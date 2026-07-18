# P8 Handoff A and Libra Front Half Detailed Plan

Status: Active；P8-00–P8-03 complete；P8-04 in progress.

Last updated: 2026-07-19

## 1. Objective

在`media-service/src/helix/domains/libra/`实现clean Handoff A与Libra front half：Libra Intake读取Procurement immutable
Candidate、执行FA-04 Subject Continuity Resolution，并在一个原子Transfer Point形成Decision、Subject create/extension、
Production Material Binding、Material Control转移与Receipt；随后实现Shelf Routing和Acceptance Spec前半段。

本Phase只使用P2合同、P3–P5 Foundation、P6 Horizontal Domain public contracts和P7 `CandidateDeliveryPort`。不接旧Libra/
Kairox/Task Runtime，不执行真实媒体生产、Workspace写入、Handoff B、API/UI或startup。

## 2. SSOT traceability

| Contract area | SSOT source | P8 realization |
| --- | --- | --- |
| Subject、Production responsibility | §3.4.1–3.4.3 | Libra-owned Subject/Binding/continuity facts |
| Handoff A | §4.4、§6.3.4 | Offer intake、Decision、atomic Transfer Point、Receipt |
| FA-04 continuity | §3.4.2、§4.4.3、§5.4.1 | exact claim唯一命中且Episode零重叠才extension |
| Routing/Acceptance Spec | §3.4.3–3.4.4、§5.3–5.5 | Subject后置Routing与versioned Spec |
| Logical/physical boundary | §8.1.4、§8.2.2、§8.4.2 | Libra public Facade、scoped Store、只读Candidate port |
| Persistence/transactions | §8.5、§8.7 | Libra-owned facts与Handoff A canonical transaction |

## 3. Hard boundaries

- Procurement Candidate/Offer保持Procurement事实；Libra只经`CandidateDeliveryPort`读取，不写`proc_*`表。
- Intake Acceptance不是长期Process Root；同一Offer只有一个immutable Decision。
- 只有exact Season Continuity Claim恰好命中一个active Subject且Episode零重叠时才extension；其余全部新建Subject。
- 标题、年份、目录、模糊分数或weak identity不得选择既有Subject，不得把continuity claim升级为Canonical Identity。
- Handoff A Accepted必须让Decision、Subject/extension、claim snapshot、Binding、Control transfer、Receipt/Outbox全有或全无。
- Candidate不决定Shelf；Routing在Subject接管后独立完成。P8不进入Workspace生产或Arca。
- 无compatibility、dual-read/write/run、旧Runtime fallback或跨域Store旁读。

## 4. Allowed verification

仅允许Node unit/contract/isolated fixture、owned temporary SQLite、synthetic Candidate/Offer/Subject/Control snapshot和fake clock。
禁止Service启动、socket、真实Field/Provider/媒体副作用、E2E、Docker、Canary、production及`media-desktop`。

## 5. Work packages

### P8-00 Exact phase transition and baseline receipt

- 从P7 closure `2cf98561d7cf785db4005e65e99b0750d84ce5ce`创建`codex/helix-p8`与独立worktree。
- fresh clean checkout复跑P7 Exit Audit，冻结P8 baseline、SSOT/P2 aggregate和禁止动作。
- Done：独立`codex/helix-p8` worktree从P7 closure创建；temporary detached clean checkout在exact closure上复跑P7
  Exit Audit与P2–P7全部聚合门禁PASS。Evidence见`evidence/P8_00_BASELINE_RECEIPT.md`。

### P8-01 Libra public ports and package guards

- 从SSOT/P2物化唯一`LibraIntakeFacade`、Command/Query及front-half public contracts。
- 拒绝Procurement Store、Arca、Workspace production、generic Runtime和HTTP authority。
- Done：当前Phase只物化SSOT明确命名的`LibraIntakeFacade.offerCandidate(ProcurementCandidateOfferAvailableMessage@1)`；
  未提前发明后续Admin/Delivery方法。nominal binding拒绝缺失/额外authority，public package无Store、Procurement internal、Runtime、
  HTTP或startup依赖。Evidence见`evidence/P8_01_LIBRA_INTAKE_PUBLIC_PORT.md`。

### P8-02 Libra scoped Store and immutable Subject facts

- 建立Libra-owned Subject、Subject revision、Candidate provenance、Production Material Binding、continuity与Episode关系Repository。
- 精确审计全部`libra_*`表、FK、revision/state/digest连续性；不复制Candidate为Libra mutable对象。
- Design Return：Candidate Delivery没有正式typed snapshot携带full Primary Manifest与Primary location Evidence；现有Binding/
  Store不能保存一个Material对应多个Episode；Subject没有Intake revision/head支持FA-04并发CAS；Resolved Product Identity的exact
  provider-season anchor只有opaque set digest无法匹配；new Subject identity pointer初值及Accepted Decision input也未闭合。
  禁止旁读Procurement Store、压扁Episode、用timestamp冒充revision或让调用者指定Subject。详见
  `evidence/P8_02_LIBRA_INTAKE_STORE_DESIGN_RETURN.md`。
