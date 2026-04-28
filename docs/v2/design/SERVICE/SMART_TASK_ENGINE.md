# SMART_TASK_ENGINE — 智能入队引擎

> 版本：2.0
> 状态：设计阶段，待实现

---

## §1 定位

SmartTaskEngine 是一个独立定时任务，负责从 media library 中发现"应该被处理但尚未入队"的条目，自动创建任务送入 TaskScheduler。

**一句话**：感知用户已看 + 已打分 → 策略推荐动作 → 自动入队。

```
EmbyAdapter ──→ library.json (元数据 + watched)
DoubanAdapter ──→ library.json (doubanRating)
desktop 打分 ──→ library.json (userRating)
StrategyEngine ──→ library.json (action, reason)

SmartTaskEngine ──→ 扫描 library.json ──→ taskStore.createTask() ──→ TaskScheduler
```

与 TaskScheduler 的关系：

| | SmartTaskEngine | TaskScheduler |
|---|---|---|
| 职责 | **发现**该做什么，自动创建任务 | **执行**已存在的任务 |
| 输入 | library.json（全表） | taskStore（任务队列） |
| 输出 | taskStore.createTask() | Flow Executor 状态推进 |
| 时机 | 定时轮询 | 5s 轮询 |

---

## §2 扫描条件

对 library.json 每条 item 判定：

```
入队条件 (AND):
  ├── watched === true                          ← 用户已看（Emby SSOT）
  ├── (userRating != null || doubanRating != null)  ← 有评分
  ├── action ∈ { transcode, upgrade, delete }      ← 策略推荐处理
  ├── 该 itemId 无活跃任务                          ← 防止重复
  └── item.source === 'emby'                        ← 仅 Emby 来源
```

**不满足任何一条则跳过，下次周期重新评估。**

### 2.1 为什么不用 playback-log

`watched` 由 markPlayed 反查 Emby 后写入 library.json（见 §4 数据流前提），已覆盖 desktop 本地操作路径。playback-log 是操作审计日志，不参与引擎判断。

### 2.2 为什么需要 source === 'emby'

library 表可能包含非 Emby 来源的条目（手动导入等），这些条目的 `watched` 语义不同，暂不纳入自动入队范围。

---

## §3 执行周期

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `smartTaskPollIntervalMinutes` | 10 | 轮询间隔（分钟） |
| `smartTaskMaxPerRun` | 10 | 每次最多创建任务数 |
| `smartTaskEnabledActions` | `["transcode", "upgrade"]` | 允许自动入队的 action 类型（默认排除 delete） |

### 3.1 最大创建数

防止首次启用或长时间停运后一次性爆发式入队。超出限制的候选条目留在下个周期处理。

**优先级排序**：取 `MAX(userRatingUpdatedAt, doubanRatingUpdatedAt)` 降序——无论评分来自本地还是豆瓣，以较晚的那个时间戳作为"评分可用时间"，最近获得评分的条目优先入队。两个字段均为 null 的条目排最后。

### 3.2 首次运行

引擎启动后第一个周期计算"距离上次评分 ≤ 30 天"的条目（`MAX(userRatingUpdatedAt, doubanRatingUpdatedAt)`），避免把几年前的老数据全部入队。此窗口可配置：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `smartTaskLookbackDays` | 30 | 首次运行或长时间停运后，只看最近 N 天内有变化的条目 |

停运判断：`lastRunAt` 距当前 > 2× 轮询间隔。

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
每个周期:
  cfg = configStore.loadConfig()
  if (!cfg.wallRatingAutoEnqueue) return     ← 总开关

  lib = mediaLibraryService.getLibrary()      ← 全量读
  activeItemIds = taskStore.getTasks()         ← 活跃任务 itemId 集合
    .filter(t => !['done','failed_hard'].includes(t.status))
    .map(t => t.itemId)

  candidates = lib.items.filter(item =>
    item.source === 'emby'
    && item.watched === true
    && (item.userRating != null || item.doubanRating != null)
    && item.action !== 'keep' && item.action !== null
    && item.reason !== '新入库'           ← 策略尚未计算
    && !activeItemIds.has(item.itemId)
    && inLookbackWindow(item)
  )

  candidates.sort by MAX(userRatingUpdatedAt, doubanRatingUpdatedAt) DESC
  for each in candidates.take(smartTaskMaxPerRun):
    taskStore.createTask({
      itemId:    item.itemId,
      itemName:  item.name,
      actionType: item.action,          ← transcode | upgrade (delete 需额外开关)
      status:    cfg.executionMode === 'manual' ? 'pending_manual' : 'queued',
    })
    log: [SmartTaskEngine] auto-enqueue {itemId} {actionType}

  cfg.smartTaskLastRunAt = now
```

### 5.1 日志

创建任务时写 `task.logs`：

```json
{ "ts": "2026-04-28T...", "source": "smart_task_engine", "action": "auto_enqueued" }
```

---

## §6 配置项汇总

| 字段 | 类型 | 默认值 | 所属域 |
|---|---|---|---|
| `wallRatingAutoEnqueue` | boolean | `false` | 总开关 |
| `smartTaskPollIntervalMinutes` | number | `10` | 轮询间隔 |
| `smartTaskMaxPerRun` | number | `10` | 每周期最大创建数 |
| `smartTaskEnabledActions` | string[] | `["transcode","upgrade"]` | 允许自动入队的 action |
| `smartTaskLookbackDays` | number | `30` | 首次/恢复运行的回看天数 |

> 所有字段定义在 `data/config.json`，由 ConfigStore 管理。详细字段语义见 `SERVICE/CONFIG.md`。

---

## §7 状态模型

SmartTaskEngine 本身无状态，不持久化自己的运行记录（运行时间写入 config 的 `smartTaskLastRunAt`）。所有决策依赖 library.json + taskStore，可随时重启不丢进度。

---

## §8 与其他模块的接口

| 方向 | 调用 | 说明 |
|---|---|---|
| 入 | `configStore.loadConfig()` | 读取开关和参数 |
| 入 | `mediaLibraryService.getLibrary()` | 全量读取 library 表 |
| 入 | `taskStore.getTasks()` | 获取活跃任务 itemId 集合 |
| 出 | `taskStore.createTask(data)` | 创建任务，供 TaskScheduler 调度 |

---

## §9 关联文档

- `SERVICE/MEDIA_LIBRARY.md` — library.json 数据模型
- `SERVICE/TASK_SCHEDULER.md` — 任务调度引擎
- `SERVICE/CONFIG.md` — 配置字段定义
- `SERVICE/STRATEGY_ENGINE.md` — 策略计算引擎（待编写）
