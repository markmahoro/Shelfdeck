# 目录 Observation 正式接线合同差异提案

2026-10-29主整合补充：本提案的Libra-owned目录Observation输入、输出和Workspace Artifact合同已结合JAV命名合同写入唯一SSOT并重新生成；下文保留原提案和隔离验证的时间点。正式Host接线、真实模型/资源资格、People/Cast及完整Phase仍未完成。新结构的Reset保留声明尚未审查，保持fail-closed；下方测试模拟分类不授权生产Reset。

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
