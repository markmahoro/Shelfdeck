# Kairox Architecture

Kairox 架构是 ShelfDeck v3.1 演进阶段的命名架构契约。

它的作用不是重新发明一套实现方案，而是把 v3.1 推进中已经确认的架构方向固定成可引用、可检查、可追责的边界。后续讨论和实现可以直接使用“符合 Kairox”或“违反 Kairox”来判断方向，避免把已经收敛的结论重新打散。

## 1. 定义

Kairox 架构约束 ShelfDeck v3.1 之后的核心业务系统按以下用户心智演进：

```text
source/discovered -> ingested -> metadata-ready -> optimized -> archived -> deleted
```

单 item task 的主语义是：

```text
object + targetGate + gateObjective
```

`ingest`、`scrape`、`transcode`、`upgrade`、`archive`、`delete` 在当前实现中仍作为兼容 operation 或 flow executor 存在，但不能再被当成 task 的唯一主语义。

一句话：

```text
Kairox = User Perception owns perception facts; Lifecycle gate owns user semantics; Task targets a gate; Flow implements the path; Event consumes resources.
```

### 1.1 六个架构组件

Kairox 的目标语义收敛为 6 个架构组件。这里的组件是职责边界，不要求当前代码立刻做到一个组件对应一个物理文件。

| 架构组件 | 核心问题 | 负责 | 不负责 |
| --- | --- | --- | --- |
| User Perception Management | 用户怎么看这个媒体 | 管理 rating、watched、playCount、favorite、manual tier、perception source、perception version；从 Admin Web、Desktop、Emby、Douban 私人账号、播放历史和导入数据采集并合并用户感知事实；写 perception change facts | 定义 Lifecycle gate；计算 optimize objective；创建 task；选择 flow；执行 event |
| Lifecycle | 媒体现在在哪，gate 过没过，目标是什么 | 定义 6 阶段 5 gate；定义 gate objective；按子库计算 ingest / metadata gate；消费 metadata/media facts、user perception facts 和 policy facts；为每个媒体计算 optimize objective readiness、objective revision 和 delete eligibility；根据 objective + observed facts 判定 optimize / archive / delete gate；推进 stage | 管理用户感知来源；创建 task；选择 flow；执行 event；控制资源 |
| Task Creator | 现在要不要创建 task，创建什么目标 task | 消费 lifecycle snapshot、自动化扫描、用户 intent、Resource Runtime 安灯信号；执行准入；创建 `object + targetGate + gateObjective` 的 task；拒绝时给 blocked reason | 定义 gate / objective；选择 flow；执行 event；控制资源 |
| Task Scheduler | 哪些 task 现在获得运行机会 | 找 runnable task；控制 task 级并发；控制 item lock；按 priority / retryAt / createdAt 排序；给 task 一次 tick；保存 Flow Planner 返回的 task-level signal | 创建 task；判断 gate；选择 flow；生成 objective；生成 event；决定 retry / fallback；控制资源 |
| Flow Planner | 为了达成 task 目标，具体怎么做 | 根据 task.object + targetGate + gateObjective 选择 flow operation；生成 event 编排；发出 event intent；消费 event / resource facts；处理 retry / fallback / wait / needs-review / fail；写 task facts / gate facts；返回 task-level signal | 定义 gate / objective；判定 lifecycle stage；控制资源容量；创建 task |
| Resource Runtime | event 怎么执行，工厂产能如何 | 读取 event intent；管理 event queue、resource bucket、capacity、concurrency、lease；调用 executor / worker；处理 timeout / worker lost / orphan lease；写 event / resource facts；输出安灯信号并提供 Resource View | 创建 task；判断 lifecycle gate；选择 flow operation；定义 optimize objective |

主链路是：

```text
User Perception Management
  -> user perception facts
  -> Lifecycle

Lifecycle
  -> Task Creator
  -> Task(object + targetGate + gateObjective)

Task Scheduler
  -> Flow Planner
  -> Resource Runtime
  -> event/resource facts
  -> Flow Planner
  -> task/gate facts
  -> Lifecycle
```

Task / event 的事实必须持久化。内存态用于实时运行、快速查询和减少反复 IO；持久化 store 是恢复、审计和迁移的事实来源。

## 2. 适用范围

凡是修改以下领域，必须先读本文：

- Lifecycle stage、gate、metadata status、user perception status、optimization status、archive status、delete status。
- User Perception Management、Douban 私人评分、Emby watched / playCount、manual tier、favorite、perception version。
- TaskAdmission、BusinessFlowPolicy、SmartTaskEngine、手动 `/v1/tasks` 创建入口。
- Task target、task control、retry/resume/cancel/confirm。
- Flow Planner、flow recovery contract、flow executor。
- TaskScheduler、resource projection、resource throttling、worker dispatch。
- Dashboard、Task Center、Media Management 的用户语义展示，以及内部诊断 projection 的可见性边界。
- metadata gate / perception readiness / optimize objective / archive gate / delete gate 配置和校验。
- 全自动模式、用户介入白名单、风险动作确认。
- NAS production deploy、migration、production data safety。

