# campus/sessions.py — 每用户 EasyConnect VPN 会话状态机
# 改造自 SCHOOLALY：按 user_id 维度、固定端口、断连自动重连。

import threading
import time


def _deterministic_ports(user_id, cfg):
    """根据 user_id 确定端口号，每用户固定（10000-18000）"""
    base = cfg.port_low
    rng = cfg.port_high - cfg.port_low
    socks = base + ((user_id * 2) % rng) + 1
    http = socks + 1
    if http > cfg.port_high:
        http = base + 1
        socks = base
    return socks, http


class Session:
    def __init__(self, user_id, student_id, password, socks_port, http_port, proxy_host="127.0.0.1"):
        self.user_id = user_id
        self.student_id = student_id
        self.password = password
        self.socks_port = socks_port
        self.http_port = http_port
        self.proxy_host = proxy_host
        self.container_name = "ec-c%s" % user_id
        self.status = "creating"
        self.error = None
        self.created_at = time.time()
        self._tun_miss = 0
        self._reconnect_count = 0
        self._last_reconnect = 0.0

    @property
    def student_id_masked(self):
        sid = self.student_id
        if len(sid) <= 4:
            return "*" * len(sid)
        return sid[:2] + "*" * (len(sid) - 4) + sid[-2:]


class SessionManager:
    """按 user_id 维护会话：每用户同时最多一个 VPN 会话，固定端口，断连自动重连。"""

    MAX_RECONNECTS = 5          # 10 分钟内最多重连次数
    RECONNECT_WINDOW = 600      # 重连计数窗口（秒）
    RECONNECT_COOLDOWN = 60     # 两次重连最小间隔（秒）

    def __init__(self, cfg, docker):
        self.cfg = cfg
        self.docker = docker
        self.sessions = {}
        self._lock = threading.Lock()
        threading.Thread(target=self._watchdog, daemon=True).start()

    def create(self, user_id, student_id, password, ports=None):
        student_id = (student_id or "").strip()
        password = password or ""
        if not student_id or not password:
            raise ValueError("学号和密码不能为空")
        with self._lock:
            old = self.sessions.get(user_id)
            if old:
                self._drop_locked(user_id)
            # 每用户固定端口（bridge 模式下 Docker 端口映射到不同外部端口）；
            # 共享会话池等调用方也可显式传入 allocate_ports() 分配的随机空闲端口
            if ports is None:
                ports = _deterministic_ports(user_id, self.cfg)
            socks_port, http_port = ports
            self.sessions[user_id] = Session(user_id, student_id, password, socks_port, http_port, proxy_host=self.cfg.proxy_host)
        threading.Thread(target=self._run, args=(user_id,), daemon=True).start()
        return user_id

    def get(self, user_id):
        with self._lock:
            return self.sessions.get(user_id)

    def _run(self, user_id):
        sess = self.get(user_id)
        if not sess:
            return
        try:
            self.docker.create_container(sess)
            sess.status = "connecting"
            deadline = time.time() + self.cfg.connect_timeout
            while time.time() < deadline:
                sess = self.get(user_id)
                if not sess:
                    return
                logs = self.docker.get_logs(sess)
                # 优先生效：检查 tun0（VPN 隧道真正建立）
                if self.docker.has_tun(sess):
                    sess.status = "connected"
                    sess.error = None
                    sess._tun_miss = 0
                    sess._reconnect_count = 0
                    return
                # 最终成功 = 最后一次登录事件是成功。日志是累积的，EasyConnect 失败后
                # 会自动重试（学校侧可能连续拒绝几次才放行），不能要求「没有 login failed」
                if logs.rfind("login successfully") > logs.rfind("login failed"):
                    sess.status = "connected"
                    sess.error = None
                    sess._tun_miss = 0
                    sess._reconnect_count = 0
                    return
                state = self.docker.container_state(sess)
                if state["exited"] and not state["running"]:
                    sess.status = "failed"
                    sess.error = "登录失败（容器已退出），请检查账号密码或网络"
                    return
                time.sleep(3)
            sess = self.get(user_id)
            if sess and sess.status == "connecting":
                sess.status = "failed"
                logs = self.docker.get_logs(sess)
                if logs.rfind("login failed") > logs.rfind("login successfully"):
                    sess.error = "登录失败：账号或密码错误（若确认无误，可能是学校侧暂时拒绝，请稍后重试）"
                else:
                    sess.error = "连接超时，请稍后重试"
        except Exception as e:
            sess = self.get(user_id)
            if sess:
                sess.status = "failed"
                sess.error = "创建失败: %s" % e

    def _drop_locked(self, user_id):
        sess = self.sessions.pop(user_id, None)
        if sess:
            try:
                self.docker.remove(sess)
            except Exception:
                pass

    def disconnect(self, user_id):
        with self._lock:
            self._drop_locked(user_id)

    def _watchdog(self):
        while True:
            time.sleep(30)
            now = time.time()
            to_remove = []
            for uid, sess in list(self.sessions.items()):
                if sess.status in ("connecting", "connected"):
                    state = self.docker.container_state(sess)
                    if not state["running"]:
                        # 容器已退出 → 尝试自动重连
                        self._try_reconnect(sess, uid, now, "VPN 连接已断开，正在重连…")
                        continue
                    if sess.status == "connected" and self.docker.has_tun(sess):
                        sess._tun_miss = 0
                    elif sess.status == "connected":
                        sess._tun_miss += 1
                        if sess._tun_miss >= 4:
                            # 隧道持续中断 → 尝试自动重连
                            self._try_reconnect(sess, uid, now, "VPN 隧道持续中断，正在重连…")
                            continue
                # 已超时的会话清理
                if now - sess.created_at > self.cfg.max_lifetime_hours * 3600:
                    to_remove.append(uid)
            for uid in to_remove:
                self.disconnect(uid)

    def _try_reconnect(self, sess, uid, now, reason):
        """断连自动重连：有重连窗口限制和冷却间隔"""
        # 重连冷却：距上次重连不足 RECONNECT_COOLDOWN 秒则跳过
        if now - sess._last_reconnect < self.RECONNECT_COOLDOWN:
            return
        # 重连次数限制：窗口期内不超过 MAX_RECONNECTS
        if now - sess.created_at > self.RECONNECT_WINDOW:
            sess._reconnect_count = 0  # 窗口过了重置
        if sess._reconnect_count >= self.MAX_RECONNECTS:
            sess.status = "failed"
            sess.error = reason + "（已超过最大重连次数）"
            return
        sess._reconnect_count += 1
        sess._last_reconnect = now
        sess.status = "connecting"
        sess.error = reason
        sess._tun_miss = 0
        # 清理旧容器，重新启动
        self.docker.remove(sess)
        threading.Thread(target=self._run, args=(uid,), daemon=True).start()
