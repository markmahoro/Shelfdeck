# DESIGN_SERVICE/HEALTH_CHECK — 服务健康检查

> Phase 4 为基准架构，v2 重写中。
> SSOT：本文是健康检查可执行行为的唯一事实来源。

---

## §1 职责定位

健康检查模块负责对外暴露 service 整体运行状态，供 desktop、tray、admin_web 三方消费。

| 消费方 | 端点 | 用途 |
|---|---|---|
| desktop | `GET /v1/health` | 门禁逻辑：连接前检查 service 是否可用 |
| tray | `GET /v1/health` | 托盘灯状态 + 左键面板展示 |
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
| 2 | 智能入队 | `smartTaskEngine` | 运行中；或 `wallRatingAutoEnqueue` 未启用（已停用） | `wallRatingAutoEnqueue` 已启用但尚未运行过一次（等待首次运行） | 已启用但定时器未运行 |
| 3 | 媒体库刷新 | `mediaLibraryService` | 全部启用子库的 `lastRefreshedAt` 在 2 倍刷新间隔内；或无任何子库启用（未配置） | 部分启用子库的 `lastRefreshedAt` 超过 2 倍刷新间隔 | 全部启用子库超时；或 library.json 不可读/损坏 |
| 4 | 豆瓣评分抓取 | `doubanService` | 会话有效（cookieHeader + userId 存在）；或无任何子库启用豆瓣（未配置） | — | 存在子库启用豆瓣但会话无效 |
| 5 | 策略引擎 | `strategyEngine` | 定时器运行中，且最近一次运行成功 | 定时器运行中但尚未运行过一次（等待首次运行） | 定时器未运行 |
| 6 | Emby 连接 | `embyService` | 全部已配置服务器 `GET /System/Info` 在 2s 内返回 200 | 部分服务器响应慢／不可达 | 全部服务器不可达 |
| 7 | 洗版服务 | `moviepilotService` | 无任何子库启用智能洗版（未配置）；或 MoviePilot API 连通且暂存路径可写 | — | 存在子库启用智能洗版，但 MoviePilot 不可达 或 暂存路径不可写 |
| 8 | 转码服务 | `transcodeService` | ffmpeg 可执行 + 至少一个设备在池 + transcodeTempRoot 可写 | 未配置任何编码设备（未配置） | ffmpeg 不可用；或 transcodeTempRoot 不可写 |

### 2.3 各检查项详细定义

#### 1. 任务调度器

- **对应模块**: `taskScheduler` → 通过 `setSchedulerState()` 上报 running/runningTasks
- **green**: `schedulerRunning === true`
- **red**: `schedulerRunning === false`（未启动或异常退出）
- **无 yellow**
- **返回字段**: `status`, `runningTasks`

#### 2. 智能入队

- **对应模块**: `smartTaskEngine` → 导出 `getHealth()`
- **green**:
  - 定时器运行中，最近一次扫描成功
  - 或 `wallRatingAutoEnqueue === false` → 描述"已停用"
- **yellow**: `wallRatingAutoEnqueue === true` 但 `lastRunAt` 为空（已启用但尚未运行过一次）→ 描述"等待首次运行"
- **red**: `wallRatingAutoEnqueue === true` 但定时器未运行
- **返回字段**: `status`, `enabled`, `lastRunAt`

#### 3. 媒体库刷新

- **对应模块**: `mediaLibraryService` → 已有 `getLibraryStatus()`，新增 `getHealth()`
- **green**:
  - 无任何子库 `enabled === true` → 描述"未配置"
  - 或所有启用子库的 `lastRefreshedAt` 在 `refreshIntervalMinutes * 2` 以内
- **yellow**: 存在启用子库，且部分（非全部）的 `lastRefreshedAt` 超过 2 倍刷新间隔
- **red**: 全部启用子库超时；或 `library.json` 不可读/损坏
- **返回字段**: `status`, `totalSubLibraries`, `enabledCount`, `staleSubLibraries[]`（yellow/red 时列出超时子库名称）

#### 4. 豆瓣评分抓取

- **对应模块**: `doubanService` → 导出 `getHealth(config)`
- **green**:
  - 无任何子库启用 `doubanEnabled` → 描述"未配置"
  - 或会话有效（`douban-session.json` 中 cookieHeader + userId 非空）
- **red**: 存在子库启用 `doubanEnabled`，但会话文件无有效 cookieHeader 或 userId
- **无 yellow**
- **返回字段**: `status`, `hasSession`, `doubanEnabledSubLibCount`

#### 5. 策略引擎

- **对应模块**: `strategyEngine` → 导出 `getHealth()`
- **green**: 定时器运行中，且最近一次运行成功
- **yellow**: 定时器运行中但 `lastRunAt` 为空（尚未运行过一次）→ 描述"等待首次运行"
- **red**: 定时器未运行
- **返回字段**: `status`, `lastRunAt`, `lastChanged`（最近一次运行的变更条目数）

#### 6. Emby 连接

- **对应模块**: `embyService` → 已在 healthCheck 中有逻辑，封装为 `getHealth(servers)`
- **green**: 所有已配置的 Emby 服务器 `GET /System/Info` 在 2s 内返回 200
- **yellow**: 部分服务器响应延迟 > 2s，或部分不可达（多服务器混合状态）
- **red**: 全部已配置服务器不可达，或任一返回 401（认证失败）
- **返回字段**: `status`, `message?`（yellow/red 时列出问题服务器）

