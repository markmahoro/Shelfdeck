# Helix Current Plan

Last updated: 2026-07-11

Status: Helix Beta recovery implementation active; production disabled until local real-source acceptance and explicit user confirmation.

## Objective

Deliver the first Helix Beta as a resource-bounded, fully automatic Library Management loop whose complete product behavior is proven against the user's real local sources before production is rebuilt.

## Active Recovery Plan

The earlier completion statements below are historical delivery facts, not current Beta acceptance. Production evidence on 2026-07-11 invalidated the system-level readiness claim.

1. Rebaseline Helix contracts and status around four hard invariants: authoritative global TaskAdmission, stable resource waiting, bounded Runner supply, and operational invariant health. **Completed 2026-07-11.**
2. Repair Task Creator/Admission, Runner, Scheduler, Resource Runtime, Governor and Task/Event persistence; add a circuit breaker without hiding or clearing work. **Completed 2026-07-11; full Service suite 167/167.**
3. Replace per-flow path mapping with an internal deployment-owned Source Access Resolver and destructive mapping fencing. **Completed 2026-07-11.**
4. Complete Emby User selection, transcode device pool editing, Optimize direction projection and Admin configuration/runtime bidirectional audit. **In progress; local Emby re-authentication awaits the password that is intentionally absent from backups.**
5. Restore durable Douban User Perception synchronization under the existing two-level automation model; complete Person and manual perception product paths. **Completed 2026-07-11.**
6. Add contract, integration, UI and performance acceptance that exercises the real local sources: `Z:\Film`, `Z:\chn_series`, `Y:\JAV`, and `Y:\US`. **In progress.**
7. Prove all E01-E40 product scenarios, normal/constrained profiles, restart/fault recovery, 30-minute active soak and 10-minute idle convergence.
8. Publish per-case evidence and residual risk. Build or deploy production only after a separate user confirmation.

Before item 6 resumes, complete the following blocking Kairox execution-kernel rebaseline. The local four-library E2E is paused because its current `flowKind -> complex executor` evidence cannot establish the accepted Task / Flow / Event contract.

## Kairox Capability And Event Runtime Rebaseline

28. Strengthen the architecture contract: every Basedata, Metadata and Optimize Task is planned after scheduling from its Gate Objective, canonical facts, Library capability policy, runtime capability and safety facts. `flowKind` becomes a classification/diagnostic label and must not route an executor. **Completed 2026-07-11.**
29. Replace the fixed step list and Task `resumePoint` execution state machine with an immutable, versioned durable Workflow Graph. Nodes are Event intents; dependencies and a restricted declarative condition language support sequence, branches and joins. The first product planner generates the graph; no user canvas is in Beta, but the model must not preclude a future canvas. **Completed 2026-07-11.**
30. Make Event a first-class durable runtime entity. Event Runtime owns readiness, dependency release, approval prerequisite, per-Event Governor permit, retry/restart recovery and Task graph aggregation. A Capability Executor performs exactly one planned effect and cannot create Tasks, choose/append capabilities, advance a Flow or write Task status directly. **Completed 2026-07-11.**
31. Atomize the existing Basedata, Scrape, Transcode and Upgrade executors into registered capabilities while preserving their validated low-level implementation and fencing. Remove the `flowKind -> complex executor.driveTask()` runtime path rather than operating dual tracks. **Completed 2026-07-11; four complex Executor files and the old Flow Planner were removed.**
32. Persist Library-allowed side-effect capabilities by Gate. Required read-only observation, verification and fact publication capabilities remain internal and cannot be disabled. Approval/authorization stays independent: allowing a capability never grants a replace, move or overwrite approval. **Completed 2026-07-11.**
33. Make file-layout compliance an Optimize Objective. Metadata owns descriptive facts and renders verified NFO/poster/fanart artifacts into a durable Metadata Artifact Workspace; it never writes those files into an unorganized source root. Optimize composes `source.organize`, `metadata.artifacts.materialize` and `filesystem.layout.verify` as required. **Completed 2026-07-11.**
34. Add the user-visible `workspaces.metadataArtifacts` setting under Media Access And Workspaces, defaulting to `<dataDir>/workspaces/metadata-artifacts`. It is durable workspace, not disposable temp: validate create/write/atomic-rename/delete, reject overlap or escape, protect referenced revisions and clean only unreferenced revisions after retention. **Implementation and safety validation completed 2026-07-11; retention cleanup remains acceptance work.**
35. Persist neutral Kairox `SourceMutationResult` for organize/replace. Libra durably consumes it, increments admission generation, suspends the old admission, coordinates Nexora re-observe/rebind and reissues admission; Kairox then obtains a new Basedata Task through Lifecycle/Runner facts, never by Task chaining. **Completed 2026-07-11 for path-changing organize; same-path replace correctly stays inside Kairox and only invalidates Basedata.**
36. Add Event-level diagnostics for queue, resource, approval, execution and retry duration, aggregated by capability, resource key, Provider, Volume, Worker and device. Operational Health must detect graph deadlock, unchanged-state writes, duplicate commit, permit leak and control-plane starvation. **Event timing API completed 2026-07-11; invariant/soak acceptance remains in item 37.**
37. Complete contract/unit/integration/Admin tests, clean-initialize the local ShelfDeck runtime, then restart E01-E40 and the normal/constrained soak acceptance from E01. Pre-rebaseline Task/Facts are not acceptance evidence. **Pending.**

