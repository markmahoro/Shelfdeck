# ShelfDeck Clean Helix Current Status

Status: Levels 0–10 accepted; P0–P7 complete; P8 in progress under standing P2–P13 Local Implementation authorization; E2E, Docker/Canary, production, real-media side effects and `media-desktop` changes paused.

Last updated: 2026-07-18

## 1. Current position

| Field | Current state |
| --- | --- |
| Architecture | `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` Level 0–10 accepted and final audit closed |
| Open business decisions | none |
| Implementation program | clean-cut Master Plan accepted as direction |
| Completed phases | P0 — implementation gap audit；P1 — Clean Skeleton and Architecture Guards；P2 — Contract and Schema Baseline；P3 — Persistence and Atomic Foundation；P4 — Execution and Recovery Foundation；P5 — Platform and Integrations；P6 — Horizontal Domains；P7 — Procurement |
| Current phase | P8 — Handoff A and Libra front half |
| Current phase status | P8-00–P8-01 PASS；P8-02 in progress |
| Implementation Gate | standing Local Implementation open for P2–P13；external actions excluded |
| Current allowed work | local code、unit/contract/isolated fixture、docs、automatic Phase transition after PASS |
| Integration baseline | exact P7 phase closure `2cf98561d7cf785db4005e65e99b0750d84ce5ce` |
| Phase worktree | `E:\my_project\emby_third_party-helix-p8` on `codex/helix-p8` |
| Next action | P8-02 Libra scoped Store and immutable Subject facts |

Architecture Agent提交`19ed12fa`已闭合`PBF-07-R1`：Page正式收敛为≤65,536 UTF-8 JCS bytes，完整Page作为
Commit Event immutable typed Evidence保存，并通过Observation→Marker→Result Binding形成禁止GC的历史恢复链；
精确Transaction Contract同时决定Outbox cardinality，Field Observation固定零Outbox。实现线程精确纳入该提交后恢复P7-03。

P7-03现已完成：PBF-07-R1重物化提交`3c6e6d6a`冻结64 KiB Page/Result、Observation→Marker FK及25项事务；
实现提交`15f27b7b`提供pure bounded Observer、Procurement-owned Observation/Material revision Store与canonical Transaction
Registry。完整Page作为immutable typed Evidence持久化并可由marker replay恢复；Field head/access/work/page/cursor CAS、Material
binding revision、reality变化后的Eligibility reset、signed int64无损和零Outbox均有机器反例。完整Architecture tests
`526/526 PASS`，未运行E2E、Docker、部署、真实Field/媒体副作用，未修改`media-desktop`，本线程未编辑SSOT。

P7-04实现前审计已返回Design：Eligibility mandatory formula需要可执行Extraction Policy、current duplicate-extraction
suppression、Selection conflict和versioned Material Control Projection；当前Policy只是任意`policy_json`，没有Beta rule schema/
precedence，Procurement没有suppression事实，Control read也没有带revision/freshness的正式Projection，Material current row无法阻止
旧reconcile覆盖新Projection。实现线程未默认allow/无suppression，未旁读旧Store，未修改SSOT。完整缺口见
`implementation/evidence/P7_04_ELIGIBILITY_RECONCILE_DESIGN_RETURN.md`。

Architecture Agent提交`2ff2f60d`已闭合`PBF-08`：固定Beta `ExtractionPolicy@1`及唯一reason precedence，
删除错误的Procurement duplicate-suppression前提，补齐versioned `MaterialControlProjectionSnapshot`、
`ExtractionEligibilityDecision/Batch/ReconcileSummary`、stale-safe CAS、terminal missing、批事务与restart收敛合同。
该修正不新增Domain、Handoff、Capability或关系表；P7-04实现阻塞解除。本实现线程只原样纳入SSOT delta，未自行修改SSOT。

Architecture Agent提交`b6505e93`与`6f137a71`已闭合`PBF-09/PBF-09-R1`：Procurement Run Admission/Seal/Retry、
relationized Execution Basis、Field-scope Control、Candidate Delivery Reservation、Run Seal逐成员Evidence及三项digest、
Retry五项digest/closed stale reason/replay snapshot，以及Procurement-owned immutable Triage Rule Registry均已有精确合同。
实现侧复审确认没有新增Domain、Handoff或Capability；关系表调整为162张，96个Catalog Result family不变，阻塞解除。

P7-04现已完成：`4c4a2c8a`把PBF-08精确传播为112/96/161/26机器合同，`9419e8f5`实现closed Policy验证、
pure Eligibility evaluator和versioned Material Control Query，`5a36fdbc`实现同一SQLite Unit of Work内的Foundation
Control批量重读与Procurement Reconcile。Batch按Field和最多100个排序Identity有界；事务重读Field/Access/terminal
Observation/Policy/Material Binding/Selection/Control，逐项拒绝stale basis，以Eligibility revision CAS原子更新current row；
相同Batch重放为no-op，且不写Event Result、marker或Outbox。聚焦反例、完整Architecture `533/533`和P3 Persistence
聚合门禁均PASS；未运行禁止的外部动作，本线程未编辑SSOT或`media-desktop`。证据见
`implementation/evidence/P7_04_ELIGIBILITY_RECONCILE.md`。

P7-05实现前审计已返回Design。当前`SelectedFieldMaterialSet`只携带最多4096个material key，既允许空集合，又缺少
role、Binding/Eligibility/Reality Evidence、Triage revision和expected Control revision；该上限还与1024项
`ResponsibilityControlCommitHandle`/`ProcurementControlReceipt`及当前Control原子边界冲突。`proc_procurement_runs`
只保存opaque `run_basis_digest`，`proc_run_materials`只保存key/role/binding revision，无法持久化和重建§6.1.4、
§6.3.2要求的可审计Execution Basis。SSOT也没有闭合Run admission/seal的正式原子事务，以及Retry Intent创建后的
open→consumed/stale CAS、新Run唯一建立、typed Result/Outbox与重放连续性。直接实现将迫使本线程私自缩小合法输入、
发明Basis字段或旁读current row冒充冻结事实，因此已停止P7-05代码。详见
`implementation/evidence/P7_05_RUN_ADMISSION_DESIGN_RETURN.md`；本线程未修改SSOT。

P7-05现已完成：`5fdbcb8f`实现ordinary Run Admission，`90afe83f`实现Run Seal，`dcf2fb87`实现Retry Intent Create，
`3b2f4db5`实现Retry consume的stale/created原子分支。完整`1..1024` Basis/Selection、Field-scope Control acquire/assert、
Seal terminal Evidence、Retry五项digest、13项closed stale precedence、业务幂等重放、唯一新Run及共享outer result/marker均有
隔离SQLite反例。Retry Access/Observation/Policy、create/consume marker及Intent↔Run连续性已物化为显式FK；全量Architecture
564 tests、112/96/162/30合同门禁PASS，aggregate为`a53d55146ff40db11d82e188757e383f81960e7fdddaceed01ab094020641c32`。
未运行禁止的外部动作，本线程未编辑SSOT或`media-desktop`。Evidence见
`implementation/evidence/P7_05_RUN_ADMISSION_AND_RETRY.md`。

