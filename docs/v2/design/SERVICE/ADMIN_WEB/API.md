# DESIGN_SERVICE/ADMIN_WEB/API — Admin API 端点设计

> 状态：v2 定稿
> SSOT：本文是 `/v1/admin/*` 端点的唯一事实来源
> openapi.yaml 待从本文档导出（机器可读形式化）

---

## §1 设计原则

### 1.1 与 desktop API 的关系

| 原则 | 说明 |
|---|---|
| **端点域分离** | admin API 使用 `/v1/admin/*` 前缀，desktop API 使用 `/v1/*` 前缀 |
| **数据模型复用** | 内部模块（TaskStore、ConfigStore）共用，不为 admin 专属数据单独建模 |
| **同一 service 模块** | admin API 和 desktop API 调用相同的内部模块，只是端点路径不同 |
| **API Key 认证** | 复用 `X-Api-Key` header 认证，与 desktop API 一致 |

### 1.2 错误处理

遵循 `SHARED/ERROR_HANDLING.md` 的统一错误码规范。

| 错误类型 | HTTP 状态码 | 说明 |
|---|---|---|
| 配置不完整 | 400 | 必填字段缺失或格式错误 |
| Emby 连接失败 | 502 | test endpoint 检测到 Emby 不可达 |
| 任务不存在 | 404 | GET/DELETE on non-existent taskId |
| 未授权 | 401 | API Key 校验失败 |

---

## §2 Emby 服务器与子库配置

> v2 更新：Emby 配置已迁移至多服务器 + 子库模型。
> 旧版 `embyClient` 单服务器接口（`GET /v1/admin/emby/config`、`PATCH /v1/admin/emby/config`）保留作兼容，逐步废弃。

### 2.1 GET /v1/admin/emby/servers

获取所有已注册的 Emby 服务器列表。

**响应**：

```json
{
  "servers": [
    {
      "uuid": "abc123",
      "serverName": "My Emby Server",
      "baseUrl": "http://192.168.1.100:8096",
      "apiKey": "********",
      "userId": "user-001",
      "embyUserPassword": "********"
    }
  ]
}
```

> `apiKey` 和 `embyUserPassword` 读取时恒返回 `"********"`（掩码）。

---

### 2.2 POST /v1/admin/emby/test

测试 Emby 连接是否可达，同时内联注册服务器（若为新服务器）。

**请求体**：

```json
{
  "baseUrl": "http://192.168.1.100:8096",
  "apiKey": "test-api-key",
  "userId": "abc123"
}
```

**响应**：

```json
{
  "ok": true,
  "message": "Emby 连接成功",
  "serverInfo": {
    "serverName": "My Emby Server",
    "version": "4.8.0.56"
  },
  "embyServerId": "abc123"
}
```

> 若该 `baseUrl` 对应的服务器尚未注册，返回的 `embyServerId` 为新生成的 uuid。
> 若已注册，返回已有 uuid。

**错误**：

| 状态码 | 场景 |
|---|---|
| 400 | 参数格式错误 |
| 502 | Emby 服务不可达或认证失败 |

---

### 2.3 GET /v1/admin/emby/users

获取指定 Emby 服务器的用户列表。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `embyServerId` | string | 是 | Emby 服务器 uuid |

**响应**：

```json
{
  "users": [
    { "id": "user-001", "name": "管理员" },
    { "id": "user-002", "name": "家庭成员" }
  ]
}
```

**错误**：

| 状态码 | 场景 |
|---|---|
| 400 | 缺少 embyServerId |
| 404 | 服务器不存在 |

---

### 2.4 GET /v1/admin/emby/media-folders

获取指定 Emby 服务器的媒体文件夹列表。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `embyServerId` | string | 是 | Emby 服务器 uuid |

**响应**：

```json
{
  "folders": [
    { "id": "section-abc", "name": "电影" },
    { "id": "section-def", "name": "剧集" }
  ]
}
```

**错误**：

| 状态码 | 场景 |
|---|---|
| 400 | 缺少 embyServerId |
| 404 | 服务器不存在 |

---

### 2.5 子库管理 API

#### GET /v1/admin/sublibraries

获取所有子库列表。

**响应**：

```json
{
  "subLibraries": [
    {
      "uuid": "sublib-001",
      "name": "电影库",
      "embyServerId": "abc123",
      "sectionId": "section-abc",
      "source": "emby",
      "doubanEnabled": true,
      "enabled": true,
      "lastRefreshedAt": "2026-04-26T10:00:00.000Z",
      "doubanSyncedAt": "2026-04-26T06:00:00.000Z",
      "mediaPolicy": {
        "target1080p": { "2": 2, "3": 4, "4": 7, "5": 12 },
        "target4k": { "2": 5, "3": 10, "4": 16, "5": 25 }
      }
    }
  ]
}
```

---

#### POST /v1/admin/sublibraries

