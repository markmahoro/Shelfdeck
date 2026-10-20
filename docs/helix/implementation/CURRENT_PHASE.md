# 当前 Phase：US Adult、演员库与每周维护窗口

2026-10-21 新增用户确认工作项 `JAV-ACTOR-COMPLETENESS`：补JavMenu同站演员提取；JAV演员结果必有，缺失时关联People管理的统一“未知演员”档案，覆盖首次Cast/NFO/入藏及Arca纠正，不伪造来源字段或外部人物ID，不改其他库。按SSOT同日合同实施、隔离验证和精确版本UI验收；未授权部署/生产历史修复。既有UAT-323/324和UAT-322各自保持独立状态。

本项本地代码与受影响Windows/浏览器验证完成；Service648 PASS/29既有skip、核心54、来源/Cast48、真实Host3及宽窄UI2项通过。五项静态检查通过，SSOT摘要已按正式materializer更新；用户授权送UI负责人审核，负责人接受仍待回收，Linux/独立分发及发布资格不继承。UI旅程沿用人物→JAV演员→未知演员→相关作品→收藏详情，首屏真实登记数和姓名即为结果，无人工确认待办或新增说明文案。详见[JAV演员Evidence](evidence/JAV_ACTOR_COMPLETENESS_20261021.md)。

20:14生产发布完成：标准部署精确af2257c423，正式Resume已持久完成，health/Admin/正常供给与正常Owner周期、611原收藏/13组历史保护、15无关容器及fnOS通过。获授权的10项旧整理已清理，新整理按正常调度推进（复验9项进行中）；维护默认周六03:00–09:00上海时区，US辅助只保留ThePornDB，测试Key未进入生产。当前承接使用反馈，不把原固定全量环境失败改成一次全绿，不将未统计身份准确率或完整生产媒体E2E记为PASS，不批量关闭既有UAT或代替正式Phase Exit Audit。精确身份、备份与回退限制见CURRENT_STATUS及本项Evidence。

20:05检查点：生产新224表主库原子发布并验证摘要成功，13组历史事实/611原收藏保护通过。标准af2257部署apply进行中，未记正常供给完成。最终组合资格3145 PASS/26既有或opt-in skip/0剩余失败、四项静态检查PASS；全量首轮唯一Windows打包项因漏Web依赖失败，相同锁文件补齐后定向复验PASS，4190 tracked输入四次摘要完全相同，首轮ok=false记录保持。首个分离bind mount换库EXDEV未替换原库；单一父目录挂载经NAS隔离验证后成功。细节见既有US Adult Evidence。

19:37检查点：获授权的精确10项标准Reset已完成、保持停服；清理后66文件完整备份及权限校验通过。生产新库只在独立release目录准备，未覆盖原210表数据库或切换镜像。af2257正常周期后13组历史事实再次逐项摘要保护通过；最终固定完整Gate继续运行。前段“Reset进入apply”保留为此前检查点。

19:18检查点：af2257候选已在完整隔离生产副本中验证health200、normalSupplyAllowed=true及放行后常规字段协调（4来源、errors0）、安全关闭；原Workspace挂载身份只读保留，生产DB路径遮挡。13组历史事实表不变。生产正式安全停机已完成，精确10项标准Reset已备份并进入apply；未换库或切换镜像。d485完整Gate3158/3132 PASS/26 skip已结束，af2257全量独立Gate仍运行，不能以旧基线代替。最终切换须等候选资格及生产新库准备完成。

日期：2026-10-20。状态：`BASELINE QUALIFIED / QUERY INCREMENT LOCALLY VERIFIED / IDENTITY ACCURACY UNASSESSED`。

最新执行顺序：用户已授权当前10项未上架整理清理（含补入1项），611条收藏保护。正式安全停机09:12:47 UTC成功：四个在途通道/deferred recovery均0、FFmpeg退出、受理后无新增Attempt。随后容器正常停止，新完整冷备64文件/3,842,413,191 bytes逐文件内容/权限一致。正在补齐最新生产终态历史及三类合同完全不变的暂停后台批次证明，拒绝Formation兼容/未决Effect，不扩大清理范围；局部94项及空Host通过，具体副本及新固定Gate仍待验。旧64d1完整Gate3137 total/3111 pass/26 skip不替代新增代码资格。生产未Reset/迁移/升级，准确率统计停止。

