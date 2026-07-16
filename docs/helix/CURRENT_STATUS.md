# ShelfDeck Clean Helix Current Status

Status: Levels 0–10 accepted; P0 and P1 complete; P2 in progress under standing P2–P13 Local Implementation authorization; E2E, Docker/Canary, production, real-media side effects and `media-desktop` changes paused.

Last updated: 2026-07-16

## 1. Current position

| Field | Current state |
| --- | --- |
| Architecture | `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` Level 0–10 accepted and final audit closed |
| Open business decisions | none |
| Implementation program | clean-cut Master Plan accepted as direction |
| Completed phases | P0 — implementation gap audit；P1 — Clean Skeleton and Architecture Guards |
| Current phase | P2 — Contract and Schema Baseline |
| Current phase status | in progress；P2-00–P2-04 complete；P2-05 next |
| Implementation Gate | standing Local Implementation open for P2–P13；external actions excluded |
| Current allowed work | local code、unit/contract/isolated fixture、docs、automatic Phase transition after PASS |
| Integration baseline | `c52e67fa2b49c605d0971f2150238ea37c50816a` |
| Phase worktree | `E:\my_project\emby_third_party-helix-p2` on `codex/helix-p2` |
| Next action | P2-05 156 relational table contract inventory |

## 2. Accepted implementation conclusion

clean Helix的业务核心、Persistence、Execution Foundation、Application Facade、API/Auth和Admin Web需要在
`media-service/src/helix/`完整架构重建。旧Libra/Nexora/Kairox/Task主路径不是可增量修补的clean骨架。

保留原则：

- Node/Fastify/SQLite/React等技术栈可以继续使用；
- Provider protocol、FFmpeg、媒体解析、DAG、queue和文件事务算法只能逐函数登记后原子化复用；
- 62个旧业务executor中0个允许整体复制；
- 旧Runtime事实不迁移、不dual-read/write/run、不成为fallback；
- 完整切换前不形成半新半旧可运行产品。

## 3. P0 evidence summary

审计baseline为`4a16f0a94ef23fcf732843e9547bd7b724d9c19d`。关键Evidence：

| Measure | Current implementation | Clean contract |
| --- | ---: | ---: |
| clean root | 不存在 | `media-service/src/helix/` |
| relational tables | 33 | 156 |
| Admin method+path | 80 | 113 |
| literal overlapping Admin route | 11 | not semantic compatibility evidence |
| clean routes structurally missing | 101 | 0 |
| historical business executors | 62 | 0 whole-copy entitlement |
| clean Capability / Result family | 0 implemented | 112 / 96 |

完整28项差距矩阵、删除/重写/保留/原子化复用台账和风险依赖链已冻结在：

`implementation/evidence/IMPLEMENTATION_GAP_AUDIT_4a16f0a9.md`

Audit result: `COMPLETE / CLEAN CORE REBUILD REQUIRED / ATOMIC REUSE ONLY / NO OPEN BUSINESS DECISION`。

## 4. Completed P1 package

P1详细Work Package已归档到`implementation/archive/P1_CLEAN_SKELETON_AND_ARCHITECTURE_GUARDS.md`：

| Work Package | Status |
| --- | --- |
| P1-00 Isolated workspace and baseline receipt | complete |
| P1-01 Clean physical package skeleton | complete；42 unique package markers |
| P1-02 Domain public/internal boundary | complete；5 frozen public entries / 12 default-deny rules |
| P1-03 Unique Composition Root shell | complete；fail-closed / zero import side effect |
| P1-04 Import/dependency guard | complete；42 packages / 6 source files / 5 dependencies / 0 findings；9 positive/negative checks |
| P1-05 Forbidden legacy semantics guard | complete；12 rule families / exact structured exemptions / 6 checks |
| P1-06 Manifest/reuse-ledger framework | complete；10 Owners / 42 packages / 62 baseline locators / stable digest |
| P1-07 Architecture verification harness | complete；single local command / 4 fixture files / JSON evidence |
| P1-08 Phase Exit Audit | complete；PASS Evidence frozen |