新增子库（含内联 Emby 服务器注册）。

**请求体**：

```json
{
  "name": "电影库",
  "embyServerId": "abc123",
  "sectionId": "section-abc",
  "source": "emby",
  "doubanEnabled": true,
  "mediaPolicy": {
    "target1080p": { "2": 2, "3": 4, "4": 7, "5": 12 },
    "target4k": { "2": 5, "3": 10, "4": 16, "5": 25 }
  }
}
```

> `embyServerId` 若为新服务器 uuid（在 Step 1 中通过 `POST /v1/admin/emby/test` 内联注册得到），则在创建子库时一并写入 `embyServers`。
> `mediaPolicy` 可选，不提供则使用默认值。

**响应**：`201 Created` + 创建的子库对象。

**错误**：

| 状态码 | 场景 |
|---|---|
| 400 | 必填字段缺失或无效 |
| 404 | embyServerId 不存在 |

---

#### DELETE /v1/admin/sublibraries/:uuid

删除子库（同时清理 library.json 中该子库的所有 items）。

**响应**：`200 OK`

```json
{
  "ok": true,
  "uuid": "sublib-001"
}
```

**错误**：

| 状态码 | 场景 |
|---|---|
| 404 | 子库不存在 |

---

#### PATCH /v1/admin/sublibraries/:uuid

部分更新子库配置。

**请求体**（所有字段可选）：

```json
{
  "name": "新名称",
  "doubanEnabled": false,
  "enabled": false,
  "mediaPolicy": {
    "target1080p": { "2": 1, "3": 3, "4": 6, "5": 10 },
    "target4k": { "2": 4, "3": 8, "4": 14, "5": 20 }
  }
}
```

**响应**：`200 OK` + 更新后的子库对象。

**错误**：

| 状态码 | 场景 |
|---|---|
| 404 | 子库不存在 |

---

## §3 转码设置

### 3.1 GET /v1/admin/transcode/config

获取当前转码配置。

**响应**：

```json
{
  "transcodeTempRoot": "D:\\transcode",
  "transcodeReplaceConfirmRequired": false,
  "ffmpegPath": "ffmpeg",
  "ffprobePath": "ffprobe",
  "transcodeMaxCpuSlots": 2,
  "transcodeCpuParticipationStrategy": "normal"
}
```

> 完整字段定义见 `SERVICE/CONFIG.md` §3.2。
> 注：`mediaPolicy` 已移至子库级，见 `SERVICE/CONFIG.md` §3.4.2。

---

### 3.2 PATCH /v1/admin/transcode/config

部分更新转码配置。

**请求体**：

```json
{
  "transcodeTempRoot": "D:\\transcode",
  "ffmpegPath": "D:\\tools\\ffmpeg.exe"
}
```

**响应**：`200 OK` + 更新后的完整配置。

---

### 3.3 GET /v1/admin/transcode/probe-devices

探测本机可用编码设备（调用 ffmpeg 实际测试编码能力）。

**响应**：

```json
{
  "devices": [
    {
      "stableKey": "nvenc:0",
      "label": "NVIDIA NVENC（CUDA 0）",
      "backend": "nvenc",
      "gpuIndex": 0
    },
    {
      "stableKey": "cpu:libx265",
      "label": "CPU · libx265（软件）",
      "backend": "cpu",
      "gpuIndex": -1
    }
  ]
}
```

> `stableKey` 可直接用于配置 `transcodeEncodingDevices[].stableKey`。
> 返回的设备仅为候选列表，实际入池需用户在 UI 中勾选后保存。

---

### 3.4 GET /v1/admin/transcode/device-pool

获取设备池状态。

**响应**：

```json
{
  "devices": [
    {
      "stableKey": "nvenc:0",
      "inPool": true,
      "priority": 100,
      "maxSlots": 2,
      "encoder": "hevc_nvenc",
      "status": "idle",
      "activeSlots": 0
    },
    {
      "stableKey": "cpu:libx265",
      "inPool": true,
      "priority": 200,
      "maxSlots": 1,
      "encoder": "libx265",
      "status": "busy",
      "activeSlots": 1
    }
  ],
  "summary": {
    "totalDevices": 2,
    "idleDevices": 1,
    "totalAvailableSlots": 2,
    "usedSlots": 1
  }
}
```

> `status` 取值：`idle` | `busy` | `error`
> `activeSlots` 表示当前正在使用的槽位数。

---

## §4 任务监控

### 4.1 GET /v1/admin/tasks

列出所有任务（含 flowState）。

**响应**：

```json
{
  "tasks": [
    {
      "id": "task-001",
      "itemId": "emby-item-123",
      "actionType": "transcode",
      "status": "executing",
      "progress": 45,
      "phase": "transcode_encoding",
      "createdAt": "2026-04-26T10:00:00.000Z",
      "updatedAt": "2026-04-26T10:05:00.000Z",
      "resumePoint": null
    }
  ],
  "summary": {
    "total": 10,
    "byStatus": {
      "queued": 3,
      "executing": 2,
      "awaiting_user_confirm": 1,
      "done": 3,
      "failed_hard": 1
    }
  }
}
```

