# Kairox Handoff - 2026-07-02

Status: superseded handoff document. The paused goal was resumed in the same thread after this handoff was written.

本文件保留当时的交接记录。最新审计结论、P2 清单和测试结果以 `docs/v3/KAIROX_CLEANUP_AUDIT.md` 为准。

本文给下一线程交接当前 Kairox Beta / Performance / GA 相关工作，以及“ShelfDeck 是否已经按 Kairox 架构改干净”的代码审计状态。

## 1. 当前结论

当前目标尚未达成。

已经完成了大量 Kairox 语义收口和审计修复，但最后一轮 `npm test` / `npm run build:web` 在用户主动中断前没有完成。因此不能声明“代码已经按 Kairox 改干净”，也不能声明本轮改动可发布。

当前判断：

- 后端主链路已经明显接近 Kairox：task 主语义收敛到 `object + targetGate + gateObjective`，flow 路径通过 `selectedFlow/flowKind` 表达。
- `delete` 已从 optimize 语义中拆出，成为独立 `targetGate=delete` / delete candidate review。
- `metadata gate` 与 user perception 的边界已收口：metadata gate 默认不要求 rating / watched / playCount / favorite。
- 仍需要下一线程完成完整测试、build、最终审计和必要修复。
- UI 还不是 GA 水平；当前只做了最小语义纠偏，不是最终用户可用 UI GA。

## 2. Worktree 状态

当前 worktree 有大量未提交修改，不能假设任一文件已经稳定。

主要改动范围：

- Kairox docs:
  - `docs/v3/KAIROX_ARCHITECTURE.md`
  - `docs/v3/KAIROX_CLEANUP_AUDIT.md`
  - `docs/v3/KAIROX_PERFORMANCE_PLAN.md`
  - `docs/v3/BUSINESS_MODEL_NOTES.md`
  - `docs/v3/USER_INTERVENTION_AND_FULL_AUTO.md`
  - `docs/v2/ARCH_OVERVIEW.md`
- Kairox Beta / E2E:
  - `media-service/scripts/kairox-beta-cutover.js`
  - `media-service/scripts/kairox-beta-production-e2e.js`
- Performance:
  - `media-service/scripts/kairox-performance-smoke.js`
  - `media-service/src/smartTaskEngine.js`
- Core semantics:
  - `businessFlowPolicy.js`
  - `taskAdmission.js`
  - `lifecycleProjection.js`
  - `lifecycleTaskPlanner.js`
  - `flowPlanner.js`
  - `taskStore.js`
  - `resourceProjection.js`
  - `strategyEngine.js`
  - `configStore.js`
  - `metadataStatus.js`
  - `spaceStats.js`
  - `v3Model.js`
- UI:
  - Dashboard / Task Center / Resource View / Media Manage / Rule Templates / System Config
  - shared web types and API client
- Tests:
  - `task-model.test.js`
  - `api-inject.test.js`
  - `api-contract.test.js`
  - `priority-engine.test.js`
  - `scrape-flow-metadata-gate.test.js`

## 3. Kairox Beta 状态

已做的方向性修改：

- `TaskTarget` 语义收口为 `targetGate + gateObjective`，并增加/使用 `selectedFlow` 表达 gate 内部实现路径。
- 删除不再作为 optimize objective / optimize operation。
- delete candidate review 最小能力已落地：
  - `GET /v1/admin/delete-candidates`
  - keep archived / snooze / suppress / confirm delete actions
  - confirm 后创建 `targetGate=delete` task
- `OPTIMIZE_OPERATIONS` 只包含 `transcode / upgrade`。
- `flowPlanner` 对 legacy `remove_media` optimize objective 保留负向拦截。
- `kairox-beta-cutover.js` 和生产 E2E 脚本存在，并已围绕 Kairox Beta 语义调整。
- 生产 E2E 文档已有：
  - `docs/v3/KAIROX_BETA_PRODUCTION_E2E.md`
  - `docs/v3/KAIROX_BETA_PRODUCTION_E2E.readonly-predeploy.md`

未完成 / 未证明：

- 当前改动后未重新完成生产 E2E。
- 当前改动后未完成完整 `npm test` 和 `npm run build:web`。
- 迁移脚本和生产 cutover 不能直接执行；必须先本地测试和 dry-run。
- 不能声明 Kairox Beta 已可发布。

## 4. Kairox Performance 状态

