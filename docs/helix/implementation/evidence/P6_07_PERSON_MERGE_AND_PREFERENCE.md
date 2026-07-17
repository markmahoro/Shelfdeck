# P6-07 Person Merge and Preference Lifecycle Evidence

Status: `PASS / WORK PACKAGE COMPLETE`

Date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implementation evidence |
| --- | --- |
| §5.9.5、§8.6.14 Merge authority | `PeopleCandidateAcceptanceDecision`必须精确选择immutable Merge Candidate中的source/target Person；Handle aggregate固定为target Person，工程实现不猜测保留对象 |
| §8.5.13 Person/Candidate/Merge correlation | Candidate terminal revision、source terminal Person revision、target active Person revision、必要Preference resolution和Merge Record在一个P3 Domain Commit事务内完成 |
| §8.5.13 one terminal target | `people_merge_records(source_person_id)`物化为数据库`UNIQUE`硬约束，不依赖应用查询或概率检查 |
| §8.6.19 `PersonRevision` | Result返回target revision、source terminal revision、accepted Candidate ref、Merge Record ref和精确Preference revision ref |
| §8.6.20 Preference | 独立`PreferenceIntent`只允许`-2..2`，校验Intent/typed parameter digest并通过People-owned revision pointer CAS提交 |
| Preference conflict business rule | `strong_identity_rule`遇到不同Preference（包括有值/无值）或试图显式改值时整笔拒绝；只有正式user Decision可解决冲突 |
| Reference correlation | Merge不复制Reference Asset/Face；source历史继续保留原Person ownership，通过source→target correlation解析 |

## 2. Atomic commit shape

```text
exact Merge Candidate + exact source/target Person/Preference fences
  → accepted Candidate revision/head
  → target Preference resolution when required
  → source terminal Person revision
  → target active Person revision with Alias/Provider Identity union
  → immutable Merge Record
  → typed PersonRevision + Commit Marker + Outbox
```

任一Candidate payload、Person revision/fact、Preference pointer、Provider Identity或数据库唯一约束失败，以上事实和Foundation
marker/result/outbox全部回滚。target保留`personId`与canonical name；target事实优先解决重复Alias/Provider Identity，source只转为
`mergedIntoPersonId=target`。Reference事实不搬迁。

## 3. Corrected implementation drift

- 删除Registration-only Capability registration假设；同一个`people.person.commit@1`现在按正式Decision kind选择Registration或Merge participant。
- 修正旧Preference草稿读取合同外`originKind/originRef`的问题：持久化来源由正式`intentId`派生，公开Result严格只有SSOT字段。
- 将SSOT prose中的source唯一terminal target物化为DDL唯一约束，并重物化table contract/DDL；未修改SSOT。
- 新P2 aggregate：`35695f240c93cbad14c2fc81d1df7c789db88966225fe7384dffaf44e9756f81`。
- 新table contract aggregate：`32e4e4c40dab5b93cc94e104da197a897eccdc2070e763f3d308776b7e343530`。

## 4. Machine counterexamples

- Merge/Registration/Preference lifecycle focused：`11/11 PASS`。
- all P6 + table materializer focused：`57/57 PASS`。
- package boundary与Capability runtime targeted：`26/26 PASS`。
- 完整Helix architecture verifier：PASS，P2 `112/96/160/22`、unresolved refs `0`、findings `[]`。
- P3 persistence verifier：PASS；DDL/table trace可重复生成，canonical transaction与crash gates全部通过。

关键反例覆盖stale Candidate、stale Person、stale Preference、Decision tamper、Provider Identity冲突、strong-rule Preference越权、
malformed explicit Preference、typed Intent digest tamper和stable replay。

## 5. Scope and next dependency

P6-07只闭合Person Merge与Preference lifecycle，不宣称Reference Artifact/Face maintenance、Person Reference Projection或全部People
Capability runtime已完成。下一工作包是P6-08 Reference Asset/Face maintenance and Projection。

未运行E2E、Docker、服务启动、真实来源、真实媒体或生产动作；未修改SSOT和`media-desktop`。
