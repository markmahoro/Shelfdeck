# Aftercare Artifact Stage 归属审查（2026-10-29）

本文件为主整合审查证据和**未批准的设计候选**，不修改 SSOT、实际 Schema、事务或代码。`c2e2127e96659a6034b2a25caf52a8528d4bd348` 已证明能处理受控 inode 碰撞，但存在下述外部文件误收编及 Stage 清理缺陷，**不得作为最终候选**。这一结论不改写原完整门禁失败及其现场已清理、当次 inode 原因不可证的限制。

## 真实执行和负例

`arca.aftercare.artifact.materialize@1` 调用 `materializeArtifactWithRollback` 时没有传入恢复分类；首次执行和恢复均走同一 `currentIsSource` 判断。缺失 Finding 已冻结后，如果目标与 Workspace source 字节相同且不是旧 Material Key，c2 在确定 Stage 不存在时直接返回目标身份；若同名 Stage 与目标为同一 inode，则先 unlink Stage 再返回身份。`Effect` 的意图先于执行器创建，不能证明这些文件由它创建。通用 `material_commit` Observer 在无 marker 时返回 `forward_required`，同样不证明已发生的物理写入。

在独立 Linux 文件系统上，两个完整 GETCHU Host 使用 c2 精确源码。夹具在 Case active、materialize Event executing、Effect intended 的时刻，首次目标检查之前创建 286 字节、与来源相同但 inode 不同于冻结旧材料的外部文件；保留旧 inode 的文件描述符保证两者不同。夹具未修改产品代码、未伪造 stat；副本数据库及文件场景均保留。

| 注入现场 | 实际结果 | 结论 |
| --- | --- | --- |
| 仅外部目标 | 原 Host 旅程报告 1 PASS，但外部目标 inode `1935310` 成为新的 Inventory 成员；materialize 与 inventory Event/Effect 均 succeeded/committed，旧 Control released、新 Control 为 Arca Shelf Entry controlled，Case resolved | PASS 是漏洞复现，绝非安全通过 |
| 外部 Stage 和目标为同字节 hardlink | 原 Host 同样报告 1 PASS；外部 inode `1933461` 成为新成员，Control 转移、Case resolved；原 Stage 路径被 unlink | 外部 Stage 被错误清理，是 c2 的新增影响 |

Windows 和 Linux 的真实文件定向负例对上述两种现场均为 0 PASS / 2 FAIL，期望冲突而实际没有异常。生产基线 `a2bf2d6fd3271dc3a3741e28ed42f533a59d99d4` 的精确源码同样为 0 PASS / 2 FAIL：以同字节外部目标冒充成功是既有缺口；c2 对外部 Stage 的 unlink 是本补丁增加的后果。进一步的 Stage-only 真实文件负例在 Windows/Linux 各 0 PASS / 1 FAIL：目标起初不存在，外部预先创建同字节 Stage，c2 将该 inode 链接发布到目标并 unlink 原 Stage。不能只修补“目标已存在”分支而继续接受未经归属证明的 Stage。

本工作区 ignored `.codex/continuity-evidence-20261029/` 保留如下证据：

| 文件 | SHA256 |
| --- | --- |
| `jav-preexisting-target-only-host.log` | `3130585ed2ea59f2f1a4f217d74eb696eebb5c8610701e852490a732a68025c5` |
| `jav-preexisting-target-stage-host.log` | `de68834e1e31569c4a5b809bf12fe251edb036abf0c15e543508154f558a2465` |
| `jav-preexisting-target-only-inspect.json` | `471ad4805cb6c51ac201b5cae768f34b6d4f622f0ef3d6043b8221e75f9d6013` |
| `jav-preexisting-target-stage-inspect.log` | `aa5e9a3d56cc97f7e40b4a502c6c66c28b58aebdb0ce5a449f2f3767f9da9a4a` |
| `jav-preexisting-target-direct-baseline.log` | `2f744e5773294acec63e0b19f88206fc61bc21050b061c58688ca54ad8a461a3` |
| `jav-preexisting-target-direct-linux.log` | `d99f4151d6376f8c8ee5e2ba365bed6884ff9a146917b22aec40b1cdc604789a` |
| `jav-preexisting-target-direct-windows.log` | `de6237a27e89d2077834f32224e23aebcb35fd4748c2a7de4ffb222fdb30aaec` |
| `jav-preexisting-stage-only-linux.log` | `9cde548184b5e8d1459032bffd9f503d16a39b3d2a97afab6584a88a962a696a` |
| `jav-preexisting-stage-only-windows.log` | `78a461b4d3b7f6d338c66b50ac534f922947e3e7e1e4c066752cc912ed0bd53b` |

