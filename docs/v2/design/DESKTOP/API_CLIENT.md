# DESIGN_DESKTOP/API_CLIENT — REST API 客户端层

> 状态：v4
> SSOT：本文是 desktop 调用 service REST API 的封装方式、端点和错误处理约定的唯一事实来源

---

## §1 职责边界

API_CLIENT 模块负责 desktop 到 service 的所有 HTTP 通信：

- **类型化封装**：所有 REST 端点对应明确的 TypeScript 方法签名
- **认证注入**：自动从 CONNECTION 模块读取 apiKey 并注入 `X-API-Key` 请求头
- **错误处理**：统一处理 HTTP 错误、网络错误、业务错误（409 冲突等）
- **轮询机制**：提供通用轮询器（createPoller），供 UI 层订阅数据更新

API_CLIENT **不负责**：
- 连接地址解析（由 CONNECTION 模块负责）
- 请求重试（由调用方决定；ApiClient 不做自动重试）
- 缓存管理（缓存策略由调用方决定）

---

## §2 架构

```
┌──────────────────────────────────────┐
│ ApiClient 类 (src/api/client.ts)     │
│                                      │
│ - getHeaders() → auth 注入           │
│ - getBaseUrl() → 从 CONNECTION 读取  │
│ - 通用 request() 方法                 │
│                                      │
│ 端点分组（按资源）：                   │
│ ├── Task 端点                         │
│ ├── Library 端点                      │
│ ├── Config 端点                       │
│ ├── Douban 端点                       │
│ ├── PlaybackLog 端点                  │
│ └── ActivityLog 端点                  │
└──────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────┐
│ Poller (src/api/polling.ts)          │
│                                      │
│ - createPoller<T>(fetch, interval)   │
│ - start() / stop()                   │
│ - onData callback                    │
└──────────────────────────────────────┘
```

> v4 设计选择：端点方法直接挂在 ApiClient 类上（而非拆分为独立的 TaskApi、LibraryApi 等文件），避免过度拆分。类的方法按资源域分组注释即可。

---

## §3 ApiClient 类设计

### 3.1 基础封装

```typescript
class ApiClient {
  // 每次调用动态读取 baseUrl 和 apiKey，确保连接变更后自动生效
  private getHeaders(): Record<string, string>
  private getBaseUrl(): string

  // 任务端点
  async getTasks(filter?): Promise<MediaTask[]>
  async getTask(taskId: string): Promise<MediaTask>
  async createTaskByIntent(intent: { itemId: string; actionType: string }): Promise<MediaTask>
  async updateTask(taskId: string, updates: Record<string, unknown>): Promise<MediaTask>
  async deleteTask(taskId: string): Promise<void>
  async executeTask(taskId: string): Promise<{ ok: boolean; message: string }>
  async pauseTask(taskId: string): Promise<{ ok: boolean; message: string }>

  // 媒体库端点
  async getLibraryCache(subLibraryId?: string): Promise<{ items: unknown[]; total: number }>
  async setLibraryCache(items: unknown[]): Promise<{ items: unknown[]; cachedAt: string }>
  async getItemRatings(): Promise<Record<string, { rating: number; updatedAt: string }>>
  async patchItemRatings(itemId: string, userRating: number | null): Promise<{ ok: boolean }>

  // 库状态
  async getLibraryStatus(): Promise<{ subLibraries: { uuid: string; name: string; enabled: boolean }[] }>

  // 标记已看/未看
  async markPlayed(itemId: string, subLibraryId?: string): Promise<{ ok: boolean }>
  async markUnplayed(itemId: string, subLibraryId?: string): Promise<{ ok: boolean }>

  // 未观看列表
  async getUnplayedItems(subLibraryId: string, sectionId?: string): Promise<UnplayedItem[]>

  // 播放记录（本地操作记录）
  async getPlaybackLog(subLibraryId?: string): Promise<PlaybackLogEntry[]>
  async recordPlay(entry: { itemId: string; subLibraryId: string; itemName: string; ... }): Promise<{ ok: boolean }>

  // 活动日志
  async getActivityLog(limit?: number): Promise<ActivityEntry[]>

  // 配置端点
  async getConfig(): Promise<Record<string, unknown>>
  async patchConfig(updates: Record<string, unknown>): Promise<Record<string, unknown>>

  // 豆瓣端点
  async getDoubanCache(): Promise<{ entries: unknown[]; syncedAt: string | null }>

  // 策略重算
  async recomputeStrategy(): Promise<{ ok: boolean; changed: number }>
}
```

