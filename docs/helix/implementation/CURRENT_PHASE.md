# 当前活动包：Series 开发

2026-10-08云端接续交接：用户要求将本地现有代码同步到GitHub并转云端开发；本次保存并发Run未完成增量为开发检查点，不作为完成或发布声明。交接复验 `node --test test/helix-architecture/p14-series-run-lifecycle-continuity.test.js test/helix-architecture/p4-event-runtime.test.js test/helix-architecture/p8-acceptance-spec-planner-stale.test.js`：Windows 71项通过、0失败/跳过。未重跑完整Host/并发、全量回归、Linux、Docker/Desktop或UI验收；既有 `P14_ONDECK_STAGED_CONTROL_CONFLICT` 阻断保持开放。下文“未提交”指检查点保存前的历史记录；云端应先从GitHub最新main取得本检查点，按本Phase接续同Season落位/Commit协调。运行数据、凭据、依赖及本地外部日志不随Git同步，无生产动作。

2026-10-08最新增量：[Direct On-deck Evidence](evidence/SERIES_DIRECT_ONDECK_20261008.md)。2/24集实际隔离Host已完成Arca接纳、Season/逐集落位、正式授权源结算及唯一Season Entry/Deck Fact提交；正式Inventory/Claim/文件/NFO与Provenance核验通过。完整架构251文件及边界/语义/合同通过。仍未满足首版部署门槛：逐成员加工、N:M聚合、追加/运营、真实媒体/Linux和UI验收继续，未发布生产。

更新：2026-10-08。ACTIVE / DEVELOPMENT。用户追加“开始开发吧”，授权Series本地开发、隔离测试及必要构建。上个Movie阶段已按用户接受完成文档收尾；[旧包快照](archive/20260930_BETA_MOVIE_CLOSEOUT/CURRENT_PHASE.md)只用于追溯。唯一计划为[CURRENT_PLAN](../CURRENT_PLAN.md)，本Phase以有名称的工作项、里程碑及Evidence管理开发，不使用UAT编号；UAT只记录上线后的测试、验收问题。原UAT-279保留误登记与转移历史。

用户追加的工程工作区清理已完成；[历史UAT-280执行结果](evidence/UAT-280_BETA_WORKSPACE_CLEANUP_20260930.md)包含本地/NAS精确清理、源码/证据/用户修改保护及工作区退役复验。当前先实施Series元数据基础；整体纵向准备仍有未决项，不能因本工作项开工宣称准备全部Exit。

## 当前执行位置

2026-10-08工作区整合后，从主工作区 main 接续节点1；已完成身份、逐集资料/Artifact/Fact调度、24集容量和逐Primary源探测。本批已补逐Primary Direct验证/Selection及小数GiB要求；下一段为Run消费多Selection、逐Primary加工、Conformance及Product Package关联。节点1未关闭，节点2完整上架尚未完成；既有逐批记录保留为历史。Movie阶段已收尾，UAT残余独立维护；本批未生产发布。

2026-10-08节点1增量：[逐Primary Direct验证](evidence/SERIES_DIRECT_MEDIA_20261008.md)。2/24成员独立Verification与Selection已接通，小数GiB及用户确认的共文件均分/多part累加计算核心已实现。Run多Selection消费、加工、Package及N:M最终证据接线仍待完成，节点1保持开放；无生产发布。

2026-10-08继续推进：[多成员Direct交付Evidence](evidence/SERIES_DIRECT_PACKAGE_20261008.md)。2/24集完整集合已进入Conformance及Product Package，逐文件读取权限与claim绑定验证通过；24集触发的Provenance容量合同矛盾已对齐，schema原子升级专项通过。当前仍未Arca正式上架，下一段接正式Season/Episode落位和逐成员加工；完整架构复验250文件通过。

## 目标、Owner 与边界

准备一个能交付真实剧集完整链路的大版本，继续使用现有五域模块化单体。Procurement 识别 Season 输入与不可变 Candidate；Libra 拥有 Subject、Routing、Run、Acceptance Spec 与生产 Workspace；Arca 拥有正式 Season Shelf Entry、Episode/Inventory、维护及退出。保持 Handoff A/B 单向、只由 On-deck Commit 建立收藏事实。Emby 仍是可选 External Provider。

首版范围沿用SSOT：普通Season文件集、明确的Season/Episode身份、按本批交付范围生产/验收、首次上架及后续非重叠Episode追加；恢复、多集共文件/一集多part、维护和退出也须进入验收，不能用只支持单文件单集掩盖模型边界。当前开发不修改Owner/Handoff/授权边界，不部署生产。

## 当前工作项：Series身份与逐集生产接线

2026-10-08显式连续性入口DoR：依据SSOT §3.4.2，Procurement只从冻结路径中的显式 `{tmdb-series-N}` namespace标记与positive Season形成weak provider_season_identity Claim，保留材料/位置/季号Evidence digest；每个同Candidate成员必须一致声明，冲突/缺失不继承。普通目录/标题及无namespace或Movie marker不推断Series。Libra仍独立确认正式Provider identity，Intake严格执行0/1/2 witness及Episode零重叠；不追溯合并已存在Subject。沿已有typed claim集合接线，不新建对象/Capability或跨Owner读；NFO读取尚未接入，不能宣称普通命名已具有精确连续性。验证单集/合并Claim、错误namespace/冲突/季号、实际Host同Subject两个Run及唯一Season扩充。 本批同Subject顺序追加、正式Provider exact及按交付范围准入/Freshness已通过实际Host，旧集与历史不改写。完整验证及后续多Run并发缺口见[连续性Evidence](evidence/SERIES_SUBJECT_CONTINUITY_20261008.md)。

2026-10-08提交历史与冲突DoR：扩充完成后按原Receipt冻结Inventory/Deck revision验证旧Run，不将新current head作为旧提交的重放basis；原Package/custody/decision/digest仍须精确相等，历史读无副作用。验证实际Host两次Commit后逐包回执读取、错误摘要与foreign custody拒绝；提交事务重放、Reservation/并发冲突单独验证。不得为旧未完成Formation增加兼容或替代原领域授权。 本批结果：历史回执修复及双批Host通过；原生事务Reservation/head drift/末尾故障注入均回滚，18表快照不变，原Owner事务重放不重复写。相关5文件38通过、1既有skip，详见[扩充Evidence追加](evidence/SERIES_SEASON_EXTENSION_20261008.md)。同Subject精确连续性、跨批Fact消费者和其他发布门槛仍开放。

2026-10-08追加当前事实：[Season扩充Evidence](evidence/SERIES_SEASON_EXTENSION_20261008.md)。E01/E02首次Commit后，E03从实际Host完成第二次On-deck Commit，扩充唯一Season Entry；原Inventory/Deck Fact历史和旧文件保留，最新Inventory包含三集，两批元数据和来源分别保留。此无claim样本按SSOT保持两个Subject，不能算同Subject精确连续性已完成。254文件全量仅固定摘要断言陈旧，更新后该文件复验通过；9项既有skip未计为验收。还须原生Commit重放/并发/Reservation负向、所有多Package Fact消费者、精确连续性入口、逐成员加工和UI/平台发布门槛，节点未关闭，未生产发布。

2026-10-08后续追加DoR：依据SSOT §3.4.2、§4.5.4–4.5.6、§6.5，在首批正式Commit后观察E03，以exact continuity延伸同一Subject、独立冻结Run，并由Arca串行扩充同一Season Entry的Inventory/Deck Fact revision。旧Run、历史Inventory和旧集物理字节保持；新增零重叠集只使用本次Package成员，不以目录相同猜identity，不覆盖旧Season共享Artifact。先用实际隔离Host定位当前链路缺口，再补拥有该事实的领域逻辑及冲突/重放回归；不变更Owner/Handoff或生产数据。

