# DESIGN_SERVICE/TASK_SCHEDULER — 任务调度引擎

> 状态：v4 定稿
> SSOT：本文是任务调度可执行行为的唯一事实来源
> 基准架构：Phase 4，per-subLibrary 调度 + 双向 API 通信模型

---

## §1 架构定位

### 1.1 Scheduler 与 FlowExecutor 的关系

Scheduler 和各个 FlowExecutor 是**对等的独立模块**，通过 API 互相调用，不共享内存。

```
┌─────────────────────────────────────────────────────┐
│                    Scheduler                         │
│  职责：                                              │
│  - 调用 flow.driveTask(taskId) 发起/恢复任务         │
│  - 调用 flow.pause(taskId) / flow.cancel(taskId)     │
│  - 接收 flow.reportStatus() 状态变更通知             │
│  - 管理 slot（并发数控制）                            │
│  - 定时轮询 slot，调度可执行的任务                    │
│  - 提供 getHealth() 给健康检查模块                   │
└─────────────────────────────────────────────────────┘
              ↕ 双向 API 调用
┌─────────────────────────────────────────────────────┐
│               FlowExecutor                          │
│  (DeleteFlow / TranscodeFlow / UpgradeFlow)         │
│  职责：                                              │
│  - driveTask(taskId)：执行/恢复（Scheduler 调）       │
│  - pause(taskId) / cancel(taskId)：被 Scheduler 调  │
│  - confirmReceived(taskId)：confirm API 调          │
│  - reportStatus(status)：通知 Scheduler              │
└─────────────────────────────────────────────────────┘
```

### 1.2 目标架构

```
TaskScheduler（taskScheduler.js）
    │
    ├── 调度决策：slot 检查、per-subLibrary scheduleMode
    ├── 路由决策：根据 actionType 获取 Flow 实例
    │
    ├──→ DeleteFlowExecutor（deleteFlowExecutor.js）
    ├──→ TranscodeFlowExecutor（transcodeFlowExecutor.js）
    └──→ UpgradeFlowExecutor（upgradeFlowExecutor.js）
```

**调度间隔**：5s 轮询（`schedulerBusy` 防重入，上一轮未结束时跳过本轮）

---

## §2 模块间 API 契约

### 2.1 Scheduler 暴露的 API

| API | 调用方 | 说明 |
|---|---|---|
| `scheduler.pauseForConfirm(taskId, resumePoint)` | Flow | 通知 Scheduler 任务暂停等确认 |
| `scheduler.reportStatus(taskId, status, progress?)` | Flow | 上报状态变更（done/failed_hard/interrupted/paused/executing/waiting_media_source 等）。同时写 activity log（任务开始/完成/失败事件），并在 done/failed_hard 时写 lastTaskDoneAt 到 library.json（48h 冷却） |
| `scheduler.markConfirmed(taskId)` | confirm API | 标记任务已被用户确认，下一轮调度时 bypass slot 检查 |
| `scheduler.getHealth()` | healthCheck | 返回 `{ status: 'green'|'red', runningTasks: number }` |

### 2.2 FlowExecutor 暴露的 API

| API | 调用方 | 说明 |
|---|---|---|
| `flow.driveTask(taskId)` | Scheduler | 开始或恢复执行（resumePoint 由 Flow 从 task 对象读取） |
| `flow.pause(taskId)` | Scheduler | 用户暂停 |
| `flow.cancel(taskId)` | Scheduler | 用户取消 |
| `flow.confirmReceived(taskId)` | confirm API | 用户确认 |

### 2.3 confirm 完整流程

```
Flow 执行中
    ↓
Flow 需要用户确认
    ↓
Flow 调用 scheduler.pauseForConfirm(taskId, resumePoint)
    → Scheduler 改 status = awaiting_user_confirm
    → Scheduler 记录 resumePoint
    → Scheduler 从 runningTasks 移除
    ↓
Flow 暂停，等用户点确认

用户点 confirm（PATCH /v1/tasks/:id { confirmed: true, confirmData? }）
    ↓
confirm API 调用 flow.confirmReceived(taskId)
    ↓
confirm API 调用 scheduler.markConfirmed(taskId)  → bypass slot 检查
    ↓
Flow 从 resumePoint 继续执行
    ↓
Flow 执行完毕，调用 scheduler.reportStatus(taskId, 'done')
```

