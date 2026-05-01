# DESIGN_SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER — Emby 数据拉取适配器

> v4 定稿。
> 参考：`ref/architecture/ARCH_INTEGRATIONS.md`
> 实现：`embyService.js`

---

## §1 职责定位

EmbyAdapter 是 MediaLibraryService 内部组件，负责从 Emby 拉取媒体数据并返回给协调层。**不直接写 `library.json`**，写操作由 `mediaLibraryService.js` 统一完成。

**调用链**：
```
MediaLibraryService 子库定时器触发
    │
    → EmbyAdapter.getLibraryItems(serverConfig, sectionId)
    │       └── serverConfig: embyServers["<uuid>"]
    │       └── sectionId: subLibrary.sectionId
    │       └── HTTP GET Emby /Items → 返回媒体项原始列表
    │
    → mediaLibraryService.upsertItems(items)
    │       └── 写入 library.json（关联 subLibraryId）+ 策略重算
```

---

## §2 核心接口

> v2 更新：所有函数接受 `serverConfig` 参数（对应 `embyServers["<uuid>"]`），支持多服务器。

### 2.1 媒体库数据拉取

| 函数 | 对应 Emby API | 说明 |
|---|---|---|
| `getLibraryItems(serverConfig, sectionId)` | `GET /Users/{userId}/Items`（ParentId=sectionId） | 拉取指定 section 的媒体项列表。若 `serverConfig.userId` 未配置，自动从 `getUsers()` 返回的第一个用户获取 userId。 |
| `getItemById(serverConfig, itemId)` | `GET /Users/{userId}/Items/{itemId}` | 按 ID 获取单个媒体项详情 |
| `libraryItemExists(serverConfig, itemId)` | `GET /Users/{userId}/Items/{itemId}` | 本地判断 item 是否在 Emby 库中存在 |
| `getItem(serverConfig, itemId)` | `GET /Users/{userId}/Items/{itemId}` | 同 getItemById，额外传入 Fields 参数获取完整字段（用于 mark-played 反查） |

### 2.2 删除操作

| 函数 | 对应 Emby API | 说明 |
|---|---|---|
| `deleteLibraryItem(serverConfig, itemId)` | `DELETE /Items/{itemId}` | 删除 Emby 媒体项（由 DeleteFlowExecutor 调用）。支持用户密码认证（`embyUserPassword`）获取 AccessToken 后删除。 |
| `getItemDeleteInfo(serverConfig, itemId)` | `GET /Items/{itemId}/DeleteInfo` | 返回删除前确认信息（文件名、路径、体积）。支持用户密码认证回退。 |

### 2.3 播放状态操作

| 函数 | 对应 Emby API | 说明 |
|---|---|---|
| `markPlayed(serverConfig, itemId)` | `POST /Users/{userId}/PlayedItems/{itemId}` | 标记媒体项为已播放 |
| `markUnplayed(serverConfig, itemId)` | `DELETE /Users/{userId}/PlayedItems/{itemId}` | 标记媒体项为未播放 |

### 2.4 播放历史查询

| 函数 | 对应 Emby API | 说明 |
|---|---|---|
| `getPlayedItems(serverConfig, filters)` | `GET /Users/{userId}/Items`（Filters=IsPlayed） | 获取已播放列表。支持 filters: `sectionId`（ParentId）、`days`（日期过滤，service-side）、`type`（Movie/Episode/all）。自动解析 section 名称。若 userId 未配置，自动从 getUsers() 获取第一个用户。 |
| `getUnplayedItems(serverConfig, sectionId)` | `GET /Users/{userId}/Items`（Filters=IsUnplayed） | 获取未播放列表，返回增强字段（sizeGb、resolution 标签、codec、isBluRayDisc、posterUrl 等）。若 userId 未配置，自动从 getUsers() 获取第一个用户。 |

### 2.5 连接与配置

| 函数 | 对应 Emby API | 说明 |
|---|---|---|
| `testConnection(serverConfig)` | `GET /System/Info` | 测试 Emby 服务器连通性 |
| `getUsers(serverConfig)` | `GET /Users/Query`（fallback: `GET /Users`） | 获取用户列表（添加子库向导 Step 2） |
| `getMediaFolders(serverConfig)` | `GET /Library/MediaFolders` | 获取媒体文件夹列表（添加子库向导 Step 3） |

