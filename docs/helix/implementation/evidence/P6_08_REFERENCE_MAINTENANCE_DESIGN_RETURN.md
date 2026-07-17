# P6-08 Reference Maintenance Formal Realizability Design Return

Status: `OPEN / SSOT CLARIFICATION REQUIRED`

Date: 2026-07-17

本文件只记录实现停线证据，不修改或替代SSOT。

## 1. Proven contradiction

SSOT同时要求：

1. §6.8.3、§8.2.5、§9.4.9：People维护Reference Image/Face，用户可添加/删除两者；
2. §8.5.13：`people_reference_assets`必须保存独立`reference_asset_id/person_id/artifact_handle_id/artifact_digest/state`，
   `people_reference_faces`必须保存独立`reference_face_id/person_id/reference_asset_id/embedding_handle_id/model_ref/state`；
3. §8.6.14：唯一Reference fact提交Capability是`people.reference_fact.commit@1`，输入写成
   `Verified reference asset + DomainFactCommitHandle`；
4. 当前由SSOT物化的closed input把`Verified reference asset`精确绑定为通用`ArtifactHandle`。该Handle只有artifact identity、
   owner scope、storage ref、digest、size/media type和provenance，没有`referenceAssetId`、Reference state、Face identity、
   source Reference Asset、embedding handle或model ref；
5. §8.6.19要求Result返回完整`referenceAssetIds[] + referenceFaceIds[]`，但现有输入不能确定新建/变更哪一个Face；
6. public合同只有`addReferenceAsset/releaseReferenceAsset`，没有与§9.4.9“添加/删除Reference Face”对应的closed command。

因此实现无法在不发明业务ID、默认state、Face来源和删除语义的情况下，同时满足Capability input、两张表和UI行为。
使用`DomainFactCommitHandle.handleId/factId`冒充`referenceAssetId/referenceFaceId`，或让Store旁读Workspace/Artifact Registry，
都没有SSOT授权并会破坏clean boundary。

## 2. Architecture Agent needs to close

请在SSOT中明确一个closed Reference Maintenance Decision/Commit DTO（名称由Architecture Agent决定），至少能区分：

- operation：asset add/release 与 face add/release（或等价closed discriminator）；
- `personId`及expected Person/reference projection revision；
- asset add：稳定`referenceAssetId`、exact verified `ArtifactHandle`、initial state；
- face add：稳定`referenceFaceId`、exact source `referenceAssetId`、embedding handle、`modelRef`、initial state；
- release：exact target ID、expected current state/revision及终态；
- Result revision的明确aggregate/revision basis，以及Asset/Face集合如何计算；
- Merge后source-owned Reference通过correlation查询时，Projection是否展开到target，以及其revision/digest basis；
- People Command Facade对Face add/release的正式named methods，或明确Face完全由哪个现有命令表达。

然后同步修正§8.6.14 Capability input summary、§8.6.20 input schema约束、必要的Result/Facade合同。无需改变Owner：People仍是
Reference Fact Owner；Artifact/Workspace仍由Platform/Foundation提供handle，二进制不得进入People DB。

## 3. Implementation state

P6-07已PASS且不受此问题影响。P6-08未写入推测性实现；现有底层可复用能力包括P5 Artifact/Workspace/Material Access handles、
P4 workspace-write recovery、People两张Reference表及P3 Domain Commit Coordinator。

本线程未修改SSOT、`media-desktop`，未运行E2E/Docker/真实媒体/生产动作。