当前Arca落位增量DoR：依据正式Series/Season identity及本批Episode Metadata/Primary Claim Set生成Season目录和逐文件名称；Libra逐集NFO使用带closed episodeScope的Artifact Requirement，完整scope进入既有Requirement digest、验证和Package引用，Arca只从本Package精确scope重建匹配digest，禁止从来源名或Workspace路径猜集号。保持只有Primary携带Episode relation、碰撞拒绝、读取Fence与正式On-deck Commit边界。覆盖2/24集纵向、N:M/part命名、跨scope/重复NFO目标拒绝和Movie回归；Related NFO、追加及Aftercare需逐项实测，不能因首批fixture通过就关闭发布门槛。

2026-10-08用户要求持续推进至首个可部署Series版本。当前增量DoR：Libra按冻结Run逐Primary重建完整Direct Selection/Verification集合，精确绑定成员Handle、Probe及Spec，禁止first-result消费；沿现有Staging、Conformance、Product Manifest及ShelfAcceptancePrimaryReadSet的集合合同交付，Related/NFO按明确目标区分，不能给Related添加Episode relation。验证2/24集、乱序/重复/缺失/跨Run结果、单集失败不交付、Movie回归，然后推进Arca正式上架及真实媒体。后续加工、N:M最终计量、追加/恢复与适用UI验收仍是可部署门槛。无新Owner、Handoff或存量兼容；所有效果只在本地隔离样本及Workspace，尚未授权NAS生产发布。

2026-10-08接续「逐Primary Direct产品验证」DoR：在既有Libra WorkspaceMediaProduction Planner内，为冻结Run的每个物理Primary形成独立ProductMediaCandidateInput、Verification和Selection；Plan绑定完整member digest，Owner projection重建精确成员与完整Source Probe覆盖，拒绝旧Binding、跨Run Work、缺失/重复/foreign Result。沿SSOT §3.4.4–3.4.6、§5.5.8、§8.6.7及PBF-20，不新增Owner/Capability/全局Store，不改来源、不生产兼容层。先覆盖一集一文件的0.75/1.5 GiB精确上限及2/24个成员调度；用户已确认N:M按文件覆盖集数均分、同集多个part份额相加，写入SSOT §5.5.8并实现精确有理数计算核心；尚未接入typed聚合验收证据，因此有上限的N:M在Direct入口显式返回LIBRA_SERIES_SPACE_AGGREGATION_REQUIRED，不能伪造单集通过。无上限的N:M保持物理成员不重复验证。验证含同一Event Result闭包、负向成员/Probe Fence、Movie单源回归及隔离Host的Direct Work终结；完整Run多Selection消费、Remux/Transcode、Package与Arca Commit另需贯通，不能用本批Direct Work通过关闭节点1或首批上架。没有Series页面/文案交付或生产动作。

2026-10-01接续「Series Routing 与 Run 调度」DoR：Routing只补Policy实际缺失的事实，沿正式Subject及routing-anchor accepted Candidate冻结contentProfile；Series另冻结同一IdentityClaim的explicit positive Season Number。Related只读取所指有界tvshow NFO的Series层事实，不把Episode/actor子节点身份当Series；Provider沿既有Routing Capability查询TV及相同Season，typed Intent/Observation拒绝错误Profile、Season和namespace。Routing得到的Provider Fact不替代正式Product Identity或发布continuity。验证包括实际Owner Context Reader、Integration Adapter、typed schema、排序优先级及原生Work调度至Spec/Run；Series Admin观察入口保持关闭，测试通过Owner观察命令驱动隔离Host。不新增Owner/Handoff/Capability或存量兼容；无用户界面交付、无生产数据动作。

2026-10-01接续「Series身份解析与continuity发布」：沿SSOT §3.4.2、§5.5.3及ResolvedProductIdentity合同，以冻结IdentityClaim的显式positive Season Number、Run execution basis和已有Related/Provider source Work形成closed Series身份Observation；TMDB search/exact必须验证TV对象及对应Season存在。Libra正式Fact保留相同Series/Season tuple，并在同一Domain Fact Commit发布provider_season_identity relation、Subject continuity set及head，不能追溯改写旧Intake或猜测合并。验证覆盖HTTP/typed schema、错误Season/对象/关联、完整Result引用、原生commit/replay/crash rollback与未来Intake匹配。无新Owner、Capability、Handoff或生产副作用；本工作项仍不开放Series页面，manual disambiguation界面后续交UI负责人验收。

- Outcome：以已解析Series/Season tuple和冻结Run交付集形成各集Observation/Draft/Fact，正式Artifact Planner与Sidecar Renderer生成Season及逐集NFO，保持独立Provenance和Related源保护；贯通实际Workspace与Fact事务后接续上游身份和完整调度。尚不开放Series产品入口。
- Owner与合同：Platform Integration Adapter只观察外部资料；Libra决定来源、Episode交付范围与Profile，并仅写Workspace。沿用SSOT §5.5.3/§5.5.5、§6.4.7.1及既有MetadataFetchIntent/SidecarProfile/ArtifactHandle，不新增Domain或跨域Store。
- DoR：输入为已有精确resolvedProviderIdentity与有界requestedFields；Sidecar以typedParameters冻结rootElement、Season Number、Episode Number，必须与本集Draft相等。普通Season沿当前positive-number合同；Episode scope使用closed canonical key/数字tuple并与Spec/Manifest逐项相等。S00不以本实现默默定案；N:M计量沿2026-10-08用户确认的SSOT规则。
- Effect/Fence：Provider使用既有IntegrationHandle/Secret Lease、timeout与响应字节上限；Renderer沿用Workspace effect authority、Artifact provenance与受控物理写入。Movie路径保持原冻结输入与行为，不做存量迁移。
- 验证：真实Adapter逻辑配隔离HTTP fixture，正向Series/Season及负向身份/响应/字段/Fence；Episode NFO生成、更新、错误集号与不完整Profile拒绝、源字节保护；现有Movie TMDB/NFO回归。完整Run/Commit、真实媒体及Linux验证在后续纵向Gate执行。

结果：元数据基础叶子已实现，提交`ea3d33d16d1bb19949f379e36ea648cfafd003a6`；两批Windows103项通过，见[原Evidence](evidence/SERIES_METADATA_FOUNDATIONS_20260930.md)。后续逐集接线提交`cca63288607aab127edd8e000221c00b373bca7a`：Intent/Observation按冻结Episode scope隔离，Draft/Fact保留逐集typed集合，Planner/Owner projection/Renderer生成Season及各集NFO，Verification拒绝重复目标代替缺集；172项受影响回归及最终12项重叠专项通过，P2合同通过，见[接线Evidence](evidence/SERIES_EPISODE_METADATA_WIRING_20260930.md)。节点1仍需真实Foundation/Workspace链、原生Series Fact commit及Artifact正式交付关联验证；Source Basis现有16 Observation及字节容量需覆盖普通长Season。本批未改变用户界面或部署生产。

追加原生验证`a36b22dab`：真实SQLite/Work Result Reader/Workspace写入/Artifact Registry/Fact事务的3条Artifact与E01/E02资料重放、失败回滚、Source Result改写Fence通过；相关48项及最终受影响回归176项通过、0失败/跳过，P2再次通过。Source Work/Plan/Event仍为固定边界种子，ResolvedIdentity仍为注入fixture，不能替代正式身份解析和Scheduler完整Run。节点1当前继续补上游Series身份链及长Season容量；节点2已确认默认NFO命名碰撞，按Arca正式布局处理，不能更改“只有Primary携带Episode relation”合同。详见同一[接线Evidence追加](evidence/SERIES_EPISODE_METADATA_WIRING_20260930.md)。

本批Series Product Identity交付`215af03f5261029410c2d8e8041778ba1396a8dd`：[身份与continuity Evidence](evidence/SERIES_PRODUCT_IDENTITY_20261001.md)。正式Planner在两个Owner input绑定冻结Season，Provider search/exact验证TV+Season，Related NFO只形成claim；原生Fact事务同时发布Subject身份、continuity relation/set digest/head，支持exact replay与最后CAS失败全回滚。未来Intake查询及E03的既有身份projection通过，但不等于实际追加准入/上架。最终15文件302项回归及生成manifest后的44项重叠复验通过，P2无findings。追加`f61beacb1`实际Identity Capability经原生Work Reader和fenced Commit发布通过，专项最终31项通过。节点1继续Routing、完整调度及长Season容量验证；无Series页面交付、无生产部署。

