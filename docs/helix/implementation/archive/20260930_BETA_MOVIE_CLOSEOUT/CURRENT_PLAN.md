# ShelfDeck 当前迭代计划

2026-09-28 新增 UAT-275/276/277：修复今日上架失败，基线07172d4c15→c147188485已通过Windows/Linux、完整副本候选/回退及标准生产发布；原失败片正式重处理及网络瞬断根因待验，不扩大Reset或媒体处置授权。

2026-09-28 用户已确认补充发布边界：冻结旧合同只读验证终态历史，原记录与摘要不变，新任务严格使用新合同；补齐不丢事实的有界回退验证后继续标准部署。用户另明确旧的已瑕疵上架条目不再修复：本轮不追溯重加工、不撤销上架、不因新接纳标准触发历史瑕疵修复。该限制不取消发布门禁，也不授权生产Reset或覆盖恢复。

2026-09-28 UAT-251/274最终发布门禁：12ac3ec725已构建/上传，Windows与Linux新增功能验证通过；完整生产副本启动被13683条历史PLAN_CATALOG_DRIFT阻断，旧镜像对升级schema回退也拒绝。生产仍69a82f2a5d且健康，未apply/Reset。历史合同只读证明及结构回退边界已获用户确认，待实现验证，详见同项审计末节；下方“验证中”为此前阶段。

2026-09-28 UAT-251/274：双标准、外部取得后内部加工及可信别名已实现；Windows完整架构240文件、真实转码/封装上架及授权正反例通过。正进行镜像构建、最新完整生产副本升级/回退门禁，尚未部署、未Reset生产。详见[审计与实施证据](implementation/evidence/UAT-251_DEFECT_ELIGIBILITY_HISTORY_AUDIT_20260928.md)。

2026-09-28 用户已授权实施、测试及标准NAS部署：本轮落实UAT-251双标准统一生产与UAT-274可信外部候选别名匹配，并按用户口径区分4K文件与4K修复版本。执行工作区为本聊天附属secondary-acceptance，基于最新已部署69a82f2a5d及其证据提交4bbf498eb；不重置生产或重处理已入库影片。前序“仅设计”是历史阶段，不再构成实施Gate。

2026-09-28：用户授权查清并修复复发的Aftercare恢复漂移，登记UAT-271（关联210/125），与已提交UAT-270合并验证及标准发布。Arca拒绝新旧Basis混用；Foundation只在精确domain_fact_commit确认未发生后记录输入失败，保留原Attempt摘要及全部业务历史，交还Owner重评，不Reset。Docker本机故障仍阻塞构建。

2026-09-28：UAT-269已发布b8cf321d65，荒野猎人原Event/Attempt/Effect完成import/probe/verify/select，无重新下载、源Reality不变；第一批关闭。接续UAT-270资源等待输入准备与单次Aftercare投影去重，Windows专项143项与完整架构240文件通过，固定资源需求分支另经34项回归；本机Docker启动故障阻塞Linux验证及构建，尚未部署。见[第二批证据](implementation/evidence/UAT-270_RESOURCE_WAIT_PREPARATION_20260928.md)。下方未发布描述为第一批历史阶段。

2026-09-28 UAT-269：用户授权外部导入原生复制修复，复用《荒野猎人》已下载材料沿同一任务恢复，不重新下载；本地回归后按标准发布及生产真实任务验收，不搭独立隔离服务。第一批只替换复制原语，第二批后台重复计算独立验证。见[修复证据](implementation/evidence/UAT-269_EXTERNAL_IMPORT_COPY_20260928.md)。

2026-09-24 UAT-268：用户报告《局内人 (2006) 1080p DTS-sample》点击“放弃整理”无结果，并明确允许扩展active Run的用户主动放弃合同。Libra安全收尾、持久终局与Control/Workspace规则已独立发布；指定sample的正式用户放弃、页面反馈、原文件与已入库正片保护均已验收，本项关闭。[发布与验收](implementation/evidence/UAT-268_ACTIVE_RUN_DISCARD_20260924.md)。

