# SPEC: v2 Media Service 重构设计

> 日期：2026-04-26
> 状态：已批准
> 基于：docs/v2/design/SERVICE*.md

---

## §1 v1 归档方案

### 1.1 归档步骤

```
1. git checkout -b v1-archive
2. git add -A
3. git commit -m "docs(v1): archive current state as v1"
4. git checkout master
```

- 当前 master 上的所有代码（media-service/src/）、文档（docs/）作为 v1 归档到 `v1-archive` 分支
- master 保留，作为 v2 开发起点

### 1.2 v2 开发起点

- `media-service/src/` 清空，从头构建
- `docs/v2/` 设计文档已完备，作为开发依据

---

## §2 整体架构

### 2.1 组件定位

v2 service 是胖服务组件，承担所有业务逻辑：

- **进程模式**：由 tray-supervisor spawn 为子进程，生命周期与 tray 绑定
- **协议**：仅暴露 HTTP REST API
- **数据权威**：任务队列、配置、媒体库均为 service 持有，desktop 只读
- **Web 管理端**：内置 React 管理页面（`/v1/admin/*`）

### 2.2 模块分层

```
┌─────────────────────────────────────────────────────┐
│                   REST API Layer                    │
│              app.js（路由注册 + 中间件）              │
└─────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────┐
│                 Coordination Layer                  │
│    mediaLibraryService / taskScheduler              │
└─────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────┐
│                    Service Layer                   │
│  embyService / doubanService / transcodeService    │
│  moviepilotService / mediaPolicyService            │
└─────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────┐
│                    Store Layer                     │
│   configStore / taskStore / mediaLibraryStore      │
└─────────────────────────────────────────────────────┘
```

---

## §3 Phase 1：MediaLibrary 完整实现

### 3.1 模块构建顺序

```
Step 1: configStore.js
Step 2: mediaLibraryStore.js
Step 3: mediaPolicyService.js
Step 4: embyService.js（EmbyAdapter）
Step 5: doubanMatchService.js
Step 6: doubanService.js（DoubanAdapter）
Step 7: mediaLibraryService.js
Step 8: REST API 端点
```

### 3.2 Step 1: configStore.js

**职责**：配置持久化，持有所有 service 侧配置的单一来源。

**文件**：`media-service/src/configStore.js`

**接口**：

```javascript
configStore.loadConfig()      → { ...config }
configStore.patchConfig(patch) → { ...config }
```

**存储**：`data/config.json`

**关键配置域**（见 `SERVICE/CONFIG.md`）：

| 配置域 | 字段 |
|--------|------|
| Emby 服务器 | `embyServers{}`，`subLibraries[]` |
| 豆瓣集成 | `douban.userId`，`douban.cookieHeader` |
| 媒体库策略 | `mediaPolicy`（子库级） |
| TaskScheduler | `executionMode`，`deleteConcurrency` 等 |
| 转码执行 | `transcodeTempRoot`，设备池等 |
| Admin 认证 | `serviceAdminPin` |

### 3.3 Step 2: mediaLibraryStore.js

**职责**：`library.json` 读写封装。

**文件**：`media-service/src/mediaLibraryStore.js`

**接口**：

```javascript
mediaLibraryStore.load()           → { version, items[], cachedAt, doubanSyncedAt }
mediaLibraryStore.save(data)       → void
mediaLibraryStore.upsertItems(subLibraryId, items) → void
mediaLibraryStore.removeItems(subLibraryId)         → void
mediaLibraryStore.getItem(itemId)  → MediaItem | null
mediaLibraryStore.updateItem(itemId, patch)         → MediaItem
```

**存储**：`data/library.json`

**MediaItem 字段**（见 `SERVICE/MEDIA_LIBRARY.md` §1）：