追加实际调度交付`4831a923b`：[Routing与调度Evidence](evidence/SERIES_ROUTING_SCHEDULING_20261001.md)。修复Routing固定Movie、Spec空Episode范围及Artifact目标数量判断；2/24集由实际Host从Field执行到身份、逐集资料、NFO/海报及原生Metadata Fact，源字节及空Shelf保持。Series来源容量128，Movie/JAV仍16，512 KiB/64 KiB字节合同不放宽；25份NFO与25条资料来源完整保存。最终15文件181项及4文件17项通过、0失败/跳过，P2通过。节点1继续逐Primary媒体验证/加工及Product Package交付关联；多批非重叠Spec/Run仍在节点3验证，无UI PASS或生产部署。

## 已确认合同与首版验收方向

节点1当前批次DoR（逐Primary源探测）：沿SSOT §3.4.4–§3.4.6、§8.6.7及PBF-20，Libra从正式Reader重建同一冻结Run的Primary集合，为每个物理Primary分配独立只读Probe Event；共文件或多个part仍按物理成员探测一次，不把Episode数组展开为重复材料。Plan冻结materialKey及完整member digest，Owner projection拒绝跨成员、旧Binding或Manifest变更；Coordinator按完整Handle digest验证持久Result精确覆盖，缺失、重复、foreign及payload改写全部拒绝。保持现有Capability I/O、Material Control、Movie单源/原盘拓扑合同及无写源副作用，不放宽stream_file Source Scope的恰好一成员约束。本批验收为Planner/Projection/Result negative与受影响Movie回归；后续逐Primary加工、Package组装及完整Host执行仍是节点1未完成条件，不以此批关闭节点。

本批结果`51d8ab8d0`：[逐Primary源探测Evidence](evidence/SERIES_SOURCE_MEDIA_20261001.md)。2/24集实际Host的Source Work及成员/Result digest通过，13文件100项通过，最终22项重叠专项通过；另3文件25通过、2项明确skip，P2通过。下一段处理产品验证、加工和Package关联；单源Direct/Package假设与Series小数GiB要求仍有实现缺口，不作为本批已完成能力。节点1保持开放，无UI交付/生产部署。

| 合同 | 引用 | 应有用户结果及验证 |
| --- | --- | --- |
| 收藏主体为 Season，Episode 是直接 child entity | SSOT §3.2.6、§3.5.4 | 不按单集创建独立 Season 收藏；Season/集数统计分开 |
| exact continuity 与零重叠才 extension | §3.4.2、§4.4.3 | 同 Season 后续非重叠集接入原 Subject；无 claim、多义或重叠建立新 Subject，不猜测合并 |
| 每 Run 冻结自己的 Episode Delivery Manifest | §3.4.4–3.4.5、§5.5.4、§6.2.3 | 新集新 Run，已有有效非重叠 Run 不被改写；不要求理论全集或以缺集阻断 |
| On-deck 扩充既有 Season Entry | §4.5.4–4.5.6、§6.5 | 首次建收藏，后续只增本次已交付集；同 Entry Commit 串行、冲突/重放安全 |
| N:M 是成员上的 bounded typed Claim Set | §3.2.6、§5.5.4、PBF-20 | E01–E02共文件、一集多个part无损穿越两次Handoff/Inventory；物理成员不重复，所有交付集都有覆盖 |
| Identity、元数据和 Artifact | §5.5.3、§5.5.5 | TMDB Series ID/Season，Series/Season资料及本批每集number/title/plot/NFO；海报等按标准与正式Capability生成 |
| Season评分上下文、逐Episode空间验收 | §5.5.8 | 沿用既定HEVC及逐集上限；不以整季总大小阻塞，也不因新集倒改旧接纳结论；多对多空间归属先核对合同 |
| Aftercare与退出 | §5.7–5.8、§6.5、§9.4 | 维护不借道采购新媒体；共享材料与相关文件安全；危险操作精确范围确认，不能连坐其他Season/Movie |
| UI由状态、操作与结果引导 | Playbook §11.1/§12.3、SSOT §9.4 | 沿用八个一级入口，展示Season/本批集范围、真实进度和下一步；UI负责人协调 |

不把 JAV/Western Adult、多用户、AI Upscale、Remote Worker、Desktop、理论全集/自动追更作为本次默认范围；改变这些范围需独立登记。新版本的名字和正式 tag 尚未分配。

## 当前实现审查与测试事实

| 已看到的实现/测试 | 证据路径 | 仍需核验 |
| --- | --- | --- |
| Candidate冻结Season claims及成员输入 | `media-service/src/helix/domains/procurement/application/movie-run-coordinator.js` | 真实目录识别、分组跨页/批次、新集Observation、Related范围，不能因文件名Movie就推断不支持Series |
| Season Subject/Run与Episode范围 | `media-service/src/helix/domains/libra/application/movie-formation-coordinator.js` | 从正式Field到Run的自动接线、并发零重叠/冲突、重复材料、历史重建 |
| Intake/布局/生命周期测试 | `media-service/test/helix-architecture/p14-series-handoff-a.test.js`、`p14-series-run-layout.test.js`、`p14-series-run-lifecycle-continuity.test.js` | Windows专项12通过、1跳过；Series Handoff A纵向fixture明确skip，需恢复真实执行，不把skip计为通过 |
| Arca Episode Claim Set | `media-service/src/helix/domains/arca/model/material-episode-claims.js`、`media-service/test/helix-architecture/p14-pbf20-episode-claims.test.js` | 真实多批Commit扩充同一Entry、完整Inventory、共享Artifact、退出/恢复 |
| TMDB按显式Episode scope取单集，Planner生成Season和逐集NFO，Draft/Fact隔离单集资料 | `media-service/src/helix/integrations/tmdb-provider-adapter.js`、`media-service/src/helix/domains/libra/application/libra-production-planners.js` | 真实Foundation/Workspace/Fact commit和Artifact交付关联待贯通；普通长Season容量待覆盖，未传显式Episode范围的Provider查询仍拒绝episode_* |
| 外部寻源/导入存在Series身份分支 | `media-service/src/helix/integrations/h1-provider-adapters.js` | MoviePilot落地快照要求恰好一条视频且Episode claims为空；搜索Episode keys取自请求而非候选实证，不能据此宣称真实剧集覆盖 |

逐入口事实、测试命令及未覆盖项见[准备审查Evidence](evidence/SERIES_READINESS_AUDIT_20260930.md)。已有部分合同基础，但不能直接启用Series。完整差距审查仍需覆盖观察→Triage→Intake→Routing/Spec→各成员生产→Handoff B→Commit→Projection→Aftercare/退出。

## 用户确认的5个节点与验收职责

2026-09-30用户确认按5个节点推进，并明确UI由UI负责人负责验收。以下是Phase内顺序，不建立全局编号体系；逐节点交付、逐节点验收，不承诺日期。

