# ShelfDeck v3.1 Progress

本文记录 v3.1 “用户视角可用版”的增量切片。v3.1 只有在 A/B/C/D 全部满足后才能标记完成；本文中的单轮记录只代表对应切片完成。

## 2026-06-30 Slice 1: media item business flow decision

### 对应标准

- A1: 新增统一用户视角业务决策结果 `businessFlowDecision`。
- A4: 手动入口继续经过同一 policy / TaskAdmission，普通媒体 scrape、缺 metadata 的 optimize/archive 等阻断原因保持一致。
- B2: 媒体管理页开始以 `allowedOperations` / `blockedReasons` 决定按钮可见性和不可用解释。
- C1: 媒体列表决策只读取 SQLite-backed media projection 和 active task projection，不依赖全量 task history 扫描。

### 用户视角判定

用户在媒体管理页每个 item 上应能看到：

- 当前 `lifecycleStage`、`metadataStatus`、`optimizationStatus`、`archiveStatus`。
- 下一座业务桥 `nextBridge`。
- 推荐操作 `recommendedOperation`。
- 可执行操作 `allowedOperations`。
- 不可执行操作 `blockedOperations` / `blockedReasons`。
- 若已有未结案任务，看到 `activeTaskBridge`、`activeFlowOperation` 和 active task 摘要。

用户能做什么：

- 只对 policy 允许的 `delete` / `transcode` / `upgrade` 创建任务。
- 成人条目继续通过成人 rescrape 入口进入 scrape 判定。

用户不能做什么，为什么：

- 普通媒体 `scrape` 被阻断，原因是 `scrape_not_supported_for_standard_media`。
- metadata 不完整的 optimize/archive 被阻断，原因是 `metadata_missing` 并返回缺失原因。
- 已有 active task 的 item 被阻断，原因是 `active_task_exists`。
- 原盘 upgrade 被阻断，原因是 `upgrade_not_supported_for_disc_like_source`。

后端事实来源：

- 媒体 facts: `library.db` projection，经 `mediaLibraryService.getLibrary()` 装饰 lifecycle/metadata/optimization。
- active task facts: `taskStore.loadTasks({ includeHistory: false })`。
- 决策模块: `media-service/src/businessFlowPolicy.js`。
- TaskAdmission: `media-service/src/taskAdmission.js` 作为薄封装调用同一 policy。

API / projection：

- `GET /v1/library`
- `GET /v1/library/queries/manage`
- `GET /v1/library/items/:itemId`

失败/空状态展示：

- 行内按钮被隐藏或替换为阻断原因。
- active task 会显示 bridge / flow operation。
- 后端仍在 `/v1/tasks` 返回 `TASK_ADMISSION_REJECTED`，前端读取标准 `{ error: { code, message } }`。

### 生产验收

- 首次部署 tag: `v3.1.0-policy-decision-20260630`。
- 浏览器验收发现问题：普通媒体 `recommendedOperation=keep` 且已闭环时，`nextBridge` 会从 allowed operation fallback 成 `optimize`，页面可能误导用户继续点击转码/洗版。
- 修复：`businessFlowDecision.nextBridge` 不再从 fallback allowed operation 派生；前端对 `keep` 推荐不再 fallback 为可执行按钮。
- 最终部署 tag: `v3.1.0-policy-decision-20260630-r2`。
- 生产 URL: `http://192.168.12.230:18080`。
- 检查页面：
  - Dashboard / 首页：服务健康、媒体库数量、空间统计、当前任务桥、失败桥梁、自动 flow operation 可见。
  - 媒体管理页：item 行展示 lifecycle、metadata、adult scrape 状态、next bridge；普通 keep item API 返回 `nextBridge=null`；普通 scrape blocked reason 为 `scrape_not_supported_for_standard_media`。
  - 任务中心：列表以桥梁 / Flow 操作 / 阶段 / 来源 / 优先级展示，仍有 destructive 控制按钮但未点击。
  - Resource View：展示 resource bucket、等待/运行、失败 event、外部依赖、Background I/O Guard、SQLite storage metrics 和慢查询诊断。
  - 任务调度页：展示自动 flow operation allow-list 和子库任务执行方式。
- 浏览器验收结论：本切片涉及的媒体 item 决策、按钮可用性解释、active task/resource 诊断入口已在生产可见；未执行 delete/cancel/真实任务创建等破坏性操作。

### 尚未满足

- Dashboard 的 v3.1 B1 体检指标仍未完整包含全部完成标准，如等待确认数量、主要阻塞原因聚合等。
- 任务中心确认台、retry/resume/cancel 语义仍需事件化和页面解释。
- Resource View 还未覆盖所有外部依赖和确认点的产品化解释。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 2: Dashboard business health summary

### 对应标准

- B1: Dashboard 增加“媒体库健康”摘要，用户第一眼看到媒体库闭环、metadata、优化、确认、失败和空间回收状态。
- C1: Dashboard 健康摘要来自 SQLite 聚合查询，不拉完整媒体 payload 或完整任务列表。
- C2: Dashboard 不再显示任务列表卡片；任务详情继续由任务中心承接，首页只保留入口级健康信号。

### 用户视角判定

用户在 Dashboard 应能看到：

- 总条目、闭环比例、未闭环媒体数。
- metadata 缺失数和等待优化数。
- 等待确认、失败桥梁、当前非终态任务桥的计数。
- 预计可回收空间。
- 主要健康信号，如失败任务桥、等待确认、metadata 未完成、等待优化、未闭环媒体、自动 flow 操作未启用。
- 后台自动 flow allow-list。
- “最近事件”时间线，用来感知系统正在同步、计算或自动入队。

用户不会在 Dashboard 处理：

- 具体任务列表。
- 最近失败任务明细。
- 重试、暂停、取消、确认等任务操作。

这些仍由任务中心作为唯一任务明细入口承接，避免 Dashboard 变成半个任务中心。

后端事实来源：

- 媒体健康 facts: `libraryStore.queryDashboardMediaStats()`，从 `library.db` 的 lifecycle / metadata / optimization projection 聚合。
- 任务健康 facts: `taskStore.queryDashboardTaskStats()`，从 `tasks.db` 的 status / bridge / operation projection 聚合。
- API: `GET /v1/admin/dashboard/health`。
- 空间数据仍来自 `GET /v1/space-stats` 的轻量 SQLite rows。
- 最近事件仍来自 `GET /v1/activity-log`，前端命名为“最近事件”而不是“实时日志”。

API / projection：

- `GET /v1/admin/dashboard/health`
  - `status`: `green | yellow | red`
  - `media`: total / closed / open / metadataIncomplete / pendingOptimization / archive-like / pending bridge / missing reason aggregates
  - `tasks`: total / active / awaitingConfirmation / failed / done / bridge / operation / source aggregates
  - `automation.enabledOperations`
  - `diagnostics.signals`

失败/空状态展示：

- 健康摘要加载中显示“加载业务健康指标中...”。
- 无阻塞时显示“暂无明显阻塞”。
- 无最近事件时显示“暂无最近事件”。

### 本地验收

- `npm test`: 214 pass。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 生产验收

- 首次部署 tag: `v3.1.0-dashboard-health-20260630`。
- 浏览器验收后按产品语义做文案修正：Dashboard 健康摘要中的“当前任务桥”改为“活动流程”，避免用户误解为任务列表卡片。
- 最终部署 tag: `v3.1.0-dashboard-health-20260630-r2`。
- 镜像 SHA-256: `2505f2bc9895a49d293834c7e5f68ed646ff69bf2cbd4e413159c995f2ba8371`。
- 生产 URL: `http://192.168.12.230:18080`。
- 部署检查：
  - `/v1/health` 恢复 `green`。
  - 运行镜像为 `markmahoro/shelfdeck:v3.1.0-dashboard-health-20260630-r2`。
  - adult mount 正常。
  - scraper module 加载正常。
- API 检查：
  - `/v1/admin/dashboard/health` 返回真实生产聚合：媒体总数、闭环/未闭环、metadata 缺失、等待优化、任务状态、自动 flow allow-list、主要信号和 SQLite storage metrics。
- 浏览器检查：
  - `添加媒体库` 按钮和添加媒体库向导仍在 Dashboard。
  - `媒体库健康` 卡片可见。
  - `最近事件` 卡片可见，用于表达系统正在同步、计算或自动入队。
  - 旧任务列表卡片已移除：页面不再出现 `当前任务桥` / `任务桥提醒` / `实时日志` 标题。
  - 未点击删除、移除、创建任务、确认任务等生产破坏性或写入操作。

### 尚未满足

- 任务中心确认台、retry/resume/cancel 语义仍需事件化和页面解释。
- Resource View 还未覆盖所有外部依赖和确认点的产品化解释。
- 后端业务逻辑仍需继续推进，下一轮优先关注 TaskAdmission / lifecycle 推进 / task event 语义等核心链路。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 3: manual bridge intent admission

### 对应标准

- A2: 手动任务创建开始支持用户视角的 bridge intent，而不只接受 v2 `actionType`。
- A4: intent 解析后仍进入同一 `TaskAdmission` / `BusinessFlowPolicy`，不会绕过 metadata、active task、普通媒体 scrape、原盘 upgrade 等业务规则。
- C1: intent 准入仍使用当前 item facts 和 active task projection，不读取完整 task history。

### 用户视角判定

后端现在接受两类手动任务输入：

- 旧兼容输入：`{ itemId, actionType }`。
- v3 intent 输入：`{ itemId, bridgeKind, preferredOperation? }` 或 `{ itemId, intent: { bridgeKind, preferredOperation? } }`。

后端解析规则：

