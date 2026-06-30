# ARCH_OVERVIEW - 系统结构总览

本文是 ShelfDeck 当前唯一架构入口。更细的实现细节以代码和测试为准；当代码行为改变到影响组件边界、数据所有权、部署目标或外部集成时，必须同步更新本文。

## 1. 产品定位

ShelfDeck 是媒体库管家：基于 Emby 媒体数据、观看状态、用户评分和 Douban 评分，判断影片应该保留、删除、转码或洗版，并把动作交给 service 执行。

当前主要能力：

| 能力 | 说明 |
| --- | --- |
| 资产盘点 | 同步 Emby 电影库，保存媒体技术信息和用户关系数据 |
| 策略推荐 | 根据评分、观看状态、码率、编码、分辨率计算 action/reason |
| 空间管理 | 执行 delete/transcode/upgrade/scrape 等统一任务 |
| 成人库管理 | 管理成人文件夹库的单 item 入库、刮削、整理和演员库；不再通过私有目录监听/扫描自动发现并批量入队 |
| Admin Web | 配置 service、媒体库、策略、任务和外部集成 |
| Desktop | 浏览媒体库、下发意图、展示任务状态 |

## 2. 当前模块

| 模块 | Directory | Runtime | 职责 |
| --- | --- | --- | --- |
| service Docker | `media-service/` | Container | Linux/Docker 版主服务；HTTP API、Admin Web、任务调度、外部集成、内置 face-service |
| service Windows | `media-service/` | Node.js + Fastify + systray2 | Windows 版主服务；同 Docker 版，但内嵌托盘并使用 bundled FFmpeg |
| desktop | `media-desktop/` | Electron + React | HTTP thin client；管理 service 地址、浏览媒体、下发意图 |
| worker node | `media-worker/` | Node.js + Fastify + FFmpeg + optional AI runtime | 被动算力补充节点；接收 service 下发的转码 job，欧美成人 AI job 仅作为兼容扩展路径 |

## 3. 组件边界

系统逻辑上分为主控侧和计算侧：

| 组件 | 职责 | 状态所有权 |
| --- | --- | --- |
| service | HTTP API、任务队列、任务执行、媒体库缓存、配置、Admin Web、外部集成、欧美成人本地抽帧/人脸匹配/封面生成 | 任务、配置、媒体库、策略结果、People 人物库 |
| desktop | 用户交互、service 地址管理、任务/媒体展示、播放助手 | service 连接地址和本地 UI 状态 |
| worker node | FFmpeg 计算、GPU 能力探测、临时 job 文件、AI source asset、帧缓存和模型推理 | 仅持有计算侧临时状态、上传源文件缓存和模型缓存 |

跨组件通信一律使用 HTTP REST。desktop 不直接访问 Emby、Douban、MoviePilot 或 service 运行时数据文件。transcode node 不直接访问 Emby、MoviePilot 或 service 数据文件。

## 4. 进程模型

Windows:

```text
media-service
  Fastify :18080
  Admin Web static files
  embedded tray module

media-desktop
  Electron main process
  React renderer
  HTTP client -> media-service
```

Docker/Linux:

```text
container: media-service
  Fastify :18080
  Admin Web static files
  internal only:
    InsightFace face-service :19110
  no tray
```

Worker node:

```text
container: shelfdeck-media-worker
  Fastify :19000
  /api/v1/health
  /api/v1/capabilities
  /api/v1/jobs
  /api/v1/assets
  /api/v1/ai/jobs
  temporary source/output files
  AI source assets / frame cache

  optional internal only:
    Ollama :11434
    InsightFace face-service :19110
```

desktop 退出不影响 service。service 退出会中断任务并让 desktop 断连。

## 5. 数据流

```text
Emby/Douban/MoviePilot
        ^
        |
service API + engines  ----HTTP----> transcode node(s)
        ^
        |
desktop / Admin Web
```

核心流：

1. service 同步 Emby 媒体库到 `media-service/data/library.db`。
2. service 同步 Douban 或接收用户评分。
3. `StrategyEngine` 计算每个媒体项的 `action/reason`。
4. `SmartTaskEngine` 或用户操作创建任务。
5. `TaskAdmission` 先判断任务是否允许入队，并通过 `FlowPlanner` 固化 `taskBridge` 与 `flowPlan`；`PriorityEngine` 计算队列优先级。
6. `TaskScheduler` 保持 v2 `actionType` 兼容分派，但资源视图和事件历史按 `flowPlan` 的 bridge、direction、operation kind 和 resource type 解释任务。
7. 本机转码直接在 service 执行；远程转码通过 `NodeService` 上传源文件到 transcode node，轮询状态，下载输出，再由 service 完成校验和替换。
8. desktop 和 Admin Web 轮询 REST API 获取任务、媒体库和健康状态。

Dolby Vision 转码属于转码能力层，而不是任务管理绕行策略。`TranscodeService.precheck()` 必须为 Dolby Vision 源选择一个可运行的 HDR→SDR tonemap path：优先使用 FFmpeg `libplacebo`，但必须通过实际 filter graph self-test 验证运行时可用；如果 `libplacebo` 因 Vulkan/runtime 不可用失败，则降级到软件 `zscale+tonemap` path。两条 path 都不可用时，precheck 才失败，并把原因暴露给健康检查和任务事件。任务中心只展示该能力路径、resource 和失败摘要，不通过阻断或隐藏任务来替代转码能力补强。

