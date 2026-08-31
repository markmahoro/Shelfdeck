# ShelfDeck Clean Helix Master Plan

Status: **Helix-beta Movie-only full chain；PROD-040/041 与 Formation 当前 Plan 聚合已部署并通过生产验收。**

Last updated: 2026-08-31

## 当前基线

- NAS production：`192.168.12.230:18080`。
- Image：`markmahoro/shelfdeck:helix-beta-20260831-b06b70ba10`；source commit `b06b70ba10df836d04cb05483df574a976433df4`；tar SHA-256 `1389e07734d1de51262ef947d0345f095c5f50c59d9c2acbd97cd951b51f9543`。
- Health：`ok` / `helix-clean-v3` / `normalSupplyAllowed:true`；schema 186；SQLite integrity `ok`。
- Execution：全局 active Attempt 6 个，Observation active Attempt 0；未触及 64 hard cap。
- Formation：3 `in_progress`、9 `completed`、0 `pending|attention_required`；《罪人》已在同一 On-deck Run 完成并建立 Shelf Entry。

## 已完成

- PROD-032：修复 Libra Pre-deck token 旁路，完成有损升级并让 Handoff A Package 重新按 Field seats 进入 Libra。
- PROD-033：清理终态 Work 下的执行层残留，释放被历史脏记录占用的 active Attempt 容量。
- PROD-034：对两个已中止 Run 完成一次性纠正，释放 Custody、Material Control 和 Binding，移除陈旧 Formation Projection，并撤除通用恢复兼容路径。
- PROD-035 本地实现：Final Verify 移到 Placement 后；NFO 按业务语义验收并保存盘上实际指纹，Primary 等材料仍严格字节校验；Final Verify、Fulfillment、Commit 三次读取最新现实。
- PROD-035 本地收敛：Aftercare 对语义等价 NFO 漂移只提交新的 Inventory Representation revision；On-deck 自动恢复有界，耗尽后稳定进入 `attention_required`，用户继续同一 Run 重试，不再无限停留在活动中间态。
- PROD-036 replacement 已无损部署：旧第 69 页的 Work、Work Attempt、Event、Event Attempt 与 Effect 均 terminal failed，错误为 `COOPERATIVE_EXECUTION_DEADLINE_EXCEEDED`；仍保持 68 页/17,408 Entries，没有第 69 页迟到提交。
- PROD-037 已无损部署：NFO Presentation gate 严格限定为 Movie Identity、title/year/plot/genre/cast；初始监控窗口没有再出现 NFO source stale 或 director semantic drift。既有《罪人》attention 未被兼容恢复。
- PROD-040 已部署并生产验收：恢复 Stage 不再只认原始 `offloadContext`；只有同一 On-deck Run、同一 Target Commit Slot 的 typed `PlacementSwitchReceipt` 才能证明非 Package NFO 是该 Run 先前 Placement 的结果。语义等价时保留盘上实际 NFO，语义错误时从 Package 重新 Stage；无回执、错 Run/错 Slot 或任何 Primary 漂移仍 fail closed。
- PROD-041 已部署并生产验收：`continue_forward` 不再用已经结束的原 Event Attempt wall-clock 作为恢复执行起点；Effect Journal 为同一非终态 Effect 冻结一次 durable recovery execution start，恢复句柄按原 Timeout Policy 获得一个有界预算。重启重放只读同一时间，不刷新 deadline；Input、Fence、Attempt、Effect、idempotency key 与 effect occurrence time 均不变。
- Formation 详情本地修正：材料准备只接受当前 Subject 的 Candidate Package + Structure Unit 双重正式绑定；Accepted On-deck planning failure 从 immutable Work Definition 恢复并继续同一 Run，第三代失败后稳定进入可重试 attention。没有前端 Plan、兼容读取或生产数据修改。
- Formation Plan语义与列表同源本地修正：成功执行的合规检查即使结论不符合也显示为已完成；媒体生产Plan按真实工作命名；一级页当前进展只消费过程卡片同源的后端`currentPlan`摘要，不再读取`organizingSteps`拼第二套表述。生产《冰血暴》对应显示为“计划14 处理媒体文件 / 等待处理资源”。
- Formation 完成态 Plan 聚合已部署并生产验收：同一责任链的成功 successor 覆盖旧 failed Work 的当前状态，最终 On-deck 完成时 `currentPlan` 返回完成 successor；历史失败仍保留在过程卡片，没有 successor 的失败仍为 attention。《罪人》当前显示 `计划5 将媒体写入收藏架 / 已完成`。
- PROD-042 本地修复：Intake Rejection Planner 不再把整个 Supporting Work dependency ref 当成 `evidenceWorkId`，而是 fail-closed 提取唯一 `objectId`；回归覆盖 Rejection Decision 原子提交与 Pre-deck token 释放。尚未部署，现有失败条目不做兼容恢复。

