# ShelfDeck 当前状态

2026-09-28 UAT-251/274最终发布门禁：12ac3ec725已构建/上传，Windows与Linux新增功能验证通过；完整生产副本启动被13683条历史PLAN_CATALOG_DRIFT阻断，旧镜像对升级schema回退也拒绝。生产仍69a82f2a5d且健康，未apply/Reset。历史合同只读证明及结构回退边界待确认，详见同项审计末节；下方“验证中”为此前阶段。

2026-09-28 UAT-251/274：双标准、外部取得后内部加工及可信别名已实现；Windows完整架构240文件、真实转码/封装上架及授权正反例通过。正进行镜像构建、最新完整生产副本升级/回退门禁，尚未部署、未Reset生产。详见[审计与实施证据](implementation/evidence/UAT-251_DEFECT_ELIGIBILITY_HISTORY_AUDIT_20260928.md)。

2026-09-28 UAT-272/273：已标准发布69a82f2a5d，生产health/normalSupplyAllowed、Admin/挂载/Secret/fnOS通过。最新完整副本候选及回退Host通过，精确镜像Linux56项通过；真实浏览器已验证金都639445的片名/年份/海报预览及取消零身份提交。正式选择及新自动观察业务验收待补，两项保持开放。见[证据](implementation/evidence/UAT-272_273_MOVIE_IDENTITY_20260928.md)。

2026-09-28：UAT-269已发布b8cf321d65，荒野猎人原Event/Attempt/Effect完成import/probe/verify/select，无重新下载、源Reality不变；第一批关闭。接续UAT-270资源等待输入准备与单次Aftercare投影去重，Windows专项143项与完整架构240文件通过，固定资源需求分支另经34项回归；本机Docker启动故障阻塞Linux验证及构建，尚未部署。见[第二批证据](implementation/evidence/UAT-270_RESOURCE_WAIT_PREPARATION_20260928.md)。下方未发布描述为第一批历史阶段。

2026-09-28 UAT-269：外部导入改用原生异步独占复制，Windows/Linux定向各45项通过；完整架构及生产接续待验，尚未发布。见[证据](implementation/evidence/UAT-269_EXTERNAL_IMPORT_COPY_20260928.md)。

2026-09-24 16:39 CST UAT-268 已独立标准发布 `helix-beta-20260924-cdcab6dbab`，git `cdcab6dbab83e157af80068196d250b9eb236491`，tar SHA256 `9361e3c95edd69b195f9e63b6f6432175afd90c290981862da9e819c9b43b7fc`，镜像 ID `sha256:42c03c77c6567effb97a259f64bb9b21c7e58d8dd991563e865a50ef1804c564`。标准脚本、完整Host候选/回退副本、指定sample副本真实放弃与同键重放、健康/Admin/挂载、SQLite/收藏保护通过。生产用户随后正式放弃指定sample，页面显示“已结束 · 用户放弃”，Run active rev2→discarded rev3、唯一Decision/Receipt、Outcome `user_cancelled`、输入Control释放；上线前备份与生产只读对照证明sample原文件身份、已入库《局内人》正片Entry/17项Inventory及其Control保持。UAT-268已按业务验收关闭；UAT-267三片上架修复未纳入本镜像。[发布与验收](implementation/evidence/UAT-268_ACTIVE_RUN_DISCARD_20260924.md)。以下为历史时点。

2026-09-23 UAT-267：三条已 Accepted On-deck Run 的冻结依据修复仅在隔离发布分支，生产仍为 `3fff5f7dc3` 镜像。完整 Host 只读副本通过，但 CIFS 媒体源缺少保持物理身份的隔离可写克隆，真实 Effect 演练门禁未过；不得把本次 UAT-268 独立发布当作三片恢复。[门禁](implementation/evidence/UAT-267_ONDECK_FROZEN_BASIS_20260923.md)。

