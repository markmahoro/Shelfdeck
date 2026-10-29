# 当前集成 Phase：本轮并行修复与 BUFFALO-VIDEO-IDENTIFICATION

2026-10-29 用户因额度不足要求安全停止全部本轮线程及轮询；所有相关线程已停止，定时跟进保持暂停。功能和最终验证均未完成，完整架构回归有 30 项失败；生产尚未执行本轮 Stop、Reset 或部署。工作现场、备份、阻断和恢复顺序见 [暂停交接](evidence/HANDOFF_20261029_2206.md)。用户要求恢复前不得续跑。

2026-10-29 最新用户决定覆盖下方旧的 Series 独立发版/七条逐项恢复顺序：先检查五条原因未明项并只加入必要的修复，再完成电影自定义 Spec、US Adult 演员识别与自动建档及已有积压根因修复；随后安全停机、执行已授权的 Fresh-generation Formation Reset，最后标准部署同一版本。旧未入藏任务不做兼容、自愈或逐条恢复；用户已授权跳过真实 CIFS 验证，不再等待低 I/O；不能将未验证部分记为通过。按已授权的精确停止态预检、保留依赖验证、备份和标准发布入口执行；不恢复定时轮询。

五条针对性复核新增两项本轮工作，具体案例、证据边界与最小修复方向见 [PRODUCTION_FIVE_CASES_REVIEW_20261029](evidence/PRODUCTION_FIVE_CASES_REVIEW_20261029.md)：

- **TMDB-ALIAS-TYPE-BOUND**：硅谷 S04 的同输入、同生产 Adapter 当前可复现；TMDB 合法 `alternative_titles[].type` 描述为 159 UTF-8 bytes，旧代码按 128 bytes 整体拒绝。该字段不属于 Alias Evidence；在保持完整响应、实际标题和身份边界有界的前提下修正协议校验，覆盖原反例及无效类型、总体过界负例。历史第一次错误未保留字段级证据，不伪称精确历史因果。
- **JAV-SOURCE-FAILURE-DIAGNOSTICS**：GVH-877、SORA-062 的来源错误持久诊断缺少阶段和 HTTP 状态；按现有 failure evidence 合同保留白名单字段并限制底层网络码，不暴露 Secret、URL 或响应正文。不改变源选择、重试或旧 Run。历史失败的精确网络根因仍未知，当前只验证精确页面可访问，未取得封面。

两项代码分别提交 `9a271d317`、`9ae7c1aa6`：隔离 Linux 定向64项及后续身份/诊断22项通过，真实 Host 的页面503失败 Evidence 定向通过。既有完整 FC2 503→备站→入藏测试首两轮因误设1 GiB临时卷、低于Workspace至少5 GiB准入而未进入入藏；改用空间充足的隔离匿名卷后原断言及新增持久诊断断言通过。首两次失败保留。详见五条复核 Evidence，最终集成和正式验收未完成。

DDOB-019 的冲突目标为已有 active Shelf Entry 所控的同番号正式文件，新任务输入为不同物理材料；保护性拒绝保留，不因相同番号认定可合并、覆盖或自动替换。爱死机原始三次均为连接重置，当前相同来源查询已成功，无法证明原始连接重置的外部位置；不追加猜测性恢复代码。

更新：2026-10-29。用户同意恢复演员、电影、剧集及UI负责人线程并行，本线程追踪和整合、负责Reset与发布；不恢复定时轮询。Series、电影自定义Spec及演员识别统一发版，旧七条不逐条恢复。本文件仍是唯一活动集成包。Phase 1有限技术资格已Exit，固定提交125229556及[Evidence](evidence/BUFFALO_CATALOGUE_FEASIBILITY_20261029.md)可复验；未开放自动出演。

