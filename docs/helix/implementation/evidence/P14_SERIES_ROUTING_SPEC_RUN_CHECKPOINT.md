# P14 Series Routing / Acceptance Spec / active Run Checkpoint

状态：**FROZEN FOR ACTIVE REVIEW**

## Baseline and scope

- 实现基线：`094c310a`，P14 evidence `4e7bc272` 已接受正式 phased
  Work/Plan/Event 与 Series Handoff A。
- Architecture SSOT：实施线程未修改。
- 本检查点只覆盖已接受 Season Subject 到一个 active Libra Run；未进入
  Workspace、Production、Handoff B、JAV、Western Adult 或横向管理路由。

## Closed vertical

同一 P14 disposable Series sample 只通过正式 Admin HTTP 与 Owner-local public
ports完成：

`Season Subject/Bindings/Controls
→ Field Routing Assessment/Decision
→ Decision Basis
→ Acceptance Spec
→ active Libra Run + Episode Delivery Manifest`

- 使用正式 HTTP 创建 active Series Shelf、绑定 `system-beta-recommended`
  Rule Template，并发布 exact Field Routing Policy。第一命中结果来自正式
  Policy与Arca Shelf Routing Target Projection；Libra没有读取Arca Store。
- Decision Preparation复用已接受的 Perception Resolution public boundary。
  无rating记录时由Perception Owner实际提交 versioned `not_found` Resolution，
  Decision Basis冻结其 revision/result digest；没有用空数组或Libra合成结果。
- Acceptance Spec保持 `structureKind=season`、`contentProfile=series`，Product
  Scope为 `episode_manifest`，冻结 exact `E001/E002` Episode set与scope digest。
- Run Material Manifest为 `episode_delivery`。两个Primary member保留各自的
  Candidate Delivery ref、Libra Binding revision/evidence、current Material
  Control projection与Episode claim。Related NFO/图片不成为Run Primary member。
- Candidate/Binding Episode relation digest与Production Manifest nominal claim
  digest在Libra Owner内做确定性映射；Run Admission仍对完整Owner rows做重验，
  没有外域补读或Foundation Result旁读。
- Subject current Episode scope、Product Scope与Run Manifest Episode set必须完全
  相同；stale scope、stale Binding/Control/Spec/head或active Run Episode overlap
  均fail closed。
- Series结果返回 `contentProfile=series`；clean Composition只据已返回的typed
  formation result停止后续stage availability，明确不调用Movie Production。

## Recovery and counterexamples

- 在 `libra_runs` insert边界注入事务故障：Acceptance Spec已经是合法历史事实，
  但Run、Run Manifest及member全部为零。
- 移除故障并重启后，从同一Owner facts与heads重建相同basis，只形成一个active
  Run、一个Manifest、两个member和两条Episode claim。
- 相同HTTP请求再次重放只复用同一Routing Decision、Acceptance Spec、Run与
  Manifest；不会重复Probe、Handoff A或Owner写入。
- 机器反例覆盖：
  - stale Subject Episode scope；
  - stale Binding/Material Control/Acceptance Spec；
  - duplicate/conflicting Episode claims与active scope overlap；
  - Routing unresolved/inactive target；
  - Decision/Spec/Run CAS rollback。
- Sample MKV/NFO/图片bytes与mtime保持不变。

## Evidence

- 定向组合回归：`43/43 PASS`。
- 完整 `npm run test:helix-architecture`：`128 files PASS`。
- Inventory：112 Capabilities / 97 Result families / 177 tables /
  43 canonical transactions / 114 routes / 18 UI surfaces。
- Contract aggregate：
  `45ba7a467e7411c7671587cb5b265b1cedf9a53974d76b7a7209d7d80923574e`。
- Manifest aggregate：
  `35d209a3c5141d397b824796995508a453035df2420b032e34fc83b0a4cfe829`。
- `prohibitedActionsRun=[]`。

## Owner / transaction boundary

- Procurement与Handoff A事实完全复用已接受checkpoint，未重新发布Candidate。
- Libra只写自己的Routing Decision/Basis/Spec/Run/Manifest facts。
- Arca只通过正式Shelf Routing Target与Standard Projection提供输入；无跨Owner
  Store read/write。
- Material Control只通过正式Foundation projection与既有Run Admission
  transaction重验；没有新增Owner、Store、Handoff、Capability、Result family、
  table或canonical transaction。

## Remaining

- 当前冻结在active Series Run，等待Architecture/P14独立复验。
- 下一段仅可推进该Run的Workspace/Production/open Handoff B；当前未实施。
- FA-04后续Season extension仍必须由exact provider-season或persisted grouping
  claim、唯一active Subject与零Episode overlap驱动；本检查点没有用标题/路径
  猜测，也没有声明Provider acceptance。
- `F02.17`仍为`NOT_RUN`。
