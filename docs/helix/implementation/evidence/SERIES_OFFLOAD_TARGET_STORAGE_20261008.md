# 多目标Offload持久化与重建

日期：2026-10-08；基线 `585023fe023e2f4afbd7d11df4f65ffcde182feb`，当前Phase交接工作项。

SSOT relation表增加nullable final_product_material_keys_schema_ref/json，单目标列可NULL；库CHECK要求单目标与多目标JSON恰一者非NULL，后者固定LibraOffloadProductMaterialKeys schema、2..1024数组且仅original_input/replaced_and_settled/remove_after_place。JSON≤128 KiB，单source仍一row。新application schema、table合同、DDL及manifest均通过既有生成入口同步。

Promotion沿原事务写入完整canonical列表，Reader沿原Package relation重建互斥字段；纯存储投影验证所有keys、排序唯一、schemaRef、基数和处置，拒绝非canonical JSON、重复/无序和双字段，不截断或降级为首目标。现有Package digest重建继续覆盖完整列表。此处未接入Assembler实际生成多目标或Arca现场验证。

14项专项通过：原Promotion事务/历史Package读回、原子故障回滚，以及真实SQLite中新列表完整写读、一次源row回滚、互斥/schema/基数/处置CHECK拒绝。多目标原生测试针对持久化边界，不是合法完整多成品Promotion或外部Host证明。旧测试夹具finalProductMaterialKey/disposition为NULL违反既有合同，已修正为明确carried_forward一对一输入，未放宽校验。

普通两集Direct/Remux混合上架隔离Host通过35.8秒。首次Host因启动升级器仍锁定旧DDL摘要而拒绝，已更新新库target digest；旧schema缺新列时禁止沿旧升级链标记成新库，返回明确升级未验证错误。旧目标摘要也保持不被自动推定为可升级来源。下一段必须实现并测试保护已完成Movie历史的精确schema升级；未完成Formation不享有迁移权利。此临时拒绝是开放发布Gate，不是旧库升级完成。既有6项defect-admission测试通过，但其历史模拟保留当前Offload形态，不能替代真实旧表升级验证。

P2完整基线通过（初检发现JSON必须有固定schemaRef后已补齐正式application schema/列）；包边界454文件/1433依赖、语义2073文件及diff检查通过。DDL实际SQL只修改Offload表；生成manifest同时刷新全部table contract摘要，未额外修改其他SQL。日志目录 `E:/my_project/helix-git-consolidation-20261008/`：`series-offload-storage-regression-v3.log`、`series-offload-storage-host-v2.log`、`series-offload-storage-migration-regression.log`、`series-offload-storage-contracts-v2.log`。

未部署NAS。旧库保护升级、Assembler完整映射、Arca全部目标验证/一次结算、Coordinator/真实外部Host及Linux/UI等Series发布条件继续，未声称可部署。