- `bridgeKind=metadata` 只允许 `scrape`。
- `bridgeKind=optimize` 允许 `transcode` / `upgrade`；如果没有 `preferredOperation`，只采用 item 当前推荐方向。
- `bridgeKind=archive` 只允许 `delete`；如果没有明确 `preferredOperation=delete` 或 item 当前推荐方向为 `delete`，后端返回 validation error，不替用户猜测破坏性动作。
- bridge 与 operation 不匹配时返回 `400 VALIDATION_ERROR/preferred_operation_bridge_mismatch`。
- intent 含糊且无法从 item 推荐方向安全解析时返回 `400 VALIDATION_ERROR/preferred_operation_required`。

任务创建成功后：

- `actionType` 仍保存解析后的兼容 operation，保证现有 scheduler / executor 不被破坏。
- `taskBridge` / `flowPlan` 仍由同一 flow plan 固化。
- `requestedIntent` 写入 task payload 和 `task.created` event，后续任务中心可以解释用户原始意图。

后端事实来源：

- intent 解析：`businessFlowPolicy.resolveManualOperationIntent()`。
- 手动准入：`taskAdmission.canCreateManualIntent()`。
- API: `POST /v1/tasks`。

失败/空状态展示：

- 缺少 `actionType` 且缺少 bridge intent 时继续返回 `400 VALIDATION_ERROR/missing_task_intent`。
- 非法 `actionType` 继续返回 `400 VALIDATION_ERROR/invalid_action_type`。
- 普通媒体 `metadata/scrape` intent 仍由 admission 返回 `409 TASK_ADMISSION_REJECTED/scrape_not_supported_for_standard_media`。

### 本地验收

- `node --test test/api-inject.test.js`: 100 pass。
- `npm test`: 217 pass。

### NAS 生产验收

- Image: `markmahoro/shelfdeck:v3.1.0-manual-intent-20260630`。
- SHA-256: `9f1209c46be195b1622616901179899b68ac3fbf82f5f7a00dc9ed86ccfa3a04`。
- 部署后 `/v1/health` 返回 `green`。
- 运行镜像 tag 校验通过。
- 无副作用业务校验：`POST /v1/tasks` with `bridgeKind=archive` + `preferredOperation=transcode` 返回 `400 VALIDATION_ERROR/preferred_operation_bridge_mismatch`，未创建生产任务。

### 尚未满足

- 任务中心还没有把 `requestedIntent` 产品化展示为确认台上下文。
- retry/resume/cancel 语义仍需事件化和页面解释。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 4: task control state projection

### 对应标准

- A5: 任务控制语义开始从按钮分支提升为后端可解释投影，覆盖确认、暂停、恢复、中断、失败和取消/移除。
- B3: 任务中心可以从 API 直接读取 `controlState`，不再只靠 `status/actionType` 猜测按钮含义。
- B4: `awaiting_user_confirm` 任务暴露 `confirmation` summary，包括 gate、message、options、resumePoint 和确认后效果。
- C1: 任务列表的 `controlState` 只依赖 task current facts；只有单任务详情按需读取最近 event。

### 用户视角判定

后端现在给任务 response 增加 `controlState`：

- `state`: `ready_to_start` / `queued` / `running` / `paused` / `interrupted` / `awaiting_confirmation` / `terminal` 等用户可理解状态。
- `actions.execute|pause|confirm|cancel|retry`: 每个动作都有 `enabled`、`reason`、`effect`、`label`、`method`、`endpoint`，让前端能说明“为什么可点/为什么不可点/点了会发生什么”。
- `confirmation`: 解释确认 gate、确认文案、候选项和确认后回到哪个 `resumePoint`。
- `recovery`: 解释当前是否可恢复、从哪里恢复、下一步应走 `execute` / `confirm` / `inspect_events` / flow-specific recovery。
- `latestEvent`: 详情页附带最近 task event 摘要，方便任务中心定位最近发生的事实。

后端事实来源：

- 当前 task facts：`status`、`phase`、`resumePoint`、`retryCount`、`approval`、`taskBridge`、`flowPlan`。
- Event facts：详情页通过 `task_events` 最近记录补充 `latestEvent`。
- 投影模块：`taskControlPolicy.buildTaskControlState()`。

覆盖入口：

- `POST /v1/tasks` 创建任务返回 `controlState`。
- `GET /v1/tasks` / `GET /v1/tasks/:id` 返回 `controlState`。
- `PATCH /v1/tasks/:id` 确认后返回 `controlState`。
- `POST /v1/tasks/:id/actions/execute` 和 `/pause` 返回 `controlState`。
- `GET /v1/admin/tasks` / `GET /v1/admin/tasks/:id` 返回 `controlState`。

### 本地验收

- `node --test test/api-inject.test.js`: 101 pass。
- `npm test`: 218 pass。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### NAS 生产验收

- 首次部署 tag: `v3.1.0-task-control-20260630`。
- 生产 API 验收发现问题：终态 `done` 任务虽然只允许“移除记录”，但 `primaryAction` 被选成 `cancel`，容易让任务中心误导用户理解为“取消任务”。
- 修复：终态任务的 `primaryAction` 不再选择 `remove_task_history_record`；该能力仍保留在 `actions.cancel`，label 为“移除记录”。
- 最终部署 image: `markmahoro/shelfdeck:v3.1.0-task-control-20260630-r2`。
- SHA-256: `1cab349d688bb147f91650818d42e1f0ed39d6c2f3b939c874b7c9310ad63964`。
- 部署后 `/v1/health` 返回 `green`。
- 运行镜像 tag 校验通过。
- API 检查：
  - 执行中 scrape task 返回 `controlState.state=running`、`primaryAction=pause`，`actions.pause.enabled=true`。
  - 终态 done scrape task 返回 `controlState.state=terminal`、`primaryAction=""`，`actions.cancel.effect=remove_task_history_record`、`actions.cancel.label=移除记录`。
- 浏览器检查：
  - Dashboard：首页仍展示 `媒体库健康`、`最近事件` 和 `添加媒体库` 入口；不恢复任务列表卡片。
  - 任务中心：执行中任务展示“暂停 / 取消任务 / 详情”，终态任务展示“刮削报告 / 修正番号 / 详情 / 移除记录”，页面未崩溃。
  - 媒体管理页：lifecycle、metadata、刮削状态、下一步和任务入口仍正常渲染。
  - Resource View：resource bucket、event、SQLite storage、Background I/O Guard 仍正常渲染。
  - 任务调度页：任务执行方式、审批策略、并发数、后台自动入队 allow-list 和优先级配置仍正常渲染。
  - 未点击删除、移除、取消、确认、创建任务等生产破坏性或写入操作。

### 尚未满足

- 任务中心 UI 还没有把 `controlState` 产品化为操作区/确认台。
- `failed_hard` 的通用 retry endpoint 仍未定义；当前投影会明确返回 `no_generic_retry_endpoint`，需要后续按 flow-specific recovery 收口。
- 确认台仍未把 `confirmation` / `recovery` 产品化成用户可操作的上下文。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 5: failed task recovery contract

### 对应标准

- A5: `failed_hard` / `failed_soft` 任务的 retry 从“无通用入口”收口为后端 recovery contract。
- B3: 任务中心可以从 `controlState.actions.retry` 读取是否可重试、不可重试原因、重试 endpoint 和重试效果。
- C1: 失败任务列表投影仍只依赖 task current facts；retry 执行时才检查同 item active task 冲突。
- D1: retry 会写入 task event，任务详情能解释失败任务被重新排队的事实。

### 用户视角判定

后端现在对失败任务给出明确恢复语义：

- 如果任务处于 `failed_hard` / `failed_soft`，且 `actionType` 有 flow recovery contract，`resumePoint` 属于该 flow 的已知恢复点，`retryCount` 未达到上限，则 `controlState.actions.retry.enabled=true`。
- retry endpoint 为 `POST /v1/tasks/:id/actions/retry`。
- 成功 retry 后，同一个 task 回到 `queued`，`manualExecuteRequested=true`，`retryCount + 1`，`phase=null`，`progress=0`。
- 若原 task 有 `resumePoint`，则从该恢复点重新排队；若没有，则补齐对应 flow 的默认起点，如 `transcode_precheck`、`upgrade_precheck`、`scrape_precheck`。
- retry 不会新建 task，也不会绕过同 item active task 去重；同 item 已有 active task 时返回 `409 TASK_CONFLICT`。
- retry 达到上限、未知 flow 或未知 resumePoint 时返回 `409 TASK_RECOVERY_REJECTED`。

事件语义：

- retry 成功会写 `task.retry_requested`。
- `retryCount` 增加仍由 `taskStore.updateTask()` 写 `task.retry_recorded`。

后端事实来源：

- 当前 task facts：`status`、`actionType`、`resumePoint`、`retryCount`、`itemId`。
- 冲突检查：`taskStore.loadTasks({ includeHistory: false })`。
- 投影/判定模块：`taskControlPolicy.buildTaskRecoveryPlan()`。

覆盖入口：

- `GET /v1/tasks` / `GET /v1/tasks/:id`
- `GET /v1/admin/tasks` / `GET /v1/admin/tasks/:id`
- `POST /v1/tasks/:id/actions/retry`

### 本地验收

- `node --test test/api-inject.test.js`: 103 pass。
- `npm test`: 220 pass。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产 API/浏览器验证待用户明确允许生产部署后执行。
- 任务中心 UI 还没有把 `controlState.actions.retry` 产品化为操作区按钮和失败恢复说明。
- 确认台仍未把 `confirmation` / `recovery` 产品化成用户可操作的上下文。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 6: task center control-state UI

### 对应标准

- B3: 任务中心操作区开始消费后端 `controlState.actions`，不再只按 `status/actionType` 自行推断启动、暂停、重试、确认、取消/移除。
- B4: 任务详情页展示 `confirmation` / `recovery` 上下文，用户能看到等待确认、恢复点、最近 event 和动作效果。
- D1: 任务详情页展示 task event 历史和 `task.retry_requested` 文案，失败恢复不再只能靠日志猜。

### 用户视角判定

任务中心列表现在会：