2026-09-23 UAT-267：Shelf Standard 升版后三条已 Accepted On-deck Run 的冻结依据修复已在隔离发布分支完成，生产尚未发布。真实物理 Effect 演练因生产媒体来自 CIFS 共享、缺少隔离且保持物理身份的可写克隆而未过门禁；本次 UAT-268 独立发布不包含该修复。[冻结依据与门禁](implementation/evidence/UAT-267_ONDECK_FROZEN_BASIS_20260923.md)。

2026-09-23 UAT-266：用户确认Movie新Run及存量收藏统一Matroska容器/`.mkv`，直接升级系统模板。规格、Libra无损Remux路由和系统Template/Shelf Standard revision 2已部署；第一片正式维护检查等待资源。接续按Aftercare逐项修复并验收19部存量，同时验证新Run成品；不直接重命名或改写生产Inventory。见[实施与验收](implementation/evidence/UAT-266_MOVIE_MATROSKA_STANDARD_20260923.md)。

2026-09-22 部署批次调整：125/212/250独立修复已上线。251的旧Root修复已随19d13f7b58上线，7误Case终结、执行停止/资源释放、19项真实重查及黑寡妇partial正式回收完成；264的新Workspace通用回收验证独立记录，3份历史NFO人工恢复与263切Root继续受原合同确认和物理收尾门禁约束。三个历史文件不再被误列为251 Case终结的前置条件；任何已Commit或既有合法终态必须保留。证据见CURRENT_STATUS与251既有记录，不另建计划。

2026-09-22 用户授权修复整理失败，并要求网络方案保持简单。接续 UAT-125/212/250：Provider 有限退避与脱敏诊断、Formation 当前事实过滤、转码预检本地超时与取消。隔离分支 `codex/formation-failure-convergence`，不重置生产条目；验证后交统一部署负责人。证据见 [修复记录](implementation/evidence/UAT-125_212_250_FAILURE_CONVERGENCE_20260922.md)。

2026-09-20 本线程用户追加并授权：先完成 UAT-262 工程过程数据清理、UAT-263 Libra/Aftercare 共用用户 Workspace 设置、UAT-264 自动回收规则对齐，再返回 UAT-251 黑寡妇卡住与已接受瑕疵误转码主线。允许核验后清理旧工程备份/tar/闲置测试副本；保护生产事实、原媒体、未决 Effect 和必要恢复资料。共用物理设置不合并领域 Owner，Aftercare 不要求额外配置。按本轮指令完成本地验证和标准发布；不新增任意 Formation Reset。

2026-09-12 UAT-251生产复验追加：用户确认修复已接受瑕疵误识别、9项误建维护Case及19部收藏状态。隔离实施`codex/aftercare-accepted-defects`；读取精确Handoff B冻结要求、正式取消未提交的自动瑕疵修复、重新检查旧笼统结论；保护原片、授权与历史，交统一部署负责人发布。证据见`implementation/evidence/UAT-251_ACCEPTED_DEFECT_RECOVERY_20260912.md`（执行包相对路径为`evidence/`）。

更新：2026-09-12。ACTIVE。用户要求先整理UAT文档，再继续逐项验收关闭；此前合同审查暂停已结束。
[UAT总表](UAT_ITERATION_REGISTER.md)是唯一条目、状态、当前关闭条件入口；[当前执行包](implementation/CURRENT_PHASE.md)记录执行位置；本计划仅保留范围、顺序与授权。

2026-09-12：部署负责人完成cd4f3f5b2d首批标准发布，257/258/259分别验收关闭；既有256关闭保留。当前继续251与接收恢复剩余链路，三片历史及精确治理范围见当前执行包。

## 已确认合同

2026-09-12：本任务接续完成UAT-251，并追加用户明确要求的“自动授权瑕疵上架”。隔离实施区为`E:/my_project/emby_third_party-helix-uat251`，分支`codex/uat-251-terminal-defects`，完成后整合集成区；保护其他任务未提交修改。前端做法须与任务`01a0912a-0086-74e2-88ab-536c59d3862a`确认后实施。原三终局、精确Gap、手动瑕疵修复及有限再进入合同继续有效。

