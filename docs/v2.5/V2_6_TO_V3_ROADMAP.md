# ShelfDeck v2.6 -> v3.0 Iteration Roadmap

本文固化从当前 v2.5 向 v3.0 演进的阶段计划，避免后续长程目标或上下文压缩后丢失版本边界。

核心判断：

- v2.5 是生产能力保留 + 局部架构探路。
- v3.0 的关键不是重写所有功能，而是让 lifecycle、task bridge、flow、event、resource scheduling、projection 成为系统事实。
- 后续采用连续长程目标推进：`v2.6 -> v2.6.1 -> v2.7 -> v3.0`。
- 每个长程目标只推进一个版本；验收、部署、固化后再进入下一版。

## 总路线

```text
v2.5  当前基础：生产能力可用，已有 task_events/resource view/projection 的雏形
v2.6  Event 可观测版本：先看清谁在干活、谁在吃资源
v2.6.1 Diagnostic Log 版本：补全非 flow-node 的存储/系统诊断日志
v2.7  Task / Flow 语义收正版：任务变成 lifecycle bridge，flow 编排 event
v3.0  数据模型与产品语义成型版：v3 模型成为 SQL facts / runtime / projections 的事实基础
```

执行原则：

- v2.6 不大改业务语义，只补可观测性。
- v2.6.1 固定 event 语义，补 diagnostic/resource log，不把数据库维护层混入 flow event。
- v2.7 收正 task、flow、event 的业务语义，但不做数据模型完全换代。
- v3.0 再做 SQL facts、runtime state、projections、Admin Web 产品语义的正式收口。
- 每版都必须可独立部署、独立验收、独立回滚。
- 不清理生产数据，不改变危险文件操作语义，除非用户明确授权。
- service Docker/Admin Web 是优先对象；desktop 与 worker 仅处理兼容影响。

## 版本总表

| 版本 | 一句话目标 | 用户可感知变化 | 不做什么 | 验收门槛 |
| --- | --- | --- | --- | --- |
| v2.6 | 先让系统可观测 | 资源视图能解释媒体库加载、豆瓣同步、SmartTask、任务调度是谁在运行、耗时多久、占用什么资源 | 不改 task 业务语义，不重写 flow，不改危险文件操作 | 卡顿或 CPU 升高时，Admin Web/API 能归因到具体 runtime event |
| v2.6.1 | 固定 event 语义并补诊断日志 | 当 event 证明不是业务 flow 卡住时，用户能继续看到 SQLite/WAL、store、projection、scheduler 等系统层瓶颈 | 不把数据库维护叫 event，不改 task/flow 语义，不清生产数据 | 资源/诊断页能区分 flow event、diagnostic log、metric，并解释 WAL/SQLite/Store 层耗时 |
| v2.7 | 收正 task / flow / event 语义 | 任务中心能从 lifecycle bridge、flow plan、event history 解释任务为什么发生、如何执行、哪里失败 | 不做 SQL facts 全面换代，不做 Admin Web 全量产品重组 | 手动/自动任务仍可用，但新任务已能用 bridge + flow + event 表达 |
| v3.0 | 让 v3 模型成为数据事实和产品语义 | 媒体库、任务中心、资源视图、诊断页都围绕 lifecycle、metadata、optimization、archive、flow、event 展示 | 不机械复制 v2 内部模型，不把 `actionType`/`payload_json` 当主模型 | SQL facts / runtime / projections 分层成立，生产数据可 dry-run 迁移或兼容导入 |

## 语义固定

从 v2.6.1 起，后续文档和实现必须固定以下语义：

| 概念 | 固定含义 |
| --- | --- |
| `event` | flow 里的一个 node，是一次被编排的业务/执行动作 |
| `event log` | event 执行过程中的日志记录，解释该 node 怎么跑、为什么失败 |
| `diagnostic log` | 系统层诊断记录，不一定属于某个 flow node，用于解释瓶颈、异常和资源消耗 |
| `metric` | CPU、内存、IO、WAL size、耗时、行数、队列长度等指标 |
| `activity` | 给用户看的系统动态摘要 |

