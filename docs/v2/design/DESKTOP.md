# DESIGN_DESKTOP — 瘦客户端组件总览

> Phase 3（服务执行引擎）为基准架构。
> 状态：v4
> SSOT：本文是 desktop 组件内部模块划分和协作方式的唯一事实来源

---

## §1 组件定位

desktop 是 Phase 3 的瘦客户端，不承载业务逻辑：

- **进程模型**：Electron 主进程 + 渲染进程，独立启动（不依赖 service 是否运行）
- **协议**：仅通过 HTTP REST 与 service 通信；内部主进程与渲染进程通过 IPC（contextBridge）通信
- **数据权威**：desktop 不持有任何业务数据的 SSOT — 任务队列、配置、媒体库表均只读自 service
- **本地持久化**：仅保存自身连接配置（service 地址、API Key、播放器路径等），使用 electron-store
- **外部集成**：仅 `emby:launchPlayer` IPC 用于启动外部播放器；所有外部系统通过 service 集成

组件间关系由 `ARCH_OVERVIEW.md` §1（组件边界）和 §3（数据流）描述，本文档仅聚焦 desktop **内部**子模块的职责和协作。

---

## §2 进程模型

### 2.1 主进程与渲染进程

```
┌─────────────────────────────────────────────┐
│ Electron 主进程 (electron/main.js)           │
│                                              │
│ 职责：                                       │
│ - 窗口管理（BrowserWindow 创建/销毁）         │
│ - IPC handler 注册（settings、connection）    │
│ - 启动外部播放器（emby:launchPlayer）         │
│ - 读取/写入 electron-store（本地配置）         │
│ - 解析 service 连接地址（shelfdeckConnection） │
│ - 开发模式：自动发现 Vite dev server          │
└─────────────────────────────────────────────┘
        │ contextBridge (preload.js)
        ▼
┌─────────────────────────────────────────────┐
│ 渲染进程 (src/)                              │
│                                              │
│ 职责：                                       │
│ - UI 渲染（React 组件）                       │
│ - 调用 service REST API（通过 apiClient）     │
│ - 读取 service 连接配置（通过 window.embyApi）│
│ - 用户交互（打分、观看标记、任务下发）          │
│ - 本地设置编辑（通过 window.embyApi）          │
└─────────────────────────────────────────────┘
```

### 2.2 启动与退出

- desktop 独立启动：不依赖 service 是否运行；未连接时显示引导界面
- desktop 退出：service 和 tray 不受影响；任务继续执行
- 开发模式：Vite dev server（端口 5174–5184）提供 HMR；Electron 加载 Vite URL
- 生产模式：Electron 加载 `dist/index.html` 构建产物

---

## §3 子模块架构

### 3.1 分层模型

desktop 内部子模块按**分层**组织，下层为上层提供能力，层间通过明确的接口通信：

```
┌──────────────────────────────────────────────┐
│  UI 层 (pages/ + components/)                │
│  - 页面结构、组件层级、状态管理、中文文案       │
│  - 通过 apiClient 消费 service 数据           │
│  - 通过 window.embyApi 读写本地设置            │
│  - 通过 window.embyApi 感知连接状态            │
└──────────────────────────────────────────────┘
        │ 依赖（import）
        ▼
┌──────────────────────────────────────────────┐
│  数据层                                       │
│                                              │
│  ┌─────────────┐  ┌──────────────┐          │
│  │ apiClient    │  │ settings     │          │
│  │ (API_CLIENT) │  │ (SETTINGS)   │          │
│  │              │  │              │          │
│  │ REST 调用     │  │ 本地配置读写  │          │
│  │ 轮询机制      │  │ IPC 桥接     │          │
│  └─────────────┘  └──────────────┘          │
│         │               │                    │
│         ▼               ▼                    │
│  ┌─────────────────────────────┐            │
│  │ connection (CONNECTION)      │            │
│  │                              │            │
│  │ service 地址解析              │            │
│  │ 健康检查 + 连接门禁           │            │
│  └─────────────────────────────┘            │
└──────────────────────────────────────────────┘
```

### 3.2 子模块职责

| 子模块 | 目录 | 职责 |
|--------|------|------|
| **CONNECTION** | `src/connection/` + `electron/shelfdeckConnection.js` | service 地址解析（env > file > vite > default）、健康检查轮询、连接门禁 |
| **API_CLIENT** | `src/api/` | 类型化 REST 客户端、端点方法、轮询机制、错误处理 |
| **SETTINGS** | `src/settings/` + `electron/main.js` IPC handlers | electron-store 本地配置、IPC 桥接、设置面板 UI |
| **UI** | `src/pages/` + `src/components/` | 页面结构、组件层级、状态管理、中文文案 |

