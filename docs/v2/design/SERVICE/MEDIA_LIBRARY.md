# DESIGN_SERVICE/MEDIA_LIBRARY — 媒体库管理

> Phase 4 为基准架构，v4 定稿。
> SSOT：本文是媒体库行为、数据结构、REST API 的唯一事实来源。

---

## §1 媒体库表（library.json）

### 1.1 表结构

文件路径：`data/library.json`

```json
{
  "version": 1,
  "items": [MediaItem],
  "cachedAt": null
}
```

**MediaItem 字段定义**：

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `itemId` | string | 主键 | 统一标识，来源无关 |
| `subLibraryId` | string | 系统 | 所属子库 uuid |
| `name` | string | Emby | 影片名称 |
| `path` | string | Emby | 媒体文件路径 |
| `source` | string | 系统 | 来源类型：`emby` / `local` / `tmdb` |
| `sourceId` | string | 来源系统 | 对应来源系统的主键 |
| `type` | string | Emby | 媒体类型：`movie` / `series` / `episode` |
| `bitrate` | number | Emby | 码率（bps） |
| `duration` | number | Emby | 时长（秒） |
| `resolution` | string | Emby | 分辨率，如 `3840x2160` |
| `size` | number | Emby | 文件大小（字节） |
| `codec` | string | Emby | 视频编码：`h264` / `h265` / `hevc` / `av1` |
| `premiereDate` | string | Emby | 首播日期（ISO 8601） |
| `genres` | string[] | Emby | 类型标签列表 |
| `isDiscLike` | boolean | 解析 | 是否原盘（ISO/BDMV），由路径解析或 Emby 返回判定 |
| `watched` | boolean | Emby | 是否已观看（Emby UserData.Played 缓存） |
| `doubanId` | string | 匹配结果 | 豆瓣条目 ID（由标题匹配得出），null 表示未匹配 |
| `doubanRating` | number | Douban | 豆瓣星级（1-5），null 表示未匹配 |
| `doubanRatingUpdatedAt` | string | Douban | 该条目豆瓣评分最近一次更新时间（ISO 8601） |
| `userRating` | number | Desktop | 用户星级（1-5），null 表示未评分 |
| `userRatingUpdatedAt` | string | Desktop | 用户评分时间（ISO 8601） |
| `lastRefreshedAt` | string | 系统 | 最近一次 Emby 拉取更新时间（ISO 8601） |
| `lastTaskDoneAt` | string | TaskScheduler | 最近一次任务完成时间（done/failed_hard），用于 48h 冷却 |
| `bucket` | string | Library 自算 | 分辨率分类：`1080p` / `4K`，由 `recomputeAllSelfFields()` 得出 |
| `equivalentBitrate` | number | Library 自算 | 等价码率（Mbps），由 `recomputeAllSelfFields()` 得出 |
| `action` | string | StrategyEngine | 推荐动作：`delete` / `transcode` / `upgrade` / `keep` |
| `reason` | string | StrategyEngine | 推荐原因，如"4★ 1080p 码率超标，建议压缩" |
| `targetBitrate` | number | StrategyEngine | 目标码率（Mbps），来自匹配规则的 `actionParams.targetBitrate` |
| `targetCodec` | string | StrategyEngine | 目标编码，来自匹配规则的 `actionParams.targetCodec` |
| `seedPreferences` | object | StrategyEngine | 洗版种子偏好，来自匹配规则的 `actionParams.seedPreferences`（仅 upgrade） |
| `maxSizeGB` | number | StrategyEngine | 洗版最大文件体积（GB），来自匹配规则的 `actionParams.maxSizeGB`（仅 upgrade） |
| `predictedSizeGb` | number | StrategyEngine | 预测转码后体积（GB），由 StrategyEngine 根据 targetBitrate + duration 估算 |

### 1.1.1 数据来源分类

**类别一：外部拉取**（Library 定时向外部数据源请求）

| 来源系统 | 字段 | 刷新周期 |
|---|---|---|
| Emby（经 `embyService`） | name, path, type, bitrate, duration, resolution, size, codec, premiereDate, genres, isDiscLike, watched | 每 1h |
| Douban（经 `doubanService`） | doubanId, doubanRating, doubanRatingUpdatedAt | 每 6h |

**类别二：自身计算**（`recomputeAllSelfFields()`，每 10min 全量重算）

| 字段 | 计算方式 |
|---|---|
| `bucket` | `resolutionBucket(resolution)` → `1080p` / `4K` |
| `equivalentBitrate` | `bitrate / 1_000_000` → Mbps |

> `targetBitrate`、`targetCodec`、`seedPreferences`、`maxSizeGB`、`predictedSizeGb` 已迁移至 StrategyEngine 写入。`recomputeAllSelfFields()` 不再计算这些字段。

**类别三：策略计算**（StrategyEngine，每 30min 全量重算）

