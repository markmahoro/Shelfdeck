# DESIGN_SERVICE — 胖服务组件总览

> Phase 3（服务执行引擎）为基准架构。
> v4 定稿。

## §1 组件定位

service 是 Phase 3 的胖服务组件，承担所有业务逻辑执行：

- **进程模式**：由 tray-supervisor spawn 为子进程，生命周期与 tray 绑定
- **协议**：仅暴露 HTTP REST API，不做 IPC
- **数据权威**：任务队列、配置、Emby 连接信息均为 service 持有，desktop 只读
- **Web 管理端**：内置 React 管理页面（`/v1/admin/*`），用于 Emby 连接配置、转码设置、任务监控
- **外部集成**：所有外部系统（Emby、豆瓣、MoviePilot）均通过 service 集成，desktop 不直接通信

组件间关系由 `ARCH_OVERVIEW.md` §1（组件边界）和 §3（数据流）描述，本文档仅聚焦 service **内部**子模块的职责和协作。

## §2 子模块职责链路

### §2.1 执行器架构

#### 2.1.1 目标架构

```
EmbyAdapter ──→ library.json（元数据 + watched）
DoubanAdapter ──→ library.json（doubanRating）
desktop 打分 ──→ library.json（userRating）

StrategyEngine ──→ 全量计算 action/reason ──→ library.json
SmartTaskEngine ──→ 扫描 library.json ──→ taskStore.createTask()

TaskScheduler（taskScheduler.js）
    │
    ├── 调度决策：slot 检查、夜间暂停、executionMode
    ├── 路由决策：根据 actionType 分派到对应 Flow
    │
    ├──→ DeleteFlowExecutor（deleteFlowExecutor.js）
    ├──→ TranscodeFlowExecutor（transcodeFlowExecutor.js）
    └──→ UpgradeFlowExecutor（upgradeFlowExecutor.js）
```

**原则**：
- TaskScheduler 承担调度 + 路由两层职责，直接调用 Flow Executors，不经过中间代理层
- StrategyEngine、SmartTaskEngine、EmbyAdapter、DoubanAdapter 均为独立定时模块，各管一层，互不耦合

#### 2.1.2 并发保护

| 共享内容 | 文件位置 | 说明 |
|---|---|---|
| `recoverInterruptedTasks()` | `taskScheduler.js` | 启动时扫描中断任务，统一降级 |
| `runningTasks` / `_driveCallIds` / `_appendLock` | `taskScheduler.js` | 并发保护，Flow 不感知 |

#### 2.1.3 任务状态管理边界

任务状态分为两个正交维度：

**`status`（调度状态）— Scheduler 管理**

- 值：pending_manual | queued | executing | paused | awaiting_user_confirm | interrupted | done | failed_hard
- 含义由调度层定义

**`phase`（Flow 阶段）— 各 Flow Executor 管理**

- 值由各 Flow Executor 自行定义
- 交互规则由各 Flow Executor 与 service.md 约定

**边界规则**：
- Scheduler 只读写 `status`，不读写 `phase`
- Flow Executor 只读写 `phase`，不读写 `status`
- TaskStore 持久化两者
- 交互规则定义在各 Flow Executor 子文档中

#### 2.1.4 各 Flow 执行器职责

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
    ├── precheck：验证 MoviePilot 连接 + item 信息
    ├── planning：调用 moviepilotService 搜索种子，smartSeedSelect 优选种子
    ├── pauseForConfirm：提交前等待用户确认种子选择
    ├── executing：调用 moviepilotService 添加下载任务，轮询进度
    ├── pre_replace_verify：下载+刮削完成后，verify 文件就绪
    ├── replace：路径映射 + 文件转移（MoviePilot transfer）
    └── verify：检查替换是否成功
