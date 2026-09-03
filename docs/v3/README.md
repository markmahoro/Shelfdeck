# ShelfDeck v3 / Kairox 历史文档索引

Status: Kairox release line 已关闭；当前 ShelfDeck 权威全部位于 `docs/helix/`。

Last updated: 2026-09-03

## 阅读规则

- `CURRENT_STATUS.md`：只说明 Kairox closure 与当前 Helix 入口。
- `CURRENT_PLAN.md`：明确 v3 没有活动计划。
- `RELEASE_GOALS.md`：保存 Kairox Beta 已达成、后续 Kairox goals 已取消的历史事实。
- `VERSIONING.md`：仍是镜像 tag、Git tag 和 package version 的技术口径入口；当前部署身份必须与
  `docs/helix/CURRENT_STATUS.md` 一致。
- `KAIROX_ARCHITECTURE.md` / `KAIROX_ENGINEERING_PLAYBOOK.md`：仅用于理解历史实现，不定义 clean Helix。
- `acceptance/` 与 `archive/`：Kairox 验收、交接和旧计划 Evidence，不得作为新实现授权。

## 冲突规则

1. ShelfDeck 产品、Owner、Handoff、业务对象和当前计划以 `docs/helix/` 为准。
2. `docs/v3/` 不得恢复 Kairox roadmap、旧 lifecycle 边界、compatibility 或 dual runtime。
3. 任何仍使用旧组件名称的 v2/v3 文档都只能解释历史代码位置，不能覆盖 Helix SSOT。
4. 当前生产身份只在 `docs/helix/CURRENT_STATUS.md`、`VERSIONING.md` 和
   `docs/v2/PRODUCTION_DEPLOYMENT.md` 三处同步维护。
