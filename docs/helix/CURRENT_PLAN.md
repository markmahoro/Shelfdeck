# ShelfDeck 当前计划

更新：2026-10-08。用户已接受Helix Beta Movie全链路阶段成果，并明确开始Series大版本开发。阶段收尾证据为[UAT-278](implementation/evidence/UAT-278_BETA_MOVIE_CLOSEOUT_20260930.md)；唯一活动执行包为[CURRENT_PHASE](implementation/CURRENT_PHASE.md)。不分配新版本名称或Git release tag。

## 范围与顺序

| 顺序 | 结果 | 入口与门禁 |
| --- | --- | --- |
| 已完成 | Movie 阶段文档收尾、用户验收记录、生产基线与历史归档 | UAT-278；保留未关闭 UAT，不新增技术资格总体 PASS |
| 已完成 | Beta 工程工作区和废弃副本清理 | UAT-280；选定本地/NAS目标完成，源码、用户修改及必要恢复资料保留 |
| 节点1 / 当前 | 剧集资料与生产基础 | 实际Field→Routing/Spec→身份/逐集资料/Workspace/Fact、多成员Direct/Package及隔离Arca Commit已贯通；逐成员调度/完整终检与受控Direct+Remux混合上架已验证，真实Transcode等仍待完成，节点未关闭 |
| 节点2 | 首批剧集完整上架 | 隔离E01/E02从Field到唯一Season Entry已通过；真实Series媒体及用户场景验收待完成 |
| 节点3 | 持续追加与复杂文件映射 | 隔离E03追加/并发、旧集保护及Direct N:M逐集空间已验证；加工映射与完整恢复/运营待验证 |
| 节点4 | 完整运营与用户体验 | 外部寻源、恢复、Aftercare/退出及剧集用户旅程；UI负责人验收 |
| 节点5 | Movie回归与Series发布资格 | 冻结SHA的Windows/Linux、真实媒体/浏览器、升级/回退及数据保护，沿用正式发布入口 |

Series 范围从 SSOT §3.2.6、§3.4.2–3.4.5、§4.4–4.5、§5.3.5、§5.5.3–5.5.8、§6.2.3、§6.5 及 §9.4 派生。首版范围草案及尚需审查的细节见 Phase；没有新 Owner、全局媒体 ID 或独立 Series Runtime。Movie-only Beta 基线继续作为 Movie 回归 Oracle。

2026-09-30用户确认按上述5节点推进。每个节点分别记录实现、业务/技术验证及适用UI验收；涉及界面或后端展示文案的节点必须按既有UI规范，由UI负责人对具体版本验收后才能关闭，不把UI验收集中拖到节点4或发布前。开发节点及过程缺口均由Phase管理，不分配UAT编号。

## Movie 残余维护

2026-09-30用户追加的UAT-280清理已完成：[结果与保护验证](implementation/evidence/UAT-280_BETA_WORKSPACE_CLEANUP_20260930.md)。NAS60项废弃工程资料和142个旧镜像标签、本地34个旧镜像包、40个测试副本、另2份过时测试数据库及5处退役残余均已清理；37个Git worktree退役27个，保留10个有当前开发/用户修改/未完成验收/UI/历史非Movie职责的工作区。递归命令曾被拦截，后续审批通过的明确文件及空目录操作完成剩余清理。源码及必要恢复证据保留，继续Series Phase准备。

已有未关闭上线后问题继续由[UAT 总表](UAT_ITERATION_REGISTER.md)管理，按自身证据验收；不重开已有关闭项，不以阶段接受批量关单。先刷新事实，区分仍复现缺陷、缺少验收和历史处置。若涉及媒体安全、恢复或收藏事实，先解决依赖，再发布受影响的 Series 增量；不影响的准备工作继续。旧 B1–B5 排程已冻结到收尾快照，不再作为活动 Movie 开发阶段。

2026-09-30用户明确UAT只用于上线后的测试、验收问题。Series准备和开发按Phase工作项及里程碑推进；原UAT-279保留误登记与转移记录，不再作为开发任务使用。278/280仅保留历史收尾/清理事实，不继续为版本开发分配UAT。

已上架瑕疵条目保持 2026-09-28 用户确认的保护范围；原失败片重处理、存量清理或 Reset 不由本计划自动触发。进度显示、后台监听器与系统盘空间风险见 Status。

## 授权、工作区与交付

本聊天已授权阶段收尾、Beta工程清理、Series准备及本地开发/隔离测试/必要构建。2026-09-30首批代码为Series元数据基础，不新增Series生产部署、生产数据迁移或真实媒体处置授权。既有各UAT的精确授权持续有效，不扩张为任意操作。

当前统一开发区：`E:/my_project/emby_third_party-helix`，分支 `main`。2026-10-08已整合Movie收尾、Series开发及已发布UAT-281维护修复；原Series分支和重复工作区已退役为可恢复备份。同日经用户确认，UAT-267预检工具工作区及本地分支也已退役，现在只保留main工作区。旧分支独有历史提交保存在archive refs与恢复包，未提交/必要ignored内容保留于备份目录preserved；UAT-267仍按原条件开放，不以工作区退役关闭问题。详见[整合Evidence](implementation/evidence/GIT_WORKSPACE_CONSOLIDATION_20261008.md)。

部署职责按2026-09-28用户决定由各线程自行闭环。涉及UI的设计及验收由现任UI负责人负责，遵守Playbook §11.1/§12.3。当前元数据叶子未交付Series页面；后续各节点的可见变化逐项协调、逐版本验收。