已做的方向性修改：

- 新增 `docs/v3/KAIROX_PERFORMANCE_PLAN.md`。
- 新增 `media-service/scripts/kairox-performance-smoke.js`。
- `SmartTaskEngine` 从旧的 action summary 口径收口到：
  - `enabledTaskTargets`
  - `allowedOptimizeFlows`
  - `candidatesByTargetGate`
  - `candidatesBySelectedFlow`
  - `enqueuedByTargetGate`
  - `enqueuedBySelectedFlow`
- 调度供给方向已从“全局 active backlog 一刀切 defer”推进到 pressure-aware 思路。

重要语义说明：

- `candidatesBySelectedFlow` 是诊断分布，不是业务候选主语义。
- 用户侧 / Dashboard 主语义应看 target gate candidate，例如 metadata / optimize / archive / delete。
- selected flow 只能解释 Flow Planner 或 executor 实现路径。

未完成 / 未证明：

- Performance smoke 未最终跑完并记录结果。
- 未做生产压测和推荐生产配置输出。
- 当前 Performance 版本不能视为完成。

## 5. GA 状态

当前 GA 只能指历史 v3.3 GA：

- `docs/v3/V3_3_GA_RECOVERY_PLAN.md` 记录 v3.3 GA 已在生产验收。
- v3.3 GA 恢复的是普通库、成人库、任务中心、设置页、automatic ingest、automatic metadata、automatic optimize transcode。
- v3.3 GA 明确不包含 automatic upgrade / delete。

Kairox 用户可用 GA 尚未达成：

- UI 仍有很多信息架构和文案问题。
- Kairox Beta 未完成当前变更后的测试闭环。
- Kairox Performance 未完成压测闭环。
- Production user-view E2E 需要重新跑。

## 6. 本轮“Kairox 是否改干净”审计进展

### 6.1 已修复的 P0/P1 类问题

已完成的语义修复包括：

- 后端不再从 `item.action` 推导 lifecycle optimize direction。
- `lifecycleProjection` 在 objective 未 ready 时不再错误触发 optimize task。
- Rule Template UI / config 保存路径不再写 `action/actionParams`。
- `strategyEngine` 不再输出 `item.action`。
- `spaceStats` / `v3Model` / `libraryStore` 不再从 `item.action` 推导优化/删除空间或 facts。
- `taskTarget.operationHint` 改为 `taskTarget.selectedFlow`。
- `/v1/library/queries/manage?action=...` 已移除。
- `businessFlowPolicy` 的旧 action 命名大幅收口：
  - `targetForAction` -> `targetForSelectedFlow`
  - `resolveAutoEnabledActions` -> `resolveEnabledAutomationFlows`
  - `action_not_enabled` -> `target_or_flow_not_enabled`
- Dashboard / Health / SmartTask health 的自动化输出改为 target/flow 口径。
- Media Manage 前端移除旧 action filter，并将 `MediaAction` / `preferredTaskAction` 改为 `MediaSelectedFlow` / `preferredTaskFlow`。
- 文档中把 delete 属于 optimize 的表述改为 delete gate review。

### 6.2 当前源码搜索结果

最后一次针对 `media-service/src media-service/web/src media-service/test` 的旧语义搜索，剩余命中主要是 P2：

- `configStore.js`
  - `smartTaskEnabledActions`
  - `cooldownHoursByAction`
  - `maxQueuedByAction`
  - `action/actionParams`
  - 作用：一次性迁移输入和清洗，不应继续作为运行时配置。
- `flowPlanner.js`
  - `remove_media`
  - 作用：负向回归防线，拒绝 legacy optimize delete objective。
- tests
  - `smartTaskEnabledActions` migration tests
  - `remove_media` negative test
  - `actionParams` stripping tests

这些当前暂列 P2，但下一线程必须重新审计确认：

```bash
rg -n "actionType|item\.action|rule\.action|actionParams|operationHint|recommendedAction|businessFlowDecision\.action|candidatesByAction|enqueuedByAction|cooldownHoursByAction|maxQueuedByAction|operationKindWeights|preferredOperation|transcode candidate|scrape candidate|upgrade candidate|smartTaskEnabledActions|enabledActions|enabledOperations|optimize\.delete|remove_media|MediaAction|preferredTaskAction|allowedOperationForItem|action_not_enabled" media-service/src media-service/web/src media-service/test
```