- 从 `controlState.actions` 渲染 `execute` / `pause` / `retry` / `confirm` / `cancel` 控制按钮。
- 保留业务专属入口，如刮削报告、修正番号、任务详情。
- 在“来源/审批/优先级”列显示后端控制提示，如“从失败点重新排队同一个任务”“等待确认后才能继续”等。
- 终态任务的 `remove_task_history_record` 显示为“移除记录”，不再被混同成取消运行任务。

任务详情页现在会：

- 展示“控制状态”卡片：用户态状态、恢复点、重试次数、恢复建议、确认点和最近 event。
- 展示每个控制动作的可用性、不可用原因和点击效果。
- 对特殊确认点继续保留既有专门 UI，如转码替换对比、洗版候选选择、洗版替换对比。

前端事实来源：

- `MediaTask.controlState`
- `controlState.actions`
- `controlState.confirmation`
- `controlState.recovery`
- `controlState.latestEvent`
- `TaskEvent` history

覆盖入口：

- 任务中心列表操作列。
- 任务中心详情弹窗。
- `tasks.retry()` client 方法。

### 本地验收

- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。
- `npm test`: 220 pass。

### 尚未满足

- 本切片尚未部署 NAS；生产浏览器验收待用户明确允许生产部署后执行。
- 任务中心控制区已接入 `controlState`，但还没有把所有确认点做成更统一的确认台布局；特殊确认卡仍沿用既有实现。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 7: task center confirmation console

### 对应标准

- B4: 任务详情页的确认上下文进一步统一到 `controlState.confirmation`，不再主要依赖 `status/resumePoint` 分支解释确认点。
- B3: 任务中心的确认动作、确认文案、恢复点和确认后效果在同一个“确认台”中呈现。
- D1: 特殊确认点继续保留具体业务卡片，但入口说明和 gate 判定优先读取后端投影。

### 用户视角判定

任务详情页现在会：

- 通过 `controlState.confirmation.required` 判定任务是否等待确认。
- 通过 `controlState.confirmation.gateId` / `resumePoint` 解释确认点。
- 在“确认台”中展示确认消息、gate、恢复点、确认后的效果和可选项。
- 普通确认点可直接在确认台完成确认。
- 洗版候选选择、转码替换确认、洗版替换确认继续使用专门卡片，但它们的显示条件优先读取 `controlState.confirmation`。

兼容策略：

- 旧 task 若没有 `controlState`，仍以 `status=awaiting_user_confirm`、`approval.gateId`、`resumePoint` 作为后备判断。
- 这保证任务中心可以跨旧记录和新投影平滑工作。

### 本地验收

- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。
- `npm test`: 220 pass。

### 尚未满足

- 本切片尚未部署 NAS；生产浏览器验收待用户明确允许生产部署后执行。
- 确认台已统一上下文，但仍需要生产数据验证不同 gate 的实际渲染效果。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 8: task intent context in task center

### 对应标准

- A2: 手动 bridge intent 不只停留在创建 API，任务中心详情页开始展示用户原始意图。
- B3: 用户在任务中心能看到“我当初想推进哪座桥”和“后端实际解析成哪个 flow 操作”。
- B4: 确认台、恢复建议和 event 历史旁边有用户意图上下文，降低确认/重试时的误判。

### 用户视角判定

任务详情页现在会展示“用户意图与解析结果”：

- 用户提交：创建方式、目标桥梁、偏好操作。
- 后端解析：实际桥梁、实际 flow 操作、flow direction。
- 若旧任务没有 `requestedIntent`，仍用 `taskBridge` / `flowPlan` 作为历史兼容解释。
- 文案明确说明：任务执行、确认和恢复以解析结果为准；用户原始意图用于解释这条任务为什么存在。

前端事实来源：

- `MediaTask.requestedIntent`
- `MediaTask.taskBridge`
- `MediaTask.flowPlan`

### 本地验收

- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。
- `npm test`: 220 pass。

### 尚未满足

- 本切片尚未部署 NAS；生产浏览器验收待用户明确允许生产部署后执行。
- 仍需在生产任务中心用真实手动 intent / 旧 actionType 任务检查展示效果。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 9: task action server-side contract

### 对应标准

- B3: `controlState.actions` 不再只是前端按钮提示，而成为任务 action endpoint 的服务端业务约束。
- B4: 用户确认、暂停、恢复、取消的入口语义和后端状态转换同源，避免直接调用 API 绕过前端状态。
- A5: 失败恢复、暂停恢复和运行中取消继续保留现有 flow contract，但入口先经过统一控制策略。

### 用户视角判定

后端现在会先读取 `taskControlPolicy.getTaskAction(task, actionName)`：

- `POST /v1/tasks/:id/actions/execute` 只接受 `controlState.actions.execute.enabled=true` 的任务。
- `POST /v1/tasks/:id/actions/pause` 只接受 `controlState.actions.pause.enabled=true` 的任务。
- `DELETE /v1/tasks/:id` 和 `DELETE /v1/admin/tasks/:id` 只接受 `controlState.actions.cancel.enabled=true` 的任务。
- 不可用动作统一返回 `409 TASK_ACTION_REJECTED`，message 为 `controlState.actions.*.reason`。
- 等待队列中的任务暂停由后端直接落到 `paused`；运行中任务仍交给对应 flow 做清理、停止下载或删除 partial 文件。

这意味着前端按钮灰掉的动作，直接调 API 也不会成功；任务中心展示和后端执行之间不再存在第二套隐形规则。

### 本地验收

- `node --test test/api-inject.test.js`: pass，104 pass。
- `npm test`: pass，221 pass。

### 尚未满足

- 本切片尚未部署 NAS；生产行为待用户明确允许生产部署后执行。
- 本切片只收口 action endpoint 入口，未改 scheduler/flow 内部执行器状态机。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 10: resource failure recovery diagnostics

### 对应标准

- A5: 失败任务能从 event/resource/diagnostic 串到恢复建议，而不只在任务中心单点查看。
- B5: Resource View 的失败 event 开始展示对应 task、资源、恢复状态、恢复点和 diagnostic error。
- C1: Resource View 失败诊断只读取最近失败 event、对应 task current facts 和最近 diagnostic log，不扫描完整 task history。

### 用户视角判定

Resource View 的“失败 event”现在不再只是 event type / resource / time：

- 用户能看到失败关联的媒体或 task。
- 用户能看到失败发生在哪个 resource bucket，如 `local:ffmpeg`。
- 用户能看到恢复状态，如“可重试/重试”，以及 `resumePoint`。
- 如果 diagnostic log 有匹配的 `taskId` / `itemId` / resource，会显示诊断错误摘要。

后端事实来源：

- 失败事件：`taskStore.queryRecentFailureEvents({ pageSize: 20 })`。
- 当前任务事实：`taskStore.getTask(event.taskId)`。
- 恢复建议：`taskControlPolicy.buildTaskControlState(task, { latestEvent })`。
- 资源上下文：event resource facts，缺失时回退 `resourceProjection.resourceForTask()`。
- 诊断摘要：`diagnosticLog.list({ limit: 120 })` 中最近匹配行。

API 契约：

- `GET /v1/admin/resources`
- `diagnostics.failedEvents[]` 保留原 `TaskEvent` 字段，并新增：
  - `task`
  - `resourceContext`
  - `recovery`
  - `controlState`
  - `diagnosticSummary`

前端消费：

- Resource View 的“失败 event”卡片展示恢复状态、下一步动作、恢复点和 diagnostic error。

### 本地验收

- `node --test test/api-inject.test.js`: pass，104 pass。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。
- `npm test`: pass，221 pass。

### 尚未满足

- 本切片尚未部署 NAS；Resource View 生产浏览器验收待统一部署窗口执行。
- Resource View 现在能解释失败恢复，但还没有提供直接跳转任务详情的交互。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 11: restart recovery event semantics

### 对应标准

- A2: service restart recovery 不再只是内部状态修正，而有明确用户视角解释。
- A5: 重启导致的 interrupted、自动重排和恢复失败都进入 task event / diagnostic log。
- B3/B5: 任务中心和 Resource View 能以中文标签展示重启恢复相关事件。

### 用户视角判定

服务重启后，用户现在能通过任务详情 event history 或 Resource View 看到：

- 哪些任务因为服务重启或运行态残留被标记为 `interrupted`。
- 任务原本处于哪个 `status` / `phase` / `resumePoint`。
- 调度器是否把 interrupted task 自动重新排队。
- 自动重排消耗了第几次 `retryCount`。
- 如果重启恢复超过上限，为什么被置为 `failed_hard`。

后端事件语义：

- `task.restart_interrupted`: 启动恢复发现运行态任务，标记为 interrupted。
- `task.restart_recovery_queued`: 调度器把 interrupted task 自动重排为 queued。
- `task.restart_recovery_failed`: interrupted task 重启恢复次数超过上限，转为 failed_hard。

后端事实来源：

- scheduler 当前任务投影：`taskStore.querySchedulerTasks()`。
- 任务事件：`taskStore.appendTaskEvent()`。
- 诊断日志：`diagnosticLog.record()`，scope 为 `scheduler.restartRecovery`。

前端消费：

- Task Monitor event history 增加三类重启恢复事件中文标签。
- Resource View failed event 标签增加三类重启恢复事件中文标签。

### 本地验收

- `node --test test/priority-api.test.js`: pass，12 pass。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。
- `npm test`: pass，222 pass。

### 尚未满足

- 本切片尚未部署 NAS；生产重启恢复事件展示待统一部署窗口执行。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 12: adult rescrape intent response contract

### 对应标准

- A4: 成人 rescrape 作为显式用户入口，不只创建任务，还返回/记录 bridge、operation 和用户意图。
- B3: 任务中心能解释成人重刮任务来自“成人条目重刮入口”，实际 flow 是 metadata/scrape。
- C1: rescrape 仍通过 `TaskAdmission` 和当前 task facts 做 active-task 去重，不读取 heavy payload。

### 用户视角判定

