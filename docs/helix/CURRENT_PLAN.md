# ShelfDeck Clean Helix Master Plan

Status: **五项用户痛点只读审计完成，迭代方向待评审；PROD-066 当前 54 部上架，服务保持停止。**
Last updated: 2026-09-07

唯一活动包：[CURRENT_PHASE](implementation/CURRENT_PHASE.md)。事实见 [CURRENT_STATUS](CURRENT_STATUS.md)，本轮证据见 [PROD-066](implementation/evidence/PROD-066_COLLECTION_CLEAN_BASELINE_20260907.md)。P1–P14、PROD-064 和此前 PROD-065 修复作为历史证据保留，不沿用旧数量作为本轮验收结果。

本轮用户授权：审查 Libra/Arca；逐片核验已上架电影；允许直接数据库清理不合格上架及异常状态；清空未完成 Libra 流程；最后清理修复残留。原始源删除另行逐条授权，沿用此前生产停线。

已完成全量核验、两项本地根因修复、候选数据库事务演练、生产替换与独立复核、旧快照及无引用工作区清理。此前退出 11 部的判定过宽；经用户授权已定向恢复其原上架及关联记录，当前 54 部，另外 7 条未完成流程、20 条失效 Stage 控制及 9 条孤儿控制的清理保留。8 部旧演员 ID 错写及 3 部 NFO 字节/绑定漂移仍待处理，不宣称为全面合格基线；生产服务没有启动。

用户最新要求以五项产品痛点重新审计，不以前序 Aftercare/Libra 架构收敛建议为前提。只读结论与下一轮交付建议见[五项痛点审计](implementation/evidence/USER_PAIN_AUDIT_20260907.md)：统一工作可见性与有界列表查询、批量改善准入、NFO与源目录共存合同。当前未授权这轮实现；SSOT未修改。

下一 Gate：先评审上述用户结果及精确合同调整，再在唯一活动包承接获授权的实施范围；生产继续停止，54部实际维护与功能改造分开。数据库恢复不等于NFO修复，审计也不授权重新退收藏、清理文件、部署或启动。
