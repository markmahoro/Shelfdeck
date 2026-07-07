# ShelfDeck v3 Current Plan

Last updated: 2026-07-07

## Current Objective

Reach `Kairox Beta` in this worktree.

`Kairox Beta` means proving the Kairox business chain works in production with a real test sample. It does not mean UI GA or scheduler performance optimization.

This worktree stops at `Kairox Beta`. Later goals require a new worktree.

The production Kairox E2E is paused at Stage 6.

The current blocker `refresh capability Kairox cutover` has been implemented locally and verified by tests. It still needs deployment and E2E re-validation before Stage 7+ continues.

The E2E goal is to prove:

```text
frontend pages are visible
-> API projections are Kairox-correct
-> facts freshness works
-> lifecycle computes the next target gate
-> task creator creates targetGate tasks
-> Flow Planner selects the flow
-> Resource Runtime executes it
-> gate facts advance
-> archive and delete review remain separated from optimize
```

## Current Execution Order

1. Keep `Kairox Beta E2E` as the main thread objective.
2. Stop E2E at Stage 6 while the refresh blocker is active.
3. Refresh cutover implementation is complete locally:
   - `refresh` remains an intent / scan request, not a task type.
   - Emby inventory discovery produces source observations.
   - SmartTaskEngine / Task Creator turn observations into target-gate tasks.
   - TaskAdmission remains the only creation gate.
   - Resource Runtime and executors publish facts through the owning gate.
4. Commit the blocker fix.
5. Deploy only after explicit user authorization.
6. Resume E2E from the affected stage and continue one stage at a time.

## Active E2E Plan

The active detailed E2E plan is:

```text
docs/v3/acceptance/KAIROX_FRONTEND_API_E2E_PLAN.md
```

The active report artifact is:

```text
docs/v3/acceptance/KAIROX_FRONTEND_API_E2E.md
```

## Explicit Non-Goals Right Now

- Do not start Kairox Performance work before production E2E proves the business chain.
- Do not start Frontend GA polish before production E2E proves the business chain.
- Do not start Kairox Usable, Kairox Performance, Kairox GA Candidate, or Kairox GA work in this worktree.
- Do not create another roadmap or competing active plan.
- Do not use archived Codex plans as implementation guidance.
- Do not use old v3.x roadmap names as current version identity.
- Do not treat package version `1.0.0` or Docker `latest` as production version identity.
- Do not run destructive production actions outside the selected E2E canary scope.
- Do not add a `refresh` target gate, flow kind, or task type.
- Do not restore batch refresh as a direct canonical facts writer.

## Next Recommended Action

After the refresh cutover is deployed, resume production E2E from the affected stage:

```powershell
cd media-service
node scripts/kairox-frontend-api-e2e.js `
  --base-url=http://192.168.12.230:18080 `
  --frontend-url=http://192.168.12.230:18080 `
  --mode=destructive `
  --allow-production `
  --confirm-destructive-e2e `
  --library-name="公共 国产剧库" `
  --canary-item-id=82397 `
  --stage=stage0 `
  --out=../docs/v3/acceptance/KAIROX_FRONTEND_API_E2E.md `
  --state=../docs/v3/acceptance/.kairox_frontend_api_e2e_state.json
```

If item `82397` is not found, first query the test library for `漫长的季节` and report the replacement item id before continuing.