### 3.3 物理文件映射

```
media-desktop/
├── electron/                        # Electron 主进程
│   ├── main.js                      # 窗口管理、IPC handler 注册、应用生命周期
│   ├── preload.js                   # contextBridge：暴露 window.embyApi / doubanApi / mediaService / electronAPI
│   └── shelfdeckConnection.js       # [CONNECTION] 连接地址解析（主进程侧 SSOT）
│
├── src/                             # 渲染进程（React + TypeScript）
│   ├── main.tsx                     # 入口：挂载 React 根组件
│   ├── App.tsx                      # 根组件：路由、媒体库选择、全局任务轮询
│   │
│   ├── connection/                  # [CONNECTION 模块]
│   │   ├── baseUrl.ts              # 渲染进程侧 baseUrl / apiKey 读取
│   │   ├── health.ts              # 健康检查（GET /v1/health）
│   │   └── ConnectionGate.tsx      # 连接门禁组件（内部管理健康轮询；service 不可达时显示引导）
│   │
│   ├── api/                        # [API_CLIENT 模块]
│   │   ├── client.ts              # ApiClient 类：类型化 HTTP 封装、auth 注入
│   │   ├── polling.ts             # 通用轮询器（createPoller）
│   │   └── types.ts               # API 请求/响应类型
│   │
│   ├── settings/                   # [SETTINGS 模块]
│   │   ├── store.ts               # 本地设置数据模型 + IPC 桥接封装
│   │   └── SettingsPanel.tsx       # 设置面板 UI（含媒体库目录映射）
│   │
│   ├── pages/                      # [UI 模块 — 页面级组件]
│   │   ├── ContinueWatchingPage.tsx   # 继续看（海报网格 + 播放记录列表）
│   │   ├── MediaManagePage.tsx        # 媒体库管理
│   │   └── ActivityLogPage.tsx        # 实时日志
│   │
│   ├── components/                 # [UI 模块 — 共享组件]
│   │   ├── TopNav.tsx
│   │   ├── MediaLibraryManageRow.tsx
│   │   ├── FloatingTaskButton.tsx
│   │   └── ...
│   │
│   ├── models/                     # 共享数据类型（纯类型 + 展示辅助）
│   │   ├── task.ts                # MediaTask 数据模型 + 状态标签
│   │   └── media.ts               # ManagedMediaItem 数据模型 + 展示辅助
│   │
│   ├── dev/                        # 仅开发模式使用
│   │   ├── stub.ts                # Dev stub：模拟 window.embyApi / doubanApi
│   │   └── seed.ts                # Debug seed：模拟任务数据
│   │
│   ├── styles.css                  # 全局样式
│   └── global.d.ts                # 全局类型声明（window.embyApi 等）
```

---

## §4 数据流

### 4.1 意图下发（desktop → service）

```
UI 层（页面按钮点击）
    │ onEnqueue(item, action)
    ▼
apiClient.createTaskByIntent({ itemId, actionType })
    │ POST /v1/tasks
    ▼
connection 提供 baseUrl + apiKey
    │
    ▼
service REST API → TaskScheduler 接管
```

desktop 仅下发意图（itemId + actionType），不持有任何任务执行细节。service 根据 itemId 调用 Emby API 获取详细信息。

### 4.2 进度轮询（service → desktop）

```
App 启动全局任务轮询 GET /v1/tasks（间隔 400ms）
FloatingTaskButton 自己额外启动独立轮询 GET /v1/tasks（间隔 400ms）
    │
    ▼
UI 层消费任务列表 → 更新任务卡、进度条、状态标签
```

轮询由 API_CLIENT 模块的 createPoller 驱动，UI 层通过回调订阅数据更新。

### 4.3 媒体库浏览（service → desktop）

```
UI 层进入媒体库管理页
    │
    ▼
apiClient.getLibraryCache(subLibraryId) → GET /v1/library?subLibraryId= → 返回 items[] + total
    │
    ▼
UI 层展示列表，叠加本地标注（评分、观看状态）
    │
    ▼
用户修改评分 → apiClient.patchItemRatings(itemId, userRating) → service 写入
```

### 4.4 连接健康监控

```
ConnectionGate 组件内部 setInterval(checkHealth, 5000)
    │
    ▼
ConnectionGate 根据健康状态决定显示内容：
  - healthy → 渲染正常页面（children）
  - unhealthy → 显示连接引导界面
```

健康检查轮询由 ConnectionGate 组件内部管理，不通过 App 组件传递 `healthy` prop。