| 字段 | 类型 | 来源 |
|------|------|------|
| `itemId` | string | 主键 |
| `subLibraryId` | string | 所属子库 uuid |
| `name` | string | Emby |
| `path` | string | Emby |
| `source` | string | `emby` / `local` / `tmdb` |
| `sourceId` | string | EmbyId |
| `type` | string | `movie` / `series` / `episode` |
| `bitrate` | number | Emby |
| `duration` | number | Emby |
| `resolution` | string | Emby |
| `size` | number | Emby |
| `premiereDate` | string | Emby |
| `genres` | string[] | Emby |
| `isDiscLike` | boolean | 解析 |
| `doubanId` | string | 匹配结果 |
| `doubanRating` | number | Douban |
| `doubanSyncedAt` | string | Douban |
| `userRating` | number | Desktop |
| `userRatingUpdatedAt` | string | Desktop |
| `lastRefreshedAt` | string | 系统 |
| `action` | string | 策略计算 |
| `reason` | string | 策略计算 |

### 3.4 Step 3: mediaPolicyService.js

**职责**：纯函数，根据媒体项属性和策略配置计算推荐动作。

**文件**：`media-service/src/mediaPolicyService.js`

**接口**：

```javascript
mediaPolicyService.recommendedAction(item, mediaPolicy) → { action, reason }
```

**action 规则**（见 `SERVICE/MEDIA_LIBRARY.md` §1.4）：

| rating | resolution | bitrate vs target | action |
|--------|------------|-------------------|--------|
| 1-2 | any | — | `delete` |
| 3 | any | > target + hysteresis | `transcode` |
| 3 | any | ≤ target + hysteresis | `keep` |
| 4 | any | > target + hysteresis | `transcode` |
| 4 | any | < target × 0.8 | `upgrade` |
| 4 | any | 其他 | `keep` |
| 5 | 1080p | — | `upgrade` |
| 5 | 4K | < target × 0.8 | `upgrade` |
| 5 | 4K | 其他 | `keep` |
| null | any | — | `keep` |

**effectiveRating 计算**：`doubanRating ?? userRating ?? null`（豆瓣优先）

### 3.5 Step 4: embyService.js（EmbyAdapter）

**职责**：调用 Emby REST API，返回原始媒体数据；不直接写 library.json。

**文件**：`media-service/src/services/embyService.js`

**接口**：

```javascript
embyService.testConnection(serverConfig)         → { ok, serverName }
embyService.listUsers(serverConfig)              → [{ userId, name }]
embyService.listMediaFolders(serverConfig)       → [{ id, name }]
embyService.getLibraryItems(serverConfig, sectionId) → [MediaItem]
embyService.getItemDetails(serverConfig, itemId) → MediaItem
embyService.getItemDeleteInfo(serverConfig, itemId) → { path }
embyService.libraryItemExists(serverConfig, itemId) → boolean
embyService.deleteLibraryItem(serverConfig, itemId, password) → void
embyService.markPlayed(serverConfig, itemId, userId) → void
embyService.markUnplayed(serverConfig, itemId, userId) → void
```

**serverConfig 结构**：

```javascript
{
  baseUrl: string,    // e.g. "http://192.168.1.100:8096"
  apiKey: string,
  userId: string,
  embyUserPassword: string  // 用于删除操作鉴权
}
```

### 3.6 Step 5: doubanMatchService.js

**职责**：标题规范化 + 豆瓣匹配算法。

**文件**：`media-service/src/services/doubanMatchService.js`

**接口**：

```javascript
doubanMatchService.buildDoubanStarsByNormalizedTitle(entries)
// → Map<normalized_title_key, stars>

doubanMatchService.movieDoubanStars(embyName, mediaType, byNormTitle)
// → stars | null
```

**匹配算法**（见 `SERVICE/MEDIA_LIBRARY.md` §3.2）：

1. 豆瓣端：title 按 `/` 分段 + 全串，NFKC 规范化 → Map
2. Emby 端：embyName 按 `/`、`：`、`:`、`｜`、`|` 分段 + 全串，NFKC 规范化
3. Emby keys 按长度降序排列，依次查 Map，命中即返回

### 3.7 Step 6: doubanService.js（DoubanAdapter）

**职责**：调用豆瓣 API，抓取用户"看过"的评分列表；不直接写 library.json。

**文件**：`media-service/src/services/doubanService.js`

**接口**：

```javascript
doubanService.fetchRatings(userId, cookieHeader)
// → [{ subjectId, title, stars }, ...]
```

### 3.8 Step 7: mediaLibraryService.js

**职责**：协调者，维护统一的 `library.json`，管理子库定时拉取。

**文件**：`media-service/src/mediaLibraryService.js`

