# ShelfDeck Clean Helix Current Status

Status: **MOVIE COLLECTION LIFECYCLE READY THROUGH SHELF DEREGISTRATION；PROD-032 已部署并通过生产稳定性核验。**

Last updated: 2026-08-31

## Production

- Host：`192.168.12.230:18080`。
- Running image：`markmahoro/shelfdeck:helix-beta-20260831-710aa1b65a`；source commit `710aa1b65a`。
- Image tar SHA-256：`19292cef75f10eb5216f52c41cdb8fc8f50ab156e6dcc27cf7c6c4c4809c8733`。
- Health：`ok`；generation `helix-clean-v3`；schema 186；`normalSupplyAllowed:true`；SQLite `integrity_check=ok`。
- Compose：`/vol1/1000/docker/shelfdeck`；data：`/vol1/1000/docker/shelfdeck/data`；Workspace mount：`/transcode`。
- PROD-032 rollback backup：`/vol1/1000/docker/shelfdeck/data.backup-20260830T170231Z-predeck-pipeline`。
- 其他 NAS Docker 服务在部署后只读检查时仍运行正常。

## PROD-032 生产结果

部署前现场为 720 active Subject、0 active Libra Run、0 token、200 条非终态 Libra Work，Formation 显示 712 pending、2 in progress、6 completed。根因是 Intake replay 和多个 fallback reconciler 绕过 per-field token，且 Run Admission 过早释放 token。

2026-08-31 有损升级按 stop → full data backup → migration → bounded Libra reset → standard deploy 执行：

- reset 时已没有 active/suspended/frozen Run，因此 discarded Run 为 0；
- 终止 200 条遗留 Libra Work，并同步取消其非终态 Event、Attempt 和 Resource Defer；
- 保留 1 条 Field policy（3 seats）、全部 Subject 和其他 Domain 事实；
- `/transcode` 当时无残留条目；没有删除、移动或改写 `/media` 正式媒体；
- 重启后同一 Field 稳定持有 3 个 token，仅有 3 条 admitted `routing_basis` Work，0 active Run；
- Formation Admin API 汇总为 3 pending、2 in progress、6 completed；active section 仅 5 条且无分页，不再展示数百条 tokenless 历史 Subject。

数据库中的 723 active Subject 继续作为业务连续性事实保留；Formation 是当前工作视图，不是历史 Subject 数据库浏览器。

## Verification

- Service：375 项（357 pass、18 skip、0 fail）。
- Helix Architecture：113 capabilities、99 result families、186 tables、44 transactions，全部通过；contract aggregate `dfe37fde6047adeb8526241f77d51fc45cebec691168b9eccc01208b8787f391`。
- Product Surface Matrix：123 routes；Admin Web build 与 37 tests 通过。
- Service 与 Web 的 official npm registry audit 均为 0；`git diff --check`、reset/部署脚本检查均通过。

现行产品验收权威仍为 `BETA_FEATURE_ACCEPTANCE_BASELINE.md`。本次生产修复不把任何 `HB-*` 自动标为 PASS。