独立候选`b7a03bb48`、`2a58c1606`已整合US体积检查及对话框修复：隔离Linux服务56项、Windows Web 15项和前端构建通过；最终合版、真实媒体及具体版本UI复核仍开放。冷态Reset结构转换提交`bfc9f0cd4`对固定生产239表→当前244表进行精确目录和marker校验；后续已声明244表保留规则，补齐相关Withdrawal闭包与旧执行防重启边界。隔离Linux完整管理流程85项通过，后续闭包回归85项及管理入口2项通过；原2项缺失闭包、旧Work反例和一次声明错误失败均保留。最终整合结构、生产停止态数据闭包、校验冷备与实际Reset仍待核验。

演员Observation `28a6e4f43`已叠加主整合暂存代码并保留已有Artifact类型，真实Event及Workspace定向Linux 52项、四项静态检查通过；这不是正式Host或真实视频/People/Cast资格。演员线程继续前序Frame恢复和系统建档，目录来源的Selection Basis、People自动注册来源和人物独立Reset依赖仍待精确机器合同及实现。Series候选Perception同Owner模型边界修复`f253017d2`已通过Linux 45项和静态检查；JAV新路径与主整合已存在的`3e707a033`合同仍待合并及完整验收。

最新合并检查点：主整合固定待提交tree `23b114916969c167f5bc186833bf2298515746a0`包含Series候选`f253017d2`、演员Observation及Reset基线；静态四项与P2定向3项通过，合并后隔离Linux Foundation/演员Observation 148项、共享Series/Perception/诊断62项通过。UI负责人对`2a58c1606`开发预检通过，最终混合版本仍须独立复核。

JAV长标题`619ffc464`不是发布合格候选：真实Host的Stage回执前、Stage已提交/Verify前和Placement回执前三个进程中断窗口初版未完成Effect责任，试验性修订已恢复唯一Commit；成员写入中、完整Manifest尚未持久化的第四窗口仍停滞。Arca正在实现同Effect逐成员证据及无法证明时明确attention；须固定版本复验所有窗口，Reset不得借此删除正式根下文件。演员系统建档和电影自定义Spec仍在开发，新增People/Cast数据结构若改变目标DDL，须重新验证从实际239表源的Reset结构与精确保留闭包。

演员线程阶段提交`bfc11236e`的真实Frame Effect恢复、People姓名比较和Libra人物请求输入已整合；保留主线Artifact kind，Linux 79项、Windows 25项及静态四项通过。仍使用技术fixture，实际视频/Host、系统建档、Cast和最终Reset未完成。

## 并行执行与当前阻断

| 线程 / ID | 本轮交付与先后 | 整合边界 |
| --- | --- | --- |
| 本轮整合线程 | 计划追踪、共享合同/生成物、Reset与最终合版门禁/发布 | 自有主整合与独立候选目录；保护其他线程及已有暂存工作 |
| 演员线程 01a164c5-1b9a-7312-a8ec-701ea6032526 | 继续Catalogue Basis/Work/Artifact/补采恢复及Phase 4→5闭环 | 共享基准97c4913b9含2f/68/f0/723/3c/e7及正式合同，固定树双平台各52通过；NAS验证暂停，正式Host/真实模型/完整门禁未完成，不作为Series发布基线 |
| ShelfDeck 生产待处理条目分诊 01a18626-520c-79a0-8240-066bd0a777a3 | 生产快照与逐条分诊已完成；JAV长名原型已留证 | 本轮未重新启动，16:18快照不等于Reset精确范围 |
| ShelfDeck 剧集上架与自愈修复 01a18627-6d8b-7d72-aa5a-bcb7cbf6ed0f | Series新任务修复核对，并承接JAV长名正式实现 | 在独立工作区开发；不逐条重试旧任务，不操作生产 |
| ShelfDeck 电影寻源与自定义标准 01a18628-b31a-70c3-abbc-bd29b688cbce | 完成自定义标准端到端用户闭环 | 承接原增量；完整API/UI、Owner/Runtime和真实旅程仍未闭合，不开放半成品 |
| UI负责人 01a0912a-0086-74e2-88ab-536c59d3862a | 提前复核体积及瑕疵对话框，最终核验精确合版 | 当前提前反馈不代替最终版本复核 |

