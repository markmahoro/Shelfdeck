# 目录 Observation 正式接线合同差异提案

这是演员线程的合同审查 Evidence，不是另一个活动计划，也不是已修改的架构 SSOT。唯一 SSOT 及共享生成物仍由主整合线程统一维护；本文件给出精确缺口与最小传播范围，不能据此提前开启生产能力。

## 既有确认与机器合同缺口

用户已确认视频识别主路使用内置 buffalo_l/离线目录，Libra 决定一片一演员，People 按内部 personId 唯一复用/建档，保留人工入口并退役推荐认领；性别不影响资格或排序。现有 SSOT 末尾 2026-10-29 补充、8.6.18 的 UsAdultCatalogueAnalysisBasis/FaceCatalogueGeneration 已覆盖该方向。

现有 8.6.6 **没有**目录 Observe Capability；8.6.18 WorkspaceArtifactOutputTarget 只有 frame_set/western_analysis；Workspace Product Port 的 Artifact kinds 亦未包含目录 Observation。现有 FaceClusterSetHandle 只描述技术分组，PersonMatchEvidence 要求真实 People Reference，不能把外部目录 UID 假装 personId 或伪造旧 automatic_match。

Foundation 的 fx_event_result_bindings.result_json/evidence_json 均为 64KiB。完整有界目录 Evidence 可达 8MiB，必须放到独立 Workspace Artifact；不扩大 Foundation JSON、不复用旧 western_analysis payload，也不让 pure_observation 中途写文件。

## 建议补入唯一 SSOT 的目录 Observe 原子合同

8.6.6 新增一行：

| Capability ref | Input → Output | Effect Class |
| --- | --- | --- |
| `libra.us_adult.catalogue.observe@1` | `UsAdultCatalogueAnalysisBasis + UsAdultCatalogueCompletedBatchSet + WorkspaceArtifactOutputTarget → FaceCatalogueObservationHandle` | `workspace_write` |

只在 Libra 当前 Run 的受控 Workspace 产生一份完整技术 Observation；CPU/索引负责技术查询，Libra 后续再应用自己的资格策略。它不读写 People、不确认出演、不写 Arca、不读原视频、不请求外网、不补充任意本地路径权限。

8.6.18 新增/扩展：

| 类型 | 精确边界 |
| --- | --- |
| `UsAdultCatalogueCompletedBatchSet` | closed accepted-business-dto，≤64KiB；schemaRef/schemaVersion、analysisId/libraRunId/basisDigest、mode(initial/initial_and_supplement)、有序 batches、setDigest。每批保存 stage/batchDigest/workId、完整 FrameArtifactSet/FaceEmbeddingSetHandle/FaceClusterSetHandle，以及三个实际成功 Result 的 work/attempt/plan/event/result/capability/schema/resultDigest/inputBindingDigest。按唯一 frozen batch Work 重建，不能接受调用者任选 Handle 或丢失 no-face 帧。 |
| `FaceCatalogueObservationHandle` | closed typed Result，≤16KiB；schemaRef/schemaVersion、analysisId/libraRunId/workspaceId/runExecutionBasisDigest/basisDigest、mode/completedBatchSetDigest/observationSourceSetDigest、modelRefDigest/catalogueGenerationDigest/searchPolicyDigest/clusterParameterDigest、resultKind(observed/no_faces)、frame/face/group/query counts、observationDigest、observationArtifactHandle、handleDigest。nested Handle 必须为同 Run/Workspace 的 active face_catalogue_observation Artifact，真实字节摘要与 Registry 匹配。无 Person/出演/collection 标记。 |
| `WorkspaceArtifactOutputTarget` | outputKind 增加唯一 closed 值 face_catalogue_observation；沿原 targetId/effectScopeDigest/targetDigest 公式，由 Libra 用完整 Basis/CompletedBatchSet 编译 sourceInputDigest 与唯一 root-relative 路径。Executor 不选目录，不扩大 root。 |

Artifact kind 新增 `face_catalogue_observation`，closed payload 为 `shared.buffalo-catalogue-observation@1`，最大 8MiB，所有完整原始代表查询结果、别名、目录验真 proof 和帧/特征关联均保留。数据超过上限明确失败，不静默截断、回退为 no_match 或写半份 Artifact。

新 Handle 的来源、大小和内部 observationDigest 由实际 bytes 验证。后继读取只允许原 Result 指向的 Artifact；历史 Handle 可读不等于当前执行资格，Run/Workspace/目标/人工选择竞争另沿 Owner 当前资格核对。

## Work、恢复与资源

