# Kairox Engineering Playbook

本文是 Kairox 工程施工规范。它不替代 `KAIROX_ARCHITECTURE.md`，而是把每次改代码前必须遵守的工程术语、分层边界和审计方法固定下来，避免实现过程中被 Mirex 旧模型带跑偏。

开工顺序固定为：

```text
先读 KAIROX_ARCHITECTURE.md
再读 KAIROX_ENGINEERING_PLAYBOOK.md
再读相关代码
最后才改代码
```

## 1. 核心原则

Kairox 的核心不是把旧字段改名，而是改变职责边界。

```text
User Perception writes perception facts
Lifecycle projects gate / objective / eligibility
Task Creator creates target-gate tasks
TaskAdmission admits target-gate tasks
Flow Planner selects flowPlan
Task Scheduler grants a runnable task a tick
Resource Runtime dispatches flow events
Executor executes events
Lifecycle re-evaluates durable facts
```

任何实现如果只是：

```text
actionType -> targetGate
operationKind -> selectedFlow
transcode task -> optimize task with selectedFlow=transcode
```

都只是换皮，不是 Kairox Runtime Cutover。

## 2. 固定术语

| 术语 | 含义 | 允许出现的位置 | 禁止用法 |
| --- | --- | --- | --- |
| `object` | 被生命周期推进的媒体对象或 source candidate | Task、Lifecycle projection、API | 不能用 flow 名称代替 object |
| `targetGate` | task 要跨过的 gate | Task identity、TaskAdmission、Task Creator、UI 主语义 | 不能被 `transcode/scrape/delete` 替代 |
| `gateObjective` | 这个 gate 要达成的目标合同 | Task、Lifecycle objective projection、Flow Planner input | 不能由 Scheduler 或 Executor 临时发明 |
| `flowPlan` | Flow Planner 产出的执行计划 | Task runtime 的 flow 层、Resource Runtime / Executor input | 不能由 Task Creator 预先塞入旧 action 语义 |
| `flowKind` | `flowPlan` 内的实现路径类型 | 只在 Flow Planner output、Resource Runtime / Executor routing、diagnostic 中使用 | 不能作为 task identity、candidate identity、规则模板语义 |
| `flowReview` | Flow Planner 给用户的实现路径建议和确认状态 | optimize task 的 review/confirmation 层、Task Center/API 细节 | 不能替代 task target；不能由 Task Creator 预选 |
| `flowPreference` | 用户希望 Flow Planner 优先考虑的实现路径约束 | 用户确认/修改 proposed flow 后作为 Flow Planner input | 不能直接变成 executor dispatch；不能绕过 safety/authorization |
| `event` | flow 执行中的 durable step | Task event store、Resource Runtime、diagnostic | 不能决定 lifecycle objective |
| `facts` | 持久化事实 | media facts、metadata facts、perception facts、gate facts、event facts | 不能用内存推断替代事实写入 |
| `canonical facts` / 权威事实 | ShelfDeck 当前正式承认的媒体真实状态 | Lifecycle gate 判断、用户展示、Task Creator projection | 不能由非 owner flow 随手改写 |
| `staged facts` / 暂存事实 | flow 产出的待接受结果 | Flow Executor output、Resource Runtime、flow verification | 不能直接当成 Lifecycle gate passed |
| `event evidence` / 执行证据 | 证明 staged facts 可信的执行记录 | Task events、Resource Runtime、diagnostic | 不能替代权威事实 |
| `factRefreshRequest` / 事实刷新请求 | 权威事实过期后的 declarative signal | Flow Executor output、Lifecycle projection input | 不能直接创建 task；不能绕过 Task Creator |
| `refresh` / 刷新 | 用户或系统请求重新观察外部 source 的意图 | API 文案、activity、scan request | 不能是 targetGate、flowKind 或 task type；不能直接写权威事实 |
| `SourceReference` / 来源引用 | 状态 0，对外部 source 的最小引用 | Source Adapter Sync 输出、ingest task object/itemInfo | 不能携带 canonical media/metadata/gate 结论 |

硬边界：

```text
Task / Flow execution result is not Gate achievement.
```

task / flow / runtime 只回答“这次事情有没有做成”；Lifecycle / gate 只回答“当前目标有没有达成”。`transcode`、`upgrade`、`archive`、`delete` 的 attempt failure 必须留在 task status、event evidence、failure context、recovery contract 中，不能被写成 gate failed 来阻塞 lifecycle projection。

