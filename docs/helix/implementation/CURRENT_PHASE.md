# 当前活动包：Series 开发

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
