# P14 BETA-IMPL-03 Product Surface Construction Matrix

Status: `H1.2 REPLACEMENT FROZEN / ARCHITECTURE PENDING / H1.3 FROZEN`

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
| Accepted vertical regression baseline | `ddc3e51909ca4e9f5729c4326b05daee4792326f` |
| Route inventory | 114 total; 40 real; 6 Worker routes intentionally Beta-404; 68 unavailable-503 |
| Core contract counts | 112 Capability / 97 Result family / 178 Table / 43 Canonical Transaction |
| Scope | `shelfdeck service` only; no Worker, Desktop, Ollama, legacy runtime, or generic Store facade |

The earlier `4 real / 6 Worker / 104 remaining` row described the clean
entrypoint before accepted Setup/Foundation route construction. It is stale.
H1.0 froze `36 / 6 / 72`; H1.1 makes the four existing Integration routes
real, producing the mechanically reproduced `40 / 6 / 68` count above.
Accepted Movie/Series/JAV/Western backend verticals do not add route methods and
are not counted as real routes or Feature PASS.

## H1 governance

H1 is a construction batch. The Feature Matrix is the user-outcome acceptance
ledger. One H1 foundation capability may support several Features, but neither
an H1 checkpoint nor an accepted backend vertical may automatically mark a
Feature PASS.

The four accepted verticals are protected by immutable regression baseline
`ddc3e519`. H1 may connect real input only at an existing formal Port, Adapter,
Platform configuration, or Composition seam. It must not change a Procurement,
Libra, or Arca core Coordinator, Owner/Handoff, Canonical Transaction, or formal
DTO. If real input cannot be connected without such a change, the phase stops
with a bounded Design Return.

Production fixture fallback, compatibility/dual path, caller fixture injection,
and legacy fallback are prohibited. A deterministic adapter may implement the
same formal Port in a test, but it must never become a production fallback.

Every H1 phase uses this fixed gate:

`implementation checkpoint → Architecture active review → P14 independent
acceptance → next phase`

The implementation task cannot self-accept. Luna Runner is created, scheduled,
received, terminated, and archived only by the Architecture task. P14 supplies
only a frozen repeat-test list and does not trigger Luna. Luna runs deterministic
bulk regression only; it does not diagnose, repair, or declare PASS.

Ordinary engineering closure remains implementation-owned. Before substantial
work, a bounded cost packet is mandatory when an interpretation materially
extends the phase, adds paid/licensed/hardware/operational dependencies,
creates disproportionate maintenance, broadly reworks accepted paths, or spends
large effort on a low-probability edge. The packet records user outcome,
cheapest compliant option, fuller option, one-time/recurring cost, risks, and a
recommendation; technical possibility alone is not authority for an expensive
interpretation.

H1 is the only authorized horizontal batch. After H1.5 acceptance the task
hard-stops. H2 is not authorized.

## H1.0 executable construction drawing

### Current route surface

The count below is derived from the exact route inventory and the explicit
method assignments in `create-clean-facades.js`, not from journey evidence:

| State | Count | Meaning |
| --- | ---: | --- |
| Real public method | 40 | Public Facade method has an explicit clean implementation |
| Worker Beta exclusion | 6 | Deliberate `404 REMOTE_WORKER_NOT_AVAILABLE_IN_BETA` |
| Unavailable product method | 68 | Deliberate `503 CLEAN_FACADE_NOT_IMPLEMENTED` |
| Total | 114 | Exact machine route inventory |

Of 30 Platform routes, session create/delete and security read are real; six
Worker routes remain Beta 404. H1.1 makes the four Integration routes real.
The 17 remaining unavailable non-Worker Platform methods are the later H1
construction surface: Workspace 3, Resource 3, Formation/Setup 1, security
rotate 1, and diagnostics 9.

### Existing Owner rows and formal seams

| Area | Existing owner rows / formal ports | Existing implementation | Exact H1 gap |
| --- | --- | --- | --- |
| Integration config | `platform_integrations`, `platform_secret_refs`; `IntegrationQueryPort`, `IntegrationHandleResolverPort`, `SecretLeaseResolverPort` | H1.1 adds Platform owner-local repository/application/Admin wiring, encrypted opaque Secret Source and revision-fenced Handle/Lease reads; H1.2 reuses it for four additional closed kinds | H1.2 implementation complete for Douban/JAV-Adult/MoviePilot/optional Emby; independent acceptance pending |
| Provider adapters | `ExternalProviderObservationPort`, `ExternalProviderArtifactPort`, `ExternalProviderRequestPort` | real TMDB plus H1.2 Douban/JAV-Adult/MoviePilot/optional Emby adapters on existing typed ports; test adapters remain explicit test-only implementations | MoviePilot ready/stability file reality remains fail closed until formal root/probe authority is supplied; no hidden savePath mapping |
| Workspace roots | `platform_mount_scopes`, revisions, `platform_workspace_roots`; `MountScopeResolverPort`, `PlatformWorkspaceRuntimePort` | Location registry repository/service with owner, containment and overlap rules | Product host still defaults Libra Workspace from `dataDir`; Workspace Admin routes and safe real probe are unavailable |
| Resource/device | Resource Profile/Policy revisions and Compute Device/Probe rows; `ResourceProfileQueryPort`, `ComputeDeviceQueryPort` | Resource/Worker registry service and repository | No local device/resource probe or public Admin wiring; Worker registry code must not make Worker routes available |
| Face runtime | Existing PBF-23 frames/embedding/cluster/analysis/reference-match Plan/Event/Result chain and People public projection | Test-injected Western analysis engine/model pack seam | No service-local ONNX runtime/model pack asset loader, license/SHA/config fence, or clean production Composition binding |
| Setup/readiness | Existing Owner public facts, route inventory, operational cutover/readiness tests | Public health and clean startup/readiness base | Formation/diagnostic/readiness aggregation routes are unavailable and must remain read-only projections, not a global state machine |

