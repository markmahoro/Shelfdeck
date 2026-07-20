# P9 Libra Production and Delivery Detailed Plan

Status: Active；P9-00–P9-03 complete；P9-04 active.

Last updated: 2026-07-20

## 1. Objective

在`media-service/src/helix/domains/libra/`实现clean Libra production back half：从P8已发布的Acceptance Spec建立
Libra Run，在隔离Production Workspace内组织Product Metadata、Artifact、媒体生产和Conformance，发布immutable
On-deck Product Package，并闭合Run freshness、rework、discard、Cleanup与Off-load Completion驱动的Workspace reclaim。

P9不执行Handoff B Acceptance或Arca On-deck Commit，不接真实Provider/FFmpeg/文件副作用，不接API/UI/startup，也不复用
旧Kairox Runtime、executor、Store或flow语义。

## 2. SSOT traceability

| Contract area | SSOT source | P9 realization |
| --- | --- | --- |
| Libra Run与状态 | §3.4.4、§6.4.4–6.4.6 | Run Creator、scope exclusivity、freshness与terminal semantics |
| Production Material/Workspace | §3.4.6、§6.4.7、§7.6、§10.5 | external input只读；Working/Staging、space、Control与cleanup |
| Product production | §6.4.7、§7.3.5、§8.6.6–8.6.8 | metadata/artifact/media/external material typed Capability |
| On-deck Package | §3.4.7、§4.5、§6.4.7–6.4.10 | immutable Package、Product Manifest、Off-load Context、Control |
| Discard/Cleanup/Reclaim | §3.4.4、§6.4.5、§10.5.2 | user discard原子释放Input；Workspace逐Material Evidence回收 |
| Persistence/transactions | §8.5.11、§8.7 | Libra-owned rows、canonical commits、Result/Marker/Outbox |

## 3. Hard boundaries

- 正式外部Input只属于Production Material Set，对Libra只读；所有变化产物只能先写Production Workspace。
- Workspace Working Set与Product Staging Set不重叠；未经验证的Material不得进入Product Material Manifest。
- 原Input已满足Spec时允许Package直接引用，但不得为抽象一致性强制复制大型文件。
- Run Creator只建立业务Run，不选择Capability、设备、Flow或Task；真正Supporting Work只走P4正式Runtime。
- Package发布不等于Handoff B Accepted，不创建Arca On-deck Run、Shelf Entry、Deck Fact或Inventory。
- frozen不得自动恢复；只有用户Discard Decision可释放原始Input Control。Workspace/Product Control必须等删除Evidence后释放。
- Off-load Signal只作wake；Reclaimer必须读取Arca durable Off-load Completion Projection，不依赖可靠Signal或跨Store补读。
- 禁止compatibility、dual-read/write/run、旧Runtime fallback、旧Store旁读或将Kairox恢复为组件。

## 4. Allowed verification

仅允许Node unit/contract/isolated fixture、owned temporary SQLite、synthetic Material/Artifact、fake clock、fake P5 ports和
故障注入。禁止Service启动、socket、真实Provider/Worker/FFmpeg/媒体文件副作用、E2E、Docker、Canary、production及
`media-desktop`。

## 5. Work packages

### P9-00 Exact phase transition and baseline receipt

- 从P8 closure `3184ef4573cb3663e4a1fae87fc65b4d1c270b38`创建`codex/helix-p9`与独立worktree。
- fresh clean checkout复跑P8 Exit Audit，冻结P9 baseline、SSOT/P2 aggregate和禁止动作。
- Done：P9 worktree已建立；P8 clean-tree Exit Audit返回`ok=true`、`findings=[]`、`prohibitedActionsRun=[]`。
  Evidence见`evidence/P9_00_BASELINE_RECEIPT.md`。

### P9-01 Production contract feasibility and public boundary

- 从SSOT/P2反向审计Run、Workspace、Product、Package、Discard、Cleanup和Reclaimer的typed DTO、Owner row、revision/digest/CAS、
  canonical transaction、Result/Marker/Outbox及重启恢复连续性。
- 只物化SSOT正式命名的Libra production public contracts；拒绝Store、Arca internal、raw filesystem、generic Runtime或HTTP authority。
- 若任一路径无法唯一实现，精确Design Return架构Agent；不以调用者补值、Foundation Result或旧Store推断。
- Design Return：Run Creation/Lifecycle、Run-owned Material/Episode scope、Workspace current/Working→Staging、完整Package
  Promotion、Discard/Cleanup及Off-load Completion scope admission的DTO→Owner row→transaction→restart连续性存在已证明缺口；
  精确问题已发送Architecture Agent。Evidence见`evidence/P9_01_PRODUCTION_CONTRACT_DESIGN_RETURN.md`。
- Non-blocked reuse audit Done：0个旧Service/Runtime/Executor/Store可复制；只登记FFmpeg command/progress、disc parser、
  Workspace containment/checksum/atomic rename及设备识别测试向量。正式目标replace函数明确排除P9。Evidence见
  `evidence/P9_01_LEGACY_REUSE_AUDIT.md`。
- Done：PBF-13与PBF-13-R1均经实现侧只读复审后原样纳入；112/97/176/43机器合同完成重物化。
  `ProductDeliveryPort`和`WorkspaceReclamationPort`只公开SSOT正式方法，六个Reclamation application DTO与
  Product Delivery DTO均已冻结。机器反例拒绝Store、Repository、路径、Material ID和删除authority；完整Architecture
  gate 679/679 PASS。Evidence见`evidence/P9_01_PRODUCTION_CONTRACT_FEASIBILITY.md`。

### P9-02 Run Creator and immutable delivery scope

