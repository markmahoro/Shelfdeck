# ShelfDeck Clean Helix Master Plan

Status: BDMV Triage性能重构与Scope Reference落地已完成；Execution Foundation与Procurement本地全链验证通过，已封口供后续Domain接入。

Last updated: 2026-08-10

## 0.1 Current amendment — Observation facts and incremental Eligibility

本轮废止“仅改Observation存储”的上一版计划，先修改唯一Architecture SSOT，再实现并验证两个相互关联的收敛点：

- Observation明细永久写入Procurement-owned `proc_field_observation_entries`；Page JSON只保存游标、数量、边界digest、page/fact digest和commit marker。一个Page Event最多提交256个文件、物理读取最多64 MiB，每个Physical Material指纹读取最多262,144 bytes。独立Layout Capability/Event/Result废止，Layout只作为冻结Observation entries上的技术Projection。
- Eligibility仍是`proc_field_materials`上的当前Decision Projection。全局Observation head推进不再使全部Material失效；Reconcile只接收新、Reality/Binding/位置变化、missing、unknown/basis失效，以及Field/Access/Policy/Selection/Reservation/Control影响的有界Material Key Change Set。未变化Material不执行Eligibility SQL UPDATE、不递增revision。

本轮不新增Eligibility历史表、Capability、Result family、Admin route或业务对象；当前clean合同为111 Capability、97 Result family、180 table、43 Canonical Transaction。验证顺序固定为：合同/Schema → Observation幂等与批次边界 → 18,000项Eligibility写放大fixture → Procurement回归 → 本地只读`Z:\\Film`全量Canary。上述门禁已全部完成；本轮不进入Docker、NAS、Libra或Arca。

### 0.1 Current amendment — BDMV Assessment and Scope Reference

BDMV不再为每个物理成员建立通用Media Probe Event。每个BDMV容器只签发一个`procurement.triage.bdmv.assess@1`，在一次受控调用中完成有限Playlist/Clip拓扑解析、确定性主标题选择和选定主标题M2TS的bounded metadata probe；不读取完整M2TS、不计算全文件Hash、不嵌套调用Event Runtime。普通媒体仍使用`shared.material.media.probe@1`。

Structure只消费durable `BdmvAssessmentEvidence@1`并输出紧凑`UnitScopeReference`；Candidate Context按冻结Run、Observation和Assessment facts重建主载荷与对应结构依赖。BDMV容器的全部物理成员仍作为不可拆分Scope参与Run Admission（最多1024），但不塞入Plan或Structure Result；未选中的M2TS/CLIPINF不进入Candidate或Related。

### 0.2 Final evidence — 2026-08-10 local full Canary

本轮使用本机Node.js、系统Temp下的clean数据库和只读`Z:\\Film`完成最终Canary：

- sourceBefore/sourceAfter均为18,407个regular files，digest均为`a630ecf5b86c0da2541b5e53fae2bc6e5aa8d28fd181b7d6ce6c770042eb316d`；数据库`integrity_check=ok`。
- Observation为72页、18,407条entry；每文件只读取一次中段指纹，逻辑读取`1,776,608,472` bytes，未超过`18,407 × 262,144`上限；主动重启后未重读已提交页。
- 增量Eligibility首轮实际`eligibilityDecisionWrites=18,407`、`reconcileBatchCount=185`；Observation完成后的后续Triage没有增加Eligibility写入；完全相同Observation的0写入由专项fixture覆盖。
- 创建12个并存Run并全部Seal；950个Work、1,148个Plan、4,029个Event/Attempt/Result全部成功；937个Candidate Package与937个open Handoff A Offer，Related Reference共4,397份。
- BDMV容器共59个，其中56个Assessment为`resolved`、3个以`bdmv_topology_unavailable`带Evidence收口；产生56个BDMV Structure Unit、53个BDMV Candidate，普通Candidate为884个。通用Media Probe共929个，BDMV内部成员通用Probe为0；没有STREAM标题Candidate。
- `failedWorks=0`、`failedEvents=0`、`resourceDefers=0`、RSS峰值约1.35 GiB；数据库`integrity_check=ok`。Related数据库审计未发现BDMV内部路径或视频载荷（包括`.m2ts`）被误记为Related；Offer未消费，Libra/Arca事实为0，源文件无写入/移动/删除/重命名。
- 总耗时约8分04秒；Observation terminal后首个Structure约119秒、首个Candidate/Offer约140秒、全部Run Seal约7分56秒。临时资产保留于`C:\\Users\\markm\\AppData\\Local\\Temp\\helix-full-movie-canary-zpq4zN`；此前Canary资产未删除。

