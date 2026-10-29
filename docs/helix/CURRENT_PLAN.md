# ShelfDeck 当前计划

2026-10-29 用户确认：电影自定义 Spec、US Adult 演员识别与自动建档和积压修复均纳入同一次交付。顺序为先诊断五条未明原因并确定必要增量，再完成本轮既有功能，之后安全停机、Fresh-generation Formation Reset、标准部署新版本。旧未入藏任务无跨迭代兼容或逐条自愈义务；原七条逐项重试计划退役，不能把 Reset 当作新任务缺陷修复。用户已授权本次生产 Reset 与升级，并明确不再等待真实 CIFS 资格或 NAS 低 I/O；未实测范围如实记录，停止态精确范围、保护及标准备份/发布入口仍执行。本轮不恢复定时观察。

五条只读诊断新增两项直接相关工作：`TMDB-ALIAS-TYPE-BOUND` 修复真实来源的无业务用途 type 字段误拦截；`JAV-SOURCE-FAILURE-DIAGNOSTICS` 保留安全、有限的来源失败阶段与状态。两项均不迁移或恢复旧任务；其他项目不因额外假设扩张。当前实施与证据见唯一活动 Phase。

更新：2026-10-29。用户指定本线程负责本轮计划追踪、跨线整合、最终门禁与生产发布，并同意恢复现有演员、电影、剧集和 UI 线程并行；不恢复定时轮询。Series 候选与其他功能最终共同交付。仅 implementation/CURRENT_PHASE.md 是活动集成执行包，不新增平行活动计划。既有代码、未提交工作、首跑失败、测试及生产证据全部承接。

## 本轮阶段与依赖

| 阶段 | 交付范围 | 退出门槛 | 当前状态 / 前置 |
| --- | --- | --- | --- |
| Phase 1：BUFFALO-CATALOGUE-FEASIBILITY | 在 ShelfDeck Linux Docker 技术边界内，按固定 Sense 2 方法完成图片检测/对齐/512维特征、官方离线目录检索及自建参考图样本匹配；不接自动建档或视频业务。 | 固定模型/预处理/数据包与原生索引兼容；与同输入 Sense 基准的人脸/候选/距离对照通过；内存/控制面响应/取消与依赖复用条件有证据。失败明确阻断后续识别实现，不降低标准换取通过。 | **有限技术PASS / 已Exit**，见归档和Evidence；不是视频或发布资格。 |
| Phase 4：BUFFALO-VIDEO-IDENTIFICATION | 统一 buffalo_l 后的视频有界抽帧/补采、聚类/频次、离线目录与自建Reference备用、单演员选择、资源控制和目录更新；不创建人物。 | 多演员/歧义/无脸负例；性别不影响资格和排序；真实视频冷/热/1080/4K/SMB/停止取消及控制面资源资格；确定版本化策略及样本范围。 | **原演员线程推进，其他生产修复并行。** 用户已取消性别筛选；尚未正式接线，不能以单图PASS替代。 |
| Phase 5：PEOPLE-AUTOMATION-AND-RETIREMENT | 识别姓名至People唯一复用/TPDB资料/截图兜底建档，Libra单演员出演；原人工入口保留；完整退役推荐人脸认领。 | 新/已有/同名/无TPDB/无图/故障/并发/重启/人工先行的真实Host至正式Commit旅程；统一buffalo_l Reference发布/更新和保留依赖，旧Claim责任停止态预检；具体UI交互验证。 | **演员线程继续Phase 4→5。** 姓名规则和推荐退役已有增量复用；正式闭环尚未完成，不保留SFace备用。 |
| Phase 2：FORMATION-DEFECT-CLOSURE | 剧集发布根因、三部电影外部候选身份可靠性、精确同集剧情补充、季海报复用及JAV长名处理。 | 各项新任务根因独立闭合，适用Host旅程和来源、正式文件保护负例；三部电影不以统一错误码或一处解析修复代替逐项证据。 | **Series切片已入独立候选，JAV长名正式接线尚未完成。** 旧七条逐项恢复退役，Reset不代替新任务根因修复；最终合版门禁未完成。 |
| Phase 3：CUSTOM-ACCEPTANCE-LIFECYCLE | 标准/瑕疵/用户自定义三层目标，真实差距建议、Preview/确认、旧Run/Offer收尾、新Run、生产/Conformance/NFO、Arca/Aftercare/保留、API/UI。 | 真实确认至新Run至唯一Commit闭环；重放/崩溃/人工目标变化/恢复标准及基线变化不陷入旧custom Head；跨Owner/部分交接负例完整。 | **电影/目标线程并行承接。** 18个原未提交文件已校验复制，原件保留；不混淆寻源身份缺陷与用户改标准，不开放半成品。 |
| Phase 6：INTEGRATED-RELEASE-AND-ACCEPTANCE | 固定整合候选、Linux镜像/完整架构/Service/Web、具体版本UI负责人、停止态副本/收藏文件与历史保护、Fresh Reset及标准部署。 | 按Phase 2/3/5完成同版功能；停止态预检、校验冷备及Reset保留依赖；用户已跳过真实CIFS资格，未测风险如实记录。 | **主线程统一整合/发布。** 安全停机、Reset和升级已有用户授权；版本尚未具备执行条件。 |

