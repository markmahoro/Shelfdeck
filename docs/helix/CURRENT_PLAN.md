# ShelfDeck Clean Helix Master Plan

Status: Levels 0–10 accepted; P0–P6 complete; P7 in progress under standing P2–P13 Local Implementation authorization; external-environment actions and `media-desktop` remain paused.

Last updated: 2026-07-18

## 1. Role and authority

本文是唯一Helix Master Plan，只维护：

- clean-cut总决策；
- P0–P14 Phase顺序、依赖和Exit Gate；
- 当前Phase指针；
- 授权边界和下一动作。

架构只由`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`定义；工程过程只由`ENGINEERING_PLAYBOOK.md`定义；当前Phase的
Work Package细节只存在于`implementation/CURRENT_PHASE.md`；当前事实只由`CURRENT_STATUS.md`报告。

本文不复制Phase执行细节，也不保存已完成审计全文。

## 2. Accepted implementation decision

采用：

> 新`media-service/src/helix/`完整重建clean业务核心和产品表面；旧实现逐函数取证复用；完整验证后一次性切换
> Composition Root；不在旧Libra/Nexora/Kairox/Task主路径上增量改造。

固定边界：

- 五个一级Business Domain为Procurement、Libra、Arca、User Perception、People Management；
- Collection Formation只有Procurement→Libra和Libra→Arca两次单向Handoff；
- 一个`data/shelfdeck.db`不等于共享Store；Repository和Fact Owner保持隔离；
- clean schema不迁移旧Runtime事实，不dual-read/write/run，不保留旧fallback；
- 62个旧业务executor中0个可整体复制；复用只限登记后的pure/protocol/FFmpeg/file-transaction原子；
- 完整clean root切换前只允许isolated fixture，不形成混合可运行产品；
- `media-desktop`不属于本轮范围。

实现差距基线和处置Evidence见
`implementation/evidence/IMPLEMENTATION_GAP_AUDIT_4a16f0a9.md`。

## 3. Current phase

| Field | Current value |
| --- | --- |
| Phase | P7 — Procurement |
| Detailed packet | `implementation/CURRENT_PHASE.md` |
| Status | in progress；P7-00–P7-02 PASS；latest SSOT与Architecture Agent `f2846fd1`原始blob一致；112/96/161/24 |
| Implementation baseline | exact P6 phase closure `5831c53207d5e71ccdf4792da11ed71be3d47ae1` |
| Phase branch/worktree | `codex/helix-p7` / `E:\my_project\emby_third_party-helix-p7` |
| Allowed now | P2–P13本地代码、unit/contract/isolated fixture、文档与Phase自动转换 |
| Next action | P7-03 Field Observation Inventory与幂等page commit |

## 4. Master roadmap