#### 7. 洗版服务

- **对应模块**: `moviepilotService` → 导出 `getHealth(config)`
- **green**:
  - 无任何子库启用 `upgradeSmartSelect.enabled` → 描述"未配置"
  - 或 MoviePilot `checkConnection()` 返回 `ok: true` 且 `upgradeStagingLocalPath` 路径存在且可写
- **red**: 存在子库启用智能洗版，但任一条件不满足（MoviePilot API 不可达 或 暂存路径不存在/不可写）
- **无 yellow**
- **返回字段**: `status`, `smartSelectEnabled`, `message?`（red 时说明具体原因：API 不通 / 路径不可写）

#### 8. 转码服务

- **对应模块**: `transcodeService` → 导出 `getHealth(config)`
- **green**:
  - ffmpeg 二进制可执行（执行 `ffmpeg -version` 返回 0）
  - 且 `transcodeTempRoot` 路径存在且可写
  - 且 `transcodeEncodingDevices` 中至少有一个 `inPool === true` 的设备
- **yellow**: ffmpeg 可用 + transcodeTempRoot 可写，但 `transcodeEncodingDevices` 中无任何 `inPool === true` 的设备 → 描述"未配置"
- **red**: ffmpeg 不可用；或 transcodeTempRoot 不可写
- **返回字段**: `status`, `ffmpegOk`, `deviceCount`, `message?`（yellow/red 时说明具体原因）

---

## §3 聚合规则

### 3.1 三级聚合

```
green  = 所有检查项均为 green
yellow = 至少一项 yellow，无 red
red    = 至少一项 red
```

### 3.2 聚合示例 (8 项)

| 调度器 | 智能入队 | 媒体库刷新 | 豆瓣 | 策略引擎 | Emby | 洗版 | 转码 | 聚合 |
|--------|---------|-----------|------|---------|------|------|------|------|
| green | green | green | green | green | green | green | green | **green** |
| green | yellow | green | green | green | green | green | green | **yellow** |
| green | green | yellow | green | green | green | green | green | **yellow** |
| green | green | green | green | green | yellow | green | green | **yellow** |
| green | green | green | green | green | green | green | yellow | **yellow** |
| green | green | green | green | green | green | red | green | **red** |
| red | green | green | green | green | green | green | green | **red** |

---

## §4 REST API

### 4.1 GET /v1/health

公开端点，无需认证。供 desktop 和 tray 使用。

**响应**：

```json
{
  "status": "green",
  "timestamp": "2026-04-26T10:00:00.000Z"
}
```

> 仅返回聚合状态，不暴露内部检查细节。

### 4.2 GET /v1/admin/health

Admin 专属端点，返回完整检查详情。供 admin_web 仪表盘使用。

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

**各检查项返回字段**：

| 检查项 | key | 字段 |
|---|---|---|
| 任务调度器 | `scheduler` | `status`, `runningTasks` |
| 智能入队 | `smartTask` | `status`, `enabled`, `lastRunAt?` |
| 媒体库刷新 | `mediaLib` | `status`, `totalSubLibraries`, `enabledCount`, `staleSubLibraries?` |
| 豆瓣评分抓取 | `douban` | `status`, `hasSession`, `doubanEnabledSubLibCount` |
| 策略引擎 | `strategy` | `status`, `lastRunAt?`, `lastChanged?` |
| Emby 连接 | `emby` | `status`, `message?` |
| 洗版服务 | `upgrade` | `status`, `smartSelectEnabled`, `message?` |
| 转码服务 | `transcode` | `status`, `ffmpegOk`, `deviceCount`, `message?` |

---

## §5 与子模块的集成

每个运行态模块通过导出 `getHealth()` 或对应的 health 上报函数参与健康检查：

```
healthCheck (中心聚合)
  ├── taskScheduler.getHealth()              → scheduler
  ├── smartTaskEngine.getHealth()            → smartTask
  ├── mediaLibraryService.getHealth(config)  → mediaLib
  ├── doubanService.getHealth(config)        → douban
  ├── strategyEngine.getHealth()             → strategy
  ├── checkEmby(servers)                     → emby（多服务器连通性）
  ├── moviepilotService.getHealth(config)    → upgrade
  └── transcodeService.getHealth(config)     → transcode
```

### 5.1 健康检查时机

- **启动时**：service 启动后立即执行一次完整检查
- **定时**：每 30s 执行一次（与 TaskScheduler 5s 调度间隔解耦）
- **按需**：每次 `GET /v1/health` 或 `GET /v1/admin/health` 请求时返回最近一次检查结果（缓存 10s）

---

## §6 关联文档

- `SERVICE.md` — 胖服务组件总览
- `SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER.md` — `testConnection()` 实现
- `SERVICE/TASK_SCHEDULER.md` — Scheduler 状态上报
- `SERVICE/CONFIG.md` — 配置字段定义
- `SERVICE/ADMIN_WEB/API.md` — `GET /v1/admin/health` 端点契约
- `ARCH_OVERVIEW.md` — 消费方（desktop/tray）健康检查用途