Host 注入器 `jav-preexisting-target-diagnostic.cjs` SHA256 `435b1bc1396a2c08ab9383d0989faeaf7e3fb97ab0ee5b4d10574e4fe1663a5b`；两份 Host 冻结源码的 Aftercare 文件 SHA256 均为 `58abf334c586704708fdfdc868d884b859e5d148437935290bf8577036599755`。原始诊断输出、完整基线首轮失败及条件复现均不得覆盖。

## 现有合同和不能借用的证据

- SSOT §5.8.2.3/§5.8.2.4：Aftercare 使用当前受控材料、accepted Facts 和已声明来源，安全提交新 Inventory；既有合规 Artifact 不因猜测覆盖。§8.5.6/§7.9.2：material effect 使用精确 Effect Journal、transaction slot/reality 恢复，不能把 intent 当作物理成功。§10.5.3：Slot 未分类不得 GC；未知归属或未分类 Effect 保留。
- `fx_effect_journal` 当前只绑定 attempt、effect class、idempotency key、intent digest、最终 output digest 和状态；它没有目标 Stage 创建者或创建后 inode 的持久记录。`effect_observed`、commit marker 和 Receipt 是效果验证后的事实，不能预先制造。`recoveryDecision=continue_forward` 只能许可按原 Effect 复验，不能自行证明目标是本 Effect 创建。
- Arca 的 `arca_staged_manifest_records` 是现有不可变 Stage Evidence，但 `createStagedManifestStore.save` 只接受 `arca.inventory.product.stage@1`（含 Aftercare placement）及 JAV Correction Stage；`StagedInventoryManifest` 的 `sourceMaterialKey` 必须命中来源 Product member。单次重新取得的缺失 Artifact 不是该合同中已声明的 Product member，不能改造 digest、伪造 member 或仅放宽 producer 检查来塞入。Aftercare Workspace Registry 的 Handle 又必须在已登记 Workspace 根内；Shelf Target Stage 不能借用该 Registry。
- `fx_event_result_bindings` 的最终 Result 不存在于物理写入之前；把 `fx_event_progress`、Acceptance Evidence 或其他字段改作 Stage 身份会改变其 Owner/语义。既有一次性 `MaterialEffectReceipt` 在物化成功后形成，不足以区分它形成之前已存在的外部目标。

## 审查候选：Arca-owned 两份不可变 Evidence

以下是可执行粒度的候选设计，名称/DDL/事务均待主整合对照合同判定。它保持 Arca 为唯一业务 Owner，Foundation 只验证自身事实和保存自身 Effect/Result；不增加跨域写入、Control owner、全局媒体 ID、Libra 状态或额外收藏。仅适用于精确匹配 `custody:artifact_missing` 与目标 kind 的 `presentation:*_missing`、且冻结旧 Inventory 成员明确存在的 Artifact；其他 Aftercare 路径不因本方案放宽。