## 3. 文档优先级

Kairox 是 v3.1 架构契约入口，但不是唯一细节来源。

| 层级 | 文档 | 用途 |
| --- | --- | --- |
| 架构契约入口 | `docs/v3/KAIROX_ARCHITECTURE.md` | 判断一个改动是否符合 v3.1 架构方向 |
| 当前实现地图 | `docs/v2/ARCH_OVERVIEW.md` | 记录当前代码已经落地的系统事实；不是架构契约 |
| 业务语义 | `docs/v3/BUSINESS_MODEL_NOTES.md` | Lifecycle、gate、task、flow、objective 的业务定义 |
| 成人库数据模型 | `docs/v3/ADULT_DATA_MODEL.md` | 成人库 hot media facts、light adult metadata、cold AI artifacts、file assets 分层 |
| 自动/人工边界 | `docs/v3/USER_INTERVENTION_AND_FULL_AUTO.md` | 用户介入白名单和全自动模式标准 |
| 历史讨论 | `docs/v3/V3_1_DISCUSSION_NOTES.md` | 讨论证据和历史结论，不覆盖 Kairox |
| 切片日志 | `docs/v3/V3_1_PROGRESS.md` | 已完成切片、验证、生产部署和剩余风险，不覆盖 Kairox |
| 运行上下文 | `docs/v3/OPERATION_CONTEXT.md` | NAS、生产、安全和测试入口 |
| 调试流程 | `docs/v2/DEBUG_WORKFLOW.md` | 运行问题排查入口 |
| 测试体系 | `docs/v2/TEST_ARCHITECTURE.md` | 测试分层和 flow catalog |

当文档冲突时：

1. 以代码、测试和生产事实为最终事实来源。
2. 若当前实现地图过期，先更新 `docs/v2/ARCH_OVERVIEW.md`；若架构合同过期，先更新本文或相关 ADR。
3. 若冲突影响本文中的 Kairox contract，必须同步更新本文，并在 ADR 中记录原因。

## 4. 核心合同

### 4.1 Lifecycle owns user semantics

用户看到的是生命周期阶段和 gate，不是 executor 名称。

Kairox 下的核心用户心智是：

| Gate | 用户语义 | 典型 task target |
| --- | --- | --- |
| ingest gate | 外部候选成为 ShelfDeck 可管理媒体项 | `targetGate=ingest` |
| metadata gate | scrape 阶段完成，媒体可进入 optimize | `targetGate=metadata` |
| optimize gate | 媒体事实达到归档前的目标合同 | `targetGate=optimize` |
| archive gate | 媒体进入已归档状态 | `targetGate=archive` |
| delete gate | 已归档媒体满足处置条件并完成删除 | `targetGate=delete` |

实现可以继续有兼容字段，但 UI、API projection、诊断和文档不应继续把 `actionType` 当成用户语义主语。

`archive` 在 Kairox 中保留“已归档”的用户语义。已归档表示媒体已经完成入库、元数据和必要优化，当前可以安心放在库中；它不是生命周期终点，也不等于“永不删除”。已归档媒体后续可以被 delete gate 的处置规则纳入删除候选。

Kairox 没有 `refresh` 这个一等概念。旧实现中的 refresh / startup refresh / manual refresh / scheduled refresh，架构语义都应收口为 `ingest`：

- ingest 从 Emby、文件夹、成人 watch root 等 source 同步 source facts。
- ingest 对齐 inventory identity、source path、基础 media facts 和 subLibrary 归属。
- ingest 写入或更新事实后，Lifecycle gate projection 重新判断当前对象停在哪个 gate。
- ingest 不直接创建后续 metadata / optimize task；自动 task 创建仍必须通过 Task Creator / TaskAdmission。
- startup/background ingest 必须有预算和 backpressure，不能阻塞 Admin Web projection。

### 4.2 User Perception Management owns user perception facts

User Perception Management 管理“用户怎么看这个媒体”的 durable facts。它是 Kairox 核心组件，和 Lifecycle 并列，不是 metadata gate 的一部分。

User perception facts 包括：

- 本地用户评分、豆瓣私人评分、Emby 用户评分和导入评分。
- watched、playCount、lastPlayedAt、favorite。
- manual tier，例如用户显式标记 premium / high / standard / baseline。
- perception source、source priority、perception version、perceptionUpdatedAt。

ShelfDeck 当前从 Douban 获取的是用户私人评分和用户自己的观看状态，不是公众评分。因此 `doubanRating` 属于 User Perception Management，不属于 metadata facts，也不能作为 metadata gate 的 required fact。若未来引入豆瓣公众评分、IMDb、TMDB vote 等外部群体评价，应另建 Public Reception Management 或等价组件；它不能混入 User Perception，也不能混入 metadata gate。

