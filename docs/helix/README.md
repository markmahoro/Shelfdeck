# Helix Documentation Index

Status: current Helix entry.

```text
Helix = Libra + Nexora + Kairox
```

Helix 是 ShelfDeck `media-service` 内部的两层模块化单体架构：Libra 负责 Library Management，Nexora 与 Kairox 作为内部 Service 分别提供 source lifecycle 和 in-library maintenance 能力。

## Current Documents

| Document | Purpose |
| --- | --- |
| `ARCHITECTURE.md` | Accepted Helix top-level contract |
| `SERVICE_CONTRACTS.md` | Libra / Nexora / Kairox internal Service contracts |
| `CURRENT_PLAN.md` | Sole active Helix Beta implementation plan |
| `CURRENT_STATUS.md` | Current implementation facts and evidence |
| `KAIROX_CAPABILITY_CATALOG.md` | 50 atomic Kairox Capabilities, contracts and performance metrics |
| `acceptance/FLOWPLAN_BUSINESS_PARITY.md` | FlowPlan business-parity evidence and the unresolved Season Upgrade blocker |
| `nexora/ARCHITECTURE.md` | Nexora domain details, subordinate to Helix fact ownership |
| `../v3/KAIROX_ARCHITECTURE.md` | Completed Kairox inheritance contract |

## Required Reading

```text
docs/helix/README.md
docs/helix/ARCHITECTURE.md
docs/helix/SERVICE_CONTRACTS.md
docs/helix/CURRENT_STATUS.md
docs/helix/CURRENT_PLAN.md
docs/helix/nexora/ARCHITECTURE.md
docs/v3/KAIROX_ARCHITECTURE.md
docs/v3/KAIROX_ENGINEERING_PLAYBOOK.md
```

## Conflict Rules

1. Helix fact ownership and dependency direction follow `ARCHITECTURE.md`.
2. Service inputs, outputs and invariants follow `SERVICE_CONTRACTS.md`.
3. `nexora/` and `v3/` documents cannot override the accepted Helix top-level contract.
4. `docs/v2/ARCH_OVERVIEW.md` remains an implementation map, not an architecture contract.
5. Do not create parallel active Helix or Nexora plans.
