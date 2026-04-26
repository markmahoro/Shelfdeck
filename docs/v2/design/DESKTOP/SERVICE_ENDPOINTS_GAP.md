# DESIGN_DESKTOP/SERVICE_ENDPOINTS_GAP — 待补端点交接

> 状态：v2 交接文档
> 接收方：service 端实施
> 说明：以下 4 个端点 desktop 端已设计调用方，但 service 端尚未注册路由和实现逻辑

---

## §1 缺失端点清单

| # | 方法 | 端点 | 用途 | desktop 调用页面 |
|---|------|------|------|-----------------|
| 1 | POST | `/v1/library/actions/mark-played` | 标记媒体项为已观看 | WallPage, MediaManagePage, HistoryPage |
| 2 | POST | `/v1/library/actions/mark-unplayed` | 标记媒体项为未观看 | WallPage, MediaManagePage, HistoryPage |
| 3 | POST | `/v1/library/queries/played` | 查询已观看历史 | HistoryPage |
| 4 | POST | `/v1/library/queries/unplayed` | 查询未观看列表 | WallPage |

---

## §2 端点详情

### 2.1 mark-played

```
POST /v1/library/actions/mark-played
Content-Type: application/json
X-API-Key: <apiKey>

Request:
{
  "config": {
    "baseUrl": "http://192.168.1.100:8096",
    "apiKey": "xxx",
    "userId": "user-uuid"
  },
  "itemId": "item-abc123"
}

Response (200):
{
  "ok": true
}

Error (4xx/5xx):
{
  "error": { "code": "EMBY_UNREACHABLE", "message": "..." }
}
```

**service 需要做的**：
1. `app.js`：注册路由 `POST /v1/library/actions/mark-played`
2. 调用 `embyService.markPlayed(config, itemId)` → `POST Emby /Users/{userId}/PlayedItems/{itemId}`
3. 成功返回 `{ ok: true }`

---

### 2.2 mark-unplayed

```
POST /v1/library/actions/mark-unplayed
Content-Type: application/json
X-API-Key: <apiKey>

Request:
{
  "config": {
    "baseUrl": "http://192.168.1.100:8096",
    "apiKey": "xxx",
    "userId": "user-uuid"
  },
  "itemId": "item-abc123"
}

Response (200):
{
  "ok": true
}
```

**service 需要做的**：
1. `app.js`：注册路由
2. 调用 `embyService.markUnplayed(config, itemId)` → `DELETE Emby /Users/{userId}/PlayedItems/{itemId}`
3. 成功返回 `{ ok: true }`

---

### 2.3 queries/played

```
POST /v1/library/queries/played
Content-Type: application/json
X-API-Key: <apiKey>

Request:
{
  "config": {
    "baseUrl": "http://192.168.1.100:8096",
    "apiKey": "xxx",
    "userId": "user-uuid"
  },
  "days": 30,             // 7 | 30 | 0（0=不限天数）
  "type": "Movie",        // "all" | "Movie" | "Episode"，可选
  "sectionId": "sec-1"    // 媒体库 sectionId，可选（不传=全部）
}

Response (200):
[
  {
    "id": "item-abc123",
    "name": "电影名称",
    "type": "Movie",
    "datePlayed": "2026-04-20T10:30:00.000Z",
    "sectionId": "sec-1",
    "sectionName": "Movies",
    "posterTag": "abc123",
    "seriesName": "连续剧名称",     // 仅 Episode 类型
    "indexLabel": "S01E01"         // 仅 Episode 类型
  }
]
```

**service 需要做的**：
1. `app.js`：注册路由
2. 调用 `embyService.getPlayedItems(config, { days, type, sectionId })`
3. 按 `days` 参数过滤 Emby 返回结果（Emby API 返回全量，需自行按 `datePlayed` 过滤）
4. 按 `type` 参数过滤（Movie / Episode）
5. 按 `sectionId` 参数过滤

---

### 2.4 queries/unplayed

