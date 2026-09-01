# ShelfDeck Clean Helix Current Status

Status: **统一无损升级与获授权 PROD-047 纠正已完成；生产监控发现两类未授权历史残留。**

Last updated: 2026-09-01

## Local implementation completed

- 已确认 SSOT 边界：Procurement 继续生成 Candidate Package；Field 席位满或为0时，open Handoff A Offer、责任和 Control 留在 Procurement。
- Field API 已改为 generated/accepted/waiting/rejected；Formation 当前业务分类已收敛为 in_progress/attention_required/completed；Admin Web 已删除“待整理”筛选并把文件来源页重排为 Procurement 交接账本与 Libra 席位。
- 旧四态 Formation 表升级时只重建可派生 Projection，不改 Subject、Token、Handoff、Run 或其他 Owner 事实；本地目标 DDL digest 为 `6a2246c39bebcd1f6f80264bac793c7a3119636a791683e426e4c30aa6fdc651`。
- 最终合并验证：Service 412 项为 394 pass、18 skip、0 fail；Admin Web 42/42 且 production build 通过；NFO/Catalog focused 66/66。Architecture fixture、semantic、manifest、contract 均通过，contract aggregate 为 `ab70c205efa3f8d8dd399d352690497918e3489ae9118bf067ea58b281accf75`；总 gate 仍仅被未改动的 `formation-process-projection.js` 与 `progress-projection-reader.js` 18 个既有 dynamic-template scanner findings 阻断。Service production dependencies 与 Admin Web 全依赖经 npm 官方 registry 审计均为 0 vulnerability。
- 文件来源/Formation 新语义、Formation 详情排版、我的收藏成品库一级页、PROD-042、NFO 与 Catalog 修复均已合并并随当前统一镜像部署。
- 生产所谓“600 多个假死 Libra Run”实际以 621 个 Accepted 但无 token 的历史 Subject 为主；生产现有真实 `libra_runs` 仅 101 个，其中此前 dry-run 识别 2 个 actionable Run。它们不获得兼容权利。
- Formation Reset 已修复 Control scope：Procurement-owned Control 保留；Libra `subject|on_deck_package` 与 Arca custody Control 属于可清理范围；Nuclear 只回卷 Formation Control revision 后缀并恢复 Procurement 边界。
- 首次生产 Nuclear apply 在事务提交前由 `foreign_key_check` 阻断并完整回滚：2 条受保护的已 Commit Run 仍以 `supersedes_run_id` 指向待删除旧 Run。Nuclear 现同步清空保留 Run 上指向被删除 Run 的 supersession pointer；回归覆盖保护 Run、Shelf Entry 与 Commit Receipt继续保留。
- 修正后的生产 Nuclear Reset 已完成：删除 716 个未 Commit Subject、101 个 Libra Run 和 3,275 个过程 Work；保留 10 条已 Commit 责任链、全部 Procurement 事实与 `/media`。事务后 Accepted/no-token Subject、active/no-admission-head Run 和孤儿引用均为 0；随后新 Observation/Intake 只按正常链路自然形成新条目。
- 两种 Reset 均报告并清零 Accepted/no-token Subject 与 active/no-admission-head Run；Normal 可建立一次 reset-only Admission Head 后正式 discard，Nuclear 删除整个未 Commit 图。Service 411 项为 393 pass、18 skip、0 fail；Admin Web 42/42 且 production build 通过。Architecture fixture、semantic、manifest、contract 均通过，总 gate 仍仅受 18 个既有 dynamic-template scanner findings 阻断。

## PROD-036 Production Monitoring

Field Observation 容量与崩溃恢复已随 `helix-beta-20260831-29efa3a229` 无损部署。生产只读证据已排除先前判断的 terminal Event 聚合窗口：同一 Work 的 Attempt 1–68 及各自 Event 均为 `succeeded`，共写入 `68 × 256 = 17,408` 条 Entry；Attempt 69 与 Event 仍为 `executing`，Effect 只有 intent，没有 Result、commit marker 或第 69 页 header，`runningAttemptWithOnlyTerminalEvents.count=0`。精确故障点位于领域提交前的 Observation executor I/O。冻结的 1 小时 Timeout Policy 此前接到 no-op isolator，只做执行前检查；页内任一 CIFS `stat/open/read` 不 settle 都会无限占住 Attempt。现有证据不能进一步归因到某个具体 syscall。