重试分层：

```text
Event retry: Resource Runtime / Executor recovery contract 管，同一个 task 内重试 resumePoint，不创建新 task。
Task attempt retry: TaskCreationPolicy / TaskAdmission 管，基于 attemptKey 和 automatic attempt budget 判断是否创建新 task。
Lifecycle gate re-evaluation: Lifecycle 管，只看 canonical facts + gate objective，不看 retryCount。
```

`task.retryCount` 只属于 event retry / recovery，不得作为 Lifecycle gate 判断依据，也不得直接替代 automatic task attempt budget。

## 3. 禁止术语

以下词在 runtime 主路径中属于 Mirex 重力源，新增代码默认禁止。

| 禁止词 | 为什么禁止 | 仅允许场景 |
| --- | --- | --- |
| `actionType` | Mirex task 主身份 | 历史文档、一次性 migration/cutover 输入、负向测试 |
| `operationKind` / `operation_kind` | Mirex runtime 物理身份 | 历史文档、一次性 migration/cutover 输入、负向测试 |
| top-level `selectedFlow` | 容易变成 `operationKind` 换皮 | 迁移期读旧 payload 时可清洗；新 task 不应保存 |
| `preferredFlow` 作为 task 创建参数 | 用户偏好被误当成 task identity | 只能作为 `flowPreference` 进入 Flow Planner replan |
| `selectedOperation` | 把 flow selection 重新命名成 operation | 不新增；已有测试应迁移到 `flowPlan.flowKind` |
| `transcode candidate` / `scrape candidate` / `upgrade candidate` | candidate 主语义错误 | 历史文档 |
| `bySelectedFlow` 作为 candidate 主摘要 | 把 candidate 重新按 flow 归类 | 只可作为已规划 task 的内部诊断，不作为业务摘要 |

命名规则：

```text
Task identity: object + targetGate + gateObjective
Flow identity: flowPlan.flowKind
User flow input: flowReview + flowPreference
Event identity: eventType + taskId + resource facts
```

## 4. Fact Ownership 施工规则

改任何字段、payload、API projection 或 task payload 前，先判断它属于哪一类 fact。字段归属决定谁能写它，也决定 scrape / ingest / perception 的边界。

| Fact 类别 | Canonical owner | 可写权威事实的入口 | 典型字段 | 其他 flow 可做什么 |
| --- | --- | --- | --- | --- |
| `sourceFacts` / `ingestFacts` | ingest gate / ingest flow | `targetGate=ingest` task | `itemId`、`subLibraryId`、`source`、`sourceId`、`path`、`originalPath`、`fileName`、`extension`、`assetRootPath`、`externalRefs`、`size`、`mtime`、`sourceExists` | 只能写 staged facts / evidence / `factRefreshRequest` |
| `mediaFacts` | metadata gate / scrape-probe flow | `targetGate=metadata` task | `duration`、`bitrate`、`codec`、`container`、`resolution`、`audioCodecs`、`subtitleTracks`、`isDiscLike`、`equivalentBitrate`、`bucket` | transcode/upgrade 可产出 output staged facts，但不能直接发布权威事实 |
| `metadataFacts` | metadata gate / scrape flow | `targetGate=metadata` task | `title`、`originalTitle`、`year`、`premiereDate`、`genres`、`studio`、`director`、`actors`、`plot`、`poster`、`fanart`、`nfoPath`、`metadataSource`、`scrapeStatus`、`scrapedAt`、成人库 `adultId` / `censor` / `protagonist` | source adapter 可写 candidate/hint；最终权威事实必须由 metadata task 发布 |
| `userPerceptionFacts` | User Perception Management | perception API / Emby / Douban 私人账号 / 用户手动输入 | `rating`、`ratingSource`、`watched`、`playCount`、`lastPlayedAt`、`favorite`、`manualTier`、`perceptionVersion` | 不能作为 metadata gate required facts |
| `gateFacts` | Lifecycle + 对应 gate verification | Lifecycle projection / gate verification | `ingestGate`、`metadataGate`、`optimizeGate`、`archiveGate`、`deleteGate`、`objectiveHash`、`gatePassedAt`、`gateEvidence` | executor 只能提交 evidence，不能自行推进 lifecycle |

Gate passed 不是“字段全”：