### 6.3 尚未最终证明的点

下一线程需要重点验证：

- `operationKind` 是否只作为 executor dispatch / SQLite physical projection，不再作为业务候选/目标/用户解释来源。
- `SmartTaskEngine` 是否只承接 lifecycle projection，不自己重新计算 objective。
- `TaskAdmission` duplicate prevention 是否稳定按 `itemId + targetGate`，不是按 selected flow。
- `Flow Planner` 对 no-op / transcode / upgrade / blocked 的选择和 explanation 是否完整。
- transcode 完成后是否确实写入 objectiveHash 对应 optimize gate facts。
- delete task 是否只来自 delete candidate confirm / explicit delete target，且未确认前不 destructive。
- UI 中所有“candidate/action/task target”口径是否已完全符合 Kairox。

## 7. 测试状态

已知情况：

- 之前某轮 focused tests 曾通过，但不是当前最新 worktree 的证明。
- 当前最新改动后，用户主动中断了测试命令：
  - `node --test test/task-model.test.js test/api-contract.test.js test/api-inject.test.js`
  - `npm run build:web`
- 因此当前不能声明测试通过。

下一线程必须至少运行：

```bash
cd media-service
npm test
npm run build:web
```

建议先跑 focused tests：

```bash
cd media-service
node --test test/task-model.test.js
node --test test/api-contract.test.js
node --test test/api-inject.test.js
node --test test/priority-engine.test.js
node --test test/scrape-flow-metadata-gate.test.js
```

如果 `npm test` 长时间无输出或超时，逐文件顺序跑并记录失败文件，再修复，最后仍要回到 `npm test`。

## 8. 下一线程建议执行顺序

1. 读取本文、`docs/v3/KAIROX_ARCHITECTURE.md`、`docs/v3/KAIROX_CLEANUP_AUDIT.md`。
2. 运行旧语义搜索，重新分类 P0/P1/P2。
3. 先修 P0/P1，不碰生产。
4. 跑 focused tests。
5. 跑 `npm test`。
6. 跑 `npm run build:web`。
7. 更新 `KAIROX_CLEANUP_AUDIT.md`，记录最终审计命中、P2 理由和测试证据。
8. 如果全部通过，再决定是否提交 git。
9. 只有用户明确要求部署时，才进入生产部署 / E2E。

## 9. 下一线程开头提示词

可以直接复制以下提示词到新线程：

```text
请继续 ShelfDeck Kairox 审计目标。当前线程因为额度暂停，目标尚未完成。

工作目录：E:\my_project\emby_third_party

请先阅读：
- AGENTS.md
- docs/v3/KAIROX_HANDOFF_2026_07_02.md
- docs/v3/KAIROX_ARCHITECTURE.md
- docs/v3/KAIROX_CLEANUP_AUDIT.md

目标：
完整审计 ShelfDeck 当前代码是否已经按 Kairox 架构改干净。

Kairox 唯一业务任务语义是：
object + targetGate + gateObjective

允许的核心概念：
- targetGate: ingest / metadata / optimize / archive / delete
- gateObjective
- selectedFlow / flowKind
- flow execution event
- userPerceptionFacts
- mediaFacts / metadataFacts / gateFacts
- lifecycleProjection

重点审计：
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
先运行 rg 审计并列出 P0/P1/P2。
发现 P0/P1 直接修复。
修复后重复审计直到 P0/P1 为 0。
最后必须运行：
cd media-service && npm test
cd media-service && npm run build:web

不要部署生产，除非我明确要求。
最终更新 docs/v3/KAIROX_CLEANUP_AUDIT.md，并告诉我：
- P0/P1 是否为 0
- 剩余 P2 是什么
- npm test / build:web 是否通过
- 当前是否可以认为 ShelfDeck 后端 Kairox Beta 语义闭合
```

## 10. 风险提示

- 不要直接部署当前 worktree。
- 不要因为旧语义搜索只剩 P2 就宣布完成；必须用测试和代码路径证明。
- 不要把历史文档流水账中的旧模型全部重写；只需保证当前架构文档、当前实现地图和当前审计文档不误导。
- 不要清理 executor 的 `operation_kind` 物理字段，除非明确做数据库迁移；当前它应只作为 executor dispatch / historical projection。
- 不要把 UI GA 混入本轮审计。当前目标是 Kairox 语义干净和可验证，不是最终 UI 重构。
