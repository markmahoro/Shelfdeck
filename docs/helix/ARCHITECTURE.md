# Helix Architecture

Status: accepted Helix Beta architecture contract.

Last updated: 2026-07-10

本文定义 ShelfDeck 的 Helix Architecture。Helix 是模块化单体中的两层业务架构，不是微服务拆分计划。

## 1. Definition

```text
Helix = Libra + Nexora + Kairox

Layer 1: Libra — Library Management / orchestration / reconciler
Layer 2: Nexora Service + Kairox Service
```

- `Libra` 唯一拥有 ShelfDeck 的 Library Management 责任、LibraryMembership、业务阶段和跨域协调。
- `Nexora` 拥有 source identity、SourceBinding、source observation，以及 onboarding / rebind / offboarding 执行能力。
- `Kairox` 拥有在库维护目标、canonical maintenance facts、Task / Flow / Event 和 maintenance projection。

Helix 的长期物理形态是一个 `media-service` 进程。Service 化表示内部 JavaScript Facade、Store ownership 和依赖方向，不表示内部 HTTP、独立容器、独立部署或消息中间件。

## 2. Dependency Contract

```text
HTTP adapters
  -> Libra Service
      -> Nexora Service
      -> Kairox Service
```

只有 Libra composition root 可以同时依赖 Nexora Service 和 Kairox Service。

禁止：

- Nexora 调用 Kairox 或写 Kairox Store。
- Kairox 调用 Nexora 或写 Nexora Store。
- HTTP adapter 直接写 Membership、SourceBinding、maintenance gate 或 task facts。
- Libra 读取域内表后自行解释 source 或 maintenance 细节。

## 3. Fact Ownership

| Fact | Canonical owner | Notes |
| --- | --- | --- |
| LibraryMembership | Libra | `active \| closed`；回答 ShelfDeck 是否负责该媒体 |
| desired management state | Libra | `managed \| closed`；表达用户/策略 intent |
| Helix phase | Libra | `onboarding \| maintenance \| offboarding \| closed`；表示管理阶段，不表示维护完成度 |
| quarantine / admission generation | Libra | source incident 隔离和 Kairox fencing |
| source identity / SourceBinding | Nexora | source reality、validity、observation evidence |
| onboarding / rebind / offboarding execution | Nexora | 能力与证据；不关闭 LibraryMembership |
| basedata / maintenance objective / facts / gates | Kairox | basedata、metadata、optimize；Helix runtime 不包含 archive gate |
| disposal recommendation | Kairox | 只提供 offboarding 建议和证据；不创建 delete task |
| Task / Flow / Event | Kairox | 在库维护执行与资源证据 |

现有 Nexora `Membership` 语义由 Libra `LibraryMembership` 取代。Nexora 不再回答“ShelfDeck 是否管理该媒体”。

## 4. Libra State Contract

Libra 保存：

```text
membershipStatus: active | closed
desiredState: managed | closed
phase: onboarding | maintenance | offboarding | closed
quarantineStatus: none | source_incident
admissionGeneration: monotonic integer
```

quarantine 是 phase 之上的覆盖状态。source missing 不关闭 Membership，也不自动进入 offboarding。

`phase=maintenance` 表示媒体已经进入长期在库管理阶段。Kairox task 完成、失败或目标重新计算都不得使 Libra 离开或重新进入该 phase；只有明确 offboarding intent 才会使它转入 `offboarding`。

Libra Reconciler 使用 durable、幂等 operation 协调两个 Service。跨 `library.db` / `tasks.db` 不假设原子事务；每一步通过 idempotency key、revision、generation 和 retry/backoff 收敛。

### 4.1 Two-Level Automation

Helix 自动化只有两个业务控制循环：

```text
Libra Library Automation (outer loop)
  -> calls Nexora for source observation/binding
  -> owns Membership, onboarding, admission, quarantine and offboarding

Kairox Maintenance Automation (inner loop)
  -> consumes current admission and maintenance policy
  -> advances basedata -> metadata -> optimize -> maintenanceComplete
```

