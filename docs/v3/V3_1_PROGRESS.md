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

## 2026-06-30 Slice 43: Lifecycle audit semantics for standard metadata repair

### 对应标准

- A2/A5: task lifecycle audit 必须跟随新的普通库 metadata repair 模型，不能继续把所有普通库 `scrape` 都判为异常。
- B3/B5: 任务中心/资源诊断看到普通库 scrape 时，应能区分正常 Emby metadata repair、旧历史任务和错误 resource 规划。
- C4: 本轮基于生产只读诊断确认 degraded 现象的真实来源，并用测试覆盖新的审计判定。

### 生产只读诊断

生产当前仍运行 `markmahoro/shelfdeck:v3.1.0-task-lifecycle-audit-20260630-r1`，尚未部署 Slice 42/43。

只读检查结果：

- `GET /v1/health`: `green`。
- `GET /v1/admin/health`: `green`。
- `GET /v1/admin/dashboard/health`: `red`，主要来自业务层历史失败和待处理压力，而不是进程/外部依赖 health 降级。
- Dashboard task facts: `failedTasks=1025`，其中 `scrape=737`、`transcode=287`、`upgrade=1`；当前 active task 为 50。
- Resource View: `local_transcode` 当前 `running=1`、`waiting=49`，瓶颈是本地 FFmpeg 转码队列；没有看到 scrape/Emby 资源正在打外部依赖。
- SmartTask 最近扫描：`transcode` candidate 1142 个因 queue cap 跳过；`scrape` candidate 287 个仍按旧生产镜像被 `scrape_not_supported_for_standard_media` 拒绝。
- NAS 空间：`/vol1` 175G，总用量 113G，剩余 62G，使用率 65%；当前 shelfdeck 目录只看到一个约 903M 的镜像 tar，不是本轮瓶颈。

### 用户视角判定

Slice 41 的 lifecycle audit 仍保留旧结论：`context.mediaType !== adult && operationKind === scrape` 就报 `standard_media_scrape_task` error。这个判断在 v3.0.1 是正确的，但在 Slice 42 后已经不再符合产品模型。

新的审计语义：

- 普通库 `scrape` 如果 `flowPlan.primaryResourceType=emby` 或 `resourceTypes` 包含 `emby`，这是正常的 standard metadata repair，不再报错。
- 普通库 `scrape` 如果仍规划到非 Emby resource，且任务还处于 active lifecycle，报 `standard_media_scrape_wrong_resource` error，表示它可能会走错资源路径。
- 普通库 `scrape` 如果是终态历史任务且没有 Emby repair resource，报 `legacy_standard_media_scrape_task` warn，表示这是旧模型遗留历史，不能再用“普通库不允许 scrape”的旧结论解释。
- Audit signal 现在返回 `primaryResourceType`、`expectedResourceType`、`actualResourceType`，方便任务中心解释“为什么这个 scrape 是正常 repair / 为什么这个 scrape 是旧历史 / 为什么这个 active scrape 资源不对”。

### 后端事实来源

- `media-service/src/app.js`
  - 更新 `taskLifecycleSignals()` 的普通库 scrape 审计规则。
  - Signal projection 增加 `primaryResourceType`。
