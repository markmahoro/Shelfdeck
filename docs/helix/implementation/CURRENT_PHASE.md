# 当前 Phase：US Adult、演员库与每周维护窗口

日期：2026-10-18。状态：`LOCAL DEVELOPMENT / CONTRACT ALIGNMENT IN PROGRESS`。

## 1. 基线与授权

- 分支 `codex/us-adult` 从同步后的 `main@ac278f33e644f0fe52f93043bfa1ac0f2eb40b18` 建立；GitHub 默认分支已改为 main。
- 用户已确认五个议题并要求本地开发；[产品决定与开工取证](evidence/US_ADULT_DECISION_BASELINE_20261018.md)不是第二份架构。
- 沿用 Playbook §3.3：本任务先记录并回写已确认合同，再传播机器门禁、实现与测试；不为已确认决定重复申请授权。
- 本地代码、合同/单元/隔离 fixture 与构建在范围内；NAS 部署、停机、Reset、生产数据或真实媒体改动不在本次授权内。
- 前一开发包保留在 [历史交付快照](archive/JAV_AND_RUNTIME_DELIVERY_AC278F33E_20261018.md)。原未关闭 UAT、精确收藏保护与验收限制不变。
- 本次工作区忽略资料移存只用于保护本地文件，不新增 ShelfDeck 备份产品功能。

## 2. 顺序与当前工作

| 工作项 | 可验收结果 | 当前状态 |
| --- | --- | --- |
| `US-CONTRACT-BASELINE` | 五个议题映射至 Owner、命令、事实、Effect、恢复和验收；SSOT 与派生合同一致，负例与 Architecture Gate 通过 | 进行中：产品决定已冻结，已回写主要SSOT及机器合同；全局残余条款对齐及最终门禁待完成 |
| `US-PEOPLE` | 三库独立；普通/JAV 零用户介入；US Adult 有图手动/辅助建档、编辑、每轮最多五位推荐；认领来源影片无二次确认 | 开发中，尚未闭合 |
| `US-FORMATION` | 真实 service-local 抽帧/人脸匹配，唯一最高有效演员；未识别进入既有暂存车间，确认后原位继续，有演员才可上架 | 开发中，尚未闭合 |
| `US-PRESENTATION` | 初次生产和 Arca 刷新共用正式 Renderer；四张 2×2 大截图；演员名加冻结原名；无展示用自建番号 | 开发中，尚未闭合 |
| `US-ARCA-REFRESH` | 仅用户单片手动指定/自动刷新创建本类 Aftercare Case；演员、NFO、海报、相关命名一致更新，收藏身份不变 | 正式HTTP/Work/提交与stage清扫真实进程恢复、Source过期及新Intent通过；最终平台/UI资格待闭合 |
| `SYSTEM-MAINTENANCE-WINDOW` | 每周配置、安全进入/退出、游标续跑和任务分类；概览只显示维护状态与当前任务 | 开发中，尚未闭合 |
| `US-QUALIFICATION` | 正式 Host 旅程、恢复反例、适用跨平台验证和具体版本 UI 审核有 Evidence | 待实现 |

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

## 2026-10-19 最新暂停状态及下轮NAS验收授权

- 开发继续暂停；`codex/us-adult@461d8805d`已保存，工作区干净，正在运行的完整Architecture验证进程已按用户要求停止，不记PASS。恢复开发后先核验当前提交及原始完整Gate结果，不能使用已撤销的分组执行资格。
- 用户追加两项发布前验收，纳入现有`US-QUALIFICATION`，不另建活动计划。仅本节记录不会恢复开发或启动NAS进程；下一轮恢复开发时执行。此前“本轮仅本地”限制在以下精确NAS隔离测试范围内被最新授权扩展，不构成生产发布或数据修改授权。
- **N95性能资格**：在实际NAS核验CPU、内存及当前可用资源后建立独立容器、端口、数据目录、Workspace和输出；为测试容器设置CPU/内存及并发边界，监测共机生产服务，不停生产或接入其数据库。先建立空载基线，再运行实际模型冷/热启动、20点抽帧、参考特征缓存、识别与海报、单片刷新及维护批次；从单任务逐步增加有界并发。记录每片/阶段耗时、吞吐、CPU、内存峰值、swap/OOM、磁盘I/O/iowait、测试API响应及共机生产健康/响应变化。若出现持续无响应、资源失控或生产明显退化，立即停止测试供给并安全收尾，记录失败，不为追求压力继续加载。验收须给出实际N95可用并发/资源配置、瓶颈及剩余风险；有卡死、OOM、无界积压或无法安全退出时不得认为性能达标，修正后复验。交互可用性数值预算在执行前结合基线明确记录，不能事后凭主观“不卡”判PASS。
- **真实媒体E2E资格**：从用户指定`/vol02/1000-0-24018892/US/scraped`有界挑选少量具有不同画质、镜头及人脸条件的影片，冻结测试清单、大小/摘要及选择理由；只读挂载原目录，并将选中材料复制到独立测试输入，避免来源结算、重命名或删除作用于原件。记录复制与空间成本，不扫描/复制全库、不提交影片/人脸图像或人物隐私资料到Git。测试数据与产物只保存在隔离目录。
- 以可核实演员身份及用户确认的独立参考图建立真值；不能把算法最高分或文件名当真值，也不能从同一测试片取参考图来证明跨片可靠性。若无法可靠核实某片演员，报告未标注，不虚报准确率；新的确证信息需要用户判断时才讨论。记录逐片真值、帧/人脸检出、最高匹配及次高差距、阈值/模型/参考图版本、耗时、自动命中/误认/暂存，以及人工确认结果。小样本结果明确分母和局限，不外推全库准确率；不为凑通过而对测试集调阈值。
- 实际E2E覆盖隔离Field→Libra识别/未识别暂存→已有演员人工确认→NFO/2×2海报/命名→Arca唯一上架，并覆盖单片指定/自动刷新及身份连续性；无脸/空库等场景可补独立对照，缺少自然样本时明确其fixture性质。验收后复核原件未变、生产数据未接入、测试进程安全退出。NAS环境、精确代码/镜像、资源限制、测试清单及性能/识别结果存入现有Evidence，不能用本机Linux或合成媒体证据替代。
- 以上与尚未通过的最终完整Architecture Gate共同构成本轮剩余资格；Windows/本机Linux及UI既有PASS按精确版本保留，新代码修改按影响补验。生产正式部署、生产数据升级及原媒体改动仍需对应授权。


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