255项前后要求审查及11组取代/承接关系见[审查证据](implementation/evidence/UAT_FULL_CONTRACT_CONSISTENCY_AUDIT_20260909.md)。三项原合同冲突均在`14cf2d9a0`确认：Off-load完成后取消额外24小时等待但保留两轮引用安全审计；workspace成品独立解码验证，Source保留fresh Probe/必要对照，Direct仍须实际产品解码；用户预先授权精确旧输入自动清理（含exclusive_related_input），无需逐片确认，共享/未知材料保留且Off-deck独立授权。合同确认不等于运行时正式授权已持久化或验收完成。

251的三种终局、仅手动修复已接受瑕疵、健康正常另附标记及typed合同均已确认；DTO/持久化/执行接入已实现并随286fe56f1e发布，剩余逐项业务验收，不再等待用户决定。NFO默认存在、非空、可读，不恢复旧持续呈现全等；物理处置仍核验精确归属。历史PROD/UX/旧测试不得覆盖现行合同。

## 剩余排程

2026-09-12 21:34：用户针对《宇航员》新增单Token及2旧Work清理明确回复“允许”；部署负责人已完成停服备份、冻结范围复核、正式精确Reset、同286镜像恢复与生产Receipt/ACK/释放闭环。该授权仅覆盖已完成的具体清理，不扩至其他条目。当前接续各UAT剩余验收，具体生产事实见CURRENT_STATUS。

2026-09-12 21:00：联合286fe56f1e标准上线与生产保护验证完成；当前不再等待251/260/261代码交付或发布，接续按各项剩余业务条件验收。旧两Token不重复Reset，历史冲突文件不按失效清单处置。最新身份及证据以CURRENT_STATUS为准；以下事故排程为历史过程。

2026-09-12第二批d7a6da2802发布失败：数据库readiness通过，但完整Host因大量历史PLAN_CATALOG_DRIFT未启动。已标准回退cd4f3f5b2d，StartedAt2026-09-11T21:32:51.809272745Z，健康/五挂载/fnOS/113收藏及970份Delivery复核通过。此前原两Token精确Reset已执行且保留，未恢复DB；5旧Offer仍open，旧版已产生新Token，不得扩大或复用旧Reset范围。新增261优先定位启动合同与补完整Host门禁，260随后，251独立。[事故记录](implementation/evidence/UAT-261_CATALOG_STARTUP_DEPLOYMENT_20260912.md)。

2026-09-12新增UAT-260：隔离演练中大Run FailedPreparationRetry将完整DTO内联至Plan，触发16 KiB CHECK；SSOT要求typed binding refs，禁止扩大上限或旧Work fallback。正常恢复链用修正BigInt桥另建副本继续；重试缺陷单独修复验收，生产未变更。见[缺陷证据](implementation/evidence/UAT-260_LARGE_RUN_RETRY_INPUT_20260912.md)。


首批cd4f3f5b2d已标准发布。257/258/259已逐项验收关闭：73页扫描成功、六片普通选材产生新包、生产UI与授权保持通过。接续261启动修复、Control生产恢复与251；原两Token Reset已执行，下一次重核当前现场。[首批记录](implementation/evidence/UAT_RELEASE_CD4F3F5B2D_20260912.md)。

2026-09-12接收恢复：第一批9820e7b85核心已部署；第二批9ecf7b2a1及Evidence d591d6867已合入d7a6da2802，Windows组合38/38、完整架构1647通过/9跳过/0失败。候选镜像Linux117/117及最新副本scoped正常链通过，但正式部署完整Host失败已回退；先解决261和完整启动验证再重新安排发布。CAS后自动新Evidence/Work不在本批内，不能把新建测试或Reset safe当作旧队列已恢复。[实现与验证](implementation/evidence/UAT-125_250_INTAKE_RECOVERY_20260912.md)。

2026-09-12追加：用户确认UAT-256全页面UI polish；仅前端呈现，八页数量与业务行为不变，桌面最大化验收。文件来源取消全局汇总；媒体整理列表结构、尺寸和交互冻结。补充移除技术标识/原始代码，必要失败原因用中文显示；未知原因占位文案不再指向技术信息。执行及证据见[确认范围](implementation/evidence/UAT-256_UI_POLISH_20260912.md)。

