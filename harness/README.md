# harness — AI 智能体管控框架

独立于前后端的顶层目录，纯 Python 标准库（零第三方依赖），面向「AI 智能体运行时治理」。
不修改 `backend/` 任何代码；后端集成通过懒加载实现，依赖缺失时检查报失败而非崩溃。

## 三个子系统

### 上下文管理 `core/context.py`
- `ContextManager`：在 token 预算内维护对话消息列表。
- 优先级 `Priority`：`SYSTEM` > `PINNED` > `NORMAL` > `LOW`；`pinned`/`SYSTEM` 消息永不删除。
- 超预算压缩顺序：删 `LOW` → 用摘要压缩 `NORMAL`（已有 `summary` 或 `summarize` 钩子）→ 删 `NORMAL`。
- `recent(n)` 提供滑动窗口：固定消息 + 最近 n 条未固定消息。
- token 估算默认 4 字符/token，中文场景可传入自定义 `token_estimator`。

### 熵管理 `core/entropy.py`
- `shannon_entropy` / `normalized_entropy` / `confidence_to_entropy`：决策不确定性 → 归一化熵 `[0,1]`。
- `EntropyManager.evaluate()`：熵 → `RiskLevel`（LOW/MEDIUM/HIGH/CRITICAL），
  超过 `high_threshold`（默认 0.7）触发 `on_escalation` 人工介入回调，并记录历史。
- `trend()` 观察最近决策的平均熵（风险是否上升），`escalated_samples()` 列出已升级样本。

### 强制检查 `core/watchdog.py`
- `Watchdog.register(name, fn, interval=0, min_severity)` 注册自检项（`fn -> CheckResult`）。
- `run` / `run_all` 手动执行；`start()` 后台周期轮询 `interval>0` 的项。
- 失败按冷却期（默认 300s）去重告警，跟踪连续失败次数；`require(*names)` 提供行动前强制门禁（失败抛 `CheckFailed`）。
- 告警通道可插拔（`alerts.py`）：`StdoutChannel` / `FileChannel`，自行实现 `AlertChannel.send` 即可扩展 Webhook 等。

## 内置自检项 `checks/builtin.py`
- `env_presence`（自动读取仓库根 `.env`）、`http_health`、`db_connectivity`、
  `migration_consistency`（对比 `models.py` 列与数据库实际列，报 schema 漂移）、`jwt_roundtrip`。

## 命令

```bash
# 运行全部自检
python -m harness check
# 只跑某项
python -m harness check --only db_connectivity
# 失败告警写入文件
python -m harness check --alert-file log/harness-alerts.log
# 演示
python -m harness context [--tokens 30]
python -m harness entropy
# 单元测试
python -m unittest discover -s harness -t .
```

建议用 `backend\.venv\Scripts\python.exe` 运行以复用后端依赖。

## 约定
- `migration_consistency` 报 schema 漂移时，去 `backend/database.py` 的 `run_migrations()` 补 `ALTER TABLE`（见仓库 AGENTS.md 数据库迁移一节）。