任务模型：

- 任务分为系统级定时任务、子库级定时任务、单 item 任务三类。`StrategyEngine` 是子库/全局长周期策略计算，不是 item task；`ingest/scrape/transcode/upgrade/delete/archive` 是 v2 兼容的 operation kind，不再是任务的唯一语义身份。
- v3.1 单 item task 是生命周期阶段之间的 bridge。完整用户心智是 `source/discovered --ingest gate--> ingested --metadata gate--> metadata-ready --optimize gate--> optimized --archive gate--> archived`。新任务会保存 `taskBridge.kind`：`ingest`（`ingest`）、`metadata`（`scrape`）、`optimize`（`transcode/upgrade/delete`）、`archive`（`archive` finalize），并保存 `flowPlan.direction`、`flowPlan.operationKind`、`flowPlan.executor`、`flowPlan.steps` 和每步 `resourceType`。旧 `actionType` API 保留，用于兼容 desktop/Admin Web 和现有 flow executor。
- 子库只有两种调度模式：`automationMode=auto` 和 `automationMode=manual`。调度模式只决定任务创建后是否自动执行：`auto` 进入执行队列，`manual` 创建为待手动启动；后台是否自动创建任务由 `smartTaskEnabledActions` 和 `TaskAdmission` 统一控制。
- `TaskAdmission` 是任务创建闸门，统一处理自动/手动来源、active task 去重、失败冷却、按任务类型的自动队列上限、已转码不重复自动转码等规则，并在允许入队时调用 `FlowPlanner`。手动创建支持 v2 `actionType` 兼容输入，也支持 v3 bridge intent：`bridgeKind=ingest|metadata|optimize|archive` 加可选 `preferredOperation`；后端先把 intent 解析为受支持的 flow operation，再统一进入 admission。手动入口只查询当前 `itemId` 的 active task summary，用于去重和 `businessFlowDecision`，不能为了单个按钮点击读取全局 active task 列表或完整 task history。admission 成功响应会返回结构化 `admission.allowed/reason/operation/bridgeKind/intentMode/taskBridge/flowPlan`；admission 拒绝仍保持标准 `error`，并返回结构化 `admission` 和当前 `businessFlowDecision`，让前端能直接展示 blocked reason、缺失元数据、支持入口和可选 operations。active task conflict 还会返回轻量 `activeTask` 摘要，说明哪个现有任务占用了该 item。48 小时冻结属于 admission，不属于 priority。
- `/v1/library`、`/v1/library/queries/manage` 和 `/v1/library/items/:itemId` 的 `businessFlowDecision` 只能使用当前页/当前 item 的 active task summary projection；列表页按本页 `itemId` 集合查询 `queryTaskSummaries({ itemIds })`，单 item 详情查询 `queryTaskSummaries({ itemId })`。`task=active|none` 过滤也只从 active summary projection 取得 itemId 集合。媒体页不能为了展示按钮或 blocked reason 读取完整 task payload、logs、report 或历史记录。
- 媒体页 `businessFlowDecision.latestEventSummary` 不只展示 active task。若当前 item 没有 active task，但最近有失败/中断 task event，服务端会按当前页 `itemId` 集合从 `task_events` 查询轻量 recent failure projection，并返回 `kind=failure_event`、task/event/bridge/operation/resource 和 `failureSummary`。active task summary 优先级高于 terminal failure summary；两者都不能触发完整 task history 或 logs/report 读取。
- `task_events` 是任务内部执行事实的事件层。任务创建会写入 `task.created` 和 `flow.planned`；调度会写入带资源类型的 `flow.dispatched`；状态、phase、resumePoint、审批、暂停、恢复、中断、重试、失败等变化会追加事件，任务详情 API 可通过 `includeEvents=1` 或 `/events` 读取历史。
- `flow.dispatched` 之后如果 flow executor 抛错或 promise reject，Scheduler 必须把 task 标记为 `failed_hard`，并追加带当前 flow step、resource、bridge/operation 和错误摘要的 `flow.failed` 事件，同时写入 `scheduler.flowDispatch` diagnostic log。失败不能只表现为 task 终态变化；任务中心、Dashboard event 和 Resource view 必须能追到失败发生在哪个 flow/resource。
- 当 executor 自己捕获错误并通过 `reportStatus(..., failed_hard)` 上报失败时，自动生成的 `task.failed` event 必须包含轻量 `failureSummary`、bridge/flow operation 和 primary resource facts。该摘要只取最近 error log 的时间、级别和消息，不把完整 logs 或 report payload 写入事件 projection。
- 用户在任务中心触发的控制动作也必须进入 `task_events`。确认成功写 `task.confirmed`，开始/继续写 `task.execute_requested`，暂停写 `task.pause_requested`，取消/移除写 `task.cancel_requested`，失败重试继续写 `task.retry_requested` / `task.retry_recorded`。这些事件记录 `requestedBy=user`、action effect、原状态、恢复点和必要的 gate/confirmData 线索，用于任务详情和 Dashboard event projection 解释“用户刚推进了什么”。
- 任务列表和任务详情 API 会返回 `controlState` 投影，用于解释当前 task 的控制语义：是否需要用户确认、execute/pause/confirm/cancel/retry 是否可用、不可用原因、动作会造成的状态推进、恢复建议和最近事件摘要。任务 action endpoint 必须以同一套 `controlState.actions` 语义作为服务端强约束；若动作不可用，返回 `409 TASK_ACTION_REJECTED` 和对应 reason。失败任务的 retry 不是无条件重跑，而是按 flow recovery contract 校验 `actionType`、`resumePoint`、`retryCount` 和同 item active task 冲突后，重新排队同一个 task。列表投影只依赖 task current facts；详情页可附带最近 event。
- Flow recovery contract 由 `src/flowRecoveryContract.js` 统一定义，覆盖当前 `ingest/archive/scrape/transcode/upgrade/delete` 的默认恢复点、允许的 resume points、重试策略和幂等性说明。`TaskControlPolicy` 只消费该合同，不再单独维护一套 resume point 表；任务 response 的 `controlState.recoveryContract` 会投影当前 flow 的恢复合同，供任务中心解释失败任务能否 retry、从哪个 event 继续、以及需要用户检查什么。
- `/v1/tasks` 默认 active 列表和 `activeOnly=1` 必须走 `queryTaskSummaries(..., { includeHistory: false })`，返回轻量 task summary 与 `controlState`，不包含 logs/report/heavy adult face payload。只有显式 `includeHistory=1` 且不是 activeOnly 时才返回完整历史记录；单任务详情、report 和 events 继续作为按需读取入口。
- 服务重启恢复必须可解释。启动时发现 `executing`、旧 phase runtime 状态或 `pausingRequested` 的任务，会先标记为 `interrupted` 并写 `task.restart_interrupted`；调度轮自动重排 interrupted task 时写 `task.restart_recovery_queued`，超过重启恢复重试上限时写 `task.restart_recovery_failed`。这些事件会记录原 status/phase/resumePoint、retryCount 和恢复效果，供任务中心与 Resource view 解释重启后的状态跳转。
- `TaskScheduler` 的准入准出仍围绕 task 状态推进和 item lock，但并发容量开始按 `flowPlan`/event resource bucket 决策，例如 `local_transcode`/`worker_transcode`、`moviepilot`、`emby`、`scraper`、`local_ai`、`filesystem:ingest`、`filesystem:mutation`。`actionType` 只保留为 executor 分派和 v2 API 兼容字段。
- v3.0 起，ShelfDeck 的业务解释以 SQLite facts 为事实层，而不是依赖 `actionType/payload_json` 混合解释。`payload_json` 继续保存详情、报告和兼容上下文，但核心查询、调度、恢复和 Admin Web 展示必须优先使用 SQL columns。
- `media_items` 分为四组事实：`lifecycle_*` 描述媒体生命周期阶段和是否结案；`metadata_*` 描述用户语义上的“元数据完整” gate 完成度和缺失原因；`optimization_*` 描述转码/洗版结果；`archive_*` 描述归档/删除/keep-like 收口状态。媒体库页以 lifecycle、metadata、optimization、archive 命名，不再把 `action` 当作唯一产品语义。
- `ingestGate` 定义一个 source candidate 是否已经成为可管理媒体项：至少需要 item identity、source/sub-library identity、source location/reference，以及基础媒体事实或 probe failure 事实。`archiveGate` 定义优化后的最终闭环：必须先满足 optimize gate，再由 `archive.finalize` 写入 `archiveStatus=archived_like` / `archiveDoneAt` 等 closure marker；`delete` 只是 optimize flow 的一种 destructive operation，不是 archive gate 本身。
- “元数据完整”是 scrape 阶段完成、可进入 optimize 阶段的用户语义 gate，不是狭义技术字段分类。子库可通过 `metadataGate` 自定义该 gate，支持 `all` / `any` 条件；未配置时使用按普通 Emby / 成人库区分的默认 gate。配置保存和运行时都必须校验自定义 gate 覆盖当前子库策略模板会消费的 optimize 输入；若不覆盖，保存配置返回 `METADATA_GATE_CONTRACT_BROKEN`，运行时 `metadataMissingReasons` 包含 `metadata_gate_contract_broken`，避免出现“显示元数据完整但无法进入 optimize”的状态。
- `tasks` 分为 bridge facts、flow facts、runtime state 和 projection payload。`bridge_kind/bridge_from/bridge_to` 描述任务连接的生命周期阶段；`flow_direction/operation_kind/primary_resource_type/resource_types_json/flow_steps_json` 描述执行编排；`source/progress/phase/resume_point/retry_count/node_id` 是 runtime state。任务中心按 bridge、flow、event 展示，旧 `actionType` 仅用于 executor 分派和兼容 API。
- `task_events` 是持久 event history，包含 `resource_type/resource_key/resource_label/bridge_kind/flow_direction/operation_kind`。Resource view 以 event/resource 为中心展示运行、等待、阻塞、失败和瓶颈；调度器按当前 flow event 的 resource bucket 做并发准入。普通 Emby metadata repair scrape 使用 `emby:metadata` 资源 bucket，成人外部刮削继续使用 `scraper` 或 `local_ai`，两者不能混成同一种资源压力。
- Resource view 的 `diagnostics.failedEvents` 不只是裸 `task_events` 行；服务端会对最近失败/中断事件补充当前 task facts、`resourceContext`、`controlState.recovery`、标准化 `failureSummary` 和最近匹配的 `diagnosticSummary`。`failureSummary` 优先来自 `task.failed` / `flow.failed` event payload，其次从当前 task 的最近 error log 或 diagnostic log 提取轻量摘要；Resource view 不能要求前端解析完整 task logs/report。用户应能从资源诊断页看到失败发生在哪个 event/resource、当前是否可 retry/continue/confirm、恢复点是什么，以及可读错误摘要是什么。
- `PriorityEngine` 只决定可入队任务的执行顺序。优先级是多维度叠加分数：`来源权重 + 任务类型权重 + 子库权重 + 业务信号 + 等待时间 + 重试惩罚 + 规则修正`，数值越小越优先；高级规则只能贡献加减分，不能把总分设为绝对值。任务会保存 `priorityBreakdown`，用于解释各维度如何叠加成最终分数。用户手动调整任务优先级会直接覆盖任务上的最终分数。
- `PATCH /v1/admin/tasks/:id` priority 调整属于用户调度意图，成功响应会返回更新后的 task、`controlState` 和 `priorityAdjustment`；无效 priority 或任务状态不可编辑时，响应仍保持标准 `error`，并返回当前 task 摘要、`controlState`、`priorityAdjustment.enabled/reason/effect/currentPriority/requestedPriority/editableStatuses`。可编辑状态限定为 `created|pending_manual|queued|interrupted|paused`，已 dispatch 的 running task 和终态历史不能改 priority。
- 审批策略与调度策略分离。`approvalPolicy` 控制任务内部关键节点是否暂停，模式为 `auto`、`confirm`、`forceConfirm`；`forceConfirm` 不能被全局、子库或任务级覆盖降级。
- 当前审批 gate 包括 `delete.beforeExecute`、`transcode.dolbyVisionTonemap`、`transcode.beforeReplace`、`upgrade.candidateSelect`、`upgrade.identityMismatch`、`upgrade.beforeReplace`、`scrape.beforeWriteMetadata`、`scrape.beforeOrganize`、`scrape.reviewResult`。
- `ingest` 是单 item 入库任务类型，用于把文件候选转换为媒体项和技术探测结果；成人库没有独立目录级扫描或独立自动刮削能力，也不把大量新文件展开成完整刮削或转码动作。后台自动入库由 `SmartTaskEngine` 读取文件候选后统一经过 `smartTaskEnabledActions`、`TaskAdmission` 和 `PriorityEngine` 创建 `ingest` 任务。
- `SmartTaskEngine` 的健康状态必须解释最近一轮自动扫描，而不只是显示开关状态。`smartTask.getHealth().lastScanSummary` 返回 enabled actions、library item 数、candidate 数、按 action 的候选/入队计数、admission rejected reason 分布、queue cap skip 分布、`maxPerRunReached`、跳过原因或错误。该摘要只来自单轮扫描的轻量计数，不包含媒体详情、task payload、日志或 face/AI heavy data。
- v3.1 以后，`archive` 是 5 阶段生命周期闭环的轻量 finalize task。旧配置如果已经启用非空 `smartTaskEnabledActions` 但缺少 `archive`，加载时会迁移补上 `archive` 并记录 `migrations.v31ArchiveAutomation=true`；完全空的 allow-list 仍表示自动化关闭，不会被迁移打开。
- 任务持久化使用 `data/tasks.db` SQLite。任务中心保留完成、失败等历史记录；调度器、节点统计、转码临时目录清理等热路径只读取非终态 active task，不能为了降低队列压力删除历史任务。
- 启动期全局维护不属于单 item task。普通媒体库启动刷新由 `mediaLibraryStartupRefreshOnStartup` 和 `mediaLibraryStartupRefreshDelaySeconds` 控制；自算字段立即运行由 `mediaLibrarySelfComputeOnStartup` 控制；`SmartTaskEngine` 首次自动入队扫描由 `smartTaskInitialDelaySeconds` 控制。生产部署可通过这些开关先恢复 API 响应，再让周期任务按节奏运行。
- 成人库 `ingest` 的媒体探测使用 `adultLibrary.probeTimeoutMs` 控制单文件 `ffprobe` 超时。坏文件或异常路径只记录 `probeError` 并继续入库，不应拖住整个 HTTP 服务。