```
POST /v1/library/queries/unplayed
Content-Type: application/json
X-API-Key: <apiKey>

Request:
{
  "config": {
    "baseUrl": "http://192.168.1.100:8096",
    "apiKey": "xxx",
    "userId": "user-uuid"
  },
  "sectionId": "sec-1"    // 媒体库 sectionId，必传
}

Response (200):
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

**service 需要做的**：
1. `app.js`：注册路由
2. 调用 `embyService.getUnplayedItems(config, sectionId)`
3. 返回的每个 item 需包含：id, name, sectionId, durationSec, sizeGb, resolution, codec, itemType, isBluRayDisc

---

## §3 实现指南

### 3.1 需要修改的文件

| 文件 | 改动 |
|------|------|
| `media-service/src/app.js` | 注册 4 条路由 |
| `media-service/src/services/embyService.js` | 新增 `markPlayed()`, `markUnplayed()`, `getPlayedItems()`, `getUnplayedItems()` |

### 3.2 Emby API 映射

| service 函数 | Emby API | 文档参考 |
|-------------|----------|----------|
| `markPlayed(config, itemId)` | `POST /Users/{userId}/PlayedItems/{itemId}` | Emby REST API |
| `markUnplayed(config, itemId)` | `DELETE /Users/{userId}/PlayedItems/{itemId}` | Emby REST API |
| `getPlayedItems(config, filters)` | `GET /Users/{userId}/Items?Recursive=true&Filters=IsPlayed&IncludeItemTypes=Movie,Episode&fields=DatePlayed,MediaSources` | Emby REST API |
| `getUnplayedItems(config, sectionId)` | `GET /Users/{userId}/Items?ParentId={sectionId}&Recursive=true&Filters=IsUnplayed&IncludeItemTypes=Movie,Episode&fields=MediaSources` | Emby REST API |

### 3.3 认证方式

所有 4 个端点需要 precheck（即 `POST /v1/emby/actions/test-connection` 已通过的 config）。service 端使用 config 中的 `apiKey` 访问 Emby API。

### 3.4 错误处理

| 场景 | HTTP 状态 | error.code |
|------|-----------|------------|
| Emby 不可达 | 502 | `EMBY_UNREACHABLE` |
| config 缺失必填字段 | 400 | `INVALID_CONFIG` |
| Emby 返回错误 | 502 | `EMBY_ERROR` |
| itemId 不存在 | 404 | `ITEM_NOT_FOUND` |

---

## §4 desktop 侧调用参考

当前 desktop 的 preload.js 已定义了这些调用（作为 reference）：

```javascript
// preload.js - 现有调用方

// mark-played
markPlayed: (args) =>
  cpJson('/v1/library/actions/mark-played', { method: 'POST', body: JSON.stringify(args) }),

// mark-unplayed
markUnplayed: (args) =>
  cpJson('/v1/library/actions/mark-unplayed', { method: 'POST', body: JSON.stringify(args) }),

// queries/played
getPlayedItems: (args) =>
  cpJson('/v1/library/queries/played', { method: 'POST', body: JSON.stringify(args) }),

// queries/unplayed
getUnplayedItems: (args) =>
  cpJson('/v1/library/queries/unplayed', { method: 'POST', body: JSON.stringify(args) }),
```

---

## §5 Desktop 端被阻塞功能清单

以下功能 service 端点就绪后，desktop 端即可启用。每个功能标注了 blocked by（哪个端点）、desktop 代码位置、以及需要做的改动。

### 5.1 海报墙（WallPage）

| 状态 | 说明 |
|------|------|
| **当前状态** | 空壳页面，显示"暂未获取到未观看内容" |
| **blocked by** | `POST /v1/library/queries/unplayed` |
| **代码位置** | `src/pages/WallPage.tsx` |

**端点就绪后 desktop 需要做的**：

1. 在 `api/client.ts` 新增 `getUnplayedItems(config, sectionId)` 方法，调用 `POST /v1/library/queries/unplayed`
2. `WallPage` 的 `useEffect` 改为实际请求数据，不再直接 `setLoading(false)`
3. 实现海报墙卡片渲染（名称、分辨率、编码、体积、策略操作按钮）
4. 实现打星评分（调用已存在的 `PATCH /v1/library/ratings`）
5. 实现一键入队（调用已存在的 `POST /v1/tasks`）

### 5.2 播放记录（HistoryPage）

| 状态 | 说明 |
|------|------|
| **当前状态** | 空壳页面，显示"暂无播放记录" |
| **blocked by** | `POST /v1/library/queries/played` |
| **代码位置** | `src/pages/HistoryPage.tsx` |

**端点就绪后 desktop 需要做的**：

1. 在 `api/client.ts` 新增 `getPlayedItems(config, filters)` 方法，调用 `POST /v1/library/queries/played`
2. `HistoryPage` 的 `useEffect` 改为实际请求数据
3. 实现日期/类型/媒体库筛选逻辑（目前仅为 UI 骨架）
4. 实现标记已看/未看按钮（调用 mark-played/mark-unplayed）

### 5.3 标记已看 / 未看（全页面）

| 状态 | 说明 |
|------|------|
| **当前状态** | 按钮渲染但 `onWatchChange` 回调为空函数（`// TODO`） |
| **blocked by** | `POST /v1/library/actions/mark-played`、`POST /v1/library/actions/mark-unplayed` |
| **代码位置** | `src/pages/MediaManagePage.tsx`（第 181-183 行）、`src/pages/WallPage.tsx`、`src/pages/HistoryPage.tsx` |