Nexora 可以有 adapter debounce、cursor、retry 和执行 worker，但不能成为第三个业务自动化控制器。Libra 不逐 gate 指挥 Kairox，也不因 task terminal 改变 `phase=maintenance`。Kairox 不改变 Membership、Libra phase 或 SourceBinding。

每个 Library 保存两个相互独立的自动化策略：

```text
libraryAutomationMode: auto | manual
maintenanceAutomationMode: auto | manual
```

- `libraryAutomationMode` 由 Libra 拥有，决定外层是否周期 observe、onboard 和协调 source lifecycle。
- `maintenanceAutomationMode` 作为 admission policy 由 Libra 传给 Kairox，Kairox Automation Policy 决定是否自动触发下一 maintenance target。
- Admin Web 的“全自动”只是一次性写入 `auto/auto`，不得同时授予 replace、move、overwrite 或 delete authorization。

Libra admission 向 Kairox 携带当前 `sourceRevision`、`policyRevision` 和 maintenance policy snapshot；Libra 不逐 gate 指挥 Kairox。

## 5. Nexora Contract

Nexora 负责：

- Emby、adult folder 和 future source adapter observation。
- stable source identity 和 SourceBinding validity。
- onboarding、diagnose、rebind、detach 和显式授权的 physical cleanup。
- source projection revision 和 evidence。

Nexora 不创建 Kairox task，不判断 maintenance complete，不修改 LibraryMembership。

## 6. Kairox Contract

Kairox 只运营 Libra 已 admission 的 active media。Kairox 保留既有 Lifecycle、Task Creator、Flow Planner、Task Scheduler、Resource Runtime 和 Task / Flow / Event 纪律。

Kairox maintenance gate 顺序是：

```text
basedata -> metadata -> optimize
```

- `basedata`：基于当前 SourceBinding 建立 Kairox 运营所需的机械可观察基础事实，例如 fingerprint、size、mtime、duration、container、codec、bitrate、resolution 和 stream facts。
- `metadata`：内容理解和用户浏览所需的描述性/丰富化事实，例如正式标题、剧情、演员、海报、fanart、内容外部 ID 和 scrape evidence。
- `optimize`：根据当前 objective 使媒体技术事实达到维护目标。

SourceBinding 回答“去哪里访问 source”，由 Nexora 拥有；Basedata 回答“当前 source 中实际是什么媒体资产”，由 Kairox 拥有。Kairox 只保存 admission 对应的 source context/reference，不成为 SourceBinding canonical owner。

Kairox 接受首次 admission 时必须能够按 `itemId` 建立最小 maintenance identity/skeleton；不得要求 Nexora adapter 预先写入 Kairox canonical facts。Basedata task 是首次发布 Kairox operational facts 的入口。

Kairox 对外只暴露两种维护完成度：

```text
maintenanceState: maintaining | complete
maintenanceComplete = maintenanceState == complete
```

单个 basedata/metadata/optimize task 的 `done` 只更新对应 gate facts。目标 revision、facts freshness 或 incident 变化可以使 `complete` 重新派生为 `maintaining`，但不会改变 Libra `phase=maintenance`。

```text
maintenanceComplete
  = admission current
  + basedata gate passed and fresh for current sourceRevision
  + metadata gate passed and fresh
  + optimize gate passed and fresh
  + objective revision current
  + no pending canonical refresh
  + no unresolved source incident
```

Helix clean runtime 不包含 `archive` target、gate、配置或 automation 分支。处置建议使用 `disposalRecommendation`，处置执行只走 Libra Offboarding。

### 6.1 Person Catalog And Preference

Kairox Metadata 同时拥有统一 Person Catalog 与媒体—演员关系。普通 Emby、JAV 与欧美成人来源使用同一 `personId` 空间；Libra 与 Nexora 不写人物事实。

- 强 Provider identity 或既有 `personId` 可以自动合并；名称、别名和人脸相似只产生人工确认候选。
- 演员偏好属于 Kairox User Perception，采用 `-2..2` 五级值：回避、不喜欢、普通、喜欢、非常喜欢。
- Metadata 发布派生 `actorPersonIds`、`actorPreferenceMax` 与 `actorPreferenceMin`。偏好 revision 变化只使关联媒体重新计算 objective。
- 演员偏好只作为 Policy 条件，不直接指定 Upgrade/Transcode Flow，也不隐式改变维护目标。
- Reference image/face 是 cold artifact，不进入媒体热 projection。