- 从ready Acceptance Spec建立Run，冻结initial Material Manifest、Execution Basis、Priority及Series Episode Delivery Manifest。
- 强制single唯一最终提交资格、Series non-overlap、frozen replacement prohibition和稳定Run identity/replay。
- Done：Run Admission只从Libra Owner rows与同事务Material Control snapshot建立immutable Basis/Manifest；initial、
  replacement、active scope set CAS、旧Run supersede、Result/marker replay和crash rollback均PASS，且零Outbox。
  Evidence见`evidence/P9_02_RUN_CREATOR.md`。

### P9-03 Run freshness, lifecycle and priority

- 实现active/suspended/superseded/frozen状态机、bounded freshness recovery和合法replacement Run。
- expedited只在合法替代Run延续，Handoff B Accepted后终止；不得下沉为用户Task priority。
- Done：Lifecycle原子事务闭合Comparable Basis、bounded recovery、priority、terminal freeze、published Package
  custody fence与Handoff B accepted consume；Result/marker replay和crash rollback均PASS。Evidence见
  `evidence/P9_03_RUN_LIFECYCLE.md`。

### P9-04 Workspace registry, material admission and control

- 建立Run-scoped Workspace revision、Working/Staging不重叠引用和Foundation Workspace Material连续性。
- 所有workspace write执行space admission、Effect fence与Control校验；正式Input保持只读。

### P9-05 Product facts, metadata, cast and artifacts

- 按fixed source order和durable Observation实现Metadata gap reconcile、Draft、Artifact验证及Product Fact commit。
- Media-Cast由Libra拥有；People只提供Projection，不接管Media-Cast或跨Store补读。

### P9-06 Media production, output selection and conformance

- 实现input verify、remux/transcode fake-port执行、Product Media verify、output selection及Acceptance Spec Conformance。
- 未验证输出不得进入Staging；无真实FFmpeg或媒体副作用。

### P9-07 External material acquisition and import

- 实现query/search/select/request/observe/stability/identity/package verify与Workspace import的正式链。
- Provider/Worker只经P5 typed ports；deferred/retry/recovery不产生隐藏fallback或外部来源切换。

### P9-08 Deliverable promotion and package publication

- 原子发布immutable On-deck Product Package、Product Material Manifest、Off-load Context、Product Facts/Artifacts、Offer、Result/Marker/Outbox。
- 对新Deliverable Material取得精确Libra Control；Package发布后不改写，最多一份成为Run成功交付。

### P9-09 Rejection-driven rework and Handoff B boundary

- 只消费Arca Structured Rejection Projection，保持Package immutable；Spec相同时同Run返工发布顺序新Package。
- P9不接受Handoff B、不写Arca Store、不创建On-deck Run、Shelf Entry、Deck Fact或Inventory。

### P9-10 Run discard and input control release

- frozen Run仅由用户Decision原子写Discard、Run terminal、Pre-deck scope结束、原始Input Control release、Cleanup Scope及Outbox。
- 不在SQLite事务中伪造物理删除；Workspace/Product Control继续由Cleanup Scope持有。

### P9-11 Workspace cleanup and Off-load Completion reclaimer

- 逐Material执行fake deletion effect、验证Evidence并原子commit cleanup/release Control。
- 支持discard立即eligible、durable Off-load Completion加24h grace、last-reference与orphan双轮规则；Signal只作wake。

### P9-12 Capability registration and isolated harness

- 精确注册P2 Libra production Capability、Owner、Effect Class、Fence/Resource与typed ports。
- 单一命令覆盖P9 fixtures及P2–P8回归；禁止真实外部动作。

### P9-13 P9 Phase Exit Audit and evidence freeze

- 反向审计SSOT traceability、Owner/Store、Workspace、Control、Package、Discard/Cleanup、旧Runtime不可达及P10未提前耦合。
- clean-tree `findings=[]`、`prohibitedActionsRun=[]`后归档P9；本自动化周期停止，不进入P10。

## 6. Execution order

~~~text
P9-00 → P9-01 → P9-02 → P9-03 → P9-04 → P9-05 → P9-06
                                                    ↓
P9-13 ← P9-12 ← P9-11 ← P9-10 ← P9-09 ← P9-08 ← P9-07
~~~

## 7. Exit criteria

1. Run、Workspace、Product Facts和Package均可由Libra Owner rows完整历史重建；
2. external Input始终只读，所有变化结果只产生于Workspace，Product Staging只含已验证输出；
3. freshness/replacement/frozen/discard状态机及scope exclusivity由CAS和机器反例证明；
4. Package publication、Control、Manifest、Offer、Result/Marker/Outbox无部分状态；
5. discard释放Input与异步Workspace cleanup明确分离，删除Evidence前不释放受控Material；
6. Reclaimer不依赖Signal或跨Store补读，遵守durable Projection、grace和reference规则；
7. P2–P8回归和P9 isolated harness PASS；
8. `findings=[]`、`prohibitedActionsRun=[]`、clean worktree且实现线程未修改SSOT。

## 8. Stop conditions

- SSOT不足以唯一实现Run/Workspace/Package/Discard/Cleanup的输入、输出、Owner rows、digest/revision/CAS或恢复；
- 实现需要写Arca/Procurement Store、修改正式Input、用Foundation Result替代Owner Fact或提前执行Handoff B；
- 需要修改SSOT、兼容层、dual path、旧fallback；
- 需要真实媒体副作用、E2E、Docker、production或`media-desktop`授权。

只有Architecture Agent明确需要用户作真实业务决策时停止并通知用户；普通工程问题和SSOT修正闭环由实现任务自主推进。
