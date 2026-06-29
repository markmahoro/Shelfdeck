# ShelfDeck Documentation Index

本文用于区分 ShelfDeck 当前生产基线和下一代重写文档。

## v2 production baseline

`docs/v2/`

v2 表示当前生产环境正在运行的 ShelfDeck service 基线。当前仓库正在回退并固化到该基线，用于后续标记 `v2.0.0` 或其他明确的 v2 tag。

`docs/v2/` 是当前生产流程、开发流程、调试流程和 v2 生产基线说明的目录。

## v3 rewrite

`docs/v3/`

v3 是更彻底重构的远期备选方向。当前不作为优先实施路线。

## v2.5 service architecture upgrade

`docs/v2.5/`

v2.5 是当前推荐路线：从 v2.0 生产基线出发，保留 v2 已验证 flow 能力，优先升级 `media-service` 的架构内核、数据模型、projection、调度边界和 service Admin Web 语义。

核心入口：

- `docs/v2.5/README.md`
- `docs/v2.5/UPGRADE_STRATEGY.md`
- `docs/v2.5/DATA_RUNTIME_MODEL.md`
- `docs/v2.5/IMPLEMENTATION_STAGES.md`
- `docs/v2.5/V2_6_TO_V3_ROADMAP.md`
- `docs/v2.5/GOAL_PROMPT.md`
