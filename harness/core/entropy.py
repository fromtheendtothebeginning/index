# core/entropy.py — 熵/不确定性管理：风险度量、阈值分级、人工介入
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass
from typing import Callable, Optional, Sequence

from .types import RiskLevel


def shannon_entropy(probabilities: Sequence[float]) -> float:
    """香农熵（bits）。"""
    return -sum(p * math.log2(p) for p in probabilities if p > 0)


def normalized_entropy(probabilities: Sequence[float]) -> float:
    """归一化熵：除以 log2(n)，范围 [0, 1]。"""
    n = len(probabilities)
    if n <= 1:
        return 0.0
    return shannon_entropy(probabilities) / math.log2(n)


def confidence_to_entropy(confidence: float) -> float:
    """单一置信度 → 伯努利熵（bits），范围 [0, 1]。"""
    c = min(max(confidence, 0.0), 1.0)
    return shannon_entropy([c, 1 - c])


@dataclass
class RiskSample:
    decision: str
    risk: RiskLevel
    entropy: float
    note: str = ""


class EntropyManager:
    """把决策不确定性转成归一化熵 → 风险分级 → 超阈值触发人工介入。

    阈值：MEDIUM = high_threshold/2，HIGH = high_threshold，CRITICAL = 0.85。
    """

    def __init__(self, history: int = 100, high_threshold: float = 0.7,
                 on_escalation: Optional[Callable[[RiskSample], None]] = None):
        self.high_threshold = high_threshold
        self.on_escalation = on_escalation
        self._history: deque[RiskSample] = deque(maxlen=history)

    def evaluate(self, decision: str, probabilities: Optional[Sequence[float]] = None,
                 confidence: Optional[float] = None, note: str = "") -> RiskSample:
        if probabilities is not None:
            ent = normalized_entropy(probabilities)
        elif confidence is not None:
            ent = confidence_to_entropy(confidence)
        else:
            ent = 0.0
        risk = self._classify(ent)
        sample = RiskSample(decision, risk, ent, note)
        self._history.append(sample)
        if risk.escalated and self.on_escalation:
            self.on_escalation(sample)
        return sample

    def trend(self, window: int = 10) -> float:
        """最近 window 条决策的平均归一化熵（风险趋势）。"""
        recent = list(self._history)[-window:]
        return sum(s.entropy for s in recent) / len(recent) if recent else 0.0

    def escalated_samples(self) -> list[RiskSample]:
        return [s for s in self._history if s.risk.escalated]

    def _classify(self, ent: float) -> RiskLevel:
        if ent >= 0.85:
            return RiskLevel.CRITICAL
        if ent >= self.high_threshold:
            return RiskLevel.HIGH
        if ent >= self.high_threshold / 2:
            return RiskLevel.MEDIUM
        return RiskLevel.LOW