```

依赖：`moviepilotService`、`smartSeedSelect`、`taskStore`、`configStore`
> MoviePilot 集成已实现，UpgradeFlowExecutor 通过 moviepilotService 调用 MoviePilot REST API 完成搜索、下载、转移全流程。

#### 2.1.5 TaskStore 操作封装（Flow Executor → TaskStore）

每个 Flow Executor 通过封装好的辅助函数操作 TaskStore：

```
executor.setStatus(taskId, status)      → taskStore.updateTask(taskId, { status })
executor.setProgress(taskId, pct)       → taskStore.updateTask(taskId, { progress: pct })
executor.appendLog(taskId, entry)       → 本 Executor 私有 appendLog（独立 seq）
executor.fail(taskId, code, message)   → setStatus + appendLog
```

> flowLog 为各 Executor 私有，seq 各自独立递增，不跨 Flow 排序。

这样 TaskStore 的调用方式集中管控，Flow Executor 只关注业务逻辑。

### §2.2 完整意图链路

#### 任务创建链路（双路径）

**路径 A：手动入队（desktop → service）**

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
TaskStore → TaskScheduler → Flow Executors（同下）
```

**路径 B：自动入队（SmartTaskEngine）**

```
StrategyEngine（定时全量计算）
    │  读 library.json，写 action/reason
    ▼
SmartTaskEngine（定时扫描）
    │  条件: watched=true + 有评分 + action∈{transcode,upgrade,delete} + 无活跃任务
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
│ TaskScheduler（taskScheduler.js）                                   │
│ 职责：调度（slot 检查、夜间暂停）+ 路由（actionType 分派）          │
│ 调度间隔：5s                                                      │
│ 直接调用 Flow Executors，不经中间代理层                            │
└─────────────────────────────────────────────────────────────────┘
    │
    ├──→ DeleteFlowExecutor
    │    └──→ EmbyService（services/embyService.js）
    │
    ├──→ TranscodeFlowExecutor
    │    ├──→ EmbyService（services/embyService.js）
    │    └──→ TranscodeService（services/transcodeService.js）
    │
    └──→ UpgradeFlowExecutor
         └──→ MoviePilotService（services/moviepilotService.js）
```

> 两条路径汇入同一个 TaskStore → TaskScheduler 管道。手动入队由用户主动操作触发，自动入队由 SmartTaskEngine 周期发现触发。

#### 进度轮询链路（桌面 → 服务）

```
desktop 渲染进程
    │ 轮询 GET /v1/tasks（间隔 400ms）
    ▼
service REST API
    └── TaskStore → 返回当前任务列表（含 status、progress、flowState）
```

#### Web 管理端链路

```
用户访问 http://service:18080/
    │
    ▼
service 提供静态 React 管理页面（dist/admin/）
    │
    ▼
管理页面调用 service REST API（/v1/admin/*）管理配置、任务、Emby 连接
```

#### 外部服务集成

| 外部系统 | 集成方式 | 任务执行侧调用方 | 媒体库管理侧调用方 |
|---|---|---|---|
| **Emby** | service → Emby REST API | DeleteFlowExecutor（删除时调用） | MediaLibraryService（定期拉取媒体数据） |
| **豆瓣** | service → 豆瓣 API | — | MediaLibraryService（抓取评分并写入媒体库表） |
| **MoviePilot** | service → MoviePilot REST API | UpgradeFlowExecutor（搜索、下载、转移） | — |

### §2.3 任务生命周期操作

#### 2.3.1 操作总览

| 操作 | REST 端点 | 作用 | TaskScheduler 响应 |
|---|---|---|---|
| **创建** | `POST /v1/tasks` | 创建新任务 | 自动模式：状态 `queued`；手动模式：状态 `pending_manual`（需用户调用 execute 才进入调度） |
| **确认** | `PATCH /v1/tasks/:id` `{ confirmed: true }` | 用户确认后推进 Flow | 解除 `awaiting_user_confirm` 停泊，状态改回 `queued`，下次调度轮询时推进 |
| **执行** | `POST /v1/tasks/:id/actions/execute` | 手动模式用户触发任务 | 状态 `pending_manual` → `created` → 进入调度；其他状态无操作 |
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

### §3 媒体库管理链路（数据层 + 策略层 + 入队层）

v2 架构将 v1 中耦合在 MediaLibraryService 内的策略计算和自动入队拆分为三个独立模块，各管一层：