Optimize flow 修改媒体资产后，相关 Basedata 必须变 stale，并通过新的 `targetGate=basedata` 重新观察。只有实际受影响的 fact group 才失效；例如同路径 transcode 通常不应使海报、剧情和演员 metadata 一并 stale。

### 6.2 Kairox Automation And Runtime Components

Kairox 内层自动化必须复用并收束既有物理组件，不新增一个与 Lifecycle、SmartTaskEngine 或 Task Scheduler 平行的重型 automation engine。

```text
Automation Runner (timer / wake-up / admission scan)
  -> Lifecycle evaluates canonical facts and objective
  -> Automation Policy decides whether automatic triggering is allowed
  -> Task Creator / TaskAdmission creates one durable target-gate task
  -> Task Scheduler selects an existing runnable task
  -> Flow Planner selects the implementation flow
  -> Resource Runtime requests global permits and executes events
```

| Component | Owns | Must not own |
| --- | --- | --- |
| Lifecycle | `nextTargetGate`、gate achievement、`maintenanceState`、`maintenanceComplete` | automation mode、task creation、flow selection、queue order、resource capacity |
| Automation Policy | 根据 `maintenanceAutomationMode` 和触发上下文产生 `triggerDecision` | 重新计算 gate、选择 flow、创建/执行 task、授予 runtime approval |
| Automation Runner | timer、terminal wake-up、bounded admission scan；依次调用 Lifecycle、Policy、Task Creator | gate 规则、resource counter、task dispatch、flow execution |
| Task Creator / TaskAdmission | durable task 创建、duplicate、attempt budget、cooldown、generation 和安全准入 | gate achievement、flow selection、task dispatch |
| Task Scheduler | 从已存在的 task 中选择 runnable task；priority/FIFO、item lock、restart recovery、状态推进并交给 Runtime | 创建 task、扫描 Lifecycle、读取 automation mode、选择 flow、计算资源容量 |
| Flow Planner | 根据 task/objective/facts 唯一选择 `flowPlan` | 自动化许可、队列调度、资源发放 |
| Resource Runtime | event 编排、执行/recovery、在每个受争用 event 前向 Governor 申请 permit | gate、automation policy、全局容量配置 |

修复动作不获得额外架构授权。无论修复的是 bug、性能、恢复、测试还是生产故障，
实现都必须留在当前事实 owner 与物理组件边界内；测试通过、临时可运行或避免失败
都不能成为跨界理由。若根因看似只能通过移动职责解决，必须停止实现、回到 Design
合同并获得用户明确确认后才能改变边界。

特别地，Task Creator 只能创建 `object + targetGate + gateObjective` Task，并保存
admission、generation、priority、objective/policy/source revision 等准入快照。它不得调用 Flow
Planner、不得在创建时写入 `flowPlan`、也不得因为某个具体 Flow 不可规划而拒绝
target-gate Task。Task 被 Scheduler 选中后，Resource Runtime 才调用独立 Flow Planner；
Flow Planner 的结果由 Task Store 持久化，随后 Runtime 执行或按明确的 blocked contract
终止本次 attempt。

`automationPolicy.js` 是 Kairox Automation Policy；`kairoxAutomationRunner.js` 是唯一薄 Runner。旧 SmartTask 组件已经移除，不存在平行 automation engine。`taskScheduler.js` 只保留 task queue 调度，不读取 automation mode，也不维护 Emby、filesystem、FFmpeg 或 worker 容量计数。

同一 Flow 需要多个受争用资源时，Beta Runtime 在首个 event 前按稳定 resource-key 顺序预取该 Flow 的 permit 集，并在 Flow 完成、失败、暂停或取消时反序释放。该保守 lease 模式会牺牲少量并行度，但保证每个 event 执行时已持有对应 permit，并避免不同 Flow 以不同顺序申请造成死锁；它不改变 event 的 Task/Flow/Event 事实边界。

