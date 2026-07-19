# P8-06 Handoff A Accepted Evidence

Status: PASS

## SSOT traceability

- `§8.7 Handoff A Accepted`：实现精确10张Libra表、2张Material Control表和3张commit/result/outbox表的单SQLite事务。
- `§8.6.19 AcceptedIntakePayload`：Commit只消费digest-valid Payload及匹配的receiving-owner Control Handle，不旁读`proc_*`。
- `§8.6.19 SubjectAndTransferReceipt`：Control成员按materialKey排序，expected/committed revision与Projection形成唯一
  `libra.handoff-a-transferred-control-set@1` digest；Receipt不接受调用方提供该摘要。
- `§3.4.2 / FA-04`：global continuity head及extension target分别CAS；new Subject只由Resolution分配ID。

## Realization

- `intake-acceptance-store.js`原子建立accepted Decision、match/overlap Evidence、Subject create/extension、continuity/Episode关系、
  一条Material一条Binding及完整N:M Episode关系、精确Primary Control transfer、Receipt、Result、Marker和Accepted Outbox。
- Handoff A Handle固定`ownerDomain=receivingDomain=libra`；来源scope仍由Payload逐项冻结为Procurement Material Field，未把来源Owner
  错当成Handle Owner。
- Related Material不进入Binding或Control scope；同步Transfer Point不创建Workflow Event。
- marker重放从Libra Owner rows恢复同一Receipt，不再次转移Control或发布Outbox。

## Machine counterexamples

- stale global continuity head在任何Domain/Control写入前失败；全部参与者保持原状。
- Outbox触发器注入崩溃后，Subject、Decision、Binding、Control transfer、Receipt、Result、Marker和Outbox全部rollback。
- Handle Owner/receiver、Payload basis、Binding set、Control scope、expected revision set、Receipt reconstruction contract任一漂移均fail closed。
- 完整Architecture gate PASS：96 fixture files；112 Capability、97 Result family、169 tables、35 transactions；
  P2 aggregate `ca53e852ea3d1a06c449d23823d0143a8558fc2a2d8811da48744cca93fcbd90`；`findings=[]`、`prohibitedActionsRun=[]`。

## Prohibited actions

未运行E2E、Docker、Canary、production、Service/socket或真实媒体副作用；未触碰`media-desktop`；实现线程未修改SSOT。