P1已关闭；clean root仍未接入`server.js`、`app.js`或任何旧Runtime。P2 inventory仍是framework-only，不构成实现。

### Active P2 work packages

| Work Package | Status |
| --- | --- |
| P2-00 Standing authorization and isolated baseline | complete；`c52e67fa` → `f1b5510d` |
| P2-01 SSOT extraction oracle/source map | complete；112/96/156/18；17 shards；10 negative checks |
| P2-02 Shared nominal type/envelope registry | complete；28 JSON Schema；registry digest `af6cb77b…` |
| P2-03 112 Capability contract packages | complete；112 packages / 896 files；digest `ce353a4c…` |
| P2-04 96 Result family closure | complete；96/96 inventory；191 refs / 0 unresolved |
| P2-05 156 table contract inventory | next |
| P2-06 18 canonical transaction inventory | pending |
| P2-07 Cross-inventory verification harness | pending |
| P2-08 Phase Exit Audit | pending |

## 5. Engineering governance state

- `CURRENT_PLAN.md`：精简Master Roadmap和授权边界；
- `ENGINEERING_PLAYBOOK.md`：Ready/Done、Work Package、门禁、测试、Review、复用、Git和停线规则；
- `implementation/CURRENT_PHASE.md`：唯一活动P2详细执行包；
- `implementation/evidence/`：冻结审计与验收Evidence；
- `implementation/archive/`：保存已冻结的P1执行包。

工程文档不能覆盖架构SSOT。任意时刻禁止出现第二份活动Phase详细计划。

## 6. Safety and worktree state

- NAS ShelfDeck Docker `192.168.12.230:18080`保持生产边界，当前不接触；
- 四库真实来源E2E保持停止；
- P2本地实现已开始；不运行E2E、Admin Web构建或Docker构建；
- 不部署、不初始化生产数据、不执行真实媒体副作用；
- 当前旧`helixCleanState`/preflight不得用于clean切换或生产；
- `media-desktop`继续排除并保留用户未提交修改；
- 用户`media-service/package.json`分析入口和未跟踪分析脚本保持不变；
- P2使用独立worktree；P3–P13继续按Phase隔离，不能直接使用原dirty工作区。

## 7. Open risks and blockers

| Priority | Current risk | Control |
| --- | --- | --- |
| R0 | 旧Kairox合同以Helix命名回流 | P1 clean root和机器禁引入门禁 |
| R0 | 原子复用携带错误Owner/Store/Material权限 | function-level ledger；0 whole-executor reuse |
| R0 | 当前误导性clean-init造成数据破坏 | 封存；P13按Level 10完全重写 |
| R1 | 后续为进度创建新旧混合路径 | Master dependency invariant和Phase Exit Audit |
| active control | Standing授权仅限本地且clean root不得接旧产品主路径 | Current Phase Non-goals与Master dependency invariant |

## 8. Next checkpoint

P2-04已完成完整type graph闭包：96/96 Result inventory active，包含86个nominal Catalog Result、9个直接shared
Result和`CapabilityOutcome`；另有3个SSOT helper schema。Catalog input由26个bounded contract和59个accepted DTO
承载，不包含Store row、裸path、通用payload或Runtime authority。Result registry digest为
`e5963ae477cd1181de935f92f09c1773279cafa4745ff10002fa82024505e004`，domain-input registry digest为
`ac3bae51336b7ec7eda32a1f6dc19904ce6047989ba8cdd1fa4b253325deba69`；112个Capability共引用191个type ID，
unresolved为0。Schema drift、open object、假parenthetical type、Outcome混入Result、raw path和missing ref反例均失败，
累计architecture fixture通过。下一检查点是P2-05冻结156项relational table contract；不生成或执行DDL。没有需要用户决定的业务问题。