成人文件夹库流：

1. 用户创建 `mediaType=adult`、`source=folder` 的子库，并配置 `watchRoot`。
2. 不存在目录级 scan 任务创建入口；候选发现只是 `SmartTaskEngine` 的只读输入，不写媒体库、不刷新子库状态、不创建 `scrape`。
   `POST /v1/admin/sublibraries/:uuid/actions/scan` 已废弃并返回 `410 SUBLIBRARY_SCAN_REMOVED`。
3. `SmartTaskEngine` 在 `smartTaskEnabledActions` 包含 `ingest` 时读取未入库文件候选，并按统一 admission/priority 创建单 item `ingest` 任务；候选发现本身不写媒体库、不创建 scrape。
4. `IngestFlowExecutor` 每次只处理一个文件候选，完成文件探测、NFO 预解析和媒体项写入，任务到“已入库”即结束。已前置刮削的文件会直接成为 `scraped=true` item；未刮削文件只写成 `scraped=false`、`adultMetadata.scrapeStatus=pending` 的库 item，不在 ingest 内创建 `scrape` 任务。
5. 日本 JAV 子库使用 `scraperType=shelfdeck_japanese_jav`；欧美成人库使用 `scraperType=western_builtin`。两者的单 item 入库和后续刮削都复用统一任务模型。
6. `ScrapeFlowExecutor` 每次只处理一个 item。JAV 通过内置 Node.js scraper 拉取元数据；欧美成人默认在 service 内本地执行 FFmpeg 抽帧、调用容器内 face-service 生成 embedding、匹配 People 人物库并生成 deterministic composite poster。`computeMode=worker` 仅作为兼容扩展路径。
   service-local 欧美成人 AI 跑在主 service 进程内，为保护 Admin Web/API 响应性，调度器必须单独限制该路径同一时间只执行 1 个本地分析任务；JAV scrape 和 `computeMode=worker` 不受此本地 AI 槽限制。