**接口**：

```javascript
mediaLibraryService.startSubLibraryRefreshTimer(subLibrary, intervalMs)
// → 每小时触发（仅 subLibrary.enabled=true）

mediaLibraryService.startSubLibraryDoubanSyncTimer(subLibrary, intervalMs)
// → 每6小时触发（仅 subLibrary.doubanEnabled=true）

mediaLibraryService.upsertItems(subLibraryId, items)
// → 写入 library.json，diff 检测后按需重算 action/reason

mediaLibraryService.removeItems(subLibraryId)
// → 从 library.json 移除该子库所有 items

mediaLibraryService.updateUserRating(itemId, userRating)
// → 写入用户评分，重算 effectiveRating + action/reason

mediaLibraryService.getLibrary(filters)
// → 返回完整媒体库列表（含 action/reason）
```

**定时拉取链路**（Emby）：

```
启动 → 遍历 subLibraries[]
  → EmbyAdapter.getLibraryItems(serverConfig, sectionId)
  → mediaLibraryStore.upsertItems()
  → diff 检测策略相关字段变更
  → 仅对 changedItemIds 重算 action/reason
  → 持久化 library.json
```

**豆瓣同步链路**：

```
启动 → 遍历 subLibraries[]
  → DoubanAdapter.fetchRatings()
  → DoubanMatchService.buildDoubanStarsByNormalizedTitle()
  → 遍历 items，匹配豆瓣评分
  → 更新 doubanRating + doubanId
  → 重算 effectiveRating + action/reason
  → 持久化 library.json
```

### 3.9 Step 8: REST API 端点

**文件**：`media-service/src/app.js`（路由注册）

