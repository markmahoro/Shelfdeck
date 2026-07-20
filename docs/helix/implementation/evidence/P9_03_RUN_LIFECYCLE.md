# P9-03 Run Freshness, Lifecycle and Priority Evidence

Status: PASS

Date: 2026-07-20

## SSOT traceability

- 唯一架构来源：`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` 8.5.4、8.5.11、8.6.21及8.9.7。
- `P9-03-R1`补齐Lifecycle transaction精确variant-superset read set；实现分支原样纳入Architecture提交`f3fcc266`。
- `P9-03-R2`明确Accepted Message四字段ID basis，并补齐Terminal Evidence member/set/evidence ID公式；实现分支原样纳入Architecture提交`07626c22`与`1561e25b`。
- 实现任务未修改SSOT，未新增Owner、Store、Handoff、Capability、事务或兼容路径。

## Implementation evidence

- Run Admission从首个revision开始持久化完整transition Evidence JSON与显式recovery空快照。
- Lifecycle在同一SQLite transaction内重建Comparable Basis，验证historical/current Material Control，执行Run/head双CAS，并提交immutable revision、typed Result与marker。
- fixed recovery严格保持`1/5/15/30/60`分钟、attempt 1..5和第五次unresolved冻结；frozen不自动恢复。
- `set_priority`只消费active Run与typed Priority Intent；非complete published Package重验Product/Off-load Control仍归Libra。
- direct terminal freeze逐项验证同Run Work、immutable Plan、terminal Event/Attempt与binary Retry Policy digest。
- complete验证published Package和Accepted Message，原子写accepted Delivery Receipt、Inbox、Run completed revision、active scope移除、Result/marker；accepted closure/rejection列为NULL且零Outbox。

## Machine counterexamples and tests

- Comparable Basis漂移、Package custody漂移、stale CAS、非法state/evidence、early recovery及changed basis均fail closed。
- complete在Foundation写后注入crash时，Run terminal、Receipt、Inbox、Result和marker全部回滚。
- marker replay返回原typed Result，不重复写revision、receipt或Inbox。
- 完整`npm run test:helix-architecture`：PASS；105 fixture files，dependency/semantic/contracts均`findings=[]`。
- P2 aggregate：`1391aa06c35df31c46aeb3221ead3e4cee684d383964233a8b81e1a5718ced9c`。
- 未运行E2E、Docker、Canary、生产、真实媒体副作用；未触碰`media-desktop`。

## Exit decision

P9-03 PASS。Run freshness、bounded recovery、priority、terminal freeze与Handoff B accepted consume具备Owner-row重建、digest/revision/CAS、重放和crash atomicity。下一工作包为P9-04 Workspace registry, material admission and control。
