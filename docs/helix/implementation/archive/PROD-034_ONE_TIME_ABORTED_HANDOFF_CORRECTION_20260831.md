# PROD-034 — One-time Aborted Handoff Correction

状态：**COMPLETE / DEPLOYED**

日期：2026-08-31

## 目标

将“唐人街探案 (2015)”和“赤壁（上） (2008)”视为不再继续恢复的已中止业务过程：保留最低限度的失败执行和 Handoff 审计，释放其 Arca Custody、Material Control 和 Binding，并从 Formation active section 移除陈旧投影。

## 边界与实施

1. 一次性工具冻结两个 Subject、Libra Run、Package、Offer、Custody 和 On-deck Run 的精确 ID、关系、状态与数量；任一漂移、active Attempt 或已发生 On-deck Commit 均 fail closed。
2. 两个 Custody 和 35 条 Binding 转为 `released`；7 项 Material Control 通过带 `PROD-034` basis 与 commit marker 的新 revision 释放。
3. 仅删除两个可重建的陈旧 Formation Projection；未删除 Handoff B Accepted、Libra Package、Work、Attempt、Event、Effect 或 Final Inventory Decision 历史。
4. 撤除为这两个 Run 引入的通用 Arca 恢复兼容路径；不保留 fallback、双读或长期兼容行为。
5. 未删除、移动或改写 `/media`、`/transcode` 文件。

## Exit Evidence

- Source commit：`82861681ce19ac3d58b289cf7c1ae94bc154eca9`。
- Image：`markmahoro/shelfdeck:helix-beta-20260831-82861681ce`。
- Tar SHA-256：`85df9f1cd607587e8f027346ec7af47be93fb6fbe241b8d187b9be1410dcbbbc`。
- Backup：`/vol1/1000/docker/shelfdeck/data.backup-20260830T183135Z-prod034-one-time-correction`。
- Correction：2 released Custodies、7 released Material Controls、35 released Bindings、2 removed stale projections；两个目标 active Attempt 均为 0。
- Post-deploy：health `ok`、generation `helix-clean-v3`、`normalSupplyAllowed:true`、SQLite integrity `ok`；两个目标均不在 Formation active section。
- Capacity：execution residual 0；全局 active Attempt 13/64。
- 原 3 条 pending：百元之恋、我经过风暴已完成；异形2处于真实 `executing`，未卡住。
- Tests：PROD-034 2/2、Arca focused 24/24、Admin Web 37/37、Architecture 全通过；service full 381 项为 362 pass / 18 skip / 1 个负载敏感 timing failure，失败文件单独复跑 20 pass / 1 skip / 0 fail；service/web official npm audit 均为 0。

这是一项封闭的一次性数据纠正，不形成可复用的生产迁移或兼容承诺。