用户从成人条目触发重刮后，API 现在能直接回答：

- 这是用户显式的 metadata bridge 意图。
- 实际创建的是 `scrape` flow operation。
- 当前 task 是否 queued/pending/manual，以及可执行哪些控制动作。
- 后续任务中心能显示创建方式为“成人条目重刮入口”。

后端事实来源：

- 入队：`adultLibraryService.rescrapeItem()` -> `enqueueScrapeTask()` -> `taskAdmission.canCreateTask()`。
- 任务语义：`taskBridge`、`flowPlan`、`requestedIntent`。
- 控制语义：`taskDetailView()` / `taskControlPolicy.buildTaskControlState()`。

API 契约：

- `POST /v1/admin/adult/items/:itemId/actions/rescrape`
- 响应保留 `ok` / `taskId` 兼容字段，并新增：
  - `task`
  - `taskBridge`
  - `flowPlan`
  - `requestedIntent`
  - `controlState`

前端消费：

- `adult.rescrapeItem()` client 类型包含完整任务投影。
- Task Monitor 对 `requestedIntent.intentMode=adult_rescrape` 显示为“成人条目重刮入口”。

### 本地验收

- `node --test test/api-inject.test.js`: pass，104 pass。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。
- `npm test`: pass，222 pass。

### 尚未满足

- 本切片尚未部署 NAS；生产成人重刮入口和任务中心展示待统一部署窗口执行。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 13: task admission rejection business payload

### 对应标准

- A4: 手动任务创建的拒绝结果不再只是旧 action 错误码，而能返回 bridge/operation 语义下的业务阻断原因。
- B2: 媒体管理页或其他前端入口即使误发旧 `actionType`，也能从后端响应读取 `businessFlowDecision.allowedOperations` / `blockedReasons` 来解释按钮不可用。
- C1: admission 拒绝响应只使用当前 item facts 和 active task projection，不加载完整 task history。

### 用户视角判定

用户点击一个当前不能创建任务的入口时，后端现在能直接回答：

- 这次被拒绝的是哪个 operation。
- 具体 blocked reason 是什么，例如 `metadata_missing`、`scrape_not_supported_for_standard_media`、`preferred_operation_bridge_mismatch`。
- 如果是 metadata 不完整，缺哪些 facts。
- 如果有指定入口，例如普通媒体 scrape 不支持，会返回成人 rescrape 支持入口。
- 当前媒体项还有哪些 `allowedOperations`，以及其他 operation 为什么被阻断。

API 契约：

- `POST /v1/tasks`
- 失败响应保留标准 `{ error: { code, message } }`。
- admission / validation / conflict 失败响应新增：
  - `admission`
  - `businessFlowDecision`

后端事实来源：

- `taskAdmission.canCreateManualIntent()`
- `businessFlowPolicy.buildItemDecision()`
- `taskStore.loadTasks({ includeHistory: false })`
- 当前 `mediaLibraryService.getLibraryItem(itemId)` 与 `metadataStatus.resolveMetadataStatus()`

### 本地验收

- `node --test test/api-inject.test.js`: pass，104 pass。

### 尚未满足

- 本切片尚未部署 NAS；生产媒体管理页是否消费新增 payload 待后续 UI/生产验收。
- 本切片收口的是 admission 拒绝解释，不改变 scheduler/flow executor 的执行语义。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 14: Dashboard entry and event feed reshape

### 对应标准

- B1: Dashboard 作为全局状态入口，不再承担任务中心的明细列表职责。
- B3/B5: Dashboard 上的日志卡片转为“系统事件”feed，让用户能感知 refresh、SmartTask、任务和健康检查仍在持续运行。
- B6: 添加媒体库入口保持在 Dashboard，并上提到首屏关键入口，不只藏在媒体库配置卡片内部。

### 用户视角判定

Dashboard 现在更明确地回答三件事：

- 系统整体是否稳定。
- 下一步应该去哪里处理：任务中心、资源视图、媒体库。
- 系统最近是否在动作：通过 event feed 展示最近后台事件。

产品取舍：

- Dashboard 不复制任务中心的任务列表；任务状态数字只保留在健康聚合中，明细处理交给任务中心。
- “最近事件”不再按运行日志来理解，而是作为轻量 event feed，按来源给出媒体库、豆瓣、策略、自动入队、任务、健康等标签。
- “添加媒体库”入口上提到关键入口条，并保留媒体库卡片内的按钮，避免用户误以为添加能力被删除。

前端消费：

- `DashboardActionStrip`
- `DashboardEventFeed`
- `activityLog.getRecent(15)`

### 本地验收

- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产浏览器中的 Dashboard 布局和点击路径待统一部署窗口验收。
- Dashboard 入口已更清晰，但任务中心仍需要继续补强用户可处理的确认/恢复工作流。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 15: Media Manage batch admission alignment

### 对应标准

- A4: 媒体管理页手动任务创建入口统一按 `businessFlowDecision.allowedOperations` 推进，不再从旧 `recommendedAction` 直接创建任务。
- B2: 批量操作只选择当前页确实可创建任务的条目；被 blocked、keep、缺业务决策或已有 active task 的行不会混入批量创建。
- C1: 前端批量判断只消费媒体列表里的 business flow projection 和 active task projection，不额外拉全量 task history。

### 用户视角判定

媒体管理页现在的批量操作更接近用户预期：

- “选择可创建”只勾选当前页可创建任务的条目。
- 侧栏显示已选条目里有多少真正可创建，以及当前页可创建数量。
- 不可批量创建的行 checkbox 直接禁用，并通过 title 给出原因。
- 单行和批量创建都要求后端返回明确 `businessFlowDecision.allowedOperations`，缺失时不会 fallback 到旧 `recommendedAction`。
- 创建任务请求使用 allowed operation 的 `bridgeKind` + `preferredOperation`，而不是只发旧 `actionType`。

前端消费：

- `MediaManagePage.preferredTaskAction()`
- `MediaManagePage.allowedOperationForItem()`
- `MediaLibraryManageRow.preferredTaskAction()`
- `taskApi.createByIntent({ itemId, bridgeKind, preferredOperation })`

### 本地验收

- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产媒体管理页批量选择和任务创建待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 16: shared media action policy helper

### 对应标准

- A4: 媒体管理页单行按钮和批量按钮共用同一份 action admission 前端判定，不再各自复制 `allowedOperations` 解释逻辑。
- B2: blocked reason、缺业务决策、推荐 operation 和 allowed operation 的展示/选择规则保持一致，减少用户看到“行上不能点、批量又能选”这类漂移。
- C1: 共享 helper 仍只消费当前媒体 row projection，不引入额外 API 或 history 查询。

### 用户视角判定

本切片不改变页面主流程，但消除了上一刀留下的维护风险：

- `allowedOperationForItem()`
- `preferredTaskAction()`
- `blockedReasonText()`
- `BLOCKED_REASON_LABELS`

现在统一放在 `media-service/web/src/models/mediaActionPolicy.ts`。媒体管理页和行组件同时引用这份 helper，后续新增 blocked reason 或改变 allowed operation 判断时，不会出现单行和批量规则不一致。

### 本地验收

- `rg` 确认 `preferredTaskAction`、`blockedReasonText`、`allowedOperationForItem` 只在共享 helper 中定义。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产媒体管理页仍待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 17: Task Monitor attention queue presets

### 对应标准

- B3: 任务中心不只展示任务列表，还要把等待用户处理的任务显式捞出来。
- B4: 用户可以一键看到等待确认、失败/中断恢复、待手动启动这些可操作队列，不需要按状态名逐个扫。
- C1: 处理队列复用现有 `/v1/admin/tasks?statuses=...` 查询和全量 summary，不额外读取 task history。

### 用户视角判定

任务中心新增“处理队列”快捷筛选：

- 需要处理：等待确认、失败、中断、暂停、待手动启动。
- 等待确认：只看 `awaiting_user_confirm`。
- 可恢复/重试：只看 `failed_hard` 和 `interrupted`。
- 待手动启动：只看 `pending_manual`、`created`、`paused`。

每个按钮显示当前全局数量；点击后会清空单状态筛选并回到第一页。普通状态 summary 和状态下拉仍可用，但会与处理队列互斥，避免用户叠加筛选后看不懂结果。

### 本地验收

- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产任务中心处理队列待浏览器验收。
- 处理队列目前按 status preset 聚合；后续可以继续按 `controlState.primaryAction` 做更精确的“可确认/可重试/可恢复”投影。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 18: Backend attention queue projection

### 对应标准

- B3: 任务中心的“处理队列”不再由前端按 status 猜测，而由后端基于 `controlState.primaryAction` 和 action effect 给出业务投影。
- B4: 用户看到的“需要处理 / 等待确认 / 可恢复或重试 / 待手动启动”与后端实际允许的 confirm/retry/resume/execute 语义一致。
- C1: 普通任务列表仍走轻量 SQL summary；只有 attention 队列需要按 current task facts 计算控制语义，不扫描 event history 或 heavy payload。

### 用户视角判定

`GET /v1/admin/tasks` 新增 `attention` 查询参数：

- `needs_action`: 等待确认、可恢复/重试、待手动启动的总队列。
- `confirmation`: `controlState.primaryAction=confirm`。
- `recovery`: 可 retry，或 execute effect 为 pause/interruption resume。
- `manual_start`: execute effect 为 `queue_for_scheduler_dispatch`。