Automation Policy 与 TaskAdmission 回答不同问题：前者回答“系统是否应自动发起当前 next target”，后者回答“这一次 task attempt 是否可以创建”。手动 intent 可以绕过 `maintenanceAutomationMode=manual`，但不能绕过 duplicate、generation、freshness、approval 或 destructive safety。

Task terminal 只唤醒 Kairox Automation Runner 重新读取 Lifecycle projection。它不直接推进下一个 gate，也不通知 Libra 改变 `phase=maintenance`。

### 6.3 Maintenance Run And MediaItem Priority

Kairox 使用唯一的 durable `MaintenanceRun` 表达“一次从当前事实收敛到
`maintenanceComplete` 的维护过程”。`maintenanceAutomationMode=auto|manual`
是互斥的 Library 策略，只决定谁建立 Run：auto 由 Kairox 建立，manual 只由
用户的 neutral start intent 建立。Run 建立后，两种模式使用完全相同的
Lifecycle、Task Creator、Scheduler 和 Resource Runtime，不允许用户逐 gate
推进。

```text
MaintenanceRun
  -> Lifecycle evaluates nextTargetGate
  -> Automation Runner supplies the candidate
  -> Task Creator creates one target-gate task
  -> task terminal wakes the same Run
  -> maintenanceComplete closes the Run
```

`maintenancePriorityClass=normal|expedited` 是 Kairox MediaItem 的 canonical
用户意图，不是 Task fact。它绑定当前 Run；Run complete、cancelled 或
offboarding 时恢复 normal，不继承到后续 Run。设置 Priority 只改变排序并唤醒
Runner，不能建立 Run、指定 gate、绕过 TaskAdmission、approval、generation
fencing 或抢占已执行工作。

只有拥有排队责任的组件消费 Priority：

- Automation Runner：MediaItem Priority -> Library Priority -> Run age -> stable item order。
- Task Scheduler：MediaItem Priority snapshot -> task-local priority -> recovery -> FIFO。
- Resource Governor：control-plane -> expedited maintenance -> normal maintenance -> same-class aging/FIFO。

Task Creator 只把当前 MediaItem Priority revision 作为可恢复、可审计的快照写入
Task。`priorityEngine.js` 只计算同一 MediaItem priority class 内部的 task-local
priority；它不是中央调度器。Lifecycle、Flow Planner 和 Approval 不读取 Priority，
因为加急不能改变“做什么”或安全条件。

Movie、Episode 和成人文件是 playable maintenance subject。Series/Season 仅是
Libra 管理和批量 intent 的 scope，不创建 Kairox maintenance task；Libra 将
Series/Season intent 扩展为成员 Episode 的独立 Run/Priority。

### 6.4 Projection Composition

- Libra Store 只持久化 Libra-owned facts，以及 durable operation 已消费的 source/maintenance revision。
- Libra 不持久化 Nexora SourceProjection 或 Kairox MaintenanceProjection 作为 canonical facts，也不以它们的快照提供查询结果。
- `LibraService.getLibraryProjection(s)` 使用 Nexora/Kairox batch projection 实时组合统一只读视图；GET 不写 Store。
- Reconciler 的启动恢复和周期扫描只推进 admission、quarantine、recovery、offboarding 等 Libra-owned coordination。Kairox task terminal 本身不触发 Libra phase 迁移。

Kairox clean runtime 只接受 `targetGate=basedata|metadata|optimize`。`ingest|delete|archive` 不存在于新配置、API、automation、Task Creator、Flow Planner 或 executor registry；检测到旧 runtime schema/config 时必须停止并返回 `HELIX_CLEAN_INIT_REQUIRED`，不得双读或自动迁移。

### 6.5 Capability And Event Workflow Runtime

Helix Beta 不允许以 `flowKind -> complex executor` 作为 Kairox 执行内核。Basedata、Metadata、Optimize Task 在 Scheduler 选中后统一进入 Flow Planner；Planner 根据 Gate Objective、canonical facts、Library capability policy、runtime capability 和 safety facts 生成不可变、版本化的 Workflow Graph。

```text
Task(object + targetGate + gateObjective)
  -> Flow Planner
  -> immutable Workflow Graph
  -> durable Event Runtime
  -> atomic Capability Executor
  -> evidence / staged facts / SourceMutationResult
  -> Lifecycle evaluates the Gate again
```

