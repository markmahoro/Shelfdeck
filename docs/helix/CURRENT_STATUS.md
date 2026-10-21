# ShelfDeck 当前状态

2026-10-21追加运行链检查点：原任务重试/双图上传/真实视频上架、当前收藏缺图重试/单图上传/健康的完整浏览器旅程通过；两类写文件后人工重试、旧已Commit Season隔离软件修复、合格原来源只读复制与别剧资料拒用均有定向证据。新增共享健康head失效与空Workspace来源重评继续验证，当前136/115/231/61。沿用三项工作项；未关闭UAT、未发布、未改生产历史文件，最终资格与Source物化后的失败恢复收口仍继续。详见既有UAT-328设计Evidence §18。

2026-10-21继续实施（尚未完成最终资格）：UAT-326新增真实进程退出后跨60秒Handle TTL恢复同一Identity Event、一次上架及再次重启不重复Commit演练通过；UAT-327真实Host对4star分类目录1081媒体形成65个完整季包和2个Run，文件/成员不重不漏。UAT-328已接通共享Supporting Work/Provider资格/字节配方/正式Control与Ready原子提交、Accepted预留与On-deck版本引用、原任务重试及上传、健康缺项修复/维护补图和Workspace回收；初始S03、跨季复用、同季加集、Workspace/正式文件真实进程退出、来源无图人工补图及真实N:M最后一季退出均取得定向证据。最后引用退出纳入原确认范围的三项共享文件，以持久retirement围栏阻止竞争准入；其他引用/Accepted预留保护共享文件。当前136 Capability/115 Result family/231表/60事务。最新追加代码仍在回归；三项UAT未关闭、未发布，旧生产收藏补齐预览/正式恢复、来源祖先资料资格、显式刷新及最终平台/UI/完整Gate仍继续。


2026-10-21首批开发检查点（产品提交`85ab5c7e1`）：UAT-326三条JAV来源路径、UAT-327完整组分批已修改；UAT-328基础合同/Basis/Provider、共享持久组件及精确文件IO已修改，尚未接通完整运行链路。组合342项定向测试、2项隔离JAV Host及最后受影响范围77项通过；P2/Manifest/包边界/语义静态检查通过；完整长时门禁提前启动后停止，不计PASS。未进行UI验收、完整发布资格或生产变更，三项UAT均开放，生产仍6c74939646。

2026-10-21 UAT-328完整设计草案完成，用户明确tvshow.nfo、poster、fanart均为剧级必需。新增核对：TMDB文字已读取show+season但结果scope依附Season；图片获取统一用整剧images，没有季级图片范围。设计覆盖Provider三层精确查询与复用、共享剧根及完整生命周期；职责扩展仍待确认，未实施/未改SSOT/未修改生产。[设计草案](implementation/evidence/UAT-328_SERIES_SHARED_PRESENTATION_DESIGN_20261021.md)。UAT-326/327方向已确认但尚无修复产品提交，生产保持6c74939646。

2026-10-21新增开放UAT-327：剧集4star分类目录下22部剧、1081 eligible视频被第一层目录规则合为一个不可拆Scope而告警；最大单季目录仅30视频。只读诊断确认现实现符合旧Scope合同，属于需讨论修订的分组设计限制；无产品/SSOT或生产修改，未扩大1024上限。详见生命周期Evidence。

2026-10-21 17:50发布完成：UAT-325修正版6c7493964674eea2d944e915654dc3c64abf8929已通过标准部署，生产镜像markmahoro/shelfdeck:helix-beta-20261021-6c74939646，image ID sha256:ad0f738f2969439d555e46833ad0e197f38b3e3babd265af66252fef622ca1fe，tar SHA256 67165d579798f3ee9db0673c0edefcb3f409f7514fae6bdc207e4a3fb1b17f86。17:41:08启动，17:47:53正式Resume完成，running/normalSupplyAllowed且无fault；被中断的原QSV转码已恢复，输出持续增长。原ended查询500已变200，active/completed等八项接口通过，线上JS/CSS与UI负责人已验收版本完全一致。切换前后80组历史/收藏/人物/未决Effect身份保护通过，649原收藏和31,238人物保持。UI同版22/22、相关单测26、Web248/build及受影响后端资格通过；完整生产媒体E2E未新增，前轮完整副本Host FAIL与用户接受例外保留。详见本专项Evidence。

新增开放UAT-326：ABF-153的JAV识别Event重启后因短期Handle到期时间变化导致输入摘要漂移，重复恢复被拒；本次只定位记录，尚未修复。相关代码与408旧版相同；实际转码恢复和本次UAT-325修复通过不等于全部任务已恢复。详见同一生命周期Evidence。

2026-10-21 当前承接：生命周期与合并增量已标准部署40861e877并恢复正常供给。用户上线后反馈UAT-325：已结束任务查询500，以及独立“准备异常”入口不符合用户旅程。根因已定位为历史分页修改只读数组；继续本Phase修正，恢复统一为原任务“重试任务”，未接收成功者纳入同一列表且不伪造Subject/Run。修正版验证与发布继续；先前待部署快照按历史保留。

2026-10-21 UTC07:31 发布进行中：用户接受本轮完整副本 Host 演练例外，原 FAIL 保持；固定 c66d55b4a 的395文件标准Architecture及四项静态检查、Service648 PASS/29既有skip、Web247和build全部通过，4220份tracked输入前后摘要一致。Runtime stop于UTC07:30:45完成，所有在途通道归零；原生产容器UTC07:31:29正常退出、exit0。完整data冷备及离线结构副本正在准备，尚未换库或启动候选，不清空生产任务。下文待例外/待全量/仍运行均为此前检查点。

2026-10-21 发布资格检查点：本地main、远端main及实施分支已同步至c66d55b4a；主工作区锁定依赖、固定模型与Web构建已更新。产品候选40861e877镜像已标准构建/上传/checksum通过，2655份镜像文件与本地相同，UI负责人同版接受；Linux86项、原生/QSV及Windows独立分发通过，照片建档真实模型/Host在Windows与Linux各7项通过。225表升级及基于候选最新事实的224表回退逐表保护通过，旧/候选/回退Host均能health200和正常供给、80张受保护历史表保持，但只读Workspace阻止转码/清理，旧版另有已在候选修复的优先级重启错误，完整副本演练仍FAIL。已向用户询问本次发布例外，尚未获得该决定；最终固定c66d55b4a完整门禁仍在运行。生产仍af2257c423、原StartedAt/restart0、health正常；未停服、未换库、未Reset或清理正式来源。精确身份、失败与日志见[专项Evidence](implementation/evidence/FORMATION_PACKAGE_DESTINATION_AUDIT_20261021.md)。

2026-10-21 生命周期第二批本地实现：持久取消/无Run退出、文件排除与撤销、退休Field闲置Control释放、三类Libra前置准备失败人工恢复、Arca人工恢复不受累计32代限制、旧superseded Workspace正式清理及未成包容量原因均已接线。33项Owner/隔离Host组合、额外取消/清理原子回滚及Arca接收竞争、容量Projection与225表离线副本回退测试通过；Web243及新增3项交互测试、构建通过。真实浏览器已走通无Run取消、勾选排除、来源撤销后不立即重试，并发现复选框样式问题已修正待最终同版复验。尚未冻结完整Gate、UI负责人审核、Linux/完整生产副本Host或部署。生产只读preflight仍为af2257c423/restart0/health正常，数据卷101GiB可用；未修改生产数据库/来源。

2026-10-21 生命周期首批本地修复：移除Libra按未变化失败历史拒收；新Run以当前公平轮次注册、以已接收Candidate发布时间作同轮排序；技术性准备失败允许下一轮普通Observation重新开采；Arca恢复改为处理分页选中的Offer。46项Owner/调度回归及3项隔离Host旅程通过，包含取消后原文件再开采、技术恢复及未变非法媒体不重试；尚未完整Gate/跨平台/UI验收或部署。退休Field闲置Control、持久取消/无Run取消及排除撤销仍待实现，不能记本专项完成。

2026-10-21 生产清理完成：按用户明确授权删除ShelfDeck测试、历史备份、旧镜像归档和停用测试/构建容器；数据卷可用101 GiB（42%使用），转码卷可用358 GiB（25%使用）。只保留在用生产镜像0434b691b4da；生产未重启，health正常，fnOS HTTP200。两次上传照片建档已自动completed、无失败码。没有手工改库/Reset/正式来源删除；生命周期功能仍待实施，详见[本专项Evidence](implementation/evidence/FORMATION_PACKAGE_DESTINATION_AUDIT_20261021.md)。以下“进行中”为历史时点。

## 2026-10-21 整合与生产空间处置（进行中）

当前分支 `codex/formation-lifecycle-recovery` 已通过 `9357688b0` 保存审查记录，并以 `fde48ef32` 合并 `codex/us-adult` 的 `d15bdb993`；未推送或部署，尚无本轮产品修复。生产仍为 `helix-beta-20261020-af2257c423`。只读日志确认多次 SQLITE_FULL/ENOSPC；清理前数据卷175 GiB、可用约1.8 GiB。用户明确授权删除 ShelfDeck 测试及备份等残留，当前正在清理经路径/挂载核验的旧备份、测试环境、镜像归档和停用测试容器；正式数据库、媒体与运行中 Workspace 不在清理范围。完成后补实际空间、健康与人物请求状态；不能把释放空间记成代码缺陷已修复。

## 2026-10-21 “死包”专项启动事实

用户恢复完整排查，并明确文件级业务流程优先、UI/入口其次。第二轮 B01–B37 路径、F07–F14 新发现、U01–U08 入口与 D01–D07 决策记录于 [Evidence](implementation/evidence/FORMATION_PACKAGE_DESTINATION_AUDIT_20261021.md)。三条新增隔离 Host 复现：无 Run abandon 503、退休 Field 保 Control 使新来源 control_not_acquirable、重试 Offer 拒收后材料恢复仍抑制且新键 reprocess 409。五项 Coordinator/Store fixture 另确认 Intake/Routing/Spec 终态失败持续 pending、Arca 自动恢复首项阻挡后项、验收 32 代后人工重试也被拒绝；120 项定向测试通过。原放弃后新扫描可成包、显式意图正常接通同包的证据保留。已完成本轮业务路径审查，等待逐项讨论合同与修复顺序；产品代码/SSOT未修改，无生产访问/部署/Reset/媒体操作；未声称全路径实景、600 文件核账或 UI 验收。本节不改变以下既有生产身份记录。
2026-10-21 JAV演员完整性本地增量完成：People幂等初始化统一“未知演员”真实档案；Libra新生产与Arca纠正均确保actor非空，原始来源Observation保持。产品提交`7b318ef956`，Service648 PASS/29既有skip、核心54、来源/Cast48、Owner回归93及真实HEVC首次入藏/真实演员纠正/写NFO后进程退出恢复3项通过；本地宽窄2项、UI负责人独立具体版本8/8及五项静态检查通过。后续测试/文档提交保持92份产品源码/9资产相同；Linux Docker不可用，未新增镜像/分发/完整Architecture资格。生产仍为下列af2257版本，本次无生产写入；[Evidence](implementation/evidence/JAV_ACTOR_COMPLETENESS_20261021.md)。

2026-10-20 20:14 Asia/Shanghai生产升级完成：`markmahoro/shelfdeck:helix-beta-20261020-af2257c423`，source `af2257c423d11f85ba2905a985a2d154c6af7cfb`，NAS image `sha256:0434b691b4dad4e1a7e2607674f1944d1fe03c4b46ec901867f0745f0ad5ac95`，tar SHA256 `0e222ee05d3cc27a50ea3bf3763f632937fd457dce539e057ff05fc99b4b2875`。标准build/upload/checksum/dry-run/readiness/apply/health/Admin/挂载/QSV检查通过；容器StartedAt `2026-10-20T12:07:21.989324547Z`，RestartCount0、无OOM。Resume在UTC12:12:00.605持久完成，12:14:07复验running/normalSupplyAllowed=true/faulted=false、后台错误0，Procurement/Libra/Perception正常周期已完成，9项整理在进行。原611收藏及13组历史事实在换库后逐项摘要保护通过，15个无关容器身份及fnOS200保持。维护默认周六03:00–09:00 Asia/Shanghai；US辅助来源仅ThePornDB，未复制一次性测试Key。完整副本正常Host/N95及平台资格见既有Evidence，最终组合3145 PASS/26既有或opt-in skip/0剩余失败；原全量环境失败及复验如实保留，未跑完整生产媒体E2E、不宣称身份准确率统计完成。生产已产生新事实，旧536不能直接读取224表，禁止仅换旧镜像或擅自覆盖旧库；保留清理后完整冷备及现场，恢复须另行核对精确范围。以下为此前检查点，不覆盖本次已上线事实。

2026-10-20 20:05 Asia/Shanghai检查点：生产210→224同卷原子换库已成功，安装后SHA256为`8eb1bd089004a75b00ae3dbed5e850ce9871abb080f1bfe27089a2ec8ced8f16`；13组历史收藏/身份/库存/人物旧列摘要全部与清理后冷备一致，611条原收藏保护。标准af2257部署apply正在执行，尚未确认新容器健康或正常供给。固定全量首轮3144 PASS/26 skip/1环境失败（独立工作区漏Web依赖）；相同锁文件补齐后原Windows打包/独立启动/原生模型用例复验PASS，tracked输入均未变，组合资格3145 PASS/26 skip/0剩余失败及四项静态检查PASS，保留首轮非全绿原报告。

2026-10-20 19:37 Asia/Shanghai检查点：标准Formation Reset已按精确10项授权完成并保持停服，原611条收藏保护；清理后再次完整备份66文件/3,842,445,959 bytes，内容及mode/uid/gid逐项一致。生产210表仍为旧镜像停止状态，新224表在独立release目录准备及验证，尚未发布到生产数据库路径。af2257完整副本放行后正常周期已通过，13组历史收藏/库存/人物事实在该周期后再次核对摘要不变。最终固定完整Gate仍运行，不将旧基线计为新版本PASS。

2026-10-20 19:18 Asia/Shanghai检查点：生产正式安全停机已完成，旧镜像保持停止；已按用户10项精确授权启动标准Formation Reset，工具已完成完整data备份并进入apply，尚未记录清理完成或数据换版。af2257c423候选在独立完整生产副本中health200、normalSupplyAllowed=true，并在放行后完成active-material-fields常规协调4来源、无runtime error、无历史Catalog拒绝，安全关闭。13组历史收藏/身份/库存/人物保护表保持。完整Architecture基线d485已3158 total/3132 PASS/26 skip/0fail；含Perception旧周期来源证明的af2257独立完整Gate仍运行，不继承为最终PASS。生产未切换新镜像。

2026-10-20 09:12:47 UTC更新：正式安全停机成功，mode/desiredMode=stopped、operation completed、所有在途通道及deferred recovery=0，FFmpeg退出，受理后新增Attempt=0；611条收藏保持。原容器随后正常停止，新完整冷备64文件/3,842,413,191 bytes及权限逐项一致。生产未Reset/迁移/换版；现补最新Catalog历史及三种合同完全不变的暂停后台批次证明，不扩大10项清理授权。94项局部回归和空Host通过，生产副本及新固定Gate仍待验。下文停机pending为此前检查点。

2026-10-20生产操作新检查点：用户已授权清理当次未上架10项（含原1项完成后补入的1项），但要求先正式安全停机成功并检查收敛，再升级。冻结前收藏为611条，全部保护。第一次标准容器停服以Exit1/P4_SHUTDOWN_CHECKPOINT_TIMEOUT结束，未当作安全停机成功；已对全部65个data文件约3.86GB及compose/secret建立并逐项验证冷备，未Reset/迁移。按最新指令恢复原精确镜像，08:29:24 UTC正式stop API受理；desiredMode=stopped、normalSupplyAllowed=false，事件1→0，仍有1个转码恢复动作在途，FFmpeg CPU及产物增长证明仍推进，尚未完成停机。现有冷备因恢复运行仅为此前现场保护，最终升级前须再捕获新鲜完整冷备。53项收敛回归PASS，不能替代生产完成状态。

精确候选`64d1b06702`完整Architecture Gate实际完成：387文件、3137 total/3111 PASS/26既有或opt-in skip/0fail，四项组件PASS；4183个tracked输入前后摘要同为`2c0245319b51bdac20298cc56c650407c1784fb73580715d2518e57003fc9f94`。未选中的真实模型/测试材料不计新覆盖。下方“Gate运行中”和“清理未获授权”为之前的历史检查点，已被本节结果与最新授权覆盖；生产仍未切换。

2026-10-20 发布候选`64d1b067024b98e51b9fa75942e465e8958b0a9c`已标准构建/上传，tag `helix-beta-20261020-64d1b06702`，tar SHA256 `1edf357198efd8c3c7384e786481ab6198b4ebe8648165d55e3ecaf1ddc8799a`，NAS校验及标准dry run通过。2634个镜像文件与Source/本地资产逐项一致；Service648 PASS/29既有skip，Linux受影响252个唯一用例最终通过（首轮P2 CLI夹具目录缺失单项失败，补齐测试布局后3项重跑通过，未改Runtime），具体版本UI负责人宽窄12/12及3份中性海报PASS。独立固定checkout完整Architecture Gate仍在运行，不能计PASS；真实媒体准确率按用户决定停止统计。

生产升级尚未执行：一致数据库副本检查`eligible=false`，30,941个人物归属全部明确，唯一阻挡为10个未完成Libra Run及其执行责任。显式10 Subject的标准Reset只读预览ready、无blocker；会丢弃这10项整理过程，生产动作尚无授权，未执行。按Playbook §3.4不得擅自加跨迭代兼容或把部署授权当成Reset授权，已请用户选择等待完成或清理后重整。当前生产image/启动时间保持；未停服、改库、改媒体或复制一次性测试凭据，未完成完整冷备/候选生产副本Host/回退资格。

2026-10-20 最新生产升级授权与来源收敛：用户确认改完直接生产部署，US Adult辅助搜图只保留ThePornDB。已移除Wikimedia查询/页面入口/新选图来源，固定官方GraphQL地址，设置仅保留API Key；不将一次性验收凭据复制到生产。受影响Service30 PASS、Web14 PASS，Web原43文件242 PASS及build后新增失败状态用例已定向复验；四项静态Gate/P2通过，aggregate `1b9df5e2fd2ffe41a64382f2159c8d8537b037fb47c15a30222086c173b5f2ba`。完整候选/UI及生产数据升级资格正在核验，生产尚未切换；只读数据库副本检查不等同完整备份或Host验收。

2026-10-20 海报排版v3本地完成：用户确认中性示例后，正式共享Renderer改为暖白底/顶部演员名/四帧2×2居中裁切铺满/页脚原名及小肖像，保持1000×1500。SSOT及冻结Renderer合同升为us-adult-presentation@3，首次Libra生产和Arca刷新复用原唯一组件。Windows受影响55 PASS/1既有opt-in skip，Linux31 PASS/1同项skip及四项静态Gate通过；正式Renderer中性预览已检查。未重建或部署NAS镜像、未重生成已有封面，原完整版本资格不自动覆盖本增量；详见既有US Adult Evidence。

2026-10-20 人工验收入口补记：用户已自行建立4个US Adult演员档案，原4片仍待接收、席位0、Run0，尚无识别或上架结果。生产健康连续三次慢/超时触发原阈值安全停测；隔离数据保留。停机数据一致副本只读检查及6次健康预检通过后恢复原隔离实例/原数据，重新启动原保护监控，入口复验200。只展开席位设置供用户操作，未修改席位或发起识别；生产实例保持。详见既有US Adult Evidence。

2026-10-20 辅助建档真实来源复验：修复StashBox适配器验证摘要缺少capabilityCodes，以及TPDB线上仅支持searchPerformer数组接口的协议差异。Windows受影响29项、Linux相关6项与四项静态Gate通过；隔离验收实例在原固定镜像上只读挂载两处明确摘要的适配修复，正常Owner API验证/保存临时凭据后，三个人名查询均返回TPDB候选，浏览器实际加载五张参考图。未选择图片/建档或判定出演身份；Wikimedia独立来源错误仍开放。生产实例未变，未生成新完整发布资格；详见既有US Adult Evidence。

2026-10-20 查询优化增量本地完成：Series同次同步读取内复用完整空间分配，Perception按Source cursor heads约束256项候选ID查询索引，新资料失效、记录/关系与规则仍每次核验。最终261项受影响回归、Linux190项、Service648 PASS/29既有skip、四项静态Gate通过；DDL/API/UI/Owner不变。合成组件Series58.09→0.77ms、重复候选查询73.45→3.64ms，输出一致；冷查无显著加速，且并行轮曾变慢，不宣称生产SLO修复。旧固定0c82ee862完整资格不自动覆盖新增Runtime；NAS生产及人工验收镜像未更新，身份业务验收仍开放。详见唯一Phase及既有US Adult Evidence。

2026-10-20 NAS超时已完成只读诊断和测试启停核验：停测仍复现6.113s健康响应，同步SQL/Libra协调及Perception/投影计算占用生产主线程；测试首次初始化可能加重竞争，不称零影响或生产已修复。生产实例保持、两次Inspector关闭。隔离人工入口现已恢复并通过登录/权限/Cookie及页面资源资格，空演员库/席位0，原保护监控生效且监控退出停止测试。等待用户独立身份和效果验收，Phase开放、未发布。见唯一Phase和US Adult Evidence。

2026-10-20 US Adult人工验收环境已建立独立数据与四份校验副本，空演员库/席位0；生产health连续三次超时触发安全停测，测试Exit0、无OOM，本机转发关闭。生产image/StartedAt/RestartCount保持；入口/会话资格与人工身份验收尚未完成，未交付操作入口或发布。隔离数据与私有清单保留，详见唯一Phase和既有Evidence。

2026-10-20 US Adult工程固定0c82ee862完整资格PASS：原始387文件/3129 tests/3116 PASS/13既有skip/0fail；JAV全部74场景实际通过，4183个tracked输入前后digest相同。Service648 PASS/29既有skip、Web242 PASS、Windows独立模型包、Linux208项及额外8个跨Profile恢复/媒体场景通过。N95隔离434请求零错误、p95 410.05ms达500ms预算、峰值887.6MiB/无OOM，仍有2.62s长尾；四片检出、两片上架/单片指定刷新及维护跨周原Work续跑通过。原件及生产实例/原latest指向保持，无运行的本轮测试容器。主工作区Service依赖已从E盘共享junction安全改为独立物理目录、固定模型默认目录齐备，自身依赖22项CPU/线程检查通过，未改外部依赖。真实出演身份准确性未评估，Phase业务验收继续开放、未生产发布；详见唯一Phase及既有Evidence。

2026-10-20固定0c82ee862：ONNX Worker生命周期/队列/异常及真实输出一致性完成；N95隔离1.5核/1.5GiB完整两片及单片指定刷新434请求零错误，p95 410.05ms达既定500ms预算，max仍2.62s，峰值887.6MiB、无OOM。四片20点检出与旧版一致，维护截止/手动停机/跨Host及下周原Work续跑通过。Linux208项全通过，Service648 PASS/29既有skip、Web242 PASS；原始完整Architecture和额外跨Profile/Windows仍在资格中。四源完整hash/stat未变，生产实例未动、NAS测试容器已正常退出。真实出演身份准确性未评估，本Phase未完成、无生产发布。详见唯一Phase及US Adult Evidence。

2026-10-20用户恢复US Adult开发。ONNX技术线程客户端/原生会话/Pack校验已拆开，32请求/32MiB有界排队及独立close控制槽、FIFO、崩溃/协议失败明确拒绝且无主线程回退。真实线程八项和预备模型/帧/图片十四项通过，输出与原实现完全一致；本轮模型检查使用独立目录NODE_PATH，尚不算分发资格。四项静态Gate通过，最终独立checkout、Windows/Linux及N95预算复验继续，未部署生产。

2026-10-19 US Adult再次按用户指令暂停：本机完整Gate取消、NAS本轮测试容器已正常退出，无运行测试容器，生产镜像/StartedAt/RestartCount未变。N95四片抽帧检出、两片技术标签完整上架/单片指定刷新、维护窗口及下一窗口原Work续跑已有隔离证据；真实出演身份准确性未判定。1.5核/1.5GiB隔离环境高频482次请求零错误，p95约511 ms/最大2.58秒，未达预设500 ms。ONNX Node的同步native推理阻塞已由profile及backend源码确认；worker thread调整未提交、未测试，不称性能已修复或开发完成。详见唯一Phase及既有US Adult Evidence。

2026-10-19 US Adult本地收口候选：Arca指定/自动单片刷新及三类真实进程中断恢复已贯通，普通/JAV可靠维护/归并、三库/图片生命周期、离线210→224副本升级、维护任务和Reference精确GC已实现。后期Actor人工纠正实际CPU Host按原Subject合法replacement完成，提交后续跑重试不重复Intent。d8cff243b具体版本UI负责人六项发现全部关闭（最后受影响宽窄8/8），后续后端改动不改UI/Renderer。当前P2 131/110/224/58/145、162路由通过，最终固定完整Gate与Windows/Linux资格进行中，不能视为开发完成或发布。详见唯一Phase及US_ADULT_LOCAL_IMPLEMENTATION Evidence。

2026-10-19 系统人物归并增量：维护内可靠编号归并正式Work/Owner事务/消息ACK，普通/JAV无用户确认；原名/身份历史保留，作品经People Merge身份Scope与Arca当前关系连续读取。真实Host归并1项、Arca CPU刷新及作品1项、Owner/规则18项通过。固定c046独立完整Gate3062 PASS/1 FAIL/13 skip，输入未变；唯一P3 trace manifest漂移已准确修复并局部24项复验，尚无新固定版本完整PASS。该固定版本独立Windows原生模型包检查通过；Reference GC、维护剩余及最终全量/Linux/浏览器/UI审核继续，无生产操作。

2026-10-19 历史人物与副本工具增量：可靠TMDB人物命名空间隔离查询/提交、历史头像与NFO编号修复通过69项及人物页9项；离线main 210→224结构副本已实现，保留全部209个旧事实表原列/行、旧确认及收藏引用，仅可靠来源填分库，未知/冲突与未完成责任拒绝。Operator与来源合批21项通过，生产副本未读取/升级，未发布；Reference GC、正式可靠归并、维护剩余及最终平台/UI资格继续。

2026-10-19 Actor stage恢复增量：原Case独立discard Work及持久Effect精确清扫完成后才可无写入失败收口。真实Host在Inventory提交前/后及stage删除第一项实际exit 73/74/75，原Case恢复、新Intent刷新和历史Source期限组合1 PASS；局部20项、Web233项与构建通过。当前P2为130/108/224/57/144、162路由，aggregate见现有Evidence。独立c04641bab完整Gate在运行；人物深度维护、Reference GC、离线升级、维护剩余及最终平台/UI仍开放，未交付或操作生产。

