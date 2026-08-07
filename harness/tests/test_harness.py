# tests/test_harness.py — 核心逻辑单元测试（stdlib unittest，无需第三方依赖）
import unittest

from harness.alerts import AlertRouter
from harness.core.context import ContextManager, Priority
from harness.core.entropy import EntropyManager, normalized_entropy, shannon_entropy
from harness.core.types import CheckResult, RiskLevel
from harness.core.watchdog import CheckFailed, Watchdog


class TestContext(unittest.TestCase):
    def test_compact_drops_low_priority_first(self):
        cm = ContextManager(token_limit=100, token_estimator=len)
        cm.add("system", "X" * 40, priority=Priority.SYSTEM, pinned=True)
        cm.add("user", "Y" * 50, priority=Priority.LOW)
        cm.add("assistant", "Z" * 60, priority=Priority.NORMAL)
        cm.compact()
        self.assertLessEqual(cm.usage(), 100)
        self.assertEqual([m.content for m in cm.messages], ["X" * 40, "Z" * 60])

    def test_compact_summarizes_before_dropping_normal(self):
        cm = ContextManager(token_limit=40, token_estimator=len,
                            summarize=lambda s: s[: len(s) // 2] + "…")
        cm.add("system", "X" * 10, priority=Priority.SYSTEM, pinned=True)
        cm.add("user", "Y" * 50, priority=Priority.NORMAL)
        cm.compact()
        self.assertLessEqual(cm.usage(), 40)
        self.assertEqual(len(cm.messages), 2)  # 压缩而非删除
        self.assertTrue(cm.messages[1].content.startswith("Y"))

    def test_system_pinned_never_removed(self):
        cm = ContextManager(token_limit=20, token_estimator=len)
        cm.add("system", "S" * 40, priority=Priority.SYSTEM, pinned=True)
        cm.add("user", "Y" * 50, priority=Priority.LOW)
        cm.compact()
        self.assertIn("S" * 40, [m.content for m in cm.messages])

    def test_recent_window_keeps_pinned(self):
        cm = ContextManager(token_limit=9999, token_estimator=len)
        cm.add("system", "S", priority=Priority.SYSTEM, pinned=True)
        for i in range(5):
            cm.add("user", str(i), priority=Priority.NORMAL)
        recent = cm.recent(window_size=2)
        self.assertEqual([m.content for m in recent], ["S", "3", "4"])


class TestEntropy(unittest.TestCase):
    def test_shannon_uniform(self):
        self.assertAlmostEqual(shannon_entropy([0.5, 0.5]), 1.0)

    def test_normalized_uniform_is_one(self):
        self.assertAlmostEqual(normalized_entropy([0.25, 0.25, 0.25, 0.25]), 1.0)

    def test_low_confidence_is_low_risk(self):
        em = EntropyManager()
        s = em.evaluate("act", confidence=0.99)
        self.assertEqual(s.risk, RiskLevel.LOW)

    def test_max_uncertainty_escalates(self):
        fired = []
        em = EntropyManager(on_escalation=lambda s: fired.append(s))
        s = em.evaluate("destructive", probabilities=[0.5, 0.5])
        self.assertEqual(s.risk, RiskLevel.CRITICAL)
        self.assertEqual(len(fired), 1)

    def test_trend_average(self):
        em = EntropyManager()
        for _ in range(5):
            em.evaluate("x", confidence=0.5)
        self.assertAlmostEqual(em.trend(window=5), 1.0, places=6)


class _RecordingChannel:
    def __init__(self):
        self.alerts = []

    def send(self, alert):
        self.alerts.append(alert)


class TestWatchdog(unittest.TestCase):
    def test_failure_alerts_with_cooldown(self):
        ch = _RecordingChannel()
        wd = Watchdog(alerts=AlertRouter([ch]), alert_cooldown_s=300)

        def flaky():
            return CheckResult("flaky", False, "boom", RiskLevel.CRITICAL)

        wd.register("flaky", flaky)
        wd.run("flaky")
        wd.run("flaky")  # 冷却期内不重复告警
        self.assertEqual(len(ch.alerts), 1)
        self.assertEqual(wd.checks["flaky"].consecutive_failures, 2)

    def test_recovery_resets_counter(self):
        wd = Watchdog()
        state = {"n": 0}

        def toggle():
            state["n"] += 1
            return CheckResult("t", state["n"] % 2 == 0)

        wd.register("t", toggle)
        wd.run("t")  # fail
        wd.run("t")  # ok
        self.assertEqual(wd.checks["t"].consecutive_failures, 0)

    def test_require_raises_on_failure(self):
        wd = Watchdog()
        wd.register("ok", lambda: CheckResult("ok", True))
        wd.register("bad", lambda: CheckResult("bad", False, "nope", RiskLevel.HIGH))
        with self.assertRaises(CheckFailed):
            wd.require("ok", "bad")

    def test_exception_in_check_is_failure(self):
        wd = Watchdog()

        def boom():
            raise RuntimeError("x")

        wd.register("boom", boom)
        result = wd.run("boom")
        self.assertFalse(result.ok)
        self.assertEqual(result.severity, RiskLevel.CRITICAL)


if __name__ == "__main__":
    unittest.main()