其他线程在各自独立工作区准备代码、专属Evidence及必要共享合同候选；主整合统一审核、合并并重新生成共享合同，互不覆盖彼此工作。NAS重型任务串行安排。本轮已授权停止态Fresh Reset和升级，不再等待真实CIFS或低I/O；保留其未测风险及停止态保护要求。

## Series候选及本轮整合检查点

| 工作项 | 当前状态 / 退出条件 |
| --- | --- |
| 候选范围 | 从生产a2bf2d6fd整合Series三个提交及MetadataFetchIntent、MetadataObservation、ArtifactAcquisitionResult最小已确认生成合同；检查原有DDL/表不变，不携带演员/自定义目标。 |
| 固定候选资格 | 固定提交的Linux镜像、适用架构/Service/Web及具体版本UI负责人核验；保留所有首跑失败与重验。 |
| 真实CIFS | 用户明确跳过；未实测风险如实记录，不能称通过。 |
| 标准发布 | 复核生产身份、容量、备份与回退；使用build-image、upload-nas-image和deploy-nas，dry run与SHA通过后按既有用户请求执行。 |
| 旧七条 | 不逐条恢复；停止态Fresh Reset按全范围合同清除未入藏在线状态并保留来源与正式收藏文件。 |
| CUSTOM-TARGET-RESET-RETENTION | 隔离模拟证实仅作dependent表分类会遗漏已保留Custom Spec的精确Intent/Preview；Libra按实际保留Spec提供Owner依赖闭包，验证同Subject多版本、未入藏、缺失/篡改与中断恢复。原开发Schema因声明不匹配保持fail-closed；不能仅靠FK通过放行Reset。 |
| JAV-AFTERCARE-REPLACEMENT-IDENTITY | 隔离环境发现的额外文件归属风险，未证明为本轮积压根因；按用户决定不作为本轮独立专项，现有保护不削弱。 |
| ON-DECK-FOREIGN-STAGE-OWNERSHIP | 同字节外来Stage是隔离反例，未证明与现有积压有关；不作为本轮独立专项。若新长名实现复用相关路径，仍按其现行Owner/冲突合同处理。[Evidence](evidence/ARCA_TARGET_EXCLUSION_RECOVERY_20261029.md) |
| WITHDRAWN-OFFER-RESET-DEPENDENCY | 已实现244表精确保留：当前保留Run、Work、Package或Outbox仍可能关联旧Offer时保留Arca Withdrawal及原Command/Marker/Audit；无关记录清除，证明缺失/Accepted矛盾阻断。隔离待投递和已投递未ACK重投、缺证、伪造及独立核验测试通过；目标结构变化或生产停止态事实不同须重核。[Audit与后继证据](evidence/ARCA_WITHDRAWN_OFFER_RESET_AUDIT_20261029.md) |
| FRESH-RESET-OLD-EXECUTION | 隔离复现历史Run带入无依赖ready Work；只按终态Work选择历史，确有保留证据依赖的未终态Work/Attempt/Event/Effect在规范化时阻断，不能恢复旧执行或伪造终态。覆盖上述各层负例；生产实际范围未知。 |
| SERIES-RESOLUTION-COMMIT-FENCE | 精确27a并发Series Host自然复现：Draft冻结后当前Query变化导致Commit Handle不匹配，Effect已reconcile_required但无Marker/Result；生产基线的受控输入亦复现。150秒持续版本变化的合成观察未收敛，不能外推首次门禁或线上状态。独立实现须保全同一Effect责任、冻结Query/Record Set/Rule、后继Work与冲突负例，不得放宽fence。[隔离调查](evidence/SERIES_RESOLUTION_COMMIT_FENCE_INVESTIGATION_20261029.md) |
| P13-BACKUP-DIGEST-CONSISTENCY | 27a完整架构第二轮中哈希时文件改变未拒绝；Linux tmpfs受控复现stat时间戳相同且接受混合摘要。独立修复须覆盖原负例、时间戳不变、正常文件/有限内存及Windows/Linux；仍须真实停止、独占与完整冷备，不能把单次复验或双读称为原子快照。[Evidence](evidence/SERIES_INTEGRATION_GATE_20261029.md) |