P7-06实现前审计已返回Design：Primary Manifest正式输入仍由最多4096个key的浅`SelectedMaterials`、无成员映射的
`Roles`及opaque `Structure.memberClaims`组成，无法唯一形成SSOT要求的1..1024个Material→Role→Episode Claim/
Binding成员；Structure/Playability缺少closed deterministic rule和typed Evidence来源，Identity Claim与Candidate Readiness
之间缺少mediaType连续性。实现线程未按数组位置猜测、未旁读Store、未把路径/标题升格为Identity，并已将精确问题包发送给
Architecture Agent。详见`implementation/evidence/P7_06_TRIAGE_PIPELINE_DESIGN_RETURN.md`。

Architecture Agent提交`48d6cac5`已闭合`PBF-10`：四个Triage Capability现在具有exact named typed input/output；
完整Run Selection以`1..1024`成员、显式Material→Role→Episode Claim/Binding/Control映射贯穿Probe、Structure Unit、
Manifest Draft和Candidate Publication；Shared Media Probe/Layout只负责现实读取，Triage Executor保持pure；Playability、
Structure和Identity/Profile均有closed rule、reason、digest及持久化连续性。Primary Manifest ordinal固定从0开始。
实现侧只读复审确认没有新增Domain、Owner、Handoff、Store、跨域写入或Capability；仅新增一张Procurement-owned
Candidate Member↔Episode Claim关系表，SSOT总表数为163。本实现线程仅原样纳入架构SSOT delta，未自行修改SSOT。

P7-06现已完成：PBF-10已重物化为112 Capability、96 Result Family、163表、30 canonical transaction和199个
resolved type ref，aggregate为`fe383269c415f6ca1f8c293018abf625e9db9fed6a02fb185ceace03fa02cfc5`。
四个pure Triage Capability实现Probe Batch显式成员映射、closed Playability reason、Selection完整覆盖与paged
Structure Unit、Series Episode Claim、Identity Claim的mediaType/contentProfile连续性及ordinal从0的Manifest Draft。
567项完整Architecture fixture、85文件/125依赖和1514 semantic files全部PASS，findings与prohibited actions均为空。
未运行E2E、Docker、生产或真实媒体副作用，未修改`media-desktop`。下一工作包P7-07。

P7-07实施前反向审计发现Candidate Publication机器Transaction遗漏
`proc_candidate_primary_material_episode_claims`。Architecture Agent提交`17bb9974`以`PBF-10-R1`闭合：domain
participant固定7张Procurement表，Foundation participant固定3张表，`writeTables`为精确10张并集；Episode Claim、
全部relation、Reservation、Offer、typed Result、marker与Outbox保持全有或全无。实现侧只读复审确认表总数仍为163，
没有新增Domain、Owner、Store、Handoff或Capability；P7-07阻塞解除。

继续实施审计又证明三项正式输入仍未闭合：Delivery必填`acceptance_basis_digest`没有来源或digest公式；原子Offer
缺少稳定`offerId`及正式Outbox message/schema/dedup payload；Candidate DTO与持久化表使用两组不同continuity kind且
没有映射规则。以上事实进入Libra Intake，不能由实现默认推断。P7-07已再次返回Design，详见
`implementation/evidence/P7_07_CANDIDATE_PUBLICATION_DESIGN_RETURN.md`。

Architecture Agent提交`ea702945`以`PBF-10-R2`闭合上述三项：Acceptance Basis由final Package与公开Handoff A
合同按唯一JCS/SHA-256公式派生；Offer ID、message ID、consumer、dedup和typed payload均可重放；continuity kind
全链路采用唯一canonical枚举，不设别名或转换层。Candidate Package保持8.6.19完整字段且不包含Offer字段或`subjectId`。
实现侧只读复审确认未新增Domain、Owner、Store、Handoff、Capability或关系表，P7-07恢复实施。

进一步原子事务审计证明Run `candidate_package_revision_head`必须执行CAS，但PBF-10-R1的机器写集遗漏承载该head的
`proc_procurement_runs`。Architecture Agent提交`52382fc7`以`PBF-10-R3`闭合：该Run表现同时属于CAS fence read和
Procurement domain write participant，Candidate Publication最终为8张Procurement表加3张Foundation表的11张精确
write table；Run head与Package、relations、Reservation、Offer、Result/marker、Outbox全有或全无。163张表总量及
PBF-10-R2全部合同保持不变，P7-07继续实施。

P7-07现已完成：PBF-10-R2/R3机器合同重物化保持112/96/163/30，Candidate Publication以精确11表事务原子CAS
Run revision head并发布Package、Manifest、Season/Episode/Related关系、Run Material Reservation、Delivery/Offer、typed
Result、Commit Marker与`fx_outbox`。Package-derived Acceptance Basis、stable Offer ID、typed message/dedup、canonical
continuity kind及Structure Evidence连续性均由实现和反例固定；业务重放、stale fence、legacy alias、Evidence不匹配与Outbox
崩溃全回滚测试PASS。未跨域写Libra Store，未写`fx_outbox_deliveries`，未运行任何被禁止的外部动作。下一工作包P7-08。

P7-08现已完成：Procurement的8个P2 Capability以唯一registration layer绑定Foundation Registry/Dispatcher；5个
`pure_observation`、2个`domain_fact_commit`和1个`responsibility_control_commit`保持精确Owner、Effect Class、contract
version与semantic validator。机器反例拒绝缺失/额外Capability、Owner/Effect漂移和untyped port；同步Domain/Control提交未被
伪造成Workflow，registration layer不依赖Runtime、Store或legacy。下一工作包P7-09。

P7-09现已完成：`CandidateDeliveryPort`只接受正式`ProcurementCandidateOfferAvailableMessage@1`，按Candidate ID/revision/
digest读取并返回detached、deep-frozen `CandidatePackage@1`。服务重新计算Package digest、Package-derived Acceptance Basis与
stable Offer identity，任何Package或Offer漂移均fail closed。synthetic Libra重复读取不改变Candidate事实，且边界不拥有
Procurement Store、Subject、Routing、Control transfer、Runtime或Signal Bus authority。下一工作包P7-10。

P7-10现已完成：新增`npm run test:helix-procurement`单命令隔离验收器，自动执行11个P7 fixture family、精确核对
15张Procurement表和8个Capability，并串行回归P2 contract、P3 persistence、P4 runtime、P5 platform与P6 horizontal
聚合门禁。结果全部PASS，`findings=[]`、`prohibitedActionsRun=[]`；全过程只使用synthetic fixture与临时SQLite。下一工作包P7-11。

P7-11正式clean-tree Exit Audit对`e598874463d07fc7419b5ef467cff167ae85109f`返回`ok=true`、`findings=[]`、
`prohibitedActionsRun=[]`。P6 closure后的515个文件全部分类；SSOT精确等于Architecture Agent `5c1d5079`批准blob，
SSOT aggregate为`f72ca6803fff817969d4a6765204a42bcbe46b80493dbc725c314f3687c2be6d`，P2 contract aggregate为
`96fa463bcc745feddb2f342b1babd354017fd88772b694cc6535229d8671c3fc`，Exit Evidence digest为
`96e2bcaede2b92a2754a11705b42346cca64b1dac6de2f4a8fa5870cac526278`。P7已满足归档与自动进入P8的全部条件。