Platform owns 16 existing tables:
`platform_schema_marker`, `platform_mount_scopes`,
`platform_mount_scope_revisions`, `platform_integrations`,
`platform_secret_refs`, `platform_workspace_roots`,
`platform_resource_profiles`, `platform_resource_profile_revisions`,
`platform_resource_operating_policy`,
`platform_resource_operating_revisions`, `platform_compute_devices`,
`platform_compute_device_probes`, `platform_workers`,
`platform_worker_revisions`, `platform_worker_devices`, and
`platform_admin_credentials`.

The formal Platform public ports are:
`IntegrationQueryPort`, `IntegrationHandleResolverPort`,
`SecretLeaseResolverPort`, `MountScopeResolverPort`,
`PlatformWorkspaceRuntimePort`, `ResourceProfileQueryPort`,
`ComputeDeviceQueryPort`, `WorkerHandleResolverPort`, and
`AdminCredentialRevisionQueryPort`.

The formal Integration ports are:
`FilesystemObservationPort`, `ContentHashPort`, `MediaProbePort`,
`WorkspaceFileEffectPort`, `MediaTransformPort`,
`FilesystemMaterialCommitPort`, `FilesystemDestructiveCommitPort`,
`ExternalProviderObservationPort`, `ExternalProviderArtifactPort`,
`ExternalProviderRequestPort`, and `WorkerComputePort`. H1 must not bind or
expose `WorkerComputePort`.

### Historical ignored configuration boundary

The preflight checked only ignored-file existence and configuration key
families; no secret value was read, printed, copied, or committed.

- The main historical checkout contains ignored
  `tests/TEST_ENV_CHECKLIST.md` and `media-service/data/config.json`.
- Potentially reusable operator input families exist for TMDB/Douban,
  MoviePilot, JAV/Adult, and optional Emby.
- Values may be re-entered later only through the formal H1 public
  test-before-save flow and encrypted Secret Store/Secret Handle continuity.
  The historical JSON is not an import source or runtime fallback.
- Historical Western Worker/Python/FastAPI/Mirex/Ollama endpoints and credentials
  are not reusable.
- Historical Emby password/API-key configuration is not copied. H1.2 must use
  the accepted one-time authentication flow and persist only the returned token
  handle.

### Fixed H1 phases, change scope, and sentinels

| Phase | Deliverable and allowed implementation modules | Forbidden scope | Minimum sentinel regression |
| --- | --- | --- | --- |
| H1.0 | Existing `CURRENT_PHASE`, this matrix, mechanical guard script/test only | All business implementation; SSOT; Feature baseline | H1 guard; accepted historical `36/6/72` route status |
| H1.1 | `helix/platform`, `helix/integrations`, Composition, Clean Host; secure Integration config + real TMDB | Domain core, formal DTO/contracts, Provider fixture fallback | P5 secret/provider/public-port/integration tests + four vertical/cleanup sentinels |
| H1.2 | Same seams; real Douban/JAV-Adult/MoviePilot/optional Emby | Cross-provider fallback, cache authority, legacy config import | Provider/integration tests + four vertical/cleanup sentinels |
| H1.3 | Platform location/resource seams, Composition, Clean Host | Domain Store reads, accepted Workspace/Product adapter changes, Worker availability | P5 location/resource + operational cutover + four vertical/cleanup sentinels |
| H1.4 | Service-local integration adapter/model loader, Composition, package manifests only if ONNX dependency is required | PBF-23 Coordinator/DTO/Capability changes, Worker/Desktop/Python service | Artifact + People + Western analysis + four vertical/cleanup sentinels |
| H1.5 | Platform/public projection and existing `helix/projections` seams, Composition, Clean Host | Admin UI/H2 work, global state machine, Domain core | Product surface + operational cutover + four vertical/cleanup sentinels + full architecture |

