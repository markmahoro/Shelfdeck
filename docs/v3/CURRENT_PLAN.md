# ShelfDeck v3 Current Plan

Last updated: 2026-07-07

## Current Objective

Clean up the project documents first, then rerun the production Kairox Frontend/API E2E from Stage 0 using the `漫长的季节` test sample.

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

1. Finish documentation rebaseline.
2. Confirm current docs are clear:
   - `README.md`
   - `CURRENT_STATUS.md`
   - `CURRENT_PLAN.md`
   - `acceptance/KAIROX_FRONTEND_API_E2E_PLAN.md`
3. Resume production E2E only after the user asks to continue.
4. Run E2E one stage at a time.
5. After each stage, report:
   - stage name.
   - pass/fail.
   - evidence.
   - next action.
6. If a stage fails:
   - stop at that stage.
   - identify root cause.
   - classify as backend semantic gap, projection gap, frontend connection gap, data state issue, or test script issue.
   - ask the user to confirm the fix direction before modifying production-affecting behavior.

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
- Do not create another roadmap or competing active plan.
- Do not use archived Codex plans as implementation guidance.
- Do not run destructive production actions outside the selected E2E canary scope.

## Next Recommended Action

After document cleanup is reviewed, resume production E2E:

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