### 2.6 userId 自动发现

`getLibraryItems`、`getPlayedItems`、`getUnplayedItems` 在 `serverConfig.userId` 为空时，自动调用 `getUsers()` 取第一个用户作为 fallback。这允许在未显式配置 userId 的情况下仍能拉取媒体数据。

---

## §3 认证与会话

Emby 使用 API Key 认证，**双重传递**：

1. **HTTP Header**: `X-Emby-Token: <api_key>`
2. **URL Query Parameter**: `api_key=<api_key>`

认证信息由 `serverConfig` 传入（对应 `embyServers["<uuid>"]` 中的 `apiKey`）。

删除操作额外支持**用户密码认证**：若配置了 `embyUserPassword`，`deleteLibraryItem()` 和 `getItemDeleteInfo()` 会先调用 `POST /Users/AuthenticateByName` 获取用户级 `AccessToken`，替换 apiKey 后执行删除。

---

## §4 返回字段映射

EmbyAdapter 从 Emby 原始响应中提取以下字段，返回给 MediaLibraryService：

| Emby 响应字段 | 提取为 | 说明 |
|---|---|---|
| `Id` | `itemId` | 作为 library.json 主键 |
| `Name` | `name` | 影片名称 |
| `Path` | `path` | 媒体文件路径 |
| `Type` | `type` | `Movie` / `Series` / `Episode` |
| `MediaSources[0].Bitrate` | `bitrate` | 码率（bps） |
| `RunTimeTicks` | `duration` | 时长（转为秒） |
| `Width` × `Height` | `resolution` | 如 `3840x2160` |
| `MediaSources[0].Size` | `size` | 文件大小（字节） |
| `PremiereDate` | `premiereDate` | 首播日期 |
| `Genres` | `genres` | 类型标签列表 |
| `MediaSources[0].MediaStreams[].Codec` | `codec` | 视频编码（规范化: h264/h265/av1） |
| `UserData.Played` | `watched` | 是否已播放 |
| `Path` + `VideoType` + `IsoType` + 文件系统 | `isDiscLike` | 是否为原盘（见下方判定逻辑） |

> `isDiscLike` 判定逻辑 `inferIsBluRayDisc()`，**四种检测方法**：
> 1. **路径后缀**：路径以 `.iso` 结尾
> 2. **路径包含 BDMV**：路径中包含 `/bdmv/` 或以 `/bdmv` 结尾
> 3. **IsoType / VideoType 字段**：`item.IsoType === 'BluRay' || 'Dvd'`，或 `item.VideoType` 为 `'BluRay' | 'iso'`（当 Path 为空时此方法为主检测手段）
> 4. **文件系统 BDMV 目录**：若路径对应磁盘目录，检查是否存在 `BDMV/` 子目录

---

## §5 错误处理与重试

- **网络错误**：返回错误，由 MediaLibraryService 决定是否重试
- **认证失败（401）**：标记对应 embyServerId 连接状态为 yellow（影响健康检查 `emby` 项）
- **重试不在 EmbyAdapter 层**：由 MediaLibraryService 定时器自行管理（下一次拉取自然重试）

> 注意：当前代码中 `fetch()` 调用未设置 `AbortSignal` 或超时。文档描述的 30s 超时约束为**目标设计**，尚未在代码中实现。实际超时行为取决于 Node.js 默认的 HTTP 超时。

---

## §6 关联文档

- `SERVICE/MEDIA_LIBRARY.md` — MediaLibraryService 协调层，调用 EmbyAdapter
- `SERVICE/DELETE_FLOW.md` — DeleteFlowExecutor 调用 `deleteLibraryItem()` / `libraryItemExists()`
- `SERVICE/HEALTH_CHECK.md` — `testConnection()` 用于 emby 健康检查项
- `SERVICE/ADMIN_WEB/PAGES.md` — 添加子库向导（服务器注册流程）