7. 刮削/整理成功后由 ShelfDeck 移动影片到库目录下的统一归拢目录（默认 `scraped/`），写入 `movie.nfo`、同名 NFO、封面、`.shelfdeck.json`，并通过 `ScrapeVerification` 合同校验后才更新 `adultMetadata`、`scraped=true` 和媒体技术信息；欧美成人未识别 protagonist 时任务失败，只保留 unknown face 诊断数据，不写成功态 NFO/封面。
8. `StrategyEngine` 使用成人库策略模板计算 `transcode/keep`；`scrape` flow 不直接链式创建转码任务，后续是否转码由 `SmartTaskEngine` 根据 `scraped=true` 等策略条件决定。
9. 后续转码继续复用现有 `TranscodeFlowExecutor`。

欧美成人库补充规则：

- 裸视频以 path identity 入库，不做番号识别；欧美成人番号由识别出的 protagonist 和 People canonical code 自生成。
- People 人物库归 service 持久化；用户搜索/上传高清正脸图建立 reference face，后续匹配以该 reference embedding 为真值。演员图片搜索源包括 Stash-box GraphQL（默认 TPDB endpoint，可配置 FansDB/其他 stash-box）、MetadataAPI、TMDB、Wikimedia，出站请求默认复用日本 JAV scraper 的代理配置，并在无候选/源失败时向 UI 返回诊断信息；同时保留手动图片 URL/本地上传兜底以覆盖素人演员。
- service Docker all-in-one 内部启动 InsightFace face-service，默认地址为 `http://127.0.0.1:19110/v1/face/embeddings`；该地址不是用户配置项，仅可通过环境变量覆盖。
- 初次未知人脸由 service-local 分析返回 `unknownFaces`，包含头像样本和 embedding 诊断；用户命名后，service 通过 `/v1/admin/adult/people/from-face` 将该 cluster 写入 People reference faces。
- 自动 `scrape` 的触发条件是库 item 状态，而不是 ingest 任务链式触发：`source=adult_folder`、`scraped !== true`、`adultMetadata.scrapeStatus` 为空或 `pending`，并且 `smartTaskEnabledActions` 包含 `scrape`，再经过 `TaskAdmission` 去重、冷却和队列上限。欧美成人 `pending` item 即使还没有 protagonist 或演员身份信号也可以自动创建首次 `scrape` 任务；首次 AI 分析负责产生 `unknownFaces`/`faceClusters` 供用户命名。`failed`、`ambiguous`、`needs_review`、`done` 不会自动反复重试，需要显式用户动作或已完成。
- 欧美成人匹配不到 protagonist 时等同于 JAV 识别不到番号：任务 `failed_hard`，item 保持 `scraped=false`，不会进入自动转码策略。
- 自动通过的 item 标记 `scraped=true`，后续转码继续复用现有 `TranscodeFlowExecutor`。
- 刮削成功会在库目录下的统一归拢目录（默认 `scraped/`，可通过 `adultLibrary.organizedFolderName` 或分区配置覆盖）中新建标准影片目录并移动当前视频：欧美成人目录/视频名为 `{adultId} {protagonist}`；JAV 目录/视频名沿用 scraper 返回的标题命名规范。已有目录不直接改名，目录内其他视频不被一起移动。ShelfDeck 的目录核对默认忽略该归拢目录，Emby 可只监控这个归拢目录。
- `scraped=true` 不能由目录位置或任务状态推断。ShelfDeck scrape 成功必须满足结构化 item 合同：媒体文件存在、`adultMetadata.scrapeStatus=done`、关键元数据存在、按配置写出的 NFO/封面存在、`.shelfdeck.json` 可读且 `itemId/subLibraryId/mediaPath/scrapeTaskId/scrapedAt` 与当前 item 匹配。任务状态只作为执行审计，不参与判断视频是否已刮削；任务报告会返回 `scrapeVerification` 结果。

