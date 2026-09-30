# 当前活动包：Series 开发

更新：2026-10-01。ACTIVE / DEVELOPMENT。用户追加“开始开发吧”，授权Series本地开发、隔离测试及必要构建。上个Movie阶段已按用户接受完成文档收尾；[旧包快照](archive/20260930_BETA_MOVIE_CLOSEOUT/CURRENT_PHASE.md)只用于追溯。唯一计划为[CURRENT_PLAN](../CURRENT_PLAN.md)，本Phase以有名称的工作项、里程碑及Evidence管理开发，不使用UAT编号；UAT只记录上线后的测试、验收问题。原UAT-279保留误登记与转移历史。

用户追加的工程工作区清理已完成；[历史UAT-280执行结果](evidence/UAT-280_BETA_WORKSPACE_CLEANUP_20260930.md)包含本地/NAS精确清理、源码/证据/用户修改保护及工作区退役复验。当前先实施Series元数据基础；整体纵向准备仍有未决项，不能因本工作项开工宣称准备全部Exit。

## 目标、Owner 与边界

准备一个能交付真实剧集完整链路的大版本，继续使用现有五域模块化单体。Procurement 识别 Season 输入与不可变 Candidate；Libra 拥有 Subject、Routing、Run、Acceptance Spec 与生产 Workspace；Arca 拥有正式 Season Shelf Entry、Episode/Inventory、维护及退出。保持 Handoff A/B 单向、只由 On-deck Commit 建立收藏事实。Emby 仍是可选 External Provider。

首版范围沿用SSOT：普通Season文件集、明确的Season/Episode身份、按本批交付范围生产/验收、首次上架及后续非重叠Episode追加；恢复、多集共文件/一集多part、维护和退出也须进入验收，不能用只支持单文件单集掩盖模型边界。当前开发不修改Owner/Handoff/授权边界，不部署生产。

## 当前工作项：Series身份与逐集生产接线

2026-10-01接续「Series身份解析与continuity发布」：沿SSOT §3.4.2、§5.5.3及ResolvedProductIdentity合同，以冻结IdentityClaim的显式positive Season Number、Run execution basis和已有Related/Provider source Work形成closed Series身份Observation；TMDB search/exact必须验证TV对象及对应Season存在。Libra正式Fact保留相同Series/Season tuple，并在同一Domain Fact Commit发布provider_season_identity relation、Subject continuity set及head，不能追溯改写旧Intake或猜测合并。验证覆盖HTTP/typed schema、错误Season/对象/关联、完整Result引用、原生commit/replay/crash rollback与未来Intake匹配。无新Owner、Capability、Handoff或生产副作用；本工作项仍不开放Series页面，manual disambiguation界面后续交UI负责人验收。

- Outcome：以已解析Series/Season tuple和冻结Run交付集形成各集Observation/Draft/Fact，正式Artifact Planner与Sidecar Renderer生成Season及逐集NFO，保持独立Provenance和Related源保护；贯通实际Workspace与Fact事务后接续上游身份和完整调度。尚不开放Series产品入口。
- Owner与合同：Platform Integration Adapter只观察外部资料；Libra决定来源、Episode交付范围与Profile，并仅写Workspace。沿用SSOT §5.5.3/§5.5.5、§6.4.7.1及既有MetadataFetchIntent/SidecarProfile/ArtifactHandle，不新增Domain或跨域Store。
- DoR：输入为已有精确resolvedProviderIdentity与有界requestedFields；Sidecar以typedParameters冻结rootElement、Season Number、Episode Number，必须与本集Draft相等。普通Season沿当前positive-number合同；Episode scope使用closed canonical key/数字tuple并与Spec/Manifest逐项相等。S00、N:M计量不以本实现默默定案。
- Effect/Fence：Provider使用既有IntegrationHandle/Secret Lease、timeout与响应字节上限；Renderer沿用Workspace effect authority、Artifact provenance与受控物理写入。Movie路径保持原冻结输入与行为，不做存量迁移。
- 验证：真实Adapter逻辑配隔离HTTP fixture，正向Series/Season及负向身份/响应/字段/Fence；Episode NFO生成、更新、错误集号与不完整Profile拒绝、源字节保护；现有Movie TMDB/NFO回归。完整Run/Commit、真实媒体及Linux验证在后续纵向Gate执行。

结果：元数据基础叶子已实现，提交`ea3d33d16d1bb19949f379e36ea648cfafd003a6`；两批Windows103项通过，见[原Evidence](evidence/SERIES_METADATA_FOUNDATIONS_20260930.md)。后续逐集接线提交`cca63288607aab127edd8e000221c00b373bca7a`：Intent/Observation按冻结Episode scope隔离，Draft/Fact保留逐集typed集合，Planner/Owner projection/Renderer生成Season及各集NFO，Verification拒绝重复目标代替缺集；172项受影响回归及最终12项重叠专项通过，P2合同通过，见[接线Evidence](evidence/SERIES_EPISODE_METADATA_WIRING_20260930.md)。节点1仍需真实Foundation/Workspace链、原生Series Fact commit及Artifact正式交付关联验证；Source Basis现有16 Observation及字节容量需覆盖普通长Season。本批未改变用户界面或部署生产。

