# 当前活动包：Series 开发

更新：2026-09-30。ACTIVE / DEVELOPMENT。用户追加“开始开发吧”，授权Series本地开发、隔离测试及必要构建。上个Movie阶段已按用户接受完成文档收尾；[旧包快照](archive/20260930_BETA_MOVIE_CLOSEOUT/CURRENT_PHASE.md)只用于追溯。唯一计划为[CURRENT_PLAN](../CURRENT_PLAN.md)，本Phase以有名称的工作项、里程碑及Evidence管理开发，不使用UAT编号；UAT只记录上线后的测试、验收问题。原UAT-279保留误登记与转移历史。

用户追加的工程工作区清理已完成；[历史UAT-280执行结果](evidence/UAT-280_BETA_WORKSPACE_CLEANUP_20260930.md)包含本地/NAS精确清理、源码/证据/用户修改保护及工作区退役复验。当前先实施Series元数据基础；整体纵向准备仍有未决项，不能因本工作项开工宣称准备全部Exit。

## 目标、Owner 与边界

准备一个能交付真实剧集完整链路的大版本，继续使用现有五域模块化单体。Procurement 识别 Season 输入与不可变 Candidate；Libra 拥有 Subject、Routing、Run、Acceptance Spec 与生产 Workspace；Arca 拥有正式 Season Shelf Entry、Episode/Inventory、维护及退出。保持 Handoff A/B 单向、只由 On-deck Commit 建立收藏事实。Emby 仍是可选 External Provider。

首版范围沿用SSOT：普通Season文件集、明确的Season/Episode身份、按本批交付范围生产/验收、首次上架及后续非重叠Episode追加；恢复、多集共文件/一集多part、维护和退出也须进入验收，不能用只支持单文件单集掩盖模型边界。当前开发不修改Owner/Handoff/授权边界，不部署生产。

## 当前工作项：Series元数据基础

- Outcome：TMDB以已解析的Series/Season tuple取得Series title及Season Number；受控Sidecar Renderer可按显式冻结Profile生成单集NFO，保护Related源文件。它是本地纵向的组成部分，尚不开放Series产品入口。
- Owner与合同：Platform Integration Adapter只观察外部资料；Libra决定来源、Episode交付范围与Profile，并仅写Workspace。沿用SSOT §5.5.3/§5.5.5、§6.4.7.1及既有MetadataFetchIntent/SidecarProfile/ArtifactHandle，不新增Domain或跨域Store。
- DoR：输入为已有精确resolvedProviderIdentity与有界requestedFields；Sidecar以typedParameters冻结rootElement、Season Number、Episode Number，必须与本集Draft相等。普通Season沿当前positive-number合同；S00、N:M计量及Episode集合的Canonical表示不属于此叶子工作项，不以本实现默默定案。
- Effect/Fence：Provider使用既有IntegrationHandle/Secret Lease、timeout与响应字节上限；Renderer沿用Workspace effect authority、Artifact provenance与受控物理写入。Movie路径保持原冻结输入与行为，不做存量迁移。
- 验证：真实Adapter逻辑配隔离HTTP fixture，正向Series/Season及负向身份/响应/字段/Fence；Episode NFO生成、更新、错误集号与不完整Profile拒绝、源字节保护；现有Movie TMDB/NFO回归。完整Run/Commit、真实媒体及Linux验证在后续纵向Gate执行。