发布检查点：精确候选`64d1b06702`的镜像已标准构建/上传并校验，dry run及当前UI负责人审核通过，Service和Linux增量验证通过；固定checkout完整Gate尚在运行。生产副本10个未完成Run阻挡210→224升级；标准显式10 Subject Reset仅完成只读预览。依Playbook §3.4等待新的生产数据处理决定，不擅自Reset或加兼容。生产尚未切换，冷备/完整Host/回退资格未完成；详见既有US Adult Evidence最新补记。

最新授权覆盖下方早期仅本地范围：用户要求改完直接生产升级，并将US Adult搜图收敛为唯一ThePornDB来源、固定地址及API Key设置。沿用同一活动Phase处理候选整合、UI与生产副本升级/回退证明及标准部署；不新增清库、Reset、旧任务终结或一次性测试凭据进入生产的授权。准确率统计按用户决定停止。

海报新排版补记：用户确认暖白底、顶部演员名、四帧2×2裁切铺满及页脚小肖像/原名的中性预览。唯一共享Renderer和冻结合同升级为us-adult-presentation@3；Windows55 PASS/1既有opt-in skip、Linux31 PASS/1同项skip、四项静态Gate通过。局部本地完成，未更新NAS镜像或已有成品，不继承原完整版本资格。用户已停止准确率统计，身份准确性状态继续保持未完成，不再主动收集统计；详见既有US Adult Evidence最新节。

真实辅助建档补记：用户提供仅用于本轮隔离验收的临时TPDB凭据。两处适配缺陷已修复并通过Windows29项、Linux相关6项及四项静态Gate；原验收镜像加两处只读适配修复后，正式连接/保存/搜图API和浏览器图片加载通过。来源候选数量不是身份正确率；旧Wikimedia缺陷随最新唯一来源决定退出当前范围，未追认旧结果。生产未改，无新增完整发布资格；证据见既有US Adult Evidence最新节。

## 1. 基线与授权

- 2026-10-20用户恢复开发，先完成ONNX worker thread改造，再复验实际N95隔离环境性能和整体验证。昨日暂停、未通过的性能预算及已取消Gate均保留为历史，不能计PASS；已确认业务决定沿用，无生产部署授权。

- 分支 `codex/us-adult` 从同步后的 `main@ac278f33e644f0fe52f93043bfa1ac0f2eb40b18` 建立；GitHub 默认分支已改为 main。
- 用户已确认五个议题并要求本地开发；[产品决定与开工取证](evidence/US_ADULT_DECISION_BASELINE_20261018.md)不是第二份架构。
- 沿用 Playbook §3.3：本任务先记录并回写已确认合同，再传播机器门禁、实现与测试；不为已确认决定重复申请授权。
- 本地代码、合同/单元/隔离 fixture 与构建在范围内；NAS 部署、停机、Reset、生产数据或真实媒体改动不在本次授权内。
- 前一开发包保留在 [历史交付快照](archive/JAV_AND_RUNTIME_DELIVERY_AC278F33E_20261018.md)。原未关闭 UAT、精确收藏保护与验收限制不变。
- 本次工作区忽略资料移存只用于保护本地文件，不新增 ShelfDeck 备份产品功能。

## 2. 顺序与当前工作

