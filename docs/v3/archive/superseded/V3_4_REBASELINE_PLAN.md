# ShelfDeck v3.4 Rebaseline Plan

Status: Active plan after Kairox User Perception update.

本文替代已标记为 superseded 的 `docs/v3/V3_4_PLUS_ROADMAP.md`。后续 v3.4+ 不再按“策略页、upgrade、delete、调度、UI”四条线并行推进，而按新的 Kairox 依赖链演进：

```text
User Perception
  -> Lifecycle Objective Projection
  -> Objective Template
  -> Flow Planner Correctness
  -> Transcode Flow Reliability
  -> Upgrade Canary
  -> Scheduler Pressure Policy
  -> Delete Gate Review
  -> User-Usable UI GA
```

总目标：

```text
交付一个基于 Kairox 的用户可用版本：
用户能稳定完成媒体入库、感知同步、目标计算、自动优化、归档和处置；
系统在生产规模下具备可接受性能；
每个版本都通过用户视角端到端验收。
```

## 0. Execution Status

| Version | Status | Evidence | Next |
| --- | --- | --- | --- |
| v3.4 | Done | `V3_4_REBASELINE_PLAN.md`、Kairox architecture ADR、rebaseline audit tests | v3.5 |
| v3.5 | Done | `UserPerceptionManagement` 最小读写模型；Douban / Emby / local rating projection；metadata gate 不再要求 perception facts；`npm test` 314/314 passed | v3.6 |
| v3.6 | Done | Lifecycle projection 输出 `optimizeObjectiveStatus` / `optimizeObjective` / `objectiveHash` / `objectiveVersion` / `objectiveDerivedFrom`；strategyEngine 兼容写入 objective projection；`npm test` 316/316 passed；`npm run build:web` passed | v3.7 |
| v3.7 | Done | 默认模板改为 perception condition -> `targetMediaFacts`；Rule Templates UI 改为“归档前目标”；旧 `rule.action` 保留兼容投影；focused tests 210/210 passed；`npm run build:web` passed | v3.8 |
| v3.8 | Done | `flowPlanner.selectOptimizeFlow` 支持 objective gap analysis；Task Creator 基于 objective 选择 no-op / transcode / blocked；transcode 使用 objective target bitrate/codec 并在 verify 校验；`npm test` 320/320 passed；`npm run build:web` passed | v3.9 |
| v3.9 | Done | transcode 各阶段持久化 recovery context / resume point；`task.failed` 暴露 recovery class；verify 校验 objective codec/bitrate/duration；transcode done 写回 library media facts 和 optimize gate evidence；`npm test` 322/322 passed；`npm run build:web` passed | v3.10 |
| v3.10 | Done | objective gap 可选择 upgrade canary；自动 upgrade 默认单任务 canary；MoviePilot / disc-like / canary slot safety 可解释；upgrade verify 校验 objective facts；upgrade done 写回 library media facts 和 optimize gate evidence；`npm test` 324/324 passed；`npm run build:web` passed | v3.11 |

## 1. Current Code Audit

当前实现仍存在以下 Mirex / Kairox 差距。这些差距不是 bug 修复清单，而是后续版本拆分和验收的事实基础。

