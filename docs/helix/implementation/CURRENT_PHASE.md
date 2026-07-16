# ShelfDeck Clean Helix Current Phase Execution Packet

Current phase: `P4 — Execution and Recovery Foundation`

Status: in progress；P4-00–P4-01 complete；P4-02 next；P3 Exit Audit PASS；standing P2–P13 Local Implementation authorization active.

Last updated: 2026-07-16

## 1. Authority and authorization

本文件是唯一活动Phase详细执行包，从属于：

1. `../TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；
2. `../CURRENT_PLAN.md`；
3. `../ENGINEERING_PLAYBOOK.md`；
4. P2冻结的112/96/156/18合同与P3原子Persistence foundation。

SSOT仍是唯一架构Authority。用户授权Codex自主推进P2–P13 Local Implementation；每个Phase只有在traceability、
机器反例和Exit Audit全部PASS后才自动归档。不得修改SSOT，不得引入compatibility、dual path或旧Runtime fallback。

继续需要单独授权：真实来源E2E、Docker/Canary、production、真实媒体副作用和`media-desktop`。

## 2. Phase objective

在P3 clean Persistence之上实现纯clean Execution Foundation：Supporting Work、Work Attempt、immutable normalized Plan、
Workflow Event/Event Attempt、typed Capability dispatch、progress、Control Plane、Resource Governor、Retry/Timeout/Circuit和
按七种Effect Class恢复。Runtime只形成技术执行事实，不创建Business Process、Decision、Run、Case、Handoff或Owner事实。

P4的外部/文件/Provider/Worker效果全部由deterministic fake adapter与receipt模拟；不接产品startup或旧executor。

## 3. Baseline and protected workspace

| Field | Value |
| --- | --- |
| P0 code audit baseline | `4a16f0a94ef23fcf732843e9547bd7b724d9c19d` |
| P3 audited implementation | `5f433d930ba3111c19b1589816b96c790d60e5f3` |
| P3 Exit evidence | `evidence/P3_PHASE_EXIT_AUDIT_5F433D93.md` / digest `b7269dd7…` |
| Integration branch | `codex/helix-clean` |
| P4 phase baseline | `4a59356f3a89f1af38f594763aaaa0465e203b99` |
| P4 phase branch/worktree | `codex/helix-p4` / `E:\my_project\emby_third_party-helix-p4` |
| Original workspace | `E:\my_project\emby_third_party` on `master`；dirty user work preserved |
| Excluded | legacy Runtime/executors、product startup、API/UI、`media-desktop`、E2E、Docker/Canary、production、real effects |

## 4. In scope

- Foundation public Work Submission/Query/Health ports without Repository or generic dispatch exposure；
- exact 112 Capability Registry、contract/schema/Effect Class/Fence/Resource validation and typed dispatcher；
- Work Admission、Supply Controller、Scheduler and normalized Work/Plan/Event persistence；
- one Resource Governor capacity Owner、atomic Permit bundle、bounded waiter/defer and profile mapping；
- Event Attempt、typed ExecutionContext、Fence、Progress、Outcome and Result binding；
- seven Effect Class journals/reconcilers、Retry/Timeout/Compensation and startup recovery；
- Pressure Guard、Circuit Breaker、readiness and invariant diagnostics；
- isolated local crash/recovery fixtures using P3 DB and fake clocks/adapters only。

## 5. Out of scope

- real Domain Planner、Automation、Reconciler or Business Decision；
- real Capability executor implementation、Provider/FFmpeg/Worker/filesystem/network adapter；
- real Workspace/Secret/Mount/Artifact/Worker registries（P5）；
- product Composition Root、Service startup、HTTP/API/Admin Web、`media-desktop`；
- old Kairox/Task scheduler、flow、executor、queue、resource runtime or data；
- E2E、Docker/Canary、production、real media and any external side effect。

P4不形成“可运行半成品产品”；所有Runtime fixture必须在isolated temp DB中完成并销毁。

## 6. Work Package index

| ID | Title | Status | Dependencies |
| --- | --- | --- | --- |
| P4-00 | P3 closure and isolated P4 baseline receipt | complete | P3 PASS |
| P4-01 | Foundation public ports and runtime nominal contracts | complete | P4-00 |
| P4-02 | Exact Capability Registry and typed dispatcher gate | next | P4-01；P2 Capability contracts |
| P4-03 | Supporting Work admission and idempotent submission | pending | P4-01；P3 Persistence |
| P4-04 | Immutable normalized Plan and DAG validator | pending | P4-02–P4-03 |
| P4-05 | Work Supply Controller and bounded backpressure | pending | P4-03–P4-04 |
| P4-06 | Work Scheduler、dependency readiness and technical lease | pending | P4-04–P4-05 |
| P4-07 | Resource Governor、Profile Mapper and atomic Permit bundle | pending | P4-05–P4-06 |
| P4-08 | Event Runtime、Fence、Outcome/Result and Progress | pending | P4-02、P4-06–P4-07 |
| P4-09 | Effect Journal and seven Effect-specific reconcilers | pending | P4-08；P3 atomic commits |
| P4-10 | Retry、Timeout and declared Compensation | pending | P4-08–P4-09 |
| P4-11 | Pressure Guard and persistent Circuit Breaker | pending | P4-05–P4-10 |
| P4-12 | Startup recovery and Foundation readiness | pending | P4-09–P4-11 |
| P4-13 | Cross-runtime crash/recovery verification harness | pending | P4-01–P4-12 |
| P4-14 | P4 Phase Exit Audit and evidence freeze | pending | P4-00–P4-13 |

## 7. Work Package contracts

### P4-00 P3 closure and isolated P4 baseline receipt

- Fast-forward the accepted P3 closure to `codex/helix-clean` and create an isolated P4 branch/worktree from that exact commit.
- Re-run `P3_LOCAL_CROSS_PERSISTENCE` and P3 Exit Audit in fresh checkout；verify original dirty workspace remains unchanged.
- Record exact closure baseline before Runtime code begins.
- Done: `codex/helix-clean` was fast-forwarded and isolated `codex/helix-p4` / `E:\my_project\emby_third_party-helix-p4`
  was created from exact P3 phase closure `4a59356f3a89f1af38f594763aaaa0465e203b99`. The P3 aggregate gate in the
  new checkout restored 112/96/156/18、156 tables/72 indexes/19 partial unique、18 transactions/132 crash points and
  `prohibitedActionsRun=[]`. Original `master` dirty files and all six existing `media-desktop` modifications remain unchanged；
  P4 worktree was clean before this receipt and no Runtime code started early.

### P4-01 Foundation public ports and runtime nominal contracts

- Publish only Work Submission/Query、typed Registry provider、Command/Control and Foundation Health contracts.
- Freeze Work/Attempt/Plan/Event/Progress/Outcome/Effect Journal nominal state machines and transition ownership.
- Public package must not expose Repository、SQLite、Executor instance or `dispatch(name,payload)`.
- Done: commit `4a9b5a59` closes the P1 skeleton gap by adding SSOT-required `foundation.public` as the 43rd guarded package，
  exposing exactly seven frozen ports and rejecting missing/extra Repository、SQLite、Executor or generic dispatch methods. Runtime
  contracts freeze the exact P2 Work/Attempt/Event/Effect/Defer/Circuit enums、four Plan Resolutions、five priority classes and seven
  Effect Classes；tests derive those sets from the 156 table and 112 Capability contracts. Supporting Work Definition is exact、bounded、
  owner-scoped and accepts only opaque dependency/material references，not preselected Capability/Executor/flow/path. Eight focused groups、
  the complete 218-test architecture gate and fresh detached-worktree gate PASS；SSOT/P2 contract aggregate unchanged and no persistence/
  Runtime behavior or product wiring entered the public package.

### P4-02 Exact Capability Registry and typed dispatcher gate

- Register exactly frozen `capabilityRef@version` contracts；bind immutable scope、Effect Class、schemas、Fence、Resource and executor identity.
- Catalog visibility is Domain + explicitly Shared only；no recommendation、fallback、version substitution or historical flow routing.
- Unknown/unavailable contract、schema drift or executor mismatch fails before Work/Event supply.

### P4-03 Supporting Work admission and idempotent submission

- Admission validates typed definition、Owner scope、basis/fence、idempotency、active-scope uniqueness、hard cap and circuit state.
- It creates technical Supporting Work only；never creates Business Process or chooses a Capability.
- Same key/same digest replays；same key/different digest and concurrent duplicate scope reject atomically.

### P4-04 Immutable normalized Plan and DAG validator

- One Work Attempt owns exactly one immutable Plan Resolution；only `planned` contains executable normalized nodes/dependencies/bindings.
- Validate acyclic graph、exact Capability versions、typed bindings、Effect Class non-escalation、resource demand and compensation declaration.
- Plan JSON is bounded parameters only；hot state/dependency/result binding remains relational.

### P4-05 Work Supply Controller and bounded backpressure

- Control only open Work、active Work Attempt and dispatch supply counts；do not plan、schedule or decide capacity.
- Stable defer projection prevents queue oscillation；reserve progress for safety/handoff/control and minimum background work.
- Backpressure never deletes Work、reverses Handoff or changes Business priority.

### P4-06 Work Scheduler、dependency readiness and technical lease

- Select only admitted Work and dependency-satisfied ready Events using business priority class、local priority、retryAt、aging and FIFO.
- Scheduler does not read Domain policy/spec/content facts and does not decide Permit capacity or Capability substitution.
- Technical lease is fenced/expiring and never substitutes Reservation、Material Control or Authorization.

### P4-07 Resource Governor、Profile Mapper and atomic Permit bundle

- One in-process Governor is the sole capacity Owner；multi-resource demand acquires atomically or acquires nothing.
- One waiter per Event、bounded queue、durable resource defer with retryAt；all permits release in `finally` and disappear on restart.
- Profile mapping changes only capacity/supply/weights，never Plan、priority、Outcome、Authorization or Control.

### P4-08 Event Runtime、Fence、Outcome/Result and Progress

- Create one Event Attempt opportunity, revalidate minimum Basis/Fence before dispatch and again before protected commits.
- Build least-authority typed ExecutionContext；validate exact inputs/parameters/Outcome/Result/Evidence and immutable Result binding.
- ProgressReporter writes bounded monotonic technical samples only；progress cannot extend auth、change result or create Business facts.

### P4-09 Effect Journal and seven Effect-specific reconcilers

- Persist intent/started/external receipt/commit marker/reality evidence/terminal reconciliation without pretending external atomicity.
- Implement deterministic recovery decisions for all seven Effect Classes：safe retry、reuse/cleanup、external observe、marker/revision check、
  whole responsibility/control check、forward/declared rollback、forward-only destruction.
- Unknown Effect Class or missing evidence remains blocked/faulted and cannot return to ordinary Work supply.

### P4-10 Retry、Timeout and declared Compensation

- Event Attempt and Work Attempt budgets remain separate；retry cannot change inputs、Capability version、Effect Class、scope or auth.
- Timeout isolates execution、releases permits，then reconciles Effect；it ends an Attempt, not Business responsibility.
- Compensation must be predeclared Plan node and contract-bound；Runtime cannot invent generic rollback or rewrite canonical facts.

### P4-11 Pressure Guard and persistent Circuit Breaker

- Detect hard-cap、duplicate waiter、state oscillation、commit/fence/control invariant、write-rate、permit leak and starvation evidence.
- Breaker blocks new normal/background and unstarted commit-capable effects in affected scope while preserving diagnostics、reconcile and
  irreversible forward recovery；restart cannot clear it.
- Closing requires invariant restoration plus explicit reconcile evidence；never queue deletion or fabricated success.

### P4-12 Startup recovery and Foundation readiness

- Scan durable nonterminal Work/Event/Effect/defer/circuit facts and classify by exact Effect Class before any normal supply.
- Never reset all `executing` to `ready`；recover no in-memory permit/waiter/lease across restart.
- Foundation readiness is fail-closed on unknown contracts/effects、orphan facts、integrity/fence/control drift or unavailable required reconciler.

### P4-13 Cross-runtime crash/recovery verification harness

- One local command verifies all state machines、Owner/port guards、DAG、priority/backpressure、Permit、Fence、Progress and seven recoveries.
- Inject crash before/after durable transitions and fake effect boundaries；reopen disposable DB and prove stable recovery/no duplicate effect.
- Harness cannot start Service、bind ports、read credentials、invoke old Runtime/E2E/Docker or perform real effects.

### P4-14 P4 Phase Exit Audit and evidence freeze

- Reverse-audit against SSOT Levels 6–8/10 and P2/P3 contracts, including unknown Effect and least-authority execution.
- Prove no Business Domain/API/UI/P5 adapter、legacy runtime、dual path or real side effect entered P4.
- PASS archives this packet and opens P5 under standing authorization.

## 8. Execution order

```text
P4-00 → P4-01 → P4-02 → P4-03 → P4-04 → P4-05 → P4-06 → P4-07
                                                    └──────────────→ P4-08 → P4-09 → P4-10
                                                                              └→ P4-11 → P4-12 → P4-13 → P4-14
```

## 9. Exit Gate

P4只有同时满足以下条件才能PASS：

1. Work/Attempt/Plan/Event/Progress/Effect/Circuit状态与Owner合同完整且非法转换fail closed；
2. 112 exact Capability contracts可见性、schema、Effect Class、Fence和typed dispatch闭合；
3. Admission、Supply、Scheduler、Governor四项责任不可互相越权；
4. multi-resource Permit原子且无泄漏/重复waiter，backpressure稳定；
5. 七种Effect Class全部覆盖unknown crash recovery，unknown Effect不进入普通供给；
6. retry/timeout/compensation不改变Business Basis/Scope/Authorization且startup不统一reset；
7. P3 gate、P4 integrated gate和fresh-worktree Exit Audit全部PASS；
8. 未触碰SSOT、E2E/Docker/production/real effects/`media-desktop`。

## 10. Stop conditions

仅在SSOT真实冲突、Business Owner/Outcome/Handoff/Authorization需改变，或必须扩大到外部授权范围时询问用户。
Runtime状态机、SQLite Repository、fake adapter、测试和性能工程选择由Codex自主处理。
