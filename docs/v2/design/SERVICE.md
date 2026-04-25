# DESIGN_SERVICE — 胖服务组件总览

> Phase 3（服务执行引擎）为基准架构。
> 状态：v2 重写中

## §1 组件定位

service 是 Phase 3 的胖服务组件，承担所有业务逻辑执行：

- **进程模式**：由 tray-supervisor spawn 为子进程，生命周期与 tray 绑定
- **协议**：仅暴露 HTTP REST API，不做 IPC
- **数据权威**：任务队列、配置、Emby 连接信息均为 service 持有，desktop 只读
- **外部集成**：所有外部系统（Emby、豆瓣、MoviePilot）均通过 service 集成，desktop 不直接通信

组件间关系由 `ARCH_OVERVIEW.md` §1（组件边界）和 §3（数据流）描述，本文档仅聚焦 service **内部**子模块的职责和协作。

## §2 子模块职责链路

### §2.1 执行器架构

#### 2.1.1 目标架构

```
TaskScheduler
    │ driveTask(taskId) — 统一入口，根据 actionType 分派
    ▼
taskExecutor.js（调度代理层，仅做路由）
    │
    ├──→ DeleteFlowExecutor（deleteFlowExecutor.js）
    │
    ├──→ TranscodeFlowExecutor（transcodeFlowExecutor.js）
    │
    └──→ UpgradeFlowExecutor（upgradeFlowExecutor.js）
```

**原则**：`taskExecutor.js` 保留为纯调度代理，**不承载任何具体 Flow 逻辑**。每个 Flow 的状态机独立为同名子模块。

#### 2.1.2 共享层（所有 Flow 共用）

| 共享内容 | 文件位置 | 说明 |
|---|---|---|
| `recoverInterruptedTasks()` | `taskExecutor.js` | 启动时扫描中断任务，统一降级 |
| `runningTasks` / `_driveCallIds` / `_appendLock` | `taskExecutor.js` | 调度代理并发保护，Flow 不感知 |

#### 2.1.3 各 Flow 执行器职责

**DeleteFlowExecutor**

```
runDeleteFlow(task)
    ├── precheck：调用 embyService.libraryItemExists()
    ├── 若不存在 → done
    ├── 若存在 → getItemDeleteInfo() → awaiting_user_confirm（停泊）
    └── 用户 confirm 后：doDeleteExecute()
        ├── 调用 embyService.deleteLibraryItem()
        └── verify：libraryItemExists() → done 或 failed_hard
```

依赖：`embyService`、`taskStore`、`configStore`

---

**TranscodeFlowExecutor**

```
runTranscodeFlow(task)
    ├── precheck：调用 transcodeService.precheck()
    │   ├── 需要 DV 确认 → awaiting_user_confirm（停泊）
    │   └── 校验设备池非空
    ├── executing：调用 transcodeService.startEncode()
    │   └── 进度通过 onProgress 回调写 TaskStore
    ├── verify：调用 transcodeService.probeSummary()
    ├── replace 前确认（可选）→ awaiting_user_confirm（停泊）
    └── doReplace()：调用 transcodeService.replaceWithRetries()
```

依赖：`transcodeService`、`embyService`、`taskStore`、`configStore`

---

**UpgradeFlowExecutor**

```
runUpgradeFlow(task)
    └── 目前空壳，直接 failed_hard
```

> 未来实现 MoviePilot 集成时，UpgradeFlowExecutor 是唯一需要改动的模块。

#### 2.1.4 TaskStore 操作封装（Flow Executor → TaskStore）

每个 Flow Executor 通过封装好的辅助函数操作 TaskStore：

```
executor.setStatus(taskId, status)      → taskStore.updateTask(taskId, { status })
executor.setProgress(taskId, pct)       → taskStore.updateTask(taskId, { progress: pct })
executor.appendLog(taskId, entry)       → 本 Executor 私有 appendLog（独立 seq）
executor.fail(taskId, code, message)   → setStatus + appendLog
```

> flowLog 为各 Executor 私有，seq 各自独立递增，不跨 Flow 排序。

