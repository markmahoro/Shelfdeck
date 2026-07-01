# Kairox Architecture

Kairox 架构是 ShelfDeck v3.1 演进阶段的命名架构契约。

它的作用不是重新发明一套实现方案，而是把 v3.1 推进中已经确认的架构方向固定成可引用、可检查、可追责的边界。后续讨论和实现可以直接使用“符合 Kairox”或“违反 Kairox”来判断方向，避免把已经收敛的结论重新打散。

## 1. 定义

Kairox 架构约束 ShelfDeck v3.1 之后的核心业务系统按以下用户心智演进：

```text
source/discovered -> ingested -> metadata-ready -> optimized -> archived
```

单 item task 的主语义是：

```text
object + targetGate + gateObjective
```

`ingest`、`scrape`、`transcode`、`upgrade`、`delete`、`archive` 在当前实现中仍作为兼容 operation 或 flow executor 存在，但不能再被当成 task 的唯一主语义。

一句话：

```text
Kairox = Lifecycle gate owns user semantics; Task targets a gate; Flow implements the path; Event consumes resources.
```

## 2. 适用范围

凡是修改以下领域，必须先读本文：

- Lifecycle stage、gate、metadata status、optimization status、archive status。
- TaskAdmission、BusinessFlowPolicy、SmartTaskEngine、手动 `/v1/tasks` 创建入口。
- Task target、task control、retry/resume/cancel/confirm。
- Flow Planner、flow recovery contract、flow executor。
- TaskScheduler、resource projection、resource throttling、worker dispatch。
- Dashboard、Task Center、Media Management 的用户语义展示，以及内部诊断 projection 的可见性边界。
- metadata gate / optimize objective / archive gate 配置和校验。
- 全自动模式、用户介入白名单、风险动作确认。
- NAS production deploy、migration、production data safety。

## 3. 文档优先级

Kairox 是 v3.1 架构契约入口，但不是唯一细节来源。

| 层级 | 文档 | 用途 |
| --- | --- | --- |
| 架构契约入口 | `docs/v3/KAIROX_ARCHITECTURE.md` | 判断一个改动是否符合 v3.1 架构方向 |
| 当前实现地图 | `docs/v2/ARCH_OVERVIEW.md` | 记录当前代码已经落地的系统事实；不是架构契约 |
| 业务语义 | `docs/v3/BUSINESS_MODEL_NOTES.md` | Lifecycle、gate、task、flow、objective 的业务定义 |
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
| optimize gate | 媒体达到优化目标 | `targetGate=optimize` |
| archive gate | 本轮处理闭环归档 | `targetGate=archive` |

实现可以继续有兼容字段，但 UI、API projection、诊断和文档不应继续把 `actionType` 当成用户语义主语。

### 4.2 Task targets a gate

Task 是一次把 object 推过某个 target gate 的尝试。

Task 必须能表达：

- `object`: 目标媒体 item 或 source candidate。
- `targetGate`: 要跨过的 gate。
- `gateObjective`: gate 的目标合同。
- `operationHint`: 兼容旧 executor 的实现提示，只能作为 hint。

自动入口、手动入口、adult rescrape 入口和未来 background source 都必须进入同一套 Task Creator / TaskAdmission 语义。不能为某个库类型或某种自动化单独开一条私有入队路径。

### 4.3 Flow implements the path

Flow 是 task 内部的实现路径，不拥有顶层用户目标。

例如 optimize task 可以选择：

- `transcode` operation 达成降低码率或兼容性目标。
- `upgrade` operation 达成提升源质量目标。
- `delete` operation 达成删除媒体目标。
- `keep` / `archive` 收口已满足目标的媒体。

Flow Planner 可以选择不同 operation，但不能临时发明 Lifecycle objective。Objective 必须来自 Lifecycle 规则、策略事实或明确的用户配置。

### 4.4 Event consumes resources

Event 是实际消耗资源的原子执行事实。

Resource projection / internal diagnostics 应围绕 event/resource 解释：

- running / waiting / failed。
- resource bucket、capacity、lease、backpressure。
- external dependency health。
- recovery、confirmation、failure summary。

SmartTaskEngine 不直接管理资源。它只消费 Resource Runtime 或 service resource projection 给出的 trigger pressure / backpressure 信号，决定是否暂缓创建新 task。

这条合同约束的是 service 后端 projection 和内部排障能力，不表示普通 Admin Web 必须暴露一个面向用户的资源视图页面。资源、DB/WAL、payload、I/O guard、diagnostic log 等运维事实应优先保留在后端诊断接口、日志和测试中，默认不进入普通用户前端。

### 4.5 Task / Flow / Event relationship

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

典型例子：