For every delivery phase, the immutable vertical sentinels include
`p14-clean-service-entrypoint`, `p14-series-handoff-a`,
`p14-jav-routing-spec-run`, `p14-western-routing-spec-run`, and
`p14-workspace-cleanup-audit`. Phase-specific P5/P6/P12/P13 tests are additive.

`media-service/scripts/p14-h1-change-scope-guard.js` is the executable guard.
It checks the complete diff from `ddc3e519`, rejects SSOT/Feature baseline,
all Procurement/Libra/Arca Domain code, all formal contracts/DTO, Foundation,
legacy `app.js`, Worker and Desktop, and allows only the active phase seams.
An out-of-scope need is evidence for Architecture review, not permission to
weaken the guard.

The following sentinel source files are immutable exact paths in every H1
phase. The guard rejects them before the broad independent-test allowlist:

- `media-service/test/helix-architecture/p14-clean-service-entrypoint.test.js`
- `media-service/test/helix-architecture/p14-series-handoff-a.test.js`
- `media-service/test/helix-architecture/p14-jav-routing-spec-run.test.js`
- `media-service/test/helix-architecture/p14-western-routing-spec-run.test.js`
- `media-service/test/helix-architecture/p14-workspace-cleanup-audit.test.js`

H1 additions must use independent test files. A phase may not replace, delete,
weaken, or rename a sentinel to evade its frozen baseline. A later change to
the guard, its own test, `CURRENT_PHASE`, or this matrix is reported as
`governance_checkpoint_review` and requires an explicit checkpoint review; the
implementation task cannot silently redefine the guard.

### Known gaps and bounded Design Return triggers

- H1.1 must choose an implementation-owned encrypted Secret Source and
  Integration aggregate repository/application around existing Platform rows.
  This is ordinary closure while the accepted Port/Owner meaning remains
  unchanged.
- H1.3 must not turn `resolved_root` into a public value and must preserve root
  ownership: `production-workspace → libra`, `aftercare-workspace → arca`,
  `internal-artifact → platform-settings`.
- H1.4 currently has no ONNX/model-pack asset in the repository and no
  `onnxruntime-node` dependency. Missing licensed model bytes/checksum is an
  asset-acquisition gap; it must be reported precisely and must not trigger a
  Worker/Python/Ollama fallback.
- Any need to change a vertical core Coordinator, Owner/Handoff, Canonical
  Transaction, formal DTO, or user-visible Integration semantics is a bounded
  Design Return. Ordinary repository, encryption, HTTP adapter, package,
  retry/recovery, and test choices remain implementation-owned.

### H1.0 verification freeze

- H1 change-scope guard and counterexamples: `10/10 PASS`.
- Accepted Movie/Series/JAV/Western/cleanup sentinels: `27/27 PASS`.
- Full `npm run test:helix-architecture`: `134 fixture files PASS`.
- Inventories: `112 Capability / 97 Result / 178 Table / 43 Canonical
  Transaction / 114 Route / 18 UI Surface`.
- Machine manifest aggregate:
  `345a974464886d213ca36ba21678bd7ad88ece5b2a081f34f4ddbc94accdc3d9`.
- Contract aggregate:
  `c5a62e222ce4063f7ad05073f343e525d417f625cc937ee5f1284a2cf2090995`.
- `unresolvedTypeRefs=0`, findings empty, `prohibitedActionsRun=[]`.

H1.0 replacement `9d396bb4265a628f08a2dcf069dad020f119a3a4`
is Architecture and P14 accepted (P14 evidence `181c57ac`).

### H1.1 TMDB implementation freeze

The four existing Integration Admin routes now resolve to Platform owner-local
application methods. TMDB is the only supported H1.1 kind; all other kinds
remain explicitly unsupported. Configuration uses the existing
`platform_integrations` and `platform_secret_refs` rows, revision CAS, encrypted
opaque Secret locators and bounded Secret Leases. Test-before-save now returns a
short-TTL opaque connection proof; PATCH consumes the proof and never accepts
the credential. Persisted endpoint/config and exact Secret envelope
scope/revision are revalidated before Secret consumption/network access.
Configure/disconnect replay is durable through existing Foundation
receipt/marker/audit technical persistence plus an exact frozen-head recovery
anchor. External responses are byte-capped before parsing and validated as
closed bounded values.

A real TMDB credential and typed identity/metadata read were verified from
ignored private operator input without copying or reporting the value. The
runtime does not import historical `config.json`, ambient provider credentials,
or a deterministic production fallback. H1.1 replacement regression is
`10/10` focused, `50/50` focused+P5+guard, `27/27` frozen vertical, and
`135` full architecture fixture files; the cumulative H1.1 scope guard reports
zero violations.

H1.1 route status is `40 real / 6 Worker Beta-404 / 68 unavailable-503`.
This is construction progress only and does not change Feature status.
Evidence is frozen in
`P14_H1_1_TMDB_INTEGRATION_CHECKPOINT.md`. Architecture accepted source
`8bf8feb5`; P14 independently accepted tested local `6c063801`, evidence
`b1cbd306`.

