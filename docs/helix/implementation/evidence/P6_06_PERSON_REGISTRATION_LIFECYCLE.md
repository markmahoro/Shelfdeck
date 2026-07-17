# P6-06 Person Registration and Candidate Lifecycle Evidence

Status: `PASS / WORK PACKAGE COMPLETE`

Date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implementation evidence |
| --- | --- |
| §5.9.4、§6.8.3 pure Candidate Resolution | `PeopleCandidateResolver`只消费typed Registration Evidence与精确immutable Policy catalog ref，输出complete Draft或bounded `no_candidate`；无Store、Provider、Foundation runtime或Capability依赖 |
| §8.6.19 complete Candidate payload | Registration Evidence完整映射`proposedName/aliases/providerIdentities/referenceHints`；payload和Evidence digest均重算校验 |
| §8.6.14 `people.candidate.commit@1` | exact Draft + Handle形成Candidate head、initial open revision、typed `PeopleCandidateRevision`、durable Result、marker和People-internal Outbox |
| §8.6.14 `people.person.commit@1` | exact Registration Acceptance Decision + Handle只读取People-owned immutable Candidate payload，原子创建Person/alias/provider identity并终结Candidate |
| §8.5.4 Candidate Acceptance | Candidate revision/payload CAS、terminal accepted revision、Person完整fact set、typed Result、marker和Outbox全成或全不成 |
| §9.7.8 dismiss Candidate | exact kind/ID/expected revision只追加dismissed terminal revision；不创建Person、不删除Evidence |
| strong identity authority | Commit Participant只接受正式`user|strong_identity_rule` Decision及合法digest；不从名称、Alias或Reference相似度自行提升授权 |

## 2. Clean implementation chain

```text
PersonRegistrationEvidence + PeopleCandidatePolicyRef
  → pure PeopleCandidateResolver
  → complete PeopleCandidateDraft
  → Domain Commit Coordinator
  → Candidate head + open revision + typed Result + marker + Outbox
  → PeopleCandidateAcceptanceDecision
  → Registration Acceptance Participant
  → Candidate accepted revision + global Person facts + typed Result + marker + Outbox
```

Candidate Commit不旁读Foundation Event Result、Provider或临时缓存；Acceptance只读取People Owner自己的Candidate snapshot。
客户端/调用方不能回传或改写Candidate payload来创建Person。

## 3. Machine counterexamples

- Resolver focused：`4/4 PASS`；覆盖complete Draft、`no_candidate`、Evidence tamper、unknown Policy、malformed result和依赖扫描。
- Registration lifecycle focused：`6/6 PASS`；覆盖Candidate commit replay、Acceptance replay、stale Candidate fence、payload digest、
  stable Provider Identity冲突整事务回滚、tampered Decision和dismiss-only terminal。
- P2/P3/table/package/all P6 focused组合：`95/95 PASS`。
- P3 canonical transaction crash + semantic/package/People回归：`103/103 PASS`。

关键失败不变量：Candidate仍保持open；不出现半个Person、半个Alias/Identity、孤立typed Result、marker或Outbox。

## 4. Scope and next dependency

本包完成Registration Candidate链路，不宣称Merge acceptance、Preference conflict resolution、Reference Asset lifecycle或People
Projection完成。下一工作包是P6-07 Person Merge and Preference lifecycle。

未运行E2E、Docker、服务启动、真实来源、真实媒体或生产动作；未修改SSOT和`media-desktop`。