```text
gate passed = required facts complete + required facts fresh + required facts satisfy gate objective
```

执行型 flow 的标准闭环：

```text
Flow Executor
  -> writes staged facts + event evidence
  -> writes factRefreshRequest when canonical facts are stale
  -> never writes transcode/upgrade attempt failure as optimize gate failure
  -> does not create follow-up task

Lifecycle
  -> reads canonical facts + fact freshness + factRefreshRequest
  -> projects next targetGate

Task Creator
  -> creates targetGate task through TaskAdmission

TaskCreationPolicy
  -> limits automatic task attempts by attemptKey
  -> prevents repeated automatic attempts for the same unchanged facts/objective
```

`factRefreshRequest` 不是 task。它只是事实：

```json
{
  "reason": "post_optimize_activation",
  "causedByTaskId": "task-123",
  "affectedFacts": ["sourceFacts", "mediaFacts"],
  "stagedFacts": {},
  "evidence": {}
}
```

当 optimize flow 已完成物理结果但权威事实未刷新时，Lifecycle 应使用：

```text
optimizeGateStatus=pending_canonical_refresh
```

该状态阻止 Task Creator 基于旧 `mediaFacts` 反复创建 optimize task。

## 5. 逻辑组件到物理组件映射

Kairox 的逻辑组件必须落到明确的物理模块。改代码前先确认“这个职责应该在哪个文件里”，再确认当前文件是否允许承载这个职责。

| 逻辑组件 | 当前物理承载 | 目标物理承载 | 下一步动作 |
| --- | --- | --- | --- |
| User Perception Management | `userPerceptionManagement.js`、部分 `app.js`、Douban/Emby 同步入口 | `userPerceptionManagement.js` 作为唯一感知事实入口 | API 只调用它写 perception facts；禁止它创建 task 或选择 flow |
| Lifecycle Gate Evaluation | `lifecycleGateService.js`、`metadataStatus.js`、`optimizationStatus.js`、部分 `lifecycleProjection.js` | `lifecycleGateService.js` + status helpers | 清掉 action / operation / selectedFlow 语义，只按 facts 和 objective 判断 gate |
| Lifecycle Objective Projection | `lifecycleObjectiveResolver.js`、`strategyEngine.js`、`lifecycleProjection.js` | `lifecycleObjectiveResolver.js` + `lifecycleProjection.js` | objective 只表达 target facts，不表达 transcode / upgrade / delete hint |
| Delete Eligibility / Review | `deleteCandidateService.js`、部分 `lifecycleProjection.js` | `deleteCandidateService.js` | 保留为 delete gate review；禁止 delete 回到 optimize |
| Source Adapter / Domain Fact Writer | `adultLibraryService.js`、Emby/Douban/source sync 入口、部分 `app.js` | source-specific adapters + fact writer APIs | 发现 source candidate、写 source/metadata/perception 输入事实；不能 createTask、不能调用 TaskAdmission、不能决定 targetGate 或 flowKind |
| Task Creator | `smartTaskEngine.js`、手动 API in `app.js` | `smartTaskEngine.js` + manual task creation API adapter | 只创建 `object + targetGate + gateObjective` task，不创建 flow task |
| TaskAdmission | `taskAdmission.js`、`taskCreationPolicy.js` | `taskAdmission.js` + `taskCreationPolicy.js` | 准入只看 targetGate、duplicate、cooldown、queue cap、destructive approval |
| Automation Policy | `automationPolicy.js`、`configStore.js` normalize | `automationPolicy.js` | 判断哪些 targetGate 允许自动化；不判断 optimize 选哪条 flow |
| Flow Planner | `flowPlanner.js` | `flowPlanner.js` | 唯一决定 `flowPlan.flowKind=no_op/transcode/upgrade/blocked/scrape/archive/delete` |
| Task Scheduler | `taskScheduler.js` | `taskScheduler.js` | 只选 runnable task、控制 item lock / retry / task 并发；移除 executor routing |
| Resource Runtime | 当前缺失，逻辑散在 `taskScheduler.js`、`runtimeResourceTracker.js`、`resourceProjection.js` | `resourceRuntime.js` | 承接 flowPlan 执行、executor routing、event/resource lease、progress/failure/recovery |
| Resource Projection | `resourceProjection.js`、`runtimeResourceTracker.js` | `resourceProjection.js` | 只做资源视图和诊断 projection，不参与业务决策 |
| Flow Executor | `scrapeFlowExecutor.js`、`transcodeFlowExecutor.js`、`upgradeFlowExecutor.js`、`archiveFlowExecutor.js`、`deleteFlowExecutor.js`、`ingestFlowExecutor.js` | 同上 | 只执行 flow event；不创建 task，不改 targetGate，不决定 next gate；非 fact owner flow 只能写 staged facts / evidence / factRefreshRequest |
| Task/Event Store | `taskStore.js` | `taskStore.js` | 持久化 task、flowPlan、events；清掉顶层 selectedFlow / operationKind / actionType |
| API Adapter | `app.js` | `app.js` | 只做 HTTP 入参/出参映射；业务决策下沉到对应组件 |
| UI Projection | `app.js`、`web/src/*` | API projection + `web/src/*` | 主语义展示 targetGate / objective / lifecycle；flowKind 只做实现路径细节 |