首次 replacement `helix-beta-20260831-29efa3a229` 运行约 68 分钟后，第 69 个 Event Attempt 仍为 `executing`、Effect 仍为 `intended`，header/Entry 完全不变。代码审计确认两个缺口：cooperative isolator 发送 abort 后仍无限等待不 settle 的 operation；non-pure recovery 抛出的 timeout 被 Host 重新排队并保留原 Attempt。replacement 现仅允许显式 abort-safe 的 Field Observation Executor 在 deadline 后经过 1 秒 settlement grace 硬结束 Runtime 等待，并让 ordinary/recovery 统一写 terminal failed、abandon 未提交 intent。迟到 operation 仍持有已 abort 的 Context，Page commit 前的执行资格门禁会拒绝它。

Recovery deadline 改为使用原 Event Attempt 的 durable `started_at_ms`，所以已超时的生产 Attempt 69 在 replacement 启动时直接收口，不会因重启重新获得一小时预算。该行为没有生产 Work ID 特例或人工数据补丁；通用 terminal Event 聚合保护继续独立保留。

Observation cadence 已由 30 分钟改为 12 小时。`proc_field_observation_entries` 仅保留 7 天，并保护 non-terminal Work、current Field Work、`active|waiting` Run、open Retry 与 current Material exact pointer；每事务最多删除 1,000 行。新库启用 incremental auto-vacuum；旧库使用默认 dry-run、显式 `--apply` 的离线 `VACUUM INTO` 原子替换工具。按生产测得 39.5 MiB/完整轮估算，7 天正常稳态约 553 MiB；30 天 gross churn 约 2.31 GiB，365 天约 28.16 GiB，但窗口外仅活动引用会增加 retained size。

hard-deadline replacement 已随 `helix-beta-20260831-ae7a567cde` 无损部署。启动恢复使用原 Event Attempt 的 durable deadline，旧第 69 页的 Work、Work Attempt、Event、Event Attempt 与 Effect 均已 terminal failed，错误为 `COOPERATIVE_EXECUTION_DEADLINE_EXCEEDED`；页数仍为 68、最大 page ordinal 67、Entries 仍为 17,408，没有 Result、header 或迟到第 69 页提交。现库 275,972 Entry、15 个 Observation Work、7 天以前 0、freelist 0；12 小时实际签发间隔与 7 天 GC 稳态仍需跨时间窗口继续观测。

## Production

- Host：`192.168.12.230:18080`。
- Running image：`markmahoro/shelfdeck:helix-beta-20260901-84b8d313e0`；source commit `84b8d313e098e96f9e0e0f5fbdf16a85b31b16e2`；tar SHA-256 `438437bb32cae59a06ba4b9d1d7dab0f538638f61da796f86c639307012e2c45`。
- Running image ID：`sha256:f20ba121f07bdbef6a3400168b2cf81ad3c3d7f8a48b077292f2c719cb876291`。
- Health：`ok`；generation `helix-clean-v3`；schema 186；`normalSupplyAllowed:true`；SQLite `integrity_check=ok`。
- Compose：`/vol1/1000/docker/shelfdeck`；data：`/vol1/1000/docker/shelfdeck/data`；Workspace mount：`/transcode`。
- PROD-047 离线纠正备份：`/vol1/1000/docker/shelfdeck/data.backup-20260901T082544Z-prod047-aftercare-reclaim`（约 898 MiB）。
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