### 2.4 用户暂停/取消完整流程

```
Flow 执行中
    ↓
用户触发暂停 → Scheduler 调用 flow.pause(taskId)
用户触发取消 → Scheduler 调用 flow.cancel(taskId)

Flow 内部处理（各 Flow 自定义，详见各 Flow 文档）：
    - 清理资源（FFmpeg 进程、临时文件等）
    - 调用 scheduler.reportStatus(taskId, 'paused' 或 'done')
    - 部分 Flow 在特定阶段无法立即响应（如等待 hash 获取），通过 pausingRequested / pendingCancel 标记延迟执行
```

---

## §3 调度决策

### 3.1 调度检查

Scheduler 每次轮询分两轮（Pass）：

**Pass 1：中断恢复**
- 扫描所有 `interrupted` 状态任务
- retryCount < 3 → 重新入队 `queued`（retryCount + 1）
- retryCount >= 3 → 标记 `failed_hard`

**Pass 2：调度分发**（按 recovered 优先排序，再按原始顺序）

对每个任务依次检查：

1. **终端状态跳过**：`done` / `failed_hard` → 跳过
2. **防重入**：已在 `runningTasks` Set → 跳过
3. **稳定状态跳过**：`paused` / `pausing` / `awaiting_user_confirm` / `waiting_media_source` → 跳过
4. **per-subLibrary scheduleMode**：`pending_manual` / `created` 状态的任务，检查 `resolveSubLibSchedule(task.itemInfo, config).autoExecute`，为 false 则跳过
5. **itemId 锁**：该 itemId 已有活跃任务 → 跳过（`executing` 状态除外）
6. **状态转换**：`created` / `pending_manual` → `queued`（纯状态变更）
7. **actionType slot 检查**：该 actionType slot 已满且非 `justConfirmedIds` → 跳过
8. **Fire-and-forget**：`flow.driveTask(taskId).catch(...)` 异步执行，Flow 通过 `reportStatus` 报告结果

### 3.2 per-subLibrary 调度模式

调度决策不再使用全局 `executionMode`，改为 per-subLibrary 的 `scheduleMode`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `autoExecute` | boolean | 任务创建后是否自动入队 `queued`（false = `pending_manual`，需用户手动 execute） |
| `autoReplaceTranscode` | boolean | 转码完成后是否自动替换（false = 需 confirm） |
| `autoReplaceUpgrade` | boolean | 洗版完成后是否自动替换（false = 需 confirm） |
| `autoCreate` | boolean | SmartTaskEngine 是否对该子库自动创建任务 |
| `smartSelectEnabled` | boolean | 洗版是否启用智能选种 |

通过 `configStore.resolveSubLibSchedule(task.itemInfo, config)` 解析当前任务对应的子库调度配置。

### 3.3 execute action 行为

`POST /v1/tasks/:id/actions/execute` 支持从多种状态恢复：

| 当前状态 | 行为 |
|---|---|
| `pending_manual` | → `queued`（直接入队） |
| `interrupted` | → `queued` |
| `paused` | → `queued` |
| `pausing` | 清除 pause 请求，设置回 `executing` |

### 3.4 夜间暂停

本期不实现。

---

## §4 状态管理

### 4.1 status（调度层管理）

- `pending_manual`：等待用户 execute（per-subLibrary `autoExecute: false`）
- `created`：刚创建（兼容旧状态，调度时统一转 `queued`）
- `queued`：可调度，等待 Scheduler 分配 slot
- `executing`：正在执行（Flow drive 中）
- `pausing`：用户请求暂停，Flow 正在等待安全暂停点
- `paused`：用户暂停
- `awaiting_user_confirm`：等待用户 confirm
- `waiting_media_source`：洗版搜索无结果，parking 状态（等待后续重试）
- `interrupted`：进程异常退出时降级
- `done`：正常结束
- `failed_hard`：硬失败

