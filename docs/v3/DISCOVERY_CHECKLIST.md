# ShelfDeck v3 Discovery Checklist

本文是 v3 长程任务开工前的代码库排摸清单。不要在完成排摸前直接实施重构。

## 1. 必读文档

先读：

- `docs/README.md`
- `docs/v2/PRODUCTION_BASELINE.md`
- `docs/v2/PRODUCTION_DEPLOYMENT.md`
- `docs/v2/DEVELOPMENT_WORKFLOW.md`
- `docs/v2/TEST_ARCHITECTURE.md`
- `docs/v2/DEBUG_WORKFLOW.md`
- `docs/v3/OPERATION_CONTEXT.md`
- `docs/v3/BUSINESS_MODEL_NOTES.md`
- `docs/v3/DATA_MODEL_NOTES.md`
- `docs/v3/V2_BEHAVIOR_PRESERVATION.md`
- 本文件

## 2. Service 排摸

必须梳理：

| 模块 | 重点问题 |
| --- | --- |
| `media-service/src/app.js` | API 边界、任务创建、任务详情、媒体库页面数据、space stats |
| `taskStore.js` | 当前 tasks.db schema、payload_json 内容、列表/详情/统计路径 |
| `libraryStore.js` | 当前 library.db schema、payload_json 内容、媒体列表/筛选/统计路径 |
| `taskScheduler.js` | 当前调度粒度、资源锁、并发、恢复、中断、重试 |
| `smartTaskEngine.js` | 自动任务触发来源、候选生成、allow-list |
| `taskAdmission.js` | 自动/手动准入、去重、冷却、队列上限 |
| `priorityEngine.js` | 当前优先级模型和可迁移部分 |
| `strategyEngine.js` | 策略推荐、媒体优化建议、keep/transcode/upgrade/delete 来源 |
| `metadataStatus.js` | 元数据完整性判断 |
| `optimizationStatus.js` | 优化状态判断 |
| `spaceStats.js` | 空间统计依赖哪些 task/media 字段 |
| `*FlowExecutor.js` | 当前 flow 编排、资源消耗点、状态写回点 |
| `services/*Service.js` | 外部系统边界和资源消耗 |

## 3. Admin Web 排摸

必须梳理：

- 媒体库管理页依赖哪些字段。
- 任务中心依赖哪些 task 字段。
- 审批、确认、手动执行入口如何触发 service API。
- space stats、dashboard、health 页面依赖哪些 API。
- 哪些 UI 仍然以 `actionType` 为核心。

## 4. Desktop 和 Worker 排摸

v3 本轮优先升级 `media-service` 与 service Admin Web。Desktop 和 worker 先做边界排摸与兼容影响评估，是否重构、如何重构、何时重构待方案确认。

Desktop 排摸目标：

- 哪些页面是媒体库管理，应下线或迁移到 service Admin Web。
- 哪些能力属于播放前端，应保留。
- desktop 是否直接依赖任务/媒体库旧字段。

Worker 排摸目标：

- 哪些接口只是远程计算。
- 是否存在媒体库、task、People 状态泄漏。
- 与 service 的 job/resource 边界现在如何定义，后续是否需要调整。

## 5. 持久化排摸

必须列出：

- `media-service/data/library.db` 表结构。
- `media-service/data/tasks.db` 表结构。
- `media-service/data/config.json` 与任务/调度相关配置。
- `media-service/data/nodes.json` worker 节点状态。
- `media-service/data/people.json` People 库。
- `payload_json` 中哪些字段是事实、投影、日志、结果、调试上下文。
- v2 中哪些运行态只存在于内存，例如 scheduler runtime、running tasks、progress/status cache、resource slots、external dependency health。
- v2 中哪些读路径依赖 SQL 列，哪些读路径仍依赖 `payload_json` 或全量加载。

## 6. 测试排摸

必须梳理：

- 哪些测试覆盖任务创建。
- 哪些测试覆盖调度和并发。
- 哪些测试覆盖 flow executor。
- 哪些测试覆盖媒体库、space stats、Admin Web。
- 哪些测试依赖 v2 `actionType` 语义。
- 哪些 E2E flow 可迁移，哪些必须重写。

## 7. 输出物

排摸完成后必须输出：

- v2 当前实现图。
- v2 当前实现中最影响 v3 重写的边界问题。
- v2 SQL facts / memory runtime / projections 的真实分布。
- v2 关键行为 inventory，至少覆盖 FFmpeg/FFprobe、外部 API、文件系统操作、任务状态机、审批 gate、配置默认值和 Admin Web 字段语义。
- 必须改、可以后改、可删除、需兼容的清单。
- 数据迁移风险。
- 生产部署风险。
- 推荐实施阶段划分。