| Phase | Outcome | Dependencies | Exit Gate summary |
| --- | --- | --- | --- |
| P0 Audit and disposition | `4a16f0a9`差距、旧模块处置、风险和clean-cut方向 | Level 0–10 accepted | **complete**；Evidence已冻结 |
| P1 Clean skeleton and guards | 固定`src/helix/`、public/internal边界、唯一Root shell、机器架构门禁和manifest框架 | P0；Local Implementation Gate | **complete**；Exit Audit PASS；Evidence frozen |
| P2 Contract and schema baseline | 112 Capability、96 Result、161 table合同与digest | P1 | **complete**；latest SSOT rematerialized 112/96/161/24；baseline gate PASS |
| P3 Persistence and atomic foundation | 唯一Kernel、scoped UoW、Control、Commit Marker、Outbox/Inbox、Audit | P2 | **complete**；24 canonical transactions；baseline gate PASS |
| P4 Execution and recovery foundation | Work/Plan/Event/Effect、Progress、Control Plane、Resource、Retry/Timeout/Circuit、startup recovery | P3 | **complete**；7 Effect Classes / 31 crash scenarios；Exit Audit PASS |
| P5 Platform and integrations | Secret/Mount/Workspace/Artifact/Resource/Worker及typed Provider/FFmpeg/file libraries | P3–P4 ports | **complete**；10 fixture families / 31 recovery scenarios；Exit Audit PASS |
| P6 Horizontal domains | Perception和People独立Store/Facade/Process/Projection | P3–P5 | **complete**；Exit Audit PASS；两域Owner与cross-domain边界闭合 |
| P7 Procurement | Material Field、Observation、Region、Triage、Candidate Package | P3–P5 | `0..N` Field隔离；Related/Control和Candidate唯一性成立 |
| P8 Handoff A and Libra front half | Handoff A、FA-04 continuity、Subject、Decision、Routing、Acceptance Spec | P6–P7 | Decision/Subject/Binding/Control/Receipt单事务 |
| P9 Libra production and delivery | Run、Workspace、Product、Conformance、On-deck Package、Discard/Cleanup/Reclaimer | P4–P5、P8 | Libra只写Workspace；Promotion/Discard/Cleanup原子闭合 |
| P10 Handoff B and On-deck | Shelf/Standard/Placement、Acceptance、Custody、Off-load、Inventory、Shelf Entry、Deck | P5、P9 | Handoff B不建Own；只有On-deck Commit建立/扩展Deck |
| P11 Arca post-deck | Aftercare、Off-deck、Shelf Deregistration | P10 | 三种旅程/授权独立；Deregistration零Delete |
| P12 Product surface | Projection/Activity、Facade、113 Admin route、Session/Auth、九页Admin Web | P6–P11 | 113/113+health；GET无副作用；九旅程和a11y通过 |
| P13 Operational cutover | clean init/backup/restore/Safety、readiness；Root/API/UI一次切换；旧路径退役 | P2–P12 | mixed generation拒写；无dual path；本地完整验证通过 |
| P14 Authorized verification/release | Real-source E2E、Windows/Linux/NAS、Docker、Canary、生产 | P13；每类独立授权 | Level 10 Release Gate；任一阶段失败停止后续 |

P1–P13是逻辑实施Phase，不是版本名或自动部署节点。P14当前不在授权范围内。

## 5. Hard dependency invariants

~~~text
P1 package/guards
  → P2 contracts/schema
  → P3 atomic persistence
  → P4 execution/recovery
  → P5 platform/integration substrate
  → P6/P7 horizontal domains and Procurement
  → P8/P9 Handoff A and Libra
  → P10/P11 Handoff B, Arca and post-deck
  → P12 Projection/API/Admin Web
  → P13 operational cutover
  → P14 separately authorized external verification/release
~~~

禁止以以下方式缩短依赖链：

- 新Procurement接旧Membership；
- 新Libra写旧`media_items`或Kairox Store；
- 新Event Runtime驱动旧executor；
- 新Admin Web调用旧Task/Library route；
- clean database回退旧Service；
- 先做Material副作用、后补Control/Effect recovery。

## 6. Phase planning and transition

- 任意时刻只有`implementation/CURRENT_PHASE.md`一份活动详细执行包；
- 只细化当前Phase，后续Phase维持Outcome/Dependency/Exit Gate级别；
- 当前Phase全部Work Package满足Done并通过独立Exit Audit后，执行包移动到`implementation/archive/`；
- Evidence冻结并由`CURRENT_STATUS.md`链接后，才细化下一Phase；
- Phase完成不自动打开下一类环境授权；
- blocking架构缺口返回Design，不以兼容层、temporary Store或silent fallback解决。

详细Ready/Done、Review、Reuse、Git/worktree和停线规则见`ENGINEERING_PLAYBOOK.md`。

## 7. Authorization boundaries

用户已授予P2–P13第1层`Local implementation` standing authorization。每个Phase在SSOT traceability、机器反例和
Exit Audit全部PASS后可以自动归档并进入下一Phase，不需要逐Phase等待：

1. Local implementation：本地代码、单元/合同/隔离fixture；
2. Real-source E2E：明确来源和副作用范围；
3. Build/Canary：明确Artifact和环境；
4. Production：明确发布/部署/升级动作。

Standing authorization不授权下一层。E2E、Docker/Canary、NAS、生产和真实媒体副作用保持暂停，
`media-desktop`保持排除。

## 8. Business decision handling

只有改变用户真实意图、可见业务结果、不可逆Authorization、Business Domain/Owner/Handoff或Object continuity的
问题才提交用户。包结构、代码组织、测试工具、manifest格式、SQL实现和性能优化由工程内部在SSOT边界内决定。

当前没有open business decision。工程问题由Codex自主处理；只有真实业务决策或SSOT冲突才向用户提问。