硬约束：

- `taskScheduler.js` 不允许做 executor routing。
- 如果代码需要按 `flowPlan.flowKind` 找 executor，它必须在 `resourceRuntime.js` 或 Flow Executor 内部。
- 如果代码需要决定 optimize 走 `transcode`、`upgrade`、`no_op` 或 `blocked`，它必须在 `flowPlanner.js`。
- 如果代码需要创建 task，它必须走 Task Creator + TaskAdmission + Task/Event Store。
- 如果代码需要防止同一目标自动反复创建 task，它必须在 TaskCreationPolicy，用 attemptKey / automatic attempt budget 表达，不能塞进 Lifecycle。
- 如果一个文件的目标物理承载不包含该职责，不要为了“先跑通”把职责塞进去。

## 6. 下一步目标：Kairox Physical Runtime Cutover

下一步不是继续清字段，而是完成 Kairox 逻辑组件到物理组件的落地：

```text
Task Scheduler 只调度 task
Resource Runtime 负责 flowPlan 执行和 executor routing
Flow Planner 唯一选择 flowKind
Task Creator 只创建 targetGate task
```

### 6.1 新增物理组件

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| Resource Runtime | `media-service/src/resourceRuntime.js` | 读取 `task.flowPlan.flowKind`，路由 executor，管理 event/resource/progress/failure/recovery |
| Automation Policy | `media-service/src/automationPolicy.js` | 判断哪些 `targetGate` 允许自动化，不判断 flow |
| Task Creation Policy | `media-service/src/taskCreationPolicy.js` | duplicate、cooldown、queue cap、destructive approval 等准入策略 |

### 6.2 修改物理组件

| 文件 | 修改目标 |
| --- | --- |
| `taskScheduler.js` | 移除 executor routing，只保留 runnable task selection、item lock、retry、task tick |
| `flowPlanner.js` | 唯一产出 `flowPlan.flowKind`，禁止输出 selectedFlow / operationKind / selectedOperation |
| `smartTaskEngine.js` | 自动 candidate 改为按 `targetGate` 生成和统计，不再有 transcode / scrape / upgrade candidate |
| `taskAdmission.js` | 输入改为 `object + targetGate + gateObjective` |
| `taskStore.js` | task 主体不保存顶层 flow / action / operation 字段；只保存 task identity、flowPlan、events |
| `lifecycleGateService.js` | gate 判断只读 facts / objective，不读 flow / action |
| `lifecycleObjectiveResolver.js` | objective 只表达 target media facts，不表达 flow hint |
| `resourceProjection.js` | 只做资源诊断 projection，不参与调度或业务判断 |
| `app.js` | 只做 API adapter，移除业务决策和 legacy task 字段投影 |
| `web/src/*` | UI 主语义使用 targetGate / objective / lifecycle，flowKind 只做实现路径细节 |

### 6.3 删除或退役物理组件

| 文件/概念 | 处理方式 |
| --- | --- |
| `lifecycleTaskPlanner.js` | 删除。名字和职责都会误导，相关能力迁移到 Flow Planner / Task Creator / policy 模块 |
| `businessFlowPolicy.js` | 删除。拆成 `automationPolicy.js` 和 `taskCreationPolicy.js` |
| 顶层 `SelectedFlow/selectedFlow` | 删除，不作为新 task/runtime/API 字段 |
| `operationKind/operation_kind` | 删除，不作为 runtime 物理身份 |
| `actionType` 主路径 | 删除，只允许历史迁移脚本或负向测试引用 |
| `bySelectedFlow/candidatesBySelectedFlow` | 删除，改为 `byTargetGate/candidatesByTargetGate` |
| “Flow Scheduler” 概念 | 禁止新增。只有 Task Scheduler 和 Resource Runtime |