```
┌─────────────────────────────────────────────────────┐
│ [数据层] MediaLibraryService                         │
│ 职责：library.json CRUD，协调 EmbyAdapter 写入       │
│ 原则：只写原始数据，不计算策略，不创建任务               │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ [策略层] StrategyEngine（定时 30min）                  │
│ 职责：全量扫描 library.json，计算 action/reason 并写回 │
│ 原则：纯函数计算，不依赖外部系统，不感知数据来源          │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ [入队层] SmartTaskEngine（定时 10min）                 │
│ 职责：扫描 library.json，发现符合条件的条目，自动入队    │
│ 原则：只读 library.json + taskStore，只写 taskStore    │
└─────────────────────────────────────────────────────┘
```

#### 3.1 数据层：MediaLibraryService

职责收窄为**纯数据 CRUD**：

- 维护 library.json，对外暴露 `getLibrary()` / `getLibraryItem()` / `upsertItems()` / `saveLibrary()`
- 管理子库配置（CRUD、定时器生命周期）
- 驱动 EmbyAdapter 定时拉取（1h）→ 调 `upsertItems()` 写入元数据 + `watched`
- 驱动 DoubanAdapter 定时同步（6h）→ 直接更新 `doubanRating` 字段
- 处理用户评分写入（`updateUserRating`）→ 只写 `userRating`，不重算策略

**明确不负责**：
- 不计算 `action` / `reason`（交给 StrategyEngine）
- 不做 diff 检测触发策略重算（StrategyEngine 全量算）
- 不创建任务（交给 SmartTaskEngine）

#### 3.2 策略层：StrategyEngine

见 `SERVICE/STRATEGY_ENGINE.md`。

#### 3.3 入队层：SmartTaskEngine

见 `SERVICE/SMART_TASK_ENGINE.md`。

#### 3.4 数据流（端到端）

```
EmbyAdapter (1h) ──→ upsertItems() ──→ library.json (name, bitrate, watched...)
DoubanAdapter (6h) ──→ 写 rating ──→ library.json (doubanRating)
desktop 打分 ──→ PATCH /v1/library/ratings ──→ library.json (userRating)
desktop 已看 ──→ POST mark-played ──→ Emby API + 反查 upsertItems ──→ library.json (watched)

StrategyEngine (30min) ──→ 全量重算 ──→ library.json (action, reason)
SmartTaskEngine (10min) ──→ 扫描 + 条件判定 ──→ taskStore.createTask()
TaskScheduler (5s) ──→ 调度 + 执行
```

#### 3.5 REST 端点

| 端点 | 方向 | 说明 |
|---|---|---|
| `POST /v1/library/cache` | EmbyService → Service | 批量写入 Emby 媒体数据（元数据 + watched） |
| `PATCH /v1/library/ratings` | Desktop → Service | 写入用户评分（只写字段，不重算策略） |
| `POST /v1/library/actions/mark-played` | Desktop → Service | 标记已看 → Emby API + 单条反查 → upsertItems |
| `GET /v1/library/queries/manage` | Service → Desktop | 返回媒体库数据（含 StrategyEngine 算好的 action/reason） |

#### 3.6 详细设计

- 数据模型与字段定义：`SERVICE/MEDIA_LIBRARY.md`
- 策略引擎：`SERVICE/STRATEGY_ENGINE.md`
- 智能入队引擎：`SERVICE/SMART_TASK_ENGINE.md`

---

## §4 子模块通信矩阵

