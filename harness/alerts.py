# alerts.py — 告警通道（可插拔）
from __future__ import annotations

import sys
from abc import ABC, abstractmethod
from pathlib import Path

from .core.types import Alert


class AlertChannel(ABC):
    @abstractmethod
    def send(self, alert: Alert) -> None: ...


class StdoutChannel(AlertChannel):
    def send(self, alert: Alert) -> None:
        print(f"[{alert.level.name}] {alert.title} — {alert.detail}", file=sys.stderr)


class FileChannel(AlertChannel):
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def send(self, alert: Alert) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(f"{alert.timestamp.isoformat()} [{alert.level.name}] {alert.title}: {alert.detail}\n")


class AlertRouter:
    def __init__(self, channels=None):
        self.channels = list(channels) if channels else [StdoutChannel()]

    def add(self, channel: AlertChannel) -> None:
        self.channels.append(channel)

    def dispatch(self, alert: Alert) -> None:
        for ch in self.channels:
            try:
                ch.send(alert)
            except Exception as exc:
                print(f"[harness] alert channel failed: {exc!r}", file=sys.stderr)