数据库维护层、SQLite/WAL、store 查询、projection build、scheduler tick 等默认不是 `event`。

它们只有在某个 flow 中被明确编排为 node 时才可以成为 event；否则只能进入 diagnostic log / metric / activity。

## 交接约束

- 后续每个长程目标只推进一个版本，不跨版偷跑。
- 每个版本开始前先重新阅读本文件、`AGENTS.md`、`docs/v2/DEBUG_WORKFLOW.md`、`docs/v2/PRODUCTION_DEPLOYMENT.md`。
- 每个版本先排摸当时的代码库现状，再决定具体实现；本文定义目标和边界，不替后续 agent 预写实现方案。
- v2 生产能力是行为基线，v3 业务模型是方向；发生冲突时，先保护生产安全，再用小步迭代收正模型。
- desktop 与 worker 不是这三版的主动重构对象；只有 service API 或资源调度兼容必须调整时才处理。
- 任何真实删除、真实替换原文件、生产数据清理，都必须再次获得用户明确授权。

## v2.6 - Event 可观测版本

目标：让系统能回答“现在谁在干活、谁在吃资源”。

### 范围

- 建立轻量 event / runtime event 观测层。
- 资源视图从 active task 视角升级到 event/resource 视角。
- 覆盖后台操作：`library.query`、`douban.sync`、`strategy.run`、`smartTask.scan`、`task.dispatch`。
- 合并展示 active task 与 runtime event。
- 不重构 task 业务语义。
- 不改变转码、洗版、删除、刮削等核心行为。
- 不清理生产数据，不删除历史任务。

### 用户视角 Before / After

Before：

- 资源视图为空，或只能看到 active task。
- 页面卡顿时只能猜是豆瓣同步、策略计算、媒体库查询、SmartTask 扫描还是任务调度。
- 只能看到 Node 进程 CPU 升高，无法知道具体业务事件。

After：

- 资源视图能看到当前或最近的业务 event。
- 媒体库加载时可看到 `library.query`。
- 豆瓣同步时可看到 `douban.sync`。
- SmartTask 扫描时可看到 `smartTask.scan`。
- 创建或调度任务时可看到任务相关 event。
- 每个 event 有开始时间、结束时间或运行中、耗时、状态、资源类型、来源组件、关联 task/item/subLibrary。

### 验收标准

- `/v1/admin/resources` 返回 event/resource 维度信息，而不是只返回 task 投影。
- Admin Web 资源视图能展示当前/最近事件、耗时、状态、资源类型、来源组件、关联对象。
- 打开媒体库页时，资源视图能看到 `library.query`。
- 手动触发豆瓣同步时，资源视图能看到 `douban.sync`，结束后能看到耗时。
- 等待或触发 SmartTask 扫描时，资源视图能看到 `smartTask.scan`。
- 创建一个转码/刮削/洗版等任务后，资源视图能看到 task dispatch 或 flow 相关 event。
- event 记录不能显著拖慢系统，资源视图自身响应稳定。
- 生产部署后媒体库、任务中心、资源视图正常。

### 长程目标提示词

```text
/goal 推进 ShelfDeck v2.6：Event 可观测版本。

目标：
在当前 v2.5 基础上补齐最小可用的 event/resource 可观测层，让系统能在资源升高、页面卡顿、后台同步运行时回答“谁在干活、谁在吃资源”。

边界：
1. 本轮不重构 task 业务语义。
2. 本轮不改变转码、洗版、删除、刮削等核心行为。
3. 本轮不清理生产数据、不删除历史任务。
4. 本轮只做 v2.6，完成后部署和验收，不继续推进 v2.7。

必须完成：
- 阅读 AGENTS.md、docs/v2/DEBUG_WORKFLOW.md、生产部署文档。
- 排摸现有 task_events、resourceProjection、taskScheduler、smartTaskEngine、mediaLibraryService、strategyEngine。
- 设计并实现轻量 runtime event / resource event 观测层。
- 至少覆盖 library.query、douban.sync、strategy.run、smartTask.scan、task.dispatch。
- 资源视图合并 active task 与 runtime event。
- API /v1/admin/resources 返回 event/resource 维度信息。
- Admin Web 资源视图能展示当前/最近事件、耗时、状态、资源类型、来源组件、关联对象。
- 增加必要测试。
- 构建并按标准流程部署到 NAS。
- 用生产环境验证媒体库页面、豆瓣同步、SmartTask、任务创建时资源视图可归因。

验收：
v2.6 通过的标志是：当系统卡顿或 CPU 升高时，资源视图能明确显示当前正在运行的业务 event，而不是只能猜测 Node 进程在忙。
```

