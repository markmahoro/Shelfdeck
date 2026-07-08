# ShelfDeck v2.5 Implementation Stages

v2.5 采用分阶段落地，避免一次性重写生产能力。

## Stage 0 - Inventory

先排摸，不直接重构。

必须输出：

- v2 service 模块图。
- v2 data/query/write path inventory。
- v2 FFmpeg/FFprobe behavior inventory。
- v2 external API inventory。
- v2 Admin Web field inventory。
- v2 task status / approval / scheduler inventory。

## Stage 1 - Event Journal Shadow Write

目标：不改变 v2 行为，只新增事件记录。

工作：

- 设计最小 `task_events`。
- 在 task admission、scheduler、flow executor 关键点写 coarse event。
- 确保 event 写失败不会破坏 v2 主流程，或有明确降级策略。
- 添加 event 查询和调试 API。

验收：

- 生产功能不变。
- event 能解释一个 task 的基本执行时间线。

## Stage 2 - Projection Layer

目标：解决主要性能问题。

工作：

- 增加 task list projection。
- 增加 media list projection。
- 增加 space stats projection。
- 增加 lifecycle/metadata/optimization projection。
- 提供 projection rebuild 工具。

验收：

- 任务中心和媒体库页面不再依赖全量 payload 扫描。
- projection 可从 facts 重建。
- 新旧查询结果可对比。

## Stage 3 - Resource View

目标：把资源调度从 task 名字推进到 event/resource 维度。

工作：

- 为 v2 flow 标注 resource hints。
- 建立 active/waiting resource projection。
- scheduler 先用 projection 做轻量决策。
- 保留 v2 flow executor 的实际执行逻辑。

验收：

- 能看见 FFmpeg、MoviePilot、scrape AI、worker 等资源占用。
- 调度循环 IO 明显减少。
- 不破坏 pause/resume/cancel。

## Stage 4 - Admin Web Semantic Upgrade

目标：让用户看到更清晰的业务状态。

工作：

- 媒体库列表改读 projection。
- task center 区分 task current 和 event history。
- item detail 展示 lifecycle、metadata、optimization、archive 状态。
- diagnostics 从媒体字段中剥离。
- 配置页按真实能力边界简化。

验收：

- 用户能理解一个 item 是否完成 ShelfDeck 处理。
- 用户能理解一个 task 为什么失败、卡住或等待确认。
- 高频页面性能提升。

## Stage 5 - Selective Replacement

目标：只在有收益时替换 v2 内部实现。

候选：

- taskScheduler 内部循环。
- taskStore/list query。
- mediaLibraryService/list query。
- spaceStats。
- strategy/metadata/optimization projection 计算。

暂不优先替换：

- FFmpeg encoding 细节。
- MoviePilot flow 细节。
- adult scrape 细节。
- delete safety 细节。

## Stage 6 - Production Rollout

目标：低风险上线。

要求：

- v2.0 tag 可回滚。
- 数据迁移 dry-run。
- projection rebuild 可重复。
- 部署走 `docs/v2/PRODUCTION_DEPLOYMENT.md`。
- 生产验证先关注 health、Admin Web、任务中心、媒体库列表、核心 flow smoke test。
