# ShelfDeck 当前计划

更新：2026-10-29。用户要求把本轮按可验收阶段拆开，先消除 buffalo_l 内置识别的技术不确定性。仅 implementation/CURRENT_PHASE.md 是活动执行包；下表是总路线，不为未来阶段另建活动计划。既有代码、未提交工作、首跑失败、测试及生产证据全部承接，不因重排宣称已完成或重做。

## 本轮阶段与依赖

| 阶段 | 交付范围 | 退出门槛 | 当前状态 / 前置 |
| --- | --- | --- | --- |
| Phase 1：BUFFALO-CATALOGUE-FEASIBILITY | 在 ShelfDeck Linux Docker 技术边界内，按固定 Sense 2 方法完成图片检测/对齐/512维特征、官方离线目录检索及自建参考图样本匹配；不接自动建档或视频业务。 | 固定模型/预处理/数据包与原生索引兼容；与同输入 Sense 基准的人脸/候选/距离对照通过；内存/控制面响应/取消与依赖复用条件有证据。失败明确阻断后续识别实现，不降低标准换取通过。 | **有限技术PASS / 已Exit**，见归档和Evidence；不是视频或发布资格。 |
| Phase 2：FORMATION-DEFECT-CLOSURE | 7条剧集发布自愈/人工重试、三部电影外部候选身份可靠性、精确同集剧情补充、季海报复用。 | 各项根因和范围独立闭合，新任务及失败恢复真实 Host 旅程通过，SMB/来源与正式文件保护负例；三部电影不以统一错误码/一处解析修复代替逐项证据。 | **下一活动 Phase，待开始。** 已有局部实现/定向Linux证据复用；生产验收留Phase 6，不靠Reset收口。 |
| Phase 3：CUSTOM-ACCEPTANCE-LIFECYCLE | 标准/瑕疵/用户自定义三层目标，真实差距建议、Preview/确认、旧Run/Offer收尾、新Run、生产/Conformance/NFO、Arca/Aftercare/保留、API/UI。 | 真实确认至新Run至唯一Commit闭环；重放/崩溃/人工目标变化/恢复标准及基线变化不陷入旧custom Head；跨Owner/部分交接负例完整。 | 已有提交与未提交增量保留；新Run接续重放等缺口继续，不依赖 Phase 1。不可提前开放半成品入口。 |
| Phase 4：BUFFALO-VIDEO-IDENTIFICATION | 统一 buffalo_l 后的视频有界抽帧/补采、聚类/频次、离线目录与自建Reference备用、单演员选择、资源控制和目录更新；不创建人物。 | 多演员/男演员/未知性别/歧义/无脸负例；真实视频冷/热/1080/4K/SMB/停止取消及控制面资源资格；确定版本化策略及样本范围。 | **必须 Phase 1 PASS。** 性别与抽样/阈值是待验证设计；不可用旧单图PASS代替。 |
| Phase 5：PEOPLE-AUTOMATION-AND-RETIREMENT | 识别姓名至People唯一复用/TPDB资料/截图兜底建档，Libra单演员出演；原人工入口保留；完整退役推荐人脸认领。 | 新/已有/同名/无TPDB/无图/故障/并发/重启/人工先行的真实Host旅程；统一buffalo_l Reference发布/更新和保留依赖，旧Claim责任停止态预检；具体UI交互验证。 | **必须 Phase 4 PASS。** 姓名规则和推荐退役已有增量复用；不保留SFace备用，不恢复Mirex架构或代码。 |
| Phase 6：INTEGRATED-RELEASE-AND-ACCEPTANCE | 固定整合候选、Linux镜像/完整架构/Service/Web、具体版本UI负责人、停止态副本/收藏文件与历史保护、发布材料及逐项生产验收。 | Phase 2/3/5均闭合；完整门禁/可审查发布与回退材料，最终明确授权范围后标准部署；生产真实结果与残余分别记录。 | 等待前置。已完成容量清理不重复，禁止把计划重排解释为部署/Reset/改库/删媒体授权。 |

