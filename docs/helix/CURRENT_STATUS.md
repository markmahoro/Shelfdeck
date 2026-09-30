# ShelfDeck 当前状态

更新：2026-10-01。Helix Beta Movie全链路获用户阶段验收，Movie阶段文档收尾及Beta工程清理完成；用户已要求开始Series开发，以Phase工作项管理。UAT只用于上线后的测试、验收问题；原279保留误登记及转移记录，278/280保留历史收尾/清理事实。记录与证据边界见[UAT-278](implementation/evidence/UAT-278_BETA_MOVIE_CLOSEOUT_20260930.md)。Series完整功能尚未交付，未声明新的技术资格总体PASS或正式release tag。

## 最近已记录生产身份

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

2026-09-30用户确认Series按5节点推进，UI遵循现行规范并由UI负责人验收。Master Plan/Phase及AGENTS已记录逐节点门禁；隔离分支补齐主工作区已确认的Playbook §11.1和Beta baseline §7.1，主工作区既有其他用户修改保持。UI负责人已确认职责并回传[验收范围矩阵](implementation/evidence/SERIES_UI_ACCEPTANCE_SCOPE_20260930.md)；具体页面结论仍需同版本实际走查，当前没有Series页面交付或UI PASS。

Series初审及Windows专项测试见[审查Evidence](implementation/evidence/SERIES_READINESS_AUDIT_20260930.md)：13项中12通过、1跳过；跳过项正是Series Handoff A纵向fixture。已有Episode Claim/Run合同基础；TMDB字段、逐Episode NFO及外部落地快照仍有明确缺口，不能直接启用。未执行真实Series E2E或浏览器验收；范围、开发工作项和准备Exit均在[唯一 Phase](implementation/CURRENT_PHASE.md)。

首批Series元数据基础已交付`ea3d33d16d1bb19949f379e36ea648cfafd003a6`：[实现与验证Evidence](implementation/evidence/SERIES_METADATA_FOUNDATIONS_20260930.md)。TMDB显式验证Series/Season tuple与Season响应，支持series_title/season_number；Renderer新增冻结到Season/Episode的episodedetails NFO并保护Related源。Windows两批共103项通过，无失败/跳过，含Movie相关回归。当时尚未接入逐Episode Observation/Draft、Artifact调度；后续进展见下文。Series入口保持阶段限制，不能把旧初审或叶子验证当完整链路结论。

逐集接线已交付`cca63288607aab127edd8e000221c00b373bca7a`：[接线Evidence](implementation/evidence/SERIES_EPISODE_METADATA_WIRING_20260930.md)。Intent/Observation按冻结集范围取资料；Draft/Fact保留typed逐集资料，Artifact Planner及Owner projection生成Season/各集NFO，Verification核验目标覆盖。172项受影响回归及最终12项重叠专项通过，P2通过；不能将两批计数相加。节点1仍未关闭：真实Foundation/Workspace/原生Fact commit、Artifact正式交付关联及普通长Season容量需继续贯通。没有Series UI交付或新生产部署。

原生验证追加`a36b22dab`：实际Workspace文件/Handle、3条Artifact verification、E01/E02 Product Metadata Fact及来源引用保存与重放，Owner写入失败原子回滚和Source Result改写拒绝均通过；相关48项测试通过，最终16文件受影响回归176项通过、0失败/跳过，P2再次通过。计数有重叠，不相加。上游Series身份和完整调度仍未接通，普通长Season容量待验证；节点2还需补Arca Season/Episode正式命名，当前默认NFO映射会碰撞。上述补充取代前段原生Fact commit未覆盖的状态，证据及未测边界见同一Evidence追加。

2026-10-01节点1增量`215af03f5261029410c2d8e8041778ba1396a8dd`：[Series身份与continuity发布](implementation/evidence/SERIES_PRODUCT_IDENTITY_20261001.md)。Series Product Identity的Plan/Owner projection、TV+Season search/exact、closed Intent/Observation和正式Subject identity/continuity事务已接通；native commit/replay、最后head CAS失败回滚、跨Season拒绝及未来Intake匹配查询通过。15文件302项回归通过，生成manifest后44项重叠复验通过，P2通过。仍未验证从Field经Routing/Scheduler到完整Series Run、实际E03追加、长Season容量或Arca正式落位；节点1未关闭，无UI PASS和新部署。

原活动文档及残余队列已冻结到[Movie 收尾快照](implementation/archive/20260930_BETA_MOVIE_CLOSEOUT/SNAPSHOT.md)。隔离分支 `codex/beta-closeout-series` 基于 `ecccf7ba9b`继续开发，最新代码见上述实现提交。主工作区、集成区及其他有未提交修改的工作区保留，修改状态未变化。

UAT-280已完成：[清理证据](implementation/evidence/UAT-280_BETA_WORKSPACE_CLEANUP_20260930.md)。NAS删除60项废弃工程资料（20个tar、21个测试目录、19个备份）及142个旧镜像标签；全部29个容器身份/启动状态未变，保留当前/回退及必要验收镜像、含原媒体和事故恢复备份。本地37个Git worktree退役27个，保留10个；34个旧镜像包、40个测试副本、另2份过时测试数据库及5处退役残余全部清除，本地可用空间较原快照增加约99.7GiB。首次审批拦截已通过明确文件及空目录操作安全完成。37个源码snapshot ref/恢复bundle及1670份必要文件复验通过，三处共享依赖和三个有用户修改的工作区状态保持；无剩余选定待删项。

同日追加只读复查发现首轮Git沿junction清理还影响了主Service及主/集成Web依赖，前次仅恢复SSH工具依赖不完整；续作的metadata保护比较基于首轮之后，不能证明首轮依赖未受影响。现已在三处按各自锁文件`npm ci`补齐，SQLite/Sharp及两处esbuild原生绑定smoke通过，用户修改及锁文件无新增变更；修复后本地净可用空间较原快照增加约98.7GiB。未新增文件删除。另有约0.94GB的UAT-125旧诊断库、约32MB测试包及约1.6MB忽略的构建输出；诊断库仍关联开放项，暂保留，不扩大已关闭280的精确清理范围。

清理阶段未构建或部署新版本、未改动生产业务数据/媒体、未重启服务；未新增功能测试或技术资格PASS。后续Series准备专项测试事实见上文，不改写清理阶段结论。部署集中负责人职责已按用户2026-09-28决定取消，UI负责人职责保留。