### H1.2 Provider integration implementation

The same four dynamic Admin routes now dispatch five exact kinds: H1.1 TMDB
plus Douban, Adult Provider, MoviePilot, and optional Emby. No provider-specific
route, table, command model, or secret persistence path was added. Endpoint,
config, Secret locator/envelope, operation, and revision fences are rechecked
before every Secret/network use. Cross-provider envelope swaps and endpoint
drift fail before Secret consumption.

Douban emits only bounded Perception source refs from the official endpoint.
Adult Provider uses only the current official ThePornDB Bearer REST subset
(`/auth/user`, `/jav` exact search, `/jav/{identifier}` exact metadata);
GraphQL has no Clean Helix runtime or fixture path. It preserves exact JAV code
identity and supplies bounded identity/metadata/people-hint/artifact seams
without upgrading weak input before a typed exact provider match. Unapproved
performer/resource operations fail closed. One shared REST client converts the
unique `sku` search result to its bounded official `scene.id`, uses only that
id for `/jav/{identifier}`, and exact-fences returned id+sku for both generic
and Product paths. MoviePilot implements availability, candidate
search, and external acquire request/receipt on the existing P5 observation and
request ports. Optional Emby performs one-time username/password authentication
and persists only the issued access token. All production adapters reject
unconfigured/unsupported kinds and never cross-fallback.

Ignored private operator input produced a real MoviePilot public
`test → proof → save` plus typed availability PASS without exposing credentials.
No usable private Douban, ThePornDB, or Emby credential was present, so their
deterministic transport evidence is construction-only and is not called real
Provider acceptance. ThePornDB official REST shape is bounded against its
current public OpenAPI but is not external credential acceptance. Exact
MoviePilot ready/stability needs a controlled
transfer root and byte-level member probe. Pulling that authority into H1.2
would duplicate H1.3 and materially expand maintenance, so a bounded cost
packet was sent and the user approved keeping it fail closed until H1.3; no
naked path/history config workaround is allowed. This is intentional phase
sequencing, not an unresolved Architecture defect, and it does not establish
download-completion/import Feature PASS or an external-request exactly-once
guarantee.

H1.2 keeps route status `40 / 6 / 68` and Feature status unchanged.
Replacement implementation closure `a9b1f993` passed focused H1.1/H1.2/P5
`33/33`, frozen vertical/P5 sentinels `41/41`, the cumulative H1.2 scope guard with zero
violations, and the full `136`-fixture architecture gate. Counts remain
`112/97/178/43`; unresolved refs, dependency/semantic findings and prohibited
actions are zero. Full evidence is frozen in
`P14_H1_2_PROVIDER_INTEGRATIONS_CHECKPOINT.md`. H1.3 remains unauthorized;
this replacement must first pass Architecture review and then P14.

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
| 4 Operations closure | no newly assigned route | cross-cutting closure gate over already assigned Platform/Arca routes | backup/restore/security/restart and security evidence | F18–F21; it cannot receive a duplicate route assignment |

## Mechanical coverage rule

`media-service/scripts/p14-product-surface-matrix-check.js` is the executable
counterpart of this ledger.  It assigns each route by exact `routeId`, not only
by Facade: core=4, Worker Beta-404=6, Setup/Foundation=59, Formation/Product=7
and Collection/Post-deck=38.  In particular, the four Libra routing rows are
Batch 1 while the other seven Libra formation rows are Batch 2.  Batch 4 is a
cross-cutting closure gate and has no route assignment.  The checker also proves
that no route can name a raw Store, legacy runtime, Worker or Desktop package as
its target.

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

## Batch 1 implementation progress

### Procurement Material Field

`GET /v1/admin/material-fields`, `POST /v1/admin/material-fields`,
`GET /v1/admin/material-fields/:fieldId`, the current extraction-policy read,
Access revision, Policy revision, and non-destructive Field deregistration are
now real Product routes.  Their
path is `Admin HTTP → ProcurementAdminFacade → Procurement owner-local
construction adapter → ProcurementCommand/QueryFacade → MaterialFieldRepository
transaction`; Composition only passes clean construction dependencies and never
obtains the Repository/Store.

- Positive: authenticated create → list → exact read, including the full Policy
  and Field Access digest basis.
- Negative: missing Admin session is `401`; URL `:fieldId` and body `fieldId`
  mismatch fails closed before the Owner command; a reused idempotency key with
  a different request is `409 ADMIN_FIELD_IDEMPOTENCY_CONFLICT`; malformed
  input cannot be admitted by the closed MaterialField contract.
- Recovery: each Field mutation atomically persists its Procurement write with
  the bound Foundation receipt/marker/audit record.  Same key and exact payload
  returns the stored typed result without another write; the Field remains
  readable after clean host restart using the same database and Secret Root.

### Procurement Field Observation

