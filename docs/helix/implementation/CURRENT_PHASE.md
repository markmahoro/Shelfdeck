# ShelfDeck Helix 当前实施阶段

状态：**UNIFIED PRODUCTION UPGRADE + NUCLEAR FORMATION RESET — GATE IN PROGRESS**

日期：2026-08-31

## 目标

本轮在不改变Owner/Handoff边界的前提下完成统一升级与旧Formation数据清场：

1. Field固定席位允许0；0不接受新包，但不停止Procurement或既有Accepted责任；
2. Procurement按Field形成generated/accepted/waiting/rejected交接账；
3. Formation取消“待整理”current分类与筛选，Accepted条目从整理中或需要处理开始；
4. 文件来源页重排为Procurement交接账本与Libra席位两列，总览同时表达两段数量；
5. 合并我的收藏成品库一级页、Formation详情排版与PROD-042 Rejection token释放修复；
6. 新镜像离线加载后、服务启动前执行Nuclear Formation Reset，删除未完成Arca Commit的过程图，保留Procurement和已入架事实；
7. 部署后验证Per-Field generated/accepted/waiting/rejected、Formation三态、Libra/Arca运行与收藏页关键表面。

## 已部署基线（保留）

对 Formation 的活动记录逐项核对持久化事实、执行器、文件现实与 Admin Web 展示，并修复已证实的不一致：

1. direct-input 验证的业务分支不得显示为执行失败；
2. Transcode 输出探测不得覆盖 source observation，等待资源与实际转码必须显示真实阶段；
3. active list、筛选和 summary 在返回前以有界的 current detail facts 覆盖延迟 Projection；
4. On-deck 调整为 `Stage → Staged Verify → Placement → Final Product Verify → Settlement → Fulfillment → Commit`，Final Verify 在 Placement 后读取 Shelf 真实文件；
5. Primary 与其他普通成员继续严格校验 Package identity；NFO 按 Movie Identity、title/year/plot/genre/cast 做语义验收，并记录盘上实际 physical identity；Final Verify、Fulfillment、Commit 均重读最新现实；
6. Accepted 后失败的唯一 Arca On-deck Run 保持 Owner/Control，自动恢复最多生成 3 代 Supporting Work；仍失败则停止执行并稳定投影为 `attention_required`，用户可用「重试上架」继续同一 Run，不创建第二个 Run、Shelf Entry 或兼容双路径；
7. Aftercare 遇到语义等价的 NFO 指纹漂移时不写文件，只提交新的 Inventory Representation revision 并原子切换 Material Control；语义错误才 update/rebuild。
8. PROD-036 将 Field Observation 调整为 12 小时 cadence，对可重建 Entry 明细执行 7 天引用保护 GC；冻结 deadline 贯穿目录枚举和 fingerprint I/O，Page commit 前执行协作式 abort 栅栏。首次 replacement 生产运行超过一小时仍不收口；现仅对显式 abort-safe Executor 执行 deadline + 1 秒 settlement grace 的 hard race，ordinary/recovery 统一 terminal fail 并 abandon intent，迟到提交由 Context 门禁拒绝；recovery 保持原 Attempt deadline。永久审计事实不删除，terminal Event/Attempt 聚合保护独立保留。
9. PROD-037 将 NFO Presentation gate 收回 Movie Identity、title/year/plot/genre/cast；Aftercare source/stat fence 竞争在回滚完成后形成 typed terminal failure，不再留下未知 `material_commit` Effect。
10. Formation 详情只投影与当前 Subject 的 Candidate Package、Structure Unit、Libra Run、Offer 和 Arca On-deck Run 正式绑定的 immutable Workflow Plan；Accepted On-deck planning failure 从 Work Definition 恢复并继续同一 Run，耗尽后投影可重试 attention。
11. Scheduler 对已到期的 Resource waiter 使用 scheduling-round fairness，而不是依赖 100ms wall-clock cooldown；过程卡片在当前后继 Work 运行时显示进行中，同时保留旧失败 Plan 的真实结果。
12. PROD-040 修复同一 On-deck Run 的 post-Placement 恢复窗口：先前成功 Placement 必须以同 Run、同 Target Commit Slot 的 typed Receipt 授权；NFO 可按语义继续并记录实际指纹，Primary/其他材料仍严格按 Package bytes，任何生产影片或旧 Work 不得拥有特殊分支。
13. Formation 的 Plan 状态只表达真实执行是否完成，不把成功提交的业务检查结论 `failed|not_available` 投影成执行失败；一级页“当前进展”与过程卡片使用同一真实 Plan 摘要，前端不得从 `organizingSteps` 再拼一套 Plan。`workspace_media_production` 的相邻 Plan 必须按其实际工作区分标题。
14. PROD-041 修复 `continue_forward` Effect Recovery 的执行时限：恢复执行拥有一次 durable、不可重置、仍受原 Timeout Policy 约束的预算；不得改写原 Attempt/Input/Fence/Effect 身份，也不得放宽 pure observation 或 ordinary retry hard deadline。
15. 同一 Owner/Process/Work kind 责任链由最新 Supporting Work 决定当前阶段状态；整体 On-deck 已完成时，`currentPlan` 必须指向完成提交的 successor，历史失败 Plan 只保留在过程卡片中。没有 successor 的真实失败仍保持 `attention`。