## v2.6.1 - Diagnostic Log 版本

目标：在 v2.6 已经能观测 flow event / runtime event 的基础上，补上非 flow-node 的系统诊断日志，尤其是 SQLite/WAL、store、projection、scheduler tick 等资源消耗，让系统能继续回答“如果不是业务 event，那到底是哪一层在忙”。

### 背景

v2.6 生产验证已经证明资源视图可以回答 `library.query`、`douban.sync`、`strategy.run`、`smartTask.scan`、`task.dispatch` 等业务/运行事件。

但媒体库页面卡顿诊断也暴露了新的盲区：

- `event` 能证明 `/v1/library?limit=50` 不是慢点。
- `event` 能看到最近高频的是 `douban.sync`、SmartTask、scrape dispatch。
- 但 `library.db-wal`、`tasks.db-wal`、SQLite checkpoint、store query、projection build、scheduler tick 的耗时和体积变化没有被全局记录。
- 如果把这些都叫 event，会污染“event 是 flow node”的业务模型。

因此 v2.6.1 要补的是 diagnostic log / resource metric，不是扩大 event 概念。

### 范围

- 建立轻量全局 diagnostic log / resource log。
- 资源视图或诊断 API 同时展示：
  - flow/runtime event；
  - diagnostic log；
  - resource metric。
- 为以下系统层操作记录 diagnostic log：
  - `libraryStore.queryItems`
  - `libraryStore.updateItems`
  - `libraryStore.replaceSubLibraryItems`
  - `libraryStore.checkpointWal`
  - `taskStore.querySchedulerTasks`
  - `taskStore.queryTaskAdmissionRows`
  - `taskStore.createTask`
  - `taskStore.writeTaskEvent`
  - `resourceProjection.buildResourceView`
  - `strategyEngine.runOnce`
  - `smartTaskEngine.run`
  - `scheduler.tick`
- 记录 WAL / DB 指标：
  - `library.db` size；
  - `library.db-wal` size；
  - `tasks.db` size；
  - `tasks.db-wal` size；
  - checkpoint 耗时；
  - 查询行数；
  - 写入行数。
- 对 slow operation 做阈值标记，例如 `status = slow`。
- 不改变业务 event 语义。
- 不改变 task/flow 语义。
- 不清理生产数据。
- 不把 WAL checkpoint 当成 flow event。

### 用户视角 Before / After

Before：

- 资源视图能看到 `library.query` 很快，但仍不知道为什么 Node CPU / IO 高。
- WAL 文件变大只能通过 SSH 查文件大小。
- SQLite checkpoint、store 写入、projection build 是否慢，只能从间接现象猜。

After：

- 当媒体库页面卡住时，用户能看到：
  - `library.query` 是否真的慢；
  - 当前是否有 `douban.sync`、`smartTask.scan`、`task.dispatch`；
  - SQLite/WAL 是否过大；
  - store/projection/scheduler 哪个阶段耗时；
  - 最近是否发生 checkpoint、批量写入、慢查询。
- 资源视图不再把所有东西叫 event，而是区分 `flow event`、`diagnostic log`、`metric`。

### 验收标准

