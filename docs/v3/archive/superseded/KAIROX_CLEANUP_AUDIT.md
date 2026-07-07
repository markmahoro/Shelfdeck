# Kairox Beta Cleanup Audit

本文记录 Kairox Beta 的当前审计基线。审计口径以 `KAIROX_ARCHITECTURE.md` 和 `KAIROX_ENGINEERING_PLAYBOOK.md` 为准。

Beta 的任务主语义只能是：

```text
object + targetGate + gateObjective
```

`scrape`、`transcode`、`upgrade`、`archive`、`delete` 只能作为 `flowPlan.flowKind`、executor 或 event 细节存在。它们不能作为 task 顶层字段、candidate 主语义、规则模板语义、Dashboard / Task Center 主解释或 compatibility layer 被继续保留。

用户未来可以参与 optimize task 的 flow 决策，但只能通过 `flowReview` / `flowPreference` 进入 Flow Planner replan。`flowPreference.preferredFlowKind` 不是 task identity，也不是 executor dispatch；它不能替代 `targetGate/gateObjective`。

## 当前结论

当前 worktree 仍处于 Kairox Beta cutover 施工中，P0/P1 尚未清零，不允许宣称 Kairox Runtime Cutover 完成。

## 保留

| 位置 | 结论 |
| --- | --- |
| `docs/v3/KAIROX_ARCHITECTURE.md` | 已收口为 6 stage / 5 gate，并明确禁止 runtime compatibility layer |
| `docs/v3/KAIROX_ENGINEERING_PLAYBOOK.md` | 已补充逻辑组件到物理组件映射和 Physical Runtime Cutover 目标 |
| `flowPlanner.js` 的 `flowPlan.flowKind` 方向 | 可保留；用户 flow 参与应收口为 `flowReview/flowPreference` |
| `taskStore.js` 清洗顶层 selected flow 的方向 | 可保留，但需要继续保证新 task/API 不暴露 legacy fields |
| `deleteCandidateService.js` | 作为 delete gate review 入口保留 |

## P0 - 必须重做或修正

| 位置 | 当前问题 | 目标 |
| --- | --- | --- |
| `taskScheduler.js` | 曾直接 import executor 并按 flowKind 路由 | 已开始迁移到 `resourceRuntime.js`；scheduler 必须只调度 task |
| `businessFlowPolicy.js` | 仍以 operation / SelectedFlow 为核心策略入口 | 退役主路径，拆为 `automationPolicy.js` 和 `taskCreationPolicy.js` |
| `taskAdmission.js` | 仍接受 `SelectedFlow` | 输入收口为 `object + targetGate + gateObjective + source` |
| `smartTaskEngine.js` | 仍生成 `SelectedFlow` candidate，输出 `candidatesBySelectedFlow` | 只生成 targetGate candidate，摘要按 targetGate |
| `lifecycleTaskPlanner.js` | 名字和职责误导，把 Lifecycle、Task、Flow 混在一起 | 退役；职责迁移到 Flow Planner / Task Creator / policy 模块 |
| `lifecycleObjectiveResolver.js` | objective 中仍出现 selectedFlow / flow fallback | objective 只表达 target media facts |
| `lifecycleGateService.js` | optimize gate 仍读取 operation / selectedOperation | gate 判断只读 facts/objective |
| `app.js` | API adapter 中仍有业务决策、manual selectedFlow/preferredFlow、任务 top-level legacy projection | API 收口为 targetGate/gateObjective；未来 flow 改选只接受 flowPreference 并重新进入 Flow Planner |
| `web/src/*` | UI 类型和筛选仍依赖 SelectedFlow | Beta 只需 smoke；不得阻塞后端，但不能作为后端语义依据 |

## P1 - 诊断/测试/文档污染

| 位置 | 当前问题 | 目标 |
| --- | --- | --- |
| `resourceProjection.js` / `spaceStats.js` / `priorityEngine.js` | 仍用 selectedFlow 作为分析维度或权重维度 | 资源诊断可看 flowKind，但业务 priority / summary 主维度必须是 targetGate |
| `optimizationStatus.js` | 仍从 task SelectedFlow 推导 optimize 状态 | 改为 gate facts / flowPlan.flowKind 结果事实 |
| `flowRecoveryContract.js` | 仍读取 `task.flowPlan.SelectedFlow || task.SelectedFlow` | 改为 `task.flowPlan.flowKind` |
| Tests | 大量 fixture/assertion 仍使用 SelectedFlow | 按 targetGate / gateObjective / flowPlan.flowKind 重写 |
| 历史交接文档 | 仍把 selectedFlow 当作可接受物理 projection | 历史文档保留，但不得覆盖当前 architecture/playbook |

## P2 - 暂时允许

| 位置 | 原因 |
| --- | --- |
| 一次性 migration / cutover 脚本读取旧 `actionType` / `SelectedFlow` / `operationKind` | 只作为旧数据输入清洗，输出不得保留 legacy runtime 字段 |
| 负向测试中的 legacy 字段 | 用于证明新 runtime 拒绝或清洗旧字段 |
| 历史文档中的 Mirex 术语 | 作为历史事实保留，不作为当前合同 |

## 当前已完成的 Beta 修正

- 新增 `resourceRuntime.js`，承接 executor routing。
- `taskScheduler.js` 已移除 executor import、`getFlow()` 和直接 `driveTask()`。
- gate invalidation 的 runtime 字段改为 `sourceFlowKind`。
- `scrapeFlowExecutor` 的 gate invalidation / completion verification 开始改用 `flowPlan.flowKind`。

## 审计命令

```bash
rg -n "SelectedFlow|selectedFlow|selected_flow|preferredFlow|operationKind|operation_kind|selectedOperation|actionType|bySelectedFlow|candidatesBySelectedFlow|readEnabledSelectedFlows|USER_OPERATIONS|BRIDGE_OPERATIONS|getFlow\\(|sourceSelectedFlow|sourceflowKind|Flow Scheduler" media-service/src media-service/web/src media-service/test docs/v3
```

判定标准：

- P0/P1 为 0 才能宣称 Kairox Runtime Cutover 完成。
- `taskScheduler.js` 不得出现 executor import、executor map、`getFlow()` 或直接 `driveTask()`。
- 新 task/API 不得暴露 top-level `SelectedFlow/selectedFlow/actionType/operationKind`。
- 若支持用户改选 optimize flow，必须使用 `flowPreference`，并由 Flow Planner 重新产出 final `flowPlan.flowKind`。
