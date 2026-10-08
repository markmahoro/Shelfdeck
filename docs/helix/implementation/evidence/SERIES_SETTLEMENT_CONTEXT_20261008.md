# Series完整目标结算上下文

日期：2026-10-08；基线 `c7035d0f5e12fb9d78026b0e3e6b127791f54bce`，当前Phase外部替换源结算工作项。

boundedSettlementContext按正式Offload目标union读取完整有序keys，要求每个key在Product Manifest和Final Inventory Decision中恰有一个成员；一个原source只保留一次。单目标继续settlementFinalMember，多目标使用完整settlementFinalMembers，包与决策摘要保持，全量原材料及最终落位路径仍进入managedLocations保护。没有把任意第一个目标当作整个映射，也不扩大原source范围。

14项上下文/授权回归通过：两个目标都保留、一个source、全管理路径与摘要保持；对每个目标分别注入Product/Final Decision缺失与重复均拒绝，双目标表示拒绝。既有61成员bounded性能/审批/结算端口测试保持；其原伪造product-N材料key已改为正式digest形态以接受共享合同校验。首次文本替换引入重复局部声明导致语法失败，修复后完整复验通过。

P2完整基线、包边界455文件/1439依赖、语义2074文件及diff检查通过。日志目录 `E:/my_project/helix-git-consolidation-20261008/`：`series-settlement-context-v2.log`、`series-settlement-context-contracts.log`、`series-settlement-context-host.log`。

本批仅完成上下文，旧单目标Settlement Handle仍拒绝多目标，原生端口也要求明确目标；不宣称多目标删除已启用。后续须在同一已确认合同内传播所有目标位置及验证到审批摘要、原生现场复核、一次源结算、完成证据与重启恢复。完整外部Host及Linux/UI/发布Gate继续，未操作NAS。

普通两集Direct/Remux正式隔离Host完整上架通过36.6秒，覆盖既有单目标结算路径；不替代多目标删除验收。