### 6.4 关键验收

- `taskScheduler.js` 里不能再有 `getFlow()`、executor map 或按 flowKind 调 executor。
- executor routing 只能在 `resourceRuntime.js`。
- optimize task 创建时没有 flow identity。
- Flow Planner 是唯一能决定 `transcode/upgrade/no_op/blocked` 的地方。
- delete 只能是 `targetGate=delete`，不能是 optimize flow。
- P0/P1 审计里 `SelectedFlow/selectedFlow/operationKind/actionType/bySelectedFlow` 为 0，迁移脚本和负向测试除外。

## 7. 分层边界

### User Perception Management

负责：

- 写入 rating、watched、playCount、favorite、manualTier、perceptionVersion。
- 同步 Douban 私人评分、Emby watched/playCount。
- 记录 perception source 和更新时间。

不负责：

- 判断 metadata gate。
- 计算 optimize objective。
- 创建 task。
- 选择 flow。

### Lifecycle

负责：

- 维护 ingest / metadata / optimize / archive / delete gate projection。
- 计算 optimize objective readiness / objective revision。
- 计算 delete eligibility。
- 根据权威事实、fact freshness、fact refresh request 判断 item 当前停在哪个 gate。
- 在权威事实过期时投影需要重新跨过的 targetGate，例如 `ingest` 或 `metadata`。

不负责：

- 创建 task。
- 选择 flow。
- 调度 executor。
- 执行资源操作。
- 刷新 sourceFacts、mediaFacts 或 metadataFacts。

### Source Adapter / Domain Fact Writer

负责：

- 发现外部 source reference，例如 Emby inventory、文件夹 watch root、成人库目录扫描。
- 提供 `observe(sourceRef)` 能力，让 ingest / metadata flow 在执行时实时取证。
- 写入 metadata hint、perception input 等非 canonical 输入事实。
- 提供 domain-specific helper，例如成人库 `adultId` candidate、NFO 读取、light adult metadata split。

不负责：

- 创建 task 或调用 TaskAdmission。
- 判断 Lifecycle gate。
- 选择 scrape / transcode / upgrade / delete flow。
- 发布跨 gate 的权威事实。

成人库模块属于 Source Adapter / Domain Fact Writer。它可以发现文件、reset metadata facts 以便重新进入 metadata gate，但不能自己 enqueue ingest/scrape task。成人库目录扫描只产生 `SourceReference`，不能解析 adultId、生成 UNK、probe 视频技术事实、读取 NFO 或写 canonical media/metadata facts；这些属于 metadata task / scrape flow。

Emby 媒体库 refresh 也属于 Source Adapter / observation 入口。它只能发现：

```text
new_source_observed
source_changed
source_missing
```

这些 observation 必须由 SmartTaskEngine / Task Creator 转成 `targetGate=ingest` 或 `targetGate=metadata` task。`refresh` 本身不能直接调用 canonical fact writer。Emby 中消失的条目只能先写入 `sourceExists=false` / `sourceMissingAt` 这类 source facts，不能直接从 ShelfDeck 删除。`sourceSnapshot` 可以作为可选 observation evidence，但 ingest flow 不能依赖它；ingest flow 必须能凭 `SourceReference` 实时 observe source。

### Task Creator / TaskAdmission

负责：

- 根据 Lifecycle projection 创建 target-gate task。
- 执行 duplicate prevention、cooldown、queue cap、destructive authorization。
- 拒绝时写清楚 targetGate 级别原因。

不负责：

- 为 optimize 预选 transcode / upgrade。
- 自己比较 rating、watched、objectiveHash。
- 绕过 Flow Planner 创建 flow 任务。

Task Creator 创建 optimize task 时，只能表达：

```json
{
  "object": { "type": "media_item", "itemId": "..." },
  "targetGate": "optimize",
  "gateObjective": { "targetMediaFacts": {} }
}
```

不能表达：

```json
{
  "targetGate": "optimize",
  "selectedFlow": "transcode"
}
```

### Flow Planner

负责：

