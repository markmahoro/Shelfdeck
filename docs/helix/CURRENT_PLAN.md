# ShelfDeck Clean Helix Master Plan

Status: **Helix-beta Movie-only full chain；PROD-035 正在修复 Formation runtime truth 与同一 On-deck Run 恢复。**

Last updated: 2026-08-31

## 当前基线

- NAS production：`192.168.12.230:18080`。
- Image：`markmahoro/shelfdeck:helix-beta-20260831-82861681ce`；source commit `82861681ce19ac3d58b289cf7c1ae94bc154eca9`。
- Health：`ok` / `helix-clean-v3` / `normalSupplyAllowed:true`；schema 186；SQLite integrity `ok`。
- Formation：0 pending、4 in progress、0 attention、8 completed；active section 4 条。
- Execution：13 active Attempts / 64 hard cap；residual 0。
- Latest rollback backup：`/vol1/1000/docker/shelfdeck/data.backup-20260830T183135Z-prod034-one-time-correction`。

## 已完成

- PROD-032：修复 Libra Pre-deck token 旁路，完成有损升级并让 Handoff A Package 重新按 Field seats 进入 Libra。
- PROD-033：清理终态 Work 下的执行层残留，释放被历史脏记录占用的 active Attempt 容量。
- PROD-034：对两个已中止 Run 完成一次性纠正，释放 Custody、Material Control 和 Binding，移除陈旧 Formation Projection，并撤除通用恢复兼容路径。

## 下一步规则

- PROD-035 当前只覆盖 4 条生产 active records 的事实展示，以及 Accepted 后失败的同一 Arca On-deck Run 的 bounded owner-local recovery。
- Formation active list 必须在有界范围内合成 current detail facts；延迟 durable Projection 不得造成列表、summary 和详情互相矛盾。
- On-deck 恢复沿用 immutable Final Inventory Decision 和同一 Run，最多 3 代 Supporting Work；不得重开 Libra、改判 Rejected 或创建第二个 On-deck Run。
- 不得继续恢复或扩展 PROD-034 的两个目标 Run。
- 其余 active records 只按各自事实诊断；未经新授权，不把本次一次性纠正扩大到其他记录。
- 恢复 Helix-beta acceptance evidence 工作时，仍以 `BETA_FEATURE_ACCEPTANCE_BASELINE.md` 为准；生产 health 不能折算为 `HB-*` PASS。
- 架构唯一 SSOT 仍为 `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；生产修复不得移动 Owner、Handoff 或 Canonical Transaction。
- 生产继续使用 `scripts/build-image.js` → `scripts/upload-nas-image.js` → `scripts/deploy-nas.js`；不删除、移动或改写 `/media` 正式媒体。

唯一活动 Phase 为 PROD-035；状态见 `docs/helix/implementation/CURRENT_PHASE.md`。
