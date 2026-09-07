# ShelfDeck Clean Helix Master Plan

Status: **PROD-066 停机数据库基线已应用；本地修复已验证，等待部署及恢复授权。**
Last updated: 2026-09-07

唯一活动包：[CURRENT_PHASE](implementation/CURRENT_PHASE.md)。事实见 [CURRENT_STATUS](CURRENT_STATUS.md)，本轮证据见 [PROD-066](implementation/evidence/PROD-066_COLLECTION_CLEAN_BASELINE_20260907.md)。P1–P14、PROD-064 和此前 PROD-065 修复作为历史证据保留，不沿用旧数量作为本轮验收结果。

本轮用户授权：审查 Libra/Arca；逐片核验已上架电影；允许直接数据库清理不合格上架及异常状态；清空未完成 Libra 流程；最后清理修复残留。原始源删除另行逐条授权，沿用此前生产停线。

已完成全量核验、两项本地根因修复、候选数据库事务演练、生产替换与独立复核、旧快照及无引用工作区清理。当前保留 43 部合格电影，退出的 11 部物理文件保留；生产服务没有启动。

下一 Gate：用户解除停线并授权部署后，使用标准 build/upload/deploy 链路部署已验证修复，恢复 Field Observation/Intake，核验旧输入拒绝及现存文件重新采购。不得把静态基线或 Reset 完成当作重新上架成功，不放宽 Final Inventory 验证，不修改 SSOT，不添加历史兼容路径。