## 边界

- Product Owner 已针对 Emby 并发改写 NFO 明确授权本次 SSOT 变化；授权只把 NFO 的 Final Reality 验收从 Package 字节全等改为「业务语义合格 + 保存实际物理指纹」，不改变 Owner、Handoff、Acceptance Basis、Final Inventory Decision 或 Handoff B Accepted 事实。
- Product Owner 已明确授权 PROD-036 的 12 小时 cadence 与 7 天历史保留；删除能力只授予 Procurement-owned Observation Entry detail，Execution Foundation 只聚合自身终态 Event，不接管 Procurement 决策。
- Primary 与其他精确成员的 Final Reality fingerprint 校验不弱化；NFO 损坏、Movie Identity 冲突或缺少拥有字段仍 fail closed，Commit 前不得建立 Shelf Entry。
- 「接受瑕疵」与「放弃整理」只适用于 Handoff B Accepted 以前的 Libra Run；Accepted 以后失败不得改判 Rejected、退回 Libra 或借这两个动作终结。此时 Arca 只允许有界自动恢复、稳定 attention 和同一 On-deck Run 的用户重试。
- 不恢复 PROD-034 已纠正的两个中止 Run。
- 不直接编辑生产 SQLite；本次只允许经统一 Formation Reset 工具、完整备份与离线事务执行已授权的 Nuclear Reset。
- 不修改 Emby 配置。本轮生产部署仅使用标准无损 replacement，不执行 clean init、Reset 或生产数据库编辑。
- 不为现有生产影片、固定 ID、路径、Run/Work/Effect 编写兼容或 fallback。若正式事实已经不可自洽，只能整理 Reset 证据并另行申请授权，不能由本修复掩盖。

## Exit Gate

