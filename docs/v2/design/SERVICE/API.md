# DESIGN_SERVICE/API — REST API 契约

> 状态：v4 定稿
> SSOT：本文是 HTTP 路径/模型/错误码的唯一事实来源
> Admin 端点（`/v1/admin/*`）详细设计见 `SERVICE/ADMIN_WEB/API.md`，本文仅作索引

---

## §1 API 设计原则

| 原则 | 说明 |
|---|---|
| **RESTful** | 资源导向 URL，标准 HTTP 方法（GET/POST/PATCH/PUT/DELETE） |
| **JSON** | 请求体和响应体均为 `application/json`（preview 等流式端点除外） |
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
| 200 | 成功 | GET/PATCH/PUT/DELETE 正常返回 |
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
| `CONFIG_INVALID` | 400 | 配置字段值无效 |
| `CONFIG_MISSING` | 400 | 必填配置字段缺失 |
| `VALIDATION_ERROR` | 400 | 请求体字段校验失败 |
| `BAD_REQUEST` | 400 | 一般请求错误（如任务未完成时请求 report） |
| `CONFLICT` | 409 | 一般资源冲突（如模板 id 重复） |
| `INTERNAL_ERROR` | 500 | 服务内部未预期错误 |
| `EMBY_ERROR` | 502 | Emby API 调用失败（mark-played、mark-unplayed、unplayed 查询等） |
| `DOUBAN_UNREACHABLE` | 502 | 豆瓣不可达 |
| ~~`EMBY_UNREACHABLE`~~ | 502 | 已废弃，新代码使用 `EMBY_ERROR`。旧路径（resolveEmbyConfigForLibrary 失败等）仍可返回此码 |
| ~~`TASK_EXECUTING`~~ | 409 | 未使用。DELETE /v1/tasks 不再检查执行中状态，直接 cancel + 删除 |

---

## §4 端点索引

### 4.1 Desktop 端点（`/v1/*`）

| 端点 | 方法 | 说明 | 详细 |
|---|---|---|---|
| `/v1/tasks` | POST | 创建任务 | §5.1 |
| `/v1/tasks` | GET | 任务列表 | §5.2 |
| `/v1/tasks/:id` | GET | 任务详情 | §5.3 |
| `/v1/tasks/:id` | PATCH | 确认任务 | §5.4 |
| `/v1/tasks/:id` | DELETE | 删除任务 | §5.7 |
| `/v1/tasks/:id/actions/execute` | POST | 手动执行任务 | §5.5 |
| `/v1/tasks/:id/actions/pause` | POST | 暂停任务 | §5.6 |
| `/v1/tasks/:id/report` | GET | 任务完成报告 | §5.8 |
| `/v1/tasks/:id/preview` | GET | 预览片段（video/mp4 流） | §5.9 |
| `/v1/library` | GET | 媒体库列表（支持 `?subLibraryId=` 等筛选） | §6.1 |
| `/v1/library/queries/manage` | GET | 媒体库列表（含策略建议，同 `/v1/library`） | §6.2 |
| `/v1/library/items/:itemId` | GET | 单项详情 | §6.3 |
| `/v1/library/ratings` | PATCH | 用户评分写入 | §6.4 |
| `/v1/library/actions/refresh` | POST | 手动刷新子库 | §6.5 |
| `/v1/library/actions/mark-played` | POST | 标记已观看 | §6.6 |
| `/v1/library/actions/mark-unplayed` | POST | 标记未观看 | §6.7 |
| `/v1/library/actions/recompute-strategy` | POST | 立即重算全库策略 | §6.8 |
| `/v1/library/queries/played` | POST | 查询已观看历史（v1 兼容，已重定向到 playback-log） | §6.9 |
| `/v1/library/queries/unplayed` | POST | 查询未观看列表 | §6.10 |
| `/v1/library/playback-log` | GET | 播放日志（本地 `playback-log.json`） | §6.11 |
| `/v1/library/playback-log/record` | POST | 记录播放 | §6.12 |
| `/v1/library/status` | GET | 子库同步状态 | §6.13 |
| `/v1/library/cache` | POST | 批量写入 Emby 数据（内部） | §6.14 |
| `/v1/config` | GET | 获取完整配置 | §7.1 |
| `/v1/config` | PATCH | 更新配置 | §7.2 |
| `/v1/health` | GET | 聚合健康状态 | §8 |
| `/v1/activity-log` | GET | 活动日志 | §9 |
| `/v1/space-stats` | GET | 空间统计 | §10 |
| `/v1/integrations/douban/fetch/ratings` | GET | 触发豆瓣评分抓取 | §11.1 |
| `/v1/integrations/douban/session` | GET | 获取豆瓣会话 | §11.2 |
| `/v1/integrations/douban/session` | PUT | 保存豆瓣会话 | §11.3 |

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
| `/v1/admin/rule-templates` | GET | 规则模板列表 |
| `/v1/admin/rule-templates` | POST | 创建规则模板 |
| `/v1/admin/rule-templates/:id` | GET | 获取单个模板 |
| `/v1/admin/rule-templates/:id` | PUT | 更新规则模板 |
| `/v1/admin/rule-templates/:id` | DELETE | 删除规则模板 |
| `/v1/admin/transcode/config` | GET | 获取转码配置 |
| `/v1/admin/transcode/config` | PATCH | 更新转码配置 |
| `/v1/admin/transcode/probe-devices` | GET | 探测本机编码设备 |
| `/v1/admin/transcode/device-pool` | GET | 设备池状态 |
| `/v1/admin/upgrade/config` | GET | 获取洗版配置 |
| `/v1/admin/upgrade/config` | PATCH | 更新洗版配置 |
| `/v1/admin/moviepilot/sites` | GET | MoviePilot 站点列表 |
| `/v1/admin/tasks` | GET | 全部任务列表（支持分页） |
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
  "itemId": "shelfdeck-item-uuid",
  "actionType": "transcode"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `itemId` | string | 是 | ShelfDeck 媒体项 ID |
