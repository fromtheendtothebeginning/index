# campus/sessions.py — 全局共享 EasyConnect VPN 会话状态机
# 单一会话：所有用户共用同一端口（管理员连接，校园服务页只读展示代理）。
# 断连自动重连。

import threading
import time


class Session:
    def __init__(self, student_id, password, socks_port, http_port, proxy_host="127.0.0.1"):
        self.student_id = student_id
        self.password = password
        # 对外端口（映射到宿主的端口，展示给用户）
        self.socks_port = socks_port
        self.http_port = http_port
        # 容器内部端口（EasyConnect 写死 1080/8888，后端经容器 IP 连接）
        self.connect_socks_port = 1080
        self.connect_http_port = 8888
        # proxy_host：后端实际连接用（容器 IP，两平台都可达）
        self.proxy_host = proxy_host
        # display_host：对外展示给用户的地址（公网域名/IP）
        self.display_host = proxy_host
        self.container_name = "ec-shared"
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
    """全局单会话：管理员连接一次，所有用户共用同一 SOCKS5 代理端口。"""

    MAX_RECONNECTS = 5          # 10 分钟内最多重连次数
    RECONNECT_WINDOW = 600      # 重连计数窗口（秒）
    RECONNECT_COOLDOWN = 60     # 两次重连最小间隔（秒）

    def __init__(self, cfg, docker):
        self.cfg = cfg
        self.docker = docker
        self.session = None
        self._lock = threading.Lock()
        threading.Thread(target=self._watchdog, daemon=True).start()

    def create(self, student_id, password):
        """建立（或重建）全局 VPN 会话。对外端口固定 10003(SOCKS5)/10004(HTTP)。"""
        student_id = (student_id or "").strip()
        password = password or ""
        if not student_id or not password:
            raise ValueError("学号和密码不能为空")
        with self._lock:
            if self.session:
                self._drop_locked()
            self.session = Session(student_id, password, 10003, 10004,
                                   proxy_host=self.cfg.proxy_host)
        threading.Thread(target=self._run, daemon=True).start()

    def get(self):
        with self._lock:
            return self.session

    def _run(self):
        sess = self.get()
        if not sess:
            return
        try:
            self.docker.create_container(sess)
            sess.status = "connecting"
            deadline = time.time() + self.cfg.connect_timeout
            fail_count = 0
            tun_hits = 0
            while time.time() < deadline:
                sess = self.get()
                if not sess:
                    return
                logs = self.docker.get_logs(sess)
                # tun0 需连续出现 3 次（约 9 秒）才算真正稳定：
                # EasyConnect 登录过程中会短暂创建 tun0，登录失败后又拆掉，
                # 只看单次存在会误判为已连接。
                if self.docker.has_tun(sess):
                    tun_hits += 1
                    if tun_hits >= 3:
                        sess.status = "connected"
                        sess.error = None
                        sess._tun_miss = 0
                        sess._reconnect_count = 0
                        return
                else:
                    tun_hits = 0
                # 日志中有 "login successfully" 且无 "login failed"（最终成功）
                if "login successfully" in logs and "login failed" not in logs:
                    sess.status = "connected"
                    sess.error = None
                    sess._tun_miss = 0
                    sess._reconnect_count = 0
                    return
                # 日志中有 "login failed"——EasyConnect 会自动重试，不要立即标记失败
                # 连续多次失败才判定（给自动重试留余地）
                if "login failed" in logs or "密码错误" in logs:
                    fail_count += 1
                    if fail_count >= 3:
                        sess.status = "failed"
                        sess.error = self._diagnose(logs)
                        return
                state = self.docker.container_state(sess)
                if state["exited"] and not state["running"]:
                    sess.status = "failed"
                    sess.error = "登录失败（容器已退出），请检查账号密码或网络"
                    return
                time.sleep(3)
            sess = self.get()
            if sess and sess.status == "connecting":
                sess.status = "failed"
                sess.error = "连接超时，请稍后重试"
        except Exception as e:
            sess = self.get()
            if sess:
                sess.status = "failed"
                sess.error = "创建失败: %s" % e

    @staticmethod
    def _diagnose(logs):
        """根据容器日志区分失败原因：网络不通 vs 账号密码错误。"""
        low = (logs or "").lower()
        # 网络类特征（EasyConnect 内部 curl 错误码）
        if "couldn't connect to server" in low or "error:7" in low:
            return "连接失败：无法连接校园 VPN 服务器（网络不通，请检查网络或服务器地址）"
        if "timeout was reached" in low or "error:28" in low:
            return "连接失败：VPN 服务器响应超时（网络不稳定或服务器不可达）"
        if "auth failed" in low:
            return "登录失败：账号或密码错误（请到「我的 → 校园服务」核对学号与 VPN 密码）"
        return "登录失败：账号或密码错误"

    def _drop_locked(self):
        sess = self.session
        self.session = None
        if sess:
            try:
                self.docker.remove(sess)
            except Exception:
                pass

    def disconnect(self):
        with self._lock:
            self._drop_locked()

    def _watchdog(self):
        while True:
            time.sleep(15)
            now = time.time()
            sess = self.get()
            if not sess:
                continue
            if sess.status in ("connecting", "connected"):
                state = self.docker.container_state(sess)
                if not state["running"]:
                    self._try_reconnect(sess, now, "VPN 连接已断开，正在重连…")
                    continue
                if sess.status == "connected" and self.docker.has_tun(sess):
                    sess._tun_miss = 0
                elif sess.status == "connected":
                    sess._tun_miss += 1
                    if sess._tun_miss >= 2:
                        self._try_reconnect(sess, now, "VPN 隧道持续中断，正在重连…")
                        continue
            # 已超时的会话清理
            if now - sess.created_at > self.cfg.max_lifetime_hours * 3600:
                self.disconnect()

    def _try_reconnect(self, sess, now, reason):
        """断连自动重连：有重连窗口限制和冷却间隔"""
        if now - sess._last_reconnect < self.RECONNECT_COOLDOWN:
            return
        if now - sess.created_at > self.RECONNECT_WINDOW:
            sess._reconnect_count = 0
        if sess._reconnect_count >= self.MAX_RECONNECTS:
            sess.status = "failed"
            sess.error = reason + "（已超过最大重连次数）"
            return
        sess._reconnect_count += 1
        sess._last_reconnect = now
        sess.status = "connecting"
        sess.error = reason
        sess._tun_miss = 0
        self.docker.remove(sess)
        threading.Thread(target=self._run, daemon=True).start()
