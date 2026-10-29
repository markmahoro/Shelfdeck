# ShelfDeck 当前计划（薄目标）

**角色：** 可选一行产品/发布目标与依赖说明。**不是**工作项列表或活 backlog。  
活工作 = GitHub PR（根 `AGENTS.md` PR-ledger）。禁止用「UAT」「Phase」排期。

历史 Master Plan 叙述全文（stub 前）保留在 git：

```bash
git show 249515421fe2f51d9594f79c046dd15441fcfae7:docs/helix/CURRENT_PLAN.md
```

## 产品 / 发布目标（一行）

Helix：Linux/Docker（NAS）上的 Movie 回归 Oracle 保持；后续功能增量以独立 PR 交付，不以文档 Phase 包排期。

## 依赖与边界（短）

- 架构唯一 SSOT：[`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`](TOP_DOWN_ARCHITECTURE_CONFIRMATION.md)
- Movie-only Beta DoD：[`BETA_FEATURE_ACCEPTANCE_BASELINE.md`](BETA_FEATURE_ACCEPTANCE_BASELINE.md)（按需）
- 生产身份：[`CURRENT_STATUS.md`](CURRENT_STATUS.md)（部署后写；非默认读）
- 历史 Phase 包：[`implementation/CURRENT_PHASE.md`](implementation/CURRENT_PHASE.md)（legacy stub）
- 上线后问题编号表：[`UAT_ITERATION_REGISTER.md`](UAT_ITERATION_REGISTER.md)（Evidence 键 only，非排期）