- 首轮目录 Work 依赖初轮 Frame Work 的成功结果；补采只在首轮完整目录评估仍未合格且有剩余采样点时由 Libra 准入。第二轮目录 Work 同时依赖首轮目录 Work 和补采 Frame Work，按两批全部特征重新分组。
- `workId/executionBasisId/idempotencyKey` 绑定 Basis、mode、全部精确 producer Result 和策略；迟到 Result、错 Run/目录/模型/批次不能借旧 Work 前进。目录更新不改写已冻结 Basis。
- 一个目录 Event 只产生一个 Observation Artifact，沿现有 scoped Workspace Effect/恢复/校验机制；中断后复用同一 verified Artifact，不再查询索引后改写旧输出，不伪造 Receipt。
- 每批 frame/embedding/cluster 的累计 quota 为 `(maximumWorkspaceBytes - 一张代表图上限 - 两份Observation上限)/2` 向下取整。保留最终代表图及两次 Observation 空间。Resource/Control-plane/停止资格仍须真实共载验证，当前技术模块测试不是 Runtime Permit 或生产资格。
- 不新增表、Canonical Transaction、Domain、全局媒体 ID、独立服务或 Worker authority。保留规则仍从 Arca Commit 和各 Owner 的精确依赖出发，不能因新 Handle 是 opaque JSON 就漏掉必要 Artifact。

## People 与出演后续必须明确的边界

这些是 Phase 5 后续接线的审查清单，不在本提案中给未定义接口直接写入权限：

1. 目录技术 Observation 只产生外部身份/姓名 Evidence；Libra 资格评估后才请求 People。People 通过自身公开姓名解析/注册，内部 personId 保持真值；TPDB ID 仅为可选 Provider 资料。
2. 自动来源不能伪装成 user_choice 或旧 Reference automatic_match。Actor Selection 增加明确的目录来源 variant，携带完整技术来源、Libra 评估和 People 精确版本快照；现有人工选择优先，仍只有一条演员关系。
3. 姓名/别名优先精确，其后只做已冻结的轻度拼写匹配；同名歧义不随便合并。TPDB 无可靠唯一资料时按已确认策略用选中人脸的代表图建档，不借另一人的资料，也不把“查不到TPDB”写成“视频没有演员”。
4. People 自动提交在自己的事务中重核当前人物事实；Libra current Run/choice/目标资格通过公开 Projection 和 Foundation opaque read fence 验证，禁止在 People 事务旁读 Libra Repository。两片并发建同名演员须在 People 复查/复用，同一任务重放不能重建人物。
5. 自动人物已提交后人工改选，Libra 的当前手选优先，不能倒删有效 People 身份；未提交自动请求遇到手选则停止。元数据/Reference 准备不构成出演事实，只有 Libra 发布 Cast 后进入正常生产/Arca 验收。
6. People 原图/新 buffalo_l Reference/来源证据须有完整保留与回收声明。人物可能在影片未 Commit 时已创建，Fresh Reset 不能为了清未入藏 Run 丢失仍被 People 身份需要的证据，也不能为此保留整个 Subject 的所有旧任务。优先采用 People 自身可独立保留的来源 Evidence/Artifact，明确引用闭包后再实施。
7. 主路及本地 Reference 备用统一512维；旧128维历史只读，不补维、不继续执行 SFace。所有新图片/特征沿正式 People 准备/发布，新模型的运行/更新和已提交收藏保护必须验证。

## 传播及验收范围

主整合确认上述合同后，局部 builder/schema functions 传播到唯一 SSOT、Capability/Result inventory、domain input/result schema、Artifact/output-kind 明确枚举及具体值校验；需要 1 个新增 Capability/Result family，表/事务数量不变。不能只在测试副本放宽 schema 后把正式分支记为可部署。

对应验证：实际 Work→Plan→Event→scoped Workspace Effect→durable Result→Owner 读取/重放；初/补两轮、no-face/有效无候选/歧义、错误代际/来源/模型/人工竞争、Artifact 已落盘进程退出/取消/迟到回执、同输入幂等及两项 quota；真实 CPU+索引共载、HTTP 控制面、停止/4K/SMB与独立视频真值。之后才接 People/Cast/唯一 Commit。当前 NAS 暂停不豁免这些门槛。


## 可审查的提案副本与验证

本线程只新增局部 schema functions、CompletedBatchSet 纯编译/验证及本文件。**未改动当前工作区的共享 SSOT、builder、全局 generated contract 或 Workspace kind 枚举**。在 ignored 独立 catalogue-contract-proposal-1 副本中应用前述精确差异后完整生成，供主整合审核，不是已采纳的生产合同。

