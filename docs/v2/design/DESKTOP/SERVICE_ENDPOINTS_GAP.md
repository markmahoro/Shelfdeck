# DESIGN_DESKTOP/SERVICE_ENDPOINTS_GAP — 待补端点交接

> 状态：v2 实施中
> 最后更新：2026-04-27
> 说明：以下 4 个端点已于 2026-04-27 实现。§5（desktop 阻塞功能）已解除阻塞并实现。

---

## §1 缺失端点清单

| # | 方法 | 端点 | 用途 | 状态 |
|---|------|------|------|------|
| 1 | POST | `/v1/library/actions/mark-played` | 标记媒体项为已观看 | ✅ 已实现 |
| 2 | POST | `/v1/library/actions/mark-unplayed` | 标记媒体项为未观看 | ✅ 已实现 |
| 3 | POST | `/v1/library/queries/played` | 查询已观看历史 | ✅ 已实现 |
| 4 | POST | `/v1/library/queries/unplayed` | 查询未观看列表 | ✅ 已实现 |

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

## §3 实现记录（2026-04-27）

### 3.1 已修改文件

| 文件 | 改动 |
|------|------|
| `media-service/src/app.js` | 注册 4 条路由 + 2 个 helper（`resolveEmbyConfigForLibrary`、`resolveEmbyConfigForItem`） |
| `media-service/src/services/embyService.js` | 新增 `markPlayed()`, `markUnplayed()`, `getPlayedItems()`, `getUnplayedItems()` |
| `media-desktop/src/api/client.ts` | 新增 `markPlayed()`, `markUnplayed()`, `getPlayedItems()`, `getUnplayedItems()` + `PlayedItem`/`UnplayedItem` 类型 |
| `media-desktop/src/pages/WallPage.tsx` | 完整重写：调用 `getUnplayedItems` 获取数据，支持入队 + 标记已看 |
| `media-desktop/src/pages/HistoryPage.tsx` | 完整重写：调用 `getPlayedItems` 获取数据，支持筛选 + 标记未看 |
| `media-desktop/src/pages/MediaManagePage.tsx` | `onWatchChange` 调用 `markPlayed`/`markUnplayed`，乐观更新本地 watched 状态 |
| `docs/v2/design/SERVICE/API.md` | 新增 §6.5-§6.8 端点文档 |

### 3.2 API 设计调整

交接文档原始设计要求 desktop 传递完整 Emby `config` 对象（`baseUrl` + `apiKey` + `userId`）。实际实现改为 **传递 `subLibraryId`**，由 service 内部解析 Emby 服务器配置。理由：

- desktop 不应持有 Emby 凭证（`GET /v1/config` 已 mask 敏感字段）
- 与现有端点模式一致（`POST /v1/library/actions/refresh`、`GET /v1/library` 均使用 `subLibraryId`）
- 减少 desktop→service 的冗余数据传递

### 3.3 Emby API 映射

| service 函数 | Emby API |
|-------------|----------|
| `markPlayed(config, itemId)` | `POST /Users/{userId}/PlayedItems/{itemId}` |
| `markUnplayed(config, itemId)` | `DELETE /Users/{userId}/PlayedItems/{itemId}` |
| `getPlayedItems(config, filters)` | `GET /Users/{userId}/Items?Recursive=true&Filters=IsPlayed&IncludeItemTypes=Movie,Episode&Fields=DatePlayed,MediaSources` |
| `getUnplayedItems(config, sectionId)` | `GET /Users/{userId}/Items?ParentId={sectionId}&Recursive=true&Filters=IsUnplayed&IncludeItemTypes=Movie,Episode&Fields=...` |

### 3.4 错误处理

| 场景 | HTTP 状态 | error.code |
|------|-----------|------------|
| Emby 不可达 / Emby 返回错误 | 502 | `EMBY_ERROR` |
| 缺少必填字段（如 `itemId`） | 400 | `VALIDATION_ERROR` |
| 子库不存在 | 404 | `NOT_FOUND` |

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

## §5 Desktop 端阻塞功能状态

### 5.1 海报墙（WallPage）— ✅ 已解除阻塞

| 项目 | 说明 |
|------|------|
| **状态** | ✅ 已实现（2026-04-27） |
| **代码位置** | `src/pages/WallPage.tsx` |
| **实现内容** | `useEffect` → `apiClient.getUnplayedItems(subLibraryId)`；支持入队（`POST /v1/tasks`）+ 标记已看（`POST /v1/library/actions/mark-played`） |

### 5.2 播放记录（HistoryPage）— ✅ 已解除阻塞

| 项目 | 说明 |
|------|------|
| **状态** | ✅ 已实现（2026-04-27） |
| **代码位置** | `src/pages/HistoryPage.tsx` |
| **实现内容** | `useEffect` → `apiClient.getPlayedItems(subLibraryId, filters)`；支持日期/类型筛选 + 标记未看（`POST /v1/library/actions/mark-unplayed`） |

### 5.3 标记已看 / 未看（全页面）— ✅ 已解除阻塞

| 项目 | 说明 |
|------|------|
| **状态** | ✅ 已实现（2026-04-27） |
| **代码位置** | `MediaManagePage.tsx`、`WallPage.tsx`、`HistoryPage.tsx` |
| **实现内容** | `apiClient.markPlayed()` / `apiClient.markUnplayed()` 已接入，`onWatchChange` 已实现乐观更新 |

### 5.4 watched 字段 — ✅ 已实现

| 项目 | 说明 |
|------|------|
| **状态** | ✅ 已实现（2026-04-27） |
| **实现内容** | `embyService.extractItemFields` → 提取 `UserData.Played` → `watched`；`mediaLibraryService.upsertItems` → 持久化 `watched` 到 library.json；desktop `coerceManagedItem` → `watched: Boolean(o.watched)` |

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

## §7 Desktop 端代码 TODO 索引（更新于 2026-04-27）

| 文件 | 位置 | 标记 | 状态 |
|------|------|------|------|
| `src/pages/WallPage.tsx` | `useEffect` → `apiClient.getUnplayedItems` | — | ✅ 已实现 |
| `src/pages/HistoryPage.tsx` | `useEffect` → `apiClient.getPlayedItems` | — | ✅ 已实现 |
| `src/pages/MediaManagePage.tsx` | `onWatchChange` → `apiClient.markPlayed/markUnplayed` | — | ✅ 已实现 |
| `src/api/client.ts` | `markPlayed`/`markUnplayed`/`getPlayedItems`/`getUnplayedItems` | — | ✅ 已实现 |
| `src/pages/MediaManagePage.tsx` | `coerceManagedItem` | `watched: Boolean(o.watched)` | ✅ 已实现（2026-04-27） |

---

## 关联文档

- `DESKTOP/UI.md` §5.6 — 完整端点汇总表
- `SERVICE/API.md` — REST API 契约（SSOT）
- `SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER.md` — Emby 适配器设计