| Area | Current Code Fact | Kairox Target | Planned Version |
| --- | --- | --- | --- |
| Metadata gate | `metadataStatus` 仍支持 `decision.watched`、`decision.rating`、`decision.userRating`、`decision.doubanRating`，并从 rule condition 反推 metadata gate inputs | metadata gate 只覆盖 metadata/media facts；rating、watched、playCount、Douban private rating 属于 User Perception | v3.5 |
| User perception | `userRating`、`doubanRating`、`watched` 分散在 media item payload、library store、Douban sync、UI filter 中 | User Perception Management owns normalized perception facts and version | v3.5 |
| Objective readiness | `lifecycleProjection` 仍用 `item.action/reason` 判断 `strategy_pending` / `strategy_missing` | Lifecycle owns `optimizeObjectiveStatus`、objective hash/version、objective revision projection | v3.6 |
| Rule templates | `configStore` 默认模板已改为 `perception condition -> targetMediaFacts`，旧 `rule.action` 只做兼容投影 | Rule template = user perception condition -> target media facts | v3.7 done |
| Strategy engine | `strategyEngine` match rule 后基于 `targetMediaFacts` 生成 legacy action hint，并写入 `optimizeObjective` projection | Compatibility module that writes `optimizeObjective` and legacy projection | v3.7 done |
| Flow planner | `flowPlanner` 已新增 objective gap selection，当前自动路径覆盖 no-op / transcode / blocked / upgrade canary；upgrade safety facts 覆盖 MoviePilot config、disc-like、canary slot | Flow selection from objective gap: no-op / transcode / blocked / upgrade | v3.10 done |
| Delete semantics | `businessFlowPolicy` 仍把 `delete` 放在 optimize aliases / operations；`flowPlanner.delete` 仍是 `optimize.delete` | `delete` is independent `targetGate=delete`, not optimize operation | v3.12 |
| Rule UI | `RuleTemplatesPage` 已改为“归档前目标” editor，条件字段收敛到 user perception facts 和少量业务分类 | “归档前目标” editor; no action-like wording | v3.7 done |
| System config UI | `SystemConfigPage` 仍展示 optimize operations with legacy split helpers | Automatic task target authorization and optimize operation authorization stay, but delete must move to delete gate | v3.12 |
| User E2E | 现有测试以 unit/API/flow 为主，缺少用户视角跨页面验收记录 | Every version records Dashboard / Media / Tasks / Settings user E2E | v3.4+ |
| Performance | v3.3 有恢复期保守调度，缺少持续压测 baseline | API hot paths second-level, no whole-page loading under background tasks | v3.4+ baseline, v3.11 policy |

## 2. Version Plan

### v3.4 - Kairox Rebaseline

Goal: 完成代码审计和新路线图落地，建立后续版本保护线。

Required work:

- 以本文作为 v3.4+ active roadmap。
- 保留 `V3_4_PLUS_ROADMAP.md`，但它只作为 superseded historical draft。
- 新增 rebaseline audit 测试，显式记录当前已知架构债；未来版本清债时必须同步更新该测试。
- 不改生产自动化范围，不恢复 upgrade/delete，不改变默认运行行为。

User E2E acceptance:

- Dashboard / Media / Tasks 当前 v3.3 能力不回退。
- 一个已有媒体仍能展示 metadata、rating、watched、当前任务建议和 lifecycle 状态。
- automatic optimize transcode 现有能力仍可用。

Performance acceptance:

- 记录 `/v1/health`、dashboard health、library list、tasks list 的本地 baseline。

### v3.5 - User Perception Foundation

Goal: 落地 User Perception Management 的最小可用读写模型。

Required work:

- 新增 normalized `UserPerceptionFacts`：rating、ratingSource、watched、playCount、lastPlayedAt、favorite、manualTier、perceptionVersion、perceptionUpdatedAt。
- 兼容旧字段：`userRating`、`doubanRating`、`watched`。
- Douban 私人评分写入 user perception；Emby watched / playCount 写入 user perception。
- metadata gate 默认配置和校验移除 `decision.*` required facts。
- 用户评分 / watched 变化 bump perceptionVersion，但不直接创建 task。

User E2E acceptance:

- 用户改评分、标记已看/未看后，媒体页能看到 perception 更新。
- Douban 私人评分同步后，媒体页能显示感知来源。
- 无评分媒体不因评分缺失卡在 metadata gate。

Performance acceptance:

- 批量 perception 更新后媒体列表仍秒级打开。
- perception 更新不触发自动任务风暴。

### v3.6 - Lifecycle Objective Projection

Goal: Lifecycle owns objective readiness and objective revision.

Required work:

- Lifecycle projection 增加 optimizeObjectiveStatus、optimizeObjective、objectiveHash、objectiveVersion、objectiveDerivedFrom。
- 支持 ready、pending_perception、pending_metadata、blocked_contract。
- perception / metadata / policy 变化后，Lifecycle recomputes objective。
- Task Creator 只扫描 Lifecycle projection，不比较 rating、watched、playCount 或 objectiveHash。
- archived item 在新 objective 下不满足时，可重新投影为 optimize pending。

User E2E acceptance:

