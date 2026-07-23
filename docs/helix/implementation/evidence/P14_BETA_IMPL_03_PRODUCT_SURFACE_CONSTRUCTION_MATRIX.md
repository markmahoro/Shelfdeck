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

Current route status: **34 real**, **6 intentional Worker 404**, **74 remaining
product routes fail closed with 503**.  Field observation and failed-preparation
retry remain fail-closed until their Supporting Work/Capability journey is
wired；非空Shelf deregistration仍未宣称完成。
This is a progress count only; the exact construction batch
assignment remains the 4/6/59/7/38 matrix above.
