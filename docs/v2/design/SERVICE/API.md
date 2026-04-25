# DESIGN_SERVICE/API — REST API 契约

> 状态：v2 重写中
> SSOT：本文是 HTTP 路径/模型/错误码的唯一事实来源
> Admin 端点（`/v1/admin/*`）详细设计见 `SERVICE/ADMIN_WEB/API.md`，本文仅作索引

---

## §1 API 设计原则

| 原则 | 说明 |
|---|---|
| **RESTful** | 资源导向 URL，标准 HTTP 方法（GET/POST/PATCH/DELETE） |
| **JSON** | 请求体和响应体均为 `application/json` |
| **端点域分离** | `/v1/*` 供 desktop 调用，`/v1/admin/*` 供 admin_web 调用 |
| **共用模块** | 两端点域共用同一套 service 内部模块（TaskStore、ConfigStore 等） |
| **无副作用的 GET** | GET 请求不修改服务状态 |
| **幂等的 PATCH** | PATCH 为部分更新，重复调用不产生副作用 |

---

## §2 认证

### 2.1 方式

可选 `X-Api-Key` header：

```
X-Api-Key: <api_key>
```

### 2.2 规则

| 端点 | 认证要求 |
|---|---|
| `GET /v1/health` | 始终无需认证 |
| 其他所有端点 | 若 service 配置了 `apiKey`，则必须携带；未配置时放行 |

### 2.3 错误响应

```
HTTP 401 Unauthorized
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "API Key 无效或缺失"
  }
}
```

---

## §3 错误码约定

### 3.1 响应格式