- `media-service/test/api-inject.test.js`
  - lifecycle audit 测试同时覆盖正常 Emby metadata repair、active wrong-resource scrape、terminal legacy scrape。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "lifecycle-audit"`: pass，111 个测试通过。
- `npm test`: pass，237 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产生命周期 audit 的新 signal 需要与 Slice 42 一起部署后再验证。
- P0-1 仍未完整关闭：还需要部署新模型后，用生产样本和任务中心继续确认普通库 repair lifecycle、成人库 scrape lifecycle、转码 queue lifecycle 是否符合预期。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 44: Flow recovery contract projection

### 对应标准

- A5: 失败任务的 retry/resume 不能只靠 `actionType` 硬编码，必须能解释当前 flow 允许哪些恢复点。
- B3/B5: 任务中心可以从 `controlState.recoveryContract` 读取 flow 的默认恢复点、当前恢复点、可恢复 event 和用户检查建议。
- C4: recovery contract 有单元测试覆盖，API 详情也验证会投影给任务详情。

### 用户视角判定

本切片把原先散落在 `TaskControlPolicy` 里的 resume point 表抽成 `flowRecoveryContract`：

- `ingest`: `ingest_precheck` / `ingest_commit`
- `scrape`: `scrape_precheck` / `scrape_executing` / `scrape_write_metadata` / `scrape_review`
- `transcode`: `transcode_precheck` / `transcode_executing` / `transcode_replace`
- `upgrade`: `upgrade_precheck` / `upgrade_planning` / `upgrade_executing` / `upgrade_pre_replace_verify` / `upgrade_replace`
- `delete`: `delete_precheck` / `delete_executing`

每个恢复点现在至少包含：

- `label`: 任务中心可展示的 event 名称；
- `retryStrategy`: `restart_step` / `resume_step` / `user_gated` 等恢复策略；
- `idempotency`: 当前恢复点对幂等性的最低说明；
- `userAction`: 失败时用户应检查或确认的方向。

`TaskControlPolicy.buildTaskRecoveryPlan()` 继续保持原有 retry 行为和错误码，但它现在消费同一份 flow contract。任务详情的 `controlState.recoveryContract` 会告诉前端：这个 flow 是否有恢复合同、默认恢复点是什么、当前恢复点是什么、最大重试次数是多少、有哪些合法恢复点。

### 后端事实来源

- `media-service/src/flowRecoveryContract.js`
  - 新增当前 flow recovery contract。
  - 提供 `buildRecoveryPlan()` 和 `buildContractProjection()`。
- `media-service/src/taskControlPolicy.js`
  - 删除本地硬编码 resume point 表。
  - `controlState` 增加 `recoveryContract`。
- `media-service/test/task-model.test.js`
  - 覆盖每个 flow 的恢复点、retry strategy、幂等性说明和未知恢复点拒绝。
- `media-service/test/api-inject.test.js`
  - 验证任务详情会投影 `controlState.recoveryContract`。

### 本地验收

- `node --test test/task-model.test.js --test-name-pattern "flowRecoveryContract"`: pass，41 个测试通过。
- `node --test test/api-inject.test.js --test-name-pattern "actions/retry rejects retry limit"`: pass，111 个测试通过。
- `npm test`: pass，239 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 这只是 recovery contract 的首层事实化；各 flow 的真实幂等行为、部分写入清理、外部请求去重和用户确认点仍需要逐 flow 审计。
- 本切片尚未部署 NAS；生产任务详情的 recovery contract 展示待后续浏览器验收。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 45: Scrape metadataGate failure semantics

### 对应标准

- A2/A5: scrape 执行后如果没有 meet `metadataGate`，必须留在当前 scrape task 的失败/恢复语义里，不能靠 SmartTaskEngine 下一轮再创建一个新 task 来解释。
- B3/B5: 任务中心和 dashboard event 需要能解释“元数据完整性未满足”，并给出当前 task 的失败摘要、缺失项和恢复点。
- C4: completion verification 不能只是旁路快照；如果 scrape 完成态 verification 失败，task 不能被标记为 `done`。

### 审计结果

本轮审计确认了两个问题：

- 普通 Emby repair scrape 已经会在 `metadataStatus.metadataComplete=false` 时失败，但失败原因只记为 warn；因此 `task.failed.failureSummary` 经常为空，任务中心只能看到 failed_hard，看不到“为什么 metadataGate 没过”。
- `finishScrape()` 原先先把任务标记为 `done`，再写 completion verification snapshot；如果 snapshot 失败，task 仍保持 `done`。这会破坏顶层心智：scrape 阶段没过 exit gate 时不应该进入后续 optimize candidate。

### 本切片修复

- `scrapeFlowExecutor` 新增统一的 `recordScrapeGateFailure()`：
  - 写入 `scrapeVerification.ok=false`；
  - 写入 `metadataGateFailure`，包含 `metadataMissingReasons` / `failureCodes` / `recovery` / `userAction`；
  - 写入 error log，使 `task.failed.failureSummary` 能被任务中心读取；
  - 追加 `scrape.metadata_gate_failed` event；
  - 保留 `resumePoint=scrape_executing`，表示 retry/resume 仍属于当前 scrape flow。
- 普通库半假 scrape 在 repair 后仍未满足 `metadataGate` 时，不再只是 warn，而是明确成为当前 scrape task 的 gate failure。
- `finishScrape()` 改为先跑 completion verification；verification 不通过时直接失败，不再标记 `done`。
- `taskStore.createTask()` 现在保留传入的 `phase` / `resumePoint` / `progress`。这个小修复是为了让恢复任务和恢复测试可以准确从指定 resume point 开始，而不是默默退回 precheck。
- dashboard event label 增加 `scrape.metadata_gate_failed -> 元数据完整性未满足`。

### 后端事实来源

- `media-service/src/scrapeFlowExecutor.js`
  - 新增 scrape gate failure 记录。
  - 普通 Emby repair gate failure 进入同一失败路径。
  - completion verification 从 done 后快照改为 done 前 exit gate。
- `media-service/src/taskStore.js`
  - `createTask()` 保留初始运行时恢复字段。
- `media-service/src/app.js`
  - dashboard task event label 增加元数据完整性未满足。
- `media-service/test/api-inject.test.js`
  - 覆盖普通库 repair 后仍缺 `identity.providerId` 时，当前 scrape task failed_hard、保留 resume point、记录 gate event 和 failureSummary。
  - 覆盖 scrape review 末端 completion verification 失败时，task 不会被标记 done。

### 本地验收

- `npm test -- --test-name-pattern "standard scrape fails current task|scrape completion verification blocks done|scrape failure marks item failed_hard"`: pass；由于当前 npm/node-test 参数转发方式，本次实际跑到了全量 service 测试，241 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产中的普通库 repair scrape 和成人 scrape 还需要部署后从任务中心挑具体样本复核。
- 这只补了 scrape exit gate 的失败事实化；每个 flow 的 retry 幂等性、部分写入回滚和用户确认策略还需要继续逐 flow 设计。
- P0-1 仍未完整关闭：下一步应继续审计每一种库类型下的 task lifecycle，并在生产样本上确认任务中心展示是否符合用户心智。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Pending Findings During P0-1 Audit

### P0 服务 degraded / 后台刷新错峰问题（待修复，非 P0-1 主线）

生产只读排查时发现：

- `GET /v1/health`: `yellow`。
- `GET /v1/admin/health`: `yellow`。
- 降级来源是 `mediaLib.status=yellow`，`staleSubLibraries=["公共_剧集","公共_国产剧"]`。
- `GET /v1/library/status` 显示：
  - `公共_电影_原生` 最近刷新于 `2026-06-30T04:57:47.867Z`；
  - `公共_剧集` 最近刷新于 `2026-06-30T02:58:26.901Z`；
  - `公共_国产剧` 最近刷新于 `2026-06-30T02:58:33.188Z`。
- Docker logs 显示同一轮定时刷新中，多个 Emby 子库 refresh 同时触发；`BackgroundIoGuard` 只允许一个 `mediaLibrary.refresh` 运行，另外两个被 `lock_busy` skipped：
  - `公共_电影_原生` refresh 正常运行并完成；
  - `公共_剧集` / `公共_国产剧` refresh 被 skipped，后续没有补偿重试，因此逐渐 stale。
- 同一轮还观察到 `GET /v1/admin/dashboard/health` 在生产上出现约 3s 到 13s 响应；`GET /v1/admin/tasks/lifecycle-audit` 在部分全量查询下约 11s。

归因判断：

- 该问题不是当前 P0-1 新业务模型不满足导致的。
- 它属于 P0 服务 degraded / P0 资源与性能问题：后台刷新定时器和 Background I/O Guard 的调度关系不合理，导致健康状态降级，并可能影响 Dashboard / audit 查询体感。
- 按用户 2026-06-30 修正规则，本问题先记录为待修复，不抢 P0-1 业务流程模型审计主线。

后续修复方向（待做）：

- 不应简单放开并发打 Emby。
- 应让 Emby 子库 refresh timer 错峰或进入串行队列，并对 `lock_busy` skipped 的 refresh 做补偿重试。
- Dashboard health / lifecycle audit 的慢查询需要单独回到 C1/C4 性能标准下做 SQL/projection 硬化。

## 2026-06-30 Slice 46: Closed task recovery state cleanup

### 对应标准

- A5: 任务生命周期必须能清晰解释当前 task 是否仍可恢复、是否需要用户确认、是否已经闭合。
- B3/B5: 任务中心不应在成功闭合任务上继续展示 retry/resume 语义，避免用户误判这个 task 仍处在执行中或可恢复中。

### 审计结果

生产只读审计时发现 delete 任务列表中存在大量 `done` task 仍保留 `resumePoint=delete_executing`：

- `/v1/admin/tasks?actionType=delete&pageSize=12`: total 42，样本均为 `status=done`。
- 样本任务包括 `f2ea3ba67b32e6d5`（ABP-001）、`0a8501c2d9162ecb`（TR-001）等。
- 这些任务已经是 `phase=done`、`bridgeKind=archive`、`flowDirection=archive.delete`、`operationKind=delete`、`primaryResourceType=filesystem`，但仍携带 `resumePoint=delete_executing`。

判断：

- 这是 P0-1 新业务模型下的生命周期语义问题。
- `resumePoint` 是失败、暂停、中断或用户确认态的恢复上下文；成功闭合 task 不应该继续携带恢复点。
- 否则任务中心会把一个已经完成的 archive/delete bridge 表达成仍有执行恢复点，破坏 `task = lifecycle 转换桥梁` 的心智。

### 本切片修复

- `taskScheduler.reportStatus()` 增加闭合状态统一清理：
  - `done`
  - `skipped`
  - `cancelled`
  - `deleted`
- 当 task 进入上述闭合状态时，统一清理：
  - `resumePoint=null`
  - `approval=null`
- `failed_hard` 等失败状态不清理 `resumePoint`，因为它们仍需要保留当前 flow 的恢复上下文。

### 后端事实来源

- `media-service/src/taskScheduler.js`
  - 新增 closed status 集合。
  - 在 `reportStatus()` 中集中清理闭合 task 的恢复/确认状态。
- `media-service/test/priority-api.test.js`
  - 覆盖 `done` task 会清理 `resumePoint` 和 `approval`。
  - 覆盖 `failed_hard` task 会保留 `resumePoint`。

### 本地验收

- `npm test -- --test-name-pattern="taskScheduler clears resume state"`: pass；由于当前 npm/node-test 参数转发方式，本次实际跑到了全量 service 测试，242 个测试通过。

### 尚未满足

- 本切片尚未部署 NAS；生产中既有 `done` task 的历史脏字段不会自动回填清理，部署后需要确认新闭合 task 不再保留 `resumePoint`。
- P0-1 仍未完整关闭：还需要继续按库类型审计 `ingest -> scrape -> optimize -> archive` 下每类 task 的 lifecycle 是否符合新业务模型。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 47: Initial strategy placeholder is not lifecycle closure

### 对应标准

- A2/A3: 媒体生命周期必须遵循 `ingest -> scrape -> optimize -> archive` 的用户心智，不能因为内部默认字段把未完成阶段误投影为已闭环。
- B3/B5: 媒体库和任务中心看到的生命周期状态必须能解释“为什么没有进入下一阶段”，而不是把“新入库占位策略”显示成归档完成。

### 审计结果

本轮继续审计 `SmartTaskEngine` / `lifecycleProjection` / `StrategyEngine` 时发现：

- 新入库普通 Emby item 默认写入 `action=keep`、`reason=新入库`。
- 成人文件夹新入库 item 也可能写入 `action=keep`、`reason=成人库新入库`。
- `lifecycleProjection.resolveLifecycle()` 原先只要看到 `metadataComplete=true` 且 `action` 为空、`keep` 或 `none`，就直接投影为：
  - `lifecycleStage=archived`
  - `lifecycleDone=true`
  - `archiveStatus=archived_like`
  - `lifecycleReason=strategy_keep`

判断：

- 这是 P0-1 新业务模型问题。
- 真正由策略计算得出的 `keep` 可以作为 archive-like closure；这是 v3.0.1 已接受的投影闭环。
- 但 `新入库` / `成人库新入库` 是策略尚未认真计算前的占位状态，不是 optimize 阶段的结果。
- 如果一个 item 已显示“元数据完整”，但只是因为默认 `keep/新入库` 被投影为 archived，用户会误以为它已经走完 optimize/archive，实际系统只是还没完成策略计算。

### 本切片修复

- `lifecycleProjection` 新增初始策略占位识别：
  - `action` 为空或 `none`：`strategy_missing`；
  - `action=keep` 且 `reason=新入库` / `成人库新入库`：`strategy_pending`。
- 上述状态不再闭环，而是投影为：
  - `lifecycleStage=metadata_ready`
  - `lifecycleDone=false`
  - `archiveStatus=not_ready`
  - `lifecycleNextTask=optimize`
- 明确策略产出的 `action=keep` 仍保持 `archived_like`，不创建 keep task，也不改变既有 keep 闭环模型。

### 后端事实来源

- `media-service/src/lifecycleProjection.js`
  - 拆分初始占位 keep 与真实策略 keep。
- `media-service/test/task-model.test.js`
  - 覆盖 `keep/新入库` 不再 closed，而是 `metadata_ready -> optimize`。
  - 覆盖 `action` 为空时是 `strategy_missing`，不再 closed。
  - 覆盖明确策略 keep 仍为 `archived_like`。
  - 覆盖 SQLite lifecycle query 中，新入库占位 keep 落在 open 集合，明确策略 keep 落在 done 集合。

### 本地验收

- `node --test test/task-model.test.js --test-name-pattern "lifecycleProjection|libraryStore persists v3 media lifecycle facts"`: pass；由于当前 node:test name pattern 运行方式，本次实际跑到 `task-model.test.js` 全量，41 个测试通过。
- `npm test`: pass，242 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产中已持久化的 lifecycle SQL facts 需要部署后通过刷新/策略重算或后续迁移刷新投影。
- P0-1 仍有模型问题待继续收敛：`SmartTaskEngine` 仍在触发器内部硬编码 `watched=true`、`item.action`、`reason !== 新入库` 等 optimize trigger 条件。这个问题同样来自旧模型，不属于性能支线；后续需要把它从“聪明决策器”继续收敛成“只看 lifecycle gate 的任务触发器”。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 48: Watched is not a hidden SmartTask optimize gate

### 对应标准

- A2/A3: `metadataComplete` 在用户语义下应表示 scrape 阶段完成，并且媒体具备进入 optimize 阶段的前置条件。
- A4: SmartTaskEngine 在新模型下应是任务触发器，不应把业务策略条件硬编码在触发器内部。
- B3/B5: 如果用户希望“只处理已观看媒体”，这个条件应来自子库 metadata gate / 策略模板 / 自动化配置，而不是隐藏在后台触发器里。

### 审计结果

继续审计 `SmartTaskEngine.buildCandidate()` 时发现：

- 当 item 已经 `metadataComplete=true`，且策略已产出 `action=transcode/upgrade/delete` 时，SmartTask 仍额外要求 `item.watched === true`。
- 这意味着一个媒体即使已经显示“元数据完整”，并且策略已明确要求 optimize，只要未观看，就完全不会成为 optimize candidate。
- 该行为没有独立配置入口，也不会在任务中心以明确 gate/配置阻断展示出来。

判断：

- 这是 P0-1 新业务模型问题。
- `watched` 可以是策略输入，也可以是用户自定义 metadata gate 的字段；但不应该是 SmartTask 触发器的隐藏全局门槛。
- 当前 `metadataStatus` 仍可校验 `decision.watched` 是否“已知”，即 true/false 都可满足；是否“必须已看过”应由策略模板表达，例如规则条件要求 `watched=true`。

### 本切片修复

- 移除 `SmartTaskEngine.buildCandidate()` 中 `if (!item.watched) return null` 的隐藏 optimize gate。
- SmartTask 对 optimize candidate 的判断变为：
  - metadata gate 已满足；
  - strategy 已产出非 `keep` 的 action；
  - action 在 `smartTaskEnabledActions` allow-list 中；
  - 仍经过 TaskAdmission 的 active 去重、cooldown、queue limit 和已完成优化检查。
- 更新 SmartTask 注释：它扫描的是满足 lifecycle gate 且有推荐 action 的 item，而不是“watched + rated”的旧模型。

### 后端事实来源

- `media-service/src/smartTaskEngine.js`
  - 移除 hidden watched gate。
  - 更新模块说明。
- `media-service/test/task-model.test.js`
  - 覆盖 metadata complete、`watched=false`、策略已产出 `transcode` 的媒体会创建 optimize task candidate。

### 本地验收

- `node --test test/task-model.test.js --test-name-pattern "smartTaskEngine"`: pass；由于当前 node:test name pattern 运行方式，本次实际跑到 `task-model.test.js` 全量，42 个测试通过。
- `npm test`: pass，243 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产当前如果 `smartTaskEnabledActions` 包含 optimize action，部署后 optimize candidate 范围可能扩大，需要结合队列上限和生产观察窗口验证。
- P0-1 仍未完整关闭：SmartTask 仍直接消费 `item.action` 作为 operation，后续还要继续收敛“触发 task”和“选择 flow/operation”的边界。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 49: Automatic trigger decision moves to BusinessFlowPolicy

### 对应标准

- A1: 后端必须能为媒体 item 给出统一的 v3 用户视角决策结果，避免 TaskAdmission、SmartTask、Admin Web 各自维护互相矛盾的规则。
- A3: SmartTaskEngine 应是任务触发器，不应在自身内部决定普通 repair、成人 scrape 或 optimize operation 的业务规则。
- A4: 自动入口仍必须经过 TaskAdmission；本切片不改变 admission、priority、scheduler 或 executor 行为。

### 审计结果

Slice 48 移除了 SmartTask 的隐藏 `watched=true` 门槛后，继续发现：

- `SmartTaskEngine.buildCandidate()` 仍直接读取 `metadataStatus`、`item.action`、`item.source`、`item.type`、成人 `scrapeStatus` 来决定候选 operation。
- 这些判断本质上属于“这个 item 当前是否该触发下一座 lifecycle task，以及推荐 operation 是什么”，不应该散落在 SmartTask 触发器内部。
- 如果继续让 SmartTask 自己判断，后续 TaskAdmission、媒体页 `businessFlowDecision`、手动 intent API 很容易重新长出互相不一致的规则。

判断：

- 这是 P0-1 新业务模型问题。
- 本切片先不试图一次性完成 optimize task 与 flow selection 的完整重构；先把自动触发决策收敛进 `BusinessFlowPolicy`，让 SmartTask 只消费结果。

### 本切片修复

- `businessFlowPolicy` 新增 `resolveAutomaticTrigger()`：
  - 非 `emby` / `adult_folder` source 不触发；
  - `series` container 不触发；
  - metadata gate 未满足时：
    - 普通 Emby item 触发 `metadata/scrape` repair candidate；
    - 成人 item 仅 `scraped !== true` 且 `scrapeStatus` 为空或 `pending` 时触发 `metadata/scrape`；
    - 对未启用的 operation 返回 `action_not_enabled`；
  - metadata gate 已满足时：
    - `keep` / 空 action 不触发；
    - 非支持 operation 返回 `unsupported_recommended_operation`；
    - 支持且已启用的 strategy operation 返回对应 bridge，例如 `transcode -> optimize`。
- `SmartTaskEngine.buildCandidate()` 不再直接判断上述业务规则，只调用 `businessFlowPolicy.resolveAutomaticTrigger()`。
- SmartTask 仍保留自身职责：
  - 读取候选池；
  - 应用现有 lookback / maxPerRun / queue cap；
  - 计算 priority；
  - 再走 TaskAdmission；
  - 创建 task。

### 后端事实来源

- `media-service/src/businessFlowPolicy.js`
  - 新增自动触发决策函数。
- `media-service/src/smartTaskEngine.js`
  - 删除本地 `isRetryableMissingMetadata()` / `isAutoMetadataCompletionCandidate()`。
  - 自动候选生成改为消费 `BusinessFlowPolicy` 结果。
- `media-service/test/task-model.test.js`
  - 覆盖普通 metadata repair trigger 不在 SmartTask 内部判断；
  - 覆盖 metadata complete + strategy action 产生 optimize trigger；
  - 覆盖未启用 operation 由 policy 返回 `action_not_enabled`；
  - 保留现有 SmartTask 自动 scrape / transcode / ingest 用例。

### 本地验收

- `node --test test/task-model.test.js --test-name-pattern "businessFlowPolicy|smartTaskEngine"`: pass；由于当前 node:test name pattern 运行方式，本次实际跑到 `task-model.test.js` 全量，45 个测试通过。
- `npm test`: pass，246 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产自动触发行为仍需与 Slice 47/48 一起在观察窗口验证。
- P0-1 仍未完整关闭：SmartTask 仍有 `smartTaskLookbackDays` / `ratingTs` 这类 trigger-pressure 旧逻辑，它不是本切片修复范围；后续需要判断它是业务模型问题还是资源刹车/扫描节奏问题。
- 手动 optimize intent 仍会在没有 preferredOperation 时从 `item.action` 推导 operation；这是手动入口模型的后续 P0-1 点，不混入本切片。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 50: Remove hidden SmartTask rating lookback gate

### 对应标准

- A3: SmartTaskEngine 是任务触发器，只应判断 lifecycle gate 是否满足并创建候选，不应藏有额外业务 gate。
- A4: 自动任务仍必须经过 TaskAdmission；本切片不改变 admission、queue cap、priority 或 executor。
- P0-1 新模型：metadata gate 已满足且策略给出 optimize operation 的媒体，应成为 optimize candidate；资源不足时应由 Resource View/Governor 明确阻止 trigger，而不是用评分更新时间静默过滤。

### 审计结果

Slice 49 后继续检查 SmartTask 触发链路，发现 `SmartTaskEngine.buildCandidate()` 仍有旧逻辑：

- 服务首次扫描或长时间暂停后恢复时，普通库 optimize candidate 会读取 `userRatingUpdatedAt` / `doubanRatingUpdatedAt`。
- 如果评分更新时间早于 `smartTaskLookbackDays`，candidate 会被直接丢弃。
- 这个判断只作用于普通 optimize candidate，不作用于 scrape candidate，也不是 TaskAdmission 的显式拒绝原因。

判断：

- 这是 P0-1 新业务模型问题。
- 它不是资源视图刹车，也不是下游 flow 重试策略；它会让 metadata gate 已满足、策略已给出 optimize action 的媒体静默停在 lifecycle 中间，破坏“元数据完整就应进入 optimize candidate”的用户心智。

### 本切片修复

- 删除 SmartTask 内部的 `smartTaskLookbackDays` / `ratingTs` 候选过滤。
- SmartTask 候选生成现在只消费 `BusinessFlowPolicy.resolveAutomaticTrigger()` 的业务决策，然后继续走现有：
  - queue cap；
  - `smartTaskMaxPerRun`；
  - PriorityEngine 排序；
  - TaskAdmission；
  - task creation。
- `smartTaskLookbackDays` 配置字段暂时保留兼容，但不再作为 lifecycle trigger gate。

### 后端事实来源

- `media-service/src/smartTaskEngine.js`
  - `buildCandidate()` 删除 first/resume + rating timestamp 过滤。
  - 扫描循环不再计算 `lookbackCutoff` / `isFirstOrResume`。
- `media-service/test/task-model.test.js`
  - 新增回归用例：评分/刷新时间超过 lookback 的 metadata-complete 媒体，仍会触发 optimize candidate。

### 非 P0-1 待修记录

- Admin Web/System Config 里仍展示 `smartTaskLookbackDays`。这不是本次业务流程不满足的根因修复项，而是历史配置语义遗留；应在后续前端语义/P1 配置整理中删除、隐藏或重新定义。

### 本地验收

- `node --test test/task-model.test.js --test-name-pattern "rating lookback|smartTaskEngine"`: pass；由于当前 node:test name pattern 运行方式，本次实际跑到 `task-model.test.js` 全量，46 个测试通过。
- `npm test`: pass，247 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS；生产自动触发行为仍需与 Slice 47/48/49 一起在观察窗口验证。
- P0-1 仍未完整关闭：手动 optimize intent 仍会在没有 preferredOperation 时从 `item.action` 推导 operation；optimize task 下具体 flow 选择边界还需要继续收敛到策略/规划层。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 51: Extract lifecycle task planning from policy/admission

### 对应标准

- A3: Task Management 只管理任务实例，不应决定一个 lifecycle task 走哪个 flow。
- A4: 自动任务创建仍必须经过 TaskAdmission；本切片不改变 queue cap、priority、scheduler 或 executor。
- P0-1 新模型：`task = lifecycle 状态转换桥梁`，`flow = task 内部 event 编排`；flow/operation 选择需要收拢到 planning 层，而不是 SmartTask 或 TaskAdmission。

### 审计结果

Slice 49/50 后，SmartTask 已基本变成 trigger，但继续检查手动创建和自动触发链路发现：

- `TaskAdmission` 本身已经很薄，只调用 `BusinessFlowPolicy`。
- `BusinessFlowPolicy` 仍直接解析 manual intent、读取 `item.action`、并调用 `flowPlanner.planFlow()`。
- 这会让代码边界看起来像是 policy/admission 仍在决定 optimize task 到底走 `transcode` 还是 `upgrade` flow。

判断：

- 这是 P0-1 新业务模型问题，但本切片不做数据库层 `actionType` 大迁移。
- 当前更合适的最小切片是先把“lifecycle intent / strategy result -> operation / flow plan”的职责抽成明确 planner，让 TaskAdmission、SmartTask 和 BusinessFlowPolicy 都消费规划结果。

### 本切片修复

- 新增 `lifecycleTaskPlanner`：
  - 定义 lifecycle bridge 支持的 operation：`metadata -> scrape`、`optimize -> transcode/upgrade`、`archive -> delete`；
  - 解析手动 task intent；
  - 从策略结果选择 operation，并标记 `planningMode: strategy_result`；
  - 统一封装 operation 到 `flowPlan` / `taskBridge` 的规划入口。
- `BusinessFlowPolicy` 改为委托 planner：
  - `resolveManualOperationIntent()` 不再内联解析；
  - 自动 optimize trigger 不再直接读取 `item.action` 做 flow selection，而是消费 planner 的 strategy operation 结果；
  - `evaluateOperation()` 不再直接调用 `flowPlanner.planFlow()`。
- 外部行为保持兼容：当前 task 仍以 legacy `actionType` 存储具体 operation，后续再评估是否需要更大的数据模型迁移。

### 后端事实来源

- `media-service/src/lifecycleTaskPlanner.js`
  - 新增 lifecycle task planning 边界。
- `media-service/src/businessFlowPolicy.js`
  - 移除内联 manual intent 解析和直接 flowPlanner 调用。
- `media-service/test/task-model.test.js`
  - 覆盖 planner 从 strategy result 选择 optimize flow；
  - 覆盖自动 trigger 暴露 `planningMode: strategy_result`。

### 本地验收

- `node --test test/task-model.test.js --test-name-pattern "lifecycleTaskPlanner|businessFlowPolicy|smartTaskEngine"`: pass；由于当前 node:test name pattern 运行方式，本次实际跑到 `task-model.test.js` 全量，47 个测试通过。
- `npm test`: pass，248 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS。
- P0-1 仍未完整关闭：数据层和 API 层仍保留 legacy `actionType=transcode/upgrade/delete/scrape`，只是通过 `taskBridge` / `flowPlan` 明确了 lifecycle/flow 分层；是否升级为一等 `taskKind=metadata/optimize/archive` 仍需后续评估。
- Flow recovery contract 仍只是初步目录化，各 flow 失败重试语义还没有逐类补齐。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 52: Scrape completion requires verified exit gate

### 对应标准

- A3: `metadataGate` 是 scrape exit gate，不是 scrape trigger。
- A4: scrape task 执行后必须由当前 flow 给出成功、失败、恢复或用户确认语义，不能靠 SmartTask 下一轮重新创建 scrape task 来补救。
- P0-1 新模型：scrape task 只有在能证明 exit gate 通过时才能进入 `done`。

### 审计结果

继续审计 scrape lifecycle 后确认：

- 普通 Emby repair 主路径已在 `runEmbyExecuting()` 后校验 `metadataStatus.resolveMetadataStatus()`；
- 成人 scrape 主路径已在 `finishScrape()` 里通过 `scrapeVerification.verifyScrapedItem()` 做 completion snapshot；
- 当 verification 明确返回 `ok:false` 时，当前 task 会进入 `failed_hard`，并记录 `scrape.metadata_gate_failed`。

但还有一个漏洞：

- 如果 completion verification 过程本身抛异常，旧代码只写 warn log，然后 `finishScrape()` 继续把 task 标记为 `done`。
- 这等价于“无法证明 metadataGate 通过时仍然完成 scrape”，违反 scrape exit gate 模型。

判断：

- 这是 P0-1 新业务模型问题。
- 它不是性能问题，也不是前端语义问题，不应仅记待修。

### 本切片修复

- `captureCompletionVerification()` 捕获异常时不再返回 `null`。
- 异常会被转换为明确的 verification snapshot：
  - `ok: false`
  - failure code: `verification.exception`
  - `metadataMissingReasons: ['verification.exception']`
  - `source: completion_snapshot`
- `finishScrape()` 因此会走现有 `recordScrapeGateFailure()` 路径：
  - task 进入 `failed_hard`；
  - phase 进入 `failed_hard`；
  - resumePoint 保留为 `scrape_executing`；
  - 记录 `scrape.metadata_gate_failed`；
  - 用户可以从失败点修复/重试。

### 后端事实来源

- `media-service/src/scrapeFlowExecutor.js`
  - verification exception 现在会成为失败的 completion snapshot。
- `media-service/test/api-inject.test.js`
  - 新增回归用例：completion verification 抛异常时 scrape task 不能进入 `done`。

### 本地验收

- `node --test test/api-inject.test.js --test-name-pattern "scrape completion verification"`: pass；由于当前 node:test name pattern 运行方式，本次实际跑到 `api-inject.test.js` 全量，114 个测试通过。
- `npm test`: pass，249 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS。
- P0-1 仍未完整关闭：各 flow 的 recovery contract 仍需逐类补齐，尤其是 precheck/executing/write/review 每个阶段失败后的用户动作与幂等边界。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 53: Preserve resume point during restart recovery

### 对应标准

- A3: `flow` 是 task 内部 event 编排；失败、中断和恢复必须属于当前 task 的 flow 语义。
- A4: Scheduler 执行已经确定的 flow event 编排，不应在恢复时丢失 flow recovery contract 给出的恢复点。
- P0-1 新模型：服务重启导致的 interrupted task 应从 flow contract 对应的 resumePoint 继续，而不是静默退回 flow start。

### 审计结果

Slice 52 后继续审计失败/中断恢复链路，确认：

- 手动 `POST /v1/tasks/:id/actions/retry` 已经会保留 failed task 的 `resumePoint`；
- 但 scheduler 在服务重启后自动恢复 `interrupted` task 时，会把 `resumePoint` 清空；
- 同一轮 dispatch 前的 queued runtime cleanup 也会清空普通 queued task 的 runtime state。

判断：

- 这是 P0-1 新业务模型问题。
- 如果一个 task 在 `transcode_executing` / `upgrade_executing` / `scrape_executing` 等阶段中断，恢复时丢掉 `resumePoint` 会让 flow 从默认 precheck 重新开始，违背“失败重试/恢复属于 task 内部 flow”的模型。

### 本切片修复

- `taskScheduler` 的 interrupted restart recovery 改为读取 `flowRecoveryContract.buildRecoveryPlan(task)`。
- 自动恢复 queued task 时保留 `recoveryPlan.resumePoint`。
- 对存在 resumePoint 的恢复任务设置 `manualExecuteRequested=true`，使 queued runtime cleanup 不会再次清掉恢复点。
- `task.restart_recovery_queued` 事件和 diagnostic log 记录实际恢复点：
  - `resumePoint`
  - `effect: queue_interrupted_task_from_resume_point` 或 `queue_interrupted_task_from_flow_start`

### 后端事实来源

- `media-service/src/taskScheduler.js`
  - interrupted recovery 不再清空 resumePoint。
- `media-service/test/priority-api.test.js`
  - 更新 restart recovery 用例，断言 `transcode_executing` 恢复点被保留，且 recovery event 记录恢复点。

### 本地验收

- `node --test test/priority-api.test.js --test-name-pattern "restart recovery|retry|resume state"`: pass，14 个测试通过。
- `node --test test/api-inject.test.js --test-name-pattern "actions/retry|recovery"`: pass；由于当前 node:test name pattern 运行方式，本次实际跑到 `api-inject.test.js` 全量，114 个测试通过。
- `npm test`: pass，249 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS。
- P0-1 仍未完整关闭：各 flow 的 contract 当前仍偏目录化，后续还需要逐 flow 审计“每个 resumePoint 是否真的幂等且从正确步骤继续”。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 54: Add transcode verify recovery point

### 对应标准

- A2: transcode 必须能解释当前 lifecycle、flow operation、phase/event，以及失败后如何恢复。
- A5: retry/resume 不能只是按钮，必须从正确的 flow phase 继续，并保留 event/resource 语义。
- P0-1 新模型：失败重试/恢复属于当前 task 内部 flow；恢复契约必须和 executor 的真实事件编排一致。

### 审计结果

继续审计 transcode flow recovery contract 后确认：

- `transcodeFlowExecutor` 的真实 flow 包含 `precheck -> executing -> verify -> replace`；
- `flowRecoveryContract` 只登记了 `transcode_precheck`、`transcode_executing`、`transcode_replace`；
- executor 的 `driveTask()` 也没有处理 `resumePoint=transcode_verify`。

判断：

- 这是 P0-1 新业务模型问题。
- 它不是性能问题，也不是前端语义问题。
- 如果转码已经产出 partial output，但在 verify 阶段失败或服务中断，旧恢复契约会让 retry 从 `transcode_executing` 继续，存在重新编码 partial output 的风险；用户看到的是同一个 task 在恢复，却实际退回到了更早的资源消耗节点。

### 本切片修复

- `flowRecoveryContract` 新增 `transcode_verify`：
  - `retryStrategy: resume_step`
  - `idempotency: read_only_probe_partial_output`
  - `userAction: inspect_verify_failure`
- `transcodeFlowExecutor.driveTask()` 支持从 `transcode_verify` 直接恢复。
- `runExecuting()` 在编码完成后、进入 verify 前持久化 `resumePoint=transcode_verify`。
- `runVerify()` 在自动通过 replace 确认后、进入 replace 前持久化 `resumePoint=transcode_replace`。
- 新增回归测试，证明 `resumePoint=transcode_verify` 时：
  - 不会再次调用 `startEncode()`；
  - 会直接 probe partial output；
  - replace 自动通过时可以完成任务；
  - 任务完成后清理 `resumePoint`。

### 后端事实来源

- `media-service/src/flowRecoveryContract.js`
  - transcode recovery contract 现在覆盖真实 verify 阶段。
- `media-service/src/transcodeFlowExecutor.js`
  - executor 恢复分派和阶段间 resumePoint 持久化与真实 flow 对齐。
- `media-service/test/api-inject.test.js`
  - 新增 transcode verify 恢复回归用例。
- `media-service/test/task-model.test.js`
  - contract 测试覆盖 `transcode_verify`。

### 本地验收

- `node --check src/transcodeFlowExecutor.js`: pass。
- `node --check src/flowRecoveryContract.js`: pass。
- `node --check test/api-inject.test.js`: pass。
- `node --test test/task-model.test.js --test-name-pattern "flowRecoveryContract"`: pass；由于当前 node:test name pattern 运行方式，本次实际跑到 `task-model.test.js` 全量，47 个测试通过。
- `node --test test/api-inject.test.js --test-name-pattern "transcode resume at verify"`: pass；由于当前 node:test name pattern 运行方式，本次实际跑到 `api-inject.test.js` 全量，115 个测试通过。
- `npm test`: pass，250 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS。
- P0-1 仍未完整关闭：还需要继续审计 upgrade/delete/scrape/ingest 的 recovery contract 是否和 executor 真实步骤完全一致。
- 本次未处理性能问题；如后续审计发现非 P0-1 问题，将先判断是否由新业务模型不满足导致，否则只记录为待修复。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 55: Align transcode verify node attribution with recovery contract

### 对应标准

- A2: transcode 任务中心和 Resource View 必须能解释当前 flow phase/event/resource。
- A5: retry/resume 必须从正确的 flow node 继续，且 task event projection 不能把恢复点误解释成其他节点。
- P0-1 新模型：flow 是 task 内部 event 编排；event/resource 展示、resumePoint 和 executor phase 必须使用同一套节点语义。

### 审计结果

Slice 54 加入 `transcode_verify` 后继续审计 flow planner 与 executor，确认：

- `flowRecoveryContract` 使用 `transcode_verify` 作为恢复点；
- `transcodeFlowExecutor.driveTask()` 已能从 `transcode_verify` 继续；
- 但 `transcodeFlowExecutor.runVerify()` 仍把 phase 写成裸 `verify`；
- `flowPlanner` 的 transcode steps 也仍是 `transcode_precheck -> transcode_executing -> transcode_replace -> verify`。

判断：

- 这是 P0-1 新业务模型问题。
- 它不是性能问题。
- 当任务以 `resumePoint=transcode_verify` 被调度时，`flowPlanner.currentFlowStep()` 会找不到同名 step，进而 fallback 到第一步；任务中心、runtime event 和 Resource View 可能把“从 verify 恢复”显示成错误的 flow node/resource。

### 本切片修复

- `flowPlanner` 的 transcode steps 改为：
  - `transcode_precheck`
  - `transcode_executing`
  - `transcode_verify`
  - `transcode_replace`
- `transcodeFlowExecutor.runVerify()` 写入 `phase=transcode_verify`，和 resumePoint/contract 对齐。
- 新增回归测试，证明 `resumePoint=transcode_verify` 时：
  - `currentFlowStep()` 返回 `phase=transcode_verify`；
  - event type 为 `optimize.transcode.verify`；
  - resource attribution 为 `filesystem`。

### 本轮记录的待审计项

- `upgradeFlowExecutor` 中存在 replace 后 `runVerify()` 函数，但当前代码搜索显示没有实际调用路径；本轮判断它属于 P0-1 recovery/flow contract 后续审计项，需要下一切片继续确认是死代码、缺失节点，还是应纳入 upgrade contract。

### 后端事实来源

- `media-service/src/flowPlanner.js`
  - transcode verify step 命名和 recovery contract 对齐。
- `media-service/src/transcodeFlowExecutor.js`
  - runVerify phase 命名和 resumePoint 对齐。
- `media-service/test/task-model.test.js`
  - 新增 transcode verify node attribution 回归测试。

### 本地验收

- `node --check src/flowPlanner.js`: pass。
- `node --check src/transcodeFlowExecutor.js`: pass。
- `node --check test/task-model.test.js`: pass。
- `node --test test/task-model.test.js --test-name-pattern "flowRecoveryContract|transcode flow plan"`: pass；由于当前 node:test name pattern 运行方式，本次实际跑到 `task-model.test.js` 全量，48 个测试通过。
- `node --test test/api-inject.test.js --test-name-pattern "transcode resume at verify"`: pass；由于当前 node:test name pattern 运行方式，本次实际跑到 `api-inject.test.js` 全量，115 个测试通过。
- `npm test`: pass，251 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- 本切片尚未部署 NAS。
- P0-1 仍未完整关闭：还需要继续审计 upgrade/delete/scrape/ingest 的 recovery contract 是否和 executor 真实步骤完全一致。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 56: Record five-stage four-gate lifecycle model

### 对应标准

- A1: 统一业务决策结果必须基于一致的 lifecycle/gate 模型。
- A2: 每个关键流程都必须能回答当前 lifecycle、下一座 bridge、完成 gate 和失败恢复语义。
- P0-1 新模型：v3.1 正式版必须收口为 5 阶段、4 gate，而不是继续混用 action/task/stage。

### 本轮模型对齐

确认 ShelfDeck 顶层 lifecycle 是 5 个阶段、4 个 gate：

```text
S0 source/discovered
  -- G1 ingest gate -->