- Done：Architecture Agent的`PBF-11`补齐typed Candidate Delivery Snapshot、global/target CAS、Resolved Identity exact
  Claim、N:M Episode关系与nullable identity初值；实现线程原样物化168张表及精确Handoff A 10 Libra + 5 Foundation
  同事务合同。Libra scoped Store只拥有10张`libra_*`表，保存Subject/continuity/Episode/Binding/Decision/Receipt完整连续性，
  不旁读或写入`proc_*`。Evidence见`evidence/P8_02_LIBRA_INTAKE_STORE.md`。

### P8-03 Offer intake and Candidate snapshot verification

- typed Offer经Inbox/dedup进入Libra；只用`CandidateDeliveryPort`读取exact Package并重算Acceptance Basis。
- 丢失、重复、乱序Signal不改变业务事实；同一Offer只形成一个Intake Decision。
- Design Return：`CandidateDeliverySnapshot@1`要求包含完整`CandidatePackage@1`，其中Related Reference必须携带完整
  `PhysicalMaterialIdentity@1`；但`proc_candidate_related_references`没有保存materialKey/mountScope/inode/content hash或
  reference digest，发布后无法从正式Owner rows无损恢复，也不能旁读Foundation Result或旧Store补值。详见
  `evidence/P8_03_CANDIDATE_DELIVERY_DESIGN_RETURN.md`。
- Done：`PBF-11-R1`经复审后原样纳入；Candidate Publication逐列保存完整Related Material Reference，正式Port收敛为
  `readSnapshot(CandidateDeliveryQuery@1) → CandidateDeliveryReadResult@1`。Procurement只读8张Owner表重建完整历史
  Package/Manifest/Location Snapshot，任一identity、relation、digest或query漂移均fail closed。Evidence见
  `evidence/P8_03_CANDIDATE_DELIVERY.md`。

### P8-04 FA-04 Subject Continuity Resolution

- pure deterministic resolver冻结Candidate claim、matched active Subject set与Episode overlap Evidence。
- exact one + zero overlap=`season_extension`；0/N match、缺claim或任一overlap=`new_subject`。

### P8-05 Intake Decision and rejection path

- 冻结accepted/rejected decision input/output、closed rejection reason与业务幂等。
- Rejected不创建/扩展Subject、不转移Control，仍形成Libra-owned Decision与上游可消费Projection。

### P8-06 Handoff A Accepted atomic Transfer Point

- 一个canonical transaction原子建立Decision、Subject create/extension、continuity/episode snapshot、Candidate provenance、
  Production Material Binding、全部Primary Control transfer、Receipt/Outbox。
- crash/fence/CAS反例证明无部分接管、无Owner窗口、Related不进入Control Scope。

### P8-07 Receipt publication and Procurement boundary

- Procurement只异步读取Accepted/Rejected Receipt Projection并收口Delivery Reservation；不读Subject Store。
- receipt丢失、重复、重启由durable Outbox/Inbox与Reconcile恢复。

### P8-08 Shelf Routing and Acceptance Spec front half

- Subject接管后独立执行Routing Assessment、一次性Shelf选择与versioned Acceptance Spec。
- Candidate/Offer不携带目标Shelf；不启动Production Workspace或Handoff B。

### P8-09 Capability registration and Foundation integration

- 精确注册P2 Libra front-half Capability、Owner、Effect Class和typed ports。
- 同步Decision/Control事务不伪造成长期Workflow；真正Work只走P4正式路径。

### P8-10 Isolated Handoff A / Libra harness

- 单一Node命令覆盖Libra front-half owned tables、Capability、Facade、FA-04、replay/CAS/crash与跨域反例。
- 回归P2–P7全部聚合门禁。

### P8-11 P8 Phase Exit Audit and evidence freeze

- 反向审计SSOT traceability、Owner/Store、Handoff A、Subject continuity、Control与Routing边界。
- 证明无Workspace production、Handoff B、Arca、API/UI/startup/legacy/dual/fallback或真实外部效果进入P8。
- PASS后归档并自动进入P9。

## 6. Execution order

~~~text
P8-00 → P8-01 → P8-02 → P8-03 → P8-04 → P8-05
                                             ↓
P8-11 ← P8-10 ← P8-09 ← P8-08 ← P8-07 ← P8-06
~~~

## 7. Exit criteria

1. Libra front-half public Facade、owned Store与P2 Capability全部可追溯到SSOT；
2. FA-04 exact one/zero-overlap及全部反例有机器证明；
3. Handoff A accepted事务无部分Subject/Binding/Control/Receipt状态；Rejected零Control transfer；
4. Procurement与Libra只经typed Offer/CandidateDeliveryPort/Receipt Projection协作，无跨Store读写；
5. Routing严格后置于Subject接管，Candidate/Offer不含Shelf决定；
6. P2–P7回归和P8 isolated harness全部PASS；
7. `findings=[]`、`prohibitedActionsRun=[]`、clean worktree且SSOT未由实现线程修改。

## 8. Stop conditions

- SSOT不足以唯一实现Offer输入、Decision Evidence、FA-04输出、Subject/Binding/Control/Receipt原子连续性；
- 实现需要Libra写Procurement Store、把weak claim升级为Canonical Identity或在Candidate阶段决定Shelf；
- 需要修改SSOT、兼容层、dual path、旧fallback；
- 需要真实媒体副作用、E2E、Docker、production或`media-desktop`授权。

只有真实业务决策或SSOT冲突上报用户；普通工程选择由Codex在本Phase内自主收敛。
