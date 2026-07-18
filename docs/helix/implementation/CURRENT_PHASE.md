# P7 Procurement Detailed Plan

Status: P7-00–P7-04 complete；P7-05 in progress.

Last updated: 2026-07-18

## 1. Objective

在`media-service/src/helix/domains/procurement/`实现clean Procurement：管理`0..N`片Material Field及其访问、观察、资格、
Procurement Run、Triage和不可变Candidate Package。只使用P2合同与P3–P5 Foundation；不接旧Nexora/Library/Task Runtime，
不接真实Field、真实媒体、API/UI或Handoff A acceptance。

## 2. SSOT traceability

| Contract area | SSOT source | P7 realization |
| --- | --- | --- |
| Domain charter and Owner | §2.2–2.3、§3.3 | Procurement package、Store和public Facade |
| Material identity/control separation | §3.2.4、§3.3.2、§4.3 | Observation membership与P3 Control分离 |
| Run/Triage/Candidate | §3.3.3–3.3.4、§5.3 | immutable Run selection、Evidence和Package |
| Logical/physical components | §8.2.2、§8.3–8.4 | public/internal package guards；单SQLite scoped repositories |
| Persistence | §8.5 | 13张`proc_*`表及Foundation原子参与者 |
| Capabilities | §8.6.3 | 8个`procurement.*@1` closed packages |
| Product/admin boundary | §9 | 仅Facade合同；P12才实现HTTP/UI |

固定物理合同：13张Procurement表、8个Capability；当前全局合同基线为112 Capability、96 Result、161表、26 canonical transaction。

## 3. Hard boundaries

- Material Field是Procurement长期Business Object，不是Shelf、Emby Library、目录别名或Control集合。
- Field Observation membership、Domain-local Binding与Material Control三者分离；重叠Field观察不复制Physical Material。
- Field Management负责发现、Identity、Observation和Eligibility；Triage只处理已选择且已取得Control的Primary Material。
- Related Material不进入Field membership、不独立取得Control，只作为不可变Reference随Candidate交付。
- Candidate Package恰好一份`1..N`成员Primary Input Manifest；发布后不原地修改。
- Candidate、Subject、Shelf Entry不是同一对象；P7不创建Subject、不决定Shelf、不执行Handoff A acceptance。
- 无compatibility、dual-read/write/run、旧Runtime fallback或旧Store旁读。

## 4. Allowed verification

仅允许Node unit/contract/isolated fixture、owned temporary SQLite、synthetic path/bytes、fake clock和fake P5 ports。禁止Service启动、
socket、ambient credential、真实Material Field扫描、真实媒体/FFmpeg副作用、E2E、Docker、Canary、production及`media-desktop`。

## 5. Work packages

### P7-00 Exact phase transition and baseline receipt

- 从P6正式closure commit创建`codex/helix-p7`与独立worktree。
- fresh clean checkout复跑P6 Exit Audit，冻结baseline、SSOT/P2 aggregate和禁止动作。
- Done：`codex/helix-p7`独立worktree从`5831c532`创建；fresh P6 Exit Audit PASS，Evidence见
  `evidence/P7_00_BASELINE_RECEIPT.md`。

### P7-01 Procurement public ports and package guards

- 建立唯一`ProcurementCommandFacade`、`ProcurementQueryFacade` public contracts及exact named methods。
- public入口不得暴露Store、generic planner、raw filesystem、Libra/Arca internals或HTTP。
- Done：三个public port与11个exact methods已冻结；Store/Subject/Shelf/Task/Related Control反例及完整Architecture
  gate PASS。Evidence见`evidence/P7_01_PROCUREMENT_PUBLIC_PORTS.md`。

### P7-02 Material Field, Access Binding and Extraction Policy

- 实现Material Field lifecycle、current-headed immutable Binding/Policy revisions与expected revision CAS。
- `0..N` Field独立；注销停止新观察/开采但保留历史Fact，不删除材料。
- Done：三表scoped Repository、注册原子闭合、Policy/Access exact CAS、digest/16 KiB/disable反例及完整P3 Persistence
  gate PASS。Evidence见`evidence/P7_02_MATERIAL_FIELD_STORE.md`。

### P7-03 Field Observation Inventory

- 实现Field page observation与atomic observation commit；保存Physical Identity、location、provenance、reality revision。
- 同一Identity允许被多Field观察；cursor/page replay幂等，移动/消失/不可访问形成新事实而非改写历史。
- Done：PBF-07-R1把Page/Result各自固定为64 KiB，完整Page由Foundation Result Binding保存为immutable typed Evidence，
  Observation→Marker→Binding链可恢复历史；canonical Transaction Registry按精确合同决定Outbox cardinality，本事务固定零Outbox。