本证据将Execution Foundation与Procurement本地验证状态更新为`CLOSED FOR DOMAIN ONBOARDING`。后续Libra/Arca接入若要求改变Foundation状态机、Permit、Result Binding、Reconcile或backpressure语义，必须返回Design。

## 0. Active implementation checkpoints

本轮在已经恢复的`Run → Work → Event`产品路径上正式封闭Execution Foundation的设计与实现接口；不回退Mirex，不重建骨架，
不进入Libra或Arca：

1. **SSOT封闭**：明确Event有界并发、`maxInFlightEvents=16`、typed Resource Key、精确Process reconcile、30秒fallback sweep、
   Domain Execution Projection及soft/hard cap语义；新增`fx_reconcile_cursors`，当前Observation事实表改造后的clean table总数为180。
2. **产品接线修复**：Runtime Host有界启动多个Event；Resource Governor逐Event原子发放Permit bundle；Scheduler、Work Supply与
   waiter遵守同一Domain Execution Projection；删除每Event全Run扫描及整Field Triage读取。
3. **Foundation封口验证**：以产品Composition Root覆盖并发、Permit、immutable Plan、Result Binding、terminal aggregation、
   205个Process三页cursor恢复、lost wake、retry/defer/timeout及七类Effect crash window。
4. **Procurement压力回归**：以260个Candidate需求证明hard cap有界、completion持续产出、Package/Offer早于全部Run Seal，且
   Coordinator不执行Capability、不做整Field读取。
5. **最终全库Canary与封口**：本地Node.js在新的系统Temp clean数据库上运行`Z:\Film`只读Canary；主动重启后从同一
   durable数据库恢复，未重扫Observation。最终12/12 Run Seal、937 Candidate Package/937 open Handoff A Offer、
   `failedWorks=0`、`failedEvents=0`、源Reality前后一致、Libra/Arca为0，已改为`CLOSED FOR DOMAIN ONBOARDING`。

Checkpoint 1–5的实现与本地fixture已经完成；Layout Snapshot及Triage Unit/Candidate Context改造的Node回归和Procurement压力fixture已通过；全量真实Canary已完成。运行边界固定为本机Node.js、临时clean数据库和
只读媒体源；不使用Docker、不部署NAS、不消费Handoff A Offer、不进入Libra或Arca。

Physical Material Identity不承担NAS字节完整性证明。所有Physical Material统一使用`middle-256k-sha256`：读取正中间最多
262,144 bytes并执行前后stat fence；禁止首次登记、Control、Binding或Effect Fence触发全文件Hash。Artifact、Canonical JSON和
事务Evidence的SHA-256保持不变。当前本地数据库不迁移Identity v1，也不保留alias、fallback或dual contract。

2026-08-09 Layout性能修订：唯一SSOT已补充Field Observation Layout Snapshot合同。Observation terminal后生成可复用的
profile-neutral目录索引；Evidence Assessment按唯一直接父目录规划Layout Event，Triage Layout只读取Snapshot，不再
执行NAS `readdir`或相关文件指纹读取。Media Probe仍保持为独立Event并只对Run Selection访问源文件。

2026-08-10 BDMV拓扑边界已确认并完成实现：BDMV不是pre-triage的`movie`类别，
而是Run Creator使用的不可拆分container group。最近`BDMV`祖先目录下的全部terminal Observation成员必须进入同一Run，
完整group可以与其他group按稳定顺序装入同一Run，单个group超过256项时整体不建Run。Structure只消费完整group，
解析Playlist、Clip与结构依赖并形成单标题Triage Unit；BDMV内部成员不得各自形成Candidate，多标题/歧义/不完整保持
`not_ready`。Run Admission不得等待Structure发现依赖后再静默扩张；所需结构成员必须在Admission前完成Observation、
Eligibility和Control。当前实现新增正式`procurement.triage.bdmv.assess@1`、`BdmvAssessmentEvidence@1`及
`BdmvAssessmentInput@1`，Scope Reference为运行时可重建引用，不新增表或业务Domain。

当前产品压力证据为260个Movie Primary、2个并存Run：260份Candidate Assembly Work最终形成260个Package和260个open
Handoff A Offer，全部Run Seal，零failed Work/Event；开放Work从未突破256。全链由产品Composition Root中的Scheduler、
Event Runtime及typed Resource Governor推进；没有Coordinator直接执行Capability的路径。