2026-10-19 US Adult恢复开发增量：系统People维护正式Work/typed Evidence链、可靠JavDB Actor ID与Arca当前出演关联已接通；真实JAV强/弱来源2项、Series维护人物/修复3项通过。Actor实际提交前/后进程退出恢复、目标冲突无覆盖及失败收口后显式新Intent再提交1项通过，未知/部分副作用仍原Case恢复。当前130/108/224/57/144及162路由，P2通过；Service648 PASS/29既有skip、Web232 PASS及构建。stage残留清扫、People深度维护/Reference审计GC、离线副本升级、维护剩余项、固定版本完整Gate/独立Windows/Linux/浏览器与负责人UI资格仍开放。旧1dd完整Gate实际33失败不是PASS，当前checkout Windows打包因共享依赖junction失败，待物理依赖checkout复验。未发布或操作生产；见唯一CURRENT_PHASE及既有US_ADULT_LOCAL_IMPLEMENTATION Evidence。

2026-10-19 US Adult本地Arca检查点：指定/自动演员已贯通正式HTTP、Source/匹配、海报/NFO/命名、文件Effect、Inventory/Control原子提交和Case结案。有脸/无脸/跨Host重启及真实UOW迟发失败回滚恢复通过，身份/收藏连续且无关健康Finding保持。P2为130 Capability/108 Result/224表/56事务/144输入/162路由；Web222项及构建、Aftercare69项通过，本轮Service648 pass/29既有skip/0 fail。此前暂停取消的Gate/Service非PASS；固定新版本完整Architecture、正式Host异常退出/并发冲突、People/维护/离线升级剩余项和最终平台/UI资格仍开放，本版未交付、未部署或操作生产。

2026-10-18 US Adult最新本地检查点：推荐认领/建档及来源A幂等确认已接正式Owner链路和UI，真实CPU两片聚合与ACK丢失跨重启通过。Arca用户刷新Intent、完整参考分页和Case原子准入、当前库存Actor/首次原名规划、独立20帧CPU匹配/海报引擎及单演员NFO纯渲染已通过局部验证。当前224表/140 Domain inputs/160路由，P2通过；一次完整Architecture被并行SSOT修订导致的汇总异常打断，不能算PASS，待固定提交副本重跑。前一Service648通过/29既有skip、Web218通过及构建为前序检查点。Arca实际Work/文件Effect与UI、人物库剩余维护/参考图生命周期、隔离副本升级及最终平台/UI资格仍开放，本版未交付、未部署。

2026-10-18 US Adult本地开发检查点：正式CPU初次生产和暂存原Run确认已贯通；推荐的People维护构建、跨周cursor、最多五人快照及只读列表/JPEG已接正式Host并有真实模型证据。当前221表/158路由，60项局部组合和新增维护Host通过；推荐认领/新建同步A、推荐UI、Arca演员刷新、隔离副本升级及最终平台/UI资格仍未完成，不是开发交付或生产发布。详见唯一活动Phase及US_ADULT_LOCAL_IMPLEMENTATION_20261018 Evidence；未操作生产。

2026-10-18 US Adult 本地开发开工：本地/远端 main 与 GitHub 默认分支已统一至 `ac278f33e`，`codex/us-adult` 从该最新基线重建。
仅保留主目录 main、本线程分支两个 checkout；三个旧 worktree 的 Git 登记已移除，忽略资料移存仓库外，f8e1 留有 Windows 占用的空目录。
旧 master/JAV/proxy 分支已合并并删除，历史 tag 保留。[五议题决定](implementation/evidence/US_ADULT_DECISION_BASELINE_20261018.md)已冻结，当前做合同对齐；
已开始回写SSOT/机器合同并实现局部People/CPU模型/渲染/维护能力；维护配置正式Host和若干局部测试通过。
US上传建档已有正式Work/Effect及真实CPU模型Host证据；三库演员页、编辑/补图已有正式链路，Formation、推荐与Arca刷新尚未形成完整链路，不能宣称已支持 US Adult；全量、平台及UI验收继续开放。生产仍为下述 `5367179429` 镜像，本次仅只读核对，未发布、停机、Reset 或改真实媒体。