- Workflow Graph 是 DAG，节点是 Event intent，边表达依赖；受限声明式 `when` 支持分支与汇合，禁止任意 JavaScript。Graph 持久化后不可改写或动态扩图。
- clean runtime 不再持久化 Task `flowKind`、复杂 Executor、旧 Flow steps、Bridge 或 `resumePoint`。Workflow Graph 的 `classification` 仅由 Planner 在 Graph 生成后派生用于展示，不参与 Task 创建、优先级、Executor 路由或 Library 配置。
- Event 是独立 durable fact，拥有 `pending|ready|waiting_for_resource|waiting_for_approval|executing|succeeded|skipped|failed|cancelled` 状态、输入输出、attempt、时间、资源、fencing、evidence 和 commit marker。
- Event Runtime 只为当前 Event 申请 Governor permit；禁止为整条 Flow 预取资源。Task 状态由 Graph 汇总，Capability Executor 不得写 Task 状态。
- Capability Executor 只完成一个原子效果，不创建 Task、不选择或追加 Capability、不调用另一个 Executor、不推进 Gate。
- Capability 不是匿名 Executor 注册项，而是版本化的内部 API。Canonical Capability Catalog 必须为每项能力定义 nominal input/output type、contract version、effect kind、resource class、approval action 和 fencing requirement。Executor 只接收 Runtime 已解析并校验的 input ports，不得读取整条 Event 列表或依赖 Event ID 后缀。
- Workflow Planner 必须为每条边声明 output-to-input binding；Graph 持久化前执行 nominal type/version 检查。缺少 binding、未知 port、未声明 dependency 或类型不兼容都必须拒绝规划，不能在 Runtime 猜测输入。
- Capability 以业务效果命名，不以旧 Flow 命名。Transcode、Upgrade、Remux 等只负责产生同一 `StagedMediaAsset`；它们共同复用 `output.media.verify -> media.replace`，不得各自复制 verify/replace。相同副作用只能有一个 canonical Capability。
- Runtime 是 approval、Permit、retry/restart、commit marker 和 post-effect 的 owner。`media.replace`、`source.organize` 等 commit-once Executor 只返回效果证据；Basedata invalidation、SourceMutationResult 持久化和 neutral signal 由 Runtime/Kairox Service 在 durable commit marker 之后统一处理。
- Library 只配置允许的副作用 Capability。观察、校验和 canonical fact publish 等必要能力不可关闭；允许 Capability 不等于授予 approval 或 destructive authorization。
- 当前系统 Planner 与未来高级画布必须使用同一 Workflow Graph contract；Beta 不提供用户画布或 Graph 写 API。

文件布局合规是 Optimize Objective，不属于 Metadata Gate。Metadata 生成的 NFO、poster、fanart 先写入持久化 Metadata Artifact Workspace；只有 Optimize 的 `source.organize` / `metadata.artifacts.materialize` / `filesystem.layout.verify` 将其原子写入最终媒体目录。

```text
workspaces.metadataArtifacts
  default: <dataDir>/workspaces/metadata-artifacts
```

该 Workspace 是用户可配置的持久化空间，不是 Transcode temp。它必须按 item/revision 隔离、保存 checksum/manifest、拒绝与媒体根目录及其他 Workspace 重叠，并保护 active/approval/materialize/recovery 引用的 revision。

`source.organize` 改变 path/source identity 时，Kairox 只能持久化中性 `SourceMutationResult`，并立即结束当前不可变 Graph。Libra durable 消费、递增一次 admission generation、暂停旧 admission、调用 Nexora rebind，并在新 SourceBinding revision 后重新 admission；新的 Basedata Task 仍由 Lifecycle/Runner 独立产生。旧 admission 不得继续 materialize、verify 或 publish。相同路径的 Transcode Replace 只使 Kairox Basedata stale，不制造不必要的 Nexora rebind。

## 7. Shared Resource Governance

Resource Management 是 Helix 共享工程基础设施，不是第四个业务域。共享 `Helix Resource Governor` 只管理 capacity、permit/lease、queue pressure、fairness、backpressure 和 diagnostics；它不拥有 Membership、SourceBinding、gate、objective 或 maintenanceComplete。