1. `ArcaAftercareArtifactStageEvidence@1`，在真实 Stage 已由本次执行独占创建、完整写入并验证后、正式目标发布前持久化。建议字段全部必填、closed object：
   - `schemaRef/schemaVersion/evidenceId/evidenceDigest`；`evidenceDigest=SHA-256(JCS(除自身外的完整对象))`。`evidenceId=SHA-256(JCS({schema:"arca.aftercare-artifact-stage-evidence-id@1",effectId,targetLocationDigest}))`；相同 effect/target 只能有一条，不相同内容不得覆盖。
   - `shelfEntryId/shelfId/aftercareCaseId/careBasisDigest/careRequirementDigest/inventoryRevision/standardRevision/placementRevision`、`artifactKind`、精确 finding pair 摘要、冻结旧 `PhysicalMaterialIdentity@2` 及其 Inventory location/binding revision；冻结原 Control projection digest/revision。它们只作当前 Case/Control 围栏，不转换或释放责任。
   - `workId/workAttemptId/planId/eventId/eventAttemptId/capabilityRef/contractVersion/effectId/effectClass/idempotencyKeyDigest/intentDigest/inputSnapshotDigest/fenceSnapshotDigest`；effectClass 固定 `material_commit`，capability 精确为现有 Artifact materialize；原 Attempt 及 Effect 贯穿重启。摘要必须取已有实际 Foundation 记录并交叉验证，不从调用者字符串单独推定。
   - 目标 `endpointId/mountScopeId/mountScopeRevision/rootLocation/rootRevision/targetRelativeLocation/stageRelativeLocation/targetLocationDigest`，以实际 Shelf Target 和已声明可控 Slot 的规范化相对路径表达；提供 root identity/containment 围栏，不将 Workspace root 当 Shelf root。Stage 路径与 exact Effect 和目标绑定；它不是可凭名字推定归属的公开临时文件。
   - 已验证源 `artifactHandleId/artifactHandleDigest/sourceResultWorkId/sourceResultEventId/sourceResultDigest/sourceFullSha256/sourceSizeBytes/sourceProvenanceDigest`；指向本 Case 下实际已登记的 Artifact 与成功 Result，不保存 Secret、原图片或凭空构造 Product Manifest。
   - 独占创建所得 Stage 的完整 `physicalIdentity`、`fullByteSha256`、`sizeBytes`，以及 `creationStat{dev,ino,size,mtimeNs,ctimeNs}`；大整数按十进制字符串、时间单位明确为纳秒。身份证据取实际文件，不修改 `PhysicalMaterialIdentity@2` 的公式；Full SHA 用于精确源字节证明，不取代有界物理指纹。
2. `ArcaAftercareArtifactPublicationEvidence@1`，在 Stage 和目标真实为已登记 Stage 的精确别名、完整目标现实校验后持久化，仍不代表 Foundation 的 Effect 已 committed。字段至少有 `publicationId/publicationDigest/stageEvidenceId/stageEvidenceDigest`、相同 Case/Work/Event/Attempt/Effect、目标快照与 Identity/完整 SHA、完整确定性 `MaterialEffectReceipt` 及其 digest、完整 `EffectReceipt` 及其 digest。唯一键为 `effectId`；相同键不同内容冲突。

第二份记录解决现有 Event Runtime 的另一窗口：`effectJournal.settle()` 在 `completeCommittedEffect()` 之前，因此 marker 可能已经存在但 `fx_event_result_bindings` 尚未保存 Result。发布 Evidence 必须能重建原封不动的完整 Outcome 和 Receipt，或以其他已确认的原子方案绑定它们；只存一个 digest 不够。时间字段应使用稳定的原 Attempt 时间或第一次持久化的确定值，恢复不得取新的 `now()` 重写 Receipt。原 `MaterialEffectReceipt` 的 schema、下游 Inventory/Control commit 仍须按当前合同单独复验，不能把 Stage/Publication Evidence 当作已入藏。

### 建议 DDL 与事务边界

候选表可分别命名 `arca_aftercare_artifact_stage_evidence` 与 `arca_aftercare_artifact_publication_evidence`：均为 Arca-owned append-only；以 evidence/publication ID 为 PK、`effect_id` UNIQUE，后者以 `stage_evidence_id` UNIQUE 引用前者；Case/Entry 可使用 Arca 内部 FK。完整 closed JSON 与独立 schema ref/digest 持久化，热列保存 Case、Event/Attempt/Effect、target、physical material key、source digest 和时间以支持精确索引，JSON 与热列逐字段重验；每份上限拟为 64 KiB。不得建立 Foundation 指向 Arca 的 FK，也不得把 Arca JSON 写入 Foundation owner 表。最终列、DDL、manifest、source map 与 retention/reset 保护须经主整合确定，不把本草案当已批准 Schema。