| 工作项 | 可验收结果 | 当前状态 |
| --- | --- | --- |
| `JAV-ACTOR-COMPLETENESS` | 来源演员保留；缺失时统一真实未知演员；Cast/NFO/收藏/相关作品一致，无伪造来源身份 | 本地实现及适用Windows/浏览器通过；具体版本UI负责人审核待回收，未发布 |
| `US-CONTRACT-BASELINE` | 五个议题映射至 Owner、命令、事实、Effect、恢复和验收；SSOT 与派生合同一致，负例与 Architecture Gate 通过 | PASS：SSOT及派生合同、Owner/Effect/恢复负例及固定0c82ee862原始完整Gate通过 |
| `US-PEOPLE` | 三库独立；普通/JAV 零用户介入；US Adult 有图手动/辅助建档、编辑、每轮最多五位推荐；认领来源影片无二次确认 | 本地实现及适用工程资格PASS；范围限制见下文 |
| `US-FORMATION` | 真实 service-local 抽帧/人脸匹配，唯一最高有效演员；未识别进入既有暂存车间，确认后原位继续，有演员才可上架 | 本地实现及适用工程资格PASS；范围限制见下文 |
| `US-PRESENTATION` | 初次生产和 Arca 刷新共用正式 Renderer；四张 2×2 大截图；演员名加冻结原名；无展示用自建番号 | 本地实现及适用工程资格PASS；范围限制见下文 |
| `US-ARCA-REFRESH` | 仅用户单片手动指定/自动刷新创建本类 Aftercare Case；演员、NFO、海报、相关命名一致更新，收藏身份不变 | PASS：正式链路/真实进程恢复/UI、Windows/Linux及N95单片指定刷新；身份连续 |
| `SYSTEM-MAINTENANCE-WINDOW` | 每周配置、安全进入/退出、游标续跑和任务分类；概览只显示维护状态与当前任务 | 本地实现及适用工程资格PASS；范围限制见下文 |
| `US-QUALIFICATION` | 正式 Host 旅程、恢复反例、适用跨平台验证和具体版本 UI 审核有 Evidence | 工程资格PASS：完整Gate、Windows/Linux/N95通过；真实出演身份准确性未评估，整体业务验收保持开放 |

本 Phase 滚动细化当前工作项；不另建活动计划，不分配开发用 UAT。缺失真实模型/适配器不能由旧 Face HTTP 服务、Mirex Store、mock Result 或空演员关系替代。

## 3. 验收门禁

- People：跨库同人可独立建档、唯一性/查询按库隔离；普通/JAV 无用户写操作/确认待办；不按同名强行归并。
- US Adult：姓名和有效单人参考图必需；无效图不发布可用演员；修改姓名/图片不广播改写已上架影片；无合并/停用/删除。
- 推荐：每轮最多五位且聚合人物；用户认领只作用于明确来源 A，Owner 命令幂等生效；跨域交互不伪装成共享 Store 或跨域原子事务。
- Formation：覆盖最高匹配、无匹配、无脸、空库、人工改选、暂存原位继续、单演员验收、重启和重复命令；沿用席位/公平与责任边界。
- Arca：本类 Case 仅由用户 Intent 创建；无结果保留原演员；命名冲突不覆盖；提交前后崩溃可恢复，Shelf Entry/Deck Fact/Canonical Identity 连续。
- 产物：预览可看清 2×2 截图，姓名/标题不遮图；原名冻结，刷新不重复追加演员前缀；不以文件名替代内部身份。
- 窗口：默认周六 03:00–09:00 Asia/Shanghai；跨重启、配置修订、手动停机、长转码错过进入、到点退出和单任务失败均有反例。
- 调度：周期健康检查只签发 Case，Case 与 Run 在正常模式执行；维护及安全收尾所需的 Foundation/消息能力不被全局 stop 误停。
- 数据：已入藏事实/引用保留；旧普通/JAV 确认项只经 Owner 有界再解析，不盲目接受、同名合并或硬删除。
- 执行适用 Service/Web/Architecture 检查，Windows/Linux 原生依赖按影响验证；未测项明示，fixture 不冒充真实模型或媒体验收。
- 本轮为跨层开发，UI 按 Playbook §12.3 接受具体版本审核，后续 UI diff 重验受影响路径。

## 4. 停线与完成

未确认新业务边界只暂停依赖工作，纯工程选择由实施方处理。不得跨 Owner 写入、引入旧 Runtime、隐藏来源失败或擅自清理生产。
全部工作项具备具体实现与适用验收证据后才能称本版开发完成；本文件当前记录本地开发进度。实际发布、数据升级与真实媒体效果需要相应精确授权。

## 5. 2026-10-19 本地开发检查点（未交付）

