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
requestMaintenanceRun(command)
setMaintenancePriority(command)
clearMaintenancePriority(command)
requestOffboarding(command)
requestOffboardingBatch(command)
reconcileItem(itemId)
reconcileBatch(itemIds?)
getLibraryProjection(itemId)
getLibraryProjections(itemIds)
getLibraryMaintenanceSummaries(options)
```

Libra owns LibraryMembership, phase, quarantine, admission generation and durable reconcile operations. It delegates capability work and never writes Nexora or Kairox facts. `getLibraryProjection(s)` batch-reads current Nexora/Kairox projections and composes them with Libra facts without persisting those capability projections. `getLibraryMaintenanceSummaries` only aggregates active playable Membership, reads Kairox through batch projections and yields between bounded batches; Series/Season containers never enter Gate denominators.

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
startMaintenanceRun(command)
setMaintenancePriority(command)
clearMaintenancePriority(command)
reconcileMaintenanceRun(command)
updateUserPerception(command)
getMaintenanceProjection(itemId)
getMaintenanceProjections(itemIds)
getMaintenanceSummaryProjections(itemIds)
```

Admission minimally contains `itemId`, `admissionGeneration`, `sourceRevision`, `sourceAccessDescriptor`, `policyRevision` and the maintenance policy snapshot. Kairox tasks retain the admission generation and validate it before canonical or destructive commits.

`reconcileMaintenance(admission)` must create or update the minimal Kairox maintenance identity when the item has no Kairox facts yet. Nexora adapters must not pre-populate Kairox canonical Basedata as a prerequisite for admission.

MaintenanceProjection contains `maintenanceState: maintaining|complete`, the public boolean `maintenanceComplete`, basedata/metadata/optimize gate facts and an optional `disposalRecommendation`. They are not Libra phase values. `disposalRecommendation` cannot create a delete task or close Membership.

Kairox Maintenance Automation owns automatic `basedata|metadata|optimize` progression for currently admitted media. Libra provides admission and policy; it does not create each next-gate task. Helix runtime has no `ingest|delete|archive` maintenance target.

Task Creator/Admission performs global duplicate and Gate-cap checks against TaskStore-owned facts in the same admission operation. `tasks`, `activeTasks` or other caller-supplied collections are not valid admission inputs.

Task creation never produces or validates a `flowPlan`. The durable creation payload is limited to
the target-gate task identity/objective plus admission, generation, MediaItem priority, source-access
mapping, objective and policy revision snapshots. After Task Scheduler selects an existing task, Resource Runtime
invokes the standalone Flow Planner and persists its output before executor routing. Neither Task Creator
nor Task Store may synthesize a Flow Plan while creating or reading a task.

Bug fixes and recovery fixes carry no implicit authority to change these owners. Any proposed fix that
requires a component to decide or persist another component's owned fact must stop at Design and obtain
explicit user confirmation before implementation.

`requestMaintenance` is an internal Runner -> Task Creator capability and requires the
Lifecycle-selected target. HTTP adapters and users cannot call it. Public user intent is
`requestMaintenanceRun` plus MediaItem-level priority commands; none accepts targetGate,
flowKind or executor.

`maintenanceAutomationMode=auto|manual` is mutually exclusive. Auto mode rejects user
start intent; manual mode never auto-creates a Run. Once a Run exists, task terminal wakes
the same Run until `maintenanceComplete` without another user action.

Kairox 还提供统一 Person Catalog：Person canonical identity、aliases、provider identities、reference artifacts、五级 preference 和 item-person relations。普通与成人演员不建立两套 Store；偏好变化发布中性 Kairox signal，关联媒体 objective 由 Kairox 自身重新计算。

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
- `POST /v1/admin/library/items/:itemId/actions/start-maintenance` creates a neutral Run only for manual Libraries.
- `POST /v1/admin/library/items/:itemId/actions/prioritize-maintenance` and `cancel-maintenance-priority` change MediaItem Priority only.
- Public APIs do not create target-gate tasks, adjust Task priority, or expose execute/retry/pause controls. Approval remains an explicit Task action.
- Helix clean runtime does not expose legacy scan, offboarding-candidate, delete-candidate or archive APIs；用户清理建议统一为 `GET /v1/admin/cleanup-recommendations`。
- Admin 人物接口统一位于 `/v1/admin/people`；旧 `/v1/admin/adult/people` 不保留兼容入口。
- Admin 配置只通过 resources/security/maintenance policy 与各 Integration 的 scoped API 读写；通用 `/v1/config` 不属于 clean contract。
- Emby connection testing is read-only and does not persist a server. Saving a server requires an explicit Emby User selection.
- Douban synchronization is a durable Library work and imports facts through Kairox User Perception; it does not create a maintenance target directly.
- Environment Source Access Mapping has no public API and is absent from Library inputs/projections.

## Shared Resource Governor

Libra/Nexora work runners and Kairox Resource Runtime request permits from one process-wide Governor created by the Helix composition root. Domain Services keep their own durable work semantics and queues; the Governor exposes capacity/lease/backpressure projections only and never writes domain facts. Task Scheduler does not maintain a second set of resource counters.
