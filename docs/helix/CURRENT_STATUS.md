# ShelfDeck 当前状态

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
- 已上架瑕疵条目不追溯重加工、不撤销上架、不因新接纳标准触发历史瑕疵修复。未完成 Formation 条目仍按 Playbook 的精确授权及 clean-cut 纪律处理，当前没有新增 Reset 授权。

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