**desktop 调用（`/v1/library/*`）**：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/library/queries/manage` | POST | 媒体库治理列表（含 action/reason） |
| `/v1/library/items/:itemId` | GET | 单条媒体详情 |
| `/v1/library/ratings` | GET | 全部用户评分映射 |
| `/v1/library/ratings` | PATCH | 批量更新用户评分 |
| `/v1/library/cache` | GET | 获取缓存的媒体库列表 |
| `/v1/library/cache` | POST | 刷新媒体库缓存 |

**admin 调用（`/v1/admin/sublibraries/*`）**：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/admin/sublibraries` | GET | 所有子库配置列表 |
| `/v1/admin/sublibraries` | POST | 新增子库 |
| `/v1/admin/sublibraries/:uuid` | DELETE | 删除子库 |
| `/v1/admin/sublibraries/:uuid` | PATCH | 更新子库 |

**Emby 操作（`/v1/emby/*`）**：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/emby/actions/test-connection` | POST | 测试 Emby 连接 |
| `/v1/emby/actions/list-users` | POST | 列出 Emby 用户 |
| `/v1/emby/actions/list-media-folders` | POST | 列出媒体库文件夹 |
| `/v1/library/actions/get-item` | POST | 单条媒体详情 |
| `/v1/library/actions/delete-info` | POST | 删除预检 |
| `/v1/library/actions/exists` | POST | 媒体项是否存在 |
| `/v1/library/actions/delete-item` | POST | 删除媒体项 |
| `/v1/library/actions/mark-played` | POST | 标记已播放 |
| `/v1/library/actions/mark-unplayed` | POST | 标记未播放 |

**豆瓣集成（`/v1/integrations/douban/*`）**：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/integrations/douban/session` | PUT | 保存豆瓣会话 |
| `/v1/integrations/douban/session` | GET | 读取豆瓣会话 |
| `/v1/integrations/douban/fetch/ratings` | POST | 拉取豆瓣评分 |
| `/v1/integrations/douban/fetch/jobs/:jobId` | GET | 豆瓣拉取作业状态 |
| `/v1/integrations/douban/fetch/stop` | POST | 停止拉取 |
| `/v1/integrations/douban/ratings/cache` | GET | 获取缓存的豆瓣评分 |

---

## §4 Phase 2：TaskScheduler + Flow Executors

### 4.1 模块构建顺序

```
Step 9: taskStore.js
Step 10: taskScheduler.js
Step 11: flows/deleteFlowExecutor.js
Step 12: flows/transcodeFlowExecutor.js
Step 13: flows/upgradeFlowExecutor.js
Step 14: services/transcodeService.js
Step 15: services/moviepilotService.js
```

### 4.2 Step 9: taskStore.js

**职责**：任务持久化。

**文件**：`media-service/src/taskStore.js`

**接口**：

```javascript
taskStore.loadTasks()                 → Task[]
taskStore.createTask(task)           → Task
taskStore.updateTask(taskId, patch)  → Task
taskStore.getTask(taskId)            → Task | null
taskStore.deleteTask(taskId)         → void
```

**存储**：`data/tasks.json`

### 4.3 Step 10: taskScheduler.js

**职责**：调度 + 路由。调用 Flow Executors，不共享内存。

**文件**：`media-service/src/taskScheduler.js`

**核心接口**：

```javascript
scheduler.pauseForConfirm(taskId, resumePoint)   // Flow 调，通知暂停等确认
scheduler.reportStatus(taskId, status, progress?) // Flow 调，上报状态变更
scheduler.drive(taskId, resumePoint)              // Scheduler 内部调，启动/恢复任务
scheduler.tick()                                  // 定时轮询（5s间隔）
```

**调度检查（三层）**：
1. itemId 锁检查（同 itemId 只能有一个 flow 在跑）
2. actionType slot 检查（concurrency 限制）
3. executionMode 检查（auto 直接入调度，manual 需用户 execute）

**recoverInterruptedTasks()**：启动时扫描 executing/interrupted 状态，统一降级。

### 4.4 Step 11: deleteFlowExecutor.js

**文件**：`media-service/src/flows/deleteFlowExecutor.js`

**drive(resumePoint)**：

| resumePoint | 行为 |
|-------------|------|
| `delete_precheck` | 从 precheck 开始 |
| `delete_executing` | 从 executing 开始（confirm 恢复） |

**phase 状态**：`precheck` → `executing` → `verify` → `done` / `failed_hard`

**特殊行为**：
- pause() / cancel() 均忽略（删除不可逆）

### 4.5 Step 12: transcodeFlowExecutor.js

**文件**：`media-service/src/flows/transcodeFlowExecutor.js`

**drive(resumePoint)**：

| resumePoint | 行为 |
|-------------|------|
| `transcode_precheck` | 从 precheck 开始 |
| `transcode_executing` | 从 executing 开始（DV confirm 恢复） |
| `transcode_verify` | 从 verify 开始（替换 confirm 恢复） |

**phase 状态**：`precheck` → `executing` → `verify` → `replace` → `done` / `failed_hard` / `paused`

**特殊行为**：
- pause()：中断 FFmpeg，保留 partial 文件
- cancel()：中断 FFmpeg，清理 partial 文件

### 4.6 Step 13: upgradeFlowExecutor.js

**文件**：`media-service/src/flows/upgradeFlowExecutor.js`

**状态**：空壳，直接 `failed_hard`。

未来实现 MoviePilot 集成时唯一需要改动的模块。

### 4.7 Step 14: transcodeService.js

**职责**：转码执行操作，被 TranscodeFlowExecutor 调用。

**文件**：`media-service/src/services/transcodeService.js`

**核心接口**：

```javascript
transcodeService.precheck(task)        // 预检（DV、临时目录、源文件、设备池）
transcodeService.startEncode(task, onProgress)  // 启动 FFmpeg，返回 jobId
transcodeService.probeSummary(jobId)   // ffprobe 摘要
transcodeService.replaceWithRetries(jobId)  // 原子替换
```

**DevicePool**：
- CPU 槽位：`transcodeMaxCpuSlots` 控制
- GPU 槽位：各设备 `maxSlots` 独立配置
- CPU 参与策略：`normal`（CPU 参与）/ `backup_only`（仅 GPU）
- 优先级：数值越小越优先

### 4.8 Step 15: moviepilotService.js

**职责**：MoviePilot 集成（暂未实现）。

**文件**：`media-service/src/services/moviepilotService.js`

**接口**（预留）：

```javascript
moviepilotService.search(mediaItem)       // 搜索洗版资源
moviepilotService.download(downloadId)    // 下载
moviepilotService.transfer(transferId)    // 转移
```

---

## §5 Phase 3：Admin Web

### 5.1 模块构建顺序

```
Step 16: adminWeb.js（路由注册）
Step 17: admin/（React 静态页面）
```

### 5.2 Admin API（`/v1/admin/*`）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/admin/auth-status` | GET | 认证状态 |
| `/v1/admin/pin` | POST | 设置/验证 PIN |
| `/v1/admin/shutdown` | POST | 关闭服务 |
| `/v1/admin/emby/config` | GET/PATCH | Emby 连接配置 |
| `/v1/admin/emby/test` | POST | 测试 Emby 连接 |
| `/v1/admin/transcode/config` | GET/PATCH | 转码配置 |
| `/v1/admin/transcode/device-pool` | GET | 设备池状态 |
| `/v1/admin/tasks` | GET | 任务列表 |
| `/v1/admin/tasks/:id` | GET/DELETE | 任务详情/删除 |
| `/v1/admin/health` | GET | 健康详情 |
| `/v1/admin/sublibraries` | GET/POST | 子库列表/新增 |

### 5.3 Admin 认证

- 所有 `/v1/admin/*` 端点需要 `X-Admin-Pin: <pin>` header
- 首次访问（未设置 PIN）返回 401，`needSetup: true`
- 已有 PIN 时校验通过才允许访问

---

## §6 文件结构

```
media-service/src/
├── server.js                    # 入口
├── app.js                       # Fastify 路由注册
├── configStore.js               # 配置持久化
├── taskStore.js                 # 任务持久化
├── mediaLibraryStore.js         # 媒体库持久化
├── taskScheduler.js             # 任务调度
├── mediaLibraryService.js       # 媒体库协调层
├── services/
│   ├── embyService.js           # Emby 适配器
│   ├── doubanService.js         # 豆瓣 适配器
│   ├── doubanMatchService.js    # 豆瓣匹配算法
│   ├── transcodeService.js      # 转码执行层
│   ├── mediaPolicyService.js   # 策略计算（纯函数）
│   └── moviepilotService.js    # MoviePilot（预留）
├── flows/
│   ├── deleteFlowExecutor.js   # 删除流程
│   ├── transcodeFlowExecutor.js # 转码流程
│   └── upgradeFlowExecutor.js  # 洗版流程（空壳）
├── admin/
│   ├── adminWeb.js              # Admin 路由
│   └── dist/                    # React 构建产物
└── data/
    ├── config.json              # 配置
    ├── tasks.json               # 任务
    └── library.json             # 媒体库
```

---

## §7 关联文档

### v2 设计文档（全量）

- `docs/v2/ARCH_OVERVIEW.md` — 系统结构总览
- `docs/v2/design/SERVICE.md` — 胖服务总览
- `docs/v2/design/SERVICE/CONFIG.md` — 配置字段定义
- `docs/v2/design/SERVICE/HEALTH_CHECK.md` — 健康检查
- `docs/v2/design/SERVICE/MEDIA_LIBRARY.md` — 媒体库管理
- `docs/v2/design/SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER.md` — EmbyAdapter 详细设计
- `docs/v2/design/SERVICE/MEDIA_LIBRARY/DOUBAN_ADAPTER.md` — DoubanAdapter 详细设计
- `docs/v2/design/SERVICE/TASK_SCHEDULER.md` — 任务调度
- `docs/v2/design/SERVICE/DELETE_FLOW.md` — DeleteFlowExecutor 详细设计
- `docs/v2/design/SERVICE/TRANSCODE_FLOW.md` — TranscodeFlowExecutor 详细设计
- `docs/v2/design/SERVICE/TRANSCODE.md` — TranscodeService 详细设计
- `docs/v2/design/SERVICE/UPGRADE_FLOW.md` — UpgradeFlowExecutor 详细设计
- `docs/v2/design/SERVICE/ADMIN_WEB.md` — Admin Web 整体设计
- `docs/v2/design/SERVICE/ADMIN_WEB/API.md` — Admin API 详细定义
- `docs/v2/design/SERVICE/ADMIN_WEB/PAGES.md` — Admin 页面设计
- `docs/v2/api/API_README.md` — REST API 端点索引（SSOT）
- `docs/v2/api/openapi.yaml` — OpenAPI 机器可读契约
