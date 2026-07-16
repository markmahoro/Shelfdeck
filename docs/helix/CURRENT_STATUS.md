# ShelfDeck Clean Helix Current Status

Status: Levels 0–10 accepted; P0 complete; P1 Local Implementation Gate open; P1-00–P1-05 complete; P1-06 next; E2E, Docker, production, real-media side effects and `media-desktop` changes paused.

Last updated: 2026-07-16

## 1. Current position

| Field | Current state |
| --- | --- |
| Architecture | `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` Level 0–10 accepted and final audit closed |
| Open business decisions | none |
| Implementation program | clean-cut Master Plan accepted as direction |
| Completed phase | P0 — implementation gap audit and disposition |
| Current phase | P1 — Clean Skeleton and Architecture Guards |
| Current phase status | in progress；P1-00–P1-05 complete |
| Implementation Gate | open for `Local implementation only / P1` |
| Current allowed work | P1本地代码、unit/contract/isolated architecture fixture、文档同步 |
| Integration baseline | `c1c6bb0dc468c11bf34e7bd63b038fc1b197a689` |
| Phase worktree | `E:\my_project\emby_third_party-helix-p1` on `codex/helix-p1` |
| Next action | P1-06 Machine-readable manifest and reuse-ledger framework |

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

## 4. Current phase package

P1详细Work Package只存在于`implementation/CURRENT_PHASE.md`。当前索引：

| Work Package | Status |
| --- | --- |
| P1-00 Isolated workspace and baseline receipt | complete |
| P1-01 Clean physical package skeleton | complete；42 unique package markers |
| P1-02 Domain public/internal boundary | complete；5 frozen public entries / 12 default-deny rules |
| P1-03 Unique Composition Root shell | complete；fail-closed / zero import side effect |
| P1-04 Import/dependency guard | complete；42 packages / 6 source files / 5 dependencies / 0 findings；9 positive/negative checks |
| P1-05 Forbidden legacy semantics guard | complete；12 rule families / exact structured exemptions / 6 checks |
| P1-06 Manifest/reuse-ledger framework | next |
| P1-07 Architecture verification harness | pending |
| P1-08 Phase Exit Audit | pending |

P1代码和隔离architecture fixture已经开始；clean root仍未接入`server.js`、`app.js`或任何旧Runtime。

## 5. Engineering governance state

- `CURRENT_PLAN.md`：精简Master Roadmap和授权边界；
- `ENGINEERING_PLAYBOOK.md`：Ready/Done、Work Package、门禁、测试、Review、复用、Git和停线规则；
- `implementation/CURRENT_PHASE.md`：唯一活动Phase详细执行包；
- `implementation/evidence/`：冻结审计与验收Evidence；
- `implementation/archive/`：Phase完成后保存冻结执行包，当前尚无归档。

工程文档不能覆盖架构SSOT。任意时刻禁止出现第二份活动Phase详细计划。

## 6. Safety and worktree state

- NAS ShelfDeck Docker `192.168.12.230:18080`保持生产边界，当前不接触；
- 四库真实来源E2E保持停止；
- 只运行P1 unit/contract/isolated architecture fixture；不运行E2E、Admin Web构建或Docker构建；
- 不部署、不初始化生产数据、不执行真实媒体副作用；
- 当前旧`helixCleanState`/preflight不得用于clean切换或生产；
- `media-desktop`继续排除并保留用户未提交修改；
- 用户`media-service/package.json`分析入口和未跟踪分析脚本保持不变；
- 实施开始后必须从批准baseline创建独立worktree，不能直接使用当前dirty工作区。

## 7. Open risks and blockers

| Priority | Current risk | Control |
| --- | --- | --- |
| R0 | 旧Kairox合同以Helix命名回流 | P1 clean root和机器禁引入门禁 |
| R0 | 原子复用携带错误Owner/Store/Material权限 | function-level ledger；0 whole-executor reuse |
| R0 | 当前误导性clean-init造成数据破坏 | 封存；P13按Level 10完全重写 |
| R1 | 后续为进度创建新旧混合路径 | Master dependency invariant和Phase Exit Audit |
| active control | P1不得提前进入P2或接旧产品主路径 | Current Phase Non-goals与Exit Gate |

## 8. Next checkpoint

P1-05已完成：12类历史语义规则扫描clean文件路径、代码、注释和字符串；只有规则manifest自身获得精确到
file/rule/location/purpose的12项结构化豁免，通配、未知、路径逃逸和未解析豁免均fail closed。P1-04/P1-05累计
15项architecture fixture通过，两个clean-root checker均为0 findings。下一检查点是P1-06建立versioned manifest、
稳定digest和function-level reuse ledger框架，但不提前填充P2的112/96/156合同正文。
