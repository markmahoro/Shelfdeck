# Kairox Production Automation Audit

## Summary

- 时间: 2026-07-08
- 目标环境: `http://192.168.12.230:18080`
- 审计方式: 只读 API / 代码静态核对；未触发 scan，未创建 task，未修改配置或生产数据。
- 结论: 自动化正在运行，但当前运行不健康。真实原因不是“没有自动任务”，而是 SmartTaskEngine 每轮都被一批 `targetGate=ingest` 的 source-missing 循环占满，导致 metadata / optimize / archive 无法自然推进。

## Production Evidence

### SmartTaskEngine

最近一轮自动扫描：

```text
lastRunAt: 2026-07-08T06:18:40.662Z
status: done
libraryItems: 2576
candidateCount: 1587
evaluatedCandidates: 1587
enqueued: 10
candidatesByTargetGate:
  optimize: 1304
  metadata: 6
  ingest: 277
enqueuedByTargetGate:
  ingest: 10
admissionRejectedByReason:
  recent_task_cooldown: 76
maxPerRunReached: true
skippedByQueueCap: 0
skippedByResourcePressure: 0
deferredByActiveBacklog: false
```

配置摘要：

```text
automaticTaskTargets: ingest, metadata, optimize
optimizeAllowedFlowKinds: []
smartTaskPollIntervalMinutes: 10
smartTaskMaxPerRun: 10
cooldownHoursByTargetGate:
  ingest: 0
  metadata: 6
  optimize: 48
  archive: 0
  delete: 48
```

### Lifecycle Distribution

全库 2576 个媒体：

```text
nextTargetGate:
  optimize: 1304
  archive: 480
  metadata: 396
  ingest: 270
  none: 126

lifecycleStage:
  metadata_ready: 1304
  optimized: 480
  ingested: 396
  source_discovered: 270
  archived: 125
  deleted: 1
```

按子库看，`ingest` 全部集中在成人 `US` 库：

```text
US:
  total: 711
  nextIngest: 270
  ingestInvalidated: 270
  sourceMissing: 10
  nextMetadata: 330
  nextOptimize: 102
  nextArchive: 9
```

### Recent Task Evidence

最近任务历史显示，同一批 `UNK-*` item 每 10 分钟重复创建自动 `ingest` task，且都很快完成：

```text
2026-07-08T06:18:49Z auto ingest done x10
2026-07-08T06:08:50Z auto ingest done x10
2026-07-08T05:58:49Z auto ingest done x10
2026-07-08T05:48:48Z auto ingest done x10
...
```

示例 item `f0a8f0ba-e4e7-4643-9520-0b2ffccec340 / UNK-38524`：

```text
lifecycleNextTask: ingest
ingestGate.status: invalidated
ingestGate.reason: ingest_gate_invalidated
invalidation.reason: source_missing
sourceExists: false
sourceMissingAt: 2026-07-08T06:19:38.666Z
lastTaskDoneAt: 2026-07-08T06:19:39.355Z
```

这说明 ingest task 已经观察到 source missing 并写了事实，但 gate invalidation 没有闭合，Lifecycle 下一轮仍继续投影 `targetGate=ingest`。

## Findings

### P0 - Source Missing Ingest Loop

当前自动化主阻塞是 `source_missing` 的 ingest 循环：

- metadata flow 曾报告 source missing，并写入 `ingestGateFailure / gateInvalidations.ingest`。
- 后续 ingest task 观察到源文件仍不存在，写入 `sourceExists=false` 和 source freshness。
- 但旧 `ingestGateFailure` 没被清除或转成稳定 blocked 状态。
- Lifecycle 继续把这些 item 投影为 `nextTargetGate=ingest`。
- `ingest` cooldown 配置为 0，done task 不消耗 automatic failed attempt budget。
- SmartTaskEngine 每 10 分钟继续创建同一批 ingest task。
- 每轮 `smartTaskMaxPerRun=10` 被这些 ingest 任务占满，metadata / optimize 候选无法进入队列。

这不是调度性能问题，而是自动任务触发条件/事实闭环问题。

### P0 - Additional Audit Passes Confirm The Loop

补充审计 1：配置 / 准入 / 调度链路。

```text
executionMode: manual
automaticTaskTargets: ingest, metadata, optimize
optimizeAllowedFlowKinds: []
smartTaskMaxPerRun: 10
targetGateWeights:
  ingest: 60
  archive: 70
  delete: 90
  metadata: 80
  optimize: 110
cooldownHoursByTargetGate:
  ingest: 0
  metadata: 6
  optimize: 48
  archive: 0
  delete: 48
```

结论：