这样 TaskStore 的调用方式集中管控，Flow Executor 只关注业务逻辑。

#### 2.1.5 拆分前后对比

| 维度 | 拆分前（当前） | 拆分后（目标） |
|---|---|---|
| 文件数 | 1 个 taskExecutor.js | 4 个文件（代理 + 3 个 Executor） |
| Transcode 改造风险 | 可能影响 Delete/Upgrade | 仅改动 transcodeFlowExecutor.js |
| 并发保护 | 集中 | 保留在代理层，Executor 不感知 |
| 新增 Flow | 修改 taskExecutor switch | 新增一个 Executor + 注册 |

### §2.3 任务生命周期操作

#### 2.3.1 操作总览

| 操作 | REST 端点 | 作用 | TaskScheduler 响应 |
|---|---|---|---|
| **创建** | `POST /v1/tasks` | 创建新任务 | 调度器按 executionMode 决定立即执行或等待 |
| **确认** | `PATCH /v1/tasks/:id` `{ confirmed: true }` | 用户确认后推进 Flow | 解除 `awaiting_user_confirm` 停泊，状态改回 `queued`，下次调度轮询时推进 |
| **执行** | `POST /v1/tasks/:id/actions/execute` | 手动触发 `pending_manual` 任务 | 状态 `pending_manual` → `created` → 立即进入调度 |
| **暂停** | `POST /v1/tasks/:id/actions/pause` | 暂停任务 | 状态改为 `paused`，调度器跳过，直到调用 execute 恢复 |
| **删除** | `DELETE /v1/tasks/:id` | 删除任务 | 任务从 TaskStore 移除，调度器不再感知 |

#### 2.3.2 确认（confirm）行为详解

用户确认是 Flow 暂停后的唯一恢复机制。三种场景：

```
Delete Flow
    → precheck 通过后停泊于 awaiting_user_confirm
    → 用户 confirm → resumePoint = 'delete_executing' → 跳过 precheck，直接执行删除

Transcode Flow
    → precheck DV 确认停泊 → 用户 confirm → resumePoint = 'transcode_executing' → 跳过 DV 检测
    → 压制完成后替换确认停泊 → 用户 confirm → resumePoint = 'transcode_replace' → 跳过 precheck + 压制 + verify

任何 Flow
    → 调度器驱动 → setStatus(awaiting_user_confirm) → 停泊
    → 用户 confirm → setStatus(queued), driving=false → 调度器下次轮询接管
```

#### 2.3.3 任务状态流转图

```
created ──→ queued ──┬──→ awaiting_user_confirm ←── confirm
                     │                                  │
                  precheck ──→ executing ──→ verify ───┘
                     │                      │
                  failed_hard ←──────────────┘
                     ▲
                 （任意阶段出错）
                     │
paused ←──────────────┤
                     │
interrupted ←────────┤ （进程异常退出时由 recoverInterruptedTasks 降级）
                     │
done ←───────────────┤
                     │
deleted ←── DELETE /v1/tasks/:id
```

### §2.2 完整意图链路

