# ShelfDeck 当前状态

更新：2026-09-12。唯一条目及关闭条件入口为[UAT总表](UAT_ITERATION_REGISTER.md)，唯一排程为[CURRENT_PLAN](CURRENT_PLAN.md)。261项连续：71项本轮功能验收关闭、34项开放、153项历史关闭、220文档关闭、1项非缺陷接受、206被取代且承接已核实。历史关闭不是本次重新验收。

255项前后合同审查及三项用户决定已完成，SSOT/Beta已在`14cf2d9a0`同步。已无这三项待确认决定；合同确认不等于实现或验收。审查及覆盖关系见[全量证据](implementation/evidence/UAT_FULL_CONTRACT_CONSISTENCY_AUDIT_20260909.md)。

## 当前生产

2026-09-12 10:35Z：261精确修复镜像`d5c00f0cc4`已构建、Linux84/84通过，最新完整副本的全Host阻断由4764项降至预期7项未决物理Plan，保护事实hash不变、quick_check ok/FK0。完整架构唯一旧digest断言已更新并定向3/3复验；7项Owner责任尚待正式收口，未生产部署，生产仍为以下cd4f健康版本。详见[集成验证](implementation/evidence/UAT-261_CATALOG_STARTUP_DEPLOYMENT_20260912.md#uat-261-精确镜像集成验证)。

2026-09-12 09:49Z人工续接复查：仍为下列cd4f回退镜像及同一StartedAt，NAS/LAN health均ok、normalSupplyAllowed=true，五挂载、Secret root匹配和fnOS 200通过。正常队列现为118收藏、970份Delivery（828 open/134 accepted/8 rejected），最新普通扫描revision1368–1440共73页succeeded；以下113收藏等数字为上次发布时点。当前Token集合已变化，原宇航员subject ID也已被旧版重新取得，不能凭同一ID重复历史Reset。09:52Z新完整45文件一致副本已下载并逐文件验hash，261完整Host门禁继续，未再次部署，定时任务保持停止。

2026-09-12第二批d7a6da2802发布失败：数据库readiness通过，但完整Host因大量历史PLAN_CATALOG_DRIFT未启动。已标准回退cd4f3f5b2d，StartedAt2026-09-11T21:32:51.809272745Z，健康/五挂载/fnOS/113收藏及970份Delivery复核通过。此前原两Token精确Reset已执行且保留，未恢复DB；5旧Offer仍open，旧版已产生新Token，不得扩大或复用旧Reset范围。新增261优先定位启动合同与补完整Host门禁，260随后，251独立。[事故记录](implementation/evidence/UAT-261_CATALOG_STARTUP_DEPLOYMENT_20260912.md)。

- 镜像：markmahoro/shelfdeck:helix-beta-20260912-cd4f3f5b2d；source cd4f3f5b2d；NAS Config Image ID sha256:f4d48cd326dba8b551af63fad7c3ce0ffdc0b3040c43c6153d1987cbc9a13452。
- tar SHA256：4d3f1b1c51d47d10bb2d3afaa5ce1b4cb6a63586b4a8887a458f8f72ec4beaed；当前回退StartedAt 2026-09-11T21:32:51.809272745Z（首批启动时间见历史证据）。标准发布、45文件完整备份与SQLite校验、五挂载/健康/fnOS管理页通过；83235c9260镜像及tar保留回滚。
- 最终Web94/94、Linux适用39/39及生产八页/五设置Tab复核通过。正常启动扫描完成73页、revision1222–1294，新Work succeeded；六条当前主文件资格变为eligible并由普通选材产生新Package/open Delivery，257已关闭。发布后初次113收藏、956包=820等待+128接收+8拒绝；原拒绝记录及自动清理授权revision1不变，Fast X继续处理中。
- Linux广测23项Reset夹具被正式/transcode限定拦下，未放宽安全限制；既有4项架构合同生成基线失败/121项drift保留。本批没有schema/typed合同变化，也未重跑完整真实媒体E2E。历史两席位和《人生密密缝》仍待精确恢复，不宣称业务全绿。详见[本批发布证据](implementation/evidence/UAT_RELEASE_CD4F3F5B2D_20260912.md)。

## 最近验收与开放事实

2026-09-12交付状态澄清：UAT-251尚有两项功能缺口，不能描述为仅剩最终验收：无可用Integration的`waiting_external_integration`有限终局，以及Freshness耗尽且无blockedWorks的冻结分支。真实瑕疵上架/手动修复/重启、播放失败终局与手动重试防循环已获源任务测试证据；完整45文件副本189→196表升级与异常回滚、188张原业务表逐行摘要不变、118收藏和7份admin放弃记录保留均通过，但尚无最终提交。两项功能完成后还需UI负责人要求的1920×1080同数据前后对照/收藏详情及Linux最终验证，精确合并Catalog和完整Host由部署任务验收。

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
