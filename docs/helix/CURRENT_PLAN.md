# ShelfDeck Clean Helix Master Plan

Status: **统一无损升级与 PROD-047 已完成；历史残留监控待决。**

Last updated: 2026-09-01

## 当前统一升级

- 保持既有五域、两次单向 Handoff 与 modular monolith 边界；不新增全局媒体对象、队列、反向 Handoff 或跨域写入。
- Libra 为每个 Material Field 保留固定 0–8 席；0 只阻止新 Handoff A 接收，Procurement 继续形成待整理媒体包，既有 Accepted 责任继续推进。
- 文件来源 API/UI 按 Field 显示已生成、Libra 已接收、等待 Libra 接收和 Structured Rejection；容量不足保持 open Offer，不伪造 rejection。
- 媒体整理当前分类收敛为整理中、需要处理、已完成；删除“待整理”筛选。总览分别展示 Procurement 等待接收与 Libra 正在整理。
- 合并文件来源/Per-Field Handoff A 账本、Formation 三态表达、Formation 详情排版、我的收藏成品库一级页、PROD-042 Rejection token 释放、PROD-044 semantic Execution Catalog 与 PROD-045 NFO 根节点生成/上架前门禁修复。
- 生产 621 个 Accepted 但无 token 的 Subject 是旧合同残留，不增加 migration、resume 或兼容路径；获授权 Nuclear Formation Reset 已完成，未 Commit 过程图已清除。本次镜像部署不再执行 Reset。
- Normal 与 Nuclear Reset 都必须清理 Accepted/no-token Subject 和 missing-admission-head Run；保留 Procurement Candidate/Delivery/Control 与已经 Arca On-deck Commit 的 Shelf/Deck 事实，不触碰 `/media`。

## 当前基线

- NAS production：`192.168.12.230:18080`。
- Image：`markmahoro/shelfdeck:helix-beta-20260901-84b8d313e0`；source commit `84b8d313e098e96f9e0e0f5fbdf16a85b31b16e2`；tar SHA-256 `438437bb32cae59a06ba4b9d1d7dab0f538638f61da796f86c639307012e2c45`。
- Health：`ok` / `helix-clean-v3` / `normalSupplyAllowed:true`；schema 186；SQLite integrity `ok`。
- Execution：PROD-047 exact 3 条遗留执行图已收口；另有 2 条 active Aftercare reclaim Work 只发生 inode drift，未获授权处理。
- Formation：0 `in_progress`、1 `attention_required`、4 `completed`；《千寻小姐》与《罪人》已完成，《人生密密缝》保持旧 NFO drift attention。

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
- PROD-042 已部署：Intake Rejection Planner 不再把整个 Supporting Work dependency ref 当成 `evidenceWorkId`，而是 fail-closed 提取唯一 `objectId`；回归覆盖 Rejection Decision 原子提交与 Pre-deck token 释放。旧失败条目不做兼容恢复。
- PROD-044 已部署：Execution Catalog 只哈希可执行语义，完整 manifest digest 继续覆盖 traceability；精确 `37264ba7…` 旧摘要仅允许 Attempt 与全部 Event 已终态的历史 Plan。生产 846 个该摘要 Plan 全终态。
- PROD-045 已部署：Libra NFO 只编辑根节点直接子元素，重复 genre 与 Product Fact 使用同一规范集合，演员 TMDB ID 不再被 movie ID 覆盖；Arca Staged Verify 在 Placement 前校验 NFO Presentation。现有失败影片不兼容恢复。
- PROD-047 一次性生产纠正已完成：只对操作员显式列出的 3 条旧 Aftercare reclaim Work，在旧 Receipt、
  reclaimed 领域现实与无 Result/Marker 执行残留全部精确吻合时终止执行图；完整备份、离线事务、完整性检查
  与二次 dry-run 均通过。未改 Receipt、Aftercare/Inventory/Material 事实或媒体文件，也未形成 Runtime 兼容路径。

## 下一步规则

