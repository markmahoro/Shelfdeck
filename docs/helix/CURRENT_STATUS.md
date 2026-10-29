# ShelfDeck 当前状态

**Not default agent reading** (except the production identity block when a task needs deploy facts). Default agent context is architecture SSOT + Engineering Playbook + PR-ledger — see root `AGENTS.md`.

Live work is GitHub PRs (`open` / `merged` / `closed-wontfix`). Do not use this file as a backlog or scheduling ledger.

## Production deploy identity

Record Docker image tag, git commit, SHA256, and E2E status **only after an authorized NAS deploy**. Merge to `main` ≠ production. Do not invent identity rows here.

_No new deploy identity is written in this slim; reconcile with live NAS only under explicit deploy authorization._

Optional: at most one line of product/release goal may sit here or in `CURRENT_PLAN.md`.

## Historical narrative (preserved)

The prior long STATUS narrative through 2026-10-21 remains in **git history** for this path (last full body before this stub: commit `16c8714c2`, file `docs/helix/CURRENT_STATUS.md`). Do not delete `implementation/evidence/` or other historical Evidence to “clean” this stub.