响应的 `summary.attention` 返回同一组队列计数，任务中心按钮直接消费这个后端 summary。这样 queued/executing 这类系统正在推进的任务不会被误算为“用户需要处理”；retry 达到上限的失败任务也不会被误放进可重试队列。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "attention queues|GET /v1/admin/tasks returns list with summary|filters by multiple statuses"`: pass，105 个匹配/相关测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。
- `npm test`: pass，223 个测试通过。

### 尚未满足

- 本切片尚未部署 NAS；生产任务中心处理队列待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 19: Task list lightweight control facts

### 对应标准

- B3: 任务中心列表里的 `controlState` 必须能正确解释失败任务是否还能 retry，不能因为列表 projection 缺 `retryCount` 而误导用户。
- C1: `/v1/admin/tasks` 的普通列表、attention 过滤和 `summary.attention` 都走轻量 task summary current facts，不能读取完整 task payload、logs、report 或成人 face cluster。
- C2: 保留任务历史的同时，任务中心热路径不因历史 heavy payload 变慢。

### 用户视角判定

本切片修正了上一刀的后端投影边界：

- `queryTaskSummaries()` 现在带出 `retryCount` 和原始 `resumePoint`，普通任务列表中的 `controlState.actions.retry.reason` 能正确显示 `retry_limit_reached`。
- `GET /v1/admin/tasks?attention=...` 和普通 `/v1/admin/tasks` 的 `summary.attention` 都复用轻量 summary projection。
- 测试中临时让 `taskStore.getTasks()` 抛错，确认 admin task list 与 attention list 不再依赖完整 payload 查询。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "attention queues|GET /v1/admin/tasks returns list with summary|omits heavy adult face payloads|filters by multiple statuses"`: pass，105 个匹配/相关测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。
- `npm test`: pass，223 个测试通过。

### 尚未满足

- 本切片尚未部署 NAS；生产任务中心处理队列待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 20: Explainable task action rejections

### 对应标准

- B3: 任务中心不只在按钮可点击时理解 `controlState`，按钮被后端拒绝时也能拿到同一套控制语义。
- B4: 用户遇到“不能执行 / 不能暂停 / 不能重试”时，后端 response 能解释当前状态、被拒动作、拒绝原因、恢复建议和下一步。
- A4: 前端按钮状态和直接调用 action API 的拒绝语义继续共用 `TaskControlPolicy`，不出现第二套规则。

### 用户视角判定

任务 action / recovery 的 409 响应保持标准错误格式：

- `error.code`
- `error.message`

同时新增解释字段：

- `task`: 当前任务列表级摘要。
- `actionName`: 被拒绝的动作，如 `execute` / `pause` / `retry`。
- `action`: `controlState.actions[actionName]` 的当前动作解释。
- `controlState`: 当前完整控制状态。
- `recovery`: 当前恢复建议。
- `recoveryPlan`: retry recovery 被拒绝时额外返回后端恢复计划。

这样任务中心后续可以直接展示“任务已在推进”“等待确认后才能继续”“重试次数已达上限”等业务解释，而不是只拿到一个裸错误字符串。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "task action endpoints reject transitions|retry rejects retry limit|actions/retry queues failed|actions/execute resumes paused"`: pass，105 个匹配/相关测试通过。
- `npm test`: pass，223 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产任务中心 action rejection 展示待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 21: Dashboard attention entry signal

### 对应标准

- B1: Dashboard 继续作为全局状态入口，而不是任务明细页，但要能提示当前是否有人工处理队列。
- B3/B4: Dashboard 上的“处理队列”数字与任务中心的后端 `attention` 业务投影一致，用户点进任务中心后看到的是同一批处理语义。
- C1: Dashboard health 的 attention 聚合复用轻量 `queryTaskSummaries({ includeAll: true })` current facts，不读取完整 task payload、logs、report 或 adult face cluster。

### 用户视角判定

`GET /v1/admin/dashboard/health` 的 `tasks` 现在包含：

- `attention`: `needs_action` / `confirmation` / `recovery` / `manual_start` 的队列计数。
- `primaryAttention`: 当前最重要的处理队列，没有待处理项时为 `null`。

Dashboard 页面消费该字段：

- 健康指标中新增“处理队列”数字。
- “下一步”卡片显示当前 primary attention，并保留“任务中心”入口。
- Dashboard 不展示任务列表，任务明细仍由任务中心承接。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "dashboard/health|attention queues"`: pass，105 个匹配/相关测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。
- `npm test`: pass，223 个测试通过。

### 尚未满足

- 本切片尚未部署 NAS；生产 Dashboard attention 入口待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 22: Dashboard structured event projection

### 对应标准

- B1: Dashboard 继续作为全局入口，保留“系统在动”的事件体感，但不承载任务明细列表。
- B4: Dashboard event 卡片不再只是读取原始日志，而是消费后端统一的 `events.recent` projection，事件有来源、严重度、消息和可跳转线索。
- C1: Dashboard event projection 使用内存 `activityLog` 和轻量 `queryRecentTaskEvents()`，不读取完整 task history、task event payload、task logs、report 或 service 原始日志。

### 用户视角判定

`GET /v1/admin/dashboard/health` 现在额外返回：

- `events.latestAt`: 最近事件时间。
- `events.bySource`: 当前 Dashboard event projection 的来源计数。
- `events.recent[]`: 统一事件条目，包含 `kind`、`source`、`sourceLabel`、`severity`、`message`、`ts`，task event 还会带 `taskId`、`itemId`、`eventType`、`resource*`、`bridgeKind`、`operationKind` 等轻量线索。

Dashboard 页面改为直接消费 `dashboardHealth.events.recent` 渲染“系统事件”卡片，不再单独轮询 `/v1/activity-log`。`/v1/activity-log` 仍保留兼容，但 Dashboard 的事件卡片语义以后以后端 Dashboard projection 为准。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "dashboard/health"`: pass，105 个匹配/相关测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。
- `npm test`: pass，223 个测试通过。

### 尚未满足

- 本切片尚未部署 NAS；生产 Dashboard event projection 待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 23: Explain confirm and retry conflict rejections

### 对应标准

- B3: 用户直接调用确认或重试 API 被拒绝时，也能拿到与任务中心按钮同源的 `controlState.actions` 解释。
- B4: “无需确认”与“同 item 已有 active task 阻止 retry”不再只是裸 409，响应能告诉用户当前任务状态、被拒动作、恢复建议和阻塞任务。
- C1: retry active conflict 改用轻量 `queryTaskSummaries({ itemId })` current facts 查询，不读取完整 task payload、logs、report 或 event history。

### 用户视角判定

本切片把两个边缘拒绝路径收进同一套解释合同：

- `PATCH /v1/tasks/:id` confirm 会先校验 `controlState.actions.confirm`。非 `awaiting_user_confirm` 任务返回 `TASK_ACTION_REJECTED`，并带 `task`、`actionName=confirm`、`action`、`controlState`、`recovery`。
- `POST /v1/tasks/:id/actions/retry` 如果发现同 item 已有其他 active task，返回 `TASK_RECOVERY_REJECTED`、`error.message=active_task_conflict`、`recoveryPlan.reason=active_task_conflict` 和轻量 `activeTask` 摘要。

这样任务中心或其他前端入口不需要对这些边缘状态写第二套错误解释。

### 本地验收

- `node --test test/api-contract.test.js test/api-inject.test.js --test-name-pattern "confirm on non-awaiting|retry rejects retry limit and active task conflict|task action endpoints reject transitions"`: pass，140 个匹配/相关测试通过。
- `npm test`: pass，223 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产任务 action rejection 展示待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 24: User task control events

### 对应标准

- A5: 用户触发任务控制动作后，后端不仅改变 status，还写入可解释的 task event。
- B3/B4: 任务详情和 Dashboard event projection 能看到“用户确认 / 请求执行 / 请求暂停 / 请求取消”，不只看到状态跳转。
- D1: 任务 event history 能串起用户动作、状态变化、恢复建议和后续调度事件。

### 用户视角判定

任务控制成功路径现在会写入用户动作事件：

- `PATCH /v1/tasks/:id` confirm 成功后写 `task.confirmed`，包含 `requestedBy=user`、`actionEffect`、`fromStatus/toStatus`、`gateId`、`resumePoint` 和 `confirmDataKeys`。
- `POST /v1/tasks/:id/actions/execute` 成功前写 `task.execute_requested`。
- `POST /v1/tasks/:id/actions/pause` 成功前写 `task.pause_requested`。
- `DELETE /v1/tasks/:id` 和 `DELETE /v1/admin/tasks/:id` 成功移除前写 `task.cancel_requested`，随后仍由 task store 写 `task.deleted`。
- `POST /v1/tasks/:id/actions/retry` 保持已有 `task.retry_requested` / `task.retry_recorded`。

Dashboard event projection 也补充这些事件类型的中文标签，因此首页“系统事件”能表达用户刚推进了哪个动作。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "actions/pause returns paused|actions/execute resumes paused|DELETE /v1/tasks/:id cancels|DELETE /v1/tasks/:id removes queued|confirm with confirmData"`: pass，105 个匹配/相关测试通过。
- `npm test`: pass，223 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产任务 event 展示待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 25: Explainable priority adjustment

### 对应标准

- B3: 任务中心的 priority 调整不再只是数字 patch，后端返回当前控制状态和可编辑性解释。
- B4: 用户尝试调整已执行中的任务优先级时，响应能解释为什么不能改，以及哪些状态允许改。
- C1: priority 调整只依赖 task current facts 和 task event latest projection，不读取完整 task history 或 heavy payload。

### 用户视角判定

`PATCH /v1/admin/tasks/:id` 的 priority 路径现在统一返回 `priorityAdjustment`：

- 成功时返回更新后的 task、`controlState` 和 `priorityAdjustment.enabled=true`。
- priority 非非负整数时返回 `VALIDATION_ERROR`，并附带 `validation.reason=non_negative_integer_required` 与当前 `priorityAdjustment`。
- 当前 task 状态不可编辑时返回 `TASK_PRIORITY_REJECTED`，并带 `task`、`controlState` 和 `priorityAdjustment.enabled=false`。

`priorityAdjustment` 包含：

- `enabled`
- `reason`
- `effect`
- `requestedPriority`
- `currentPriority`
- `editableStatuses`

可编辑状态限定为 `created` / `pending_manual` / `queued` / `interrupted` / `paused`，已进入 running 或终态的任务不允许改 priority。

