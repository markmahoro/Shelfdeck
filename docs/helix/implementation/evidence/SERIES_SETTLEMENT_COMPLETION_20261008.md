# Series结算调用与完整完成Evidence

日期：2026-10-08；基线 `dc6342f8a3ca6207149c9c04d6b45eab3bf21302`，当前Phase源结算工作项。

Capability按明确基数传完整finalTargets与bounded finalInventoryMembers，scalar保持原形。回执生成前校验端口完整目标、位置、集合摘要、映射及source absent，再将有界typed final_targets列表写入PostDeleteReality，进入record及payload摘要。SSOT与SettlementDeletionEvidence生成schema/registry/source map同步；其他DeletionEvidence不放宽为任意嵌套JSON。

Commit完成投影逐原source读取恰一份成功Evidence，要求每个映射目标恰对应一个当前Final Reality成员。多目标逐一比对materialKey、location及观察digestHex，检查原映射、absent/disposition、完整集合摘要、record/payload摘要及互斥表示；缺少/重复/截断/旧位置或摘要拒绝。完整目标列表进入完成摘要，不只记录首目标；原source仍只一条completion。

20项上下文/授权/完成专项通过：Capability捕获完整传参及typed回执；目标遗漏、重复落位/成功Evidence、位置变化、摘要变化、截断回执拒绝。普通两集Direct/Remux正式Host完整上架通过35.8秒。P2基线、包边界456文件/1444依赖、语义2075文件及diff检查通过。日志 `E:/my_project/helix-git-consolidation-20261008/series-settlement-completion-v2.log`、`series-settlement-completion-host.log`、`series-settlement-completion-contracts.log`。

Capability多目标专项使用端口stub，普通Host只覆盖scalar；前批原生临时文件Evidence不能替代本批完整多目标Host/审批持久化验证。历史Effect输入/完成观察恢复仍需传播新形态，外部Read Set/Coordinator及真实Provider链路仍待闭环。Linux/UI/发布门禁继续，未操作NAS，Series尚不可声明可部署。
