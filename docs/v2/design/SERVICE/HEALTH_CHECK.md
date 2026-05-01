# DESIGN_SERVICE/HEALTH_CHECK — 服务健康检查

> Phase 4 为基准架构，v4 定稿。
> SSOT：本文是健康检查可执行行为的唯一事实来源。

---

## §1 职责定位

健康检查模块负责对外暴露 service 整体运行状态，供 desktop、tray、admin_web 三方消费。

| 消费方 | 端点 | 用途 |
|---|---|---|
| desktop | `GET /v1/health` | 门禁逻辑：连接前检查 service 是否可用 |
| tray | `GET /v1/health` | 托盘灯状态 |
| admin_web | `GET /v1/admin/health` | 仪表盘健康卡片 + 详情诊断 |

---

## §2 检查项

### 2.1 状态约定

- **green**: 正常（含"未配置/未启用"等合理不需要工作的状态——功能主动不使用，不是故障）
- **yellow**: 降级或短暂过渡状态（部分不可用 / 等待首次运行 / 部分子库超时）
- **red**: 已启用但不可用（配置了但跑不了）

### 2.2 八项检查总览

| # | 检查项 | 对应模块 | Green | Yellow | Red |
|---|--------|---------|-------|--------|-----|
| 1 | 任务调度器 | `taskScheduler` | 轮询循环运行中 | — | 已停止／异常退出 |
| 2 | 智能入队 | `smartTaskEngine` | 运行中；或未启用（enabled=false） | 已启用但 `lastRunAt` 为空（等待首次运行） | 已启用但定时器未运行 |
| 3 | 媒体库刷新 | `mediaLibraryService` | 全部启用子库在 `defaultRefreshIntervalMinutes * 2` 内刷新；或无任何子库启用 | 部分启用子库超时 | 全部启用子库超时；或 library.json 不可读/损坏 |
| 4 | 豆瓣评分抓取 | `doubanService` | 会话有效；或无任何子库启用豆瓣 | — | 存在子库启用豆瓣但会话无效 |
| 5 | 策略引擎 | `strategyEngine` | 定时器运行中，且最近一次运行成功 | 定时器运行中但尚未运行过一次 | 定时器未运行 |
| 6 | Emby 连接 | `embyService` | 全部已配置服务器 `GET /System/Info` 在 2s 内返回 200；或零服务器配置（green，主动不用非故障） | 部分服务器响应慢／不可达 | 全部服务器不可达 |
| 7 | 洗版服务 | `moviepilotService` | 无任何子库启用智能洗版（未配置）；或 MoviePilot API 连通且暂存路径可写 | — | 存在子库启用智能洗版，但 MoviePilot 不可达或暂存路径不可写 |
| 8 | 转码服务 | `transcodeService` | ffmpeg 可执行 + 至少一个设备在池 + transcodeTempRoot 可写 | 未配置任何编码设备 | ffmpeg 不可用；或 transcodeTempRoot 不可写 |

### 2.3 各检查项详细定义

#### 1. 任务调度器

- **对应模块**: `taskScheduler` → 通过 `setSchedulerState()` 推送上报警状态（push 模型，非 pull）
- **green**: `schedulerRunning === true`
- **red**: `schedulerRunning === false`
- **返回字段**: `status`, `runningTasks`

#### 2. 智能入队

- **对应模块**: `smartTaskEngine` → 导出 `getHealth()`
- **green**: 定时器运行中且最近一次扫描成功；或 `_enabled === false`（未启用）
- **yellow**: 已启用但 `lastRunAt` 为空（尚未运行过一次）
- **red**: 已启用但定时器未运行
- **启用判定**：per-subLibrary `scheduleMode.autoCreate`，非旧全局 `wallRatingAutoEnqueue`
- **返回字段**: `status`, `enabled`, `lastRunAt`

#### 3. 媒体库刷新

- **对应模块**: `mediaLibraryService` → 导出 `getHealth()`
- **green**: 无任何子库 `enabled === true`；或所有启用子库在 `defaultRefreshIntervalMinutes * 2` 以内
- **yellow**: 部分启用子库超时
- **red**: 全部启用子库超时；或 library.json 不可读/损坏
- **返回字段**: `status`, `totalSubLibraries`, `enabledCount`, `staleSubLibraries[]`

#### 4. 豆瓣评分抓取

- **对应模块**: `doubanService` → 导出 `getHealth(config)`
- **green**: 无任何子库启用 `doubanEnabled`；或会话有效
- **red**: 存在子库启用 `doubanEnabled` 但会话无效
- **返回字段**: `status`, `hasSession`, `doubanEnabledSubLibCount`

