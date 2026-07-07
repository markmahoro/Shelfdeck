# ShelfDeck v3 Current Plan

Last updated: 2026-07-07

## Current Objective

Reach `Kairox Beta` in this worktree.

`Kairox Beta` means proving the Kairox business chain works in production with a real test sample. It does not mean UI GA or scheduler performance optimization.

This worktree stops at `Kairox Beta`. Later goals require a new worktree.

The previous production Kairox E2E run is stopped.

The current blocker `refresh capability Kairox cutover` and the post-optimize canonical refresh fix have been deployed. Production has validated ingest -> metadata refresh on the new canary item.

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
2. Restart E2E on the current canary item `81945 / 爱很美味 / Season 1`.
3. Refresh cutover implementation is complete and deployed:
   - `refresh` remains an intent / scan request, not a task type.
   - Emby inventory discovery produces source observations.
   - SmartTaskEngine / Task Creator turn observations into target-gate tasks.
   - TaskAdmission remains the only creation gate.
   - Resource Runtime and executors publish facts through the owning gate.
4. Post-optimize canonical refresh implementation is complete and deployed:
   - transcode / upgrade write staged facts and evidence, not canonical media facts.
   - Lifecycle projects `pending_canonical_refresh` back to ingest / metadata.
   - E2E Stage 7 validates canonical refresh before archive.
5. Continue E2E one stage at a time on item `81945`.

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

Restart production E2E on the current canary:

```powershell
cd media-service
node scripts/kairox-frontend-api-e2e.js `
  --base-url=http://192.168.12.230:18080 `
  --frontend-url=http://192.168.12.230:18080 `
  --mode=destructive `
  --allow-production `
  --confirm-destructive-e2e `
  --library-name="公共 国产剧库" `
  --canary-item-id=81945 `
  --stage=stage0 `
  --out=../docs/v3/acceptance/KAIROX_FRONTEND_API_E2E.md `
  --state=../docs/v3/acceptance/.kairox_frontend_api_e2e_state.json
```

The current canary item already has fresh source/media/metadata facts after production validation:

```text
81945 / 爱很美味 / Season 1
duration=200
size=20493967
bitrate=819759
lifecycleNextTask=optimize
```
