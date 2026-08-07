# core/context.py — 上下文管理：token 预算、优先级裁剪、摘要压缩、滑动窗口
from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import Callable, Optional


class Priority(IntEnum):
    SYSTEM = 4  # 系统指令，永不删除
    PINNED = 3  # 用户固定，永不删除
    NORMAL = 2  # 普通对话，可压缩、可裁剪
    LOW = 1     # 低价值，最优先裁剪


@dataclass
class Message:
    role: str
    content: str
    priority: Priority = Priority.NORMAL
    summary: str = ""  # 已有摘要（压缩时替换 content）
    pinned: bool = False


def default_token_estimator(text: str) -> int:
    """粗略 token 估算：约 4 字符/token；中文场景可传入更精确的估算器。"""
    return max(1, len(text) // 4)


class ContextManager:
    """在 token 预算内维护对话上下文。

    超预算时按顺序压缩：
      1. 删除未固定的 LOW 消息
      2. 用摘要压缩未固定的 NORMAL 消息（已有 summary，或调用 summarize 钩子）
      3. 删除未固定的 NORMAL 消息
    固定消息（pinned / SYSTEM）永不删除。
    """

    def __init__(self, token_limit: int = 8000,
                 token_estimator: Callable[[str], int] = default_token_estimator,
                 summarize: Optional[Callable[[str], str]] = None):
        self.token_limit = token_limit
        self.token_estimator = token_estimator
        self.summarize = summarize
        self._messages: list[Message] = []

    def add(self, role: str, content: str, priority: Priority = Priority.NORMAL,
            pinned: bool = False, summary: str = "") -> Message:
        m = Message(role, content, Priority(priority), summary, pinned)
        self._messages.append(m)
        return m

    @property
    def messages(self) -> list[Message]:
        return list(self._messages)

    def usage(self) -> int:
        return sum(self.token_estimator(m.content) for m in self._messages)

    def compact(self, max_rounds: int = 100) -> int:
        """压缩到预算内，返回发生裁剪/压缩的条数。"""
        changed = 0
        while self.usage() > self.token_limit and changed < max_rounds:
            if self._drop_low():
                changed += 1
                continue
            if self._compress():
                changed += 1
                continue
            if self._drop_normal():
                changed += 1
                continue
            break
        return changed

    def recent(self, window_size: int = 10) -> list[Message]:
        """滑动窗口：固定消息 + 最近 window_size 条未固定消息。"""
        pinned = [m for m in self._messages if m.pinned]
        others = [m for m in self._messages if not m.pinned]
        return pinned + others[-window_size:]

    def _drop_low(self) -> bool:
        idx = next((i for i, m in enumerate(self._messages)
                    if not m.pinned and m.priority == Priority.LOW), None)
        if idx is None:
            return False
        del self._messages[idx]
        return True

    def _compress(self) -> bool:
        for i, m in enumerate(self._messages):
            if m.pinned or m.priority >= Priority.SYSTEM:
                continue
            summary = m.summary or (self.summarize(m.content) if self.summarize else "")
            if summary and len(summary) < len(m.content):
                m.content = summary
                m.summary = summary
                return True
        return False

    def _drop_normal(self) -> bool:
        idx = next((i for i, m in enumerate(self._messages)
                    if not m.pinned and m.priority < Priority.SYSTEM), None)
        if idx is None:
            return False
        del self._messages[idx]
        return True