- 读取 task 的 `object + targetGate + gateObjective`。
- 读取 current facts、policy facts、flow safety facts、用户确认后的 `flowPreference`。
- 输出 `flowPlan.flowKind`、steps、resource needs、recovery contract、explanation。

Flow Planner 是唯一能决定 optimize 走以下哪条路径的组件：

```text
no_op
transcode
upgrade
blocked
```

### Flow Review / User Flow Preference

Kairox 允许用户参与 optimize task 的 flow 决策，但用户不能绕过 Flow Planner 直接指定 executor。

正确流程：

```text
用户触发 optimize task
  -> Task 仍然只有 targetGate=optimize + gateObjective
  -> Flow Planner 生成 proposed flowPlan / flowReview
  -> 用户确认 proposed flow，或提交 flowPreference
  -> Flow Planner 用 current facts + gateObjective + flowPreference 重新规划
  -> Resource Runtime 执行 final flowPlan
```

允许保存：

```json
{
  "flowReview": {
    "status": "awaiting_user_decision",
    "proposedFlowKind": "transcode",
    "alternatives": ["upgrade"],
    "explanation": {}
  },
  "flowPreference": {
    "preferredFlowKind": "upgrade",
    "reason": "user_prefers_better_source"
  }
}
```

不允许保存：

```json
{
  "targetGate": "optimize",
  "selectedFlow": "transcode"
}
```

约束：

- `flowReview.proposedFlowKind` 是 Flow Planner 的建议，不是 task identity。
- `flowPreference.preferredFlowKind` 是用户偏好，不是 executor dispatch。
- 用户改选 flow 后必须重新进入 Flow Planner，仍要通过 authorization、safety facts 和 objective gap 检查。
- Resource Runtime 只执行 final `flowPlan.flowKind`。
- API 可以暴露 flow review，但普通任务创建 API 不接受 `selectedFlow/preferredFlow` 作为主语义。

不负责：

- 创建 task。
- 修改 targetGate。
- 发明 gateObjective。
- 绕过 delete review。

### Task Scheduler

负责：

- 选择 runnable task。
- 给 task 一次运行机会，例如进入 executing、处理 retryAt、item lock、task 并发。
- 控制 task 级并发、item lock、retryAt。
- 持久化 flow 返回的 task-level signal。

不负责：

- 重新计算 objective。
- 选择 optimize flow。
- 调度 flow event 或资源。
- 直接调用具体 worker 资源。
- 按 `transcode/scrape/delete` candidate 供给任务。

### Resource Runtime / Executor

负责：

- 读取 `flowPlan.flowKind` 和 flow events。
- 将 event 调度到对应 executor / worker / resource bucket。
- 写 event/resource facts。
- 写 staged facts、event evidence 和 factRefreshRequest。
- 处理资源 lease、worker、timeout、partial cleanup。

不负责：

- 创建后续 task。
- 修改 task target。
- 把 delete 写入 optimize gate。
- 发布非本 gate owner 的权威事实。

## 8. 开工检查

每次改核心链路前，先回答以下问题，回答不清楚就不要动代码。

1. 本次修改属于 User Perception、Lifecycle、Task Creator、TaskAdmission、Flow Planner、Scheduler、Executor、Resource Runtime、UI projection 中哪一层？
2. 这个职责的目标物理承载是哪个文件？当前要改的文件是否允许承载它？
3. 输入事实来自哪里？是 durable facts，还是临时内存推断？
4. 本次读写的字段属于 `sourceFacts`、`mediaFacts`、`metadataFacts`、`userPerceptionFacts` 还是 `gateFacts`？当前组件是不是该类 fact 的 canonical owner？
5. 输出事实写到哪里？是权威事实、暂存事实、执行证据，还是 factRefreshRequest？是否可恢复、可审计？
6. 是否让 Task Creator 提前知道了 flowKind？
7. 是否让 Scheduler 参与了业务 objective、flow selection 或 executor routing？
8. 是否把 `transcode/scrape/upgrade/delete` 当成 task identity 或 candidate identity？
9. delete 是否仍然只通过 `targetGate=delete` 和 delete review 进入？
10. UI 主语义是否仍然是 gate/objective，而不是 flow/executor？
11. 自动任务是否全部经过 TaskAdmission？
12. 是否新增了 compatibility alias？如果是，它是否只存在于一次性 cutover 脚本？

## 9. 施工方式

优先采用“删除模型”，不要采用“重命名模型”。

错误方式：