User Perception Management 负责：

- 从 Admin Web / Desktop 用户操作、Emby、Douban 私人账号、播放历史和导入数据采集感知事实。
- 归一化不同来源的字段，例如 `userRating`、`doubanRating`、`watched`、`playCount`。
- 按 source priority 合并事实，例如 manual tier > local user rating > Douban private rating > Emby rating > playCount-derived > unknown。
- 每次有效感知变化写入 `perceptionVersion` / `perceptionUpdatedAt`，并记录 perception change fact。
- 提供当前 item 的 normalized `userPerceptionFacts` 读模型和冲突解释。

User Perception Management 不负责：

- 判断 metadata gate 是否 passed。
- 计算 optimize objective 或 delete eligibility。
- 创建 task、选择 flow、调度 event。

User perception 变化只触发 declarative projection 重新计算：

```text
User Perception Management
  writes perception facts and bumps perceptionVersion
  -> Lifecycle projection recomputes optimize objective readiness / objective revision
  -> Task Creator later scans Lifecycle projection and may create a task
```

明确禁止：

- 把 `doubanRating`、`userRating`、`watched`、`playCount` 作为 metadata gate required facts。
- User Perception Management 直接调用 Task Creator 创建 optimize/delete task。
- Task Creator 自己比较 rating、watched、playCount 或 objective hash 来判断是否需要任务。

### 4.3 Task targets a gate

Task 是一次把 object 推过某个 target gate 的尝试。

Task 必须能表达：

- `object`: 目标媒体 item 或 source candidate。
- `targetGate`: 要跨过的 gate。
- `gateObjective`: gate 的目标合同。
- `operationHint`: 兼容旧 executor 的实现提示，只能作为 hint。

自动入口、手动入口、adult rescrape 入口和未来 background source 都必须进入同一套 Task Creator / TaskAdmission 语义。不能为某个库类型或某种自动化单独开一条私有入队路径。

### 4.4 Flow implements the path

Flow 是 task 内部的实现路径，不拥有顶层用户目标。

例如 optimize task 可以选择：

- `transcode` operation 达成降低码率或兼容性目标。
- `upgrade` operation 达成提升媒体事实目标。
- 未来 `remux`、字幕、音轨或 HDR repair operation 达成更细的媒体事实目标。

Flow Planner 可以选择不同 operation，但不能临时发明 Lifecycle objective。Objective 必须来自 Lifecycle 规则、策略事实或明确的用户配置。

`delete` 不是 optimize flow operation。删除媒体不是“把媒体事实优化到某个目标值”，而是已归档媒体在后续 delete gate 中进入处置流程。Delete flow 属于 `targetGate=delete` 的实现路径。

### 4.5 Event consumes resources

Event 是实际消耗资源的原子执行事实。

Resource projection / internal diagnostics 应围绕 event/resource 解释：

- running / waiting / failed。
- resource bucket、capacity、lease、backpressure。
- external dependency health。
- recovery、confirmation、failure summary。

SmartTaskEngine 不直接管理资源。它只消费 Resource Runtime 或 service resource projection 给出的 trigger pressure / backpressure 信号，决定是否暂缓创建新 task。

这条合同约束的是 service 后端 projection 和内部排障能力，不表示普通 Admin Web 必须暴露一个面向用户的资源视图页面。资源、DB/WAL、payload、I/O guard、diagnostic log 等运维事实应优先保留在后端诊断接口、日志和测试中，默认不进入普通用户前端。

### 4.6 Task / Flow / Event relationship

Task、Flow、Event 是三层不同对象，不能互相代替。

```text
Task
  = one attempt to move one object across one target gate

Flow
  = the selected implementation plan inside that task

Event
  = a durable execution step inside that flow, usually tied to resource usage
```

固定包含关系：

```text
one task
  owns one target contract
  may use one selected flow plan at a time
  records many events over time
```

状态归属必须清楚：

| 层级 | 记录什么 | 不记录什么 |
| --- | --- | --- |
| Task | 这次 gate-crossing attempt 是否 queued、running、blocked、awaiting confirmation、failed、done | 不把 executor 名称当成任务目标 |
| Flow | 这次 task 采用哪条 implementation path、当前 resume point、允许哪些 recovery point | 不拥有 Lifecycle objective |
| Event | 实际发生过什么、消耗了什么 resource、外部副作用、失败摘要、用户确认 | 不决定下一个 Lifecycle gate |

典型 optimize 例子：

```text
task
  object = media item A
  targetGate = optimize
  gateObjective = media facts contract
    equivalentBitrate <= 8 Mbps
    codec in [hevc, av1]
    resolution preserved

flow
  operation = transcode
  executor = transcodeFlowExecutor
  recoveryContract = transcode recovery points

events
  transcode.precheck
  transcode.encode
  transcode.verify
  transcode.beforeReplace confirmation
  transcode.replace
```