- 当前工作区已经实现统一的 Formation Reset 离线调试能力，提供 `normal` 与 `nuclear` 两种模式。
- `normal` 终止并清理 On-deck Commit 前的活动整理现场，同时保留明确终态的过程记录；`nuclear` 物理删除该范围内的过程记录，使其在当前运行数据库中视同未发生。
- 两种模式都以 Arca On-deck Commit 为保护线，不触碰已入架事实和 `/media`，也不主动触发 Observation 或 Intake。
- **该能力核心已随当前生产镜像部署到 NAS，并已完成一次获授权的 Nuclear Reset。** 后续调用仍必须逐次获得明确生产授权、显式指定 `normal|nuclear`、先 dry-run，再使用模式专属确认串 `--apply`；部署本身不触发 Reset。
- 本轮统一无损升级不再执行 Reset，也不使用 clean init。
- Reset 发现范围现补齐无 Subject 的 orphan pipeline token：以 token 自身与 `source_process_id` 为独立范围根，
  同时纳入其 Libra Intake Work。Normal 删除 token、终止活动执行但保留终态审计；Nuclear 删除 token 与对应执行图。
  两种模式的 postcondition 都要求 orphan token 为 0。
- 首次获授权 Nuclear apply 清除了 3 条旧 orphan token 与《人生密密缝》未 Commit 链，但自然 Intake 立即又形成
  3 条新 orphan token。生产联表证明每条都有 1 张 WorkAdmission Command Receipt，Receipt 的 `target_id` 指向
  已被早先 Nuclear Reset 删除、当前不存在的 Intake Evidence Work；Admission 因而回放“已 admit”却没有 Work。
- Reset 现同时删除 Nuclear execution graph 对应的 Work-target Command Receipt，并全局识别 Libra 中 target Work
  已不存在的 phantom WorkAdmission Receipt；两种模式都会先删除这种不自洽 Receipt，Nuclear 再删除完整图。
  这覆盖尚未取得 token 的潜伏 Receipt，避免调度游标继续逐批撞上历史回放。最新聚焦 12/12，Service full
  426 项为 408 pass、18 skip、0 fail。

## PROD-042 Local Fix

- 生产只读诊断确认：3 个 Pre-deck token 中有 1 个停在 Intake Rejection。Evidence Work 已正式返回 `candidate_material_unavailable`，但 Rejection Planner 把整个 `dependencyRef` 对象写进 `evidenceWorkId`，Input Projection 因此无法按字符串 Work ID 读取 Evidence Result；Rejection Decision 未提交，token 也不能释放。
- 本地已将 Rejection Planner 收紧为只接受唯一的 Libra Supporting Work 依赖，并只投影其 `objectId`。focused 回归实际覆盖 Planner → Input Projection → Rejection Store commit → Coordinator token release，2/2 通过。
- 修复没有为现有失败 Work 增加重规划、fallback 或兼容读取，已随当前统一镜像部署。生产监控发现的
  1 条旧失败 Rejection Work 关联的是无 Subject 的 provisional token，不做兼容恢复。

## PROD-044 / PROD-045 Local Fixes

- 前一次候选镜像 readiness 因 846 个旧执行目录摘要 Plan 阻断启动，部署未继续；原镜像与健康数据已恢复。生产只读审计确认这些 Plan 全部终态，当前 3 个活动 Arca Work 均使用既有兼容摘要。执行摘要现排除纯追踪 `sourceLocator`，精确旧摘要只允许全终态历史退役。
- 《人生密密缝》的根因是 Libra NFO renderer 只替换首个根级 genre，且无层级正则把 actor 的 TMDB ID 当作 movie ID；Workspace NFO 在进入 Arca 前已与 Product Fact 不一致。现改为只编辑根节点直接子元素、整体规范化多值 genre，并在 Arca Placement 前执行 staged NFO 语义门禁。
- 两项均为通用合同修复，没有影片、路径、Run 或生产 ID 特例；现有失败《人生密密缝》不做兼容恢复。

## PROD-047 Completed One-time Correction

- 生产 3 条 `care_workspace_reclaim` 遗留执行图的领域现实已经完成 reclaimed，但 Material 保存的是缺少
  `scopeDigest` 的旧 `ReclamationReceipt/v1` digest；当前执行图没有 Result/Commit Marker，因此通用恢复
  必须持续 fail closed，不能把旧事实伪造为当前成功。
