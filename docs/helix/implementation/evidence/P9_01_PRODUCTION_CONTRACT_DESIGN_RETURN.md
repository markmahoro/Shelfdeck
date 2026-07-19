# P9-01 Libra Production Contract Design Return

Status: Open；submitted to Architecture Agent task `019f4a67-4a29-7c62-8af5-bf79083226ca` on 2026-07-20.

## Proven blocker

P9 implementation-feasibility reverse audit证明现有SSOT/P2合同不能唯一实现六段持久化连续性：

1. Run Creator没有typed create/lifecycle transaction、stable ID/scope digest、revision/head CAS或replacement replay；
2. Episode Delivery DTO不能映射material/role/requirement member rows，Run-owned initial Production Material Manifest只有digest无事实；
3. Workspace没有create/admission/ref attach/Working→Staging transaction或current revision head，member role/state不封闭；
4. On-deck DTO和Promotion transaction不能原子保存并恢复完整Product/Artifact/Media-Cast/Material/Off-load/Provenance snapshot；
5. Discard/Cleanup缺正式Decision/Result、member/control set公式和expected CAS，active/pending状态与non-null terminal/effect/receipt列矛盾；
6. Off-load Completion路径没有durable Projection→cleanup scope/member admission transaction，Reclaimer无法只靠Owner facts重启恢复。

完整问题包已精确列出SSOT章节、DTO、Owner row、transaction read/write set与不可实现的restart/crash连续性并发送架构任务。
这些都是工程合同闭合，不改变用户可见业务结果、Domain、Owner或Handoff；当前不需要用户决策。

## Implementation hold

暂停Run/Workspace/Package/Discard/Cleanup受影响路径。禁止调用者补值、读取Foundation Result冒充Owner事实、从current row推断
历史、写Arca/Procurement Store、引入Kairox/旧Runtime或兼容路径。可以继续只读旧实现原子复用审计和不依赖缺口的package
boundary检查；架构提交后必须先只读复审全局一致性，PASS才可原样纳入。
