# Kairox Governance Architecture Discussion Notes

Status: superseded historical discussion notes. The `Kairox Governance` name is retired. Future architecture work uses `Nexora`.

本文记录 Kairox Beta 收束后关于下一阶段架构升级的历史讨论。它不是当前已实现架构，也不是 active implementation plan。后续只能把本文作为 Nexora 设计的历史输入，不能沿用 `Kairox Governance` 命名或路线。

## 背景

Kairox Beta 已经证明了库内管理主链路可以在生产真实样本中跑通：

```text
media facts + user perception
-> lifecycle objective / gate projection
-> targetGate task
-> Flow Planner selection
-> Resource Runtime execution
-> gate facts
-> archive
-> delete review
```

但生产自动化审计暴露出一个核心问题：`source_missing` item 会反复消耗 `targetGate=ingest` 自动任务名额，导致 metadata / optimize / archive 无法自然推进。

进一步讨论后，我们认为这不是单点 bug，而是架构边界问题：

```text
Kairox Beta 已经较好地建模了 In-Library Lifecycle；
但 Onboarding 和 Offboarding 没有被同等清晰地建模。
```

## 核心判断

当前 Kairox 不应继续把所有事情塞进一个 media lifecycle。

ShelfDeck 更合理的上层业务架构应拆成三个同级业务域：

```text
1. Onboarding
2. In-Library Lifecycle
3. Offboarding
```

同时需要一个跨域的资源中台：

```text
Global Resource Management
```

这意味着：

- `ingest` 不应继续被强行理解为库内 lifecycle 的第一个 gate。
- `delete` 不应继续同时表达“销毁源文件”和“出库”。
- 当前 Resource Runtime 不应长期作为 Lifecycle 私有小中台；未来应升级为全局资源管理平台。

## 三个业务域

### Onboarding

Onboarding 的业务目标是：

```text
external source candidate -> ShelfDeck managed item
```

它解决的问题是：

```text
这个外部媒体要不要进入 ShelfDeck 管理？
能不能形成 managed item？
```

重要共识：

- 新 source candidate 如果确认不存在，不应成为状态 0 媒体。
- 对未入库候选来说，source missing 表示 candidate 失效，而不是 `ingest gate not_passed`。
- Onboarding 可以有自己的高效内部流程，例如批量扫描、增量同步、adapter-specific reconcile、批量 upsert。
- 不必强行把 Onboarding 内部流程统一成 Kairox lifecycle task。
- 需要定义 Onboarding 到 In-Library Lifecycle 的交接合同：什么条件下一个 candidate 成为 managed item。

### In-Library Lifecycle

In-Library Lifecycle 的业务目标是：

```text
managed item -> metadata-ready -> optimized -> archived
```

它解决的问题是：

```text
这个已纳管媒体在 ShelfDeck 管理下是否达标？
```

Kairox Beta 已经在这一域取得主要收益：

- 目标和手段拆开：objective / targetGate / flow / event。
- Flow attempt result 和 gate achievement 拆开。
- canonical facts / staged facts / event evidence 拆开。
- metadata / optimize / archive 主链路可以被 E2E 验证。

重要共识：

- In-Library Lifecycle 是 Kairox 当前最成熟的部分。
- 它仍然适合使用 gate / objective / task / flow / event 模型。
- 生命周期不应该依赖链式 task 推进；task 只是改变事实的手段，gate 是否通过应由独立观察和事实评价决定。
- 用户用第三方工具整理媒体、修改元数据、替换文件后，ShelfDeck 应能通过周期观察重新评价 gate，而不是只靠某个上游 task 链式触发。

### Offboarding

Offboarding 的业务目标是：

```text
managed item -> no longer managed by ShelfDeck
```

它解决的问题是：

```text
这个媒体是否还接受 ShelfDeck 管理？
```

重要共识：

- Offboarding 与销毁源文件不是一回事。
- 出库表示 item 不再接受 ShelfDeck 管理。
- 出库后不再 metadata / optimize / archive / source recovery / delete candidate。
- 源文件是否还在不是 Offboarding 的核心。

可能的 Offboarding 结果：

```text
unmanaged
retired
ignored
purged_from_shelfdeck_record
```

其中 `purge record` 是更危险的管理数据删除，应与普通 offboard 区分。

## Delete 的拆分

当前 `delete` 至少混合了两种完全不同的业务含义：

```text
1. destroy source
2. offboard item
```

### destroy source

业务含义：

```text
销毁源文件，但 item 仍然被 ShelfDeck 管理。
```

它属于 In-Library Lifecycle 或其 source asset disposition 子域。

结果应是：

```text
item 仍存在
sourceDestroyed=true 或等价 source disposition facts
sourceExists=false
metadata / perception / archive history / destruction history 保留
未来可以 recovery / reacquire
```

低评分已归档媒体 6 个月后自动处理，默认更像 `destroy source`，不是 Offboarding。

### offboard item

业务含义：

```text
这个 item 不再接受 ShelfDeck 管理。
```