此前同步Coordinator路径完成的单Movie Canary保留为低层Capability和Owner事实的诊断证据，但它绕过了产品形态的Work Scheduler、
Event Runtime与Resource Governor，因此自本计划起不再作为有效Foundation E2E或Handoff A Ready E2E验收证据。

## 1. Role and authority

本文是唯一Helix Master Plan，只维护：

- clean-cut总决策；
- P0–P13 Phase顺序、依赖和Exit Gate；
- 当前Phase指针；
- 授权边界和下一动作。

架构只由`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`定义；工程过程只由`ENGINEERING_PLAYBOOK.md`定义；当前Phase的
Work Package细节只存在于`implementation/CURRENT_PHASE.md`；当前事实只由`CURRENT_STATUS.md`报告。

本文不复制Phase执行细节，也不保存已完成审计全文。

## 2. Accepted implementation decision

采用：

> 新`media-service/src/helix/`完整重建clean业务核心和产品表面；旧实现逐函数取证复用；完整验证后一次性切换
> Composition Root；不在旧Libra/Nexora/Kairox/Task主路径上增量改造。

固定边界：

- 五个一级Business Domain为Procurement、Libra、Arca、User Perception、People Management；
- Collection Formation只有Procurement→Libra和Libra→Arca两次单向Handoff；
- 一个`data/shelfdeck.db`不等于共享Store；Repository和Fact Owner保持隔离；
- clean schema不迁移旧Runtime事实，不dual-read/write/run，不保留旧fallback；
- 62个旧业务executor中0个可整体复制；复用只限登记后的pure/protocol/FFmpeg/file-transaction原子；
- 完整clean root切换前只允许isolated fixture，不形成混合可运行产品；
- `media-desktop`不属于本轮范围。

实现差距基线和处置Evidence见
`implementation/evidence/IMPLEMENTATION_GAP_AUDIT_4a16f0a9.md`。

`PBF-10-R1`只闭合Candidate Publication的机器事务表集：7张Procurement domain表（含
`proc_candidate_primary_material_episode_claims`）与3张Foundation表构成精确10张`writeTables`；不改变Domain、Owner、
Store、Handoff或Capability；PBF-11后当前关系表总数为168张。

`PBF-10-R2`进一步固定Package-derived `CandidateIntakeAcceptanceBasis@1`、stable Offer ID、typed Offer Outbox
message/consumer/dedup合同，并把Season Continuity Claim全链路统一为
`provider_season_identity|triage_grouping_lineage`；同样不扩大任何Owner或物理边界。

`PBF-10-R3`把承载Run `candidate_package_revision_head` CAS的既有`proc_procurement_runs`补入Candidate
Publication domain write participant；最终机器事务固定为8张Procurement、3张Foundation及11张write table，
同时保留Run表为CAS fence read，不改变Owner、Store、Handoff或Capability。

`PBF-11`闭合Candidate Delivery typed snapshot、Libra-owned continuity resolution、N:M Episode/Binding关系、
global/target CAS、Resolved Identity exact Claim关系化、nullable identity初值及Handoff A完整Accepted事务。
它新增五张Libra Intake关系/头表，使总数调整为168；不新增Domain、Owner、Store、Handoff或Capability。

`PBF-11-R1`扩充既有`proc_candidate_related_references`，逐列保存完整Physical Identity、association Evidence和
reference digest，使Candidate/Run/Offer关闭后仍能由Procurement Owner rows历史重建完整Package与Delivery Snapshot；
不新增表、Owner、Store、Handoff或Capability，168-table inventory保持不变。

`PBF-11-R2`与`PBF-11-R2-R1`把Handoff A Rejected闭合为独立typed Decision、Reason/Evidence、Receipt、Outbox及
Procurement consume，并恢复Accepted Receipt的唯一scope digest；同时分离Handoff A富拒绝与Handoff B通用拒绝，
完整闭合Arca rejected持久化连续性。关系表调整为169，Catalog Result family调整为97。

`PBF-11-R2-R2`明确区分append-only row与CAS lifecycle row：`proc_candidate_deliveries`仅允许一次
`open → accepted|rejected`，`proc_run_materials`只允许合同列出的Reservation转换；Accepted/Rejected consume均从
terminal Owner rows重建并使用同一原子性、Evidence与幂等纪律。不新增Domain、Owner、Store、Handoff、Capability或表。

