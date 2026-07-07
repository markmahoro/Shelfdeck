# Kairox Thread Handoff - Paused 2026-07-02

本文是本线程暂停时的交接文档。暂停原因是当前 Codex GPT 5.5 额度即将耗尽；不要把本文理解为目标完成声明。

当前追踪目标仍未整体达成。比较准确的状态是：

- Kairox Beta 曾完成一次生产 E2E，并记录在 `docs/v3/KAIROX_BETA_PRODUCTION_E2E.md`。
- 后续又继续做了 Performance 版本和 Kairox clean-up 审计，当前 worktree 已发生大量变化。
- 当前代码审计证据显示 P0/P1 Kairox 语义违规已经归零，但这不是生产可发布证明。
- Kairox Performance 未完成生产压测闭环。
- Kairox 用户可用 GA 未完成。
- 下一线程必须重新基于当前 worktree 取证、测试、构建，必要时再做生产 E2E。

## 1. 当前 Worktree 状态

当前 worktree 是 dirty 状态，有大量未提交修改。

关键修改范围：

- Kairox 文档：
  - `docs/v3/KAIROX_ARCHITECTURE.md`
  - `docs/v3/KAIROX_CLEANUP_AUDIT.md`
  - `docs/v3/KAIROX_PERFORMANCE_PLAN.md`
  - `docs/v3/BUSINESS_MODEL_NOTES.md`
  - `docs/v3/USER_INTERVENTION_AND_FULL_AUTO.md`
  - `docs/v2/ARCH_OVERVIEW.md`
- Kairox Beta / E2E：
  - `media-service/scripts/kairox-beta-cutover.js`
  - `media-service/scripts/kairox-beta-production-e2e.js`
- Performance：
  - `media-service/scripts/kairox-performance-smoke.js`
  - `media-service/src/smartTaskEngine.js`
- 后端核心语义：
  - `media-service/src/businessFlowPolicy.js`
  - `media-service/src/taskAdmission.js`
  - `media-service/src/lifecycleProjection.js`
  - `media-service/src/lifecycleTaskPlanner.js`
  - `media-service/src/flowPlanner.js`
  - `media-service/src/taskStore.js`
  - `media-service/src/resourceProjection.js`
  - `media-service/src/strategyEngine.js`
  - `media-service/src/configStore.js`
  - `media-service/src/metadataStatus.js`
  - `media-service/src/spaceStats.js`
  - `media-service/src/v3Model.js`
- Admin Web：
  - Dashboard
  - Task Center
  - Resource View
  - Media Manage
  - Rule Templates
  - System Config
  - shared web types / API client
- Tests：
  - `media-service/test/task-model.test.js`
  - `media-service/test/api-inject.test.js`
  - `media-service/test/api-contract.test.js`
  - `media-service/test/priority-api.test.js`
  - `media-service/test/priority-engine.test.js`
  - `media-service/test/scrape-flow-metadata-gate.test.js`

最近提交：

```text
8bdd7381 Implement Kairox Beta cutover
007df1f5 Record v3.3 GA acceptance
6028e21a Record v3.3 capacity testing follow-up
c56975ec Handle upstream gate invalidation in Kairox flows
1138458e Gate automatic metadata repair by repairable facts
```

注意：`8bdd7381` 之后还有当前未提交修改。不要把该 commit 当成当前 worktree 的完整状态。

## 2. Kairox Beta 状态

### 2.1 已完成

Kairox Beta 的核心语义已经大体落地：

- 主业务语义收敛为：

```text
object + targetGate + gateObjective
```

- Kairox lifecycle 收敛为：

```text
source/discovered -> ingested -> metadata-ready -> optimized -> archived -> deleted
```

- `delete` 已从 optimize 中拆出，成为独立 `targetGate=delete` 和 delete gate review。
- optimize operation / flow 只允许 `transcode / upgrade`。
- `remove_media` 只保留为 legacy negative guard，用于拒绝旧 optimize delete objective。
- Rule Template 保存路径已转向 target media facts，不再把 action 当用户语义。
- metadata gate 与 user perception 已拆开：
  - metadata gate 默认不要求 `userRating` / `doubanRating` / `watched` / `playCount`。
  - Douban 在当前语义中是用户私人评分，属于 User Perception Management。
- delete candidate review 最小后端能力已经落地：
  - `GET /v1/admin/delete-candidates`
  - `confirm-delete`
  - `keep-archived`
  - `snooze`
  - `suppress`
- confirm delete 后创建 `targetGate=delete` task，delete flow 写 delete gate facts，不覆盖 optimize gate facts。
- `media-service/scripts/kairox-beta-cutover.js` 已存在，支持 plan/apply cutover。
- `media-service/scripts/kairox-beta-production-e2e.js` 已存在。