P8-00已完成：从P7 closure `2cf98561d7cf785db4005e65e99b0750d84ce5ce`创建独立
`codex/helix-p8` / `E:\my_project\emby_third_party-helix-p8`。在temporary detached clean checkout上复跑P7 Exit Audit，
12个P7 fixture family、15表/8 Capability及P2–P6聚合回归全部PASS；审计`findings=[]`、
`prohibitedActionsRun=[]`，baseline receipt digest为`8dcd255897b38838f98bec55f00bf60b855b1bf173653a2b8a76681625f21f05`。
下一工作包P8-01。

P8-01已完成：当前Phase只公开SSOT明确命名的`LibraIntakeFacade.offerCandidate`，输入固定为
`ProcurementCandidateOfferAvailableMessage@1`；未为后续Admin、Product Delivery或Workspace Reclamation提前发明方法。
nominal binding拒绝缺失/额外authority，机器边界证明public package不依赖Store、Procurement internal、Runtime、HTTP或startup。
下一工作包P8-02。

## 2. Accepted implementation conclusion

clean Helix的业务核心、Persistence、Execution Foundation、Application Facade、API/Auth和Admin Web需要在
`media-service/src/helix/`完整架构重建。旧Libra/Nexora/Kairox/Task主路径不是可增量修补的clean骨架。

保留原则：

- Node/Fastify/SQLite/React等技术栈可以继续使用；
- Provider protocol、FFmpeg、媒体解析、DAG、queue和文件事务算法只能逐函数登记后原子化复用；
- 62个旧业务executor中0个允许整体复制；
- 旧Runtime事实不迁移、不dual-read/write/run、不成为fallback；
- 完整切换前不形成半新半旧可运行产品。

## 3. P0 evidence summary

审计baseline为`4a16f0a94ef23fcf732843e9547bd7b724d9c19d`。关键Evidence：

| Measure | Current implementation | Clean contract |
| --- | ---: | ---: |
| clean root | 不存在 | `media-service/src/helix/` |
| relational tables | 33 | 156 |
| Admin method+path | 80 | 113 |
| literal overlapping Admin route | 11 | not semantic compatibility evidence |
| clean routes structurally missing | 101 | 0 |
| historical business executors | 62 | 0 whole-copy entitlement |
| clean Capability / Result family | 0 implemented | 112 / 96 |

完整28项差距矩阵、删除/重写/保留/原子化复用台账和风险依赖链已冻结在：

`implementation/evidence/IMPLEMENTATION_GAP_AUDIT_4a16f0a9.md`

Audit result: `COMPLETE / CLEAN CORE REBUILD REQUIRED / ATOMIC REUSE ONLY / NO OPEN BUSINESS DECISION`。

## 4. Completed P1 package

P1详细Work Package已归档到`implementation/archive/P1_CLEAN_SKELETON_AND_ARCHITECTURE_GUARDS.md`：

| Work Package | Status |
| --- | --- |
| P1-00 Isolated workspace and baseline receipt | complete |
| P1-01 Clean physical package skeleton | complete；42 unique package markers |
| P1-02 Domain public/internal boundary | complete；5 frozen public entries / 12 default-deny rules |
| P1-03 Unique Composition Root shell | complete；fail-closed / zero import side effect |
| P1-04 Import/dependency guard | complete；42 packages / 6 source files / 5 dependencies / 0 findings；9 positive/negative checks |
| P1-05 Forbidden legacy semantics guard | complete；12 rule families / exact structured exemptions / 6 checks |
| P1-06 Manifest/reuse-ledger framework | complete；10 Owners / 42 packages / 62 baseline locators / stable digest |
| P1-07 Architecture verification harness | complete；single local command / 4 fixture files / JSON evidence |
| P1-08 Phase Exit Audit | complete；PASS Evidence frozen |

P1与P2已关闭；clean root仍未接入`server.js`、`app.js`或任何旧Runtime。P2只冻结合同，不构成Persistence或Runtime实现。

### Completed P2 work packages

| Work Package | Status |
| --- | --- |
| P2-00 Standing authorization and isolated baseline | complete；`c52e67fa` → `f1b5510d` |
| P2-01 SSOT extraction oracle/source map | complete；112/96/156/18；17 shards；10 negative checks |
| P2-02 Shared nominal type/envelope registry | complete；28 JSON Schema；registry digest `af6cb77b…` |
| P2-03 112 Capability contract packages | complete；112 packages / 896 files；final digest `3ffa356d…` |
| P2-04 96 Result family closure | complete；96/96 inventory；191 refs / 0 unresolved |
| P2-05 156 table contract inventory | complete after semantic repair `d96464a7`；156/156；57 closed state enums；148 inline FKs；30 JSON columns |
| P2-06 18 canonical transaction inventory | complete；10 Control commits；19 crash bindings |
| P2-07 Cross-inventory verification harness | complete；single P2 command；aggregate `ebbfda88…` |
| P2-08 Phase Exit Audit | complete；audited `a7357810`；evidence `f4ac678c…`；1331 tracked contracts |

## 5. Engineering governance state

- `CURRENT_PLAN.md`：精简Master Roadmap和授权边界；
- `ENGINEERING_PLAYBOOK.md`：Ready/Done、Work Package、门禁、测试、Review、复用、Git和停线规则；
- `implementation/CURRENT_PHASE.md`：唯一活动P6详细执行包；
- `implementation/evidence/`：冻结审计与验收Evidence；
- `implementation/archive/`：保存已冻结的P1–P5执行包。

工程文档不能覆盖架构SSOT。任意时刻禁止出现第二份活动Phase详细计划。

## 6. Safety and worktree state

- NAS ShelfDeck Docker `192.168.12.230:18080`保持生产边界，当前不接触；
- 四库真实来源E2E保持停止；
- P6本地实现已打开；不运行E2E、Admin Web构建或Docker构建；
- 不部署、不初始化生产数据、不执行真实媒体副作用；
- 当前旧`helixCleanState`/preflight不得用于clean切换或生产；
- `media-desktop`继续排除并保留用户未提交修改；
- 用户`media-service/package.json`分析入口和未跟踪分析脚本保持不变；
- P2使用独立worktree完成；P3–P13继续按Phase隔离，不能直接使用原dirty工作区。

## 7. Open risks and blockers

| Priority | Current risk | Control |
| --- | --- | --- |
| R0 | 旧Kairox合同以Helix命名回流 | P1 clean root和机器禁引入门禁 |
| R0 | 原子复用携带错误Owner/Store/Material权限 | function-level ledger；0 whole-executor reuse |
| R0 | 当前误导性clean-init造成数据破坏 | 封存；P13按Level 10完全重写 |
| R1 | 后续为进度创建新旧混合路径 | Master dependency invariant和Phase Exit Audit |
| active control | Standing授权仅限本地且clean root不得接旧产品主路径 | Current Phase Non-goals与Master dependency invariant |

## 8. Next checkpoint

