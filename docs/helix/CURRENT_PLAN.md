# ShelfDeck Clean Helix Master Plan

Status: **Helix-beta Movie-only full chain；Observation hard-deadline replacement、PROD-037 NFO 与 Formation 合同修正已无损部署；Observation 恢复通过，Formation 详情验收失败并已打回。**

Last updated: 2026-08-31

## 当前基线

- NAS production：`192.168.12.230:18080`。
- Image：`markmahoro/shelfdeck:helix-beta-20260831-ae7a567cde`；source commit `ae7a567cde`。
- Health：`ok` / `helix-clean-v3` / `normalSupplyAllowed:true`；schema 186；SQLite integrity `ok`。
- Execution：6 executing Event Attempts、12 active Work Attempts；Observation 不再占 active Attempt，未触及 64 hard cap。
- Latest rollback backup：`/vol1/1000/docker/shelfdeck/backups/deploy-20260831T015047Z-ae7a567cde`；源/备份数据库字节一致，SQLite integrity `ok`、FK error 0。

## 已完成

- PROD-032：修复 Libra Pre-deck token 旁路，完成有损升级并让 Handoff A Package 重新按 Field seats 进入 Libra。
- PROD-033：清理终态 Work 下的执行层残留，释放被历史脏记录占用的 active Attempt 容量。
- PROD-034：对两个已中止 Run 完成一次性纠正，释放 Custody、Material Control 和 Binding，移除陈旧 Formation Projection，并撤除通用恢复兼容路径。
- PROD-035 本地实现：Final Verify 移到 Placement 后；NFO 按业务语义验收并保存盘上实际指纹，Primary 等材料仍严格字节校验；Final Verify、Fulfillment、Commit 三次读取最新现实。
- PROD-035 本地收敛：Aftercare 对语义等价 NFO 漂移只提交新的 Inventory Representation revision；On-deck 自动恢复有界，耗尽后稳定进入 `attention_required`，用户继续同一 Run 重试，不再无限停留在活动中间态。
- PROD-036 replacement 已无损部署：旧第 69 页的 Work、Work Attempt、Event、Event Attempt 与 Effect 均 terminal failed，错误为 `COOPERATIVE_EXECUTION_DEADLINE_EXCEEDED`；仍保持 68 页/17,408 Entries，没有第 69 页迟到提交。
- PROD-037 已无损部署：NFO Presentation gate 严格限定为 Movie Identity、title/year/plot/genre/cast；初始监控窗口没有再出现 NFO source stale 或 director semantic drift。既有《罪人》attention 未被兼容恢复。

## 下一步规则

- PROD-035 仍只覆盖 Formation runtime truth、Emby 并发改写 NFO，以及 Accepted 后失败的同一 Arca On-deck Run 的 owner-local convergence。
- PROD-036 只改变 Observation cadence、可重建 Entry 明细保留、Observation I/O deadline 与既有 Effect 的通用启动恢复；永久 header、Result/Evidence、Commit Marker、执行图及 Run/Retry/Candidate/Handoff 事实不删除，也不写生产 Work ID 特例。12 小时实际签发间隔与 7 天 GC 稳态仍需跨时间窗口继续观测。
- Formation active list 必须在有界范围内合成 current detail facts；延迟 durable Projection 不得造成列表、summary 和详情互相矛盾。当前《罪人》详情错误吸入 Field-wide 867 个 Plan，且 attention 被投影为 `in_progress`、无重试动作，已打回详情任务；不得用前端 Plan 或旧数据兼容掩盖。
- On-deck 恢复沿用 immutable Final Inventory Decision 和同一 Run，自动恢复最多 3 代 Supporting Work；耗尽后必须停止自动执行并投影为 `attention_required`，用户重试仍复用同一 Run。不得重开 Libra、改判 Rejected 或创建第二个 On-deck Run。
- Handoff B Accepted 前，Libra 才能「接受瑕疵」或「放弃整理」；Accepted 后 Arca 已接管，检查失败不能借这两个动作退回或结束。
- NFO 允许 Emby 改写排版、`streamdetails` 和附加字段，但 Movie Identity、title/year/plot/genre/cast 必须与 accepted facts 一致；其他材料继续 exact package identity。
- Aftercare 的 source/stat fence 冲突属于预期外部写入竞争：单个 Event 必须形成 `external_writer_conflict` failed Outcome；同一 Case 仍遵守最多 3 代 Work，耗尽后形成一个稳定 attention。后续重新评估读取最新现实，语义等价时只提交 Inventory revision，不写 NFO。
- 不修改 Emby 配置，也不直接编辑生产 SQLite。当前 NFO semantic drift、Formation projection digest 与 Aftercare reclaim schema 异常已分别打回原任务；后续修复仍须标准 build/upload/deploy。
- 不得继续恢复或扩展 PROD-034 的两个目标 Run。
- 其余 active records 只按各自事实诊断；未经新授权，不把本次一次性纠正扩大到其他记录。
- 恢复 Helix-beta acceptance evidence 工作时，仍以 `BETA_FEATURE_ACCEPTANCE_BASELINE.md` 为准；生产 health 不能折算为 `HB-*` PASS。
- 架构唯一 SSOT 仍为 `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；生产修复不得移动 Owner、Handoff 或 Canonical Transaction。
- 生产继续使用 `scripts/build-image.js` → `scripts/upload-nas-image.js` → `scripts/deploy-nas.js`；不删除、移动或改写 `/media` 正式媒体。

唯一活动 Phase 为 PROD-035；状态见 `docs/helix/implementation/CURRENT_PHASE.md`。