Phase 1有限技术门槛已通过并Exit，当前准备Phase 2，尚未启动其新增实施；后续按2→3→4→5→6推进。若 Phase 1 未通过，只阻断其下游 Phase 4/5 及包含它们的整轮发布，不阻断独立的 Phase 2/3；可在冻结未通过证据和更新唯一活动包后切换独立工作，不并行建立第二个活动 Phase，也不能把模型目标悄悄降级为另一种部署方式。

Phase 1资格与保护见[完整Evidence](implementation/evidence/BUFFALO_CATALOGUE_FEASIBILITY_20261029.md)，[原Phase 1包](implementation/archive/BUFFALO_CATALOGUE_FEASIBILITY_20261029.md)已冻结。11图像场景、5项数学、5组Reference/5空槽及补充8负例通过；不据此关闭真实视频/演员业务或原遗留问题。

## 已确定模型及部署边界

本轮主目录识别、自建Reference生成和本地备用统一 buffalo_l；按固定 Stash Sense 2 的检测/对齐/预处理/归一化/检索方法验证，不能只换权重或把旧128维特征补成512维。Mirex仅是用户询问后查到的历史事实，不是参考设计、实现来源或兼容目标。Sense是对照/数据来源，不是生产依赖；Linux Docker内置，不引入Worker、独立Sense/Stash/Python/FastAPI服务，不上传/复制整片。

用户已确认仅自用NAS、不对外分发模型/数据；后续模型/目录按本地校验资源安装，不构造包含这些资源的对外镜像，保留上游使用条件。

人物仍用内部personId，People建档、Libra出演决定、Arca收藏/纠错的Owner不变。正式采用新Model Ref后，不运行SFace备用或混合查询；已有人物原图与不可变历史保留，正式Reference重建/发布及停止态更新方案由Phase 5/6验证，不在Phase 1修改生产Reference。

## 现有基线、保护与不在本轮的事项

- 此前业务功能检查点为966b57802（旧Offer关闭及精确迟到身份守卫）；Phase 1独立资格见本次Evidence及其提交，未改这些业务行为；source-26/27定向Linux证据不等于最终候选。自定义目标Run接续等未提交文件保持，进入Phase 3审查，不丢弃或提前记PASS。
- 7条恢复、季图复用、精确剧情、姓名查询、推荐退役及第三层目标已有实现/局部资格按各项证据承接。三部电影候选可靠性不因做种数解析修复自动关闭。
- 本轮容量整理已完成；不再次Reset掩盖新缺陷。高达/凡人歌生产验收等待自然采购，不强制调度。
- 4K忙载吞吐和Reset后启动风暴继续延后；Phase 4测4K识别资源不扩展为转码吞吐修复。取消的自动观察不恢复。
- Linux Docker唯一交付；不增加Windows/Electron门禁。混合层UI仍按Playbook执行具体版本负责人验收。
- 本轮当前不执行生产操作。部署/数据处置须按最新精确授权和可审查范围，不把历史部署授权泛化；保留收藏、来源/正式文件、配置、历史Evidence。

## 当前入口和历史承接

- 架构：TOP_DOWN_ARCHITECTURE_CONFIRMATION.md；工程治理：ENGINEERING_PLAYBOOK.md。
- 唯一活动包：[Phase 2，待开始](implementation/CURRENT_PHASE.md)；当前事实：[CURRENT_STATUS](CURRENT_STATUS.md)。
- [本轮重排前冻结检查点](implementation/evidence/ROUND_REPLAN_BASELINE_20261029.md)保留原Master Plan与混合Phase全部原文；它不是另一份活动计划，也不代表旧Phase验收关闭。
- 历史Movie/Series/JAV阶段及既有UAT状态继续按原Evidence/台账逐项判断，不新增UAT编号、不批量关闭或用本轮覆盖既有验收条件。
