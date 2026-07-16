# ShelfDeck Clean Helix Current Phase Execution Packet

Current phase: `P3 — Persistence and Atomic Foundation`

Status: complete；P3-00–P3-10 complete；P3 Exit Audit PASS；standing P2–P13 Local Implementation authorization active.

Last updated: 2026-07-16

## 1. Authority and authorization

本文件是唯一活动Phase详细执行包，从属于：

1. `../TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；
2. `../CURRENT_PLAN.md`；
3. `../ENGINEERING_PLAYBOOK.md`；
4. P2冻结的112/96/156/18 machine-readable contract baseline。

用户授权Codex自主推进P2–P13 Local Implementation。每个Phase在SSOT traceability、机器反例和Exit Audit全部PASS
后自动归档并进入下一Phase。不得修改SSOT，不得引入compatibility、dual-read/write/run或旧Runtime fallback。

继续需要单独授权：真实来源E2E、Docker/Canary、生产、真实媒体副作用和`media-desktop`。

## 2. Phase objective

以P2合同为唯一实现输入，建立clean `shelfdeck.db`的Persistence与原子提交基础：156表clean schema、唯一SQLite
Kernel、Owner-scoped Repository/Unit of Work、Commit Marker、Command Receipt、Outbox/Inbox、Audit与Material Control CAS。
18项canonical transaction必须在隔离临时数据库中证明“全部成立或全部不成立”。

P3不实现Work/Event Runtime、Domain业务行为、HTTP/API/UI，也不接旧产品Composition Root。

## 3. Baseline and protected workspace

| Field | Value |
| --- | --- |
| P0 code audit baseline | `4a16f0a94ef23fcf732843e9547bd7b724d9c19d` |
| P2 audited closure | `a735781010ee58c4119d93bb320bfe11bf1d4b7f` |
| P3 implementation baseline | `e3b50f946956105b18ffcf0853c8c2a57ebb4db8` |
| Integration branch | `codex/helix-clean` |
| Phase branch/worktree | `codex/helix-p3` / `E:\my_project\emby_third_party-helix-p3` |
| Original workspace | `E:\my_project\emby_third_party` on `master`；dirty user work preserved |
| Excluded | `media-desktop`、E2E、Docker/Canary、production、real media、legacy data migration |

## 4. In scope

- deterministic clean DDL compilation from 156 P2 table contracts；
- one SQLite Kernel and clean schema generation marker；
- Owner-scoped Repository ports and Unit of Work；
- Command Receipt、Commit Marker、Audit、Outbox/Inbox/Delivery；
- Material Control current row/revision CAS；
- typed Domain/Control/Foundation CommitParticipant registry；
- 18 canonical transaction atomic/crash fixtures on disposable local DBs；
- foreign-key、partial-unique、JSON/check/index and startup integrity validation。

## 5. Out of scope

- old DB migration、import、dual-read/write、compatibility views or fallback；
- Runtime Work/Plan/Event/Effect execution and recovery loop；
- real Domain aggregate behavior、Planner、Capability executor、Facade；
- server startup wiring、HTTP、Admin Web、`media-desktop`；
- real filesystem/media/network effects；
- E2E、Docker、Canary or production。

所有数据库fixture必须使用临时目录并在测试结束后销毁；不得打开原工作区`data/`或生产数据库。

## 6. Work Package index

| ID | Title | Status | Dependencies |
| --- | --- | --- | --- |
| P3-00 | P2 closure and isolated P3 baseline receipt | complete | P2 PASS |
| P3-01 | Deterministic 156-table clean DDL compiler | complete | P3-00；P2 tables |
| P3-02 | SQLite Kernel and clean schema generation gate | complete | P3-01 |
| P3-03 | Owner-scoped Repository and Unit of Work boundaries | complete | P3-02 |
| P3-04 | Commit Marker、Command Receipt and Audit foundation | complete | P3-03 |
| P3-05 | Outbox、Delivery and Inbox atomic foundation | complete | P3-03–P3-04 |
| P3-06 | Material Control CAS current/revision participant | complete | P3-03–P3-04 |
| P3-07 | Typed Domain Commit Registry and participant coordinator | complete | P3-03–P3-06 |
| P3-08 | 18 canonical transaction crash-window fixtures | complete | P3-07 |
| P3-09 | Cross-persistence verification harness | complete | P3-01–P3-08 |
| P3-10 | P3 Phase Exit Audit and evidence freeze | complete | P3-00–P3-09 |

## 7. Work Package contracts

### P3-00 P2 closure and isolated P3 baseline receipt

- Fast-forward P2 closure into `codex/helix-clean` and create clean P3 branch/worktree from the exact commit.
- Re-run frozen P2 contract gate and verify original dirty workspace/`media-desktop` remain untouched.
- Record exact baseline; no Persistence code starts before receipt PASS.
- Done: `codex/helix-clean` and isolated P3 worktree start at exact closure
  `e3b50f946956105b18ffcf0853c8c2a57ebb4db8`；fresh checkout P2 gate is 112/96/156/18 PASS，191 refs / 0 unresolved，
  original aggregate `ebbfda8885837170d48a0feb8f3aaad9a32aa35c44dc2db21704f820a6e3fc4a`；original dirty workspace unchanged.
  P3-02的SSOT §8.5.9预审随后发现table semantic baseline不足，已由`d96464a7`修正并以新aggregate
  `aab78271f712df7714233f0a79e24453e0c1a85c5d214ebf926dc6e71adba247`重新闭合；详见
  `evidence/P2_TABLE_CONTRACT_SEMANTIC_REPAIR_D96464A7.md`。

### P3-01 Deterministic 156-table clean DDL compiler

- Compile only P2 table contracts into deterministic SQLite DDL, checks, indexes and FK declarations.
- Emit no legacy table/view/trigger and no migration from old Runtime facts.
- Every table/index/check maps back to one P2 contract and digest; unsupported contract shapes fail closed.
- Done: implementation commits `c5b0822e` + `faf9fe48` + semantic repair `d96464a7` deterministically emit 156 clean tables and 72 indexes, including all 19 P2
  partial-unique rules；three cross-table predicates use explicit technical guard columns with rule trace and no new Business Owner/fact.
  final DDL digest `98e50feb79165844951ab5133f383eedc82848e83b0e4a2c4a58059121548b11`；156/156 generated table traces
  retain the repaired exact P2 contract digest；57 closed state enums、168 SHA-256 checks、revision `>=1`及positive/negative compiler checks
  （含Windows fresh-checkout行尾复现）和完整clean architecture gate PASS。No SQLite
  connection、startup wiring、legacy schema、view、trigger or historical data path was introduced.

### P3-02 SQLite Kernel and clean schema generation gate

- Implement the only SQLite connection/transaction Kernel with required PRAGMA and same-commit timestamp injection.
- Validate schema generation、Catalog digest、`foreign_key_check` and partial-unique self-check before writable use.
- Tests use disposable databases only；no server startup wiring or local `data/` access.
- Done: commit `63e96c0e` opens only the caller-supplied clean path through the sole Kernel constructor；requires WAL、
  `foreign_keys=ON`、NORMAL synchronous and 5000 ms busy timeout；initializes exactly one `helix-clean-v1` marker and validates
  156 tables、72 indexes、19 partial unique indexes、Catalog digest、`integrity_check`、`foreign_key_check` and three cross-table
  guard projections before writable use. Five fixture groups prove same-commit time、commit/rollback、nested rejection、legacy/mixed
  refusal、DDL/marker/catalog/partial-index tamper refusal、FK corruption and guard drift. Fresh detached-worktree full gate PASS；all
  databases were temporary and deleted；no startup wiring or local `data/` access.

### P3-03 Owner-scoped Repository and Unit of Work boundaries

- Expose scoped transaction contexts that can obtain only declared Owner/Foundation/Control participants.
- Repository cannot write another aggregate/table set；Foundation cannot obtain Domain Repository.
- Negative fixtures reject undeclared table、cross-Domain write、nested authority escape and raw SQL outside the Kernel/compiler.
- Done: commit `e17e109e` adds manifest-bound Repository definitions whose SQL is generated only from registered Owner/table/column
  statements；immutable UPDATE and arbitrary SQL are not representable. `SqliteUnitOfWork` permits at most one Business Domain plus
  separately scoped Control/Foundation participants, injects one commit time and expires every participant context after synchronous use.
  Seven focused positive/negative fixtures plus a production-source persistence guard reject cross-Domain authority、Foundation→Domain
  Repository、unknown table/column/statement、raw driver/Kernel/SQL access、async/nested/context escape and prove full rollback. Fresh
  detached-worktree gate and DDL rematerialization-zero-diff PASS；all DBs were disposable.

### P3-04 Commit Marker、Command Receipt and Audit foundation

- Commit Marker is immutable and globally unique；Audit is append-only.
- Command Receipt is written with Owner modification and enforces same-key/same-digest replay vs same-key/different-digest rejection.
- No receipt can survive without its canonical fact set.
- Done: commit `14b0e89c` adds a command coordinator that checks Receipt under the same `BEGIN IMMEDIATE` before Domain execution：
  same key/same digest returns the stored typed Result without Domain work，while same key/different digest fails stably. First execution
  orders Owner participant before same-transaction Receipt、globally unique immutable Commit Marker and append-only Audit. Six fixture
  groups prove one commit time、stable replay、digest conflict preemption、Domain crash rollback、Marker/Audit/16 KiB Result failure
  rollback and no UPDATE/DELETE registration for Marker/Audit. Fresh detached-worktree full gate PASS；all DBs were disposable.

### P3-05 Outbox、Delivery and Inbox atomic foundation

- Freeze intended consumers in the producer transaction；Delivery/Inbox dedup is durable.
- Ack/retry state never changes canonical Domain ownership and cannot write consumer Domain facts directly.
- Crash fixtures cover commit-before-dispatch、duplicate delivery and consume-before-ack.
- Done: commit `fed454cb` freezes sorted, non-empty intended consumers and one Delivery row per consumer in the producer Owner transaction；
  payloads are canonical, 16 KiB-bounded ID/revision/digest references. Inbox consumption commits Consumer Domain fact and durable dedup
  together；ack remains a later Foundation transaction so consume-before-ack recovers by replay without repeating Domain work. Delivery
  retry/ack never receives Domain Repository authority. Six fixture groups prove producer/inbox dedup rollback、duplicate delivery、
  consume-before-ack、last/duplicate ack and startup rejection of consumer-set or ack-without-Inbox tampering. Fresh detached-worktree full
  gate PASS；all DBs were disposable.

### P3-06 Material Control CAS current/revision participant

- Enforce one current Control per Physical Material Identity and append-only revision history.
- Acquire/transfer/release/replace require expected revision and exact scope digest；failed CAS rolls back all participants.
- Material Identity、Binding and Control remain separate；no global media business ID is introduced.
- Done: commit `f3ec7a81` recomputes `materialKey` from the canonical Physical Material tuple and validates exact Handle operation、
  expected revision set and control-scope digest before issuing CAS. Acquire、cross-Domain transfer、release and mixed
  `replace_control_set` update one current row and append one immutable revision per changed Identity；no Binding/Domain fact is created.
  Five fixture groups prove full lifecycle、stale/wrong-scope rollback across Domain/Foundation participants、multi-Identity atomicity、
  invalid Identity/expected set/scope digest rejection and startup current/history drift refusal. Fresh detached-worktree full gate PASS；
  all DBs were disposable.

### P3-07 Typed Domain Commit Registry and participant coordinator

- Resolve only manifest-declared Owner/fact schema handles；no generic SQL participant or Executor Repository access.
- Coordinate Domain、Material Control and Foundation participants inside one Kernel Unit of Work.
- Handoff participants cannot obtain or write upstream Store.
- Done: commit `d7f27848` adds a deterministic typed Registry keyed by exact Owner、aggregate/fact type and nominal fact schema；
  every entry must predeclare `domain_fact_commit` Effect Class and a Domain revision fence. Handle/payload digest、participant Owner and
  bound Business Owner are fail-closed；the coordinator accepts no caller-supplied Repository、SQL or generic participant，and composes only
  Registry-resolved Domain、optional Material Control、immutable Commit Marker and same-Owner Outbox inside one scoped Unit of Work.
  Six fixture groups prove deterministic registration、atomic fact/marker/outbox replay、unknown schema/payload/Owner rejection、revision
  rollback、marker conflict preemption and optional Control CAS all-or-nothing. Full gate and fresh detached-worktree gate PASS；all DBs were
  disposable，SSOT/contract digests unchanged，no Runtime/API/UI/startup or upstream Store write path was introduced.

### P3-08 18 canonical transaction crash-window fixtures

- Implement all P2 transaction contracts on disposable DBs with fault injection before/after every participant and commit boundary.
- Assert all-or-nothing fact sets、fences、CAS、receipt/outbox and forbidden write sets.
- Filesystem/Provider effects remain mocked receipts；no real media side effect.
- Done: commit `6bbf66ff` drives one test-only fault harness directly from the frozen 18-contract inventory and changes every one of
  the 56 declared write tables through scoped Repository、actual Material Control and actual Outbox participants. It covers 132
  before/after-participant and pre-COMMIT crash points、18 revision-fence failures、10 stale Control CAS failures and post-COMMIT
  process-loss/reopen for every transaction；11 Outbox contracts use durable Outbox/Delivery writes. Every rollback compares complete
  table snapshots，every successful post-COMMIT recovery proves the full declared write set changed，and forbidden tables/prefixes—including
  Procurement/Libra upstream Stores at Handoff—remain unchanged. 66/66 focused tests、full gate and fresh detached-worktree gate PASS；
  all DBs were disposable and no filesystem、Provider、network、Runtime、API/UI or real-media effect was invoked.

### P3-09 Cross-persistence verification harness

- One local command validates DDL digest、156 tables、FK/check/index contracts、Owner write gates and 18 atomic fixtures.
- Harness fails on legacy schema、compatibility object、unknown table/participant or DB path outside its temp root.
- It must not start Service、bind port、read credentials or invoke E2E/Docker.
- Done: commit `bb8a797d` adds the single `npm run test:helix-persistence` / `node scripts/helix-p3-persistence-verify.js`
  gate with explicit `P3_LOCAL_CROSS_PERSISTENCE` scope. It runs the full clean architecture/contract/Owner/atomic fixture gate，then
  independently rematerializes an exact 156-table、72-index、19-partial-unique catalog under an owned temporary root and reports the
  signed DDL/P2 aggregates. Five focused fixture groups reject outside/equal/non-DB paths、unknown participant modules、legacy tables、
  compatibility views and external-action entry points；child execution receives only `NODE_ENV/NODE_PATH`，not ambient credentials.
  Focused gate、aggregate command and fresh detached-worktree command all PASS；temporary DB root is removed and prohibited actions are empty.

### P3-10 P3 Phase Exit Audit and evidence freeze

- Reverse-audit from P2/SSOT contracts rather than implementation file counts.
- Prove no Runtime/Domain/API/UI behavior、legacy migration、dual path or external side effect entered P3.
- PASS archives this packet and opens P4 under standing authorization.
- Done: audit implementation commit `5f433d930ba3111c19b1589816b96c790d60e5f3` was checked from P3 baseline
  `e3b50f942a647e91d7147eac8feeedbf0e9b49d9`. The single P3 aggregate gate and `--require-clean` reverse audit both
  passed again in a fresh detached worktree：111 changed files fell only into six allowed classes，findings=0，SSOT、Runtime、
  Domain/API/UI、E2E/Docker/production、real media and `media-desktop` were untouched. Evidence digest is
  `b7269dd77b5d7d41cbd45cb80834f79254b1b1a7410834d80bc3e697c08260e1`；details are frozen in
  `../evidence/P3_PHASE_EXIT_AUDIT_5F433D93.md`.

## 8. Execution order

~~~text
P3-00 → P3-01 → P3-02 → P3-03 → P3-04 ─┬→ P3-05 ─┐
                                           └→ P3-06 ─┴→ P3-07 → P3-08 → P3-09 → P3-10
~~~

## 9. Exit Gate

P3只有同时满足以下条件才能标记PASS：

1. 156/156 schema contracts编译并通过SQLite integrity/FK/index/check验证；
2. 唯一Kernel与Owner-scoped UoW没有跨Owner raw SQL escape；
3. Command Receipt、Commit Marker、Audit、Outbox/Inbox和Material Control CAS负例全部通过；
4. 18/18 canonical transaction在fault injection下全成或全不成；
5. clean DB不包含legacy/compatibility/dual objects，不读取旧Runtime data；
6. P2 contract gate和P3 persistence gate均PASS；
7. Exit Audit确认未触碰SSOT、E2E、Docker/production、real media或`media-desktop`。

## 10. Stop conditions

只有以下情况暂停并询问用户：

- P2合同无法唯一实现且与SSOT发生真实冲突；
- 需要改变Business结果、Owner、Handoff或不可逆授权；
- 需要扩大到E2E、Docker/Canary、production、real media或`media-desktop`。

普通SQLite/DDL/Repository/测试工程选择由Codex自主处理。

## 11. Closure

P3 Exit Gate 1–7全部PASS。本执行包已冻结归档；P4依据standing Local Implementation authorization自动打开。