结果：本叶子工作项已实现并完成约定Windows验证，提交`ea3d33d16d1bb19949f379e36ea648cfafd003a6`；两个测试批次共103项通过、0失败、0跳过。[交付Evidence与未测边界](evidence/SERIES_METADATA_FOUNDATIONS_20260930.md)。当前缺口是把逐Episode Observation/Draft及Artifact规划接入冻结Run Manifest；不得用全季一次flat Draft重复生成所有单集NFO。

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
| TMDB已核验Season并返回Series title/Season Number，Renderer支持冻结单集NFO | `media-service/src/helix/integrations/tmdb-provider-adapter.js`、`media-service/src/clean-product-production-port.js` | 当前协调器/Planner尚只生成season.nfo；逐Episode Observation/Draft、Result引用及Artifact调度需正式接入；未传显式Episode范围的Provider查询仍拒绝episode_* |
| 外部寻源/导入存在Series身份分支 | `media-service/src/helix/integrations/h1-provider-adapters.js` | MoviePilot落地快照要求恰好一条视频且Episode claims为空；搜索Episode keys取自请求而非候选实证，不能据此宣称真实剧集覆盖 |

逐入口事实、测试命令及未覆盖项见[准备审查Evidence](evidence/SERIES_READINESS_AUDIT_20260930.md)。已有部分合同基础，但不能直接启用Series。完整差距审查仍需覆盖观察→Triage→Intake→Routing/Spec→各成员生产→Handoff B→Commit→Projection→Aftercare/退出。

## 开发工作项与里程碑草案

以下是Phase内工作名称，不建立全局编号体系；排程按依赖推进，不承诺日期。

| 顺序 | 工作项 / Owner | 验收门槛 | 当前状态 |
| --- | --- | --- | --- |
| 先行 | 合同与接线核查 / 各Domain Owner | 明确S00、N:M空间计量、Episode级恢复及所有主链入口；冻结隔离样本矩阵与各工作项DoR | 初审及专项测试完成；上述合同/纵向核查待补 |
| 首个交付 | 本地Season最小纵向 / Procurement、Libra、Arca | E01/E02从Field到唯一Season Entry；每集身份/元数据/NFO/Primary覆盖、正式Handoff及Commit；恢复Handoff A测试；真实媒体验收 | 元数据基础已本地验证；接续逐集Observation/Artifact与真实Run接线，各工作项先满足DoR |
| 接续 | Episode追加与复杂映射 / Libra、Arca | E03新增Run扩充同一Entry，旧Run/集事实不改写；重叠/并发/重复及N:M、逐集空间验收通过 | 依赖首个交付 |
| 扩展 | 外部寻源、生命周期与界面 / Procurement、Libra、Arca、UI负责人 | 外部候选/落地实际Episode覆盖；缺元数据、失败/重启、Aftercare及共享材料退出；Season用户旅程走查 | 依赖对应纵向能力与UI协调 |
| 发布资格 | Movie回归与Series完整资格 / 实施与发布责任方 | 冻结SHA的Windows及Linux适用验证、真实媒体/浏览器场景、受控升级/回退及数据保护 | 前述工作项完成后执行 |

## 下一步与Phase完成条件

1. 在上述入口及直接依赖中核对每段真实接线，逐段记录已实现、需补接线、合同缺口和验证缺口；复核S00、身份纠正、N:M大小计量及Episode级失败/重试范围。已有决定按SSOT执行，真正新合同分叉才向用户提交具体方案。
2. 准备隔离测试manifest和样本：首批E01/E02、再到E03、多Season同名、重叠/重复、无claim/多义、缺元数据、E01–E02合并、多part、单集失败、进程退出、空间不足、共享Artifact与退出。真实媒体只用获授权副本；不把生产素材当可破坏fixture。
3. 固定首版验收矩阵及Owner/输入输出/revision/幂等/Effect/Fence/恢复条件，补齐上表工作项DoR与验证入口；版本开发全过程不分配UAT编号。
4. 每个开发工作项满足Playbook Definition of Ready后实施。保持恰好一个活动Phase；本包Exit后冻结到archive再切换，不另建Series活动计划。

Phase Exit须完成适用逐段差距/合同、样本矩阵及本地Season纵向工作项的完整验收；不能用首批叶子能力测试通过关闭完整Phase。原UAT-279仅保留转移记录，Phase进度不在该行更新。本轮不声称UI验收或生产剧集支持。
