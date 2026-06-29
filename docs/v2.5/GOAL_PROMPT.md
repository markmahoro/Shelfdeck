# ShelfDeck v2.5 Goal Prompt

下面提示词可用于开启 v2.5 长程目标。

```text
请完成 ShelfDeck v2.5 service 架构升级。

当前生产基线是 v2.0，tag 为 v2.0.0。v2.5 不是 v3 全量重建，不要复制重写 v2 的全部功能。v2.5 的目标是在保留 v2 已验证生产能力的前提下，升级 media-service 的架构内核、数据模型、projection、调度边界和 service Admin Web 语义。

开始前必须阅读：
- AGENTS.md
- docs/README.md
- docs/v2/PRODUCTION_BASELINE.md
- docs/v2/PRODUCTION_DEPLOYMENT.md
- docs/v2/DEVELOPMENT_WORKFLOW.md
- docs/v2/TEST_ARCHITECTURE.md
- docs/v2/DEBUG_WORKFLOW.md
- docs/v2.5/README.md
- docs/v2.5/UPGRADE_STRATEGY.md
- docs/v2.5/DATA_RUNTIME_MODEL.md
- docs/v2.5/IMPLEMENTATION_STAGES.md
- docs/v3/BUSINESS_MODEL_NOTES.md
- docs/v3/V2_BEHAVIOR_PRESERVATION.md

本轮优先对象：
- media-service
- media-service/web
- service Docker/NAS 部署流程

本轮非优先对象：
- media-desktop 只做兼容影响排摸，不主动重构。
- media-worker 只做接口和资源边界排摸，不主动重构。
- transcode/delete/upgrade/scrape/ingest 的复杂执行细节先保留 v2 实现，通过 event/projection/adapter 包起来。

v2.5 核心目标：
1. 新增 task event journal，先 shadow write，不改变 v2 主流程。
2. 新增 projection 层，优先解决任务中心、媒体库列表、space stats、metadata/optimization 状态的性能问题。
3. 明确 SQL facts、memory runtime、projection/cache 的边界。
4. 让 scheduler 逐步从全量扫描转向轻量 active/projection/resource view。
5. service Admin Web 基于新 projection 和业务语义重整展示。
6. 保留 v2 FFmpeg、MoviePilot、adult scrape、delete safety、approval gate 等生产行为。

第一阶段只做排摸和方案，不直接大规模改代码。

必须先输出：
- v2 service 模块图。
- v2 data/query/write path inventory。
- v2 FFmpeg/FFprobe behavior inventory。
- v2 external API inventory。
- v2 Admin Web field inventory。
- v2 task status / approval / scheduler inventory。
- v2.5 分阶段实施计划。
- 每阶段测试、迁移、部署和回滚方案。

实施原则：
- additive changes first。
- shadow write first。
- projection can rebuild。
- no production behavior loss。
- no destructive production data change without explicit user approval。
- 每次替换读取路径前，必须能和 v2 旧路径对比。

部署要求：
- 生产部署遵守 docs/v2/PRODUCTION_DEPLOYMENT.md。
- NAS SSH 使用 tools/ssh-exec.js 和 tools/nas-ssh-config.js。
- 私有凭据在 tests/TEST_ENV_CHECKLIST.md，不得泄露。
- 生产迁移必须 dry-run。

完成后输出：
- 实施摘要。
- 数据模型变更。
- event/projection 覆盖范围。
- Admin Web 语义变更。
- 性能证据。
- 测试结果。
- 部署/回滚说明。
- 未迁移的 v2 legacy 能力清单。
```
