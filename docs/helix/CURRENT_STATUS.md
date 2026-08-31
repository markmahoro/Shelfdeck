# ShelfDeck Clean Helix Current Status

Status: **MOVIE COLLECTION LIFECYCLE READY THROUGH SHELF DEREGISTRATION；Observation replacement、PROD-037 NFO 与 Formation 合同修正已无损部署；Observation 恢复通过，Formation 详情验收失败。**

Last updated: 2026-08-31

## PROD-036 Production Monitoring

Field Observation 容量与崩溃恢复已随 `helix-beta-20260831-29efa3a229` 无损部署。生产只读证据已排除先前判断的 terminal Event 聚合窗口：同一 Work 的 Attempt 1–68 及各自 Event 均为 `succeeded`，共写入 `68 × 256 = 17,408` 条 Entry；Attempt 69 与 Event 仍为 `executing`，Effect 只有 intent，没有 Result、commit marker 或第 69 页 header，`runningAttemptWithOnlyTerminalEvents.count=0`。精确故障点位于领域提交前的 Observation executor I/O。冻结的 1 小时 Timeout Policy 此前接到 no-op isolator，只做执行前检查；页内任一 CIFS `stat/open/read` 不 settle 都会无限占住 Attempt。现有证据不能进一步归因到某个具体 syscall。

首次 replacement `helix-beta-20260831-29efa3a229` 运行约 68 分钟后，第 69 个 Event Attempt 仍为 `executing`、Effect 仍为 `intended`，header/Entry 完全不变。代码审计确认两个缺口：cooperative isolator 发送 abort 后仍无限等待不 settle 的 operation；non-pure recovery 抛出的 timeout 被 Host 重新排队并保留原 Attempt。replacement 现仅允许显式 abort-safe 的 Field Observation Executor 在 deadline 后经过 1 秒 settlement grace 硬结束 Runtime 等待，并让 ordinary/recovery 统一写 terminal failed、abandon 未提交 intent。迟到 operation 仍持有已 abort 的 Context，Page commit 前的执行资格门禁会拒绝它。

Recovery deadline 改为使用原 Event Attempt 的 durable `started_at_ms`，所以已超时的生产 Attempt 69 在 replacement 启动时直接收口，不会因重启重新获得一小时预算。该行为没有生产 Work ID 特例或人工数据补丁；通用 terminal Event 聚合保护继续独立保留。

Observation cadence 已由 30 分钟改为 12 小时。`proc_field_observation_entries` 仅保留 7 天，并保护 non-terminal Work、current Field Work、`active|waiting` Run、open Retry 与 current Material exact pointer；每事务最多删除 1,000 行。新库启用 incremental auto-vacuum；旧库使用默认 dry-run、显式 `--apply` 的离线 `VACUUM INTO` 原子替换工具。按生产测得 39.5 MiB/完整轮估算，7 天正常稳态约 553 MiB；30 天 gross churn 约 2.31 GiB，365 天约 28.16 GiB，但窗口外仅活动引用会增加 retained size。

hard-deadline replacement 已随 `helix-beta-20260831-ae7a567cde` 无损部署。启动恢复使用原 Event Attempt 的 durable deadline，旧第 69 页的 Work、Work Attempt、Event、Event Attempt 与 Effect 均已 terminal failed，错误为 `COOPERATIVE_EXECUTION_DEADLINE_EXCEEDED`；页数仍为 68、最大 page ordinal 67、Entries 仍为 17,408，没有 Result、header 或迟到第 69 页提交。现库 275,972 Entry、15 个 Observation Work、7 天以前 0、freelist 0；12 小时实际签发间隔与 7 天 GC 稳态仍需跨时间窗口继续观测。

## Production

- Host：`192.168.12.230:18080`。
- Running image：`markmahoro/shelfdeck:helix-beta-20260831-ae7a567cde`；source commit `ae7a567cde`。
- Image tar SHA-256：`7d7f06831329d4e025ba80020be96e3846a953f70b6f204dc8176e17b33d4543`。
- Health：`ok`；generation `helix-clean-v3`；schema 186；`normalSupplyAllowed:true`；SQLite `integrity_check=ok`。
- Compose：`/vol1/1000/docker/shelfdeck`；data：`/vol1/1000/docker/shelfdeck/data`；Workspace mount：`/transcode`。
- Current rollback backup：`/vol1/1000/docker/shelfdeck/backups/deploy-20260831T015047Z-ae7a567cde`；源/备份数据库字节一致，SQLite integrity `ok`、FK error 0。
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
- **该能力核心已随当前生产镜像部署到 NAS，但没有执行。** 调用仍必须显式指定 `normal|nuclear`、先 dry-run，再使用模式专属确认串 `--apply`；部署本身不触发 Reset。
- 截至本状态记录，生产环境没有执行过 Normal Reset 或 Nuclear Reset。

## Current Runtime

