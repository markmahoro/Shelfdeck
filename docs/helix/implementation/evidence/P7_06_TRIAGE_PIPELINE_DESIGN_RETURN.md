# P7-06 Triage Evidence Pipeline Design Return

Status: CLOSED / IMPLEMENTED — PBF-10 accepted and P7-06 machine evidence PASS

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

## 6. Architecture closure audit

Architecture Agent提交`48d6cac5`（PBF-10）已经逐项闭合四条断链：

- `TriageMaterialProbeBatch`把Run Selection、Binding、admitted Control、Read Handle和Media Probe Evidence逐成员绑定；
- `TriageStructureInspectionInput`完整携带Selection、Probe/Playability、Field Context、Layout Evidence和page request；
- Playability及Structure使用closed rule、reason precedence、digest和64 KiB/page边界；
- `TriageUnitSnapshot → IdentityClaim / PrimaryInputManifestDraft → CandidateDraft`保持mediaType、contentProfile、
  role、Episode Claim和Binding连续；
- final `PrimaryInputManifest`成员为1..1024且ordinal从0；
- 只新增一张Procurement-owned N:M Episode Claim关系表，没有新增Domain、Owner、Store、Handoff、Capability或跨域写入。

实现线程只读复审为PASS，SSOT文件blob精确等于Architecture Agent提交，未由本线程编辑。

## 7. Materialization and implementation evidence

| Evidence | Result |
| --- | --- |
| SSOT source map | 112 Capability / 96 Result Family / 163 table / 30 transaction；`6fc73544…` |
| P2 aggregate | `fe383269c415f6ca1f8c293018abf625e9db9fed6a02fb185ceace03fa02cfc5` |
| Type graph | 199 refs；0 unresolved |
| Ordinal correction | generated `PrimaryInputManifest.members[].ordinal.minimum = 0` |
| Triage focused fixtures | Playability、Series N:M Episode、Identity/Profile continuity、Manifest digest与禁止Store/legacy dependency PASS |
| Full architecture gate | 567 tests；83 fixture files；85 source files / 125 dependencies；1514 semantic files；all PASS |
| Prohibited actions | `[]` |

未运行Service、E2E、Docker、Canary、生产、真实Provider/Field/媒体副作用；未修改`media-desktop`。