2026-09-23 13:03Z UAT-266 已标准发布 `helix-beta-20260923-3fff5f7dc3`，git `3fff5f7dc30145a97a5d6372817975321f349bf8`，tar SHA256 `223168ffa60e8002f9c9749b36624cbdf73e38cdf3dd34a638f2df37be089638`，Config ID `sha256:758904f31ffe3656383f0570a61560b5c89c6c8b388981baf7da3db9098d3489`。生产系统 Movie Template 与唯一 Shelf Standard 均受控升至 revision 2，规则要求 Matroska/`.mkv`；health/Admin/挂载、SQLite、204 Entry 及发布 Receipt/Outbox 通过。19 个存量 `.mp4`（约104.4 GiB）切换前后19个Shelf Entry/Material Key/路径/inode/大小/有界指纹逐项一致；自动重评已产生1条active和2条queued的rev2维护Case；《惠子，凝视》误后缀被判为`conformance:file_extension_unmet`且可自动修复，修复准备Work已受理。《有话好好说》真实MP4同时出现`container_unmet`/`file_extension_unmet`并排队，三维评估已完成；现有电影转码继续运行。新 Run 与19片逐项真实修复尚未验收，UAT保持开放。完整备份、镜像门禁及限制见[UAT-266 证据](implementation/evidence/UAT-266_MOVIE_MATROSKA_STANDARD_20260923.md)。以下为历史时点。

