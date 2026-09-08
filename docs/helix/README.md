# ShelfDeck / Helix 文档索引

Status: Helix-beta 为 Movie-only 完整旅程 A–I；当前迭代统一使用PROD编号，见CURRENT_PLAN。

Last updated: 2026-09-08

## 权威顺序

1. `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`：唯一架构 SSOT。
2. `BETA_FEATURE_ACCEPTANCE_BASELINE.md`：Movie-only Helix-beta Definition of Done。
3. `CURRENT_STATUS.md`：当前事实、部署身份、Gate、风险与最近验证。
4. `CURRENT_PLAN.md`：唯一 Master Plan；不保存已结束迭代流水账。
5. `implementation/CURRENT_PHASE.md`：唯一当前 Phase 指针；当前为用户痛点迭代。

冲突时，SSOT 高于 Helix 派生文档；Helix 文档高于 v3/Kairox、v2 和归档历史。实现库存可以因
Implementation Contract 增长而高于 SSOT 的历史 machine snapshot，但不能改变 Owner、Handoff、业务状态或授权语义。

## 当前入口

| 文档 | 用途 |
| --- | --- |
| `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` | Levels 0–10、PBF amendments 与最终审计 |
| `BETA_FEATURE_ACCEPTANCE_BASELINE.md` | Movie 全链路验收基线；四 profile Matrix 已作废 |
| `CURRENT_STATUS.md` | PROD-064 后的当前生产与工程事实 |
| `CURRENT_PLAN.md` | 当前用户痛点迭代及授权 Gate |
| `ENGINEERING_PLAYBOOK.md` | 实施治理、Owner/Effect/验证/归档规则 |
| `LEVEL7_BUSINESS_DECISIONS.md` | 已关闭的非 Canonical 业务决策 Evidence |
| `ARCHITECTURE_REVIEW.md` | 已关闭的非 Canonical 架构审计记录 |
| `PRODUCTION_DEPLOY_ISSUE_LOG.md` | 唯一PROD迭代编号台账，覆盖功能、UI、修复与运维 |
| `USER_ACCEPTANCE_TEST_ISSUE_LOG.md` | 冻结UAT历史证据；不再新增迭代编号 |
| `ADMIN_WEB_UX_ISSUE_LOG.md` | 冻结UX历史证据；新UI项统一使用PROD |

当前本地实现机器库存为 113 Capability、99 Result family、187 tables、45 Canonical Transactions、
127 Admin routes 与 17 UI surfaces。SSOT 顶部记录的 active architecture inventory 是设计/语义快照；两种数字的
职责不同，不得互相覆盖。

## 实施证据与归档

- `implementation/evidence/` 保存 P1–P13 Exit、contract、P14 checkpoint 和测试证据。
- `implementation/archive/` 保存已结束 Phase/生产稳定化包；其索引见
  `implementation/archive/README.md`。
- `archive/` 和 `nexora/archive/` 只保存 Top-down 之前的历史，不再指导当前实现。

P1–P13 已完成并冻结 E2E-ready package；Movie P14 资格验收与后续生产稳定化已完成。当前用户痛点迭代见唯一活动包。
新的实现工作必须先在 `CURRENT_PLAN.md` / `implementation/CURRENT_PHASE.md` 建立唯一指针并取得相应 Gate；
Production、Formation Reset、真实媒体副作用和 `media-desktop` 仍需各自明确授权。
