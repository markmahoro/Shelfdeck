# ShelfDeck Helix 当前实施阶段

状态：**PROD-035 ACTIVE — FORMATION RUNTIME TRUTH AND ON-DECK RECOVERY**

日期：2026-08-31

## 目标

对生产 Formation 的 4 条活动记录逐项核对持久化事实、执行器、文件现实与 Admin Web 展示，并修复已证实的不一致：

1. direct-input 验证的业务分支不得显示为执行失败；
2. Transcode 输出探测不得覆盖 source observation，等待资源与实际转码必须显示真实阶段；
3. active list、筛选和 summary 在返回前以有界的 current detail facts 覆盖延迟 Projection；
4. Accepted 后失败的唯一 Arca On-deck Run 保持 Owner/Control，并以最多 3 代 Supporting Work 自动恢复同一 Run，不创建第二个 Run、Shelf Entry 或兼容双路径。

## 边界

- 不修改 SSOT、Acceptance Basis、Final Inventory Decision 或 Handoff B Accepted 事实。
- 不弱化 Final Reality fingerprint 校验，不把失败改判为 Rejected，不恢复 PROD-034 已纠正的两个中止 Run。
- 不直接编辑生产 SQLite；恢复只能由 Arca 正式 Work、Capability、Effect 与 On-deck Commit 合同执行。
- 部署前必须完成 NAS preflight、dry-run、image checksum 和数据备份；部署后核验 4 条记录与媒体文件现实。

## Exit Gate

- Formation focused tests、Arca recovery tests、service full tests、Admin Web tests/build、npm audits 全部通过。
- 生产 health、SQLite integrity、execution residual、active Attempt 容量正常。
- 冰血暴与千寻小姐显示等待 GPU，异形2显示实际 Transcode；罪人的同一 On-deck Run 完成恢复或以可解释的 bounded exhausted 状态留在 attention。
- Phase evidence、CURRENT_STATUS 和 CURRENT_PLAN 更新后归档本 packet，并恢复 `NO ACTIVE PHASE`。
