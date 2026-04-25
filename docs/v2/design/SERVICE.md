# DESIGN_SERVICE — 胖服务组件总览

> Phase 3（服务执行引擎）为基准架构。
> 状态：v2 重写中

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

### §2.2 完整意图链路

#### 任务创建链路

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
    └──→ UpgradeFlowExecutor
         └──→ （MoviePilot 集成，暂未实现）
```

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

| 外部系统 | 集成方式 | service 内部调用方 |
|---|---|---|
| **Emby** | service → Emby REST API | EmbyService（embyService.js） |
| **豆瓣** | service → 豆瓣 API | DoubanService（doubanService.js）：session 管理、评分同步 |
| **MoviePilot** | service → MoviePilot REST API | UpgradeFlowExecutor（未来实现） |

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

### §3 媒体库管理链路（MediaLibraryService）

MediaLibraryService 维护统一的媒体库持久化表，所有媒体数据、豆瓣评分、用户评分均存在该表中。

#### 3.1 模块职责

- 维护统一的媒体库持久化表（`data/library.json`）
- 定期从 Emby 拉取媒体数据并更新表
- 写入 Douban 评分和用户评分
- 计算每个媒体项的策略建议（delete / transcode / upgrade / keep）
- 提供媒体库展示所需的全部字段给 desktop

#### 3.2 数据写入

```
EmbyService 定期拉取媒体数据 → 写入媒体库表
DoubanService 抓取豆瓣评分   → 写入媒体库表
用户打分                     → desktop → PATCH /v1/library/ratings → 写入媒体库表
```

#### 3.3 策略计算

```
GET /v1/library/queries/manage
    ↓
MediaLibraryService 读取媒体库表
    ↓
effectiveRating = doubanRating 非空 ? doubanRating : userRating 非空 ? userRating : null
    ↓
按 mediaPolicy 计算策略建议（delete / transcode / upgrade / keep）
    ↓
返回完整媒体库数据 → desktop 展示
```

#### 3.4 链路图

```
┌─────────────────────────────────────────────────────┐
│ EmbyService                                          │
│ 定期拉取媒体库数据 → 写入媒体库表                       │
└─────────────────────────────────────────────────────┘
    │
┌─────────────────────────────────────────────────────┐
│ DoubanService                                        │
│ 抓取豆瓣评分 → 写入媒体库表                            │
└─────────────────────────────────────────────────────┘
    │
┌─────────────────────────────────────────────────────┐
│ MediaLibraryService                                   │
│ 维护统一的媒体库持久化表（data/library.json）          │
│ - Emby 数据写入                                      │
│ - Douban 评分写入                                    │
│ - 用户评分写入（PATCH /v1/library/ratings）           │
│ - 策略计算                                          │
└─────────────────────────────────────────────────────┘
    │
    ↓
desktop GET /v1/library/queries/manage
    ↓
返回展示数据（含策略建议）
```

#### 3.5 REST 端点

| 端点 | 方向 | 说明 |
|---|---|---|
| `POST /v1/library/cache` | EmbyService → Service | 批量写入 Emby 媒体数据到媒体库表 |
| `GET /v1/integrations/douban/fetch/ratings` | DoubanService → Service | 抓取豆瓣评分并写入媒体库表 |
| `PATCH /v1/library/ratings` | Desktop → Service | 写入用户评分到媒体库表 |
| `GET /v1/library/queries/manage` | Service → Desktop | 返回媒体库数据（含策略建议） |

#### 3.6 详细设计

媒体库表字段定义及详细行为见 `SERVICE/MEDIA_LIBRARY.md`。

## §4 子模块通信矩阵

| 调用方 ↓ / 被调用方 → | TaskStore | TaskScheduler | TaskExecutor | EmbyService | TranscodeService | DoubanService | ConfigStore | MediaLibraryService |
|---|---|---|---|---|---|---|---|---|---|
| **API 层** | createTask / getTasks | - | - | getLibraryItem | - | doubanService | loadConfig / patchConfig | getLibrary / updateRatings |
| **TaskScheduler** | loadTasks / updateTask | - | driveTask | - | - | - | loadConfig | - |
| **TaskExecutor（代理）** | - | - | - | - | - | - | - | - |
| **DeleteFlowExecutor** | getTask / updateTask | - | - | getLibraryItem / deleteLibraryItem | - | - | loadConfig | - |
| **TranscodeFlowExecutor** | getTask / updateTask | - | - | getLibraryItem | precheck / startEncode / probeSummary / replaceWithRetries | - | loadConfig | - |
| **UpgradeFlowExecutor** | getTask / updateTask | - | - | - | - | - | - | - |
| **MediaLibraryService** | - | - | - | - | - | - | - | - |
| **EmbyService** | - | - | - | - | - | - | - | - |
| **TranscodeService** | - | - | - | - | - | - | - | - |
| **DoubanService** | - | - | - | - | - | - | - | - |

> 注：所有子模块均通过同步函数调用通信，无消息队列或事件总线。Flow Executors 与 EmbyService / TranscodeService 的详细交互在 `TASK_CENTER.md` 中描述。

## §5 数据持有权

| 数据 | 持有子模块 | 说明 |
|---|---|---|
| 任务队列 | TaskStore | data/tasks.json |
| 配置 | ConfigStore | data/config.json |
| 媒体库表 | MediaLibraryService | data/library.json（统一媒体库表，含 Emby 数据、豆瓣评分、用户评分） |
| Emby 连接 | ConfigStore + EmbyService | ConfigStore 持有配置，EmbyService 持有连接状态缓存 |
| 转码进度 | TranscodeService（内存） | encodeJobs Map，进程退出后丢失 |

## §6 子模块索引

| 子模块 | 文件 | 状态 |
|---|---|---|
| 胖服务总览 | `SERVICE.md` | 本文 |
| REST API | `SERVICE/API.md` | 待编写 |
| 任务调度引擎 | `SERVICE/TASK_CENTER.md` | 待编写 |
| 媒体库管理 | `SERVICE/MEDIA_LIBRARY.md` | 待编写 |
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
