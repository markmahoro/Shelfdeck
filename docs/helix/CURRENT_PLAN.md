# Helix Current Plan

Last updated: 2026-07-10

## Objective

Deliver the first Helix Beta as a resource-bounded, fully automatic Library Management loop under the accepted modular-monolith architecture.

## Active Slices

1. Helix contract and active-plan consolidation. **Completed 2026-07-10.**
2. Service Facades, composition root and static boundary tests. **Completed 2026-07-10.**
3. Libra facts, migration, projection and durable Reconciler. **Completed 2026-07-10.**
4. Nexora onboarding and source projection. **Completed 2026-07-10.**
5. Kairox admission and maintenanceComplete. **Completed 2026-07-10.**
6. SourceIncident, generation fencing and recovery. **Completed 2026-07-10.**
7. Offboarding, legacy ingest/delete quarantine, API and UI. **Completed 2026-07-10.**
8. Full Service audit, automated tests, Admin Web build and production migration preflight. **Completed 2026-07-10.**
9. Controlled production canary on `公共_国产剧`: retain-source offboarding, re-add, onboarding/admission projection, restart recovery and one read-only metadata maintenance task. **Completed 2026-07-10.**

## Clean-Cut Rebaseline

The earlier non-destructive canary proved Service boundaries but did not prove the final Beta requirement: a newly created full-auto library must reach `maintenanceComplete` without manual task creation. The previous `Helix Beta achieved` statement is withdrawn.

10. Rebaseline the accepted contract around two-level automation, Basedata Gate, shared Resource Governor, approval/authorization and Delete/Offboarding ownership. **Completed 2026-07-10.**
11. Strengthen the physical component contract and revise this plan before further runtime work. Lifecycle remains the sole gate/complete evaluator; existing Automation Policy remains Kairox's automatic-trigger policy; SmartTaskEngine is narrowed into a thin Runner; Task Scheduler only dispatches existing tasks; Resource Governor is process-wide Helix infrastructure. **Completed 2026-07-10.**

The implementation now proceeds in the following order. Each slice must finish code, tests, static audit and status evidence before the next begins.

### Slice 12 — Clean Initialization And Owned Data Model

- Create clean Libra Membership/work, Nexora Binding/observation and Kairox admission/media/basedata/metadata/task facts.
- Remove `media_items` mixed ownership and all runtime/config/API branches for `ingest|delete|archive`, SmartTask legacy configuration and old schedule fields.
- Detect old schema/config as `HELIX_CLEAN_INIT_REQUIRED`; provide dry-run/apply initialization with backup. No migration or dual read.
- Initialization may clear ShelfDeck-owned state only; it must never write Emby or media directories.

### Slice 13 — Libra Library Automation

- Introduce durable `observe_library` work with Emby cursor pagination, default page size 100 and per-run item/time budget.
- Replace the independent Nexora observation timer and Libra reconcile timer with one outer Library Automation loop.
- Implement `libraryAutomationMode=auto|manual`; manual observation is an explicit durable Admin action.
- Onboarding creates Libra Membership, calls Nexora binding, then issues Kairox admission carrying generation/source/policy revisions.

### Slice 14 — Kairox Maintenance Components And Basedata

- Refactor existing `smartTaskEngine.js` into a thin Automation Runner; do not introduce a parallel heavy `kairoxAutomationEngine`.
- Refactor `automationPolicy.js` around `maintenanceAutomationMode` and an explicit trigger decision; remove per-gate `automaticTaskTargets`.
- Make Lifecycle the only owner of `nextTargetGate`, gate achievement and `maintenanceComplete`.
- Extract Task Creator/Admission cleanly. Keep Task Scheduler limited to existing-task ordering, item lock, restart recovery and dispatch to Resource Runtime.
- Add `basedata` executor/facts/freshness; Kairox admission creates only a skeleton. Post-optimize mutation makes only affected Basedata stale and requires canonical refresh.

### Slice 15 — Shared Helix Resource Governor

- Create one Governor in the Helix composition root and inject it into Libra/Nexora work runners and Kairox Resource Runtime.
- Move all capacity decisions out of Task Scheduler, SmartTask/Runner, `backgroundIoGuard` and duplicate counters.
- Add bounded queues, FIFO + aging, reserved control capacity, diagnostics and `finally` permit release.
- Resource Runtime requests permits per event; resource waiting is not a gate failure. Durable work/task state, not permits, provides restart recovery.

### Slice 16 — Automation API And Admin Web

- Persist and expose `libraryAutomationMode` and `maintenanceAutomationMode`; the full-auto preset writes `auto/auto` only.
- Add explicit observe action and two-level automation/resource projections.
- Accept only `basedata|metadata|optimize` task targets; remove legacy APIs rather than returning compatibility responses.
- Remove Archive UI/config and route disposal/offboarding exclusively through Libra.
- `media-desktop` remains outside this slice and this Beta thread.

### Slice 17 — Audit And Beta Acceptance

- Static audit physical dependencies, fact writers, removed targets/config and the single global capacity owner.
- Run Service tests, Admin Web build, Windows/Linux/Docker validation and disposable full-auto E2E.
- Prove restart/cursor recovery, resource saturation, control-plane liveness, source incident/fencing, approval blocking and post-optimize Basedata refresh.
- Production clean initialization and canary remain a separately confirmed action. Any media mutation still requires a specifically named episode and explicit authorization.

## Non-Goals

- No internal microservices, HTTP/RPC or message broker.
- No `media-desktop` compatibility work; its Helix completeness requires a later dedicated refactor.
- No destructive production test without a separately named episode and explicit user authorization.
- Production canary must not modify the Emby Library, Emby metadata or media files.
- No compatibility layer or migration for Mirex, SmartTask legacy configuration, old automation fields or Kairox ingest/delete/archive runtime semantics.
- No automatic physical deletion in Helix Beta.
