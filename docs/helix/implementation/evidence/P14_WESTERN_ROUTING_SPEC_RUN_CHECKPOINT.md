# P14 Western Adult Routing / Spec / Active Run Checkpoint

状态：**FROZEN — 待 Architecture active review / P14 独立复验**

## 范围与基线

- Architecture SSOT baseline：PBF-22 `04f310c1`，实现分支原样纳入
  `6369526c`。
- P14已接受的Western Handoff A source：`da96d036`；tested
  `c360b5f6`；evidence `6590ffad`。
- 本检查点只覆盖：
  `accepted Western Subject → Routing Decision → Decision Basis →
  Acceptance Spec → one active Libra Run`。
- Provider、Workspace、Product Facts、Production、Handoff B与Arca均未进入。

## 正式链路

正式Admin HTTP预先创建active Western Shelf，绑定
`system-beta-recommended` Standard，并发布可命中的Field Routing Policy。
随后同一disposable Western媒体沿已接受Handoff A进入Libra Formation：

1. exact-read current Subject、accepted Intake、Binding与Material Control；
2. 以冻结Field/Profile Hint provenance和正式Arca Routing Target Projection建立
   ready Routing Basis、resolved Routing Decision；
3. exact-read目标Shelf Standard Projection；
4. Western Profile不声明rating Decision Input，因此Spec Basis为input-free，
   `perception_resolution_revisions=0`；
5. 发布一份immutable Acceptance Spec；
6. 以Spec、Subject/Decision head、Shelf projection、Binding/Control及
   Production Material Manifest原子admit一条active Libra Run。

Western Acceptance Spec精确来自正式Standard：

- identity：`internal_identity`，不要求Season；
- structure：`single`；
- metadata fields：`internal_identity / title`；
- artifacts：`nfo / poster`；
- media：HEVC + Matroska + `.mkv`；
- space：单Product上限1 GiB。

Handoff A中的`western_temporary`仍只是弱、可纠正的Candidate evidence；本阶段
没有把它提升为Provider、Resolved Product Identity或Arca Canonical Identity。
Run-owned `ProductionMaterialManifest@1`恰有一个`primary_payload`，scope为
`single`且Episode claims为空。

已接受Handoff A的`formation_not_started`检查点边界已由正式Formation路径替换。
Clean Host同时把`western_adult`加入现有“无正式Provider adapter则停在active Run”
closed profile gate，因此公共响应为`libra_run_active + production=null`，不会越界
进入Workspace。

## Recovery、CAS与反例

- Triage Result已提交、Candidate Publication前故障继续跨重启复用exact Result，
  不重复FFprobe。
- public same-key replay返回同一Routing Decision/Basis/Spec/Run/Manifest；
  changed payload返回409，所有head与Result exactly-once。
- stale Subject/Policy head使Decision Basis事务全回滚。
- stale Routing Basis/head使Routing Assessment/Decision事务全回滚。
- stale Material Control使Run Admission的head、Run、revision、Manifest、Result
  与marker全回滚。
- Result/marker内部故障后canonical Run Admission transaction保持全无。
- Movie/Series/JAV Formation与Lifecycle回归保持通过。
- 使用保留P14真实MKV经内置FFprobe走同一public链路；Primary与Related sidecars的
  SHA-256、size、mtime保持不变。

## 停止点证明

唯一存在的Formation状态：

- `libra_routing_assessments=1`；
- `libra_routing_decisions=1`；
- `libra_decision_basis_revisions=2`（routing + acceptance_spec）；
- `libra_acceptance_specs=1`；
- `libra_runs=1`且state=`active`；
- `libra_run_material_manifests=1`且member count=`1`。

以下保持零：

- Foundation Workspace Registry；
- Libra Workspace/revision/reference；
- Product Fact/Identity/Package；
- Arca Acceptance/Decision/Custody/Binding/Inventory/Shelf Entry/Deck Fact。

## 测试与机器基线

- Western synthetic public + production-boundary guard：`2/2 PASS`。
- Western retained real-MKV + FFprobe + production-boundary guard：
  `2/2 PASS`。
- Western/JAV/Series/Movie Formation + Decision/Spec/Run CAS/recovery：
  `33/33 PASS`。
- `npm run test:helix-architecture`：`133 files PASS`。
- Machine inventory：`112 Capability / 97 Result / 178 Table /
  43 canonical Transaction`。
- Manifest aggregate：
  `a4b184ec72bbe571bfac6c441e1bd336d8ab0a5d53dad8b48b0f10f83a887ff1`。
- Contract aggregate：
  `423a5818bca505d12998d87e69bf3e1d9391b0e960d014d84eb4f762bfc2b79f`。
- findings与`prohibitedActionsRun`均为空。

## Owner / Boundary审计

- Arca只通过正式Routing Target/Standard projection向Libra提供输入。
- Routing、Basis、Spec与Run均由Libra owner-local Store/canonical transactions
  写入；Composition Root只接线。
- 无Procurement/Arca Store补读、Provider/current cache、latest/current扫描、
  Foundation Result fallback、跨Owner写入、legacy或兼容双路径。
- SSOT、Domain、Owner、Handoff、Capability、Result、Table与Transaction库存
  未改变。

## 冻结与残余风险

当前冻结在exactly one active Western Libra Run，等待Architecture/P14复验。
不得进入Provider metadata、face/cast、Workspace/Production、Handoff B、UI或
横向施工。

本检查点不声明真实Western Provider、face、Feature/UI或Beta验收；`F02.17`
继续为`NOT_RUN`。