**关键签名变更（v4 vs v2 文档）**：
- `patchItemRatings(itemId, userRating)` — 单条更新，不是批量 `Record<string, number | null>`。返回 `{ ok: boolean }`，不是 `{ ok: boolean; count: number }`
- `getLibraryCache(subLibraryId?)` — 路径为 `GET /v1/library?subLibraryId=`，不是 `/v1/library/cache`。返回 `{ items, total }`，不是 `{ items, cachedAt }`
- 新增 `getLibraryStatus()`, `markPlayed()`, `markUnplayed()`, `getUnplayedItems()`, `getPlaybackLog()`, `recordPlay()`, `getActivityLog()`, `recomputeStrategy()`

### 3.2 认证注入

```
每次 API 调用：
  1. getHeaders() → 检查 apiKey 是否非空 → 注入 X-API-Key 头
  2. 始终带 Content-Type: application/json（有 body 时）
  3. bodyless POST/DELETE 使用 getHeadersNoBody()（不含 Content-Type，避免 Fastify 拒绝空 JSON body）
  4. apiKey 每次调用时实时读取（不缓存），确保设置面板修改后立即生效
```

### 3.3 请求实例

```
POST /v1/tasks { itemId, actionType }
    │
    ├── baseUrl 来自 CONNECTION（如 http://192.168.1.100:18080）
    ├── headers 含 X-API-Key（来自 CONNECTION）
    ├── body 为 JSON
    │
    ▼
fetch(baseUrl + '/v1/tasks', { method: 'POST', headers, body })
```

### 3.4 单例

```typescript
// src/api/client.ts
export const apiClient = new ApiClient();
```

全局单例，所有页面/组件共享同一个实例。不提供工厂函数（desktop 只连接一个 service）。

---

## §4 端点清单

### 4.1 任务 (Task)

| 方法 | HTTP | 路径 | 说明 |
|------|------|------|------|
| `getTasks` | GET | `/v1/tasks` | 任务列表（可选 filter: status, actionType, itemId） |
| `getTask` | GET | `/v1/tasks/:id` | 单个任务详情 |
| `createTaskByIntent` | POST | `/v1/tasks` | 意图下发创建任务 |
| `updateTask` | PATCH | `/v1/tasks/:id` | 更新任务（如确认） |
| `deleteTask` | DELETE | `/v1/tasks/:id` | 删除任务 |
| `executeTask` | POST | `/v1/tasks/:id/actions/execute` | 手动执行 |
| `pauseTask` | POST | `/v1/tasks/:id/actions/pause` | 暂停任务 |

### 4.2 媒体库 (Library)

| 方法 | HTTP | 路径 | 说明 |
|------|------|------|------|
| `getLibraryCache` | GET | `/v1/library?subLibraryId=` | 媒体库全量表（含 items[], total） |
| `setLibraryCache` | POST | `/v1/library/cache` | 写入媒体库缓存 |
| `getItemRatings` | GET | `/v1/library/ratings` | 用户评分表 |
| `patchItemRatings` | PATCH | `/v1/library/ratings` | 单条更新评分（body: { itemId, userRating }），返回 `{ ok: boolean }` |
| `getLibraryStatus` | GET | `/v1/library/status` | 媒体库列表元信息（subLibrary uuid/name/enabled） |
| `markPlayed` | POST | `/v1/library/actions/mark-played` | 标记已看（body: { itemId, subLibraryId }） |
| `markUnplayed` | POST | `/v1/library/actions/mark-unplayed` | 标记未看 |
| `getUnplayedItems` | POST | `/v1/library/queries/unplayed` | 未观看列表（body: { subLibraryId, sectionId }） |
| `getPlaybackLog` | GET | `/v1/library/playback-log?subLibraryId=` | 播放记录（本地操作记录） |
| `recordPlay` | POST | `/v1/library/playback-log/record` | 记录播放（body: { itemId, subLibraryId, itemName, ... }） |
| `recomputeStrategy` | POST | `/v1/library/actions/recompute-strategy` | 重算全库策略 |

