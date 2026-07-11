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
reconcileItem(subjectId)
reconcileBatch(subjectIds?)
getLibraryProjection(subjectId)
getLibraryProjections(subjectIds)
getLibraryMaintenanceSummaries(options)
```

Libra owns Subject LibraryMembership, phase, quarantine, admission generation and durable reconcile operations. Series across all Seasons is one Subject; Season and Episode are not Membership or maintenance subjects.

## Nexora Service

```text
ensureOnboarding(command)
diagnoseSource(command)
ensureOffboarding(command)
observeLibraryPage(command)
stageObservationPage(command)
finalizeObservationWork(command)
getSourceProjection(subjectId)
getSourceProjections(subjectIds)
```

SourceProjection additionally contains the finalized Asset Manifest. `assetId` is Nexora-owned and stable across locator changes when strong provider or Season/Episode identity matches.

## Kairox Service

```text
reconcileMaintenance(admission)
reconcileObjectives(subjectIds)
suspendMaintenance(command)
requestMaintenance(command)
startMaintenanceRun(command)
setMaintenancePriority(command)
clearMaintenancePriority(command)
reconcileMaintenanceRun(command)
updateUserPerception(command)
getMaintenanceProjection(subjectId)
getMaintenanceProjections(subjectIds)
getMaintenanceSummaryProjections(subjectIds)
```

Admission minimally contains `subjectId`, `subjectKind`, the immutable Asset Manifest snapshot, `admissionGeneration`, `sourceRevision`, `sourceAccessDescriptor`, `policyRevision` and policy snapshot. One Subject has at most one open Run and one Task per Gate. Episode is only an Event `assetScope`.

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
`requestMaintenanceRun` plus Subject-level priority commands; none accepts targetGate,
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

- `GET /v1/library` and `GET /v1/library/subjects/:subjectId` expose Subject projections.
- `GET /v1/admin/library/subjects/:subjectId/assets` exposes Season/Asset detail without maintenance actions.
- `POST /v1/admin/library/actions/onboard` maps to `LibraService.acceptSource`.
- `POST /v1/admin/library/subjects/:subjectId/actions/offboard` maps to `LibraService.requestOffboarding` and accepts `retain_source|detach_source|delete_source`.
- `POST /v1/admin/sublibraries/:uuid/actions/offboard` maps to `LibraService.requestOffboardingBatch`, requires an idempotency key and only accepts `retain_source`.
- `DELETE /v1/admin/sublibraries/:uuid` is rejected while any contained Libra Membership is not `closed`.
- `POST/PATCH /v1/admin/sublibraries` accepts `libraryAutomationMode` and `maintenanceAutomationMode`.
- `POST /v1/admin/sublibraries/:uuid/actions/observe` creates durable Libra observation work.
- `POST /v1/admin/library/subjects/:subjectId/actions/start-maintenance` creates a neutral Run only for manual Libraries.
- `POST /v1/admin/library/subjects/:subjectId/actions/prioritize-maintenance` and `cancel-maintenance-priority` change Subject Priority only.
- Public APIs do not create target-gate tasks, adjust Task priority, or expose execute/retry/pause controls. Approval remains an explicit Task action.
- Helix clean runtime does not expose legacy scan, offboarding-candidate, delete-candidate or archive APIs；用户清理建议统一为 `GET /v1/admin/cleanup-recommendations`。
- Admin 人物接口统一位于 `/v1/admin/people`；旧 `/v1/admin/adult/people` 不保留兼容入口。
- Admin 配置只通过 resources/security/maintenance policy 与各 Integration 的 scoped API 读写；通用 `/v1/config` 不属于 clean contract。
- Emby connection testing is read-only and does not persist a server. Saving a server requires an explicit Emby User selection.
- Douban synchronization is a durable Library work and imports facts through Kairox User Perception; it does not create a maintenance target directly.
- Environment Source Access Mapping has no public API and is absent from Library inputs/projections.

## Shared Resource Governor

Libra/Nexora work runners and Kairox Resource Runtime request permits from one process-wide Governor created by the Helix composition root. Domain Services keep their own durable work semantics and queues; the Governor exposes capacity/lease/backpressure projections only and never writes domain facts. Task Scheduler does not maintain a second set of resource counters.
- `getPendingSourceMutations(limit)`：只读返回未被 Libra 消费的 durable `SourceMutationResult`。
- `acknowledgeSourceMutation(mutationId)`：仅在 Libra 已完成 Nexora rebind 后确认消费。

Kairox Runtime 内部使用 immutable Workflow Graph 和 durable Event Store。公开接口不允许创建 Event、提交 Graph、指定 Capability 或选择内部执行路径。

Library 用户合同使用 `allowedCapabilities.metadata[]` 与 `allowedCapabilities.optimize[]`；`allowedFlowKinds`、Task `flowKind` 和复杂 Executor 名称不是公开配置。
