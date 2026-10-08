# Series完整目标结算授权范围

日期：2026-10-08；基线 `1165cc8bfa7d85a45c20e141d244955299a68aa0`，当前Phase源结算工作项。

沿用户已确认的完整映射合同，SSOT及OldPrimaryStructuralExclusiveRelatedHandles schema增加互斥finalTargets列表（2..1024，materialKey及targetLocation，primary_payload/remove_after_place，无Related reference）；单目标finalMaterialKey/finalTargetLocation保持原形。生成domain registry/source map同步。

Settlement Handle逐一要求目标恰出现于已通过的同Package Final Product Verification；bounded Final Decision目标数量、顺序、key和路径严格匹配。所有目标位置、完整源映射摘要及Final Verification摘要进入唯一原source member、memberSetDigest与approvalScopeDigest。既有审批Store按这些摘要读取/发行，因此目标变化不能复用旧scope，未增加第二个原source授权。

16项上下文/授权回归通过，覆盖全部目标位置、每一目标位置变化引起审批摘要变化、Final Reality证据变化、缺失/重复/乱序/非法路径/Related reference拒绝。审批Store本次只读审查，未新增真实SQLite多目标审批测试，不把摘要单测宣称完整审批/删除验收。P2合同、包边界455文件/1440依赖、语义2074文件及diff检查通过。

日志目录 `E:/my_project/helix-git-consolidation-20261008/`：`series-settlement-handles.log`、`series-settlement-handles-contracts.log`、`series-settlement-handles-host.log`。原生settleInputAsync仍要求明确scalar key/location，尚未接线多目标时在任何目标读写及删除前拒绝mapping；本批未启用多目标物理删除。下一步是完整目标现场复核、一次源结算、完整完成证据、原生审批及重启恢复。Linux/UI/真实外部Host与发布Gate继续，未操作NAS。

普通Direct/Remux两集正式隔离Host完整上架通过36.7秒，覆盖既有scalar审批与结算回归，不代表外部多目标删除已验证。
