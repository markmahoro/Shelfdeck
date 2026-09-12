# ShelfDeck 当前状态

更新：2026-09-12。唯一条目及关闭条件入口为[UAT总表](UAT_ITERATION_REGISTER.md)，唯一排程为[CURRENT_PLAN](CURRENT_PLAN.md)。261项连续：73项本轮功能验收关闭、32项开放、153项历史关闭、220文档关闭、1项非缺陷接受、206被取代且承接已核实。历史关闭不是本次重新验收。

255项前后合同审查及三项用户决定已完成，SSOT/Beta已在`14cf2d9a0`同步。已无这三项待确认决定；合同确认不等于实现或验收。审查及覆盖关系见[全量证据](implementation/evidence/UAT_FULL_CONTRACT_CONSISTENCY_AUDIT_20260909.md)。

## 当前生产

2026-09-12 20:59（北京时间）联合版本已标准发布成功，UAT-251、125/250接收恢复交付、260大Run重试及261启动/恢复修复已上线。定时任务保持停止。

- 镜像：`markmahoro/shelfdeck:helix-beta-20260912-286fe56f1e`；source `286fe56f1e4c5c74ae845584f29b997597415f9c`；NAS Config ID `sha256:16aa204ffda72363b68f03c7ad720c1ed73f0baf990b5c113c468f98623e3083`。
- tar SHA256：`43dd75c9f2510dc246a38c6a00cd1a506db77fec14402a2aaf73b49f1516ca7e`；StartedAt `2026-09-12T12:58:18.874868645Z`。build/upload/checksum/dry-run/apply完成。
- 13:00Z生产health200、normalSupplyAllowed=true、Admin Web及六路Admin接口200；197表、quick_check ok/FK0，五挂载/QSV、Secret root、fnOS管理页200保持。
- 原122收藏/Deck Fact/Commit、970包、1338主材料逐行missing0/changed0；8份旧Rejected及原38 Effects（23 reconcile_required）/Events不变。当前Delivery=138 accepted/824 open/8 rejected。自动瑕疵授权尚未开启，验收未擅自改变授权。
- 精确镜像Linux Foundation119/119、Retry28/28、真实媒体自动瑕疵上架→手动海报修复→重启链通过。完整新副本Host、备用镜像切换、再切回正式版本均在同一升级后数据上通过，8组保护表不变；8270个Plan含4个新d8 Plan在备用切换中逐字保留。
- 已验证同格式备用`e056c64aff`，完整45文件及compose/secret备份保留。旧cd4f不能读取197表/d8，不得直接用旧DB覆盖升级后事实。具体回退范围与SHA见[发布证据](implementation/evidence/UAT_RELEASE_286FE56F1E_20260912.md)。

本批不执行Reset、旧Token治理或冲突文件隔离；指定历史《人生密密缝》仍blocked/Commit0，已核实的当前Owner引用不能按旧清单隔离。251完整生产业务/UI验收及125/250存量治理仍分别跟进；上线不代表所有历史问题已解决。此前失败、完整副本与修复过程保留在[261记录](implementation/evidence/UAT-261_CATALOG_STARTUP_DEPLOYMENT_20260912.md)。

## 最近验收与开放事实

UAT-260已独立验收关闭：真实601/574成员隔离Retry保留全成员且Plan仅1333/1339 bytes；1/1024边界、1025拒绝、失败/重启/Outbox幂等和62表保护通过。Windows70及最终镜像Linux28通过，286标准发布及生产健康/持久事实保护通过；未在生产人为触发Retry。[本项证据](implementation/evidence/UAT-260_LARGE_RUN_RETRY_INPUT_20260912.md)。

UAT-261已独立验收关闭：286fe56f1e生产完整Host正常，health200/normalSupplyAllowed=true；最新完整副本升级、同格式备用及切回验证通过，8270 Plan含新d8逐字保留，38历史Effects/Events与122收藏保留。不改旧digest、不扩Reset、不屏蔽校验；历史Run业务恢复仍归125/250。[本项证据](implementation/evidence/UAT-261_CATALOG_STARTUP_DEPLOYMENT_20260912.md)。