- `event` 文案和 API 语义不再把非 flow-node 的数据库维护层叫 event。
- 有全局 diagnostic log / resource log 模块，能保存最近诊断记录。
- `/v1/admin/resources` 或新增诊断 API 能返回 diagnostic log / metric。
- Admin Web 能展示 diagnostic log / metric，至少能看到 storage / sqlite / wal / projection / scheduler 相关记录。
- `library.db-wal`、`tasks.db-wal` 文件大小能在诊断信息中看到。
- `libraryStore.queryItems`、`checkpointWal`、`taskStore` 关键查询和写入有耗时记录。
- 当 `/v1/library?limit=50` 很快但页面仍卡时，诊断信息能说明不是 `library.query` 慢，并显示其他资源消耗来源。
- 不影响 v2.6 已有五类 runtime event：`library.query`、`douban.sync`、`strategy.run`、`smartTask.scan`、`task.dispatch`。
- 单测通过，Admin Web build 通过。
- 按标准流程部署生产，并用生产媒体库页面卡顿场景验证诊断能力。

### 长程目标提示词

```text
/goal 推进 ShelfDeck v2.6.1：Diagnostic Log 版本。

目标：
在 v2.6 已经具备 flow/runtime event 可观测性的基础上，固定 event 语义：event 是 flow 中的 node，不是 log。补齐全局 diagnostic log / resource metric，用来解释 SQLite/WAL、store、projection、scheduler tick 等非 flow-node 的系统层资源消耗。

边界：
1. 本轮不重构 task 业务语义。
2. 本轮不改变 flow/event 业务模型。
3. 本轮不把数据库维护、SQLite/WAL、projection build、scheduler tick 叫 event。
4. 本轮不清理生产数据、不删除历史任务、不改变危险文件操作。
5. 本轮只做 v2.6.1，完成后部署和验收，不继续推进 v2.7。

必须完成：
- 阅读 AGENTS.md、docs/v2/DEBUG_WORKFLOW.md、docs/v2/PRODUCTION_DEPLOYMENT.md、docs/v2.5/V2_6_TO_V3_ROADMAP.md。
- 排摸现有 activityLog、task logs、logger、runtimeResourceTracker、resourceProjection、libraryStore、taskStore、scheduler、Admin Web 资源页。
- 设计并实现轻量全局 diagnostic log / resource metric 模块。
- 明确 API/UI 语义：flow event、diagnostic log、metric 分开展示，不混叫 event。
- 覆盖 libraryStore.queryItems、libraryStore.updateItems、libraryStore.replaceSubLibraryItems、libraryStore.checkpointWal、taskStore 关键查询/写入、resourceProjection.buildResourceView、scheduler.tick。
- 记录 SQLite/WAL 指标：library.db、library.db-wal、tasks.db、tasks.db-wal size，checkpoint 耗时，查询/写入行数。
- 对慢操作标记 slow/failed/done。
- `/v1/admin/resources` 或新增诊断 API 返回 diagnostic log / metric。
- Admin Web 资源/诊断页面展示 storage/sqlite/wal/store/projection/scheduler 诊断信息。
- 增加必要测试。
- 构建并按标准流程部署到 NAS。
- 用生产环境验证：当媒体库页卡住但 library.query 很快时，诊断信息能指出非 library.query 的资源消耗来源。

验收：
v2.6.1 通过的标志是：event 语义保持干净，仍然代表 flow node；同时系统可以通过 diagnostic log / metric 解释 SQLite/WAL、store、projection、scheduler 等非 flow-node 的卡顿来源。
```

## v2.7 - Task / Flow 语义收正版

目标：让任务从 `actionType` 驱动，转向 lifecycle bridge + flow + event。

### 范围

- 新创建 task 具备 bridge 语义：`metadata`、`optimize`、`archive`。
- `transcode`、`upgrade`、`delete`、`scrape` 逐步变成 flow direction / operation kind，而不是 task 的唯一身份。
- TaskAdmission 管准入准出。
- FlowPlanner 在 task 准入时确定 flow。
- Event 承载执行、失败、重试、中断、暂停、恢复。
- Resource scheduler 开始按 event 资源类型调度。
- 保持 v2 用户能力不退化。