2026-10-29固定Series候选：`1d8a45843f9c8982c91bb0a367eb0adfa1c5c310`，基于a2bf2d6fd，三个Schema与既有Linux验证副本字节一致、239表/62事务不变。本机合同13项通过；标准镜像首次下载既有模型失败，核验本机生产基线模型SHA后重建成功并上传校验，tar SHA256 `b57b0de41449109adbeb39f4d12ca6ab81a66d1a9ca6062c5d964b4b3271ca8d`。首个固定检出因Windows路径过长失败，第二个因换行不一致不合格，第三个与构建输入4541文件逐字节一致；独立Linux完整架构门禁仍在执行。

UI修复提交`60f123a71`、浏览器回归`567ad89ca`及专属Evidence `7265d4b5e`已直接快进至新候选`7265d4b5ec4077cb21152219a9a53e85a97ac3f9`；标准镜像tar SHA256 `42ba2e2497b2db51d4a2889599895f337779f5dc30203f545e06100159cb3697`。实现线程报告Linux Web 274通过及四视口44通过，UI负责人正在针对新镜像独立复验，尚无最终UI PASS。两版Service主体不变，但最终候选及所有后续变更仍须完成适用固定版本门禁。

在7265上单独挑入测试工具安全修复后，当前固定候选为`bc4f5c952849ed6079baedde159ddaa5ce1d39c1`，标准镜像tar SHA256 `59bcd40c566af686da84d861ea9b4d8f1cb9c785b3586172320e568e9237a3d6`。4544个跟踪文件与构建输入逐字节一致，Service依赖4995文件与该实际镜像一致；Linux Web 274通过、Service 846通过/28 skip/0失败，跳过包括专用真实媒体与浏览器fixture。UI负责人对bc4镜像适用验收PASS，依据见本包Evidence。上一段7265 UI复验中状态为旧检查点。

continuity合法重规划门禁测试`92df7fa5e`挑入后，当前候选更新为`27a0f68af3599a3422b21853632fc8a01878b750`，标准镜像tar SHA256 `e87f6628edc20732df35889aa7195bd7de1e52ba6753984635a7e39f95a3166e`。4547个跟踪文件与构建工作区逐字节一致；该版本Linux Service 846通过/28 skip/0失败、Web 274通过，UI负责人对具体镜像适用验收PASS。完整架构和真实CIFS待完成，未部署。上述bc4为前一候选。

后继Series修复在独立工作区`C:/Users/markm/.codex/worktrees/shelfdeck-series-fenced-20261029/emby_third_party-helix`的`codex/series-fenced-20261029`准备：在27a上按序挑入Foundation原Effect/Marker/Result恢复、Perception冻结依据和Owner后继Work、提交窗口验证及P13摘要修复；固定HEAD `4774a7e9056f644c29b8034ea07baeb4f578c4f6`已完成标准本机镜像构建，tar SHA256 `1a280a3efea6f67b97019552d8fd76ed7c8fe655bf5aa52998686c559b6b3023`。完整架构、Service、Web和具体版本UI在执行，真实CIFS、实际生产副本/冷备和七条恢复仍开放，未上传或部署。

4774的具体版本UI复核 **FAIL**：受控注入评分Resolution重试耗尽终态时，后端决策返回失败，评分读取仍为pending，页面继续显示“正在匹配豆瓣评分”。真实调度链是否同样触发仍需Host复现，不能推断已影响生产。Perception线程按Owner责任修复状态传播并验证新依据恢复，后继精确版本须重新完成UI验收；4774不可部署。