| 顺序 | 工作项 / Owner | 验收门槛 | 当前状态 |
| --- | --- | --- | --- |
| 节点1 | 剧集资料与生产基础 / Platform、Libra | 明确Season/Episode身份，逐集Observation/Draft/NFO/Artifact按冻结Run范围生产，完整Result与Provenance链 | 实际资料/Artifact/Fact调度、24集容量及逐Primary源探测已验证；产品验证/加工与交付关联待贯通，节点未关闭 |
| 节点2 | 首批剧集完整上架 / Procurement、Libra、Arca | E01/E02从Field到唯一Season Entry；正式Handoff/Commit、真实媒体及相应用户路径；UI负责人验收可见变化 | 依赖节点1及适用合同/fixture门禁 |
| 节点3 | 持续追加与复杂文件映射 / Libra、Arca | E03扩充同Entry，旧Run/集事实不改写；重叠/并发/重复及N:M、逐集空间验收；可见变化交UI负责人验收 | 依赖节点2 |
| 节点4 | 完整运营与用户体验 / Procurement、Libra、Arca、UI负责人 | 外部实际Episode覆盖、失败/重启、Aftercare/共享材料退出；Season用户旅程、适用状态及UI负责人验收 | 依赖对应纵向能力 |
| 节点5 | Movie回归与Series发布资格 / 实施、UI与发布责任方 | 冻结SHA的Windows/Linux、真实媒体/浏览器、升级/回退及数据保护；UI验收结论绑定最终受影响版本 | 前述节点完成后执行 |

N:M计量规则已确认，完整证据接线仍待节点3验证；S00、身份纠正及Episode级恢复在所属节点开工前核对SSOT并满足DoR，不把未知合同藏进实现，也不以节点编号另建全局台账。

UI门禁适用于每个节点，包括后端生成的用户可见文案：实施前与任务“UI负责人”（`01a0912a-0086-74e2-88ab-536c59d3862a`）协调范围及设计；按Playbook §11.1/§12.3与Movie baseline §7.1的通用UI验收方法实现。沿用现有页面、组件/token和已确认设计规则；Series业务Oracle来自SSOT，不把Series追认进Movie Beta。

实施任务提供对应commit、页面/状态、操作与结果、截图或轨迹、浏览器/键盘/窄屏测试和未测项；UI负责人执行适用任务走查并记录通过/不通过及范围。UI代码或自动化测试通过不能替代负责人验收，后续影响用户表面的diff须重验受影响路径。没有适用UI变化时如实记录范围；当前叶子实现尚无Series页面交付，不宣称UI PASS。2026-09-30 UI负责人已确认职责并回传[逐节点适用矩阵](evidence/SERIES_UI_ACCEPTANCE_SCOPE_20260930.md)；具体页面验收仍待同版本实现与实际走查。

2026-10-08 UI负责人只读设计衔接意见（任务01a0912a-0086-74e2-88ab-536c59d3862a，turn01a117bd-5062-76a1-b73d-70e5b2986e77）：来源现有表单选择电影/剧集并保持统计/席位；收藏架按模板Profile编辑、剧集支持每集小数GiB且不改Movie标准；整理保留九列/筛选/分页，在名称单元格呈现季及本批范围、过程内看逐集；收藏海报按Season一项、详情增加实际集列表，不声称理论全集完成。需补正式来源准入、Series身份命令及Season/Episode Projection，前端不得猜文件名。尚无UI PASS，最终冻结版本需实际走查。

## 下一步与Phase完成条件

1. 在上述入口及直接依赖中核对每段真实接线，逐段记录已实现、需补接线、合同缺口和验证缺口；复核S00、身份纠正、N:M大小计量及Episode级失败/重试范围。已有决定按SSOT执行，真正新合同分叉才向用户提交具体方案。
2. 准备隔离测试manifest和样本：首批E01/E02、再到E03、多Season同名、重叠/重复、无claim/多义、缺元数据、E01–E02合并、多part、单集失败、进程退出、空间不足、共享Artifact与退出。真实媒体只用获授权副本；不把生产素材当可破坏fixture。
3. 固定首版验收矩阵及Owner/输入输出/revision/幂等/Effect/Fence/恢复条件，补齐上表工作项DoR与验证入口；版本开发全过程不分配UAT编号。
4. 每个开发工作项满足Playbook Definition of Ready后实施。保持恰好一个活动Phase；本包Exit后冻结到archive再切换，不另建Series活动计划。

Phase Exit须完成适用逐段差距/合同、样本矩阵及本地Season纵向工作项的完整验收；不能用首批叶子能力测试通过关闭完整Phase。原UAT-279仅保留转移记录，Phase进度不在该行更新。本轮不声称UI验收或生产剧集支持。

2026-10-08并发Run接线DoR：按SSOT §6.2.5/6.4.6/8.6.21，各Run以冻结Episode范围重新读取当前Routing/Standard/Perception，不借用另批Spec。Acceptance Spec Work通过已有typed dependencyRef绑定Libra Run，Planner和Owner projection从Foundation公开readDefinition及Libra不可变Run/Spec验证该范围；仍由Subject Decision Head CAS串行发布，不新增Store/对象/跨Owner读取。Series Comparable语义比较忽略纯Intake revision变化，以冻结成员Episode claim集合比较交付范围，Binding/Control及当前要求变化仍触发替换。验证两批同时active、原Run不supersede、policy变化仍检测、stale/foreign依赖拒绝，并跑顺序补集/Movie回归；当前未完成。

2026-10-08并发推进事实（已保存于checkpoint `37521a59c`）：已接入按Run冻结范围的Spec准备、不可变Execution Basis dependencyRef、纯Intake revision语义归一及Series未完责任席位保留。基础范围/Lifecycle26项、补充scope6项、pipeline8项、Foundation Event Runtime64项通过（集合有重叠）；顺序同Subject补集Host仍通过93.6秒。新增两独立Field并发fixture已验证一个Subject下两个Run同时active、冻结范围不supersede，随后在Arca共享poster接管失败`P14_ONDECK_STAGED_CONTROL_CONFLICT`；完整并发尚未通过，不能关闭。Spec发布竞争已改为Owner显式抛出Foundation通用superseded-input分类，保留失败Attempt与旧Work，唤醒正常新Basis重评；不派发旧输入、也不在Foundation增加Series业务判定。下一步按SSOT §6.2.5补同Season落位/Commit串行协调，核验Target Slot现有持有/释放合同，禁止放松Material Control或借故重置。最新失败日志`E:/my_project/helix-git-consolidation-20261008/series-concurrent-host.txt`；测试Host均已停止，无生产动作。

2026-10-08目标预约DoR：按SSOT §6.5.3 Target Commit Slot及§6.2.5，Arca以Final Decision的精确Endpoint/location协调物理落位；Owner投影只读等待，首次offloading同事务竞争并持久化预约时间，副作用前再验，blocked持有者保留预约直至Commit。未占用目标的失败不能阻塞其他Run；恢复重新验证预约。验证并发Host、同/异目标、重开数据库、失败前后差异及顺序/Movie回归；无新增Owner或生产动作。

2026-10-08并发落位实现与专项验证见[Evidence](evidence/SERIES_CONCURRENT_TARGET_20261008.md)：Arca持久化目标预约、Owner输入等待、恢复竞争及旧已提交schema保护已接通；并发Host两批形成唯一Season Entry与E01–E03。大范围架构2057项执行，唯一固定摘要断言更新后专项通过，9项既有skip；历史迁移9项失败在修改前基线同样复现，保留为节点5验证缺口。继续逐成员加工、N:M最终空间证据及运营/UI/发布资格；用户要求本地与GitHub同步，验证后提交推送。

2026-10-08逐集最终空间接纳DoR：按SSOT §5.5.8及§8.6.20，Arca以本批完整Product Manifest计算每集精确有理数份额，替换当前整批Primary求和；共文件均分、多part累加，不累计已上架旧集。Space AcceptanceCheck保存绑定Manifest/scope的typed逐集Evidence，沿既有max_size_exceeded Gap与完整Acceptance union；共用纯数学合同helper，不导入另一Owner模型。验证上限相等、单集超限、总量超过单集但各集合格、分数不可向下取整、Movie回归及实际Host。Libra bounded N:M入口仍需后续接线，不以Arca修复宣称全链已支持。

2026-10-08逐集最终空间实现见[Evidence](evidence/SERIES_FINAL_SPACE_ACCEPTANCE_20261008.md)：Arca按完整Product Manifest均分/累加并保存typed Evidence；多part Structure覆盖与Libra最终Conformance独立聚合已验证。正式模板每集24字节、两集合计48字节的Host上架通过；24集回归通过。全架构2068项执行，2058通过/9既有skip/1历史见证拒绝范围断言更新后，相关86项复验通过。bounded N:M入口和逐成员加工仍待贯通，不关闭完整Series节点。