```text
operationKind -> selectedFlow
actionType -> flowKind
transcode candidate -> optimize candidate with selectedFlow=transcode
```

正确方式：

```text
删除 task 顶层 flow identity
让 Task Creator 只创建 targetGate task
让 Flow Planner 产出 flowPlan.flowKind
让 Task Scheduler 只调度 task
让 Resource Runtime 根据 flowPlan.flowKind 和 event 调用 executor
```

如果旧测试大量失败，不要先把旧字段补回来。失败点就是 Mirex 污染点，应该逐个判断：

- 这个断言是不是仍在用 action/operation/selectedFlow 当主语义？
- 如果是，改测试到 targetGate / gateObjective / flowPlan.flowKind。
- 如果不是，再修代码。

## 10. 审计命令

核心 runtime 审计：

```bash
rg -n "actionType|action_type|operationKind|operation_kind|selectedOperation|\\boperation\\b|top-level selectedFlow|candidate.*transcode|candidate.*scrape|candidate.*upgrade|bySelectedFlow" media-service/src media-service/web/src media-service/test
```

Task 主身份审计：

```bash
rg -n "task\\.selectedFlow|SelectedFlow|selected_flow|flowPlan\\.selectedFlow|flowSelection\\.selectedOperation" media-service/src media-service/web/src media-service/test
```

Delete gate 审计：

```bash
rg -n "optimize\\.delete|remove_media|targetGate.*optimize.*delete|delete.*optimize" media-service/src media-service/web/src media-service/test
```

SmartTask candidate 审计：

```bash
rg -n "candidatesBySelectedFlow|transcode candidate|scrape candidate|upgrade candidate|enabledSelectedFlows|readEnabledSelectedFlows" media-service/src media-service/web/src media-service/test
```

允许残留必须逐条归类：

- P0：task identity、scheduler、executor dispatch、API、UI 主语义仍被 Mirex 污染。
- P1：测试、诊断、摘要仍鼓励 Mirex 语义。
- P2：历史文档、一次性 cutover 输入、负向测试。

P0/P1 不清零，不允许宣称 Kairox Runtime Cutover 完成。

## 11. API / UI 约束

API task 主体必须优先表达：

```json
{
  "id": "...",
  "object": {},
  "targetGate": "optimize",
  "gateObjective": {},
  "status": "queued",
  "flowPlan": {
    "flowKind": "transcode",
    "direction": "optimize.transcode"
  }
}
```

不允许新增：

```json
{
  "actionType": "transcode",
  "operationKind": "transcode",
  "selectedFlow": "transcode"
}
```

UI 主标题和筛选应优先用：

- target gate。
- lifecycle stage。
- objective status。
- user action required。

flowKind 只能作为实现路径细节展示，例如“实现路径：transcode”。

## 12. 测试护栏

每次核心链路修改至少补或维护以下测试：

- `createTask()` 新 task 不接受 top-level `actionType/operationKind/selectedFlow` 作为主身份。
- Task Creator 创建 optimize task 时没有 flow identity。
- Flow Planner 对 optimize objective 输出 `flowPlan.flowKind=transcode/upgrade/no_op/blocked`。
- Task Scheduler 不按 flowKind 做业务选择；Resource Runtime / Executor routing 使用 `task.flowPlan.flowKind`。
- Task events 记录 `targetGate + flowPlan.flowKind + flowDirection + resource`，不记录 operationKind。
- API 不暴露 top-level `operationKind/actionType/selectedFlow`。
- SmartTask 自动候选按 `targetGate` 统计，不按 transcode/scrape 统计业务 candidate。
- delete task 只能是 `targetGate=delete`，不能是 optimize flow。

验证命令：

```bash
cd media-service && npm test
cd media-service && npm run build:web
```

## 13. 完成判定

只有同时满足以下条件，才可以说某次改动符合 Kairox：

- Task identity 只能从 `object + targetGate + gateObjective` 解释。
- Flow identity 只存在于 `flowPlan.flowKind`。
- Candidate 主摘要按 targetGate，而不是 flow。
- Flow Planner 是唯一 optimize flow selection 决策点。
- Task Scheduler 不计算 objective、不选择 flow、不调度资源 event。
- Executor 不创建 task、不改 targetGate。
- Delete 独立于 optimize。
- API/UI 主语义不依赖 action/operation/selectedFlow。
- P0/P1 审计为 0。
- 测试和 build 通过。