Stage Evidence 首次写入使用一个 UOW：Foundation participant **只读**检查 exact running Work、executing Event/Attempt、非终态 `material_commit` Effect 的 ID/class/idempotency/intent 和原输入/fence 摘要；Arca participant 只读检查 active Case、冻结 Basis/required findings、当前 Shelf/Inventory/Reservation、registered source Handle、目标挂载及 Control projection，再只向 Arca Evidence 表 insert。Stage 文件仍由本执行持有打开的描述符；先独占创建、写入并 `fsync`/完整字节验证，入事务前和插入点核对非 symlink 父路径、descriptor 与路径同一稳定 stat、源和 Case fence。每个读集合/事务 owner 与实际平台 Port 应单独确认，不能让 Arca 直接写 Foundation。已存在同一 Evidence 时只重放逐字段一致的原记录；绑定冲突或观察不可用则保留现场。

若仅当前执行独占创建的 Stage 与冻结旧 Material Key 碰撞，允许在该原 Stage 描述符持续打开、路径与描述符仍为同一稳定文件且 Case fence 有效时重建，再对新 Stage 复验并形成 Evidence；外部预先放入的 Stage 不享有此权限。文件 `fsync` 不自动证明父目录项在断电后持久；目录同步能否由目标平台支持须单独验证。若重启后 Evidence 存在而 Stage 丢失或不可观察，按未知现实停止，不伪称阶段已完成。

Publication Evidence 的 UOW 同样只读重验相同 Foundation Effect、Arca Stage Evidence/Case/Inventory/Control 与实际目标，写入 Arca 的精确 Publication Evidence；随后正常返回原 material Effect Outcome，由 Foundation 自己 settle 并完成 Event。Inventory/Control 原事务必须读取同 Effect 的有效 Publication Evidence、已提交的 Foundation Result/marker 和新目标真实身份，再维持现有 old release/new acquire 的全有或全无；Evidence 自身不写 Inventory 或 Control。若实现将此读围栏加入既有原子事务，须更新该事务的准确 read set/manifest，而不是假称事务未变化。

### 物化、中断与外部冲突

候选执行顺序如下；任何阶段不允许以同字节、同 inode、路径命中、Intent 或 `continue_forward` 单独证明归属：

| 中断/现场 | 可证明的事实与候选动作 |
| --- | --- |
| Intent 之后、独占创建 Stage 之前；Stage 和目标都经可观察性检查确实不存在 | 原 Effect 可按其围栏继续创建；不存在不是已经发布的 Receipt |
| 首次执行前目标已存在，无论相同字节与否，且没有本 Effect 的 Publication/Stage 证明 | 明确拒绝、保留目标；不得创建成功 Receipt、替换 Inventory 或释放旧 Control |
| 首次执行前 Stage 已存在，或目标与 Stage 预先为同字节 hardlink，但没有 exact Stage Evidence | 明确拒绝并保留两条路径；目录名、可预测路径和别名关系都不是创建归属证明 |
| 执行器 `O_EXCL` 创建 Stage 后、Stage Evidence 持久化前 crash | Stage/部分文件可能是本 Effect，也可能是外部占位；归属未知，保留原路径与未分类 Effect，不删除、收编、假报 no-write 或仅凭完整字节继续。如何安全清理/重新建立此窗口需明确的恢复合同，不以 Reset 隐藏 |
| Stage Evidence committed、目标未发布 | 重新核对原 Effect/Case、已记录 Stage 物理证据及源/路径，目标仍不存在才可继续排他发布；目标或 Stage 被替换、不可读、根/Control 漂移则停下并保留 |
| 排他发布成功、Publication Evidence 未提交 | 持久的 Stage Evidence 加仍存在且稳定匹配的同 inode Stage/目标别名及当前源/Case fence 才能按原 Effect 复核并形成 Publication Evidence；不同 inode/不同字节/缺失或未知状态不得推断完成 |
| Publication Evidence committed，但 Foundation settle/Result 尚未完成 | 原 Effect/Scope 与完整原 Outcome/Receipt 逐字段核对，重放同一值；若 Effect marker 已 committed 但 Event Result 尚缺，不能因只剩 digest 而构造不一致的 Receipt |
| Effect/Result 和 Inventory/Control 已 committed、Stage 尚在 | 由独立声明的清理责任核验当前 Inventory 与本 Case 的提交连续性、持久 Evidence 和稳定同 inode 别名，只 unlink 精确 Stage；目标和其他链接不动 |
| Stage 已清理后 crash，Effect/Result 与清理前置均持久可证 | 按原 committed Result/marker 及实际目标重新验证；原 Receipt 精确重放，不生成第二份 Inventory/Control。清理的 `already_absent_observed` 只表示当前缺失，不伪称本次执行了 unlink |
| Stage 缺失而 Effect 未 committed，或目标/Stage 被全部移除并以相同 inode/字节重建 | 不凭历史 inode 或指纹推断连续性，保持未分类；Stage 持久锚或可用的文件系统 generation 证据若无法证明连续，禁止认作成功 |