- 本地 Formation focused、Arca On-deck/Aftercare/recovery、同根与重启恢复测试通过；Service full 386 项为 368 pass、18 skip、0 fail。
- Admin Web 37/37、production build、Helix Architecture full gate 通过；Service 与 Web 官方 npm registry audit 均为 0。
- 测试覆盖 Placement 后、Final Verify 后、Settlement 后、Fulfillment 后及 Commit 后的 NFO 改写：语义等价继续并保存最新实际指纹；错误 TMDB、缺拥有字段、坏 XML fail closed；Primary 漂移继续失败。
- 连续外部改写只保留一个活动 Case/Incident；自动恢复耗尽后不再周期重建 Work 或刷日志，并能由用户继续同一 Run。
- Product Owner 已授权并完成 replacement 标准 build/upload/deploy、备份和 ShelfDeck Compose 无损重建；未使用 clean init/reset。PROD-036 旧第 69 页已按原 durable deadline terminal fail，68 页/17,408 Entries 不变、无迟到提交。
- PROD-037 已部署，初始窗口未见旧 NFO 错误复发。Formation 详情验收失败：《罪人》吸入 Field-wide 867 个 Plan，attention 仍显示为 `in_progress` 且无重试动作，已打回原任务；既有坏 Projection/Receipt 未获一次性纠正授权，继续 fail closed。
- Formation 精确 Candidate Plan Scope 与 On-deck Work Definition Recovery 已随 `91f990609c` 部署；生产详情收敛到约 14–25 KiB，并为《罪人》的同一 On-deck Run 建立第三代 Work。
- 第三代 Work 的首个 Event 被两个长期 Resource waiter 饿死；scheduling round 已部署并让后续 eligible Event 获得机会，过程卡片以当前 successor 作为阶段状态并保留旧失败 Plan。生产《罪人》同一 On-deck Run 已完成至 Commit。
- PROD-040 精确回归必须证明：原始 `offloadContext` 为空时，同 Run 先 Placement、Emby 后改写的语义等价 NFO 可通过恢复 Stage/Staged Verify/Placement 且字节不被覆盖；缺少或错配 Placement Receipt 仍报 target occupied；Primary 漂移仍失败。只允许正常新条目复现路径，不测试旧数据兼容。
- PROD-040 本地验证：相关 focused 68/68；Service full 385 pass、18 skip、0 fail；Admin Web 38/38 与 production build 通过；官方 npm registry audit 为 0。Architecture semantic/manifest/contract PASS，总 gate 仍仅受 main 既有两个 dynamic-template scanner findings 阻断。
- 生产只读证据确认《冰血暴 (1996)》计划12的 Work、Work Attempt、两个 Event 与 Result Outcome 均为 `succeeded`；业务检查结论为 `max_size_exceeded`，原片 `10,773,491,271 bytes`，收藏上限 `8,589,934,592 bytes`。本地过程投影现把该计划显示为已完成并列明“未通过 / 文件大小 / 收藏上限”，计划11–14分别命名为“读取原始媒体信息 / 判断原片是否可以直接使用 / 确认视频处理方式 / 处理媒体文件”；一级页由后端同源返回“计划14 处理媒体文件 / 等待处理资源”，React不再读取`organizingSteps`生成副文案。
- 本项 focused 42/42、Admin Web 38/38、production build通过。Service full当时为403项：384 pass、18 skip、1个FFmpeg stall-watchdog时序测试在全量并发下失败，单独重跑1/1通过；最终合并后 Service full 406项为388 pass、18 skip、0 fail。本项已部署，未改生产数据。
- PROD-041 必须覆盖：原 Attempt deadline 已过但 Effect Reconciler 已给出 `continue_forward` 时，Capability 能获得一次按原 Timeout Policy 计算的恢复预算并实际收敛；恢复期间再次崩溃后 deadline 不得刷新；`safe_retry` / pure observation 的既有 deadline 行为保持不变。
- PROD-041 本地验证：P4 focused 96/96；Service full 385 pass、18 skip、0 fail。部署后《罪人》同一 Effect/Run 获得一次有界恢复预算并完成 Commit；未编辑生产数据。
- 生产完成态验收曾暴露 `currentPlan` 回捞同一 On-deck Run 的早期失败 Plan；现以同责任链最新 Work 聚合阶段状态，并在最终上架阶段完成时返回最后完成 Plan 摘要。历史失败仍在过程卡片内，未完成且没有 successor 时仍投影 `attention`。最终 targeted 10/10，Service full 406 项为 388 pass、18 skip、0 fail；生产《罪人》已显示 `计划5 将媒体写入收藏架 / 已完成`。