- 机器传播为 139 Capability /118 Result family /244 table /66 transaction，domain inputs153，直接及递归type refs257/零未解析。P2零finding，digest 485a50c1b2d5984a5b93e10f66e07c334a91fbeddea8939b8e07bed42cecdd84。
- 与当前244表SQL重新编译比较，DDL完全相同，digest 294bb8243aca2857729f70fa07fbc59b69efad5da5854a5db528386e19179bc6；没有迁移或新表。
- 提案真实本机Linux Docker复验14 PASS/0skip/0FAIL，14.715秒；固定依赖镜像afb5fad462130beb66162fff081e96d089adf49ee7e2bb600e9fdac72aea0357，1CPU/768MiB、network none、source readonly、tmpfs64MiB。验证局部CompletedBatchSet/typed Handle/目录Observer/原三项Capability边界；目录/CPU是确定性fixture，不代表已注册并完成新Observe Event、真实模型共载或业务闭环。
- catalogue-contract-proposal-1-linux.log SHA256 c0ae9c78b62c25fec786d47cc6d59c1abf8c146deba87cbb51edc6e76ef64a55。首轮P2只因两个validator的硬编码138/11未传播而FAIL；副本中同步139/12后通过，原catalogue-contract-proposal-1-p2.json保留，final另写文件。不放宽未知类型、权限或JSON上限。

私有可审查文件根：E:/my_project/emby_third_party-helix/.codex/buffalo-video-phase4-20261029/。

| 文件 | 大小 / SHA256 |
| --- | --- |
| catalogue-contract-proposal-1-source.patch | 33066 bytes / faef64915df7eacbb48a0179059f19cfcf1ce0dfda1882f0143a35424b2d9de5；8个共享Source/SSOT/kind文件 |
| catalogue-contract-proposal-1-generated.patch | 507724 bytes / b3b08f6be573c97711dee8a718a77f2077ecdce6e8abf730423594e50018eaf4；159个机械生成文件 |
| catalogue-contract-proposal-1-files.json | 逐路径清单，新增/删除明确，不含运行数据、图像、模型、数据库或秘密 |
| catalogue-contract-proposal-1-p2-final.json | 上述P2完整结果 |

两份patch已在演员原工作区执行git apply --check通过，未实际apply；主整合若已追加其他合同，应按精确差异审核、重新生成/计算全局数量，不能生搬固定digest或覆盖其他线程。

后续依赖该共享合同的正式Capability注册、Artifact写入与Host调度仍未实施/验收；People/Cast/停止恢复及真实数据资格均未关闭。主整合已明确要求暂留本地，NAS没有新测试。

## People 与 Cast 机器合同补充提案（供主整合审查，未生成）

以下将已有用户确认的Owner方向具体化；字段、容量与保留边须在主整合应用后随真实实现再核验。`D(x)`表示完整JCS的SHA-256，摘要字段自身不参与其对应摘要计算。不可把当前typed schema只放宽为可接任意JSON。

### 目录出演决定

建议增加closed `UsAdultCatalogueActorDecision@1`，总canonical大小≤256KiB：`schemaRef, schemaVersion, decisionId, libraRunId, subjectId, runExecutionBasisDigest, resolvedIdentityDigest, catalogueAnalysisId, catalogueBasisDigest, observationResultRef, observationHandle, assessmentPolicyDigest, assessmentDigest, winner, nameResolution, personSnapshot, referenceAssetId, expectedChoiceHead, decisionDigest`。其中：