### 2.2 已做过的生产 E2E

`docs/v3/KAIROX_BETA_PRODUCTION_E2E.md` 记录过一次生产 E2E：

- 目标：`http://192.168.12.230:18080`
- 镜像：`markmahoro/shelfdeck:kairox-beta-itemfacts-20260702-055519`
- destructive E2E library：公共 国产剧库
- 结果：
  - Basic Navigation: PASS
  - Metadata vs Perception: PASS
  - Perception Revision: PASS
  - Optimize TargetGate: PASS
  - Transcode Objective Verify: PARTIAL
  - Archive Gate: PASS
  - Delete Candidate Review: PASS
  - Confirmed Delete: PASS
  - No Legacy Regression: PASS
  - Control Plane Smoke: PASS

这个 E2E 证明了当时镜像下 Kairox Beta 主链路基本跑通，但不能证明当前 dirty worktree 仍然通过。

### 2.3 未完成 / 风险

- 当前后续 cleanup/performance 修改后，没有重新部署生产。
- 当前后续 cleanup/performance 修改后，没有重新跑生产用户视角 E2E。
- `Transcode Objective Verify` 当时是 PARTIAL，因为生产条目过大，未等待完整转码完成。
- UI 文案仍可能误导，尤其历史上出现过“transcode candidate”这类不符合 Kairox 的表述。
- Kairox Beta 可以说“后端语义接近闭合”，但不能说“当前 worktree 已生产验收通过”。

## 3. Kairox Performance 状态

### 3.1 已完成

已新增：

- `docs/v3/KAIROX_PERFORMANCE_PLAN.md`
- `media-service/scripts/kairox-performance-smoke.js`

Performance 版本的目标不是改变 Kairox 业务语义，而是让已经 Kairox 化的后端在生产规模下更好地吃满资源，同时保持控制面可用。

已推进的设计方向：

- 旧策略：

```text
activeBacklog > 0 -> 整轮 SmartTaskEngine defer
```

- 新方向：

```text
activeBacklog 只是 pressure signal
Task Creator 仍继续评估 lifecycle candidates
TaskAdmission 负责 cooldown / duplicate / queue cap
SmartTaskEngine 按 resource pressure 做额外 supply cap
```

SmartTaskEngine 的 health / scan summary 语义已从旧 action 口径收口到：

- `enabledTaskTargets`
- `allowedOptimizeFlows`
- `candidatesByTargetGate`
- `enqueuedByTargetGate`
- `candidatesBySelectedFlow`
- `enqueuedBySelectedFlow`

这里需要特别注意：

- `candidatesByTargetGate` 才是 Kairox 业务候选分布。
- `candidatesBySelectedFlow` 只能作为实现路径诊断。
- 不应该再出现“transcode candidate / scrape candidate / upgrade candidate”作为业务描述。

### 3.2 未完成 / 风险

- Performance smoke 未形成最终报告。
- 没有生产压测结论。
- 没有推荐生产配置输出。
- 没有证明 heavy flow running 时 metadata / ingest 自动补队列的实际效果。
- 没有证明 awaiting confirmation 不再让所有 automatic task creation 停摆。
- Performance 版本不能视为完成。

## 4. GA 状态

这里必须区分历史 v3.3 GA 和 Kairox 用户可用 GA。

### 4.1 v3.3 GA

历史 v3.3 GA 已有记录：

- `docs/v3/V3_3_GA_RECOVERY_PLAN.md`
- `docs/v3/KAIROX_BETA_PRODUCTION_E2E.md` 中也引用了后续生产事实。

v3.3 GA 主要证明：

- 普通库、成人库、任务中心、设置页基本可用。
- automatic ingest / metadata / optimize transcode 主路径可跑。
- v3.3 不包含 automatic upgrade / delete。

### 4.2 Kairox GA

Kairox 用户可用 GA 尚未完成。

未完成项：

- Kairox Beta 当前 dirty worktree 未重新生产 E2E。
- Kairox Performance 未压测闭环。
- UI 信息架构还没有按最终用户视角重做。
- 普通用户页面仍可能暴露过多内部运维概念。
- 中英混杂和文案误导尚未系统处理。
- Task Center / Dashboard 的 target gate / objective / selected flow 展示仍需最终产品化。

因此当前不能声明 ShelfDeck 已进入 Kairox GA。

## 5. “ShelfDeck 是否按 Kairox 改干净”的代码审计状态

### 5.1 当前审计结论

以当前最后一次源码搜索为证据：

- P0 / P1：暂未发现仍需保留的问题。
- P2：仍有允许残留，主要是迁移入口、负向防回归 guard、以及测试 fixture。

