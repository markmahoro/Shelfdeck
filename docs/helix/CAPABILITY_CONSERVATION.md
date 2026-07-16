# Level 7 Capability Conservation Audit

Status: `AUDITED / LEVEL_7_ACCEPTED / LEVEL_8_INPUT`

Last updated: 2026-07-16

本文是`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` Level 7的能力守恒Evidence，不是独立架构SSOT、活动计划或
clean Capability Catalog。它回答：历史Kairox目录中的62项业务Capability在clean Helix中分别保留、合并、
拆分、重新归属或失去旧语义后，是否仍有有效产品能力被静默遗漏。

最终Capability名称、nominal schema、物理模块、Store/Facade和Registry由Level 8确定；本文中的clean target
名称是逻辑合同标识，不授权直接按旧代码改名实现。

## 1. Audit basis and result

审计输入：

- Level 0–6全部Accepted业务合同；
- Level 7 Structured Draft中的Supporting Work、Domain Planner、Workflow/Event Runtime和Atomic Capability合同；
- `KAIROX_CAPABILITY_CATALOG.md`保存的62项历史业务Capability；
- `acceptance/FLOWPLAN_BUSINESS_PARITY.md`保存的旧FlowPlan复刻Evidence；
- `media-service/src/capabilityCatalog.js`及`media-service/src/capabilities/`当前实现，只作为代码Reality。

逐项结论：

| Disposition | Count | Meaning |
| --- | ---: | --- |
| `retain_recontract` | 21 | 单一有效效果继续存在，但必须改用clean scope、typed handle和Level 7 Effect Class |
| `merge` | 24 | 与近似能力合并为一个参数化或Manifest-aware原子合同，不保留内容类型换皮能力 |
| `split` | 12 | 历史能力跨Owner、跨效果或混入Decision，必须拆给Planner或多个Domain-scoped Capability |
| `remove_legacy_semantics` | 5 | 只承载旧Gate、逐步审批或Replace/Discard分支；Accepted产品合同不再需要该语义 |
| **Total** | **62** | 全部历史业务Capability均有确定去向 |

额外的第63个Catalog条目`workflow.blocked`不是Capability，必须删除，由Level 7 `Plan Resolution`中的
`temporarily_unplannable|contract_unplannable`表达，不建立伪执行节点。

审计没有发现需要用户决定的新业务分叉，也没有发现必须保留旧Gate、Task、flowKind或复杂Executor才能完成
的产品能力。Level 7能力守恒可以关闭；clean实现仍须等待Level 8物理合同和后续Implementation Gate。

## 2. Current-code evidence

当前代码盘点结果：

```text
Catalog entries               63
Historical business entries   62
workflow.blocked                1
pure                           38
commit_once                    16
staged_write                    9
Capability registrations       62
registrations with allowedTargetGates 62
```

全部62项注册仍依赖旧`allowedTargetGates`，Executor大量直接读取`task`、整份`config`、Kairox Store或People
Store；正式Material写入仍存在于`media.file.replace`、`series.season.replace`和`source.organize`。因此：

- 当前实现证明底层行为存在；
- 当前实现不满足Level 7 clean ExecutionContext和Domain边界；
- 不允许在旧Registry上增量修补后宣称Level 7完成；
- 实施必须clean cut旧Gate路由、旧Task上下文和跨Domain Store访问。

## 3. Conservation rules

本次映射遵循：

1. Capability只完成一个可独立失败、重试、授权、占用资源、验证或恢复的命名效果。
2. Planner拥有Objective/Requirement到Capability Graph的选择；Executor不能选择后续步骤。
3. 同一scope内Input、Output、Effect、权限和Fence完全相同的近似能力必须合并。
4. Owner、Authorization、Material Control或Output Evidence不同，即使底层代码相同也保持不同合同。
5. Provider adapter、FFmpeg helper、XML renderer、文件事务library可以复用，但不因此成为Capability Owner。
6. 正式外部Input不由Libra修改；Arca On-deck统一执行fixed Off-load transaction。
7. 大图片、视频、Provider payload和embedding只通过Artifact/Workspace handle传递，不进入Event热JSON。
8. Capability success只返回Result/Evidence/Effect Receipt，不能宣布Business Process完成。

## 4. Historical 62-item disposition

### 4.1 Historical Basedata and common Metadata — 1–10

