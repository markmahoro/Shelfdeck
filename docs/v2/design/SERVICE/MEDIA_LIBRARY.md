# DESIGN_SERVICE/MEDIA_LIBRARY — 媒体库管理

> Phase 3 为基准架构，v2 重写中。
> SSOT：本文是媒体库行为、数据结构、REST API 的唯一事实来源。
> 重构目标：代码从 `cacheStore.js`（混放 cache.json）迁移到独立的 `mediaLibraryService.js` + `library.json`。

---

## §1 媒体库表（library.json）

### 1.1 表结构

文件路径：`data/library.json`（由 `cache.json` 重命名而来，v2 重构目标）

```json
{
  "version": 1,
  "items": [MediaItem],
  "cachedAt": "2026-04-25T12:00:00.000Z"
}
```

> `doubanSyncedAt` 已移至子库级（`subLibrary.doubanSyncedAt`）。

**MediaItem 字段定义**：

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `itemId` | string | 主键 | 统一标识，来源无关，可支持 Emby / 本地文件夹 / TMDB 等多来源 |
| `subLibraryId` | string | 系统 | 所属子库 uuid（关联 `subLibraries[].uuid`） |
| `name` | string | Emby / 文件夹扫描 | 影片名称 |
| `path` | string | Emby / 文件夹扫描 | 媒体文件路径 |
| `source` | string | 系统 | 来源类型：`emby` / `local` / `tmdb` |
| `sourceId` | string | 来源系统 | 对应来源系统的主键（如 EmbyId） |
| `type` | string | Emby / 文件夹扫描 | 媒体类型：`movie` / `series` / `episode` |
| `bitrate` | number | Emby / 文件夹扫描 | 码率（bps） |
| `duration` | number | Emby / 文件夹扫描 | 时长（秒） |
| `resolution` | string | Emby / 文件夹扫描 | 分辨率，如 `3840x2160` |
| `size` | number | Emby / 文件夹扫描 | 文件大小（字节） |
| `premiereDate` | string | Emby / 文件夹扫描 | 首播日期（ISO 8601） |
| `genres` | string[] | Emby / 文件夹扫描 | 类型标签列表 |
| `isDiscLike` | boolean | 解析 | 是否原盘（ISO/BDMV），由路径解析或 Emby 返回判定 |
| `doubanId` | string | 匹配结果 | 豆瓣条目 ID（由标题匹配得出，非预关联字段）；null 表示未匹配到豆瓣条目 |
| `doubanRating` | number | Douban | 豆瓣星级（1-5），null 表示未匹配 |
| `doubanSyncedAt` | string | Douban | 该条豆瓣评分同步时间（ISO 8601）；与 subLibrary.doubanSyncedAt（子库级整体同步时间）不同 |
| `userRating` | number | Desktop | 用户星级（1-5），null 表示未评分 |
| `userRatingUpdatedAt` | string | Desktop | 用户评分时间（ISO 8601） |
| `lastRefreshedAt` | string | 系统 | 最近一次 Emby 拉取更新时间（ISO 8601） |
| `action` | string | 策略计算 | 推荐动作：`delete` / `transcode` / `upgrade` / `keep` |
| `reason` | string | 策略计算 | 推荐原因，如"码率偏高"、"已观看" |

> **v2 结构说明**：`library.json` 根级无独立的 `doubanRatings[]` 数组；豆瓣评分数据直接存在每条 `MediaItem.doubanId` / `MediaItem.doubanRating` / `MediaItem.doubanSyncedAt` 上，与 Emby 元数据合一。
> 豆瓣同步时间改为子库级（`subLibrary.doubanSyncedAt`），每条 MediaItem 也有自己的 `doubanSyncedAt` 字段。

### 1.2 主键设计

主键为 `itemId`（string），不绑定任何来源系统，以保证多来源扩展性：

- Emby 来源：itemId = Emby 返回的 `Id`
- 本地文件夹来源：itemId = 文件绝对路径或哈希
- TMDB 来源：itemId = TMDB ID
- 其他来源：按来源系统约定

### 1.3 持久化

- 文件路径：`data/library.json`
- 写入时机：Emby 定时拉取完成后、Douban 同步完成后、用户评分写入后
- **时间戳层级**：
  - 子库级 `doubanSyncedAt`：该子库豆瓣同步周期的完成时间
  - MediaItem 级 `doubanSyncedAt`：该条目最近一次豆瓣评分更新时间
- 迁移注释：v1 版本使用 `data/cache.json`（`libraryItems[]` + `doubanRatings[]` 混放），v2 重构为 `library.json` 结构；v2 子库版新增 `subLibraryId` 字段关联子库，Emby 拉取链路升级为按子库独立定时