> 完整 status/phase 定义见 `SERVICE/TASK_SCHEDULER.md`。

**查询参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `status` | string | 按 status 筛选 |
| `actionType` | string | 按 actionType 筛选（`transcode`/`delete`/`upgrade`） |

---

### 4.2 GET /v1/admin/tasks/:id

获取单个任务详情。

**响应**：

```json
{
  "id": "task-001",
  "itemId": "emby-item-123",
  "actionType": "transcode",
  "status": "executing",
  "progress": 45,
  "phase": "transcode_encoding",
  "resumePoint": null,
  "createdAt": "2026-04-26T10:00:00.000Z",
  "updatedAt": "2026-04-26T10:05:00.000Z",
  "logs": [
    { "seq": 1, "ts": "2026-04-26T10:00:00.000Z", "level": "info", "msg": "任务开始" },
    { "seq": 2, "ts": "2026-04-26T10:00:01.000Z", "level": "info", "msg": "precheck 通过" }
  ],
  "itemInfo": {
    "name": "电影名称",
    "path": "D:\\media\\movie.mkv",
    "resolution": "3840x2160",
    "bitrate": 50000000
  }
}
```

**错误**：

| 状态码 | 场景 |
|---|---|
| 404 | 任务不存在 |

---

### 4.3 DELETE /v1/admin/tasks/:id

删除任务。

**响应**：`200 OK`

```json
{
  "ok": true,
  "id": "task-001"
}
```

**错误**：

| 状态码 | 场景 |
|---|---|
| 404 | 任务不存在 |
| 409 | 任务正在执行中，无法删除（可选实现） |

---

## §5 服务健康状态

### 5.1 GET /v1/admin/health

获取 service 健康状态详情（admin 专属，比 `/v1/health` 更详细）。

**响应**：

```json
{
  "status": "yellow",
  "checks": {
    "service": { "status": "green", "uptime": 86400 },
    "emby": { "status": "yellow", "message": "连接延迟 > 2s" },
    "scheduler": { "status": "green", "runningTasks": 2 }
  },
  "timestamp": "2026-04-26T10:00:00.000Z"
}
```

> 详细定义见 `SERVICE/HEALTH_CHECK.md`。

---

## §6 端点索引

| 端点 | 方法 | 说明 | 对应模块 |
|---|---|---|---|
| `/v1/admin/emby/config` | GET | 获取 Emby 连接配置（已废弃，兼容保留） | ConfigStore |
| `/v1/admin/emby/config` | PATCH | 更新 Emby 连接配置（已废弃，兼容保留） | ConfigStore |
| `/v1/admin/emby/test` | POST | 测试连接 + 内联注册服务器 | EmbyService |
| `/v1/admin/emby/servers` | GET | 获取已注册服务器列表 | ConfigStore |
| `/v1/admin/emby/users` | GET | 获取服务器用户列表 | EmbyService |
| `/v1/admin/emby/media-folders` | GET | 获取服务器媒体文件夹列表 | EmbyService |
| `/v1/admin/sublibraries` | GET | 获取子库列表 | MediaLibraryService |
| `/v1/admin/sublibraries` | POST | 新增子库 | MediaLibraryService |
| `/v1/admin/sublibraries/:uuid` | DELETE | 删除子库 | MediaLibraryService |
| `/v1/admin/sublibraries/:uuid` | PATCH | 更新子库 | MediaLibraryService |
| `/v1/admin/transcode/config` | GET | 获取转码配置 | ConfigStore |
| `/v1/admin/transcode/config` | PATCH | 更新转码配置 | ConfigStore |
| `/v1/admin/transcode/probe-devices` | GET | 探测本机可用编码设备 | TranscodeService |
| `/v1/admin/transcode/device-pool` | GET | 获取设备池状态 | TranscodeService |
| `/v1/admin/tasks` | GET | 列出所有任务 | TaskStore |
| `/v1/admin/tasks/:id` | GET | 获取任务详情 | TaskStore |
| `/v1/admin/tasks/:id` | DELETE | 删除任务 | TaskStore |
| `/v1/admin/health` | GET | 服务健康详情 | HealthCheck |

---

## §7 关联文档

- `SERVICE/ADMIN_WEB.md` — Web 管理端总览
- `SERVICE/ADMIN_WEB/PAGES.md` — 页面结构与组件
- `SERVICE/CONFIG.md` — 配置字段定义
- `SERVICE/TASK_SCHEDULER.md` — status/phase 定义
- `SERVICE/HEALTH_CHECK.md` — 健康检查详细设计
- `openapi.yaml` — 机器可读形式化（未来由本文档导出）