前候选1d8a完整架构3402通过/5失败/27跳过，四项缺少依赖路径后定向通过；1081视频Host并发收敛核查见专项Evidence。bc4完整架构3410通过/3失败/27跳过：两项缺历史Git对象，精确27a相同测试补只读对象后6项通过；另一JAV Aftercare海报失败已找到可复现的相同现象，首跑因果仍未证实。精确27a首轮3411通过/3失败/27跳过：两项同样缺历史对象，第三项Series Resolution Commit Handle异常已在隔离Host调查；带完整历史的第二轮3413通过/1失败/27跳过，唯一失败为上述P13备份摘要缺口。两次原失败均保留，不能用定向结果冒充全量通过。

本轮已获Fresh-generation Reset授权；预检须停止、冻结精确范围并核验保留依赖，可能清除在线未入藏任务和系统工作区，不能仅据历史34条快照推算范围。[只读分诊和Reset影响](evidence/PRODUCTION_TRIAGE_INTEGRATION_20261029.md)。

演员2f/68/f0/723/3c/e7与目录Observe合同结合JAV截断合同的共享基准`97c4913b96cbe6509c65a2c42ae5ee106905eb17`已固定，P2为139/118/244/66、153 domain inputs、257 refs且无未解析。固定树Windows/Linux各52通过，Linux包/语义/Manifest/P2通过；Linux沿旧镜像依赖，不覆盖新增usearch真实模型。初次组合的37项通过发生在临时启用244表保留声明的实验状态，发现Custom Spec缺口后已撤回声明并实测`RESET_RETENTION_SCHEMA_UNREVIEWED`；Actor保留正例仅在测试内模拟分类。Reset测试待精确保留和合法历史修复后重验，当前无正式Host接线或完整Actor/Reset资格。[Evidence](evidence/BUFFALO_CATALOGUE_OBSERVATION_CONTRACT_20261029.md)。

真实CIFS首轮将Workspace/SQLite错误放到共享盘而失败；按生产布局重跑后8项直接文件调用仍遇 `PHYSICAL_MATERIAL_STAT_FENCE_CHANGED`。隔离探针发现首次路径stat与文件描述符时间戳不一致、后续收敛；真实Host已定位同一Series publish Effect进入reconcile_required，最初测试把该预期恢复通知视为异常而提前退出。验证原Effect恢复至唯一Commit的第三轮隔离Host在2026-10-29 14:43启动；随后NAS应用响应超时，隔离测试连接在无最终结果时断开，不能计为通过。用户说明前序其他Docker部署导致系统卡死并重启NAS；独立根因未核实。重启后确认任务容器不存在、生产仍为同一a2bf2d6fd镜像；用户重挂两个原CIFS源后原容器仍见启动时空目录，故精确核验源及容器后重启该容器恢复绑定；容器内SMB及健康已恢复，但管理状态一次超时、swap约2GiB，稳定性仍待核验。候选未部署或线上重试；NAS稳定性复核前暂停新NAS测试和发布。[候选与恢复Evidence](evidence/SERIES_INTEGRATION_GATE_20261029.md)。

UI负责人对前一固定候选的独立走查发现两项阻断：文件状态核对超时仅显示通用失败原因，整理过程弹窗键盘焦点可逃到背景。浏览器28通过/8失败（两项各四视口）；Series线程修复后新候选负责人复验中。前版独立Linux Web 271项通过；Service首轮32失败主要因依赖和隔离/tmpfs配置不完整。补齐环境后835通过/2失败/28跳过：Event deadline定向及八次诊断重放通过但失败原因尚未确定，电影测试工具的Linux路径安全断言为生产基线既有问题，电影线程已独立提交db539e9df，仅覆盖盘符/UNC字符串、不宣称识别已挂载SMB；不抹除完整门禁失败。

## 生产分诊新增阻断