- Product Owner 已授权只终止这 3 条旧 Work/Event/Attempt/Effect。默认 dry-run 的 PROD-047 工具以
  终态 Case、完整 reclaimed scope、旧/新 Receipt 精确 digest、零 Result/Marker/活动引用和单链结构共同
  证明范围；apply 还要求外部逐条传入 exact Work ID，集合漂移或任一不变量不符即整批拒绝。
- 首次生产 plan 额外观察到 1 条 Workspace 仍 active 且有活动引用的正常 reclaim Work；exact Work 集合门禁
  在事务前阻断，自动重启原服务，数据库未纠正。工具现明确只把领域 Registry 已 reclaimed 的执行残留纳入
  PROD-047 候选，正常 active Workspace 只列为 excluded 诊断。
- 生产 apply 已在完整离线备份后完成：exact 3 条 Work、3 条 Work Attempt、3 条 Event 和 3 条 Effect
  分别收口为 `cancelled/cancelled/cancelled/failed`，3 条 Event Attempt 形成完成的 cancelled Outcome；统一错误码为
  `P4_LEGACY_AFTERCARE_RECLAIM_EXECUTION_RETIRED_PROD047`。事务后 `integrity_check=ok`。
- 二次 dry-run 返回候选 0、unsafe 0，证明纠正幂等；正常 active Workspace Work 继续只列为 excluded。
  纠正没有改 Receipt、Aftercare Case、Inventory、Workspace/Material reclaimed 事实或任何媒体文件，也没有向
  Runtime 增加 migration、fallback 或旧条目兼容。

## Current Runtime

- Formation 当前为 5 条：0 条 `in_progress`、1 条 `attention_required`、4 条 `completed`、0 条 `ended`；服务
  health、readiness、SQLite integrity、容器 restart count 与浏览器 console 均正常。
- 《人生密密缝 (2017)》保持真实 attention：旧条目在 Arca 上架前报告
  `CLEAN_ARCA_FINAL_NFO_SEMANTIC_DRIFT`，没有为该影片增加兼容恢复；《千寻小姐 (2023)》与《罪人》均已完成。
- Formation 详情卡片已生产验收：列表与详情使用同源 current Plan，完成 successor 不再被历史失败 Plan 覆盖，
  NFO 失败文案明确表达“正式位置中的 NFO 内容与本次已接受的媒体信息不一致”。
- Field 页面显示 generated 952、Libra accepted 727、waiting 225。第二次获授权 Reset 已删除当时 3 条 token 与
  3 张直接关联的 phantom Receipt，但自然 Intake 又选中 3 张更早的潜伏 Receipt。提交时间证明这些 Receipt 比
  新 token 早约 43 小时，并非新 Admission 原子性失败；全库只读审计发现 3,274 张 Libra phantom Receipt
  （Intake 1,433、Acceptance 726、其他 Libra 1,115）。本地修复现清理完整 Libra 潜伏池；19 张 Arca phantom
  Receipt、2 条 active Aftercare reclaim Work 仍明确不在本次范围。
- PROD-047 之外另有 2 条正常 active Aftercare reclaim Work。它们的文件 size 与 content fingerprint 与记录完全
  一致，仅 inode 已变化，持续形成 `ARCA_AFTERCARE_WORKSPACE_MEMBER_CHANGED`；它们不属于已 reclaimed 的
  legacy Receipt residual，未纳入本次授权纠正。
- 《罪人 (2025)》沿用 On-deck Run `6934758bf6a97208e0e2bc024d6bfb19bf6f36993a2a223bee5a7ba23125ca2a`，已完成 Stage → Verify → Placement → Settlement → Fulfillment → Commit，并建立 Shelf Entry `f04a4f09b2b64d957392425ca6eb7d70dde5126bf4f07424777df08c84f11347`。
- 《罪人》详情当前显示 `计划5 将媒体写入收藏架 / 已完成`；旧 failed Plan 仅留在过程历史。最终启动窗口未再出现该条目的 `CLEAN_ARCA_TARGET_OCCUPIED`、`CLEAN_ARCA_FINAL_NFO_SEMANTIC_DRIFT` 或 `ARCA_AFTERCARE_NFO_SOURCE_STALE`。
- 《千寻小姐 (2023)》已完成；此前长期 49.9% 是部署重启窗口中的持久化转码进度，不再是当前状态。