混合成人库处理：

- 已经由 JavSP 或其他工具前置刮削的目录，只要媒体旁边存在 `movie.nfo` 或同名 `.nfo`，`ingest` 时会解析 NFO，标记为 `scraped=true`，不会再自动创建刮削任务。
- 未刮削的裸视频会在 `ingest` 时从文件名/路径识别番号或生成欧美成人占位番号，标记为 `scraped=false`、`adultMetadata.scrapeStatus=pending`。后续是否创建 `scrape` 任务只由 `SmartTaskEngine` 基于库 item 状态、`smartTaskEnabledActions`、`TaskAdmission` 和 `PriorityEngine` 决定。
- Admin Web 的媒体库管理页在成人库条目的名称下展示“已刮削 / 待刮削 / 刮削失败”状态、番号和 studio，并提供刮削状态筛选；整目录手动扫描入口已移除。

## 6. Service 模块

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| HTTP API | `src/app.js` | `/v1/*` 和 `/v1/admin/*` 路由 |
| Server | `src/server.js` | 启动、关闭、可选 tray |
| Config | `src/configStore.js` | `data/config.json` 读写、默认值、平台路径 |
| Library store | `src/libraryStore.js` | `data/library.db` SQLite 读写；启动时从旧 `library.json` 一次性迁移 |
| Task store | `src/taskStore.js` | `data/tasks.db` SQLite 读写；启动时从旧 `tasks.json` 一次性迁移 |
| Flow planner | `src/flowPlanner.js` | 将 v2 `actionType` 映射为 v2.7 `taskBridge`、`flowPlan` 和资源步骤 |
| v3 model | `src/v3Model.js` | 将媒体项、任务和事件规范化为 v3 SQL facts；迁移、写入和查询共用 |
| Scheduler | `src/taskScheduler.js` | 轮询、锁、并发、flow dispatch |
| Task admission | `src/taskAdmission.js` | 自动/手动入队闸门、去重、冷却、业务幂等 |
| Approval policy | `src/approvalPolicy.js` | 任务内部关键节点审批策略 |
| Priority engine | `src/priorityEngine.js` | 任务优先级计算 |
| Delete flow | `src/deleteFlowExecutor.js` | 删除任务执行 |
| Transcode flow | `src/transcodeFlowExecutor.js` | 转码任务执行 |
| Upgrade flow | `src/upgradeFlowExecutor.js` | MoviePilot 洗版任务执行 |
| Ingest flow | `src/ingestFlowExecutor.js` | 文件候选入库任务执行；单文件探测、NFO 预解析、媒体项写入 |
| Archive flow | `src/archiveFlowExecutor.js` | 优化完成后的轻量生命周期闭环；写入 archive closure facts，不删除媒体 |
| Scrape flow | `src/scrapeFlowExecutor.js` | 普通 Emby metadata repair 和成人库刮削/整理任务执行；普通库读取 Emby、已有 Douban 缓存和自算字段，成人库 JAV 调用内置 scraper，欧美成人默认 service-local AI |
| Library | `src/mediaLibraryService.js` | 子库和媒体缓存管理 |
| Adult folder library | `src/adultLibraryService.js` | 成人文件夹库单 item 入库、刮削、整理、演员库和只读目录核对 |
| Policy | `src/mediaPolicyService.js`、`src/strategyEngine.js`、`src/smartTaskEngine.js`、`src/flowRecoveryContract.js` | 策略计算、自动入队和 flow recovery contract |
| External adapters | `src/services/*Service.js` | Emby、Douban、MoviePilot、FFmpeg、成人库 scraper、欧美成人 service-local/worker AI |
| Tray | `src/tray.js` | Windows 系统托盘 |
| People store | `src/peopleStore.js` | `data/people.json` 欧美成人人物库 |
| Node registry | `src/nodeStore.js` | `data/nodes.json` worker 节点登记、健康状态、设备池 |
| Node client | `src/nodeService.js` | 调用 worker 的 transcode job、AI asset/job、capabilities/health API |

