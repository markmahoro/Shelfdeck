# P8-02 Libra Intake Store Design Return

Status: OPEN / RETURNED_TO_DESIGN

## 1. Candidate Delivery输入不闭合

SSOT §8.4.2要求Libra通过`CandidateDeliveryPort`读取Candidate，随后为全部Primary成员建立Binding并转移Control。当前正式
`ProcurementCandidateOfferAvailableMessage@1`只携带Package identity/digest；`CandidatePackage@1`只携带
`primaryInputManifestRef{manifestId,manifestDigest,memberCount}`，不含Manifest成员；`PrimaryInputManifest@1`虽有成员、role、
Episode Claim和Control Evidence，但没有Primary `endpointId/location`。`libra.intake.binding.resolve@1`却要求
“Candidate material/location evidence”，`LibraBindingDraft`和`libra_material_bindings`都强制endpoint/location。

缺失正式输入：

- `CandidateDeliveryPort.deliverCandidatePackage`的versioned input/output DTO；
- exact Offer/Package/full Primary Manifest的同一snapshot continuity；
- 每个Primary成员的可验证endpoint/location来源、revision/digest及大小边界；
- Delivery snapshot总digest和重放语义。

Libra不能旁读`proc_candidate_primary_materials`、`proc_run_materials`或`proc_field_materials`补值。

## 2. N:M Episode范围无法持久化

`PrimaryInputManifest.members[].episodeClaims`允许`0..32`，一个multi-episode Material可以对应多个Episode。当前：

- `LibraBindingDraft.bindings[]`每项只有单个nullable `episodeKey`；
- `libra_material_bindings`只有单个`episode_key`；
- 其PK为`(subject_id,material_key,binding_revision)`，同一Material/revision不能保存多个Episode row；
- front-half没有Subject↔Episode accepted scope关系表。

因此无法无损建立Production Material Binding，也无法重建FA-04所需的current Subject Episode集合和
`episode_overlap_digest`。选择第一个Episode、拼字符串或复制binding revision都会改变业务事实。

## 3. FA-04并发CAS没有承载点

Handoff A Accepted transaction声明`domainRevisionFenceRequired=true`，并要求continuity match与Episode overlap在并发变化后重算。
但`libra_subjects`没有Subject/Intake state revision或accepted-scope head；`AcceptedIntakePayload.revision`没有定义对应哪一行，
也没有expected target Subject revision/digest。两个extension可读取同一旧Episode集合后同时通过zero-overlap并提交相交范围。

需要正式的Subject Intake head/revision、完整claim+episode set digest、expected revision/state及CAS更新参与表；或等价的、可由机器
事务唯一执行的正式Fence合同。

## 4. Resolved Identity anchor不可枚举

FA-04允许Candidate claim匹配Subject已接受claim，或current Resolved Product Identity中的exact provider-season anchor。
`libra_product_identity_revisions`只有`provider_identity_set_digest`，没有relationized provider namespace/key/kind或可读取typed
snapshot引用。Digest不能反推出anchor集合，现有Store无法执行该匹配。

需要正式anchor事实来源、Owner、revision/digest、查询输入输出与持久化连续性；不能把display identity、标题或opaque digest当anchor。

## 5. Subject初值与Accepted Decision authority未闭合

- `libra_subjects.current_identity_revision`是指向`libra_product_identity_revisions`的current pointer，但Handoff A Accepted写集不含
  identity revision；new Subject在尚未完成Product Identity Resolution时应写什么值未正式说明。机器table contract标为non-null，
  当前DDL却实际允许NULL，二者也不一致。
- `AcceptedIntakePayload`只含`candidatePackage,bindingDraft,subjectId,controlScopeDigest`，没有Offer/
  `acceptanceBasisDigest`、FA-04 matched set、episode overlap、`new_subject|season_extension` discriminator、target expected revision/state
  或Decision digest。直接接受调用者给出的`subjectId`会把Libra-owned continuity decision authority交给调用者。

## 6. Required closure

请Architecture Agent独立评估并在SSOT中闭合：

1. versioned Candidate Delivery snapshot与Primary location Evidence；
2. multi-Episode Subject/Binding关系模型及overlap digest公式；
3. Subject Intake revision/head和accepted transaction CAS write set；
4. Resolved Product Identity exact provider-season anchor的typed可枚举事实；
5. new Subject identity pointer初值；
6. 完整Intake Resolution/Accepted payload与Decision持久化输入输出。

在闭合前，P8-02不建立Libra Store，不引入跨Store read、opaque JSON补丁、兼容层或旧Runtime fallback。
