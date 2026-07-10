# Helix Internal Service Contracts

Status: accepted Helix Beta contract.

Last updated: 2026-07-10

Helix Services are in-process JavaScript modules. Commands are JSON-shaped values and must carry `idempotencyKey` and `libraryGeneration`. Projections carry monotonic revisions and support batch reads.

## Libra Service

```text
acceptSource(command)
createSubLibrary(command)
updateSubLibrary(command)
requestLibraryObservation(command)
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
observeLibraryPage(command)
getSourceProjection(itemId)
getSourceProjections(itemIds)
```

SourceProjection minimally contains `sourceRevision`, readiness, active bindings, source access descriptor and current diagnosis/offboarding evidence. Nexora does not expose its Store.

## Kairox Service

```text
reconcileMaintenance(admission)
reconcileObjectives(itemIds)
suspendMaintenance(command)
requestMaintenance(command)
updateUserPerception(command)
getMaintenanceProjection(itemId)
getMaintenanceProjections(itemIds)
```

Admission minimally contains `itemId`, `admissionGeneration`, `sourceRevision`, `sourceAccessDescriptor`, `policyRevision` and the maintenance policy snapshot. Kairox tasks retain the admission generation and validate it before canonical or destructive commits.

`reconcileMaintenance(admission)` must create or update the minimal Kairox maintenance identity when the item has no Kairox facts yet. Nexora adapters must not pre-populate Kairox canonical Basedata as a prerequisite for admission.

MaintenanceProjection contains `maintenanceState: maintaining|complete`, the public boolean `maintenanceComplete`, basedata/metadata/optimize gate facts and an optional `disposalRecommendation`. They are not Libra phase values. `disposalRecommendation` cannot create a delete task or close Membership.

Kairox Maintenance Automation owns automatic `basedata|metadata|optimize` progression for currently admitted media. Libra provides admission and policy; it does not create each next-gate task. Helix runtime has no `ingest|delete|archive` maintenance target.

The internal component contract is:

```text
Lifecycle -> nextTargetGate / maintenanceComplete
Automation Policy -> automatic triggerDecision
Automation Runner -> bounded scan/wake and Task Creator call
Task Scheduler -> runnable ordering/item lock/recovery of existing tasks
Flow Planner -> flowPlan
Resource Runtime -> event execution through shared Governor permits
```

`TaskScheduler` never creates a task, interprets a gate, reads the library automation modes, chooses a flow, or calculates resource capacity. `ResourceGovernor` is shared Helix infrastructure and is not nested under Kairox.

`reconcileObjectives` 只由 Kairox Automation Runner 调用，用于持久化当前 policy/objective revision，并对 no-op objective 发布验证事实。GET projection 不借此产生副作用。匹配当前 admission generation、target 和 objective 的 automatic terminal failure 会投影为 `automationBlocker`，Runner 不得形成 retry storm。

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
- `POST/PATCH /v1/admin/sublibraries` accepts `libraryAutomationMode` and `maintenanceAutomationMode`.
- `POST /v1/admin/sublibraries/:uuid/actions/observe` creates durable Libra observation work.
- `POST /v1/tasks` maps only `basedata|metadata|optimize` to `LibraService.requestMaintenance`; every other target returns `400 KAIROX_INVALID_TARGET_GATE`.
- Helix clean runtime does not expose legacy scan, delete-candidate or archive APIs.

## Shared Resource Governor

Libra/Nexora work runners and Kairox Resource Runtime request permits from one process-wide Governor created by the Helix composition root. Domain Services keep their own durable work semantics and queues; the Governor exposes capacity/lease/backpressure projections only and never writes domain facts. Task Scheduler does not maintain a second set of resource counters.