- People：三库隔离、普通/JAV零用户确认、US上传/搜图建档、姓名/别名编辑、补图已接正式链路；深度系统维护、参考图释放/图库和关联作品仍待完成。
- Formation：service-local真实CPU固定模型、20点抽帧、最高有效单演员、无脸/空库转二号、原Run人工确认、NFO/共享2×2 Poster、精确Actor加原名与初次On-deck已贯通；Formation现有演员选择无建档快捷入口。
- 推荐：维护内持久化扫描、分组与排名，窗口结束后最多五位可见；用户认领/新建经持久Claim及Owner命令自动确认明确来源A。两片聚合、真实截图建档、ACK丢失跨重启、只确认A而B仍暂存的CPU Host通过。UI已接，尚未做浏览器及具体版本负责人验收。
- 维护：独立准入、安全进入/收尾、配置及概览、既有任务分类/持久cursor已接。手动豆瓣沿原Acquisition/cursor转普通调度已验证；残留清扫及完整截止/重启资格仍开放。
- Arca刷新基础：精确Arca物理作用域、共享匹配器、当前库存Actor/原名与目标规划、单演员NFO替换及独立20帧CPU/海报引擎通过局部验证。用户Intent、完整同版参考分页与Case已接Owner原子准入，数据库重开、迟发回滚、篡改与库存CAS反例通过；Arca源准备已有正式Supporting Work/Planner、workspace_write Capability和Root真实读取/CPU适配器；全部20帧及特征逐项注册，跨数据库重开可读，局部中断/链接/改字节围栏通过。后续匹配/文件Effect/库存提交和HTTP仍未完成。
- 当前合同：122 Capability /105 Result families /224表 /56事务 /141 Domain inputs /160路由，P2通过。一次完整Architecture在后置汇总被开发中SSOT修订打断，未获得可用完整结果，不算PASS；固定提交`64e2649d4`的隔离checkout完整门禁及匹配阶段Service回归已按用户暂停指令取消，均无PASS；恢复后需在新固定提交重跑。
- 最新已完成本地验证：上个提交Service648 pass/29既有skip/0 fail；源准备接线后的全Service648 pass/29既有skip/0 fail，首次启动暴露的Planner种类索引未同步已修复。Arca合同/事务/DDL等82项通过，P2及包边界通过；Web218项及构建为前序UI检查点。真实CPU Host证据单列，不把合成Result fixture当成推理证据。
- 继续实现Arca单片演员刷新Case。离线升级副本、适用跨平台、实际进程中断恢复及具体版本UI资格仍开放。未部署、未操作生产或真实媒体。

具体历史、失败记录与验收限制见[本地实施Evidence](evidence/US_ADULT_LOCAL_IMPLEMENTATION_20261018.md)。全部五议题及适用验收闭合前不称开发完成。

## 2026-10-19 暂停记录及本轮NAS验收授权