### 本地验收

- `node --test test/priority-api.test.js`: pass，12 个测试通过。
- `npm test`: pass，223 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产 priority 调整解释待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 26: Explainable manual task admission

### 对应标准

- A4: 手动创建任务的成功与失败都经过同一套 `TaskAdmission` / `BusinessFlowPolicy`，并返回用户可理解的 bridge / operation / blocked reason。
- B3: 任务中心或其他手动入口不需要只靠 legacy `actionType` 推断创建结果，成功响应可直接展示本次 admission 解析出的 bridge 和 flow operation。
- C1: active task conflict 的补充信息来自 `queryTaskSummaries({ itemId }, { includeHistory: false })` 轻量投影，不读取完整历史 task payload。

### 用户视角判定

`POST /v1/tasks` 手动创建任务现在补齐 admission 解释：

- 创建成功时，响应除了 task detail / `controlState`，还返回 `admission.allowed=true`、`reason=allowed`、`operation`、`bridgeKind`、`intentMode`、`requestedIntent`、`taskBridge` 和 `flowPlan`。
- v2 `actionType` 兼容输入会标记为 `intentMode=action_type_compatibility`；v3 bridge intent 会标记为 `intentMode=bridge_intent`。
- 创建失败仍返回标准 `error`、结构化 `admission` 和当前 `businessFlowDecision`。
- 当失败原因是 `active_task_exists` 时，响应额外返回轻量 `activeTask`，包含占用该 item 的任务 id、bridge、flow operation、status、phase、resumePoint、priority 和 `controlState`。

本切片同时收紧 retry conflict 的轻量查询：同 item 冲突只在 active task projection 内判断，不会把终态历史任务误判为 active conflict。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "POST /v1/tasks creates task|accepts optimize bridge intent|accepts archive bridge intent"`: pass，105 个测试通过。
- `node --test test/api-contract.test.js --test-name-pattern "duplicate itemId"`: pass，35 个测试通过。
- `npm test`: pass，223 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产任务创建入口的 admission 解释待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 27: SmartTask scan diagnostic summary

### 对应标准

- A3: 自动化边界不只由 `smartTaskEnabledActions` 和 `TaskAdmission` 执行，还要能解释上一轮自动扫描为什么创建或没有创建任务。
- B5: Resource / diagnostics / health 可以从 SmartTask health 看到后台自动入队的候选、拒绝和跳过原因。
- C3: SmartTask 扫描有节奏、有上限，并新增单轮 diagnostic summary；摘要只保存轻量计数和 reason 分布。

### 用户视角判定

`smartTaskEngine.getHealth()` 现在会返回 `lastScanSummary`：

- `enabledActions`
- `libraryItems`
- `candidateCount`
- `evaluatedCandidates`
- `enqueued`
- `candidatesByAction`
- `enqueuedByAction`
- `admissionRejected`
- `admissionRejectedByReason`
- `skippedByQueueCap`
- `skippedByQueueCapByAction`
- `maxPerRunReached`
- `reason`
- `error`

这样用户看到“自动入队没有动”时，后端能解释是因为没有 enabled actions、没有候选、queue cap 满了、`TaskAdmission` 拒绝，还是扫描异常/Background I/O Guard 忙碌，而不是只剩一个模糊的健康灯。

本切片不保存媒体详情、task payload、日志、成人 face cluster 或 AI debug，只记录单轮扫描的轻量统计。

### 本地验收

- `node --test test/task-model.test.js --test-name-pattern "smartTaskEngine cannot auto-enqueue standard media scrape|smartTaskEngine health explains queue-cap skips"`: pass，36 个测试通过。
- `npm test`: pass，224 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产系统配置/Resource diagnostics 中 SmartTask health 的展示待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 28: Dashboard automation diagnostics projection

### 对应标准

- B1: Dashboard 作为媒体库体检入口，不展示任务列表，但要解释自动化当前开启了哪些 flow operation，以及最近自动扫描是否真的在动。
- B5: Dashboard health 的 diagnostics 可以看到 SmartTask admission rejected / queue cap / max-per-run 等自动化阻塞信号。
- C1/C3: Dashboard automation projection 只消费 `smartTaskEngine.getHealth().lastScanSummary` 的轻量计数，不读取完整 task history、task payload、logs 或 heavy adult/AI data。

### 用户视角判定

`GET /v1/admin/dashboard/health` 的 `automation` 现在包含：

- `enabledOperations`: 当前 `smartTaskEnabledActions` allow-list。
- `smartTask.status/enabled/disabledReason/message/lastRunAt/lastError`
- `smartTask.lastScanSummary`: 上一轮自动扫描摘要，包括候选数、评估数、入队数、按 action 分布、admission rejected reason 分布、queue cap skip 分布和 `maxPerRunReached`。

Dashboard health 的 `diagnostics.signals` 也会把自动化阻塞变成入口级信号：

- `smart_task_scan_failed`
- `smart_task_admission_rejected`
- `smart_task_queue_cap`
- `smart_task_max_per_run`

这样首页仍然不承担任务中心职责，但能告诉用户“自动化开了什么、上一轮为什么没有继续入队、是不是被 policy 或队列上限挡住”。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "dashboard/health"`: pass，105 个测试通过。
- `npm test`: pass，224 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产 Dashboard automation diagnostics 待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 29: Explainable adult rescrape active conflict

### 对应标准

- A4: 成人 rescrape 是显式用户入口，不能在重复点击时只返回裸 `CONFLICT`。
- B3/B4: 用户在成人 item 上再次触发 rescrape 时，后端能解释哪个 active task 正在占用该 item、当前 metadata bridge / scrape flow 停在哪里。
- C1: active conflict 使用 `queryTaskSummaries({ itemId }, { includeHistory: false })` 轻量 current facts，不读取完整 task history、logs、report 或 heavy adult face payload。

### 用户视角判定

`POST /v1/admin/adult/items/:itemId/actions/rescrape` 在已有 active scrape task 时，现在返回：

- `409 TASK_CONFLICT`
- `error.message=active_task_exists`
- `admission.operation=scrape`
- `admission.reason=active_task_exists`
- `admission.bridgeKind=metadata`
- `admission.activeTaskId`
- 当前 `businessFlowDecision`
- 轻量 `activeTask` 摘要，包含 task id、bridge、flow operation、status 和 `controlState`

这样前端可以告诉用户：“这个成人条目已经有一个 metadata/scrape 任务在队列或执行中”，而不是只显示一个泛化冲突。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "rescrape re-enqueues"`: pass，105 个测试通过。
- `npm test`: pass，224 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产成人 rescrape duplicate conflict 展示待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 30: Explainable worker node delete conflicts

### 对应标准

- B5: 外部 worker 资源被任务占用时，后端不再只返回裸数量，而是返回可展示的资源上下文和占用任务。
- C1: 节点删除冲突使用 `queryTaskSummaries({ nodeId, statuses: ['executing'] })` 查询 current facts，不读取完整 task history。

### 用户视角判定

`DELETE /v1/admin/nodes/:id` 在 worker node 仍有 active job 时，现在返回：

- `409 NODE_HAS_ACTIVE_JOBS`
- `error.message=node_has_active_jobs`
- `node`: 节点 id/name/address/status
- `resourceContext`: `worker_node`、`node:<id>` 和展示 label
- `activeJobCount`
- `activeTasks`: 占用该节点的轻量任务摘要，包含 flow operation、status、`nodeId` 和 `controlState`
- `forceDelete`: 明确 `force=true` 的后果是 `mark_active_tasks_failed_hard_then_delete_node`

`?force=true` 仍保留原有能力，但响应会返回被影响的 task id；实现上也改为基于摘要定位 active job，再按 task id 更新状态。

同时修正 `nodeStore` 的数据目录：节点登记现在跟随 `CONTROL_PLANE_DATA_DIR` / service data dir，避免测试和运行时把 `nodes.json` 写到固定源码目录。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "DELETE /v1/admin/nodes/:id explains active worker job conflicts"`: pass，106 个测试通过。
- `npm test`: pass，225 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产 worker node 删除冲突展示待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 31: Manual admission item-scoped active facts

### 对应标准

- A4: 手动任务创建仍经过同一 `TaskAdmission` / `BusinessFlowPolicy`，但单个按钮点击只需要解释当前 item 的业务准入。
- B2: 媒体管理页创建任务失败时继续得到同 item 的 `businessFlowDecision` / `activeTask` 解释，不会被其他 item 的 active task 干扰。
- C1: `/v1/tasks` 手动 admission 改为 `queryTaskSummaries({ itemId }, { includeHistory: false })`，不读取全局 active task 列表或完整 task history。

### 用户视角判定

`POST /v1/tasks` 现在在手动创建任务时只读取当前 `itemId` 的 active task summary：

- 当前 item 没有 active task 时，即使系统里有其他 item 的 active task，也不会误判为冲突。
- 当前 item 已有 active task 时，仍返回 `409 TASK_CONFLICT`、结构化 `admission`、当前 `businessFlowDecision` 和轻量 `activeTask`。
- metadata missing、普通媒体 scrape blocked、bridge intent mismatch 等拒绝响应仍保持原有解释字段。

