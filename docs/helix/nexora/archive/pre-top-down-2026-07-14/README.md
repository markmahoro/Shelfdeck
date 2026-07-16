# Nexora Documentation Index

Status: historical implementation entry; superseded by the 2026-07-13 top-level redesign.

Nexora no longer ownsTriage、Observation admission或全局SourceBinding truth。目标合同中，
Procurement拥有采购预检；Nexora只负责Libra生产订单内的Canonical Source安全修正。

本目录只保留旧实现与迁移盘点，不能覆盖`docs/helix/ARCHITECTURE.md`和
`docs/helix/SERVICE_CONTRACTS.md`。

## Current Documents

| Document | Purpose |
| --- | --- |
| `ARCHITECTURE.md` | Superseded Nexora-first contract; historical implementation input |
| `CODE_REALITY_MAP.md` | Legacy/current implementation map |
| `PROCESS.md` | Historical Nexora-first process; subordinate to Helix plan |
| `SLICES.md` | Paused historical Nexora-first slices |
| `CURRENT_PLAN.md` | Pointer to the sole active Helix plan |
| `CURRENT_STATUS.md` | Pointer to the sole active Helix status |
| `adr/` | Historical decisions; later Helix decisions supersede conflicts |

## Conflict Rules

1. `docs/helix/ARCHITECTURE.md` owns top-level fact and dependency boundaries.
2. `docs/helix/SERVICE_CONTRACTS.md` owns internal Service contracts.
3. 本目录不得把Triage、Procurement、Off-deck或Deck ownership赋给Nexora。
4. Historical ADRs and hypotheses remain evidence, not the active Helix contract.