| `actionType` | string | 是 | `transcode` / `delete` / `upgrade` |

**响应**：`201 Created`

```json
{
  "id": "task-001",
  "itemId": "shelfdeck-item-uuid",
  "actionType": "transcode",
  "status": "pending_manual",
  "progress": 0,
  "phase": null,
  "createdAt": "2026-04-26T10:00:00.000Z",
  "updatedAt": "2026-04-26T10:00:00.000Z",
  "itemName": "电影名称",
  "resumePoint": null,
  "logs": [
    { "seq": 1, "ts": "2026-04-26T10:00:00.000Z", "level": "info", "msg": "Task created" }
  ],
  "itemInfo": {
    "name": "电影名称",
    "itemId": "shelfdeck-item-uuid",
    "embyItemId": "emby-item-123",
    "path": "D:\\media\\movie.mkv",
    "subLibraryId": "sublib-001",
    "assetKey": "sublib-001:path:d:/media/movie",
    "externalRefs": {
      "emby": { "itemId": "emby-item-123", "serverId": "emby-server-1" }
    },
    "resolution": "3840x2160",
    "bitrate": 50000000,
    "size": 45000000000,
    "duration": 7200,
    "type": "Movie",
    "doubanRating": 4,
    "userRating": null
  }
}
```

| 附加字段 | 类型 | 说明 |
|---|---|---|
| `itemName` | string | 媒体项名称（从 `itemInfo.name` 或 `itemId` 回退） |
| `resumePoint` | string\|null | confirm 后恢复点（创建时始终为 null） |
| `logs` | array | 执行日志（创建时含一条 "Task created"） |
| `itemInfo` | object\|null | 从 media library 填充的 ShelfDeck 媒体项信息（library 中存在该项时填充，否则为 null），下游 Emby Id 位于 `itemInfo.embyItemId` / `itemInfo.externalRefs.emby.itemId` |

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