在这个例子里，用户语义是“把媒体 A 优化到降低码率目标”。`transcode` 只是当前实现路径，`encode` / `verify` / `replace` 才是具体执行事件。

典型 delete 例子：

```text
task
  object = media item B
  targetGate = delete
  gateObjective = archived media disposal
    rule = rating <= 2 and archivedFor >= 6 months

flow
  operation = delete
  executor = deleteFlowExecutor
  recoveryContract = delete recovery points

events
  delete.precheck
  delete.beforeExecute confirmation
  delete.execute
  delete.verify
```

在这个例子里，用户语义是“从已归档媒体中处置不再需要的条目”。`delete` 是 delete gate 的实现路径，不是 optimize gate 的 operation。

硬约束：

- 一个 task 必须先能解释 `object + targetGate + gateObjective`，再谈 flow operation。
- Task status 描述 gate-crossing attempt 的当前处境，不能用 `actionType` 或 executor 名称替代。
- Flow Planner 可以为同一个 gate objective 选择不同 flow，但不能改变 task target。
- Event history 是执行审计和恢复依据；失败不能只写 task 终态，必须能追到 event/resource/failure summary。
- Scheduler 只能调度 runnable task 和 dispatch flow event，不能把业务 objective 塞进调度分支。
- UI 可以展示实现路径，但主标题、筛选、诊断入口应优先展示 task target。
- Resource projection 只能从 event/resource 解释运行压力，不能把 task target 简化成 resource bucket；普通用户前端不应把 resource bucket 当成核心产品页面。

明确禁止：

- 把 `transcode task`、`upgrade task` 当成长期用户语义。Kairox 下它们是 optimize task 的 operation path。
- 把 `delete` 当成 optimize task 的 operation path。Kairox 下 delete 是独立 delete gate 的 flow operation。
- 在 flow executor 内部私自修改 `targetGate` 或 `gateObjective`。
- 在 event 执行成功后绕过 Lifecycle/Task Creator 直接创建下一个 gate 的 task。
- 用 task retry 代替 flow recovery contract。
- 用 resource queue / resource projection 反向决定媒体的 Lifecycle objective。

### 4.7 Metadata gate is a scrape exit gate

`metadataGate` 不是“要不要 scrape”的触发条件，而是 scrape 阶段是否完成的 exit gate。

普通库半假 scrape / metadata repair 必须按当前子库 metadata gate 补齐 facts。若补不齐，失败原因必须指向 gate 中具体无法满足的条件。

自定义 metadata gate 必须覆盖 optimize objective 和 delete eligibility 会消费的 metadata/media 输入：

```text
metadataCompleteGate >= optimizeMediaRequiredInputs + deleteMediaRequiredInputs
```

保存配置时必须硬校验；运行时发现历史坏配置时必须产生 `metadata_gate_contract_broken`，不能显示“元数据完整”又在 optimize 阶段静默卡死。

metadata gate 不覆盖 user perception facts。`rating`、`doubanRating`、`userRating`、`watched`、`playCount`、`favorite`、`manualTier` 不得作为 metadata gate required facts。缺少这些事实不表示媒体“元数据不完整”；它只可能影响 Lifecycle 是否能计算 optimize objective readiness。

Kairox 没有 `self-compute` 这个一等概念。所谓“自算”必须拆回以下语义：

- 若只是 `resolution -> bucket`、`bitrate -> equivalentBitrate` 这类确定性派生，属于 scrape / metadata repair flow 内的 media facts projection event。推荐事件名是 `scrape.project_media_facts`，它应在 `scrape.fetch_or_probe_metadata` / `scrape.write_metadata` 之后、`scrape.verify_metadata_gate` 之前执行。
- 若派生依赖的原始事实缺失，例如 bitrate、duration、codec、path identity 等缺失，则 metadata gate 不完整，必须通过 scrape / metadata repair flow 补齐。
- scrape flow 完成必要事实后，相关 media facts projection 才能使对象自然进入 optimize gate。
- 后台 maintenance 可以重放或补跑 scrape flow 的安全 event，但不能拥有 Lifecycle objective，不能替代 scrape，也不能让 metadata gate 在事实不完整时通过。

因此：metadata / media facts 不完整的对象不能进入 optimize gate；user perception facts 不完整的对象不应回退 metadata gate，而应由 Lifecycle 投影为 `optimizeObjectiveStatus=pending_perception`、默认 baseline objective 或其他可解释状态，具体取决于子库 objective policy。

### 4.8 Upstream gate invalidation is a standard flow signal

Kairox gate projection 读取的是已持久化 facts，不是每次实时重扫外部世界。因此 gate 可能出现“曾经通过，但执行时发现事实已经失效”的情况。例如：