成功 materialize **不得像 c2 那样在取得 Foundation 成功证据前清掉最后的 Stage 锚**；否则 Stage 已无、Receipt 未持久时，外部相同字节目标与本次发布在现有证据中不可区分。目标首次发布须使用真实不覆盖原子操作，`EEXIST` 不能降级为覆盖；c2 的同目录 hardlink 依赖不是现有 Shelf atomic-rename 探针保证，CIFS 资格仍须独立验证。实际是否存在能保留该保证的其他已批准原子接口由主整合判定。

清理应由明确登记的 Arca Effect/Work 负责，在现有 §10.5.3 允许的 Inventory/Aftercare Commit 后运行，输出 typed 清理 Result/Receipt 并可按同一 Effect 重放；候选只删除经 `stageEvidence + publicationEvidence + committed result + current target` 共同证明的 Stage 冗余链接，不删除目标、源、未知 Stage、父目录或任何其他收藏成员。首次缺失及中断后缺失如何表达 `already_absent_observed`、何时允许 Case resolved、清理 Effect Class 和失败 attention 路径都需要被明确注册；不可偷偷复用只覆盖其他资源的 Settlement/Workspace reclaim 授权。若当前目标不再匹配，禁止 unlink 可能是最后链接的 Stage，保留现场。

上述 stat 快照必须在每次读取/删除前后稳定复验。hardlink 本身会改变 ctime，不能将创建时 ctime 误当发布后不变；恢复需证明同一个仍受控的锚、已持久 Publication 或可证明的文件系统 generation。若外部能删除全部锚并重建同 inode/同字节，现有 `inode + bounded fingerprint` 公式无法单独证明连续，应停止而不是制造更强结论。真实 NAS/CIFS 的 inode、unlink-open、hardlink 和元数据一致性仍未知。

## 合同差异和待审查问题

此候选将引入 Arca-owned Stage/Publication 两个 typed application evidence 及持久记录、对应 UOW 读写集/DDL/manifest、专门的 material-effect reality observer、精确清理 Effect/Result 及其 Case 收口依赖；还需确认 raw material Effect Receipt 时间/重放、Inventory Commit 新增只读证明、Schema/contract 测试和停止态发布/升级资格。它不宣称现有合同已经授权这些变更，也不改变已确认 SSOT。主整合应先判断这些属于已确认 Arca 内证据细化，还是涉及需用户确认的对象/事务/副作用授权边界；尤其是预 Evidence 中断时可接受的 attention 与未知 orphan 处理，不能以“原 Effect 存在”自动认领。

验收至少包括：三个外部真实文件场景、真实旧 inode 复用且相同字节、Stage Evidence 伪造/跨 Case/Effect/Attempt/源或路径、Target Slot symlink 和 Fence 漂移、目标并发出现、Stage/目标全删除后同 inode 重建、source 或文件不可观察、每个物理/DB/marker/Result 交界处进程退出后重放、清理前后原视频/NFO/其他图片和所有非目标 Control/Inventory 不变、唯一新旧 Control、重复提交一份 Receipt、Windows/Linux 和真实目标 CIFS。完整 Host 及最终固定候选的全门禁、NAS 发布及七条线上恢复仍由主整合处理。