- metadata 完整但 perception 未满足策略要求时，显示“等待用户感知”，不是“元数据缺失”。
- 用户将 4 星改为 5 星后 objective version 变化。
- 当前事实满足新 objective 时不产生新任务；不满足时进入需要优化。

Performance acceptance:

- 批量 objective revision 不阻塞媒体列表。
- objective recompute 可观测且不会长时间占满 CPU。

### v3.7 - Optimize Objective Template MVP

Goal: `/rules` 从 action template 改为 perception condition -> target media facts。

Required work:

- [x] 新 Rule Template schema：条件只基于 user perception facts 和少量业务分类；目标只表达 target media facts。
- [x] 默认模板重排：电影 5 星 / 4 星 / 3 星 / baseline，剧集同构，成人库单一 baseline target。
- [x] 模板语义和 UI 文案不出现“转码 / 压缩 / 洗版 / 删除 / 保留”作为目标。
- [x] 旧 `rule.action` 兼容读取，保存时写新 schema，并保留 legacy projection。
- [x] `strategyEngine` 收口为 compatibility module，输出 `optimizeObjective`。

Implementation notes:

- `RuleTemplate` 保存时通过 `normalizeRuleTemplate` 补齐 `targetMediaFacts` 和 legacy projection。
- 默认 movie / TV 模板仍用 Douban 私人评分或本地用户评分作为 perception condition；成人库使用单一 `adult_baseline` target。
- `strategyEngine` 不再把模板 action 当成目标本身，而是从 `targetMediaFacts` 推导 `keep/transcode/upgrade` legacy hint，供 v3.8 前的旧 planner 路径继续工作。
- `lifecycleObjectiveResolver` 将 `targetMediaFacts` 投影为 `OptimizeObjective(kind=target_media_facts)`。
- v3.7 不清除 delete-as-optimize 旧债；该项仍保留到 v3.12 Delete Gate Review。

User E2E acceptance:

- 用户能创建 5 星 -> Premium 目标、3 星 -> Standard 目标。
- 保存后媒体库能显示目标层级和目标事实。
- 旧模板读取、保存不丢配置。

Performance acceptance:

- 保存模板后 recompute 不导致 Dashboard / Media 全页 loading。

### v3.8 - Flow Planner Gap Analysis

Goal: 先保证 Flow Planner 能正确选择 no-op / transcode / blocked，并稳定执行 transcode；不恢复 upgrade。

Required work:

- [x] Flow Planner 输入 current media facts、optimizeObjective、operation authorization、flow safety facts。
- [x] Flow selection: objective satisfied -> no-op pass; local transform can satisfy -> transcode; better source needed but upgrade disabled -> blocked / needs upgrade; missing facts -> blocked / needs metadata repair。
- [x] 保存 flow selection explanation：current facts、target facts、gap、selected operation、blocked reason。
- [x] Transcode flow 使用 objective target bitrate / codec，verify 产物满足 objective，replace 后写 objectiveHash 对应 optimize gate facts。

Implementation notes:

- `flowPlanner.selectOptimizeFlow` 是 v3.8 的核心选择函数，输出 `selectedOperation`、`currentFacts`、`targetFacts`、`gap`、`blockedReason` 和 `objectiveHash`。
- `lifecycleTaskPlanner.selectStrategyOperation` 优先使用 objective gap analysis；没有可比较 target facts 的 legacy objective 继续回退 `operationHint/item.action`。
- `lifecycleProjection` 在 objective 已满足时将 optimize gate 投影为 `operation=no_op`，直接进入 archive candidate。
- `transcodeFlowExecutor` 在 precheck 阶段从 `gateObjective.targetMediaFacts` 推导 target bitrate / codec，并在 verify 阶段校验 codec 和 bitrate 上限。
- v3.8 不恢复 automatic upgrade；需要更好源时只返回 `blockedReason=needs_upgrade`。

User E2E acceptance:

- 已满足目标的媒体不创建 task。
- 需要降低资源成本的媒体自动创建 transcode task。
- 转码成功后进入 optimized，再进入 archive。
- 事实不足或转码失败时，任务中心能解释原因和恢复点。

Performance acceptance:

- 单个 transcode running 时 Dashboard / Media / Tasks 保持可用。
- progress 更新不明显拖慢 API。

### v3.9 - Transcode Flow Reliability And Recovery

