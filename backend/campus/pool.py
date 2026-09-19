# campus/pool.py — 共享 VPN 会话池：多个校园账号常驻在线，供活动看板免配置使用。
# 设计边界：池子只服务公开数据（活动列表/详情）；分数/成绩/校园卡等个人数据
# 一律走用户自己的会话，绝不经由共享账号查询。
# 复用 SessionManager（专用实例，键为 "pool<账号id>" 的整数保留段 900000+id）与
# DektManager（每账号一个 CAS 客户端）；CAS 验证码由注入的识图回调自动识别
# （features 层负责取站长配置的识图模型）。

import threading
import time

# 会话键保留段：与真实 user_id 错开，容器名 ec-c9000001 不会撞 ec-c<用户id>
KEY_BASE = 900000


def pool_key(account_id):
    return KEY_BASE + account_id


class PoolManager:
    REFRESH_SECONDS = 60      # 账号同步 / CAS 登录维护周期
    RECREATE_FAILED_AFTER = 600   # failed 会话隔多久重建一次（密码错误时避免疯狂重试）
    YIELD_CLEAR_CHECKS = 2        # 用户会话全部下线后，再连续观察几轮才恢复池会话

    def __init__(self, cfg, docker, sessions, dekt, get_vision, solve_captcha, log):
        self.cfg = cfg
        self.docker = docker
        self.sessions = sessions     # 专属 SessionManager 实例
        self.dekt = dekt
        self._get_vision = get_vision        # () -> {"provider","api_key","model",...} | None
        self._solve_captcha = solve_captcha  # (captcha_bytes, vision) -> 文本 | None
        self._log = log
        # key -> {"id","student_id","password","label","enabled"}（features 层定期喂入）
        self.accounts = {}
        self.ready = {}          # key -> True 表示该账号 CAS 已登录可用
        self._created_at = {}    # key -> 最近一次 create 时间戳（failed 重建节流）
        self.yielded = False     # 有用户自己的会话在线，池已让位（学校限制：单 IP 一条隧道）
        self._clear_checks = 0
        self._rr = 0
        self._lock = threading.Lock()
        threading.Thread(target=self._loop, daemon=True, name="campus-pool").start()

    def active_key(self):
        """当前应在线的账号：第一个启用的（学校限制单 IP 单隧道，其余待命）。"""
        enabled = sorted(k for k, a in self.accounts.items() if a.get("enabled"))
        return enabled[0] if enabled else None

    # ------------------------------------------------------- 账号同步（features 层调用）
    def set_accounts(self, accounts):
        """喂入 DB 里的账号全集（含停用的），按需创建/移除会话。

        学校限制单个出口 IP 同时只能有一条 VPN 隧道，因此：
        - 多个启用账号时只保持第一个在线（其余待命，主账号坏了好切换）；
        - 有用户自己的会话容器在线时池主动让位，用户全部断开并观察
          YIELD_CLEAR_CHECKS 轮后再恢复。
        """
        with self._lock:
            removed = set(self.accounts) - set(accounts)
            self.accounts = dict(accounts)
        for key in removed:
            # 账号已被删除（新集合里没有）：容器一并回收
            if self.sessions.get(key) is not None:
                self.sessions.disconnect(key)
            self.ready.pop(key, None)
            self._created_at.pop(key, None)
        now = time.time()
        active = self.active_key()
        others_online = self._others_online()

        if others_online:
            self.yielded = True
            self._clear_checks = 0
        elif self.yielded:
            self._clear_checks += 1
            if self._clear_checks > self.YIELD_CLEAR_CHECKS:
                self.yielded = False

        for key, acc in accounts.items():
            # 非活跃账号（停用 / 待命）：不留会话
            if not acc.get("enabled") or key != active:
                if self.sessions.get(key) is not None:
                    self.sessions.disconnect(key)
                self.ready.pop(key, None)
                continue
            # 让位中：断开自己的会话，等用户侧全部下线
            if self.yielded:
                if self.sessions.get(key) is not None:
                    self.sessions.disconnect(key)
                    self._log("campus pool %s 让位给用户会话，暂停共享隧道" % key)
                self.ready.pop(key, None)
                self._created_at.pop(key, None)
                continue
            sess = self.sessions.get(key)
            if sess is None:
                if now - self._created_at.get(key, 0) < self.RECREATE_FAILED_AFTER:
                    continue
                try:
                    ports = self.docker.allocate_ports()
                    self.sessions.create(key, acc["student_id"], acc["password"], ports=ports)
                    self._created_at[key] = now
                    self.ready.pop(key, None)
                    self._log("campus pool %s 会话创建中" % key)
                except (ValueError, RuntimeError) as e:
                    self._created_at[key] = now
                    self._log("campus pool %s 创建失败: %s" % (key, str(e)[:150]))

    def _others_online(self):
        """是否有用户自己的 EasyConnect 容器在线（非池的 ec-c* 都算）。"""
        try:
            containers = self.docker.client.containers.list(filters={"name": "ec-c"})
        except Exception:
            return False
        for c in containers:
            name = c.name
            if name.startswith("ec-c"):
                tail = name[4:]
                if tail.isdigit() and int(tail) >= KEY_BASE:
                    continue   # 池自己的容器
            return True
        return False

    # ------------------------------------------------------------------ 维护循环
    def _loop(self):
        while True:
            try:
                self.maintain()
            except Exception as e:
                self._log("campus pool 维护异常: %s" % str(e)[:200])
            time.sleep(self.REFRESH_SECONDS)

    def maintain(self):
        for key, acc in list(self.accounts.items()):
            if not acc.get("enabled"):
                continue
            sess = self.sessions.get(key)
            if sess is None or sess.status == "failed":
                # failed 会话由 set_accounts 下一轮按节流重建；这里只清就绪位
                self.ready.pop(key, None)
                continue
            if sess.status == "connected" and not self.ready.get(key):
                self._cas_login(key, acc)

    def _cas_login(self, key, acc):
        """会话隧道已通，完成学工 CAS 登录（AI 识码，最多 LOGIN_MAX_TRIES 次）。"""
        sess = self.sessions.get(key)
        client = self.dekt.get(key, sess) if sess else None
        if client is None:
            return
        if client.session is not None:
            self.ready[key] = True
            return
        vision = self._get_vision()
        if not vision:
            self._log("campus pool %s 未就绪：站长未配置识图模型，无法自动过验证码" % key)
            return
        from campus.dekt import DektError
        for _ in range(3):
            try:
                pending = client.prepare_login(acc["student_id"], acc["password"])
            except DektError as e:
                self._log("campus pool %s 登录失败: %s" % (key, str(e)[:120]))
                return
            if pending is None:
                break  # 已有会话
            if not pending.captcha:
                self._log("campus pool %s 验证码获取失败" % key)
                return
            text = self._solve_captcha(pending.captcha, vision)
            if not text:
                self._log("campus pool %s 验证码识别失败" % key)
                return
            try:
                client.complete_login(acc["student_id"], text)
                self.ready[key] = True
                self._log("campus pool %s CAS 登录成功" % key)
                return
            except DektError as e:
                self._log("campus pool %s 登录重试: %s" % (key, str(e)[:120]))
        self._log("campus pool %s 多次登录未成功，下一轮再试" % key)

    # ------------------------------------------------------------------ 对外取用
    def acquire(self):
        """轮转返回一个已就绪的 (key, client)；没有就绪账号返回 None。"""
        with self._lock:
            keys = [k for k, acc in self.accounts.items()
                    if acc.get("enabled") and self.ready.get(k)]
            if not keys:
                return None
            self._rr = (self._rr + 1) % len(keys)
            key = keys[self._rr]
        sess = self.sessions.get(key)
        if sess is None or sess.status != "connected":
            return None
        return key, self.dekt.get(key, sess)

    def mark_stale(self, key):
        """取用时报登录态失效：清就绪位，维护线程会重新登录。"""
        self.ready.pop(key, None)

    def overview(self):
        return {"yielded": self.yielded, "active_key": self.active_key()}

    def status_of(self, account_id):
        """给管理端看的单账号会话状态。"""
        key = pool_key(account_id)
        sess = self.sessions.get(key)
        status = sess.status if sess else "none"
        return {"status": status, "error": sess.error if sess else None,
                "cas_ready": bool(self.ready.get(key))}
