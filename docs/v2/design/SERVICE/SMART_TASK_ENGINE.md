# SMART_TASK_ENGINE — 智能入队引擎

> 版本：4.0
> 状态：v4 定稿

---

## §1 定位

SmartTaskEngine 是一个独立定时任务，负责从 media library 中发现"应该被处理但尚未入队"的条目，自动创建任务送入 TaskScheduler。

**一句话**：感知用户已看 + 已打分 → 策略推荐动作 → 自动入队。

```
EmbyAdapter ──→ library.json (元数据 + watched)
DoubanAdapter ──→ library.json (doubanRating)
desktop 打分 ──→ library.json (userRating)
StrategyEngine ──→ library.json (action, reason, targetBitrate...)

SmartTaskEngine ──→ 扫描 library.json ──→ taskStore.createTask() ──→ TaskScheduler
```

与 TaskScheduler 的关系：

| | SmartTaskEngine | TaskScheduler |
|---|---|---|
| 职责 | **发现**该做什么，自动创建任务 | **执行**已存在的任务 |
| 输入 | library.json（全表） | taskStore（任务队列） |
| 输出 | taskStore.createTask() | Flow Executor 状态推进 |
| 时机 | 定时轮询（默认 10min） | 5s 轮询 |

---

## §2 扫描条件

对 library.json 每条 item，全部满足以下条件才入队：

```
入队条件 (AND):
  ├── source === 'emby'                            ← 仅 Emby 来源
  ├── watched === true                             ← 用户已看（Emby SSOT）
  ├── userRating != null || doubanRating != null   ← 有评分
  ├── action ∈ smartTaskEnabledActions             ← 策略推荐处理且在允许列表中（默认 transcode, upgrade）
  ├── reason !== '新入库'                          ← 策略引擎尚未处理（跳过）
  ├── 该 itemId 无活跃任务                          ← 防止重复（排除 done/failed_hard/deleted）
  ├── resolveSubLibSchedule(item).autoCreate       ← per-subLibrary 开关
  ├── lastTaskDoneAt 距今 > 48h                    ← 冷却期（等待 Emby 刷新元数据后重新评估）
  └── 首次/恢复运行：MAX(userRatingUpdatedAt, doubanRatingUpdatedAt) 在 lookbackDays 内
```

**不满足任何一条则跳过，下次周期重新评估。**

### 2.1 为什么不用 playback-log

`watched` 由 markPlayed 反查 Emby 后写入 library.json（见 §4 数据流前提），已覆盖 desktop 本地操作路径。playback-log 是操作审计日志，不参与引擎判断。

### 2.2 为什么需要 source === 'emby'

library 表可能包含非 Emby 来源的条目（手动导入等），这些条目的 `watched` 语义不同，暂不纳入自动入队范围。

### 2.3 48h 冷却期

任务完成（done/failed_hard）后，scheduler.reportStatus() 自动写 `lastTaskDoneAt` 到 library.json。SmartTaskEngine 检查此字段，确保 Emby 有足够时间刷新元数据后再重新评估该条目。

### 2.4 首次/恢复运行回看窗口

引擎启动后第一个周期（或停运超过 2× 轮询间隔后的恢复运行），只处理最近 `smartTaskLookbackDays` 天内有评分变化的条目，避免把几年前的老数据全部入队。

---

## §3 执行周期

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `smartTaskPollIntervalMinutes` | 10 | 轮询间隔（分钟） |
| `smartTaskMaxPerRun` | 10 | 每次最多创建任务数 |
| `smartTaskEnabledActions` | `["transcode", "upgrade"]` | 允许自动入队的 action 类型（默认排除 delete） |
| `smartTaskLookbackDays` | 30 | 首次/恢复运行的回看天数 |

### 3.1 最大创建数

防止首次启用或长时间停运后一次性爆发式入队。超出限制的候选条目留在下个周期处理。

**优先级排序**：取 `MAX(userRatingUpdatedAt, doubanRatingUpdatedAt)` 降序——无论评分来自本地还是豆瓣，以较晚的那个时间戳作为"评分可用时间"，最近获得评分的条目优先入队。两个字段均为 null 的条目排最后。

### 3.2 首次运行

引擎启动后延迟 5s（让 StrategyEngine 完成首轮同步计算），然后执行首次扫描。首次或恢复运行时仅处理 `lookbackDays` 窗口内的条目。

停运判断：`lastRunAt` 距当前 > 2× 轮询间隔。

### 3.3 Per-action 队列上限

每种 action type 有队列上限 = `concurrency × 5`（如 transcode concurrency=2 → 上限 10 个）。超过上限的 action type 跳过不入队，防止单一类型占满队列。

---

## §4 数据流前提

SmartTaskEngine 依赖 library.json 作为已看/评分/策略的唯一读取源。这要求以下流程已就位：