- Libra/Nexora 和 Kairox 保留各自的业务 work queue 与事实 owner。
- Nexora source observation、Libra reconcile 和 Kairox Resource Runtime 都必须通过共享 Governor 获取受争用资源的 permit。
- control-plane work 必须保留最低容量，不能被 FFmpeg 或全库扫描饿死。
- source observation 和 Libra reconcile 必须 cursor/batch 化，并有 per-run item/time budget。
- Kairox Automation Runner / Task Creator 消费 pressure 和 bounded-queue projection，停止无界供给；Task Scheduler 只执行 item lock 和 runnable ordering。
- 只有共享 Governor 判断全局 resource capacity。Kairox Resource Runtime 在每个受争用 event 开始前申请 permit，并在完成、失败、暂停或取消时通过 `finally` 释放。
- automatic task 的 terminal failure 或“执行成功但未达到 objective”必须形成可解释的 Automation blocker；同一 admission generation、target 和 objective 不得周期性重复创建 task。新 generation、objective revision 或显式 manual intent 才能解除该自动重试栅栏。
- 资源不足表达为 waiting/backpressure，不得直接改变业务事实或伪装成 gate failure。

Governor 是由 Helix composition root 创建并注入的进程级单例，位于 Libra、Nexora、Kairox 三个业务组件之外。permit 不持久化；重启后由 durable Libra work 或 Kairox task 重新申请。每个 resource queue 必须有界，并支持 FIFO + aging；control work 使用保留容量，不能被 optimize 饿死。

典型 resource key 包括 `emby:<serverId>:api`、`filesystem:<volume>:scan`、`filesystem:<volume>:probe`、`filesystem:<volume>:mutation`、`db:library:write`、`db:tasks:write`、`local:ffmpeg` 和 `worker:<workerId>`。

### 7.1 Supply, Waiting And Operational Invariants

Task supply capacity and runtime resource capacity are separate contracts:

- TaskAdmission is the sole owner of global active/queued Gate caps. It must query authoritative TaskStore facts inside the admission operation; callers cannot supply a narrowed task list.
- Automation Runner consumes remaining Gate supply and cannot create beyond it. Governor pressure may stop supply but Governor does not create or admit Tasks.
- `waiting_for_resource` is a stable Task state. A Task may own at most one live Governor waiter. Queue-full backpressure persists a retry deadline and cannot oscillate the Task through `queued` on every Scheduler tick.
- Task events record fact transitions. Repeated observation of an unchanged state cannot append another status/waiting event.
- Restart discards permits and waiters, then performs one durable recovery transition. It cannot repeatedly recover the same waiting fact.

Operational Health must evaluate invariants, not only process exceptions. Gate cap violation, repeated unchanged transitions, abnormal Event/DB growth, permit leaks or control-plane starvation are system faults. An internal circuit breaker may stop new maintenance supply while keeping diagnostics and control work live; it cannot cancel work, clear facts or report false completion.

### 7.2 Source Access Paths

Nexora canonical source paths remain source identity evidence. Environment-specific filesystem access is resolved by one deployment-owned Source Access Resolver:

```text
canonical source path + deployment mapping revision
  -> runtime access path
```

Mappings are not user Library configuration and are not exposed through Admin APIs. Kairox stores the mapping revision on destructive Tasks and revalidates canonical path, access path, containment and revision before probe, staged activation, replace or destructive commit. Missing, ambiguous or escaping mappings fail explicitly and never fall back to a guessed path.

## 8. Source Incident And Fencing

Kairox 发现 source 不可用时只产生 SourceIncident。Libra：

1. 递增 admission generation。
2. 设置 quarantine。
3. 要求 Kairox suspend。
4. 要求 Nexora diagnose。
5. recovered / rebound 后发放新的 generation；confirmed missing 保持 active Membership 等待 intent。

Kairox task 在开始、激活 staged facts、替换文件和破坏性提交前必须校验 admission generation。旧 generation 不能发布 canonical result。

## 9. Offboarding And Delete

```text
Libra enters offboarding
-> revoke Kairox admission
-> wait for Kairox quiescent
-> Nexora performs cleanup
-> Libra closes Membership
```