### 4.3 配置 (Config)

| 方法 | HTTP | 路径 | 说明 |
|------|------|------|------|
| `getConfig` | GET | `/v1/config` | 读取 service 配置 |
| `patchConfig` | PATCH | `/v1/config` | 部分更新配置 |

### 4.4 豆瓣 (Douban)

| 方法 | HTTP | 路径 | 说明 |
|------|------|------|------|
| `getDoubanCache` | GET | `/v1/integrations/douban/ratings/cache` | 豆瓣评分缓存 |

### 4.5 活动日志 (ActivityLog)

| 方法 | HTTP | 路径 | 说明 |
|------|------|------|------|
| `getActivityLog` | GET | `/v1/activity-log?limit=` | 活动日志（返回 { entries: ActivityEntry[] }） |

---

## §5 错误处理

### 5.1 错误类型

| 错误 | 触发条件 | 处理方式 |
|------|----------|----------|
| `ApiConflictError` | HTTP 409（任务冲突、itemId 互斥） | 调用方捕获，UI 提示"该条目已有未结案任务" |
| 网络错误 | fetch 抛出（连接拒绝、DNS 失败等） | 调用方捕获，UI 提示网络不可达 |
| HTTP 4xx | 400/401/404 | 调用方捕获，UI 提示具体错误 |
| HTTP 5xx | 500/502 | 调用方捕获，UI 提示服务端错误 |

### 5.2 ApiConflictError

```typescript
class ApiConflictError extends Error {
  code: string    // 服务端返回的错误码（如 'TASK_ITEM_CONFLICT'）
  message: string // 服务端返回的可读消息
}
```

仅在 `createTaskByIntent` 中抛出。调用方应展示 `message` 字段给用户。

### 5.3 通用错误处理模式

```typescript
// 调用方模式
try {
  await apiClient.createTaskByIntent(intent);
} catch (e) {
  if (e instanceof ApiConflictError) {
    // 409：展示冲突提示
  } else {
    // 其他错误：展示通用错误提示
  }
}
```

ApiClient 不吞错误、不做 toast。错误展示由 UI 层负责。

---

## §6 轮询机制

### 6.1 createPoller

```typescript
// src/api/polling.ts

type Poller<T> = {
  start: () => void;
  stop: () => void;
};

function createPoller<T>(
  fetch: () => Promise<T>,
  onData: (data: T) => void,
  intervalMs: number,
): Poller;
```

### 6.2 使用场景

| 场景 | 端点 | 间隔 | 说明 |
|------|------|------|------|
| App 全局任务轮询 | `GET /v1/tasks` | 400ms | App 挂载时启动，供各页面消费 |
| FloatingTaskButton 任务轮询 | `GET /v1/tasks` | 400ms | FloatingTaskButton 内部独立实例，挂载时启动 |
| 健康检查 | `GET /v1/health` | 5s | ConnectionGate 内部通过 `setInterval` 管理（不使用 createPoller） |

### 6.3 行为约定

- `start()` 立即执行一次 fetch（不等第一个间隔）
- 上一次 fetch 未完成时，不发起下一次（避免请求堆积）
- `stop()` 不清除已获取的数据（由调用方管理）
- fetch 抛出异常时，不停止轮询（静默重试）

### 6.4 实现要点

```typescript
function createPoller<T>(
  fetchFn: () => Promise<T>,
  onData: (data: T) => void,
  intervalMs: number,
): Poller {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const data = await fetchFn();
      onData(data);
    } catch {
      // 静默重试
    } finally {
      running = false;
    }
  };

  return {
    start: () => {
      tick(); // 立即执行
      timer = setInterval(tick, intervalMs);
    },
    stop: () => {
      if (timer) { clearInterval(timer); timer = null; }
    },
  };
}
```