这意味着“运行时代码主链路已经基本按 Kairox 收口”，但下一线程仍需要重新取证，不能直接接受本线程结论。

### 5.2 已修掉的关键问题

已修复或收口的重点：

- `SmartTaskEngine.getHealth().lastScanSummary` 不再输出 action candidate summary。
- Dashboard health 不再用 `enabledOperations` 作为自动化主语义。
- Rule Templates UI / config 保存路径不再写 action-like template。
- `lifecycleProjection` 不再从 `item.action` 推导 optimize direction。
- `businessFlowPolicy` 只在 `lifecycleNextTask=optimize` 且 target gate 授权后调用 Flow Planner。
- Flow Planner 显式空 flow 授权列表不再被当成无限制。
- `spaceStats` / `v3Model` / `libraryStore` 不再从 `item.action` 推导优化/删除空间或 facts。
- `libraryStore.getDashboardMediaSummary()` 改为 `byRecommendedTargetGate`。
- `taskTarget.operationHint` 改为 `taskTarget.selectedFlow`。
- `/v1/library/queries/manage?action=...` 已移除。
- Media Manage UI 移除旧 action filter。
- `MediaAction` / `preferredTaskAction` / `allowedOperationForItem` 等前端旧命名已收口为 selected flow 口径。
- 手动 optimize intent 不再被 automatic optimize allow-list 错误阻断。
- `targetForAction`、`bridgeKindForAction`、`concurrencyLimitForAction` 等 helper 命名已收口为 selected flow / target gate 口径。
- `no_enabled_actions` / `action_not_enabled` 等诊断 reason 已改成 target/flow 口径。

### 5.3 当前剩余命中

最后一次审计命令：

```bash
rg -n "actionType|item\.action|rule\.action|actionParams|operationHint|recommendedAction|businessFlowDecision\.action|candidatesByAction|enqueuedByAction|cooldownHoursByAction|maxQueuedByAction|operationKindWeights|preferredOperation|transcode candidate|scrape candidate|upgrade candidate|smartTaskEnabledActions|enabledActions|enabledOperations|optimize\.delete|remove_media|MediaAction|preferredTaskAction|allowedOperationForItem|action_not_enabled|byRecommendedAction|targetGateForAction|bridgeKindForAction|concurrencyLimitForAction" media-service/src media-service/web/src media-service/test
```

当前命中只剩：

- `media-service/src/configStore.js`
  - `action/actionParams`
  - `smartTaskEnabledActions`
  - `cooldownHoursByAction`
  - `maxQueuedByAction`
  - 作用：legacy config migration input，normalize 后不写回运行配置。
- `media-service/src/flowPlanner.js`
  - `remove_media`
  - 作用：拒绝 legacy optimize delete objective 的负向防回归 guard。
- `media-service/test/task-model.test.js`
  - 对上述 migration / negative guard / actionParams stripping 的测试。

这些当前被归为 P2，理由是它们不作为运行时业务主语义。

### 5.4 最近记录的本地验证

`docs/v3/KAIROX_CLEANUP_AUDIT.md` 已记录最近一轮验证：

```bash
cd media-service && npm test
cd media-service && npm run build:web
```

结果：

- `npm test`: 329/329 passed。
- `npm run build:web`: passed。
- 仅保留 Vite 对 `web/src/api/client.ts` 静态/动态混合 import 的 chunk warning。

下一线程仍应重新跑一次，因为当前目标是交接暂停，不是 final release sign-off。

## 6. 下一线程必须继续做什么

建议顺序：

1. 读取：
   - `AGENTS.md`
   - `docs/v3/KAIROX_THREAD_HANDOFF_PAUSED_2026_07_02.md`
   - `docs/v3/KAIROX_ARCHITECTURE.md`
   - `docs/v3/KAIROX_CLEANUP_AUDIT.md`
   - `docs/v3/KAIROX_PERFORMANCE_PLAN.md`
2. 运行 `git status --short`，确认当前 dirty worktree。
3. 重新运行 Kairox 旧语义 `rg` 审计。
4. 如果出现 P0/P1，直接修复。
5. 重复审计直到 P0/P1 为 0。
6. 跑：

```bash
cd media-service && npm test
cd media-service && npm run build:web
```

7. 更新 `docs/v3/KAIROX_CLEANUP_AUDIT.md`。
8. 继续 Kairox Performance：
   - 跑 `media-service/scripts/kairox-performance-smoke.js`。
   - 补齐 pressure-aware supply 的测试和报告。
   - 验证 heavy flow / awaiting confirmation 不阻塞轻任务补队列。
9. 不要部署生产，除非用户明确要求。
10. 若用户要求生产验证，必须先 dry-run，再按 Kairox Beta / Performance E2E 文档执行。

