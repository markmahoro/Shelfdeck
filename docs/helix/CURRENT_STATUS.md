# ShelfDeck Clean Helix Current Status

Status: **MOVIE COLLECTION LIFECYCLE READY THROUGH SHELF DEREGISTRATION；PROD-032 修复与有损升级进行中。**

Last updated: 2026-08-31

## Production

- Host：`192.168.12.230:18080`。
- Running image：`markmahoro/shelfdeck:helix-beta-20260830-5189f5f79c`。
- Image tar SHA-256：`8c9f3afa484bd56c2df92e7e1b07c569da4fd78d106b3d24379225926ef1d779`。
- Health：`ok`；generation `helix-clean-v3`；schema 186；`normalSupplyAllowed:true`。
- Compose：`/vol1/1000/docker/shelfdeck`；data：`/vol1/1000/docker/shelfdeck/data`；Workspace mount：`/transcode`。
- 当前备份：`data.backup-20260830-partial-libra-reset`、`data.backup-20260830-predeck-pipeline`。本轮尚未创建新备份。
- 其他 NAS Docker 服务在只读预检时正常。

## 2026-08-31 只读现场

- Libra Run：99 discarded、6 superseded、0 active/suspended/frozen/completed。
- Libra Subject：720 active。
- Formation：712 pending、2 in progress、6 completed；其中 91 条“等待重新入库”，621 条“正在确认目标、评分、要求或身份”。
- Pipeline policy：1；token：0。
- Supporting Work：Libra 183 admitted、17 running；Perception 48 admitted。
- Procurement Candidate Package：952。

结论：上一轮重置终止了 Run，却没有把历史 Subject 的 routing/spec/rating 重建纳入 token gate；“token=0 但数百条工作继续生成”证明 PROD-031 未达到用户可见目标。

## Local remediation

已完成：

- Intake replay 必须先取得 per-field token；
- 下游 fallback reconcilers 只扫描 token holder；
- token 生命周期延长到 Handoff B Accepted / Discard，rejection 释放；
- Formation active queue 隐藏 tokenless 且无 Run/Handoff B 的历史 Subject；
- Admin GET 无写入、重复 PATCH no-op；
- reset 增加 event/attempt/resource cancellation 与 `/transcode` 路径防护；
- production image build 拒绝 dirty worktree，并校验 tag 的 exact 10-char commit suffix；
- 一次性 NAS 排障脚本已从工作区删除；历史 SAFE PAUSE Phase 已归档。

本地门禁已完成：Service 375 项（357 pass、18 skip、0 fail）、Helix Architecture、Product Surface Matrix、Admin Web build/37 tests、reset/部署脚本语法与 `git diff --check` 均通过；Service 与 Web 的官方 npm registry audit 均为 0。生产部署尚未执行。

## Acceptance

现行产品验收权威仍为 `BETA_FEATURE_ACCEPTANCE_BASELINE.md`。本次修复、部署和 health 检查不把任何 `HB-*` 标为 PASS。
