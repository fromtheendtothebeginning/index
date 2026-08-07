# core/watchdog.py — 强制检查：周期自检、失败告警（冷却去重）、行动前门禁
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

from ..alerts import AlertRouter
from .types import Alert, CheckResult, RiskLevel

CheckFn = Callable[[], CheckResult]


class CheckFailed(RuntimeError):
    """require() 强制门禁未通过。"""

    def __init__(self, results):
        self.results = results
        super().__init__("check failed: " + ", ".join(r.name for r in results if not r.ok))


@dataclass
class Check:
    name: str
    fn: CheckFn
    interval: float = 0.0  # 0 = 不进入周期轮询，仅手动触发
    min_severity: RiskLevel = RiskLevel.MEDIUM  # 失败达到该级别才告警
    consecutive_failures: int = 0


class Watchdog:
    """注册检查项，手动/周期执行；失败按冷却去重告警；require() 提供强制门禁。"""

    def __init__(self, alerts: Optional[AlertRouter] = None, alert_cooldown_s: float = 300.0):
        self.alerts = alerts or AlertRouter()
        self.alert_cooldown_s = alert_cooldown_s
        self._checks: dict[str, Check] = {}
        self._last_results: dict[str, CheckResult] = {}
        self._last_alert_ts: dict[str, float] = {}
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def register(self, name: str, fn: CheckFn, interval: float = 0.0,
                 min_severity: RiskLevel = RiskLevel.MEDIUM) -> "Watchdog":
        self._checks[name] = Check(name, fn, interval, min_severity)
        return self

    @property
    def checks(self) -> dict[str, Check]:
        return dict(self._checks)

    def run(self, name: str) -> CheckResult:
        check = self._checks.get(name)
        if check is None:
            result = CheckResult(name, False, "未注册的检查项", RiskLevel.HIGH)
            self._last_results[name] = result
            return result
        t0 = time.perf_counter()
        try:
            result = check.fn()
        except Exception as exc:  # 检查自身抛异常视为失败
            result = CheckResult(name, False, f"check raised: {exc!r}", RiskLevel.CRITICAL)
        result.latency_ms = (time.perf_counter() - t0) * 1000
        self._last_results[name] = result
        self._maybe_alert(check, result)
        return result

    def run_all(self, names: Optional[list[str]] = None) -> list[CheckResult]:
        targets = names or list(self._checks)
        return [self.run(n) for n in targets]

    def require(self, *names: str) -> list[CheckResult]:
        """强制门禁：指定检查全部通过才返回，否则抛 CheckFailed。"""
        results = self.run_all(list(names))
        failed = [r for r in results if not r.ok]
        if failed:
            raise CheckFailed(results)
        return results

    def start(self, interval: float = 30.0) -> None:
        """后台周期执行 interval>0 的检查。"""
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()

        def _loop():
            while not self._stop.is_set():
                for name, check in self._checks.items():
                    if check.interval > 0:
                        self.run(name)
                self._stop.wait(interval)

        self._thread = threading.Thread(target=_loop, daemon=True, name="harness-watchdog")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    def _maybe_alert(self, check: Check, result: CheckResult) -> None:
        if result.ok:
            check.consecutive_failures = 0
            return
        check.consecutive_failures += 1
        if result.severity.value < check.min_severity.value:
            return
        now = time.monotonic()
        if now - self._last_alert_ts.get(check.name, -1e9) < self.alert_cooldown_s:
            return
        self._last_alert_ts[check.name] = now
        self.alerts.dispatch(Alert(
            title=f"watchdog: {check.name}",
            detail=f"连续失败 {check.consecutive_failures} 次：{result.message}",
            level=result.severity,
            source="harness.watchdog",
        ))