`POST /v1/admin/material-fields/:fieldId/actions/observe`现已接通正式
Procurement纵切。Admin command先通过Foundation Work Admission建立同一
Field唯一non-terminal Observation Work；Clean Service技术adapter只执行
目录枚举、`stat`与SHA-256读取，不创建、移动、重命名或删除来源文件。冻结的
`FieldAccessHandle + FieldObservationPageRequest`交给现有
`procurement.field.page.observe@1`形成最多100项/64 KiB的typed Page，
随后由既有`helix.transaction.field-observation-page-commit`逐页原子提交
完整Evidence、Observation revision/head、Material current rows、typed
Result和commit marker，Outbox固定为零。

Foundation Work/Attempt/Plan/Event只保存执行技术事实，完整Page/Handle作为
immutable Plan input冻结；Procurement业务事实仍只写Owner Store。
`fieldId/accessRevision/observationRevision`使用显式target与CAS，
同key异payload稳定409。故障夹具在第二页insert前中断后证明只保留第一页
完整事实；重启使用已冻结Page、Event Result/marker和上一页cursor恢复，
不重新解释已提交页面，最终连续提交revision 1..3。三份disposable sample
文件在首次执行、故障、restart和exact replay前后内容及mtime均不变。

### T-shaped Movie旅程：Observation → Handoff A

施工顺序已从横向管理路由补齐切换为journey-first。当前冻结的Movie纵切为：

`Admin HTTP Field Observe → terminal Field Observation Result →
Procurement owner-local Automation → Extraction Eligibility Reconcile →
SelectedFieldMaterialSet → procurement.material.control.acquire@1 →
Procurement Run Admission transaction → Evidence Assessment/Triage → immutable
Candidate Package/Offer → Handoff A → Libra Accepted Intake/Subject + Control
transfer`。

Automation没有新增Run admission管理路由，也不把业务判断放入Composition
Root。它只接受正式terminal Observation Result，按显式
`fieldId/access revision/terminal observation revision+workId/policy
revision/active Triage Rule authority`生成稳定Run identity。Eligibility按
Field current material集合、精确last Observation、既有Selection guard及正式
Material Control Projection计算；Run Admission冻结1..1024个UTF-8排序成员的
完整Physical Identity、binding/eligibility/provenance/Control basis，并通过
既有canonical transaction原子建立Run、Run Material rows、同Field
Procurement Control、typed Result和commit marker。Supporting Work只保存冻结
Selection/Control named inputs与执行状态。

真实public HTTP在P14 disposable `film-complete/movie-slice.mkv`上已验证：

- source size `899884162` bytes；执行前后SHA-256均为
  `0e084d2f15a1d923943b97d1f7be175800dafaa7c7af245cebd76310259cb3c8`，
  size/mtime/content均不变；
- 形成唯一active Run
  `procurement-run-a4585e399dfa8792d4aa76eeefb0fa59c1620dfd`，
  Run Basis digest
  `8a5c923ae1ba93ca6f96892aa212d8f69bfdcfc26aeec6032e60fae0cac561af`，
  恰好一个Run Material和一个Procurement-controlled Material；
- 同一Observation命令跨Clean Service restart稳定返回同一Run与Basis，
  Run/Selection/Control均未重复；
- fault fixture在Run/Control/typed Result已原子提交、Foundation Event尚未从
  `executing`切换`succeeded`时中断；重启后由durable Result恢复Event和Work，
  不重新Eligibility、不创建第二Run。

在同一P14 disposable Movie上，Procurement owner-local Coordinator使用已冻结
Run/Run Material/Field Access输入完成typed Evidence、Primary Manifest、Triage、
Candidate Package与Offer发布；Candidate publication canonical transaction同时
建立Procurement→Libra durable Delivery。Libra只通过既有Candidate Delivery
public port消费该Offer，在自己的Intake Acceptance transaction中建立Accepted
Intake、Subject与Libra Material Control Binding，并建立Libra→Procurement durable
Delivery。两侧Inbox/Outbox receipt均按exact replay和restart恢复，不旁读
Foundation Result、不跨Owner Store。

真实public HTTP首轮形成一个Package、一个Offer、一个Subject和一次Control
transfer；跨restart重放返回同一typed result且没有第二次业务副作用。故障注入
在Libra Handoff A receipt写入前回滚，保留唯一open Offer和Procurement Control；
去除故障后重启，重放同一Observation完成原Offer的一次Handoff A。所有路径均
验证source size/SHA-256/mtime零变化。

P14发现的Related NFO ordinary defect已在本纵切内有界修复。Procurement
Coordinator从冻结Run成员生成typed Layout Evidence，按同目录、同stem（或目录内
唯一主视频对应的`movie.nfo`）建立唯一association；Triage使用既有
`Related Material Reference`合同冻结NFO identity、role、Endpoint、location、
checksum与association evidence。NFO不从Observation/Eligibility历史删除，不进入
Media Probe，不形成第二个Movie Unit、Primary Manifest成员、Candidate reservation
或Libra Product Material Binding。无唯一association的NFO只保留为未关联Evidence，
不会被提升为Primary Candidate。