所有错误响应遵循统一格式：

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "人类可读的错误描述"
  }
}
```

### 3.2 HTTP 状态码映射

| HTTP 状态码 | 含义 | 触发场景 |
|---|---|---|
| 200 | 成功 | GET/PATCH/DELETE 正常返回 |
| 201 | 已创建 | POST 创建资源成功 |
| 400 | 请求参数错误 | 必填字段缺失、格式无效、值超出范围 |
| 401 | 未授权 | API Key 无效或缺失 |
| 404 | 资源不存在 | taskId/itemId 不存在 |
| 409 | 资源冲突 | 任务正在执行中无法删除、同一 itemId 已有任务 |
| 500 | 服务内部错误 | 未预期的运行时异常 |
| 502 | 上游不可达 | Emby/Douban/MoviePilot 连接失败 |

### 3.3 业务错误码

| code | HTTP | 说明 |
|---|---|---|
| `UNAUTHORIZED` | 401 | API Key 无效 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `TASK_CONFLICT` | 409 | 同一 itemId 已有进行中的任务 |
| `TASK_EXECUTING` | 409 | 任务正在执行中，无法删除 |
| `CONFIG_INVALID` | 400 | 配置字段值无效 |
| `CONFIG_MISSING` | 400 | 必填配置字段缺失 |
| `EMBY_UNREACHABLE` | 502 | Emby 服务器不可达 |
| `DOUBAN_UNREACHABLE` | 502 | 豆瓣不可达 |
| `VALIDATION_ERROR` | 400 | 请求体字段校验失败 |

---

## §4 端点索引

### 4.1 Desktop 端点（`/v1/*`）

| 端点 | 方法 | 说明 | 详细 |
|---|---|---|---|
| `/v1/tasks` | POST | 创建任务 | §5.1 |
| `/v1/tasks` | GET | 任务列表 | §5.2 |
| `/v1/tasks/:id` | GET | 任务详情 | §5.3 |
| `/v1/tasks/:id` | PATCH | 确认任务 | §5.4 |
| `/v1/tasks/:id/actions/execute` | POST | 手动执行任务 | §5.5 |
| `/v1/tasks/:id/actions/pause` | POST | 暂停任务 | §5.6 |
| `/v1/tasks/:id` | DELETE | 删除任务 | §5.7 |
| `/v1/library/queries/manage` | GET | 媒体库列表（含策略建议） | §6.1 |
| `/v1/library/items/:itemId` | GET | 单项详情 | §6.2 |
| `/v1/library/ratings` | PATCH | 用户评分写入 | §6.3 |
| `/v1/library/actions/refresh` | POST | 手动刷新子库 | §6.4 |
| `/v1/library/status` | GET | 子库同步状态 | §6.5 |
| `/v1/library/cache` | POST | 批量写入 Emby 数据（内部） | §6.6 |
| `/v1/config` | GET | 获取完整配置 | §7.1 |
| `/v1/config` | PATCH | 更新配置 | §7.2 |
| `/v1/health` | GET | 聚合健康状态 | §8 |
| `/v1/integrations/douban/fetch/ratings` | GET | 触发豆瓣评分抓取 | §9 |

### 4.2 Admin 端点（`/v1/admin/*`）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/admin/emby/servers` | GET | 已注册 Emby 服务器列表 |
| `/v1/admin/emby/test` | POST | 测试 Emby 连接 + 内联注册 |
| `/v1/admin/emby/users` | GET | 获取 Emby 用户列表 |
| `/v1/admin/emby/media-folders` | GET | 获取 Emby 媒体文件夹 |
| `/v1/admin/emby/config` | GET | Emby 连接配置（已废弃） |
| `/v1/admin/emby/config` | PATCH | 更新 Emby 连接配置（已废弃） |
| `/v1/admin/sublibraries` | GET | 子库列表 |
| `/v1/admin/sublibraries` | POST | 新增子库 |
| `/v1/admin/sublibraries/:uuid` | DELETE | 删除子库 |
| `/v1/admin/sublibraries/:uuid` | PATCH | 更新子库 |
| `/v1/admin/transcode/config` | GET | 转码配置 |
| `/v1/admin/transcode/config` | PATCH | 更新转码配置 |
| `/v1/admin/transcode/probe-devices` | GET | 探测本机编码设备 |
| `/v1/admin/transcode/device-pool` | GET | 设备池状态 |
| `/v1/admin/tasks` | GET | 全部任务列表 |
| `/v1/admin/tasks/:id` | GET | 任务详情（含日志） |
| `/v1/admin/tasks/:id` | DELETE | 删除任务 |
| `/v1/admin/health` | GET | 服务健康详情 |

> Admin 端点的完整请求/响应 schema 见 `SERVICE/ADMIN_WEB/API.md`。

---

## §5 任务端点

### 5.1 POST /v1/tasks — 创建任务

desktop 下发用户意图，创建新任务。

**请求体**：

```json
{
  "itemId": "emby-item-123",
  "actionType": "transcode"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `itemId` | string | 是 | Emby 媒体项 ID |
| `actionType` | string | 是 | `transcode` / `delete` / `upgrade` |

**响应**：`201 Created`

```json
{
  "id": "task-001",
  "itemId": "emby-item-123",
  "actionType": "transcode",
  "status": "created",
  "progress": 0,
  "phase": null,
  "createdAt": "2026-04-26T10:00:00.000Z",
  "updatedAt": "2026-04-26T10:00:00.000Z"
}
```

**行为**：
- `executionMode = auto` → status 为 `created`，自动转入调度池（下一轮调度时变为 `queued`）
- `executionMode = manual` → status 为 `pending_manual`，需用户调用 §5.5 execute

**错误**：

| 状态码 | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `actionType` 无效或 `itemId` 为空 |
| 409 | `TASK_CONFLICT` | 同一 `itemId` 已有进行中任务（`itemId` 锁约束） |

---

### 5.2 GET /v1/tasks — 任务列表

desktop 轮询任务状态（间隔 400ms）。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `status` | string | 否 | 按 status 筛选 |
| `actionType` | string | 否 | 按 actionType 筛选 |

**响应**：`200 OK`

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
      "updatedAt": "2026-04-26T10:05:00.000Z"
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 任务 ID |
| `itemId` | string | 媒体项 ID |
| `actionType` | string | `transcode` / `delete` / `upgrade` |
| `status` | string | 调度状态（见 `TASK_SCHEDULER.md` §4） |
| `progress` | number | 进度 0-100 |
| `phase` | string | Flow 阶段（见各 Flow 文档），可为 null |
| `createdAt` | string | 创建时间（ISO 8601） |
| `updatedAt` | string | 更新时间（ISO 8601） |

---

### 5.3 GET /v1/tasks/:id — 任务详情

**响应**：`200 OK`

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

| 字段 | 类型 | 说明 |
|---|---|---|
| `resumePoint` | string | confirm 后恢复点，无停泊时为 null |
| `logs` | array | 执行日志（Flow 私有，各 Flow seq 独立递增） |
| `itemInfo` | object | 媒体项摘要信息 |

**错误**：

| 状态码 | 场景 |
|---|---|
| 404 | 任务不存在 |

---

### 5.4 PATCH /v1/tasks/:id — 确认任务

用户确认后推进 Flow（唯一恢复 `awaiting_user_confirm` 的机制）。

**请求体**：

```json
{
  "confirmed": true
}
```

**响应**：`200 OK`

```json
{
  "id": "task-001",
  "status": "queued",
  "updatedAt": "2026-04-26T10:06:00.000Z"
}
```

**行为**：
1. 仅 `status = awaiting_user_confirm` 时有效
2. 调用 `flow.confirmReceived()` → Flow 从 `resumePoint` 继续执行
3. status 改为 `queued`，调度器下次轮询接管

**错误**：

| 状态码 | code | 场景 |
|---|---|---|
| 404 | `NOT_FOUND` | 任务不存在 |
| 409 | `TASK_CONFLICT` | 任务状态不是 `awaiting_user_confirm` |

---

### 5.5 POST /v1/tasks/:id/actions/execute — 手动执行

`executionMode = manual` 时，用户手动触发任务进入调度。

**请求体**：无

**响应**：`200 OK`

```json
{
  "id": "task-001",
  "status": "queued",
  "updatedAt": "2026-04-26T10:01:00.000Z"
}
```

**行为**：
- `pending_manual` → `created` → 进入调度（status 变为 `queued`）
- 其他 status → 无操作，返回当前状态

**错误**：

| 状态码 | 场景 |
|---|---|
| 404 | 任务不存在 |

---

### 5.6 POST /v1/tasks/:id/actions/pause — 暂停任务

**请求体**：无

**响应**：`200 OK`

```json
{
  "id": "task-001",
  "status": "paused",
  "updatedAt": "2026-04-26T10:03:00.000Z"
}
```

**行为**：
- Scheduler 调用 `flow.pause()`
- 各 Flow 自行处理（TranscodeFlow 中断 FFmpeg 保留 partial；DeleteFlow 忽略 pause）
- status 改为 `paused`，调度器跳过

**错误**：

| 状态码 | 场景 |
|---|---|
| 404 | 任务不存在 |

---

### 5.7 DELETE /v1/tasks/:id — 删除任务

**响应**：`200 OK`

```json
{
  "ok": true,
  "id": "task-001"
}
```

**行为**：
- 若正在执行：Scheduler 调用 `flow.cancel()` → 清理资源 → 从 TaskStore 移除
- 若非执行中：直接从 TaskStore 移除

**错误**：

| 状态码 | code | 场景 |
|---|---|---|
| 404 | `NOT_FOUND` | 任务不存在 |
| 409 | `TASK_EXECUTING` | 任务正在执行中（可选实现） |

---

## §6 媒体库端点

### 6.1 GET /v1/library/queries/manage — 媒体库列表

返回完整媒体库数据，含策略建议。供 desktop 媒体库展示页面使用。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `source` | string | 否 | 按来源筛选：`emby` / `local` |
| `type` | string | 否 | 按类型筛选：`Movie` / `Series` / `Episode` |
| `action` | string | 否 | 按推荐动作筛选：`delete` / `transcode` / `upgrade` / `keep` |
| `subLibraryId` | string | 否 | 按子库 uuid 筛选 |

**响应**：`200 OK`

```json
{
  "items": [
    {
      "itemId": "emby-item-123",
      "subLibraryId": "sublib-001",
      "name": "电影名称",
      "path": "D:\\media\\movie.mkv",
      "source": "emby",
      "sourceId": "emby-item-123",
      "type": "Movie",
      "bitrate": 50000000,
      "duration": 7200,
      "resolution": "3840x2160",
      "size": 45000000000,
      "premiereDate": "2024-01-01",
      "genres": ["Action", "Sci-Fi"],
      "isDiscLike": false,
      "doubanId": "1234567",
      "doubanRating": 4,
      "doubanSyncedAt": "2026-04-26T06:00:00.000Z",
      "userRating": null,
      "userRatingUpdatedAt": null,
      "lastRefreshedAt": "2026-04-26T10:00:00.000Z",
      "action": "transcode",
      "reason": "码率 50 Mbps 超出 5★ 4K 目标 25 Mbps"
    }
  ],
  "total": 150
}
```

> MediaItem 字段完整定义见 `SERVICE/MEDIA_LIBRARY.md` §1.1。

---

### 6.2 GET /v1/library/items/:itemId — 单项详情

**响应**：`200 OK`

```json
{
  "itemId": "emby-item-123",
  "subLibraryId": "sublib-001",
  "name": "电影名称",
  "path": "D:\\media\\movie.mkv",
  "source": "emby",
  "type": "Movie",
  "bitrate": 50000000,
  "duration": 7200,
  "resolution": "3840x2160",
  "size": 45000000000,
  "action": "transcode",
  "reason": "码率 50 Mbps 超出 5★ 4K 目标 25 Mbps"
}
```

**错误**：

| 状态码 | 场景 |
|---|---|
| 404 | itemId 不存在 |

---

### 6.3 PATCH /v1/library/ratings — 用户评分写入

**请求体**：

```json
{
  "itemId": "emby-item-123",
  "userRating": 4
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `itemId` | string | 是 | 媒体项 ID |
| `userRating` | number | 是 | 用户星级评分（1-5） |

**响应**：`200 OK`

```json
{
  "ok": true
}
```

**副作用**：
- 写入 `library.json` 中对应 item 的 `userRating` + `userRatingUpdatedAt`
- 重新计算 `effectiveRating` → `action` + `reason`
- 若 `wallRatingAutoEnqueue = true`，自动创建转码任务（由 TaskScheduler 负责）
- 持久化 `library.json`

**错误**：

| 状态码 | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `userRating` 超出 1-5 范围 |
| 404 | `NOT_FOUND` | itemId 不存在 |

---

### 6.4 POST /v1/library/actions/refresh — 手动刷新子库

触发指定子库立即执行 Emby 拉取。

**请求体**：

```json
{
  "subLibraryId": "sublib-001"
}
```

**响应**：`202 Accepted`

```json
{
  "ok": true,
  "message": "子库刷新已触发"
}
```

> 刷新为异步操作，通过 `GET /v1/library/status` 查询进度。

**错误**：

| 状态码 | 场景 |
|---|---|
| 400 | 缺少 `subLibraryId` |
| 404 | 子库不存在 |

---

### 6.5 GET /v1/library/status — 子库同步状态

**响应**：`200 OK`

```json
{
  "subLibraries": [
    {
      "uuid": "sublib-001",
      "name": "电影库",
      "enabled": true,
      "lastRefreshedAt": "2026-04-26T10:00:00.000Z",
      "doubanEnabled": true,
      "doubanSyncedAt": "2026-04-26T06:00:00.000Z"
    }
  ]
}
```

---

### 6.6 POST /v1/library/cache — 批量写入 Emby 媒体数据

**内部端点**。由 EmbyService 在定时拉取完成后调用，将 Emby 原始数据批量写入媒体库表。

**请求体**：

```json
{
  "subLibraryId": "sublib-001",
  "items": [
    {
      "sourceId": "emby-item-123",
      "name": "电影名称",
      "path": "D:\\media\\movie.mkv",
      "type": "Movie",
      "bitrate": 50000000,
      "duration": 7200,
      "resolution": "3840x2160",
      "size": 45000000000,
      "premiereDate": "2024-01-01",
      "genres": ["Action", "Sci-Fi"],
      "isDiscLike": false
    }
  ]
}
```

**响应**：`200 OK`

```json
{
  "ok": true,
  "upserted": 50,
  "removed": 2
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `upserted` | number | 新增或更新的 item 数量 |
| `removed` | number | 移除的 item 数量（Emby 侧已删除） |

> 此端点由 service 内部模块调用，desktop 不直接使用。

---

## §7 配置端点

### 7.1 GET /v1/config — 获取完整配置

**响应**：`200 OK`

```json
{
  "executionMode": "auto",
  "deleteConcurrency": 1,
  "transcodeConcurrency": 1,
  "upgradeConcurrency": 1,
  "wallRatingAutoEnqueue": false,
  "transcodeTempRoot": "D:\\transcode",
  "transcodeReplaceConfirmRequired": false,
  "ffmpegPath": "ffmpeg",
  "ffprobePath": "ffprobe",
  "transcodeEncodingDevices": [],
  "transcodeMaxCpuSlots": 1,
  "transcodeCpuParticipationStrategy": "normal",
  "moviepilot": {
    "baseUrl": "",
    "apiKey": "********",
    "savePath": "",
    "stagingPath": ""
  },
  "upgradeStagingLocalPath": "",
  "upgradeRetryInterval": 3600000,
  "upgradeMaxRetries": 3,
  "embyServers": {},
  "subLibraries": [],
  "douban": {
    "userId": "",
    "cookieHeader": "********"
  },
  "mediaPolicy": {
    "target1080p": { "2": 2, "3": 4, "4": 7, "5": 12 },
    "target4k": { "2": 5, "3": 10, "4": 16, "5": 25 }
  }
}
```

> 敏感字段（`apiKey`、`cookieHeader`、`embyUserPassword`）读取时返回 `"********"`。
> 完整字段定义见 `SERVICE/CONFIG.md` §3。

---

### 7.2 PATCH /v1/config — 更新配置

部分更新，仅传入需要变更的字段。

**请求体**（示例）：

```json
{
  "executionMode": "manual",
  "transcodeConcurrency": 2
}
```

**响应**：`200 OK` — 返回更新后的完整配置（同 §7.1）。

**行为**：
- 配置变更由 ConfigStore 持久化到 `data/config.json`
- 并发相关字段变更后，TaskScheduler 下次轮询生效
- 转码配置变更后，TranscodeService 下次调用生效

**错误**：

| 状态码 | code | 场景 |
|---|---|---|
| 400 | `CONFIG_INVALID` | 字段类型错误或值超出范围 |
| 400 | `CONFIG_MISSING` | 必填字段被设为空 |

---

## §8 健康检查

### GET /v1/health

公开端点，无需认证。供 desktop 和 tray 使用。

**响应**：`200 OK`

```json
{
  "status": "green",
  "timestamp": "2026-04-26T10:00:00.000Z"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | string | 聚合状态：`green` / `yellow` / `red` |
| `timestamp` | string | 最近一次检查时间（ISO 8601） |

> 详细设计见 `SERVICE/HEALTH_CHECK.md`。
> Admin 端点 `GET /v1/admin/health` 返回完整检查详情，见 `SERVICE/ADMIN_WEB/API.md` §5.1。

---

## §9 豆瓣集成

### GET /v1/integrations/douban/fetch/ratings

触发豆瓣评分同步（按子库）。由 admin_web 豆瓣管理页调用。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `subLibraryId` | string | 是 | 目标子库 uuid |

**响应**：`202 Accepted`

```json
{
  "ok": true,
  "message": "豆瓣评分同步已触发"
}
```

> 同步为异步操作（可能耗时数分钟），进度通过 `GET /v1/library/status` 中的 `doubanSyncedAt` 字段确认。

**错误**：

| 状态码 | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 缺少 `subLibraryId` |
| 404 | `NOT_FOUND` | 子库不存在 |
| 502 | `DOUBAN_UNREACHABLE` | 豆瓣不可达 |

---

## §10 Admin 端点

`/v1/admin/*` 端点域供 admin_web 调用。完整设计见 `SERVICE/ADMIN_WEB/API.md`（SSOT for admin endpoints）。

| 类别 | 端点 | 方法 | 说明 |
|---|---|---|---|
| Emby 服务器 | `/v1/admin/emby/servers` | GET | 已注册服务器列表 |
| | `/v1/admin/emby/test` | POST | 测试连接 + 内联注册 |
| | `/v1/admin/emby/users` | GET | 用户列表 |
| | `/v1/admin/emby/media-folders` | GET | 媒体文件夹列表 |
| | `/v1/admin/emby/config` | GET/PATCH | Emby 连接配置（已废弃） |
| 子库管理 | `/v1/admin/sublibraries` | GET/POST | 子库列表 / 新增 |
| | `/v1/admin/sublibraries/:uuid` | DELETE/PATCH | 删除 / 更新子库 |
| 转码设置 | `/v1/admin/transcode/config` | GET/PATCH | 转码配置 |
| | `/v1/admin/transcode/probe-devices` | GET | 探测编码设备 |
| | `/v1/admin/transcode/device-pool` | GET | 设备池状态 |
| 任务监控 | `/v1/admin/tasks` | GET | 全部任务列表 |
| | `/v1/admin/tasks/:id` | GET/DELETE | 任务详情 / 删除 |
| 健康检查 | `/v1/admin/health` | GET | 服务健康详情 |

---

## §11 API 版本策略

- **当前版本**：`v1`
- **版本方式**：URL 路径前缀（`/v1/`）
- **兼容性**：`/v1/` 端点保持向后兼容；新功能优先在现有端点上扩展字段
- **废弃**：标记为废弃的端点保留至少一个大版本周期后移除
- **Admin 端点**：`/v1/admin/*` 不承诺与 desktop API 相同的兼容性（admin_web 与 service 一起发布）

---

## 关联文档

- `SERVICE/ADMIN_WEB/API.md` — Admin 端点 SSOT
- `SERVICE/TASK_SCHEDULER.md` — 任务 status 定义和调度行为
- `SERVICE/DELETE_FLOW.md` — Delete Flow 行为
- `SERVICE/TRANSCODE_FLOW.md` — Transcode Flow 行为
- `SERVICE/UPGRADE_FLOW.md` — Upgrade Flow 行为
- `SERVICE/MEDIA_LIBRARY.md` — MediaItem 字段定义
- `SERVICE/CONFIG.md` — 配置字段定义
- `SERVICE/HEALTH_CHECK.md` — 健康检查详细设计
- `SERVICE/ADMIN_WEB/PAGES.md` — 页面与 API 交互方式