cleanup mode：

- `retain_source`: 退出管理，不修改 source。
- `detach_source`: binding invalid，不删除文件。
- `delete_source`: 显式 destructive authorization 后删除并保存证据。

Helix Beta 禁止自动物理删除。

Delete 不再是 Kairox lifecycle gate。删除当前 source 且不再管理必然改变 SourceBinding 和 Membership，因此只能作为 Libra Offboarding 的 `cleanupMode=delete_source`：Libra验证 intent/authorization、撤销 Kairox admission 并等待 quiescent，Nexora执行物理删除和保存 evidence，最后 Libra关闭 Membership。

Kairox 可以根据在库事实提供 `disposalRecommendation`，但不能创建 delete task，也不能直接发起 offboarding。Libra外层自动化可以读取该 projection 并结合 policy/user intent 决定是否创建 offboarding operation；Beta 中不得自动授权 `delete_source`。

Kairox optimize 内部的 staged artifact cleanup 或 verified replace event 不是 Offboarding：只要完成后媒体仍受 ShelfDeck 管理，它仍属于 Kairox maintenance，并受 Kairox approval policy 约束。若 replace 改变 path/source identity，Kairox只能产生中性 SourceMutationResult，由 Libra协调 Nexora re-observe/rebind。

## 10. Approval And Authorization

- Kairox `automationPolicy` 决定是否允许自动创建 maintenance target task；它不决定已经存在的 task 如何调度或执行。
- Kairox `approvalPolicy` / runtime confirmation 决定某次 Flow 到达 replace、move、overwrite 等风险 checkpoint 时是否需要暂停。
- `destructiveAuthorization` 是 Risk Authorization 的一种，不等于 runtime approval。
- `delete_source` authorization 属于 Libra Offboarding；Nexora只执行已经验证的 scoped authorization。

## 11. Beta Completion

### 11.1 Admin User Surface

Admin Web 的用户信息架构固定为：概览、媒体库、媒体、演员、任务中心、清理建议、管理策略、系统设置。普通页面不暴露 Libra/Nexora/Kairox、revision、generation、permit 或 blocker 等内部术语；原始事实只能进入默认折叠的诊断区。

- 概览只表达系统是否可用及维护成果；resource wait、自动重试与等待确认不是系统故障。
- 任务中心只展示运行中、等待确认、已完成；可恢复失败不形成普通用户失败墙。
- 清理建议使用“不再由 ShelfDeck 管理 / 解除来源关联 / 删除媒体文件”，分别映射三个 cleanup mode。
- 系统设置只保存用户决策；FFmpeg/FFprobe、control/DB capacity、扫描周期、队列 aging 等部署或内部默认值不进入普通配置。
- Admin Web 通过 scoped API 访问资源、安全、维护策略与各 Integration；不存在通用 raw config API。

Helix Beta 必须同时通过：

- architecture boundary audit。
- 新建一个 `libraryAutomationMode=auto`、`maintenanceAutomationMode=auto` 的库能够自动完成 Nexora observation/SourceBinding、Libra onboarding/admission，以及 Kairox `basedata → metadata → optimize → required refresh → maintenanceComplete`。
- source missing / recovery / rebind / running-task fencing。
- offboarding 和三种 cleanup mode。
- restart / retry / idempotency evidence。
- 全库 onboarding 与 Kairox heavy maintenance 并行时，Resource Governor 能证明 capacity、backpressure、control-plane liveness 和 bounded queue。
- Service Windows tests、Linux Docker production image、Admin Web build，以及用户批准的 controlled production canary。

`media-desktop` 的 Helix completeness 已被明确延后到独立重构，不作为本线程 Beta 判定条件。生产 canary 只允许 `retain_source` 与 ShelfDeck 内部事实变更；Emby Library、Emby metadata 和媒体文件不得修改，除非用户另行指定破坏性测试剧集并授权。

此前 manual/full-manual 的非破坏性 production canary 只证明 Service 边界、onboarding/admission、恢复和单个 metadata task；它不证明上述全自动闭环。文件拆分或接口存在只是必要条件，不能单独证明 Beta 完成。
