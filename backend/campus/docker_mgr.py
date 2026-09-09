# campus/docker_mgr.py — EasyConnect 容器生命周期与端口分配
# 移植自 SCHOOLALY（server/app/docker_mgr.py），配置改读 campus.config.Config

import random
import threading

import docker
from docker.errors import NotFound


class DockerManager:
    def __init__(self, cfg):
        self.cfg = cfg
        self._lock = threading.Lock()
        self.client = self._connect(cfg)

    @staticmethod
    def _connect(cfg):
        """连接 Docker：优先 DOCKER_HOST，失败则回退本机 Unix socket。

        服务器上 DOCKER_HOST 若仍指向 tcp://127.0.0.1:2375 但守护进程只监听
        unix socket 时，回退可避免整个校园服务不可用。
        """
        host = (cfg.docker_host or "").strip()
        candidates = []
        if host:
            candidates.append(host)
        candidates.append("unix:///var/run/docker.sock")
        last_err = None
        for base in candidates:
            try:
                client = docker.DockerClient(base_url=base)
                client.ping()
                return client
            except Exception as e:
                last_err = e
        raise last_err

    def _used_ports(self):
        used = set()
        for c in self.client.containers.list(all=True):
            for proto in ("1080/tcp", "8888/tcp"):
                for bind in c.ports.get(proto, []) or []:
                    hp = bind.get("HostPort")
                    if hp:
                        used.add(int(hp))
        return used

    def allocate_ports(self):
        with self._lock:
            low, high = self.cfg.port_low, self.cfg.port_high
            free = [p for p in range(low, high + 1) if p not in self._used_ports()]
            if len(free) < 2:
                raise RuntimeError("代理端口资源不足")
            socks = random.choice(free)
            free.remove(socks)
            http = random.choice(free)
        return socks, http

    def create_container(self, sess):
        # host 模式：容器共享宿主网络栈，tun/路由正常工作
        # EasyConnect 默认 SOCKS5=1080, HTTP=8888，不传 -l 参数
        cli_opts = "-d %s -u %s -p %s" % (self.cfg.vpn_addr, sess.student_id, sess.password)
        env = {
            "EC_VER": self.cfg.ec_ver,
            "CLI_OPTS": cli_opts,
            "PING_ADDR": self.cfg.keepalive_addr,
            "PING_INTERVAL": self.cfg.ping_interval,
        }
        for attempt in range(2):
            try:
                self.client.containers.run(
                    self.cfg.ec_image,
                    name=sess.container_name,
                    detach=True,
                    remove=True,
                    devices=["/dev/net/tun"],
                    privileged=True,
                    network_mode="host",
                    environment=env,
                    mem_limit=self.cfg.mem_limit,
                )
                return
            except docker.errors.APIError as e:
                if "Conflict" in str(e) and attempt == 0:
                    self.remove(sess)
                    continue
                raise

    def remove(self, sess):
        try:
            self.client.containers.get(sess.container_name).remove(force=True)
        except NotFound:
            pass

    def container_state(self, sess):
        try:
            c = self.client.containers.get(sess.container_name)
        except NotFound:
            return {"running": False, "exited": True}
        c.reload()
        state = c.attrs.get("State", {})
        return {"running": bool(state.get("Running")), "exited": not state.get("Running")}

    def get_logs(self, sess, tail=200):
        """容器 stdout 日志 + EasyConnect 内部日志（含 curl 错误码，用于诊断失败原因）"""
        try:
            c = self.client.containers.get(sess.container_name)
        except NotFound:
            return ""
        out = ""
        try:
            out = (c.logs(tail=tail) or b"").decode("utf-8", "replace")
        except Exception:
            pass
        try:
            r = c.exec_run("sh -c 'tail -60 /usr/share/sangfor/EasyConnect/resources/logs/easyconn.log 2>/dev/null'")
            if r.exit_code == 0 and r.output:
                out += "\n" + r.output.decode("utf-8", "replace")
        except Exception:
            pass
        return out

    def has_tun(self, sess):
        """容器内 VPN 隧道(tun0)是否存在"""
        try:
            c = self.client.containers.get(sess.container_name)
            r = c.exec_run("sh -c 'ip link show tun0'")
            return r.exit_code == 0
        except Exception:
            return False

    def cleanup_orphans(self):
        for c in self.client.containers.list(all=True, filters={"name": "ec-"}):
            try:
                c.remove(force=True)
            except Exception:
                pass