`PBF-11-R3`固定Handoff A Accepted Control revision set的成员、排序、JCS公式、Payload/Commit Handle绑定及
historical Control reconstruction；保持112项Capability、97个Catalog Result family、169张关系表和15表事务边界不变。

`PBF-12`闭合Libra Routing、Decision Basis与Acceptance Spec的typed input/output、唯一ID/digest、revision/head CAS、
Subject Field/profile provenance、Product Scope、Arca只读Projection freshness及三项canonical transaction。它不新增
Domain、Owner、Store、Handoff、Capability或关系表；保持112项Capability、97个Catalog Result family和169张表，
Canonical Transaction由35项增至38项。

`PBF-12-R1`把pre-CAS `SubjectDecisionHeadSnapshot@1`补入既有Decision Basis input relation，并在Basis row/result
冻结expected revision与snapshot digest；历史Input Set可只由Libra Owner rows重建。它不改变Domain、Owner、Store、
Handoff、Capability、Result family、表或Canonical Transaction计数。

`PBF-13`闭合Libra生产后半链的Run Admission/Lifecycle、immutable Production Material与N:M Episode scope、
Workspace admission/reference、完整On-deck Product Package、Discard/Cleanup及Off-load Completion Reclaimer连续性。
新增七张Libra-owned关系表和五项Canonical Transaction；当前合同为112 Capability、97 Catalog Result family、
176 tables、43 Canonical Transactions，未新增Domain、Owner、Store、Handoff、Capability或用户业务决策。

## 3. Current phase

| Field | Current value |
| --- | --- |
| Phase | P13 — Operational cutover and E2E-ready package |
| Detailed packet | `implementation/CURRENT_PHASE.md` |
| Status | P13 complete；final Implementation Contract Baseline and E2E-ready package frozen |
| Implementation baseline | P13 implementation closure `bd75e7e4`；product surface `23e3b930` |
| Phase branch/worktree | `codex/helix-p9` / `E:\my_project\emby_third_party-helix-p9` |
| Allowed now | 本实施线程停止；不得进入P14、E2E或部署 |
| Next action | 独立P14资格验收任务消费冻结package；需用户单独授权 |

## 4. Master roadmap

| Phase | Outcome | Dependencies | Exit Gate summary |
| --- | --- | --- | --- |
| P0 Audit and disposition | `4a16f0a9`差距、旧模块处置、风险和clean-cut方向 | Level 0–10 accepted | **complete**；Evidence已冻结 |
| P1 Clean skeleton and guards | 固定`src/helix/`、public/internal边界、唯一Root shell、机器架构门禁和manifest框架 | P0；Local Implementation Gate | **complete**；Exit Audit PASS；Evidence frozen |
| P2 Contract and schema baseline | 112 Capability、96 Result、161 table合同与digest | P1 | **complete**；latest SSOT rematerialized 112/96/161/26；baseline gate PASS |
| P3 Persistence and atomic foundation | 唯一Kernel、scoped UoW、Control、Commit Marker、Outbox/Inbox、Audit | P2 | **complete**；26 canonical transactions；baseline gate PASS |
| P4 Execution and recovery foundation | Work/Plan/Event/Effect、Progress、Control Plane、Resource、Retry/Timeout/Circuit、startup recovery | P3 | **complete**；7 Effect Classes / 31 crash scenarios；Exit Audit PASS |
| P5 Platform and integrations | Secret/Mount/Workspace/Artifact/Resource/Worker及typed Provider/FFmpeg/file libraries | P3–P4 ports | **complete**；10 fixture families / 31 recovery scenarios；Exit Audit PASS |
| P6 Horizontal domains | Perception和People独立Store/Facade/Process/Projection | P3–P5 | **complete**；Exit Audit PASS；两域Owner与cross-domain边界闭合 |
| P7 Procurement | Material Field、Observation、Region、Triage、Candidate Package | P3–P5 | **complete**；Exit Audit PASS；15表/8 Capability与Candidate原子性闭合 |
| P8 Handoff A and Libra front half | Handoff A、FA-04 continuity、Subject、Decision、Routing、Acceptance Spec | P6–P7 | **complete**；原子连续性和Exit Audit PASS |
| P9 Libra production and delivery | Run、Workspace、Product、Conformance、On-deck Package、Discard/Cleanup/Reclaimer | P4–P5、P8 | **complete**；baseline frozen |
| P10 Handoff B and On-deck | Shelf/Standard/Placement、Acceptance、Custody、Off-load、Inventory、Shelf Entry、Deck | P5、P9 | **complete**；Exit Audit PASS |
| P11 Arca post-deck | Aftercare、Off-deck、Shelf Deregistration | P10 | **complete**；baseline frozen |
| P12 Product surface | Projection/Activity、Facade、113 Admin route、Session/Auth、九页Admin Web | P6–P11 | **complete**；114 route、18 surface、build/tests PASS |
| P13 Operational cutover and E2E-ready package | clean init/backup/restore/Safety、readiness；Root/API/UI一次切换；旧路径退役；冻结独立E2E任务可直接消费的版本化交付包 | P2–P12 | **complete**；local gates PASS；package frozen |