### 用户视角 Before / After

Before：

- 任务中心看到的是转码、洗版、删除、刮削等 action。
- 用户不容易理解任务与媒体生命周期的关系。
- 失败、暂停、恢复、重试更多依赖 task 状态和日志解释。

After：

- 任务中心能看出这个媒体正在跨哪个生命周期阶段：补元数据、优化、归档。
- 用户点击“转码/洗版/删除/刮削”仍保留原意图，但内部表达为 task + flow input。
- task detail 能看到 flow plan 和 event history。
- 失败、暂停、恢复、重试能在 event 层解释。

### 验收标准

- 用户点“转码”，内部创建 optimize task，flow direction 是 transcode。
- 用户点“洗版”，内部创建 optimize task，flow direction 是 upgrade。
- 元数据缺失 item 不能直接 optimize，只能进入 metadata bridge。
- 新创建任务有明确 bridge：`metadata`、`optimize`、`archive`。
- 自动任务仍走统一 TaskAdmission。
- FlowPlanner 能在任务准入时确定 flow。
- task detail/API/Admin Web 能展示 bridge、flow plan、event history。
- 重试、中断、暂停、恢复在 event 层留下清晰记录。
- Resource scheduler 开始按 event 资源类型做调度决策。
- task management 只负责任务准入准出和状态推进。
- 刮削、转码、洗版、删除、手动启动、自动入队都能跑。

### 长程目标提示词

```text
/goal 推进 ShelfDeck v2.7：Task / Flow 语义收正版。

目标：
在 v2.6 已具备 event/resource 可观测性的基础上，收正任务模型。任务不再只是 v2 actionType，而是生命周期阶段之间的 bridge；flow 决定任务内部事件编排；event 承载具体执行、资源、失败、重试和中断。

边界：
1. 本轮只推进 v2.7，不做 v3.0 数据模型完全换代。
2. 保持 v2 用户可见能力不退化。
3. 生产文件 mutation 行为必须保持原有安全边界。
4. 不做 desktop / worker 重构，除非 service 兼容必须调整。

必须完成：
- 基于 v2.6 代码排摸 taskScheduler、taskAdmission、flow executors、resourceProjection、taskStore。
- 为新创建 task 增加 bridge 语义：metadata、optimize、archive。
- 将 transcode、upgrade、delete、scrape 解释为 flow direction / operation kind，而不是 task 的唯一身份。
- 实现或补齐 FlowPlanner：任务准入时确定 flow。
- task detail/API/Admin Web 能展示 bridge、flow plan、event history。
- 重试、中断、暂停、恢复在 event 层留下清晰记录。
- Resource scheduler 开始按 event 资源类型做调度决策，task management 只负责任务准入准出和状态推进。
- 保持手动任务和自动任务均走 TaskAdmission。
- 增加覆盖 metadata、optimize、archive、手动转码、手动洗版、元数据缺失拦截、失败事件的测试。
- 构建、部署、生产验证。

验收：
v2.7 通过的标志是：用户仍能完成原来的转码、洗版、刮削、删除，但系统内部已经能用 task bridge、flow、event 解释任务为什么发生、如何执行、在哪里失败、能否重试。
```

## v3.0 - 数据模型与产品语义成型版

目标：让 v3 模型成为系统事实，而不是 v2 兼容层上的补丁。

### 范围

- media item lifecycle 正式落库。
- task / flow / event 建立明确 SQL 结构。
- SQL facts / runtime state / projections 分层。
- 查询、调度、恢复、Admin Web 依赖的核心字段从 `payload_json` 平铺出来。
- Resource scheduler 以 event 为调度单位。
- Admin Web 围绕 lifecycle、metadata、optimization、archive、flow、event、resource 重组。
- v2 数据支持 dry-run 迁移或兼容导入。
- 生产部署可回滚。

### 用户视角 Before / After

Before：

- 媒体库字段、任务字段、资源字段仍有 v2 历史痕迹。
- 许多业务状态靠 payload 或运行时推导。
- Admin Web 能用，但语义还不是完整 v3。