## 下一步规则

- PROD-035 仍只覆盖 Formation runtime truth、Emby 并发改写 NFO，以及 Accepted 后失败的同一 Arca On-deck Run 的 owner-local convergence。
- PROD-036 只改变 Observation cadence、可重建 Entry 明细保留、Observation I/O deadline 与既有 Effect 的通用启动恢复；永久 header、Result/Evidence、Commit Marker、执行图及 Run/Retry/Candidate/Handoff 事实不删除，也不写生产 Work ID 特例。12 小时实际签发间隔与 7 天 GC 稳态仍需跨时间窗口继续观测。
- Formation active list 必须在有界范围内合成 current detail facts；延迟 durable Projection 不得造成列表、summary 和详情互相矛盾。Candidate Package + Structure Unit 双重绑定、同 Run 重试与 successor 聚合均已部署；后续继续以新条目验证，不为旧残留增加兼容路径。
- 列表“当前进展”与详情过程卡片必须引用同一持久化Workflow Plan顺序、标题和执行状态；业务检查“未通过”是该检查的真实结果，不得提升为Runtime失败或“需要处理”。只有真实技术失败、无后继可推进责任或明确用户动作才进入attention表达。前端不得恢复`organizingSteps` Plan回退。
- On-deck 恢复沿用 immutable Final Inventory Decision 和同一 Run，自动恢复最多 3 代 Supporting Work；耗尽后必须停止自动执行并投影为 `attention_required`，用户重试仍复用同一 Run。不得重开 Libra、改判 Rejected 或创建第二个 On-deck Run。
- Handoff B Accepted 前，Libra 才能「接受瑕疵」或「放弃整理」；Accepted 后 Arca 已接管，检查失败不能借这两个动作退回或结束。
- NFO 允许 Emby 改写排版、`streamdetails` 和附加字段，但 Movie Identity、title/year/plot/genre/cast 必须与 accepted facts 一致；其他材料继续 exact package identity。
- post-Placement 恢复授权不得从路径、文件名或特定生产记录推断；只能读取同一 Run 的 durable Placement Result，并在 Stage、Staged Verify、Placement 三处重新核对 Run/Slot fence。
- Forward Recovery 的执行预算只用于已经分类为 `continue_forward` 的同一非纯 Effect；普通 Attempt、pure observation 与 `safe_retry` 继续使用原冻结 deadline，不能借恢复重置普通 hard timeout。
- Aftercare 的 source/stat fence 冲突属于预期外部写入竞争：单个 Event 必须形成 `external_writer_conflict` failed Outcome；同一 Case 仍遵守最多 3 代 Work，耗尽后形成一个稳定 attention。后续重新评估读取最新现实，语义等价时只提交 Inventory revision，不写 NFO。
- 不修改 Emby 配置，也不直接编辑生产 SQLite。当前 NFO semantic drift、Formation projection digest 与 Aftercare reclaim schema 异常已分别打回原任务；后续修复仍须标准 build/upload/deploy。
- 不得继续恢复或扩展 PROD-034 的两个目标 Run。
- 其余 active records 只按各自事实诊断；未经新授权，不把本次一次性纠正扩大到其他记录。
- PROD-042 部署后，现有失败 Rejection Work 只能通过已授权的 Formation Reset 调试能力清除；不得为它增加 migration、replan、dual-read 或旧 Input Binding fallback。Reset 后的新 Intake 必须用正常链路重新验证 token 能在 Rejection terminal 后释放。
- 恢复 Helix-beta acceptance evidence 工作时，仍以 `BETA_FEATURE_ACCEPTANCE_BASELINE.md` 为准；生产 health 不能折算为 `HB-*` PASS。
- 架构唯一 SSOT 仍为 `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；生产修复不得移动 Owner、Handoff 或 Canonical Transaction。
- 生产继续使用 `scripts/build-image.js` → `scripts/upload-nas-image.js` → `scripts/deploy-nas.js`；不删除、移动或改写 `/media` 正式媒体。

唯一活动 Phase 为 PROD-035；状态见 `docs/helix/implementation/CURRENT_PHASE.md`。