追加原生验证`a36b22dab`：真实SQLite/Work Result Reader/Workspace写入/Artifact Registry/Fact事务的3条Artifact与E01/E02资料重放、失败回滚、Source Result改写Fence通过；相关48项及最终受影响回归176项通过、0失败/跳过，P2再次通过。Source Work/Plan/Event仍为固定边界种子，ResolvedIdentity仍为注入fixture，不能替代正式身份解析和Scheduler完整Run。节点1当前继续补上游Series身份链及长Season容量；节点2已确认默认NFO命名碰撞，按Arca正式布局处理，不能更改“只有Primary携带Episode relation”合同。详见同一[接线Evidence追加](evidence/SERIES_EPISODE_METADATA_WIRING_20260930.md)。

本批Series Product Identity交付`215af03f5261029410c2d8e8041778ba1396a8dd`：[身份与continuity Evidence](evidence/SERIES_PRODUCT_IDENTITY_20261001.md)。正式Planner在两个Owner input绑定冻结Season，Provider search/exact验证TV+Season，Related NFO只形成claim；原生Fact事务同时发布Subject身份、continuity relation/set digest/head，支持exact replay与最后CAS失败全回滚。未来Intake查询及E03的既有身份projection通过，但不等于实际追加准入/上架。最终15文件302项回归及生成manifest后的44项重叠复验通过，P2无findings。节点1继续Routing、完整调度及长Season容量验证；无Series页面交付、无生产部署。

## 已确认合同与首版验收方向

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
| 节点1 | 剧集资料与生产基础 / Platform、Libra | 明确Season/Episode身份，逐集Observation/Draft/NFO/Artifact按冻结Run范围生产，完整Result与Provenance链 | 逐集生产、Series Product Identity及原生Workspace/Fact事务已验证；Routing、完整调度及长Season容量待贯通，节点未关闭 |
| 节点2 | 首批剧集完整上架 / Procurement、Libra、Arca | E01/E02从Field到唯一Season Entry；正式Handoff/Commit、真实媒体及相应用户路径；UI负责人验收可见变化 | 依赖节点1及适用合同/fixture门禁 |
| 节点3 | 持续追加与复杂文件映射 / Libra、Arca | E03扩充同Entry，旧Run/集事实不改写；重叠/并发/重复及N:M、逐集空间验收；可见变化交UI负责人验收 | 依赖节点2 |
| 节点4 | 完整运营与用户体验 / Procurement、Libra、Arca、UI负责人 | 外部实际Episode覆盖、失败/重启、Aftercare/共享材料退出；Season用户旅程、适用状态及UI负责人验收 | 依赖对应纵向能力 |
| 节点5 | Movie回归与Series发布资格 / 实施、UI与发布责任方 | 冻结SHA的Windows/Linux、真实媒体/浏览器、升级/回退及数据保护；UI验收结论绑定最终受影响版本 | 前述节点完成后执行 |

S00、身份纠正、N:M计量及Episode级恢复在所属节点开工前核对SSOT并满足DoR，不把未知合同藏进实现，也不以节点编号另建全局台账。

UI门禁适用于每个节点，包括后端生成的用户可见文案：实施前与任务“UI负责人”（`01a0912a-0086-74e2-88ab-536c59d3862a`）协调范围及设计；按Playbook §11.1/§12.3与Movie baseline §7.1的通用UI验收方法实现。沿用现有页面、组件/token和已确认设计规则；Series业务Oracle来自SSOT，不把Series追认进Movie Beta。

实施任务提供对应commit、页面/状态、操作与结果、截图或轨迹、浏览器/键盘/窄屏测试和未测项；UI负责人执行适用任务走查并记录通过/不通过及范围。UI代码或自动化测试通过不能替代负责人验收，后续影响用户表面的diff须重验受影响路径。没有适用UI变化时如实记录范围；当前叶子实现尚无Series页面交付，不宣称UI PASS。2026-09-30 UI负责人已确认职责并回传[逐节点适用矩阵](evidence/SERIES_UI_ACCEPTANCE_SCOPE_20260930.md)；具体页面验收仍待同版本实现与实际走查。

## 下一步与Phase完成条件

1. 在上述入口及直接依赖中核对每段真实接线，逐段记录已实现、需补接线、合同缺口和验证缺口；复核S00、身份纠正、N:M大小计量及Episode级失败/重试范围。已有决定按SSOT执行，真正新合同分叉才向用户提交具体方案。
2. 准备隔离测试manifest和样本：首批E01/E02、再到E03、多Season同名、重叠/重复、无claim/多义、缺元数据、E01–E02合并、多part、单集失败、进程退出、空间不足、共享Artifact与退出。真实媒体只用获授权副本；不把生产素材当可破坏fixture。
3. 固定首版验收矩阵及Owner/输入输出/revision/幂等/Effect/Fence/恢复条件，补齐上表工作项DoR与验证入口；版本开发全过程不分配UAT编号。
4. 每个开发工作项满足Playbook Definition of Ready后实施。保持恰好一个活动Phase；本包Exit后冻结到archive再切换，不另建Series活动计划。

Phase Exit须完成适用逐段差距/合同、样本矩阵及本地Season纵向工作项的完整验收；不能用首批叶子能力测试通过关闭完整Phase。原UAT-279仅保留转移记录，Phase进度不在该行更新。本轮不声称UI验收或生产剧集支持。