- ARCA-PATH-COMPONENT-BUDGET：HALT-094和EMLB-094原冻结Decision超长；已有缩短预览但正式接线未完成，现由剧集线程承接。旧任务按本轮Reset处理，不改写冻结Decision。
- US-SIZE-DEFECT-PREVIEW：后端与对话框修复已入独立候选并通过上述定向测试；最终合版UI与生产验收仍开放。
- SERIES-PRESENTATION-EXPANSION：13个build/15个Season Subject是13:36快照；新任务修复按同版验证，旧任务不逐条恢复。其他来源错误和正常人工待决分别承接。

以上均未因局部Linux PASS而自动完成。

最新检查点：已完成新typed Catalogue Basis、Service内置数值/CPU隔离/目录查询与代表图模块，qualification入口复用正式模块；尚未接通正式Work和Artifact持久化。contract-6 Linux54 PASS/0skip；4组目录有序身份与固定参考一致。contract-3四张代表图（含旋转）可独立检出单脸，记录紧框首败后采用显式1/4留边策略。目录代际冻结manifest及7成员/512维特征空间，实际2,715,402,822 bytes验真；检索与Libra身份资格分开。静态合同/P2从排除原Phase 3未提交文件的源码快照通过，资源共载/正式Host及Phase Exit仍未通过，详见本包[Evidence](evidence/BUFFALO_VIDEO_QUALIFICATION_20261029.md)。

## 本轮优先Outcome

先完成真实视频识别，再立即接Phase 5人物复用/自动建档和出演确认。共同终点是“真实影片→可靠选定一位演员→完整人物→正式出演→生产→Arca唯一Commit”，演员/NFO/海报一致。不能仅凭图片姓名、一个聚类或中间Choice就称整项核心功能完成。

本Phase交付视频读取/抽样/特征/分组/目录和本地Reference检索及Libra单演员选择资格，不写People Person，不提前接自动注册；后者由Phase 5完成并真实入藏验证。真实演员准确性、自动归属和人工兜底分别验收，不能用Phase 1技术一致性代替。

## 已确定合同与Owner

- Linux Docker内置能力，无Worker、独立Sense/Stash/Python服务；Mirex不作为设计/实现来源。方法基于固定Sense 2及Phase 1已资格的Node实现。
- 全部模型计算统一buffalo_l；主目录检索与自建Reference备用用同一特征体系，不保留SFace备用，不混用原128维特征。
- 一部影片一位演员；A/B均可靠识别时可选其中一位，不扩展多演员关系。2026-10-29用户取消性别条件：不预测、不按gender筛选/加减分/分流，缺失或冲突不单独产生人工待决，男性也可被选中；仍按身份可靠性和独立时间覆盖判断，不把频次解释为已证明主演。
- Libra拥有冻结的影片/材料/采样策略及单演员决定；共享计算只给技术分组/特征/候选；People拥有Person/Reference准备与发布；Arca拥有正式入藏和库存纠错。外来目录不是People Registry，内部personId保持。
- 物理读取只经当前Owner的Read Handle及源身份校验；不整片上传/复制，不增加任意视频URL服务。Frame/Embedding/Cluster/代表图使用现有Workspace/Artifact/Effect及取消围栏，不能把帧字节塞进业务Result。

## 首先冻结的设计与待定项

性别条件已按用户决定取消。下列采样/数值细节仍须根据实际视频冻结后才进入正式策略；不能把本包激活当作已经完成资格：

