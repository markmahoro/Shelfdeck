# v3 Archive

Archived documents are historical records. They are useful for audit, rollback, and context, but they are not current implementation guidance.

## Directories

| Directory | Meaning |
| --- | --- |
| `superseded/` | Plans, roadmaps, and audits that were replaced or abandoned |
| `completed/` | Phase plans or gap audits that have already been implemented |
| `evidence/` | Historical E2E reports, production audits, and run evidence |
| `handoff/` | Thread handoff notes and paused-goal summaries |

## Rule

When an archived document conflicts with a current document, trust Helix first:

1. `docs/helix/`（SSOT、Plan、Phase、Status、Playbook）
2. `docs/v3/VERSIONING.md`（仅版本分层规则）
3. Closed stubs：`docs/v3/CURRENT_PLAN.md`、`docs/v3/CURRENT_STATUS.md`
4. Historical understanding only：`KAIROX_ARCHITECTURE.md` / `KAIROX_ENGINEERING_PLAYBOOK.md`

Do not revive an archived plan by editing it in place. New work goes to Helix Master Plan / Phase, not v3.