S1 ingested
  -- G2 metadata gate -->
S2 metadata-ready
  -- G3 optimize gate -->
S3 optimized
  -- G4 archive gate -->
S4 archived
```

关键边界：

- Stage 是用户语义状态。
- Gate 是进入下一阶段的证明合同。
- Task 是跨 gate 的桥。
- Flow 是 task 内部 event 编排。
- Event 是资源消耗、外部副作用、确认、失败和恢复事实。

### Gate 定义

- `ingest gate`：证明外部候选已经成为 ShelfDeck 可管理 item。v3.1 第一版合同是：稳定 `itemId` 已建立；来源或归属子库明确；source refs / asset identity / 媒体路径 / 外部引用至少有一种可追踪；基础媒体事实已写入，或 probe/读取失败原因已经作为可见事实落库。没有过 gate 的对象只能停在 `source/discovered`，不能表现成可优化媒体。
- `metadata gate`：证明 item 已具备进入 optimize 的用户语义前提，即用户看到的“元数据完整”。它不限于狭义 metadata 字段；子库可自定义，但必须覆盖下游 optimize 策略消费字段。
- `optimize gate`：证明本次 optimize task/flow 声明的处置目标已经达成。Optimize flow 包括 `keep`、`transcode`、`upgrade`、`delete`。delete 属于 optimize gate，不属于 archive gate。转码的成功不是 FFmpeg 跑完，而是输出在宽容差内达到目标码率/编码/可播放/替换等合同。Gate miss 是当前 task 的 flow 结果，是否重试属于 flow retry policy，不属于 SmartTaskEngine 或 TaskAdmission。
- `archive gate`：证明 optimized 之后的本轮 ShelfDeck 处理闭环已经归档。v3.1 第一版合同是：item 已经具备 optimized-like 结果（`keep` 决策成立，或 transcode/upgrade/delete 等 optimize flow 已达成目标）；没有显式 `archiveBlockers`；终态事实和必要摘要可解释。未过 gate 的 item 应停在 `optimized` 并等待 archive bridge，而不是直接显示已闭环。

### 本切片修复

- 更新 `docs/v3/BUSINESS_MODEL_NOTES.md`，把原本粗粒度的主流程改写为 5 stage / 4 gate 模型。
- 明确 `delete` 是 optimize flow。
- 明确 gate miss 的重试策略属于当前 task flow，不属于 SmartTaskEngine / TaskAdmission。
- 明确 TaskManagement 使用 gate 判定结果，但不定义 gate 合同。
- 新增 `media-service/src/lifecycleGateService.js`，落地第一版 `evaluateIngestGate()` / `evaluateArchiveGate()`。
- `lifecycleProjection.resolveLifecycle()` 接入 ingest/archive gate：
  - ingest gate 未过时返回 `lifecycleStage=source_discovered`、`lifecycleNextTask=ingest`；
  - metadata 缺失但 ingest gate 已过时才返回 `lifecycleStage=ingested`；
  - optimized-like 结果存在但 archive gate 被 blocker 阻断时返回 `lifecycleStage=optimized`、`lifecycleNextTask=archive`；
  - keep / optimization done 且 archive gate 通过时才返回 `archived`。

### 本地验收

- `node --check src/lifecycleGateService.js`: pass。
- `node --check src/lifecycleProjection.js`: pass。
- `node --check test/task-model.test.js`: pass。
- `node --test test/task-model.test.js --test-name-pattern "lifecycleProjection|libraryStore persists v3 media lifecycle"`: pass；由于当前 node:test name pattern 运行方式，本次实际跑到 `task-model.test.js` 全量，49 个测试通过。
- `npm test`: pass，252 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。
- `git diff --check`: pass；仅有 Windows 换行提示。

### 尚未满足

- P0-1 后续代码审计要按 4 gate 重排：现有 `metadataStatus` 仍是 metadata gate 核心；`ingest/archive` gate 已有第一版 evaluator；下一步需要补 optimize gate 的事实结构和 evaluator。
- Optimize gate 的目标/宽容差/失败解释还未落代码，尤其 transcode/upgrade/delete/keep 的 acceptance criteria 仍需逐 flow 实现。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。

## 2026-06-30 Slice 57: Implement first optimize gate evaluator

### 对应标准

- P0-1：业务流程必须收口到 5 阶段、4 gate。
- P0-1 新模型：Optimize Gate 证明本次 optimize task/flow 的目标达成，而不是只证明 executor 跑过。
- P0-1 新模型：Optimize gate miss 属于当前 task/flow 结果，默认不能让 SmartTaskEngine / TaskAdmission 自动创建同类重资源任务。

### 本切片修复

- `lifecycleGateService` 新增 `evaluateOptimizeGate()`。
- Optimize Gate 第一版支持：
  - 显式 `optimizeGate` / `optimizationGate` 结果优先；
  - `keep` 作为 no-op optimize flow 通过 gate；
  - `transcode` / `upgrade` / `delete` 必须有对应完成 marker 或显式 gate 事实；
  - 转码按目标码率宽容差 `0.65x - 1.35x` 校验；
  - 升级按目标码率下限 `0.9x` 校验；
  - `h265/hevc`、`h264/avc` 等 codec alias 归一后校验；
  - legacy marker 无目标/观测事实时仍可通过，但会标记为 `legacy_optimization_marker`，避免老数据突然断流。
- `lifecycleProjection.resolveLifecycle()` 接入 Optimize Gate：
  - metadata 已完整但 optimize 未尝试时，仍停在 `metadata_ready -> optimize`；
  - optimize gate 通过后，才进入 archive gate；
  - optimize gate failed 时，停在 `metadata_ready`，`lifecycleNextTask=null`，并输出 `retryPolicy.automaticRetry=false`，避免把重资源 gate miss 表达成可自动反复入队的普通候选。
- Archive Gate 现在复用 Optimize Gate 判断 optimized-like 结果，避免 archive 独立维护另一套 optimize 完成定义。

### 本轮记录的待审计项

- 当前 API / planner / 测试中仍存在 `manual delete task is planned as archive bridge` 语义。这是 P0-1 新模型缺口：delete 应属于 optimize gate，不属于 archive gate。下一切片需要收口 delete 的 bridge intent、flow plan、TaskAdmission 和前端表述。
- 当前 transcode/upgrade executor 尚未把结构化 `optimizeGate` 结果写回 item/task；本切片只是在 projection 层支持显式 gate 和现有 marker/verifyResult。后续需要把 flow executor 的 verify/replace 结果沉淀为稳定事实。

### 后端事实来源

- `media-service/src/lifecycleGateService.js`
  - 新增 Optimize Gate evaluator、目标/观测归一、宽容差校验、默认 retry policy。
- `media-service/src/lifecycleProjection.js`
  - 生命周期推进从裸 `optimizationStatus` 改为使用 `optimizeGate`。
- `media-service/test/task-model.test.js`
  - 新增 pending/pass/fail 三类 Optimize Gate 回归测试。

### 本地验收

- `node --check src/lifecycleGateService.js`: pass。
- `node --check src/lifecycleProjection.js`: pass。
- `node --check test/task-model.test.js`: pass。
- `node --test test/task-model.test.js --test-name-pattern "lifecycleProjection"`: pass；由于当前 node:test name pattern 运行方式，本次实际跑到 `task-model.test.js` 全量，50 个测试通过。
- `npm test`: pass，253 个测试通过。
- `npm run build:web`: pass；Vite 仍提示 `client.ts` 同时被 dynamic/static import，属于既有 chunking warning。

### 尚未满足

- P0-1 尚未关闭：delete 仍有旧 archive bridge 语义，需要下一切片修复。
- Optimize Gate 的事实写入还没有贯穿 transcode/upgrade/delete executor；当前是第一版读模型 evaluator。
- v3.1 总目标仍未完成，不能标记 v3.1 为正式完成。
