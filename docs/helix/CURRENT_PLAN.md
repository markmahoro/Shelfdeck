# ShelfDeck Clean Helix Master Plan

Status: **PROD-066 已定向恢复 11 部，当前 54 部上架；NFO 问题待处理，服务保持停止。**
Last updated: 2026-09-07

唯一活动包：[CURRENT_PHASE](implementation/CURRENT_PHASE.md)。事实见 [CURRENT_STATUS](CURRENT_STATUS.md)，本轮证据见 [PROD-066](implementation/evidence/PROD-066_COLLECTION_CLEAN_BASELINE_20260907.md)。P1–P14、PROD-064 和此前 PROD-065 修复作为历史证据保留，不沿用旧数量作为本轮验收结果。

本轮用户授权：审查 Libra/Arca；逐片核验已上架电影；允许直接数据库清理不合格上架及异常状态；清空未完成 Libra 流程；最后清理修复残留。原始源删除另行逐条授权，沿用此前生产停线。

已完成全量核验、两项本地根因修复、候选数据库事务演练、生产替换与独立复核、旧快照及无引用工作区清理。此前退出 11 部的判定过宽；经用户授权已定向恢复其原上架及关联记录，当前 54 部，另外 7 条未完成流程、20 条失效 Stage 控制及 9 条孤儿控制的清理保留。8 部旧演员 ID 错写及 3 部 NFO 字节/绑定漂移仍待处理，不宣称为全面合格基线；生产服务没有启动。

下一 Gate：继续基于既有 Aftercare 合同处理 NFO 问题；用户解除停线并授权部署后，使用标准 build/upload/deploy 链路部署已验证修复，恢复运行并验证 Aftercare 与剩余 Intake。不得把数据库恢复当作 NFO 修复完成，不放宽 Final Inventory 验证，不修改 SSOT，不添加历史兼容路径。
