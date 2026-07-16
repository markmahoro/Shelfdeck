# ShelfDeck Clean Helix Current Status

Status: Levels 0–10 accepted; P0–P3 complete; P4 in progress under standing P2–P13 Local Implementation authorization; E2E, Docker/Canary, production, real-media side effects and `media-desktop` changes paused.

Last updated: 2026-07-16

## 1. Current position

| Field | Current state |
| --- | --- |
| Architecture | `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` Level 0–10 accepted and final audit closed |
| Open business decisions | none |
| Implementation program | clean-cut Master Plan accepted as direction |
| Completed phases | P0 — implementation gap audit；P1 — Clean Skeleton and Architecture Guards；P2 — Contract and Schema Baseline；P3 — Persistence and Atomic Foundation |
| Current phase | P4 — Execution and Recovery Foundation |
| Current phase status | in progress；P4-00–P4-01 complete；P4-02 next；P3 Exit Audit PASS |
| Implementation Gate | standing Local Implementation open for P2–P13；external actions excluded |
| Current allowed work | local code、unit/contract/isolated fixture、docs、automatic Phase transition after PASS |
| Integration baseline | exact P3 phase closure `4a59356f3a89f1af38f594763aaaa0465e203b99` |
| Phase worktree | `E:\my_project\emby_third_party-helix-p4` on `codex/helix-p4` |
| Next action | P4-02 Exact Capability Registry and typed dispatcher gate |

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
- `implementation/CURRENT_PHASE.md`：唯一活动P4详细执行包；
- `implementation/evidence/`：冻结审计与验收Evidence；
- `implementation/archive/`：保存已冻结的P1执行包。

工程文档不能覆盖架构SSOT。任意时刻禁止出现第二份活动Phase详细计划。

## 6. Safety and worktree state

- NAS ShelfDeck Docker `192.168.12.230:18080`保持生产边界，当前不接触；
- 四库真实来源E2E保持停止；
- P4本地实现已打开；不运行E2E、Admin Web构建或Docker构建；
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
aggregate不变。下一检查点是P4-02 exact Capability Registry and typed dispatcher gate。没有需要用户决定的业务问题。