## 7. 下一线程开头提示词

可以直接复制以下提示词到新线程：

```text
请继续 ShelfDeck Kairox 工作。本线程因为 Codex GPT 5.5 额度暂停，当前追踪目标尚未整体完成。

工作目录：E:\my_project\emby_third_party

请先阅读：
- AGENTS.md
- docs/v3/KAIROX_THREAD_HANDOFF_PAUSED_2026_07_02.md
- docs/v3/KAIROX_ARCHITECTURE.md
- docs/v3/KAIROX_CLEANUP_AUDIT.md
- docs/v3/KAIROX_PERFORMANCE_PLAN.md

背景：
- Kairox Beta 曾用生产环境跑过 E2E，记录在 docs/v3/KAIROX_BETA_PRODUCTION_E2E.md。
- 之后又继续做了 Kairox Performance 和代码 clean-up，当前 worktree 有大量未提交修改。
- 不要继承上一轮生产 E2E 作为当前 worktree 的证明。

Kairox 唯一业务任务语义：
object + targetGate + gateObjective

允许的业务目标：
- targetGate: ingest / metadata / optimize / archive / delete
- gateObjective
- userPerceptionFacts
- mediaFacts / metadataFacts / gateFacts
- lifecycleProjection

允许的实现路径：
- selectedFlow / flowKind
- flow execution event

关键规则：
1. 不得把 scrape/transcode/upgrade/delete 叫成业务 candidate / action / task target。
   正确口径：
   - metadata candidate，不是 scrape candidate
   - optimize candidate，不是 transcode candidate
   - delete candidate 是 delete gate review candidate
   - scrape/transcode/upgrade/delete 只能是 selectedFlow / flowKind

2. 不得继续使用以下旧字段作为业务主语义：
   actionType, operationKind, enabledActions, enabledOperations, smartTaskEnabledActions,
   candidatesByAction, enqueuedByAction, cooldownHoursByAction, maxQueuedByAction,
   action/actionParams, recommendedAction, businessFlowDecision.action,
   optimize.delete, remove_media objective

3. Lifecycle / Task Creator 只能看 targetGate + gateObjective。
   Flow Planner 根据 current facts + gateObjective 选择 selectedFlow。
   Executor 只能执行 selectedFlow，不得反向创建业务目标。

4. delete 必须独立：
   delete 是 targetGate=delete。
   delete 不得出现在 optimize objective。
   delete 不得作为 optimize flow。
   delete candidate 必须来自 archive 后 delete gate review。
   未确认前不得 destructive delete。

5. optimize objective 只表达目标媒体事实。
   Rule template 不能出现转码/压缩/洗版/删除/保留这类 action-like 文案。
   Flow Planner 才能决定 no_op / transcode / upgrade / blocked。

请从当前 worktree 重新取证，不要相信上一线程结论。

先运行：
git status --short
rg -n "actionType|item\.action|rule\.action|actionParams|operationHint|recommendedAction|businessFlowDecision\.action|candidatesByAction|enqueuedByAction|cooldownHoursByAction|maxQueuedByAction|operationKindWeights|preferredOperation|transcode candidate|scrape candidate|upgrade candidate|smartTaskEnabledActions|enabledActions|enabledOperations|optimize\.delete|remove_media|MediaAction|preferredTaskAction|allowedOperationForItem|action_not_enabled|byRecommendedAction|targetGateForAction|bridgeKindForAction|concurrencyLimitForAction" media-service/src media-service/web/src media-service/test

列出 P0/P1/P2。
发现 P0/P1 直接修复。
修复后重复审计直到 P0/P1 为 0。

最后必须运行：
cd media-service && npm test
cd media-service && npm run build:web

然后更新 docs/v3/KAIROX_CLEANUP_AUDIT.md，并告诉我：
- P0/P1 是否为 0
- 剩余 P2 是什么
- npm test / build:web 是否通过
- 当前是否可以认为 ShelfDeck 后端 Kairox Beta 语义闭合
- Kairox Performance 还剩哪些验证

不要部署生产，除非我明确要求。
```

## 8. 风险提示

- 不要把 Kairox Beta 的历史生产 E2E 当成当前 dirty worktree 的生产验收。
- 不要把 `candidatesBySelectedFlow` 当业务候选；它只能是诊断分布。
- 不要因为 `operationKind` 在 executor/runtime 中存在就盲目删除数据库字段；只有当它泄漏成业务语义时才是问题。
- 不要把 UI GA 混入 clean-up 审计。UI GA 是后续产品化版本。
- 不要跑生产 destructive 测试，除非用户明确再次授权。
- 不要清空、迁移、删除生产数据，除非用户明确要求。
