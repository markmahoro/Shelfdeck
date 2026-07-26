# P14 Series Production / open Handoff B Checkpoint

状态：**FROZEN FOR ACTIVE REVIEW**

## Baseline and scope

- 已接受基线：Series Routing / Acceptance Spec / active Run
  `643ced69`；P14 tested `36ae8eb6`，evidence `a927a655`。
- 本检查点只覆盖同一 active Series Libra Run 到一个 immutable
  `OnDeckProductPackage` 和一个 open Handoff B Offer。
- 当前没有进入 Arca Handoff B Acceptance、On-deck、Off-load 或 Workspace
  cleanup；也没有进入 JAV、Western Adult 或横向路由补齐。
- 实现线程未修改 Architecture SSOT。

## Closed vertical

同一条已接受 Movie production construction path 现同时支持：

`active Series Run + E001/E002/E003 Run Manifest
→ Workspace admission
→ exact direct-original media verification
→ Product Metadata / Identity / Cast facts
→ role-aware Artifact Product Staging
→ six-group Product Conformance
→ Deliverable Promotion
→ immutable OnDeckProductPackage
→ one libra.product-offer.available@1`

- 没有建立平行 Series coordinator、Store、transaction 或 Handoff；Series 复用
  `movie-production-coordinator`、Workspace、Product Fact、Conformance、
  Promotion 和 Product Delivery 既有实现，只按 frozen
  `contentProfile/structureKind/productScope`处理差异。
- 两个 Primary member 保留 exact N:M Production Episode claim：第一个
  Primary保存E001/E002，第二个保存E003。生成NFO与Poster是非Primary Artifact
  role，`episodeClaims=[]`且使用nominal empty claim-set digest；它们的Product
  scope只由Artifact Requirement、Verified Artifact Manifest和verification
  continuity表达。
- 最终Package包含四个Material member（两个Primary、一个NFO、一个Poster），
  只为Primary冻结三条member/Episode relation；不存在Artifact Episode relation。
- Product Delivery historical reconstruction 对 Series 使用
  `scopeKind=episode_delivery`，重建同样三个Primary relation并验证claim tuple；
  非Primary仍为空，没有把N:M scope压平为单Episode。
- Related NFO 按正式 source priority 先于 typed TMDB Provider observation。
  测试中的 TMDB response 是 construction fixture，仅证明 typed Provider
  continuity，不代表真实 Provider acceptance。
- 原 Series MKV、Episode NFO、tvshow NFO 与 Season artwork bytes/mtime
  全部保持不变。生成的 Product NFO/Poster 只写入 disposable Libra Workspace。

## Bounded Product Fact Plan correction

合法 Series metadata/fact payload 会超过 `fx_plan_nodes.input_bindings_json`
16 KiB。实现没有提高上限、截断、压缩或旁路 Work Runtime，而是新增并物化
`LibraProductFactCommitPlanBinding@1`：

- Plan 只冻结 exact Run/Fact fence、payload digest、Source Basis identity/digest、
  durable Result refs、Artifact/Verification refs 与 nullable Media Cast Fact ref；
- 完整 Resolved Identity、Metadata Draft、Verified Artifact Manifest 和
  Source Basis value 仍由 Coordinator 在 execution/commit boundary 从当前
  deterministic inputs 内存组装；
- schema 为 closed object，`maxCanonicalBytes=16 KiB`，在 Plan insert 前由
  runtime validator 校验；
- Series 三个 Product Fact Plan row 全部低于16 KiB，且不含完整
  `sourceBasis`、`productMetadataDraft` 或 `verifiedArtifactManifest`。

这是 implementation-owned construction contract；未新增 Capability、Result
family、table 或 canonical transaction。

## Recovery and replay

真实 public Admin HTTP 重放覆盖三个既有 Movie 高风险窗口：

1. `afterWorkspacePhysicalEffect`：Package为零；重启复用journaled Workspace
   effect，不在源目录产生任何写入。
2. `afterProductFactsCommit`：Identity、Metadata、Cast三类Fact各一份，
   Package仍为零；重启不重复Fact或Artifact。
3. `afterPackageCommit`：一个Package和一个
   `libra.product-offer.available@1`已经原子存在；响应前故障后重启只历史重建
   同一Package/Offer。

最终再次重放保持相同 `onDeckPackageId/packageDigest/offerId`；Package、
Fact、Outbox、Workspace staging reference与物理输出均不重复。Series路径没有
调用Arca Acceptance，`arca_acceptance_decisions=0`。

## Owner / Store / Handoff audit

- Procurement/Handoff A、Libra Routing/Spec/Run全部复用已接受Owner facts。
- 本段只读取Libra exact Run/Spec/Manifest/Binding provenance和正式 durable
  Product inputs，只写Libra Workspace、Product Fact、Package/Offer Owner rows。
- Provider只通过现有 typed integration port；没有直接Provider补读、外域Store
  读取、`latest/current`扫描或Foundation Result fallback。
- Composition Root只根据正式 formation result接线；业务判断、Workspace、
  Conformance与Promotion保持Libra owner-local。
- Architecture inventory保持112 Capabilities / 97 Result families /
  177 tables / 43 canonical transactions；114 routes / 18 UI surfaces。
- `ProductionMaterialManifest@1`的domain/application machine schema已同步加入
  closed role guard：只有`primary_payload`可以携带Episode Claims；Workspace
  Staging与Promotion Runtime也执行相同fail-closed约束。

## Evidence

- Series public HTTP + Plan/Event + production/replay：`2/2 PASS`。
- 非Primary Workspace Staging与Promotion Episode Claim正反例：PASS。
- Domain/Application nominal schema物化、registry digest与baseline gate：PASS。
- Historical Product Delivery验证四个member、三个Primary relation及零Artifact
  relation：PASS。
- Movie production non-regression：`1/1 PASS`。
- 完整 `npm run test:helix-architecture`：`129 files / 876 tests PASS`。
- Contract aggregate：
  `31c50aca25c02424e214c6ddd2ba52e13452cb926e8e176e02d324958ee0d43d`。
- Manifest aggregate：
  `35d209a3c5141d397b824796995508a453035df2420b032e34fc83b0a4cfe829`。
- `prohibitedActionsRun=[]`。

## Remaining

- 当前冻结在 open Handoff B Offer，等待 Architecture/P14 独立复验。
- 未实施 Series Arca Handoff B Acceptance、On-deck、Off-load 或最终 cleanup。
- typed TMDB fixture不是Real Provider acceptance。
- `F02.17`仍为`NOT_RUN`。
- P14接受后，下一段只推进同一Series Package/Offer到Arca On-deck与最终责任
  closure；不得提前进入JAV、Western Adult或横向Feature Matrix。