**活跃状态**（占用 slot 和 itemId 锁）：`executing`、`pausing`、`awaiting_user_confirm`

### 4.2 phase（Flow Executor 管理）

- 值由各 Flow Executor 自行定义
- 交互规则由各 Flow Executor 与本文约定

### 4.3 边界规则

- Scheduler **只读写 status**，不读写 phase
- Flow Executor **只读写 phase**，不读写 status
- TaskStore 持久化两者

---

## §5 并发保护

| 机制 | 作用域 | 说明 |
|---|---|---|
| `runningTasks` Set | 同轮次防重入 | Scheduler 每轮对每个任务调用一次 driveTask |
| `schedulerBusy` flag | 轮次级防重入 | 上一轮未结束则跳过新轮次 |
| `recoverInterruptedTasks()` | 启动恢复 | 扫描 10 种中断状态（precheck/executing/verify/transcode_executing/transcode_replace/upgrade_executing/upgrade_replace/planning/pre_replace_verify/pausing）+ pausingRequested flag，统一降级为 interrupted |
| `itemId` 锁 | item 维度 | 同一 `itemId` 只能有一个 flow 在跑（跨 actionType） |
| `justConfirmedIds` Set | 单轮次 bypass | 用户 confirm 后的任务绕过 slot 限制（它已持有 slot） |

### 5.1 中断恢复 + 重试

启动时 `recoverInterruptedTasks()` 将所有非终端、非 `awaiting_user_confirm` 的中断任务降级为 `interrupted`。

调度时 Pass 1 对 `interrupted` 任务自动重试：
- retryCount < 3 → 重新 `queued`（retryCount + 1）
- retryCount >= 3 → `failed_hard`

Pass 2 中 recovered 任务优先于普通 `queued` 任务分发。

---

## §6 完整意图链路

### 任务创建链路

```
desktop / admin web / SmartTaskEngine 意图下发（POST /v1/tasks）
    ↓
API 层（app.js）接收 HTTP 请求、参数校验
    ↓
TaskStore.createTask() 持久化任务（status 由 per-subLibrary scheduleMode 决定）
    ↓
Scheduler 定时轮询（每 5s）：
    → 终端状态跳过
    → per-subLibrary autoExecute 检查
    → itemId 锁检查
    → actionType slot 检查
    → 通过 → 获取对应 Flow 实例
    → 调用 flow.driveTask(taskId)
```

### 进度轮询链路

```
desktop 渲染进程
    │ 轮询 GET /v1/tasks（间隔 400ms）
    ↓
service REST API
    └── TaskStore → 返回当前任务列表（含 status、progress、phase）
```

---

## §7 子模块索引

| 子模块 | 文件 |
|---|---|
| TaskScheduler（调度+路由） | `SERVICE/TASK_SCHEDULER.md` | 本文 |
| DeleteFlowExecutor | `SERVICE/DELETE_FLOW.md` |
| TranscodeFlowExecutor | `SERVICE/TRANSCODE_FLOW.md` |
| UpgradeFlowExecutor | `SERVICE/UPGRADE_FLOW.md` |

## 关联文档

- `SERVICE/DELETE_FLOW.md` — DeleteFlowExecutor 详细设计
- `SERVICE/TRANSCODE_FLOW.md` — TranscodeFlowExecutor 详细设计
- `SERVICE/UPGRADE_FLOW.md` — UpgradeFlowExecutor 详细设计
- `SERVICE/TRANSCODE.md` — TranscodeService 执行层
- `SERVICE/CONFIG.md` — per-subLibrary scheduleMode 等配置
- `SERVICE/STRATEGY_ENGINE.md` — 策略计算引擎（决定 item 的 action）
- `SERVICE/SMART_TASK_ENGINE.md` — 智能入队引擎（自动创建任务）