| 字段 | 计算方式 |
|---|---|
| `action`, `reason` | 规则模板匹配 |
| `targetBitrate`, `targetCodec` | 匹配规则的 `actionParams` |
| `seedPreferences`, `maxSizeGB` | 匹配规则的 `actionParams`（仅 upgrade） |
| `predictedSizeGb` | `(targetBitrate × 10⁶ × duration) / (8 × 1024³)` |

**类别四：任务生命周期**（TaskScheduler 自动写入）

| 字段 | 写入时机 |
|---|---|
| `lastTaskDoneAt` | 任务 done 或 failed_hard 时由 `scheduler.reportStatus()` 写入 |

**类别五：用户输入**（用户通过 REST API 写入）

| 字段 | 写入时机 |
|---|---|
| `userRating`, `userRatingUpdatedAt` | `PATCH /v1/library/ratings` |

### 1.2 主键设计

主键为 `itemId`（string），不绑定任何来源系统：
- Emby 来源：itemId = Emby 返回的 `Id`
- 本地文件夹来源：itemId = 文件绝对路径或哈希
- TMDB 来源：itemId = TMDB ID

### 1.3 持久化

- 文件路径：`data/library.json`
- **写入者与字段**：

| 写入者 | 写入字段 |
|---|---|
| EmbyAdapter（经 MediaLibraryService.upsertItems） | name, path, type, bitrate, duration, resolution, size, codec, premiereDate, genres, isDiscLike, watched, lastRefreshedAt |
| DoubanAdapter（经 syncDoubanForSubLibrary） | doubanId, doubanRating, doubanRatingUpdatedAt（仅在匹配成功时更新；未匹配则保持旧值） |
| desktop PATCH /v1/library/ratings | userRating, userRatingUpdatedAt |
| Library 自算（recomputeAllSelfFields, 每 10min） | bucket, equivalentBitrate |
| StrategyEngine | action, reason, targetBitrate, targetCodec, seedPreferences, maxSizeGB, predictedSizeGb |
| TaskScheduler（reportStatus） | lastTaskDoneAt |

### 1.4 策略计算

策略计算由 **StrategyEngine**（`SERVICE/STRATEGY_ENGINE.md`）独立负责。采用用户可配置的**规则模板引擎**：

- 每个子库通过 `ruleTemplateId` 引用一个规则模板
- 规则按 priority 排序，对 item 的条件组逐一匹配，last match wins
- 匹配规则后设置 `action` / `reason` / `targetBitrate` / `targetCodec` / `seedPreferences` / `maxSizeGB` / `predictedSizeGb`

> `mediaPolicyService.recommendedAction()` 已完全废弃，仅保留 `resolutionBucket()` 工具函数。所有策略逻辑由 `strategyEngine.js` + `config.ruleTemplates` 实现。

---

## §2 模块职责

### 2.1 当前模块结构

```
MediaLibraryService（Library — 数据 owner + 定时器总控）
    │
    ├── 子库管理：CRUD 子库配置
    ├── upsertItems()：批量写入/更新外部拉取字段，不含策略计算
    ├── updateUserRating()：写入 userRating + userRatingUpdatedAt
    ├── recomputeAllSelfFields()：全量扫描，重算 bucket / equivalentBitrate
    ├── getLibrary()：供 REST API / StrategyEngine / SmartTaskEngine 读取
    │
    ├── 定时器总控
    │     ├── 启动立即刷新（每个 enabled 子库）→ refreshSubLibrary() → 避免启动空窗期
    │     ├── Emby 拉取（每 1h）→ EmbyAdapter.getLibraryItems() → upsertItems()
    │     ├── 豆瓣同步（每 6h）→ DoubanAdapter.syncRatings() → 匹配写入
    │     └── 自身计算（每 10min）→ recomputeAllSelfFields() → saveLibrary()
    │
    ├── EmbyAdapter（embyService.js）— 纯取数工具
    └── DoubanAdapter（doubanService.js）— 纯取数工具

StrategyEngine（独立定时 30min）— 全量读 library.json → 规则模板匹配 → 写回策略字段

SmartTaskEngine（独立定时 10min）— 全量读 library.json → 条件判定 → taskStore.createTask()
```

**设计原则**：
1. 所有模块均为普通 Node.js 模块，无独立进程或线程
2. **数据写入与策略计算完全解耦**：各 adapter 只写原始字段；Library 自算只写 bucket / equivalentBitrate；StrategyEngine 写策略字段
3. **子库级独立定时**：每个子库有独立的 Emby 拉取定时器和豆瓣同步开关
4. **全量重算优于按需重算**：纯函数计算成本极低，消除 diff 检测逻辑

### 2.2 各子模块职责边界