| # | Historical capability | Disposition | Clean logical contract and boundary |
| ---: | --- | --- | --- |
| 1 | `emby.item.observe` | split | Emby描述信息并入`libra.product_metadata.fetch`；Physical Material技术事实改由`shared.material.media.probe`取得。Emby不再证明文件Reality |
| 2 | `filesystem.media.probe` | retain_recontract | `shared.material.media.probe(MaterialAccessHandle) → MediaProbeEvidence [pure_observation]` |
| 3 | `filesystem.layout.observe` | retain_recontract | `shared.material.layout.observe(MaterialAccessHandle, boundedScope) → LayoutEvidence [pure_observation]` |
| 4 | `basedata.verify` | split | 拆为Procurement Triage Evidence、Libra Product Conformance和Arca Custody/Acceptance各自的Domain-scoped verify；不存在全局Basedata Gate |
| 5 | `basedata.publish` | split | 按Owner拆成Procurement Observation/Claim commit、Libra Product Fact commit和Arca Inventory/Care commit；不存在共享Basedata Fact |
| 6 | `basedata.subject.publish` | remove_legacy_semantics | 删除Subject聚合Gate Fact；Season/Manifest聚合由对应Domain的Manifest验证和Canonical commit表达 |
| 7 | `media.identity.resolve` | merge | 与#8合并为`libra.product_identity.resolve(IdentityClaim, DecisionEvidence, structureKind) → ResolvedProductIdentity [pure_observation]` |
| 8 | `series.identity.resolve` | merge | 并入#7；`single|season`是同一效果的有限结构参数，不建立Series换皮Executor |
| 9 | `metadata.provider.fetch` | merge | 与#10合并为`libra.product_metadata.fetch(ResolvedProductIdentity, contentProfile, providerRef) → MetadataObservation [pure_observation]` |
| 10 | `series.metadata.provider.fetch` | merge | 并入#9；Provider adapter可以按结构选择协议，但Capability效果仍是一次Metadata observation |

### 4.2 Western Adult and Worker analysis — 11–21

| # | Historical capability | Disposition | Clean logical contract and boundary |
| ---: | --- | --- | --- |
| 11 | `media.frames.extract` | retain_recontract | `libra.media.frames.extract(MaterialAccessHandle, SamplingPlan) → FrameArtifactSet [workspace_write]` |
| 12 | `person.faces.embed` | retain_recontract | `libra.face.embedding.compute(FrameArtifactSet, ModelRef) → FaceEmbeddingSet [pure_observation]` |
| 13 | `person.faces.cluster` | retain_recontract | `libra.face.cluster.compute(FaceEmbeddingSet, ClusterParameters) → FaceClusterSet [pure_observation]` |
| 14 | `person.faces.match` | retain_recontract | `libra.face.reference.match(FaceClusterSet, PersonReferenceProjection) → PersonMatchEvidence [pure_observation]`；不得直接读取People Store |
| 15 | `metadata.poster.compose` | retain_recontract | `libra.western.poster.render(PersonMatchEvidence, FrameArtifactSet) → ArtifactHandle [workspace_write]`；不返回base64大Payload |
| 16 | `adult.metadata.compose` | merge | 与#21合并为`libra.western.metadata.normalize(WesternAnalysisVariant) → ProductMetadataDraft [pure_observation]` |
| 17 | `compute.asset.register` | retain_recontract | `shared.worker.asset.register(WorkspaceMaterialHandle, WorkerRef) → WorkerAssetReceipt [external_request]` |
| 18 | `compute.asset.upload` | retain_recontract | `shared.worker.asset.upload(WorkerAssetReceipt, WorkspaceMaterialHandle) → WorkerUploadReceipt [external_request]`；上传不是`staged_write` |
| 19 | `adult.analysis.request` | retain_recontract | `libra.western.analysis.request(WorkerUploadReceipt, AnalysisSpec) → ExternalJobReceipt [external_request]` |
| 20 | `adult.analysis.observe` | retain_recontract | `libra.western.analysis.observe(ExternalJobReceipt) → deferred(retryAfter) | WesternAnalysisResult [pure_observation]`；单次观察、不内部轮询 |
| 21 | `adult.metadata.normalize` | merge | 并入#16，本机与Worker结果先转换为同一`WesternAnalysisVariant`再执行一次规范化 |

### 4.3 Product Metadata and Artifact — 22–28

