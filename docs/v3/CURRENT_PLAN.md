# ShelfDeck v3 Current Plan

Last updated: 2026-07-08

## Current Objective

Reach `Kairox Beta` in this worktree.

`Kairox Beta` means proving the Kairox business chain works in production with a real test sample. It does not mean UI GA or scheduler performance optimization.

This worktree stops at `Kairox Beta`. Later goals require a new worktree.

The production Kairox Frontend/API E2E run has passed Stage 0-15 on the canary item.

The current implementation task is complete; the next decision is whether to accept `Kairox Beta` for this worktree.

Automation must now follow:

```text
information change layer: write facts / freshness / policy / evidence only
periodic scan layer: the only background automatic task creation mechanism
queue scheduling layer: schedule already-created tasks only
```

User-visible run scan / refresh library is removed from the product model. Users can only intervene on a concrete media item, concrete task, or concrete delete candidate.

Media Freeze must now follow:

```text
task terminal done
-> task finalizer writes mediaFreeze when configured for completed targetGate
-> Lifecycle can still project nextTargetGate
-> TaskAdmission rejects any new task while mediaFreeze is active
-> periodic scan or manual intent can create tasks only after freeze expires
```

This prevents post-optimize ingest/metadata refresh from reading external technical facts before Emby or the filesystem has stabilized. It is not a chained task and does not change gate achievement semantics.

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
2. Automation model closure is complete and deployed:
   - `POST /v1/library/actions/refresh` and `/ingest` are removed from product runtime.
   - SmartTaskEngine automatic creation only comes from the internal periodic timer.
   - SmartTaskEngine consumes LifecycleSnapshot, not lightweight media rows.
   - delete confirm / adult rescrape / media-detail manual task creation use unified Task Creator + TaskAdmission.
   - frontend automation configuration separates automatic creation, periodic scan, creation protection, queue priority, and flow execution confirmation.
3. Refresh cutover implementation is complete and deployed:
   - `refresh` is not a targetGate, flowKind, task type, or user-triggered scan.
   - Emby inventory discovery produces source observations.
   - LifecycleSnapshot / Task Creator turn observations into target-gate tasks during periodic scan.
   - TaskAdmission remains the only creation gate.
   - Resource Runtime and executors publish facts through the owning gate.
4. Post-optimize canonical refresh implementation is complete and deployed:
   - transcode / upgrade write staged facts and evidence, not canonical media facts.
   - Lifecycle projects `pending_canonical_refresh` back to ingest / metadata.
   - E2E Stage 7 validates canonical refresh before archive.
5. Media Freeze is complete and deployed:
   - `media_items` stores freeze state in hot columns, not `payload_json` only.
   - optimize done writes a 24h media freeze by default.
   - TaskAdmission rejects automatic and manual tasks for frozen media with `media_frozen`.
   - media list/detail projection and E2E Stage 10 expose freeze evidence.
6. Production E2E has passed one stage at a time on item `81945`.

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
- Do not expose user-triggered run scan, refresh library, or scan sub-library as a product capability.
- Do not treat approval/confirmation as automation authorization; approval belongs to task flow execution.

## Next Recommended Action

Review the completed E2E report:

```text
docs/v3/acceptance/KAIROX_FRONTEND_API_E2E.md
```

If accepted, close this worktree as `Kairox Beta` and start any next release goal in a new worktree.
