# Nexora Architecture Hypothesis

Status: superseded hypothesis retained as design history.

Last updated: 2026-07-08

本文保留 Nexora Global Design 的推导结果。当前合同以 `docs/helix/ARCHITECTURE.md` 和 `docs/helix/nexora/ARCHITECTURE.md` 为准。

## Final Hypothesis

```text
Helix Architecture = Nexora + Kairox
Nexora = Source Management
Kairox = In-Library Operation
```

Nexora 不包含 Kairox。Nexora 的目标也不是统一所有资源管理。Nexora 只维护 source-side reality，让 Kairox 不再承担入库、出库、源变更、source missing 的业务归因。

## Core Facts

Nexora 的最小事实是：

```text
Membership(mediaItemId, active | closed)
SourceBinding(mediaItemId, sourceId, valid | invalid)
```

解释：

- `Membership` 是 ShelfDeck 管理责任事实，变化少，由 policy 决定。
- `SourceBinding` 是 mediaItem 与 source 的可依赖关系事实，变化多，由 source reality observation 驱动。
- `Kairox eligibility = Membership active + at least one valid SourceBinding`。

## Design Consequences

- 入库 = Membership active + valid SourceBinding。
- 出库 = Membership closed。
- source missing = SourceBinding invalid，不自动出库。
- 换源 = old SourceBinding invalid + new SourceBinding valid，Membership 不变。
- Kairox 只处理 eligible media。
- Kairox 不写 Membership / SourceBinding。
- Resource evidence 不自动修改 Nexora facts。

## Superseded Ideas

以下早期假设已被替代：

- 早期的 Nexora/Kairox 上下级关系假设。
- 早期的多顶级域 Nexora 假设。
- Onboarding / Offboarding are top-level domains。
- 早期的资源治理顶级域假设。
- Source action is a shared cross-domain toolkit outside Source Management。

这些想法的有效部分已经收敛为 Nexora 内部的 source management actions 和 Helix 工程纪律。