- metadata / scrape flow 发现源文件已被用户移动或删除，说明 ingest gate 的 source facts 失效。
- optimize flow 发现 metadata / media facts 不可信或缺失，说明 metadata gate 的事实基础失效。
- archive flow 发现 optimize result 或替换产物不一致，说明 optimize gate 的事实基础失效。
- delete flow 发现归档事实、路径身份或删除目标不可信，说明 archive gate 或 ingest gate 的事实基础失效。

这类问题必须走统一的 upstream gate invalidation 机制：

```text
Flow / Event
  discovers upstream fact invalidation
  -> returns invalidatedGate + reason + evidence as task-level signal

Task Scheduler
  persists task event and item gate invalidation fact
  -> does not invent lifecycle objective

Lifecycle projection
  reads gate invalidation fact
  -> projects item back to the invalidated gate

Task Creator
  reads the new lifecycle snapshot
  -> decides whether and when to create the next task
```

边界要求：

- Flow / Event 只报告事实失效，例如 `invalidatedGate=ingest`、`reason=source_missing`、`evidence.path=...`。
- Task Scheduler 只承接并持久化 flow signal，记录 task event / failure summary / item gate invalidation fact；它不能自行定义新的 stage 或 objective。
- Lifecycle 根据持久化 gate invalidation fact 回退 stage，例如 source missing 应使对象回到 `source_discovered`，`lifecycleNextTask=ingest`。
- Task Creator 只能基于回退后的 lifecycle snapshot 决定是否创建 task，不能由下游 flow 链式私建上游 task。
- 后续 ingest / metadata / optimize / archive / delete flow 成功写入新的 gate facts 后，必须清理或覆盖对应 invalidation fact。

明确禁止：

- 在 Task Creator / BusinessFlowPolicy 里通过实时文件系统探测代替 ingest gate facts。
- 把 upstream gate invalidation 伪装成当前 gate 的普通失败，例如把 source missing 记成 metadata scrape failed。
- 在 scrape / optimize / archive / delete executor 内部直接创建上游补救 task。
- 用 retry 当前 task 代替回退上游 gate；若上游事实失效，必须先让 Lifecycle 重新投影。

### 4.9 Task Creator is unified

所有自动 task 创建必须通过统一 TaskAdmission / BusinessFlowPolicy / Task Creator 语义。

必须保持：

- active task duplicate prevention。
- 自动 task 创建 allow-list。新配置语义应表达为 `automaticTaskTargets`，用于决定系统是否可以自动创建 `ingest`、`metadata`、`optimize`、`archive`、`delete` 这类 gate target task。
- optimize flow operation allow-list。新配置语义应表达为 `optimizeAllowedOperations`，用于决定 optimize task 内允许选择 `transcode`、`upgrade`、未来 `remux` 等媒体事实优化 operation path。
- queue cap、cooldown、backlog pressure。
- standard/adult/manual/background source 的同一准入模型。
- manual intent 可以表达用户明确意图，但仍保留 active duplicate、风险动作和 flow safety 校验。

旧 `smartTaskEnabledActions` 是兼容字段，不能继续作为 Kairox 架构概念扩张。迁移期可以按以下规则投影：

- `ingest` -> `automaticTaskTargets` 包含 `ingest`。
- `scrape` -> `automaticTaskTargets` 包含 `metadata`。
- `transcode` / `upgrade` -> `automaticTaskTargets` 包含 `optimize`，同时写入对应 `optimizeAllowedOperations`。
- `archive` -> `automaticTaskTargets` 包含 `archive`。
- `delete` -> `automaticTaskTargets` 包含 `delete`。delete 不能投影为 optimize operation。

这几个授权层不能互相替代：允许自动创建 optimize task 不等于允许所有 optimize operation；允许某个 optimize operation 也不等于系统可以绕过 Task Creator / TaskAdmission 自动建 task；允许系统产生 delete candidate 或 delete task 也不等于允许无确认删除。

Delete gate 默认应是 review-first：

- Lifecycle / policy 可以自动计算已归档媒体的 delete eligibility。
- 普通产品路径应优先展示 delete candidates / 处置队列。
- 用户可以确认删除、保持已归档、延后提醒或设置不再建议。
- 只有用户确认或显式 destructive pre-authorization 后，Task Creator 才能创建或执行 `targetGate=delete` 的 destructive task。
- 全自动 delete 不是 Kairox 默认能力；即使未来实现，也必须有单独显式授权、审计和可回滚验证说明。

明确禁止：

- 成人库独立目录扫描或监听后绕过 TaskAdmission 自动创建 scrape/optimize/delete task。
- scrape flow 完成后链式私自创建 optimize task。
- failed optimize gate 被 SmartTaskEngine 误判为应该自动创建同类新 task。
- 已归档媒体进入 delete candidate 后绕过 delete review / destructive authorization 直接执行删除。
- 用隐藏按钮、禁用任务或绕过任务中心代替 flow capability 修复。