## Formation Detail Production Acceptance

- 根因一是详情投影只按共享 `procurement_run_id` 收集 Plan，把同一 Field Run 下全部 Candidate Work 都带入一个 Subject。现在 Procurement 阶段必须同时匹配 Accepted Candidate Package 与其冻结 `structureUnitId`；Field-wide Evidence Plan、其他 Candidate Plan 以及只匹配其中一项的漂移数据全部排除，前端仍只渲染后端返回的真实 Plan。
- 根因二是 Accepted On-deck 的 Plan/Input Projection 失败没有 Result，恢复却从 Result 读取 Handoff B 引用；生产《罪人》的同一 On-deck Run 因此停在 `offloading`，已有两代 failed Work。恢复现只读 immutable Work Definition，继续同一 Run；第三代失败后的 callback gap 会先把该 Run 收口为 `blocked`，再稳定投影 `attention_required` 与「重试上架」，不会重开 Libra 或创建第二个 On-deck Run。
- 上述两项已随 `91f990609c` 无损部署。生产详情已收敛到约 14–25 KiB，材料准备只保留当前 Candidate 的一个真实 Plan；同一 On-deck Run 已产生第三代 running Work，没有重开 Libra 或第二个 Run。
- 第三代 Work 的首个 Event 随后持续停在 `ready`。只读诊断确认不是 16 个 Event 并发上限：仅 6 个 Event Attempt executing。真正原因是两个更早的 `waiting_for_resource` 转码 Event 持续排在队首；Scheduler 用 100ms wall-clock cooldown 防重复，而生产一次 SQLite 调度扫描可超过 100ms，于是同一 waiter 每轮重新获选并饿死后续 Event。现改为 scheduling-round fairness：一个资源 waiter 每轮只尝试一次，其他 eligible Event 必须获得机会；整轮耗尽后再由 bounded fallback 开启下一轮。
- 过程卡片另有独立聚合错误：旧 failed Work 先于当前 running successor 判定，导致阶段显示 `attention` 而整体仍为 `in_progress`。现在当前 `admitted|ready|running` 后继 Work 决定阶段为进行中；旧失败 Plan 仍原样保留在展开结果中，不被覆盖或删除。
- 完成态进一步暴露同一缺口：成功 successor 已完成 On-deck Commit 后，历史 failed Work 仍会把阶段和 `currentPlan` 拉回 `attention`。现按同一 Owner/Process/Work kind 的最新 Work 判定责任链状态；最终上架阶段完成时，列表摘要指向完成 Commit 的 successor，早期失败 Plan 继续只作为过程历史展示。没有 successor 的真实失败仍保持 `attention`。该修正已随 `b06b70ba10` 部署，并由《罪人》的完成态详情形成生产验收。
- 《冰血暴 (1996)》生产只读证据进一步确认：计划12执行链全部 `succeeded`，只是媒体合规检查返回`max_size_exceeded`（原片约10.03 GiB、收藏上限8 GiB），随后真实计划13确认处理方式、计划14等待转码资源。旧过程投影把Result payload中的`result:"failed"`误当成Runtime失败；本地现只按Event/Outcome执行事实确定Plan状态，计划12显示已完成并保留“不符合要求”的真实检查结论。
- 一级页“当前进展”此前虽不是React生成Plan，但仍由`nextAction + organizingSteps`这套旧后端表达驱动，与过程卡片的真实Plan分离。现在列表只为当前页有界读取同一真实Plan投影的编号、标题、状态和进度摘要；前端只渲染`currentPlan`，没有第二套Plan生成或`organizingSteps`回退。媒体生产计划标题按真实工作区分，冰血暴计划11–14依次为“读取原始媒体信息 / 判断原片是否可以直接使用 / 确认视频处理方式 / 处理媒体文件”。
- 历史 focused 109/109；当时 Service full 402 项为 384 pass、18 skip、0 fail。P4 Runtime gate 仅受既有 dynamic-template scanner findings 阻断。该 follow-up 后续已部署，未编辑生产数据库、未 Reset、未创建新 On-deck Run 或重开 Libra。
- Plan语义/列表同源增量 focused 42/42、Admin Web 38/38、production build通过；最终 successor 聚合合并后 Service full 406 项为 388 pass、18 skip、0 fail。上述增量均已部署，未写生产数据库。

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