2026-10-08 bounded N:M Direct DoR：依据SSOT §5.5.8，Libra Owner projection从冻结Run完整Primary/Probe集合生成closed Series空间Basis，绑定Run execution digest、成员digest、Handle/Probe digest及Episode范围。Capability只对该typed输入做精确分摊，返回当前成员所覆盖集的份额与Basis digest；Direct Reader逐字节重建输入/证据，Verification identity绑定Basis，Conformance和Arca仍从最终成品独立重算。保持64 KiB输入/16 KiB结果上限、物理成员只验证一次、无副作用或UI变化；验证共享文件、多part、分数边界、缺失/重复/foreign/改写Basis、实际Host N:M及Movie回归。逐成员加工和混合成品选择仍为独立未完成条件。

2026-10-08 N:M上游根因修正DoR：实际两part样本在Procurement被`structure_ambiguous`拒绝，尚未创建Run；SSOT §3.2.6/§3.4.2已明确同Candidate内部multipart为Libra生产范围，不能视为Procurement边界错误。删除Triage对不同物理成员重复Episode key的全局拒绝，保留完整各成员typed Claim Set、物理唯一与容量限制；不推断分段命名、不变更后续Candidate零重叠准入。修正与SSOT冲突的旧单测并复验实际part Host和Series Intake连续性负向；不是通过放宽Libra/Arca最终验收绕过缺陷。

2026-10-08 bounded N:M Direct结果：[空间Basis Evidence](evidence/SERIES_DIRECT_SPACE_BASIS_20261008.md)。共享文件及多part实际隔离Host经正式Handoff B/Commit完成，完整成员Basis、精确分摊、typed闭包、跨Basis拒绝及Movie回归通过。Procurement同Candidate重复Episode拒绝已按既有SSOT纠正，跨批Intake保持；节点尚未关闭，继续逐成员加工/混合选择和其余首版门槛。

2026-10-08逐成员加工DoR：沿SSOT §8.6.7/§8.6.18的一Event一物理stream_file，先使Remux/Transcode Supporting Work身份绑定冻结Primary member digest，策略依赖不跨成员；紧凑ProductionSourceScopeReference从完整Run重建精确单成员，不裁剪或替换Run/Spec，也不放宽stream_file memberCount=1。Planner/Resolver只授予该成员只读Handle；成员、Run、Manifest或引用digest变更拒绝，Movie/原盘定义保持。随后接Coordinator逐成员策略与完整混合成品终检/交付，Workspace归属、空间预算、claim映射和最终N:M分摊一并验证；单个成员Work通过不得视为整个Season可交付。

2026-10-08逐成员加工增量结果：[成员范围与Remux Planner](evidence/SERIES_MEMBER_MEDIA_SCOPE_20261008.md)。成员Work身份/策略依赖、单文件Source Scope/读取Fence、Remux Planner及Workspace候选完整空间Basis通过专项与全架构回归。当前尚未接Coordinator混合成品提交/汇合、成员Transcode Planner与真实媒体；本批不关闭节点，继续既定首版全部门槛。

2026-10-08成员Transcode DoR：Planner按成员Work精确选择Source Handle/Probe、同成员Assessment/Selection历史和独立输出；Selection逐字节复用已通过Assessment的Intent/Device/输入证据，拒绝跨成员历史。Series有界文件预算由完整冻结源集合按各集当前字节份额比例分配，取该文件所覆盖各集的最紧约束并向下取整；此为Libra生产规划预算，不修改逐集Acceptance Spec，质量下限仍按原单集Policy，最终完整混合成品必须独立逐集复验。沿既有typed Intent/Plan binding、Workspace fence与一Event一策略，不新建Owner或业务对象。验证N:M预算守恒/精度/零输入不可规划、策略历史隔离、source/Intent/Device错误拒绝与Movie回归；Run自动调度及完整交付后续接通。

2026-10-08成员Transcode Planner结果：[规划Evidence](evidence/SERIES_MEMBER_TRANSCODE_PLANNING_20261008.md)。成员源与策略历史、精确Assessment复用、共享/part物理预算及原单集质量下限通过专项和全架构验证。下一段为Coordinator成员Work提交/恢复和完整混合成品选择、Staging、Conformance/Promotion汇合；尚未真实Series加工实链或发布，节点保持开放。

2026-10-08混合成品汇合DoR：Coordinator沿完整冻结Primary集合逐成员调度Remux/Transcode，Working Reference只携带该源成员Episode Claims。新增同类Supporting Work的最终集合验证阶段，identity/dependencies绑定完整候选集合及持久Result digest；复用既有Verify/Select Capability，所有候选在完整实际混合集合上重算份额后才允许Staging/Conformance/Promotion。中间Workspace候选若仅受其他待处理part导致的聚合超限影响，只有实际文件已满足自身保守预算且其他质量/解码均通过时可作为待终检材料，不伪造passed Selection。交付逐成员建立源→成品关联与源结算，禁止首结果借用/整Run统一carried-forward或replaced。验证混合链路、缺集/foreign/重复/改写集合、正确Episode映射、重放和源保护；不改变Owner/Handoff或NAS数据。

2026-10-08混合候选终检/交付增量见[Evidence](evidence/SERIES_MIXED_FINAL_SELECTION_20261008.md)：逐成员调度、完整实际集合Verify/Select及Staging/Conformance/Promotion已接通；隔离Direct+Remux两集到唯一Season上架与逐源结算通过。受控Effect不等于真实FFmpeg；完整Transcode Host、逐成员外部寻源、恢复/运营、UI/Linux和发布资格继续，节点保持开放。

2026-10-08真实混合媒体Host DoR：沿用上述成员生产与终检合同，以临时生成的三集媒体分别触发Direct/Remux/Transcode，启用正式FFmpeg/Probe/Device探测及Workspace Effect，Provider资料保持隔离fixture；验收同Season完整上架、实际HEVC输出、各成员Claims/源结算与真实加工Result。不得借助旧Kairox runtime或NAS数据；失败按实际Owner根因修复。

2026-10-08真实混合媒体增量见[Evidence](evidence/SERIES_REAL_MIXED_MEDIA_20261008.md)：正式Windows Host三集Direct/Remux/NVENC Transcode、两文件跨两集且含同集part的N:M上架均通过；最终Inventory实际字节数独立重算与Libra/Arca逐集份额一致。短SDR无音轨无上限样本不覆盖有界重试、长片、多设备、外部寻源/恢复、Linux/UI和完整发布资格。

2026-10-08外部寻源合同复核（待用户确认，相关写入暂不实施）：SSOT §3.2.6允许最终N:M，但§8.6.21 OffloadContextManifest的finalProductMaterialKey仅为单值。外部提供E01/E02分集文件替换原E01-E02共文件时，无法逐项表达完整source-to-final mapping；按原物理成员单独寻源还会使E01多part与完整外部E01重复覆盖。建议在Libra既有Owner内按冻结Episode Claims二部图求受影响连通范围，以范围完整Episode Set寻源/验证，替换范围内所有原Primary，保留范围外已合格候选；各原Primary记录与自身Claims相交的全部最终Primary keys，要求其并集覆盖原Claims。Series交接使用精确有序多值映射，Movie仍为单成品；完整成品终检、Handoff B和Arca逐源结算继续保持原职责，Landing只读且只复制到Workspace。不增Domain/Store/第三次Handoff；正式schema/事务/验收必须在用户确认后传播，不能随意挑一个成品引用或删掉原part掩盖缺口。

2026-10-08升级验证DoR：修复既有9项历史迁移测试债。使用Git已提交且原DDL SHA256匹配的真实旧schema隔离fixture，验证既有正式升级入口、事实保护、FK/integrity及幂等；将过时自动retire运行数据预期改为现行clean-cut不自动修改的验证。不新增旧Formation兼容、迁移或生产数据动作。

