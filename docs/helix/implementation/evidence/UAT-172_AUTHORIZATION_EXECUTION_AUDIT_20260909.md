# UAT-172 持续授权与执行链审查

2026-09-09。结论：问题成立，仍开放；没有新增用户待决策项。现行依据为SSOT 5.8.7及arca_ondeck_settlement_approvals合同，不恢复历史“全自动/关键步骤确认”产品模式。

## 已核实事实

生产只读结果（2026-09-08T21:22:46.824Z，`.codex/uat172-authorization-before.json`）为`arca-input-settlement-standing`、revision 1、enabled、scope `old_primary_and_exclusive_related`、coversExclusiveRelatedInput=true。现有正式持久授权与用户已确认范围一致；不能把“执行链未接通”误写成“用户尚未授权”。没有重复提交授权、变更授权范围或直接写生产数据库。

`input-settlement-authorization-store.js`已有Owner Store及正式enable/revoke revision事务。`on-deck-projections.js`的settlementApproval仍即时合成`system-policy`、revision 1、approvedAtMs=0；未读取授权或arca_ondeck_settlement_approvals。settlementHandles的finalProductVerificationDigest使用Libra历史conformance digest，不能冒充Arca本次Final Product Verification。

`on-deck-capability-ports.js`将Approval传至settleInputAsync；`clean-arca-inventory-port.js`检查精确材料、source-to-final mapping及当前物理Fence，但未校验此Approval或当前授权。当前缺口是实际执行授权，不是单纯设置文案。

## 实施约束及剩余验收

Arca应在同Run正式Final Product Verification完成后，由Owner派生并持久化精确Approval；Projection只读，不在Projection内写Owner事实，也不把Approval写入pure_observation的Final Verify Capability。每个Scope覆盖当前授权revision、精确成员、Off-load/mapping及本次Final Verification。撤销、缩减范围或Basis变化使旧Approval失效，不静默扩大旧revision。

基础Execution Runtime已有temporarily-unavailable输入等待，不必将授权等待伪造成一次失败Attempt。当前composition仅在On-deck Work成功后调用reconcileOnDeck；若采用Owner reconcile派生Approval，须接入在飞Run的正式协调时点，不能等待整个Work成功形成死锁。此处记录调查事实，不另建活动计划。

验收仍需完整Host与物理负向：无授权不删除；授权覆盖后完成精确Settlement；撤销及范围不足不删除；Approval签发后、异步物理检查期间撤销须在删除前被识别；重启/幂等不扩大Scope；共享、未知及范围外输入保留；新Final故障不能复用历史验证。授权状态/撤销入口需浏览器核对，标准发布后核对生产正式事实。任何局部测试或去掉开关都不单独关闭172。
