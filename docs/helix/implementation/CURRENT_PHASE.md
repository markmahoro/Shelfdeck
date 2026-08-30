# ShelfDeck Helix 当前实施阶段

状态：**PRODUCTION STABILIZATION — PROD-032**

日期：2026-08-31

## 目标

修复生产 Libra Pre-deck 节流旁路，并执行一次有备份、可回滚的有损升级。保留 Procurement、Arca、People、Perception、Platform、Field、Shelf、集成配置及正式媒体；终止旧 Libra 执行现场、清空 Workspace 临时产物，使现存 Handoff A Package 重新按每 Field 席位进入 Libra。

## 已证实根因

- 生产有 720 个 active Subject，但没有 active Libra Run；Formation 仍显示 712 pending、2 in progress。
- `libra_predeck_pipeline_tokens` 为 0，后台 routing/spec/rating reconciler 却直接扫描全部 active Subject。
- 历史 succeeded Intake Evidence 被当作免票路径；Run Admission 又过早释放 token。
- 上一轮 full reset 只终止 Run/Work，没有把历史 Subject 的下游重建纳入 token gate。

## 本阶段变更边界

1. Intake Evidence 提交前先占用 per-field token；历史 Evidence replay 同样必须占用。
2. Routing、Subject Rating、Acceptance Spec、Run Creation 的 fallback 只推进 token holder。
3. Token 从 Intake 持有到 Handoff B Accepted 或用户 Discard；Intake Rejection 释放。
4. Formation 活动列表只展示 token holder 或已有 Run/Handoff B 的 Subject；历史事实不删除。
5. GET 不再隐式创建默认 policy；重复 PATCH 不更新时间戳；production image 只允许从 clean、commit-addressed worktree 构建。
6. Reset 只操作 Libra 执行现场与 `/transcode`，必须先停服务、建立唯一备份并校验数据库副本。

## Exit Gate

- targeted regression、完整 Service tests、Admin Web build、Helix Architecture gate 全绿；
- `git diff --check`、contract/schema verifier、production deploy contract 全绿；
- production tar SHA-256 与远端一致，标准 deploy dry run 通过；
- 升级后 health/readiness 正常，无旧 active Libra Run；
- 每 Field token held 不超过配置席位，Formation active queue 不再出现数百条 tokenless Subject；
- 备份目录、旧镜像/tar、compose 与回滚命令均已核实。

本阶段不修改 HB 验收结论，不授权删除正式媒体，不做 `--helix-clean-init`，不改 `media-desktop`。