Goal: 把 transcode flow 做成 Kairox 下可靠的生产主路径。

Required work:

- [x] 补齐 precheck / encode / verify / replace confirmation / replace failure / interruption / resume / retry recovery contract。
- [x] 明确 transcode event facts 和 resource facts。
- [x] objective-aware verify：codec、bitrate/equivalentBitrate、duration、output path identity、replace 后 media facts refresh。
- [x] 补齐 pause / cancel / retry 用户视角行为。
- [x] 验证 partial 文件清理和 orphan cleanup。

Implementation notes:

- `transcodeFlowExecutor` 在 precheck / executing / verify / replace 阶段显式持久化对应 `resumePoint`。
- transcode 失败时写入 `failureContext`，`task.failed.failureSummary` 暴露 `phase`、`resumePoint`、`recoveryClass`、`userAction`、`objectiveHash`。
- verify 阶段校验 objective codec、bitrate 上限和时长偏差，并把 `outputPath`、target facts、objectiveHash 写入 `verifyResult`。
- transcode done 时，`taskScheduler` 将 verify facts 写回 library item：size、bitrate、equivalentBitrate、codec、resolution、duration、`optimizationResult` 和 explicit optimize gate evidence。

User E2E acceptance:

- 用户能看到转码进度、暂停、取消、重试。
- 失败后任务中心明确下一步。
- 成功后媒体目标状态满足，归档闭环可继续。

Performance acceptance:

- 长时间转码期间控制面稳定。
- 失败风暴不会无限重试，partial/orphan 不持续增长。

### v3.10 - Upgrade Canary

Goal: 在 Flow Planner 和 transcode 稳定后恢复 upgrade canary。

Required work:

- [x] Flow Planner 增加 upgrade selection：当前事实低于目标、本地转换无法提升源质量、MoviePilot 可用、符合 safety、用户/配置授权 upgrade。
- [x] automatic upgrade 仅 canary：小队列、单任务、默认确认关键步骤。
- [x] 保留 candidate selection、identity mismatch、before replace。
- [x] upgrade 成功后写 objectiveHash 对应 optimize gate facts。

Implementation notes:

- `flowPlanner.selectOptimizeFlow` 对 better-source gap 在 `upgrade` 已授权且 safety facts 通过时选择 `selectedOperation=upgrade`，否则解释为 `needs_upgrade`、`moviepilot_not_configured`、`upgrade_not_supported_for_disc_like_source` 或 `upgrade_canary_limit`。
- `configStore` 增加 `upgradeCanary` 默认配置：`maxActiveTasks=1`、require MoviePilot config、disc-like 不自动 upgrade。
- `businessFlowPolicy` 在 automatic upgrade 上执行 canary admission；手动 upgrade 仍可表达用户意图，但不绕过 active task / metadata / flow safety checks。
- `smartTaskEngine` 自动任务 payload 补齐 `optimizeObjective`、`objectiveHash`、`objectiveVersion`、`targetMediaFacts` 和 codec facts，保证真实自动任务不会丢失 objective-aware flow plan。
- `upgradeFlowExecutor` 在 pre-replace verify 阶段用产物 codec、bitrate、resolution 校验 `gateObjective.targetMediaFacts`，不满足 objective 时不进入 replace。
- `taskScheduler` 在 upgrade done 后写回 size、bitrate、equivalentBitrate、codec、resolution、duration、`optimizationResult` 和 explicit optimize gate evidence。

User E2E acceptance:

- 5 星低质量媒体解释为“需要更好源”。
- 启用 canary 后创建 upgrade flow。
- 候选为空、MoviePilot 不可用、身份不一致都可解释。
- 成功后满足目标并归档。

Performance acceptance:

- upgrade waiting / downloading 不阻塞页面。
- MoviePilot 异常不拖慢主 API；无重复 upgrade task。

### v3.11 - Scheduler Pressure Policy

Goal: 在 Kairox task/objective/flow 稳定后解决资源吃不满。

Required work:

- 建立压测脚本和报告模板。
- 采集 candidate / evaluated / enqueued / rejected、admission reasons、active backlog、resource running/waiting/blocked、API latency、DB/WAL/log growth、duplicate active task。
- 将 `activeBacklog > 0` 整轮 defer 改为 pressure-aware supply policy。
- Scheduler 仍只调度 runnable task，不重新计算业务 objective。

