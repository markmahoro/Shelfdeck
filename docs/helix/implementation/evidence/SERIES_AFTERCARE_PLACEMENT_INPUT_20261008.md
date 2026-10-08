# Series Aftercare Placement输入与命名

日期：2026-10-08；基线`e72af72b953a04b6faa7632e998c3fcf87bb5063`，唯一Series Phase运营工作项。没有NAS部署或生产数据操作。

## 根因与实现

原Aftercare请求仅构造title/year，没有Season Provider Identity、跨批次Episode Metadata或NFO Artifact关联；Series Inventory端口会因缺Season身份拒绝。现在由Arca当前Inventory读取全部已接受批次Identity/Metadata，先验证同一Canonical Series/Season，保留完整Primary Claims；Series标题使用已接受显示资料，不以Provider编号替代缺失标题。

Aftercare显式传递当前持久化Inventory Artifact scopes，Inventory端口要求Aftercare Case并逐一验证材料覆盖、来源批次、Season/Episode和scope唯一性。On-deck仍使用其正式Accepted Artifact Manifest，Aftercare不伪造历史Workspace Handle/Artifact。命名仍由现有Series算法负责，共文件及多part的材料集合保持。

Placement评估原只比较目录，会漏掉目录相同而文件模板变化的情况；改为按完整Final Inventory Decision逐成员比较Endpoint与绝对目标路径，拒绝不完整或重复材料决策。

## 验证

真实临时文件调用正式Inventory prepare（无DB写入），验证两批资料、E01/E02共文件、E03双part、四份NFO的完整命名。拒绝缺scope、错来源批次、重复scope、错Season、缺Episode、缺标题和非Aftercare使用Inventory scope。准确匹配当前路径、同目录改名和缺成员决策分别验证。首轮fixture把primaryTemplate写成不支持的title变量，已改用正式默认stem/ext；未放宽生产模板。

8项新增Placement专项纳入最终全架构：2,279通过、9既有skip、0失败，97.1秒；现有Series Placement 5项亦在该批通过。边界446文件/1390依赖、语义2064文件与diff检查通过。实际E01/E02上架后E03追加的正式Host通过（94.2秒）：从Arca Store读取当前两批Facts及材料，原位置prepare精确匹配；改folderTemplate后生成全部新目标，成员名称保持、目标尚不存在，未执行文件迁移。

## 未覆盖

本批完善Placement输入和评估，不宣称实际文件迁移、落位中断恢复、Inventory/Control Commit和旧位置Settlement的完整迁移Case已通过。那些仍须正式Host验证，不能由prepare命名或全架构通过代替。真实网络/媒体、UI版本验收、Linux与Series发布资格仍开放。

日志目录`E:/my_project/helix-git-consolidation-20261008/`：`series-aftercare-placement-full.log`、`series-aftercare-placement-full-final.log`、`series-aftercare-placement-host.log`。
