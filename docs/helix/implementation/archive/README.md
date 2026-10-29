# Helix Implementation Archive Index

Status: historical implementation packets and closure evidence only; not an active plan.

Last updated: 2026-10-29

- [20260930_BETA_MOVIE_CLOSEOUT](20260930_BETA_MOVIE_CLOSEOUT/SNAPSHOT.md)：Movie用户阶段验收收尾前活动文档及补充发布状态快照，后续活动转入Series准备。

## Phase packets

- [OPS_RUNTIME_STARTUP_RELEASE_20261013](OPS_RUNTIME_STARTUP_RELEASE_20261013.md)：安全停机/用户Reset发布前启动竞态修正、完整生产副本/候选数据回退及生产部署Exit。

- P1–P8 的完整冻结 Phase packet 保存在本目录。
- P9–P13 的冻结结论由 `../evidence/P9_13_EXIT_AUDIT.md`、`../evidence/P10_EXIT_AUDIT.md`、
  `../evidence/P11_EXIT_AUDIT.md`、`../evidence/P12_EXIT_AUDIT.md`、`../evidence/P13_EXIT_AUDIT.md`、
  `../evidence/P13_IMPLEMENTATION_CONTRACT_BASELINE.md` 与 `../evidence/P13_E2E_READY_PACKAGE.json` 共同保存。
- `H1_SAFE_PAUSE_20260729.md` 是 P14 大纵向重定基前的历史暂停包；其四 profile Beta 门禁已由
  2026-08-22 Movie-only 范围修正覆盖。
- `PROD-032_PREDECK_PIPELINE_STABILIZATION_20260831.md`、
  `PROD-033_EXECUTION_RESIDUAL_RECOVERY_20260831.md` 与
  `PROD-034_ONE_TIME_ABORTED_HANDOFF_CORRECTION_20260831.md` 保存前三项生产纠正包。
- `PROD-035_TO_PROD-064_PRODUCTION_STABILIZATION_20260903.md` 保存后续稳定化索引。

这些文件只用于追溯。活工作以 GitHub PR 为准；默认阅读 SSOT + 根 `AGENTS.md` PR-ledger 指针（Playbook 按需）。

- Legacy phase 包全文：[CURRENT_PHASE_LEGACY_PACKET_THROUGH_20261021.md](CURRENT_PHASE_LEGACY_PACKET_THROUGH_20261021.md)（`../CURRENT_PHASE.md` 仅为 stub）。
- STATUS 长叙事保留在 `../../CURRENT_STATUS.md` 的 git history（stub 前见 `16c8714c2`）。薄 `../../CURRENT_STATUS.md` 仅保留授权部署身份位。

- [SERIES_DEVELOPMENT_20261008](SERIES_DEVELOPMENT_20261008.md)：Series五节点开发冻结包；首个可部署候选84c2cd9268，未部署生产，最终证据见包首链接。

- [OPS_RUNTIME_RESET_20261013](OPS_RUNTIME_RESET_20261013.md)：安全停机与用户Formation Reset本地开发/具体版本UI验收冻结包；最终产品0bcaf5a11，未部署生产。