desktop 轮询任务状态（间隔 400ms）。返回完整 task 对象（与 §5.3 详情相同 shape）。

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
      "itemId": "shelfdeck-item-uuid",
      "actionType": "transcode",
      "status": "executing",
      "progress": 45,
      "phase": "transcode_encoding",
      "itemName": "电影名称",
      "resumePoint": null,
      "createdAt": "2026-04-26T10:00:00.000Z",
      "updatedAt": "2026-04-26T10:05:00.000Z",
      "logs": [
        { "seq": 1, "ts": "2026-04-26T10:00:00.000Z", "level": "info", "msg": "Task created" },
        { "seq": 2, "ts": "2026-04-26T10:00:01.000Z", "level": "info", "msg": "precheck 通过" }
      ],
      "itemInfo": {
        "name": "电影名称",
        "path": "D:\\media\\movie.mkv",
        "resolution": "3840x2160",
        "bitrate": 50000000
      }
    }
  ]
}
```

> 列表项与详情端点返回相同的完整 task 对象（含 `logs`、`itemInfo`、`itemName`、`resumePoint` 等全部字段）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 任务 ID |
| `itemId` | string | ShelfDeck 媒体项 ID |
| `actionType` | string | `transcode` / `delete` / `upgrade` |
| `status` | string | 调度状态（见 `TASK_SCHEDULER.md` §4） |
| `progress` | number | 进度 0-100 |
| `phase` | string | Flow 阶段（见各 Flow 文档），可为 null |
| `itemName` | string | 媒体项名称 |
| `resumePoint` | string\|null | confirm 后恢复点 |
| `createdAt` | string | 创建时间（ISO 8601） |
| `updatedAt` | string | 更新时间（ISO 8601） |

---

### 5.3 GET /v1/tasks/:id — 任务详情

**响应**：`200 OK`

```json
{
  "id": "task-001",
  "itemId": "shelfdeck-item-uuid",
  "actionType": "transcode",
  "status": "executing",
  "progress": 45,
  "phase": "transcode_encoding",
  "itemName": "电影名称",
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
| `resumePoint` | string\|null | confirm 后恢复点，无停泊时为 null |
| `itemName` | string | 媒体项名称 |
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
  "confirmed": true,
  "confirmData": { "selectedIndex": 0 }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `confirmed` | boolean | 是 | 必须为 `true` |
| `confirmData` | object | 否 | 用户选择数据（如 upgrade Flow 的种子选择 `selectedIndex`），写入 task 持久化 |

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
2. 若有 `confirmData`，先写入 task
3. 调用 `flow.confirmReceived()` → Flow 从 `resumePoint` 继续执行
4. status 改为 `queued`，调度器下次轮询接管

**错误**：

| 状态码 | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `confirmed` 不为 `true` |
| 404 | `NOT_FOUND` | 任务不存在 |
| 409 | `TASK_CONFLICT` | 任务状态不是 `awaiting_user_confirm` |

---

### 5.5 POST /v1/tasks/:id/actions/execute — 手动执行

手动触发任务进入调度。支持多种源状态的过渡。

**请求体**：无

**响应**：`200 OK`

```json
{
  "id": "task-001",
  "status": "queued",
  "updatedAt": "2026-04-26T10:01:00.000Z"
}
```

**行为（按源状态）**：

| 源 status | 目标 status | 说明 |
|---|---|---|
| `pending_manual` | `queued` | `executionMode = manual` 下的待确认任务 → 进入调度队列 |
| `interrupted` | `queued` | 中断任务 → 重新入队，调度器从 `resumePoint` 恢复 |
| `paused` | `queued` | 已暂停任务 → 重新入队，调度器从 `resumePoint` 恢复 |
| `pausing` | `executing` | 清除暂停请求标志，直接回到执行态（调度器 hash 循环接管） |
| 其他 | 不变 | 返回当前状态，无操作 |

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
- 始终先调用 `flow.cancel()` 清理资源（FFmpeg 进程、partial 文件等）
- 然后从 TaskStore 移除
- 不检查任务是否正在执行——任何状态的任务均可删除

**错误**：

| 状态码 | code | 场景 |
|---|---|---|
| 404 | `NOT_FOUND` | 任务不存在 |

---

### 5.8 GET /v1/tasks/:id/report — 任务完成报告

获取已完成任务的执行报告（含转码前后对比、空间节省等）。

**响应**：`200 OK`

```json
{
  "taskId": "task-001",
  "itemName": "电影名称",
  "actionType": "transcode",
  "elapsedSec": 123,
  "encoder": "hevc_nvenc",
  "original": {
    "sizeBytes": 45000000000,
    "videoCodec": "h264",
    "bitrate": 50000000,
    "width": 3840,
    "height": 2160,
    "audioCodec": "aac"
  },
  "output": {
    "sizeBytes": 15000000000,
    "videoCodec": "hevc",
    "bitrate": 16000000,
    "width": 3840,
    "height": 2160
  },
  "bytesSaved": 30000000000
}
```

> 返回结构因 `actionType` 而异：
> - `transcode`: 含 `original`、`output`、`bytesSaved`、`encoder`
> - `delete`: 含 `bytesFreed`
> - `upgrade`: 含 `original`、`output`、`bytesSaved`、`tmdbVerified`（如果有 `upgradePreview` 数据）

**错误**：

| 状态码 | code | 场景 |
|---|---|---|
| 400 | `BAD_REQUEST` | 任务未完成（status 不为 `done`） |
| 404 | `NOT_FOUND` | 任务不存在 |

---

### 5.9 GET /v1/tasks/:id/preview — 预览片段

返回转码/洗版完成的预览视频片段（`video/mp4`）。支持 HTTP Range 请求。

**响应**：`200 OK`（或 `206 Partial Content`）

- `Content-Type: video/mp4`
- `Content-Length: <fileSize>`
- 支持 `Range` header（HTTP 206 部分内容）

> 预览文件路径来自 `task.verifyResult.previewPath`。仅在任务完成后且验证结果含预览文件时可用。

**错误**：

| 状态码 | code | 场景 |
|---|---|---|
| 404 | `NOT_FOUND` | 预览不可用或文件不存在 |

---

## §6 媒体库端点

### 6.1 GET /v1/library — 媒体库列表

返回完整媒体库数据，含策略建议。响应自动附加 `embyWebUrl` 字段（用于 desktop 播放按钮）。

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
      "itemId": "shelfdeck-item-uuid",
      "subLibraryId": "sublib-001",
      "assetKey": "sublib-001:path:d:/media/movie",
      "name": "电影名称",
      "path": "D:\\media\\movie.mkv",
      "source": "emby",
      "sourceId": "emby-item-123",
      "externalRefs": {
        "emby": { "itemId": "emby-item-123", "serverId": "emby-server-1" }
      },
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
      "reason": "码率 50 Mbps 超出 5★ 4K 目标 25 Mbps",
      "embyWebUrl": "http://192.168.1.100:8096/web/index.html#!/item?id=emby-item-123"
    }
  ],
  "total": 150
}
```

> `embyWebUrl` 由 service 从 `embyServers` 配置中解析并附加到每个 item。
> MediaItem 字段完整定义见 `SERVICE/MEDIA_LIBRARY.md` §1.1。

---

### 6.2 GET /v1/library/queries/manage — 媒体库列表（manage 别名）

功能同 §6.1 `GET /v1/library`，返回完整媒体库数据含策略建议。供 desktop 媒体库展示页面使用。

**查询参数**：同 §6.1。

**响应**：`200 OK` — 同 §6.1（不含 `embyWebUrl` 附加字段）。

---

### 6.3 GET /v1/library/items/:itemId — 单项详情

**响应**：`200 OK`

```json
{
      "itemId": "shelfdeck-item-uuid",
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

### 6.4 PATCH /v1/library/ratings — 用户评分写入

**请求体**：

```json
{
  "itemId": "shelfdeck-item-uuid",
  "userRating": 4
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `itemId` | string | 是 | ShelfDeck 媒体项 ID |
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

### 6.5 POST /v1/library/actions/refresh — 手动刷新子库

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

### 6.6 POST /v1/library/actions/mark-played — 标记已观看

通过 Emby API 标记指定媒体项为已观看。

**请求体**：

```json
{
  "itemId": "shelfdeck-item-uuid",
  "subLibraryId": "sublib-001"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `itemId` | string | 是 | ShelfDeck 媒体项 ID |
| `subLibraryId` | string | 否 | 子库 UUID。未提供时从 library.json 查找 item 所属子库 |

**响应**：`200 OK`

```json
{
  "ok": true
}
```

**行为**：
1. 通过 `subLibraryId` 或 `itemId` 解析 Emby 服务器配置
2. 从 `externalRefs.emby.itemId` 解析当前 Emby Id，调用 `POST Emby /Users/{userId}/PlayedItems/{embyItemId}`
3. 记录 activity log

**错误**：

| 状态码 | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 缺少 `itemId` |
| 404 | `NOT_FOUND` | 子库不存在或无法确定 item 所属子库 |
| 502 | `EMBY_ERROR` | Emby API 调用失败 |

---

### 6.7 POST /v1/library/actions/mark-unplayed — 标记未观看

通过 Emby API 取消指定媒体项的已观看标记。

**请求体**：

```json
{
  "itemId": "shelfdeck-item-uuid",
  "subLibraryId": "sublib-001"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `itemId` | string | 是 | ShelfDeck 媒体项 ID |
| `subLibraryId` | string | 否 | 子库 UUID。未提供时从 library.json 查找 item 所属子库 |

**响应**：`200 OK`

```json
{
  "ok": true
}
```

**行为**：
1. 通过 `subLibraryId` 或 `itemId` 解析 Emby 服务器配置
2. 从 `externalRefs.emby.itemId` 解析当前 Emby Id，调用 `DELETE Emby /Users/{userId}/PlayedItems/{embyItemId}`

**错误**：

| 状态码 | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 缺少 `itemId` |
| 404 | `NOT_FOUND` | 子库不存在或无法确定 item 所属子库 |
| 502 | `EMBY_ERROR` | Emby API 调用失败 |

---

### 6.8 POST /v1/library/actions/recompute-strategy — 重算全库策略

立即触发全库策略重算（strategy engine 单次执行）。

**请求体**：无

**响应**：`200 OK`

```json
{
  "ok": true,
  "changed": 12
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `changed` | number | 策略发生变化的 item 数量 |

---

### 6.9 POST /v1/library/queries/played — 查询已观看历史

**v1 兼容端点**，已重定向为读取本地 `playback-log.json`。不再调用 Emby API。

**请求体**：

```json
{
  "subLibraryId": "sublib-001"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `subLibraryId` | string | 否 | 子库 UUID。不提供则返回全部日志 |

**响应**：`200 OK` — 返回 `playback-log.json` 中匹配 `subLibraryId` 的条目数组。

**行为**：
1. 读取本地 `data/playback-log.json`
2. 仅按 `subLibraryId` 过滤（若提供）
3. 不调用 Emby API
4. 不接受 `days`、`type`、`sectionId` 等其他筛选参数

> 新代码请使用 `GET /v1/library/playback-log`（§6.11）和 `POST /v1/library/playback-log/record`（§6.12）。

---

### 6.10 POST /v1/library/queries/unplayed — 查询未观看列表

从 Emby 实时查询未观看媒体项列表（不走 library.json 缓存）。

**请求体**：

```json
{
  "subLibraryId": "sublib-001",
  "sectionId": "sec-1"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `subLibraryId` | string | 是 | 子库 UUID |
| `sectionId` | string | 否 | Emby 媒体库 sectionId（默认使用子库配置的 sectionId） |

**响应**：`200 OK`

```json
[
  {
    "id": "item-abc123",
    "name": "电影名称",
    "sectionId": "sec-1",
    "posterTag": "abc123",
    "runTimeTicks": 75600000000,
    "durationSec": 7560,
    "sizeGb": 18.2,
    "resolution": "4K",
    "codec": "h264",
    "itemType": "Movie",
    "isBluRayDisc": false,
    "embyPlayed": false
  }
]
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | Emby 媒体项 ID |
| `name` | string | 媒体项名称 |
| `sectionId` | string | 所属 Emby 媒体库 ID |
| `posterTag` | string | 海报图片标签 |
| `runTimeTicks` | number | 时长（Emby ticks） |
| `durationSec` | number | 时长（秒） |
| `sizeGb` | number | 文件体积（GB） |
| `resolution` | string | 分辨率：`1080p` / `4K` |
| `codec` | string | 视频编码：`h264` / `h265` / `av1` |
| `itemType` | string | 类型：`Movie` / `Episode` / `Other` |
| `isBluRayDisc` | boolean | 是否为蓝光原盘 |
| `embyPlayed` | boolean | Emby 观看状态（此端点始终为 `false`） |

**行为**：
1. 通过 `subLibraryId` 解析 Emby 服务器配置
2. 调用 `GET Emby /Users/{userId}/Items?ParentId={sectionId}&Filters=IsUnplayed&IncludeItemTypes=Movie,Episode`
3. 提取媒体源信息（编码、分辨率、体积）

**错误**：

| 状态码 | code | 场景 |
|---|---|---|
| 404 | `NOT_FOUND` | 子库不存在 |
| 502 | `EMBY_ERROR` | Emby API 调用失败 |

---

### 6.11 GET /v1/library/playback-log — 播放日志

读取本地播放日志（`data/playback-log.json`）。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `subLibraryId` | string | 否 | 按子库 uuid 筛选 |

**响应**：`200 OK` — 返回匹配的播放日志条目数组。

```json
[
  {
    "itemId": "shelfdeck-item-uuid",
    "subLibraryId": "sublib-001",
    "itemName": "电影名称",
    "type": "Movie",
    "playedAt": "2026-04-26T10:30:00.000Z",
    "posterUrl": "http://...",
    "path": "D:\\media\\movie.mkv",
    "embyWebUrl": "http://...",
    "sectionName": "Movies"
  }
]
```

---

### 6.12 POST /v1/library/playback-log/record — 记录播放

写入一条播放记录到本地 `data/playback-log.json`。

**请求体**：

```json
{
  "itemId": "shelfdeck-item-uuid",
  "subLibraryId": "sublib-001",
  "itemName": "电影名称",
  "type": "Movie",
  "posterUrl": "http://...",
  "path": "D:\\media\\movie.mkv",
  "embyWebUrl": "http://...",
  "sectionName": "Movies"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `itemId` | string | 是 | ShelfDeck 媒体项 ID |
| `subLibraryId` | string | 是 | 子库 UUID |
| `itemName` | string | 否 | 媒体项名称 |
| `type` | string | 否 | 类型 (`Movie` / `Episode`) |
| `posterUrl` | string | 否 | 海报图片 URL |
| `path` | string | 否 | 文件路径 |
| `embyWebUrl` | string | 否 | Emby Web 播放 URL |
| `sectionName` | string | 否 | 所属媒体库名称 |

**响应**：`200 OK`

```json
{
  "ok": true
}
```

**行为**：
- 自动附加 `playedAt` 时间戳
- 去重：同一 `itemId` 已有记录时更新 `playedAt` 而非重复插入
- 持久化到 `data/playback-log.json`

---

### 6.13 GET /v1/library/status — 子库同步状态

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

### 6.14 POST /v1/library/cache — 批量写入 Emby 媒体数据

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
  "transcodeCpuParticipationStrategy": "normal",
  "moviepilot": {
    "baseUrl": "",
    "apiKey": "********",
    "savePath": "",
    "stagingPath": ""
  },
  "upgradeStagingLocalPath": "",
  "upgradeReplaceConfirmRequired": false,
  "upgradeRetryInterval": 3600000,
  "upgradeMaxRetries": 3,
  "embyServers": {},
  "subLibraries": [],
  "ruleTemplates": [],
  "douban": {
    "userId": "",
    "cookieHeader": "********"
  }
}
```

> 敏感字段（`apiKey`、`cookieHeader`、`embyUserPassword`）读取时返回 `"********"`。
> 完整字段定义见 `SERVICE/CONFIG.md` §3。
>
> **注意**：`mediaPolicy`（全局策略）已在 v2→v3 迁移时删除。策略逻辑迁移至 `ruleTemplates`（规则模板引擎），子库级策略通过 `ruleTemplateId` 引用模板。`mediaPolicy` 字段不在配置响应中。
> 旧版 `transcodeMaxCpuSlots` 同样已移除，由 `transcodeEncodingDevices` 中的 per-device `maxSlots` 替代。

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
> Admin 端点 `GET /v1/admin/health` 返回完整检查详情（8 项），见 `SERVICE/ADMIN_WEB/API.md` §6.1。

---

## §9 活动日志

### GET /v1/activity-log

获取近期活动日志（系统事件 + 用户操作）。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `limit` | number | 否 | 返回条数（1-50，默认 20） |

**响应**：`200 OK`

```json
{
  "entries": [
    {
      "ts": "2026-04-26T10:30:00.000Z",
      "type": "user_action",
      "message": "「电影名称」已标记为已看"
    }
  ]
}
```

---

## §10 空间统计

### GET /v1/space-stats

计算媒体库空间的统计信息（基于 library.json + tasks 状态 + config）。

**查询参数**：无

**响应**：`200 OK`

```json
{
  "totalSizeBytes": 500000000000,
  "managedSizeBytes": 350000000000,
  "activeTaskBytes": 50000000000,
  "potentialSavingsBytes": 150000000000
}
```

> 具体字段由 `spaceStats.computeSpaceStats()` 计算。

---

## §11 豆瓣集成

### 11.1 GET /v1/integrations/douban/fetch/ratings

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

### 11.2 GET /v1/integrations/douban/session — 获取豆瓣会话

获取当前豆瓣登录会话（cookie + userId）。

**响应**：`200 OK`

```json
{
  "cookieHeader": "********",
  "userId": "1234567",
  "interestsRssUrl": "https://www.douban.com/feed/people/..."
}
```

> `cookieHeader` 返回脱敏值。

---

### 11.3 PUT /v1/integrations/douban/session — 保存豆瓣会话

保存豆瓣登录凭证。

**请求体**：

```json
{
  "cookieHeader": "dbcl2=...; ck=...",
  "userId": "1234567",
  "interestsRssUrl": "https://www.douban.com/feed/people/1234567/interests"
}
```

**响应**：`200 OK` — 返回保存后的会话对象（`cookieHeader` 脱敏）。

**行为**：
- 持久化到 `data/douban-session.json`
- `interestsRssUrl` 会自动提取 `userId`（若提供了 url 但未提供 userId）

---

## §12 Admin 端点

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
| 规则模板 | `/v1/admin/rule-templates` | GET/POST | 规则模板列表 / 创建 |
| | `/v1/admin/rule-templates/:id` | GET/PUT/DELETE | 单个模板 CRUD |
| 转码设置 | `/v1/admin/transcode/config` | GET/PATCH | 转码配置 |
| | `/v1/admin/transcode/probe-devices` | GET | 探测编码设备 |
| | `/v1/admin/transcode/device-pool` | GET | 设备池状态 |
| 洗版设置 | `/v1/admin/upgrade/config` | GET/PATCH | 洗版配置 |
| | `/v1/admin/moviepilot/sites` | GET | MoviePilot 站点列表 |
| 任务监控 | `/v1/admin/tasks` | GET | 全部任务列表（分页） |
| | `/v1/admin/tasks/:id` | GET/DELETE | 任务详情 / 删除 |
| 健康检查 | `/v1/admin/health` | GET | 服务健康详情（8 项检查） |

---

## §13 API 版本策略

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