| 模块 | 职责 |
|---|---|
| `mediaLibraryService.js` | 数据 owner：子库管理，定时器总控，CRUD，自身计算 bucket / equivalentBitrate |
| `embyService.js`（EmbyAdapter） | 纯取数工具：调用 Emby REST API，返回原始媒体数据 |
| `doubanService.js`（DoubanAdapter） | 纯取数工具：调用豆瓣 API |
| `doubanMatchService.js` | 标题关键字匹配：NFKC 规范化 + 最长键优先 |
| `strategyEngine.js` | 独立定时任务：规则模板匹配，写 action/reason/targetBitrate/targetCodec/seedPreferences/maxSizeGB/predictedSizeGb |
| `smartTaskEngine.js` | 独立定时任务：扫描 library.json，自动创建任务 |
| `library.json` | 单一持久化文件；所有媒体库数据的 SSOT |

> `mediaPolicyService.js` 已废弃，仅保留 `resolutionBucket()` 工具函数。

---

## §3 数据写入链路

### 3.1 Emby 定时拉取（按子库）

```
service 启动
    │
    └── 遍历 subLibraries[]（每个子库独立定时器）
            │
            └── 每小时触发（仅当 subLibrary.enabled = true）：
                → 从 embyServers[subLibrary.embyServerId] 获取服务器配置
                → EmbyAdapter.getLibraryItems(serverConfig, subLibrary.sectionId)
                → upsertItems() 写入 library.json
                → subLibrary.lastRefreshedAt = now
```

### 3.2 豆瓣定时同步（按子库）

**标题匹配算法**（`doubanMatchService.js`）：
1. 豆瓣端：title 按 `/` 分段 + 全串，NFKC 规范化 → 存入 Map（key → stars）
2. Emby 端：影片名称按 `：` / `:` / `｜` / `|` 分段 + 全串，NFKC 规范化 → 生成 keys
3. 匹配：Emby keys 按长度降序排列，依次查 Map，命中即返回

```
每6小时触发（仅当 subLibrary.doubanEnabled = true）：
    → DoubanAdapter.fetchRatings(null, { existingEntries: cachedEntries })
    → DoubanMatchService.buildDoubanStarsByNormalizedTitle(entries)
    → 遍历该子库 items（仅 Movie 类型）：
        ├── 匹配成功且 stars 变化 → 更新 doubanRating + doubanRatingUpdatedAt
        ├── 匹配成功但 stars 未变 → 跳过
        └── 未匹配 → 保留旧值（不置 null）
    → 持久化 library.json + 更新 subLibrary.doubanSyncedAt
```

> 豆瓣使用持久化条目缓存（`douban-entries-cache.json`）实现增量同步。无 14 天全量刷新机制——每次同步均为增量模式。

### 3.3 用户评分写入

```
desktop PATCH /v1/library/ratings
    → mediaLibraryService.updateUserRating(itemId, userRating)
    → item.userRating = userRating, item.userRatingUpdatedAt = now
    → 持久化 library.json
```

---

## §4 REST API

> SSOT：`SERVICE/API.md` 定义 HTTP 路径/模型/错误码。

### 4.1 端点索引

| 端点 | 方法 | 说明 |
|---|---|---|
| `GET /v1/library` | GET | 返回媒体库数据，支持 `?subLibraryId=` 筛选 |
| `GET /v1/library/queries/manage` | GET | 返回完整媒体库列表（含 action/reason） |
| `GET /v1/library/items/:itemId` | GET | 返回单项媒体详情 |
| `PATCH /v1/library/ratings` | PATCH | 写入用户评分 `{ itemId, userRating }` |
| `POST /v1/library/actions/refresh` | POST | 手动触发指定子库的 Emby 拉取 |
| `POST /v1/library/actions/recompute-strategy` | POST | 手动触发策略重算 |
| `GET /v1/library/status` | GET | 返回各子库同步状态 |
| `GET /v1/admin/sublibraries` | GET | 返回所有子库配置列表 |
| `POST /v1/admin/sublibraries` | POST | 新增子库（含内联 Emby 服务器注册） |
| `DELETE /v1/admin/sublibraries/:uuid` | DELETE | 删除子库 |
| `PATCH /v1/admin/sublibraries/:uuid` | PATCH | 更新子库配置 |

### 4.2 筛选与查询

- `GET /v1/library/queries/manage`：支持 `?source=&type=&action=&subLibraryId=` 筛选参数
- `GET /v1/library`：支持 `?subLibraryId=` 参数，返回 `{ items, total }`

---

## §5 关联文档

- `SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER.md` — EmbyAdapter 详细设计
- `SERVICE/MEDIA_LIBRARY/DOUBAN_ADAPTER.md` — DoubanAdapter 详细设计
- `SERVICE/CONFIG.md` — 配置字段定义（embyServers、subLibraries、ruleTemplates）
- `SERVICE/STRATEGY_ENGINE.md` — 策略计算引擎
- `SERVICE/SMART_TASK_ENGINE.md` — 智能入队引擎
- `SERVICE/API.md` — REST 端点 SSOT
