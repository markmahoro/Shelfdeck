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
| maintenance objective / facts / gates | Kairox | metadata、optimize 和兼容 archive |
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

## 5. Nexora Contract

Nexora 负责：

- Emby、adult folder 和 future source adapter observation。
- stable source identity 和 SourceBinding validity。
- onboarding、diagnose、rebind、detach 和显式授权的 physical cleanup。
- source projection revision 和 evidence。

Nexora 不创建 Kairox task，不判断 maintenance complete，不修改 LibraryMembership。

## 6. Kairox Contract

Kairox 只运营 Libra 已 admission 的 active media。Kairox 保留既有 Lifecycle、Task Creator、Flow Planner、Task Scheduler、Resource Runtime 和 Task / Flow / Event 纪律。

Kairox 对外只暴露两种维护完成度：

```text
maintenanceState: maintaining | complete
maintenanceComplete = maintenanceState == complete
```

单个 metadata/optimize task 的 `done` 只更新对应 gate facts。metadata task 完成后，如果 optimize 等必要条件尚未满足，`maintenanceState` 仍为 `maintaining`。目标 revision、facts freshness 或 incident 变化可以使 `complete` 重新派生为 `maintaining`，但不会改变 Libra `phase=maintenance`。

```text
maintenanceComplete
  = admission current
  + metadata gate passed and fresh
  + optimize gate passed and fresh
  + objective revision current
  + no pending canonical refresh
  + no unresolved source incident
```

`archive` 在 Helix Beta 中保留为 Kairox compatibility / optional finalization，不是 Helix phase，也不是 maintenanceComplete 的必要条件。

## 6.1 Projection Composition

- Libra Store 只持久化 Libra-owned facts，以及 durable operation 已消费的 source/maintenance revision。
- Libra 不持久化 Nexora SourceProjection 或 Kairox MaintenanceProjection 作为 canonical facts，也不以它们的快照提供查询结果。
- `LibraService.getLibraryProjection(s)` 使用 Nexora/Kairox batch projection 实时组合统一只读视图；GET 不写 Store。
- Reconciler 的启动恢复和周期扫描只推进 admission、quarantine、recovery、offboarding 等 Libra-owned coordination。Kairox task terminal 本身不触发 Libra phase 迁移。

Kairox `targetGate=ingest/delete` 不能创建新的 Helix 主路径任务。它们只允许 historical read、rollback support、migration input 和 negative test。

## 7. Source Incident And Fencing

Kairox 发现 source 不可用时只产生 SourceIncident。Libra：

1. 递增 admission generation。
2. 设置 quarantine。
3. 要求 Kairox suspend。
4. 要求 Nexora diagnose。
5. recovered / rebound 后发放新的 generation；confirmed missing 保持 active Membership 等待 intent。

Kairox task 在开始、激活 staged facts、替换文件和破坏性提交前必须校验 admission generation。旧 generation 不能发布 canonical result。

## 8. Offboarding

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

## 9. Beta Completion

Helix Beta 必须同时通过：

- architecture boundary audit。
- Libra `onboarding → maintenance`，以及 Kairox 在 maintenance phase 内 `maintaining ↔ complete` 的业务闭环。
- source missing / recovery / rebind / running-task fencing。
- offboarding 和三种 cleanup mode。
- restart / retry / idempotency evidence。
- Service Windows tests、Linux Docker production image、Admin Web build，以及用户批准的 controlled production canary。

`media-desktop` 的 Helix completeness 已被明确延后到独立重构，不作为本线程 Beta 判定条件。生产 canary 只允许 `retain_source` 与 ShelfDeck 内部事实变更；Emby Library、Emby metadata 和媒体文件不得修改，除非用户另行指定破坏性测试剧集并授权。

文件拆分或接口存在只是必要条件，不能单独证明 Beta 完成。
