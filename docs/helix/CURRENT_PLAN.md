# ShelfDeck 当前计划

更新：2026-09-30。用户已接受 Helix Beta Movie 全链路阶段成果，当前进入支持剧集的大版本准备。阶段收尾证据为 [UAT-278](implementation/evidence/UAT-278_BETA_MOVIE_CLOSEOUT_20260930.md)；唯一活动执行包为 [CURRENT_PHASE](implementation/CURRENT_PHASE.md)。不分配新版本名称或 Git release tag。

## 范围与顺序

| 顺序 | 结果 | 入口与门禁 |
| --- | --- | --- |
| 已完成 | Movie 阶段文档收尾、用户验收记录、生产基线与历史归档 | UAT-278；保留未关闭 UAT，不新增技术资格总体 PASS |
| 当前优先 | Beta 工程工作区和废弃副本清理 | UAT-280；NAS清理完成，本地独立副本删除被自动审批阻断，整体保持部分完成 |
| 接续准备 | Series 首版合同与实现差距审查、样本及验收准备 | UAT-279；在当前 Phase 完成逐段接线核查，形成可独立验收的实施项 |
| 后续 | Series 完整纵向交付 | 先本地 Season → Episode → On-deck，再持续追加、多对多映射、维护/退出、恢复和 UI；开工前按最高 UAT 接续登记具体结果 |
| 发布前 | Movie 回归与 Series 资格验收、受控升级/回退验证 | 精确 SHA/镜像与当前数据保护；沿用标准发布入口和适用授权 |

Series 范围从 SSOT §3.2.6、§3.4.2–3.4.5、§4.4–4.5、§5.3.5、§5.5.3–5.5.8、§6.2.3、§6.5 及 §9.4 派生。首版范围草案及尚需审查的细节见 Phase；没有新 Owner、全局媒体 ID 或独立 Series Runtime。Movie-only Beta 基线继续作为 Movie 回归 Oracle。

## Movie 残余维护

2026-09-30用户追加：先完成UAT-280工作区清理，范围含本地/NAS无用副本、备份与旧发布资料；[结果与待办](implementation/evidence/UAT-280_BETA_WORKSPACE_CLEANUP_20260930.md)。已删除NAS60项废弃工程资料和142个旧镜像标签，退役14个Git worktree；34个本地镜像包、40个测试副本及5处退役目录残余尚未删除，自动审批返回`blocked by policy`。本项保持部分完成，不以NAS完成代替整体关闭。保护生产业务数据、媒体、未提交修改及必要恢复证据；清理后接续279准备。

所有未关闭项继续进入[唯一 UAT 总表](UAT_ITERATION_REGISTER.md)，按自身证据验收；不重开已有关闭项，不以阶段接受批量关单。先刷新事实，区分仍复现缺陷、缺少验收和历史处置。若涉及媒体安全、恢复或收藏事实，先解决依赖，再发布受影响的 Series 增量；不影响的准备工作继续。旧 B1–B5 排程已冻结到收尾快照，不再作为活动 Movie 开发阶段。

已上架瑕疵条目保持 2026-09-28 用户确认的保护范围；原失败片重处理、存量清理或 Reset 不由本计划自动触发。进度显示、后台监听器与系统盘空间风险见 Status。

## 授权、工作区与交付

本聊天已授权阶段收尾与 Series 开发准备。当前工作为文档和只读代码审查，未新增 Series 生产部署、生产数据迁移或真实媒体处置授权。既有各 UAT 的精确授权持续有效，不扩张为任意操作。

当前隔离交付区：`C:/Users/markm/.codex/worktrees/beta-closeout-series/emby_third_party-helix`，分支 `codex/beta-closeout-series`，基于 `ecccf7ba9b`。主工作区、原集成区及其他 worktree 的未提交内容受保护；归档文档不等于删除工作区。后续代码开工前核对最新交付与修改归属。

部署职责按 2026-09-28 用户决定由各线程自行闭环。涉及 UI 的设计与复查继续由现任 UI 负责人协调，遵守 Playbook §11.1 / §12.3；本阶段不修改 UI。
