# Series 逐成员 Transcode 规划

2026-10-08，基于`953de5b32`，CURRENT_PHASE逐成员加工工作项。Planner增量，不构成完整Run加工/交付或可部署版本。

## 实现与边界

Transcode Planner从成员Work identity精确找到冻结Primary，用其Source Handle/Probe和独立Assessment/Selection历史。候选Node和输出目标随成员隔离；完整Run/Spec保持。Selection重建Assessment的实际Handle、Probe、同Run/Requirement/ordinal的Intent及设备Verification，逐字节复用验证通过的施工输入；跨成员、重复Result、改写Probe/Device/样本拒绝。后续策略只看同成员历史，超限重试测量也须绑定该成员Source Probe及Requirement。此连续性验证沿用现有typed合同，同样适用于Movie。

有界Series按完整源集合的精确Episode份额分配保守物理预算。`T_e`为每集源字节份额，`S_i`为文件大小，`C`为单集上限，文件预算取覆盖集上的`min(floor(C*S_i/T_e))`；BigInt计算并限制到safe integer。例：一个共享文件覆盖两集时可使用两集容量；9字节共享两集、另3字节仅属于第一集，在每集上限7时文件预算为8和2，均分累加不超限。零字节成员明确不可规划；无上限保持无预算。实际成品仍需完整集合终检，预算不是passed Evidence。

音轨/视频预算使用该物理容量，但档位质量下限仍按原单集上限计算，并保留已有源质量下限。不会因共享文件获得更多物理容量而误升级质量档位，也不改Acceptance Spec。未新建Owner、Capability、全局对象或跨域Store。

## 验证

- 首批Source/Planner/Budget/Media Contracts专项112项通过；随后增加跨成员超限重试测量负向通过。
- 预算覆盖有理数、超过Number聚合精度、safe integer上界、零大小/无上限/错误Basis；128组确定性不规则N:M映射将各文件预算按正式规则再汇总，全部满足各集上限。
- Planner正反例覆盖成员独立Assessment/Selection、完整Intent/Device复用、错误来源/Probe/Device/Result、duplicate、拒绝策略隔离、下一策略链及共享文件容量与原单集质量下限。Spec digest前后保持。
- 除Series Host外全架构2,115项：2,106通过、9既有skip、0失败，99.7秒。P2、Domain boundary、forbidden semantics和`git diff --check`通过。P2 aggregate仍为`87ed61befce92924d00c73719e3a6fe4f6745419438ca14f250e706bb89028f7`，无typed schema或DDL变化。

日志：工作区外`E:/my_project/helix-git-consolidation-20261008/series-transcode-*`。本批尚未执行真实Series FFmpeg或新完整Host转码，不用Planner/fixture通过替代实链；没有UI交付、Linux/部署验证或NAS动作。

## 接续

Run Coordinator还需按成员提交并恢复加工Work、给Working Handle绑定正确Episode Claims，并冻结完整混合输出选择。Staging、Conformance/Promotion及`findSelectedMediaWork`仍有单媒体Work/Direct-only假设，须一起接通完整集合终检；中间单成员通过不能完成Season。完整实链需覆盖Direct+Remux+Transcode、共享文件/part、失败/恢复与真实媒体，再推进剩余运营、UI负责人验收、Linux、迁移与发布/回退门槛。目标保持首个完整可部署Series版本，未缩减范围。