- 开发继续暂停；`codex/us-adult@461d8805d`已保存，工作区干净，正在运行的完整Architecture验证进程已按用户要求停止，不记PASS。恢复开发后先核验当前提交及原始完整Gate结果，不能使用已撤销的分组执行资格。
- 用户追加两项发布前验收，纳入现有`US-QUALIFICATION`，不另建活动计划。仅本节记录不会恢复开发或启动NAS进程；下一轮恢复开发时执行。此前“本轮仅本地”限制在以下精确NAS隔离测试范围内被最新授权扩展，不构成生产发布或数据修改授权。
- **N95性能资格**：在实际NAS核验CPU、内存及当前可用资源后建立独立容器、端口、数据目录、Workspace和输出；为测试容器设置CPU/内存及并发边界，监测共机生产服务，不停生产或接入其数据库。先建立空载基线，再运行实际模型冷/热启动、20点抽帧、参考特征缓存、识别与海报、单片刷新及维护批次；从单任务逐步增加有界并发。记录每片/阶段耗时、吞吐、CPU、内存峰值、swap/OOM、磁盘I/O/iowait、测试API响应及共机生产健康/响应变化。若出现持续无响应、资源失控或生产明显退化，立即停止测试供给并安全收尾，记录失败，不为追求压力继续加载。验收须给出实际N95可用并发/资源配置、瓶颈及剩余风险；有卡死、OOM、无界积压或无法安全退出时不得认为性能达标，修正后复验。交互可用性数值预算在执行前结合基线明确记录，不能事后凭主观“不卡”判PASS。
- **真实媒体E2E资格**：从用户指定`/vol02/1000-0-24018892/US/scraped`有界挑选少量具有不同画质、镜头及人脸条件的影片，冻结测试清单、大小/摘要及选择理由；只读挂载原目录，并将选中材料复制到独立测试输入，避免来源结算、重命名或删除作用于原件。记录复制与空间成本，不扫描/复制全库、不提交影片/人脸图像或人物隐私资料到Git。测试数据与产物只保存在隔离目录。
- 以可核实演员身份及用户确认的独立参考图建立真值；不能把算法最高分或文件名当真值，也不能从同一测试片取参考图来证明跨片可靠性。若无法可靠核实某片演员，报告未标注，不虚报准确率；新的确证信息需要用户判断时才讨论。记录逐片真值、帧/人脸检出、最高匹配及次高差距、阈值/模型/参考图版本、耗时、自动命中/误认/暂存，以及人工确认结果。小样本结果明确分母和局限，不外推全库准确率；不为凑通过而对测试集调阈值。
- 实际E2E覆盖隔离Field→Libra识别/未识别暂存→已有演员人工确认→NFO/2×2海报/命名→Arca唯一上架，并覆盖单片指定/自动刷新及身份连续性；无脸/空库等场景可补独立对照，缺少自然样本时明确其fixture性质。验收后复核原件未变、生产数据未接入、测试进程安全退出。NAS环境、精确代码/镜像、资源限制、测试清单及性能/识别结果存入现有Evidence，不能用本机Linux或合成媒体证据替代。
- 以上与尚未通过的最终完整Architecture Gate共同构成本轮剩余资格；Windows/本机Linux及UI既有PASS按精确版本保留，新代码修改按影响补验。生产正式部署、生产数据升级及原媒体改动仍需对应授权。

用户后续已明确恢复开发；以上暂停为历史状态。原始完整Gate正在独立`72388341e`验证checkout重跑，不分组或筛选测试。实际NAS性能及用户指定路径的隔离媒体验收已开始准备，精确环境、预算和范围限制见现有Evidence最新节；真实人物身份准确性不由本轮自动人脸比对判定，保留人工验收，不能用检出率替代身份准确率。

用户随后再次要求暂停：`72388341e`完整Gate已取消，不记PASS；本机所属验证进程已停止，NAS隔离测试容器已正常退出且无运行的本轮测试容器，生产身份/StartedAt/RestartCount保持。实际N95四片20点检出、两片技术标签E2E及单片指定刷新、维护截止/手动停机/下一窗口原Work续跑已取得证据。独立5 Hz探针482次请求零错误，但p95约511 ms、最大2.58秒，未达到预设500 ms预算；profile及本地ONNX backend源码证明推理Promise内仍同步调用native。已开始将模型计算移入service-local worker thread，三个Integration文件的未提交修改保留，尚未运行测试、打包或NAS复验，不视为已修复。恢复时先审查线程生命周期/队列/异常及真实模型一致性，再重建精确镜像和Windows包、复验N95预算及最终完整Gate。真实演员身份准确性仍须人工验收。


## 6. 2026-10-19 恢复开发检查点

用户恢复本地开发，优先Arca单片演员刷新；既有决定沿用。Arca指定/自动Actor的Source→匹配/选择→海报/NFO/Plan→stage/publish/verify→Inventory/Control原子提交→退役→Case结案已接正式Work、调度、HTTP和收藏页。有脸/无脸/同名/跨Host重启及真实UOW迟发失败回滚恢复通过；Shelf Entry/Deck/Canonical与无关健康Finding保持。当前130/108/224/56/144、162路由，P2通过；Web222项和构建通过；Aftercare69项、当前合同22项、文件进程退出等局部证据见现有Evidence最新节。Service648 pass/29既有skip/0fail为本轮检查点，仍须最终固定版本全量资格。先前暂停的Gate/Service不记PASS。

下一步在固定提交checkout跑完整Architecture；继续People深度维护/参考图/关联作品、离线副本升级、维护剩余项和整体验证。Arca正式Host异常进程退出与并发冲突、适用平台和具体版本UI资格仍开放。没有生产操作或发布，本版尚未完成。


