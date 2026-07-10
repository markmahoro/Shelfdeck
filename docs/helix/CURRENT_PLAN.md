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

## Rebaseline Slices

The earlier non-destructive canary proved Service boundaries but did not prove the final Beta requirement: a newly created full-auto library must reach `maintenanceComplete` without manual task creation. The previous `Helix Beta achieved` statement is withdrawn.

10. Rebaseline the accepted contract around two-level automation, Basedata Gate, shared Resource Governor, approval/authorization and Delete/Offboarding ownership. **Completed 2026-07-10.**
11. Replace the three independent business clocks with Libra outer Library Automation and Kairox inner Maintenance Automation; Nexora observation becomes bounded outer-loop capability work. **Active.**
12. Replace the Helix legacy-ingest quarantine gap with `targetGate=basedata`, migrate fact ownership/freshness and close post-optimize canonical refresh.
13. Extract shared Resource Governor permits/backpressure for Nexora observation, Libra reconcile and Kairox Resource Runtime; add cursor/batch budgets and liveness diagnostics.
14. Run automated failure/restart/resource-pressure tests, then a newly created full-auto library E2E through onboarding, basedata, metadata, optimize, required refresh and `maintenanceComplete`.

No runtime code for Slices 11-14 starts until this rebaseline plan is confirmed. Production destructive E2E remains separately authorized and is not implied by full-auto maintenance acceptance.

Each slice includes implementation, tests, static audit, status update and an honest record of remaining risks. Do not skip directly to a later slice.

## Non-Goals

- No internal microservices, HTTP/RPC or message broker.
- No `media-desktop` compatibility work; its Helix completeness requires a later dedicated refactor.
- No destructive production test without a separately named episode and explicit user authorization.
- Production canary must not modify the Emby Library, Emby metadata or media files.
- No extension of Mirex or legacy Kairox ingest/delete semantics.
- No automatic physical deletion in Helix Beta.