- 6 个 Event Attempt 正在 executing，12 个 Work Attempt 处于 active；Observation 已释放其 1 个 active Attempt。Libra 3 个 running Work、Arca 9 个 running Work；服务 health、SQLite quick check 与无关容器均正常。
- 新镜像初始窗口没有再出现 NFO source stale / `director` semantic drift，但既有《罪人》仍停在历史 On-deck attention，未做兼容恢复。
- Formation API 当前返回 4 条 active；Projection 为 `stale`，启动后出现 6 次 `FORMATION_PROJECTION_DIGEST_INVALID`。更严重的是《罪人》详情约 1.65 MB，材料准备错误吸入 Field-wide 867 个真实 Plan，并把 attention 显示为 `in_progress`、`executorIssue=null`。已按约定打回媒体整理详情任务；未编辑生产数据库。

## PROD-035 Production Monitoring

- Product Owner 已针对 Emby 并发改写 NFO 授权 SSOT 变化和本次无损部署；未授权修改 Emby 配置。
- On-deck 顺序改为 Placement 后 Final Verify；NFO 用 accepted Movie facts 做语义验收，同时保存 Shelf 上实际 physical identity。Primary 与其他普通成员仍严格校验 Package identity。
- Final Verify、Fulfillment、Commit 各自重读最新现实；Commit 用最后一次实际 Final Reality 建立 Inventory Representation 与 Material Control。
- Aftercare 对语义等价 NFO 漂移不改文件，只新增 Inventory Representation revision 并原子切换 Control；语义错误仍走带 CAS source guard 的 update/rebuild。
- Accepted 后失败继续由 Arca 持有同一 On-deck Run。自动恢复最多 3 代；耗尽后进入零执行资源的稳定 `attention_required`，停止周期性 Supporting Work 与错误日志，用户可「重试上架」继续同一 Run。
- 检查点审计确认：「接受瑕疵」和「放弃整理」属于 Handoff B Accepted 前的 Libra 旅程；Accepted 后不得用它们改判、回退或释放 Arca custody/control。
- 生产仍重复报 `ARCA_AFTERCARE_NFO_SOURCE_STALE` 与 `CLEAN_ARCA_FINAL_NFO_SEMANTIC_DRIFT`（owned field `director`）；因此 PROD-035 不能标记生产 FIXED，已打回原 NFO 任务继续修正。

## PROD-037 Production Monitoring

- 生产只读核对确认，`director` semantic drift 的目标是《老枪 (2024)》，不是《罪人》。盘上 NFO 的 TMDB `1184222`、title/year/plot/genre/cast 与 accepted facts 一致；Emby 增加的 director 属于可维护附加内容，不是 Final Reality gate。
- `ARCA_AFTERCARE_NFO_SOURCE_STALE` 属于另一条 Aftercare Case。source CAS 在 `material_commit` intent 后抛异常，旧 Runtime 将其视为未知副作用并持续恢复。
- 本地修正把 Presentation gate 限定到已授权字段，并将同一演员的弱名称/强 TMDB identity 合并验收；source/stat fence 冲突在文件回滚后返回 `retryDirective=never` 的 typed `external_writer_conflict`，使未提交 Effect 可 abandon、Event/Work 有界终结。
- 没有生产 DB 编辑、Emby 配置修改、Work ID 特例或旧条目兼容路径。修正已随当前镜像无损部署；初始监控窗口未见两类旧错误复发，仍需等待新的正式 Aftercare/On-deck 行为验证。

## Verification

- PROD-034 focused：2/2；Arca focused：24/24；Admin Web：37/37，build 通过。
- Helix Architecture full gate 通过；P2 contract aggregate 更新为 `549e136626021ed6f7f437e173775c06b59e82fc3cea73e189bdafeb0792404b`。DDL digest 保持 `3be2dad9b3615053681dfc2721974657fc3995ccf60a044e17dfb5131f0f8199`，无需 schema migration。
- 本次最终合并后 focused 135/135；完整 Service 399 项为 381 pass、18 skip、0 fail；Admin Web 38/38；production build 通过。
- 标准 build/upload/deploy dry-run/apply 完成，未使用 `--helix-clean-init`。部署脚本原只读 WAL readiness 返回 `SQLITE_CANTOPEN` 却未阻断；部署后 health/SQLite 校验通过。脚本已在本地修为“只读源复制到临时目录后校验，并强制匹配 ready”，对当前生产数据副本复验为 186 tables、123 routes、17 UI surfaces、findings []，尚未随镜像部署。
- PROD-035 targeted 覆盖 NFO 五个并发改写窗口、Primary 漂移、坏 XML/身份冲突/缺字段、Aftercare revision convergence、连续冲突聚合、同根与阶段恢复；UAT-131 四个场景通过。
- Service full：386 项，368 pass、18 skip、0 fail；Admin Web：37/37，production build 通过。
- Service 与 Web 的 official npm registry audit 均为 0；image checksum、deploy gates、SQLite integrity 和 production health 通过。

现行产品验收权威仍为 `BETA_FEATURE_ACCEPTANCE_BASELINE.md`。这些生产修复不把任何 `HB-*` 自动标为 PASS。
