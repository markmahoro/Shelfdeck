# Series实际Placement Case

日期：2026-10-08，基线`d65841a5ba0df64b221defed55d1cc4b1aee80f9`；唯一Series Phase完整运营工作项，无NAS部署/生产数据动作。

## 正式API与实际文件验证

隔离Host由Field生产E01/E02并上架后，以Shelf Placement preview/PATCH发布新folderTemplate；preview必须无物理副作用并精确报告1个受影响Entry。经正式Aftercare检查、Slot/Stage/Verify/Placement、Inventory-Control原子事务、旧位置Settlement和重评估，Case resolved。全部Primary/NFO/poster字节、Episode Claims和Artifact scopes逐一保留；新材料Control属于同一Entry、旧材料已释放、旧位置已结算，SQLite外键/完整性通过。最后事务参与者抛错的全回滚验证沿用NFO完整Host fixture。

整季换目录完整Host首轮修复后通过92.1秒，加入最终Settlement保护后再验91.9秒通过。另增加只改Primary命名模板的同目录变体，验证未改名NFO/poster仍可读且事实保留；完整Host复验通过，92.0秒。

## 并发评估修复

首轮在Placement发布时与旧健康评估并发；Owner projection正确拒绝旧Care Basis，但以普通Error报告导致Host报执行器错误。改用Foundation既有executionInputSuperseded合同，保持旧Event/Work失败与失效证据、禁止旧Assessment Commit，由Arca当前Basis重新组织评估。没有忽略测试错误、延时规避、重贴旧Evidence或把Arca业务判断移入Foundation。12项投影专项通过；失效分类由明确类型验证，完整迁移无Host错误。

## 同目录保护缺陷

同目录变体首次失败于重评估：当前NFO/poster已被结算删除，报CLEAN_ARCA_PRODUCT_SOURCE_MISSING。根因是Placement Material Receipt对所有Staged成员都生成retiredMaterials并标记requiresSettlement，包含身份和位置均未变化的成员。修复在Receipt投影排除未变化成员、同位置替换不删除当前路径，并在Settlement效果入口拒绝当前Inventory位置。36项Placement/Settlement专项通过，同目录Host复验通过（92.0秒）；原失败保留，不以清数据或延时规避。

## 验证边界

文件、SQLite、API和执行Runtime为真实实现；Provider和媒体Probe/播放抽样仍为fixture。没有证明进程崩溃恢复、跨设备迁移、真实网络/媒体或Linux；UI精确版本和整体Series发布资格仍开放。

全架构完整Host复验通过，92.0秒。边界446文件/1391依赖、语义2064文件及diff检查通过。日志目录`E:/my_project/helix-git-consolidation-20261008/`：`series-placement-case.log`保留初次并发失败，`series-placement-case-superseded.log`为整季迁移通过，`series-placement-rename-case.log`保留同目录失败，`series-placement-rename-case-final.log`为修复后通过；`series-placement-case-full.log`为完整架构回归；`series-placement-folder-case-final.log`为最后保护加入后的整季换目录复验。