The Workflow Graph is immutable once persisted. Event output may select declared conditional branches but cannot mutate or extend the graph. Facts requiring a different plan cause a later Gate Task to be planned through Lifecycle and Automation Runner.

Recovery implementation may fix local defects without per-defect checkpoints when the accepted contract is unchanged. Any newly discovered contract conflict returns to architecture discussion before implementation. No workaround, silent fallback, queue clearing, task hiding or production mutation is allowed.

## Delivery Slices

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

**Completed 2026-07-10.**

- Create clean Libra Membership/work, Nexora Binding/observation and Kairox admission/media/basedata/metadata/task facts.
- Remove `media_items` mixed ownership and all runtime/config/API branches for `ingest|delete|archive`, SmartTask legacy configuration and old schedule fields.
- Detect old schema/config as `HELIX_CLEAN_INIT_REQUIRED`; provide dry-run/apply initialization with backup. No migration or dual read.
- Initialization may clear ShelfDeck-owned state only; it must never write Emby or media directories.

### Slice 13 — Libra Library Automation

**Completed 2026-07-10.**

- Introduce durable `observe_library` work with Emby cursor pagination, default page size 100 and per-run item/time budget.
- Replace the independent Nexora observation timer and Libra reconcile timer with one outer Library Automation loop.
- Implement `libraryAutomationMode=auto|manual`; manual observation is an explicit durable Admin action.
- Onboarding creates Libra Membership, calls Nexora binding, then issues Kairox admission carrying generation/source/policy revisions.

### Slice 14 — Kairox Maintenance Components And Basedata

**Completed 2026-07-10.**

- Refactor existing `smartTaskEngine.js` into a thin Automation Runner; do not introduce a parallel heavy `kairoxAutomationEngine`.
- Refactor `automationPolicy.js` around `maintenanceAutomationMode` and an explicit trigger decision; remove per-gate `automaticTaskTargets`.
- Make Lifecycle the only owner of `nextTargetGate`, gate achievement and `maintenanceComplete`.
- Extract Task Creator/Admission cleanly. Keep Task Scheduler limited to existing-task ordering, item lock, restart recovery and dispatch to Resource Runtime.
- Add `basedata` executor/facts/freshness; Kairox admission creates only a skeleton. Post-optimize mutation makes only affected Basedata stale and requires canonical refresh.