### 4.10 Recovery belongs to flow contract

Retry/resume/fallback 不是通用按钮语义。

任务控制 API 可以提供统一外壳，但真正能否恢复、从哪里恢复、是否幂等，必须由对应 flow recovery contract 决定。

至少需要可解释：

- 当前失败发生在哪个 event/resource。
- 是否可 retry。
- retry 是否复用原 task。
- resumePoint 是什么。
- 是否需要用户确认。
- 重试是否可能重复提交外部副作用。

### 4.11 Full-auto is configured authorization

全自动模式不是另一条执行链路。

全自动模式表示用户已预先配置规则和授权范围，系统可以在这些范围内自动推进生命周期。它仍必须遵守：

- Lifecycle gate。
- Task Creator / TaskAdmission。
- Flow Planner recovery contract。
- Resource Runtime backpressure。
- 用户介入白名单。
- 风险动作预授权。

全自动遇到低置信度、多候选、配置矛盾、未授权风险动作、不可恢复失败或资源安灯信号时，必须停在可解释状态。

Delete gate 的全自动授权必须比普通 optimize 授权更窄。默认允许系统计算 delete candidate，但不默认允许 destructive delete；只有明确 destructive pre-authorization、审计和验证合同齐备时，才可以从 review-first 演进到自动执行。

### 4.12 Admin Web is a user projection, not an operations console

Admin Web 面向普通用户和家庭长期服务心智，不是运维控制台。前端 projection 的目标是让用户快速确认“服务大体可用、外部集成是否配置正确、媒体库状态是否清楚”，而不是让用户理解内部资源、数据库或调度细节。

前端 health check 是安心状态灯：

- ShelfDeck 服务可用性。
- 外部集成状态，例如 Emby、MoviePilot、Douban、Worker、转码节点。
- 配置导向提示：红灯必须尽量指向用户可以执行的配置检查或授权动作。

普通用户前端不应默认展示：

- DB / WAL / payload_json 体积、表级统计、慢查询诊断。
- resource bucket、capacity、lease、backpressure、I/O guard。
- diagnostic log、slow log、内部 event payload、worker 低层状态。
- 要求用户理解 scheduler、TaskAdmission、Flow recovery 的排障信息。

这些事实必须保留在后端诊断接口、日志、测试和必要的内部工具中，便于开发者排查根因；但默认不作为 Admin Web 主路径可视化。若确需临时暴露，必须满足：

- 入口明确标记为内部诊断或 debug。
- 不影响 dashboard、媒体库、任务中心等普通页面首屏性能。
- 不让用户把运维事实误解为可直接操作的业务状态。

Delete candidates / 处置队列是普通业务页面，不是运维页面。它展示的是已归档媒体是否满足 delete gate 规则，以及用户对这些候选的决策：确认删除、保持已归档、延后提醒或不再建议。它不应展示 resource bucket、DB/WAL、内部 payload 等运维事实。

成人库恢复必须遵守 `docs/v3/ADULT_DATA_MODEL.md`：成人库仍是 Kairox subLibrary；`media_items` 热数据只保存 item identity、file facts、Lifecycle/gate facts、task target facts 和 light adult metadata；face clusters、embedding、gallery、base64 图片和 AI 中间输出属于 cold AI artifacts 或 file assets，不能进入普通列表、dashboard 或 TaskAdmission 热路径。

### 4.13 Optimize target projection is not a strategy layer

Kairox 没有 `strategy` 这个一等架构层。旧实现中的 `strategyEngine` 只能作为 legacy implementation module 保留，其架构语义是 optimize gate target projection。

Optimize gate target projection 的职责：

- 只在 metadata gate / required media facts 满足后计算 objective；若 objective policy 需要 user perception facts，还必须等待 perception readiness。
- 基于 metadata/media facts、User Perception Management 提供的 normalized perception facts、subLibrary policy，计算 optimize gate 的 target / gateObjective。
- optimize gateObjective 是归档前媒体事实目标合同，例如码率区间、编码、分辨率、HDR、音轨、字幕、容器、体积上限或来源质量要求。
- 如果当前 observed media facts 已满足目标合同，optimize gate 直接通过；不需要把 `keep` 建模成一个独立目标。
- 输出推荐事实和参数，例如 target media facts、reason、targetBitrate、targetCodec、predictedSizeGb、seedPreferences，以及可选 operation hint。
- 不补 metadata，不采集或合并 user perception，不读取外部 source facts，不创建 task，不绕过 TaskAdmission。

Optimize objective readiness 是 Lifecycle projection，不是 Task Creator 判断：

```text
metadata/media facts
  + user perception facts
  + policy facts
  -> optimizeObjectiveStatus
  -> gateObjective
  -> lifecycleNextTask
```

`metadata gate passed` 不等于 `optimize objective ready`。若 metadata/media facts 已完整，但 objective policy 需要的 user perception facts 仍不可判定，Lifecycle 可以投影为：

