# Helix Current Plan

Last updated: 2026-07-10

## Objective

Deliver the first Helix Beta as a clean, runnable Library Management loop under the accepted modular-monolith architecture.

## Active Slices

1. Helix contract and active-plan consolidation. **Completed 2026-07-10.**
2. Service Facades, composition root and static boundary tests. **Completed 2026-07-10.**
3. Libra facts, migration, projection and durable Reconciler. **Completed 2026-07-10.**
4. Nexora onboarding and source projection. **Completed 2026-07-10.**
5. Kairox admission and maintenanceComplete. **Completed 2026-07-10.**
6. SourceIncident, generation fencing and recovery. **Completed 2026-07-10.**
7. Offboarding, legacy ingest/delete quarantine, API and UI. **Completed 2026-07-10.**
8. Full Service audit, automated tests, Admin Web build and production migration preflight. **Completed 2026-07-10.**
9. Controlled production canary on `public_国产剧`: retain-source offboarding, re-add, onboarding/admission projection and restart recovery. **Active.**

Each slice includes implementation, tests, static audit, status update and an honest record of remaining risks. Do not skip directly to a later slice.

## Non-Goals

- No internal microservices, HTTP/RPC or message broker.
- No `media-desktop` compatibility work; its Helix completeness requires a later dedicated refactor.
- No destructive production test without a separately named episode and explicit user authorization.
- Production canary must not modify the Emby Library, Emby metadata or media files.
- No extension of Mirex or legacy Kairox ingest/delete semantics.
- No automatic physical deletion in Helix Beta.
