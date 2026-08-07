# core/types.py — 共享类型
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class RiskLevel(Enum):
    LOW = 0
    MEDIUM = 1
    HIGH = 2
    CRITICAL = 3

    @property
    def escalated(self) -> bool:
        """风险达到需人工介入的级别。"""
        return self.value >= RiskLevel.HIGH.value


@dataclass
class CheckResult:
    name: str
    ok: bool
    message: str = ""
    severity: RiskLevel = RiskLevel.LOW
    latency_ms: float = 0.0
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class Alert:
    title: str
    detail: str = ""
    level: RiskLevel = RiskLevel.HIGH
    source: str = "harness"
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