P2 Exit Audit已在fresh-worktree复现性修正后PASS并归档。审计闭合提交`a735781010ee58c4119d93bb320bfe11bf1d4b7f`，合同aggregate digest为
原始aggregate为`ebbfda8885837170d48a0feb8f3aaad9a32aa35c44dc2db21704f820a6e3fc4a`，Exit evidence digest为
`f4ac678ce0b943e86b1317185866172e579ce273e2f6a6f515a16b76180f9352`；1379个P2 changed files与1331个tracked
contract files反向审计、findings=0。P3首次baseline发现并促成修正了被`release/` ignore遗漏的8-file Capability package；
现在Exit Audit会拒绝任何物理存在但Git未纳管的contract artifact。
P2未修改SSOT、未执行DDL/SQLite、未接startup、未触碰E2E/Docker/production/real media/`media-desktop`。下一检查点是
P3-00已完成：`codex/helix-clean`与隔离P3 worktree从精确闭合提交
`e3b50f946956105b18ffcf0853c8c2a57ebb4db8`开始；fresh checkout P2 gate恢复112/96/156/18 PASS、191 refs / 0 unresolved，
aggregate `ebbfda8885837170d48a0feb8f3aaad9a32aa35c44dc2db21704f820a6e3fc4a`。原dirty workspace与`media-desktop`
保持不变。P3-02预审发现原P2 table semantic baseline弱于SSOT §8.5.9；`d96464a7`已修正57个开放状态枚举、3个误判
revision-set digest、6个整数版本/优先级字段、revision起点和168个SHA-256检查。替换后的P2 aggregate为
`aab78271f712df7714233f0a79e24453e0c1a85c5d214ebf926dc6e71adba247`，fresh detached worktree全门禁及重物化零diff PASS。
P3-01最终DDL digest为`98e50feb79165844951ab5133f383eedc82848e83b0e4a2c4a58059121548b11`，156表、72 index、19/19
partial-unique保持闭合。详见`implementation/evidence/P2_TABLE_CONTRACT_SEMANTIC_REPAIR_D96464A7.md`。P3-02已在
`63e96c0e`完成：唯一Kernel、WAL/FK硬门禁、clean generation/Catalog/integrity/FK/partial-unique/guard self-check及
same-commit timestamp全部通过5组disposable SQLite正反例和fresh detached-worktree完整门禁。未接startup、未访问本地
`data/`，所有临时数据库已删除。P3-03已在`e17e109e`完成：Repository statement只能从manifest登记的同Owner表/列生成，
Unit of Work最多持有一个Business Domain并为Control/Foundation分别发放短生命周期context；7项正反例与静态guard拒绝跨域、
raw SQL、未声明authority、immutable UPDATE、异步/嵌套/context逃逸，fresh detached-worktree与DDL重物化零diff PASS。
P3-04已在`14b0e89c`完成：同事务preflight保证same-key/same-digest稳定replay且不执行Domain，different-digest
稳定拒绝；首次执行按Owner Fact→Receipt/全局Marker/append-only Audit整体提交。6组崩溃/约束反例和fresh detached-worktree
完整门禁PASS，不存在孤立Receipt。P3-05已在`fed454cb`完成：Producer事务冻结完整consumer set/Delivery，Consumer事务
原子写Domain Fact+Inbox，ack保持后续Foundation事务；6组dedup、重复投递、consume-before-ack、last/duplicate ack及startup
篡改反例在fresh detached worktree PASS，Delivery不持有Domain权限。
P3-06已在`f3ec7a81`完成：canonical Physical Material Identity重算、expected revision/from-to scope/scope digest
精确验证、单一current+append-only revision CAS，以及replace-control-set多Identity原子性均由5组fixture与startup tamper
反例证明，fresh detached-worktree完整门禁PASS；Control未创建Binding或Domain事实。P3-07已在`d7f27848`完成：exact
Owner/aggregate/fact/schema Registry强制预声明`domain_fact_commit` Effect Class和revision fence，payload digest与participant
Owner/bound Owner均fail-closed；coordinator不接受调用方Repository、SQL或generic participant，只在同一scoped UoW组合Domain、
可选Material Control、Commit Marker与同Owner Outbox。6组原子/replay/unknown schema/payload drift/wrong Owner/revision/marker
conflict/Control CAS反例、完整门禁和fresh detached-worktree均PASS，SSOT与P2合同digest未改变。P3-08已在`6bbf66ff`
完成：18项合同、56个声明写表、132个participant/COMMIT故障点、18个revision-fence反例、10个stale Control CAS反例和
11个真实Outbox路径均使用disposable SQLite验证；COMMIT前任一点失败保持完整快照不变，COMMIT后进程丢失/reopen保持整套
声明事实可见，Handoff上游prefix及其它forbidden write set不变。66/66专项测试、完整门禁和fresh detached-worktree均PASS，
没有真实文件/Provider/网络/媒体副作用。P3-09已在`bb8a797d`完成：唯一`P3_LOCAL_CROSS_PERSISTENCE`命令聚合完整
架构/合同/Owner/atomic fixture门禁，并在owned temp root重物化156表、72 index、19 partial unique exact catalog；5组专项
反例拒绝越界/非DB路径、unknown participant module、legacy table、compatibility view和外部动作入口，子进程不继承ambient
credentials。专项、聚合命令和fresh detached-worktree均PASS。P3 Exit Audit已对实现提交`5f433d930ba3111c19b1589816b96c790d60e5f3`
完成正式与fresh detached-worktree双重复审：111 changed files全部属于6类允许范围，findings=0，evidence digest
`b7269dd77b5d7d41cbd45cb80834f79254b1b1a7410834d80bc3e697c08260e1`。P3已归档，完整Evidence见
`implementation/evidence/P3_PHASE_EXIT_AUDIT_5F433D93.md`。下一检查点是P4-00精确闭合提交与隔离P4 baseline receipt。
P4-00已从精确phase closure `4a59356f3a89f1af38f594763aaaa0465e203b99`创建`codex/helix-p4`隔离
worktree；新检出的P3聚合门禁恢复112/96/156/18、156表/72 index/19 partial unique与18 transaction/132 crash points
全部PASS，`prohibitedActionsRun=[]`。原`master` dirty清单及6个既有`media-desktop`修改保持不变。下一检查点是P4-01
Foundation public ports and runtime nominal contracts。P4-01已在`4a9b5a59`完成：补齐SSOT要求的第43个
`foundation.public` package，精确暴露7个Port且拒绝Repository/SQLite/Executor/generic dispatch；Runtime nominal
state/Plan Resolution/Priority/七种Effect Class分别由P2表与112 Capability合同反向校验。Supporting Work Definition拒绝
预选Capability/Executor/flow/path和非opaque引用。8组专项、218-test完整门禁及fresh detached-worktree均PASS，P2合同
aggregate不变。P4-02已在`758b92ad`完成：112项exact Registry、Domain+Shared可见性、schema/semantic/executor
binding与typed Dispatcher全部fail closed；Context/input/parameters/Fence/Outcome/Result/Evidence逐层验证，拒绝版本替代、
权限字段和非pure无Receipt success。`foundation.capability`只精确授权Ajv两个模块。8组专项、完整门禁及fresh detached
worktree均PASS，P2 aggregate不变。P4-03已在`7efb760d`完成：WorkAdmission在同一Foundation事务读取持久化
Work/Event/Circuit权威事实并原子写Work+typed Receipt；replay/digest conflict/concurrency/hard cap/Circuit/invalid Process
和rollback均由7组反例闭合，未写业务域表。语义门禁发现的`Admission`简写通过改名为canonical `WorkAdmission`解决，
未新增豁免。完整门禁和fresh detached worktree均PASS。P4-04已在`40fd0cc9`完成：完整logical Plan/node合同纳入
deterministic graph digest，DAG/Capability/schema/Effect/resource/Fence/output/approval/retry/timeout/compensation逐项fail closed；
发布原子写Plan/Node/Edge/Event，root ready/dependent pending，同Attempt同图replay、异图冲突，零Domain写。6组专项、完整
门禁及fresh detached worktree均PASS。下一检查点是P4-05 Work Supply Controller。没有需要用户决定的业务问题。
P4-05已在`6e06a70f`完成：Supply Controller只读持久化target/Work/Attempt/Event/Circuit事实，soft/hard cap、
safety/handoff reserved lane和60秒minimum background进展均返回稳定snapshot，不删改事实、不选Capability、不判断容量。
6组专项、完整门禁及fresh detached worktree均PASS；per-resource竞争明确留给P4-07 Governor。下一检查点是P4-06
Scheduler/dependency readiness/technical lease。没有需要用户决定的业务问题。
P4-06已在`2c79072e`完成：Scheduler只读Foundation normalized Work/Event/Edge事实和Owner发布的同一Business Priority
Projection；五档不可跨越，同档按local priority+每60秒aging及FIFO stable key排序，Event严格重验ready、retryAt和
`success|terminal`依赖。technical lease仅为带fence digest的短期进程内并发锁，不持久化、不替代Permit、Reservation、
Material Control或Authorization。6组专项、38-file完整架构门禁及fresh detached worktree均PASS，semantic findings=0，
P2 aggregate保持`aab78271f712df7714233f0a79e24453e0c1a85c5d214ebf926dc6e71adba247`。下一检查点是P4-07
Resource Governor、Profile Mapper和atomic Permit bundle。没有需要用户决定的业务问题。
P4-07已在`ff72c6cd`完成：pure Profile Mapper精确实现`default|full`容量，未验证/未知设备为0、Provider与验证slot
上限不可突破、SQLite/control/mutation保持单写；唯一进程内Governor原子发放multi-key Permit bundle、每Event一个waiter、
跨档禁止aging越级，Profile降档不撤销执行中Permit，并用`finally`释放。Permit/waiter不持久化；仅queue hard-full原子写
`fx_resource_defer + Event retryAt`，退避固定5s/30s/2min/10min。12组专项、40-file完整架构门禁及fresh detached worktree
均PASS，semantic findings=0，P2 aggregate不变。下一检查点是P4-08 Event Runtime、Fence、Outcome/Result和Progress。
没有需要用户决定的业务问题。
P4-08前置审计发现immutable Plan完整合同无持久化位置；用户已明确授权返回Design。`4f3c41b9`以最小SSOT修正补齐
Plan Objective及Node approval/auth/retry/timeout/output/compensation字段和compensation FK，并新增可复现source-map
materializer。新SSOT/P2/DDL digest分别为`8b250ce4…`/`fe2f4433…`/`29a8e6b6…`；156表、72 index、19 partial unique、
112/96/156/18及18 transaction/132 crash points保持PASS。历史Evidence未改写，完整传播记录见
`implementation/evidence/P2_P4_IMMUTABLE_PLAN_PERSISTENCE_REPAIR_4F3C41B9.md`。P4-08随后在`3788d9fc`完成：ready-only
Event Runtime、双Fence、exact approval/auth、四种Outcome、immutable Result、DAG/when推进、Progress和Resource timing
全部闭合；Executor crash保留durable executing Attempt供P4-09恢复。29组专项、完整门禁及fresh detached worktree均PASS。
下一检查点是P4-09 Effect Journal和七类Effect-specific Reconciler。没有需要用户决定的业务问题。
P4-09已在`4aaa6450`完成：每个non-pure Event在Executor前先持久化Effect intent，Effect ID由Effect Class与
idempotency key确定性生成，后续合法safe retry只能复用同一intent，不能建立第二条副作用通道；已存在、terminal或
reconcile-required intent均不得返回ordinary dispatch。Effect Receipt先落`effect_observed`，再由class-specific fake
reality verifier核验，最后才在同一Foundation事务写immutable Commit Marker并把Journal置为`committed`；崩溃、证据缺失、
receipt/marker冲突保持`reconcile_required`或fail closed，不伪造外部原子事务或Result。七类Reconciler分别实现safe redo、
Workspace reuse/declared cleanup、external identity observe、Fact marker/revision/Fence、whole responsibility/control、Material
forward/declared rollback和destruction forward-only；unknown class、partial transfer和未授权rollback均阻断。26项专项测试、
45-file完整架构门禁、P3 persistence aggregate及fresh detached-worktree审计全部PASS；P2 aggregate仍为`fe2f4433…`，
DDL仍为`29a8e6b6…`，未触碰真实文件/Provider/Worker、E2E、Docker、production或`media-desktop`。下一检查点是P4-10
Retry、Timeout和declared Compensation。没有需要用户决定的业务问题。
P4-09随后以`06b80c15`补齐deferred external request的typed `ExternalJobReceipt`持久化：receipt identity在进入
reconcile前写入同一Effect Journal，idempotency drift或替换external identity均fail closed。P4-10已在`b84a8707`
完成：Execution Policy Registry对exact Capability集合冻结versioned Retry/Timeout/Compensation binding，并与Capability
snapshot合并计算Plan catalog digest；Planner不能写任意policy ref。Event failure、deferred observation及Work Attempt replan
使用三个独立预算，non-pure failure/timeout在`safe_retry`证据前只能进入effect-specific reconcile，Basis变化必须返回Domain
Owner。Timeout deadline只由Plan policy生成，调用方不能覆盖；执行句柄必须先被isolator终止隔离，Attempt才以timeout收口，
Permit仍由`finally`释放。普通DAG推进明确跳过compensation node；只有同Plan预声明target/contract、`compensate`恢复决定、
reality evidence及restricted applicability全部匹配时才可原子激活，destructive effect禁止rollback。38项专项、47-file完整
架构门禁、P3 persistence aggregate及fresh detached-worktree审计全部PASS；P2/DDL digest不变，未执行真实副作用或外部环境
动作。下一检查点是P4-11 Pressure Guard和persistent Circuit Breaker。没有需要用户决定的业务问题。
P4-11已在`1e5c6732`完成：Pressure Guard按SSOT固定阈值识别即时Correctness fault、连续hard cap、写入率发散、
waiter/background starvation、WAL连续增长和Permit不守恒，只写`fx_circuit_states`，不清队列、不改Event或Result。
Circuit open事实跨重启保留；相同证据稳定replay，不同证据不能静默覆盖；关闭必须严格经过`open → recovering → closed`
并同时提交invariant restoration与reconcile evidence。open/recovering Circuit阻止新normal/background及未开始commit effect，
只保留diagnostic、reconcile、已开始Control/Receipt收口及已跨不可逆边界的forward recovery；Event Runtime在Permit/Attempt/
effect intent前执行该门禁。26项专项、48-file完整架构门禁、P3 persistence aggregate及fresh detached-worktree审计PASS，
P2/DDL digest不变。下一检查点是P4-12 Startup recovery和Foundation readiness。没有需要用户决定的业务问题。
P4-12先以`a2ebe66f`建立只读startup recovery gate，随后审查发现原分类仍可能让待执行恢复动作错误进入ready；
`9dae2330`已将其修正为彻底fail closed。启动先校验DB integrity、Plan catalog、Capability/Policy binding，再扫描全部
nonterminal Work/Attempt/Plan/Event/Event Attempt/Effect/resource defer/Circuit事实；pure崩溃、non-pure intent前崩溃、
已提交Effect及七类exact Reconciler分别产生明确恢复动作。任何恢复动作存在时保持`recovering`，全局Circuit或未知合同/
Effect、orphan、多Effect、缺失defer/reconciler、catalog/integrity漂移均阻止normal supply；scoped Circuit保持`degraded`。
启动不批量重置Event，不恢复进程内Permit/waiter/lease，也不写业务事实。8项专项反例、49-file完整架构门禁、P3 persistence
aggregate及fresh detached-worktree审计全部PASS；P2 aggregate仍为`fe2f4433…`，18 transaction/132 crash points保持PASS，
`prohibitedActionsRun=[]`。下一检查点是P4-13 Cross-runtime crash/recovery verification harness。没有需要用户决定的业务问题。
P4-13已在`daaa0970`完成：新增唯一`P4_LOCAL_CROSS_RUNTIME_RECOVERY`本地命令，先聚合state machine、Owner/Port、
DAG/supply、backpressure/Permit、Fence/Progress及Effect Journal/Reconciler全部架构fixture，再在owned temp DB中执行
1个pure process-loss场景和6类non-pure Effect×5个边界（intent前、intent后、fake effect后、observation后、commit后），
共31个跨进程崩溃场景。每次崩溃均重新打开SQLite并重复分类，随后恢复和再次replay；最终严格保持一个Effect、一个
Commit Marker和一次fake dispatch。矩阵调用真实七类Reconciler，证明Material/Destructive intent后按`continue_forward`、
Workspace按reality复用、其它已提交事实按exact receipt/marker收敛，而非统一fallback。3项专项反例、50-file总门禁、
P3 persistence aggregate及fresh detached-worktree审计全部PASS；P2 aggregate仍为`fe2f4433…`，18 transaction/132 crash
points保持PASS，`prohibitedActionsRun=[]`。下一检查点是P4-14 P4 Phase Exit Audit和Evidence freeze。没有需要用户决定的业务问题。
P4 Exit Audit已对实现提交`fa8debb37cf118e39bb769f82336ecc0c0a1f2a3`完成正式与fresh detached
`--require-clean`双重复审：73个changed files全部属于8类允许范围，SSOT只包含已授权`4f3c41b9`修正且Git blob/
source-map aggregate精确匹配，旧Runtime、Domain/P5、API/UI、deployment和`media-desktop`越界findings=0。P4 aggregate
保持7类Effect/31个跨进程crash scenario，P3保持156表/72 index/19 partial unique和18 transaction/132 crash points；
Evidence digest为`3c3053d37ffcc2836e5e07ae9fd73186bf0ddef8395c42163e227b74328a5827`，完整Evidence见
`implementation/evidence/P4_PHASE_EXIT_AUDIT_FA8DEBB3.md`。P4已归档并自动打开P5；下一检查点是P5-00精确闭合提交与
隔离P5 baseline receipt。真实Provider/FFmpeg/Worker/媒体副作用仍未授权。没有需要用户决定的业务问题。
P5-00已完成：`codex/helix-clean`前移到精确P4 phase closure `5dd0b7094ea35cc04c7ba931fd109467462d0af6`，
并从该点创建隔离`codex/helix-p5` / `E:\my_project\emby_third_party-helix-p5`。fresh checkout的P4 Runtime总门禁
恢复51个架构fixture、7类Effect/31个跨进程crash scenario，P3回归恢复156表/72 index/19 partial unique与18 transaction/
132 crash points，全部PASS且`prohibitedActionsRun=[]`。原dirty workspace及`media-desktop`保持不变。下一检查点是
P5-01已完成并经P5-07传播修正：21个immutable nominal ports完整声明Owner、schema refs、Effect Class、idempotency、Fence和payload
bound；其中11个Integration ports分别覆盖pure observation、workspace write、external request、material commit和destructive commit，完整architecture gate PASS，证据见
`implementation/evidence/P5_01_PUBLIC_NOMINAL_PORTS.md`。下一步P5-02 Secret Reference and least-authority
credential resolver。没有需要用户决定的业务问题。
P5-02已完成：Platform Repository只保存opaque Secret Reference metadata；one-shot lease要求exact
scope/kind/revision/purpose、60秒内TTL与Fence，拒绝过期/重放/同步Promise逃逸，并在同步或受控异步settlement后清零owned bytes。证据见
`implementation/evidence/P5_02_SECRET_REFERENCE_AND_LEASE.md`。下一步P5-03 Mount Scope and Workspace Root
registries。没有需要用户决定的业务问题。
P5-03已完成：Mount Scope current-headed immutable revisions、active fingerprint uniqueness、Workspace Root exact CAS、
full capability probe、Windows/POSIX canonical path、root互斥及Field/Shelf reserved-root反例全部PASS，证据见
`implementation/evidence/P5_03_LOCATION_REGISTRIES.md`。下一步P5-04 Physical Material Identity and
binding-health primitives。没有需要用户决定的业务问题。
P5-04已完成：唯一canonical Physical Material Identity算法与P3 Control交叉验证、full SHA-256/stat-fence复用、
rename/content/inode/mount及Binding Health反例全部PASS，证据见
`implementation/evidence/P5_04_PHYSICAL_IDENTITY_AND_BINDING_HEALTH.md`。下一步P5-05 Artifact Registry and
controlled payload handles。没有需要用户决定的业务问题。
P5-05已完成：Artifact Registry及Reference lifecycle由`execution-foundation`单独拥有，P5-01误放在Platform的
Artifact Query port已按SSOT纠正到`foundation.public`；controlled root containment、typed provenance、完整SHA-256/
size/media reality、owner或exact active-reference purpose、reference CAS及零引用GC authority/intent均fail closed。
9项专项、56-file完整架构、P3 persistence和P4 runtime聚合门禁PASS；Registry不执行物理删除，SSOT未修改。
证据见`implementation/evidence/P5_05_ARTIFACT_REGISTRY.md`。下一步P5-06 typed External Provider protocol adapters。
没有需要用户决定的业务问题。
P5-06已完成：8个使用IntegrationHandle的Capability与三类Effect Class反向闭合；Emby/TMDB/Douban/MoviePilot/
adult provider的每个允许组合使用唯一`protocolAtomId@1`，没有generic URL/request入口。Integration/Secret Fence、
operation-specific timeout/input bound、request/response SHA-256、typed ref/Artifact/External Job Receipt、deep freeze和错误脱敏
均fail closed；18项专项及完整架构/P3/P4聚合门禁PASS。旧Provider模块因混合network/fs/config/业务Owner未导入clean root。
证据见`implementation/evidence/P5_06_TYPED_EXTERNAL_PROVIDER_PROTOCOLS.md`。下一步P5-07 filesystem transaction、probe/hash
and FFmpeg atoms。没有需要用户决定的业务问题。
P5-07已完成：20个关闭的filesystem/hash/FFprobe/FFmpeg operation atoms逐项反向绑定Capability与Effect Class；正式
Inventory提交和破坏性删除使用新增的独立nominal ports，不能伪装为Workspace写。Operation Grant过期/Owner/路径containment、
禁止覆盖、closed profile、Effect intent digest、argv-only命令、bounded result与错误脱敏均fail closed。9项protocol及4项port
专项、58-file完整架构、P3 persistence和P4 runtime聚合门禁PASS；未调用已安装FFmpeg、未读取或修改真实媒体。
旧`transcodeService`因混合自建并发、环境工具选择、fallback、直接替换及旧Task语义未导入clean root。证据见
`implementation/evidence/P5_07_MEDIA_TOOL_PROTOCOLS.md`。下一步P5-08 Resource、device and passive Worker registries/protocol。
没有需要用户决定的业务问题。
P5-08已完成：Platform通过P3 Owner Repository持久化`default|full` Resource Profile、Operating Policy、Compute Device
probe及Worker immutable revisions；显式`unavailable/offline`与未知资源投影为零容量，Permit仍只由P4
`ResourceGovernor`拥有。当前active/healthy Worker revision才可签发≤60秒的`WorkerHandle`。asset register、upload和
analysis request三个closed passive Worker atoms要求exact Secret Lease、request digest和上游Receipt链，返回typed
Worker/External Job Receipt；不接受URL、argv、Store polling或Worker-owned queue。13项Registry/protocol专项、60-file
完整架构、P3 persistence及P4 runtime门禁PASS；未连接真实Worker或执行真实媒体。旧`resourceGovernor.js`和当前
`media-worker` server因自建容量/Job Map、raw FFmpeg args、binary/device选择及旧Task语义未导入clean root。证据见
`implementation/evidence/P5_08_RESOURCE_DEVICE_WORKER.md`。下一步P5-09 Material Access Handle issuer and Fence
enforcement。没有需要用户决定的业务问题。