2026-10-18 已按用户授权标准上线 `markmahoro/shelfdeck:helix-beta-20261018-5367179429`（source `5367179429d6e6785c1adf8c8da363bc21def9bd`），包含已合并查询优化、全站统一代理/JAV连接、空间不足转二号及本轮Package热点优化。Image ID `sha256:fe8fe2f77c2d32bdc3fe59c14e616610fc48e304704baea9b92352261267fe60`，tar SHA256 `94409f5791c1f31fc0cd494c1a2a0aea298f07a38857dbc45c1ab418f178f1f2`。最终Linux143、canonical2359文件、QSV及完整副本候选/使用后旧版回退/历史保护通过；隔离只读媒体错误和首次备份辅助文件校验拒绝如实保留。UTC 2026-10-18T04:41:42.805Z health/正常供给、RestartCount0；原585收藏/42Run、792590不可变行及Effect意图保持。冷备 `/vol1/1000/docker/shelfdeck/backups/package-release-20261018T033556-5367179429/cold`（63文件，aggregate `3fc937f068bcbc85e4563b81c662464b9f99c6a2b09a3e0657e14a8d447c130a`），无Reset/换库/手工媒体处置。Node 12011ms短采样单核88.5%，不代表长期整机降幅；未跑完整生产媒体E2E/Electron，UAT-318仍开放。详见[本轮发布证据](implementation/evidence/UAT-318_FORMATION_TAB_QUERY_PERFORMANCE_20261012.md#2026-10-18-完整热点优化及合并开发标准上线)。以下较早段落为历史时点。

2026-10-18 UAT-318成品包热点本地优化完成：同一同步preparationScope下两个Settlement投影与资源解析共同读取一次完整上下文；Foundation仅传递不透明scope且不进入Executor/持久输入，Arca持有临时结果。Libra按精确Fact revision批量读取、单次恢复metadata、按成员分组Episode claims及同事务复用Run行，保留完整Package与逐项校验。143项定向回归通过。145材料/48 claims的真实Package记录在本机内存Repository对照中，旧3次重建80.27–86.46ms/36次调用，新1次23.88–27.07ms/9次调用，完整输出一致；不含SQLite I/O/媒体副作用，不能当作NAS CPU实测。未构建/部署、未改生产数据，既有开发已合并至57c7aa675且无新分支。

2026-10-18 用户追加的空间不足重试转二号已本地实现：3次、至少间隔60秒，保留Subject整体安全转区；空间恢复自动原位继续。17项席位、4项API/复制、2条真实Host旅程及Service647通过/29既有skip。未部署、未清理/修改生产数据或配置；完整证据见[本项Evidence](implementation/evidence/LIBRA_WORKSPACE_SPACE_WORKSHOP_20261018.md)。

2026-10-18 本轮只读现场复核生产仍bfd97f36a、RestartCount0、health ok/正常供给；未部署或修改生产配置/数据。Workspace审计发现4份superseded旧Run合计70.1595 GiB，引用仍working且无Cleanup Scope，现有回收路径返回has_workspace_references；另有35.3902 GiB历史保留/备份、约7.55 GiB当前在用，同卷外部Landing约173 GiB。UAT-322开放，只诊断未清理。用户确认的全站统一代理/JAV一键连接已在独立worktree本地实现，专项22、Service647通过/29既有skip、Web197、最终宽窄浏览器6及构建通过；12a4b4030具体版本UI审核20/20通过；尚无Linux精确候选/生产资格，未宣称发布就绪。证据：[网络](implementation/evidence/GLOBAL_NETWORK_POLICY_20261018.md)、[Workspace](implementation/evidence/UAT-322_WORKSPACE_RESIDUE_AUDIT_20261018.md)。


2026-10-18 用户决定本轮性能优化先到这里，暂停后续优化与发布。d6ef5fee3e完整副本旧/新各20轮均100 API成功、20 JS完整：概览stale 7→0，age P95 40.575→23.723秒；API P95 1.599→1.477秒，JS中位0.970→0.877秒、P95 3.214→4.995秒。响应门禁未通过，未部署。三轮诊断完成；新旧演练Host均Exit0，当前无运行中的UAT-318演练容器。候选最终历史审计未返回成功结果，不记PASS；旧版历史保护已通过。已保存代码、镜像和全部证据，UAT-318保持开放。UTC01:47只读复核生产仍原bfd97f36a容器运行、RestartCount0。详见原UAT-318 Evidence暂停记录。

2026-10-16 UAT-318候选540b61cd59旧/新各20轮完成，未部署：概览stale 3→0、age P95 31.357→18.591秒；API P95 1.533→3.052秒、JS P95 3.770→5.577秒，响应门禁再次失败。正式20轮后才做三轮诊断，Inspector关闭/Host Exit0，568收藏/两条Run/Effect及历史保护通过。继续收窄原Owner内的NFO输入、Off-deck单Entry、Process取消及终态Evidence查询；无需schema迁移。Windows相关565 pass/3既有skip、Service647 pass/29既有skip；局部三轮完整输出等价。下一候选d6ef5fee3e已标准构建/上传，精确Linux85通过，完整Host旧/新20轮资格进行中。生产仍bfd97f36a，UAT-318开放。

2026-10-16 UAT-318候选4755d3d3d旧/新各20轮完成，未部署：概览stale 7→0、age P95 36.257→20.052秒；API P95 1.479→1.479秒、JS中位1.255→1.188秒，未通过真实响应改善门禁。两Host均Exit0，568收藏/两条Run/Effect意图保持；观察明细按SSOT七天及全部引用逐条核验后允许退役，候选6000行、旧版256行。新修复仅在原Owner内合并Perception同调用候选读取，以及按永久Observation header和现有索引分批GC、事务间让出；无schema/保留期/保护规则变更。三轮局部基准分别约减半和GC热批2.52–2.54→0.62–0.68秒；相关514测试/静态门禁通过，完整Service及下一候选Host资格继续，生产仍bfd97f36a。

2026-10-16 UAT-318候选161af9810旧/新各20轮完成，未部署：概览stale从5/20降到0/20、age P95 33.104→21.843秒，JS中位2.188→1.318秒/P95 5.867→3.746秒，但API P95 1.063→1.766秒，未通过不退化门禁。继续在Arca Owner内按实际Care Basis读取健康评估，保留完整历史/Case/Commit并校验当前head；概览片段恢复50ms，Perception仅复用本次clause的纯归一化值。冻结568收藏三轮健康输出digest一致，评估18896→1677，耗时约下降22%–29%；正式Host资格待测，生产仍bfd97f36a。

2026-10-16 UAT-318候选d61b91a1df未通过多轮门禁，未部署：同568收藏副本旧/新各20轮，候选7/20概览stale、max74.245秒，API P95 3.395秒、JS P95 8.454秒；两Host历史/Effect/两季Run保护通过。首组改善未持续，继续定位Perception别名转换与Arca健康读取成本，保留全部失败证据和原阈值。生产保持bfd97f36a，无Reset；详见原UAT-318 Evidence。

2026-10-16 UAT-318本轮已标准部署 `markmahoro/shelfdeck:bfd97f36a`：保留Owner边界与全部恢复校验，修复准备/概览重复读取、Effect历史全量读取和Admin静态传输回调放大。最终完整副本20轮100 API成功、JS中位491ms/P95 5.35s、0超时；使用后旧版回退与历史保护通过。生产上线10轮50 API成功、JS10/10完整，中位883ms/最大1.98s；概览仍4/10 stale（32–42秒），1秒整页目标未达标，UAT-318开放。Windows647 pass/29既有skip、最终Linux139通过；568收藏、706253不可变历史行、所有原Effect意图及两季精确Run/Subject/Workspace保持，无Reset/迁移/人工媒体处置。UTC05:37 health/running/normalSupplyAllowed正常、RestartCount0；UAT-321恢复期133次告警仍未修复。57/59伴随文件字节/身份保持，其余为正式operator intent和有FFmpeg现场证据的活动producer临时文件。完整身份、备份、失败、数据核验与验收限制见原UAT-318 Evidence最新节；以下为历史时点。


2026-10-16 UAT-318第二候选ffa85c9a6同副本10轮：概览10/10 ready、50 API成功、JS无超时，但第9/10轮27.53/19.51s，仍暂缓部署。Effect同快照读取5×3轮从1.18–1.48s降至15–54ms且完整输出相等；后续profile event-loop max909ms但JS9.6s。现补Admin静态JS/CSS的512KiB有界读取块，保持原sendFile路径/Range/HEAD/ETag与原字节；完整回归及下一镜像资格进行中，生产不变。

2026-10-16 UAT-318 修复候选 b84f36509a 完整副本各10轮：旧版JS 3/10超时、完成11.83–33.38s；候选无超时但1.67–28.40s，概览仍1/10 stale，性能不稳定，未部署。候选50 API成功、Health最大455ms、Formation最大1121ms；不能以改善均值宣称达标。同快照567收藏概览/3目标五组Arca投影完整digest一致，61不可变表705,991行/所有Effect意图/两条精确Run保护通过。后续两轮采样发现Effect intent/Marker全量历史读取，正在Foundation原Owner内改为精确条件读取，保留全部恢复和冲突校验；相关131测试及新增2000条无关历史回归通过，后续候选资格仍进行。生产仍3c3991fabe，无Reset或数据处置。

2026-10-16 UTC03:36–03:41 UAT-318多轮因果对照：8轮同容器独立stream为12–39ms，正式JS为193–22639ms；7/8轮部分重叠采样，不冒充纯基线。维护检查完成后仍慢，两个新profile转为Formation/概览及周期Perception主导；单一Aftercare去重不足以解决。3目标固定只读事务five/one/one/five证明重复上下文放大、完整输出等价，但不是正式新鲜度/Host修复资格。根因收敛为多条高频全量同步读取在HTTP主线程竞争；概览每轮四次Formation list、全收藏健康重建及超cadence紧接重建均有代码证据。无产品代码修改/部署，Inspector和短生命对照server已收口；UAT保持开放，详见原Evidence最新多轮对照节。

2026-10-16 UTC03:27–03:33 UAT-318继续只读定位：生产3c3991fabe保持正常供给/RestartCount0；两份约14秒profile中Arca维护上下文读取占inclusive约69%/70%，conformance单次准备重复5次完整上下文。关闭Inspector后，503927字节JS同容器HTTP仍29553ms、直接读盘2ms且SHA一致。两项字符串优化实验完整输出等价但无稳定收益，均未保留；本轮无有效新修复/部署，下一步须解决重复读取并证明新鲜度及完整性fence。详见原UAT-318 Evidence最新节；整页性能仍未达标。

2026-10-16 已按用户“先部署这次的修复升级”完成标准生产发布：`markmahoro/shelfdeck:3c3991fabe`（source `3c3991fabe29678a5a51793a98ace8f9a0b99124`），含四处执行读取、People分页及Arca当前Inventory修复。精确镜像Linux236、最新完整副本候选/旧版回退Host及历史保护通过；首个错误512MiB heap演练OOM与只读媒体错误如实保留。冷备份59文件aggregate `66e7392db520ad6c5b0e4e98a5c7e75fc27682a332452c938cc0149b01d5c1aa`，标准SHA/readiness/apply通过。UTC20:37:08正式Resume完成、running/normalSupplyAllowed=true、faulted=false、RestartCount0；560原收藏/Commit、两季Subject/Run/Workspace与物理身份、704,421不可变历史行及原Effect意图保持，无Reset/迁移/人工媒体处置。挂载/QSV/13无关容器/fnOS通过，已验UI资产hash保持。上线三轮15 API无错、概览均ready、JS3/3完整但仍20–25s，部分API超过1秒，UAT-318不关闭。启动公平投影同revision错误独立登记UAT-321，恢复完成前已消退、尚未修复。完整身份、备份、失败与验收限制见原[UAT-318发布Evidence](implementation/evidence/UAT-318_FORMATION_TAB_QUERY_PERFORMANCE_20261012.md#2026-10-16-本次读取修复发布资格)。以下较早段落为历史时点。

2026-10-16 UAT-318 按用户要求再查10轮已完成：50 API无错，JS有8/10在30–35s预算未完成；overview有8/10 stale、age31–54s。新发现Arca健康投影仍展开旧Inventory/Material role，已本地按当前head/revision限定：560 Entry完整输出等价，Representation5203→560、Material role40660→4339，old/new/new/old1290/1017/918/1216ms；双平台相关各63及静态门禁通过。上架完整Package重建采样窗口累计6.056s为新增未修复热点，不删除完整性fence。生产仍dc7/正常供给/RestartCount0，Inspector closed；无新构建、上传或部署，不宣称整页SLO或UAT关闭。十轮明细与试验限制见原[UAT-318 Evidence](implementation/evidence/UAT-318_FORMATION_TAB_QUERY_PERFORMANCE_20261012.md)。

2026-10-16 UAT-318 追加三轮只读调查：原 dc7 JS 完整传输19.6–25.6s、event-loop max1.8–5.1s。新确认 People 25项请求6.8–7.4s，原因是先展开28,996 Person/33,667 Candidate再分页；395560043已在People Owner内限定当前页并复用聚合计数，同快照实际old/new/new/old为8152/13/8/7485ms，完整输出相同，SQL120658→82。Windows/Linux People各52、Service645 pass/29既有skip及静态门禁通过；Unicode全姓名搜索仍729–823ms。Outbox反复读取10,030条delivery历史（无pending）、执行摘要完整输入canonical解析842ms窗口累计等残余已记录、尚未修复。当前People代码未构建新镜像/部署，旧4ba tar不含此变更；UAT不关闭，生产身份/供给保持、Inspector已关闭。[追加证据](implementation/evidence/UAT-318_FORMATION_TAB_QUERY_PERFORMANCE_20261012.md)。

2026-10-16 UAT-318 独立只读排查复现 dc7 静态 JS 在 NAS loopback 约 19–20 秒传输，同文件容器内读取约 1 ms。当前 profile 指向概览/执行准备的主线程竞争。Foundation exact Process 状态、Work Admission open-state、Startup Recovery snapshot 索引及 Libra Rating identity 已本地修复为 `4ba8f04d9`；当前库状态/评分完整输出等价，Service645 pass/29既有skip、精确 Linux 候选79、31跨进程恢复与静态门禁通过。额外332文件全量包装主动中断，不计PASS。候选4ba8f04d97已标准构建并独立校验，未上传/部署；同步媒体指纹、首开/HTTP 长尾与1秒SLO仍开放，生产仍为下述dc7。本候选新鲜副本Host/发布资格未完成，不继承此前跳过NAS演练的决定。详见既有 [UAT-318 Evidence](implementation/evidence/UAT-318_FORMATION_TAB_QUERY_PERFORMANCE_20261012.md)。

2026-10-16 已按用户最新“跳过NAS演练 升级吧”完成生产标准部署：`markmahoro/shelfdeck:dc7dcddbaf`（source `dc7dcddbaf6714d56aaa453610f862914863578f`）。UTC18:25复核health ok、mode/desiredMode running、normalSupplyAllowed=true、faulted=false、RestartCount0；`/adult`与原`/adult_media`绑定同一宿主目录，QSV/13无关容器/fnOS保持。完整备份及204→210/203旧表2,236,865行逐行保护通过，560原收藏、原Commit、两季精确Run/Workspace保持，54伴随文件与data目录物理身份保持，无Reset/删媒体。二号5席/占1，3来源已有公平记录。新鲜NAS完整Host演练按用户明确决定跳过，非PASS。UAT-318/UAT-320仍开放：两季尚等待资源，首开/静态大文件传输仍超时；不宣称完整媒体E2E或1秒SLO。详见既有双车间公平与UAT-318 Evidence。

2026-10-16 原聊天合并候选已冻结为`markmahoro/shelfdeck:dc7dcddbaf`（source dc7dcddbaf6714d56aaa453610f862914863578f），标准build/upload/SHA通过；含已接受UI的双车间/公平、UAT-318两批性能修复及`/adult`部署绑定。最终镜像Foundation68及本机临时介质Host2、Windows Service645 pass/29既有skip通过，2356份运行源码与冻结UI资产逐文件匹配。用户明确暂不NAS完整副本演练，真实Scope完整Host资格未完成，未部署/未应用adult新挂载；生产保持037。UTC10-15 17:15:51（北京时间10-16 01:15:51）复核原版本已恢复running/normalSupplyAllowed=true/faulted=false，health ok；容器ID/StartedAt/镜像保持、RestartCount0，S02/S03原Subject/Run仍active等待转码。没有停止/重建容器、迁移、Reset或本次NAS副本Host。细节见既有[双车间审查Evidence](implementation/evidence/LIBRA_WORKSHOP_FAIRNESS_INTERFACE_AUDIT_20261015.md)及UAT-318。

2026-10-16 LIBRA 双车间/来源公平本地实现验证中：Service645 pass/29既有skip、Web190、宽窄UI4、Linux核心36及真实二号Host1通过，Windows实际二号恢复/三来源长转码各1通过。结构为210表/149 routes；3.13GB历史204副本203表逐行保护及未使用回退校验通过，但缺受保护S02/S03，不能替代新鲜生产副本。最终Windows组合Host2/2、独立Service包与Linux受影响范围已复核；实现1f36d9ed8已获UI负责人8项独立浏览器检查接受；新鲜副本资格仍开放，已交付原聊天，未部署。详见 CURRENT_PHASE 与对应审查Evidence。

2026-10-15 新合同已获用户确认：Series 按 Subject 整体转入二号；允许 Foundation 最小通用只读分页执行摘要。继续实现与资格验证；不修改 Foundation 调度/执行语义、不接管原聊天 Arca/Perception 性能路径。

2026-10-15 UAT-320 缺路由配置 readiness/需要处理/对应来源配置入口已独立本地实现，后台68、Web12及受控宽窄浏览器2项通过，Web构建通过。具体版本UI负责人审核及上线验收尚未完成，UAT保持开放；不等于双车间/来源公平完成。本聊天未部署或操作生产，见既有[UAT-320 Evidence](implementation/evidence/UAT-320_SERIES_ROUTING_READINESS_20261015.md)。

2026-10-15 原聊天已记录 UAT-320：通过正式 Routing preview/PATCH 为剧集来源发布 revision1，摩登家庭 S02/S03 原 Subject 已创建 active Run 并进入身份核对；仅证明原停滞点解除，不代表整季完成。缺配置却显示 preparing/in_progress 的展示缺陷仍开放，由 LIBRA-ATTENTION-WORKSHOP 的 Owner readiness/attention 工作覆盖。后续合并升级保留 Evidence 中精确两季任务及新增事实，不执行默认清场；现场及具体身份见 [UAT-320 Evidence](implementation/evidence/UAT-320_SERIES_ROUTING_READINESS_20261015.md)。本聊天未直接核验或操作生产。

2026-10-15 LIBRA-ATTENTION-WORKSHOP / LIBRA-SOURCE-FAIRNESS 已在唯一活动 Phase 开工审查。二号容量已获用户确认：全 Libra 共用默认5、0–32；Series Subject/Run席位一致性和低成本执行反馈接口边界待确认。尚无实现、测试或UI资格，不改变最近已记录生产身份；本聊天未操作生产。


2026-10-15 JAV首版已完成本轮发布资格并标准部署生产：markmahoro/shelfdeck:037592bef4，source 037592bef4441ceda87b3270f6e70cb7857da3a7。11:46:57 UTC复核mode=running、normalSupplyAllowed=true、faulted=false；556条原收藏和原入藏Receipt保持，已观察11条新Libra执行成功。机器合同121/104/204/51、147 routes。完整生产副本200→204/199旧表逐行保护、真实完整Host正常供给/33协调器推进、停止及使用后回退拒绝通过；生产按授权清理6个未结束Subject与精确discarded旧记录，86表范围外保护及49个伴随文件物理身份保持。最终UI变更经负责人宽/窄两项接受，其余继承原接受；Web186、Service642 pass/29既有skip与Linux20条业务的精确backend字节继承范围明确，最终实际镜像Native/API/源码/资产及Windows独立Service包复核通过。生产五挂载/QSV、fnOS及13个无关容器保持。具体原始失败/观察超时、Annex、备份及回退限制见现有JAV_RELEASE_COPY Evidence；不追认为每站长期可用、整季生产E2E或Electron资格，不批量关闭既有UAT。以下较早段落为历史快照，不覆盖当前授权与事实。

2026-10-15 用户明确授权三步推进：另开聊天排查生产任务长期停滞并修复，合并修复后用生产完整副本演练升级/回退，演练通过后标准部署生产。诊断聊天01a13ebb-f373-7670-a207-64797e8c7c31已建立；主聊天统一控制安全停机、备份、精确清场及发布，诊断期间保持生产只读。必要生产停机/标准部署不再以旧“未授权”文字阻塞；Reset仍需冻结可审查范围并通过原保护门禁，不能清掉未决非pure Effects或已入藏事实。

2026-10-15 JAV-RELEASE-CANDIDATE：最终本地候选 markmahoro/shelfdeck:455873b377 已通过标准构建、导出及独立SHA256校验；实际该镜像Linux JAV核心6/终态恢复8/Movie3/Series3共20条选择场景全部通过。固定锁定依赖FFprobe解决HEVC色彩漏读；备份改为有界完整hash，镜像384MiB容器内P13六项通过。当前Windows独立Service包203表/147路由、包内Native/API及256MiB备份恢复/篡改拒绝通过。2318份Service源码及已接受1qAJmlnq UI字节一致，继承具体版本适用UI接受。P2 121/104/203/51与既有完整整合/精确计数复验的组合证据保持，不宣称重跑过一次全绿整合。剩余部署准备为生产完整一致副本、6 active Libra及20未决Arca settlement-delete Effects的明确收口与实际规模升级/回退资格；4 running Work仍须核验。NAS临时隔离Linux仍按用户决定skip，没有上传、部署、停服、Reset或改生产数据。下一步须先取得仅限原容器停机备份后原样重启的精确授权。详见现有JAV_RELEASE_COPY/JAV_CORRECTION_RECOVERY证据。

2026-10-15 JAV-WORKBENCH-RECOVERY：恢复Intent已原子保存完整Receipt/执行Snapshot/文件现场Observation并追加不可变历史；当前指针不覆盖旧证据。实际Host的Source失败恢复、资料已成功而NFO写入失败恢复均完成同一Correction及清理（2 pass），后一条验证站点选填资料变化不会重写冻结Source Result，原失败Work、视频与原On-deck保持。已接入有界只读现场Preparation；发布/提交后清理的终态恢复、producer temporary及反复恢复后取消、公开API/工作区继续动作和最终版本资格尚未闭合，不宣称恢复功能或生产部署就绪。详见既有JAV_CORRECTION_RECOVERY证据。

2026-10-15 JAV-WORKBENCH-RECOVERY：独立纠正的工作区维护任务列表、八阶段分页/筛选/计数/精确定位、真实Foundation只读过程和交互区无写入取消已落地。Web177、宽窄Playwright10、真实Host1通过；146 routes，121/104/202/50，P2 a6d6375b...。原具体版本UI/全架构结果不覆盖本次改动，负责人已获版本变化通知。继续有文件副作用的终态失败Recovery Intent及同任务新执行，未宣称此恢复已可用或可部署。

2026-10-15 用户已确认JAV独立纠正链路接入工作区维护任务及同任务有界终态恢复方案，原合同确认依赖解除，JAV-WORKBENCH-RECOVERY进入实施。旧终态执行不可复活、原视频/Entry及门禁保持；新Projection/恢复机器合同、用户入口和相应验证尚未完成。NAS临时隔离Linux测试继续为用户决定跳过，非PASS；旧具体版本UI审核不覆盖后续改动。

2026-10-15 用户明确跳过NAS临时隔离容器Linux测试：准备方案不执行，此项不再是等待授权的依赖；状态为skipped by user，而非Linux通过。已有Linux内存组件/只读Kernel证据保持原范围，完整文件Effect及候选镜像尚无本项证据。终态文件失败恢复方案继续向用户展开，未获确认前不改变Foundation终态合同；UI审核与生产一致副本条件独立保持。

2026-10-15 JAV-CURRENT-INPUT-QUALIFICATION：321文件整合已收取，2692 pass/12 skip/0 fail，3125输入前后c7f8ae71...一致、receipt ok=true，前轮Web变化的资格缺口已按新一轮关闭。当前无任务自有测试进程待收取。用户已授权并已向“UI负责人”（01a0912a-0086-74e2-88ab-536c59d3862a）发送具体版本审核材料；源码及重新构建的JS/CSS摘要与验证记录一致，审核结论待收取。后续受Linux执行环境授权、终态文件失败恢复Intent确认、实际UI审核及生产责任未收口的副本资格约束；不能以本地完成/只读生产通过宣称部署就绪。

2026-10-15 JAV-REAL-SCALE-KERNEL：实际3.133 GB生产库只读Kernel完整检查通过（82.54秒），8,701 Outbox/18,402 Control等实际一致性保持；256 MiB堆上限下heap约16.9 MB、RSS123 MB。只读metadata检查，不启动候选Host/升级/写数据，独立副本与Linux业务文件Effect资格仍未成立。当前一致版本321文件整合仍运行，输入未变；其他授权门禁保持。

2026-10-15 JAV-PRODUCTION-HISTORY-READONLY：实际七Catalog分层终态样本156/156通过（101完整冻结图、55既有精确退役规则），27类Owner/Work覆盖；仍是样本、无Owner现场/全副本资格。最新只读生产556收藏（554 Movie/2 Season）、3.133 GB，6 active Libra/2 running Work及20 reconcile_required Effect阻断完整升级副本；无终止/Reset/数据修改。Linux临时容器、终态恢复合同及具体版本UI门禁继续。证据见JAV_RELEASE_COPY。

2026-10-15 JAV-REAL-CORRECTION-UI：当前真实Service宽/窄浏览器完成确认入藏→预览四项文件→确认纠正→清理完成，2 pass并核验原视频/Entry/On-deck Receipt/Libra锁号保持。架构321文件已终结2692 pass/12 skip/0 fail；全输入守卫因两Web修复返回false，Annex独立证明3011份backend输入前后不变，不冒充完整同输入资格。当前UI另有Web175/Playwright10及真实浏览器证据；整体负责人、Linux授权/恢复合同和真实副本门禁继续。

2026-10-15 JAV-REAL-SERVICE-UI：当前bundle与真实隔离Service的宽/窄浏览器确认→唯一入藏2 pass；修复真实长路径引发的确认窗口溢出，长目录E2E/焦点/axe及当前Web175、Playwright10通过。CSS82cb8561...，JSbe48d041...，具体摘要/视觉证据见JAV_SOURCE_HOST；任务自有Host/preview已关闭。冻结架构轮仍运行，其backend输入保持、两份Web输入因本修复变化，不能称最终全输入一致；Linux授权、Recovery Intent、真实副本及整体具体版本负责人门禁仍开放。

2026-10-15 JAV-SERIES-RECOVERY-QUALIFICATION：显式三条Series维护/外部Transcode/Off-deck真实进程恢复全部通过、无skip。架构初轮实际321文件/2703项，2690 pass/1 fail/12 skip；唯一失败来自范围收窄前的Series fanart检查，当前失败文件与相关组合113项复验通过。冻结输入的新整合轮已启动，结果未收取。NAS临时隔离Linux worker已完成只读资源检查与本地可审查准备，授权待回复，尚未创建；Recovery Intent、真实副本及具体版本UI门禁仍开放。

2026-10-15 JAV-OPERATIONS-QUALIFICATION：实际JAV非空Shelf注销及Off-deck公开授权/收口各1 pass，精确四材料Control释放、无关文件与历史身份/入藏Receipt保持；注销保留全部文件，退出只清理冻结Scope。首轮Off-deck fixture误要求立即open已按preparing等待合同修正，没有产品逻辑改动。Movie实际FFmpeg三项无skip通过；显式Series三类进程恢复与319文件架构整合仍运行。平台、恢复合同、真实副本及版本门禁保持，未进入Desktop/生产。

2026-10-15 JAV-AFTERCARE-FANART：补齐当前JAV Standard要求的背景图独立维护及typed MaterialEffectReceipt.artifactKind，修复背景图替换误退役海报；3条维护、1条纠正后维护、1条源失效Host通过，其他图片/视频/Canonical/原入藏Receipt保持。最新102项相关回归通过，覆盖JAV不要求背景图及Movie/Series无新增背景图义务；Service670（641 pass/29 skip/0 fail）通过。P2及边界/语义通过，aggregate b9eae8313bce1eb107eef441546b36efe1a813070c906adbfb0fab6d4529307b，121/104/202/50不变。319文件架构整合仍运行且启动早于最后JAV范围收窄，不作最终版整体资格；Linux、真实副本、恢复合同及具体版本UI验收仍开放。仅Service/Admin Web。

2026-10-15 JAV-AFTERCARE-RECOVERY-CONDITIONS：JAV维护改为accepted站点语义条件，不再由TMDB变化触发；41项相关回归通过，P2不变。实际同站source condition变化后新Case完成且旧失败历史保持；FC2/GETCHU维护两条通过。证据不扩为其他Artifact/全部类别/实时来源或最终版本资格；Recovery Intent/Linux环境待确认，真实副本、最终整合与负责人审核仍开放。仅Service/Admin Web范围。

2026-10-15 JAV-AFTERCARE-POSTER：单站固定资源海报修复已通过实际Host，保留视频/NFO/Canonical/原Receipt并释放旧海报Control；纠正后只用当前Arca来源。修复了压缩Metadata来源恢复缺口并完整核验原Source Result与Fact digest；源失效3次有界失败后无Artifact/目标写入，失败Effect保持，公开check收取unresolved。Current配置Handle和旧Handle拒绝、89相关回归及P2通过。最终整合、维护恢复条件/其他类型、Recovery Intent/Linux选择和真实副本/具体版本验收仍未闭合；无Desktop/生产动作。

2026-10-15 JAV-AFTERCARE-NFO：NFO重建保留Canonical番号，缺失检查时序分歧在Case admission前按精确Material重新取得Custody Evidence；实际Host修复完成/唯一当前NFO/旧Control released/Primary和原身份及唯一入藏Receipt保持、无Provider重查通过。92项相关回归与P2/边界/语义通过，机器合同不变。原318文件整合已exit0（2678 pass/12 skip/0 fail），不覆盖后续全部改动；Source Map已重生成。封面维护、待确认Recovery Intent/Linux环境及真实副本/负责人/发布资格仍开放，无Desktop/生产/原测试集动作。

2026-10-15 JAV-RELEASE-MEMORY：合法138 MB历史Outbox在64 MiB堆实际复现只读检查OOM，Kernel改为逐条完整校验；同限制下检查/完整199表副本/回退资格及末尾损坏拒绝通过，相关22项通过。P3结构专项与P2/边界/语义保持通过，不声明完整聚合或真实生产规模资格。原318文件整合仍在运行且早于本次Kernel变更；Linux Docker Secrets Engine故障已重验，修复本机或独立测试环境选择待用户答复，既有数据保持；Recovery Intent仍待确认。仅Service/Admin Web，无Desktop/生产动作。

2026-10-15 JAV-FC2-FALLBACK：FC2官方经NAS代理与JavMenu直连分别完成live同号title/cover、pinned reobserve、poster派生；JavMenu代理route仍拒绝，未隐藏换线路。新增2条实际Host受控故障旅程：FC2 403后换站、503先3次有界重试后换站；均固定JavMenu同源Metadata/NFO/图片、保留首站失败、一包/一Run/一Commit。修复连接测试把已知Source错误误报500：现映射现有Platform upstream错误，无proof/config写入，unknown异常保持；32项后端/合同与7项相关Web测试通过，源码边界/语义通过。此轮未修改UI源码/bundle或生产，FC2样本资格不等于所有影片稳定可用；CID、完整恢复/平台/发布资格继续开放，Recovery Intent确认仍待回复。

2026-10-15 JAV-INTEGRATION / NAS-READONLY：318个非JAV-Host架构文件共2687项，2670 pass/5 fail/12 skip；5 fail均为新增取消route后旧144/117计数，按真实145/118对齐后5个相关文件47项（45 pass/2 skip/0 fail）复验通过，未重跑或计整个P3通过。只读NAS核验：仍0dbd762d2镜像/200表c00结构、553收藏（551 Movie/2 Season）、数据库约3.1 GB；6 active Run及21 intended/reconcile_required Effect使当前完整副本升级资格不成立。未导出整库/Secret/媒体、未创建NAS文件或改服务。实际7种Catalog摘要均有现存规则覆盖，但未逐Plan验证。Linux Node20.20.2/Sharp0.35.2下12类号码与内存cover/preview、重复派生与错字节负例通过（仅组件，不是Linux文件I/O/镜像资格）。Recovery Intent仍待用户确认；源码变更只修旧计数测试。详情见恢复Evidence，生产停机/Reset/旧责任处置仍未授权。

2026-10-15 JAV-WINDOWS-PACKAGE：Service 打包漏掉17份clean root依赖，已补齐并携带JAV离线Operator；新增fresh `--output`、拒绝覆盖/源目录嵌套/alias父目录，原生fs复制且不删除旧输出或runtime data。仓库之外的实际包独立Node/SQLite/Sharp/FFmpeg/FFprobe启动、202表/145 routes、health/session/Collection/Formation/JAV Integration读取、全部require.cache来自包内及三个拒绝保护通过；最终集成测试1 pass，原Windows/Docker entrypoint guard1 pass。包内Operator只读检查上一发布Movie库eligible，源DB SHA保持，JS bundle仍be48...。Service最终回归670（641 pass/29 skip/0 fail）、Work/Effect/Startup56 pass。新发现terminal failed恢复与“沿原Effect”条款不闭合，已向用户请求新增Arca Recovery Intent的确认；未复活旧Work/Effect、未实现未确认恢复合同。Linux/混合副本/最终UI负责人/发布资格仍开放，无Desktop或生产操作。

2026-10-15 JAV-CANCEL-UI：Arca status 的 cancellation availability 已与取消命令共用同UOW只读校验；纯Source失败实际available，真实写入冲突 unavailable，非预期损坏仍返回错误。Admin Web后果勾选/取消、同输入重试、过期拒绝后刷新、提交防重复/关闭、迟到GET隔离、cancelled→重新查询已接。Web174通过，最后取消错误文案改动后11项相关复验及最终built bundle的宽/窄屏10条浏览器走查通过；两条最终真实Host旅程通过。最终JS SHA256 be48d04168d3079b3efe301e5a584a8a199dfa1857a40f486f103634c8012abc；截图/DOM/键盘/axe及边界证据见 [恢复证据](implementation/evidence/JAV_CORRECTION_RECOVERY_20261015.md)。这属于跨层改动，具体版本UI负责人验收尚未完成，不计发布资格。有文件副作用恢复、最终全量/Linux/混合副本与发布资格继续开放；没有Desktop/生产动作。

2026-10-15 JAV-CANCEL：Arca 专用无写入取消事务、closed Cancellation Receipt、只读前置校验与 Admin POST 已接通。真实 Host 晚期 Receipt/marker/audit 写入后失败整体回滚、成功/精确重放/异请求冲突/过期/伪造 Actor/外来 Entry 通过；取消后重新预览确认→身份提交→cleanup completed，原视频与唯一入藏 Receipt 保持。真实 Workspace 冲突/failed Effect 的取消返回409并保持 attention 门禁及冲突字节。当前121/104/202/50、Arca app26、145 routes，P2 aggregate b61d66725c9f5145a08fc7b4a71915ae4f138d9a951f24c2d8eee3501870712d；DDL保持550b212e5491b273ee9e07290e8ab0065176fbf56d48792bb0f90ed0730d9ae1。相关38、模型/门禁11、Source Map/P2/路由20及当前50事务通用crash suite通过，源码边界/语义扫描通过。UI按钮/操作资格Projection、有副作用恢复、Linux/混合副本与精确版本UI资格继续开放；旧317文件P3结果不能覆盖新切片。没有Desktop或生产操作。

2026-10-15 JAV-P3/NO-EFFECT：原最终 P3 进程已 exit0，317 个架构测试文件及当前 202 表 / 49 事务聚合通过，aggregate c5b16223e6a5b4743e7f2a558e1a88333bdb1b0d6fe82caf2da6a046c249b454。随后新增 Arca 只读 no-effect Observation/model：精确 Source failed / Assets cancelled、实际持久执行 Scope、原 Basis 与无 Effect/Registry/Artifact；相关 10 项与实际 Host Source drift/精确登记过滤旅程通过。该 Observation 不改 Correction、不释放门禁；专用取消事务/API/UI 与文件副作用后的恢复仍待实现。全量 P3 不包含随后新增的两个文件，具体验证见 [失败处理证据](implementation/evidence/JAV_CORRECTION_RECOVERY_20261015.md)。Desktop 与生产范围保持。

2026-10-15 JAV-RELEASE-SERIES/ROLLBACK：真实上一发布两集 HEVC Season 完整副本已在当前 Host 经旧会话/Collection/公开 resume/31秒周期保持 Entry、Canonical、唯一原 Commit、源 SQLite 与所有媒体字节。Movie/Series 无新事实窗口均实际创建/核验完整 backup、恢复到新空目录并启动旧 Host；已有新事实的新副本均拒绝 rollback，没有恢复覆盖。最终全架构/P3仍在原 session 运行，未重启或计PASS。Docker Desktop socket 初始化故障只读重验，Linux仍开放；没有Docker Reset/配置改动、NAS/用户材料或Desktop开发。详见 [发布副本证据](implementation/evidence/JAV_RELEASE_COPY_20261015.md)。

2026-10-15 JAV-RELEASE-COPY：只读 200→202 结构副本与回退资格工具已有 8 项 IO/SQLite 测试；当前 Kernel 准入不变。真实旧源码 da23711dd 的 Movie 单样本完整副本完成 credential/session 连续性、Collection 200、公开 resume→running 和 31 秒周期；源库/视频/poster/NFO SHA、Entry/Canonical 及唯一原入藏 Receipt 保持。人物关联正常刷新 Inventory2，原三份 fact digest 不变。23 项历史 Catalog 漂移由精确冻结 87-capability/1134-schema 档案及终态证明收口；原 Witness 未变、没有注册旧 Executor。69 项历史证明及 101 项组合通过；全架构初轮 2708 项有 24 fail，16 文件修正后复验 235 项（230 pass/5 skip/0 fail），最终全架构/P3 聚合已重新启动，未计通过。P2 c5b16223e6a5b4743e7f2a558e1a88333bdb1b0d6fe82caf2da6a046c249b454 保持。完整生产副本、Series 升级、实际回退、Linux、UI 负责人及异常交互仍开放；[详情](implementation/evidence/JAV_RELEASE_COPY_20261015.md)。无生产、Desktop 或用户测试材料操作。

2026-10-15 JAV-SOURCE-HOST：13 条按类型单站来源/主备和 2 条无号人工确认真实 Host 旅程通过；专用站 native key 精确重验缺陷及生成器 runtime Facade 名称漂移已修复。真实网络 15 个样本完成资格/重验/封面派生，FC2 本轮代理两次 unavailable，CID 仍开放。Service 670 项中 641 pass/29 skipped/0 fail，相关组合 42 pass。严格机器清单同步为 121/104/202/49，P2 aggregate `c5b16223e6a5b4743e7f2a558e1a88333bdb1b0d6fe82caf2da6a046c249b454`；全架构/P3 正在运行，未计通过。来源/资格/结构升级残余见 [本轮证据](implementation/evidence/JAV_SOURCE_HOST_20261015.md)。未开发 Desktop，未操作生产或用户测试材料。

2026-10-15 JAV-CORRECTION-DIRECTORY-RUNTIME：独立目录责任已接既有Arca回收后台/公开精确清单及恢复交互；原On-deck检查不消费Correction目录。真实HTTP Host两条最终旅程通过：空旧Inventory目录自动归档、未知文件保持且只在精确清单确认后归档；冷重启公开证明、原视频与唯一On-deck保持。恢复同样重验当前绑定/扫描根；6项新IO/DAO分支和原15项回收回归通过。曾发现周期巡检等待过长与Host wrapper未转发通知；现由注册Owner scoped wake合并通知、单步推进、周期公平补查及stop等待收口，8项Runner/58项相关组合/32项启动组合通过。完成后通知错误显式报告，不伪造业务回滚。37项Series及21项P2/DDL/Movie组合通过。Web170项、构建及最终桌面/窄屏4条目录/纠正走查通过，键盘、完整清单授权、恢复及Axe覆盖；首次读取两类检查共用一次请求，负责人具体版本验收仍开放。UI JS SHA256 ed58a8fcb156877e320bc9441022f26497229e0b8c550055c5ccbbe86a62bbba。121/104/202/49、domain123/type refs228保持，aggregate97b14fc6f567b9f0ba6c41735807b8852d6e5773475b8697a089d38348e1dc1f；全源码边界/语义扫描通过。完整异常处理、类型来源正式旅程、Windows/Linux最终资格及升级回退仍开放；未操作生产、用户测试材料或Desktop。

2026-10-15 目录切片最终补充：完整 p3-canonical-transaction-crash suite（当前49项 canonical transaction inventory）以 dot reporter 运行 exit0；覆盖合成 Kernel participant fault/回滚/修订围栏/提交后重开，不能替代实际 Arca 条件与文件 Effect 资格。所有本轮测试进程及任务服务器已退出；Desktop 没有 tracked diff。

2026-10-15 JAV-CORRECTION-DIRECTORY：只在已 completed cleanup 的实际 Work/Event/Effect/Result 与 immutable committed context 下构造 closed Scope；精确旧 Binding 父目录/ordinal，根与受保护材料显式保留，32目录/64 KiB 超限拒绝。新增独立 arca_jav_correction_directory_checks；pending种子与 cleanup Receipt/completed 同事务，metadata CAS重验同context/Receipt并拒绝不完整/外来Scope、错误状态和 stale revision。公开纠正真实 Host冷读Scope/种子、实际临时目录未知文件保留及Store负例通过；两项更新后的实际进程退出验证事务内（seed INSERT后）Receipt/种子一起回滚，COMMIT后各一份并重启承接。5项Scope、18项P2/DDL/Scope组合、53项catalog/Kernel/启动组合及14项JAV generic crash组合通过；后者仅证明Kernel合成写入原子性，业务资格由真实Owner旅程另证。121/104/202/49、Arca app25、domain123/type refs228；aggregate48ac04ac733509853ec65a4290271c12dcd94600435de4b6bf42a16c078fcbe8，全源码边界/语义扫描通过。尚未接目录后台检查/归档/公开UI，不宣称完成目录旅程。Desktop实际为历史播放助手，本轮审查/安装依赖/build及旧测试尝试无功能或tracked变更；SSOT §10.9.1未纳入clean范围，用户质疑后明确停止该方向，不复接旧端点。继续Service/Admin Web及完整发布资格；Docker/Linux故障和精确版本负责人/升级回退仍开放，无生产和用户测试集动作。

2026-10-15 JAV-DIRECT-WATCHED 补充：新增真实 SQLite 候选装配测试，验证 accepted Subject 评分/已看优先且其他 Entry direct、旧 JAV provider/title 不污染，并保持原 Record；Perception/Movie 组合37项通过。Desktop 按现有锁文件安装依赖且 Vite build 通过，lock 未改；旧 Desktop 集成两套测试因历史 server 启动入口退出1而失败，40项未执行，不能当作 clean Desktop 资格通过。Linux Docker 与 Desktop clean 端到端、异常/旧目录、正式来源旅程、具体版本 UI 负责人及升级回退继续开放。

2026-10-15 JAV-DIRECT-WATCHED：Perception 独立 direct 已看 Source/key/revision/lineage、boolean/null 命令、完整请求重放核验、独立 watched Resolution 和只读 Projection 已接通；共享候选集合改变后分别重算评分与已看，不向评分决策提交布尔值。真实 Host 设置 true→false→撤回、同命令重放/异参数拒绝、重启和评分原 Record 不变通过；原评分 31 项回归及最终 4 条 Host 组合通过。两条 JAV 正式纠正旅程验证 Entry 与 exact accepted Subject 的评分 4/已看 true 均保留，历史 Record ID 不改写。收藏已看控件和日志已实现，168 项 Web 测试、构建、桌面/窄屏键盘及 accessibility 走查通过；跨层具体版本负责人验收仍开放。36 项来源/番号/A-B/身份回归与 19 项合同/guard 测试通过，全源码边界/语义扫描通过；121/104/201/49、domain123/type refs228保持，aggregate43c7a841c98d1545fe4036e6c2f8a22d66933bb50a8681c3825f6f6cafdf9f94。本机 Docker Desktop 日志为 Secrets Engine socket 初始化失败，docker version 无响应，已终止本次查询客户端；Linux qualification 尚未完成，未 Reset/修复全局 Docker 或操作 NAS。持久隔离、完整异常恢复/旧目录、各类来源正式旅程及升级回退资格继续开放。A/B 不检查缺段；用户测试材料和生产未变更。

2026-10-15 JAV-PERCEPTION-CONTINUITY：Libra公开接受来源variant重建完整Package/验证digest后返回Subject origin；Arca依原Commit/Run/Custody、当前sourcePackage与actual committed Correction/Canonical形成closed连续性Projection。Perception query/Rule4及pure Resolver按Entry→精确accepted Subject→当前identity共享候选选择，隔离其他direct目标、旧identity和纯title；不改历史Record，普通Movie规则保持。真实Host Entry直接评分及accepted Subject评分4在纠正后保持，两条旅程通过；accepted Subject重启公开查询也通过，原Record ID/revision不改写。8项范围/冲突/撤销/已看Resolver单元、28项相关schema/Movie组合、32项Perception/Delivery/P2回归及边界扫描通过。来源query/result及两项Origin/Continuity app DTO闭合，Runtime正式schema validator注入Collection；121/104/201/49保持、aggregate24549d1b6bfc6ba091e9c0c302077d24fd7076d2b79e5331f22e50299ae08d2a。直接已看API/UI、全部隔离的持久/公开旅程、异常恢复、旧目录、各类来源/媒体/平台/UI/升级回退资格仍开放；不以Resolver已看单元宣称已看入口完成。无生产和用户测试材料动作。

2026-10-15 JAV-CORRECTION-CLEANUP-COMMIT：Owner专用完成事务及自动协调已接通，严格消费原Identity Commit、两项成功清理Work/Event/Effect/Result/marker和完整Registry集合；当前双head/原Commit/Control同事务围栏，cleanup Receipt三联列/completed及门禁释放原子，不另做无Permit文件加工。正式清理普通marker与原子marker按各自Foundation协议核验，修正了普通Result持久时点可晚于Receipt及marker无Result列的错误假设。5条受控HTTP真实Host旅程通过：正常公开/重启、Entry直接评分4保持、新来源演员经People接受后关联、完成事务内部实际退出回滚无Receipt、COMMIT后退出保留同Receipt/门禁释放。人物刷新到Inventory3后独立重启核验历史Cleanup Receipt仍通过，不要求current head停在纠正revision；重签伪造Result引用/Artifact locator篡改均拒绝。26项合同/DDL/门禁及139项Foundation/相关回归、P2/边界扫描通过。121/104/201/49，domain123/type refs228，aggregatea677477cddc7f7b908c38d9cad78afda88cb53bc032b55ecfed7aab0bc8d0848。accepted Subject连续性、直接已看入口/历史隔离、完整异常恢复、旧目录及媒体/平台/UI/升级回退资格继续开放。无生产或用户测试材料动作。

2026-10-15 JAV-CORRECTION-WORKSPACE-WORK：独立workspace_write Capability/Supporting Work/Planner/Projection与资源、原Effect恢复已接自动Runtime。专用事务原子提交四Material reclaimed、三Artifact deleted/revision、Registry reclaimed、Receipt Result/marker；回收后只沿实际Effect/Event/Work/marker恢复原Handle，使用PK查询，不伪造active或重新抓网站。受控单站HTTP的真实Host正常纠正/重启验证通过；四个实际进程退出/冲突场景通过：两个unlink后原Effect继续、事务COMMIT后同Receipt重放、事务内Result写入后全登记/Result/marker回滚、残余foreign字节失败并保持attention门禁/视频。143项Foundation/相关模型、28项DDL/物理回归通过，Catalog各suite及P2/边界扫描通过。合同121/104/201/48，shared31/domain123/type refs228，aggregate00df625ecd5d6b4d20b36529cac69b856a1a266796b3250449f75b2f3cf0f5a2。Owner cleanup完成事务/门禁释放、旧目录责任、People/Perception复验和全部发布资格继续开放；正常纠正仍cleanup active。无生产及用户测试材料动作。

2026-10-15 JAV-CORRECTION-WORKSPACE-RECLAIM：已实现closed回收Plan、提交后精确Registry只读查询、成功前置Work准备与物理端口。只核验/回收metadata/nfo/poster/fanart四份工作材料及空scope目录，保留root、正式hard links和未知内容；完整SHA/Physical Identity、执行/Owner guard及原Effect continue_forward均有测试。8项新测试、21项相关文件回归及21项P2/DDL/回收组合通过。公开真实Host正常纠正→formal成功→重启无缓存→四Material/三Artifact预检通过，原视频/唯一On-deck保持、无新增网络请求；错误context、active入口及stale root拒绝。真实检查修复了测试重启根配置及SQLite BigInt精确比较，未放宽围栏。120/103/201/47与P2 aggregate保持，边界/语义扫描通过。尚未接回收Supporting Work/Effect/Registry提交和cleanup完成事务；正常纠正仍停cleanup active，不宣称门禁释放或生产就绪。无生产或用户测试材料动作。

2026-10-15 JAV-CORRECTION-FORMAL-WORK：独立jav_correction_formal_retirement Supporting Work/Planner/Executor、material_commit leaf、资源映射与reality恢复已接自动Runtime。三个真实Host场景通过：公开正常→精确formal Receipt及重启不重复；实际退出在两个unlink后沿原Effect完成；残留alias被foreign替换时原Effect失败、cleanup attention门禁保持，已提交身份/视频/冲突不变。当前视频依实际Current Inventory Binding核验，旧位置退出不再误读为视频丢失；未重抓网站、不新增原On-deck Commit。Foundation Dispatcher修复await异步input/result semantic核验，并有晚期失败/未完成不发布成功的回归；未改变Owner权威。127项Foundation Runtime/Event/Startup、11项合同图、18项相关模型/Planner/Dispatcher及P2/边界扫描通过。120/103/201/47，Domain inputs122/type refs226，P2 aggregate1809881ae48fbc77e2b856ce4e741005f93473bb14e47a85d2b723d2de4ff186。formal Receipt只表达old/retained/stage收口，Workspace Registry/Artifact回收、专用cleanup完成事务/门禁释放、旧目录责任、People/Perception再验证及全部发布资格继续开放；当前正常纠正停在cleanup active等下一步，不宣称总体完成。无生产或用户测试材料动作。

2026-10-15 JAV-CORRECTION-CLEANUP-GATE：实际Identity Commit原子初始化独立cleanup_state=pending，committed身份/原Receipt保持。Entry/Shelf门禁及partial-unique持续覆盖pending/active/attention_required，缺状态观察不释放；另一纠正、普通维护/人物刷新、退出和相关Shelf操作被拒绝。本纠正的只读清理准备可在自己的committed cleanup gate内运行，不借active。completed要求closed Cleanup Receipt及digest，数据库拒绝无证据清门禁；专用完成事务尚未实现，没有通用状态完成接口。真实Owner提交/Off-deck拒绝和公开正常/重启重放两条Host通过；4项门禁、10项正式收口、10项DDL、3项P2及扫描通过。UI新增真实cleanupState，等待/需处理时不提供第二次查询；7项组件、构建及桌面/窄屏2条受控浏览器走查通过，负责人精确版本验收仍开放。自动正式清理Work/Effect/Receipt和Workspace回收未接，当前本地纠正后将保留清理门禁；人物后续关联需待此链闭合后重验，不继承旧版本通过。119/102/201/47、144routes，P2 aggregate 2316cba15fc01372d5623bc9ad9c133769c03ed148871eac24d8efbfe4612ebf。无生产操作。

2026-10-15 JAV-CORRECTION-COMMITTED-CONTEXT：Owner Inventory Commit已在同一原子事务保存closed ArcaJavCorrectionCommittedContext（≤4 MiB）：实际Work/Event/Attempt/idem、精确Receipt digest、完整File Plan及正式Staged Record。非committed必须全NULL，committed三联列齐备且固定Schema；4 MiB仅对该列精确登记，不放宽其他JSON。新增readCommitted与retirementPreparation沿actualResult/marker/历史Revision/Manifest恢复，不伪造active、不重新抓资料。原子回滚/提交后实际进程退出恢复、正常公开重放及引用篡改拒绝已有真实Host证据；独立重启后的只读预检已通过，未发生额外网络请求，原视频字节与唯一原On-deck Commit保持。23项P2/DDL/正式收口测试与package/semantic扫描通过，119/102/201/47、144routes保持，P2 aggregate e8a80dc542e815d17516791fa92c582f444700c8ce4f8bfaa0f9b55161386fe7。自动清理Supporting Work/Capability/Effect/Receipt、提交后竞争门禁、Workspace/旧目录责任与完整发布资格继续开放；无生产动作。

2026-10-14 JAV-CORRECTION-FORMAL-RETIREMENT：已增加 closed ArcaJavCorrectionFormalRetirementPlan（≤4 MiB）及本地物理端口；actual committed Receipt/terminal Evidence、当前 heads、完整 old/new Control、精确 Final/old/retained/stage 路径集合共同构成 guard。只退出已批准 rename 的旧 Binding及声明临时 link，保留当前视频完整字节/Identity，不改 Inventory、Control或历史 Commit。10 项新测试及7项原正式文件测试通过：路径重叠、不同inode的已验证copy、未知/错字节/foreign或reacquired材料、移除中断、head变化、范围扩张和缺失Owner观察拒绝。不同inode测试是同卷copy模拟，不能作为真实跨卷资格。真实Host的Owner原子提交fixture已按实际数据库/Control/Manifest构造并完成只读preflight；公开纠正正常/重启重放回归通过。尚未接入自动清理：正式Supporting Work/Capability/Effect/Receipt、提交后竞争门禁、真实清理进程丢失、旧目录责任及Workspace Registry/Artifact回收仍开放。当前119/102/201/47、144routes与P2 aggregate保持；package/semantic扫描通过。无生产或用户测试材料动作。

2026-10-14 JAV-CORRECTION-ADMIN：收藏交互区新增“核对影片”，通过 Arca 独立 GET 预览、POST 确认、GET 指定/最近纠正状态完成查询、新旧影片/完整路径预览、后果勾选、持久受理及完成反馈；Libra 过程详情保持只读。真实 Host 公开接口旅程通过：错误字段/伪造 actor 拒绝、精确重复确认重放、异摘要同 key 冲突、其他 Entry 状态拒绝、完成后重启无预览缓存仍重放同 Receipt，不重复原 On-deck Commit。预览检查在提交前，Owner 事务内仍复验实际 Basis/Control；修复嵌套 SQLite 事务，没有放宽原子约束。前端 164 项、桌面/窄屏 JAV 初次确认/纠正与 Series 收藏 6 条受控浏览器走查、构建通过；本次浏览器使用受控响应，不替代真实来源或 UI 负责人对具体版本的验收。当前 144 routes（143 Admin + public health）、119/102/201/47 合同；P2 aggregate 12cbd8f039bbdc8b9017d9ff933ef974e223964522e9e2efaa9db568f3554e58。A/B 合并、单独 A、单独 B 真实 Host 复测通过，不设缺段门禁。提交后清理、Perception 剩余连续性、完整错误恢复、UI 负责人及跨平台/发布资格仍开放；无生产操作。

2026-10-14 JAV-CORRECTION-OWNER-CONTINUITY：带演员的真实Host旅程已验证当前Arca normalized relation Projection与People公共接口：新站New Actor进入新Inventory，旧Old Actor只保留历史；新姓名无Person且不阻断入藏，经精确People Registration Candidate用户接受后，Arca依公开accepted-origin proof形成人物记录新Inventory revision，原Correction Receipt与唯一On-deck Commit保持。后台证据及记录刷新按既有30秒cadence，测试覆盖完整周期，未修改调度规则。另一真实Admin API旅程验证同一Entry的直接评分4在号码纠正后重建Resolution仍为4、record identity及direct revision保持。已接受Subject的连续性、watched直接记录/纠正、旧身份外部或其他Entry隔离仍未验收，不以本次两条通过宣称Perception完整关闭。提交后清理、完整用户入口/错误处理、平台/媒体回归及发布资格继续开放；无生产操作。

2026-10-14 JAV-CORRECTION-RUNTIME：inventory.commit 已接正式 Supporting Work/Planner/Executor/Coordinator和独立资源解析。正常真实Host从Source/Assets→stage→publish→独立verify→atomic commit完成新Canonical/Inventory/Control/Receipt，重启不重复；原视频及唯一原On-deck Commit保持。路径重叠的提交前HTTP旧poster/旧身份与提交后新head已通过；原Owner晚期失败回滚fixture保持。独立进程在Receipt事务COMMIT后、journal完成前退出可沿原Effect消费同一bound Receipt；在事务内部写入Result后而COMMIT前退出，则身份/库存及全部Control完全回滚，随后原Effect恢复提交。短Workspace写入、Stage进程退出和冲突attention三个回归通过。当前119/102/201/47合同、相关模型/Planner/P2及package/semantic扫描通过。提交后旧路径/retained/stage/Workspace清理、People Origin与Perception连续性、错误处理及用户入口、各类来源/平台/回归和发布资格仍开放；无生产操作。

2026-10-14 JAV-CORRECTION-ATOMIC-STORE：专用 inventory.commit Capability/Receipt/Canonical transaction 合同已闭合（119/102/201/47，P2 digest 931dd050a09fcd938bb41a6bab9efdf0a6aebdc645b61d617e81bcdf6cdc6356）。Owner事务在同SQLite UOW重验五个精确前置Result、成功Work/执行fence、actual active Admission、完整Manifest/Verification、当前Basis及逐材料Control；新Canonical/Inventory双head、Control、Correction terminal和Receipt/marker全有或全无。隔离真实Host持久证据加执行fixture已通过：晚期identity写入失败、Result写入失败与过期执行fence均零残留；成功与精确重放不新增任何On-deck/Aftercare Commit，原视频及原Receipt保持。Metadata/Cast以有界Record+来源/规范化relation证据保存，64名长姓名预算及完整重建/tamper测试通过，不截断可选资料。当前仍未接最终commit Supporting Work/Executor/自动Coordinator；正式Runtime进程丢失重放、提交后清理、People Origin/Perception连续性、UI与跨平台/发布资格继续开放。不是完整纠正旅程PASS，无生产操作。

2026-10-14 JAV-CORRECTION-INVENTORY-PREPARE：从同 Scope 完成的 Source/Assets、stage、publish、final Verification 持久结果构造新 Arca Identity/Metadata/Cast、Inventory revision 及精确 Control changes，真实 Host 提交准备旅程通过，尚不写任何收藏 head。当前 actor hints 仅名称；经 People 公共 Reference Query 的逐 hint accepted-origin proof 关联，不按姓名猜测、不借整片 Observation digest 关联所有演员。未知人物保留新站署名且不阻断。原质量/瑕疵 Facts、Shared Related 和原 On-deck Receipt 保持；未变视频 assert 原 Control，替换资料 release/acquire，跨卷 copy 身份变化按精确新旧 Material set 处理。25 项相关模型/合同测试及 package/semantic 扫描通过，当前 118/101/201/46 合同保持。专用最终原子事务/Receipt、crash replay、清理、People 后续 Origin 消费、Perception 连续性、UI/跨平台和发布资格仍开放；未部署或修改生产。

2026-10-14 JAV-CORRECTION-VERIFY：独立 files.verify/domain_fact_commit Work 已接通，真实 Host 普通及路径重叠两条旅程通过，完整目标 SHA-256/Identity、旧 retained Identity、实际 NFO 番号/title 独立核验；Verification/Record/Result/marker 原子且重启保持。漂移、缺失 retained、错误/重复/旧 TMDB identity、无实际 active Admission 等负例通过；原视频、旧 Canonical/Inventory/唯一 On-deck Commit 保持。当前合同 118/101/201/46，package/semantic 扫描通过。Canonical/Inventory/Control 原子提交、提交后清理、验证事务中进程丢失专项、People/Perception/UI、跨平台及完整发布资格仍开放；files_verified 不代表纠正成功。无生产操作。

2026-10-14 JAV-CORRECTION-PUBLISH：files.publish独立Work/material_commit/Placement Receipt已接入，真实Host切换与新旧路径重叠旅程通过，原视频路径/字节和原Canonical/Inventory/Commit保持。全部原材料先建立固定exact retained link，再exclusive发布目标；六项文件测试包含替换途中恢复、外来碰撞前零副作用和重放。Arca Current poster在pending Correction/相同旧revision/key/binding/Basis下经旧Identity校验读取retained alias，真实HTTP仍显示原封面；不提前发布新身份。117/101/201/46合同、相关18项合同/文件测试及Collection7项回归、package/semantic通过。独立最终Verification Work、Canonical/Inventory/Control原子提交、清理、People/Perception/UI及完整发布资格仍开放；文件切换不是纠正成功，无生产操作。

2026-10-14 JAV-CORRECTION-RECOVERY：正式来源Result已冻结四个输出SHA-256/byte count，Workspace执行重建必须吻合；短期Integration Handle从持久Event输入移除，Platform按冻结config在网络调用时重新核发，未放宽有效期/配置检查。专用恢复逐项核验本地文件、完整Registry及精确前置Result；真实独立进程在NFO写出后退出，可沿原Effect ID/Source Result恢复，不重写已有NFO或原视频。退出后冲突字节则结束Work并进入attention_required，保留冲突文件、旧Canonical/Inventory/唯一Commit/视频；不默认为absent，不自动删除冲突。修复Foundation缺失terminal_failure执行分支及策略重复reconcile循环，110项Runtime/Policy/Startup测试通过；四条真实Correction Host旅程通过，18项合同/恢复测试及package/semantic检查通过。Workspace原子发布已完成：固定recipe temporary经fsync/完整核验后exclusive link发布，真实进程退出覆盖完整发布、最终冲突及写入一半三种场景，原Effect恢复通过；短临时文件只能在Foundation明确cleanup_then_rebuild后清理，完整错误/未知/最终冲突文件保留，发布抢占目标负例通过。人工处理完整冲突的用户入口仍未完成；正式收藏文件替换/验证/最终Canonical+Inventory提交、People/Perception/UI和完整发布资格继续开放。无生产操作。

2026-10-14最新执行前切片：Correction持久Record读取、nonterminal lifecycle CAS/重放及禁止普通状态更新伪造成功已接通；同Entry维护/记录刷新/退出、整架注销及相关Standard/Placement/Template变更已加Owner gate，真实入藏Host验证拒绝并保持旧Inventory/Commit/视频。维护/退出回归通过；旧注销fixture identity_kind已修正为tmdb_movie，超过10000-member及重启注销复验通过。Arca自己的同站Metadata fact value/NFO重建及tamper/escape tests通过；仍未接正式Correction Supporting Work、Workspace注册/文件Effect、最终Canonical+Inventory Commit、People/Perception承接和UI，不把本切片视为已完成纠正或可部署生产。无生产操作。

2026-10-14最新Correction切片：Arca独立Basis/Proposal/preview proof/Admission Receipt已实现，缓存32份/10分钟、单站title+cover与精确旧新路径、原Physical Identity/碰撞/未知目录成员检查通过。新的201-table/46-transaction合同与Kernel、P2、semantic和全树package boundary通过；200-table历史target仍为显式冻结测试目标，Host使用当前201-table digest，未增加旧Formation fallback或自动迁移。当前201-table真实Host Direct入藏后，独立Correction受理、陈旧Control整事务回滚、缓存无关Receipt replay、并发另一Correction拒绝及旧身份/Inventory/Commit/视频保留通过。受理仅记录用户Intent；正式Supporting Work/文件Effect/最终Identity+Inventory Commit、全Arca竞争门禁、People/Perception承接和UI尚未接通，不把admitted当纠正完成。没有生产动作。

2026-10-14 JAV-PARTS 本地事实：实际同目录同号A/B在Procurement发布一个immutable Package；Libra按冻结A→B进行明确FFmpeg copy Remux并验证逐段Probe、初始化签名、合计时长及接缝实际帧；Arca一个final Primary及唯一Commit。隔离Host六条旅程已通过：常规HEVC Direct、无号人工确认、A/B Remux、单独B、不兼容参数保留原源并以真实Plan拒绝Evidence收口、H.264 A/B先合并再HEVC Transcode。规则不声明预期分段全集、不设置缺段门禁。用户DDT-548原源之外的合并文件1111942864 bytes/6222061ms通过完整H.264 canonical顺序码流和267960 AAC包核验；原源size/inode/mtime/ctime与bounded fingerprint保持，未移动/覆盖/删除。测试集10/10只表示番号Claim，不等于真实影片确权。

2026-10-14持续开发事实：正式单站 Identity Observation→原子 Fact/Subject lock、Metadata 同源 binding、真实 Workspace poster/fanart/nfo、真实 HEVC Direct/播放核验→Handoff B→Arca 验收/落位/结算/唯一 Commit 已在隔离 Host 通过；无号材料经工作区正式 preview/choose 入藏、重复 Receipt replay 和确认后异号拒绝也通过。Artifact Result 现在保留完整 source/crop/renderer/output 派生证明，JAV不沿用 Related NFO/图片。独立 JAV 推荐模板不改旧标准；Arca Profile 按正式身份选择。Admin Web 编译和既有152项测试通过，新JAV交互6项通过；尚无浏览器/负责人验收、Arca已入藏Correction、完整跨平台/来源各类资格或生产升级资格。本目标保持 active，无生产动作。以下2026-10-13准备段为历史设计/证据，未完成项以本条实际状态为准。

2026-10-14 JAV继续本地开发：既有Product Identity preview/choose入口增加JAV分支，按类型配置来源执行单站主备；完整资格成功即停止，真实多候选保留歧义，暂时失败同站最多2次。选择以服务端预览、Snapshot/resource/cover digest为依据，原子写Libra immutable Intent及Foundation Receipt，未确认允许新revision改号、旧preview/迟到响应围栏、首次身份已有时拒绝新选择、重启/过期后原Receipt仍可重放。新增64 KiB typed selection record，Movie/Series列NULL；新DDL仅clean-cut准入，旧schema拒绝前不写修复，历史迁移目标保持原样。73项相关测试通过、P2/table/DDL及全树package boundary通过；真实Admin HTTP preview为受控transport，已修正原测试使用fetchImpl而Host实际要求integrationFetch的注入错误。正式JAV Identity Work/Fact及原子首次提交围栏尚未接通，Workspace正式Artifact、完整上架、Arca纠正和UI仍待开发；无生产动作。

2026-10-14按用户要求转入功能代码：8类站点parser/有界HTTP观测、匿名Platform配置/test-proof-save-read/重启与receipt恢复、精确source/config/route Handle校验已接入clean service；Admin会话保护HTTP配置测试通过，网络错号/歧义/越界/超时/变图不隐藏换站。内部JPEG poster/fanart派生实现71/50 crop与字节摘要，仅prepared bytes，未冒充正式Workspace Artifact。JavDB IPX-177直连、FC2官方FC2-718323经用户NAS代理，由实际Runtime在隔离临时SQLite中测试→保存→再次观测→海报准备均成功；没有真实视频读取/生产配置修改。Windows专项79 pass/0 fail/0 skip，package boundary与P2校验通过；全库semantic扫描命中HEAD已存在且本轮未改动的perception-store.js:542注释“candidate membership”，未放松规则或改该文件。本切片无新semantic finding。Libra首次正式身份/锁号、Workspace注册/Effect、上架/Arca纠正及UI仍待接通，Linux/完整构建未测；必要合同已直接写SSOT，不以准备文档收口阻止后续开发。

2026-10-13 JAV来源基础子合同Ready后进入本地机器实现：新增jav-source-contracts.js及专项tests，形成完整号码/CID anchor、grammar/anchor摘要、按类型有界Source Snapshot/语义校验；IntegrationHandle schema/shared registry闭合anonymous/secret jav_source分支，原Secret-bound Provider形状/认证不放松。T38前缀搜索找到真实影片，JavDB T38-071/072主番号/title及1000×673声明封面解码/派生通过，当前字节Evidence共20行；JavMenu备用429/无主资料未通过。CID新增官方ipx00177/ssis00698仍无完整主身份/映射，不用同一200壳页或公开JS确权。Windows合同/Provider回归84 pass、0 fail/skip，IBW有/无Z保持独立的最后grammar修正后9项源合同复验通过；P2固定摘要已对齐合法Handle结构变更，counts未增加。当前仅纯合同代码与机器schema，source helper尚未绑定正式Intent/Result，Platform resolver/资格Effect/首次Identity事务/Arca Correction及UI仍待实现，无生产动作。

2026-10-13用户接受未确认身份旅程：需要处理→交互区确认番号→查询/预览→精确核验成功后首次确认并继续；确认前可反复改号、关闭后稍后继续，自动唯一合格匹配也会确认，首次成立后Libra锁号。继续准备取得两份新增叶子正例：JavMenu/N1230（820×462 cover）和AvWiki/259LUXU-1022（840×472 cover），主身份/title及声明图片真实解码/裁剪通过；均为独立直连，NAS分别reset/无主资料壳页，不能隐藏route切换。T38真实正例与CID映射仍开放。SSOT补齐先source/cover资格再首次Identity的依赖顺序、latest Selection Intent围栏、Command Receipt与Fact区别及重放顺序；typed机器传播与完整Host尚未完成，无业务代码/生产动作。证据与Gate均在唯一Phase及既有来源Evidence。

2026-10-13 JAV身份旅程按用户最新决定简化：Libra不允许途中改番号，正式Product Identity首次确认后锁定；尚未确认的文件名Claim/输入/查询预览不锁，用户可在“需要处理”交互区补填、查询、查看候选并再次核验后首次确认。单站title+可用cover资格通过才可确认；无号/歧义/不完整来源保留原材料，不强行上架。已确认后不同规范番号请求拒绝，旧Plan不变，取消尚未实现的点击核对等待/Review Session/换号replacement与跨Run承接方案；首版已入藏Arca保留视频Correction仍保留。SSOT和唯一Master/Phase已调整，无Review代码需要兼容/迁移/Reset，无生产动作。下面点击等待段落是已被本条取代的历史决定。

2026-10-13简化方案复验：SSOT Source Map已同步，source-map check及P2 contract baseline通过、findings0，git diff --check通过。仅合同与引用同步；未确认身份的JAV交互、番号锁定及Arca Correction尚未实现，不宣称运行或UI资格。

2026-10-13核对门禁文档收口（历史，已被最新简化决定取代）：用户确认的点击等待语义已回写SSOT/唯一Phase/Master；Source Map及P2基线复验通过、findings0，现有机器目录不变；4份当前文档链接和git diff --check通过。只完成合同/引用验证，没有Review gate代码、浏览器/UI或执行中FFmpeg/落位/Commit竞争资格PASS，生产保护范围不变。

2026-10-13用户确认JAV“点击即等待核对”：媒体整理工作区交互区【核对影片】经服务端持久受理后阻止该媒体后续推进/上架；当前Attempt按Effect收口并释放资源，其他媒体不受影响。确认原影片/明确取消后重验Basis继续；确认换号撤销旧身份提交资格并合法替换/重验，不能在旧Plan换参数。关浏览器/网络断开/重启保持pending，不作自动确认。SSOT与唯一Phase/Master已承接该已确认行为，Review typed/runtime/UI未实现；下一段PROPOSED状态只保留为用户回复前历史时点。

2026-10-13 JAV执行中核对设计复查：现Movie/Series在FormationPage用户操作列触发ManualIdentityDialog，过程详情展示；已按用户纠正把JAV核对入口改回逐媒体交互区。SSOT移除上一稿Handoff B后“安全退回”的歧义，责任始终留Arca，不改变单向Handoff。当前没有Review Session/gate代码，执行中开启核对的持久门禁、Attempt/Effect收口、确认/取消与迟到结果隔离在唯一Phase作为PROPOSED方案，不宣称已获确认或实现；独立来源/合同准备继续，未部署/停机/Reset。

2026-10-13 JAV本轮文档门禁完成：SSOT Source Map与P2 contract baseline检查通过，当前目录113 Capability / 99 Result family / 200 Table / 45 Transaction、未解析type ref为0；P2 aggregate 2da8328724e77634ef8ac8a910b31569234d3896eef02f0fb0547e997dbadf37。414份既有contract JSON变更剔除source locator及其派生摘要后与HEAD业务结构一致，5份当前文档本地链接无缺失，git diff --check通过。新JAV/Correction typed注册、推荐Template title-only源码、Runtime、真实Host与具体版本UI仍未实现/验证；这些检查只证明文档/引用基线，不能使节点1或功能Ready自动通过。

2026-10-13 JAV最新决定与准备事实：用户最终确认单站主备，title+可用cover为网站最低条件，选填不阻断、不跨站合并、JAV321不强制；该决定替代此前更强Required字段与跨站补缺建议。SSOT、唯一Master/Phase与来源矩阵已更新。用户进一步确认首版含已上架后保留视频的身份纠正，Arca独立Correction、Entry/收藏连续性及不改原入藏历史已回写合同；typed状态/事务/Effect/感知Owner连续性尚待闭合，没有Correction代码或UI。来源已取得常规、FC2、日期型、MUGEN/IBW/T28、RED/SKY/EX/K、HEYDOUGA官方、GETCHU/GYUTTO的单站title/cover/identity及解码叶子样本；N、数字前缀259LUXU、T38及CID完整资格仍开放。HEAD基线da23711dd、生产最近记录0dbd762d2，无生产查询/部署/停机/Reset/重处理；旧35pass/2skip不扩写为功能通过。详见[来源Evidence](implementation/evidence/JAV_SOURCE_READINESS_20261013.md)与[当前Phase](implementation/CURRENT_PHASE.md)。以下JAV段落是较早时点事实，不覆盖本条最终范围和live结果。

2026-10-13 JAV来源范围再次确认：用户要求特殊番号也接入专用资料来源并完成抓取/上架，按番号类型明确选择；不再仅记录为JAV321无资料后的待处理。唯一Phase已承接类型→候选来源映射、顺序/预算、换源独立Plan、响应identity复核与逐类验收；新增源码差距为现有Metadata Planner按provider:jav前缀只容许一次JAV来源。参考FC2/FANZA等Adapter还有输入ID回填/只产CID、studio字段语义等需细化项，不作为强身份Oracle。仍为文档设计，站点live资格与新功能测试未执行，无业务代码/SSOT/生产操作；前条“特殊类别附加来源待闭合”仅保留为本次回复前历史范围。

2026-10-13 JAV用户决定及参考审计更新：必须接入JAV321，特殊番号和封面参考Yuukiy/JavSP，多分段暂不考虑；用户已纠正前述JAVSAP名称。参考冻结HEAD c4cfe61188234dd24c75b53b42b054327fef3e58，已只读核对番号、JAV321品番/页面解析、分类来源组、fanart→poster默认裁剪及五份历史JSON字段；发现识别与资料完备须分开验收，匿名Provider Handle和派生Artifact需合同细化。特殊类别附加来源、命名与身份纠正等仍待闭合。已回写唯一Master Plan/Phase；没有启动Reference应用、复制源码、live刮削或下载图片，没有业务代码/SSOT/生产变更，准备专项仍为35pass/2skip，不新增资格PASS。下条“Provider/输入未确认”为回复前历史状态，本条取代相应待定项。

2026-10-13 JAV准备初审完成，基线da23711dd：现有Triage、推荐标准和ThePornDB适配可作为基础，但公开观察入口、正式Product Identity提交、Arca profile与Aftercare、Admin配置/身份入口仍有明确缺口。Windows准备专项37项中35通过、2个旧JAV纵切skip、0失败；受控Provider响应不等于真实资料或全链路验收。唯一活动[CURRENT_PHASE](implementation/CURRENT_PHASE.md)已承接差距、待确认决定、五节点顺序与验收条件；Provider、输入覆盖、默认命名及身份纠正等尚未确认，未开始业务实施。没有新增UAT、版本名称、UI PASS、构建或生产操作；本轮未查询生产实时状态，最近生产身份仍以下文0dbd762d2发布记录为准。旧段落均为各次时点事实，不覆盖本条当前准备状态。

2026-10-13安全停机与用户Formation Reset已生产发布：markmahoro/shelfdeck:0dbd762d2，git0dbd762d296e7d936f11e7647e1c40210d624c6e，NAS Image sha256:1b36d623eb64c1fba474cb638647afb30dea82aa6c03b2f68f5532c47dd02c3a；tar562240000 bytes/SHA256 ba1ad12f6be4caf53603e1dd04cdf6309b3e87e0e51bc7aa74b74d45e1bb4a4f。发布前完整副本发现0bc启动竞态，修正后Windows37/Linux精确82、完整旧版/候选/候选数据回退通过，UI资产不变且负责人6cee7e732接受继承。标准checksum/dry run/readiness/apply/health/正常供给/Admin/五挂载/QSV通过，RestartCount0/OOMfalse，生产StartedAt2026-10-13T11:22:43.206436246Z。实际Chromium验证安全停机可用、运行中Reset禁用、收藏/整理GET200；前两次浏览器等待超时保留，第三次通过，不作为1秒SLO资格。Entry523/Commit523/Run661保持，Material38477为正常注册进展，原20条destructive_commit reconcile_required保留。完整备份和旧镜像保留，Avail约16GiB。未执行生产停机/Reset或重处理五项媒体；未做NAS长时FFmpeg停机/断电及完整Electron分发。OPS发布资格Phase已Exit归档，UAT-318/319等按原条件保持；详情见implementation/evidence/OPS_RUNTIME_RESET_20261013.md。

2026-10-13安全停机/用户Formation Reset本地开发验收完成，最终产品0bcaf5a1128c2aebb38c8507df5c75f7c565a250；标准镜像markmahoro/shelfdeck:0bcaf5a11，tar562240000 bytes/SHA256 1141879eda514155d66a029081af8fb041d5c9173ed95b2271ca3d60d0a2a168。Foundation停机/显式恢复、在线读和业务写门禁、重启保留停机、隔离备份/精确Reset、历史/收藏保护及中断拒恢复已验证；Web152、desktop/narrow8、后台Linux80及最终镜像包装专项6通过（适用继承见Evidence），UI负责人最终接受commit73547f3a4。Phase已Exit；未部署、未执行生产停机/Reset或重处理五项媒体，生产仍为2f9560bcb。未做NAS长时FFmpeg/断电和完整Electron分发，详情见implementation/evidence/OPS_RUNTIME_RESET_20261013.md。

2026-10-13补核文件来源扫描状态：两目录实际可读（Film991项/chn_series45项），但后端仍投影本地10:27的最新扫描失败；12小时失败准入间隔使下一次最早22:27左右到期，重启不提前重试。这不是浏览器缓存或当前再次断挂载。此前服务恢复检查漏覆盖来源扫描状态，319仍开放；即时目录恢复自愈暂缓，未触发扫描或处置生产任务，详见319 Evidence。

2026-10-13用户在已知完整本地副本Host/回退演练未完成后，明确指示直接上生产。标准发布2f9560bcb36a2ef09ef4f538021a88f75c5a9136完成，NAS镜像sha256:48e229fce27309ca1860d73f0cfebb93f9fb34d76ac3cc65ef5536531aa38462，tar SHA256 ac797372cc19715a241f3b25217154127df0161175199890cc0485f6e76204f2。备份integrity ok/FK0、checksum/dry run/readiness/health/normalSupplyAllowed/Admin/五挂载/QSV通过，RestartCount0；CIFS稳定v2证据纠正已正式apply。生产518 Entry/518 Commit/38218 Material/655 Run与冻结备份一致，五项媒体未人工重处理，MoviePilot及其他服务正常。完整镜像57项、部署工具双平台各3项通过；UI资产与aef验收逐字节一致。真实浏览器6轮整理中0.326–0.844秒，收藏10次有效样本0.246–1.779秒，仍未稳定1秒且海报更慢；网络timing发现部分API发送前排队1.2–1.5秒，与同源海报请求并发重叠，UAT-318开放。UAT-319永久修复已上线，真实再次重挂载资格未做，不声称文件来源恢复自愈已实现。盘Avail约20GiB，暂不全面清理。详见318/319 Evidence；原版退出超时及readiness工具缺陷均保留记录，部署工具修复commit2bb44c61d，不改本次产品镜像身份。

2026-10-13用户提供本机Z:\（群晖Media映射）。最终2f9560bcb本地只读Docker探针确认/media/Film可访问，但Docker Desktop实际呈现ext4 /dev/sde、mountRoot=/mnt/host/uC/192.168.12.45/Media，不是生产CIFS证据，不能用于证明原Scope完整Host启动通过。已请求本机SMB凭据文件路径以作Linux只读挂载，不接收聊天密码、不跳过身份合同。最终候选与已验收aef74a3ef的JS/CSS SHA256逐字节一致，无新增前端差异；生产复核health200/status ok/normalSupplyAllowed=true。候选仍未部署，完整Host及生产1秒验收待完成。

2026-10-13最终局部候选2f9560bcb已在本机标准构建：tar562221568 bytes/SHA256 ac797372cc19715a241f3b25217154127df0161175199890cc0485f6e76204f2，Linux精确镜像相关57通过。最新518 Entry快照完整Collection/健康筛选/overview各四次old/new对照输出全部一致；最终最近浏览77–87→50ms、筛选655–726→398–411ms、overview560–604→292–294ms，overview SQL1071→273，事实正文读取约减少90%。这些是本机只读完整查询测量，不是HTTP/浏览器实际内容或生产1秒资格。完整本地Host演练仍缺群晖SMB凭据配置文件路径，问题已向用户提出；不重启NAS副本演练、不跳过发布门禁，候选尚未上传/部署，318/319保持开放。生产仍已恢复的505原版，本机任务查询容器已停止保留后续验证用。

2026-10-13原版恢复完成：仅以Platform显式工具纠正Media Scope两个错误digest为当前runtime-v1，ID/revision保留；505844a8b于03:57:09.204 UTC启动，04:02 UTC前后health200/status ok/normalSupplyAllowed=true，Admin及MoviePilot页面200，RestartCount0，两个媒体挂载均SMB。不等于CIFS稳定指纹新版已发布。后续转本地性能验证：最新518条完整查询old/new结果一致，最近浏览73–102→51–52ms、健康筛选708–760→393–403ms、overview584–627→303–306ms，overview事实正文139780924→13951089 bytes；仍有1,000多条SQL，定位Perception逐Record读取并在其Owner Store内补批量读取，Windows相关34通过，未构建最终新候选或部署。Windows zh-CN与Linux en-US的历史Record排序摘要差异保留失败证据，Linux完整查询通过，不跳过校验。

2026-10-13最新用户顺序：先恢复原生产版本505844a8b；性能/挂载代码修复只在本地验证，完成后再标准升级NAS并独立验证生产前端改善，不将副本演练与原版恢复混为一谈。NAS任务自建uat319-current副本验证已停止且容器不存在，未计通过；当前正式恢复仅对已核实的Media Mount Scope两个错误digest执行有界Platform纠正，保持ID/revision/媒体记录。待优化项准确名称为“文件来源目录从无法访问到恢复访问时的自愈机制”，ShelfDeck不负责SMB重连，今天不实施。

2026-10-13 UAT-319：用户授权NAS重启后的两服务重启及挂载缺陷修复。MoviePilot HTTP200；ShelfDeck容器已恢复SMB，但临时设备号0:93→0:81引发HELIX_MOUNT_SCOPE_UNSAFE，服务尚未就绪。Platform稳定CIFS指纹与显式CAS证据纠正工具Windows17项通过，尚未部署/纠正生产。媒体及Scope ID/revision保护，不Reset、不重处理五项媒体。aef性能/UI候选已获具体版本UI接受，但完整Host演练中断未通过，UAT-318仍开放。本机任务演练容器已停止删除；NAS先前nice_taussig在重启后已确认不存在，不再增加NAS重型对照。

2026-10-13追加UAT-318：用户明确“整理中”及“我的收藏”点击至实际内容小于1秒、管理响应优先于后台吞吐；原则已补SSOT §10.6，不新增调度器。505生产再次复现27–35秒等待，轻量health同样迟到；采样热点在Arca健康批量读取历史事实。当前本地按当前Inventory Revision提前过滤及克制加载反馈补丁已通过相关68服务/21 Web/4浏览器测试，1服务进程恢复未启用；514收藏同快照完整输出一致、局部428→212ms，不是生产达标。尚未发布、Linux最终镜像/UI负责人及生产1秒验收待完成。NAS SSH连续握手失败；只读隔离对照容器nice_taussig的停止未获确认，须先复核该任务自建容器；不停止生产业务，不重处理五项媒体。

2026-10-13最新生产为markmahoro/shelfdeck:505844a8b，git505844a8bade56e7705ee47e0d578874f9117efa，Image sha256:73484068340fec14df3e66d52d2689a6c586c5dbab21d91807faf58af20de6c4，tar1724124160 bytes/SHA25638362057d5b1f516861800485d3d947931e44fe3b8f3f8214dec61bce920932d。标准build/upload/checksum/dry run/readiness/health/供给/Admin/五挂载/QSV通过，RestartCount0，最终镜像Perception专项28通过。加载空态补丁生产多轮复验0次误报；本轮纯后端无UI字段变化，前端保持已验资产。十二轮48请求全部200，十一轮最长约0.99–1.91秒，一轮5896ms；未复现原数十秒，但性能UAT-318保持开放，非完整SLO窗口。五项失败媒体未人工重处理，狂暴女神/sample及正式安全停机/Reset仍暂缓；问题未全部验收，不执行全面生产清理。Avail约25GiB。

2026-10-13第四轮已标准发布24821200d34fe055036c0d11ac5b1dc9afbf6cbd，Docker markmahoro/shelfdeck:24821200d，Image sha256:7f77396fd54c7587969faf588f4a8da718f6585f735319ece6a7e55410028f9a，tar1724123136 bytes/SHA256251935ecf66e3ab26ebb3164d53fa21dd55b31b09d9963ff7189804a57be689b。readiness/health/供给/Admin/五挂载/QSV通过，RestartCount0，最终镜像141通过。前端资产与6feda已验版本一致，纯后端无UI字段或文字变更；实际两轮四Tab空态误报0。十二轮48请求均200，十一轮最长约1.2–2.1秒，另一次6172ms；性能UAT-318仍开放，未重处理五项媒体。追加Perception纯字符串计算缓存28项通过、尚未发布；没有缓存评分、业务事实、候选集合或决策。

2026-10-13第二轮已标准发布 `markmahoro/shelfdeck:6feda0d26`，git `6feda0d26a3d3ff5994a17d23d83ac1bc3a756ce`，Image ID `sha256:88ee3b310b9d07fab4c95914e3936152014a09e601163f9bf38e67b0dc0d9af7`，tar SHA256 `f7fb047d9ebecefa14a5db8b2b7e0e285900d7c46efb59337bd0ab0e5439f11d`。备份integrity ok/FK0/SHA、readiness/health/供给/Admin/五挂载/QSV通过，RestartCount0；最终镜像35通过，跨层UI具体版本66项及实际页面接受。生产Chromium两轮四Tab：有条目Tab误报空态0次；正常空结果保持，未执行媒体写操作。但HTTP仍有15.9秒长尾，UAT-318不关闭；追加采样定位Series候选恢复中反复构造未签发策略Work，局部修正139专项通过、未发布。未执行整季加工E2E/desktop全量，五项失败媒体仍未重处理。

2026-10-13生产已标准发布 `markmahoro/shelfdeck:9a23b01c7`，git `9a23b01c7ff8c5d16272898e2efe3296e500cd0c`，Image ID `sha256:23ec509e81511ee9fc84f50ad61f87c633a4ab8ac6d9cc2e4d508fc24f994a7b`，tar SHA256 `e7d95627ebc588c0161e6e109452f5edc5c479744c307558ea69f868695055ff`。标准checksum/readiness/health/Admin/五挂载/QSV通过，RestartCount0；最终镜像专项79/79，发布前备份509 Entry/509 Commit，本地integrity ok/FK0及SHA匹配。未重跑整季加工上架E2E或desktop全量，五项失败媒体未重处理。真实四请求并发样本旧版三轮4891/2530/4762ms，新版3626/1683/1750ms，仍有长尾，UAT-318不关闭；这不是完整SLO资格验收。用户追加整理中加载时误报空态，纯前端补丁专项14项及Web构建通过，尚未发布；服务优化生产UI审核仍进行中。

2026-10-12 9478a4fc7标准发布完成：Image sha256:d3fcc1f839494fb441835c23ac05da49635432af6db85f526e06ca2fcf6d78f7、tar SHA256 e530bdc7f880b12b8be312bc7134e1ead1a4f6baa6d81d6e2389aaf2580ac552。readiness/health/供给/Admin/挂载通过，RestartCount0；完整镜像120通过/1既有skip。发布前备份本地integrity ok/FK0及NAS SHA一致，509 Entry/509 Commit。生产UI已独立接受UAT-315计数，三query一致；六项原失败/放弃Run无Token，无人工重处理。用户新反馈Tab慢登记UAT-318：局部候选有界Result/评分读取，Linux79通过、同备份12次JSON等价、读取量下降86–87%，尚未发布或整页验收。盘Avail约46GiB。三部剧历史诱因及全面清理保持开放。

2026-10-12修复准备：用户要求先完成修复、暂不重处理五项失败媒体。计数/Reset/查询优化双平台各92通过；追加FFmpeg安全超时诊断双平台各28通过/1既有skip，Linux一次时序断言失败后原样复验通过。兰闺喜事原S01E17只读三点解码均通过，历史超时诱因仍未证实；两电影原Run均已discarded。当前盘约26GiB可用。修复尚未发布，UAT-313/315/316/317不关闭，详情见315–317 Evidence。

2026-10-12 MoviePilot恢复：用户授权启动、未授权暂停下载。追加清理UAT-281三份已被最终备份替代的中间DB后Avail约6.2GiB。精确清理满盘遗留网络endpoint，原MoviePilot容器/配置/数据及172.18.0.2:3000连接恢复；NAS本机和LAN页面HTTP200，启动日志Application startup complete，容器running且不重启；ShelfDeck health200/normalSupplyAllowed=true。未暂停或删除任何下载。剩余下载量未核清，6.2GiB不作为不会再次满盘的保证；UAT-313两片业务结果及新代码发布仍未完成。

2026-10-12最新复验：计数/Formation查询开销/Reset闭包相关Windows及Linux各92项通过；Linux先前失败已确定为测试包漏带前端源码，补齐后通过。未发布新产品代码。UAT-313释放后《绿头苍蝇》实际search发出3次请求，均ECONNREFUSED；MoviePilot容器因ENOSPC退出，恢复该容器待用户授权。继续清理已被05-stopped替代的01/02/03预检DB后Avail约6.1GiB；最终停机与Reset备份保留。两套大下载暂停亦待用户选择。生产问题尚未全部解决，不能结束收尾清理验收。

2026-10-12继续处理：用户授权的UAT-313旧Work恢复reservation已通过Foundation abandonExecution释放，保留31次事故及范围外全部Circuit/Incident；两搜索尚未产生Attempt，验收仍开放。当前卷再次满盘，Against.the.Current两套剧集下载近期写入；七份已完成升级测试的数据库副本也已按清理授权删除，正式05-stopped/Reset备份保留。计数统一及减小Formation查询范围仍为本地修正、未发布；Linux92项91通过/1失败，复验受ENOSPC阻断。临时暂停两套下载等待用户选择，详见UAT-313及UAT-315–317 Evidence。

2026-10-12后续：用户授权的两份旧镜像tar已删除，Avail恢复约3.3GiB；《罪恶之城》原正式放弃命令200/discarded，Run revision3且Token=0。投影恢复ready，但active/completed/ended仍为7/10/10，页面延迟仍在；UAT-315/316/313未关闭。按追加授权删除UAT-281四份已结束测试数据库副本，保留日志、正式备份、媒体及当前回退材料；四份逻辑8GiB不等于实际释放空间。容器未重启，cab3e2d77与health正常。用户要求问题解决后再统一清理生产；详见[清理与复验](implementation/evidence/UAT-315_317_PRODUCTION_DIAGNOSIS_20261012.md)。

2026-10-12升级后排查：生产仍cab3e2d77，发现/app/data所在卷Avail=0（100%）；备份约52G、test-runs约23G。三体/繁花/兰闺喜事已自动discarded且无Token，失败分别为资料网络错误、身份查询超时、FFmpeg验证超时；不是三项真实席位残留。Formation跨section summary为6/9，旧投影stale；查询一致性与Reset恢复探针闭包本地修正共65项Windows测试通过，未部署。用户已授权正式放弃罪恶之城，但入口500且Run/Token未改变；两个旧镜像tar限定清理等待明确授权。详见[UAT-315–317排查](implementation/evidence/UAT-315_317_PRODUCTION_DIAGNOSIS_20261012.md)与[UAT-313](implementation/evidence/UAT-313_RESET_ORPHAN_RECOVERY_CIRCUIT_20261012.md)。安全停机/用户Reset尚未设计实施，狂暴女神与sample仍待优化。

2026-10-12 17:34：Series生产升级完成，标准镜像markmahoro/shelfdeck:cab3e2d77，运行时git cab3e2d77ac0b6506a268c97ac07af82f4442e49，tar SHA256 bfe6769dedae1699d24c5349d6b9077cb364091e1ac8c6f55f9ea98aff4e9aa0。获批四项限定Reset完成并幂等，504 Entry/36111 Inventory/504 Commit及保留执行历史迁移后逐行一致，integrity=ok/FK=0；4原视频大小及指纹保留。NAS/LAN health=ok、normalSupplyAllowed=true、Admin HTTP200、挂载/QSV/fnOS及其他容器正常，RestartCount=0。用户可自行配置Series Shelf/来源。最终Windows/Linux两集NFO→Commit→迁移链路与Service602通过/0失败/29skip；未执行生产Series整季E2E或桌面全量。备份、精确身份、首次Reset回滚及最终部署证据见[生产升级记录](implementation/evidence/SERIES_PRODUCTION_UPGRADE_20261012.md)。下文为历史时点，不覆盖本次最终状态。

2026-10-12 17:21：四项获批生产Reset完成，4 Subject/4 Run/1 Package/59 Work清零，重复plan幂等，integrity=ok/FK=0，504收藏保护审计进行中。旧镜像Reset遗漏outcomes导致首次拒绝，DB/Workspace已完整回滚核验后，标准包装显式使用最终候选不可变镜像完成清理；包装专项10+闭包回归1通过。完整停机备份05及精确Workspace备份已核验，追加Reset备份formation-reset-20261012T091753Z保留。最终cab3e2d77标准deploy apply进入readiness，尚未确认服务恢复；不宣称已部署成功。

2026-10-12 17:08升级执行中：用户明确批准限定《万里归途》《周处除三害》《宇宙探索编辑部》《荒野猎人》四项旧未入藏进度Reset。17:00只停止生产ShelfDeck，停机标准plan ready=true且四Subject与授权完全一致，当前504 Entry/504 Commit保护；未Reset或加载新版。精确Workspace备份series-cab3e2d77-stopped完成7文件/7104409698字节逐文件SHA校验（另一Workspace不存在）；data/compose/secret停机备份05完整性及摘要校验运行中。在线只读备份方法在关闭WAL后报CANTOPEN，失败04副本保留，改为停机文件复制；未修补原库或绕过校验。

2026-10-12 16:50：最后的Series UAT-307/310已由原大江大河33集新Run c884204c…正式Media Cast Fact验收关闭：67 Observation保留、63唯一relation、单份S3E001 NFO来源、Fact31550字节，34 NFO/海报及35 Artifact验证成功，失败0；原Run完整上架仍独立进行。UAT-311已按最终输入等价提速、双平台与原Artifact链路关闭，282–311本批Series问题各按自身Evidence收口。cab3e2d77最终镜像完整生产副本启动/退出正常；501 Entry、35946库存及501 Commit全量摘要一致，保留执行历史逐行一致，integrity=ok/FK=0。镜像构建、上传SHA256及dry run通过。生产仍旧镜像，未停服、Reset或升级；下一步仅待当前精确未完成Formation生产Reset授权及停机备份/标准升级。并行新增Movie外部BDMV问题不由此批Series关单代替。

2026-10-12 16:22：UAT-311最终修正cab3e2d77已加载本地18081/PID28364，停机备份integrity=ok/FK=0。相同武林外传冻结NFO事件输入摘要保持，准备耗时1082–1277毫秒降至135–145毫秒；仅是局部测量。Windows34专项、双平台重复NFO/Commit/迁移及Service602通过/0失败/29skip通过。精确镜像已标准构建/上传checksum及dry run通过（SHA256 bfe6769dedae1699d24c5349d6b9077cb364091e1ac8c6f55f9ea98aff4e9aa0），生产副本完整Host验证进行中。原大江大河重试已完成来源观察、进入273成员/6范围封包Run，媒体probe 59成功/214等待资源，尚无原33集新Fact。情满四合院Libra完成但Arca仍在来源结算，不能称入藏完成。307/310/311开放；NAS未停服、Reset或升级。

2026-10-12 15:52：现场CPU剖析定位新UAT-311，Artifact投影反复构建整季所有Episode草稿，15.25秒采样约9.56秒在productMetadataContext；此前不能将全部等待归因于142 GB复制。Libra内部按单次输入准备复用、仅构建所需Episode，34项专项、Windows完整NFO/Commit/迁移91.34秒、Linux同链路及相关专项7通过/0失败/43skip、四项静态门禁通过。已停止本地旧PID28208，停机DB备份375545856字节、integrity=ok/FK=0，准备加载验证。生产未动；d6097265e镜像已被本次运行时修复取代，须重建候选。

2026-10-12 15:39：两项获批本地放弃已完成，服务未重启。情满四合院46集mandatory media验收约623秒成功，已进入Arca stage；该步骤仍占共享写资源。大江大河正式重试的来源观察第一页成功，后续页等待资源，尚无新候选/演员Fact，307/310仍开放。生产只读范围已随正常运行变化，不能复用先前4 Subject清理计划；正式停服/Reset前须刷新并单独确认范围。NAS未停服、Reset或升级。

2026-10-12 15:25：用户批准的本地《大宅门2》《乔家大院》均已通过正式放弃入口进入discarded，77个原视频存在且大小一致。原大江大河33集新Run e26c2ffa…完成67份资料获取及34份NFO生成/验证，但海报失败，未生成最终人物Fact；相同配置的独立只读海报调用随后成功867619字节，尚不能确定原失败原因。已正式reprocess（intent 227638f0…）继续验收，307/310保持开放。凡人歌37集已completed，单Episode演员事实是额外现场旁证。生产未停服、Reset或升级。

2026-10-12 15:07：三国95个原文件在独立临时实例重新封包并正式Libra接纳，Claim16562字节、Handoff A Receipt1、失败0，未配置Shelf/未创建Run；实例已停，UAT-309关闭。用户明确批准放弃本地大宅门2及乔家大院以优先验收：前者已discarded，后者closure_pending；大江大河新33集Run e26c2ffa…经正式入口加急，继续UAT-307/310原场景验收。生产未改变。

2026-10-12 14:52：backup03原镜像完整Host冷启动health=ok/normalSupplyAllowed=true并正常退出，约23分钟；只读挂载的EROFS不代表旧任务恢复通过。UAT-293冻结历史兼容按自身证据关闭，生产仍旧版本。当前剩余307/309/310现场验收。本地来源通过正式API临时3→8席位以推进原问题候选，已接纳大江大河33集Intake进程并恢复策略为3；已占用Token自然完成释放，不改转码资源配置或生产配置。

2026-10-12 14:40：最终运行时候选d6097265e已标准构建/上传，生产副本candidate310完整Host健康启动，SQLite integrity=ok/FK=0。501份On-deck Commit及保留的Plan/Node/Edge/Result/Marker逐行摘要一致；一条Entry由Inventory Revision 2→3经正式人物引用刷新凭据解释，未改写旧执行历史。原镜像对backup03完整恢复启动仍运行。全架构2493通过/1旧摘要断言失败/12skip，更新该测试固定值后相关3项通过；Service602通过/0失败/29skip。当前开放293/307/309/310，其他前述已验条目以UAT总表为准。生产仍旧版本，未停服、Reset或升级。

2026-10-12 UAT-310用户最终选用首个非空Episode的单来源演员名单，取消拟议8 MiB扩容。原大江大河33集证据只读重放4166→63条，完整Draft31300字节；Windows32项合同及双平台NFO/入藏/整季迁移Host通过，静态门禁通过。原现场加载及重处理继续，生产未升级。详见UAT-310 Evidence。

2026-10-12 13:24后：用户选择的《大宅门》2001第1季40集已有正式On-deck Commit（Entry `1c1241dc1356fa408b65a89598b45ca1e39f955694358b3d581554c47da4d2ea`）；潜伏、Netflix三体此前外部调用失败，不计通过。三国95成员经正式failed-preparation retry建立新采购Run，大江大河33集复用原幂等键重放202，等待原问题链路验收。UAT-292当前源码原竞态完整Host92.42秒通过并独立关闭；291/284/293/307/308仍开放。

生产继续原版本正常处理，收藏已增至501。新完整备份`/vol1/1000/docker/shelfdeck/backups/series-preflight-20261012-03`：SQLite 2,545,827,840字节、SHA256 `f41a544d2e7e1e004c724f77b5f99094e73c9b93cb0481f88d68277d59fc0f4b`，39伴随文件一致、integrity=ok/FK=0；501收藏/35946 Material/501 Commit/615 Run。旧4 Subject范围因正常生产推进发生变化，不能复用旧授权范围。仅新增备份，未停服或Reset。5996cef8f8中间镜像已标准构建，tar SHA256 `e446d9acd5fd2e2bf6ee169e5fd03572d66c895289c5aec858db05bdf3bdf61d`；未包含后续308及UI修复，不是最终部署镜像。新快照隔离演练与原镜像冷启动回退验证仍运行。

2026-10-12继续升级：UAT-293冻结历史只读验证的完整生产副本Host已健康启动；499收藏/35915 Inventory Material/499 Commit及保留历史逐行摘要一致，integrity=ok/FK=0。Linux专项105通过、最终Service601通过/0失败/28skip，全量架构重跑中；精确候选镜像及回退仍待验，生产保持原版本。UAT-289已由指定UI负责人接受b87a61bc8；294/295/297/298/300/301/302按各自证据补齐关闭，不能外推其他未验UAT。用户已选定大宅门2001、潜伏2009、Netflix三体2024，三份身份命令已202接受；三体后续因网络失败退出，经正式入口重试一次，其他任务继续。

2026-10-12后续用户确认：同意已完成历史的只读兼容并继续执行升级，取代此前暂停决定。范围为冻结旧合同、逐条验证历史及跨Plan证据，不恢复旧未完成Formation、不改写历史、不绕过校验。生产仍须完整副本验证和全部Series UAT各自验收；生产Reset另行按当前精确范围授权。

2026-10-12最新用户决定：“暂不扩展历史兼容，保留生产现状”。不实施所提冻结旧合同兼容方案，不执行NAS升级或生产Reset。UAT-293继续阻断发布；既有修复和独立验收保留，不宣称全部Series UAT已清零。

生产副本在最小逻辑Reset及Schema升级后，完整Host仍因27,592项PLAN_CATALOG_DRIFT拒绝启动；生产未改变。最新全量架构运行：依赖/语义/manifest/合同扫描通过，2485通过、2失败、12skip；两项失败均为P7测试Governor缺少abandonWaiters，补齐夹具后该文件14项全部通过，未再次执行整个全量suite。Service601通过、0失败、28skip。UAT-307重复NFO完整Host Windows与Linux均通过，原现场新Run仍待验；UAT-289具体版本UI验收由指定负责人继续完成。

2026-10-12后续：按用户要求先逐项处理Series UAT再升级。UI负责人`01a0912a-0086-74e2-88ab-536c59d3862a`负责UAT-289具体版本验收。UAT-304停机/Effect恢复修复已通过Windows与Linux实际FFmpeg中断、重启唯一Commit及再次重启幂等；Service601通过/0失败/28skip。UAT-305实际依赖及manifest扫描已通过，原全量fixture8失败对应179项修复回归通过，全量重跑中。新增UAT-307精确重复人物hint修复，1022条本地Observation只读重放无重复relation，Windows两集NFO完整Commit通过；本地18081/PID33100加载后health正常。未将尚待现场或UI验收的条目批量关闭。

生产仍为`helix-beta-20260930-8e197b3c36`，未停服、升级或Reset。完整data/compose/secret备份在`/vol1/1000/docker/shelfdeck/backups/series-preflight-20261012-02`，receipt校验39伴随文件、2,545,827,840字节SQLite，SHA256 `9366b15b9d48812961b27ec52f7e70e9ad9a9fd67aa2b08e4f6604721c32c638`，integrity=ok/FK=0、499条收藏与499份Commit。副本升级命中`SERIES_OFFLOAD_FORMATION_RESET_REQUIRED`：3 active Run及1未入藏Package；默认全局Reset被保留Subject锚点保护拒绝，限定4 Subject的60 Work逻辑Reset在隔离副本通过，Schema升级至200表通过。未接入实际Workspace写权限；这不是完整发布演练或生产Reset授权，完整Host及最终镜像升级/回退仍须通过。

2026-10-12：用户授权NAS生产升级，剧集Shelf及来源由用户上线后配置。HEAD `eb56ef6f1`发布前实际package/manifest扫描仍失败（8项依赖违规、1项表清单envelope），UAT-305阻断发布，未构建/上传/apply或Reset。NAS只读preflight及health正常，仍运行`helix-beta-20260930-8e197b3c36`、RestartCount0、normalSupplyAllowed=true；备份与完整生产副本升级/回退演练尚未执行。详见[UAT-305复验证据](implementation/evidence/UAT-305_EXISTING_ARCHITECTURE_GATES_20261011.md)。

2026-10-11 19:31：UAT-306 Series自动观察修复`525469601`已部署本地18081/PID8704，health正常。Windows相关15项、双平台95集无手动扫描Host通过；国产剧总目录自动扫描成功，发现4955文件，自动建立2个Procurement Run，共1642 Material/40 Scope。后续封包与整理仍运行中，不声明全部上架完成。用户明确无需历史条目兼容或防重复处理；本次无兼容代码、无Reset、无NAS部署。UAT-306按自身条件关闭，UAT-304/305仍开放。详见[Evidence](implementation/evidence/UAT-306_SERIES_AUTO_OBSERVATION_20261011.md)。

2026-10-11 13:44：用户明确Series本地开发快速迭代，无需等待安全退出窗口，已记录CURRENT_PLAN持续授权。核对PID及18081监听后直接终止旧18116及FFmpeg子进程，停机SQLite backup SHA256为35ce7bd9760b70a79c186a4fb88388bf15bdbcdc8c7c497f580e518965bd8483。以5c3effc200b194d5b4a41d67a6dbef01dd612fb8启动PID41120，已加载UAT-284及301/302；health ok/normalSupplyAllowed=true，人世间恢复transcode且新FFmpeg进程34616已启动。失败计数保持FFmpeg3/Provider Transport3/Network1/Timeout15，Run6、Commit0，未Reset/重扫/NAS部署。UAT-304正常停机缺口和UAT-305架构门禁仍开放，强制中断恢复不等于这两项已修复。

2026-10-11 13:24：用户确认UAT-284的Series Unit方案后已提交c60427d93，实现SSOT/typed合同/Owner重建，双平台95文件隔离Host各发布一个Season Candidate，完整Unit67785字节、Foundation Structure2022字节，持久证据重建通过。1024成员及8 MiB边界、缺失/篡改拒绝通过；Windows P7/Schema186项、Service599通过/0失败/27skip，P2合同与语义扫描通过。Linux P7为156通过/1项缺Git的旧Exit审计环境失败，独立95文件Host通过，不计整套PASS。全仓package8项、manifest1项失败与修复前HEAD完全一致，另记UAT-305开放。原三国现场新封包仍待验；18081保持旧81a5a2e41及真实转码，不为加载修复重启，UAT-304仍开放。详见UAT-284 Evidence。

2026-10-11：用户要求拉起本地继续修复。18081以81a5a2e41及原preview-uat294/data启动，health正常；12:49人世间仍转码，历史失败计数未增加，白鹿原上次已discarded，尚无新Commit。UAT-301/302读取优化已提交761c5e98a，最终77集混合NFO/Provider完整Host Windows984.83秒、Linux1302.94秒通过，231项来源结算及On-deck Commit完成，UAT-300完整Host阻塞解除；受控Provider/mediaProbe不代替真实影片验收。Service626项中599通过、0失败、27既有skip；Movie native4k完整Host及相关边界回归通过。UAT-303历史回退工具固定旧Schema，双平台各5项通过并按限定范围关闭，不关闭UAT-293。新增UAT-304：停机终止FFmpeg可能写成加工失败，尚未修复；现场未为加载优化重启，301/302现场加载仍待验。UAT-284的95集Unit合同方案待用户确认。停机数据库备份已核对，不Reset、不操作NAS；不完整Workspace副本清理被自动审批策略拒绝，副本保留。

2026-10-09 22:41后：77集混合来源诊断最终231项结算和Fulfillment均成功，On-deck Commit准备查询超过500项，登记UAT-300。Arca有界分批只读装配已修复，双平台各21项通过，完整77集容器重跑中；未将UAT-298或整体E2E计PASS，本地新Run未中断。

2026-10-09 UAT-299现场通过：e6a6a201d已加载18081 PID52284，健康正常。人世间/白鹿原旧Run均自动discarded，69942/91640字节完整Decision归Libra，Foundation引用各383字节；工作区清理推进。两条正式重新处理请求均202，等待新Run完整验收。UAT-299自身关闭，Series整体上架和77集诊断仍开放。用户授权无需安全窗口重启，失败历史保留，NAS未动。

2026-10-09后续：用户要求不等待窗口，18081已正常停机备份并以PID51504重启加载UAT-298，health200/normalSupplyAllowed=true。人世间被中断转码记录失败后frozen，自动discard又遇69942字节Evidence超64 KiB，UAT-299已确认并修复，双平台各43项通过，真实副本69942字节Decision/383字节Record原子回滚及重放通过，待本地加载；白鹿原仍active。未Reset/NAS部署，结算诊断容器继续。

2026-10-09 21:36后：UAT-298 Linux77集已通过发布、Arca验收/落位/最终校验，旧NFO上限消除；但40分钟测试终点来源结算160/231完成、71待处理，零失败Event，尚无Commit。带30秒进度/耗时和保留数据库的诊断复验已启动，不能仅延长预算就计PASS；现场转码仍执行，本次Schema尚未加载。

2026-10-09后续：UAT-298用户确认后，Series NFO来源交付证据1024条已实现，其他Profile16条、完整Provenance1 MiB保持；双平台41项边界/Schema/交付回归通过。Windows17集混合Host完整Commit通过（90.73秒），Linux77集原场景仍在跑。现场两Run均进入媒体处理且transcode执行中，暂未重启加载本次Schema，未关闭UAT。

2026-10-09 19:21后：UAT-297长预算混合来源Host双平台已越过metadata/artifact/fact/media/conformance，随后publish因ProductionProvenance.sourceNfoObservations仍最多16条失败；精确输入失败摘要匹配，登记UAT-298待独立合同确认。未完成Commit，不计完整PASS；现场18081仍在媒体处理，本轮未重启。

2026-10-09 18:42后：UAT-297用户确认后已实现Series资料集合1024项/8 MiB，生成器、Schema/Registry同步，双平台51项专项/领域回归通过。本地原进程退出原因未明；已用原data恢复18081 PID15316，白鹿原artifact Work恢复running、人世间media Work恢复running，未Reset。77集混合来源Windows首轮旧预算耗尽（资料与事实提交已成功，无失败Event），Linux首轮退出诊断未保全，均不计完整PASS；40分钟预算的持久日志重跑及监控继续，未关闭UAT或宣称现场上架。

2026-10-09后续：现场白鹿原新Run资料232项均成功，但汇总超过Series128项合同，artifact Planner反复P9_METADATA_INTENT_ORDER，登记UAT-297待容量确认。人世间59项资料已通过，目前workspace_media_production admitted；两部剧均未上架，先前资料阶段推进不能代表整体正常。

2026-10-09：UAT-295 TMDB按季响应复用已加载本地18081；真实人世间58集/白鹿原77集各仅2次HTTP且标题剧情完整，双平台69项相关测试及Windows77集完整Host通过。UAT-296修复Series重新处理入口遗留Movie-only限制，原两条意图通过公开API重放均202，新来源Observation已建立两条active Run，资料获取成功推进且暂未新增失败。旧失败记录保留，完整新Run上架仍待验，NAS未动。

2026-10-09 12:25：UAT-295两条新Run已自动结束：正式Lifecycle先以integration_exhausted frozen，再由actorId=system的Discard Decision终结，非人工放弃。Formation ended2、无非终态Event、Arca/Commit/收藏0；没有新增错误。原TMDB逐集超时及恢复验收保持开放。

2026-10-09 12:13：UAT-294已获用户确认并修复，Windows/Linux 77集完整Host最终On-deck Commit分别640.05/658.09秒通过，完整Stage/Final/Fulfillment证据及Foundation64 KiB保护均通过；定向Windows25项、Linux22项、表合同/边界40项通过。新18081现场两Run各有一集TMDB三次超时，登记UAT-295；精确端点复测6项均200，但原失败未消除，Run仍在正式失败前置媒体证据流程，未上架。旧数据/4收藏快照保留，NAS未动。

2026-10-09 11:58：用户确认干净测试目录切换及UAT-294 Arca最终决策8 MiB。新18081已健康启动，三集成/收藏架/路由/旧输入自动处理授权迁入；旧完整data与4收藏保留快照，实际文件不手工处置。人世间58集、白鹿原77集通过定向扫描各接纳1包，均为全新active Run。UAT-294定向25项通过，77集越过原决策限制及Stage/Placement/最终校验，完整Commit复验继续；未发布NAS。

2026-10-09 04:31：用户明确以本地测试排查为主、不保留旧Run；Reset仅在副本完成，4收藏保留但391历史Plan仍阻断升级，见[UAT-293](implementation/evidence/UAT-293_LOCAL_UPGRADE_TEST_RESET_20261009.md)。18081旧实例健康，独立18082新实例200表启动正常，TMDB/MoviePilot迁入通过、豆瓣传输失败；主实例是否切换干净数据目录待范围回复。UAT-292修复28+53定向及原时序完整迁移Host通过。新增77集实测发现UAT-294最终落位决策64 KiB限制，尚未通过、扩容待确认。

2026-10-09 04:13：UAT-291 sidecar/逐集NFO映射与命名已提交af5fe3901并推送，双平台入藏/旧空季目录清理、Windows迁移及改名回归通过。用户授权更新本地18081；SIGINT完整排空后新版本被PLAN_CATALOG_DRIFT阻断（UAT-293），已逐字节恢复停机备份并以a45d7b13f冻结源码回退，health正常，未Reset/NAS部署。新代码尚未现场生效；棋士历史遗漏关联文件未处置。存放规则更新与旧健康检查Basis竞争另记UAT-292。见[Evidence](implementation/evidence/UAT-291_SERIES_RELATED_SIDECARS_20261009.md)。

2026-10-09 UAT-290：最终校验/Fulfillment及最终Commit Evidence均已改为Arca完整不可变记录与Foundation有界引用，Windows/Linux 47集完整Host均通过；Movie上架、Series迁移/NFO维护及合同/升级回归通过，见[Evidence](implementation/evidence/UAT-290_SERIES_FINAL_VERIFICATION_20261009.md)。现场18081仍a45d7b13f，保护大宅门2真实转码，未重启/Reset/部署NAS；上海女子图鉴仍等待来源结算授权，未执行删除。各容量UAT仍待现场验收，不因隔离测试通过关单。

2026-10-09后续：UAT-287及生产追溯列表扩容已获确认并实现；Windows核心74/Linux50、升级24、边界60通过，两集完整Host通过。47集已通过成品验收/交付/Arca验收，Stage Manifest94041字节命中Foundation64 KiB，UAT-288已实现，Windows三类Host回归及Linux存储升级通过；47集越过Stage/Placement后最终校验74939字节超限，UAT-290已获确认待实施；尚无47集完整E2E通过。现场副本196表摘要保持，18081仍a45d7b13f，保护真实转码，未Reset。上海女子图鉴进入offloading但缺来源结算授权，20项delete均未执行，提示缺口UAT-289。

2026-10-09 02:02：UAT-285代码a45d7b13f已推送origin/main。后续46/47集93次媒体输入失败Evidence均精确命中完整空间集合32成员上限，登记[UAT-286](implementation/evidence/UAT-286_SERIES_MEDIA_SPACE_CAPACITY_20261009.md)，合同扩容待用户确认；未修改失败Run或Reset。

2026-10-09 01:57本地UAT：用户确认UAT-285有界逐集Owner记录，原3 Run完整32/46/47集资料及NFO正式提交通过，按自身关卡关闭；双平台大剧情Host与Windows追加Host通过。未Reset/重扫/部署NAS。下一关《情满四合院》46 Primary媒体verify输入准备失败，独立排查中；《大宅门2》32项verify/select通过并转码。真实E2E仍开放，见[UAT-285 Evidence](implementation/evidence/UAT-285_SERIES_METADATA_CAPACITY_20261009.md)。

2026-10-09 00:29本地UAT：经用户确认修复UAT-284 Manifest Result，原4个任务恢复封包，总43包；第二采购Run正式completed。Windows44/Linux22及Movie HTTP Host通过。三国95成员Unit限制仍开放；3个整理Run在72项Metadata获取成功后触及整季Draft 64 KiB上限，UAT-285方案待合同确认。未Reset/重扫/部署NAS。

2026-10-09真实Series UAT：UAT-282原1777 Probe全部完成，39包发布/3接受；UAT-283有界Admission/Lifecycle Evidence修复后，原3 Subject建立active Run并通过首次检查，身份已确认、逐集资料获取推进。两项按各自关卡关闭，完整上架未验收；UAT-284另记录4 Manifest Result超限与95成员Unit限制。双平台45相关项通过，P2/Schema13和DDL9项通过，未部署NAS、未Reset。

2026-10-08 本地真实Series UAT：新增[UAT-282](implementation/evidence/UAT-282_SERIES_PROCUREMENT_PROGRESS_20261008.md)，大来源Probe队列硬上限导致重复十分钟退避空窗。用户确认容量释放有界唤醒合同，共用Governor修复ff4617995已加载本地Windows18081，双平台相关127项各通过；原两个Run保持，实际封包/E2E验收继续，UAT未关闭。该修复未包含在原可部署镜像84c2cd9268内，未部署NAS。

2026-10-08 最终状态：Series首个可部署候选开发Exit，标准镜像`markmahoro/shelfdeck:84c2cd9268`，产品SHA `84c2cd92687ad55851cd1d0984e94c1d14334031`。负责人已接受最终受影响UI；全架构/服务/Linux/真实媒体及升级回退证据和各自版本边界见[最终Evidence](implementation/evidence/SERIES_FULL_REGRESSION_20261008.md)。tar SHA256 `a5c09f6cd69a9193b89453bc8fda9f75b75ff7dabfe3c8ec3945510b981adfdc`。NAS仍是旧Movie生产版本，未上传、部署或Reset；当前442收藏/3个active Run的现场处置需精确授权。

以下为历史过程记录，保留旧失败和中间状态；最新结论以上述最终Evidence为准。

2026-10-08 当前收尾：0f78f4240修正后Windows 280文件完整架构Gate已通过；真实集成冷配置和本地旧Movie镜像升级/正式恢复演练已通过。33dd11627外部Direct/Remux/Transcode实际浏览器运行至收藏分别通过116.11/141.46/162.71秒；打开的Formation详情刷新已修复。当前追加失败原因文案及放弃源保护验证，待UI负责人接受具体提交和重建最终镜像。以下逐批记录是历史进展，不代表当前仍存在对应旧缺口；尚未部署NAS。

2026-10-08 候选终态：服务592通过/0失败/27skip，实际镜像Linux545通过/0失败/4skip；Windows全架构2410通过/2个过期摘要或生成清单失败/12skip。正式重建P3 manifest并同步P2固定摘要，12项复验通过，DDL不变；最终全量/镜像须重新冻结。本地精确旧Movie镜像→候选→正式备份恢复→旧镜像联合演练通过，1收藏/3文件及历史事实保持；未部署或修改NAS。

2026-10-08 候选验证进行中：36100db30标准构建镜像已导出，2121个运行时输入摘要与镜像一致；Windows架构全量和实际镜像内Linux Series回归仍在执行。服务总测试591通过/1个200ms看门狗测试时序失败/27skip，单独复验通过；仅将测试活动周期放大至跨越两个2秒静默预算，硬截止测试同样留出启动预算，三项专项通过，完整服务复验待完成。无生产代码/UI变更。NAS只读核验仍为原Movie镜像、442个收藏及3个active Run，无修改或部署。

2026-10-08 外部多part与进程恢复：三个真实4K文件经转码后按E01两part/E02一文件逐集验收，Windows124.69秒/Linux147.79秒通过；两个part各自整集超限Evidence保持，最终完整集合通过。加工/结算完成、On-deck Commit前退出进程后，新Host唯一提交及再次重开一致，Windows135.59秒/Linux174.19秒通过；恢复零外部调用，成品/Provider/范围外字节保护保持。21专项/P2/diff通过，仅测试增量，剩余失败矩阵审查与最终发布Gate继续，无NAS动作。

2026-10-08 外部Series转码接续：精确Import成员进入既有设备Assessment/有界策略，沿完整Scope预算生产，全部合格后重建实际成品映射；保留质量下限终结与禁止再次获取。真实H.264→HEVC两集Host Windows119.16秒/Linux130.84秒通过，映射/一次获取/Provider字节保护保持；双平台各147专项、Movie外部4项、外部Remux回归及P2/边界/语义通过。外部多part体积与进程恢复、最终冻结发布Gate仍开放，无UI或NAS动作。

2026-10-08 外部Remux已贯通：精确Import Work/Handle/Probe/Claims绑定加工源，两分集MP4封装MKV后重建全部替换目标，经全Run验收/Arca结算。真实4K HEVC/AAC Host Windows112.66秒/Linux120.66秒通过，逐段核对Remux→Package→Stage→Inventory、一次获取及Provider字节保护；双平台各145专项、Movie外部4项、普通Series混合Host及P2/边界/语义通过。外部Transcode/恢复及最终发布Gate继续，无UI变更或NAS动作。

2026-10-08 真实外部媒体Host：3秒4K HEVC/AAC分集素材经正式Probe/Playback/Import/验收/结算，Windows111.34秒/Linux118.70秒通过；Provider字节保护、两集覆盖及一次请求保持。仅网络仍受控，后加工/恢复及最终发布Gate继续，未改产品代码或操作NAS。见外部Host Evidence。

2026-10-08 服务总回归13项失败已修复：过期UI/Readiness断言、旧列数及缺正式映射/摘要的fixture、事故工具Inventory写入、评分Host授权/等待窗口。Windows619项592通过/0失败/27skip，Linux相关58项通过，P2通过；无产品UI变更或NAS动作。外部后加工/恢复及最终冻结发布Gate继续。见[全量Evidence](implementation/evidence/SERIES_FULL_REGRESSION_20261008.md)。

2026-10-08 已确认的EpisodeDelivery Requirement集合摘要落地，正式Event状态误用修复；共文件→两个分集的完整外部Host Windows97.67秒/Linux116.86秒通过，一次请求、Claims/结算/Provider文件保护保持。合同58/35项、外部失败路由3项、Movie外部4项及P2/架构通过。外部后加工/恢复、服务总回归13项失败及其他发布Gate继续；旧全架构因运行中变更仅作诊断，无NAS动作。

2026-10-08 多季退出：Arca正式身份投影季号，搜索/已选/审阅/记录可区分同名季；实际页面只退出S02四成员，S01六文件/事实/Control保持，Windows98.45秒/Linux103.84秒通过，单季40.74秒回归通过。138前端/构建/查询与架构检查通过；UI负责人已接受bfefd19ae此路径（独立Host99.13秒）。前轮完整路由Host29项通过，仍非最终发布Gate。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 同名双Season：S01两集后S02E01独立上架，首季六文件/历史事实保护通过；Windows94.71秒、Linux103.27秒、实际浏览器键盘/双视口95.11秒通过。修复收藏卡aria-label缺少季号，137前端/构建通过；UI负责人已接受b490aad36已验证收藏路径，多季运营及其他发布Gate继续。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 历史副本升级/恢复：修复迁移误用Custody状态、Reset遗漏Run Outcome；正式定向清理4个未完成Subject后升级成功，61张Arca表的保留记录不变，365个收藏受保护。原备份覆盖恢复后SHA256逐字节一致，双平台54项相关回归及架构检查通过。仅本地历史数据库演练，不代表当前生产/应用联合回退资格，无NAS动作。[Evidence](implementation/evidence/SERIES_HISTORICAL_UPGRADE_PREFLIGHT_20261008.md)。

2026-10-08 首次业务配置：无用户模板/收藏架起步，页面复制系统模板至两集实际上架38.12秒通过，系统revision不变、实际Spec每集0.5GiB；原混合加工37.36秒回归通过。负责人已接受31b1df37b本路径（独立38.40秒），真实集成凭据/完整冷启动及其他发布Gate继续，无NAS动作。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 页面退出：实际Series审阅/关闭/取消/最终授权至6成员删除39.13秒通过，范围外文件及取消字节保护/唯一终结保持。修复退出剧名搜索投影、弹窗焦点和busy保护、历史记录粘连；136前端/Windows及Linux查询/构建/架构检查通过；警示去重后38.36秒复验，负责人已接受51ed1bb6e已验证退出路径。其他发布Gate继续，无NAS动作。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 浏览器维护修复：真实NFO修复/复核91.66秒通过；补齐批量健康评分目标series_title，使列表与详情一致。追加演员按正式ID展示去重，72.26秒追加复验通过；movie_only资格不再误报文件损坏。133前端/8浏览器/Windows及Linux各61专项/构建与架构检查通过。UI负责人已接受a5dc10fac本轮路径（独立追加76.02秒/维护91.80秒）；其他运营/外部/冷配置/升级回退Gate继续，无NAS动作。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 浏览器追加：页面再次扫描/确认E03，唯一Season累计3集，旧文件/历史事实/追加原子性及重放保持，桌面窄屏73.15秒通过。负责人已接受2aaa423ce规则修复，新增追加待复验；运营/外部及升级回退Gate继续，无NAS动作。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 真实规则发布修复：已发布用户模板的旧Draft基线/响应解包错误修复，保留双CAS；冲突固定在弹窗操作区并保留输入。页面0.5GiB/集进入正式Spec且实际上架38.35秒通过，131前端/8浏览器/5正式HTTP及构建/P2通过。c7354defd创建授权段已获接受，新修复待负责人复验；其他发布Gate继续，无NAS动作。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 浏览器收藏架与授权：页面创建收藏架/选择模板/命名预览及自动清理确认接入来源至上架旅程，动态Shelf ID及实际结算断言38.35秒通过。负责人已接受a2910cc08来源段，新增创建/授权待验收；规则模板仍API预置，完整发布Gate继续，未操作NAS。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 浏览器来源到上架：真实页面登记Series来源、发布年份分拣并扫描，接续人工身份/Arca上架/收藏双视口38.41秒通过；仅测试增量。负责人已接受573444125登录至收藏段，新增来源段待复验。收藏架/规则仍由API配置，完整运营/外部及发布Gate继续。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 真实浏览器Host：页面登录→人工Series身份确认→实际两集上架→Collection详情37.26秒通过，无API拦截；修复截图发现的窄屏五列工具栏溢出，128前端/双视口收藏/原Host/构建及P2通过。待UI负责人精确版本复验；预配置仍经API，完整旅程与发布Gate不关闭，未操作NAS。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 历史生产副本预检：只读下载9月30日既有备份并核验SHA256，正式升级因未完成Formation拒绝，拒绝后副本字节不变；Reset预检因14条保留路由锚点和10条非目标控制事实拒绝，未执行清理。仅安全拒绝证据，成功升级/回退仍开放，未修改NAS。[Evidence](implementation/evidence/SERIES_HISTORICAL_UPGRADE_PREFLIGHT_20261008.md)。

2026-10-08 部署准备只读核验：NAS容器shelfdeck仍running，镜像`markmahoro/shelfdeck:helix-beta-20260930-8e197b3c36`/`sha256:168be0bb2101b79424f7f978c32d3724852eb5267b2234a4c981c22fe075ac2b`，原五个数据/媒体挂载保持。只读数据库元数据为2359238656字节、197表；未获取副本、未创建远端文件、未部署/重启/修改生产数据。生产副本升级回退门槛仍开放。

2026-10-08 完整Aftercare重启：真实N:M成品落位后、Inventory Commit前退出进程，新Host完成同Case唯一提交，第三次启动结果不变；Windows108.19秒/Linux100.67秒通过，成品字节/Claims/未改成员与范围外文件保护通过。06a8ce7c0冻结278文件全量2402通过/0失败/10skip；新增重启专项单独通过。尚非完整发布资格。[Evidence](implementation/evidence/SERIES_AFTERCARE_HOST_RECOVERY_20261008.md)。

2026-10-08 Series长时媒体：20分钟带AAC的N:M正式Host在Linux CPU181.85秒、Windows NVENC183.57秒通过，成品时长/音轨/Claims/上架验证完整；素材为循环合成，不外推真实复杂画面质量。278文件冻结全量仍运行，未操作NAS。[Evidence](implementation/evidence/SERIES_LONG_MEDIA_HOST_20261008.md)。

2026-10-08 Series HDR专项：Windows44.08秒/Linux42.23秒真实N:M Host通过，Remux/CPU转码后两成品保留10-bit PQ/BT.2020及完整Episode Claims。仅3秒合成素材，长片/HLG/DV/画质等未覆盖。上一轮全量2396通过/1个已修复Stage误报/10skip，后续冻结全量仍需完成；无NAS操作。[Evidence](implementation/evidence/SERIES_HDR_HOST_20261008.md)。

2026-10-08 Stage并发误报修复：全部祖先保留身份/权限/链接校验，仅精确slot比较内容时间戳，避免兄弟目录活动被当作slot变化。Windows84项、Linux21项、并发10次及P2/边界/语义通过；原全量仍运行，最终冻结全量尚未通过。无UI变更或NAS操作。[Evidence](implementation/evidence/SERIES_STAGE_OBSERVATION_CONCURRENCY_20261008.md)。

2026-10-08 UI负责人接受冻结SHA `d4d86d234`：四项原缺陷及详情空槽修复通过；仅覆盖已复验来源/收藏架/整理详情/收藏详情状态，完整旅程与发布Gate仍开放。全架构仍执行，历史Stage测试的共享祖先目录时间戳并发失败已复现，尚未修复；未操作NAS。[Evidence](implementation/evidence/SERIES_UI_REVIEW_FIXES_20261008.md)。

2026-10-08 UI负责人四项拒绝已修复：Series分拣身份类型/摘要、弹窗键盘与忙碌关闭保护、收藏共文件去重分组、Formation进度去重。128项前端、8项Series双视口及2项Movie浏览器、构建通过；待新提交负责人复验，整体发布门槛不关闭，未部署NAS。[Evidence](implementation/evidence/SERIES_UI_REVIEW_FIXES_20261008.md)。

2026-10-08 完整架构回归结束：277文件2407项，2396通过/1入口健康等待超时/10skip；入口helper改30秒墙钟预算与1秒请求上限，相关83通过/2skip及重型并发3通过。原失败保留，最终全量PASS尚未建立。UI负责人已开始76ed35e32验收并报告分拣类型/弹窗键盘缺口，待正式结论和修复，未部署NAS。[Evidence](implementation/evidence/SERIES_FULL_REGRESSION_20261008.md)。

2026-10-08 跨文件系统恢复：Workspace tmpfs设备106、Inventory设备93，正式Materialize在三个rename边界退出后由新进程恢复/重放一致，外部写入冲突拒绝；Linux专项通过、Windows默认28项通过。完整Host其他崩溃矩阵及发布Gate继续，未操作NAS。[Evidence](implementation/evidence/SERIES_CROSS_DEVICE_RECOVERY_20261008.md)。

2026-10-08 跨文件系统真实Host：Linux来源/Workspace设备93、Shelf tmpfs设备106，96.91秒完成N:M上架及Remux/CPU Aftercare，Claims/原子回滚/结算断言通过；显式测试开关已保存。277文件Windows全量回归仍在执行，已见正式入口1失败但隔离复验通过，未宣称全量PASS。其他发布Gate继续，未操作NAS。[Evidence](implementation/evidence/SERIES_CROSS_DEVICE_HOST_20261008.md)。

2026-10-08 Linux Docker验证：本机Engine恢复，372768b68原Dockerfile构建通过；438项Series专项、E03追加、真实CPU N:M加工、99.70秒跨进程退出恢复及4条Movie外部场景通过。原生/投影专项缺测试挂载已补齐复验，1个live BDMV素材skip保留。其他发布Gate继续，未操作NAS。[Evidence](implementation/evidence/SERIES_LINUX_DOCKER_20261008.md)。

2026-10-08 Series命名示例与空间展示：收藏架按实际Profile提供单集/共文件/part示例，模板变更即时反馈；Formation明确每集空间上限。55项后端、125项前端、双视口/Axe及构建/P2/架构/语义通过。UI接受与其他发布Gate继续，未部署NAS。[Evidence](implementation/evidence/SERIES_NAMING_PREVIEW_20261008.md)。

2026-10-08 Formation本批范围：从当前展示Run的冻结Claims投影Season/实际集号/物理文件数，列表及过程详情保持一致。55项后端、124项前端、双视口及构建通过；94.15秒真实E03追加Host确认Formation仅E03、Collection累计三集。P2/架构/语义通过，负责人验收及其他发布Gate继续，未部署NAS。[Evidence](implementation/evidence/SERIES_FORMATION_SCOPE_20261008.md)。

2026-10-08 Collection Series详情：从当前Inventory及Canonical Season事实输出实际集数/文件关系，支持共文件和多part；不拿首文件规格代表整季。7项查询专项、共文件/part两个Host及E03追加94.2秒通过，124项前端、双视口及构建/P2/架构/语义通过。负责人验收和其他发布Gate仍开放，未部署NAS。[Evidence](implementation/evidence/SERIES_COLLECTION_EPISODES_20261008.md)。

2026-10-08 Series 人工身份UI：Formation区分剧集操作，预览冻结Season且确认不提交季/集；124项前端、Movie/Series双视口4项及构建通过。新增实际Host从无匹配经正式HTTP人工选择到两集Direct/Remux上架36.9秒通过。窄屏弹窗越界修复；Episode范围展示/Collection和负责人验收继续，未部署NAS。[Evidence](implementation/evidence/SERIES_MANUAL_IDENTITY_UI_20261008.md)。

2026-10-08 Series 人工身份命令：经用户确认扩展SSOT，TMDB Series ID绑定Run冻结Season/basis，拒绝改季扩集和跨类型，仍仅记录Intent并由provider_exact复验。49项专项、普通Direct/Remux Host35.9秒及P2/架构/语义通过。前端与人工选择完整Host继续，EpisodeDelivery摘要缺口保留，未部署NAS。[Evidence](implementation/evidence/SERIES_MANUAL_IDENTITY_COMMAND_20261008.md)。

2026-10-08 Series 收藏架规则UI：按Movie/Series展示与编辑，支持每集小数GiB，保留其他Profile和未改媒体要求；窄屏弹窗尺寸修复。121项前端全量、双视口规则/来源4项及构建通过；正式Arca规则校验通过，浏览器API受控。负责人接受、真实发布/重评及其他Series页面继续，未部署NAS。[Evidence](implementation/evidence/SERIES_SHELF_RULES_UI_20261008.md)。

2026-10-08 Series 文件来源 UI：登记可显式选择电影/剧集，卡片显示正式类型；失败重试与重复提交保护、标题层级修复。前端114项、双视口浏览器/Axe及构建通过；5项后端回归通过、1项缺本地素材skip。浏览器使用受控API，UI负责人同版本接受仍待完成；EpisodeDelivery摘要缺口按用户要求保留，未部署NAS。[Evidence](implementation/evidence/SERIES_SOURCE_UI_20261008.md)。

2026-10-08 Series正式观察入口：后台现有Admin API允许movie/series，其他Profile保持拒绝；9项真实SQLite准入/幂等/过期拒绝专项通过。首次上架37.1秒、同Season E03追加94.1秒、两个来源并发93.6秒均从正式HTTP入口通过。基线全架构2384通过/7失败/10skip，7项Offload扩展后的陈旧fixture/断言已修复，相关231项复验通过；Web构建及原生126通过/2skip。页面/浏览器及UI负责人同版本接受未完成；未操作NAS。[Evidence](implementation/evidence/SERIES_PUBLIC_OBSERVATION_20261008.md)。

2026-10-08 Series本地耗尽寻源：真实策略耗尽后进入完整关联Scope，其他技术失败保持终止；首个实测仅体积成品仍走既有质量保护。耗尽→搜索拒绝、技术失败不寻源、普通Direct/Remux Host及46项专项/P2/架构/语义通过。EpisodeDelivery合同缺口及整体发布Gate仍开放，未操作NAS。[Evidence](implementation/evidence/SERIES_LOCAL_EXHAUSTION_ROUTING_20261008.md)。

2026-10-08 外部Host修复：Series源像素缺口不再误走Movie路径，Query读取正式Run basis；搜索拒绝Host3.7秒、普通Host36.7秒、57项专项通过。Movie后加工残留候选次数调用修复，真实Transcode/Remux上架45.1/38.4秒通过。用户暂保留EpisodeDelivery逐集Requirement摘要合同缺口，完整外部替换Host显式skip，尚不可部署；未操作NAS。[Evidence](implementation/evidence/SERIES_EXTERNAL_HOST_GAPS_20261008.md)。

2026-10-08 Series外部调度：spec_external按完整Scope推进Search/Acquire/Import并恢复既有Work，完整consumer通过后按实际文件Claims附着Workspace，再回全Run终检；拒绝前序或失败媒体明确终结。14项专项、35.4秒普通Host及P2/架构/语义通过。内部耗尽/后加工/完整外部Host继续，未操作NAS。[Evidence](implementation/evidence/SERIES_EXTERNAL_COORDINATOR_20261008.md)。

2026-10-08 外部Series验收源：共用Import/成品Handle时也从唯一同Run成功Workspace记录重建endpoint/实际位置/revision，拒绝缺失/重复/跨Run，不伪造Field Binding。10项专项、35.4秒普通Host及P2/架构/语义通过。外部Coordinator与完整端到端继续，未操作NAS。[Evidence](implementation/evidence/SERIES_ACCEPTANCE_WORKSPACE_SOURCE_20261008.md)。

2026-10-08 Series完成绑定：Aftercare识别完整多目标结算回执，严格列表/摘要/时间资格后仅移除已完成旧source监控；16项历史回归通过。原生新Node进程重开保留完整证据，成品变更拒绝；P2/架构/语义通过。旧UAT-261见证不扩展为新Series兼容，完整Host恢复继续，未操作NAS。[Evidence](implementation/evidence/SERIES_COMPLETED_BINDINGS_20261008.md)。

2026-10-08 Series结算完成Evidence：Capability传全部目标及Final Decision，typed final_targets进入回执摘要；Commit逐一匹配当前落位key/位置/观察摘要，拒绝缺失/重复/截断/旧证据。20项专项、35.8秒普通Host及P2/架构/语义通过。历史恢复与完整外部Host继续，未操作NAS。[Evidence](implementation/evidence/SERIES_SETTLEMENT_COMPLETION_20261008.md)。

2026-10-08 Series原生源结算：异步端口逐目标匹配Package/Final Decision并核验真实落位指纹，全部通过后复核审批、仅删除唯一source；完整目标证据与重放核验，junction/缺目标/变更拒绝。81项原生回归及P2/架构/语义通过。Capability完成证据/恢复和端到端继续，未操作NAS。[Evidence](implementation/evidence/SERIES_NATIVE_SETTLEMENT_20261008.md)。

2026-10-08 Series结算Handle：完整有序目标key/位置与Final Verification证据进入一个原source审批摘要，缺目标/重复/乱序拒绝，任一位置变化使旧scope失效。16项回归、36.7秒普通上架Host及P2/架构/语义通过。原生多目标现场复核、结算完成证据与恢复继续，未操作NAS。[Evidence](implementation/evidence/SERIES_SETTLEMENT_HANDLES_20261008.md)。

2026-10-08 Series结算上下文：一个原source携带全部唯一Product/Final Decision目标，全管理路径及摘要保持；任一目标缺失/重复拒绝。14项回归、36.6秒普通混合上架Host及P2/架构/语义通过。多目标Handle/审批/原生结算与恢复仍待接通，未操作NAS。[Evidence](implementation/evidence/SERIES_SETTLEMENT_CONTEXT_20261008.md)。

2026-10-08 Arca多目标处置：ProductDispositionManifest传播完整互斥目标集合，一source一member；投影逐目标核对Package，Final Product Verification对全部落位成员检查缺失/重复。12项专项、35.8秒普通混合上架Host及P2/架构/语义通过。源结算/恢复与完整外部Host继续，未部署NAS。[Evidence](implementation/evidence/SERIES_ARCA_DISPOSITION_20261008.md)。

2026-10-08 Series Offload装配：Promotion重建完整外部候选映射，原文件携带全部成品且仅一row，保留原物理/Control；单目标scalar、缺失/篡改拒绝。30项专项、36.6秒普通混合上架Host及P2/架构/语义通过。外部Read Set、Arca/Coordinator和真实外部Host继续，未部署NAS。[Evidence](implementation/evidence/SERIES_OFFLOAD_ASSEMBLY_20261008.md)。

2026-10-08 Offload旧表升级：精确旧DDL/hash经既有事务扩展多目标列，保持已完成Movie原列、Package摘要及Arca/Custody/Shelf记录；未完成或错关联拒绝，复制后异常完整回滚并可重试。28项回归及P2/架构/语义通过。生产副本升级/回退仍未验收，Assembler/Arca/Coordinator继续，未部署NAS。[Evidence](implementation/evidence/SERIES_OFFLOAD_SCHEMA_UPGRADE_20261008.md)。

2026-10-08 Series进程恢复：N:M媒体物化三个rename边界退出/新进程恢复及冲突保护通过；真实Off-deck Host在删除完成、terminal提交前退出，新Host完成唯一终态，第三次启动Evidence不变。主动注入EPERM仍沿同Case/同Authorization恢复，增强Host 115.1秒通过。修复删除环境错误分类与退出Entry旧Aftercare纯观察恢复；118项专项、全架构2,311通过/10skip/0失败。跨设备/其他中断点/UI/Linux等发布Gate继续，未部署NAS。[Evidence](implementation/evidence/SERIES_PROCESS_RECOVERY_20261008.md)。

2026-10-08 Series Off-deck：真实N:M成品经正式Review/Selection/Authorization完成整季退出，2个Primary/3条Claims未重复删除，6个材料精确结算，范围外文件保留；11表终态事务故障回滚/正常提交通过，Host 45秒。原生SQLite跨Season/Movie共享引用与实际删除保护、18项专项及架构/语义通过。仅测试/证据，跨收藏完整Host和进程恢复等仍待验证，整体发布Gate继续，无NAS部署。[Evidence](implementation/evidence/SERIES_OFFDECK_HOST_20261008.md)。

2026-10-08 Linux环境预检：本机Docker Desktop启动因Inference socket错误失败，Engine未就绪，Linux验证未执行；失败日志已核对并结束本次启动/查询进程，未重置Docker数据。其他Series工作继续，详见媒体Host Evidence。

2026-10-08真实有界媒体维修：20秒1080p SDR/AAC源68,526,141字节，经NVIDIA target_size转码为14,280,933字节，低于每集32 MiB；939个音频包SHA256原样保持。正式Host 102.9秒通过，含Claims、事务故障回滚/提交、Control及Settlement；43项专项与架构/语义通过。仅测试/证据修改，N:M有界/长片/HDR/进程恢复/Linux/UI及整体发布Gate继续，无NAS部署。[Evidence](implementation/evidence/SERIES_MEDIA_AFTERCARE_HOST_20261008.md)。

2026-10-08 N:M真实媒体维修追加：共文件E01–E02与E01独立part经正式Host完成Remux/NVIDIA转码、Claims保持、Inventory-Control故障回滚/提交及Settlement，98.5秒通过；最终逐集实测13,493/5,927字节。该维修无空间上限，1 MiB仅作事后计量比较；真实有界压缩仍待合适尺寸源验证。仅测试/证据修改，30项专项及架构/语义检查通过；进程恢复/UI/Linux与整体发布Gate继续，未部署NAS。[Evidence](implementation/evidence/SERIES_MEDIA_AFTERCARE_HOST_20261008.md)。

2026-10-08真实Series媒体维修：正式隔离Host经规则/Shelf标准API触发一集保持、一集Remux、一集NVIDIA NVENC Transcode，Case健康终结；实际Inventory-Control事务末尾故障注入全回滚后正常提交，Claims保持、旧Control释放及Settlement通过，增强复验约100秒。安全成员策略对应缺陷已开放自动维修，缺策略仍需处理；全架构2,300通过/9既有skip/0失败。N:M/长片/进程恢复/UI/Linux与整体发布Gate继续，无NAS部署。[Evidence](implementation/evidence/SERIES_MEDIA_AFTERCARE_HOST_20261008.md)。

2026-10-08提交前现场复核：Series Inventory入口检查完整维修回执、最终落位文件、暂存原文件及未替换Primary，再按原Claims重建逐集空间；文件漂移在Control查询/事务写入前拒绝。57项专项及全架构2,300通过/9既有skip/0失败。真实原子事务、Claims持久化、Settlement/崩溃恢复及媒体Host继续，自动维修与发布Gate保留。[Evidence](implementation/evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。

2026-10-08完整成品集合门禁：Commit Planner和媒体Projection要求全部冻结目标的唯一同Work/Attempt/Plan成品与验证，维修输出和未替换文件共同按N:M规则逐集计量；集合摘要进入VerifiedCareInventoryChange。45项专项及全架构2,300通过/9既有skip/0失败。正式提交前现场复核、事务/Claims/Settlement/崩溃恢复与真实媒体Host继续，自动维修及发布Gate未开放。[Evidence](implementation/evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。

2026-10-08精确媒体物化：Series成品从源Handle摘要匹配唯一冻结Case目标，校验施工意图、Workspace归属与实际字节，回执明确原成员。三个目标实际文件替换、旧文件保护、forward恢复及精确Control变更计算通过；全架构2,297通过/9既有skip/0失败。完整集合终检、正式事务/Claims持久化/Settlement/崩溃恢复及真实媒体Host继续，未开放自动媒体维修或部署NAS。[Evidence](implementation/evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。

2026-10-08逐目标维修接线：准备Planner逐成员调度Remux/Transcode与验证，Effect按冻结Case选择原文件，Series输出身份/Remux路径按成员区分，部分输出清理读取精确Plan参数。混合Case计划、入口Fence和真实SQLite/文件清理验证通过；分组全架构2,297通过/9既有skip/0失败。完整物化/集合终检/原子Commit/恢复与真实媒体Host仍待完成，自动媒体维修及发布Gate未开放。[Evidence](implementation/evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。

2026-10-08精确媒体成品绑定：[Evidence](implementation/evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。Commit逐项绑定验证Event，经同Work/Attempt/Plan、输入Binding、Handle和Result摘要取唯一生产成品，拒绝错取或歧义。15项专项及分组全架构2,296通过/9既有skip/0失败；逐目标Effect、完整集合终检/原子Commit/恢复仍待完成，自动媒体维修与发布Gate保持开放，未部署NAS。

2026-10-08 Case成员策略消费：[Evidence](implementation/evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。完整成员集合纯校验由Arca观察与规划共用；Case从冻结健康Work及正式Assessment/Finding重建精确目标，Projection按materialKey取对应策略，拒绝错来源、缺成员及改写证据。39项专项、分组全架构2,293通过/9既有skip/0失败。逐目标维修Plan/Effect与完整媒体维修仍待完成，自动维修门禁保留，未部署NAS。

2026-10-08 完整成员调度：[Evidence](implementation/evidence/SERIES_MEMBER_ASSESSMENT_SCHEDULING_20261008.md)。健康Planner调度完整Series Primary集合，整季Conformance消费同Work/Attempt/Plan的精确成员证据并绑定集合摘要；缺失/重复/错scope拒绝，不重复Probe。26项专项及24集Plan通过，正式两集NFO维修Host验证成员结果持久化、摘要重建、专业Commit与最终健康（约92秒）；分组全架构2,292通过/9既有skip/0失败。媒体Case消费/逐目标Effect和完整维修仍待完成，未部署NAS。

2026-10-08 成员Conformance Result：[Evidence](implementation/evidence/SERIES_MEMBER_CONFORMANCE_RESULT_20261008.md)。现有Capability增加显式成员参数和closed memberScope，生成独立有界策略Evidence；专业Assessment投影/Commit排除成员结果，保持三维整季健康事实。37项成员/投影专项、合同生成及分组全架构2,291通过/9既有skip/0失败，Result仍限64 KiB。尚未调度完整成员集合或接通维修闭环，Series可部署Gate继续，未部署NAS。

2026-10-08 逐成员媒体策略：[Evidence](implementation/evidence/SERIES_CARE_MEMBER_STRATEGY_20261008.md)。Series策略引擎显式选择当前Inventory成员并校验对应Probe Evidence，Intent/preflight绑定完整空间Basis和文件预算；质量下限保持原单集档位，零预算不退成无上限模式。26项专项及全架构2,289通过/9既有skip/0失败。多策略正式Assessment、Planner/Effect和完整维修闭环仍待完成，未启用自动媒体维修或部署NAS。

2026-10-08 媒体维修空间基础：[Evidence](implementation/evidence/SERIES_CARE_MEDIA_SPACE_20261008.md)。Arca以自身完整Inventory的Physical Identity/正式Claims/Binding、revision与Care Basis建立逐成员保守预算；Libra仅复用纯字节算术，Owner边界保持。23项专项及共文件两集正式Host通过；最终全架构2,284通过/9既有skip/0失败。逐成员媒体Strategy/Effect/完整成品验收与Commit仍待完成，Series自动媒体维修尚未开放，未部署NAS。

2026-10-08 实际Placement：[Evidence](implementation/evidence/SERIES_PLACEMENT_CASE_20261008.md)。正式Host整季换目录和同目录Primary改名均完成迁移、Inventory/Control事务、旧位置结算及健康终结；修复旧评估Basis失效分类，以及未变化NFO/poster被错误结算的缺陷，并在删除入口保护当前Inventory位置。最终全架构2,281通过/9既有skip/0失败。进程崩溃/跨设备恢复、其余运营/UI/Linux及Series发布资格继续，未部署NAS。

2026-10-08 Placement输入：[Evidence](implementation/evidence/SERIES_AFTERCARE_PLACEMENT_INPUT_20261008.md)。Aftercare已携带完整Series/Season身份、各批Episode资料及当前Inventory NFO scope，真实两批Host可精确复原原位置并规划新目录；评估修正同目录改名漏检。全架构2,279通过/9既有skip/0失败。实际迁移Case/恢复、其余运营/UI/Linux发布条件继续，未部署NAS。

2026-10-08 联合展示维护：[Evidence](implementation/evidence/SERIES_PRESENTATION_CASE_20261008.md)。正式隔离Host同一Case恢复缺失poster和两集NFO，验证精确TMDB Series/Season请求、三份Artifact物化、原子事务、Settlement、正常/历史成员保护及收敛后Host重开，92秒通过。本批仅新增验证；完整运营/恢复/UI/Linux发布门槛仍开放，无NAS部署。

2026-10-08 NFO完整Case：[Evidence](implementation/evidence/SERIES_AFTERCARE_NFO_CASE_20261008.md)。已登记且scope/资料齐全的缺失或空Series NFO启用自动维修；正式隔离Host同时修复两集，Inventory-Control原子回滚/提交、Settlement、正常成员及旧revision保护通过。People关联收敛后Host/SQLite关闭重开保持事实及健康状态；全架构2,271通过/9既有skip/0失败。真正进程崩溃恢复、其余运营/UI/Linux和完整发布资格仍开放，未部署NAS。

2026-10-08 NFO维修副作用：[Evidence](implementation/evidence/SERIES_AFTERCARE_NFO_EFFECTS_20261008.md)。精确Profile到独立Workspace NFO、来源Fence、只替换目标成员的物化及forward恢复已接通；12项真实文件Capability专项及全架构2,269通过/9既有skip/0失败。尚缺正式Host的Case/Inventory-Control事务、结算与重启验证，自动维修仍关闭；UI/Linux与完整发布资格继续，未部署NAS。

2026-10-08 NFO维修目标冻结：[Evidence](implementation/evidence/SERIES_AFTERCARE_NFO_TARGET_FREEZE_20261008.md)。Series逐成员Finding、Case历史证据到精确目标、独立TextRender Planner/Profile已接通，错Binding/Scope/Basis拒绝；299项维护相关回归通过。Series实际维修写入仍关闭，下一段接副作用、物化、原子提交与恢复；UI/Linux及完整发布资格继续，无NAS部署。

2026-10-08 NFO重建增量：[Series NFO Render Evidence](implementation/evidence/SERIES_AFTERCARE_NFO_RENDER_20261008.md)。已按正式Artifact scope及原批次资料重建整季/单集NFO，实际两批Host全部四份目标通过；Commit Planner修正多NFO重复取首个结果。专项39项、全架构2,233通过/9既有skip/0失败。尚未启用Series NFO实际维修，目标冻结/副作用/原子提交及恢复继续；完整UI/Linux/发布Gate保持开放，未部署NAS。

2026-10-08 NFO关联持久化：[Inventory Artifact Scope Evidence](implementation/evidence/SERIES_INVENTORY_ARTIFACT_SCOPE_20261008.md)。Series NFO目标与已接受来源已纳入Inventory/Deck摘要及Commit，追加保留旧关联、历史回执可重建。E01/E02→E03完整隔离Host通过；全架构2,202通过、9既有skip、0失败；最终维护/Scope回归239通过。Movie精确旧schema新增空列并保持事实，旧Series缺关联拒绝升级。逐Artifact维修/UI/Linux及完整发布资格仍待完成，未部署NAS。

2026-10-08 NFO目标映射：[Artifact Targets Evidence](implementation/evidence/SERIES_ARTIFACT_TARGETS_20261008.md)。Arca按完整Metadata scopes及Artifact Requirement/材料摘要确定整季与逐集NFO目标，正式落位复用同一映射，拒绝重复/错季/歧义目标。共文件两集隔离Host上架通过；全架构2,190通过、9既有skip、0失败。Inventory关系持久化和逐集维修尚未接通，UI/Linux及发布资格仍开放，未部署NAS。

2026-10-08 NFO完整性：[NFO评估Evidence](implementation/evidence/SERIES_AFTERCARE_NFO_ASSESSMENT_20261008.md)。Series现检查全部已登记NFO，后集缺失/空文件不再被Season NFO掩盖；现有单NFO写入路径在Series上明确拒绝，防止误修其他集。Aftercare回归225项通过。精确Artifact目标到逐集维修提交尚未接通，不能视为完整维护交付；UI/Linux与发布门槛仍开放，未部署NAS。

2026-10-08海报维护身份：[Provider Identity Evidence](implementation/evidence/SERIES_AFTERCARE_PROVIDER_IDENTITY_20261008.md)。修正Series Aftercare请求被固定成TMDB Movie的问题，以全部已接受批次验证Series/Season后调用原Artifact Adapter；错季/身份不一致拒绝。95项相关测试及边界/语义检查通过。完整展示维护、逐集NFO、逐成员维修、UI/Linux及发布资格仍待完成；无NAS部署。

2026-10-08全成员健康评估：[Aftercare媒体Evidence](implementation/evidence/SERIES_AFTERCARE_MEDIA_ASSESSMENT_20261008.md)。Series当前Inventory全部Primary现执行Probe/播放抽样，空间按完整N:M集合精确逐集计算；15项专项通过，正式Capability/schema验证通过。全架构复验2,150通过、9既有skip、0失败；首次曾有1项目录变化Fence失败，独立复验通过，原始记录保留。Series媒体维修策略仍未接通，缺陷明确保留attention_required；UI/Linux、完整运营与发布资格继续，未部署NAS。

2026-10-08补集资料检查：[Inventory Metadata Evidence](implementation/evidence/SERIES_INVENTORY_METADATA_20261008.md)。Aftercare修正逐集标题/剧情误查第一份Metadata顶层字段的问题，改为当前Inventory范围内全部批次的精确Episode资料；两批正式Host Owner context验证通过。全架构2,135通过、9既有skip、0失败。完整Aftercare、Series UI/浏览器/Linux和发布资格继续；外部N:M替换合同仍待此前用户确认。未部署NAS。

2026-10-08升级测试债修复：[历史schema Evidence](implementation/evidence/SERIES_HISTORICAL_UPGRADE_FIXTURES_20261008.md)。原9项失败来自伪旧DDL和过时自动retire预期，现改为8份可校验Git来源的真实历史DDL及current schema不改写运行记录的断言；联合升级门禁20项通过。本轮不改生产迁移，不构成同库发布/回退验收。外部Series N:M替换的多值源→成品映射方案已写入Phase并等待用户确认，其余独立工作继续。

2026-10-08真实Series加工：[真实媒体Evidence](implementation/evidence/SERIES_REAL_MIXED_MEDIA_20261008.md)。Windows正式Host的三集Direct/Remux/NVENC Transcode和共享文件＋同集part的N:M完整上架通过；最终实际字节数在Libra/Arca两端逐集复核通过。105项成员/预算回归通过。本批为短SDR无音轨/无上限样本；有界加工重试、逐成员外部寻源/恢复、运营、UI/Linux及发布资格继续，未部署NAS。

2026-10-08混合成品接线：[终检与交付Evidence](implementation/evidence/SERIES_MIXED_FINAL_SELECTION_20261008.md)。完整实际候选集合终检及逐成员Staging/交付/源结算已接通，受控Direct+Remux两集隔离Host完整上架通过；100项专项通过。全架构复验2,121通过、9既有skip、0失败。真实Series转码Host、逐成员外部寻源/运营、UI/Linux及发布资格仍未完成，未部署NAS。

2026-10-08逐成员Transcode Planner：[规划Evidence](implementation/evidence/SERIES_MEMBER_TRANSCODE_PLANNING_20261008.md)。源/策略历史/输出按成员隔离，完整Assessment连续性和N:M物理预算接通，质量下限保持原单集Policy；全架构2,106通过、9既有skip、0失败。Coordinator、混合成品Staging/终检/交付仍需接线，真实Series转码、UI/Linux及发布资格未完成。

2026-10-08逐成员加工增量：[成员范围与Remux Planner](implementation/evidence/SERIES_MEMBER_MEDIA_SCOPE_20261008.md)。成员Work身份/策略依赖、单文件读取Fence、Remux四节点及输出完整空间Basis已实现；全架构2,091通过、9既有skip、0失败，Direct共享文件完整Host保持通过。Coordinator混合成品调度及逐成员Transcode仍未接通，不构成完整加工交付或可部署版本。

2026-10-08 Direct N:M接通：[空间Basis Evidence](implementation/evidence/SERIES_DIRECT_SPACE_BASIS_20261008.md)。完整冻结成员集合进入Direct验证，支持共文件均分与多part累加；共享文件12字节/集、两part合计48字节/集的正式隔离Host上架通过。修正Procurement错误拒绝同Candidate内部Episode重叠，保留跨批Intake约束；电影真实媒体回归通过。逐成员加工/混合成品、UI及真实Series/Linux和发布资格仍未完成。

2026-10-08逐集空间接纳：[最终空间Evidence](implementation/evidence/SERIES_FINAL_SPACE_ACCEPTANCE_20261008.md)。Arca已修正整季总量误判，保存逐集精确份额；Libra最终Conformance独立重算，支持共文件/多part最终数学验收。两集各24字节、每集上限24字节的正式Host上架及24集回归通过；bounded N:M的Libra入口保护仍在，逐成员加工与完整首版发布资格继续。无UI交付或生产动作。

2026-10-08并发增量：[并发Run与目标预约](implementation/evidence/SERIES_CONCURRENT_TARGET_20261008.md)。两批非重叠Run保持各自范围，Arca以持久化目标预约避免共享文件接管冲突；并发Host已通过。预约/恢复/精确旧schema升级与拒绝未完成责任专项通过；历史迁移测试9项失败已在修改前基线复现，保留为发布资格缺口。尚未完成逐成员加工、N:M完整验收、UI及真实媒体/Linux，不宣称可部署。用户已要求每批验证后提交并推送，保持GitHub与本地一致。

2026-10-08连续性增量：[同Subject分批补集](implementation/evidence/SERIES_SUBJECT_CONTINUITY_20261008.md)。显式Series Claim经过正式Provider查证后，E03沿用原Subject并独立Run扩充同一Season，旧集/Run/历史保持；顺序Host通过。并发Run及完整首版发布资格仍未完成，无新部署。

2026-10-08最新追加：[Season扩充Evidence](implementation/evidence/SERIES_SEASON_EXTENSION_20261008.md)。实际隔离Host E03扩充唯一Season收藏，原文件/历史及两批元数据保留；该无claim样本为两个Subject，同Subject连续性入口仍待接通。254文件回归仅旧固定摘要断言失败，已更新并专项复验通过，9项既有skip。Series发布资格仍未达到，无新部署。

2026-10-08最新增量：[Direct On-deck Evidence](implementation/evidence/SERIES_DIRECT_ONDECK_20261008.md)。2/24集实际隔离Host已完成Arca接纳、Season/逐集落位、正式授权源结算及唯一Season Entry/Deck Fact提交；正式Inventory/Claim/文件/NFO与Provenance核验通过。完整架构251文件及边界/语义/合同通过。仍未满足首版部署门槛：逐成员加工、N:M聚合、追加/运营、真实媒体/Linux和UI验收继续，未发布生产。

更新：2026-10-08。Helix Beta Movie全链路获用户阶段验收，Movie阶段文档收尾及Beta工程清理完成；用户已要求开始Series开发，以Phase工作项管理。UAT只用于上线后的测试、验收问题；原279保留误登记及转移记录，278/280保留历史收尾/清理事实。记录与证据边界见[UAT-278](implementation/evidence/UAT-278_BETA_MOVIE_CLOSEOUT_20260930.md)。Series完整功能尚未交付，未声明新的技术资格总体PASS或正式release tag。

2026-10-08节点1增量：[逐Primary Direct验证](implementation/evidence/SERIES_DIRECT_MEDIA_20261008.md)。2/24成员独立Verification与Selection已接通，小数GiB及用户确认的共文件均分/多part累加计算核心已实现。Run多Selection消费、加工、Package及N:M最终证据接线仍待完成，节点1保持开放；无生产发布。

2026-10-08接续：[多成员Direct交付](implementation/evidence/SERIES_DIRECT_PACKAGE_20261008.md)已完成2/24集Host的完整Conformance及Product Package发布，验证所有Primary、claim、NFO与读取权限。schema容量升级专项通过，完整架构复验250文件通过；Arca正式上架、加工、N:M最终验收、发布资格仍未完成。

## 最近已记录生产身份

2026-10-15已标准发布037592bef4并恢复正常运行，source 037592bef4441ceda87b3270f6e70cb7857da3a7，NAS image config sha256:449e85683e9d9ce10260873baf5bcbf1222f45c234535eb06c9a08bd1b42608c，tar SHA256 9450561ed6b9394e84cdb0baf43f1cda379ed6aebc7d89fd2b4e3121f418543f。556原收藏/Receipt及历史Journal保护，具体资格与备份/回退边界见[JAV发布证据](implementation/evidence/JAV_RELEASE_COPY_20261015.md)。

### 2026-09-30生产版本（历史）

标准apply已切换 `helix-beta-20260930-8e197b3c36`，git `8e197b3c3685d21d87c581bae1016ed70896e2c3`，tar SHA256 `c6b84d0de15b92a38a5ecbe58003f2dc2fdafb2f42c41d66408f3b16e3711d02`，Image ID `sha256:168be0bb2101b79424f7f978c32d3724852eb5267b2234a4c981c22fe075ac2b`。243架构文件及完整检查、Windows相关138项、最终Linux165通过/1canary跳过；最新完整副本候选及同库旧镜像回退均完整启动、正常调度、关闭且保护十一类历史事实。生产health/normalSupplyAllowed、Admin、挂载/QSV/Secret及十一类发布前事实保护通过。16:45:49 CST《网诱惊魂》原Run自动完成封装、输出验证、来源处置及唯一On-deck Commit，页面“已进入收藏架”，Shelf Entry active、Inventory/Deck Fact revision1；UAT-281关闭。见[UAT-281证据](implementation/evidence/UAT-281_REMUX_PROBE_RETRY_CONVERGENCE_20260930.md)。全量Service/Desktop/全库整理E2E未执行，没有UI修改、Reset或直接SQL改写。本次整合仅核对既有证据，未查询生产实时状态。

### 前一生产版本（历史）

| 项目 | 值 |
| --- | --- |
| 镜像 | `markmahoro/shelfdeck:helix-beta-20260928-c147188485` |
| 源码 | `c14718848597063dcd28fed002ae8e5e5897a7e5` |
| tar SHA256 | `df9a74befe6ac9bd5ac3014222598c2ff7bd57f1958079decb6aaa4c14400ffa` |
| NAS Image ID | `sha256:a928dc2cb13a03e6e379f3f88420a104dbf83d06fe658b0192a6d9de6a4e9fb0` |
| StartedAt | `2026-09-28T15:19:12.747534143Z` |
| 发布 Evidence | [UAT-275/276/277](implementation/evidence/UAT-275_276_277_ONDECK_FAILURES_20260928.md) |

该发布 Windows 架构241文件、适用真实媒体与精确 Linux 镜像、完整候选/同库回退 Host、标准发布及8类事实摘要保护通过；全量 Service/Desktop/全库整理 E2E 未运行，历史失败片未重跑。上线前后321 Shelf Entries/24635 Inventory Materials不变，未 Reset 或自动重跑。以上为历史发布证据。2026-09-30清理重新核验生产镜像、StartedAt、挂载和RestartCount0保持原值，health200；未重跑媒体链或重新核验上述业务计数。

## 已接受成果与保留事项

- 2026-09-30 用户确认当前运行比较稳定，接受 Helix Beta Movie 全链路阶段成果。Beta 保持 Movie-only A–I；Series 不追认进原 Beta。
- 现有 UAT 逐项状态见[总表](UAT_ITERATION_REGISTER.md)。已部署、待实际影片或完整业务验收的项继续开放；历史待核实记录不能直接视为当前缺陷。
- 2026-09-29 “检查整体运行状态”聊天只读检查报告：health/Admin 200、无容器重启/OOM，转码仍推进，最近一小时14次成功无新增失败；321上架，保管检查正常。标准符合性63项及呈现5项降级可能重叠，未逐项核验，不据此宣称全部收藏健康。
- 同次检查保留三项风险：《侏罗纪公园2》记录94.4%但输出增长；73次监听器超限警告；系统盘85%/约28GB可用。关联 UAT-127/170/212、125/152、262。2026-09-30工程副本清理后系统盘60%/约70GiB可用，原85%为空间历史快照；进度与监听器风险本轮未修复。
- 已上架瑕疵条目不追溯重加工、不撤销上架、不因新接纳标准触发历史瑕疵修复。未完成 Formation 条目仍按 Playbook 的精确授权及 clean-cut 纪律处理，本轮新增Reset授权及实际范围以顶部2026-10-15记录为准，不扩大为其他条目或后续任意Reset。

## 当前开发与归档

2026-10-08 Git整合：当前开发回到主工作区 main，已合入Series 1d998a43c及维护eb0bd08a3，合并提交2c2998827。24个旧本地分支名已退役，10个附属工作区已移除，现在只保留main。原提交保存在archive refs与恢复包，未提交修改及必要非重建资料保存在preserved目录，重复完整副本已清理。UAT-267工作区经用户确认退役，问题本身仍开放；不表示所有历史独有改动已合入。验证与恢复见[整合Evidence](implementation/evidence/GIT_WORKSPACE_CONSOLIDATION_20261008.md)。以下日期段落为各次实现时点，旧工作区描述不再表示当前归属。

2026-09-30用户确认Series按5节点推进，UI遵循现行规范并由UI负责人验收。Master Plan/Phase及AGENTS已记录逐节点门禁；隔离分支补齐主工作区已确认的Playbook §11.1和Beta baseline §7.1，主工作区既有其他用户修改保持。UI负责人已确认职责并回传[验收范围矩阵](implementation/evidence/SERIES_UI_ACCEPTANCE_SCOPE_20260930.md)；具体页面结论仍需同版本实际走查，当前没有Series页面交付或UI PASS。

Series初审及Windows专项测试见[审查Evidence](implementation/evidence/SERIES_READINESS_AUDIT_20260930.md)：13项中12通过、1跳过；跳过项正是Series Handoff A纵向fixture。已有Episode Claim/Run合同基础；TMDB字段、逐Episode NFO及外部落地快照仍有明确缺口，不能直接启用。未执行真实Series E2E或浏览器验收；范围、开发工作项和准备Exit均在[唯一 Phase](implementation/CURRENT_PHASE.md)。

首批Series元数据基础已交付`ea3d33d16d1bb19949f379e36ea648cfafd003a6`：[实现与验证Evidence](implementation/evidence/SERIES_METADATA_FOUNDATIONS_20260930.md)。TMDB显式验证Series/Season tuple与Season响应，支持series_title/season_number；Renderer新增冻结到Season/Episode的episodedetails NFO并保护Related源。Windows两批共103项通过，无失败/跳过，含Movie相关回归。当时尚未接入逐Episode Observation/Draft、Artifact调度；后续进展见下文。Series入口保持阶段限制，不能把旧初审或叶子验证当完整链路结论。

逐集接线已交付`cca63288607aab127edd8e000221c00b373bca7a`：[接线Evidence](implementation/evidence/SERIES_EPISODE_METADATA_WIRING_20260930.md)。Intent/Observation按冻结集范围取资料；Draft/Fact保留typed逐集资料，Artifact Planner及Owner projection生成Season/各集NFO，Verification核验目标覆盖。172项受影响回归及最终12项重叠专项通过，P2通过；不能将两批计数相加。节点1仍未关闭：真实Foundation/Workspace/原生Fact commit、Artifact正式交付关联及普通长Season容量需继续贯通。没有Series UI交付或新生产部署。

原生验证追加`a36b22dab`：实际Workspace文件/Handle、3条Artifact verification、E01/E02 Product Metadata Fact及来源引用保存与重放，Owner写入失败原子回滚和Source Result改写拒绝均通过；相关48项测试通过，最终16文件受影响回归176项通过、0失败/跳过，P2再次通过。计数有重叠，不相加。上游Series身份和完整调度仍未接通，普通长Season容量待验证；节点2还需补Arca Season/Episode正式命名，当前默认NFO映射会碰撞。上述补充取代前段原生Fact commit未覆盖的状态，证据及未测边界见同一Evidence追加。

2026-10-01节点1增量`215af03f5261029410c2d8e8041778ba1396a8dd`：[Series身份与continuity发布](implementation/evidence/SERIES_PRODUCT_IDENTITY_20261001.md)。Series Product Identity的Plan/Owner projection、TV+Season search/exact、closed Intent/Observation和正式Subject identity/continuity事务已接通；native commit/replay、最后head CAS失败回滚、跨Season拒绝及未来Intake匹配查询通过。15文件302项回归通过，生成manifest后44项重叠复验通过，P2通过；追加`f61beacb1`实际Identity Capability入口的原生发布通过，专项最终31项通过。仍未验证从Field经Routing/Scheduler到完整Series Run、实际E03追加、长Season容量或Arca正式落位；节点1未关闭，无UI PASS和新部署。

实际调度本批交付`4831a923b`：[Routing与调度Evidence](implementation/evidence/SERIES_ROUTING_SCHEDULING_20261001.md)。2/24集从正式Field经Intake、Routing、Spec、身份及逐集生产执行到原生Metadata Fact；24集生成Season加逐集25份NFO、海报及25条资料来源。Series来源上限128，Movie/JAV16，字节界保持。最终181项基础/Series及17项Movie/集成回归通过，无失败/跳过，P2通过。节点1继续逐Primary媒体与交付关联；没有Arca上架、Series UI验收、真实媒体/Linux或生产部署结论。两处测试Temp递归清理被自动审批拒绝，目录暂保留，Host均已关闭。

节点1追加逐Primary源探测`51d8ab8d018321f6c754eb88c4f7313c8e90e6ed`：[Source Media Evidence](implementation/evidence/SERIES_SOURCE_MEDIA_20261001.md)。实际Host的2/24个物理Primary分别产生只读Probe，Plan冻结完整成员digest，Owner projection与Result reconstruction拒绝跨成员/旧Binding、缺失/重复/foreign或payload改写；Movie单源及原盘合同保持。13文件100项通过、0失败/跳过，最终22项重叠专项通过；另3文件25通过、2项因Windows/缺少live BDMV fixture跳过，P2通过。测试停止Source Work边界，完整产品验证、逐Primary加工、Conformance/Package关联仍待实施；节点1未关闭，无UI PASS或生产部署。

原活动文档及残余队列已冻结到[Movie 收尾快照](implementation/archive/20260930_BETA_MOVIE_CLOSEOUT/SNAPSHOT.md)。隔离分支 `codex/beta-closeout-series` 基于 `ecccf7ba9b`继续开发，最新代码见上述实现提交。主工作区、集成区及其他有未提交修改的工作区保留，修改状态未变化。

UAT-280已完成：[清理证据](implementation/evidence/UAT-280_BETA_WORKSPACE_CLEANUP_20260930.md)。NAS删除60项废弃工程资料（20个tar、21个测试目录、19个备份）及142个旧镜像标签；全部29个容器身份/启动状态未变，保留当前/回退及必要验收镜像、含原媒体和事故恢复备份。本地37个Git worktree退役27个，保留10个；34个旧镜像包、40个测试副本、另2份过时测试数据库及5处退役残余全部清除，本地可用空间较原快照增加约99.7GiB。首次审批拦截已通过明确文件及空目录操作安全完成。37个源码snapshot ref/恢复bundle及1670份必要文件复验通过，三处共享依赖和三个有用户修改的工作区状态保持；无剩余选定待删项。

同日追加只读复查发现首轮Git沿junction清理还影响了主Service及主/集成Web依赖，前次仅恢复SSH工具依赖不完整；续作的metadata保护比较基于首轮之后，不能证明首轮依赖未受影响。现已在三处按各自锁文件`npm ci`补齐，SQLite/Sharp及两处esbuild原生绑定smoke通过，用户修改及锁文件无新增变更；修复后本地净可用空间较原快照增加约98.7GiB。未新增文件删除。另有约0.94GB的UAT-125旧诊断库、约32MB测试包及约1.6MB忽略的构建输出；诊断库仍关联开放项，暂保留，不扩大已关闭280的精确清理范围。

清理阶段未构建或部署新版本、未改动生产业务数据/媒体、未重启服务；未新增功能测试或技术资格PASS。后续Series准备专项测试事实见上文，不改写清理阶段结论。部署集中负责人职责已按用户2026-09-28决定取消，UI负责人职责保留。

2026-10-08 N:M有界维修：两个20秒大文件正式Host通过111.4秒，E01/E02按均分加part分别41,778,237.5/15,218,166.5字节，均低于每集64 MiB；独立part 939音频包保持，Claims/事务回滚/Control/Settlement通过。修复MP4→MKV未指定语言und/缺省等价误报，42项专项及架构/语义通过；小共文件比例预算限制仍开放。外部寻源完整范围替换方案已获用户确认，合同传播待实施；UI授权及Linux等发布Gate继续。未部署NAS。[Evidence](implementation/evidence/SERIES_MEDIA_AFTERCARE_HOST_20261008.md)。

2026-10-08外部替换范围模型：用户确认已写入SSOT §3.2.6；Libra完整冻结关联分量与source-to-all-final映射纯校验完成，17项专项及架构/语义通过。尚无生产调用方，外部Work/Provider Evidence、多值schema/持久化/Promotion/Arca结算与完整Host继续，不声明寻源已启用或可部署。[Evidence](implementation/evidence/SERIES_EXTERNAL_REPLACEMENT_SCOPE_20261008.md)。

2026-10-08外部Scope Work接线：Series三个阶段Work及依赖/并发/幂等身份绑定完整Scope，正式Planner按范围构造查询和Package EpisodeDelivery并拒绝跨范围Query，Movie身份保持。34项专项、36秒正式Series上架Host及完整P2基线通过；SSOT源行号/摘要410个生成文件已同步，无字段语义变化。多文件Import、Coordinator/Provider和多值交接/Arca结算仍待闭环，未部署NAS。[Evidence](implementation/evidence/SERIES_EXTERNAL_WORK_SCOPE_20261008.md)。

2026-10-08 Series外部多成员Import：正式Planner逐成员导入/Probe，每个Verify依赖完整范围结果，以实际Handle及冻结Claims进行均分+part验收；不同Scope目标路径隔离，跨范围Package和错Event/Probe拒绝。23项合同/Planner及30项原生端口测试、完整P2/架构/语义通过；原生第二成员ENOSPC重试保留第一成员和全部Landing。Coordinator/Provider/完整候选终检及多值交接/Arca结算继续，未声明端到端可用或部署NAS。[Evidence](implementation/evidence/SERIES_EXTERNAL_MULTI_IMPORT_20261008.md)。

2026-10-08外部Import Result消费：校验成功Scope Work最新Attempt/Plan、全部Import/Probe/Verify/Select及原Acquire Evidence，重算完整范围验收/Selection和source-to-all-final映射；不合格媒体保持ineligible。26项专项和P2/架构/语义通过。consumer待接入Coordinator/全Run候选替换，后续多值交接及Arca结算仍待闭环，未部署NAS。[Evidence](implementation/evidence/SERIES_EXTERNAL_IMPORT_RESULTS_20261008.md)。

2026-10-08外部候选合并：完整Scope Import集合接入正式Series候选Reader，整分量替换、范围外保留；最终空间Basis覆盖全Run并重建映射/Claims/Handle。110项专项、37.2秒普通Direct/Remux混合上架Host及P2/架构/语义通过。Coordinator触发、外部不合格媒体后处理和多值交接/Arca结算仍待闭环，未声明外部端到端可用或部署NAS。[Evidence](implementation/evidence/SERIES_EXTERNAL_CANDIDATE_MERGE_20261008.md)。

2026-10-08 Provider搜索覆盖：MoviePilot季号与Episode集合改为读取实际meta_info明确范围，禁止从Query复制；下载前复验同候选身份/覆盖，缺集/错季/跨季/矛盾字段在POST前拒绝。21项Provider回归及P2/架构/语义通过，使用受控网络响应；Landing逐文件Claims、Coordinator和多值交接/结算继续，未部署NAS。[Evidence](implementation/evidence/SERIES_PROVIDER_SEARCH_COVERAGE_20261008.md)。

2026-10-08 Series Landing：同job逐文件Transfer History绑定真实文件和明确Season/Episode Claims，支持共文件+part；稳定性端口重读记录与SHA256，拒绝目录/重复/错季/越界/junction，不纳入同目录无关文件。45项Provider/协议/外部流水线及P2/架构/语义通过；受控网络与真实临时字节，未验证真实Provider下载。Coordinator、多值交接/结算及发布Gate继续，未部署NAS。[Evidence](implementation/evidence/SERIES_PROVIDER_LANDING_20261008.md)。

2026-10-08 Series获取空间：修复总包误判逐集超限和缺大小被转为0；按本轮用户确认将仅逐集分配unknown、其余合格且总大小已知的多集候选准入写入SSOT，正式Select与P5提交前复验已消费。33项回归及强化Select专项、P2/架构/语义通过。实际逐集终检不变，Coordinator/多值交接与结算继续，未部署NAS。[Evidence](implementation/evidence/SERIES_ACQUISITION_SPACE_20261008.md)。

2026-10-08多成品Offload合同：SSOT/Package/Promotion支持互斥单目标及2..1024多目标，后者仅原Primary替换；Promotion校验所有目标为具备Claims的同Package Workspace Primary。15项专项、生成合同/P2/架构/语义通过。持久化、Reader/Assembler及Arca多目标验证/一次结算待接通，未启用多目标交付或部署NAS。[Evidence](implementation/evidence/SERIES_OFFLOAD_TARGET_CONTRACT_20261008.md)。

2026-10-08多目标Offload存储：互斥单目标与固定schemaRef/128 KiB完整JSON列表、Promotion事务写入和Reader重建已接通。14项专项、35.8秒普通混合上架Host、6项既有回归及P2/架构/语义通过。新库启动摘要已对齐；旧Offload表升级尚未验证并明确拒绝，必须完成历史保护升级后才可发布。Assembler/Arca/Coordinator继续，未部署NAS。[Evidence](implementation/evidence/SERIES_OFFLOAD_TARGET_STORAGE_20261008.md)。


2026-10-19 US Adult本地源准备检查点（未交付）：Arca单片刷新源准备已接正式Supporting Work/Planner/Workspace Effect及Root读取/20点CPU适配器，20帧和Features/manifest逐项注册；真实模型、SQLite重开、源/Work/Control/路径与部分写入反例通过。标题与实际容器文件名预算拆开。合同为122 Capability/105 Result families/224表/56事务/141 Domain Inputs/160路由，P2通过；Package Gate 632/2208/47通过，初次上架CPU Host 1项通过。首次新Planner种类索引遗漏已修复，Service648 pass/29既有skip/0 fail；固定旧检查点`64e2649d4`的独立完整Architecture仍运行，后者尚无完整结果。Arca后续匹配/文件与库存Effect/HTTP、数据副本升级、People及维护剩余项和UI/跨平台资格开放。未部署或触及生产。[Evidence](implementation/evidence/US_ADULT_LOCAL_IMPLEMENTATION_20261018.md)。
