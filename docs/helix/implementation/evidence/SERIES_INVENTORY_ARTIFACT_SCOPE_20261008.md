# Series Inventory NFO目标持久化

2026-10-08；关联Series Phase节点4逐集维修基础。未部署NAS。

## 实现与合同

SSOT §8.5.11的Arca Inventory成员现在明确保存nullable `artifact_scope_schema_ref` / `artifact_scope_json`。仅Series NFO有值，4 KiB closed JCS冻结整季/Episode Requirement、已接受Package/Artifact引用和自摘要；非Series或其他角色为空。没有给NFO伪造Primary Episode Claim，没有增加Owner/Handoff或跨域Store读取。

On-deck把上一批已经用于正式落位的Artifact目标映射，按verified Staged sourceMaterialKey绑定到最终物理成员；目标数据与Inventory/Deck摘要和同一Commit事务保存。新revision追加保留原成员关系，历史回执重建也包含该关系。Aftercare读出并复制关系，维护revision写入前校验角色/schema/JCS/摘要，避免静默丢弃或将NFO关系带到Primary。

同一物理Season NFO被后续批次复用时，原成员的已接受来源关联保留；原始历史行不重写。Scope只是资料文件的目标关系，不替代物理身份、Binding或Material Control。

## 验证

- 完整隔离Host：E01/E02首次上架后，显式同Subject E03追加成功（93.7秒）。所有NFO具有对应scope，其他角色为NULL；原NFO关联逐字保留，新集独立保存，旧Inventory与历史回执保持。使用受控媒体/Provider fixture，不是完整Aftercare维修或真实网络证据。
- 最终架构回归2,211项：2,202通过、9既有skip、0失败（97.4秒）。随后补充维护writer写入前校验及2项测试，受影响Aftercare/Scope联合239项通过。
- 精确旧schema升级、目标预约、table/P2合同等专项44通过；旧历史schema联合12通过。最终Scope模型/升级测试14项已包含在239项中。
- 初次验证发现历史回执未把新scope纳入摘要、JSON字段缺少独立schema_ref及旧预约测试由当前DDL倒推历史；均修正后复验通过。初次6项架构失败与Host历史回执失败不计为通过。
- 架构边界、语义与P2门禁通过。DDL digest：`efa5340869a40216e3b2750293cbcb65fa3c7bc1c6950eb01eaf012b9f496a90`。P2 aggregate：`f7b0a6342223d780b6d349f7c2d24c24eb017358fe7834f76164ce3b296085d7`。

## 升级与保护

从精确前版 `f1016a2c9f4a314554c7a9863a487e4874ec77f93e6010c51fbb281b4204c2cb` 只新增两个nullable列，Movie行的既有字段逐字保持，并验证新Kernel可打开；重放为no-op。旧schema存在Series Shelf Entry时拒绝并回滚（ARCA_SERIES_ARTIFACT_SCOPE_UNPROVEN），不能靠文件名补造正式关系。未完成On-deck原Reset门禁继续，不新增未完成Formation兼容流程。

测试增加两份公开Git历史DDL压缩快照（f1016a…与46893c…），有完整commit/SHA256来源，不含任何数据库或运行数据。预约升级测试改为真实历史快照，避免后续新增字段污染旧schema fixture。

## 范围与后续

已完成目标关系的正式持久化；尚未完成逐Artifact Planner/Projection、NFO重新生成、精确Materialize及完整维修Case。现有Series TextRender scope门禁仍保留，不能宣称NFO维修已交付。还需验证Series真实维修、重启/副作用恢复、共享文件退出、UI负责人验收、Linux、生产副本升级/回退与发布镜像。

日志在仓库外 `E:/my_project/helix-git-consolidation-20261008/`：`series-inventory-artifact-host-final.log`、`series-inventory-artifact-full-final.log`、`series-inventory-artifact-aftercare.log`、`series-inventory-artifact-focused.log`、`series-inventory-artifact-upgrade-final.log`及P2报告。
