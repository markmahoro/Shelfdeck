# P7-05 Run Admission、Seal 与 Retry Evidence

Status: PASS

Date: 2026-07-18

## 1. SSOT traceability

| SSOT contract | Local realization |
| --- | --- |
| §6.3.2、§8.6.18 `ProcurementRunExecutionBasis` | 完整`1..1024`成员的Field/Access/terminal Observation/Policy/Triage/Binding/Eligibility/Reality/Control basis，关系化保存并可重建 |
| §8.6.18 Run Admission | 一个SQLite UoW内重读current head/member、取得或assert同Field Control、写Run/Selection、typed `ProcurementControlReceipt`和marker；零Outbox |
| §6.3.3、§8.6.18 Run Seal | expected revision/basis CAS；Candidate Reservation与released terminal member完整覆盖；failed seal释放Selection但保留Procurement Control |
| §8.6.18 Retry Intent Commit | failed sealed Run的精确`released+triage_failed`scope、current head/member precondition、open Intent、Receipt/marker和唯一Procurement内部Outbox同事务成立 |
| §8.6.18 Retry Admission | open Intent revision/digest CAS；全部consume snapshots；`stale`不建Run/不改Control，`consumed`与唯一新Run/Selection/Control/outer Result同事务成立 |

## 2. Implementation receipts

- `5fdbcb8f`：ordinary Run Admission与完整Basis/Selection/Control Receipt。
- `90afe83f`：Run Seal、terminal member Evidence和Selection release。
- `dcf2fb87`：Retry formal DTO、Intent create、业务幂等重放和内部Outbox。
- `3b2f4db5`：Retry consume的stale/created两分支、共享marker/result、新Run continuity及机器FK纠偏。
- 本实现线程未编辑`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`。

## 3. Machine counterexamples

- stale Field/Access/Observation/Policy/Rule或member Binding/Eligibility/Selection/Control不能建立Run。
- Control冲突使Run、Selection、Control、Result和marker全部回滚。
- same-Field Control只执行`assert_same_field`，不伪造release/acquire revision。
- failed Seal释放Selection但不释放Field-scope Procurement Control。
- 相同`fieldId+idempotencyKey`即使换技术marker也只重放原Intent Receipt。
- Retry stale reason使用13项closed precedence；head reason优先于member drift，全部member保存immutable consume snapshot。
- 任一member stale使整个Intent stale，零新Run、零Control变化、零consume Outbox。
- 全部matched时只建立一个`retry_intent_id`唯一关联的新Run；Intent和Run保存相同consume/admission marker及outer result digest。
- Retry Access/Observation/Policy、create/consume marker及Intent↔Run连续性均有显式FK；循环link为`DEFERRABLE INITIALLY DEFERRED`。

## 4. Verification

- Focused unit/contract/isolated SQLite：PASS。
- Full `node scripts/helix-architecture-verify.js`：PASS；564 tests，83 clean source files，122 dependencies，1510 semantic files，`findings=[]`。
- Contract baseline：112 Capability / 96 Result family / 162 tables / 30 canonical transactions；aggregate `a53d55146ff40db11d82e188757e383f81960e7fdddaceed01ab094020641c32`。
- 禁止动作：`prohibitedActionsRun=[]`；未运行E2E、Docker、Canary、production或真实媒体副作用；未触碰`media-desktop`。

## 5. Exit conclusion

P7-05 PASS。Run、Seal和Retry没有引入新Owner、跨Domain Store、兼容层、dual path或旧Runtime fallback；可以进入P7-06 Triage evidence pipeline。