当前73项本轮功能关闭、32项开放，206承接已核实；153项历史关闭、220文档关闭及1项非缺陷接受不计为新增功能验收。已关闭项不再列入实施队列。下列B标签不代表新Phase；同批独立项目可以先验收，达到自身条件立即关闭。

| 批次 | 剩余UAT（唯一归属） | 当前验收重点 |
| --- | --- | --- |
| B1 有限终局与瑕疵 | 251、126、131、133、154、161、164、168、173、162 | 已确认typed合同落地；原片安全、精确Gap、三种终局、手动修复及同条件不循环 |
| B2 后端及材料安全 | 210、125、148、150、152、127 | 171已独立关闭；按三项新确认核验Source/Product、回收及恢复；210完整节流/Case条件逐项验 |
| B3 整理与收藏 | 212、120、149、153、151、155、166、170、140、227、236、242 | 真实进度、健康/处理分离、有界分页、当前页轮询；251相关展示单独接入 |
| B4 全站剩余验收 | 247 | 跨页缓存、失效与迟到响应逐场景验 |
| B5 存量 | 209、250、216 | 当前精确范围及连续性；保护已上架事实、正常生产、sample及另一完整版本 |

206承接证据已核实：207正式事故恢复及后续健康/物理证据覆盖原事故；保留历史关闭，不新增功能关闭，不恢复旧“无需纠正”结论。

## 授权与交付

2026-09-12追加：用户指定“收口并部署上线”为部署负责人，负责代码合并、工作区清理及生产部署，顺序、批次与节奏自主决定，取代此前固定等待全部交付及部署等通知安排。当前收口范围为UAT-251、接收恢复、UAT-257扫描修复及258；按依赖和验证结果安排发布。此次任命不向其他任务广播，必要技术协调正常进行。UI第二轮已由用户追加授权，登记UAT-259，在独立工作区实施并交统一部署任务安排发布。交接及只读预检见[联合发布接手审计](implementation/evidence/UAT_JOINT_DEPLOYMENT_READINESS_20260912.md)；职责见Playbook §3.5。生产数据/媒体处置仍按精确范围授权。

既有实施、本地测试与标准NAS发布授权持续有效；标准发布允许中断FFmpeg。本项目必要清理及精确旧Input持续授权按各自范围执行，未取得当前物理证据不得删除。无任意Reset、直接SQL改生产、删额外NFO掩盖健康问题或旧数据兼容授权。Emby调查及5分钟自动轮询保持停止。

集成工作区为`E:/my_project/emby_third_party-helix-iteration`，分支`codex/user-pain-iteration`；主工作区不作为本次编辑目标。用户指定的care-clarity交付`e6b7f0424`已由`799433c65`整合部署，不再并行修改。其他worktree保留，未完成归属审查不删除。原`AFTERCARE_HEALTH_CASE_IMPLEMENTATION_20260908.md`的未提交修改受保护，不夹带提交。

生产身份、备份、部署结果仅维护[CURRENT_STATUS](CURRENT_STATUS.md)及对应Evidence。历史基线见[整理前快照](implementation/archive/20260908_PRE_PROD_CONSOLIDATION/CURRENT_PLAN.md)与[台账整理证据](implementation/evidence/UAT-220_REGISTER_CONSOLIDATION_20260908.md)。不在活动计划累积已关闭流水。

## UAT-265 图片角色修复（2026-09-22）

用户授权修正带电影名前缀图片的角色识别。Procurement两处规则共用精确分类，保持既有归属边界；已于459efebbf2完成统一生产发布及适用验证。旧收藏不因新识别规则自动重分类，局内人恢复须沿用Arca正式瑕疵修复。见[证据](implementation/evidence/UAT-265_PREFIXED_ARTWORK_ROLE_20260922.md)。


2026-09-28 UAT-272/273：修复上映年份证据和用户指定的同单元格手动身份浮窗；基线1281d4dd76，隔离分支codex/movie-identity-selection。用户改为各线程自行部署闭环，本线程已完成标准发布69a82f2a5d及生产只读预览验收；待正式身份选择/新观察业务验收，不Reset、不改历史事实。
