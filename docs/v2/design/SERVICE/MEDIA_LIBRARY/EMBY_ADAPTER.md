# DESIGN_SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER — Emby 数据拉取适配器

> Phase 3 为基准架构，v2 重写中。
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

| 函数 | 对应 Emby API | 说明 |
|---|---|---|
| `getLibraryItems(serverConfig, sectionId)` | `GET /Users/{userId}/Items`（ParentId=sectionId） | 拉取指定 section 的媒体项列表 |
| `getItemById(serverConfig, itemId)` | `GET /Items/{itemId}` | 按 ID 获取单个媒体项详情 |
| `libraryItemExists(serverConfig, itemId)` | 同上 | 本地判断 item 是否在 Emby 库中存在 |
| `deleteLibraryItem(serverConfig, itemId)` | `DELETE /Items/{itemId}` | 删除 Emby 媒体项（由 DeleteFlowExecutor 调用） |
| `getItemDeleteInfo(serverConfig, itemId)` | `GET /Items/{itemId}` | 返回删除前确认信息（文件名、路径、体积） |
| `testConnection(serverConfig)` | `GET /System/Info` | 测试 Emby 服务器连通性 |
| `getUsers(serverConfig)` | `GET /Users/Query` | 获取用户列表（添加子库向导 Step 2） |
| `getMediaFolders(serverConfig)` | `GET /Library/MediaFolders` | 获取媒体文件夹列表（添加子库向导 Step 3） |

---

## §3 认证与会话

Emby 使用 API Key 认证：

```
X-Emby-Token: <api_key>
```

认证信息由 `serverConfig` 传入（对应 `embyServers["<uuid>"]` 中的 `apiKey`）。

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
| `Path` 解析 | `isDiscLike` | 路径是否为 ISO/BDMV 原盘 |

> `isDiscLike` 判定逻辑：`inferIsBluRayDisc()` 检查路径是否以 `.iso` 结尾或包含 `BDMV` 目录。

---

## §5 错误处理与重试

- **网络错误**：返回错误，由 MediaLibraryService 决定是否重试
- **认证失败（401）**：标记对应 embyServerId 连接状态为 yellow（影响健康检查 `emby` 项）
- **超时**：单次请求超时 30s，由调用方决定是否重试
- **重试不在 EmbyAdapter 层**：由 MediaLibraryService 定时器自行管理（下一次拉取自然重试）

---

## §6 关联文档

- `SERVICE/MEDIA_LIBRARY.md` — MediaLibraryService 协调层，调用 EmbyAdapter
- `SERVICE/DELETE_FLOW.md` — DeleteFlowExecutor 调用 `deleteLibraryItem()` / `libraryItemExists()`
- `SERVICE/HEALTH_CHECK.md` — `testConnection()` 用于 emby 健康检查项
- `SERVICE/ADMIN_WEB/PAGES.md` — 添加子库向导（服务器注册流程）
