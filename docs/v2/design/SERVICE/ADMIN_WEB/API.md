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
      "ruleTemplateId": "default",
      "upgradeSmartSelect": false
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
  "ruleTemplateId": "default",
  "upgradeSmartSelect": false
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 子库名称 |
| `embyServerId` | string | 是 | Emby 服务器 uuid |
| `sectionId` | string | 是 | Emby 媒体库 section ID |
| `source` | string | 否 | 来源：`emby` |
| `doubanEnabled` | boolean | 否 | 启用豆瓣同步（默认 true） |
| `ruleTemplateId` | string | 否 | 策略规则模板 ID（默认 `"default"`） |
| `upgradeSmartSelect` | boolean | 否 | 洗版智能选种（默认 false） |
| `mediaPolicy` | object | 否 | **已废弃**（v2→v3 迁移后删除）。请使用 `ruleTemplateId` 替代 |

> `embyServerId` 若为新服务器 uuid（在 Step 1 中通过 `POST /v1/admin/emby/test` 内联注册得到），则在创建子库时一并写入 `embyServers`。

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
  "ruleTemplateId": "custom-template-1",
  "upgradeSmartSelect": true
}
```

**响应**：`200 OK` + 更新后的子库对象。

**错误**：

| 状态码 | 场景 |
|---|---|
| 404 | 子库不存在 |

---

### 2.6 规则模板管理 API

#### GET /v1/admin/rule-templates

获取所有规则模板列表。

**响应**：

```json
{
  "ruleTemplates": [
    {
      "id": "default",
      "name": "默认策略",
      "description": "内置默认策略模板",
      "rules": [
        {
          "action": "transcode",
          "condition": { "field": "bitrate", "op": "gt", "value": 25000000 }
        }
      ]
    }
  ]
}
```

---

#### GET /v1/admin/rule-templates/:id

获取单个规则模板。

**响应**：`200 OK` — 返回模板对象。

**错误**：

| 状态码 | 场景 |
|---|---|
| 404 | 模板不存在 |

---

#### POST /v1/admin/rule-templates

创建新规则模板。

**请求体**：

```json
{
  "id": "my-template",
  "name": "我的策略",
  "description": "自定义策略模板",
  "rules": [
    { "action": "keep", "condition": { "field": "doubanRating", "op": "gte", "value": 4 } }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 模板唯一标识 |
| `name` | string | 是 | 模板名称 |
| `description` | string | 否 | 模板描述 |
| `rules` | array | 否 | 规则列表 |

**响应**：`201 Created` + 创建的模板对象。

**错误**：

| 状态码 | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `id` 或 `name` 缺失 |
| 409 | `CONFLICT` | 模板 id 已存在 |

---

#### PUT /v1/admin/rule-templates/:id

全量或部分更新规则模板。

**请求体**（所有字段可选）：

```json
{
  "name": "新名称",
  "description": "新描述",
  "rules": []
}
```

**响应**：`200 OK` + 更新后的模板对象。

**错误**：

| 状态码 | 场景 |
|---|---|
| 404 | 模板不存在 |

---

#### DELETE /v1/admin/rule-templates/:id

删除规则模板。

**响应**：`200 OK`

```json
{
  "ok": true,
  "id": "my-template"
}
```

> 内置 `default` 模板不可删除。

**错误**：

| 状态码 | 场景 |
|---|---|
| 400 | 尝试删除 `default` 模板 |
| 404 | 模板不存在 |

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
  "transcodeEncodingDevices": [
    { "stableKey": "nvenc:0", "backend": "nvenc", "gpuIndex": 0, "maxSlots": 2, "priority": 100 }
  ],
  "transcodeCpuParticipationStrategy": "normal"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `transcodeTempRoot` | string | 转码临时目录 |
| `transcodeReplaceConfirmRequired` | boolean | 替换前是否需要用户确认 |
| `ffmpegPath` | string | FFmpeg 路径 |
| `ffprobePath` | string | ffprobe 路径 |
| `transcodeEncodingDevices` | array | 编码设备池配置（per-device `maxSlots` + `priority`） |
| `transcodeCpuParticipationStrategy` | string | CPU 参与策略：`normal` |

> 完整字段定义见 `SERVICE/CONFIG.md` §3.2。
>
> **注意**：旧版 `transcodeMaxCpuSlots` 已移除，CPU 并发槽位现由 `transcodeEncodingDevices` 中 per-device `maxSlots` 控制。

---

### 3.2 PATCH /v1/admin/transcode/config

部分更新转码配置。

**请求体**：

```json
{
  "transcodeTempRoot": "D:\\transcode",
  "ffmpegPath": "D:\\tools\\ffmpeg.exe",
  "transcodeEncodingDevices": [
    { "stableKey": "nvenc:0", "backend": "nvenc", "gpuIndex": 0, "maxSlots": 1, "priority": 100 }
  ]
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

## §4 洗版设置（MoviePilot）

### 4.1 GET /v1/admin/upgrade/config

获取当前洗版/MoviePilot 配置。`apiKey` 字段返回脱敏值 `********`。

**响应**：

```json
{
  "moviepilot": {
    "baseUrl": "http://192.168.1.100:3000",
    "apiKey": "********",
    "savePath": "/vol1/1000/media_download/shelfdeck",
    "stagingPath": ""
  },
  "upgradeStagingLocalPath": "W:\\shelfdeck",
  "upgradeReplaceConfirmRequired": false,
  "upgradeRetryInterval": 3600000,
  "upgradeMaxRetries": 3
}
```

| 新增字段 | 类型 | 说明 |
|---|---|---|
| `upgradeReplaceConfirmRequired` | boolean | 洗版替换前是否需要用户确认（默认 false） |

---

### 4.2 PATCH /v1/admin/upgrade/config

部分更新洗版配置。仅传入需要变更的字段。`apiKey` 在保存时以明文传入，查询时脱敏返回。

**请求体**：

```json
{
  "moviepilot": {
    "baseUrl": "http://192.168.1.100:3000",
    "apiKey": "new-api-token",
    "savePath": "/downloads/shelfdeck",
    "stagingPath": ""
  },
  "upgradeStagingLocalPath": "Y:\\staging",
  "upgradeReplaceConfirmRequired": true,
  "upgradeRetryInterval": 7200000,
  "upgradeMaxRetries": 5
}
```

**响应**：同 `GET /v1/admin/upgrade/config`（apiKey 脱敏）。

**配置字段**（详见 `SERVICE/CONFIG.md` §3.3）：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `moviepilot.baseUrl` | string | `""` | MoviePilot 服务地址 |
| `moviepilot.apiKey` | string | `""` | API Token |
| `moviepilot.savePath` | string | `""` | 容器内下载目录 |
| `moviepilot.stagingPath` | string | `""` | 容器内 Staging 目录（可选）|
| `upgradeStagingLocalPath` | string | `""` | 本地 Staging 路径 |
| `upgradeReplaceConfirmRequired` | boolean | `false` | 洗版替换前是否需要用户确认 |
| `upgradeRetryInterval` | number | 3600000 | 重搜间隔 (ms) |
| `upgradeMaxRetries` | number | 3 | 最大重试次数 |

---

### 4.3 GET /v1/admin/moviepilot/sites

获取 MoviePilot 已配置的下载站点列表。

**查询参数**：无

**响应**：`200 OK`

```json
[
  { "id": "site-1", "name": "站点A", "domain": "site-a.com", "is_active": true },
  { "id": "site-2", "name": "站点B", "domain": "site-b.com", "is_active": false }
]
```

> 需要 MoviePilot 已配置 `baseUrl` + `apiKey`。若 MoviePilot 不可达，返回空数组 `[]`。

---

## §5 任务监控

### 5.1 GET /v1/admin/tasks

列出所有任务（含 flowState）。支持分页和关键词搜索。

**查询参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `status` | string | 按 status 筛选 |
| `actionType` | string | 按 actionType 筛选（`transcode`/`delete`/`upgrade`） |
| `q` | string | 关键词搜索（匹配 `itemName` 或 `itemId`） |
| `page` | number | 页码（默认 1） |
| `pageSize` | number | 每页条数（1-100，默认 20） |

**响应**：

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
  },
  "page": 1,
  "pageSize": 20,
  "total": 10
}
```

| 分页字段 | 类型 | 说明 |
|---|---|---|
| `page` | number | 当前页码 |
| `pageSize` | number | 每页条数 |
| `total` | number | 符合筛选条件的任务总数（未分页前） |

> `summary.total` 和 `summary.byStatus` 均为未分页前的全量统计。
> 完整 status/phase 定义见 `SERVICE/TASK_SCHEDULER.md`。

---

### 5.2 GET /v1/admin/tasks/:id

获取单个任务详情。

**响应**：

```json
{
  "id": "task-001",
  "itemId": "shelfdeck-item-uuid",
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

### 5.3 DELETE /v1/admin/tasks/:id

删除任务。

**响应**：`200 OK`

```json
{
  "ok": true,
  "id": "task-001"
}
```

**行为**：
- 始终先调用 `flow.cancel()` 清理资源
- 然后从 TaskStore 移除
- 任何状态的任务均可删除

**错误**：

| 状态码 | 场景 |
|---|---|
| 404 | 任务不存在 |

---

## §6 服务健康状态

### 6.1 GET /v1/admin/health

获取 service 健康状态详情（admin 专属，比 `/v1/health` 更详细）。返回 8 项检查结果。

**响应**：

```json
{
  "status": "yellow",
  "checks": {
    "scheduler":    { "status": "green", "runningTasks": 2 },
    "smartTask":    { "status": "green" },
    "mediaLib":     { "status": "green", "itemCount": 1500 },
    "douban":       { "status": "green", "hasSession": true, "doubanEnabledSubLibCount": 2 },
    "strategy":     { "status": "green" },
    "emby":         { "status": "yellow", "message": "所有 Emby 服务器响应偏慢" },
    "upgrade":      { "status": "green", "moviepilotConfigured": true },
    "transcode":    { "status": "green" }
  },
  "timestamp": "2026-04-26T10:00:00.000Z"
}
```

| 检查项 | 说明 |
|---|---|
| `scheduler` | 任务调度器状态（runningTasks 计数） |
| `smartTask` | 智能任务引擎状态 |
| `mediaLib` | 媒体库状态（itemCount 等） |
| `douban` | 豆瓣集成状态（hasSession、doubanEnabledSubLibCount） |
| `strategy` | 策略引擎状态 |
| `emby` | Emby 服务器连接状态（多服务器聚合 green/yellow/red） |
| `upgrade` | MoviePilot 连接状态 |
| `transcode` | 转码服务状态 |

> 聚合规则：全部 green → green；含 yellow 但无 red → yellow；含 red → red。
> 详细定义见 `SERVICE/HEALTH_CHECK.md`。

---

## §7 端点索引

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
| `/v1/admin/rule-templates` | GET | 获取规则模板列表 | ConfigStore |
| `/v1/admin/rule-templates` | POST | 创建规则模板 | ConfigStore |
| `/v1/admin/rule-templates/:id` | GET | 获取单个规则模板 | ConfigStore |
| `/v1/admin/rule-templates/:id` | PUT | 更新规则模板 | ConfigStore |
| `/v1/admin/rule-templates/:id` | DELETE | 删除规则模板 | ConfigStore |
| `/v1/admin/transcode/config` | GET | 获取转码配置 | ConfigStore |
| `/v1/admin/transcode/config` | PATCH | 更新转码配置 | ConfigStore |
| `/v1/admin/transcode/probe-devices` | GET | 探测本机可用编码设备 | TranscodeService |
| `/v1/admin/transcode/device-pool` | GET | 获取设备池状态 | TranscodeService |
| `/v1/admin/upgrade/config` | GET | 获取洗版配置 | ConfigStore |
| `/v1/admin/upgrade/config` | PATCH | 更新洗版配置 | ConfigStore |
| `/v1/admin/moviepilot/sites` | GET | 获取 MoviePilot 站点列表 | MoviePilotService |
| `/v1/admin/tasks` | GET | 列出所有任务（分页 + 搜索） | TaskStore |
| `/v1/admin/tasks/:id` | GET | 获取任务详情 | TaskStore |
| `/v1/admin/tasks/:id` | DELETE | 删除任务 | TaskStore |
| `/v1/admin/health` | GET | 服务健康详情（8 项检查） | HealthCheck |

---

## §8 关联文档

- `SERVICE/ADMIN_WEB.md` — Web 管理端总览
- `SERVICE/ADMIN_WEB/PAGES.md` — 页面结构与组件
- `SERVICE/CONFIG.md` — 配置字段定义
- `SERVICE/TASK_SCHEDULER.md` — status/phase 定义
- `SERVICE/HEALTH_CHECK.md` — 健康检查详细设计
- `openapi.yaml` — 机器可读形式化（未来由本文档导出）