**端点就绪后 desktop 需要做的**：

1. 在 `api/client.ts` 新增 `markPlayed(itemId)`、`markUnplayed(itemId)` 方法
2. 替换所有页面中 `onWatchChange` 的 TODO 空函数为实际 API 调用
3. 调用成功后刷新当前列表（重新拉取数据以反映最新观看状态）

### 5.4 watched 字段

| 状态 | 说明 |
|------|------|
| **当前状态** | `coerceManagedItem` 中硬编码 `watched: false` |
| **blocked by** | service `GET /v1/library` 响应目前不含观看状态字段 |
| **代码位置** | `src/pages/MediaManagePage.tsx` `coerceManagedItem` 函数 |

**service 就绪后 desktop 需要做的**：

1. 若 service 在 library 响应中新增 `watched` 字段，修改 `coerceManagedItem` 映射 `watched: Boolean(o.watched)`

---

## §6 GET /v1/library 响应字段增强（建议）

以下字段 desktop 目前硬编码或无法展示，若 service 在 `GET /v1/library` 响应中补充，desktop 可移除硬编码并展示更准确的信息：

| 字段 | 当前 desktop 行为 | 建议 service 返回 |
|------|------------------|-------------------|
| `codec` | 硬编码为 `'h265'` | 返回实际编码格式（h264/h265/av1），从 Emby MediaSources 获取或 ffprobe |
| `targetBitrate` | 不展示（显示 `—`） | 由 `mediaPolicyService` 计算的目标码率（Mbps） |
| `predictedSizeGb` | 不展示（显示 `—`） | 按策略目标码率估算的转码后体积（GB） |
| `watched` | 硬编码为 `false` | 从 Emby UserData 获取观看状态 |

> **优先级**：`codec` 和 `watched` 为高优先级（用户可见信息缺失），`targetBitrate` 和 `predictedSizeGb` 为中优先级（表格列显示 `—` 不影响核心功能）。

---

## §7 Desktop 端代码 TODO 索引

供 service 就绪后快速定位需要改动的代码位置：

| 文件 | 行位置 | 标记 | 说明 |
|------|--------|------|------|
| `src/pages/WallPage.tsx` | 第 22-28 行 | `useEffect` 空壳 | 等待 `queries/unplayed` 端点 |
| `src/pages/HistoryPage.tsx` | 第 30-43 行 | `useEffect` 空壳 | 等待 `queries/played` 端点 |
| `src/pages/MediaManagePage.tsx` | 第 181 行 | `// TODO` | 等待 mark-played/mark-unplayed 端点 |
| `src/api/client.ts` | — | 缺少 4 个方法 | 需新增 `markPlayed`/`markUnplayed`/`getPlayedItems`/`getUnplayedItems` |
| `src/pages/MediaManagePage.tsx` | `coerceManagedItem` | `watched: false` | 等待 service 返回 watched 字段 |

---

## 关联文档

- `DESKTOP/UI.md` §5.6 — 完整端点汇总表
- `SERVICE/API.md` — REST API 契约（SSOT）
- `SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER.md` — Emby 适配器设计
