# runner.py — CLI：check / context / entropy
from __future__ import annotations

import argparse

from .alerts import FileChannel
from .checks import builtin
from .core.context import ContextManager, Priority
from .core.entropy import EntropyManager
from .core.watchdog import Watchdog


def cmd_check(args: argparse.Namespace) -> int:
    wd = Watchdog()
    if args.alert_file:
        wd.alerts.add(FileChannel(args.alert_file))
    wd.register("env_presence", lambda: builtin.env_presence("DB_USER", "DB_PASSWORD", "SECRET_KEY"))
    wd.register("api_health", lambda: builtin.http_health("http://127.0.0.1:8000/api/health"))
    wd.register("db_connectivity", builtin.db_connectivity)
    wd.register("migration_consistency", builtin.migration_consistency)
    wd.register("jwt_roundtrip", builtin.jwt_roundtrip)
    names = [args.only] if args.only else None
    results = wd.run_all(names)
    for r in results:
        status = "OK  " if r.ok else "FAIL"
        print(f"[{status}] {r.name:22s} ({r.latency_ms:6.1f}ms) {r.message}")
    ok = all(r.ok for r in results)
    print("所有检查通过" if ok else "存在失败的检查")
    return 0 if ok else 1


def cmd_context(args: argparse.Namespace) -> int:
    cm = ContextManager(token_limit=args.tokens, summarize=lambda s: s[: len(s) // 2] + "…")
    cm.add("system", "你是 anticraft 的运维助手，系统指令固定在预算内。", priority=Priority.SYSTEM, pinned=True)
    for i in range(1, 6):
        cm.add("user", f"第{i}轮请求：包含一些需要保留的详细上下文内容，文本较长以便演示压缩效果。",
               priority=Priority.NORMAL)
    before, dropped = cm.usage(), cm.compact()
    print(f"token: {before} -> {cm.usage()} (limit={cm.token_limit}, 压缩/裁剪 {dropped} 条)")
    for m in cm.recent(3):
        print(f"  [{m.role:9s}] {m.content[:32]}")
    return 0


def cmd_entropy(args: argparse.Namespace) -> int:
    def on_escalation(s):
        print(f"  ! 需要人工介入：{s.decision} risk={s.risk.name} ent={s.entropy:.3f}")

    em = EntropyManager(on_escalation=on_escalation)
    cases = [
        ("执行删除操作确认", [0.55, 0.45], None),
        ("解析用户意图", [0.33, 0.33, 0.34], None),
        ("自动生成修复补丁", [0.70, 0.15, 0.15], None),
        ("明确执行命令", None, 0.99),
    ]
    for decision, probs, conf in cases:
        s = em.evaluate(decision, probabilities=probs, confidence=conf)
        print(f"{decision:16s} risk={s.risk.name:8s} ent={s.entropy:.3f}")
    print(f"风险趋势 avg_entropy={em.trend():.3f} escalated={len(em.escalated_samples())}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m harness",
        description="anticraft harness — AI 智能体管控框架（上下文/熵/强制检查）",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_check = sub.add_parser("check", help="运行看门狗自检（可加 --only）")
    p_check.add_argument("--only", help="只运行指定检查项")
    p_check.add_argument("--alert-file", help="失败告警同时写入该文件")
    p_check.set_defaults(fn=cmd_check)

    p_ctx = sub.add_parser("context", help="上下文管理演示")
    p_ctx.add_argument("--tokens", type=int, default=120)
    p_ctx.set_defaults(fn=cmd_context)

    p_ent = sub.add_parser("entropy", help="熵/风险度量演示")
    p_ent.set_defaults(fn=cmd_entropy)

    args = parser.parse_args(argv)
    return args.fn(args)
