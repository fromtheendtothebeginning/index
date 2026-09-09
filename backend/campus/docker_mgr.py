# campus/docker_mgr.py — EasyConnect 容器生命周期与端口分配
# 移植自 SCHOOLALY（server/app/docker_mgr.py），配置改读 campus.config.Config

import random
import socket
import threading

import docker
from docker.errors import NotFound


class DockerManager:
    def __init__(self, cfg):
        self.cfg = cfg
        self._lock = threading.Lock()
        self.client = self._connect(cfg)
        # WSL2 需要 bridge+legacy iptables 才能建 tun0；原生 Linux 用 host 模式最省事
        self.is_wsl = self._detect_wsl()

    @staticmethod
    def _detect_wsl():
        try:
            with open("/proc/version", "r") as f:
                return "microsoft" in f.read().lower()
        except Exception:
            return False

    @staticmethod
    def _resolve_hosts(*hosts):
        """宿主侧预解析域名 → {host: ip}，用于注入容器 /etc/hosts。"""
        out = {}
        for h in hosts:
            if not h:
                continue
            try:
                ip = socket.gethostbyname(h)
                if ip:
                    out[h] = ip
            except Exception:
                pass
        return out

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
        """按环境选网络模式，对外端口统一 10003(SOCKS5)/10004(HTTP)。

        - 原生 Linux（服务器）：host 模式。容器直接监听宿主 1080/8888
          （bridge 模式下 VPN 连不通），再用 socat 把 10003/10004 转发过去。
        - WSL2：bridge + 端口映射（宿主 10003→容器 1080，10004→8888），
          并加 IPTABLES_LEGACY=1（否则 `ip route flush table 2` 报
          "FIB table does not exist"，tun0 建不起来）。host 模式下 WSL 登录超时。
        后端统一经 1080/8888 连代理：host 模式走 127.0.0.1，WSL 走容器 IP。
        """
        cli_opts = "-d %s -u %s -p %s" % (self.cfg.vpn_addr, sess.student_id, sess.password)
        env = {
            "EC_VER": self.cfg.ec_ver,
            "CLI_OPTS": cli_opts,
            "PING_ADDR": self.cfg.keepalive_addr,
            "PING_INTERVAL": self.cfg.ping_interval,
        }
        kwargs = {}
        if self.is_wsl:
            env["IPTABLES_LEGACY"] = "1"
            kwargs["ports"] = {
                "1080/tcp": ("0.0.0.0", str(sess.socks_port)),
                "8888/tcp": ("0.0.0.0", str(sess.http_port)),
            }
        else:
            kwargs["network_mode"] = "host"
        # 容器内 DNS 偶发解析失败（curl error:6 Couldn't resolve host name）：
        # 宿主侧预解析 VPN 域名写入容器 /etc/hosts；宿主也解析不了时用配置的 IP 兜底
        extra = self._resolve_hosts(self.cfg.vpn_addr)
        if not extra.get(self.cfg.vpn_addr) and getattr(self.cfg, "vpn_ip", ""):
            extra[self.cfg.vpn_addr] = self.cfg.vpn_ip
        if extra:
            kwargs["extra_hosts"] = extra
        for attempt in range(2):
            try:
                c = self.client.containers.run(
                    self.cfg.ec_image,
                    name=sess.container_name,
                    detach=True,
                    remove=True,
                    devices=["/dev/net/tun"],
                    privileged=True,
                    environment=env,
                    mem_limit=self.cfg.mem_limit,
                    **kwargs,
                )
                if self.is_wsl:
                    # WSL mirrored 模式宿主访问不到端口映射，改用容器 IP
                    try:
                        c.reload()
                        nets = c.attrs.get("NetworkSettings", {}).get("Networks", {})
                        ip = next((n.get("IPAddress") for n in nets.values() if n.get("IPAddress")), "")
                        if ip:
                            sess.proxy_host = ip
                    except Exception:
                        pass
                else:
                    sess.proxy_host = "127.0.0.1"
                    self._forward_ports(c, sess)
                return
            except docker.errors.APIError as e:
                if "Conflict" in str(e) and attempt == 0:
                    self.remove(sess)
                    continue
                raise

    @staticmethod
    def _forward_ports(container, sess):
        """host 模式下把对外端口重定向到容器实际监听的 1080/8888。

        用内核 iptables REDIRECT（而非 socat）：socat 用户态转发在服务器上
        会让 HTTPS 握手卡死（实测 TLS 直接断开），iptables 没有这个问题。
        """
        if (sess.socks_port, sess.http_port) == (1080, 8888):
            return
        rules = [
            f"iptables -t nat -A PREROUTING -p tcp --dport {sess.socks_port} -j REDIRECT --to-port 1080",
            f"iptables -t nat -A PREROUTING -p tcp --dport {sess.http_port} -j REDIRECT --to-port 8888",
        ]
        for rule in rules:
            try:
                container.exec_run(["sh", "-c", rule])
            except Exception:
                pass

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