- `optimizeObjectiveStatus=ready`：已得到 gateObjective，可以评价 optimize gate。
- `optimizeObjectiveStatus=pending_perception`：等待 rating、watched、playCount、manualTier 等感知事实。
- `optimizeObjectiveStatus=pending_metadata`：metadata/media facts 不足，应停留在 metadata gate。
- `optimizeObjectiveStatus=blocked_contract`：metadata gate、perception policy 或 objective policy 合同矛盾。

`rating=null`、`watched=false`、`playCount=0` 可以是有效 user perception facts；是否足够生成 objective 由 objective policy 决定。不能把“没有评分”直接等价为 metadata 缺失。

若 optimize target 无法计算，原因必须回到 metadata/media facts contract、perception readiness 或 objective policy contract，例如 `metadata_missing`、`metadata_gate_contract_broken`、`perception_pending`、`objective_policy_contract_broken`、`optimize_required_input_missing`。不能把“strategy 未运行”作为用户语义，也不能让对象在事实不完整时显示为 optimize-ready。

Objective revision 是 Lifecycle 的 declarative projection：

```text
User perception / metadata / policy facts changed
  -> Lifecycle recomputes objectiveHash / objectiveVersion
  -> Lifecycle evaluates current media facts and current gate facts against new objective
  -> if not satisfied, Lifecycle projects lifecycleNextTask=optimize
  -> Task Creator later scans the projection and may create targetGate=optimize task
```

Lifecycle 不得调用 Task Creator 创建任务；Task Creator 也不得自己比较 rating、watched、playCount、objectiveHash 来发现 revision。Lifecycle 只维护 projection，Task Creator 只承接 projection。

Delete eligibility 不属于 optimize target projection。删除规则依赖已归档媒体的归档时间，以及 User Perception Management 提供的评分、观看状态、用户长期归档偏好等事实，属于 delete gate / archive maintenance policy。低评分媒体可以在 optimize gate 上“无需媒体事实优化，直接满足归档前目标”，进入 archived；随后由 delete gate 规则在归档满一定时间后进入 delete candidate。

典型例子：

```text
2 星电影
  metadata gate passed
  optimize media facts target = current media facts acceptable / no media improvement required
  optimize gate passed
  archive gate writes archivedAt
  delete gate rule = rating <= 2 and archivedFor >= 6 months
  delete candidate waits for user review
```

### 4.14 Service owns orchestration

Service 拥有任务、媒体库、配置、People、策略结果和生产数据。

Desktop 是 HTTP thin client，不直接访问 Emby、Douban、MoviePilot、service runtime data 或 worker runtime data。

Worker 是被动计算节点，只提供计算能力和临时 job 状态。Worker 不拥有媒体库语义，不直接访问 Emby/MoviePilot/service 数据文件，不决定 Lifecycle、TaskAdmission 或 Flow objective。

### 4.15 Production path is canonical

NAS ShelfDeck Docker 是生产环境。

生产部署必须走标准脚本链路：

```bash
bash scripts/build-image.sh <tag>
node scripts/upload-nas-image.js dist-image/shelfdeck-<tag>.tar
node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <local-sha256>
node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <local-sha256> --apply
```

不得绕过 `tools/nas-ssh-config.js` 硬编码 SSH 凭据。不得在用户未明确授权时删除、清空、重建或直接修改生产数据。

## 5. 反漂移规则

如果一个实现方案出现以下迹象，应先停下并重新对齐 Kairox：

- 新增一个自动任务来源，但没有经过 TaskAdmission。
- 新增一个 UI 状态，却只能用 `actionType` 解释。
- 新增一个 scheduler 分支来决定业务目标。
- 新增一个 flow executor，却没有 flow recovery contract。
- 新增一个 resource 限流，却让 SmartTaskEngine 自己推导 flow event 消耗。
- 新增一个 metadata complete 判定，却没有校验 optimize inputs。
- 新增 `refresh`、`strategy`、`self-compute` 作为 Kairox 一等概念，而不是收口到 ingest、metadata gate、optimize gate、TaskAdmission。
- 缺少必要 media facts 时仍让对象通过 metadata gate 或进入 optimize gate。
- 把 `doubanRating`、`userRating`、`watched`、`playCount` 当成 metadata gate required facts。
- Task Creator 自己比较 user perception facts 或 objective hash 来发现 objective revision。
- Lifecycle 在 objective revision 后直接调用 Task Creator 创建任务，而不是只写 projection。
- 把 delete candidate 或 delete task 伪装成 optimize objective / optimize operation。
- 把已归档理解成生命周期终点，导致 delete gate 无法表达归档库后续处置。
- 新增一个 worker 能力，却让 worker 持有 service 的业务事实。
- 新增一个普通前端卡片或页面来展示 DB/WAL、payload、resource bucket、I/O guard、diagnostic log 等运维事实。
- 为了处理某类失败而隐藏任务、跳过事件、清空历史或静默 fallback。
- 修改生产数据或部署方式，却没有 dry-run、checksum、回滚和验证说明。