#### 5. 策略引擎

- **对应模块**: `strategyEngine` → 导出 `getHealth()`
- **green**: 定时器运行中，且最近一次运行成功
- **yellow**: 定时器运行中但 `lastRunAt` 为空（尚未运行过一次）
- **red**: 定时器未运行
- **返回字段**: `status`, `lastRunAt`, `lastChanged`

#### 6. Emby 连接

- **对应模块**: `embyService` → `checkEmby(servers)`
- **green**: 所有已配置 Emby 服务器 `GET /System/Info` 在 2s 内返回 200；**零服务器也返回 green**（主动不配置不是故障）
- **yellow**: 部分服务器响应延迟 > 2s，或部分不可达
- **red**: 全部已配置服务器不可达，或任一返回 401
- **返回字段**: `status`, `message?`

#### 7. 洗版服务

- **对应模块**: `moviepilotService` → 导出 `getHealth(config)`
- **green**: 无任何子库启用智能洗版（未配置）；或 MoviePilot `checkConnection()` 返回 ok 且 `upgradeStagingLocalPath` 路径存在且可写
- **red**: 存在子库启用智能洗版，但 MoviePilot 不可达或暂存路径不可写
- **返回字段**: `status`, `smartSelectEnabled`, `message?`

#### 8. 转码服务

- **对应模块**: `transcodeService` → 导出 `getHealth(config)`
- **green**: ffmpeg 二进制可执行 + `transcodeTempRoot` 路径存在且可写 + 至少一个 `inPool === true` 的设备
- **yellow**: ffmpeg 可用 + transcodeTempRoot 可写，但无任何 `inPool === true` 的设备（未配置）
- **red**: ffmpeg 不可用；或 transcodeTempRoot 不可写
- **返回字段**: `status`, `ffmpegOk`, `deviceCount`, `message?`

---

## §3 聚合规则

### 3.1 三级聚合

```
green  = 所有检查项均为 green
yellow = 至少一项 yellow，无 red
red    = 至少一项 red
```

---

## §4 REST API

### 4.1 GET /v1/health

公开端点，无需认证。仅返回聚合状态。

**响应**：

```json
{
  "status": "green",
  "timestamp": "2026-04-26T10:00:00.000Z"
}
```

### 4.2 GET /v1/admin/health

Admin 专属端点，返回完整检查详情。

**响应**：

```json
{
  "status": "yellow",
  "checks": {
    "scheduler":   { "status": "green", "runningTasks": 2 },
    "smartTask":   { "status": "yellow", "enabled": true },
    "mediaLib":    { "status": "green", "totalSubLibraries": 3, "enabledCount": 3 },
    "douban":      { "status": "green", "hasSession": false, "doubanEnabledSubLibCount": 0 },
    "strategy":    { "status": "green", "lastRunAt": "2026-04-26T09:58:00.000Z", "lastChanged": 5 },
    "emby":        { "status": "green" },
    "upgrade":     { "status": "green", "smartSelectEnabled": false },
    "transcode":   { "status": "green", "ffmpegOk": true, "deviceCount": 2 }
  },
  "timestamp": "2026-04-26T10:00:00.000Z"
}
```

---

## §5 与子模块的集成

每个运行态模块通过导出 `getHealth()` 或对应的 health 上报函数参与健康检查：

```
healthCheck (中心聚合，每 30s 定时)
  ├── taskScheduler.setSchedulerState() 上报   → scheduler（push 模型）
  ├── smartTaskEngine.getHealth()              → smartTask
  ├── mediaLibraryService.getHealth(config)    → mediaLib
  ├── doubanService.getHealth(config)          → douban
  ├── strategyEngine.getHealth()               → strategy
  ├── checkEmby(servers)                       → emby
  ├── moviepilotService.getHealth(config)      → upgrade
  └── transcodeService.getHealth(config)       → transcode
```

- **启动时**：service 启动后立即执行一次完整检查
- **定时**：每 30s 执行一次（与 TaskScheduler 5s 调度间隔解耦）
- **按需**：每次请求时返回最近一次定时结果（30s 粒度）

---

## §6 关联文档

- `SERVICE.md` — 胖服务组件总览
- `SERVICE/TASK_SCHEDULER.md` — Scheduler 状态上报
- `SERVICE/CONFIG.md` — 配置字段定义
- `SERVICE/ADMIN_WEB/API.md` — `GET /v1/admin/health` 端点契约
- `ARCH_OVERVIEW.md` — 消费方（desktop/tray）健康检查用途