2026-10-08历史升级测试债完成：[Evidence](evidence/SERIES_HISTORICAL_UPGRADE_FIXTURES_20261008.md)。真实历史DDL替换伪旧fixture，current schema旧Plan保持不自动改写；历史升级与Series相关schema/reservation联合20项通过。解决原9项测试失败，不替代完整生产同库升级/回退证据。

2026-10-08Series逐集资料健康检查DoR：沿SSOT §3.4.4/§6.5的Arca Inventory/Fact权威，修正Aftercare把episode_title/episode_plot当第一份Metadata顶层字段的错误；以当前Inventory真实Claims限定范围，读取所有已接纳Product Metadata Facts，校验同Canonical Season与逐集唯一记录。缺集/错季/重复/空值须识别，已有完整补集不得误报。保持既有Finding代码/Owner与Movie路径，不新增UI控件或文案；用户仍在现有健康状态/资料缺失提示查看结果，后续Series UI负责人需对冻结版本状态显示验收，本批不声明UI通过。验证模型负向、真实两批上架后的Owner context及Movie回归；不碰外部替换待确认合同。

2026-10-08逐集资料缺失检查已接通：[Evidence](evidence/SERIES_INVENTORY_METADATA_20261008.md)。Aftercare按当前Inventory Claims检查全部批次的逐集Metadata，原完整E01/E02/E03不再因顶层查找而误报；14项专项、两批正式Host Owner context与全架构2,135通过/9既有skip。完整Aftercare其他维度、浏览器/版本UI验收及发布资格继续。

2026-10-08当前DoR：Series Aftercare媒体评估由Arca读取当前完整Inventory，依据SSOT §5.5.8逐集均分/累加实际Primary字节，逐物理成员Probe与播放抽样，并保留读取前后Physical Identity Fence。范围为纯评估与既有Finding输出；不增加Owner或自动维修权限。现有维修策略只描述单一Primary，Series缺陷必须显式保留attention_required，逐成员修复仍为本Phase后续必做项，不能以此关闭运营能力。验证普通多集、N:M边界/小数、后续成员异常、内容漂移及Movie回归；健康投影的具体版本UI验收仍待负责人执行。

2026-10-08本批结果：[Aftercare媒体Evidence](evidence/SERIES_AFTERCARE_MEDIA_ASSESSMENT_20261008.md)。全Primary媒体评估与N:M逐集计量接通，15项专项及正式Capability/schema通过；全架构复验2,150通过、9既有skip、0失败（首次目录变化Fence偶发失败已保留证据）。未实现Series逐成员维修、展示维护及完整运营，UI/Linux与发布Gate保持开放。无生产动作。

2026-10-08展示维护DoR：Arca海报获取原固定tmdb_movie，Series必须从当前Inventory的全部已接受resolved_identity重建精确TMDB Series/Season anchor，校验Canonical Identity后传给现有Integration Adapter；不同批次必须指向同一Season，冲突/缺失在网络或Workspace写入前拒绝。沿用SSOT §3.2.6/§5.5.5/§8.6.19既有Owner及Artifact路径，不改变NFO/维修范围或生产权限。专项验证Series/Movie路由、跨批/错季/错Provider拒绝及正式Capability边界；后续完整展示维护与UI版本验收继续。

2026-10-08展示维护增量：[Provider Identity Evidence](evidence/SERIES_AFTERCARE_PROVIDER_IDENTITY_20261008.md)。Series海报获取按正式Series/Season身份接入既有TMDB Artifact端口，不再请求同编号Movie；跨批Canonical身份与网络/Workspace前Fence验证通过。95项相关测试通过；未完成逐集NFO、完整维修Host和对应版本UI验收，节点4及首版发布资格仍开放。

2026-10-08逐集NFO评估DoR：当前Presentation只检查任意一个NFO可读，Series应检查当前Inventory登记的全部NFO（沿已确认存在/非空/可读口径，不把外部XML或内容差异当损坏）。每个缺失/不可读文件纳入Finding摘要。现有TextRender/Materialize按单NFO选择且缺少Episode目标，不能授权其修复Series；在尚未接通逐Artifact scope前，Series NFO缺陷明确attention_required，TextRender执行入口在写入前拒绝。此为实现中间门禁，后续逐集生成/落位/提交必须完成，不能以拒绝维修满足节点4。验证后集缺失/空、无NFO、外部文本、顺序稳定、Movie回归及正式Capability无写副作用。

2026-10-08 NFO评估增量：[Evidence](evidence/SERIES_AFTERCARE_NFO_ASSESSMENT_20261008.md)。全部已登记NFO评估与错误单NFO维修的写入前门禁已实现，Aftercare回归225通过。后续必须打通Arca接受Artifact Requirement到Inventory成员的精确关联、逐Artifact Planner/Result、NFO生成/落位/原子提交；不得以文件名猜集或NFO的伪Primary Claim替代。此批不关闭维护能力或节点4，无生产动作。

2026-10-08 NFO scope基础DoR：从交付包的完整Metadata Episode scopes、NFO Artifact Requirement digest和Workspace材料digest建立Arca内部确定性关联，供当前Series落位和后续正式Inventory Artifact关系持久化使用。以原有Owner/SSOT §5.5.5/§6.5为界，不猜文件名、不赋予NFO Primary Claim；拒绝错季、重复Episode、歧义Artifact或同scope重复物理NFO。先验证真实落位调用及负向数据，再接入Commit关系保存和逐Artifact维修，不能仅凭内部映射宣称Aftercare已完成。

2026-10-08 NFO scope基础结果：[Evidence](evidence/SERIES_ARTIFACT_TARGETS_20261008.md)。按Requirement与材料digest建立内部映射并接入Series落位；17项专项、共文件两集完整隔离Host通过，全架构2,190通过/9既有skip/0失败。后续必须将该正式关联写入Arca Inventory revision及原子Commit，再连接逐Artifact维修；本批未持久化映射，不关闭节点4或发布Gate。

2026-10-08 Inventory Artifact scope持久化DoR：在Arca Inventory成员增加nullable的artifact_scope_json；仅Series NFO存储closed且自带摘要的整季/Episode Requirement与已接受Artifact来源关联，Movie/其他角色为空。On-deck从既有正式映射及已验证Staged成员建立关系，与Inventory/Deck摘要及事务一同提交；追加保留旧成员关系，Aftercare新revision复制关系。Owner/Handoff不变，不读取Libra内部Store，不替NFO创建Primary Claim。精确旧schema只做新增nullable列，不回填/猜测历史Series关系；旧Series收藏缺关系需显式拒绝升级，Movie事实不改写。以模型负向、真实SQLite事务/历史保护、Host首次/追加验证；本批无生产升级授权。

2026-10-08 Inventory Artifact scope结果：[Evidence](evidence/SERIES_INVENTORY_ARTIFACT_SCOPE_20261008.md)。独立schema_ref与closed scope JSON已进入Arca正式成员、首次/追加Commit、历史摘要重建及维护revision复制。显式连续性Host E01/E02→E03通过；全架构2,202通过/9既有skip/0失败，最后维护/Scope239通过。旧Movie schema保护升级与旧Series缺证据拒绝通过。下一段将scope贯穿逐Artifact维修Planner/Projection/Result、NFO生成与精确物化提交；当前TextRender门禁仍在，不关闭节点4/发布Gate。无生产动作。

2026-10-08 Series NFO重建DoR：依据SSOT §5.5.5及Arca Aftercare/Inventory合同，从当前正式NFO成员的Artifact scope选择其sourcePackageId对应的已接受Identity、Metadata和Cast；Episode目标只使用精确匹配的逐集资料，整季不混入Episode字段。生成tvshow/episodedetails受控XML，校验Series/Season、当前成员范围、必需字段和输出字节上限；不从文件名推断、不回读Libra Store或重新抓取Provider。先以负向模型及实际两批Host Owner context验证，再贯穿Planner/Result/物化与原子提交；完整链路通过前保持Series自动维修门禁，不以纯Renderer通过关闭运营工作项。