这样媒体管理页单行按钮和批量入口可以继续依赖同一 admission 语义，但后端不会为单个 item 的手动点击拉全局任务热路径。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "manual admission does not load full task history"`: pass，106 个测试通过。
- `npm test`: pass，225 个测试通过。第一次全量运行中 `manual scrape of low-confidence` 出现一次日志断言波动，单独复跑通过，随后第二次全量通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产手动创建任务 admission 热路径待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 32: Media business decision active summary projection

### 对应标准

- B2: 媒体管理页的按钮可用性和 blocked reason 继续来自 `businessFlowDecision`，但不依赖完整 task payload。
- C1: `/v1/library`、`/v1/library/queries/manage`、`/v1/library/items/:itemId` 的 active task facts 改为 lightweight summary projection。
- C2: `task=active|none` 管理查询保留 SQL pagination path，不加载完整媒体库或完整任务历史。

### 用户视角判定

媒体页现在获取业务决策时：

- 列表页只按当前页 itemIds 查询 active task summary。
- 单 item 详情只查询当前 `itemId` 的 active task summary。
- `task=active|none` 过滤只从 active summary projection 提取 active itemId 集合。
- 已有 active task 的媒体仍会显示 `active_task_exists`、active bridge、active flow operation 和 latest event summary。

这样用户看到的按钮状态和阻断原因不变，但后端不再为了媒体列表上的按钮解释读取完整 task payload、logs、report 或历史记录。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "GET /v1/library explains active task|task filter stays on SQL pagination path"`: pass，106 个测试通过。
- `npm test`: pass，225 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时动态/静态 import，非本切片新增失败。

### 尚未满足

- 本切片尚未部署 NAS；生产媒体管理页 active task blocked reason 待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 33: Legacy task active list summary projection

### 对应标准

- B3: 用户会去任务中心看任务状态，默认 active task list 应该直接返回当前控制语义。
- C1: `/v1/tasks` 默认 active 列表和 `activeOnly=1` 改为 lightweight task summary projection。
- C2/C3: active 列表不返回 logs/report/heavy adult face payload；详情、report、events 仍作为按需读取入口。

### 用户视角判定

`GET /v1/tasks` 现在：

- 默认只返回 active tasks，并走 `queryTaskSummaries(..., { includeHistory: false })`。
- `activeOnly=1` 与默认 active view 一样返回轻量 summary 和 `controlState`。
- `bridgeKind` / `operationKind` 过滤仍可用于 active list。
- `includeHistory=1` 且不是 activeOnly 时继续保留完整历史兼容路径。

这样媒体页和 legacy/desktop task list 仍能看到 task id、item、bridge、flow、status、priority、`controlState` 等列表事实，但不会为了列表加载 logs、report 或 heavy payload。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "defaults to active tasks|filters by bridge and flow operation"`: pass，106 个测试通过。
- `npm test`: pass，225 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产 legacy task list/媒体页 active list 待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 34: Scheduler flow failure event diagnostics

### 对应标准

- A5: flow executor 异常不能只把任务打成失败，必须能追到失败发生的 flow step、resource 和错误摘要。
- B3/B5: 任务中心、Dashboard event 和 Resource View 可以用同一个 `flow.failed` 事件解释失败任务和资源故障。
- C4: scheduler 异常收口有测试证据，不只依赖口头约定。

### 用户视角判定

当 Scheduler 已经分派任务并写入 `flow.dispatched` 后，如果 executor 抛错或 promise reject，现在会：

- 将 task 标记为 `failed_hard`。
- 追加 `flow.failed` task event，包含 `flowEventType`、`flowEventPhase`、resource type/key/label、bridge、operation、错误名称/消息和 effect。
- 写入 `scheduler.flowDispatch` diagnostic log，记录 task/item/action/bridge/operation/resource/error。
- Dashboard event projection 将 `flow.failed` 标成“执行失败”，Resource View 的 failed event projection 可以继续补 task/control/recovery/diagnostic 上下文。

这样用户看失败任务时，不只是看到一个终态，而能看到“已分派到哪个 flow/resource 后失败”和“具体错误摘要是什么”。

### 本地验收

- `node --test test/priority-api.test.js --test-name-pattern "flow failure events|dispatch order"`: pass，13 个测试通过。
- `npm test`: pass，226 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产任务中心/Resource View 的真实 executor 异常展示待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 35: Executor-reported failure summaries

### 对应标准

- A5: executor 自己捕获错误并上报 `failed_hard` 时，失败事件必须带可读错误摘要。
- B3/B5: 任务中心、Dashboard event 和 Resource View 能从 `task.failed` 事件直接看到失败原因、bridge/operation 和 primary resource。
- C2/C4: 失败摘要只写最近 error log 的轻量字段，有测试证明不会依赖完整 logs/report payload。

### 用户视角判定

大量 flow executor 会先写 error log，再调用 `scheduler.reportStatus(taskId, 'failed_hard')`。这类失败现在不再只有 `task.status_changed` / `task.failed` 的裸状态：

- `task.failed.payload.failureSummary` 包含最近 error log 的 `message`、`level`、`ts` 和 `source=task_log`。
- `task.failed.payload` 同时带 `bridgeKind`、`flowDirection`、`operationKind`、`primaryResourceType`。
- Dashboard event projection 将 `task.failed` 标成“任务失败”，不会退回技术 event name。
- 事件 payload 只保存摘要，不复制完整 task logs、report 或 heavy payload。

这样 executor 内部处理过的失败也能被用户看懂：失败的是哪座 bridge、哪个 operation、哪个资源方向，以及最近错误消息是什么。

### 本地验收

- `node --test test/task-model.test.js --test-name-pattern "failure summary|task event journal"`: pass，37 个测试通过。
- `npm test`: pass，227 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产失败任务事件展示待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 36: Resource failure summary projection

### 对应标准

- A5: 失败原因不能只藏在 task event payload、task logs 或 diagnostic log 里，资源诊断读模型应直接给出用户可读摘要。
- B5: Resource View 的 `diagnostics.failedEvents` 能展示失败 event/resource、恢复动作和标准化失败摘要。
- C2/C4: 失败摘要只投影轻量字段，测试覆盖 Resource View 不需要前端解析完整 logs/report。

### 用户视角判定

`GET /v1/admin/resources` 的 `diagnostics.failedEvents[]` 现在新增稳定字段：

- `failureSummary.message`
- `failureSummary.level`
- `failureSummary.ts`
- `failureSummary.source`
- `failureSummary.errorName`

摘要来源优先级：

- `task.failed.payload.failureSummary`
- `flow.failed` 的 `errorMessage/errorName`
- 该 task 当前最近一条 error log 的轻量摘要
- 匹配的 diagnostic log `error/reason`

同时 `queryRecentFailureEvents` 显式把 `flow.failed` 当作 failure event，并优先返回 `task.failed` / `flow.failed` / `task.interrupted` 这类语义事件，减少 Resource View 命中裸 `task.status_changed` 的概率。

这样 Resource View 可以直接告诉用户“资源诊断里这次失败的错误摘要是什么”，而不是要求页面理解多种 event payload 或完整 task logs。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "task events and admin resource view"`: pass，106 个测试通过。
- `npm test`: pass，227 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产 Resource View 失败摘要展示待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 37: Media row terminal failure event summary

### 对应标准

- A1/A5: 媒体 item 的统一业务决策结果应包含最近事件或诊断摘要；终态失败不能只在任务详情/Resource View 里可见。
- B2: 媒体管理页每行能看到 active task 摘要，也能看到最近失败 task event 摘要。
- C1/C2/C4: 媒体列表按当前页 itemIds 从 `task_events` 查询轻量 recent failure projection，不读取完整 task history、logs 或 report。

### 用户视角判定

`GET /v1/library` 和 `GET /v1/library/items/:itemId` 的 `businessFlowDecision.latestEventSummary` 现在：

- 有 active task 时仍优先返回 `kind=active_task` 摘要。
- 没有 active task、但该 item 最近有失败/中断事件时，返回 `kind=failure_event` 摘要。
- failure event 摘要包含 `eventId`、`taskId`、`eventType`、`status`、`phase`、`resumePoint`、`bridgeKind`、`flowOperation`、`primaryResourceType`、`failureSummary`、`updatedAt`。
- `diagnosticSummary.latestFailure` 同步暴露最近失败摘要，供媒体页直接展示“最近为什么失败”。

这样用户在媒体管理页不需要先跳到任务中心，至少能看到这个条目最近失败在哪里、错误摘要是什么；如果该条目同时有 active task，仍以 active task 阻断为主，避免状态冲突。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "active task as operation blocker|terminal failure summary"`: pass，107 个测试通过。
- `npm test`: pass，228 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产媒体管理页最近失败摘要展示待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 38: Dedicated confirmation queue projection

### 对应标准

- B4: 需要用户确认的任务必须有独立后端读模型，任务中心不用从普通任务列表里猜。
- B3: 确认队列复用 `TaskControlPolicy` 的 confirm/recovery 语义，按钮可用性和后端强约束一致。
- C1/C2/C4: 队列和 summary 只读 `queryTaskSummaries` current facts，不读取完整 task history、logs、report 或 adult face payload，并有 API 测试覆盖。

### 用户视角判定

新增 `GET /v1/admin/confirmations`，面向任务中心的“待确认”队列，而不是 Dashboard 任务列表卡片。它会返回：

- 当前等待用户确认的 task。
- `confirmation.gateId/message/options/resumePoint/effect/whyRequired`，说明为什么卡住、确认后继续到哪里。
- `confirmAction` 和 `recovery`，说明当前应该点确认而不是 pause/retry/execute。
- `taskBridge`、`flowPlan`、`actionType` 和 `itemInfo` 轻量摘要。
- `summary.byGate/byBridgeKind/byOperationKind`，以及 `bridgeKind/operationKind/actionType/q` 过滤能力。

这样任务中心可以直接做“确认事项”入口；Dashboard 继续只保留入口级健康信号和 event 卡片，不需要复刻任务明细列表。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "admin/confirmations|attention queues"`: pass，108 个测试通过。
- `npm test`: pass，229 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产任务中心确认队列待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 39: Adult review items in confirmation queue

### 对应标准

- B4: 用户确认台不只收 `awaiting_user_confirm` task，也要集中展示成人库 ambiguous / needs_review 这类需要用户拍板的事项。
- A2/A5: 成人 scrape / rescrape 的失败、歧义和审核状态能回到统一 metadata/scrape bridge 语义，而不是散落在成人库详情里。
- C1/C2/C4: 成人 review 事项来自 `library.db` 的轻量 SQL projection，不读取完整媒体 payload、adult face clusters、task logs 或 report，并有 API 测试覆盖。

