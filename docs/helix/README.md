# ShelfDeck / Helix Documentation Index

Status: business architecture redesign; implementation and E2E paused.

Helix不再被解释为整个ShelfDeck只包含Libra/Nexora/Kairox。当前已确认ShelfDeck还包含
平级的Deck、Aftercare、User Perception和People Management业务域；正式命名待定。

## Current documents

| Document | Purpose |
| --- | --- |
| `ARCHITECTURE.md` | 当前最高优先级业务域、生命周期与事实Owner合同 |
| `SERVICE_CONTRACTS.md` | 当前可确认的跨域交付方向；精确Schema待设计 |
| `TRIAGE_SUBJECT_AND_POLICY.md` | Pre-deck Triage、Season Subject与信息递进；顶层Owner以ARCHITECTURE为准 |
| `KAIROX_CAPABILITY_CATALOG.md` | 当前Kairox原子能力目录，等待Company/Department scope复审 |
| `CURRENT_PLAN.md` | 唯一活动计划；当前只允许Design与文档审计 |
| `CURRENT_STATUS.md` | 当前实现与架构差距 |
| `nexora/ARCHITECTURE.md` | Nexora下层合同；不得覆盖顶层业务域合同 |

## Reading order

```text
ARCHITECTURE.md
CURRENT_STATUS.md
CURRENT_PLAN.md
SERVICE_CONTRACTS.md
TRIAGE_SUBJECT_AND_POLICY.md
```

## Conflict rule

1. `ARCHITECTURE.md`是当前最高优先级合同。
2. 旧文档中的长期Membership、Policy、Person、offboarding语义若与其冲突，均视为superseded。
3. 当前不得依据旧实施计划继续编码、E2E或生产部署。
