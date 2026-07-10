# Helix Internal Service Contracts

Status: accepted Helix Beta contract.

Last updated: 2026-07-10

Helix Services are in-process JavaScript modules. Commands are JSON-shaped values and must carry `idempotencyKey` and `libraryGeneration`. Projections carry monotonic revisions and support batch reads.

## Libra Service

```text
acceptSource(command)
requestMaintenance(command)
requestOffboarding(command)
requestOffboardingBatch(command)
reconcileItem(itemId)
reconcileBatch(itemIds?)
getLibraryProjection(itemId)
getLibraryProjections(itemIds)
```

Libra owns LibraryMembership, phase, quarantine, admission generation and durable reconcile operations. It delegates capability work and never writes Nexora or Kairox facts. `getLibraryProjection(s)` batch-reads current Nexora/Kairox projections and composes them with Libra facts without persisting those capability projections.

## Nexora Service

```text
ensureOnboarding(command)
diagnoseSource(command)
ensureOffboarding(command)
getSourceProjection(itemId)
getSourceProjections(itemIds)
```

SourceProjection minimally contains `sourceRevision`, readiness, active bindings, source access descriptor and current diagnosis/offboarding evidence. Nexora does not expose its Store.

## Kairox Service

```text
reconcileMaintenance(admission)
suspendMaintenance(command)
requestMaintenance(command)
getMaintenanceProjection(itemId)
getMaintenanceProjections(itemIds)
```

Admission minimally contains `itemId`, `admissionGeneration`, `sourceRevision`, `sourceAccessDescriptor` and `policyRevision`. Kairox tasks retain the admission generation and validate it before canonical or destructive commits.

MaintenanceProjection contains `maintenanceState: maintaining|complete` and the compatibility boolean `maintenanceComplete`. Metadata/optimize gate facts explain the derived state; they are not Libra phase values.

## Errors And Idempotency

- Domain methods return structured results or throw errors carrying stable `code` values.
- Repeating an accepted command with the same idempotency key returns the same operation/result.
- Reusing an idempotency key with a different payload is rejected.
- Stale generation/revision commands are rejected and cannot overwrite current projections.
- Reconcile wake-ups are advisory and only accelerate Libra-owned coordination. Startup recovery and periodic Libra reconcile are the durable fallback; task completion does not require a Libra state update merely to refresh a Kairox projection.

## Public API Adapters

- `GET /v1/library`, manage queries and item detail expose a `helix` projection.
- `POST /v1/admin/library/actions/onboard` maps to `LibraService.acceptSource`.
- `POST /v1/admin/library/items/:itemId/actions/offboard` maps to `LibraService.requestOffboarding` and accepts `retain_source|detach_source|delete_source`.
- `POST /v1/admin/sublibraries/:uuid/actions/offboard` maps to `LibraService.requestOffboardingBatch`, requires an idempotency key and only accepts `retain_source`.
- `DELETE /v1/admin/sublibraries/:uuid` is rejected while any contained Libra Membership is not `closed`.
- `POST /v1/tasks` maps only `metadata|optimize|archive` to `LibraService.requestMaintenance`; `ingest|delete` return `410 HELIX_LEGACY_TARGET_REMOVED`.