---

## §7 与 preload.js 的分工

### 7.1 分工原则

| 场景 | 使用方式 | 说明 |
|------|----------|------|
| 简单 REST 调用 | ApiClient（渲染进程 fetch） | 大部分 CRUD 端点 |
| 长轮询任务 | preload.js 桥接 | transcode 压制进度、douban 同步进度（服务端异步任务，需 IPC 转发进度事件） |
| 文件系统操作 | preload.js 桥接 | deriveReplaceBackupPath（需 Node.js path 模块） |
| 健康检查 | preload.js 桥接 (`window.mediaService.checkHealth`) | 使用 Node http 模块，绕过 CORS |
| 设置读写 | preload.js IPC (`window.embyApi.getSettings` / `saveSetting`) | 主进程 electron-store 操作 |

### 7.2 preload 不做的事

preload.js 不再做一般的 REST 调用。v1 中 preload 封装了大量 `cpJson()` 调用，v2/v4 中这些大部分迁移到 ApiClient。preload 仅保留：
- 需要 Node.js API 的操作（路径拼接、健康检查）
- 需要 IPC 通信的操作（进度事件转发、设置读写、launchPlayer）
- 长轮询进度桥接（transcode 进度 → `transcode:progress` IPC 事件、douban 进度 → `douban:fetchProgress` IPC 事件）

### 7.3 preload 暴露的 API 面（v4 实际）

```typescript
// 主 API 面 — 所有 desktop 功能集中在此
window.embyApi = {
  // REST helpers (通过 cpJson 内部调用)
  testConnection, getUsers, getMediaFolders,
  getUnplayedItems, getLibraryItemsForManage, getPlayedItems,
  markPlayed, markUnplayed, getLibraryItem,
  getItemDeleteInfo, deleteLibraryItem, libraryItemExists,
  // Transcode
  transcodeValidateTools, transcodeProbeEncodeDevices, transcodePrecheck,
  transcodeStartEncode, transcodeAbort, transcodeProbe,
  transcodeReplace, transcodeCleanupTaskWorkdir,
  transcodeScanOrphans, transcodeStatPaths, transcodeDeletePaths,
  transcodeDeriveReplaceBackupPath,
  onTranscodeProgress,
  // Player
  launchPlayer, launchPath,
  // Settings (electron-store IPC bridge)
  getSettings: () => Promise<DesktopSettings>,
  saveSetting: (key, value) => Promise<{ ok: boolean; error?: string }>,
  // Connection
  getEffectiveConnection: () => { baseUrl: string; apiKey: string; source?: string },
  onConnectionUpdated: (listener) => () => void,
  // Douban
  saveDoubanSession, getDoubanSession, stopDoubanFetch,
  fetchDoubanRatings, onDoubanProgress,
};

// 豆瓣 API 面（部分方法与 embyApi 重叠，独立暴露）
window.doubanApi = {
  saveSession, getSession, stopFetch, fetchRatings, onProgress,
};

// 健康检查（Node http 模块，绕过浏览器 CORS）
window.mediaService = {
  checkHealth: () => Promise<boolean>,
};

// Electron 环境标记
window.electronAPI = {
  isElectron: true,
};
```

> **不再有** `window.shelfdeckSettings` — 设置读写通过 `window.embyApi.getSettings()` 和 `window.embyApi.saveSetting(key, value)` 进行。
>
> `window.shelfdeckMedia`（旧 API）仍然暴露但不再推荐使用；新代码应使用 `window.embyApi.getEffectiveConnection()` 和 `window.embyApi.onConnectionUpdated()`。

---

## 关联文档

- `DESKTOP.md` — 瘦客户端总览（§4 数据流）
- `DESKTOP/CONNECTION.md` — 连接管理（baseUrl + apiKey 提供）
- `DESKTOP/UI.md` — UI 组件（轮询数据消费方）
- `SERVICE/API.md` — REST API 契约（端点的 SSOT）
