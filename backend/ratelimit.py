# ratelimit.py — 内存滑动窗口限流器 & 账号失败锁定器（线程安全，纯标准库）

import threading
import time
from collections import deque


class SlidingWindow:
    """内存滑动窗口限流器：按 key 在 window_seconds 内最多放行 limit 次"""

    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window_seconds = window_seconds
        self._lock = threading.Lock()
        self._hits = {}

    def allow(self, key: str) -> bool:
        """记录一次访问；窗口内次数未超限返回 True，否则返回 False（不记录）"""
        now = time.monotonic()
        with self._lock:
            timestamps = self._hits.setdefault(key, deque())
            cutoff = now - self.window_seconds
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()
            if len(timestamps) >= self.limit:
                return False
            timestamps.append(now)
            return True


class AccountLock:
    """账号失败锁定器：连续失败达到 max_fail 次后锁定 lock_seconds"""

    def __init__(self, max_fail: int = 5, lock_seconds: int = 900):
        self.max_fail = max_fail
        self.lock_seconds = lock_seconds
        self._lock = threading.Lock()
        self._fail_count = {}
        self._lock_until = {}

    def check(self, key: str) -> bool:
        """当前是否可用；被锁定返回 False，过期自动解锁"""
        now = time.monotonic()
        with self._lock:
            lock_until = self._lock_until.get(key)
            if lock_until is not None:
                if now < lock_until:
                    return False
                self._lock_until.pop(key, None)
                self._fail_count.pop(key, None)
            return True

    def fail(self, key: str) -> None:
        """记录一次失败，达到阈值后锁定"""
        with self._lock:
            count = self._fail_count.get(key, 0) + 1
            self._fail_count[key] = count
            if count >= self.max_fail:
                self._lock_until[key] = time.monotonic() + self.lock_seconds

    def clear(self, key: str) -> None:
        """成功后清除失败记录与锁定状态"""
        with self._lock:
            self._fail_count.pop(key, None)
            self._lock_until.pop(key, None)


# 模块级单例
login_ip = SlidingWindow(10, 60)          # 同一 IP 每分钟最多 10 次登录尝试
login_user = SlidingWindow(5, 60)         # 同一用户名每分钟最多 5 次登录尝试
register_ip = SlidingWindow(5, 60)        # 同一 IP 每分钟最多 5 次注册
reset_ip = SlidingWindow(5, 60)           # 同一 IP 每分钟最多 5 次密码重置
check_username_ip = SlidingWindow(60, 60) # 同一 IP 每分钟最多 60 次用户名探测
reset_lock = AccountLock(5, 900)          # 同一账号连续 5 次邀请码校验失败锁定 15 分钟
