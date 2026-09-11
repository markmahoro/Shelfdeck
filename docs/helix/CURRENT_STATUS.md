# ShelfDeck 当前状态

更新：2026-09-12。唯一条目及关闭条件入口为[UAT总表](UAT_ITERATION_REGISTER.md)，唯一排程为[CURRENT_PLAN](CURRENT_PLAN.md)。259项连续：70项本轮功能验收关闭、33项开放、153项历史关闭、220文档关闭、1项非缺陷接受、206被取代且承接已核实。历史关闭不是本次重新验收。

255项前后合同审查及三项用户决定已完成，SSOT/Beta已在`14cf2d9a0`同步。已无这三项待确认决定；合同确认不等于实现或验收。审查及覆盖关系见[全量证据](implementation/evidence/UAT_FULL_CONTRACT_CONSISTENCY_AUDIT_20260909.md)。

## 当前生产

- 镜像：markmahoro/shelfdeck:helix-beta-20260912-cd4f3f5b2d；source cd4f3f5b2d；NAS Config Image ID sha256:f4d48cd326dba8b551af63fad7c3ce0ffdc0b3040c43c6153d1987cbc9a13452。
- tar SHA256：4d3f1b1c51d47d10bb2d3afaa5ce1b4cb6a63586b4a8887a458f8f72ec4beaed；StartedAt 2026-09-11T20:28:03.909028638Z。标准发布、45文件完整备份与SQLite校验、五挂载/健康/fnOS管理页通过；83235c9260镜像及tar保留回滚。
- 最终Web94/94、Linux适用39/39及生产八页/五设置Tab复核通过。正常启动扫描完成73页、revision1222–1294，新Work succeeded；六条当前主文件资格变为eligible，继续核对普通选材结果。发布后初次113收藏、956包=820等待+128接收+8拒绝；原拒绝记录及自动清理授权revision1不变，Fast X继续处理中。
- Linux广测23项Reset夹具被正式/transcode限定拦下，未放宽安全限制；既有4项架构合同生成基线失败/121项drift保留。本批没有schema/typed合同变化，也未重跑完整真实媒体E2E。历史两席位和《人生密密缝》仍待精确恢复，不宣称业务全绿。详见[本批发布证据](implementation/evidence/UAT_RELEASE_CD4F3F5B2D_20260912.md)。

## 最近验收与开放事实

UAT-125/250核心9820e7b85已由203773327合入集成分支：新Intake恢复输入稳定、精确pre-Subject Reset闭包和《人生密密缝》两文件离线隔离/回滚工具已完成。独立发布区49项专项通过；开发任务的Windows/Linux验证、一致备份副本演练及生产两文件只读预检见[实现证据](implementation/evidence/UAT-125_250_INTAKE_RECOVERY_20260912.md)。核心已随cd4f3f5b2d部署，离线隔离工具未执行；5份旧Candidate共23项Control不符，正式拒绝链正在按已审定窄合同实施，仍阻塞完整席位恢复，不执行生产两席位Reset，不宣称该片已上架或3席位有效周转。[联合收口证据](implementation/evidence/UAT_JOINT_DEPLOYMENT_READINESS_20260912.md)。

UAT-259已独立验收关闭：最终Web94/94，本地494元素一致，cd4f3f5b2d生产八页/五设置Tab布局、状态和必要交互复核通过；九列表格保持。[本项证据](implementation/evidence/UAT-259_UI_REFINEMENT_20260912.md)。

UAT-257扫描恢复已部署：正常新扫描完成73页，原失败历史保留，页面由扫描中转完成，六条资格已刷新。后续普通选材及新Package/Delivery仍逐项核对，整项开放。[实现及验收](implementation/evidence/UAT-257_SCAN_RECOVERY_IMPLEMENTATION_20260912.md)。

UAT-258已独立验收关闭：本地真实Host授权/撤销、错误恢复及键盘通过；cd4f3f5b2d生产入口/范围/取消/返回焦点通过，正式授权revision1保持不变。[本项证据](implementation/evidence/UAT-258_RESIDUAL_CLEANUP_AUTHORIZATION_BUTTON_20260912.md)。

UAT-257实现`0aabaa1ca`：拒绝终结旧包、释放材料回普通选材及累计包统计口径；与UAT-256任务完成来源卡片UI协调。138项领域测试、2项既有旅程和新拒绝闭环样例通过，89项前端测试、构建及隔离页面核对通过；已联合部署，后续正常扫描验收仍开放，见[证据](implementation/evidence/UAT-257_PROCUREMENT_REJECTION_CYCLE_20260912.md)。

UAT-256全页面UI polish已本地实现并通过89项前端测试及桌面八页走查；整理列表478个元素内容与尺寸对照0差异。文件来源已取消全局汇总，统一卡片、按钮、字号及状态色；按用户补充移除技术标识/原始代码，并将必要失败原因改为中文，补充复查通过。已完成83235c9260生产验收并关闭，见[本轮证据](implementation/evidence/UAT-256_UI_POLISH_20260912.md)。