### Arca异常退出与当前库存读取增量

真实固定CPU Host在Inventory提交前/后实际进程退出均已恢复原Case，外来目标冲突保持当前收藏和外来字节且精确报告；独立文件恢复8项通过。人物当前作品查询/分页及Collection深链、刷新期间retained旧海报读取已接通。正式HTTP相关作品复验、最终全量Gate/版本UI仍继续。失败Case用户恢复、People系统深度维护/图库生命周期、离线升级和维护剩余资格未关闭；具体日志及未测范围见既有Evidence最新节。


### US参考图片生命周期增量

图库/current Reference图片读取、补图/释放及原子replace_image已接正式Work/Effect/Owner事务；保留US最后有效图片，替换失败回滚和无脸保留旧图、重放跨重启由真实模型Host验证。Web231项及构建、Owner/合同27项通过，P2保持130/108/224/56/144（aggregate见Evidence）。普通/JAV系统维护正式链、Reference审计/无引用GC及具体版本浏览器/UI资格继续；Service补齐本地tools依赖后的全量648 PASS/29既有skip/0 fail。没有生产操作。


### 系统People及Actor失败重新提交增量

普通/JAV已走正式Evidence Supporting Work→Candidate→可靠身份Person Commit，弱线索内部保留、无用户确认；Arca精确来源Projection及可靠JavDB Actor ID接通，维护后当前出演关系由Arca自行更新。真实JAV强/弱线索Host2项、Series维护人物/修复Host3项通过。Actor无写入发布失败可严格证明后原子收口unresolved，用户从原入口显式新Intent完成；实际提交前/后进程退出及冲突后再提交1项通过，未知/部分效果不能采用此收口。新增失败收口Canonical事务，当前130/108/224/57/144、162路由；P2 aggregate与具体资格见既有Evidence最新节。Service648 PASS/29既有skip，Web232 PASS及build通过。

继续失败Actor stage精确清扫、系统People深度维护/Reference审计GC、离线副本升级与维护剩余资格；随后完成新固定版本全量Gate、独立依赖Windows分发、Linux及实际浏览器/具体版本UI审核。前一完整Gate33失败已逐项修复/局部复验但新整合未跑；本checkout Windows打包因共享依赖junction失败，非分发PASS。未操作生产，本版未完成。


### Actor stage精确清扫与Source期限增量

首次发布无写入失败后，原Case先准入独立discard Supporting Work，复用既有retire Capability及material_commit Effect；只清理其冻结stage manifest，全部成员预检后逐项复验，不触碰原片、retained或外来目标。实际Host在删除第一项stage文件后exit 75，重启沿同Case/Effect完成清扫，Owner才原子收口unresolved；再由用户新Intent完成刷新。另两个Inventory提交前/后exit 73/74继续通过，已准备Source在历史租约过期一天后可继续消费冻结结果。当前Basis冲突由只读状态明确投影，不伪造执行或擅自取消Case。

真实CPU Host组合1 PASS/85.0秒；Source租约4项、最新Actor/文件/Owner/P2组合20项通过，Web233 PASS及build通过。当前130/108/224/57/144及162路由，P2 aggregate a26df8c4641a9a08b5bb3dc18daa12009acddd9fff8037af4f9ca907be3e804a。完整Architecture正在独立固定c04641bab运行，不覆盖本增量；Service和剩余人物/维护/升级/平台/UI资格继续，尚未交付。


### 历史人物与离线升级增量

TMDB NFO/credits可靠人物命名空间统一查询及提交复验，跨库/多人物冲突不任取；历史头像与NFO编号保留，69项及人物页9项通过。离线main 210→224版本化结构副本已实现、归档精确DDL并接入分发清单：可靠归属填库类型，全部209个旧事实表原列逐字节保留，新14表为空，未知/冲突归属或未完成责任拒绝；旧确认仅内部保留，历史已接受来源可只读恢复。8项Operator及13项People合批通过。未操作真实生产副本或发布。72963fb39 Service648 PASS/29既有skip；最终全量/平台/UI及Reference GC、正式可靠归并等仍开放。


