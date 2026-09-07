# 当前实施阶段：PROD-066 收藏干净基线

2026-09-07。状态：BASELINE_APPLIED_SERVICE_STOPPED；本地修复尚未部署。

- 用户授权：审查 Libra / Arca 历史修复；全面核验已上架 Movie；清理不合格上架事实和异常数据（允许直接数据库操作）；清空未完成 Libra 流程；最后清理工作区残留。
- 生产继续保持用户要求的停线。原始文件源删除须逐条另获授权；本轮不删除、移动、改名媒体文件，不修改 SSOT。
- 基线：生产 source `5565a03eb2`；包含后续 operator 和 Evidence 的 `d8de16bd1`；独立 worktree `codex/collection-clean-baseline`。
- 前序 PROD-065 Evidence 和提交保持历史不变；本包接替其未闭合的数据核查工作，不沿用“有 Commit 即完整”的结论。
- SSOT：§5.6、§5.7、§6.4.7、§6.5、§8.5.11–12、§10.2、§10.5、§10.10.2.1，以及已确认的 Movie file-scoped Settlement 修订。
- Owner：Libra Product/Spec/Workspace；Arca Acceptance/Inventory/Deck/Control；Procurement Field/Observation/Candidate；清理工具仅承担本次授权的离线运维责任。
- 输入：精确镜像和离线数据库快照、冻结 Spec/Acceptance/Inventory/Commit、当前文件只读探测、历史修复及备份。
- 输出：逐 Entry 上架与原料可用性证据、代码问题结论、有界清理 manifest 和前后核验。
- Effect/transaction：先只读取证；数据修改前冻结精确 scope、完整备份并校验，副本演练、单事务及独立 postcondition；未完成 Formation 使用正式 Reset 工具。
- 验证：关键文件存在及可读、NFO/图片/媒体要求、授权瑕疵、Inventory/Control/业务执行关联完整性、范围外事实保护、Reset 幂等及重新采购资格。
- 停止条件：来源不可确认、文件真实损毁需用户条目授权、任何 SSOT Owner/Handoff 合同缺口、备份/演练/独立核验失败。
- 最后工作区清理：仅已证明无引用的残留；保留本次回滚备份与未定责媒体。

## 已完成与剩余 Gate

- 54 部电影的 451 个当前 Inventory 文件已全量核验存在性/指纹；54 次媒体 Probe、162 次分段解码、93 张图片完整解码通过。分段解码不等于完整影片逐帧检验。
- 8 部 NFO 未覆盖当前已接受演员关系，3 部 NFO 实际身份与当前 Inventory Binding 漂移；11 部都仍有可用电影文件。依用户授权撤销其上架事实，保留所有媒体文件。未发现需要授权清理源的不可恢复条目。
- 副本单事务演练后于北京时间 20:06 应用数据库基线：保留 43 部 / 369 个当前文件，范围外 Arca 事实和当前控制逐行未变；18 个关联及未完成 Libra Subject/Run 清空，21 个精确 Handoff A Delivery 重开；20 个失效 Stage 控制与 9 个孤儿控制清除。
- 生产复核：SQLite integrity=ok、FK=0、当前文件指纹漂移=0、无 Libra/Custody 当前控制；保留真实历史失败记录及停机中的 Arca Aftercare，不伪造成功凭证。6 个被新 Reservation 覆盖的历史闭包不重复重开。
- 两个复现代码缺陷已本地修复：On-deck Commit 漏释放同文件 NFO Stage 旧身份；Reset 对仍有 Intake 的重叠旧 Candidate 未统一仲裁，触发唯一约束。`--keep-stopped` 用于停线运维。
- 清理 33 个旧快照和 4 个无引用 Workspace，保留完整回滚数据；旧快照 448 个非数据库文件先集中复制并逐文件校验。原始媒体源没有删除、移动或改名。
- 剩余：本地修复的标准镜像部署与恢复 Intake，须承接用户停线指令取得恢复授权；此前停机基线不宣称为运行态验收。证据见 [PROD-066](evidence/PROD-066_COLLECTION_CLEAN_BASELINE_20260907.md)。
