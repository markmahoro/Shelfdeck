# ShelfDeck Clean Helix Implementation Gap Audit

Status: closed implementation evidence; audit baseline `4a16f0a94ef23fcf732843e9547bd7b724d9c19d`; no implementation authorization.

Last updated: 2026-07-16

## Authority and purpose

本文保存提交`4a16f0a9`相对clean Helix架构的现有实现差距审计Evidence。它回答“当前代码与Accepted合同
差在哪里、旧代码如何处置”，不定义架构、不改变业务语义，也不是活动实施计划。

发生冲突时，权威顺序固定为：

1. `../../TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；
2. `../../CURRENT_PLAN.md`；
3. `../../CURRENT_STATUS.md`；
4. 本Evidence。

## Audit baseline and scope

审计开始时`HEAD`正是`4a16f0a94ef23fcf732843e9547bd7b724d9c19d`。覆盖：

- `media-service/src`的Composition、Runtime、Store、Capability、Integration和启动/clean-init路径；
- `media-service/web/src`的路由、API client、页面、认证和产品心智；
- `media-service/test`的测试Oracle与可复用低层fixture；
- 基线`media-service/package.json`和相关Operator脚本。

审计只读进行，没有运行单元测试、E2E、Admin Web构建、Docker构建或生产部署。工作区既有
`media-desktop`修改、`media-service/package.json`新增分析入口及未跟踪分析脚本均排除于基线并保持不变。

## Executive conclusion

**clean Helix的业务核心和产品表面需要完整架构重建，但整个技术资产不需要从零重写。**

完整重建覆盖：

- `media-service/src/helix/`五个Business Domain和Execution Foundation；
- 唯一Composition Root和一个`data/shelfdeck.db`；
- Material Control、事务、Outbox/Inbox、Work/Plan/Event/Effect与恢复；
- Application Facade、Projection、Admin API/Auth和九页Admin Web；
- clean initialization、backup/restore和Runtime readiness。

允许保留的是经过逐函数登记和clean合同测试的pure algorithm、Provider protocol、FFmpeg/FFprobe、媒体解析与
文件事务原子。旧Service、Runtime、Store、Executor、Task/Gate语义和页面不能整体继承。

## Mechanical evidence snapshot

| Evidence at `4a16f0a9` | Current | Clean SSOT | Meaning |
| --- | ---: | ---: | --- |
| `media-service/src/helix/` | 不存在 | 固定物理根 | clean组件尚未开始 |
| 服务JavaScript | 100文件、约26,212行 | 新模块化单体边界 | 旧代码规模不等于clean完成度 |
| Admin Web | 19文件、约2,741行 | 九个一级入口与九条旅程 | 当前8页仍是Library/Media/Task/Cleanup心智 |
| SQLite关系表 | 33张 | 156张、7类固定prefix | 现有schema不是clean schema子集 |
| 物理状态库 | `library.db`、`tasks.db`、`config.json`、`nodes.json` | 一个`shelfdeck.db`加Secret/Workspace/Artifact root | 缺少单事务Kernel与Owner隔离 |
| Admin method+path | 80个 | 113个 | 仅11个字面重合；参数名归一后仍缺101个clean route |
| 当前受保护但不在SSOT的route | 80个 | 0个 | 旧Admin及Desktop/Task/Library表面必须退出 |
| public health | 1个 | 1个 | 路径可保留，响应与Readiness需重签 |
| 历史Capability executor | 62个 | 112个clean ref / 96个Result family | 62/62需重签、合并或拆分；0个可整体复制 |
| 服务测试 | 49文件、约5,043行 | Level 10验证矩阵 | 多数绑定旧Kairox/Task/targetGate；仅底层fixture可保留 |

## SSOT-to-code traceability matrix

| ID | SSOT contract | Current evidence | Gap and disposition |
| --- | --- | --- | --- |
| G-01 | §8.1.2固定`src/helix/`与五Domain public/internal包 | clean根不存在；约100个JS文件平铺在`src/` | **missing / rebuild**：新建clean root；旧目录只作Evidence |
| G-02 | §8.1.3只有`createHelixApplication`可全局装配 | `libraCompositionRoot.js`只装配Nexora/Kairox/Libra并解释`source_mutation`；`app.js`自行取得大量singleton | **wrong composition / replace**：唯一显式注入Root；禁止第二Runtime和隐式可写singleton |
| G-03 | §2、§8.2固定Procurement、Libra、Arca、Perception、People五个Owner | 主模块仍是Libra/Nexora/Kairox；Arca与Procurement包不存在 | **owner topology absent**：按SSOT从Object/Process重建，历史名称不继承Owner |
| G-04 | §3分离Physical Material Identity、Domain-local Binding与Material Control | `nexora_subject_bindings`、`kairox_admissions`、`libra_subjects.membership_status`以全局`subjectId`串联；无Control Authority | **model violation / replace**：分别关系化；删除Membership/Admission/global SourceBinding |
| G-05 | §8.5.1唯一`SqliteKernel`打开`shelfdeck.db` | 七个Store分别打开`library.db`或`tasks.db`，配置和Worker另写JSON | **atomicity absent / rebuild**：一个Kernel、scoped Repository/UoW和SQL门禁 |
| G-06 | §8.5.2要求156张固定prefix关系表 | 33张表主要为`nexora_`、`kairox_`、Task/Workflow及旧`libra_` | **schema incompatible / replace**：按156表合同从空generation建库，不做增量migration |
| G-07 | §8.5.4 Handoff、Control、On-deck、Off-deck等原子提交 | 无Material Control、CommitParticipant、Outbox/Inbox；跨`library.db/tasks.db`靠调用和Signal | **critical safety gap / rebuild**：先UoW、Control CAS、Commit Marker、Outbox，再接Domain |
| G-08 | §3–§6 Procurement拥有Material Field、Observation、Region、Triage和Candidate Package | `subLibraries`把Emby section或watchRoot当媒体库；Nexora无Field、Region、Primary/Related或Candidate Package | **domain absent / rebuild**：Emby降为External Provider，Physical Field成为入口Owner |
| G-09 | §4 Handoff A转移Candidate责任、Binding和Control | `Libra.acceptSource`直接创建Membership并调用Nexora onboarding/Kairox admission | **handoff absent / delete semantics**：实现typed Delivery/Acceptance/Receipt；禁止接旧Membership |
| G-10 | §2–§6 Libra拥有Subject、Routing、Spec、Run、Workspace和Product Package | `libraRuntime`聚合媒体库CRUD、观察、感知、维护、offboarding；`kairoxRuntime`用Gate/Task生产 | **wrong scope / decompose-rewrite**：按Intake、Decision、Routing/Spec、Production、Workspace、Delivery拆分 |
| G-11 | §4 Handoff B Accepted只转Custody/Control，不建立Own | 无On-deck Product Package、Arca Acceptance/Custody或Handoff B Receipt | **handoff absent / rebuild**：Libra冻结Manifest，Arca独立验收并原子接责 |
| G-12 | §3–§6 Arca Off-load和On-deck Commit建立Inventory/Shelf Entry/Deck Fact | Kairox optimize capability直接替换/整理来源文件并发布`kairox_optimize_facts`；Arca不存在 | **critical wrong owner / remove-rewrite**：正式Target效果只由Arca执行；On-deck Commit独立建Own |
| G-13 | §2.6、§6 Aftercare从现有Shelf Entry修复 | Maintenance/Optimize从Membership+Admission+targetGate推进；无Shelf Entry/Care Basis/Inventory revision | **process absent / rebuild**：独立Assessment、Basis、Case、Finding、Workspace、Settlement和Inventory commit |
| G-14 | §2.7、§6 Off-deck要求Review/Scope/Authorization/Case/Evidence；Deregistration非破坏 | `Libra.requestOffboarding`接受`retain/detach/delete_source`并由Nexora清理；Cleanup页可直接选择删除 | **authorization/owner violation / delete-rebuild**：旧offboarding不得映射；分别实现Off-deck和Deregistration |
| G-15 | §2、§8 User Perception独立Owner | Libra同步Douban后调用Kairox写`kairox_user_perception_facts` | **wrong owner / replace**：独立`perception_`Store/Facade/Acquisition；消费者只读Projection |
| G-16 | §2、§8 People拥有Registry/Preference/Reference，Media-Cast由媒体Owner拥有 | `personCatalogStore`在`tasks.db`建`kairox_people/kairox_item_people`；metadata capability直接写People | **cross-domain write / replace**：People独立Repository；Libra只读Person Projection，Media-Cast由媒体Owner提交 |
| G-17 | §7–§8 Foundation使用Supporting Work/Attempt、immutable Plan、Event/Attempt、Effect Receipt | `taskStore`以Task identity/targetGate/用户控制为中心；Workflow/Event直接读Task/Kairox/config/signal | **runtime incompatible / replace**：旧Task ID、Gate、控制API和Store不迁移 |
| G-18 | §7 clean Catalog为112项typed contract，Executor只见ExecutionContext/handle | 62项业务executor读取Task、整份Config、Store或正式路径，按`allowedTargetGates`路由 | **executor incompatible / function audit**：0项整体复制；只抽pure/protocol/file-transaction函数 |
| G-19 | §6–§8只有一个Control Plane/Resource Governor，Priority由Process派生 | TaskScheduler、两个Automation Runner、Event Runtime和Governor并行供给/排序；另有PriorityEngine | **duplicate authority / replace**：保留bounded permit算法，删除全局Priority和重复计数 |
| G-20 | §8.4.6 Automation由各Domain拥有，无端到端Engine | 5秒TaskScheduler、Libra/Kairox automation和Signal Bus共同推进同一媒体 | **runtime topology wrong / rebuild**：Domain reconciler只供给自己的Work，Foundation统一dispatch |
| G-21 | §8.5与§10按Effect Class恢复，未知Effect保持recovering/faulted | 恢复依赖Task/Event状态、内存permit和Signal；无Effect Journal、Safety Watermark或完整crash分类 | **recovery unsafe / rebuild**：先建durable Effect/Receipt/Watermark，再接commit-capable capability |
| G-22 | §5、§9配置按Owner形成revisioned Policy；Secret不进普通Store | `configStore.js`向Runtime/Executor注入整份`config.json`，混合Policy、token、Workspace、资源、API Key和SubLibrary | **configuration owner violation / split-replace**：Domain Policy、Platform Setting、Secret Handle分别持久化 |
| G-23 | §9.7只暴露113 Admin route与1 public health；Adapter只调Facade/Projection | `app.js`3612行、93 route，直接调Store/Service/Task并承载Decision；80个Admin route仅11个字面重合 | **API incompatible / rewrite**：Facade/schema稳定后一次换route；不保留Task/Library兼容层 |
| G-24 | §9.7.2/§10.8 Admin Web使用HttpOnly SameSite Session；API Key只存hash | Web把明文`admin_api_key`存`localStorage`并逐请求发送；Security API绑定`config.json`明文Key | **security violation / replace**：Session exchange、credential revision/hash、rotation和Audit重建 |
| G-25 | §9.3–§9.9九页、Activity Ledger、普通/Advanced Diagnostics分层 | 导航为概览/媒体库/媒体/演员/任务中心/清理建议/策略/设置；详情展示Task/automation JSON和日志 | **product incompatible / rewrite**：九个一级入口；普通页面只显示业务旅程，Diagnostics只读 |
| G-26 | §9.8 Projection可重建、GET无副作用、列表有界聚合 | 列表由Libra/Kairox/Nexora即时拼装，部分按项跨服务；无`read_`表和Activity Projection | **read model absent / rebuild**：Canonical Outbox构建`read_`；删除React/GET侧业务推导 |
| G-27 | §10.2 clean init为digest绑定dry-run→外置verified backup→新库/Secret→verify | `helixCleanState.js`把旧targetGate schema称clean，默认备份可在data内，复制后直接递归删除并写marker/config | **dangerous false clean path / retire-rewrite**：当前工具不得用于clean切换或生产 |
| G-28 | §10.10要求完整静态、合同、事务、Domain/Foundation、产品、恢复、平台矩阵 | 49个测试多数固定旧Kairox/Task/targetGate；Admin contract验证旧页面/route | **test oracle obsolete / selective reuse**：保留parser/FFmpeg/DAG/queue/file fixture，重写断言和Owner fixture |

## Disposition register

### Retire after clean cutover

- 旧`libraCompositionRoot`及Libra/Nexora/Kairox Service/Store/Runtime/Reconciler/Automation主路径；
- TaskStore、TaskAdmission/Creation/Control/Scheduler、targetGate、Gate Facts、PriorityEngine和旧Workflow/Resource Store；
- Membership、Admission、global SourceBinding、maintenanceComplete、flowKind及33张旧运行表；
- Kairox Signal/PostEffect隐藏后效；
- 旧Library/Task/Automation/Cleanup/Admin配置route和Admin Web页面；
- 当前`helixCleanState`、`helixRuntimePreflight`及脚本的clean操作语义；
- Libra executor写People Store、Kairox capability修改正式媒体、Signal补偿跨库原子性的路径。

退役发生在完整clean root通过隔离验证之后、切换之前；不是审计阶段立即删除。切换后不保留旧Runtime fallback。

### Rewrite

- `src/helix/`全部Domain package、Facade、Repository、Planner、Capability wrapper和Domain automation；
- `SqliteKernel`、156表、scoped UoW、Material Control、Outbox/Inbox、Work/Plan/Event/Effect、Progress、Resource、Circuit；
- 唯一Composition Root、Runtime lifecycle/readiness/recovery、Server Adapter、113 Admin route、Session/Auth；
- Domain/Platform配置、Secret store、Workspace/Artifact registry、clean init/backup/restore；
- Admin Web九页、Setup、Activity Ledger、危险Intent/Authorization、Advanced Diagnostics和Accessibility；
- 绑定clean SSOT的静态、合同、事务、恢复、API和UI测试。

### Retain as technology shell

- Node.js 20、Fastify、`better-sqlite3`、React、React Router、React Query、Vite、TypeScript与构建工具链；
- 通用UI primitive、responsive/accessibility CSS和图标，但不保留旧路由、DTO、query key或业务文案；
- Fastify static/CORS、日志、Windows tray等无业务Owner外围能力，经新启动/Secret/Health合同审计后接线；
- Provider/Worker/FFmpeg依赖包和已验证协议样本。

### Reuse only after atomization and recontracting

| Atom family | Allowed extraction | Mandatory boundary |
| --- | --- | --- |
| `workflowGraph` | DAG、dependency、condition和nominal port校验 | 新Plan schema；删除Kairox/targetGate |
| `resourceGovernor` | bounded queue、permit、aging和排序 | Foundation唯一Owner；删除singleton/config读取/旧resource key |
| `transcodeService` | FFmpeg/FFprobe、probe、command builder、progress/abort、disc parser、device self-test | typed EncodeIntent/Material Handle；不决定Plan或正式Material commit |
| `metadataArtifactWorkspace` | containment/overlap、checksum、fsync+rename、manifest verify、probe | Foundation Artifact/Workspace Handle；GC/materialize由Owner Scope/Evidence驱动 |
| replacement services | Stage/Switch/Rollback/恢复算法和失败fixture | 只供Arca fixed Off-load/Aftercare；补Identity/Fence/mount/volume合同 |
| Provider/Worker services | HTTP/protocol、parser、pagination、normalization | typed Adapter；不写Fact、建Work、轮询Workflow或暴露Secret |
| pure media/AI helpers | identity、normalization、bitrate、device-plan、embedding/cluster/match/render | 由Owner Planner/Requirement调用；大Payload走Artifact Handle |
| existing low-level tests | parser样本、FFmpeg参数、DAG反例、queue公平性、file crash fixture | 只保留输入和不变量，断言重写到clean合同 |

每个复用项必须登记current locator、clean Owner、target、typed I/O、Effect、Fence、Resource、安全Evidence和新测试。
未登记函数不得复制到`src/helix/`。

## Risk register and dependency chain

| Priority | Risk | Required control |
| --- | --- | --- |
| R0 | 旧Kairox合同被Helix命名伪装为clean | 新root/new generation/静态禁引入；旧preflight不进启动链 |
| R0 | 复用带回错误Owner或正式Material权限 | 0 whole-executor reuse；先合同后提取；跨域import/SQL门禁 |
| R0 | Material/Authorization错误或重复副作用 | Control/UoW/Effect recovery完成前禁止正式Material capability接线 |
| R0 | 当前clean-init删除active数据 | 封存现工具；新工具必须digest、外置backup、hash/fsync且不触碰媒体root |
| R1 | 156表或原子窗口缺口迫使逻辑回到JSON/Signal | Schema机械核对；逐commit transaction fixture；禁止通用Store |
| R1 | 101个clean route缺失导致兼容层诱惑 | Facade/Projection先稳定，API/UI一次切换，不保留旧route |
| R1 | happy path先于Effect recovery | Receipt/Journal/Watermark先于Domain side effect |
| R1 | Secret和Admin credential泄露 | Secret store与Session先于Admin Web；日志/DTO遮罩验证 |
| R2 | Projection N+1和事实漂移 | Outbox驱动`read_`、rebuild、50/200项SQL上限和lag health |
| R2 | Windows/NVENC假阳性 | Level 10分层验证；不得静默CPU fallback或放宽Spec |

~~~text
contracts + static guards + schema
  → SQLite UoW + Control + Outbox/Inbox + Work/Plan/Event/Effect recovery
  → Platform/Integration handles + Workspace/Artifact substrate
  → Perception/People and Procurement
  → Handoff A + Libra
  → Handoff B + Arca On-deck/Inventory/Deck
  → Aftercare + Off-deck + Shelf Administration
  → Projection + Facade + API/Auth + Admin Web
  → clean init/recovery/backup
  → one-time root switch and old runtime retirement
~~~

任何阶段都不能以“新组件接旧Membership/Task/Store”缩短依赖链。未完成全链时只允许isolated fixture，不形成
混合可运行产品。

## Open decisions and closure

审计没有发现新的业务分叉。重建范围、包结构、Schema实现、静态门禁、原子复用和切换顺序均由Accepted SSOT
唯一约束，属于工程实施选择。

Audit result: `COMPLETE / CLEAN CORE REBUILD REQUIRED / ATOMIC REUSE ONLY / NO OPEN BUSINESS DECISION`。

本结论不打开Implementation Gate，不授权E2E、Docker、生产、真实媒体副作用或`media-desktop`修改。
