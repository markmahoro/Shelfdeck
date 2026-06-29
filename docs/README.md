# ShelfDeck Documentation Index

本文用于区分 ShelfDeck 当前生产基线和下一代重写文档。

## v2 production baseline

`docs/v2/`

v2 表示当前生产环境正在运行的 ShelfDeck service 基线。当前仓库正在回退并固化到该基线，用于后续标记 `v2.0.0` 或其他明确的 v2 tag。

`docs/v2/` 是当前生产流程、开发流程、调试流程和 v2 生产基线说明的目录。

## v3 rewrite

`docs/v3/`

v3 是下一轮 service 优先重构升级目标。v3 文档只用于给后续 agent 提供操作上下文、排摸入口和任务提示词，不预设 v3 的具体架构设计。desktop 与 worker 重构方案待定。

核心入口：

- `docs/v3/README.md`
- `docs/v3/OPERATION_CONTEXT.md`
- `docs/v3/DISCOVERY_CHECKLIST.md`
- `docs/v3/GOAL_PROMPT.md`
