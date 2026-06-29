# ShelfDeck v3 Data Model Notes

本文记录 v3 数据模型的原则性共识。

它不是最终 schema 设计，不规定具体表名、字段名、索引或 ORM。v3 agent 必须先排摸 v2 的 `library.db`、`tasks.db`、`config.json`、`nodes.json`、`people.json` 和生产数据规模，再提出最终数据模型。

## 1. 总原则

v3 数据模型应区分三类数据：

- durable facts：必须持久化、可恢复、可审计的事实。
- runtime state：正在执行中的实时状态，用于调度、资源占用、取消、暂停、进度。
- projections：为了查询、展示、统计和调度效率，从 facts 派生出来的读模型。

不要把三类数据混成一个 `payload_json` 大桶，也不要把所有运行态只放在内存里。

## 2. SQL 持久化层

SQL 数据库是事实来源。

适合持久化到 SQL 的数据：

- media item 的稳定身份、source references、媒体事实和业务阶段。
- task 的业务状态、阶段跨越目标、准入结果和终态。
- event 的执行历史、重试、中断、外部调用、错误、资源消耗和用户确认。
- flow plan 或 flow snapshot，用于恢复和审计。
- resource usage 记录，用于排查性能和容量规划。
- projection checkpoint，用于快速恢复投影，而不是替代事实。

SQL 层应该支持：

- 按 `itemId` 查询当前媒体状态。
- 按 `taskId` 查询 task 当前状态。
- 按 `eventId` 查询具体执行事件。
- 按 task/event 状态快速查 active work。
- 按资源类型快速查正在占用或等待资源的 event。
- 按 item/task/event 时间线做审计。

具体是否拆成多个 SQLite database，或一个 database 多张表，应由 v3 agent 基于代码排摸、性能数据和部署约束决定。

## 3. 内存运行层

内存不是事实来源。

内存适合承载：

- 正在运行的 event runtime。
- task runtime index。
- resource scheduler 的队列、令牌、锁、slot、并发占用。
- external dependency 的短期健康状态和连接探测结果。
- Admin Web 需要的短生命周期推送状态。
- 已从 SQL 恢复出来的 hot projection/cache。

内存层必须满足：

- service 重启后可以从 SQL 恢复。
- 内存状态丢失不能导致 task/event 永久丢失。
- 写入事实时必须先落 SQL，或有明确的 write-ahead/recovery 机制。
- 长任务的关键阶段、外部副作用、文件路径和替换状态必须可恢复。
- 取消、暂停、中断这类控制信号需要同时影响内存 runtime 和持久化事实。

## 4. Event Store 和 Task Store

业务上，event 属于 task 的执行历史；物理上，event store 可以和 task store 分开。

推荐 v3 agent 重点评估：

- task 当前态是否需要一张轻量 current table。
- event 历史是否需要独立 append-only table。
- task/event 是否需要分库以降低写放大和查询干扰。
- event payload 中哪些字段应该平铺成列，哪些可以保留 JSON。
- active event 是否需要独立索引或 projection，供 resource scheduler 快速读取。

原则：

- task current 解决“现在这座桥到哪了”。
- event history 解决“这座桥为什么这样走”。
- projection 解决“页面和调度器如何快读”。

## 5. Projection

Projection 是读模型，不是事实。

v3 应明确哪些 projection 服务哪些读场景：

- Media list projection：Admin Web 媒体库列表、筛选、分页。
- Task list projection：任务中心列表、active/terminal 查询。
- Item lifecycle projection：一个 item 当前在哪个业务阶段。
- Resource projection：当前和未来短期资源占用。
- Space stats projection：空间收益、原始大小、转码/洗版/删除收益。
- Diagnostics projection：外部依赖、失败原因、最近错误。

Projection 可以存在 SQL 中，也可以有内存热缓存。关键是 projection 必须能从 facts 重建。

## 6. Payload JSON 的边界

v3 不应继续把核心查询字段长期藏在 `payload_json` 里。

建议平铺的字段类型：

- 主键和外键：`itemId`、`taskId`、`eventId`、source refs。
- 状态：lifecycle stage、task status、event status、terminal flag。
- 调度字段：resource type、priority、notBefore、lease/lock、retry count。
- 用户展示字段：媒体标题、source、metadata status、optimization direction、archive status。
- 统计字段：size、bitrate、bytes saved、duration、started/finished timestamps。

适合保留 JSON 的字段：

- 外部 API 原始响应摘要。
- 调试上下文。
- 不参与查询和调度的可变扩展字段。
- UI 详情页才需要的大对象，但应避免无限增长。

## 7. Write Path

v3 agent 设计写路径时要明确：

- 哪些写是事实写入。
- 哪些写是 projection 更新。
- 哪些写可以异步补偿。
- 哪些写必须在同一事务里完成。
- 外部副作用发生前后分别写什么 event。
- service 崩溃后如何判断副作用是否已经发生。

特别是 FFmpeg 替换、MoviePilot 下载、成人库文件移动、delete flow 这类不可轻易回滚的动作，必须有清楚的 event 记录和恢复策略。

## 8. Recovery

v3 必须有恢复模型。

service 启动时至少要能回答：

- 哪些 task 处于 active 但没有 runtime。
- 哪些 event 正在执行中但 process 已经消失。
- 哪些 FFmpeg partial/staging 文件需要保留、清理或等待用户确认。
- 哪些外部系统任务已经提交但本地 event 没有完成。
- 哪些 projection 已过期，需要重建。

恢复逻辑应优先依赖 SQL facts，而不是依赖内存残留或临时文件猜测。

## 9. 对 v3 Agent 的要求

v3 agent 在提出最终数据模型前，必须先输出：

- v2 数据 inventory。
- v2 查询路径 inventory。
- v2 写路径 inventory。
- v2 runtime 内存状态 inventory。
- v2 `payload_json` 字段分类。
- v3 SQL facts / memory runtime / projections 的候选方案。
- 每个方案的性能、复杂度、迁移和恢复成本。

没有这份排摸，不要直接落最终 schema。