1. **markPlayed 反查 Emby 后更新 library.json**：`POST /v1/library/actions/mark-played`
   - 调 Emby API 标记已看
   - 调 `GET /Items/{id}?Fields=UserData` 单条反查
   - `upsertItems(subLibraryId, [fetchedItem])` → watched 写入 library.json

2. **StrategyEngine 独立于 EmbyAdapter**：策略计算是独立的定时周期，不对 EmbyAdapter/DoubanAdapter/评分端点产生耦合。

3. **desktop 打分直接写 userRating**：`PATCH /v1/library/ratings` 只更新字段，不触发策略重算（交给 StrategyEngine）。

---

## §5 执行流程

```
服务启动:
  StrategyEngine.runOnce() 同步执行
  SmartTaskEngine 延迟 5s → 首次 run()

每个周期:
  cfg = configStore.loadConfig()
  lib = mediaLibraryService.getLibrary()          ← 全量读
  allTasks = taskStore.getTasks()
  activeItemIds = allTasks
    .filter(t => !['done','failed_hard','deleted'].includes(t.status))
    .map(t => t.itemId)

  // 统计每种 action type 的活跃任务数
  activeByType = count by actionType

  // 每种 action 的队列上限 = concurrency × 5
  limits = { delete: deleteConcurrency*5, transcode: transcodeConcurrency*5, upgrade: upgradeConcurrency*5 }

  candidates = lib.items.filter(item =>
    source === 'emby'
    && watched === true
    && (userRating 或 doubanRating 非空)
    && action ∈ enabledActions
    && reason !== '新入库'
    && !activeItemIds.has(item.itemId)
    && resolveSubLibSchedule(item).autoCreate
    && lastTaskDoneAt 距今 > 48h
    && (非首次/恢复运行 或 评分在 lookbackDays 内)
  )

  candidates.sort by MAX(userRatingUpdatedAt, doubanRatingUpdatedAt) DESC

  for each in candidates:
    if toEnqueue.length >= maxPerRun: break
    if activeByType[item.action] >= limits[item.action]: continue

    subLibSchedule = resolveSubLibSchedule(item)
    status = subLibSchedule.autoExecute ? 'queued' : 'pending_manual'

    taskStore.createTask({
      itemId, itemName, actionType, status,
      itemInfo: { name, path, subLibraryId, resolution, bitrate, size,
                  duration, type, doubanRating, userRating,
                  targetBitrate, targetCodec, seedPreferences,
                  maxSizeGB, equivalentBitrate },
      logs: [{ ts, source: 'smart_task_engine', action: 'auto_enqueued' }]
    })

    activeByType[item.action]++
    toEnqueue.push(item)
```

### 5.1 日志

创建任务时写 `task.logs`：

```json
{ "ts": "2026-04-28T...", "source": "smart_task_engine", "action": "auto_enqueued" }
```

入队完成后写 activity log：
```
智能入队：3 个任务已自动创建（码率压缩 2 个，洗版 1 个）
```

---

## §6 配置项汇总

| 字段 | 类型 | 默认值 | 所属域 | 说明 |
|---|---|---|---|---|
| `smartTaskPollIntervalMinutes` | number | `10` | 轮询间隔 | 分钟 |
| `smartTaskMaxPerRun` | number | `10` | 每周期最大创建数 | 防止爆发式入队 |
| `smartTaskEnabledActions` | string[] | `["transcode","upgrade"]` | 允许自动入队的 action | 默认排除 delete |
| `smartTaskLookbackDays` | number | `30` | 首次/恢复运行的回看天数 | 避免老数据入队 |

**Per-subLibrary 控制**（见 `CONFIG.md`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `scheduleMode.autoCreate` | boolean | 该子库是否允许自动创建任务（替代旧全局 `wallRatingAutoEnqueue`） |

> 所有字段定义在 `data/config.json`，由 ConfigStore 管理。详细字段语义见 `SERVICE/CONFIG.md`。

---

## §7 状态模型

SmartTaskEngine 本身无状态（`lastRunAt` 为模块内存变量）。所有决策依赖 library.json + taskStore，可随时重启不丢进度。

---

## §8 与其他模块的接口

| 方向 | 调用 | 说明 |
|---|---|---|
| 入 | `configStore.loadConfig()` | 读取参数 + resolveSubLibSchedule() |
| 入 | `mediaLibraryService.getLibrary()` | 全量读取 library 表 |
| 入 | `taskStore.getTasks()` | 获取活跃任务 itemId 集合 |
| 出 | `taskStore.createTask(data)` | 创建任务（含完整 itemInfo），供 TaskScheduler 调度 |
| 出 | `activityLog.addActivity()` | 写入队汇总日志 |

---

## §9 关联文档

- `SERVICE/MEDIA_LIBRARY.md` — library.json 数据模型
- `SERVICE/TASK_SCHEDULER.md` — 任务调度引擎
- `SERVICE/CONFIG.md` — 配置字段定义（scheduleMode.autoCreate）
- `SERVICE/STRATEGY_ENGINE.md` — 策略计算引擎（上游，先于本引擎运行）