2026-10-08 Series NFO重建增量：[Evidence](evidence/SERIES_AFTERCARE_NFO_RENDER_20261008.md)。正式Artifact来源批次到tvshow/episodedetails渲染已通过实际两批Host Owner context，Commit输出按精确Event绑定，拒绝多结果歧义。专项39项、全架构2,233通过/9既有skip/0失败。下一段接通缺陷目标冻结、逐Artifact Workspace生成/正式物化/Inventory与Control原子Commit和恢复；当前Series自动维修门禁保留，完整运营及发布资格未完成。

2026-10-08 NFO维修目标冻结DoR：按SSOT §6.5、§8.5.11及既有Aftercare Finding/CareRequirement合同，将Series NFO展示缺陷按正式成员分别产生稳定Finding；摘要覆盖Material、Binding和Artifact关联。Planner从Case requiredEffects与同Care Basis专业Assessment历史重建精确成员集合，拒绝未匹配/歧义/过期证据；为每个目标建立独立TextRender Event，并经ArtifactProfile冻结材料key、scope摘要和Case requirement摘要。Coordinator不读文件、不新增Store；真正物化闭环完成前保留attention_required与TextRender写入门禁。验证多集缺失、顺序稳定、错来源/绑定/Case拒绝、正式Planner/Projection及Movie回归。

2026-10-08 NFO维修目标冻结结果：[Evidence](evidence/SERIES_AFTERCARE_NFO_TARGET_FREEZE_20261008.md)。逐NFO Finding绑定正式材料/Artifact关系，Case与同Basis专业历史解析精确目标，独立TextRender Event/Profile以及同类参数去重已实现；299项维护回归通过。保留Series实际写入门禁；下一段贯穿Profile、生成Artifact、精确物化、未受影响材料保护、原子提交与恢复。UI版本验收与完整发布资格仍开放。

2026-10-08 NFO维修副作用DoR：在既有Aftercare Owner/Workspace/Material Effect合同内，TextRender消费精确ArtifactProfile，验证Case/已接受Fact/Basis后为每个目标写独立Workspace NFO；Artifact provenance绑定原材料、scope和读取时Physical Identity。正式物化只替换该目标，重验已生成字节与来源Fence，Receipt仅retire该成员，Inventory新revision保留其Artifact scope及其他成员。continue_forward须以冻结Source Guard、精确新文件或superseded原文件证据重建，禁止凭路径存在认领；缺失恢复与外部写入分别验证。自动维修评估保持关闭，待实际完整Case/事务和恢复通过后再启用。

2026-10-08 NFO维修副作用结果：[Evidence](evidence/SERIES_AFTERCARE_NFO_EFFECTS_20261008.md)。TextRender/ArtifactHandle、逐目标落位、原成员scope复制和显式forward恢复已实现，12项真实文件Effect专项及全架构2,269通过/9既有skip/0失败。该Evidence使用内存Workspace登记fixture，不替代正式SQLite Case/Inventory/Control事务、Settlement或进程重启验证；下一段补完整Host后再启用自动维修。未关闭运营或发布Gate，无生产动作。

2026-10-08 Series NFO完整Case DoR：对已登记且Artifact scope/已接受资料齐全的缺失或空NFO，沿现有Aftercare自动维修授权启用完整Case；目录、symlink、不可读、scope或资料不足继续attention_required。隔离Host由正式HTTP健康检查进入Assessment/Case/Workspace/Materialize/Inventory-Control原子Commit/Settlement/终结，核对目标scope和正常文件/旧revision保护；不注入业务结果或改写运行数据库推进。完整Host失败按实际Owner根因修复，UI精确版本及Linux/生产验证仍为独立门禁。

2026-10-08 NFO完整Case增量：[Evidence](evidence/SERIES_AFTERCARE_NFO_CASE_20261008.md)。正式Host已贯通两集缺失/空NFO的自动Case、Workspace、逐成员物化、Inventory/Control事务及Settlement和resolved；最后参与者抛错验证全事务回滚，正常成员/旧revision保护和People关联收敛后的Host重开通过。全架构2,271通过/9既有skip/0失败。当前只启用资料和scope完整的已登记NFO维修；真正进程中断、媒体/其他展示/Placement运营、UI精确版本及Linux发布Gate继续。

2026-10-08 Series展示联合维修DoR：依SSOT §5.5.5至少一张poster及既有Aftercare Owner合同，在正式隔离Host同时制造两集NFO缺陷和已登记poster缺失，验证TMDB Series/Season精确身份获取、独立Artifact物化、同一Inventory/Control事务和Settlement、正常材料保护及终结/重开。沿用前批真实SQLite回滚验证；不修改生产数据、不绕过Provider身份Fence，不把fixture网络/媒体结论扩展为真实网络验收。

2026-10-08 联合展示维护结果：[Evidence](evidence/SERIES_PRESENTATION_CASE_20261008.md)。正式Host在同一Case恢复登记poster和两个Episode NFO，Series/Season Provider身份、三Artifact、原子回滚/Commit、Settlement、正常及旧成员保护、收敛后重开通过，92秒无失败。本批只有测试/文档变更，不覆盖真实网络、所有图像损坏、进程崩溃、Placement迁移或整体Series发布；上述工作继续。

2026-10-08 Series Placement请求DoR：当前Aftercare仅构造title/year的单体投影，Series命名所需Season身份、全部Episode Metadata与已登记NFO scope缺失。沿Arca内部Inventory端口建立显式Aftercare Artifact scope输入，使用当前Inventory的完整Claims、全部已接受批次Facts及持久化scope；不伪造Workspace Artifact、回读Libra或猜测文件名。On-deck继续使用其Accepted Artifact合同，Aftercare入口单独验证精确材料覆盖、Season/Episode与重复scope。先验证真实Inventory端口命名及拒绝路径，再补完整迁移Host；本批基础不等同于迁移闭环通过。

2026-10-08 Placement输入结果：[Evidence](evidence/SERIES_AFTERCARE_PLACEMENT_INPUT_20261008.md)。Series跨批Facts/Claims与持久化NFO scope进入显式Aftercare命名，拒绝错批/缺scope等输入；评估逐成员比较路径，覆盖同目录改名。8项新增专项、全架构2,279通过/9既有skip/0失败；两批实际Host Owner context原位复原和新目录规划94秒通过。下一段必须验证实际迁移物化、Commit、Settlement及恢复，不能以prepare通过关闭迁移或发布Gate。

2026-10-08 Series实际Placement Case DoR：在正式隔离Host上架E01/E02后，通过Shelf Placement preview/PATCH发布新folderTemplate，以原Target root执行整Entry迁移。验证全部Primary/NFO/poster字节和Episode/Artifact关系、Inventory-Control原子回滚/提交、旧位置Settlement及Case重评估终结；保持正式API/Owner路径，不直接改写业务数据库推进。失败按当前合同定位根因，后续仍须同目录改名、异常恢复与发布平台验证。

2026-10-08迁移Host发现旧健康评估与新Placement发布并发，Owner projection正确拒绝旧Basis但用普通Error使Host记录执行器故障。按既有Foundation executionInputSuperseded合同改为明确输入失效：仍使旧Event/Work失败、保留证据、禁止旧Assessment Commit；由Arca当前Basis重新评估，不增加Foundation业务判断，不屏蔽fixture错误。

2026-10-08同目录改名Host暴露实际数据保护缺陷：Placement Material Receipt将未变化成员也标为requiresSettlement，删除了仍作为当前Inventory的NFO/poster。修复在Arca Receipt投影排除位置/身份均未变成员，同位置替换不结算当前路径，并在实际Settlement入口拒绝当前Inventory位置。保留原失败证据；必须重跑真实Host和相关完整回归，不能以增加等待或重置掩盖。