---

## §5 数据持有权

| 数据 | 持有模块 | 存储位置 | 说明 |
|------|----------|----------|------|
| service 地址 | SETTINGS (electron-store) | 本地磁盘 | desktop 唯一自主持有的配置 |
| API Key | SETTINGS (electron-store) | 本地磁盘 | 用于 service 认证 |
| 播放器路径 | SETTINGS (electron-store) | 本地磁盘 | PotPlayer 可执行文件路径 |
| 路径映射 | SETTINGS (electron-store) | 本地磁盘 | 全局 + 每媒体库路径映射 |
| 任务队列 | service (TaskStore) | service 端 | desktop 只读轮询 |
| 媒体库表 | service (MediaLibraryService) | service 端 | desktop 只读展示 |
| 策略建议 | service (mediaPolicyService) | service 端 | desktop 只读展示 |
| 配置（Emby/策略/调度） | service (ConfigStore) | service 端 | desktop 通过 API 读写 |

> desktop 端 `models/` 中的 `recommendedAction()` 等函数是**客户端侧展示辅助**，仅用于即时 UI 反馈（如媒体库管理页的策略预览列）。service 端计算的结果是 SSOT。当客户端侧逻辑与 service 冲突时，以 service 为准。

---

## §6 子模块通信矩阵

| 调用方 ↓ / 被调用方 → | CONNECTION | API_CLIENT | SETTINGS | models |
|---|---|---|---|---|
| **UI (pages)** | ConnectionGate | apiClient | window.embyApi | MediaTask, ManagedMediaItem |
| **UI (components)** | — | apiClient | window.embyApi | MediaTask, ManagedMediaItem |
| **API_CLIENT** | baseUrl, apiKey | — | — | API 类型 |
| **CONNECTION** | — | — | window.embyApi 读取 serviceUrl/apiKey | — |
| **SETTINGS** | 提供 URL 给 connection 解析链 | — | — | — |
| **models** | — | — | — | — |

> 所有通信均为同步函数调用（渲染进程内）或 IPC invoke（主进程 ↔ 渲染进程）。无事件总线、无消息队列。
>
> 本地设置读写通过 `window.embyApi.getSettings()` / `window.embyApi.saveSetting(key, value)` 进行，不再使用 `window.shelfdeckSettings`。

---

## §7 与 v1 架构的关键差异

| 方面 | v1 (Phase 2) | v2/v4 (Phase 3+) |
|------|-------------|---------------|
| **任务调度** | desktop 持有 client-side `taskScheduler.ts` 模拟调度 | service TaskScheduler 是唯一调度引擎；desktop 删除 `taskScheduler.ts` |
| **策略计算** | desktop `mediaManager.ts` 计算 recommendedAction | service `mediaPolicyService.js` 计算；desktop 侧仅保留展示辅助 |
| **配置同步** | desktop 通过 `controlPlaneConfigSync.ts` 推送配置到 service | service ConfigStore 是 SSOT；desktop 通过 API 读写 |
| **数据通信** | 混合 IPC + REST | 纯 REST（除 launchPlayer IPC） |
| **App.tsx** | 单体 ~1500 行组件 | 拆分为 pages/ + components/ + 数据层 |
| **连接管理** | 分散在 cpBase.ts + mediaServiceHealth.ts | 统一到 connection/ 模块 |
| **设置访问** | `window.shelfdeckSettings` | `window.embyApi.getSettings()` / `window.embyApi.saveSetting()` |
| **页面结构** | WallPage / HistoryPage | ContinueWatchingPage / ActivityLogPage |
| **tray 关系** | desktop spawn tray companion | tray 嵌入 service 进程，与 desktop 无关 |

---

## §8 子模块索引

| 子模块 | 文件 | 状态 |
|--------|------|------|
| 瘦客户端总览 | `DESKTOP.md` | 本文 |
| service 连接管理 | `DESKTOP/CONNECTION.md` | v4 |
| REST API 客户端层 | `DESKTOP/API_CLIENT.md` | v4 |
| 配置持久化 | `DESKTOP/SETTINGS.md` | v4 |
| UI 组件与布局 | `DESKTOP/UI.md` | v4 |

---

## 关联文档

- `ARCH_OVERVIEW.md` — 系统结构总览（组件边界、数据流、进程模型）
- `SERVICE.md` — 胖服务组件总览（service 侧对等架构）
- `SHARED/DATA_FLOW.md` — 意图下发 + 轮询机制（跨组件视角）
- `SHARED/DATA_MODEL.md` — 核心数据模型
- `SHARED/ERROR_HANDLING.md` — 错误码与降级策略
