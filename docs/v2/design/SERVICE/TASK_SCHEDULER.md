# DESIGN_SERVICE/TASK_SCHEDULER — 任务调度引擎

> 状态：v2 重写中
> SSOT：本文是任务调度可执行行为的唯一事实来源
> 基准架构：Phase 3，基于双向 API 通信模型重写

---

## §1 架构定位

### 1.1 Scheduler 与 FlowExecutor 的关系

Scheduler 和各个 FlowExecutor 是**对等的独立模块**，通过 API 互相调用，不共享内存。

```
┌─────────────────────────────────────────────────────┐
│                    Scheduler                         │
│  职责：                                              │
│  - 调用 flow.drive(resumePoint) 发起/恢复任务         │
│  - 调用 flow.pause() / flow.cancel() 用户操作        │
│  - 接收 flow.reportStatus() 状态变更通知             │
│  - 管理 slot（并发数控制）                            │
│  - 定时轮询 slot，调度可执行的任务                    │
└─────────────────────────────────────────────────────┘
              ↕ 双向 API 调用
┌─────────────────────────────────────────────────────┐
│               FlowExecutor                          │
│  (DeleteFlow / TranscodeFlow / UpgradeFlow)         │
│  职责：                                              │
│  - drive(resumePoint)：执行/恢复（Scheduler 调）      │
│  - pause() / cancel()：被 Scheduler 调              │
│  - confirmReceived()：confirm API 调                │
│  - reportStatus(status)：通知 Scheduler              │
└─────────────────────────────────────────────────────┘
```

### 1.2 目标架构

```
TaskScheduler（taskScheduler.js）
    │
    ├── 调度决策：slot 检查、executionMode
    ├── 路由决策：根据 actionType 创建/获取 Flow 实例
    │
    ├──→ DeleteFlowExecutor（deleteFlowExecutor.js）
    ├──→ TranscodeFlowExecutor（transcodeFlowExecutor.js）
    └──→ UpgradeFlowExecutor（upgradeFlowExecutor.js）
```

**调度间隔**：5s 轮询（本期暂不引入事件驱动）

---

## §2 模块间 API 契约

### 2.1 Scheduler 暴露的 API

| API | 调用方 | 说明 |
|---|---|---|
| `scheduler.pauseForConfirm(taskId, resumePoint)` | Flow | 通知 Scheduler 任务暂停等确认 |
| `scheduler.reportStatus(taskId, status, progress?)` | Flow | 上报状态变更（done/failed_hard/interrupted/paused 等） |

### 2.2 FlowExecutor 暴露的 API

| API | 调用方 | 说明 |
|---|---|---|
| `flow.drive(resumePoint)` | Scheduler | 开始或恢复执行 |
| `flow.pause()` | Scheduler | 用户暂停 |
| `flow.cancel()` | Scheduler | 用户取消 |
| `flow.confirmReceived()` | confirm API | 用户确认 |

### 2.3 confirm 完整流程

```
Flow 执行中
    ↓
Flow 需要用户确认
    ↓
Flow 调用 scheduler.pauseForConfirm(taskId, resumePoint)
    → Scheduler 改 status = awaiting_user_confirm
    → Scheduler 记录 resumePoint
    ↓
Flow 暂停，等用户点确认

用户点 confirm（PATCH /v1/tasks/:id { confirmed: true })
    ↓
confirm API 调用 flow.confirmReceived()
    ↓
Flow 从 resumePoint 继续执行
    ↓
Flow 执行完毕，调用 scheduler.reportStatus(taskId, 'done')
```

### 2.4 用户暂停/取消完整流程

```
Flow 执行中
    ↓
用户触发暂停 → Scheduler 调用 flow.pause()
用户触发取消 → Scheduler 调用 flow.cancel()

Flow 内部处理（各 Flow 自定义，详见各 Flow 文档）：
    - 清理资源（FFmpeg 进程、临时文件等）
    - 调用 scheduler.reportStatus(taskId, 'paused' 或 'done')
```

---

## §3 调度决策

### 3.1 Slot 检查

- 各 actionType 独立维护 concurrency 计数
- `queued` 任务只有对应 actionType 的 slot 有空闲时才被调度
- slot 计算：执行中的任务数（`executing` 状态）< 对应 concurrency 上限

### 3.2 executionMode

| executionMode | 行为 |
|---|---|
| `auto` | 任务创建后 status 直接为 `queued`，进入调度池 |
| `manual` | 任务创建后 status 为 `pending_manual`，需用户调用 `execute` 才变为 `queued` |

### 3.3 夜间暂停

本期不实现。

---

## §4 状态管理

### 4.1 status（调度层管理）

- `pending_manual`：手动模式，等待用户 execute
- `created`：刚创建（自动模式）
- `queued`：可调度，等待 Scheduler 分配 slot
- `executing`：正在执行（Flow drive 中）
- `paused`：用户暂停
- `awaiting_user_confirm`：等待用户 confirm
- `interrupted`：进程异常退出时降级
- `done`：正常结束
- `failed_hard`：硬失败

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
| `runningTasks` Set | 同轮次防重入 | Scheduler 每轮对每个任务调用一次 drive |
| `recoverInterruptedTasks()` | 启动恢复 | 扫描 executing/precheck/verify 状态，统一降级为 interrupted |

---

## §6 完整意图链路

### 任务创建链路

```
desktop 意图下发（POST /v1/tasks）
    ↓
API 层（app.js）接收 HTTP 请求、参数校验
    ↓
TaskStore.createTask() 持久化任务
    ↓
Scheduler 定时轮询（每 5s）：
    → 检查 actionType 对应 slot 有无空闲
    → 有空闲 → 获取对应 Flow 实例
    → 调用 flow.drive('xxx_precheck')
```

### 进度轮询链路

```
desktop 渲染进程
    │ 轮询 GET /v1/tasks（间隔 400ms）
    ↓
service REST API
    └── TaskStore → 返回当前任务列表（含 status、progress、flowState）
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
- `SERVICE/CONFIG.md` — executionMode、夜间暂停等配置
