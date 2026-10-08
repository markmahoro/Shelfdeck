# Arca多目标处置与落位终检

日期：2026-10-08；基线 `be7a20ed20b25f2c68ace1076105249930b517f8`，当前Phase外部替换交接工作项。

按用户已确认的source-to-all-final合同补齐SSOT的Arca传播：ProductDispositionManifest一source一member，finalMaterialKey与finalMaterialKeys互斥；多目标2..1024、排序唯一、primary_payload/replaced_and_settled且无Related reference。生成domain schema/registry/source map已同步，未新增Owner或删除授权。

Arca处置投影调用共享Offload目标校验，逐一要求唯一对应Product member；多目标逐一要求Series Workspace Primary和非空Episode Claims，完整列表进入member及manifest摘要。Final Product Verification在返回通过前对每个处置目标核对当前落位Reality，缺失/重复及错误基数/顺序/角色拒绝，不只验证首个目标。

12项专项及既有Handoff B规划回归通过，覆盖多成品一原文件、任一目标缺失、重复目标事实、非Series/缺Claims/错角色、单目标Movie与Related保持，以及互斥列表拒绝。普通两集Direct/Remux完整上架Host通过35.8秒；P2完整基线、包边界455文件/1438依赖、语义2074文件及diff检查通过。日志在 `E:/my_project/helix-git-consolidation-20261008/series-disposition-tests.log`、`series-disposition-host.log`、`series-disposition-contracts.log`。

专项为模型/投影依赖边界验证，普通Host仅覆盖scalar；尚非多目标源结算/完整外部Host证明。下一步仍需传递全部目标位置与证据到Settlement Handle、原生源结算、完成证据和重启恢复；外部Read Set/Coordinator及Linux/UI/生产副本升级发布门禁继续。未部署NAS，Series未达到可部署声明条件。
