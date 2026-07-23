# P14 BETA-IMPL-03 Product Surface Construction Matrix

Status: `FROZEN CONSTRUCTION BASELINE / SETUP-FOUNDATION IN PROGRESS`

## Purpose and authority

This is an implementation-owned construction ledger.  It does not alter the
Architecture SSOT, user outcome, Owner, Store, Handoff, or route inventory.
The exact route rows are the committed machine artifact
`media-service/src/helix/contracts/manifests/route-inventory.json`; this ledger
assigns every currently unavailable non-Worker route to the owner-local public
port and construction batch that must make it real.  The route manifest remains
the sole byte-level list, avoiding a second hand-maintained 110-row copy.

| Baseline | Value |
| --- | --- |
| Architecture governance | `1619735c` |
| BETA feature baseline | `fcfc38f0` |
| Route inventory | 114 total; 4 currently real; 6 Worker routes intentionally Beta-404; 104 remaining product routes |
| Core contract counts | 112 Capability / 97 Result family / 177 Table / 43 Canonical Transaction |
| Scope | `shelfdeck service` only; no Worker, Desktop, Ollama, legacy runtime, or generic Store facade |

## Route-to-owner construction rules

Every row selected by `contract.facade` below is an exact route row in the
machine inventory.  A command uses the listed Owner's application transaction;
a `GET` uses its Owner-local public query or read-only projection.  Composition
only adapts HTTP input/output and never obtains a Store.

| Batch | Route facade / exact route count | Owner-local public/application target | Canonical source | Feature group / evidence gate |
| --- | ---: | --- | --- | --- |
| 1 Setup/Foundation | `OverviewQueryFacade` / 3 | `projections.public.OverviewQuery` | owner query projections; no canonical write | F01, F18–F21; public HTTP auth/empty-state/restart |
| 1 Setup/Foundation | `PlatformAdminFacade` non-Worker / 21 remaining (session/security already real; six Worker rows stay 404) | `platform.public` typed settings/diagnostic ports | `platform_*` owner rows and registered Platform setting transactions | F01, F18–F21; setting update/restart/fail-closed |
| 1 Setup/Foundation | `ProcurementAdminFacade` / 9 | `procurement.public.ProcurementCommandFacade` and `ProcurementQueryFacade` | Procurement Field/Observation transactions and Procurement projections | F02, F05, F06; Field create→read→observe/replay/negative |
| 1 Setup/Foundation | `ArcaShelfAdminFacade` / 22 | new owner-local `arca.public.ArcaShelfAdminFacade` | Arca Shelf/Standard/Placement transactions and Arca projections | F03, F06, F12, F15, F20; Shelf create→read→revision/restart |
| 1 Setup/Foundation | `LibraFormationFacade` routing subset / 4 | new owner-local `libra.public.LibraFormationAdminFacade` | Libra routing decision/revision transactions and projections | F04; route parameter/decision revision/replay |
| 2 Formation/Product | remaining `LibraFormationFacade` / 7 | `libra.public.LibraFormationAdminFacade`, Intake/Product Delivery/Workspace ports | Candidate intake, Run, Workspace, Product, Handoff A/B typed transactions | F05–F12; full owner-row journey/crash-replay |
| 3 Collection/Post-deck | `ArcaCollectionFacade` / 3, `ArcaCareFacade` / 3, `ArcaOffdeckFacade` / 17 | new owner-local Arca collection/care/off-deck public ports | Arca Inventory/Care/Off-deck transactions and projections | F13, F15–F17, F20–F21; accepted custody and recovery |
| 3 Collection/Post-deck | `PerceptionAdminFacade` / 4, `PeopleAdminFacade` / 11 | Perception/People existing typed public facades | respective Owner transactions/projections; reference-image capability is service-local | F14, F17–F18, F21; reference/recovery/negative |
| 4 Operations closure | remaining Platform diagnostics/security/automation routes | `platform.public` and owner-local Arca automation public port | Platform/Arca canonical rows and read-only diagnostics | F18–F21; backup/restore/security/restart |

## Mechanical coverage rule

`media-service/scripts/p14-product-surface-matrix-check.js` is the executable
counterpart of this ledger.  It must prove that each route inventory row is
assigned to exactly one row above, that the six remote-Worker routes remain
Beta-404 (never silently wired), and that no route can name a raw Store,
legacy runtime, Worker or Desktop package as its target.

## Construction guardrails

- A route becomes real only after its Owner-local public port, query/transaction
  and persistence continuity exist; `CLEAN_FACADE_NOT_IMPLEMENTED` is removed
  only at that time.
- A route must not return mock success, execute an arbitrary Store operation,
  select a Domain process in Composition, or read another Owner's Store.
- Each batch adds public HTTP positive, validation/authorization negative, and
  restart/crash-replay evidence for a representative real journey; family-level
  route-parameter tests cover sibling routes.
- The six `PlatformAdminFacade` Worker routes remain explicit `404
  REMOTE_WORKER_NOT_AVAILABLE_IN_BETA`.  They are not work items and must never
  acquire a Worker probe, configuration dependency, or fallback.