P5-09已完成：Execution Foundation新增无Store的invocation-scoped Material Access Authority，只组合Owner发布的Binding、
Workspace、Control、Approval/Authorization、Target Slot和Event Fence projection，不接管Canonical Fact。Physical/
Workspace Handle冻结exact revision、permission、containment、Basis及≤60秒内部lifetime；Primary重验Control revision，Related
始终read-only且不生成Control。Operation Grant按Effect Class严格区分observation、Workspace write、Arca material commit和
destructive commit，目标路径只能从当前Workspace/Target Handle派生；P5-07 dispatch前再次重验filesystem Reality与全部
authority slice，Grant单次消费，stale/escape/replay均在effect前失败。P5专项71/71及完整architecture/P3/P4门禁PASS；仅使用
synthetic Owner/Reality adapters，未触碰真实媒体。证据见
`implementation/evidence/P5_09_MATERIAL_ACCESS_FENCE.md`。下一步P5-10 cross-platform isolated integration verification
harness。没有需要用户决定的业务问题。

P5-10已完成：新增`npm run test:helix-platform`跨平台Node-only isolated verification命令，精确运行10组P5 fixture
family并复用P4既有31场景cross-process crash verifier，不建立第二套Runtime。Workspace staged/observed、Material promoted
和External receipt四个命名边界均收敛为一次fake dispatch；缺场景、错误Decision、重复dispatch、非OS临时目录或fixture
allowlist漂移全部fail closed。统一命令、62-file architecture、P3 persistence及P4 runtime门禁PASS；未启动Service、绑定
端口、读取ambient credential、调用真实network/binary/media、Docker或`media-desktop`。证据见
`implementation/evidence/P5_10_ISOLATED_INTEGRATION_HARNESS.md`。下一步P5-11 P5 Phase Exit Audit and evidence freeze。
没有需要用户决定的业务问题。

