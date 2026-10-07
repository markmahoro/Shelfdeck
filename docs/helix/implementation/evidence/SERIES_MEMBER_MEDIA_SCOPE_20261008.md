# Series 逐成员加工范围与 Remux Planner

2026-10-08，基于`f42456a34`，CURRENT_PHASE逐成员加工增量；首版仍未达到可部署门槛。

## 实现

- Remux/Transcode Assessment/Selection的Supporting Work可绑定完整冻结Primary member digest，Work identity、idempotency key和策略依赖按成员隔离；保留原Run execution basis。Movie原定义保持。
- `ProductionSourceScopeReference`复用现有closed字段，Series引用一个Primary，scope digest绑定完整Run Manifest、Run execution及member digest。Resolver从完整Run重建唯一精确引用，匹配全部digest/count后才发放该文件读取Handle。没有裁剪Run、改写Spec或放宽stream_file的一文件合同；错误member/binding/manifest/scope拒绝。
- Remux Planner能识别该成员Work，生成既有Remux→Probe→Verification→Selection四节点，独立输出路径/目标和成员绑定；正式Remux Capability接到的读取范围只有该成员。
- Series Workspace Candidate也必须携带完整空间Basis；实际输出替换其来源成员，其余冻结成员仍保留，Claim不从路径猜测。原Source Probe和输出Probe分别绑定实际Handle，完整有理数聚合再次计算。新增负向发现并补齐了Probe本身的sourceHandleDigest连续性检查，不能仅比对其外层摘要。
- 中间候选验证不是混合最终产品验收。最终Conformance/Arca独立复算保持，未改变Owner、Control、Handoff或生产数据。

## 证据

- Scope/Work/Remux Planner/Workspace候选专项最终75项通过。覆盖2/24/32成员精确单文件读取、无提前句柄授予、stale Manifest/member/binding/Scope拒绝、策略依赖不跨成员、路径不碰撞、原Run不变、输出替换后共享文件和part累加、错误来源/Probe拒绝。
- 正式Capability的范围测试执行到Effect port边界，用受控sentinel停止，证实只传入该物理成员，错误Scope不再进入Effect。没有将此测试宣称为真实FFmpeg加工或完整Remux Host。
- 相关Media Contracts/Conformance与新增专项112项通过；后续补充正式Capability边界专项通过。
- 全架构回归（除Series Host）2,100项，2,091通过、9既有skip、0失败，100.0秒。
- 共享文件Direct完整Host回归通过，35.8秒；正式Package/Conformance/Arca Commit保持。Series媒体Probe/Provider/Playback仍为隔离替身。
- P2、Domain boundary、forbidden semantics及`git diff --check`通过。P2 aggregate：`87ed61befce92924d00c73719e3a6fe4f6745419438ca14f250e706bb89028f7`。无DDL变化。

日志：工作区外`E:/my_project/helix-git-consolidation-20261008/series-member-*`。本批未重跑Movie真实媒体Host；前一批`f42456a34`已通过，本批Movie相关合同及全架构覆盖通过。尚未验证Linux或真实Series加工。

## 接续

当前Run Coordinator仍没有提交逐成员加工Work和混合成品终检/交付；单成员Remux Planner可用不等于用户旅程可用。Transcode仅完成成员Work身份/依赖，Planner的source/预算/策略历史/输出Projection仍需按成员接线。继续完整Run调度、Working Handle正确Episode映射、混合完整集合重验及Staging/Conformance/Promotion；不可消费first-result或把单成员成功当Season成功。外部寻源、恢复/维护/退出、多Package Fact读者、UI负责人的具体版本验收、真实Series FFmpeg/Linux和冻结部署/回退仍待完成。没有UI交付、Formation Reset或NAS生产动作。