## 7. Worker Node 模块

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| Worker API | `media-worker/src/server.js` | `/api/v1/jobs`、上传源文件、查询状态、下载输出、清理 job、AI asset/job API |
| AI service | `media-worker/src/aiService.js` | source asset 缓存、抽帧、People 快照匹配、face embedding 调用、VLM 调用 |
| Worker config | `media-worker/src/config.js` | 默认端口、API key、临时目录、AI data root、FFmpeg 路径、VLM endpoint、face embedding endpoint |
| All-in-one image | `media-worker/Dockerfile.all-in-one` | 单容器 GPU 算力节点，内部启动 Node worker、Ollama 和 InsightFace |
| Face service | `media-worker/face-service/` | InsightFace HTTP embedding 服务，仅在 all-in-one 容器内部暴露 |
| Worker admin | `media-worker/src/admin.html` | 简单配置页面 |

worker node 是被动计算节点，欧美成人管理不依赖 worker：

- 不知道 Emby、MoviePilot、媒体库路径映射或 service 地址。
- 转码 job 保存内存状态和临时源/输出文件。
- AI job 通过 `/api/v1/assets` 接收 service 上传的源视频，worker 本地保存 source asset 和抽帧缓存；该路径仅用于 `computeMode=worker`。
- People 不在 worker 持久化；service 在创建 AI job 时传入当前 People 快照。
- 默认 service 部署只启动一个容器；face-service 是 service 容器内进程，不作为用户可见的独立 Docker 服务。
- VLM endpoint 必须兼容 OpenAI chat completions：`POST {VISION_BASE_URL}/chat/completions`，支持 image_url data URI。默认 all-in-one 内部地址是 `http://127.0.0.1:11434/v1`。
- Face endpoint 由 `FACE_EMBEDDINGS_URL` 指定，约定输入 `{ images: [{ imageId, imageIndex, data, mimeType }], detect, returnCrops }`，输出 `{ faces: [{ faceId, imageIndex, bbox, embedding, sampleImageBase64 }] }`。默认 all-in-one 内部地址是 `http://127.0.0.1:19110/v1/face/embeddings`。
- 由 service 负责任务持久化、调度、校验和替换。
- 默认端口是 `19000`。
- 删除 worker node 前，service 使用 task summary projection 查询绑定该 `nodeId` 且正在 `executing` 的转码任务；如果存在 active job，`DELETE /v1/admin/nodes/:id` 返回 `409 NODE_HAS_ACTIVE_JOBS`，同时给出 `node`、`resourceContext`、`activeTasks` 和 `forceDelete` 后果。`?force=true` 会先尝试取消执行器，再把这些 active task 标记为 `failed_hard` 后删除节点。