P5-11已完成：正式clean-tree `npm run test:helix-platform-exit`审计实现`5d3bdde07bd95d5b228f46a3be16c17ea8211209`。
399个baseline后文件全部分类；本线程未修改SSOT，唯一SSOT变化精确绑定Architecture Agent提交`a933463f`，当前SSOT blob、
source-map与P2 aggregate均匹配。10个P5 fixture families、31个P4 recovery scenarios、63个architecture fixture files、
P3 156 tables/72 indexes/19 partial unique及18 transactions/132 fault points全部PASS，findings和prohibited actions均为空。
Evidence digest为`8817403970291024b145248dbf674165964cbf7c9af0d3d32abf6cdb14102d81`，详见
`implementation/evidence/P5_PHASE_EXIT_AUDIT_5D3BDDE0.md`。P5已归档并自动打开P6；下一检查点是P6-00 P5 closure与
隔离P6 baseline receipt。没有需要用户决定的业务问题。

P6-00已完成：从精确P5 phase closure `41470e47ec6bed7ba1cf81024130870eb2e57e92`创建独立
`codex/helix-p6` / `E:\my_project\emby_third_party-helix-p6`。Fresh checkout完整P5 Exit复审再次PASS，closure
evidence digest为`d17ace651cfea4b20a953ac4b0824e110c391d3559abbb97a17ccdb4b5d6c51f`；SSOT blob/source-map与P2
aggregate保持精确匹配，401个变更文件全部分类，findings和prohibited actions为空。原dirty workspace及
`media-desktop`未写入。证据见`implementation/evidence/P6_00_BASELINE_RECEIPT.md`。下一步P6-01 Horizontal-domain
public ports and package guards。没有需要用户决定的业务问题。