2026-09-22 13:10Z 最新生产为 `helix-beta-20260922-459efebbf2`：UAT-265精确同stem前缀图片分类修复上线，保留19的误维护及0e列表/诊断/预检修复。标准部署、候选/19回退Host、Linux147适用项及Windows仓库审计3项、生产分类源SHA与角色、health/Admin/挂载/Secret/fnOS和192收藏8组原事实保护通过。《局内人》旧Inventory revision15及poster_missing未改，未发起手动修复；UAT保持开放待实际新片/旧收藏验收。下方为历史时点，[本次证据](implementation/evidence/UAT-265_PREFIXED_ARTWORK_ROLE_20260922.md#正式生产发布结果)给出镜像身份、备份和隔离告警边界。

2026-09-22 10:40Z 最新生产为 `helix-beta-20260922-19d13f7b58`：旧Root的251误维护收尾及264通用回收修复已上线，并保留本日0e诊断/列表/预检修复。7个剩余误Case已正式终结，另外2个既有终态保留；黑寡妇FFmpeg停止，正常Libra转码继续。19项真实三维复查全部落库，均healthy/无活动Case；黑寡妇临时文件已正式回收，Work succeeded/Effect committed、Registry reclaimed、文件不存在；8组原持久事实missing0/changed0，141文件身份/有界指纹不变。浏览器需要处理0、整理中3；3份历史NFO/263切Root保持独立待决，未宣布251整项关闭。下方0e及更早状态为历史时点，详见[本次发布证据](implementation/evidence/UAT-251_ACCEPTED_DEFECT_RECOVERY_20260912.md#2026-09-22-旧root修复正式发布)。

2026-09-22 09:28Z 当前生产已更新为 `helix-beta-20260922-0e16b6dd8b`：UAT-125/212/250 的诊断、列表、预检独立修复上线。历史100条查询由500恢复200，已结束记录保留且移出活动列表；health/normalSupplyAllowed、Admin、五挂载/QSV/Secret/fnOS通过，192收藏及8组原持久事实missing0/changed0。《星际迷航2》旧预检Attempt正式以EXECUTION_TIMEOUT结束，当前等待资源，影片未完成。Aftercare黑寡妇仍在转码；251/263/264及Provider新Policy未随本批发布。最新空间65G可用/63%使用，21次AbortSignal listener警告仍待定位。下列9月12日/20日及22日发布前记录为历史时点，生产身份以本段和[本次发布证据](implementation/evidence/UAT-125_212_250_FAILURE_CONVERGENCE_20260922.md#生产发布结果2026-09-22)为准。

2026-09-22 部署复核：生产仍为 `286fe56f1e`，StartedAt 保持9月12日14:31:12Z；health/normalSupplyAllowed、LAN及fnOS管理页正常，Secret和五挂载一致。vol1可用约73G、使用率59%。已接收UAT-125/212/250独立修复 `dadb11797`，准备保持旧Workspace Root的发布线。共享Root切换仍受3份历史NFO人工恢复合同及完整回收门禁约束，不以部署授权替代该决定。

2026-09-22 UAT-212追加：原286“已完成”100条页稳定500，部署负责人核实前100 Subject有103 Run；Run revisions查询批量误用500而仓储上限100。已改为100分批，同时保护超过100的Subject刷新；真实SQLite专项32/32通过，待独立补丁串行副本/生产验证。[记录](implementation/evidence/UAT-125_212_250_FAILURE_CONVERGENCE_20260922.md)。


发布拆分：诊断、列表、预检不改 registry，已交付；Provider 30/120秒退避仅在独立提交 `7123117d6`，会改变 catalog，既有 witness 不支持，未整合或发布。不得将空库E2E当作旧286计划兼容证据。

2026-09-22：白名单网络诊断贯通 Secret/Outcome；Formation 刷新后移除已结束条目并修正活动计数/分页；预检本地 30 秒上限、取消与技术失败区分。本地专项 71 PASS/1 BDMV 样本缺失跳过，架构 239 文件及边界/manifest/contract 门禁通过；尚未发布或生产 UAT，Linux/QSV待验证。[证据](implementation/evidence/UAT-125_212_250_FAILURE_CONVERGENCE_20260922.md)。

2026-09-20：UAT-262精确工程清理98目标后vol1由100%降至57%、可用约75G；运行数据和必要回退资料保留。UAT-263/264统一Workspace及回收修复本地/候选Linux检查通过；副本确认黑寡妇旧Effect/Case正式终结，但复制挂载身份阻止物理回收，未通过完整门禁。生产另有3个历史NFO身份漂移的人工恢复合同待确认，故未切盘/发布，生产仍286。三个条目及251主线接续见[本批证据](implementation/evidence/UAT-251_ACCEPTED_DEFECT_RECOVERY_20260912.md#2026-09-20-uat-262263264-授权实施)。

更新：2026-09-12。唯一条目及关闭条件入口为[UAT总表](UAT_ITERATION_REGISTER.md)，唯一排程为[CURRENT_PLAN](CURRENT_PLAN.md)。261项连续：73项本轮功能验收关闭、32项开放、153项历史关闭、220文档关闭、1项非缺陷接受、206被取代且承接已核实。历史关闭不是本次重新验收。

255项前后合同审查及三项用户决定已完成，SSOT/Beta已在`14cf2d9a0`同步。已无这三项待确认决定；合同确认不等于实现或验收。审查及覆盖关系见[全量证据](implementation/evidence/UAT_FULL_CONTRACT_CONSISTENCY_AUDIT_20260909.md)。

2026-09-13 00:04，UAT-251修复`e7c84dd536`已整合并构建上传候选镜像，Linux专项26/26、真实评分公共端口122批量/19详情及完整Host启动/旧286回退通过，生产仍286。正式接口副本收尾暴露《拆弹部队》旧transcode Effect为reconcile_required，Case持续draining；另外8 Case已正式unresolved，18项新检查观察已运行、提交仍待资源。**候选尚不满足完整收尾门禁，暂停生产apply，已交原开发任务补修**；不Reset、不改写历史Effect或媒体。完整备份和精确现场见[修正证据](implementation/evidence/UAT-251_ACCEPTED_DEFECT_RECOVERY_20260912.md#联合部署验证与收尾阻塞)。

## 当前生产

- 最新镜像：`markmahoro/shelfdeck:helix-beta-20260922-459efebbf2`；source `459efebbf29beb039d687493f94f9f6bd659b315`；Config ID `sha256:7b3909e86a92d0842961b66d8efec255ab81c62083f74ea310da30ade8e2769c`。
- tar SHA256：`17bb070151105b8bc55f924f65d56244745511496e2f097a6883c34e0201f768`；StartedAt `2026-09-22T13:07:43.182908298Z`，restartCount 0。标准build/upload/checksum/dry-run/apply完成，44文件完整在线备份、候选旧库Host及同数据19回退通过。Windows150及Linux147适用项/仓库审计3项与生产保护通过；新片完整媒体E2E和局内人旧收藏手动修复未执行。

以下保留此前生产事件，不覆盖以上最新身份。

2026-09-12 22:33《人生密密缝》获用户“确认”后已执行精确生产清理：唯一旧重复主片完整备份校验后移出Material Field，正式Formation Reset清理旧Subject及23 Works、1 Workspace；冻结manifest一致。原122收藏、Inventory/immutable Candidate等9表、范围外Control及其他3 Token不变；包含正式主片在内的其余9文件逐项完整SHA256、inode和元数据不变。14:32:43Z活动整理查询已无本片旧条目，原正式Entry仍active/healthy、Inventory revision 11，服务正常。**旧候选仍open、Reservation待结束、Receipt尚未生成，当前3席位满；正式缺失拒绝/ACK仅在副本通过，生产最终后台收尾尚待正常队列。** 不提高席位、不清理其他任务、不重新创建定时任务。备份及边界见[获授权生产清理结果](implementation/evidence/UAT-125_250_INTAKE_RECOVERY_20260912.md#人生密密缝获授权生产清理结果)。

2026-09-12 20:59（北京时间）联合版本已标准发布成功，UAT-251、125/250接收恢复交付、260大Run重试及261启动/恢复修复已上线。定时任务保持停止。

13:33Z《宇航员》本次精确生产清理及正式闭环完成。用户针对这一个新增Token及2旧Work明确回复“允许”；停服后完整备份、重新核验同一冻结manifest，再使用正式Formation Reset删除精确技术闭包。80张Arca/Procurement/Control表、另外2Token逐字保留，Subject/Run/Workspace/Control/收藏删除0。没有扩大到其他条目、主动扫描或恢复旧DB。

同286镜像重启后，新Control Evidence正式判定原候选失配，Rejected Receipt/Effect/marker、Outbox ACK、Inbox与独立重算Closure吻合，5项Reservation释放、目标Token消失。13:34Z正常队列已接入另一新任务；原122收藏及970包/1338主材料保留。ready后观察60s无原`P8_INTAKE_CONTROL_RESULT_INVALID`，health/Admin正常。AbortSignal listener警告仍有6次，原因尚未证实，未提高阈值掩盖；125/250整体仍开放。具体授权、备份和验证见[生产清理结果](implementation/evidence/UAT_RELEASE_286FE56F1E_20260912.md#获授权生产精确清理结果)。

- 镜像：`markmahoro/shelfdeck:helix-beta-20260912-286fe56f1e`；source `286fe56f1e4c5c74ae845584f29b997597415f9c`；NAS Config ID `sha256:16aa204ffda72363b68f03c7ad720c1ed73f0baf990b5c113c468f98623e3083`。
- tar SHA256：`43dd75c9f2510dc246a38c6a00cd1a506db77fec14402a2aaf73b49f1516ca7e`；本片精确Reset后StartedAt `2026-09-12T14:31:12.085895511Z`。原build/upload/checksum/dry-run/apply完成，本次镜像未变。14:33Z health/normalSupply正常，restartCount0，五挂载/QSV/compose/Secret/root权限/fnOS及其他容器保持；ready后60s无原Control错误或error日志，AbortSignal listener警告11次仍未定位。
- 13:00Z生产health200、normalSupplyAllowed=true、Admin Web及六路Admin接口200；197表、quick_check ok/FK0，五挂载/QSV、Secret root、fnOS管理页200保持。
- 13:34:45Z原122收藏/Deck Fact/Commit、970包、1338主材料逐行missing0/changed0；8份旧Rejected及原38 Effects（23 reconcile_required）/Events不变。当前Delivery=139 accepted/822 open/9 rejected；仅新增《宇航员》正式拒绝，另1项由正常队列接收。自动瑕疵授权尚未开启，验收未擅自改变授权。
- 精确镜像Linux Foundation119/119、Retry28/28、真实媒体自动瑕疵上架→手动海报修复→重启链通过。完整新副本Host、备用镜像切换、再切回正式版本均在同一升级后数据上通过，8组保护表不变；8270个Plan含4个新d8 Plan在备用切换中逐字保留。
- 已验证同格式备用`e056c64aff`，完整45文件及compose/secret备份保留。旧cd4f不能读取197表/d8，不得直接用旧DB覆盖升级后事实。具体回退范围与SHA见[发布证据](implementation/evidence/UAT_RELEASE_286FE56F1E_20260912.md)。

发布本身未Reset；随后新增获授权的《宇航员》单Token清理及闭环已经完成。《人生密密缝》的旧重复流程现已精确清理，健康正式收藏保留，后台旧候选终结仍待正常队列；NFO与poster未隔离。251完整生产业务/UI验收及125/250其他存量责任仍分别跟进；上线不代表所有历史问题已解决。此前失败、完整副本与修复过程保留在[261记录](implementation/evidence/UAT-261_CATALOG_STARTUP_DEPLOYMENT_20260912.md)。

## 最近验收与开放事实

UAT-260已独立验收关闭：真实601/574成员隔离Retry保留全成员且Plan仅1333/1339 bytes；1/1024边界、1025拒绝、失败/重启/Outbox幂等和62表保护通过。Windows70及最终镜像Linux28通过，286标准发布及生产健康/持久事实保护通过；未在生产人为触发Retry。[本项证据](implementation/evidence/UAT-260_LARGE_RUN_RETRY_INPUT_20260912.md)。

UAT-261已独立验收关闭：286fe56f1e生产完整Host正常，health200/normalSupplyAllowed=true；最新完整副本升级、同格式备用及切回验证通过，8270 Plan含新d8逐字保留，38历史Effects/Events与122收藏保留。不改旧digest、不扩Reset、不屏蔽校验；历史Run业务恢复仍归125/250。[本项证据](implementation/evidence/UAT-261_CATALOG_STARTUP_DEPLOYMENT_20260912.md)。

UAT-251核心与指定UI负责人认可的最终页面已随286发布；Windows/Linux真实媒体自动瑕疵上架、手动修复、剩余Gap及重启、无Provider有限重查和Freshness耗尽已有源证据，最终镜像实际媒体链通过。生产授权读取正常且尚未启用；完整生产业务/UI验收继续，保持开放。[本项证据](implementation/evidence/UAT-251_TERMINAL_OUTCOME_AUDIT_20260908.md)。

UAT-125/250恢复与正式Control拒绝链已随286发布。历史原两Token Reset已执行且不重复；现有旧条目仍按当前Owner责任和精确材料证据处理，不能把新版本正常启动写成存量全部恢复。《人生密密缝》获授权的旧重复流程清理已执行，正式收藏健康，旧候选尚待排队终结；原NFO/poster隔离方案已停止。[恢复证据](implementation/evidence/UAT-125_250_INTAKE_RECOVERY_20260912.md)、[存量治理](implementation/evidence/UAT-250_FORMATION_STOCK_GOVERNANCE_20260908.md)。

UAT-259已独立验收关闭：最终Web94/94，本地494元素一致，cd4f3f5b2d生产八页/五设置Tab布局、状态和必要交互复核通过；九列表格保持。[本项证据](implementation/evidence/UAT-259_UI_REFINEMENT_20260912.md)。

UAT-257已独立验收关闭：cd4f3f5b2d生产正常扫描73页成功；6片新资格及新Package/Delivery已核验，8份旧Rejected记录不变，970=834等待+128接收+8拒绝。[本项证据](implementation/evidence/UAT-257_PROCUREMENT_REJECTION_CYCLE_20260912.md)。

UAT-258已独立验收关闭：本地真实Host授权/撤销、错误恢复及键盘通过；cd4f3f5b2d生产入口/范围/取消/返回焦点通过，正式授权revision1保持不变。[本项证据](implementation/evidence/UAT-258_RESIDUAL_CLEANUP_AUTHORIZATION_BUTTON_20260912.md)。

UAT-256全页面UI polish已本地实现并通过89项前端测试及桌面八页走查；整理列表478个元素内容与尺寸对照0差异。文件来源已取消全局汇总，统一卡片、按钮、字号及状态色；按用户补充移除技术标识/原始代码，并将必要失败原因改为中文，补充复查通过。已完成83235c9260生产验收并关闭，见[本轮证据](implementation/evidence/UAT-256_UI_POLISH_20260912.md)。

218已按[Windows NVENC / 同版Linux CPU真实维护验收](implementation/evidence/UAT-218_AFTERCARE_QUALITY_FLOOR_20260908.md)关闭：质量下限、实际超限拒绝、失败保原片及重启通过。此次只增加测试和Evidence，生产镜像不变。并发标准变更期间旧Assessment不能正常提交/收尾的隔离复现仍由210/125修复；251仍未完成。

156/157按[真实CPU/QSV资格、源预检与双遍生产验收](implementation/evidence/UAT-156_157_DEVICE_PIPELINE_ACCEPTANCE_20260909.md)分别关闭。修复x265统计参数与自检提前清理，最终镜像实际硬件复验通过，没有恢复旧跳转硬解。

169已按[真实QSV长片及硬截止/停机验收](implementation/evidence/UAT-169_LONG_TRANSCODE_ACCEPTANCE_20260909.md)独立关闭，未用单测代替长片证据；125/127仍按自身条件开放。

226的新旧完成依据、233的1440/1280/390响应式、234的统计与筛选已按[生产页面证据](implementation/evidence/UAT-226_233_FORMATION_BROWSER_20260909.md)分别关闭。245已按[独立快照与有界读取验收](implementation/evidence/UAT-245_OVERVIEW_PROJECTION_ACCEPTANCE_20260909.md)关闭：生产30次GET p95约4.7ms，最终镜像100次请求内领域仓储调用0；141失败状态保护通过。240/241/248已按[八页按钮与视觉验收](implementation/evidence/UAT-240_241_248_BROWSER_ACCEPTANCE_20260909.md)分别关闭；无产品代码或合同变更。247跨页缓存条件仍开放。

159/163已按真实Movie放弃及成功上架后的Workspace回收、partial清理、真实进程退出恢复和重启稳定分别关闭，见[验收](implementation/evidence/UAT-159_163_WORKSPACE_RECLAIM_20260909.md)。标准NAS发布与镜像内部代码复验通过；125/152联合压力与更广恢复仍开放。165亦已按[独立进程恢复与未决Effect保护](implementation/evidence/UAT-165_PROCESS_RECOVERY_ACCEPTANCE_20260909.md)关闭。

171按当前NFO Oracle独立关闭，Windows/Linux真实媒体改写后健康正常、记录刷新且不产生修复Case，原片及Accepted Product Facts保留，见[171证据](implementation/evidence/UAT-171_NFO_CURRENT_CONTRACT_ACCEPTANCE_20260909.md)。135/136按真实ISO完整链及生产发布分别关闭，见[135/136证据](implementation/evidence/UAT-135_136_ISO_SOURCE_ACCEPTANCE_20260909.md)。132按Windows/Linux真实Direct HEVC完整链独立关闭，没有转码或重封装，见[132证据](implementation/evidence/UAT-132_DIRECT_UNKNOWN_ACCEPTANCE_20260909.md)。137/160已按独立真实媒体正负路径关闭，Windows及生产同版Linux各30项通过，见[137/160证据](implementation/evidence/UAT-137_160_FRESH_MEDIA_ACCEPTANCE_20260909.md)。210完整关闭条件仍未满足。

172已独立关闭：正式持续授权、逐Scope持久Approval及删除前当前授权核验接通；Windows/Linux真实链、撤销/重启/范围不足负向、正式浏览器与生产新镜像复核通过。生产原授权revision 1及79收藏保持不变，见[验收](implementation/evidence/UAT-172_AUTHORIZATION_ACCEPTANCE_20260909.md)。134已完成同根精确范围、负向与端口重建重放验收，见[134证据](implementation/evidence/UAT-134_SCOPED_SETTLEMENT_ACCEPTANCE_20260909.md)。158已完成采样中时间戳变化与真实内容漂移的正负验收，见[158证据](implementation/evidence/UAT-158_STAGE_TIMESTAMP_ACCEPTANCE_20260909.md)。138已完成单Movie真实全链及未知/后生文件保护验收，见[138证据](implementation/evidence/UAT-138_THUMBS_MOVIE_ACCEPTANCE_20260909.md)。225/229/231/244/249已按[生产浏览器证据](implementation/evidence/UAT_SETTINGS_BROWSER_ACCEPTANCE_20260909.md)分别关闭。无新的用户待决策项。

251实现与125/250正式拒绝链已部署，剩余业务验收及存量责任见本页最新记录；不重复历史Reset，不手改Control，216样片及另一完整1080p版本保持原状。

此前逐项流水及旧时点状态保留在[整理前历史快照](implementation/evidence/UAT_STATUS_SNAPSHOT_BEFORE_172_20260909.md)，每项验收证据由总表链接；旧“最新发布”“仍开放”等措辞不覆盖本页和总表。