Focused fixture同时包含主视频、精确关联NFO和不相关NFO，证明只探测主视频、Package
恰好一个Primary与一个Related Reference、Candidate Delivery可按digest历史重建、
restart exact replay不重复Package/Offer/Subject，且三份文件的bytes/mtime均不变。

当前Movie已到达**Libra Accepted Intake/Subject + Control transfer**。本段不进入
Libra Routing或Acceptance Spec，不宣称Arca、final Target或Beta完成，也没有
因此增加real route数量。

### T-shaped Movie旅程：Handoff A → active Libra Run（已拒绝的首版）

实现checkpoint `c1501957`曾从已接受的Handoff A继续同一Movie正式链路，并严格
停止在active Libra Run；该checkpoint随后因缺少正式Perception Resolution而被
拒绝，不能作为当前施工基线。其原始范围为：

`Libra Subject → Shelf Routing Assessment/Decision → Decision
Preparation/Basis → Acceptance Spec publication → Libra Run Admission`。

P14真实public HTTP fixture先通过正式Shelf API创建active Movie Shelf并绑定
`system-beta-recommended`，再通过正式Libra Routing API发布Field Policy。Libra
Formation Coordinator仅消费Arca public `ShelfRoutingTargetProjection`与exact
`ShelfStandard` projection；Composition Root只装配这两个查询函数，不持有Arca
Store，也不执行Shelf选择、Requirement生成或Run admission业务判断。Subject、
Field Policy、Decision Input/Basis、Routing Decision、Acceptance Spec与Run均由
Libra Owner-local repository及既有canonical transaction提交。

Routing按照用户配置的Shelf优先级执行第一命中；higher-priority target inactive
时返回typed unresolved并禁止fall-through。首版曾错误地用空Libra输入直接选择
`no_rating`分支；该行为已被拒绝，后续`f0319035`以正式Perception Resolution
替代。
Decision head按H0→H1→H2→H4推进，Spec与Run使用exact revision/digest/CAS及
Material Control projection fence。Fresh restart/replay读取明确Subject、Offer、
Spec和Run identity，返回原active Run，不建立第二个Decision、Basis、Spec或Run。
已有focused fixture覆盖stale Policy/Standard/Control、Spec/Run CAS、事务故障
rollback与restart recovery；Movie/NFO的bytes与mtime保持零变化。

验证证据：

- P8 Decision front-half negative/first-match fixture：7/7 PASS；
- P14 clean public HTTP与source-boundary focused fixture：2/2 PASS；
- `test:helix-procurement`：12 fixtures、15 Procurement tables、8
  Capabilities，P2–P6 regressions PASS，prohibited actions 0；
- `test:helix-architecture`：122 fixture files PASS，dependency/semantic/
  manifest/contracts均无finding；
- inventory保持112 Capabilities、97 Result families、177 tables、43
  canonical transactions、114 routes、18 UI surfaces，contract aggregate
  `c7e08ddbccb71e864846c5cb0ef923d3e48f37af30d1111acb0e0316544a0288`。

本段仅保留被拒绝实现的审计历史；当前有效证据以本文后续
`Movie Decision Identity / Perception continuity correction`为准。

### Procurement Failed-preparation Retry

`POST /v1/admin/material-fields/:fieldId/actions/retry-failed-preparation`
现已接通正式失败重试纵切。closed Admin command必须显式携带
`failedProcurementRunId + expectedFailedRunStateRevision +
expectedFailedRunBasisDigest`，只按该精确Run读取，不搜索latest/current Run。
仅`sealed + failed|partial_failure`且具有`released + triage_failed`成员的
正式历史可建立重试；active、completed、缺失或target不一致均fail closed。

一次命令建立两节点Foundation Supporting Work：第一节点执行既有
`helix.transaction.procurement-retry-intent-commit`，第二节点执行既有
`helix.transaction.procurement-retry-admission`。完整Intent与Admission
request作为immutable Plan input冻结。Intent创建按`fieldId +
idempotencyKey`稳定重放；消费使用`open@revision/digest` CAS，并与唯一新
`ProcurementRunExecutionBasis`、新Run、Selection、Control assertion/acquire、
typed Result和marker原子提交。旧失败Run及其terminal evidence不修改。

实现级fixture复用正式Field Observation自动形成的Run，再通过既有正式
Run Seal fault path制造失败事实。Retry Admission insert故障证明
Intent可已提交而新Run/consume marker保持全无；重启通过Event Result/marker
恢复，只产生一个新Run。同key同payload在同进程及跨重启返回原typed result，
同key异payload为409，第二key不得重复消费同一失败Basis。Windows路径分隔符
在Owner-local Eligibility Reconcile中统一规范化，真实Observation文件可合法
进入Eligibility，来源文件内容保持零变化。

