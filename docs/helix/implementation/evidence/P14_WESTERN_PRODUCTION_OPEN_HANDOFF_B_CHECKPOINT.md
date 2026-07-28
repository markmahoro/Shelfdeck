# P14 Western Adult Production / Open Handoff B Checkpoint

状态：**FROZEN — 待 Architecture active review / P14 独立复验**

## Baseline 与停止点

- P14 已接受的 Western Routing / Spec / active Run source：`5b7990ee`。
- P14 evidence：`43c86f4c`（tested `a4b942a1`）。
- PBF-23 Architecture correction：`9dc37de7`，在实现分支原样纳入为
  `5186469a`。
- 本检查点只覆盖：
  `active western_adult Run → service-local Analysis
  → Workspace / Product Facts / Staging / Conformance
  → immutable OnDeckProductPackage
  → exactly one open libra.product-offer.available@1`。
- Arca Acceptance、Inventory、On-deck、Libra responsibility closure 均为0；
  本检查点冻结在 Handoff B Offer open。

## Construction contracts

正式分析链由 clean service Composition Root 注入并按以下阶段执行：

`frames.extract
→ face.embedding.compute
→ face.cluster.compute
→ western.analysis.request
→ western.analysis.observe
→ face.reference.match`

- 每阶段均是独立 Supporting Work、immutable one-node Plan、Event 与 typed
  Result；`LibraWesternAnalysisPhasePlanBinding@1`冻结完整Capability input和
  exact upstream Result refs。
- `FrameArtifactSet@1`只携带一个`western_frame_set` composite Artifact
  Handle、frameCount和member-set digest；不内联逐帧Handle。
- Embedding只消费该composite Handle，Cluster只消费Embedding Result；
  Analysis request是`workspace_write`并输出
  `ArtifactHandle(kind=western_analysis)`，observe是pure observation并输出
  `WesternAnalysisResult@1`。
- People只通过`PersonReferenceQueryFacade`读取0..256个正式
  `PersonReferenceProjection`。本施工样本projection为空，但仍实际执行
  `face.reference.match`，形成`matches=[]`及完整unmatched cluster集合。
- Product Metadata与Media Cast均消费持久Analysis/Match Results；
  Product Fact source ref精确绑定Western Analysis Artifact Registry Handle，
  不存在Worker receipt、caller Result fixture或Foundation Result旁读。
- Western Model Pack冻结model revision、SHA、license、input/output contracts
  与cluster parameters。实际引擎作为clean service-local adapter注入；当前
  deterministic fixture只证明施工合同与恢复，不声明真实ONNX模型、人脸或
  Provider验收。

机器物化新增/扩展包括：

- `WorkspaceArtifactOutputTarget@1`、`SamplingPlan@1`、`FaceModelRef@1`、
  `ClusterParameters@1`、`AnalysisSpec@1`；
- `FrameArtifactSet@1`、`FaceEmbeddingSetHandle@1`、
  `FaceClusterSetHandle@1`、`WesternAnalysisResult@1`、
  `PersonMatchEvidence@1`；
- Product Metadata / Media Cast Western source basis和
  `LibraWesternAnalysisPhasePlanBinding@1`。

PBF-23后Worker operation catalog只保留既有asset register/upload；
Western analysis不再映射到Worker external request。

## Product / Package continuity

- `western_temporary`保持弱、可纠正的Handoff A输入；Resolved Product
  Identity由正式Western Analysis Result及其Artifact Handle建立，没有伪造
  Provider或Canonical Identity。
- Product Metadata由Western Analysis Normalize建立；Media Cast由同一cluster
  Result、同一冻结People projection set与正式Match Result建立。空projection
  不是empty-cast shortcut。
- Primary复用满足Spec的HEVC/Matroska/MKV输入；NFO经正式
  `product_sidecar.render`，poster经正式Western render、Artifact
  verification与role-aware Staging。所有Product members的Episode claims为空。
- six-group Conformance使用完整Acceptance Spec、Product Facts、Media与Artifact
  verification、Product Material Manifest；没有放宽Requirement。