### 1.4 策略计算

**effectiveRating 计算**：
```
effectiveRating = doubanRating 非空 ? doubanRating : userRating 非空 ? userRating : null
```
豆瓣评分优先，用户评分兜底，均为空时 effectiveRating = null。

**action / reason 计算**：
```
// 从 item.subLibraryId 找到对应子库，取子库的 mediaPolicy
mediaPolicyService.recommendedAction(item, subLibrary.mediaPolicy) → { action, reason }
```

> v2 更新：策略计算使用子库级 `mediaPolicy`（`subLibraries[].mediaPolicy`），不再使用全局 `mediaPolicy`。

`recommendedAction()` 逻辑（来自 `mediaPolicyService.js`）：

| rating | resolution | bitrate vs target | action |
|---|---|---|---|
| 1-2（delete tier） | any | — | `delete` |
| 3 | any | > target + hysteresis | `transcode` |
| 3 | any | ≤ target + hysteresis | `keep` |
| 4 | any | > target + hysteresis | `transcode` |
| 4 | any | < target × 0.8 | `upgrade` |
| 4 | any | 其他 | `keep` |
| 5 | 1080p | — | `upgrade` |
| 5 | 4K | < target × 0.8 | `upgrade` |
| 5 | 4K | 其他 | `keep` |
| null | any | — | `keep` |

`reason` 字段由 `mediaPolicyService` 在返回 action 时附带说明文字。

媒体库每次更新（Emby 拉取、用户评分变更）时，action/reason **仅在被影响的 item 上**重新计算（按需重算，见 §3）。

**diff 检测范围**（触发策略重算的字段变更）：
- `bitrate`、`size`、`duration`、`resolution`（影响码率判定）
- `doubanRating`（豆瓣同步后）
- `userRating`（用户评分后）
- `genres`（类型标签可能影响某些策略规则）

---

## §2 模块职责

### 2.1 v2 目标模块结构

v2 目标：新增 `mediaLibraryService.js` 作为协调层，支持多子库独立管理：

```
mediaLibraryService.js（协调层）
    │
    ├── 子库管理：CRUD 子库配置（增/删/查，暂停/启用）
    ├── upsertItems()：批量写入/更新 library.json items[]（关联 subLibraryId）
    ├── updateUserRating()：处理用户评分写入 + 重算 action/reason
    ├── getLibrary()：供 REST API 调用，返回完整媒体库数据
    │
    ├── EmbyAdapter（embyService.js）
    │     └── getLibraryItems(embyServerConfig, sectionId) → 拉取指定 Emby section 媒体数据
    │
    ├── DoubanAdapter（doubanService.js）
    │     └── syncRatings() → 抓取豆瓣评分并写入（按子库独立开关）
    │
    └── mediaPolicyService.js（纯函数）
          └── recommendedAction(item, policy) → { action, reason }
```

**设计原则**：
1. 无独立 `MediaLibraryService` 进程或线程；是普通 Node.js 模块，被 `app.js` 或定时任务调用
2. **先写盘，再按需重算策略**：每次变更只重算受影响的 item，避免全量重算
3. **子库级独立定时**：每个子库有独立的 Emby 拉取定时器和豆瓣同步开关

### 2.2 各子模块职责边界

| 模块 | 职责 |
|---|---|
| `mediaLibraryService.js` | 协调者：子库管理，定时器驱动 adapter，聚合数据到 library.json，提供 getLibrary() 给 REST 层 |
| `embyService.js`（EmbyAdapter） | 仅负责调用 Emby REST API，返回原始媒体数据；不直接写 library.json |
| `doubanService.js`（DoubanAdapter） | 仅负责调用豆瓣 API；不直接写 library.json |
| `mediaPolicyService.js` | 纯函数：输入 MediaItem + subLibrary.mediaPolicy 配置，输出 action + reason；无副作用 |
| `library.json` | 单一持久化文件；所有媒体库数据的 SSOT |

---

## §3 数据写入链路

### 3.1 Emby 定时拉取（按子库）

**原则：先写盘，再按需重算策略。** 每个子库独立拉取，只重算该子库受影响 items。