Phase 4→5仍有依赖；Phase 2/3并行开发，最终统一发版。任何模型/数据/方法变化仍须复核受影响的Phase 1资格。

## 并行责任与整合

| 执行线程 | 责任 | 代码与副作用边界 |
| --- | --- | --- |
| ShelfDeck 本轮整合与生产交付（本线程） | 唯一计划/合同/生成物、跨线整合、Reset准备、最终门禁与发布 | 主整合分支codex/round-integration-20261029；保护其他线程及现有暂存工作 |
| ShelfDeck 演员识别与自动建档 | Phase 4→5演员识别和自动建档 | 自有worktree；Store检查点2f9fc0702已提交，Linux19项通过但正式Host及Phase Exit未完成；原Phase 3的18文件由电影线程承接 |
| ShelfDeck 生产待处理条目分诊 | 已完成生产快照、分诊及JAV路径原型 | 本轮未重新启动；生产保持只读，不重试旧任务 |
| ShelfDeck 剧集上架与自愈修复 | 核对新Series任务，承接JAV新Decision的长名正式实现 | 独立开发，不修改主整合或本线程Series候选工作区，不操作生产 |
| ShelfDeck 电影寻源与自定义标准 | 电影候选可靠性、三层Spec完整生命周期，承接18文件增量 | 独立分支codex/movie-spec-parallel-20261029，自f24164ae0起；不写主整合目录或Series发布逻辑 |
| UI负责人 | 提前复核体积与瑕疵对话框；最终对固定合版复核 | 提前复核不等于最终版本资格；不修改主线程源码 |

## 生产分诊新增工作项

| 工作项 | 责任与当前状态 |
| --- | --- |
| ARCA-PATH-COMPONENT-BUDGET | HALT-094、EMLB-094的UTF-8目录/正式名/临时后缀超限；用户已授权主动截断，已有未接线的预览原型。剧集线程承接新JAV Decision正式实现；旧未入藏状态按本轮Reset处理。 |
| US-SIZE-DEFECT-PREVIEW | 后端及对话框修复已入独立候选`b7a03bb48`、`2a58c1606`，Linux服务56项、Web 15项及构建通过；最终合版与具体版本UI资格仍开放。 |
| SERIES-PRESENTATION-EXPANSION | 13个共享build、15个Season Subject为历史快照；修复新任务共用根因，旧任务按Reset处理，不逐条重试。 |

分诊事实和具体边界见[整合Evidence](implementation/evidence/PRODUCTION_TRIAGE_INTEGRATION_20261029.md)；人工身份/演员待决及其他来源故障不并作同一缺陷。

单一SSOT、CURRENT_PLAN、CURRENT_PHASE及全局生成物仅本线程修改；其他线程输出专属Evidence/合同需求，无第二活动计划。NAS重型任务由本线程统筹。用户已授权本轮Fresh Reset和升级；按停止态预检、完整校验冷备及保护依赖执行，不逐条重试旧任务。

Phase 1资格与保护见[完整Evidence](implementation/evidence/BUFFALO_CATALOGUE_FEASIBILITY_20261029.md)，[原Phase 1包](implementation/archive/BUFFALO_CATALOGUE_FEASIBILITY_20261029.md)已冻结。11图像场景、5项数学、5组Reference/5空槽及补充8负例通过；不据此关闭真实视频/演员业务或原遗留问题。