| # | Historical capability | Disposition | Clean logical contract and boundary |
| ---: | --- | --- | --- |
| 22 | `person.relations.resolve` | split | 拆为`libra.media_cast.resolve(MetadataObservation, PersonProjection) → MediaCastDraft`与`libra.media_cast.commit → MediaCastFact`；People注册/合并由People Management自己的Process完成，Capability不得写People Store |
| 23 | `metadata.sidecar.render` | merge | 与#24合并为`libra.product_sidecar.render(ProductMetadataDraft, sidecarProfile) → ArtifactHandle [workspace_write]` |
| 24 | `series.metadata.sidecar.render` | merge | 并入#23；Movie NFO、tvshow NFO和Episode NFO是同一Renderer效果的版本化Profile |
| 25 | `metadata.image.acquire` | retain_recontract | `libra.product_artifact.acquire(ProductMetadataDraft, poster|fanart) → ArtifactHandle|not_available [workspace_write]`；一次取得一个Artifact |
| 26 | `metadata.artifacts.verify` | retain_recontract | `shared.artifact.manifest.verify(ArtifactHandle[]) → VerifiedArtifactManifest [pure_observation]` |
| 27 | `metadata.publish` | merge | 与#28合并为`libra.product_metadata.commit(ProductMetadataDraft, VerifiedArtifactManifest, Fence) → ProductMetadataFact [domain_fact_commit]` |
| 28 | `series.metadata.publish` | merge | 并入#27；结构差异属于typed Product Metadata，不产生Series专用Fact Owner |

### 4.4 Transcode, output and workspace — 29–39

| # | Historical capability | Disposition | Clean logical contract and boundary |
| ---: | --- | --- | --- |
| 29 | `container.remux` | retain_recontract | `libra.media.remux(MaterialAccessHandle, RemuxIntent) → WorkspaceMediaHandle [workspace_write]` |
| 30 | `media.transcode.precheck` | split | 实际Probe归`shared.material.media.probe`；质量/空间权衡和候选编码路径归Libra Production Planner；Event前输入可用性归`libra.transcode.input.verify`，不在Capability内生成Flow |
| 31 | `transcode.tonemap.accept` | remove_legacy_semantics | 删除伪Approval Capability。Dolby Vision处理必须由Shelf Standard/Acceptance Spec、Planner和Capability参数表达；用户不逐生产手段审批 |
| 32 | `media.transcode` | retain_recontract | `libra.media.transcode(MaterialAccessHandle|WorkspaceMediaHandle, EncodeIntent) → WorkspaceMediaHandle [workspace_write]`；一次Event只执行一种已声明策略 |
| 33 | `output.media.verify` | split | 技术Probe使用Shared Capability；`libra.product_media.verify(MediaProbeEvidence, MediaRequirement) → ProductMediaVerification [pure_observation]`只比较当前Spec |
| 34 | `output.media.select` | retain_recontract | `libra.product_output.select(ProductMediaVerification[]) → SelectedWorkspaceProduct [pure_observation]`；只在Plan预声明候选中确定性选择 |
| 35 | `output.media.disposition` | merge | “是否满足产品要求/是否有收益”并入`libra.product_media.verify`；不再生成replace/discard动作树 |
| 36 | `output.preview.generate` | remove_legacy_semantics | 旧Replace逐步审批已经被Accepted“用户定义Outcome、系统选择Means”取代；未来若产品需要用户预览，必须作为新产品功能重新定义 |
| 37 | `staged.asset.discard` | merge | 与#38合并为`domain.workspace.material.reclaim(WorkspaceHandle, ReferenceEvidence) → ReclamationReceipt [workspace_write]`，由各Domain Reclaimer使用 |
| 38 | `workspace.cleanup` | merge | 并入#37；清理依据durable handle/reference，不依据历史replacement branch |
| 39 | `optimization.outcome.select` | remove_legacy_semantics | 删除旧replace/discard汇合；Product Conformance与Package publication直接表达生产结果 |

### 4.5 External material acquisition / MoviePilot — 40–53