```text
task
  object = media item A
  targetGate = optimize
  gateObjective = reduce_bitrate

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

硬约束：

- 一个 task 必须先能解释 `object + targetGate + gateObjective`，再谈 flow operation。
- Task status 描述 gate-crossing attempt 的当前处境，不能用 `actionType` 或 executor 名称替代。
- Flow Planner 可以为同一个 gate objective 选择不同 flow，但不能改变 task target。
- Event history 是执行审计和恢复依据；失败不能只写 task 终态，必须能追到 event/resource/failure summary。
- Scheduler 只能调度 runnable task 和 dispatch flow event，不能把业务 objective 塞进调度分支。
- UI 可以展示实现路径，但主标题、筛选、诊断入口应优先展示 task target。
- Resource projection 只能从 event/resource 解释运行压力，不能把 task target 简化成 resource bucket；普通用户前端不应把 resource bucket 当成核心产品页面。

明确禁止：

- 把 `transcode task`、`upgrade task`、`delete task` 当成长期用户语义。Kairox 下它们是 optimize task 的 operation path，除非目标 gate 本身另有明确合同。
- 在 flow executor 内部私自修改 `targetGate` 或 `gateObjective`。
- 在 event 执行成功后绕过 Lifecycle/Task Creator 直接创建下一个 gate 的 task。
- 用 task retry 代替 flow recovery contract。
- 用 resource queue / resource projection 反向决定媒体的 Lifecycle objective。

### 4.6 Metadata gate is a scrape exit gate

`metadataGate` 不是“要不要 scrape”的触发条件，而是 scrape 阶段是否完成的 exit gate。

普通库半假 scrape / metadata repair 必须按当前子库 metadata gate 补齐 facts。若补不齐，失败原因必须指向 gate 中具体无法满足的条件。

自定义 metadata gate 必须覆盖 optimize objective 会消费的输入：

```text
metadataCompleteGate >= optimizeRequiredInputs
```

保存配置时必须硬校验；运行时发现历史坏配置时必须产生 `metadata_gate_contract_broken`，不能显示“元数据完整”又在 optimize 阶段静默卡死。

### 4.7 Task Creator is unified

所有自动 task 创建必须通过统一 TaskAdmission / BusinessFlowPolicy / Task Creator 语义。

必须保持：

- active task duplicate prevention。
- `smartTaskEnabledActions` / 自动推进 allow-list。
- queue cap、cooldown、backlog pressure。
- standard/adult/manual/background source 的同一准入模型。
- manual intent 可以表达用户明确意图，但仍保留 active duplicate、风险动作和 flow safety 校验。

明确禁止：

- 成人库独立目录扫描或监听后绕过 TaskAdmission 自动创建 scrape/optimize task。
- scrape flow 完成后链式私自创建 optimize task。
- failed optimize gate 被 SmartTaskEngine 误判为应该自动创建同类新 task。
- 用隐藏按钮、禁用任务或绕过任务中心代替 flow capability 修复。

### 4.8 Recovery belongs to flow contract

Retry/resume/fallback 不是通用按钮语义。

任务控制 API 可以提供统一外壳，但真正能否恢复、从哪里恢复、是否幂等，必须由对应 flow recovery contract 决定。

至少需要可解释：

- 当前失败发生在哪个 event/resource。
- 是否可 retry。
- retry 是否复用原 task。
- resumePoint 是什么。
- 是否需要用户确认。
- 重试是否可能重复提交外部副作用。

### 4.9 Full-auto is configured authorization

全自动模式不是另一条执行链路。

全自动模式表示用户已预先配置规则和授权范围，系统可以在这些范围内自动推进生命周期。它仍必须遵守：

- Lifecycle gate。
- Task Creator / TaskAdmission。
- Flow Planner recovery contract。
- Resource Runtime backpressure。
- 用户介入白名单。
- 风险动作预授权。

全自动遇到低置信度、多候选、配置矛盾、未授权风险动作、不可恢复失败或资源安灯信号时，必须停在可解释状态。

### 4.10 Admin Web is a user projection, not an operations console

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

### 4.11 Service owns orchestration

Service 拥有任务、媒体库、配置、People、策略结果和生产数据。

Desktop 是 HTTP thin client，不直接访问 Emby、Douban、MoviePilot、service runtime data 或 worker runtime data。

Worker 是被动计算节点，只提供计算能力和临时 job 状态。Worker 不拥有媒体库语义，不直接访问 Emby/MoviePilot/service 数据文件，不决定 Lifecycle、TaskAdmission 或 Flow objective。

### 4.12 Production path is canonical

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
| `transcode` / `upgrade` / `delete` | task 类型 | optimize flow operation |
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
- 在 UI 主路径继续使用“转码任务 / 洗版任务 / 删除任务”作为长期主语义。
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
- 用户语义是否仍能表达为 `object + targetGate + gateObjective`？
- 自动和手动入口是否共用同一准入模型？
- 失败、确认、重试、恢复是否有 event 和 recovery contract？
- 资源压力和失败点是否能在后端诊断中解释？普通前端是否避免暴露运维细节？
- metadata gate 是否仍覆盖 optimize objective 输入？
- 全自动模式遇到不可判断事项时是否会停在可解释状态？
- 是否影响 service Docker、service Windows、desktop Windows 或 worker node 边界？
- 是否需要更新 `docs/v2/ARCH_OVERVIEW.md`、v3 细文档或测试？

## 9. 关联 ADR

- `docs/v3/adr/0001-kairox-architecture.md`
- `docs/v3/adr/0002-mirex-legacy-compatibility.md`
