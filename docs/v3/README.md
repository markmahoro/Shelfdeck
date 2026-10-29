# ShelfDeck v3 / Kairox 历史文档索引

Status: Kairox release line 已关闭；当前 ShelfDeck 权威全部位于 `docs/helix/`。

Last updated: 2026-09-03

## 阅读规则

- `CURRENT_STATUS.md`：**CLOSED stub**；禁止追加部署流水。实时身份见 Helix `CURRENT_STATUS`。
- `CURRENT_PLAN.md`：明确 v3 没有活动计划。
- `RELEASE_GOALS.md`：保存 Kairox Beta 已达成、后续 Kairox goals 已取消的历史事实。
- `VERSIONING.md`：Product version / Docker image tag / Git release tag / package 分层口径；与根 `CHANGELOG.md` 对齐。
- `KAIROX_ARCHITECTURE.md` / `KAIROX_ENGINEERING_PLAYBOOK.md`：仅用于理解历史实现，不定义 clean Helix。
- `acceptance/` 与 `archive/`：Kairox 验收、交接、旧计划与历史 Status 段落，不得作为新实现授权。

## 冲突规则

1. ShelfDeck 产品、Owner、Handoff、业务对象和当前计划以 `docs/helix/` 为准。
2. `docs/v3/` 不得恢复 Kairox roadmap、旧 lifecycle 边界、compatibility 或 dual runtime。
3. 任何仍使用旧组件名称的 v2/v3 文档都只能解释历史代码位置，不能覆盖 Helix SSOT。
4. **生产部署身份**只维护在 `docs/helix/CURRENT_STATUS.md`。`VERSIONING.md` 只定义规则；`docs/v2/PRODUCTION_DEPLOYMENT.md` 只定义部署流程。