| 调用方 ↓ / 被调用方 → | TaskStore | EmbyService | TranscodeService | ConfigStore | MediaLibraryService | StrategyEngine | SmartTaskEngine | DeleteFlowExecutor | TranscodeFlowExecutor | UpgradeFlowExecutor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **API 层** | createTask / getTasks | getLibraryItem | - | loadConfig / patchConfig | getLibrary / updateRatings / upsertItems | - | - | - | - | - |
| **TaskScheduler** | loadTasks / updateTask | - | - | loadConfig | - | - | - | driveTask | driveTask | driveTask |
| **StrategyEngine** | - | - | - | loadConfig | getLibrary / saveLibrary | - | - | - | - | - |
| **SmartTaskEngine** | createTask / getTasks | - | - | loadConfig | getLibrary | - | - | - | - | - |
| **DeleteFlowExecutor** | getTask / updateTask | getLibraryItem / deleteLibraryItem | - | loadConfig | - | - | - | - | - | - |
| **TranscodeFlowExecutor** | getTask / updateTask | getLibraryItem | precheck / startEncode / probeSummary / replaceWithRetries | loadConfig | - | - | - | - | - | - |
| **UpgradeFlowExecutor** | getTask / updateTask | - | - | loadConfig | - | - | - | - | - | - |
| **MediaLibraryService** | - | - | - | loadConfig | - | - | - | - | - | - |

> 注：所有子模块均通过同步函数调用通信，无消息队列或事件总线。Flow Executors 与 EmbyService / TranscodeService 的详细交互在 `SERVICE/TASK_SCHEDULER.md` 和各 Flow 文档中描述。DoubanService 仅被 MediaLibraryService 的内部定时器调用，不在此矩阵中体现。

---

## §5 数据持有权

| 数据 | 持有 / 写入模块 | 说明 |
|---|---|---|
| 任务队列 | TaskStore | data/tasks.json |
| 配置 | ConfigStore | data/config.json |
| 媒体库元数据（name, bitrate, watched...） | MediaLibraryService（协调）+ EmbyAdapter（拉取） | data/library.json |
| 媒体库策略字段（action, reason） | StrategyEngine | data/library.json（仅写 action/reason，不改其他字段） |
| Emby 连接 | ConfigStore + EmbyService | ConfigStore 持有配置，EmbyService 持有连接状态缓存 |
| 转码进度 | TranscodeService（内存） | encodeJobs Map，进程退出后丢失 |

---

## §6 子模块索引

| 子模块 | 文件 | 状态 |
|---|---|---|
| 胖服务总览 | `SERVICE.md` | 本文 |
| REST API | `SERVICE/API.md` | 待编写 |
| 任务调度引擎 | `SERVICE/TASK_SCHEDULER.md` | v2 重写中 |
| Delete Flow 执行器 | `SERVICE/DELETE_FLOW.md` | v2 重写中 |
| Transcode Flow 执行器 | `SERVICE/TRANSCODE_FLOW.md` | v2 重写中 |
| Upgrade Flow 执行器 | `SERVICE/UPGRADE_FLOW.md` | v2 重写中 |
| 转码执行层 | `SERVICE/TRANSCODE.md` | v2 重写中 |
| 媒体库管理 | `SERVICE/MEDIA_LIBRARY.md` | v2 重写中 |
| Emby 适配器 | `SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER.md` | v4 定稿 |
| 豆瓣适配器 | `SERVICE/MEDIA_LIBRARY/DOUBAN_ADAPTER.md` | v4 定稿 |
| 策略计算引擎 | `SERVICE/STRATEGY_ENGINE.md` | v2 设计中 |
| 智能入队引擎 | `SERVICE/SMART_TASK_ENGINE.md` | v2 设计中 |
| 健康检查 | `SERVICE/HEALTH_CHECK.md` | v2 重写中 |
| 配置与路径映射 | `SERVICE/CONFIG.md` | v2 定稿 |
| Web 管理端 | `SERVICE/ADMIN_WEB.md` | v2 定稿 |
| Admin API | `SERVICE/ADMIN_WEB/API.md` | v2 定稿 |
| Admin 页面 | `SERVICE/ADMIN_WEB/PAGES.md` | v2 定稿 |

## 关联文档

- `ARCH_OVERVIEW.md` — 系统结构总览（组件边界、数据流）
- `SHARED/DATA_FLOW.md` — 意图下发 + 轮询机制（跨组件视角）
- `SHARED/ERROR_HANDLING.md` — 错误码与降级策略
- `SHARED/DATA_MODEL.md` — 核心数据模型