上述证明关闭的是Retry implementation contract，不冒充用户Feature验收。
当前正式产品旅程尚未自然形成`sealed failed|partial_failure` Run，因此
`F02.17`仍为`NOT_RUN`；不得为测试便利新增Run admission/seal管理路由。待
Candidate/Preparation现实链路能够自然产生失败Run后，再由P14从该入口闭合
用户级Retry验收。

### Arca Shelf aggregate

以下 10 条 Shelf route 已经接通真实 Arca Owner-local application：
`GET/POST /v1/admin/shelves`、`GET /v1/admin/shelves/:shelfId`、
`PATCH /v1/admin/shelves/:shelfId`、
`GET /v1/admin/shelves/:shelfId/standard`、
`POST /v1/admin/shelves/:shelfId/actions/bind-template`、
`GET/PATCH /v1/admin/shelves/:shelfId/placement`以及
`POST /v1/admin/shelves/:shelfId/placement/actions/preview`、
`POST /v1/admin/shelves/:shelfId/actions/deregister`。创建 Shelf 时在同一
transaction 建立 initial Shelf、Standard、Placement 与 active routing
projection；Standard/Placement 后续 revision 使用显式 expected revision
与 head CAS。URL/body target、idempotency replay/conflict、digest、FK、
restart/history 以及故障后的零部分写均已有 HTTP/Owner-row 证据。
Shelf rename只修改非Identity名称并用monotonic `updatedAtMs`做CAS，不改变
Target Folder、Standard、Placement或routing projection。Placement preview
形成durable Command Receipt；Target Folder proposal使用closed
`endpointId + canonical absolute rootLocation + mountScopeId/revision`
四元组。Clean Service技术adapter只执行`realpath/stat/access/statfs`，
并把typed read-only probe port注入Arca application；它形成可达、可读、
可写和target-local-slot atomic-switch protocol的readiness Evidence，
不创建探针文件。PATCH必须携带并匹配同一Shelf、
同一expected Placement revision、current Target digest、proposed Target/
Placement digest及`previewId/previewDigest`。发布只在同一Arca transaction
中追加Placement revision并CAS切换`arca_shelves` Target四元组和Placement
head；不执行Inventory迁移、文件移动、复制、删除或重命名。routing
projection不因纯物理Target变化而伪造新Standard/status revision。

在Placement revision insert处注入故障后，Target四元组、
revision/head/receipt均保持零部分写；inactive Shelf稳定拒绝新preview。
旧Target和新Target中的独立physical sentinel在preview、publish、故障、
restart及idempotent replay前后逐字节不变，目录成员集合也不变。不可达目录
在Arca transaction前fail closed且不会被自动创建。

Shelf Deregistration当前闭合的是**empty Shelf正式终态纵切**：请求必须包含
exact-Shelf行政注销authorization和显式active/updatedAt/routing projection
fence；同一SQLite UoW原子写入`arca_deregistrations`、
`arca_deregistration_receipts`、Shelf terminal/routing projection、
typed `DeregistrationReceipt` Result binding和commit marker。故障注入证明
这些行全有或全无；重启后按同一marker/typed Result稳定重放，Target Folder
中的physical sentinel逐字节不变。因为当前P14运行时尚未接通active
Shelf Entry的Inventory/Material Control release assembler，遇到
`active|offdeck_in_progress` Entry会以
`P14_SHELF_DEREGISTRATION_NON_EMPTY_UNWIRED` fail closed；本checkpoint
不声称非空Shelf注销已完成，也不伪造跨Store读取或空Control释放记录。

### Arca Rule Template与automatic-follow

114-route registry中的9条Rule Template route及既有Shelf bind route已经接通
真实Arca Owner-local application：

- Template list/exact-read/revision history；
- system/user Template copy；
- durable user Draft read/CAS revision；
- impact preview、publish与archive；
- Shelf bind及Template新revision发布后的automatic-follow。

Clean init在同一Arca aggregate transaction冻结唯一
`system-beta-recommended`系统Template revision 1，包含Movie、Series、JAV、
Western Adult四组UTF-8稳定排序的Profile Rule Set，以及SSOT确认的
No-rating、1–5星、HEVC、stream file、4K、高质量主音轨、Matroska和
空间上限。系统Template无Draft且所有编辑/发布/归档命令稳定返回
`SYSTEM_TEMPLATE_IMMUTABLE`；copy原子建立新的User Template、published
revision和可恢复Draft。

Draft更新验证closed Outcome vocabulary、profile/draft/rules digest和
`draftRevision + basePublishedRevision` CAS。Preview以durable Command
Receipt冻结Template/Draft head及全部当前绑定Shelf head set；当前尚无正式
Libra未On-deck Subject impact public projection，因此对应数量显式为`null`
并带`libra_subject_impact_projection_unavailable`，不跨Store补读或伪造0。
Publish消费同一preview/draft digest，在
`helix.transaction.rule-template-publish`边界内原子建立immutable Template
revision、切换Template head、为所有active bound Shelf建立完整
`ShelfStandard` revision、切换Shelf/routing projection head并发布Outbox。
任一Shelf CAS/insert失败时Template/Shelf/Receipt/marker/Outbox全回滚。

