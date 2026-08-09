# P8-03 Candidate Delivery Design Return

Status: BLOCKED BY SSOT PERSISTENCE CONTINUITY

Date: 2026-07-19

## 1. Required output

SSOT §8.2.1、§8.4.2和§8.6.18要求`CandidateDeliveryPort@1.readSnapshot(CandidateDeliveryQuery@1)`返回
`CandidateDeliveryReadResult@1`。found结果必须包含完整、immutable、digest闭合的`CandidateDeliverySnapshot@1`；其中包含
完整`CandidatePackage@1`，Offer关闭后仍可historical read。

## 2. Proven missing persistence input

`CandidatePackage@1.relatedReferences[]`中的每项要求：

- 完整`PhysicalMaterialIdentity@1`：`materialKey,mountScopeId,inode,fingerprintAlgorithm,contentFingerprint`；
- `endpointId,location,checksumAlgorithm,checksumHex,associationEvidenceDigest,referenceDigest`。

但`proc_candidate_related_references`只保存：

`candidate_package_id,reference_id,primary_ordinal,role,endpoint_id,location,checksum_algorithm,checksum_hex,evidence_digest`

缺失`identity.materialKey`、`identity.mountScopeId`、`identity.inode`、`identity.fingerprintAlgorithm`、
`identity.contentFingerprint`和`referenceDigest`。checksum不能反推mount scope、inode或material key，也无法在缺失完整identity时重算
`referenceDigest`。因此发布后无法从正式Procurement Owner rows重建完整Package、验证`relatedReferenceSetDigest`和`packageDigest`。

## 3. Rejected implementation shortcuts

- 不从Libra旁读`proc_*`或其他Store补值；
- 不读取`fx_event_result_bindings`把Foundation Result变成隐藏Business Store/fallback；
- 不读取current mutable Field row修补immutable Candidate；
- 不以checksum、referenceId或数组位置伪造Physical Material Identity；
- 不使用opaque JSON、legacy Store、compatibility或old Runtime fallback。

## 4. Required architecture closure

需要Architecture Agent明确完整Related Reference事实的正式持久化落点与重建合同，并同步Candidate Publication原子写/crash
合同。若扩展既有关系表，应保持Procurement Owner且通常不改变168-table inventory；任何其他方案必须同样证明Owner、historical
read和digest连续性，不得引入隐藏Store或跨域依赖。

另有一个不阻塞架构的机器传播问题：P7 public port artifact仍使用旧`deliverCandidatePackage`，且机器registry尚未物化
`CandidateDeliveryQuery/ReadResult` schema；待上述持久化合同闭合后由实现线程按现有SSOT修正。

本线程未修改SSOT，未运行任何外部环境或真实媒体副作用。
