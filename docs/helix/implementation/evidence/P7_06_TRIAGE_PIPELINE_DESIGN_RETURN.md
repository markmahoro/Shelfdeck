# P7-06 Triage Evidence Pipeline Design Return

Status: BLOCKED — formal input/output continuity is not implementation-complete

Date: 2026-07-18

## 1. Scope audited

- `procurement.triage.playability.inspect@1`
- `procurement.triage.structure.inspect@1`
- `procurement.triage.identity_claim.resolve@1`
- `procurement.triage.primary_manifest.build@1`
- SSOT §5.3.2–§5.3.6、§8.6.4、§8.6.18–§8.6.20

## 2. Proven gaps

| Contract | Required output | Missing implementable continuity |
| --- | --- | --- |
| Primary Manifest | `1..1024`、ordinal从0连续的`materialKey/role/episodeClaim?/bindingRevision` | `SelectedMaterials`仍是最多4096个key；`Roles`是无成员映射的字符串数组；`Structure.memberClaims`是opaque refs。无法唯一恢复Material→Role→Episode映射和Binding revision |
| Structure | single/season、primary roles、逐Material Episode Claim、Related refs | `MaterialFieldContext`只有opaque Field refs/context digest；没有topology、稳定member relation、Related Evidence或closed deterministic rule |
| Playability | 每个Material的playable和reason codes | Read Handle只提供读取权限；没有typed Probe Evidence、closed reason set、判定precedence和唯一digest basis |
| Identity Claim | claim kind/title/profile/source hints并满足Candidate Readiness | mediaType承载连续性缺失；claim/source hint取值和映射未闭合；不能靠路径/标题推成Canonical Identity |

机器Schema另把`PrimaryInputManifest.members.ordinal`设为minimum 1，与SSOT要求从0连续冲突。

## 3. Forbidden implementation shortcuts

- 不按三个独立数组的位置猜测Material/Role/Episode关系；
- 不旁读`proc_run_materials`补正式Capability输入；
- 不把路径、文件名、标题或模糊相似度提升为Canonical Identity；
- 不私设4096→1024截断、default role、default mediaType或开放reason code；
- 不调用旧Triage/Task Runtime，不引入兼容层或fallback。

## 4. Required architecture closure

1. 四个Capability的exact named input DTO与统一`1..1024`边界；
2. Material→Role→Episode Claim显式映射、稳定排序和digest公式；
3. Structure/Playability的closed deterministic decision contract及typed Evidence来源；
4. Identity Metadata/Claim/Candidate Draft之间mediaType、contentProfile和structure连续性；
5. 现实解析由P5哪个typed port提供，哪些步骤保持pure；
6. 不新增Domain、Owner、Store或Handoff。

## 5. Current conclusion

这是正式输入不能唯一形成正式输出的SSOT合同缺口，不是工程偏好。P7-06保持Design Return；实现线程已把完整问题包发送至架构任务`019f4a67-4a29-7c62-8af5-bf79083226ca`，等待独立评估。P7-05闭合状态不受影响。