它属于 Offboarding。

出库后：

```text
Lifecycle 不再评价它
Task Creator 不再为它创建任务
Dashboard 不再把它算入管理成果
Delete candidate 不再处理它
```

## Ingest 的重新定位

讨论过程中发现，`ingest gate` 一直不舒服，是因为它处在 source candidate 和 managed item 的边界。

如果坚持：

```text
gate not_passed => 应该能触发对应 task
```

那么 `source missing` 就不能表达成 `ingest gate not_passed`。

更合理的理解是：

```text
active source candidate + 尚未纳管
=> Onboarding 需要处理

source candidate missing
=> candidate 不具备入库资格
=> 不进入库内 lifecycle
```

因此，下一阶段需要重新定义：

- 什么是 SourceCandidate。
- 什么是 ManagedItem。
- 什么是 SourceBinding / SourceAsset。
- Onboarding 如何产出 ManagedItem。
- 已纳管媒体后续 source 丢失时，属于库内 source health / recovery / disposition，而不是回到状态 0。

## 是否统一任务架构

一个关键讨论点是：Onboarding 是否也必须遵循 Kairox 的统一 task 架构。

最终倾向是：

```text
不强行统一业务域内部流程。
```

理由：

- Onboarding / In-Library Lifecycle / Offboarding 像三个不同部门。
- 每个部门可以各自用最适合自己的方式做得又快又好。
- 架构上的统一重点应该是部门之间的交接合同，而不是强行统一部门内部流程。
- 把 ingest 强套成 lifecycle task 已经以性能和语义为代价。

因此：

- In-Library Lifecycle 继续使用 Kairox gate/task/flow/event。
- Onboarding 可以使用批量/增量/adapter-specific 黑盒流程。
- Offboarding 可以使用审批、批量、异步、审计等自身流程。
- 三个域之间必须通过清晰合同交接。

这不是回到 Mirex。Mirex 的问题是把库内管理的业务目标和执行手段混在一起；而这里是承认不同业务域内部机制可以不同，但边界和交接必须清楚。

## Global Resource Management

另一个关键共识是：虽然业务域内部流程不必统一，但资源管理必须统一。

不要做：

```text
Lifecycle 小中台
Onboarding 小中台
Offboarding 小中台
再加一个大中台
```

长期目标应是：

```text
Global Resource Management Platform
```

它不统一业务 task，但统一资源 event。

### 统一的不是 Task，而是 Resource Event

业务部门可以各自有不同内部流程：

```text
Onboarding:
  bulk sync job
  incremental scan
  candidate reconcile
  managed item upsert

In-Library Lifecycle:
  metadata task
  optimize task
  archive task

Offboarding:
  unmanage batch
  purge record
  destructive cleanup
```

但关键资源消耗应统一提交为 Resource Event：

```text
emby.api.listItems
emby.api.getItem
fs.scanDirectory
fs.statFile
ffprobe.file
ffmpeg.encode
db.batchUpsert
db.writeFacts
file.replace
file.delete
moviepilot.search
moviepilot.download
douban.sync
audit.write
```

Resource Management 只关心：

```text
resourceType
resourceKey
costEstimate
priority
ownerDepartment
ownerJobId / ownerTaskId
idempotencyKey
timeout
retryPolicy
destructiveRisk
```

不关心业务目标本身：

```text
这个媒体该不该 optimize
这个 candidate 该不该入库
这个 item 该不该出库
```

当前 Resource Runtime 是 lifecycle-first 的小中台。下一阶段应考虑把它逐步升级为全局资源中台。

## 与现有版本目标的关系

当前 worktree 已收束为：

```text
Kairox Beta = 库内管理主链路在生产真实样本中跑通。
```

下一阶段不应继续在当前 worktree 中修 ingest/delete。

建议新线程/新 worktree 先做架构设计：

```text
Kairox Governance Architecture
```

它不是推翻 Kairox，而是把 Kairox 从 In-Library Lifecycle 扩展为 ShelfDeck Governance。

与现有 release goal 的关系需要重新讨论：

- `Kairox Usable` 是否应等待 Governance 边界明确。
- `Kairox Performance` 是否应包含 Global Resource Management。
- 是否需要新增一个明确阶段，例如 `Kairox Governance Beta`。

## 待决策问题

下一线程应重点讨论：

- Kairox 是否继续作为总架构名，还是明确升级为 `Kairox Governance`。
- Onboarding / In-Library Lifecycle / Offboarding 的交接合同。
- SourceCandidate / ManagedItem / SourceBinding 是否需要成为显式数据模型。
- Onboarding 内部是否完全脱离 task 架构，还是保留某种 job/operation 模型。
- destroy source 属于 In-Library Lifecycle 的 gate、task、还是 source disposition 子流程。
- Offboarding 的最小可用能力：unmanage / retire / purge 的区别。
- Resource Runtime 如何分阶段升级为 Global Resource Management。
- 当前 Beta 代码中 ingest/delete 相关实现，在下一阶段是迁移、保留、还是退役。