- Deliverable Promotion保留PBF-17/PBF-18-R1顺序与Control连续性，形成一份
  immutable Package和一条pending Offer；ProductDelivery historical read可重建
  同一Package。
- 原Western MKV/NFO/poster及无关源文件的SHA-256、size、mtime保持不变；
  所有物理写入只发生在disposable Libra Workspace。

## Recovery 与反例

- Frame物理文件已经产生、journal/Result尚未完成时崩溃，重启从同一effect
  reality恢复，不重复frame extraction。
- Western Analysis Result已经提交、Event尚未success时崩溃，重启复用exact
  persisted Result，不重复analysis写Artifact。
- Package/Control/Offer已经原子提交、HTTP响应前崩溃，重启返回同一Package与
  exactly one Offer。
- 历史Workspace phase revision用于重建逐字节相同的Frame/Analysis Target和
  Plan binding，避免current Workspace revision导致恢复身份漂移。
- deterministic engine调用计数跨全部故障/重启保持：
  Frame、Embedding、Cluster、Analysis、Match、Poster各一次。
- 持久`fx_event_result_bindings.result_json`按其正式Result schema、JCS bytes与
  result digest重新验证；额外字段、Model Pack shape/SHA、Artifact kind/Handle、
  People projection contract漂移均fail closed。
- no Analysis adapter时仍停在accepted active Run，不创建Workspace/Product；
  Movie/Series/JAV共享Formation和Production回归保持通过。

## Machine baseline 与测试

- Core inventory：`112 Capability / 97 Result / 178 Table /
  43 canonical Transaction`。
- Additional machine counts：`29 shared types / 109 domain inputs /
  205 referenced type refs / 0 unresolved refs`。
- SSOT source-map aggregate：
  `59a36f2312f45110dc159ffab8dabe2f34611ec991001191a8721663ffd7414a`。
- Contract aggregate：
  `c5a62e222ce4063f7ad05073f343e525d417f625cc937ee5f1284a2cf2090995`。
- Component digests：
  - shared types：
    `ebf1d53507130ac901d59651ef8afcb9f923654e36c1f9273fd0c5deb09db3a1`；
  - result types：
    `e11ff14390c5d8d5c69c87338cd7c3633faac8bd61ef78a248a48641da30f515`；
  - domain inputs：
    `5c621eb74274a665b119158b6e6bf6c6f3812817810fb3e19eda88dd8943b55f`；
  - capabilities：
    `83f48b7eff4d27d0af17f5f49c9dca08d441b6725a865cd30b6b1720e075a802`；
  - tables：
    `c2b1dd21b92b30b9ab5aa4a09e378e2cc3136f40cf75e1f7dbbd07dc05a636ba`；
  - transactions：
    `4d37eb40a1851fae068780e184ce4bc152be5428d662447576d0f166ea9a82ab`。
- Western定向：`3/3 PASS`。
- PBF-23 machine、People public port及共享Product Fact回归：`85/85 PASS`。
- Series N:M / Movie Perception / JAV Handoff A回归：`15/15 PASS`。
- Table/DDL/Worker/baseline定向：`22/22 PASS`。
- 完整`npm run test:helix-architecture`：`133 files / 898 tests PASS`；
  dependency、semantic、manifests、contracts均PASS，findings与
  `prohibitedActionsRun`为空。

## Owner / Boundary 与残余风险

- Analysis、Workspace、Product Fact、Package均在Libra owner-local；People仅经
  正式Facade提供projection；Composition Root只装配service-local adapters。
- 无Procurement/Arca/People Store补读、跨Owner写、latest/current scan、
  compatibility、legacy fallback或Worker/Desktop/Ollama/Python/FastAPI/Mirex。
- Architecture核心Inventory、Owner、Store、Handoff、Capability、Result、
  Table与Transaction边界未新增。
- 当前deterministic analysis fixture不是real ONNX Model Pack、real face或
  real Provider acceptance；F02.17继续为`NOT_RUN`。
- Architecture/P14接受前不得让Arca消费Offer，不得进入responsibility closure
  或恢复横向Feature/UI工作。
