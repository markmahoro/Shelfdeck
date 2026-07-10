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
| basedata / maintenance objective / facts / gates | Kairox | basedata、metadata、optimize 和兼容 archive |
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

Library-level `automationMode` 和 desired management intent 由 Libra 拥有。Libra admission 向 Kairox携带当前 `sourceRevision`、`policyRevision` 和 maintenance policy snapshot；Kairox自行执行允许范围内的 gate automation。

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

`archive` 在 Helix Beta 中保留为 Kairox compatibility / optional finalization，不是 Helix phase，也不是 maintenanceComplete 的必要条件。

Optimize flow 修改媒体资产后，相关 Basedata 必须变 stale，并通过新的 `targetGate=basedata` 重新观察。只有实际受影响的 fact group 才失效；例如同路径 transcode 通常不应使海报、剧情和演员 metadata 一并 stale。

## 6.1 Projection Composition

- Libra Store 只持久化 Libra-owned facts，以及 durable operation 已消费的 source/maintenance revision。
- Libra 不持久化 Nexora SourceProjection 或 Kairox MaintenanceProjection 作为 canonical facts，也不以它们的快照提供查询结果。
- `LibraService.getLibraryProjection(s)` 使用 Nexora/Kairox batch projection 实时组合统一只读视图；GET 不写 Store。
- Reconciler 的启动恢复和周期扫描只推进 admission、quarantine、recovery、offboarding 等 Libra-owned coordination。Kairox task terminal 本身不触发 Libra phase 迁移。

Kairox `targetGate=ingest/delete` 不能创建新的 Helix 主路径任务。新路径使用 `targetGate=basedata`；legacy ingest/delete 只允许 historical read、rollback support、migration input 和 negative test。

## 7. Shared Resource Governance

Resource Management 是 Helix 共享工程基础设施，不是第四个业务域。共享 `Helix Resource Governor` 只管理 capacity、permit/lease、queue pressure、fairness、backpressure 和 diagnostics；它不拥有 Membership、SourceBinding、gate、objective 或 maintenanceComplete。

- Libra/Nexora 和 Kairox 保留各自的业务 work queue 与事实 owner。
- Nexora source observation、Libra reconcile 和 Kairox Resource Runtime 都必须通过共享 Governor 获取受争用资源的 permit。
- control-plane work 必须保留最低容量，不能被 FFmpeg 或全库扫描饿死。
- source observation 和 Libra reconcile 必须 cursor/batch 化，并有 per-run item/time budget。
- Kairox Task Creator 消费 resource pressure，停止无界供给；Task Scheduler/Resource Runtime 执行 per-resource capacity 和 item lock。
- 资源不足表达为 waiting/backpressure，不得直接改变业务事实或伪装成 gate failure。

典型 resource key 包括 `emby:<serverId>:api`、`filesystem:<volume>:scan`、`filesystem:<volume>:probe`、`filesystem:<volume>:mutation`、`db:library:write`、`db:tasks:write`、`local:ffmpeg` 和 `worker:<workerId>`。

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

- Kairox `automationPolicy` 决定是否允许自动创建/执行 maintenance target task。
- Kairox `approvalPolicy` / runtime confirmation 决定某次 Flow 到达 replace、move、overwrite 等风险 checkpoint 时是否需要暂停。
- `destructiveAuthorization` 是 Risk Authorization 的一种，不等于 runtime approval。
- `delete_source` authorization 属于 Libra Offboarding；Nexora只执行已经验证的 scoped authorization。

## 11. Beta Completion

Helix Beta 必须同时通过：

- architecture boundary audit。
- 新建一个 `automationMode=auto` 的库能够自动完成 Nexora observation/SourceBinding、Libra onboarding/admission，以及 Kairox `basedata → metadata → optimize → required refresh → maintenanceComplete`。
- source missing / recovery / rebind / running-task fencing。
- offboarding 和三种 cleanup mode。
- restart / retry / idempotency evidence。
- 全库 onboarding 与 Kairox heavy maintenance 并行时，Resource Governor 能证明 capacity、backpressure、control-plane liveness 和 bounded queue。
- Service Windows tests、Linux Docker production image、Admin Web build，以及用户批准的 controlled production canary。

`media-desktop` 的 Helix completeness 已被明确延后到独立重构，不作为本线程 Beta 判定条件。生产 canary 只允许 `retain_source` 与 ShelfDeck 内部事实变更；Emby Library、Emby metadata 和媒体文件不得修改，除非用户另行指定破坏性测试剧集并授权。

此前 manual/full-manual 的非破坏性 production canary 只证明 Service 边界、onboarding/admission、恢复和单个 metadata task；它不证明上述全自动闭环。文件拆分或接口存在只是必要条件，不能单独证明 Beta 完成。