- `observationResultRef`完整包含`workId, attemptId, planId, eventId, resultId, capabilityRef, resultSchemaRef, resultDigest, inputBindingDigest`；Capability固定`libra.us_adult.catalogue.observe@1`，Result固定`FaceCatalogueObservationHandle@1`，完整Result/Handle/digest必须与同Run、同Execution Basis的实际成功Producer一致。
- `winner` closed为`identityKey, uid, name, aliases[0..16], groupIds[1..1280], coverageStrata[1..20], supportingRepresentativeStrata[2..3]`。它只能由完整Observation及冻结selectionPolicy重算的qualified assessment导出，不能由调用方指定；姓名和别名必须取自该identity的原始查询结果，矛盾或超界明确待决。`uid/identityKey`只标识外部目录技术成员，不是People personId。
- `nameResolution` closed为`kind(reused|registered), policyRef, nameQueryDigest, libraryNamesDigest, resolutionDigest, registrationDecisionId NULL, registrationDecisionDigest NULL`；reused时两个registration字段均NULL，registered时均非NULL且指向People实际系统建档决定。对应People最新公开snapshot必须能证明`personSnapshot.personId`和所选有效`referenceAssetId`；完整Person快照沿现有`UsAdultPersonSnapshot@1`。`expectedChoiceHead`对自动分支恒为NULL，提交时Libra必须在自身事务内确认当前Subject仍无人工Choice head，不能把已有Choice伪装成空。
- `decisionId=D({schema:'libra.us-adult-catalogue-decision-id@1',libraRunId,catalogueBasisDigest,observationResultDigest:observationResultRef.resultDigest,assessmentDigest,resolutionDigest:nameResolution.resolutionDigest,personSnapshotDigest:personSnapshot.snapshotDigest,referenceAssetId})`；`decisionDigest=D(完整value excluding decisionDigest)`。决策构造前后都验证当前Run、身份、Workspace、Choice和People公开快照，提交采用同一opaque read fence；People或Choice发生竞争则重新读取，不原位覆盖已有Cast。
- People调用之前先计算无Person依赖的`catalogueDecisionInputDigest=D({schema:'libra.us-adult-catalogue-decision-input@1',libraRunId,subjectId,runExecutionBasisDigest,resolvedIdentityDigest,catalogueBasisDigest,observationResultRef,observationHandle,assessmentPolicyDigest,assessmentDigest,winner,expectedChoiceHead:null})`；自动Operation使用这个前置摘要，不能依赖尚未形成的最终决定而产生循环。新执行所用Reference Face必须绑定`buffalo_l`单脸模型摘要；只有旧128维Reference的Person须沿People正式流程先形成新版本，不能补维或假装兼容。

现有`UsAdultActorSelectionBasis@1`只接受`user_choice|automatic_match`且绑定旧Reference Analysis，不能把本决定塞进任一旧分支。建议新增明确版本的Actor Selection union：`user_choice`携带现有Choice，`automatic_match`携带真实本地Reference completion，`automatic_catalogue`只携带上面的目录决定；三者互斥，均引用同一内部Person快照与Reference。正式人工Choice不应因为目录文件缺失而失去入口；需将其必要帧生产Basis与目录generation区分，不能强行建立不存在的目录结果。旧已提交收藏只读保留自身原版本；未完成Run无旧兼容权。具体版本和共用字段由主整合根据现有Product/Aftercare合同统一决定，不能仅改enum而遗失旧事实可读性。

建议新增Libra不可变`libra_us_adult_catalogue_actor_decisions`：`decision_id PK, libra_run_id FK, subject_id FK, decision_schema_ref, decision_json, decision_digest, observation_result_id, created_at_ms`；`UNIQUE(libra_run_id, decision_digest)`，JSON及摘要精确匹配上述类型，不用Subject级最新值取代本Run的决定。Source/Owner读取和生成写入是Libra责任。`libra_product_fact_source_refs`的目录出演variant恰引用上面唯一Observation成功Result，`source_ref`固定其Observation Artifact Handle ID，Evidence ID/digest复制实际Result Evidence；不冒充`PersonMatchEvidence`。Cast commit在Libra事务读`libra_runs, libra_subjects, libra_product_fact_revisions, libra_us_adult_catalogue_bases, libra_us_adult_catalogue_actor_decisions, libra_us_adult_actor_choice_heads/intents`及现有Foundation Work/Attempt/Plan/Node/Event/EventAttempt/Result/marker；还须验证Observation Registry与Workspace material的精确Handle。People快照只通过公开Projection加opaque fence进入，不把People Repository加入Libra事务。Commit依然仅发布一条actor relation，source及originEvidenceDigest明确为目录决定。

### People系统建档与证据

建议独立`people.catalogue-register-person@1`系统命令及closed `PeopleCatalogueRegistrationDecision@1`，字段：`schemaRef, schemaVersion, decisionId, newPersonId, libraryKind='us_adult', canonicalName, aliases, providerIdentities, initialReference, catalogueOrigin, decisionDigest`。`catalogueOrigin`包含`originKind='catalogue_auto', catalogueDecisionInputDigest, sourceObservationDigest, assessmentDigest, identityKey, selectedName, nameQueryDigest, libraryNamesDigest, nameResolutionDigest, providerProofDigest, imageSourceProofDigest`；`decisionDigest=D(完整Decision excluding decisionDigest)`。命令audit actorType为system、命令身份固定系统scope，不伪造admin用户确认。`newPersonId`仍由ShelfDeck生成；外部UID/TPDB ID只作证据或Provider资料，不作主键。