真实Admin HTTP fixture覆盖auth、URL/body target、closed shape、stable ID、
rules/profile digest、system immutability、copy/draft/preview/publish/archive、
idempotent replay/conflict、history、restart及故障回滚。源码反例证明Arca
Rule Template实现不导入Libra package，Composition只装配public application
port，不持有Repository或Store。绑定中的User Template不能archive；未绑定
User Template可非破坏性终结aggregate。

### Libra Field Routing Policy

以下 exact 4 条 Batch 1 Routing route 已经接通真实 Libra Owner-local
application：

- `GET /v1/admin/routing/material-fields/:fieldId`
- `POST /v1/admin/routing/material-fields/:fieldId/actions/preview`
- `PATCH /v1/admin/routing/material-fields/:fieldId`
- `GET /v1/admin/routing/material-fields/:fieldId/revisions`

Composition Root 只把独立的 Arca public
`ShelfRoutingTargetProjection` port 接给 Libra；Libra 不 import、不查询
`arca_*` Store。Preview 保存 durable Command Receipt，稳定重放
`resolved|unresolved` 结果并拒绝同 key 不同 request。Publish 在 Libra
transaction 中原子保存 immutable Policy revision、连续 rank targets、
exact Field head CAS 与 Outbox；current read 只按 `field_id` 读取 head 后按
`routing_policy_id+revision` 精确解析，不使用 max/latest/current scan。
closed input、inactive/未知 Shelf、非法 direct policy、target mismatch、
stale head、idempotency conflict、restart/history，以及在 target insert
处注入故障后的 revision/head/receipt/outbox 全部回滚均由 public HTTP
fixture 覆盖。

Current route status: **40 real**, **6 intentional Worker 404**, **68 remaining
product routes fail closed with 503**. 非空Shelf deregistration仍未宣称完成。
This is a progress count only; the exact construction batch
assignment remains the 4/6/59/7/38 matrix above.

### Movie Decision Identity / Perception continuity correction

Implementation checkpoint `f0319035` supersedes the rejected
`c1501957` Movie Libra Run checkpoint without entering Workspace or production.
At Handoff A, the exact accepted Candidate Package `identityClaim` is mapped by
the versioned implementation contract
`libra.candidate-claim-title-anchor@1` to one immutable Libra-owned
`DecisionIdentityEvidenceSnapshot@1`. The mapping uses the accepted title with
NFKC, lowercase and whitespace-collapse normalization and freezes a bounded
weak title anchor; it does not use a claim digest as the anchor value and does
not infer identity from a path or Provider.

The snapshot is persisted atomically on the existing
`libra_intake_decisions` row with schema/json/digest support columns and is
bound to Intake Decision, Candidate Package revision/digest, Candidate Delivery
Snapshot digest and exact Claim schema/id/digest. This is an owner-local
Implementation Contract extension; the table inventory remains 177 and Libra
does not reread Procurement or Foundation Result after Handoff A.

For a Profile declaring `rating`, Libra rebuilds the byte-identical
`CanonicalQueryHandle` from its own rows and calls only the formal
`PerceptionResolutionFacade`. Perception uses its owner-local record set,
resolver and commit participant to publish/reuse one immutable
`found(rating=1..5)` or typed `not_found(kind=rating)` Resolution. Libra freezes
that exact Resolution revision/digest and its `VersionedQueryResult` in the
Decision Basis. A Profile not declaring rating performs no query. Unavailable,
stale or integrity-failed Resolution yields typed unresolved and creates no
Basis, Spec or Run.

Recovery fixtures inject a fault after Perception Resolution commit but before
Decision Basis. Restart reconstructs the same query from Libra rows, reuses the
same Perception revision/result digest and creates exactly one Basis, Spec and
active Run. Focused counterexamples cover rating found, no-record not-found,
watched-only rating not-found, changed record-set revision, non-rating no-query
and unavailable/corrupt Resolution. Full architecture verification passes
836/836; package and semantic findings are zero.

Frozen construction values:

- Architecture governance baseline: `1619735c`
- Implementation closure: `f0319035`
- Core counts: `112 / 97 / 177 / 43`
- Contract aggregate:
  `7ece7977c388f6a4230b236089889917618a45e977f91f2928d17bc95ee00b97`
- Result-type digest:
  `00e0f6aefc6fba803111d34652da145f71503d26e91ef31f3d6250ec43f36fec`
- DDL digest:
  `4e16f31d07b8bc2f9678979ac1127eb8c6624477fe2ec347f1836a464b7ec13f`
- Prohibited actions run: `0`
- Remaining gate: P14 independent retest; Workspace/production/Handoff B were
  not started.