## PROD-040 Production Accepted

- 生产只读复现证明，恢复 Stage 遇到的非 Package NFO 是同一 On-deck Run 早先 Placement 后由 Emby 等价改写的 final 文件；原 `offloadContext` 不包含这个由 Placement 新建的路径，因此旧门禁把它误判为陌生冲突文件并抛出 `CLEAN_ARCA_TARGET_OCCUPIED`。
- 本地修正从 Execution Foundation 读取同一 Arca On-deck Run 的 durable Placement Result；只有 typed `PlacementSwitchReceipt/v1` 同时匹配 `scopeId=onDeckRunId` 与当前 `targetCommitSlotId`，Stage、Staged Verify、Placement 才允许 NFO 进入 semantic presentation 分支。
- 语义等价 NFO 不被重写，Staged Manifest 记录其盘上实际 physical identity；没有正式回执、错 Run/错 Slot、缺 presentation basis、语义冲突或任何非 NFO 成员漂移继续 fail closed。不存在影片 ID、路径、Work ID 特例，也没有 migration、旧条目兼容、生产数据编辑或 Reset。
- 精确回归覆盖空 `offloadContext`、先 Placement、Emby 改写、同 Run 恢复 Stage；同时覆盖无回执拒绝与 Primary 严格拒绝。修正先随 `e16ff04ebf` 部署，并在 PROD-041 部署后由《罪人》同一 Run 完成 Stage 至 Commit 的生产链路正式验收。

## PROD-041 Production Accepted

- PROD-040 随生产镜像 `e16ff04ebf` 部署后，现有 On-deck Run 的 Stage 仍未进入 Inventory Port：Startup Recovery 已把 Effect 分类为 `continue_forward`，但 Event Runtime 用原 Event Attempt `started_at_ms + timeoutMs` 重建 deadline；原 deadline 已过，Timeout Controller 在 Capability dispatch 前立即抛出 `P4_EXECUTION_TIMEOUT`。
- 这是所有长时间停机后 `continue_forward` 非纯 Effect 都可能触发的 Foundation 缺口，不是 NFO、影片或 Arca 专属问题。现为同一 Effect 在首次恢复执行前原子写入一次 durable recovery execution start；Attempt Policy 仍使用原 Capability/Effect Class 的冻结 Timeout Policy，只把这次恢复句柄的计时起点改为该 durable 时间。
- 后续进程重启不会更新该时间，因此真实 recovery hard timeout 不会无限重置。原 Event Attempt identity、Input Snapshot、Fence Snapshot、Effect identity/intent/idempotency key、`effectOccurredAtMs` 和 Result/Receipt 收口合同均保持不变。当现实探测已证明一个非纯 Effect 不存在时，`safe_retry` 也复用这一单次 durable recovery budget；`safe_retry_before_intent`、普通 retry 与 pure observation 仍沿用原 Attempt deadline，PROD-036 hard-close 行为未放宽。

## PROD-046 Local Fix Ready

- `arca.aftercare.workspace.reclaim@1` 的三个生产恢复动作被 Reality Observer 分类为 `safe_retry`，但原 Event Attempt deadline 已过；旧 Event Runtime 在 Capability dispatch 前持续抛出 `P4_EXECUTION_TIMEOUT`，使同一 Work/Attempt/Effect 永久保持 executing/intended。
- 根因是 Foundation 只给 `continue_forward` 建立 durable recovery execution budget，遗漏了“Effect 已持久化、现实已证明 Effect 不存在”的非纯 `safe_retry`。修正后两类 classified non-pure recovery 共享同一机制：Effect Journal 原子冻结一次 `verified_at_ms`，重启不能续期，超时后仍 fail closed。
- 该修正不包含影片、路径或生产 ID 特例，不编辑生产数据，不改变 Owner/Handoff；普通 retry、`safe_retry_before_intent` 与 pure observation 的 deadline 语义不变。
- 本地测试覆盖：原 Attempt deadline 已过时，classified `continue_forward` 仍实际 dispatch 并成功收口；同一 Effect 在时钟前进一小时和再次启动时仍返回第一次冻结时间。修正随 `e655d6d66f` 部署后，《罪人》同一 Effect/Run 获得一次有界恢复预算并完成 On-deck Commit；未修改生产数据。