## 6. Kairox vs Mirex

Mirex 是 Kairox 之前的 legacy compatibility model。它是旧实现的名字，不是未来架构方向。

```text
Mirex = actionType owns task semantics; task/flow/event boundaries are collapsed; scheduler/executor may carry business decisions.
```

Kairox 代码可以读取或写入 Mirex 字段用于兼容、迁移和回滚，但不能从 Mirex 字段派生新的用户语义。

| 维度 | Mirex 旧模型 | Kairox 架构 |
| --- | --- | --- |
| Task 主语义 | `actionType` | `object + targetGate + gateObjective` |
| 用户感知 | 混在 metadata / strategy 条件里 | User Perception Management owns perception facts |
| `transcode` / `upgrade` | task 类型 | optimize flow operation |
| `delete` | task 类型或 optimize operation | delete gate 的 flow operation |
| Scheduler | 调度和部分业务判断混合 | 调度 runnable task / dispatch flow event |
| SmartTask | 自动决策器倾向 | task trigger，消费 gate 和 backpressure |
| Flow | 常和 task/action 混在一起 | task 内部 implementation path |
| Event | 日志或辅助事实 | durable execution step |
| Resource | executor 限流或运行状态 | event/resource runtime |
| UI | action / 任务类型 | task target / gate / objective |

Mirex compatibility rules:

- `actionType`、`taskBridge`、`flowPlan.operationKind`、legacy task status 可以保留为兼容字段。
- 新 API、新 UI、新测试和新文档必须优先表达 Kairox target semantics。
- 修 bug 时可以补 Mirex compatibility，但必须避免让 Mirex 成为新行为的设计入口。
- 迁移旧数据时应把 Mirex 字段投影到 Kairox target facts；投影失败必须可诊断。
- 当 Kairox 与 Mirex 解释冲突时，除非正在修兼容/迁移问题，否则以 Kairox 为准。

明确禁止：

- 新增只接受 `actionType` 而不能表达 `targetGate/gateObjective` 的业务入口。
- 在 UI 主路径继续使用“转码任务 / 洗版任务”作为长期主语义，或把“删除任务”混入 optimize 语义。
- 为了兼容旧任务，把 scheduler/executor 中的 Mirex 分支继续扩张成新业务规则。
- 用“这是旧逻辑”作为理由绕过 Kairox Task Creator、Flow recovery、Resource event 或 full-auto 边界。

## 7. 修改 Kairox 的流程

Kairox 可以演进，但不能在实现中静默漂移。

修改流程：

1. 在相关 issue、任务说明或对话中明确说明要改变 Kairox contract。
2. 先更新本文，说明新的合同、旧合同为什么不再适用。
3. 若改变了关键决策，新增或更新 `docs/v3/adr/` 下的 ADR。
4. 同步更新 `docs/v2/ARCH_OVERVIEW.md` 中已经落地的当前实现事实；不要把它当成 Kairox 的替代合同。
5. 补充或更新测试，至少覆盖 TaskAdmission、task target、controlState、resource projection 或相关 API 契约。
6. 若涉及生产，按 `docs/v2/PRODUCTION_DEPLOYMENT.md` 执行标准部署和验证。

## 8. 开工检查

修改核心链路前，至少回答：

- 这个改动改变的是 Lifecycle、Task Creator、Flow Planner、Scheduler、Resource Runtime，还是 UI projection？
- 这个改动是否改变 User Perception Management、perception source priority、perception version 或 Douban / Emby 感知同步边界？
- 用户语义是否仍能表达为 `object + targetGate + gateObjective`？
- 自动和手动入口是否共用同一准入模型？
- 失败、确认、重试、恢复是否有 event 和 recovery contract？
- 资源压力和失败点是否能在后端诊断中解释？普通前端是否避免暴露运维细节？
- metadata gate 是否只覆盖 metadata/media 输入，并避免要求 rating、watched、playCount、doubanRating 这类 user perception facts？
- Lifecycle 是否负责 objective readiness / objective revision projection，而 Task Creator 只承接 projection？
- 是否影响 delete gate、delete review 或 destructive authorization？
- 全自动模式遇到不可判断事项时是否会停在可解释状态？
- 是否影响 service Docker、service Windows、desktop Windows 或 worker node 边界？
- 是否需要更新 `docs/v2/ARCH_OVERVIEW.md`、v3 细文档或测试？

## 9. 关联 ADR

- `docs/v3/adr/0001-kairox-architecture.md`
- `docs/v3/adr/0002-mirex-legacy-compatibility.md`
- `docs/v3/adr/0003-archive-delete-gate.md`
- `docs/v3/adr/0004-user-perception-management.md`
