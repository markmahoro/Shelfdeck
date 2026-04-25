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

### 2.1 四项检查

| 检查项 | 含义 | 判定逻辑 |
|---|---|---|
| **service** | service 进程自身状态 | 始终 green（进程存活即可响应） |
| **config** | 配置完整性 | 必填字段缺失 → yellow；配置无法解析 → red |
| **emby** | Emby 服务器连通性 | `embyService.testConnection()` 成功 → green；延迟 > 2s → yellow；不可达／认证失败 → red |
| **scheduler** | 任务调度器状态 | TaskScheduler 正常运行 → green；无正在执行任务时由调用方决定是否降级 |

### 2.2 各检查项详细定义

#### service

- **green**：进程存活
- **实现**：直接返回，无需外部依赖
- **附加字段**：`uptime`（进程运行秒数）

#### config

- **green**：ConfigStore 成功加载配置，所有必填字段存在
- **yellow**：配置可加载但存在必填字段缺失（如 `transcodeTempRoot` 为空）
- **red**：配置文件损坏、无法解析

#### emby

- **green**：`GET /System/Info` 在 2s 内返回 200
- **yellow**：请求成功但延迟 > 2s，或部分 Emby 服务器不可达（多服务器场景）
- **red**：所有 Emby 服务器不可达，或认证失败（401）
- **多服务器规则**：任一 green → emby 整体 green；全 yellow → yellow；任一 red → red

#### scheduler

- **green**：TaskScheduler 轮询循环正常运行
- **yellow**：Scheduler 运行中但有异常（如连续多轮无任务被调度）
- **red**：Scheduler 异常终止或未启动

---

## §3 聚合规则

### 3.1 三级聚合

```
green  = 所有检查项均为 green
yellow = 至少一项 yellow，无 red
red    = 至少一项 red
```

### 3.2 聚合示例

| service | config | emby | scheduler | 聚合 |
|---|---|---|---|---|
| green | green | green | green | **green** |
| green | yellow | green | green | **yellow** |
| green | green | yellow | green | **yellow** |
| green | yellow | yellow | green | **yellow** |
| green | green | red | green | **red** |
| green | green | green | red | **red** |

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
    "service": { "status": "green", "uptime": 86400 },
    "config": { "status": "green" },
    "emby": { "status": "yellow", "message": "服务器 192.168.1.100:8096 响应延迟 3.2s" },
    "scheduler": { "status": "green", "runningTasks": 2 }
  },
  "timestamp": "2026-04-26T10:00:00.000Z"
}
```

**各检查项返回字段**：

| 检查项 | 字段 |
|---|---|
| `service` | `status`, `uptime` |
| `config` | `status`, `missingFields?`（yellow 时列出缺失字段） |
| `emby` | `status`, `message?`（yellow/red 时包含详情） |
| `scheduler` | `status`, `runningTasks`, `queuedTasks?` |

---

## §5 与子模块的集成

### 5.1 Emby 健康检查

EmbyAdapter 的 `testConnection(serverConfig)` 调用 `GET /System/Info`：
- 成功且延迟 ≤ 2s → green
- 成功但延迟 > 2s → yellow
- 失败或 401 → red

见 `SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER.md` §2。

### 5.2 健康检查时机

- **启动时**：service 启动后立即执行一次完整检查
- **定时**：每 30s 执行一次（与 TaskScheduler 5s 调度间隔解耦）
- **按需**：每次 `GET /v1/health` 或 `GET /v1/admin/health` 请求时返回最近一次检查结果（缓存 10s）

---

## §6 关联文档

- `SERVICE.md` — 胖服务组件总览
- `SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER.md` — `testConnection()` 实现
- `SERVICE/TASK_SCHEDULER.md` — Scheduler 状态上报
- `SERVICE/CONFIG.md` — 配置完整性检查依赖
- `SERVICE/ADMIN_WEB/API.md` — `GET /v1/admin/health` 端点契约
- `ARCH_OVERVIEW.md` — 消费方（desktop/tray）健康检查用途
