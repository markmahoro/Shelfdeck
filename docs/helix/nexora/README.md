# Nexora Documentation Index

Status: current Nexora capability entry under Helix.

Nexora is the source truth and onboarding/offboarding capability used by Libra. It does not own LibraryMembership and does not call Kairox.

```text
Libra -> Nexora Service
Libra -> Kairox Service
```

## Current Documents

| Document | Purpose |
| --- | --- |
| `ARCHITECTURE.md` | Current Nexora capability contract |
| `CODE_REALITY_MAP.md` | Legacy/current implementation map |
| `PROCESS.md` | Historical Nexora-first process; subordinate to Helix plan |
| `SLICES.md` | Paused historical Nexora-first slices |
| `CURRENT_PLAN.md` | Pointer to the sole active Helix plan |
| `CURRENT_STATUS.md` | Pointer to the sole active Helix status |
| `adr/` | Historical decisions; later Helix decisions supersede conflicts |

## Conflict Rules

1. `docs/helix/ARCHITECTURE.md` owns top-level fact and dependency boundaries.
2. `docs/helix/SERVICE_CONTRACTS.md` owns internal Service contracts.
3. This directory defines Nexora internals only and cannot assign LibraryMembership to Nexora.
4. Historical ADRs and hypotheses remain evidence, not the active Helix contract.