- PROD-035 仍只覆盖 Formation runtime truth、Emby 并发改写 NFO，以及 Accepted 后失败的同一 Arca On-deck Run 的 owner-local convergence。
- PROD-036 只改变 Observation cadence、可重建 Entry 明细保留、Observation I/O deadline 与既有 Effect 的通用启动恢复；永久 header、Result/Evidence、Commit Marker、执行图及 Run/Retry/Candidate/Handoff 事实不删除，也不写生产 Work ID 特例。12 小时实际签发间隔与 7 天 GC 稳态仍需跨时间窗口继续观测。
- Formation active list 必须在有界范围内合成 current detail facts；延迟 durable Projection 不得造成列表、summary 和详情互相矛盾。Candidate Package + Structure Unit 双重绑定、同 Run 重试与 successor 聚合均已部署；后续继续以新条目验证，不为旧残留增加兼容路径。
- 列表“当前进展”与详情过程卡片必须引用同一持久化Workflow Plan顺序、标题和执行状态；业务检查“未通过”是该检查的真实结果，不得提升为Runtime失败或“需要处理”。只有真实技术失败、无后继可推进责任或明确用户动作才进入attention表达。前端不得恢复`organizingSteps` Plan回退。
- On-deck 恢复沿用 immutable Final Inventory Decision 和同一 Run，自动恢复最多 3 代 Supporting Work；耗尽后必须停止自动执行并投影为 `attention_required`，用户重试仍复用同一 Run。不得重开 Libra、改判 Rejected 或创建第二个 On-deck Run。
- Handoff B Accepted 前，Libra 才能「接受瑕疵」或「放弃整理」；Accepted 后 Arca 已接管，检查失败不能借这两个动作退回或结束。
- NFO 允许 Emby 改写排版、`streamdetails` 和附加字段，但 Movie Identity、title/year/plot/genre/cast 必须与 accepted facts 一致；其他材料继续 exact package identity。
- post-Placement 恢复授权不得从路径、文件名或特定生产记录推断；只能读取同一 Run 的 durable Placement Result，并在 Stage、Staged Verify、Placement 三处重新核对 Run/Slot fence。
- Effect Recovery 的执行预算只用于已经分类为 `continue_forward`，或现实探测已证明 Effect 不存在的非纯 `safe_retry`；同一 Effect 只冻结一次恢复起点，重启不得刷新。普通 Attempt、`safe_retry_before_intent` 与 pure observation 继续使用原冻结 deadline，不能借恢复重置普通 hard timeout。
- Aftercare 的 source/stat fence 冲突属于预期外部写入竞争：单个 Event 必须形成 `external_writer_conflict` failed Outcome；同一 Case 仍遵守最多 3 代 Work，耗尽后形成一个稳定 attention。后续重新评估读取最新现实，语义等价时只提交 Inventory revision，不写 NFO。
- 不修改 Emby 配置，也不直接编辑生产 SQLite。当前 NFO semantic drift、Formation projection digest 与 Aftercare reclaim schema 异常已分别打回原任务；后续修复仍须标准 build/upload/deploy。
- 不得继续恢复或扩展 PROD-034 的两个目标 Run。
- 其余 active records 只按各自事实诊断；未经新授权，不把本次一次性纠正扩大到其他记录。
- 生产监控新增两个待决事实：3 条 orphan provisional pipeline token 占住全部 Libra 席位，但当前 Formation Reset
  不覆盖无 Subject 的 token；另有 2 条 active Aftercare reclaim Work 只发生 inode drift。先完善通用 Reset 诊断
  与边界，再提交新的 dry-run 计划；不得把它们并入已结束的 PROD-047 授权。
- PROD-042 部署后，现有失败 Rejection Work 只能通过已授权的 Formation Reset 调试能力清除；不得为它增加 migration、replan、dual-read 或旧 Input Binding fallback。Reset 后的新 Intake 必须用正常链路重新验证 token 能在 Rejection terminal 后释放。
- 恢复 Helix-beta acceptance evidence 工作时，仍以 `BETA_FEATURE_ACCEPTANCE_BASELINE.md` 为准；生产 health 不能折算为 `HB-*` PASS。
- 架构唯一 SSOT 仍为 `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；生产修复不得移动 Owner、Handoff 或 Canonical Transaction。
- 生产继续使用 `scripts/build-image.js` → `scripts/upload-nas-image.js` → `scripts/deploy-nas.js`；不删除、移动或改写 `/media` 正式媒体。

唯一活动 Phase 为 Nuclear Reset 完成后的本次统一生产升级；状态见 `docs/helix/implementation/CURRENT_PHASE.md`。