## 8. Runtime Data

Runtime data 不入库：

| 文件 | 所有者 | 说明 |
| --- | --- | --- |
| `media-service/data/config.json` | service | 配置 |
| `media-service/data/tasks.db` | service | 任务队列和任务中心历史 |
| `media-service/data/tasks.json` | service | 旧版任务存储；存在时启动自动迁移到 `tasks.db`，迁移后仅作为原始记录保留 |
| `media-service/data/library.db` | service | 媒体库主存储；列表分页、筛选和 item 读写从 SQLite 读取 |
| `media-service/data/library.json` | service | 旧版媒体库缓存；存在时启动自动迁移到 `library.db`，迁移后仅作为原始记录保留 |
| `media-service/data/nodes.json` | service | 转码节点登记；跟随 service data dir |
| `media-service/data/people.json` | service | 欧美成人 People 人物库 |
| `media-worker/config.json` | worker node | worker 本机配置 |
| `media-worker/data/ai/` | worker node | AI source asset、抽帧缓存和模型侧运行数据 |

不要把生产/测试环境导出的 `tasks_*.json`、`config_*.json`、截图、构建产物或日志提交到仓库。

## 9. API 契约

- Desktop domain: `/v1/*`
- Admin domain: `/v1/admin/*`
- Health: `GET /v1/health` public
- Protected APIs: `X-Api-Key`
- Error shape: `{ error: { code, message } }`
- GET 无副作用，PATCH 幂等部分更新

API 细节以 `src/app.js` 和现有 tests 为准。新增或变更 API 时必须补充对应 service inject test、desktop integration test 或 E2E flow。

成人库相关 API：

