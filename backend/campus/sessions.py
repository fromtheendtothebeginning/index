# campus/sessions.py — 每用户 EasyConnect VPN 会话状态机
# 移植自 SCHOOLALY（server/app/sessions.py）：token 维度 → anticraft user_id 维度，
# 容器名 ec-c{u_id} 便于定位；密码来自凭据库解密，仅存内存。

import threading
import time


class Session:
    def __init__(self, user_id, student_id, password, socks_port, http_port):
        self.user_id = user_id
        self.student_id = student_id
        self.password = password
        self.socks_port = socks_port
        self.http_port = http_port
        self.container_name = "ec-c%s" % user_id
        self.status = "creating"
        self.error = None
        self.created_at = time.time()

    @property
    def student_id_masked(self):
        sid = self.student_id
        if len(sid) <= 4:
            return "*" * len(sid)
        return sid[:2] + "*" * (len(sid) - 4) + sid[-2:]


class SessionManager:
    """按 user_id 维护会话：每用户同时最多一个 VPN 会话。"""

    def __init__(self, cfg, docker):
        self.cfg = cfg
        self.docker = docker
        self.sessions = {}
        self._lock = threading.Lock()
        threading.Thread(target=self._watchdog, daemon=True).start()

    def create(self, user_id, student_id, password):
        student_id = (student_id or "").strip()
        password = password or ""
        if not student_id or not password:
            raise ValueError("学号和密码不能为空")
        with self._lock:
            # 已有会话则先断开（重新连接场景）
            old = self.sessions.get(user_id)
            if old:
                self._drop_locked(user_id)
            if len(self.sessions) >= self.cfg.max_sessions:
                raise RuntimeError("已达并发上限(%d)，请稍后再试" % self.cfg.max_sessions)
            socks_port, http_port = self.docker.allocate_ports()
            self.sessions[user_id] = Session(user_id, student_id, password, socks_port, http_port)
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
                if "login successfully" in logs:
                    sess.status = "connected"
                    sess.error = None
                    return
                if "login failed" in logs or "密码错误" in logs:
                    sess.status = "failed"
                    sess.error = "登录失败：账号或密码错误"
                    return
                state = self.docker.container_state(sess)
                if state["exited"] and not state["running"]:
                    sess.status = "failed"
                    sess.error = "登录失败（容器已退出），请检查账号密码或网络"
                    return
                time.sleep(2)
            sess = self.get(user_id)
            if sess and sess.status == "connecting":
                sess.status = "failed"
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
                        sess.status = "failed"
                        sess.error = "VPN 连接已断开，请重新连接"
                        continue
                    # 隧道健康：tun0 持续缺失约2分钟(连续4次)则判定失效
                    if sess.status == "connected" and self.docker.has_tun(sess):
                        sess._tun_miss = 0
                    elif sess.status == "connected":
                        sess._tun_miss = getattr(sess, "_tun_miss", 0) + 1
                        if sess._tun_miss >= 4:
                            sess.status = "failed"
                            sess.error = "VPN 隧道持续中断，请重新连接"
                if now - sess.created_at > self.cfg.max_lifetime_hours * 3600:
                    to_remove.append(uid)
            for uid in to_remove:
                self.disconnect(uid)
