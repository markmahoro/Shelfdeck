# ShelfDeck Clean Helix Current Phase Execution Packet

Current phase: `P2 — Contract and Schema Baseline`

Status: in progress；P2-00–P2-02 complete；P2-03 next；standing P2–P13 Local Implementation authorization active.

Last updated: 2026-07-16

## 1. Authority and authorization

本文件是唯一活动Phase详细执行包，从属于：

1. `../TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；
2. `../CURRENT_PLAN.md`；
3. `../ENGINEERING_PLAYBOOK.md`。

用户授权Codex自主推进P2–P13 Local Implementation。每个Phase在SSOT traceability、机器反例和Exit Audit全部PASS
后，可自动归档并进入下一Phase。不得修改SSOT，不得引入compatibility、dual-read/write/run或旧Runtime fallback。

继续需要单独授权：真实来源E2E、Docker/Canary、生产、真实媒体副作用和`media-desktop`。只有真实业务决策或
SSOT冲突向用户提问；工程选择由Codex负责。

## 2. Phase objective

把SSOT中已经Accepted的Capability、Result、relational table和canonical transaction合同转换为版本化、可计算
digest、可由机器闭合引用的P2 contract/schema baseline。P2只冻结“后续实现必须满足什么”，不实现Repository、
SQLite Kernel、Runtime、Domain行为、API或UI。

P2完成时必须成立：

- 112/112 Capability ref各有唯一immutable v1 contract package；
- 96/96 Result family和全部shared handle/envelope具有JSON Schema 2020-12定义；
- 156/156 table具有Owner、prefix、columns、PK/FK、unique/index、revision/current-pointer、JSON limit和SSOT locator；
- 18/18 canonical transaction具有Owner、participant、atomic fact set、required tables和crash fixture contract；
- 所有`$ref`、Owner、Effect Class、Fence、Resource Demand、Approval/Authorization和transaction/table引用闭合；
- Catalog、Schema和transaction aggregate digest稳定；
- P3可以只按P2合同实现Persistence，不需要重新解释SSOT或借用旧Schema。

## 3. Baseline and protected workspace

| Field | Value |
| --- | --- |
| P0 code audit baseline | `4a16f0a94ef23fcf732843e9547bd7b724d9c19d` |
| P1 closure / P2 implementation baseline | `c52e67fa2b49c605d0971f2150238ea37c50816a` |
| Integration branch | `codex/helix-clean` |
| Phase branch | `codex/helix-p2` |
| Phase worktree | `E:\my_project\emby_third_party-helix-p2` |
| Original workspace | `E:\my_project\emby_third_party` on `master`；dirty user work preserved |
| Excluded | `media-desktop`、user analysis script、E2E/Docker/production/real media |

## 4. In scope

- machine-readable SSOT source locators and extraction fixtures；
- shared nominal types、handles、Outcome/envelopes；
- 112 Capability v1 package manifests and referenced schemas；
- 96 Result family schemas；
- 156 relational table contracts；
- 18 canonical transaction contracts；
- digest、duplicate、count、Owner、Effect、reference and schema validation；
- isolated contract tests and Phase Exit Evidence。

## 5. Out of scope

- DDL execution、migration、database connection、Repository or UoW implementation；
- Work/Event/Effect Runtime、Resource Governor or recovery loop；
- Domain aggregate behavior、Facade、Planner or Capability executor；
- HTTP route、Auth、Projection or Admin Web；
- old schema migration、dual-read/write、fallback or cutover；
- real filesystem/media/network effects。

P2 Schema是实现合同，不是可运行数据库。不得创建空壳Repository、伪成功Executor或为了测试而连接旧Store。

## 6. Work Package index

| ID | Title | Status | Dependencies |
| --- | --- | --- | --- |
| P2-00 | Standing authorization and isolated baseline receipt | complete | P1 PASS |
| P2-01 | SSOT extraction oracle and source map | complete | P2-00 |
| P2-02 | Shared nominal type and envelope registry | complete | P2-01 |
| P2-03 | 112 Capability immutable contract packages | next | P2-01、P2-02 |
| P2-04 | 96 Result family schema closure | pending | P2-02、P2-03 |
| P2-05 | 156 relational table contract inventory | pending | P2-01 |
| P2-06 | 18 canonical transaction and participant inventory | pending | P2-05 |
| P2-07 | Cross-inventory contract verification harness | pending | P2-02–P2-06 |
| P2-08 | P2 Phase Exit Audit and evidence freeze | pending | P2-00–P2-07 |

## 7. Work Package contracts

### P2-00 Standing authorization and isolated baseline receipt

- Record standing authorization without broadening external-environment permission.
- Create clean P2 branch/worktree from exact P1 closure commit.
- Reconfirm original dirty workspace and excluded files remain untouched.
- Done: baseline receipt committed and P2-01 can run without user input.

### P2-01 SSOT extraction oracle and source map

- Parse only the accepted SSOT ranges for Catalog、Result registry、table rows and canonical transactions.
- Every extracted item receives stable ID、section/line locator、raw contract digest and Owner classification.
- Hand-maintained manifest and extractor output must cross-check; SSOT prose is not modified.
- Negative fixtures: duplicate row、missing locator、count drift、unknown section、ambiguous table/capability parse all fail closed.

### P2-02 Shared nominal type and envelope registry

- Implement JSON Schema 2020-12 contracts for §8.6.18 handles and common Outcome/Evidence/Verification/Fact/Receipt/Manifest/Draft envelopes.
- Enforce stable `$id`、`additionalProperties:false`、opaque identity、digest/time/revision constraints and bounded arrays/JSON.
- No raw path、Config、Store、Facade、Planner、Runtime or unverified payload type is allowed.

### P2-03 112 Capability immutable contract packages

- Each Catalog ref has exactly one `contracts/capabilities/<domain>/<name>/v1/` package with the eight SSOT-required files.
- Manifest fixes Owner、Effect Class、named ports、schema refs、Fence、Resource、idempotency and optional Approval/Authorization.
- Catalog summary input/output is translated to named typed ports without inventing Business decisions.
- No Executor code or registration is created in P2.

### P2-04 96 Result family schema closure

- Every Catalog output resolves to one accepted Result family or direct shared handle.
- Every schema inherits the correct envelope and mandatory payload from §8.6.19.
- `deferred|failed|fence_rejected` remain Outcome variants, never business Result variants.
- Contract graph has zero unresolved `$ref` and zero undeclared output family.

### P2-05 156 relational table contract inventory

- Convert §8.5.10–§8.5.13 rows into exact machine-readable table contracts.
- Record sole Owner、prefix、columns、PK/FK、unique/partial unique、hot index、immutability、revision/current pointer、JSON schema/limit and delete restriction.
- Foundation cannot FK to Domain；`platform_*` cannot reference Domain；`read_*` remains rebuildable and non-canonical.
- P2 does not emit or execute migration SQL.

### P2-06 18 canonical transaction and participant inventory

- Record exact atomic fact set、Owner、Domain/Control/Foundation participants、required tables、CAS/fence、receipt/outbox and rollback invariant.
- Cross-Domain Accepted writes receiving facts、Control and Outbox only；never upstream Store.
- Crash fixture contract is declared for P3/P4 implementation, but no transaction executes in P2.

### P2-07 Cross-inventory contract verification harness

- One local command checks 112/96/156/18 counts、unique IDs、all refs、Owner/prefix、Effect Class、handle restrictions and stable aggregate digest.
- Every rule has positive and negative fixtures; parse/schema/reference failure returns non-zero.
- Harness must not start service、open DB、create Runtime data、bind port or read credentials/media roots.

### P2-08 P2 Phase Exit Audit and evidence freeze

- Reverse-audit from SSOT, not from generated file count.
- Prove no implementation behavior、DDL execution、legacy compatibility or startup wiring entered P2.
- Freeze baseline commit、commands、aggregate digest、known limitations and implementation commit.
- PASS automatically archives this packet and opens P3 Local Implementation under the standing authorization.

## 8. Execution order

~~~text
P2-00 → P2-01 → P2-02 ─┬→ P2-03 → P2-04 ─┐
                         └→ P2-05 → P2-06 ─┤→ P2-07 → P2-08
~~~

P2-03/04与P2-05/06可以在P2-01 source map冻结后并行，但不得各自维护第二份type/Owner registry。发生冲突时以
SSOT locator和single registry串行收敛，不使用alias、placeholder或temporary exception。

## 9. Phase Exit Gate

- 112/112 Capability、96/96 Result、156/156 table、18/18 transaction mechanically closed；
- all item IDs unique；all Owners、locators、schema refs and transaction table refs resolved；
- Effect Class/Fence/Resource/Approval/Authorization match SSOT；
- table prefix、FK direction、immutable/revision/current pointer and JSON limits pass；
- aggregate digest stable across repeated runs；
- clean root has no P2→legacy import、Executor、Repository、DB connection、DDL execution or startup wiring；
- no undocumented reuse、whole-executor reuse、compatibility or dual path；
- isolated negative fixtures and reverse Exit Audit PASS；
- diff excludes `media-desktop`、runtime data、generated build artifacts and original user changes。

## 10. Stop conditions

Only stop and ask the user when SSOT has a genuine contradiction or a decision changes user intent、visible business outcome、irreversible
Authorization、Business Domain/Owner/Handoff or business-object continuity. Engineering ambiguity is resolved locally and documented.