### Slice 15 — Shared Helix Resource Governor

**Completed 2026-07-10.**

- Create one Governor in the Helix composition root and inject it into Libra/Nexora work runners and Kairox Resource Runtime.
- Move all capacity decisions out of Task Scheduler, SmartTask/Runner, `backgroundIoGuard` and duplicate counters.
- Add bounded queues, FIFO + aging, reserved control capacity, diagnostics and `finally` permit release.
- Resource Runtime requests permits per event; resource waiting is not a gate failure. Durable work/task state, not permits, provides restart recovery.

### Slice 16 — Automation API And Admin Web

**Completed 2026-07-10.**

- Persist and expose `libraryAutomationMode` and `maintenanceAutomationMode`; the full-auto preset writes `auto/auto` only.
- Add explicit observe action and two-level automation/resource projections.
- Accept only `basedata|metadata|optimize` task targets; remove legacy APIs rather than returning compatibility responses.
- Remove Archive UI/config and route disposal/offboarding exclusively through Libra.
- `media-desktop` remains outside this slice and this Beta thread.

### Slice 17 — Audit And Beta Acceptance

**Completed 2026-07-10.** Service、Admin Web、Windows host、Linux production image、disposable full-auto/restart E2E 和 disposable real transcode/replace E2E 已通过。生产 clean initialization/canary 仍是独立授权动作，不属于本计划的自动执行权限。

- Static audit physical dependencies, fact writers, removed targets/config and the single global capacity owner.
- Run Service tests, Admin Web build, Windows/Linux/Docker validation and disposable full-auto E2E.
- Prove restart/cursor recovery, resource saturation, control-plane liveness, source incident/fencing, approval blocking and post-optimize Basedata refresh.
- Production clean initialization and canary remain a separately confirmed action. Any media mutation still requires a specifically named episode and explicit authorization.

## Admin Web Product Rebaseline

18. 固化八个用户页面、统一 Person Catalog、五级演员偏好与 clean configuration contract。**Completed 2026-07-10.**
19. 实现 Kairox Person Catalog、普通/成人演员 observation、身份合并和演员偏好策略联动。**Completed 2026-07-10.**
20. 删除 raw/legacy config API，将部署项、内部常量和用户配置分离。**Completed 2026-07-10.**
21. 建立可发布的 Admin visual system、响应式 App Shell 与统一交互组件。**Completed 2026-07-10.**
22. 重做概览、媒体库、媒体、演员、任务中心、清理建议、管理策略和系统设置。**Completed 2026-07-10.**
23. 完成 Service/Web/Browser/Docker E2E、视觉与可访问性审计，并更新 Beta 状态报告。**Completed 2026-07-10.**

## Maintenance Run Rebaseline

24. 固化互斥的 auto/manual Run 启动策略、durable Maintenance Run 与 MediaItem Priority。**Completed 2026-07-11.**
25. 让 Runner、Scheduler、Governor 分别消费 MediaItem Priority，移除用户指定 Gate、Task priority 和逐 Task 控制入口。**Completed 2026-07-11.**
26. 持久化 Library hierarchy，Series/Season intent 扩展到 playable Episode。**Completed 2026-07-11.**
27. 更新 Admin Web 并完成 Service/Web/Docker 验证；可定位的实现/测试缺陷自行修复，涉及合同变化时停止对齐。**Completed 2026-07-11.**

Production deployment remains paused pending explicit user acceptance and a separately confirmed production cutover.

## Non-Goals

- No internal microservices, HTTP/RPC or message broker.
- No `media-desktop` compatibility work; its Helix completeness requires a later dedicated refactor.
- No destructive production test without a separately named episode and explicit user authorization.
- Production canary must not modify the Emby Library, Emby metadata or media files.
- No compatibility layer or migration for Mirex, SmartTask legacy configuration, old automation fields or Kairox ingest/delete/archive runtime semantics.
- No automatic physical deletion in Helix Beta.