| 项目 | 提议/要求 | 冻结前需要的证据或决定 |
| --- | --- | --- |
| 有界抽样 | 首批约20个跨时间点，必要时补最多20个未采点；输入前seek，不随片长线性扫描，短片去重。 | 实际视频中抽样足够性、失败与部分完成语义、读取量/时限/并发/空间；新Sampling/Model Ref及typed输入闭合，禁止旧Run兼容分支。 |
| 分组和代表脸 | 复用已生成512维特征，确定性分组；按独立时间区段计数，重复截图不加票；每组少量清晰/多角度代表脸。 | 同人不同角度、相似不同人、A+B同框、近邻burst与片头重复、组污染负例；不能靠相同候选姓名合并未知脸。 |
| 名字与选择 | 全库检索后按身份可靠性和独立时间覆盖选一位，不分性别；身份歧义与多个可靠演员分别处理。 | 姓名候选相近、同框不同人、弱匹配与局部重复不能形成虚假资格；gender值变化/缺失/冲突不得改变排序或触发人工。不得用TPDB反复试名替代决定。 |
| 坐标/代表图 | 原帧、校正画布、脸框、代表图及embedding必须连续绑定；提供People可验证的单脸原始来源。 | Phase 1旋转框属于校正画布；正式提取须验证变换/裁剪Artifact，不能用原帧坐标直接套用。 |
| 缓存与资源 | 复用模型/只读索引及同一资格图像结果，绑定模型/数据generation；沿Runtime既有Permit和停止屏障，不能组件私藏队列。 | Phase 1仅证明单图隔离进程；真实视频/整机共载、冷/热、mmap与RSS口径、超时/取消/停止及回收实测后确定预算。 |

## 实施与资格工作项

| 工作项 | 范围 | 验收门槛 |
| --- | --- | --- |
| BUFFALO-VIDEO-CONTRACT | 先对照SSOT及现有正式Frame/Embedding/Cluster/Analysis Basis，冻结技术输入输出、策略版本、坐标/来源、资源及失败语义。 | 不跨Owner，不暗中确定未决业务规则；现有Source/Workspace/Model/Artifact/Spec/digest/fence保护不弱化。 |
| BUFFALO-VIDEO-PIPELINE | 将已资格的模型/目录方法接入真实受控抽帧与分组、补采/代表图和进度，保持结果可恢复。 | 独立真实视频有界执行，零整片上传/全片扫描退化；失败/取消/预算耗尽不伪装无脸或无匹配。 |
| BUFFALO-SINGLE-ACTOR | Libra根据真实候选和已确认策略产生单演员识别依据，本地Reference备用亦用buffalo_l。 | 多演员A/B、男性覆盖更多、gender任意/缺失/冲突不影响资格、模糊/侧脸、无脸、库无匹配、身份歧义分别验证；无合格结果进入原人工路径，人工先行不被迟到自动结果覆盖。 |
| BUFFALO-RESOURCE-AND-DATA | 有版本模型/目录、缓存/暂存清理、任务上限及停止/重启/迟到结果门禁。 | 实际Linux视频冷/热/1080/4K/SMB及与正常工作共载的CPU/内存/字节/延迟；更新不能混读generation或重判已有演员。4K识别验证不扩展为转码吞吐修复。 |
| BUFFALO-VIDEO-EXIT | 固定源码/配置/数据/样本，完整正反例与适用UI验证，反向审计及冻结包。 | 以真实视频证据退出，Phase 1原图和静态双人拼图不代替；随后立即接Phase 5，不切回Phase 2。 |

## Phase 5接续准备（仅依赖接口，不提前实施）

Phase 4应提供绑定材料/帧/模型/目录/策略的识别候选及代表图来源。Phase 5由People唯一复用或TPDB补充/截图兜底建档，再由Libra消费完整Person/Reference快照确认出演；保留原人工建档/影片选择、并发幂等和人工作主。TPDB ID不作为人物主键或建档必需条件，不循环匹配新Reference来证明刚才姓名。模型/Reference正式更新、旧Evidence只读保留和推荐认领退役责任与入藏旅程都在Phase 5闭合。

## 保护、授权和当前事实

Phase 2已有修复、Phase 3未提交Run接续文件和既有资格均保留，现由上述独立线程并行承接，不记验收完成。原Phase 2待开始包冻结在[重排检查点](evidence/ROUND_REPLAN_BASELINE_20261029.md)，不构成另一个活动计划。