After：

- 媒体库明确显示 lifecycle、metadata、optimization、archive。
- 用户能知道哪些媒体已处理完，哪些卡在元数据，哪些待优化，哪些归档失败。
- 任务中心展示 bridge、flow、event。
- 资源页解释当前资源被哪些 event 占用。
- 诊断页能展示外部依赖、失败 event、资源瓶颈。
- 系统重启、失败、重试、迁移都能被解释和恢复。

### 验收标准

- media item lifecycle 正式落库：`discovered/ingested/metadata_ready/optimized/archived`。
- task、flow、event 有独立事实表或明确 SQL 结构。
- 查询、调度、恢复、Admin Web 依赖的核心字段不再藏在 `payload_json`。
- facts / runtime state / projections 分层明确。
- resource scheduler 以 event 为调度单位。
- Admin Web 媒体库改为 lifecycle、metadata、optimization、archive 语义。
- 任务中心改为 bridge、flow、event 语义。
- 资源视图改为 event/resource 语义。
- 诊断页能展示外部依赖、失败 event、资源瓶颈。
- v2 生产数据可以迁移或兼容导入，且有 dry-run。
- 生产部署可回滚。
- 关键 v2 能力仍可用：媒体库管理、策略、豆瓣、成人刮削、转码、洗版、删除安全边界、任务中心、资源视图。

### 长程目标提示词

```text
/goal 推进 ShelfDeck v3.0：数据模型与产品语义成型版。

目标：
在 v2.7 已经收正 task / flow / event 语义后，将 v3 模型正式变成 ShelfDeck 的数据事实和产品语义。媒体生命周期、任务桥梁、flow 编排、event 历史、资源调度、Admin Web 展示都要以 v3 模型为中心。

边界：
1. 本轮目标是 service Docker/Admin Web。
2. desktop 与 worker 不做完整重构，除非 service API 兼容必须调整。
3. 生产部署必须可回滚。
4. v2 生产数据迁移必须先 dry-run，不得直接破坏生产数据。
5. 保留 v2 核心用户能力，但内部模型可以彻底收口到 v3。

必须完成：
- 排摸 v2.7 当前数据结构、payload_json 使用点、Admin Web 字段语义。
- 设计并实现正式 SQL facts / runtime state / projections 分层。
- media item lifecycle 正式落库。
- task、flow、event 建立明确 SQL 结构。
- 将查询、调度、恢复、Admin Web 依赖的核心字段从 payload_json 平铺出来。
- resource scheduler 以 event 为调度单位。
- Admin Web 媒体库改为 lifecycle、metadata、optimization、archive 语义。
- 任务中心改为 bridge、flow、event 语义。
- 资源视图改为 event/resource 语义。
- 诊断页能展示外部依赖、失败 event、资源瓶颈。
- 提供 v2 数据 dry-run 迁移或兼容导入方案。
- 提供生产部署和回滚方案。
- 增加 service、API、Admin Web、迁移、恢复、调度相关测试。
- 构建、部署、生产验证。

验收：
v3.0 通过的标志是：ShelfDeck 不再依赖 v2 actionType/payload_json 混合模型来解释业务。用户能在 Admin Web 里清楚看到媒体生命周期、任务桥梁、flow 执行、event 历史和资源占用，并且系统重启、失败、重试、迁移都能被解释和恢复。
```

## 推荐执行方式

1. 开启 v2.6 长程目标。
2. v2.6 完成后部署生产、验收资源归因能力，并固化分支或 tag。
3. 开启 v2.7 长程目标。
4. v2.7 完成后部署生产、验收 task/flow/event 语义，并固化分支或 tag。
5. 开启 v3.0 长程目标。
6. v3.0 完成后执行迁移 dry-run、生产部署、回滚演练和最终验收。

每个版本都应在开始前重新读取本文件，并把上一版本的实际交付结果作为新的基线，而不是沿用压缩上下文中的模糊记忆。