- pure Observer同时按100项和canonical bytes分页且不跳过首个未返回成员；Commit以Field head/access/work/page/cursor执行CAS，
  原子追加Observation、更新Material current row、保存typed Result/Evidence和Marker。int64无损、replay、rebound、reality reset、
  stale Access/revision、continuity、zero-Outbox及rollback反例PASS。Evidence见
  `evidence/P7_03_FIELD_OBSERVATION_DESIGN_RETURN.md`第10节。

### P7-04 Extraction Eligibility and derived Regions

- 由有效Observation、Extraction Policy和当前Control projection计算Eligibility。
- Procurement/Production/Finished Goods Region只读动态派生，无Region Store/ID/路径锁。
- Done：PBF-08机器合同已精确传播；closed `ExtractionPolicy@1`、唯一reason precedence、typed Selection/Control snapshots和
  pure evaluator完成。Reconcile在一个scoped UoW中先批量重读Foundation Control，再以Procurement Repository重读全部current
  basis，按revision/digest拒绝stale item并CAS更新current Eligibility/Region。相同Batch重放no-op；零Event Result、marker、
  Outbox；完整Architecture `533/533`和P3 Persistence gate PASS。Evidence见
  `evidence/P7_04_ELIGIBILITY_RECONCILE.md`。

### P7-05 Procurement Run selection and Control acquisition

- Run冻结Field scope、Triage revision和Selected Field Material Set。
- Primary成员逐Identity通过P3 responsibility/control CAS取得Procurement Control；冲突整事务失败。
- 实现正式Procurement retry-intent canonical transaction，不让retry事实改变业务Owner。

### P7-06 Triage evidence pipeline

- 注册并实现playability、structure、identity claim、primary manifest四个pure Capability。
- Evidence完整保留model/rule/revision/provenance；不把标题、路径或模糊相似度提升为Canonical Identity。
- Series Season Continuity只允许exact provider-season或持久triage grouping lineage。

### P7-07 Immutable Candidate Package publication

- Candidate Draft完整包含Identity Claim、最小Identity Metadata、结构、Primary Input Manifest、Related Reference、Field Context和Evidence。
- 原子发布Package、Primary、Related、Season Claim、Delivery、typed Result、Commit Marker、Audit与Outbox。
- 强制同一Physical Identity同时最多属于一份仍可被Libra接受的Candidate；变更必须发布新Package。

### P7-08 Capability registration and Foundation integration

- 精确注册8个`procurement.*@1` package digest、Owner、Effect Class和typed ports。
- observation/control/domain commit分别进入P4/P3正确路径；不为同步事务伪造Workflow。

### P7-09 Downstream boundary verification

- synthetic Libra consumer只读取不可变Candidate/Delivery public contract，不读Procurement Store。
- Acceptance/Subject/Routing/Material Control transfer留给P8；signal丢失、重复、乱序不改变Candidate事实。

### P7-10 Isolated Procurement harness

- 单一Node命令覆盖13表、8 Capability、Facade、replay/CAS/crash与边界反例。
- 同时回归P2 contract、P3 persistence、P4 runtime、P5 platform和P6 horizontal gates。

### P7-11 P7 Phase Exit Audit and evidence freeze

- 反向审计全部P7 SSOT traceability、Owner、Store prefix、Control、Candidate唯一性和cross-domain dependency。
- 证明无Subject/Shelf/Deck/Media-Cast/API/UI/startup/legacy/dual/fallback或真实外部效果进入P7。
- PASS后归档本包并自动进入P8。

## 6. Execution order

~~~text
P7-00 → P7-01 → P7-02 → P7-03 → P7-04
                              ↓
P7-11 ← P7-10 ← P7-09 ← P7-08 ← P7-07 ← P7-06 ← P7-05
~~~

## 7. Exit criteria

1. 13张Procurement表、8个Capability及public Facade全部可追溯到SSOT和P2 digest；
2. `0..N` Field、重叠Observation、Binding/Policy CAS、Eligibility和Region派生有机器反例；
3. Selected Primary全部有exact Procurement Control，Related永不独立Control；
4. Candidate immutable、单Manifest、`1..N` Primary和active Candidate identity唯一性有DB/transaction反例；
5. P2–P6回归与P7 isolated harness全部PASS；
6. `findings=[]`、`prohibitedActionsRun=[]`、clean worktree且SSOT未由实现线程修改；
7. 独立P7 Exit Audit PASS后才允许进入P8。

## 8. Stop conditions

- SSOT输入不足以唯一实现Field/Eligibility/Control/Candidate的输入、输出、状态或持久化连续性；
- 实现必须让Procurement创建Subject、决定Shelf、拥有Related Control或直接写其他Domain Store；
- 需要修改SSOT、引入兼容层/dual path/旧fallback；
- 需要真实Field、Provider、媒体副作用、E2E、Docker、production或`media-desktop`授权。

只有真实业务决策或SSOT冲突上报用户；普通工程选择由Codex在本Phase内自主收敛。