| # | Historical capability | Disposition | Clean logical contract and boundary |
| ---: | --- | --- | --- |
| 40 | `integration.moviepilot.check` | retain_recontract | `shared.integration.availability.observe(IntegrationHandle) → IntegrationEvidence [pure_observation]` |
| 41 | `media.upgrade.identity.resolve` | merge | 与#49合并为`libra.external_material.query.prepare(ResolvedProductIdentity, structureKind) → AcquisitionQuery`；不得重新拥有Product Identity |
| 42 | `source.upgrade.search` | merge | 与#50合并为`libra.external_material.search(AcquisitionQuery) → AcquisitionCandidates [pure_observation]`；single/season为有限参数 |
| 43 | `source.upgrade.request` | retain_recontract | `libra.external_material.acquire.request(SelectedCandidate, WorkspaceDeliveryContract) → ExternalJobReceipt [external_request]`；不保留旧逐Candidate Flow Approval |
| 44 | `source.upgrade.observe-download` | merge | 与#45合并为`libra.external_material.acquire.observe(ExternalJobReceipt, phase) → deferred|AcquisitionObservation [pure_observation]` |
| 45 | `source.upgrade.observe-transfer` | merge | 并入#44；`download|transfer`是同一单次观察合同的有限phase参数 |
| 46 | `source.upgrade.output.resolve` | merge | 与#51合并为`libra.external_material.output.resolve(AcquisitionObservation, structureKind) → ExternalMaterialHandle [pure_observation]` |
| 47 | `source.upgrade.output.settle` | retain_recontract | `libra.external_material.stability.observe(ExternalMaterialHandle) → deferred|StableExternalMaterialEvidence [pure_observation]` |
| 48 | `media.identity.inspect` | retain_recontract | `libra.external_material.identity.verify(StableExternalMaterialEvidence, ResolvedProductIdentity) → IdentityVerification [pure_observation]` |
| 49 | `series.upgrade.identity.resolve` | merge | 并入#41；Season key属于Product Structure输入，不建立第二套identity resolver |
| 50 | `source.season-upgrade.search` | merge | 并入#42；精确Season过滤由Acquisition Query约束，搜索效果不换皮 |
| 51 | `source.season-upgrade.output.resolve` | merge | 并入#46；输出以Manifest-aware `ExternalMaterialHandle`表达，不以单文件/目录分裂Capability |
| 52 | `series.season-package.verify` | retain_recontract | `libra.external_material.package.verify(ExternalMaterialHandle, EpisodeDeliveryManifest, IdentityRequirement) → VerifiedExternalPackage [pure_observation]` |
| 53 | `media.identity.accept` | remove_legacy_semantics | 删除“批准Identity mismatch”伪Capability。Downloaded product不满足确定Identity只能失败；Beta不建设Identity contradiction override |

搜索结果的确定性候选选择需要一个由#42拆出的clean能力：
`libra.external_material.candidate.select(AcquisitionCandidates, SelectionCriteria) → SelectedCandidate
[pure_observation]`。它只依据Acceptance Spec允许的系统Means进行选择，不恢复用户逐种子陪诊。

外部稳定Material进入Libra Production Workspace还需要显式
`libra.workspace.material.import(ExternalMaterialHandle, WorkspaceScope) → WorkspaceMaterialHandle
[workspace_write]`；旧实现曾直接把MoviePilot staging当作可替换源，因此历史62项中没有这条clean边界。

### 4.6 Formal material, layout and publication — 54–62

| # | Historical capability | Disposition | Clean logical contract and boundary |
| ---: | --- | --- | --- |
| 54 | `optimization.objective.verify` | split | 拆为`libra.product.conformance.verify(ProductFacts, AcceptanceSpec)`与Arca各Acceptance检查；Task/Gate Objective不再存在 |
| 55 | `media.file.replace` | split | 不保留“replace”业务动作。拆入Arca fixed Off-load transaction的Target Commit、Stage、Switch、Final Primary Verify和Input Settlement原子效果 |
| 56 | `series.season.replace` | split | 同#55；Season由Product Material Manifest表达，不建立特殊整季Replace路径 |
| 57 | `source.organize` | split | 同#55；Final Inventory Decision决定终态，Arca fixed transaction执行，不存在独立organize动作树 |
| 58 | `metadata.artifacts.materialize` | split | On-deck并入Arca Stage Product；On-deck后修复属于Aftercare Presentation专用Artifact materialize合同，两者权限/Fence不同 |
| 59 | `filesystem.layout.verify` | split | Shared Layout Observation只提供Evidence；Arca Acceptance、On-deck Fulfillment、Aftercare Custody/Presentation分别执行自己的Requirement verify |
| 60 | `series.assets.layout.verify` | merge | 并入Manifest-aware Arca Fulfillment/Inventory verification；single与Season共用Material Manifest合同 |
| 61 | `optimization.result.publish` | merge | 与#62合并为Libra Product Conformance Evidence及`libra.product_package.publish`；不发布Optimize Gate Fact |
| 62 | `series.optimization.result.publish` | merge | 并入#61；Episode Delivery Manifest使同一Package publication支持Season增量Run |

