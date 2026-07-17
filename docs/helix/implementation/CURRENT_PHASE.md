# ShelfDeck Clean Helix Current Phase Execution Packet

Current phase: `P6 — Horizontal Domains`

Status: in progress；P6-00 next；P5 Exit Audit PASS；standing P2–P13 Local Implementation authorization active.

Last updated: 2026-07-17

## 1. Authority and authorization

本文件是唯一活动Phase详细执行包，从属于：

1. `../TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；
2. `../CURRENT_PLAN.md`；
3. `../ENGINEERING_PLAYBOOK.md`；
4. P2合同、P3 Persistence、P4 Execution Foundation与P5 Platform/Integration冻结Evidence。

SSOT仍是唯一架构Authority，本线程不得修改SSOT。P6只实现User Perception与People Management两个横向一级业务域；
二者拥有独立Store、Facade、Process和Projection，不位于Collection Formation主链，也不取得媒体事实或Material Control。

继续需要单独授权：真实来源E2E、Docker/Canary、production、真实媒体副作用和`media-desktop`。P6的Provider、文件与
Workspace行为只允许fake adapter、synthetic evidence和owned temp root。

## 2. Phase objective

在P3–P5 clean foundation上闭合User Perception与People Management：

- User Perception拥有Perception Acquisition、immutable Perception Record、dedup relation和按kind发布的
  `found|not_found` Resolution；
- People Management拥有Person Registry、Alias、Provider Identity、Preference、Reference Asset/Face、Registration/
  Merge Candidate及Merge Record；
- 两域只通过各自public Facade、versioned Result和Projection协作，异步工作使用P4 Supporting Work/Capability；
- 证明People不写Media-Cast Fact，Perception不拥有Content Identity/Subject/Shelf Entry，也不主动操纵消费者流程。

## 3. Baseline and protected workspace

| Field | Value |
| --- | --- |
| P0 code audit baseline | `4a16f0a94ef23fcf732843e9547bd7b724d9c19d` |
| P5 audited implementation | `5d3bdde07bd95d5b228f46a3be16c17ea8211209` |
| P5 Exit evidence | `evidence/P5_PHASE_EXIT_AUDIT_5D3BDDE0.md` / digest `88174039…` |
| P6 exact phase baseline | P6-00从P5 closure commit冻结 |
| Planned branch/worktree | `codex/helix-p6` / `E:\my_project\emby_third_party-helix-p6` |
| Original workspace | `E:\my_project\emby_third_party` on `master`；dirty user work preserved |
| Excluded | Procurement/Libra/Arca实现、product startup、API/Admin Web、E2E、Docker、production、真实来源/媒体、`media-desktop` |

## 4. SSOT traceability contract

| SSOT contract | P6 implementation obligation | Machine rejection |
| --- | --- | --- |
| §2.8、§3.6、§5.9.1–5.9.3 | immutable Record；Resolution每次只回答一个kind的`found|not_found`；不返回pending或原始Record集合 | 原地更新Record、跨kind聚合、consumer command/signal均失败 |
| §2.9、§3.7、§5.9.4–5.9.5 | Person identity/Preference/Reference/Candidate/Merge由People拥有 | Media-Cast、Subject、Shelf Entry或媒体Metadata写入均失败 |
| §4.6.2–4.6.4、§8.4.4–8.4.5 | 跨域只读Owner Resolution/Projection；Result带contract、revision、Evidence、freshness；`not_found`区别于调用失败 | Repository/internal import、null-not-found、反向修正Owner Fact均失败 |
| §8.2.4–8.2.5 | 精确建立两个Domain的public/application/planning/capabilities/persistence物理组件 | generic Store/Facade、共享Repository或Foundation Result充当业务Candidate均失败 |
| §8.5.1–8.5.2、§8.5.13 | Repository只注册`perception_`或`people_`表；显式head/revision、immutable rows与唯一性成立 | 越前缀SQL、`MAX(revision)`热路径、JSON越界和错误状态转换均失败 |
| §8.6.13–8.6.14 | 闭合5个Perception和8个People Capability；Effect Class、Fence、Result/Evidence与Owner一致 | 缺合同绑定、错误Effect Class、Executor跨域写或绕过Coordinator均失败 |

## 5. In scope

- `domains/perception/`与`domains/people/`的public/application/planning/capabilities/persistence实现；
- P2已冻结的7张`perception_`表与10张`people_`表对应P3 scoped Repository；
- Perception Source/Cursor、Acquisition、Record、Anchor、Dedup、Resolution Head/Revision；
- Person revision、Alias、Provider Identity、Preference、Reference Asset/Face、Registration/Merge Candidate、Merge Record；
- 5个Perception及8个People Capability Executor与P4 typed dispatch；
- Owner发布的Resolution/Person Reference Projection，以及synthetic跨域consumer contract fixture；
- isolated transaction/crash/replay、Owner和negative boundary verification。

## 6. Out of scope

- Procurement、Libra、Arca的Planner、Store、Fact或业务流程；
- People写Media-Cast Fact，或Perception建立Canonical Content Identity、Subject、Shelf Entry、Spec/Run/Case；
- Person Preference Beta产品规则/operator、Admin Web编辑器或自动Off-deck行为；
- UI read-model、113 Admin routes、Session/Auth和Composition Root产品接线；
- 真实Douban/Provider、人脸模型、FFmpeg、Worker、用户图片或媒体访问；
- legacy/Kairox/旧People/Metadata Store导入、迁移、兼容、dual path或fallback。

## 7. Work Package index

| ID | Title | Status | Dependencies |
| --- | --- | --- | --- |
| P6-00 | P5 closure and isolated P6 baseline receipt | next | P5 PASS |
| P6-01 | Horizontal-domain public ports and package guards | pending | P6-00；P2 contracts |
| P6-02 | User Perception scoped Store and atomic Repository | pending | P6-01；P3 Persistence |
| P6-03 | Perception Acquisition and immutable Record pipeline | pending | P6-02；P4–P5 |
| P6-04 | Perception dedup、Resolution and public query Facade | pending | P6-02–P6-03 |
| P6-05 | People Registry and Candidate scoped Repositories | pending | P6-01；P3 Persistence |
| P6-06 | Person Registration and Candidate lifecycle | pending | P6-05；P4–P5 |
| P6-07 | Person Merge and Preference lifecycle | pending | P6-05–P6-06 |
| P6-08 | Reference Asset/Face maintenance and Projection | pending | P6-05–P6-07；P5 Artifact/Workspace |
| P6-09 | Capability executors and Foundation runtime integration | pending | P6-03–P6-08；P4 contracts |
| P6-10 | Cross-domain Resolution/Projection boundary verification | pending | P6-04、P6-08–P6-09 |
| P6-11 | Horizontal-domain isolated integration harness | pending | P6-01–P6-10 |
| P6-12 | P6 Phase Exit Audit and evidence freeze | pending | P6-00–P6-11 |

## 8. Work Package contracts

### P6-00 P5 closure and isolated P6 baseline receipt

- Commit P5 Evidence、archive和P6 packet；freeze exact closure commit。
- 从closure创建独立`codex/helix-p6` worktree，重跑P5 Exit Audit并确认原dirty workspace与`media-desktop`未变。
- P6实现开始前记录branch、worktree、HEAD、SSOT blob/source-map和P2 aggregate。

### P6-01 Horizontal-domain public ports and package guards

- 仅发布`PerceptionCommandFacade`、`PerceptionResolutionFacade`、`PeopleCommandFacade`和
  `PersonReferenceQueryFacade`的nominal versioned contracts；不得暴露Repository、Transaction、generic query/command。
- 建立两个Domain的精确包依赖；互相只能依赖public Result/Projection contract，不能导入对方internal。
- 机器拒绝Media-Cast/Subject/Shelf Entry/Control写权限、内部HTTP、旧Store和共享horizontal Store。

### P6-02 User Perception scoped Store and atomic Repository

- Repository只注册7张`perception_`表；Source/Cursor、Record/Anchor/Relation、Resolution revision/head分别typed。
- Record、Anchor、Relation和Resolution Revision不可变；source current cursor和resolution head使用显式expected revision CAS。
- 固化rating `1..5`、source record唯一性、normalized relation pair、query contract/input digest/revision唯一性和payload bound。

### P6-03 Perception Acquisition and immutable Record pipeline

- Planner/Coordinator冻结Source、cursor/window、Integration handle、normalization contract和idempotency basis。
- `source.acquire`与`record.normalize`只产Evidence/Draft；`record.commit`在单一Domain事务内写Record、Anchor、cursor和Outbox。
- 同一来源重放收敛为同一commit result；纠错/retract/supersede追加新Record/Relation，不覆盖历史。

### P6-04 Perception dedup、Resolution and public query Facade

- Deduplicator/Resolver按强Identity优先规则消费immutable records与revisioned rule；不建立global content ID。
- `resolution.commit`以query contract/input digest expected head CAS原子写revision/head/outbox。
- Query一次只返回声明kind的`found|not_found`、providerDomain、contract/version、input anchors digest、revision、Evidence、
  resolvedAt和freshness；`not_found`、integration failure和invalid contract严格区分。

### P6-05 People Registry and Candidate scoped Repositories

- Repository只注册10张`people_`表，分别维护Person head/revisions、Alias、Provider Identity、Preference、Reference、Candidate和Merge。
- stable provider identity active unique；同evidence最多一个open Registration Candidate；normalized pair最多一个open Merge Candidate。
- Candidate不是Person；Foundation Work/Event Result不能被保存为待用户确认的People业务对象。

### P6-06 Person Registration and Candidate lifecycle

- Evidence Planner只读取typed Provider/Reference inputs并产生Registration Evidence/Candidate Draft。
- 自动注册仅允许同一stable Person ID或同namespace stable Provider Identity；同名/Alias/face similarity只能形成Candidate。
- 接受Candidate时由Registration Coordinator在原子事务中建立Person revision、identity facts、Candidate terminal和Outbox；
  dismiss/supersede不创建Person。

### P6-07 Person Merge and Preference lifecycle

- Merge Candidate使用normalized pair和immutable Evidence；接受Merge时保留target personId并形成唯一terminal Merge Record。
- preference冲突要求已有显式用户选择输入；工程实现不得自行决定可见业务结果。
- Person Preference revision只允许`-2..2`，由People拥有；不得直接改媒体事实、Shelf Entry或启动Off-deck。

### P6-08 Reference Asset/Face maintenance and Projection

- Reference Coordinator通过P5 Artifact/Workspace Handle导入、验证和回收Reference Asset/Face；Store只保存handle/digest/model ref。
- 大图片、embedding或模型payload不进入hot JSON/DB；Workspace reclaim使用exact Reference Evidence和P4 Effect recovery。
- `PersonReferenceQueryFacade`发布只读Person identity/reference Projection，带revision/freshness/provenance，不包含Media-Cast事实。

### P6-09 Capability executors and Foundation runtime integration

- 实现并注册SSOT §8.6.13的5个Perception与§8.6.14的8个People Capability，严格绑定P2 package digest。
- Executor只消费`CapabilityExecutionContext@1` named inputs和注入port，不持有Store/Facade/Planner/Runtime或generic Integration。
- `pure_observation|workspace_write|domain_fact_commit`分别走P4正确Effect recovery；简单同步Command可直接Domain transaction，
  不强制伪造Workflow。

### P6-10 Cross-domain Resolution/Projection boundary verification

- synthetic Libra/Arca consumer只能通过public Resolution/Projection读取；保存的Basis copy必须保留Owner/revision/digest而非改写Fact。
- Counterexample证明Perception不能push/interrupt/create Run/Case，People Candidate不能写Media-Cast，consumer不能写回Resolution/Person。
- Neutral Signal只允许durable wake-up/reconcile语义；丢失、重复、乱序不改变Canonical结果。

### P6-11 Horizontal-domain isolated integration harness

- 单一Node-only命令覆盖两个Domain的Repository、Facade、13 Capability、transaction/crash/replay和边界反例。
- 使用owned temp DB、fake Integration/Worker/clock和synthetic bytes；禁止Service startup、socket、ambient credential和真实文件/媒体。
- 同时回归P2 contract、P3 persistence、P4 runtime和P5 platform exit gates。

### P6-12 P6 Phase Exit Audit and evidence freeze

- 反向审计SSOT §2.8–2.9、§3.6–3.7、§4.6、§5.9、§8.2.4–8.2.5、§8.4–8.6与全部P6 Evidence。
- 证明Owner、Store prefix、Facade、Capability、Result/Projection、Effect recovery和cross-domain dependency全部闭合。
- 证明无Procurement/Libra/Arca Fact、Media-Cast、API/UI/startup、legacy、dual/fallback或真实外部效果进入P6。
- PASS后归档本包并在standing authorization下自动打开P7。

## 9. Execution order

~~~text
P6-00 → P6-01 ─┬→ P6-02 → P6-03 → P6-04 ─┐
               └→ P6-05 → P6-06 → P6-07 → P6-08 ─┤
                                                   ↓
                              P6-09 → P6-10 → P6-11 → P6-12
~~~

## 10. Exit criteria

P6只有同时满足以下条件才能PASS：

1. SSOT traceability覆盖两个Domain的Object/Process/Decision、组件、17张表、13个Capability及cross-domain合同；
2. 两域Repository前缀与Fact Owner隔离，所有revision/head/unique/state/transaction不变量有机器反例；
3. Perception只发布single-kind `found|not_found` Resolution；People只发布Person Reference Projection；
4. Media-Cast/Content Identity/Subject/Shelf Entry/Control和consumer process写入反例全部fail closed；
5. P2–P5回归与P6 isolated integration全部PASS，工作树内容clean；
6. `prohibitedActionsRun=[]`，SSOT未由本线程修改，无E2E/Docker/production/真实媒体/`media-desktop`动作；
7. 独立P6 Exit Audit `findings=[]`，Evidence冻结后才允许进入P7。

## 11. Stop conditions

- SSOT对Owner、Resolution语义、Person merge/preference冲突结果或Capability/transaction合同存在无法同时满足的矛盾；
- 实现看似必须让People写Media-Cast、让Perception拥有Content Identity或让consumer直接读Domain Store；
- 需要真实Provider、人脸模型、媒体副作用、E2E、Docker、production或`media-desktop`授权；
- 发现必须引入compatibility、dual path、legacy fallback或修改SSOT才能继续。

前三类中只有真正业务结果/SSOT冲突才上报用户；普通工程实现问题由Codex在本Phase内自主解决。