```
service 启动
    │
    └── 遍历 subLibraries[]（每个子库独立定时器）
            │
            └── mediaLibraryService.startSubLibraryRefreshTimer(subLibrary, intervalMs = 3600000)
                    │
                    └── 每小时触发（仅当 subLibrary.enabled = true）：
                        → 从 embyServers[subLibrary.embyServerId] 获取服务器配置
                        → EmbyAdapter.getLibraryItems(serverConfig, subLibrary.sectionId)
                        │       └── 返回该 section 的原始 Emby 媒体项列表
                        │
                        → 遍历 items，upsertItems() 写入 library.json
                        │       ├── 匹配策略：按 sourceId + subLibraryId 查找已存在 item → 更新字段
                        │       ├── 不存在 → 新增（itemId = Emby Id，subLibraryId = 当前子库 uuid）
                        │       ├── lastRefreshedAt = now
                        │       ├── subLibrary.lastRefreshedAt = now
                        │       └── diff 检测：哪些 item 的**策略相关字段**实际变了
                        │             → 标记 changedItemIds
                        │
                        → 仅对 changedItemIds 逐条：
                        │       └── mediaPolicyService.recommendedAction(item, subLibrary.mediaPolicy) → 更新 action + reason
                        │
                        └── 持久化 library.json + 更新 subLibrary.lastRefreshedAt
```

> Emby 侧删除的 item：直接从 library.json 移除（不存在则删），不保留孤儿。

### 3.2 豆瓣定时同步（按子库）

**原则：只更新评分变了的那几条，再只重算那几条的策略。**

**前置说明：豆瓣评分匹配使用标题关键字匹配，而非 doubanId 预关联。** DoubanAdapter 仅拉取用户在豆瓣标记的"看过"列表（含 subjectId / title / stars），匹配在 service 侧通过 `DoubanMatchService.movieDoubanStars()` 完成。

**标题匹配算法**（来自 `doubanMatchService.js`）：
1. **豆瓣端**：将用户豆瓣"看过"列表每条的 title 按 `/` 分段 + 全串，各自 NFKC 规范化 → 生成多个 normalized key → 存入 Map（key → stars）
2. **Emby 端**：将 Emby 影片名称按 `/`、`：`、`:`、`｜`、`|` 分段 + 全串，各自 NFKC 规范化 → 生成多个 normalized key
3. **匹配**：Emby keys 按长度降序排列（长键优先，减少短词误匹配），依次查 Map，命中即返回 stars；均未命中 → 未匹配

```
service 启动
    │
    └── 遍历 subLibraries[]（每个子库独立豆瓣同步）
            │
            └── mediaLibraryService.startSubLibraryDoubanSyncTimer(subLibrary, intervalMs = 21600000)
                    │
                    └── 每6小时触发（仅当 subLibrary.doubanEnabled = true）：
                        → DoubanAdapter.fetchRatings()
                        │       └── 返回 [{ subjectId, title, stars }, ...]
                        │
                        → DoubanMatchService.buildDoubanStarsByNormalizedTitle(entries)
                        │       └── 建立内存 Map：normalized_title_key → stars
                        │
                        → 遍历 library.json items（仅该 subLibrary 的 items）：
                        │       ├── 仅 Movie 类型参与匹配
                        │       ├── 调用 movieDoubanStars(embyName, 'Movie', byNormTitle)
                        │       │       └── 返回 doubanStars 或 null
                        │       ├── doubanRating 实际变化 → 更新 item.doubanRating
                        │       │       变化时同步记录 item.doubanId（豆瓣 subjectId）
                        │       ├── item.doubanSyncedAt = now
                        │       └── subLibrary.doubanSyncedAt = now
                        │
                        → 重新计算 doubanRating 变化条目的 effectiveRating + action/reason（使用对应 subLibrary.mediaPolicy）
                        │
                        └── 持久化 library.json + 更新 subLibrary.doubanSyncedAt
```

### 3.3 用户评分写入

**原则：单条变更，只重算单条。**

```
desktop PATCH /v1/library/ratings
    │
    → mediaLibraryService.updateUserRating(itemId, userRating)
    │       ├── 按 itemId 找到 library.json 中对应条目
    │       ├── item.userRating = userRating
    │       ├── item.userRatingUpdatedAt = now
    │       └── 重新计算 effectiveRating + action + reason（使用对应 subLibrary.mediaPolicy）
    │
    └── 持久化 library.json
```

---

## §4 REST API

> SSOT：`SERVICE/API.md` 定义 HTTP 路径/模型/错误码。
> 本节为索引和语义说明，不重复 API.md 中的完整字段定义。

### 4.1 端点索引