## 5. Clean capability families not represented by the historical 62

历史目录主要覆盖旧Kairox处理内核，不能反向证明clean Helix只需要这些能力。Level 0–6还要求以下
Foundation family；精确拆分和nominal schema由Level 8完成：

| Clean scope | Required family | Why historical catalog did not cover it |
| --- | --- | --- |
| Procurement | Field bounded observation、Physical Material identity、Extraction Eligibility evidence、Triage Claim/Structure、Primary Input Manifest构造与Candidate publication | 旧Catalog从admitted media开始，缺少采购业务 |
| Libra Intake Acceptance | Candidate/Manifest结构验证、Binding建立、Handoff A Accepted Decision与Control transfer提交 | 旧系统没有Procurement → Libra独立责任交接 |
| Libra Decision Preparation | Policy-declared Decision Fact acquisition、User Perception query、People/reference query、Decision Basis readiness commit | 旧Planner在Task内临时读取Store/Provider |
| Libra Production | Product gap/conformance、External Material import、On-deck Product Package publication、Workspace reclamation | 旧Optimize直接替换正式源并发布Gate Fact |
| Arca Shelf Acceptance | Identity、Structure、Metadata、Mandatory Media、Space、Inventory feasibility分别验收并提交Acceptance Decision | 旧系统没有独立甲方验收域 |
| Arca On-deck | Resolve Final Inventory、Prepare Target Commit、Stage、Staged Verify、Placement Switch、Final Primary Verify、Input Settlement、Fulfillment Verify、On-deck Commit | 旧replace/reorg把生产和上架混在一起 |
| Arca Aftercare | Custody、Presentation、Conformance observation及Service Catalogue允许的Domain-scoped repair | 旧maintenanceComplete之后没有独立售后流程 |
| Arca Off-deck | Destruction Scope verify、Primary delete、Related last-reference release、Deletion Evidence与terminal commit | 旧Delete Gate/Offboarding语义已撤销 |
| Arca Shelf Administration | Deregistration Release Manifest verify、Control release与non-destructive terminal commit | 旧系统没有Shelf注销合同 |
| User Perception | Acquisition、normalize、immutable record commit、deduplicate/resolution query | 旧Catalog只把评分当Kairox输入 |
| People Management | Person registration、merge、reference image/face、candidate与preference事实维护 | 旧Capability直接写Kairox Person Catalog |

这些新增family是上游Accepted业务合同的执行覆盖，不是Level 7新增业务域或用户功能。Level 8不得把它们
重新压回一个全局Planner、Store或复杂Executor。

## 6. Representative workflow parity under the clean model

### 6.1 Movie

```text
Libra Decision Preparation
  → product_identity.resolve
  → product_metadata.fetch

Libra Production Plan
  metadata branch: media_cast.resolve → sidecar.render / artifact.acquire → artifact.verify
  media branch: material.media.probe → remux/transcode → media.probe → product_media.verify
  join: product.conformance.verify → product_metadata.commit → product_package.publish

Arca
  Acceptance checks → fixed Off-load transaction → On-deck Commit
```

覆盖普通Metadata、no-op、Remux、Transcode、External Material acquisition和复合生产，不需要Basedata/
Metadata/Optimize顺序Gate。

### 6.2 Series Season

```text
one Season Subject + immutable Episode Delivery Manifest
  → one Product Identity / Product Metadata plan
  → Episode media branches may run independently and concurrently
  → Manifest-aware Season conformance
  → one Product Package for the current non-overlapping Episode scope
  → Arca fixed Off-load by Product Material Manifest
```

历史Season Upgrade blocker已经被clean边界解除：Libra在Workspace生产一个Manifest-aware Season product，
Arca按统一Off-load transaction上架；不再把每个Episode当独立Upgrade Task，也不执行特殊Season replace。

### 6.3 JAV

