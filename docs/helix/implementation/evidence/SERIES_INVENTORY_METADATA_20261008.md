# Series 补集后的逐集资料检查

日期：2026-10-08，关联 CURRENT_PHASE 节点3/4；不改变待确认的外部替换合同。

## 问题与实现

Arca Aftercare的missingFields原先只从第一份Product Metadata Fact顶层descriptiveFacts查找episode_title/episode_plot。Series实际把这些字段保存在episodeMetadata中；持续补集后，一个Inventory还会保留多个来源Package的Metadata Facts。这会把完整资料误判为缺失。

现在以当前Arca Inventory Primary的Episode Claims去重确定真实范围，读取全部已接纳Metadata Facts；每个当前Episode必须有唯一同Season、正确编号、非空且字段唯一的记录。原始来源顺序不影响结果，共文件或同集多part不要求重复Episode metadata。读取的Resolved Identity Facts必须都对应当前Shelf/Canonical Season，不从第一份未知身份猜Season。

同Owner的Package字段检查复用这一规则并读取所有Metadata Facts。Aftercare仅在Series的episode_title/episode_plot上使用新检查，其他身份安全判断与Movie顶层字段行为保持。无表/schema/Owner变更，无文件写入或数据修复。

## 验证

- 14项模型专项通过：多批补集/顺序变化/N:M、缺集、空标题、重复Episode、错季/集号、重复字段、外来/缺失身份、空Inventory、范围外资料、Movie回归、Package多Fact。
- 两批正式Host上架后的Arca Owner currentContext验证通过（94.1秒）：E01/E02及后续E03的两份Metadata Facts都必须被读取；只在内存副本移除E03标题后应准确报告缺失，原持久Facts保持不变。
- 全架构2,144项：2,135通过、9既有skip、0失败（99.0秒）；架构边界及语义Guard通过，git diff --check通过。

本批没有浏览器走查、UI负责人验收、Linux或生产动作；不宣称整个Series Aftercare/健康评估完成。既有健康状态与提示保持相同交互，页面最终显示仍需冻结版本UI验收。日志位于仓库外 `E:/my_project/helix-git-consolidation-20261008/series-inventory-metadata*.txt`。
