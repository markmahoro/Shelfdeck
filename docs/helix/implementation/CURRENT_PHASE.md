# ShelfDeck Helix 当前实施阶段

状态：**PROD-035 LOCAL FIX COMPLETE — PRODUCTION NOT DEPLOYED**

日期：2026-08-31

## 目标

对 Formation 的活动记录逐项核对持久化事实、执行器、文件现实与 Admin Web 展示，并修复已证实的不一致：

1. direct-input 验证的业务分支不得显示为执行失败；
2. Transcode 输出探测不得覆盖 source observation，等待资源与实际转码必须显示真实阶段；
3. active list、筛选和 summary 在返回前以有界的 current detail facts 覆盖延迟 Projection；
4. On-deck 调整为 `Stage → Staged Verify → Placement → Final Product Verify → Settlement → Fulfillment → Commit`，Final Verify 在 Placement 后读取 Shelf 真实文件；
5. Primary 与其他普通成员继续严格校验 Package identity；NFO 按 Movie Identity、title/year/plot/genre/cast 做语义验收，并记录盘上实际 physical identity；Final Verify、Fulfillment、Commit 均重读最新现实；
6. Accepted 后失败的唯一 Arca On-deck Run 保持 Owner/Control，自动恢复最多生成 3 代 Supporting Work；仍失败则停止执行并稳定投影为 `attention_required`，用户可用「重试上架」继续同一 Run，不创建第二个 Run、Shelf Entry 或兼容双路径；
7. Aftercare 遇到语义等价的 NFO 指纹漂移时不写文件，只提交新的 Inventory Representation revision 并原子切换 Material Control；语义错误才 update/rebuild。
8. PROD-036 将 Field Observation 调整为 12 小时 cadence，对可重建 Entry 明细执行 7 天引用保护 GC；冻结 deadline 贯穿目录枚举和 fingerprint I/O，Page commit 前执行协作式 abort 栅栏；启动恢复复用原 Attempt、Effect 与幂等键，永久审计事实不删除。terminal Event/Attempt 聚合保护作为独立通用恢复保留。

## 边界

- Product Owner 已针对 Emby 并发改写 NFO 明确授权本次 SSOT 变化；授权只把 NFO 的 Final Reality 验收从 Package 字节全等改为「业务语义合格 + 保存实际物理指纹」，不改变 Owner、Handoff、Acceptance Basis、Final Inventory Decision 或 Handoff B Accepted 事实。
- Product Owner 已明确授权 PROD-036 的 12 小时 cadence 与 7 天历史保留；删除能力只授予 Procurement-owned Observation Entry detail，Execution Foundation 只聚合自身终态 Event，不接管 Procurement 决策。
- Primary 与其他精确成员的 Final Reality fingerprint 校验不弱化；NFO 损坏、Movie Identity 冲突或缺少拥有字段仍 fail closed，Commit 前不得建立 Shelf Entry。
- 「接受瑕疵」与「放弃整理」只适用于 Handoff B Accepted 以前的 Libra Run；Accepted 以后失败不得改判 Rejected、退回 Libra 或借这两个动作终结。此时 Arca 只允许有界自动恢复、稳定 attention 和同一 On-deck Run 的用户重试。
- 不恢复 PROD-034 已纠正的两个中止 Run。
- 不直接编辑生产 SQLite；恢复只能由 Arca 正式 Work、Capability、Effect 与 On-deck Commit 合同执行。
- 不修改 Emby 配置。本轮只授权本地代码、测试与文档，不部署生产。

## Exit Gate

- 本地 Formation focused、Arca On-deck/Aftercare/recovery、同根与重启恢复测试通过；Service full 386 项为 368 pass、18 skip、0 fail。
- Admin Web 37/37、production build、Helix Architecture full gate 通过；Service 与 Web 官方 npm registry audit 均为 0。
- 测试覆盖 Placement 后、Final Verify 后、Settlement 后、Fulfillment 后及 Commit 后的 NFO 改写：语义等价继续并保存最新实际指纹；错误 TMDB、缺拥有字段、坏 XML fail closed；Primary 漂移继续失败。
- 连续外部改写只保留一个活动 Case/Incident；自动恢复耗尽后不再周期重建 Work 或刷日志，并能由用户继续同一 Run。
- 生产发布、现场恢复《罪人》和生产验收尚未授权；发布时必须另行执行标准 build/upload/deploy、备份和只重建 ShelfDeck Compose 项目。