```
desktop 意图下发（POST /v1/tasks）
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ API 层（app.js）                                                  │
│ 职责：接收 HTTP 请求、参数校验、调用子模块                            │
│ 关键路径：POST /v1/tasks → taskStore.createTask()                 │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ TaskStore（taskStore.js）                                         │
│ 职责：任务持久化、任务状态读写                                       │
│ 接口：createTask() / updateTask() / getTask() / loadTasks()        │
│ 状态存储：data/tasks.json                                          │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ TaskScheduler（taskScheduler.js）                                  │
│ 职责：轮询调度（5s 间隔）、并发控制、状态机推进触发                    │
│ 接口：driveTask(taskId)                                           │
│ 与 TaskExecutor 的协作：scheduler 每轮检查 concurrency slot，        │
│   有空位时调用 executor.driveTask() 推进 Flow                       │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ TaskExecutor（taskExecutor.js）                                    │
│ 职责：Flow 调度代理（仅路由），无任何业务逻辑                         │
│ 协作模式：                                                         │
│   - 调用 DeleteFlowExecutor / TranscodeFlowExecutor /             │
│     UpgradeFlowExecutor 执行具体 Flow                             │
│   - 承载并发保护状态（runningTasks / _driveCallIds / _appendLock）  │
│   - 承载 recoverInterruptedTasks()                                 │
└─────────────────────────────────────────────────────────────────┘
    │
    ├──→ DeleteFlowExecutor
    │    └──→ EmbyService（services/embyService.js）
    │
    ├──→ TranscodeFlowExecutor
    │    ├──→ EmbyService（services/embyService.js）
    │    └──→ TranscodeService（services/transcodeService.js）
    │
    ├──→ UpgradeFlowExecutor
    │    └──→ （MoviePilot 集成，暂未实现）
    │
    └──→ DoubanService（services/doubanService.js）
         职责：豆瓣 session 管理、评分拉取
         调用方：API 层（/v1/integrations/douban/...）
```

## §3 子模块通信矩阵

| 调用方 ↓ / 被调用方 → | TaskStore | TaskScheduler | TaskExecutor | EmbyService | TranscodeService | DoubanService | ConfigStore |
|---|---|---|---|---|---|---|---|---|
| **API 层** | createTask / getTasks | - | - | getLibraryItem | - | doubanService | loadConfig / patchConfig |
| **TaskScheduler** | loadTasks / updateTask | - | driveTask | - | - | - | loadConfig |
| **TaskExecutor（代理）** | - | - | - | - | - | - | - |
| **DeleteFlowExecutor** | getTask / updateTask | - | - | getLibraryItem / deleteLibraryItem | - | - | loadConfig |
| **TranscodeFlowExecutor** | getTask / updateTask | - | - | getLibraryItem | precheck / startEncode / probeSummary / replaceWithRetries | - | loadConfig |
| **UpgradeFlowExecutor** | getTask / updateTask | - | - | - | - | - | - |
| **EmbyService** | - | - | - | - | - | - | - |
| **TranscodeService** | - | - | - | - | - | - | - |
| **DoubanService** | - | - | - | - | - | - | - |

> 注：所有子模块均通过同步函数调用通信，无消息队列或事件总线。Flow Executors 与 EmbyService / TranscodeService 的详细交互在 `TASK_CENTER.md` 中描述。

## §4 数据持有权

| 数据 | 持有子模块 | 说明 |
|---|---|---|
| 任务队列 | TaskStore | data/tasks.json |
| 配置 | ConfigStore | data/config.json |
| 用户评分 | ratingStore | data/ratings.json |
| 媒体库缓存 | cacheStore | data/cache.json |
| Emby 连接 | ConfigStore + EmbyService | ConfigStore 持有配置，EmbyService 持有连接状态缓存 |
| 转码进度 | TranscodeService（内存） | encodeJobs Map，进程退出后丢失 |

## §5 子模块索引

| 子模块 | 文件 | 状态 |
|---|---|---|
| 胖服务总览 | `SERVICE.md` | 本文 |
| REST API | `SERVICE/API.md` | 待编写 |
| 任务调度引擎 | `SERVICE/TASK_CENTER.md` | 待编写 |
| 健康检查 | `SERVICE/HEALTH_CHECK.md` | 待编写 |
| 配置与路径映射 | `SERVICE/CONFIG.md` | 待编写 |
| Emby 适配器 | `SERVICE/EMBY_INTEGRATION.md` | 待编写 |
| 豆瓣适配器 | `SERVICE/DOUBAN_INTEGRATION.md` | 待编写 |
| 转码执行器 | `SERVICE/TRANSCODER.md` | 待编写 |

## 关联文档

- `ARCH_OVERVIEW.md` — 系统结构总览（组件边界、数据流）
- `SHARED/DATA_FLOW.md` — 意图下发 + 轮询机制（跨组件视角）
- `SHARED/ERROR_HANDLING.md` — 错误码与降级策略
- `SHARED/DATA_MODEL.md` — 核心数据模型