## 新增核心功能的共同验收目标

2026-10-29实施检查点：Phase 4新typed Catalogue Basis及Service内置CPU/目录/代表图模块已落地，固定数据Linux54项与4组真实目录对照通过。仍须将这些模块接入Libra正式Work、持久Artifact、补采/停止恢复及资源准入，再完成独立视频业务资格；Phase 4尚未Exit，随后接Phase 5的顺序不变。不会把模块级对照当作自动建档、正式出演或发布通过。

Phase 4/5共同交付：一部真实影片经受控读取、有界抽帧、人脸分组、离线目录识别及单演员选择，进入People唯一复用/建档、Libra出演确认，最后沿正式生产/Arca验收到唯一On-deck Commit；验证演员资料/NFO/海报和所确认Person一致。Phase 4单独通过只代表视频识别及策略资格，必须Phase 5业务闭环通过才可宣称本项核心功能打通。

按既有决定，一片只确认一位演员；A/B均可靠识别时可按稳定规则选一位，不新增多演员建模。2026-10-29用户取消性别筛选：男性、女性及性别缺失/冲突不影响资格、排名或单独进入人工；身份可靠性和独立时间覆盖仍需验证。身份歧义、库无匹配、停止/重启、人工选择竞争继续验收。模型/索引/采样资源仍受既有Runtime门禁，零整片上传、不引入独立服务。

## 已确定模型及部署边界

本轮主目录识别、自建Reference生成和本地备用统一 buffalo_l；按固定 Stash Sense 2 的检测/对齐/预处理/归一化/检索方法验证，不能只换权重或把旧128维特征补成512维。Mirex仅是用户询问后查到的历史事实，不是参考设计、实现来源或兼容目标。Sense是对照/数据来源，不是生产依赖；Linux Docker内置，不引入Worker、独立Sense/Stash/Python/FastAPI服务，不上传/复制整片。

用户已确认仅自用NAS、不对外分发模型/数据；后续模型/目录按本地校验资源安装，不构造包含这些资源的对外镜像，保留上游使用条件。

人物仍用内部personId，People建档、Libra出演决定、Arca收藏/纠错的Owner不变。正式采用新Model Ref后，不运行SFace备用或混合查询；已有人物原图与不可变历史保留，正式Reference重建/发布及停止态更新方案由Phase 5/6验证，不在Phase 1修改生产Reference。

## 现有基线、保护与不在本轮的事项

- 此前业务功能检查点为966b57802（旧Offer关闭及精确迟到身份守卫）；Phase 1独立资格见本次Evidence及其提交，未改这些业务行为；source-26/27定向Linux证据不等于最终候选。自定义目标Run接续等未提交文件保持，进入Phase 3审查，不丢弃或提前记PASS。
- 季图复用、精确剧情、姓名查询、推荐退役及第三层目标已有实现/局部资格按各项证据承接。三部电影候选可靠性不因做种数解析修复自动关闭。
- 本轮已授权Fresh Reset；它不掩盖新任务缺陷。高达/凡人歌生产验收等待自然采购，不强制调度。
- 4K忙载吞吐和Reset后启动风暴继续延后；Phase 4测4K识别资源不扩展为转码吞吐修复。取消的自动观察不恢复。
- Linux Docker唯一交付；不增加Windows/Electron门禁。混合层UI仍按Playbook执行具体版本负责人验收。
- 固定同版候选后执行适用门禁、停止态预检、校验备份、Fresh Reset及标准部署；保留收藏、来源/正式文件、配置和历史Evidence。真实CIFS未测风险须明确记录。

## 当前入口和历史承接

- 架构：TOP_DOWN_ARCHITECTURE_CONFIRMATION.md；工程治理：ENGINEERING_PLAYBOOK.md。
- 唯一活动包：[Phase 4](implementation/CURRENT_PHASE.md)；当前事实：[CURRENT_STATUS](CURRENT_STATUS.md)。
- [本轮重排前冻结检查点](implementation/evidence/ROUND_REPLAN_BASELINE_20261029.md)保留原Master Plan与混合Phase全部原文；它不是另一份活动计划，也不代表旧Phase验收关闭。
- 历史Movie/Series/JAV阶段及既有UAT状态继续按原Evidence/台账逐项判断，不新增UAT编号、不批量关闭或用本轮覆盖既有验收条件。