P6-01已完成：唯一versioned horizontal public contract catalog精确登记4个Owner-scoped Facade与12个named methods；
Perception只发布Record/Acquisition command和single-kind Resolution，People只发布Person/Candidate/Preference/Reference
command及Person Reference Projection。Exact-shape factory拒绝extra/generic/Media-Cast/Store authority，P1 skeleton改为
逐Domain精确出口allowlist而非放宽。专项8/8、64-file architecture、53 files/65 dependencies、1436 semantic files及
P5 10-family/31-scenario回归全部PASS，P2 aggregate不变，findings和prohibited actions为空。证据见
`implementation/evidence/P6_01_HORIZONTAL_DOMAIN_PUBLIC_PORTS.md`。下一步P6-02 User Perception scoped Store and
atomic Repository。没有需要用户决定的业务问题。

P6-02已按PBF-02/PBF-03重新闭合：`PerceptionRecordRepository`拥有7张Source/Acquisition/Cursor/Page Commit/Record/Anchor/
Relation表，`PerceptionResolutionRepository`拥有2张Revision/Head表。首次sync使用revision `0`逻辑sentinel但不伪造cursor
row；active Acquisition partial unique，terminal后可重开；Source/cursor/Resolution均expected revision CAS。Page receipt、
Record、Anchor、lineage、cursor和typed Result同事务，same marker replay与source identity duplicate计数收敛；stored Result tamper
fail closed。专项`11/11 PASS`，P2/P3/People/Perception组合`59/59 PASS`，证据见
`implementation/evidence/P6_02_PERCEPTION_SCOPED_STORE.md`。

P6-03已完成：Provider pure-observation port只交付bounded references，Observation Reader形成immutable
`PerceptionObservationPage`，matching revisioned normalization rule形成`PerceptionAcquisitionCommitDraft`；P3 Domain Commit
Coordinator在单一UoW提交Perception facts、cursor、typed Result、Foundation Result binding、Commit Marker和Outbox。focused
`3/3`、P3/P6组合`22/22`、Domain input `8/8`与Architecture guards `21/21 PASS`。证据见
`implementation/evidence/P6_03_PERCEPTION_ACQUISITION_PIPELINE.md`。