- SmartTaskEngine 的自动创建开关实际有效，虽然全局 `executionMode=manual` 仍存在历史语义噪声。
- `ingest` 权重最高、cooldown 为 0、每轮上限为 10。
- 当 277 个 ingest candidate 长期存在时，每轮会优先创建 ingest，且达到 `maxPerRun=10` 后停止。
- 这解释了为什么 metadata / optimize candidate 虽然存在，但没有机会入队。

补充审计 2：任务历史 / lifecycle-audit。

```text
tasks by targetGate:
  ingest: 621 total, 620 done, 1 failed_hard
  metadata: 1585 total, 428 done, 1157 failed_hard
  optimize: 72 total, 6 done, 66 failed_hard
  archive: 2 total, 2 done
  delete: 2 total, 2 done

task source:
  auto: 2228
  manual: 54

lifecycle-audit signals:
  missing_bridge_or_flow_kind: 1182
  adult_metadata_unexpected_flow: 1084
  legacy_standard_media_scrape_task: 464
```

结论：

- 自动任务历史不是空，反而很多；用户看到“没任务”主要是当前 active queue 很快被执行完。
- 历史任务中 adult metadata 失败和 legacy unknown flow 噪声很大，会污染 Dashboard 和用户判断。
- 最近新增的自动任务仍然集中在 ingest，且是同一批 source-missing adult item。
- archive / delete 生产历史几乎只有 E2E/manual，符合当前自动化配置，但不符合“完整自动闭环”的长期目标。

### P1 - Optimize 自动化授权不完整

配置中：

```text
automaticTaskTargets includes optimize
optimizeAllowedFlowKinds is empty
```

代码语义确认：`optimizeAllowedFlowKinds=[]` 表示 `transcode` 和 `upgrade` 都不授权，不是默认全开。

因此即使 ingest 循环修复后，自动创建 optimize task 也可能在 Flow Planner 阶段变成 `blocked`，例如：

```text
transcode_not_authorized
needs_upgrade
```

如果生产期望自动 transcode，需要显式启用 `optimizeAllowedFlowKinds=['transcode']`。是否启用 `upgrade` 应另行确认。

### P2 - Archive 未自动化是配置结果

全库有 480 个 `nextTargetGate=archive`，但 `automaticTaskTargets` 不包含 `archive`。

SmartTaskEngine 在 candidate 构建阶段会按 `automaticTaskTargets` 过滤，所以 archive 不会进入自动候选。这不是 Admission 拒绝，也不是 Scheduler 问题。

### P2 - 历史失败任务噪声很大

当前任务库：

```text
totalTasks: 2272
failed_hard: 1224
done: 1048
failedByFlowKind:
  unknown: 1179
  scrape: 41
  blocked: 1
  ingest: 1
  no_op: 1
  transcode: 1
```

这会让 Dashboard 长期显示红色，并扩大 tasks.db。它不直接解释当前自动创建问题，但会影响用户判断和后续性能治理。

## Interpretation

用户看到“没有任务自动生成”的主观感受成立，但真实系统行为是：

```text
SmartTaskEngine 在跑
-> 每轮都创建 10 个 ingest
-> ingest 很快完成
-> 用户看 active task 时经常是空
-> 同一批 source_missing item 下轮又被创建
-> 有价值的 metadata / optimize / archive 没机会推进
```

所以当前自动化不符合预期运行。

## Recommended Next Step

先处理 P0，不要先调大并发或 maxPerRun。

本报告的直接技术结论是：

```text
source_missing 不能继续消耗每轮 automatic task creation 名额。
```

但本问题已经暴露出更大的架构边界：`ingest/onboarding` 不应继续被硬塞进库内 lifecycle gate。后续应在新 worktree 中围绕 Onboarding / In-Library Lifecycle / Offboarding 三个业务域重新设计，不在 `Kairox Beta` 收束中临时修补。

短期候选治理方向：

- 对确认 `sourceExists=false` 的对象，不再持续投影可自动创建的 `targetGate=ingest`。
- 重新定义 Onboarding 与 In-Library Lifecycle 的交接合同，避免 source candidate / managed item / source binding 混在同一个 lifecycle gate 中。
- 重新定义 Offboarding 与 source destruction 的边界，避免 `delete` 同时表达“销毁源文件”和“停止管理”。
- 在后续 Performance / Governance 工作中评估全局 Resource Management，避免各业务域各自建立资源小中台。

修复 P0 后再决定配置：

- 是否启用 `optimizeAllowedFlowKinds=['transcode']`。
- 是否把 `archive` 加入 `automaticTaskTargets`。
- 是否清理旧 failed task 历史和 tasks.db。
