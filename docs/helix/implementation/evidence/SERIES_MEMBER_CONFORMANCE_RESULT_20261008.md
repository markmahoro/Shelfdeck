# Series成员Conformance Result

日期：2026-10-08；基线`a19e55d9c1b90d82d5f28ffa0456b276515ed6f3`。Series Phase媒体维修工作项，无NAS部署或生产数据动作。

## 有界正式合同

Foundation的Event Result JSON上限为64 KiB，整季所有Strategy和Device Snapshot不能重复内嵌到一个Result。现有Arca Conformance Capability增加可选materialKey参数，Series成员分支返回相同Result family、附closed memberScope：materialKey、完整spaceBasisDigest、sourceHandleDigest及maxOutputBytes。一个Result保存一份Strategy；策略未形成则显式null，不截断成员或提升存储上限。Movie及原整季评估保持原参数和Result形状。

成员执行核验当前Physical Identity，读取该文件Probe并进行有界播放抽样；覆盖Episode超限且自身超出物理预算时记录空间缺陷。Strategy使用前批精确成员引擎，执行前后身份漂移拒绝。Custody不可评估时保留成员scope和not_assessable，不Probe或生成策略。不同成员具有独立Evidence ID。

成员Evidence不能替代整季专业Assessment。投影、Commit输入及默认单策略投影排除memberScope结果，防止Map覆盖整季conformance或把额外成员提交成健康维度。后续Planner须调度全成员，由整季Assessment校验完整集合并绑定其摘要，再由Case读取精确Work重建策略集合；本批尚未接通该调度与汇总。

## 验证

正式Capability样本覆盖两个独立成员Strategy、完整递归schema校验、64 KiB大小、封闭scope拒绝额外字段、Custody门禁和Movie拒绝成员参数。37项成员/投影测试通过；含专业Commit输入捕获，证明只提交原三个维度，不声称真实数据库事务测试。Movie结构策略回归同时通过。

初次新增Commit fixture漏传构造器要求的Physical Material fingerprint端口，明确失败；补齐禁止文件访问的测试端口后专项通过，生产校验未放宽。原日志保留于`E:/my_project/helix-git-consolidation-20261008/series-member-assessment-focused.log`和`series-member-assessment-full.log`；最终记录为`series-member-assessment-focused-final.log`、`series-member-assessment-full-final.log`。

合同生成与P2检查通过，仍为113 Capability/99 Result family/197 table/45 transaction；aggregate digest为`dcb10533f051889f8e6639e215f03c576a5087ef014d97dfe1454e557faabeb9`。架构447文件/1395依赖、语义2065文件及diff检查通过。没有DDL变更或Result容量扩张。

全架构复验另暴露历史witness差异清单漏记本次Conformance合同变化，以及并发祖先目录时间戳变化导致stage Fence拒绝。历史witness文件与摘要保持不变，仅将该Capability加入“历史授权不再适用”的变化清单；两文件专项复验通过。最终验证将stage文件单独串行执行，其余架构并行，全部测试保留。日志为`series-member-assessment-full-verified.log`和`series-member-assessment-stage-verified.log`；原失败保留在`series-member-assessment-full-final.log`。

最终分组全架构：并行部分2,275通过/9既有skip，串行stage 16通过，合计2,291通过/9 skip/0失败；耗时96.4秒加0.2秒。重型Series Host按既有方式单独管理，本批未运行，不能以此声称完整成员Runtime或维修Host通过。

## 后续门禁

本批证明正式单成员Capability与Result，不证明Runtime已调度/持久化完整成员集合。完整集合汇总、逐目标维修Planner/Effect、混合输出逐集终检、Inventory-Control原子提交及恢复必须继续完成；仍未开放Series自动媒体维修，UI精确版本/Linux/完整可部署Gate未关闭。