旧P6-05 10-table实现已由clean rewrite完全取代：`PersonRegistryRepository`精确拥有7张Person/Identity/Preference/Reference
表，`PeopleCandidateRepository`精确拥有Registration/Merge head+revision及Merge Record共5张表。Person是global Registry且
不含`content_scope`；Preference使用显式current pointer；Candidate只保存完整typed payload并逐次形成immutable revision，
Merge Candidate冻结精确Person fact与Preference revision。旧单行state API、digest-only Draft及无head Preference追加均删除，
没有compatibility path。focused `9/9`、P2/P3/table/package组合`68/68`、canonical crash/semantic组合`103/103 PASS`。
当前P2 aggregate为`65f96c638a668817085611035870c461f96a71209198b64eae62886ecc6549ac`。证据见
`implementation/evidence/P6_05_PEOPLE_SCOPED_REPOSITORIES.md`；下一工作包P6-06。

P6-06已完成：pure `PeopleCandidateResolver`只消费typed Evidence与immutable Policy catalog，产生complete Candidate Draft或
bounded `no_candidate`；Candidate Commit通过P3 Coordinator原子写head/open revision、typed Result、marker与Outbox；
Registration Acceptance以Candidate revision/payload CAS原子终结Candidate并创建global Person、Alias、Provider Identity。
同marker重放返回首次typed Result；stale revision、payload/Decision tamper及stable Provider Identity冲突均整事务rollback。
`dismiss-candidate`只追加terminal revision，不创建Person。Resolver `4/4`、lifecycle `6/6`、P2/P3/table/package/all-P6
组合`95/95 PASS`。证据见`implementation/evidence/P6_06_PERSON_REGISTRATION_LIFECYCLE.md`；下一工作包P6-07。

P6-07已完成：Merge Acceptance精确冻结Candidate、source/target Person revision/fact和nullable Preference pointer；同一P3事务内
追加Candidate accepted revision、source terminal revision、target active revision、必要Preference resolution、immutable Merge
Record、typed Result、marker和Outbox。target Person identity/canonical name保留，Alias/Provider Identity按target优先合并，Reference
Asset/Face仍归source历史、不复制。strong identity rule遇到Preference差异或显式改值即拒绝，source terminal target由数据库
`UNIQUE`硬约束。独立Preference Commit已删除合同外字段读取并验证Intent digest。focused `57/57`、targeted `26/26`、完整
Architecture与P3 Persistence门禁PASS；P2 aggregate更新为
`35695f240c93cbad14c2fc81d1df7c789db88966225fe7384dffaf44e9756f81`。证据见
`implementation/evidence/P6_07_PERSON_MERGE_AND_PREFERENCE.md`；下一工作包P6-08。

P6-08已在实现前审计中返回Design：SSOT要求维护并添加/删除Reference Image/Face，且两张People表分别需要稳定业务ID、
Artifact/Embedding handle、model/source/state；但当前`people.reference_fact.commit@1` closed input只含通用
`ArtifactHandle + DomainFactCommitHandle`，无法确定Asset/Face业务ID、Face事实或release语义，public合同也没有Face add/release
named command。实现线程没有用Handle ID冒充业务ID、没有旁读Store或写推测性默认值。待Architecture Agent闭合正式Reference
Maintenance DTO/Capability/Facade合同后继续。证据见
`implementation/evidence/P6_08_REFERENCE_MAINTENANCE_DESIGN_RETURN.md`。本线程未修改SSOT。
上述Perception Resolution与People Registration Design Return已由Architecture Agent提交`85752517`闭合，实现线程仅
cherry-pick该原始SSOT delta，未手工修改SSOT。Perception现有正式链为`CanonicalQueryHandle → Input Assembler →
PerceptionResolutionQuery/RecordSet/RuleSnapshot → pure Resolver → Draft → atomic Commit → Facade`；Resolution持久化完整typed
结果并由四列复合外键约束Head，Record以scalar fields和排序Anchor计算`record_digest`。People的`content_scope`已从合同删除，
Person明确为global Registry，不再等待业务值来源。

P6-04现已完成：旧ID-only DTO与Store旁读捷径均未保留；强Identity tier按固定rank选择，只有同一最强tier一致时返回
`found`，冲突或无匹配返回`not_found`，exact duplicate proof与普通Resolution匹配分离。P2合同门禁PASS，P3 DDL `7/7`、
canonical crash `78/78`、Perception focused/integration `20/20 PASS`。证据见
`implementation/evidence/P6_04_PERCEPTION_RESOLUTION.md`。P6整体Exit Audit尚未执行；下一工作包是P6-05最新12-table
People Store clean rewrite。

P6-08至P6-11已完成：Direct Person Registration和Reference Image单Face add/release原子闭合；5个Perception与8个People
Capability按P2 digest注册；cross-domain consumer只能保存Owner/revision/digest Basis；统一isolated harness覆盖75个架构fixture、
24项canonical transaction与25个crash fixture。最终合同为112 Capability、96 Result Family、161表、24 transaction，197个type ref
全部解析。

P6-12正式clean-tree Exit Audit对`0cc4d8bf86fcfcf0a329f15a3b4d34a23a399d09`返回`ok=true`、`findings=[]`、
`prohibitedActionsRun=[]`。515个baseline后文件全部分类；SSOT精确等于Architecture Agent `f2846fd1`原始blob，P2 aggregate为
`d94a53f8b7741aefa8bd0d245db4aafcc70100e2ac3d42d1ee7eb2685261cc70`，Exit Evidence digest为
`19377c01d465f5894ef6c3adf3b33c6c24b62bcda1a4605c202981be0ae4e114`。P6已归档，P7 Procurement详细包已打开；
外部环境与`media-desktop`授权边界不变。

P7-00至P7-01已完成：从P6 closure `5831c532`建立独立P7 worktree并fresh复跑P6 Exit PASS；Procurement唯一public
package现精确暴露Command/Query/Candidate Delivery三个port与11个named methods。Store、Subject、Shelf、generic Task和Related
Control authority反例全部拒绝。完整Architecture 76 fixtures、69 files/82 dependencies、1476 semantic files PASS；历史P6 Auditor
已固定审计P6 closure，避免后续Phase合法Evidence被误判为P6越界。下一工作包P7-02。

P7-02已完成：`MaterialFieldRepository`只绑定三张Procurement表；Material Field注册在同一UoW内闭合Policy、Field、Access
双向引用，Policy/Access使用immutable revision、canonical digest和exact CAS。重复Field、digest篡改、16 KiB上限、stale/skipped
revision及disabled后写入全部fail closed。Focused 9/9与完整P3 Persistence（77 fixtures、161表、24 transactions）PASS；
`prohibitedActionsRun=[]`。下一工作包P7-03。

P7-03在实现前返回Design：`FieldObservationPage.materialObservations[]`只有opaque Object Revision Ref，无法形成
`proc_field_materials`要求的Physical Identity、hash/stat/location/binding列；closed Capability input没有正式Snapshot resolver。
同时`ObservationCommitResult`要求aggregate revision/expected revision，但Material Field/Observation persistence没有对应head/CAS，
且一个Access revision允许多页，不能借用Access revision。实现线程未写默认值、未旁读旧Store、未修改SSOT。完整缺口见
`implementation/evidence/P7_03_FIELD_OBSERVATION_DESIGN_RETURN.md`。