仅自用NAS，不对外分发模型/数据。完成同版候选后执行已授权的安全停机、Fresh Reset和标准升级；保护收藏、来源和正式文件，不启停原Sense服务，不恢复自动观察。隔离测试按精确目录、只读输入、容量/资源预检及任务专属进程执行；SSH使用tools/nas-ssh-config.js，凭据不输出。

2026-10-29技术切片：已增加有界20+20抽样提议、带同框排斥/组内距离保护的质心分组、时间区段去重、最多三张代表脸及显式目录链接身份汇总；姓名相同不合并，gender冲突保留。Service既有Read Handle/Source校验下增加显式采样点与流式sink，旧正式20帧入口保持原策略；输入前seek并限制解码线程，取消或失败不返回部分成功。模型/目录和新视频Evidence仍是qualification代码，正式Runtime依然为旧模型，不能称已经切换或完成Phase 4。

实际Linux首轮数学/边界15项、最终补充13项（含真实FFmpeg取消/来源改变/停止屏障、4K良性合成解码与目录身份链接）通过；三部影片只读首采共60帧/84检测完成，新代码12组分组网格逐项重放一致，新视频Evidence路径对固定Sense的3原图/1旋转图数值及有序身份对照通过。双女演员样本同时得到与原片名相符的两位女性候选和距离更低的男性候选，不能直接取单脸最高分；另一部目录别名覆盖原片名。第一部片名/旧演员/新候选互相不一致，缺独立真值保留未决，不宣称准确率。1CPU每部首采158–289s，父HTTP探针7273次/0错误/最慢93ms；cgroup触及2GiB上限、max事件4348、无OOM，资源资格仍待。详见[首轮视频Evidence](evidence/BUFFALO_VIDEO_QUALIFICATION_20261029.md)。

首次Inventory TEXT版本比较失败和新增测试挂载被只读父目录拒绝均保留；输入转换及隔离挂载修正后复验，不放宽身份/产品断言。三条Inventory/收藏保护字段及2模型/7目录SHA保持，生产容器身份/StartedAt不变，全部本任务容器已退出。2026-10-29用户明确否决FEMALE-only提议，取消全部性别筛选和分流；该项已定，不再等待确认。当前不能开放自动出演的剩余原因是正式执行链/资源/识别资格尚未完成。原来的常规单图资格不被这里的小样本替代或扩张。

尚缺正式typed Basis/策略/Artifact与资源接线、补采、真值充分的独立视频识别和4K/冷启动/完整停止恢复资格；Phase 5人物发布和唯一Commit未开始。Phase 6最终整合/镜像/完整架构及具体版本UI/生产门禁保持；本次没有增加CUDA、生产处置或自动观察。

上段为首轮检查点：typed Catalogue Basis与显式策略现已新增，后续缺口为其Store/正式Work/Artifact/Runtime Permit接线、20+20补采与恢复及业务/资源资格；不能因纯模块已迁入Service就提前开启自动人物处理。原128维正式链尚未切换，Phase 5仍需统一Reference及本地备用，不允许新增SFace运行备用或未入藏旧Run兼容。

取消性别条件后的增量：Libra私有`us-adult-catalogue-assessment`按显式冻结的距离/候选差距、独立代表及时间覆盖参数形成候选评估，完全不读取gender作决定；技术候选不等于Person、ActorChoice或Cast。资格不够、无脸、无匹配及身份歧义分开，重复截图不充当独立证据，同一组强身份冲突或同框两脸归同UID不能被高分掩盖。最新assessment-2实际Linux 10 PASS / 0 skip，三部已有Evidence的12组网格与60次gender值/缺失/冲突变更重放全部通过。参数0.5/0.05/2代表区段/3覆盖区段仅为明确的实验Fixture，不是生产校准默认值。私有模型尚未接正式Work/typed Observation，Phase 4仍开放。