User E2E acceptance:

- 转码运行时用户仍能打开 Dashboard、Media、Tasks。
- 多个待处理媒体能逐步补队列。
- awaiting confirmation 不让所有自动任务停摆。

Performance acceptance:

- API 热路径秒级；queue 不单调膨胀；无同 item 并发；输出推荐生产配置。

### v3.12 - Delete Gate Review

Goal: 建立 archived 后处置队列，不恢复 destructive optimize delete。

Required work:

- `TASK_TARGETS` 包含 delete；`OPTIMIZE_OPERATIONS` 不包含 delete。
- Lifecycle 计算 delete eligibility：archive facts、archived duration、User Perception facts、long-archive preference。
- 新增 delete candidates / 处置队列：确认删除、保持已归档、延后提醒、不再建议。
- 用户确认或显式 destructive pre-authorization 后，Task Creator 创建 `targetGate=delete` task。
- delete flow 写 delete gate facts，保留 archive history。

User E2E acceptance:

- 低评分 item optimize 阶段不生成 delete objective。
- archived item 满足 delete policy 后进入候选队列。
- 未确认时绝不执行 destructive delete。

Performance acceptance:

- 候选计算不拖慢媒体列表；批量候选不阻塞 Dashboard。

### v3.13 - User-Usable UI GA

Goal: 把 Kairox 能力整理成普通用户可用的产品界面。

Required work:

- 信息架构重组：日常、配置、高级。
- 清理中英混杂。
- 普通页面不展示 DB/WAL/payload/resource bucket/diagnostic log。
- Dashboard 首屏回答服务是否正常、哪些库需要处理、哪些媒体缺 perception/objective/metadata、哪些任务需要确认、哪些归档媒体待处置。
- Task Center 主语义展示 target gate / objective，operation 只作为实现路径。

User E2E acceptance:

- 从零配置一个库，同步 Douban / Emby 感知，设置归档前目标，自动完成 metadata -> objective -> transcode -> archive。
- 处理 upgrade canary、delete candidate、任务失败恢复。
- 普通用户不需要理解 DB/WAL/resource bucket。

Performance acceptance:

- 生产典型库规模下 Dashboard、Media、Tasks、Settings 秒级可用；后台任务运行时无全页 loading；浏览器控制台无关键错误。

## 3. Cross-Version Acceptance

每个版本都必须满足：

- 用户视角 E2E 验收记录，而不是只跑单元测试。
- 至少覆盖 Dashboard、Media、Tasks 和相关设置页。
- 对每个新增状态给出用户可理解文案。
- API 热路径计时记录。
- 无同 item 重复 active task。
- 无自动任务绕过 TaskAdmission。
- 无 flow executor 私自创建后续 task。
- 无 delete-as-optimize 回归。
- 文档更新到 Kairox 和当前实现地图。

每个版本至少执行：

```bash
cd media-service && npm test
cd media-service && npm run build:web
```

## 4. Stable Interface Targets

- `UserPerceptionFacts`: normalized rating / watched / playCount / favorite / manualTier / source / version。
- `OptimizeObjective`: target media facts + constraints + optional operation hints。
- `LifecycleProjection`: optimizeObjectiveStatus / objectiveHash / objectiveVersion / lifecycleNextTask / gateObjective。
- `FlowSelection`: selected operation / gap explanation / blocked reason / objectiveHash。
- `RuleTemplate`: perception condition + target media facts；旧 action 字段只做 compatibility projection。
- `TaskTarget`: delete 是独立 target gate；optimize operations 只包含 transcode / upgrade。
- `DeleteCandidate`: archived item + delete eligibility + user decision state。

## 5. Assumptions

- ShelfDeck 当前 Douban 数据只代表用户私人评分，不代表公众评分。
- Public Reception Management 不在本轮实现范围内。
- 旧字段 `userRating`、`doubanRating`、`watched`、`action`、`actionParams` 在迁移期保留兼容读写。
- 不做默认 full-auto destructive delete。
- v3.13 才作为“基于 Kairox 的用户可用版本”候选 GA；v3.4-v3.12 都是必要地基版本。