### 用户视角判定

`GET /v1/admin/confirmations` 现在是统一“确认/审核队列”后端 projection：

- `kind=task_confirmation`：继续表示 task 正在 `awaiting_user_confirm`。
- `kind=adult_review`：表示成人条目需要审核，例如 JAV 番号低置信 `ambiguous`，或欧美成人 scrape result `needs_review`。
- 顶层 `items[]` 合并两类事项，`confirmations[]` / `reviews[]` 保持分组，`summary.taskConfirmations` / `summary.adultReviews` 分别给出计数。
- adult review item 会明确给出 `taskBridge.kind=metadata`、`flowPlan.operationKind=scrape`、`confirmation.whyRequired`、review 入口和 nextAction。
- `kind`、`bridgeKind`、`operationKind`、`actionType`、`reviewStatus`、`subLibraryId`、`q` 都可以在后端过滤；`bridgeKind=archive` 这类过滤不会混入成人 metadata review。

这样任务中心未来可以把“待确认”和“待审核”放在同一处理入口里；Dashboard 仍只做入口级健康和系统事件，不承担任务/审核明细。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "admin/confirmations|attention queues"`: pass，109 个测试通过。
- `npm test`: pass，230 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产任务中心确认/审核队列待浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 40: Dolby Vision transcode capability fallback

### 对应标准

- A2/A5: Dolby Vision 转码失败必须能解释为具体转码能力 path 的失败，而不是只看到 task 终态。
- B5: `/v1/admin/health` 的 transcode check 暴露 Dolby Vision tonemap 能力状态，Resource View / 任务事件能追到实际使用的能力路径。
- C3/C4: 生产 degraded 排查发现当前瓶颈是 `local_transcode` 单 slot backlog，同时 DV 失败来自 FFmpeg `libplacebo` Vulkan runtime 初始化失败；本切片用运行时 self-test 和 fallback 作为证据化修复。

### 用户视角判定

生产任务中心抽样失败任务：

- “变形金刚3：月黑之时”和“变形金刚2：卷土重来”均为 Dolby Vision 4K 转码任务。
- 任务已经自动通过 Dolby Vision tonemap 审批，进入 CPU encode。
- 实际失败点是 FFmpeg filter 初始化：`No vkGetInstanceProcAddr function provided` / `Failed initializing vulkan device` / `Error initializing filters`。

因此修复方向是转码能力补强，而不是任务管理绕行：

- `TranscodeService` 现在先对 `libplacebo` 运行实际 filter graph self-test。
- 如果 `libplacebo` 存在但运行时失败，则自动选择软件 `zscale+tonemap` HDR→SDR fallback。
- 如果两条 path 都不可用，precheck 返回清晰的 “no usable Dolby Vision tonemap path”。
- 选中的 path 写入 task `itemInfo.dolbyVisionTonemap` / `dvTonemapFilter`，编码阶段使用同一个 filter graph，并在任务日志中记录 path。
- `getHealth()` 暴露 `dolbyVisionTonemap.ok/mode/label/message`，让服务 degraded 能直接指向 DV 转码能力。
- Docker runtime 增加 `libvulkan1`、`mesa-vulkan-drivers`、`vulkan-tools`，优先补强 libplacebo/Vulkan path，同时保留软件 fallback。

### 本地验收

- `node --test test/transcode-fallback.test.js`: pass，10 个测试通过。
- `node --test test/api-inject.test.js --test-name-pattern "admin/health|transcode/config"`: pass，109 个测试通过。
- `npm test`: 最终 pass，233 个测试通过。第一次全量运行中 `manual scrape of low-confidence` 出现一次日志时序断言失败；单独复跑通过，后续全量通过，未发现与本切片相关的确定性回归。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产 DV 转码能力和健康检查待部署后验证。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 41: Task lifecycle audit by library type

### 对应标准

- A2/A5: 任务中心需要能按库类型解释 task 从创建、排队、执行、等待确认、恢复到终态的生命周期。
- B3/B5: 任务中心和资源诊断页可以直接拿到每种库类型下 bridge / operation / resource / status 是否合理，而不是靠前端扫任务列表猜。
- C1/C2/C4: 审计 projection 只读 `queryTaskSummaries` current facts 和 config sub-library 定义，不读取完整 task payload、logs、report 或 heavy media payload。

### 用户视角判定

新增 `GET /v1/admin/tasks/lifecycle-audit`，面向任务中心的后端审计读模型：

- 按 lifecycle stage 聚合：创建/待手动启动、排队、执行中、等待用户确认、暂停/中断恢复、成功终态、失败终态。
- 按 `mediaType` 和 sub-library 聚合 task 总数、status、bridge kind、operation kind、source、active/terminal/failed/awaitingUser。
- 返回 `signals`，指出明显不符合预期的任务生命周期样本，例如普通媒体 scrape task、缺少 sub-library context、找不到 sub-library、缺少 bridge/operation/resource、等待确认但没有 confirmation gate、执行中没有 phase。
- 支持 `status/statuses/actionType/bridgeKind/operationKind/subLibraryId/mediaType/q/sampleLimit` 过滤，方便从当前生产任务中心挑具体任务分析。

这样 P0 的“每一种库类型下 task 生命周期是否符合预期”有了后端事实入口；任务中心后续可以展示“电影库为什么出现 scrape”“成人库 metadata bridge 是否都是 ingest/scrape”“哪些 failed task 缺恢复解释”等问题，而不是把这些判断散落在 UI 分支里。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "lifecycle-audit|admin/tasks returns list"`: pass，110 个测试通过。
- `npm test`: pass，234 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产任务生命周期 audit 待浏览器/API 验证。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 42: Sub-library metadata gate and standard metadata repair scrape

### 对应标准

- A1/A2: “元数据完整”从全局硬编码字段改为子库级 scrape completion gate，用户语义是 optimize-ready。
- A3/A4: 普通 Emby 媒体 metadata 缺失时可以进入统一 `metadata/scrape` flow；自动创建仍受 `smartTaskEnabledActions`、TaskAdmission、冷却和队列上限约束。
- A5/B3/B5: 普通库半假 scrape 以 resource/event 表达为 Emby metadata repair，而不是成人外部 scraper；失败原因回到当前子库 gate 缺失项。
- C3/C4: 普通 metadata repair 使用独立 `emby:metadata` resource bucket，避免 Resource View 把它和成人 scraper/本地 AI 混在一起。

### 用户视角判定

本切片覆盖此前 v3.0.1 / 早期 v3.1 中“普通媒体 scrape 一律不支持”的判断。新的产品模型是：

- Admin Web 显示“元数据完整”时，表示该媒体已完成 scrape 阶段，并具备进入 optimize 阶段所需的前置条件。
- 每个子库可以通过 `metadataGate` 自定义“元数据完整”需要哪些条件；默认 gate 保持既有普通 Emby / 成人库语义。
- `metadataGate` 支持 `all` 和 `any`，例如评分可表达为至少满足 `userRating` / `doubanRating` 之一。
- 用户自定义 gate 可以严于下游策略输入，但不能宽于下游策略输入。
- 保存子库配置时，如果 gate 没覆盖当前策略模板消费的 optimize 输入，API 返回 `400 METADATA_GATE_CONTRACT_BROKEN`。
- 运行时如果旧配置或迁移导致 gate 合同被破坏，`metadataMissingReasons` 会包含 `metadata_gate_contract_broken`，不会让 item 显示成“元数据完整”后又安静卡在 optimize 之前。
- 普通 Emby item 的 `scrape` 不再表示真正 TMDB/海报/名称刮削，而是半假 metadata repair：问 Emby、读已有 Douban 缓存、自算技术字段和策略，再按当前子库 gate 判断是否完成。

### 后端事实来源

- `media-service/src/metadataStatus.js`
  - 新增子库 `metadataGate` 解析和 `all` / `any` 条件判断。
  - 新增策略输入覆盖校验，内部诊断码为 `metadata_gate_contract_broken`。
- `media-service/src/businessFlowPolicy.js`
  - 普通库 metadata 已完整时 `scrape` 返回 `metadata_already_complete`。
  - 普通库 metadata 缺失时允许进入 `metadata/scrape` TaskAdmission。
- `media-service/src/scrapeFlowExecutor.js`
  - 普通 Emby `scrape` 日志改为 standard metadata repair。
- `media-service/src/mediaLibraryService.js`
  - 普通库 repair 只应用已有 Douban 缓存，不在 scrape 任务中临时外呼 Douban。
  - 对单 item repair 补充文件技术探测和自算字段。
- `media-service/src/flowPlanner.js`、`resourceProjection.js`、`taskScheduler.js`
  - 普通 metadata repair scrape 使用 `emby` primary resource / `emby:metadata` bucket。
- `media-service/src/app.js`
  - 新增子库保存时 metadata gate 合同校验。

### 本地验收

- `node --test test/task-model.test.js --test-name-pattern "metadataStatus uses sub-library metadataGate|metadataStatus marks a custom metadataGate|smartTaskEngine auto-enqueues standard metadata repair scrape"`: pass，39 个测试通过。
- `node --test test/api-inject.test.js --test-name-pattern "TaskAdmission accepts standard metadata repair scrape|PATCH /v1/admin/sublibraries rejects metadataGate|GET /v1/library exposes v3 business flow decision"`: pass，111 个测试通过。
- `npm test`: pass，237 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS。原因：生产当前 `smartTaskEnabledActions` 包含 `scrape`，部署后普通库 scrape candidate 可能开始被自动入队并写生产任务数据，需要单独安排生产观察窗口。
- 还未用生产样本“黑炮事件”“凛冬的已至”验证 repair 后具体 gate 缺失项和 Resource View 压力。
- 前端暂未提供 `metadataGate` 配置 UI；当前是后端模型和 API 校验先落地。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。