## Verification

- PROD-034 focused：2/2；Arca focused：24/24；Admin Web：37/37，build 通过。
- 当时 Helix Architecture full gate 通过；P2 contract aggregate 更新为 `549e136626021ed6f7f437e173775c06b59e82fc3cea73e189bdafeb0792404b`，DDL digest 为 `3be2dad9b3615053681dfc2721974657fc3995ccf60a044e17dfb5131f0f8199`。本轮三态 Formation Projection 的本地目标 DDL digest 已更新为 `6a2246c39bebcd1f6f80264bac793c7a3119636a791683e426e4c30aa6fdc651`，仅迁移可重建 Projection；尚未部署生产。
- 本次最终合并后 focused 135/135；完整 Service 399 项为 381 pass、18 skip、0 fail；Admin Web 38/38；production build 通过。
- 标准 build/upload/deploy dry-run/apply 完成，未使用 `--helix-clean-init`。部署脚本原只读 WAL readiness 返回 `SQLITE_CANTOPEN` 却未阻断；部署后 health/SQLite 校验通过。脚本已在本地修为“只读源复制到临时目录后校验，并强制匹配 ready”，对当前生产数据副本复验为 186 tables、123 routes、17 UI surfaces、findings []，尚未随镜像部署。
- PROD-035 targeted 覆盖 NFO 五个并发改写窗口、Primary 漂移、坏 XML/身份冲突/缺字段、Aftercare revision convergence、连续冲突聚合、同根与阶段恢复；UAT-131 四个场景通过。
- PROD-040 focused：相关 Arca/Aftercare/On-deck 68/68；Service full 403 项为 385 pass、18 skip、0 fail；Admin Web 38/38，production build 通过；Service 与 Web 官方 npm registry audit 均为 0。Helix Architecture gate 的 semantic、manifest、contract 均通过，总 gate 仅被 main 既有 `formation-process-projection.js` / `progress-projection-reader.js` dynamic-template scanner findings 阻断，本轮未改这两个文件。
- PROD-041 focused：P4 Effect Journal/Event Runtime/Startup Recovery/Runtime Host 96/96；Service full 403 项为 385 pass、18 skip、0 fail。正式 P4 Runtime gate 仍只被 main 既有两个 dynamic-template scanner findings 阻断；本轮 Foundation tests 与运行时语义没有新增 finding。
- 最终 Formation successor 聚合合并后 targeted 10/10；Service full 406 项为 388 pass、18 skip、0 fail。最终镜像 build/upload/checksum/dry-run/apply、readiness、health、Admin Web、媒体/QSV mount 和 running-image 校验全部通过。
- PROD-042 targeted 11/11；新增 Planner/Projection/commit/token-release 精确回归 2/2；Service full 406 项为 388 pass、18 skip、0 fail。P8 fixture/semantic/manifest/contract 均通过，总 Gate 仍只受 main 既有 `formation-process-projection.js` / `progress-projection-reader.js` dynamic-template scanner findings 阻断，本轮没有新增 finding。
- Service full：386 项，368 pass、18 skip、0 fail；Admin Web：37/37，production build 通过。
- Service 与 Web 的 official npm registry audit 均为 0；image checksum、deploy gates、SQLite integrity 和 production health 通过。

现行产品验收权威仍为 `BETA_FEATURE_ACCEPTANCE_BASELINE.md`。这些生产修复不把任何 `HB-*` 自动标为 PASS。