People现有图片Operation可采用明确`catalogue_registration`版本化payload分支：沿既有字段保留实际`selectedImage/faceModelRef`，再绑定上述origin和精确来源摘要；不复用声称人为输入的payload。`operationId=D({schema:'people.catalogue-registration-operation-id@1',catalogueDecisionInputDigest,nameResolutionDigest,imageSourceProofDigest})`并加People前缀，`personId`按该Operation稳定生成。若提交时姓名集合变化，旧Operation以明确stale结束；重新解析后唯一命中则复用既有Person，仍为not_found且当前Run/Choice有效才以新resolutionDigest准入新Operation。两个Run并发同名先到先提交、后者复查后复用；歧义或超出完整快照上限不能盲目建档。Person/Reference的正式发布仍一次提交。

为避免Person已正式发布、影片尚未入藏时Fresh Reset删掉其来源，建议People新增`people_us_adult_catalogue_registration_origins`：`person_id PK/FK, decision_id UNIQUE, decision_digest, origin_schema_ref, origin_json, origin_digest, observation_schema_ref, observation_json, observation_digest, created_at_ms`。`origin_json`为closed来源/姓名解析/安全Provider证明/图片来源证明≤64KiB；`observation_json`为经Libra完整校验、逐字节canonical的`shared.buffalo-catalogue-observation@1`≤8MiB，`observation_digest=D(observation_json解析值)`，并匹配Decision的`sourceObservationDigest`及实际Observer Artifact的`digestHex`；Observation内部排除自身计算的`observationDigest`另行保持，不能混淆。它是People自己的事实副本，不把图片/视频塞进Foundation Result，也不把原Libra文件路径作为永久读取权限。People初始Reference持有实际有界图片及buffalo_l 512维特征；视频截图分支保留原帧digest、frame/face Evidence、裁剪参数/策略与输出digest；Provider分支保留精确匹配与图片digest。两种图片来源互斥，真正not_found与网络/协议失败分开；不得用无结果伪造成功Provider来源。此副本保留完整目录Observation及选中图片来源，用于审计；它不声称Reset后仍保有全部未入藏视频帧、特征或可完全重放的旧模型资源。

系统建档事务在People Owner下读取完整当前`people_persons, people_person_revisions, people_aliases`及Reference准备所需People Registry/操作事实，事务内按冻结规则重算姓名解析并确认not_found、摘要未漂移；Foundation opaque fence保证此前Libra公开Run/Choice资格在提交前未变化。写入`people_persons, people_person_revisions, people_aliases, people_provider_identities, people_reference_assets, people_reference_faces, people_reference_revisions, people_us_adult_catalogue_registration_origins`，及原命令receipt/marker/system audit/People outbox；Reference图片/向量必须预先由正式Effect完成且摘要精确匹配，任一步失败不得发布半个人物。

当前`people-image-search.js`只查询`searchPerformer(limit:10)`，并将每人最多5张图投影为图片列表；无图人物会被丢掉，`state=empty`不等于姓名无匹配，恰好10个人物也不能证明结果完整。因此自动建档不能直接消费该人工图片搜索的`empty`或选择顺序；Provider Adapter须保留有界完整人物候选、姓名/别名、图片情况与查询完成证据，达到返回上限时明确标记不完整并拒绝唯一/无匹配结论。技术故障独立失败；短期选择token只能在有效期内经现有受控通道取得图片，持久Operation保存真正取得的图片Handle/摘要而不是依赖过期token。

Fresh Reset：所有已发布Person沿People原配置/人物保留规则保留，新增origin行按精确person_id保留；它自己包含完整Observation副本和origin证明，Reference Asset/Face继续通过People现有`fresh-reset-reference-retention`保留精确image/embedding Registry及物理文件，不因文本中的旧Run ID反向保留整个Libra Subject/Work。已Commit收藏所需目录决定及Observer Result按Cast精确source refs保留，未Commit影片的Libra决定、Work、Workspace可清除。Person系统建档的精确命令receipt/audit/outbox及必要完成Operation应按decision/operation引用保留，不能以整个Subject扩张替代；失败或未提交Operation无Person依赖。缺少origin副本/Reference闭包必须阻断Reset，不补造证据。

这是待传播的合同提案，不是已完成实现；须用真实并发SQLite、跨Owner竞态、Reset隔离副本、正式Host和独立视频样本验证。资源generation不可用、姓名歧义、截图不可用、TPDB网络失败以及人工Choice竞争均不得被转换为成功建档。
