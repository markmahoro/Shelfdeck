# ShelfDeck Clean Helix Current Status

Status: Levels 0–10 accepted; P0–P4 complete; P5 in progress under standing P2–P13 Local Implementation authorization; E2E, Docker/Canary, production, real-media side effects and `media-desktop` changes paused.

Last updated: 2026-07-17

## 1. Current position

| Field | Current state |
| --- | --- |
| Architecture | `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` Level 0–10 accepted and final audit closed |
| Open business decisions | none |
| Implementation program | clean-cut Master Plan accepted as direction |
| Completed phases | P0 — implementation gap audit；P1 — Clean Skeleton and Architecture Guards；P2 — Contract and Schema Baseline；P3 — Persistence and Atomic Foundation；P4 — Execution and Recovery Foundation |
| Current phase | P5 — Platform and Integrations |
| Current phase status | in progress；P5-00–P5-08 complete；P5-09 next；P4 Exit Audit PASS |
| Implementation Gate | standing Local Implementation open for P2–P13；external actions excluded |
| Current allowed work | local code、unit/contract/isolated fixture、docs、automatic Phase transition after PASS |
| Integration baseline | exact P4 phase closure `5dd0b7094ea35cc04c7ba931fd109467462d0af6` |
| Phase worktree | `E:\my_project\emby_third_party-helix-p5` on `codex/helix-p5` |
| Next action | P5-09 Material Access Handle issuer and Fence enforcement |

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