- `POST /v1/admin/sublibraries` 支持 `source=folder`、`mediaType=adult`。
- `POST /v1/admin/sublibraries/:uuid/actions/scan` 已废弃，返回 `410 SUBLIBRARY_SCAN_REMOVED`。
- `GET/PATCH /v1/admin/adult/config` 管理成人库全局默认配置、日本 JAV scraper 默认项和欧美成人配置；face-service 不作为用户配置项暴露。
- `GET/POST/PATCH/DELETE /v1/admin/adult/people` 管理 service-owned People 人物库。
- `POST /v1/admin/adult/people/from-face` 从某个 item 的 unknown face cluster 创建 People reference face。
- `/v1/tasks` 保留 `actionType=ingest|scrape|transcode|upgrade|delete|archive` 兼容输入，同时支持 `bridgeKind` / `preferredOperation` 手动 intent。`ingest` bridge 只允许 `ingest`，`metadata` bridge 只允许 `scrape`，`optimize` bridge 允许 `transcode|upgrade|delete`，`archive` bridge 只允许 `archive` finalize；没有明确 operation 时只采用 item 当前推荐方向，不替用户猜测破坏性动作。所有 operation 都进入统一任务队列和任务监控。
- `POST /v1/admin/adult/items/:itemId/actions/rescrape` 是成人条目的显式 metadata bridge 入口。它通过 `TaskAdmission` 创建 `scrape` task，任务记录 `requestedIntent.intentMode=adult_rescrape`，响应保留 `taskId` 兼容字段，并返回 `task`、`taskBridge`、`flowPlan`、`requestedIntent` 和 `controlState`，让前端能解释“用户要求重刮”实际落到哪个 flow。若同 item 已有 active scrape task，返回 `409 TASK_CONFLICT`、`admission.reason=active_task_exists`、当前 `businessFlowDecision` 和轻量 `activeTask` 摘要，避免重复入口只给裸 conflict。
- `/v1/tasks`、`/v1/tasks/:id`、`/v1/admin/tasks`、`/v1/admin/tasks/:id` 的 task response 包含 `controlState`。前端应优先使用该字段展示任务控制按钮、确认点和恢复建议，而不是只按 `status/actionType` 自行推断。
- `GET /v1/admin/tasks` 支持 `attention=needs_action|confirmation|recovery|manual_start`，并在 `summary.attention` 返回同一组处理队列计数。该投影由 `controlState.primaryAction` 和 action effect 推导：等待确认进入 `confirmation`，可 retry 或 resume 的任务进入 `recovery`，需要手动开始的任务进入 `manual_start`，三者合并为 `needs_action`。运行中的 queued/executing 任务、已达 retry 上限的失败任务、终态历史记录不能仅因为 status 相似就进入处理队列。列表和 attention summary 必须使用 `queryTaskSummaries` 这类轻量 current-facts projection，不能读取完整 task payload、logs、report 或 adult face clusters。
- `GET /v1/admin/tasks/lifecycle-audit` 是任务中心和诊断页使用的任务生命周期审计 projection。它只读取 `queryTaskSummaries` current facts 和 config 中的 sub-library 定义，按 `mediaType`、sub-library、status、lifecycle stage、bridge kind、operation kind、source 聚合，并返回异常 signal 样本，例如普通媒体 scrape task、缺少 sub-library context、缺少 bridge/operation/resource、等待确认但没有 confirmation gate、执行中缺 phase。该接口用于回答“每种库类型下 task 生命周期是否符合预期”，不能从完整 task payload、logs、report 或媒体库 heavy payload 中反推。
- `GET /v1/admin/confirmations` 是任务中心确认/审核队列的专用 lightweight projection。它默认合并两类用户待处理事项：`tasks.db` 中的 `awaiting_user_confirm` task，以及 `library.db` 中成人条目的 `scrape_status=ambiguous|needs_review` 或 `adultMetadata.reviewStatus=needs_review`。task confirmation 返回 `confirmation.gateId/message/options/resumePoint/effect/whyRequired`、`confirmAction`、`recovery`、`taskBridge` 和 `flowPlan`，并提供按 gate、bridge kind、operation kind 的 summary；adult review 以 `kind=adult_review` 返回 metadata/scrape bridge、review reason、review action 和轻量 item/adult metadata。该接口支持 `kind=task|adult_review|all`、`bridgeKind`、`operationKind`、`actionType`、`reviewStatus`、`subLibraryId` 和 `q` 过滤。任务中心可以直接展示“为什么要用户确认/审核、确认后会继续到哪里”；前端不能从通用任务列表、完整 logs、report、完整媒体 payload 或 adult face clusters 中反推确认台。
- `GET /v1/admin/dashboard/health` 的 `tasks` 聚合会包含同一套 `attention` 队列计数和 `primaryAttention`。Dashboard 只展示入口级健康信号和任务中心跳转，不复制任务中心明细列表；处理队列的业务判定仍以后端 `TaskControlPolicy` 为准。`automation` 聚合会返回当前 `enabledOperations` 和精简 `smartTask` health，其中 `lastScanSummary` 只包含上一轮自动扫描的候选/入队/拒绝/跳过计数与 reason 分布，供 Dashboard 解释自动化为什么动或没动。
- `GET /v1/admin/dashboard/health` 同时返回 `events.recent` Dashboard event projection。该 projection 合并内存 `activityLog` 与最近 `task_events` current facts，输出统一的 `kind/source/sourceLabel/severity/message/ts/taskId/resource` 字段；Dashboard 的“系统事件”卡片消费这个结构化 projection，不再单独轮询 `/v1/activity-log`，也不读取 task event payload、完整 task history 或原始 service log。
- `POST /v1/tasks/:id/actions/execute`、`POST /v1/tasks/:id/actions/pause`、`PATCH /v1/tasks/:id` confirm、`DELETE /v1/tasks/:id` 和 `DELETE /v1/admin/tasks/:id` 必须先校验对应 `controlState.actions.*.enabled`；不可用时返回 `409 TASK_ACTION_REJECTED`，避免直接调用 API 绕过前端按钮状态。任务 action / recovery 的 409 response 保留标准 `error`，并额外返回 `task`、`actionName`、`action`、`controlState`、`recovery`，让任务中心能解释当前为什么不可执行以及下一步应看确认、恢复还是事件。retry 遇到同 item active task 冲突时返回 `TASK_RECOVERY_REJECTED`、`recoveryPlan.reason=active_task_conflict` 和轻量 `activeTask` 摘要，而不是裸 `TASK_CONFLICT`。
- `POST /v1/tasks/:id/actions/retry` 只恢复 `controlState.actions.retry.enabled=true` 的失败任务。成功后同一个 task 回到 `queued`，`retryCount` 增加，保留或补齐 flow `resumePoint`，写入 `task.retry_requested` / `task.retry_recorded` 事件；若重试次数到达上限、resumePoint 不在该 flow contract 内，或同 item 已存在 active task，则返回 409。
- `GET /v1/admin/resources` 返回 Resource view，其中 `diagnostics.failedEvents[]` 每行保留 task event 字段，并额外包含 `task`、`resourceContext`、`recovery`、`controlState`、`diagnosticSummary`。该投影只读取最近失败 event、对应 task current facts 和最近 diagnostic log，不扫描完整 task history 或 heavy payload。
- `approvalPolicy` 和 `automationMode` 属于子库任务配置；旧的 `scheduleMode/custom/autoReplace*` 字段仅作为兼容旧配置保留。

Worker API:

- `GET /api/v1/health`
- `GET /api/v1/capabilities`
- `POST /api/v1/jobs`
- `PUT /api/v1/jobs/:id/source`
- `GET /api/v1/jobs/:id`
- `GET /api/v1/jobs/:id/output`
- `DELETE /api/v1/jobs/:id`
- `POST /api/v1/assets`
- `PUT /api/v1/assets/:id/source`
- `GET /api/v1/assets/:id`
- `POST /api/v1/ai/jobs`
- `GET /api/v1/ai/jobs/:id`

## 10. 平台约束

- Docker/Linux 专用行为使用 `process.platform === 'linux'`。
- Windows-only tray 代码必须可选加载，Docker 中缺失 optional dependency 是正常情况。
- 路径使用 `path.join()` 和可配置根目录。
- FFmpeg/FFprobe 优先读取 `FFMPEG_PATH`、`FFPROBE_PATH`，Dockerfile 提供默认值。
- 日本 JAV scraper 是 service 内置 Node.js 实现，不依赖 Python。需要访问受限站点时，在成人库配置中设置代理服务器。
- 欧美成人 AI 默认在 service Docker all-in-one 内执行；worker 可保留为额外算力补充或兼容路径。

## 11. 关联文档

- `docs/v2/DEVELOPMENT_WORKFLOW.md`
- `docs/v2/TEST_ARCHITECTURE.md`
- `docs/v2/DEBUG_WORKFLOW.md`
- `tests/TEST_ENV_CHECKLIST.md`（私有凭据，不提交）
