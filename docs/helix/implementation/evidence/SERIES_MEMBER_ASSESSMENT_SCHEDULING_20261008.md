# Series完整成员评估调度

日期：2026-10-08；基线`7af4a38b97e3dcd091a1260d011a429352774a58`。唯一Series Phase的媒体维修工作项，无NAS部署或生产数据动作。

## Planner与汇总

健康Planner按当前Arca Inventory完整Primary集合创建逐成员Conformance Event，身份绑定Work Attempt与material key，依赖Custody完成；整季Conformance依赖所有成员成功。成员顺序归一，原Movie仍为四节点健康Plan，Series没有Primary时保持原明确缺失处理。

整季Capability从同Work、Attempt和Plan重建精确集合，核对每个稳定Event ID、Result ID/storage digest、Envelope digest、输入Binding摘要、Care Basis/Inventory revision、当前memberScope与空间预算，拒绝缺失、重复、错来源、失败或摘要篡改。汇总时再核验文件Physical Identity，不重复Probe或播放抽样。整季Result仅保存memberAssessmentSet的digest与memberCount，成员完整Strategy仍独立持久化，Result上限保持64 KiB。

## 验证

26项媒体评估/策略测试通过；新增24集正式Plan校验，验证全部独立Event和汇总依赖、顺序稳定、旧Basis拒绝及Movie路径。正式Capability测试验证成员集合缺失/重复/错Work/Attempt/Plan/Event、结果摘要或scope改写、失败结果拒绝，聚合不重复Probe，结果可通过递归schema校验。

正式隔离Host的两集NFO维修场景通过（91.7秒，进程总92.1秒）。Field到On-deck、健康检查、独立成员Result、整季集合摘要、专业Commit、NFO Case/Inventory-Control原子事务与结算、终态健康及收敛后Host重开均沿真实Runtime。测试通过Foundation Work Result Reader读取实际SQLite结果，逐条核验成员数量和存储大小，并独立重建整季集合摘要。Provider/媒体Probe及播放仍为fixture，不声称真实转码或进程崩溃恢复。

首次Host失败于健康Planner接收通用On-deck Context Reader：此前Planner不读取Inventory，新增成员调度后才暴露。修复Arca public planning registration，将健康Planner明确接到Aftercare Context Reader；没有跨域读Store或增加fallback。失败保留在`E:/my_project/helix-git-consolidation-20261008/series-member-scheduling-host.log`，通过记录为`series-member-scheduling-host-reader.log`。

P2合同生成/检查通过，113 Capability/99 Result family/197 table/45 transaction不变，aggregate digest为`3cb15e64c19032852ef4321c31517e16654f56a6c338e3d3547c983f97004f72`；无DDL变更。架构447文件/1396依赖、语义2065文件及diff检查通过。完整回归分组日志为`series-member-scheduling-full.log`及单独串行的`series-member-scheduling-stage.log`，与重型Host分开运行。

最终分组全架构2,292通过/9既有skip/0失败：并行2,276通过（97.3秒），串行stage 16通过（0.2秒）。

## 未完成范围

完整成员观察已由Runtime调度和持久化；Series媒体Finding仍保留attention_required。下一段必须让Case精确重建已冻结集合、逐目标选择Strategy和执行Effect，验证完整混合输出的逐集空间再原子提交/恢复。真实媒体维修、跨设备/进程崩溃、UI精确版本/Linux及完整可部署Gate继续，不能以本批健康检查闭环替代维修交付。