2026-09-12 UAT-251：`eae6bb3da` 核心实现、`874172bc6` 合并最新页面与 261 契约；指定 UI 负责人已通过最终本地 1920×1080 图片复核。Windows/Linux 真实媒体自动瑕疵上架、手动海报修复及剩余瑕疵/重启验证通过，合并后 Web105通过。197表原业务数据保持验证已完成；最终联合 Catalog witness、完整 Host 与生产验收交部署任务，仍开放、未独立部署。[证据](implementation/evidence/UAT-251_TERMINAL_OUTCOME_AUDIT_20260908.md)。

2026-09-12 UAT-251交付状态：此前无Integration的有限终局及Freshness耗尽无blockedWorks两项缺口，源任务现已接通并获定向证据。无资料Provider使用独立Libra观察，按首见后1/5/15/30/60分钟最多五次重查，重启不重置；受控时钟完整HTTP链实际安全媒体瑕疵上架186.4秒通过。Freshness五次耗尽分支已走到责任收尾，修复Discard序列化BigInt后专项通过。独立`libra_strategy_availability`使最终目标从196变为197表，DDL `854c22240e01915f777958ec490bf1ebad6dcc4a92f4bd6f2f032d32ac2d1312`；此前45文件副本189→196升级/异常回滚、188原业务表摘要不变、118收藏/7份admin放弃保留仅属中间版本证据，197版须补验。真实瑕疵上架/手动修复/重启及失败重试防循环已有源测试证据；尚无最终提交，仍需最终197升级/回滚、UI负责人要求的1920×1080同数据前后对照/收藏详情及Linux差异验证。精确合并Catalog和完整Host由部署任务验收。

UAT-261源任务只读核查：4个已Commit Run的历史Receipt固定Inventory/DeckFact=1/1，原读取入口误用当前Inventory版本5/2/5/5。独立历史读取按Receipt的精确版本执行原完整摘要校验后4项全部通过，20项旧删除及20项后继输入/意图摘要和实际后继完成链已匹配。源提交e1bbc467a已合入4f6953ad1，干净发布树Catalog/Owner history/startup/runtime Host针对性104/104通过。另3项stage明确unsupported并继续阻断；未重复构建已知仍受阻的新镜像，精确镜像的已验证结果仍是上述d5的7项阻断，不提前改写为启动成功。

2026-09-12新增UAT-260：隔离演练中大Run FailedPreparationRetry将完整DTO内联至Plan，触发16 KiB CHECK；SSOT要求typed binding refs，禁止扩大上限或旧Work fallback。正常恢复链用修正BigInt桥另建副本继续；重试缺陷单独修复验收，生产未变更。见[缺陷证据](implementation/evidence/UAT-260_LARGE_RUN_RETRY_INPUT_20260912.md)。


UAT-125/250第一批9820e7b85核心已部署；原两Token精确Reset已执行，《人生密密缝》尚未处置。第二批9ecf7b2a1/d591d6867正式Control拒绝链已合入d7a6da2802；独立发布区Windows组合38/38、完整架构1647通过/9既有跳过/0失败，DDL不变。候选镜像Linux117/117及最新副本完整scoped正常链通过；实际发布在完整Host启动失败并回退，接续261修复，不重复原两Token Reset。原备份820个open Offer中815匹配、5个失配共23项，7组保护表未变；这是旧副本只读分类，不是当前NAS统计或旧队列完整恢复，125/250保持开放。[实现证据](implementation/evidence/UAT-125_250_INTAKE_RECOVERY_20260912.md)、[集成验证](implementation/evidence/UAT_JOINT_DEPLOYMENT_READINESS_20260912.md)。

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

251的三终局、仅手动修复已接受瑕疵、健康正常另附标记及typed合同已确认，DTO/持久化/执行接入与验收仍在实施。125/250输入稳定核心已部署；旧Control失配正式拒绝链与精确生产恢复仍未完成。没有Reset或手改Control；216样片及另一完整1080p版本保持原状。

此前逐项流水及旧时点状态保留在[整理前历史快照](implementation/evidence/UAT_STATUS_SNAPSHOT_BEFORE_172_20260909.md)，每项验收证据由总表链接；旧“最新发布”“仍开放”等措辞不覆盖本页和总表。
