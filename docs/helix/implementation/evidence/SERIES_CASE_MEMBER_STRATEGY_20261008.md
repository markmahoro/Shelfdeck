# Series Case消费成员策略

日期：2026-10-08；基线`8bd705183ceb196cf84ecaaae19df910e4a72c3f`。Series Phase媒体维修工作项，无NAS部署/生产数据动作。

## 实现

将完整成员证据的纯校验提取为Arca model，由观察汇总和Case消费共用；Primary Read Handle构造移入同Owner合同工具，字节形状不变。文件现场Identity Fence继续由Capability执行，Planner/Projection不做文件I/O。

Case必须active且Care Basis、CareRequirement摘要一致，basisInputs只允许一个精确健康Work引用。解析该Work中已进入正式conformance Assessment历史的唯一整季结果，验证Result/Envelope、完整成员集合摘要及requiredEffects/acceptanceDigest。每个媒体Finding必须对应该Assessment正式Finding，按成员观察里的精确条件确定目标；同成员同时需要Remux/Transcode时采用其冻结Transcode策略。Projection必须带目标materialKey，缺失、非目标或无合格策略不能选择首文件代替。

## 验证

39项评估/策略/Projection专项通过。新测试经正式成员Capability和汇总生成Evidence，再构造精确Case/历史输入；E01正常、E02编码不符时只选E02，正式Projection返回其冻结Strategy。测试拒绝终态Case、错健康Work/重复Work引用、篡改Requirement、错Finding/Assessment、漏成员、错策略Handle、错集合摘要及当前Binding变化。Case为模型fixture，不声称运行时已自动建立媒体维修Case或执行转码。

架构检查448文件/1402依赖、语义2066文件及diff通过。没有Capability schema、DDL或Result容量变更。本批不重跑重型Host；前批正式成员调度Host证据保留，当前纯集合校验与Handle提取由专项和完整架构回归覆盖。回归日志在`E:/my_project/helix-git-consolidation-20261008/series-case-member-strategy-full.log`与`series-case-member-strategy-stage.log`。

最终分组全架构2,293通过/9既有skip/0失败：并行2,277通过（97.6秒），串行stage 16通过（0.1秒）。

## 后续门禁

本批接通目标解析和策略Projection，不开放Series自动媒体维修。后续必须让维修Planner为每个目标生成独立节点，Effect精确绑定同一原成员及输出，再完成混合成品逐集验收、Inventory-Control原子提交/Settlement与恢复。真实媒体、UI精确版本/Linux及整体可部署资格仍未完成。

## 追加：精确验证成品消费

基线`13fb55e8b3e720d166c1d7281770b8af3f1ef04b`。Commit Planner为每个媒体物化节点冻结其验证Event。Projection从同一准备Work读取唯一通过的CareProductVerification，沿持久输入Binding找到生产Event，要求Handle ID、producingEventId、Result schema、Work/Attempt/Plan及Result摘要均一致。缺失、重复、失败或跨执行结果拒绝；同Work的执行期投影仍直接使用Foundation已经解析的Result。没有新增schema或修改Owner边界。

15项Projection/Planner专项通过，包含三个Remux/Transcode输出乱序解析、正式Plan schema验证及17种损坏/跨执行变体。分组全架构2,296通过/9既有skip/0失败（并行2,280，95.8秒；串行stage 16，0.2秒）；架构448文件/1402依赖、语义2066文件和P2合同通过。日志：`series-verified-media-output-full.log`、`series-verified-media-output-stage.log`、`series-verified-media-output-contract.log`，位于既有外部日志目录。本批是有界后端输出绑定修复，没有新增真实FFmpeg/Host、UI、Linux或部署证据。

仍需逐目标准备Planner/Effect、完整混合输出逐集验收、精确物化和原子提交/结算/恢复；Series自动媒体维修保持关闭。
