# ShelfDeck Clean Helix Current Status

Status: **MOVIE COLLECTION LIFECYCLE READY THROUGH SHELF DEREGISTRATION；PROD-034 已部署并完成一次性数据纠正。**

Last updated: 2026-08-31

## Production

- Host：`192.168.12.230:18080`。
- Running image：`markmahoro/shelfdeck:helix-beta-20260831-82861681ce`；source commit `82861681ce19ac3d58b289cf7c1ae94bc154eca9`。
- Image tar SHA-256：`85df9f1cd607587e8f027346ec7af47be93fb6fbe241b8d187b9be1410dcbbbc`。
- Health：`ok`；generation `helix-clean-v3`；schema 186；`normalSupplyAllowed:true`；SQLite `integrity_check=ok`。
- Compose：`/vol1/1000/docker/shelfdeck`；data：`/vol1/1000/docker/shelfdeck/data`；Workspace mount：`/transcode`。
- PROD-034 rollback backup：`/vol1/1000/docker/shelfdeck/data.backup-20260830T183135Z-prod034-one-time-correction`。
- 其他 NAS Docker 服务在部署后只读检查时仍运行正常。

## Production Corrections

PROD-032 已修复 Libra Pre-deck token 旁路并完成有损升级；保留全部 Subject 和 Field policy，终止 200 条遗留 Libra Work，使 Formation 从数百条活动记录收敛到真实工作集。证据见归档 Phase packet。

PROD-033 已收口终态 Work 下的执行层残留：39 Attempts、52 Events、2 Event Attempts 和 2 Effects；当前 residual 为 0，不再占满全局 64 个 active Attempt 名额。其 rollback backup 为 `/vol1/1000/docker/shelfdeck/data.backup-20260830T175325Z-prod033-execution-recovery`。

PROD-034 已按 Product Owner 授权对“唐人街探案 (2015)”和“赤壁（上） (2008)”执行封闭的一次性数据纠正：

- 两个 `discarded` Libra Run 不再恢复；两个 Custody、7 项 Material Control 和 35 条 Binding 已释放；
- 删除两个可重建的陈旧 Formation Projection，两个目标不再出现在 active section；
- 保留 Handoff、Package、Work、Attempt、Event、Effect 和 Final Inventory Decision 最低审计；
- 为这两个 Run 引入的通用 Arca 恢复兼容路径已经撤除；
- 未删除、移动或改写 `/media`、`/transcode` 文件。

## Formation Reset Debug Capability

- 当前工作区已经实现统一的 Formation Reset 离线调试能力，提供 `normal` 与 `nuclear` 两种模式；focused tests 14/14 通过。
- `normal` 终止并清理 On-deck Commit 前的活动整理现场，同时保留明确终态的过程记录；`nuclear` 物理删除该范围内的过程记录，使其在当前运行数据库中视同未发生。
- 两种模式都以 Arca On-deck Commit 为保护线，不触碰已入架事实和 `/media`，也不主动触发 Observation 或 Intake。
- **该能力尚未部署到生产 NAS。** 当前 Running image `markmahoro/shelfdeck:helix-beta-20260831-82861681ce` 不包含 Reset 核心；计划随后续 ShelfDeck 标准升级进入生产镜像。在此之前不得对生产执行 `scripts/formation-reset-nas.js --apply`。
- 截至本状态记录，生产环境没有执行过 Normal Reset 或 Nuclear Reset。

## Current Runtime

- Formation：0 pending、4 in progress、0 attention、8 completed；active section 共 4 条。
- 原 3 条 pending 中，百元之恋和我经过风暴已完成；异形2正在执行源媒体探测，不是卡死。
- 全局 active Attempt：13/64；execution residual：0。
- 其余 active records 是当前真实业务状态，不在本次一次性纠正授权范围内。

## Verification

- PROD-034 focused：2/2；Arca focused：24/24；Admin Web：37/37，build 通过。
- Helix Architecture：113 capabilities、99 result families、186 tables、44 transactions，全部通过；contract aggregate `dfe37fde6047adeb8526241f77d51fc45cebec691168b9eccc01208b8787f391`。
- Service full：381 项，362 pass、18 skip、1 个负载敏感的 FFmpeg stall-watchdog timing failure；对应测试文件单独复跑为 20 pass、1 skip、0 fail。
- Service 与 Web 的 official npm registry audit 均为 0；image checksum、deploy gates、SQLite integrity 和 production health 通过。

现行产品验收权威仍为 `BETA_FEATURE_ACCEPTANCE_BASELINE.md`。这些生产修复不把任何 `HB-*` 自动标为 PASS。