### 可靠系统归并与完整Gate检查点

维护内普通/JAV可靠归并已接正式Supporting Work、typed Evidence、Candidate/Owner Merge事务及消息ACK；同名不作依据，US不参与，偏好冲突保留内部。正式Host1 PASS/49.9秒、Owner/规则/作品18项、Arca真实CPU指定刷新及HTTP作品1 PASS/63.9秒。People明确历史Merge身份Scope使当前作品在Arca普通关系刷新前连续可读，不跨Owner改关系。

固定c04641bab独立完整Architecture为3076 total/3062 PASS/1 FAIL/13 skip，输入摘要前后一致；唯一生成DDL trace manifest漂移已重新物化，物理DDL不变，相关24项及副本8项通过。该固定版本独立Windows包含原生模型检查通过。最终新版本完整Gate及Linux/浏览器/UI负责人资格、Reference审计GC和维护剩余项继续；不能把本检查点视为五议题交付。


### Reference GC、后期Actor续跑与UI收口

正式双轮Reference审计及维护内精确Artifact回收、claim/Receipt恢复和重新发布验证接通；保持P3单Owner UOW，以Foundation opaque read fence保护跨Owner读间隔。后期人工Actor选择由Libra在唤醒生产前完成原位或合法replacement判定，真实CPU Host1项及提交后续跑重试负例通过。具体d8cff243b UI负责人8/8受影响检查通过、六项发现全部关闭；UI/Renderer后无变化。当前P2 131/110/224/58/145及162路由，物理DDL不变。最终固定提交完整Gate、Service/Windows/Linux资格继续，尚未交付；日志及准确限制见既有Evidence最新节。

### 2026-10-20 固定线程版本与NAS复验

`a4a673c20`完成线程客户端、原生模型/预处理、纯Pack验证及线程入口拆分；`0c82ee862`补齐共享Schema编译复用和精确Integration builtin负例基线。模型/阈值/业务Owner及持久合同不变。第一轮仅线程改造445请求p95 555ms仍FAIL；新固定版本434请求p95 410.05ms、p99 836.48ms、max 2619.84ms、零错误，达到既定p95≤500ms，偶发长尾仍存在。此结论限实际N95的1.5核/1.5GiB、两片技术标签旅程，峰值约887.6MiB、无OOM；不等于大库生产容量或实际身份准确性保证。

四片各20点检出与改造前一致；1核串行总65.096s，双任务37.212s（两片），主事件循环p95约80/82ms。两片暂存→原Run确认→唯一上架→用户单片指定刷新、维护截止/手动停机/跨Host重启及下一窗口原健康Work续跑均通过；原件四份完整hash/大小/时间戳/inode未变，生产镜像/StartedAt/RestartCount保持。独立Linux最终47文件208项全通过；前序环境遗漏测试专用脚本的13失败已保留，修正测试挂载后重跑，不改产品包。新镜像2634文件逐字节与Source/资源相同，UI摘要沿用已接受版本。

当前Service648 PASS/29既有skip、Web242 PASS；最终固定`0c82ee862`原始完整Gate不筛选/不分组，仍在运行。最初`a4a673c20`完整Gate因追加有证据的性能修复而中止，不计PASS。不得提前关闭Phase；具体镜像、原始日志、范围限制及最后结果以现有Evidence为准。

## 最终工程验收与Phase退出检查（2026-10-20）

固定0c82ee862原始完整Gate PASS：387文件、3129 total/3116 PASS/13既有skip/0fail，fixture 3493.8s。74个JAV名称（52 literal+22动态）逐名核验全部PASS；4183 tracked files前后aggregate 73c06dab33d3a59329af8f17519b7579b9c98ef0062c38317d63ae4d5f4e7a80完全相同。包边界、semantic、manifests、P2均PASS；此前取消/分组遗漏/失败轮次不计最终资格。

Service/Web/Windows/Linux/N95及UI的适用工程证据已齐备，跳过和未选中项均单列。主工作区Service原E盘junction已仅移动链接对象至ignored恢复入口，换成独立物理依赖；未改外部target，ORT1.30.0及默认固定模型完整，清空NODE_PATH后22项真实CPU/线程检查通过。代码/持久合同/SSOT在资格后未改，仅更新文档。