2026-10-08实际Placement结果：[Evidence](evidence/SERIES_PLACEMENT_CASE_20261008.md)。整季换目录与同目录Primary改名的正式API/Host实际文件闭环分别91.9/92.0秒通过，含事务回滚/Commit、Control和Settlement。旧Assessment改为显式输入失效；Receipt排除未变化材料，Settlement拒绝当前Inventory位置，修复首次同目录场景删除NFO/poster的问题。36项专项和全架构2,281通过/9既有skip/0失败。真实进程中断、跨设备、媒体维修及UI/Linux发布Gate仍开放。

2026-10-08 Series媒体维修计量DoR：沿SSOT §5.5.8与现有保守物理预算公式，将纯N:M字节预算算法从Libra模型提取到共享合同工具，Owner仍各自提供完整源集合。Arca以自身当前Inventory完整Physical Identity/Claims、Binding、Care Basis和revision建立维修空间快照，给出逐成员预算并继续实测逐集验收；拒绝错误摘要和不完整Claims，不跨读Libra。先接现有媒体评估并验证边界，自动维修门禁在逐成员策略/完整输出验证与Commit闭环完成前保留。

2026-10-08媒体维修空间基础结果：[Evidence](evidence/SERIES_CARE_MEDIA_SPACE_20261008.md)。Arca当前Inventory快照与共享纯算术已接通，23项专项及共文件两集真实SQLite/Host通过；预算仍与实际逐集验收分离。下一段贯通逐成员冻结策略/目标、Planner/Effect和完整混合输出验证，再连接原子Commit与恢复；本批不开放自动媒体维修，不关闭运营或发布Gate。

2026-10-08逐成员媒体策略DoR：沿SSOT §8.6.11既有Arca Strategy/结构preflight合同，消除策略构造中隐式读取第一Primary的行为。Series必须显式选择当前Inventory成员，以完整空间快照派生该物理文件预算并核对该成员Probe Evidence；Intent/preflight摘要绑定完整空间Basis、目标Handle及预算，设备选择和质量下限保持原规则。先完成单成员策略引擎及错成员/错Evidence/不可行预算验证，再将多个策略纳入正式Assessment及Planner/Effect；完整链路前保持自动维修门禁，不跨读Libra或执行预试编码。

2026-10-08逐成员策略引擎结果：[Evidence](evidence/SERIES_CARE_MEMBER_STRATEGY_20261008.md)。显式Primary选择/Probe Evidence校验、完整空间Basis摘要和独立物理预算已接通，质量下限按原单集Policy决定；26项专项及全架构2,289通过/9既有skip/0失败。下一段将多个策略冻结进正式Assessment并贯穿逐目标Planner/Effect、完整混合输出终检与原子提交/恢复；尚未启用Series自动媒体维修或完成可部署Gate。

2026-10-08成员Assessment DoR：正式Event Result只有64 KiB，Series不能把整季完整Strategy/Device Snapshot重复嵌入一个Result。沿同一Arca Conformance Capability增加显式materialKey参数与closed memberScope结果，逐成员保存Probe/播放结论和单一Strategy，scope绑定完整空间Basis及物理预算；这些成员证据不充当三维专业Assessment。先贯通有界单成员Capability/schema与专业Commit隔离，再由Planner调度各成员并以完整证据集合摘要生成整季Assessment，后续Case从精确Work重建集合；不放宽Result上限或截断Series成员数，不在完整链路前启用维修。

2026-10-08成员Result基础结果：[Evidence](evidence/SERIES_MEMBER_CONFORMANCE_RESULT_20261008.md)。显式参数、closed成员scope和正式单成员策略Evidence已接通；专业投影/Commit仅消费三个整季维度，37项专项及合同检查通过。下一步须由健康Planner调度完整成员集合、整季结果绑定集合摘要并从同Work精确重建，随后继续逐目标维修/终检/原子提交；当前自动媒体维修门禁保留。

2026-10-08完整成员调度DoR：健康Planner对当前Series全部Primary生成独立Conformance Event，其稳定身份绑定Work Attempt和materialKey；整季Conformance依赖全部成员成功，并只消费同Work/Attempt/Plan的精确成员Result。逐项核对当前空间scope、Result/Envelope摘要，拒绝缺失/重复/错来源，重验当前物理身份后按完整证据集合摘要汇总健康结论。整季Result仅保存集合摘要与数量，单成员策略保留各自Result；不重复Probe或扩张64 KiB存储，不启用未完成维修链路。验证负向集合与正式隔离Host健康检查，再推进Case消费。

2026-10-08完整成员调度结果：[Evidence](evidence/SERIES_MEMBER_ASSESSMENT_SCHEDULING_20261008.md)。24集Plan和精确集合负向验证通过；真实两集Host已由Runtime保存成员Result并重建整季摘要，NFO维修/专业Commit/健康终结与收敛后重开通过。修复public planning registration误传通用Reader，明确使用Arca Aftercare Reader。下一段Case重建冻结策略集合并贯穿逐目标Effect、完整混合输出验收与原子提交/恢复；Series媒体自动维修和整体发布Gate仍未开放。

2026-10-08 Case成员策略消费DoR：将同Owner完整成员证据的纯校验提取为Arca model供观察汇总与规划共用，文件现场Fence继续留在Capability。Case只消费basisInputs冻结的唯一健康Work、正式专业Assessment及requiredEffects对应Finding，重建完整成员集合摘要后按materialKey选择策略；拒绝其他Work/Basis、篡改Requirement、漏成员、错Finding和错策略。先连接策略Projection和负向测试，再生成逐目标维修Plan与Effect；不执行新副作用、不解除自动维修门禁、不读取Libra或把文件I/O放入Planner。

2026-10-08 Case消费结果：[Evidence](evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。目标解析与策略Projection已接通，只选择Case冻结Finding对应成员；纯集合校验移入Arca model，现场Fence仍在Capability。39项专项及分组全架构2,293通过/9既有skip/0失败。下一步逐目标维修Planner与Effect、完整混合输出验收/原子Commit/恢复；自动维修和发布Gate仍未开放。

2026-10-08精确媒体成品绑定：[Evidence](evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。Commit逐项绑定验证Event，经同Work/Attempt/Plan、输入Binding、Handle和Result摘要取唯一生产成品，拒绝错取或歧义。15项专项及分组全架构2,296通过/9既有skip/0失败；逐目标Effect、完整集合终检/原子Commit/恢复仍待完成，自动媒体维修与发布Gate保持开放，未部署NAS。

2026-10-08逐目标维修接线：准备Planner逐成员调度Remux/Transcode与验证，Effect按冻结Case选择原文件，Series输出身份/Remux路径按成员区分，部分输出清理读取精确Plan参数。混合Case计划、入口Fence和真实SQLite/文件清理验证通过；分组全架构2,297通过/9既有skip/0失败。完整物化/集合终检/原子Commit/恢复与真实媒体Host仍待完成，自动媒体维修及发布Gate未开放。[Evidence](evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。

2026-10-08精确媒体物化：Series成品从源Handle摘要匹配唯一冻结Case目标，校验施工意图、Workspace归属与实际字节，回执明确原成员。三个目标实际文件替换、旧文件保护、forward恢复及精确Control变更计算通过；全架构2,297通过/9既有skip/0失败。完整集合终检、正式事务/Claims持久化/Settlement/崩溃恢复及真实媒体Host继续，未开放自动媒体维修或部署NAS。[Evidence](evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。

2026-10-08完整成品集合门禁：Commit Planner和媒体Projection要求全部冻结目标的唯一同Work/Attempt/Plan成品与验证，维修输出和未替换文件共同按N:M规则逐集计量；集合摘要进入VerifiedCareInventoryChange。45项专项及全架构2,300通过/9既有skip/0失败。正式提交前现场复核、事务/Claims/Settlement/崩溃恢复与真实媒体Host继续，自动维修及发布Gate未开放。[Evidence](evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。
