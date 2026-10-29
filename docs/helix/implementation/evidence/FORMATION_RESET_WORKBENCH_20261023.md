# Formation Reset 当前工作台扩展（2026-10-23）

状态：`CODE IMPLEMENTED / DIRECTIONAL TESTS PASS / PRODUCTION NOT RUN`

## 1. 用户决定

2026-10-23 用户确认把 Formation Reset 作为“媒体整理工作台”的兜底清理能力，并明确：

- 清理范围：当前工作台全部 `in_progress` + `attention_required` + pending intake，覆盖所有 profile/shelf；
- 包含 Handoff B Accepted 但尚未 On-deck Commit 的 on-deck/acceptance；
- 保留已入藏 Shelf Entry/Inventory/正式收藏、completed/ended 历史、Aftercare/Off-deck、源文件；
- Reset 前做离线备份；执行内容可审计；
- 概览按钮由 `Reset 整理任务` 改为 `重置工作台`，只要求一次确认词；
- 不做逐条预览 UI，不把 Reset 当普通用户取消，也不以 Reset 掩盖可复现缺陷。

## 2. 合同边界

Reset 不是用户取消、`放弃整理`、Rejected 或撤回 Accepted 业务事实；不改变历史 Accepted/Decision/Receipt，也不伪造业务终态。它只退役未 Commit 的当前工作台运行时占用：

- Libra：`in_progress|attention_required` Subject、pending intake token、Run/Workspace/Projection；
- Arca：custody、on-deck run、acceptance decision、offer/package、target reservation；
- 源文件保留，之后可由 Procurement 重新观察并形成新的 Candidate/Product Package；不保证自动重采。

`cancel` 在 Arca Accepted 后仍不允许；Reset 是独立的管理性兜底，不是 cancel 的替代入口。SSOT 已追加 “Administrative Formation Reset（2026-10-23 用户决定）” 段落。

## 3. 实现

- `scripts/user-formation-reset.js`：
  - 选择改为按 `libra_formation_projections.classification in ('in_progress','attention_required')`，并保留无 Projection 的 active/pending intake；
  - 不再用“终态 Run”阻挡当前 attention；只对 `classification='completed'` 保留 `RESET_ENDED_HISTORY_OVERLAP` 保护；
  - 保留 committed Subject、未决 Effect、unscoped responsibility 三类 blocker；
  - apply 成功后写 durable `shelfdeck.user-formation-reset-receipt@1` 到 `data/reset-receipts/<resetId>.json`，包含 backupId、preview/scope digest、清理计数、保留计数、verification。
- `formation-reset-nas.js`：离线 apply 后写 `backupDir/reset-receipt.json`，记录 image、backup、scope 和时间；支持 `--keep-stopped`。
- `RuntimeControls.tsx`：
  - 按钮 `重置工作台`，对话框 `重置整理工作台`；
  - 去掉逐条清单和复选框，改为清理/保留摘要 + 输入 `重置工作台` 一次确认；
  - 仍保留内部 preview digest、blocker 和运行状态变化失效，不作为用户步骤。
- 备份：沿用现有 full data backup + workspace copy + integrity check；Reset 前强制 preview digest 一致。

## 4. 定向验证

| 范围 | 结果 |
| --- | --- |
| `helix-formation-reset.test.js` | 40/40 PASS |
| `formation-reset-nas.test.js` | 10/10 PASS |
| `runtime-controls.test.tsx` | 6/6 PASS |
| 重试/剧集相关 Web 定向 | 49/49 PASS |
| 剧集 Handle/NFO 定向 | 20/20 PASS |

尚未执行：完整 Service/Web Gate、生产副本 Reset 演练、生产 Reset、部署、重采验收。

## 5. 生产执行顺序（待授权）

1. 冻结本轮代码与测试，完成完整 Gate；
2. 在独立生产副本执行一次 Reset：验证当前工作台清空、收藏/completed/ended/Aftercare/源文件保持、Arca custody/target 释放、receipt 可查；
3. 生产：离线全量备份 → 安全停机 → Reset（`--keep-stopped`）→ 部署新版本 → 启动 → health/formation 验收；
4. Procurement 重采 → 新 Candidate/Product Package → 验证 5 个剧集、高达两条收藏、凡人歌一条 Season；
5. 若新包仍失败，停止并保留缺陷，不以再次 Reset 掩盖。

## 6. 风险

- 当前生产有 225 个 `in_progress|attention_required` Subject（2026-10-23 只读分布）；备份/Reset 时间和空间需按此规模评估；
- 4K 转码及其他在跑任务会因停服中断，属于用户已接受的连带损失；
- `RESET_UNRESOLVED_EFFECT` 可能阻止 apply；必须先核查而非绕过；
- 生产 preview 尚未运行，实际 scope/blocker 以 dry-run 为准。