从SSOT反向检查：五议题代码、正式Owner/命令/Effect和实际恢复链均有证据；Worker仅持有图片计算/模型、不持有Domain事实，编译优化仍在Foundation Validator内，不引入跨域authority或新业务对象；无旧Runtime/双读/迁移兼容路径，无media-desktop或后续Phase耦合。原件完整hash/stat及生产image/StartedAt/RestartCount保持，测试已退出，无生产发布授权。

**不关闭整体Phase**：真实出演者身份准确性仍未评估。本轮只对真实素材检出/技术标签业务链路、固定模型一致性和性能负责，不能用最高算法分、文件名或未标注样本证明真实身份准确率；500ms预算仅在已记录的小样本/资源配置通过，2.62s长尾及生产容量限制保留。所有实现工作项的工程检查PASS不替代该业务验收，也不等于生产可部署或已发布。


### 2026-10-20 人工验收准备

同一固定镜像的独立manual-uat-v1已准备四份校验副本，空演员库、席位0、无Run，等待用户独立建档和评估身份。初始化夹具排序400经原幂等命令恢复，未重置数据或修改产品。NAS生产health连续三次5秒超时，安全监控已停止测试容器（Exit0、无OOM），本机转发亦关闭。停测后生产三次health 14.369/1.107/0.252秒，image/StartedAt/RestartCount保持；不判断慢响应根因。入口与会话资格未完成，暂不交付用户操作。私有清单/受限登录文件及全部隔离数据保留；待NAS稳定继续入口资格，身份和实际效果验收未开始，Phase保持开放。详情见既有Evidence最新节。


### 2026-10-20 超时关系核验及入口就绪

已完成生产只读profile与测试启停对照：停测后12次health仍出现6.113s及4.358s；测试不整理时8次均200、最大4.528s。证明生产自身存在超过5秒的慢响应，后台同步SQL/Libra reconcile、Perception候选/摘要和概览健康计算占用主线程；不能排除首次测试冷初始化加重同机竞争，也不宣称已修复生产性能。两次Inspector均关闭，生产实例身份保持；详见既有Evidence，不改已合格候选。

同一隔离数据已恢复，入口http://127.0.0.2:18125/people的health、登录session、未认证拒绝、Cookie、空人物库/席位0、页面及JS/CSS全部检查通过；未作浏览器人工身份验收。私有登录文件和清单已准备。1.5CPU/1.5GiB及原安全停测阈值保持；监控退出亦停止唯一测试容器。当前等用户独立建档、开启整理并判断匹配/海报/命名/单片刷新；Phase业务验收开放，无生产发布。


### 2026-10-20 查询优化增量完成（本地）

用户要求实施前述机会后，完成Series Direct Selection同次同步计算内的整季空间分配复用，以及Perception按完整Clause/Evidence和同事务Source cursor heads约束的256项候选ID查询索引。仅深冻结且由本模块构造的Basis可复用；逐文件Probe/Handle仍核验，scope结束/异常即失效。评分仍每次读取当前记录/关系并执行原规则；新资料使索引失效，exact路径不增加head查询。未实现新的Resolution未变快返或概览方案。

最终19文件261 PASS、Linux9文件190 PASS、Service648 PASS/29既有skip、四项静态Gate零finding；运行与测试输入摘要前后保持。此前83文件过宽扩展轮已取消，不计PASS或完整Gate；Linux首次缺测试脚本的1fail保留，补齐验证挂载后通过。原0c82ee862完整Gate只证明固定旧基线，增量没有新完整Gate/分发/N95资格，NAS验收入口仍原固定镜像。

本机组件5轮中位数：96成员纯Series分配58.09→0.77ms；1500记录64个重复候选查询73.45→3.64ms，输出相同，冷查83.38→81.81ms；并行干扰下曾有冷查变慢，已保留。不能当作整机CPU或生产health改善。表/API/UI/摘要规则及Owner不变，当前P2 aggregate不变。整体身份业务验收继续开放，无生产发布；实现、安全负例、原始记录及准确范围见既有US Adult Evidence最新节。