```text
product_identity.resolve(number)
→ product_metadata.fetch
→ media_cast.resolve
→ sidecar.render + poster/fanart acquire
→ HEVC/Matroska gap plan
→ product conformance
→ Package → Arca Acceptance / Off-load
```

番号是Identity Requirement；Metadata、HEVC、Matroska和空间上限仍完整保留，但不形成Gate链。

### 6.4 Western Adult

```text
local path:
  frames.extract → face.embed → face.cluster → face.reference.match
  → western.poster.render → western.metadata.normalize

worker path:
  worker.asset.register → worker.asset.upload → analysis.request
  → repeated single observation Event Attempts → western.metadata.normalize

common tail:
  media_cast.resolve → Artifact production → media normalization
  → conformance → Package → Arca
```

People Management只提供Person Reference Projection；“这部媒体由谁出演”仍由Libra的Media-Cast处理闭环，
Capability不能顺手注册、合并或修改Person。

### 6.5 Arca Acceptance, On-deck, Aftercare and Off-deck

- Shelf Acceptance只检查Package和Spec，不读取Libra Plan/Event或指定返工Capability。
- On-deck只使用固定事务编译器，不重建adopt/replace/relocate/organize动作树。
- Aftercare拥有独立Planner和Domain-scoped repair Capability；只在当前Inventory内工作。
- Off-deck只有immutable Destruction Scope和Authorization后才能运行删除Capability。
- Shelf Deregistration只运行Control release和终结Fact，不调用删除Capability。

## 7. Effect, safety and performance closure

| Concern | Closure requirement |
| --- | --- |
| Typed API | 每个clean Capability只接收声明的typed inputs/parameters；不得接收整个Task、Config或任意Store |
| Effect Class | 必须映射为`pure_observation|workspace_write|external_request|domain_fact_commit|responsibility_control_commit|material_commit|destructive_commit`之一 |
| Fencing | 每个Event只校验实际Basis slice；external/domain/responsibility-control/material/destructive commit前再次校验 |
| Recovery | workspace output按eventId/digest复用；external effect用receipt；commit用marker；destruction按Scope继续完成 |
| Resource | 每个Event声明Integration、Volume、CPU/GPU、Worker、DB/control等Resource Demand，Permit不覆盖整条Workflow |
| Payload | 视频、图片、Frame、Embedding和Provider大Payload只传handle/checksum/摘要 |
| Metrics | 每个Event采集supply、scheduler、planning、resource、approval、external、execution和commit duration |
| No hidden control | Capability不得写Work/Event状态、追加Graph、调用另一个Capability、内部轮询或宣布业务完成 |

Level 10再通过真实来源和NAS canary设绝对SLA。当前立即失败条件仍是重复commit、Fence绕过、Permit泄漏、
状态振荡、无界Payload、跨Domain写事实或复杂Executor包装。

## 8. Closure and remaining engineering work

### 8.1 Level 7 closure result

- 历史62项业务Capability：`62/62 accounted for`；
- 历史`workflow.blocked`：确定删除；
- 有效Movie、Season、JAV、Western Adult、Transcode、Remux、External Upgrade、Metadata、Artifact、Worker和
  正式Material能力：均有clean去向；
- 原Season Upgrade blocker：由Season Product Manifest + Libra Workspace production + Arca fixed Off-load
  解除，不再需要特殊replace语义；
- 新Business Domain、Owner、Handoff、Authorization或用户旅程分叉：`none`；
- Level 7 Business Decision Register：保持`NO_OPEN_BUSINESS_DECISION`。

### 8.2 Level 8 engineering work reserved

Level 8必须继续完成：

1. 固化clean Capability名称、nominal input/output schema和version；
2. 设计Domain Catalog view、Registry和Executor注入边界；
3. 映射Planner、Runtime、Governor、Material Control Authority和Domain Facade物理组件；
4. 为Arca fixed Off-load transaction、Aftercare和Off-deck补齐物理Capability目录；
5. 审计现有代码每个实现函数的复用、搬迁、拆分或删除，禁止包装旧complex Executor；
6. 移除`allowedTargetGates`、旧Task/Config上下文、`workflow.blocked`和跨Domain Store写入；
7. 形成clean schema、事务、Outbox/Effect Receipt和崩溃窗口合同。

这些是工程安置，不是待用户决定的业务问题。Level 7已在封闭审计通过后标记为`ACCEPTED`，本文现在
作为Level 8输入；它仍不授权实现、E2E、Docker或生产部署。