218已按[Windows NVENC / 同版Linux CPU真实维护验收](implementation/evidence/UAT-218_AFTERCARE_QUALITY_FLOOR_20260908.md)关闭：质量下限、实际超限拒绝、失败保原片及重启通过。此次只增加测试和Evidence，生产镜像不变。并发标准变更期间旧Assessment不能正常提交/收尾的隔离复现仍由210/125修复；251仍未完成。

156/157按[真实CPU/QSV资格、源预检与双遍生产验收](implementation/evidence/UAT-156_157_DEVICE_PIPELINE_ACCEPTANCE_20260909.md)分别关闭。修复x265统计参数与自检提前清理，最终镜像实际硬件复验通过，没有恢复旧跳转硬解。

169已按[真实QSV长片及硬截止/停机验收](implementation/evidence/UAT-169_LONG_TRANSCODE_ACCEPTANCE_20260909.md)独立关闭，未用单测代替长片证据；125/127仍按自身条件开放。

226的新旧完成依据、233的1440/1280/390响应式、234的统计与筛选已按[生产页面证据](implementation/evidence/UAT-226_233_FORMATION_BROWSER_20260909.md)分别关闭。245已按[独立快照与有界读取验收](implementation/evidence/UAT-245_OVERVIEW_PROJECTION_ACCEPTANCE_20260909.md)关闭：生产30次GET p95约4.7ms，最终镜像100次请求内领域仓储调用0；141失败状态保护通过。240/241/248已按[八页按钮与视觉验收](implementation/evidence/UAT-240_241_248_BROWSER_ACCEPTANCE_20260909.md)分别关闭；无产品代码或合同变更。247跨页缓存条件仍开放。

159/163已按真实Movie放弃及成功上架后的Workspace回收、partial清理、真实进程退出恢复和重启稳定分别关闭，见[验收](implementation/evidence/UAT-159_163_WORKSPACE_RECLAIM_20260909.md)。标准NAS发布与镜像内部代码复验通过；125/152联合压力与更广恢复仍开放。165亦已按[独立进程恢复与未决Effect保护](implementation/evidence/UAT-165_PROCESS_RECOVERY_ACCEPTANCE_20260909.md)关闭。

171按当前NFO Oracle独立关闭，Windows/Linux真实媒体改写后健康正常、记录刷新且不产生修复Case，原片及Accepted Product Facts保留，见[171证据](implementation/evidence/UAT-171_NFO_CURRENT_CONTRACT_ACCEPTANCE_20260909.md)。135/136按真实ISO完整链及生产发布分别关闭，见[135/136证据](implementation/evidence/UAT-135_136_ISO_SOURCE_ACCEPTANCE_20260909.md)。132按Windows/Linux真实Direct HEVC完整链独立关闭，没有转码或重封装，见[132证据](implementation/evidence/UAT-132_DIRECT_UNKNOWN_ACCEPTANCE_20260909.md)。137/160已按独立真实媒体正负路径关闭，Windows及生产同版Linux各30项通过，见[137/160证据](implementation/evidence/UAT-137_160_FRESH_MEDIA_ACCEPTANCE_20260909.md)。210完整关闭条件仍未满足。

172已独立关闭：正式持续授权、逐Scope持久Approval及删除前当前授权核验接通；Windows/Linux真实链、撤销/重启/范围不足负向、正式浏览器与生产新镜像复核通过。生产原授权revision 1及79收藏保持不变，见[验收](implementation/evidence/UAT-172_AUTHORIZATION_ACCEPTANCE_20260909.md)。134已完成同根精确范围、负向与端口重建重放验收，见[134证据](implementation/evidence/UAT-134_SCOPED_SETTLEMENT_ACCEPTANCE_20260909.md)。158已完成采样中时间戳变化与真实内容漂移的正负验收，见[158证据](implementation/evidence/UAT-158_STAGE_TIMESTAMP_ACCEPTANCE_20260909.md)。138已完成单Movie真实全链及未知/后生文件保护验收，见[138证据](implementation/evidence/UAT-138_THUMBS_MOVIE_ACCEPTANCE_20260909.md)。225/229/231/244/249已按[生产浏览器证据](implementation/evidence/UAT_SETTINGS_BROWSER_ACCEPTANCE_20260909.md)分别关闭。无新的用户待决策项。

251的三终局、仅手动修复已接受瑕疵、健康正常另附瑕疵标记及typed合同已确认；DTO/持久化/执行接入与验收尚未完成。125/250的`P4_EVENT_RECOVERY_INPUT_DRIFT`已定位同一旧Intake Continuity Head从827变830造成输入漂移；修复及生产治理尚未完成，没有Reset或手改Control。216样片及另一完整1080p版本保持原状。

此前逐项流水及旧时点状态保留在[整理前历史快照](implementation/evidence/UAT_STATUS_SNAPSHOT_BEFORE_172_20260909.md)，每项验收证据由总表链接；旧“最新发布”“仍开放”等措辞不覆盖本页和总表。