| 端点 | 方法 | 说明 |
|---|---|---|
| `GET /v1/library/queries/manage` | GET | 返回完整媒体库列表（含 action/reason），供 desktop 展示 |
| `GET /v1/library/items/:itemId` | GET | 返回单项媒体详情 |
| `PATCH /v1/library/ratings` | PATCH | 写入用户评分 `{ itemId, userRating }` |
| `POST /v1/library/actions/refresh` | POST | 手动触发指定子库的 Emby 拉取（admin 页面调用） |
| `GET /v1/library/status` | GET | 返回各子库同步状态（lastRefreshedAt、doubanSyncedAt） |
| `GET /v1/admin/sublibraries` | GET | 返回所有子库配置列表（admin API） |
| `POST /v1/admin/sublibraries` | POST | 新增子库（含内联 Emby 服务器注册） |
| `DELETE /v1/admin/sublibraries/:uuid` | DELETE | 删除子库（同时清理该子库在 library.json 中的所有 items） |
| `PATCH /v1/admin/sublibraries/:uuid` | PATCH | 更新子库（暂停/启用、修改名称、开关豆瓣同步、更新码率策略） |

### 4.2 GET /v1/library/queries/manage 语义

- **调用方**：desktop 媒体库展示页面
- **返回数据**：所有 MediaItem，含最新 action/reason
- **筛选参数**：`?source=emby&type=movie&action=delete&subLibraryId=xxx`（可选）
- **认证**：同 service 其他端点（可选 X-Api-Key）

### 4.3 PATCH /v1/library/ratings 语义

- **调用方**：desktop 用户打分操作
- **请求体**：`{ itemId: string, userRating: number }`
- **响应**：`{ ok: true }`
- **副作用**：写入 `library.json` + 重算 `action`/`reason`
  - `wallRatingAutoEnqueue` 触发由 TASK_SCHEDULER 负责（见 `TASK_SCHEDULER.md` 配置域），MEDIA_LIBRARY 不感知

### 4.4 用户配置依赖

媒体库正常运行依赖以下配置。

#### 4.4.1 Emby 服务器（必填，通过子库间接配置）

Emby 服务器配置通过 **添加子库流程** 间接完成（见 ADMIN_WEB/PAGES.md §2.2.2）。

用户执行添加子库流程时：
1. 输入 `baseUrl` + `apiKey` → 调用 `GET /System/Info` 验证并获取 `serverName`
2. 选择用户 → 调用 `GET /Users/Query` 获取用户列表
3. 选择媒体文件夹 → 调用 `GET /Library/MediaFolders` 获取文件夹列表（单选）
4. 自定义子库名称 → 完成注册

> 配置入口：service Web 管理页 **媒体库 → 添加子库**

#### 4.4.2 豆瓣集成（可选）

豆瓣配置独立于 Emby 服务器，在**添加子库向导**最后一步中可选择是否启用该子库的豆瓣同步。

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `douban.userId` | string | `""` | 豆瓣"看过"页用户 ID（URL 中 `people/` 与 `/collect` 之间的字段） |
| `douban.cookieHeader` | string | `""` | 豆瓣登录 Cookie（公开列表可不填；私人可见列表必填） |

> 配置入口：service Web 管理页 **豆瓣集成**（全局配置，仅当 `subLibrary.doubanEnabled=true` 时生效）

#### 4.4.3 策略配置（有默认值，可选）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `subLibraries[].mediaPolicy.target1080p` | object | 见 CONFIG.md | 1080p 各星级目标码率（Mbps）；2★ 为删除档，目标码率仅作配置兼容占位 |
| `subLibraries[].mediaPolicy.target4k` | object | 见 CONFIG.md | 4K 各星级目标码率（Mbps） |

> 配置入口：service Web 管理页 **媒体库 → 添加子库** Step 4

#### 4.4.4 定时器（暂不可配）

以下间隔目前硬编码，未来可作为配置项暴露：

| 字段 | 当前值 | 说明 |
|---|---|---|
| Emby 定时拉取间隔 | 3600000ms（1小时） | 每个子库独立定时 `startSubLibraryRefreshTimer(subLibrary)` |
| 豆瓣定时同步间隔 | 21600000ms（6小时） | 每个子库独立定时 `startSubLibraryDoubanSyncTimer(subLibrary)` |

---

### 4.5 关联文档

- `SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER.md` — EmbyAdapter 详细设计
- `SERVICE/MEDIA_LIBRARY/DOUBAN_ADAPTER.md` — DoubanAdapter 详细设计
- `SERVICE/CONFIG.md` — 配置字段定义（embyServers、subLibraries）
- `SERVICE/ADMIN_WEB/PAGES.md` — 添加子库向导 UI
- `SERVICE/ADMIN_WEB/API.md` — 子库管理 API
- `SERVICE/TASK_SCHEDULER.md` — `wallRatingAutoEnqueue` 配置字段及自动入队调度逻辑
- `SERVICE/API.md` — REST 端点 SSOT