P1–P13是本线程的完整逻辑实施Phase，不是版本名或自动部署节点。P13 Exit Audit PASS且E2E-ready package冻结后，
本线程的Helix开发任务即完成。

## 5. Hard dependency invariants

~~~text
P1 package/guards
  → P2 contracts/schema
  → P3 atomic persistence
  → P4 execution/recovery
  → P5 platform/integration substrate
  → P6/P7 horizontal domains and Procurement
  → P8/P9 Handoff A and Libra
  → P10/P11 Handoff B, Arca and post-deck
  → P12 Projection/API/Admin Web
  → P13 operational cutover and E2E-ready package
~~~

禁止以以下方式缩短依赖链：

- 新Procurement接旧Membership；
- 新Libra写旧`media_items`或Kairox Store；
- 新Event Runtime驱动旧executor；
- 新Admin Web调用旧Task/Library route；
- clean database回退旧Service；
- 先做Material副作用、后补Control/Effect recovery。

## 6. Phase planning and transition

- 任意时刻只有`implementation/CURRENT_PHASE.md`一份活动详细执行包；
- 只细化当前Phase，后续Phase维持Outcome/Dependency/Exit Gate级别；
- 当前Phase全部Work Package满足Done并通过独立Exit Audit后，执行包移动到`implementation/archive/`；
- Evidence冻结并由`CURRENT_STATUS.md`链接后，才细化下一Phase；
- Phase完成不自动打开下一类环境授权；
- blocking架构缺口返回Design，不以兼容层、temporary Store或silent fallback解决。

详细Ready/Done、Review、Reuse、Git/worktree和停线规则见`ENGINEERING_PLAYBOOK.md`。

## 7. Authorization boundaries

用户已授予P2–P13第1层`Local implementation` standing authorization。每个Phase在SSOT traceability、机器反例和
Exit Audit全部PASS后可以自动归档并进入下一Phase，不需要逐Phase等待：

1. Local implementation：本地代码、单元/合同/隔离fixture；
2. Real-source E2E：明确来源和副作用范围；
3. Build/Canary：明确Artifact和环境；
4. Production：明确发布/部署/升级动作。

Standing authorization不授权下一层。E2E、Docker/Canary、NAS、生产和真实媒体副作用保持暂停，
`media-desktop`保持排除。

## 8. Post-program independent tasks

P13之后的外部验证与发布工作不属于本Helix实施Program，也不作为本线程完成条件：

1. **Independent E2E qualification task**：从P13冻结的E2E-ready package开始，按单独授权执行真实来源、真实媒体副作用、
   Windows/Linux/Docker及必要的Canary验证；发现实现缺陷时形成可复现Problem Report并返回对应开发范围修复，发现SSOT冲突时
   返回Architecture Agent；不得在验收任务加入兼容层或旧Runtime fallback。
2. **Independent deployment task**：只消费已经通过独立E2E验收的精确Artifact，按单独生产授权完成镜像身份、SHA256、dry run、
   NAS部署、health/readiness与发布观察；不得把部署修补反向变成业务架构或运行时兼容路径。

两项任务必须使用P13冻结的commit、package manifest和digest建立可追溯交接。E2E验收任务与部署任务彼此独立；部署任务不得在
缺少对应E2E PASS Evidence时开始。

## 9. Business decision handling

只有改变用户真实意图、可见业务结果、不可逆Authorization、Business Domain/Owner/Handoff或Object continuity的
问题才提交用户。包结构、代码组织、测试工具、manifest格式、SQL实现和性能优化由工程内部在SSOT边界内决定。

当前没有open business decision。工程问题由Codex自主处理；只有真实业务决策或SSOT冲突才向用户提问。
