# DESIGN_DESKTOP/UI — UI 组件与布局

> 状态：v4
> SSOT：本文是 desktop 渲染进程的页面结构、组件层级、状态管理方式和中文文案规范的唯一事实来源

---

## §1 职责边界

UI 模块负责 desktop 的所有用户界面：

- **页面结构**：定义导航和页面路由
- **组件层级**：页面 → 区块 → 行组件的嵌套关系
- **状态管理**：每页独立的 React hooks 模式
- **中文文案**：用户可见文字规范

UI 模块 **不负责**：
- REST 调用（由 API_CLIENT 模块的 apiClient 负责）
- 连接管理（由 CONNECTION 模块的 ConnectionGate 负责）
- 设置持久化（由 SETTINGS 模块的 window.embyApi 负责）
- 业务逻辑计算（由 service 负责；desktop 侧仅保留展示辅助函数）

---

## §2 页面结构

### 2.1 路由表

| 页面 ID | 导航标签 | 说明 |
|---------|----------|------|
| `continueWatching` | 继续看 | 未观看内容浏览（海报网格）+ 最近播放记录列表 |
| `mediaManage` | 媒体库管理 | 全量媒体库表格、批量操作、码率策略预览 |
| `activityLog` | 实时日志 | service 端活动日志流 |

> **配置管理不在 desktop**：Emby 连接、媒体策略、调度参数、转码设备池、豆瓣配置等均通过 service 内置的 admin web 管理（`http://service:18080/admin`）。
>
> **任务管理不在 desktop**：全量任务列表、详情、执行日志等通过 admin web 的 `/tasks` 页面管理。desktop 仅通过 FloatingTaskButton 展示活跃任务数 + 进行中/最近完成摘要（"任务卡 UI"），以及媒体库行内的任务状态指示。完整管理功能通过 FloatingTaskButton 面板中的"在浏览器中查看完整任务中心 →"链接跳转到 admin web。

### 2.2 导航结构

```
┌─────────────────────────────────────────────────┐
│ TopNav                                           │
│  [当前媒体库 ▼]    [继续看] [媒体库管理] [实时日志] [⚙] │
├─────────────────────────────────────────────────┤
│                                                   │
│  当前页面内容                                      │
│                                                   │
├─────────────────────────────────────────────────┤
│ ConnectionGate（连接断开时覆盖整个内容区）          │
└─────────────────────────────────────────────────┘
                        ┌──────┐
                        │ N  │  FloatingTaskButton
                        └──────┘  （有活跃任务时显示）
```

- TopNav：始终可见，媒体库选择器 + 3 个主 tab + 设置齿轮（打开 SettingsPanel）
- FloatingTaskButton：仅当有活跃任务时显示；点击展开任务摘要面板（自己独立轮询）
- ConnectionGate：覆盖层，仅在 service 不可达时显示（内部管理健康轮询）
- SettingsPanel：覆盖层，编辑 desktop 本地设置（service 地址、API Key、播放器路径、路径映射、媒体库目录映射）

### 2.3 页面切换

不实现 URL 路由（Electron 非浏览器环境）。使用 React state 驱动页面切换：

```typescript
type AppPage = 'continueWatching' | 'mediaManage' | 'activityLog';

// 渲染（3 页面，无路由库）
{page === 'continueWatching' && <ContinueWatchingPage tasks={tasks} subLibraryId={subLibraryId} />}
{page === 'mediaManage' && <MediaManagePage tasks={tasks} subLibraryId={subLibraryId} />}
{page === 'activityLog' && <ActivityLogPage />}
```

---

## §3 组件层级

### 3.1 组件树

```
App
├── TopNav
│   ├── MediaLibrarySelector（当前媒体库下拉选择 + 全部媒体库选项）
│   ├── NavTab[] (continueWatching, mediaManage, activityLog)
│   └── SettingsGear → 打开 SettingsPanel
│
├── ConnectionGate ({ children, onSettingsOpen })
│   └── (当前页面)
│
├── ContinueWatchingPage
│   ├── PosterGrid（未观看内容海报网格）
│   │   └── PosterCard[]
│   │       ├── PosterImage
│   │       ├── ItemName
│   │       └── PlayButton → emby:launchPlayer IPC
│   └── PlaybackLogList（最近播放记录）
│       └── PlaybackLogRow[]
│           ├── ItemName + SectionName
│           └── PlayedAt
│
├── MediaManagePage
│   ├── FilterBar（9 个筛选器 + 名称搜索）
│   │   ├── ActionFilter（全部 / 转码 / 洗版 / 达标 / 未标注 / 删除）
│   │   ├── ResolutionFilter（全部 / 1080p / 4K）
│   │   ├── CodecFilter（全部 / h264 / h265 / av1）
│   │   ├── WatchedFilter（全部 / 已看 / 未看）
│   │   ├── BluRayFilter（全部 / 原盘 / 非原盘）
│   │   ├── DoubanFilter（全部 / 有评分 / 无评分）
│   │   ├── LocalRatingFilter（5★ / 4★ / … / 1★ / 无评分）
│   │   ├── TaskFilter（全部 / 活跃任务 / 无任务）
│   │   └── SearchInput（名称关键字搜索）
│   ├── BatchActions
│   │   ├── SelectAll
│   │   ├── BatchEnqueue（批量入队）
│   │   └── SelectionCount
│   ├── RecomputeStrategyBtn（刷新媒体库管理策略 → apiClient.recomputeStrategy()）
│   ├── MediaLibraryManageRow[]（13 列：与 admin-web 对齐）
│   │   ├── ItemName
│   │   ├── SizeGb
│   │   ├── Resolution
│   │   ├── Codec
│   │   ├── CurrentBitrate（equivalentBitrate Mbps）
│   │   ├── TargetBitrate（Mbps）
│   │   ├── PredictedSize（predictedSizeGb GB）
│   │   ├── IsDisc（原盘标记）
│   │   ├── DoubanStars → Stars 组件（视觉星标 ★，只读展示豆瓣评分）
│   │   ├── UserStars → StarInput 组件（可点击交互星标，hover 预览，写入 userRating）
│   │   ├── WatchedStatus（已看/未看按钮组）
│   │   ├── StrategyCell（action + reason 提示文字；keep 时显示 item.reason）
│   │   └── TaskCell（关联任务状态 + 入队按钮）
│   └── SummaryStats（体积汇总、节省预估）
│
├── ActivityLogPage
│   ├── LogEntry[]
│   │   ├── Timestamp
│   │   ├── Source
│   │   └── Message + Detail
│   └── EmptyState（无日志时）
│
├── FloatingTaskButton（自己的独立任务轮询）
│   ├── Badge（活跃任务数 / 待确认数）
│   └── TaskSummaryPanel（展开时）
│       ├── ConfirmNeededSection（待确认，红色高亮）
│       │   └── TaskCard（详情展开 + 确认按钮）
│       ├── ActiveTaskList（进行中，最多 8 条）
│       │   └── TaskRow（itemName + progress% + status + 暂停/执行按钮）
│       ├── RecentDoneList（最近完成，最多 3 条）
│       └── AdminLink → 在浏览器中查看完整任务中心（→ admin web /admin）
│
└── SettingsPanel（覆盖层）
    ├── ServiceUrl input
    ├── ServiceApiKey input
    ├── PlayerExePath input
    ├── 媒体库目录映射（per-subLibrary path map section）
    └── Save button
```

### 3.2 App.tsx 职责收缩

v1 的 App.tsx 是 ~1500 行的单体组件，包含所有页面逻辑、状态、效果。v4 收缩为：

```typescript
// v4 App.tsx（~80 行）
function App() {
  const [page, setPage] = useState<AppPage>('continueWatching');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tasks, setTasks] = useState<MediaTask[]>([]);
  const [subLibraries, setSubLibraries] = useState<SubLibraryInfo[]>([]);
  const [subLibraryId, setSubLibraryId] = useState<string>('');

  // 全局任务轮询（供页面使用）
  // 媒体库列表加载

  return (
    <div className="appShell">
      <TopNav page={page} setPage={setPage} onSettingsClick={...}
        subLibraries={subLibraries} subLibraryId={subLibraryId} onSubLibraryChange={setSubLibraryId} />
      <ConnectionGate onSettingsOpen={...}>
        {page === 'continueWatching' && <ContinueWatchingPage tasks={tasks} subLibraryId={subLibraryId} />}
        {page === 'mediaManage' && <MediaManagePage tasks={tasks} subLibraryId={subLibraryId} />}
        {page === 'activityLog' && <ActivityLogPage />}
      </ConnectionGate>
      <FloatingTaskButton baseUrl={baseUrl} />
      {settingsOpen && <SettingsPanel onClose={...} subLibraries={subLibraries} />}
    </div>
  );
}
```

**关键变化**：
- `ConnectionGate` **不接受 `healthy` prop** — 它内部管理自己的健康检查轮询 (`setInterval(checkHealth, 5000)`)
- 签名：`ConnectionGate({ children, onSettingsOpen })`
- `FloatingTaskButton` **自己运行独立的任务轮询** — 不从 App 接收 `tasks` prop

---

## §4 状态管理

### 4.1 原则

- **每页独立管理状态**：不使用全局状态管理库（Redux、Zustand 等）
- **共享状态通过 props 下传**：`tasks` 通过 props 传递到页面
- **API 数据就近获取**：每个页面组件在自己的 `useEffect` 中调用 apiClient
- **不做客户端缓存**：数据总是从 service 重新获取（desktop 是瘦客户端）

### 4.2 状态归属

| 状态 | 持有者 | 传递方式 |
|------|--------|----------|
| `page` (当前页面) | App | props 到 TopNav |
| `tasks` (任务列表) | App | props 到 ContinueWatchingPage、MediaManagePage |
| `subLibraries` (媒体库列表) | App | props 到 TopNav、SettingsPanel |
| `subLibraryId` (当前选中媒体库) | App | props 到 TopNav、各页面 |
| `settingsOpen` | App | 控制 SettingsPanel 显示 |
| 连接健康状态 | ConnectionGate | 内部管理 |
| FloatingTaskButton 任务列表 | FloatingTaskButton | 内部独立轮询 |
| 媒体库列表 + 过滤 | MediaManagePage | 内部 useState |
| 活动日志列表 | ActivityLogPage | 内部 useState |
| 继续看列表 | ContinueWatchingPage | 内部 useState |
| 本地设置表单 | SettingsPanel | 内部 useState |

### 4.3 任务轮询策略

任务轮询有**两个独立实例**：

1. **App 全局轮询**（`createPoller, 400ms`）：供 ContinueWatchingPage 和 MediaManagePage 消费（标记已入队条目）
2. **FloatingTaskButton 独立轮询**（`createPoller, 400ms`）：在 FloatingTaskButton 组件内部挂载时启动，独立于 App 的轮询

两个轮询各自独立运行，互不依赖。

### 4.4 健康检查轮询策略

```
ConnectionGate 挂载 → setInterval(checkHealth, 5000) 内部管理
    │
    ▼
每次 poll → checkHealth() → setHealthy(ok) → setChecking(false)
    │
    ▼
ConnectionGate 根据 healthy 状态决定渲染内容：
  - checking=true → "正在连接媒体管理服务..."
  - healthy=false → 连接引导界面
  - healthy=true → children（正常页面）
```

健康检查轮询由 ConnectionGate 组件**内部管理**，不通过 App 组件传递 `healthy` prop。App 不持有 `connectionHealthy` 状态。

---

## §5 各页面数据流与 API 交互

### 5.1 继续看（ContinueWatchingPage）

**数据源**：service 未观看内容列表 + 本地播放记录。

```
ContinueWatchingPage 挂载
    │ useEffect
    ▼
apiClient.getUnplayedItems(subLibraryId) → POST /v1/library/queries/unplayed
apiClient.getPlaybackLog(subLibraryId) → GET /v1/library/playback-log
    │
    ▼
展示海报网格 + 最近播放记录列表
```

**用户操作**：

| 操作 | 实现 | 说明 |
|------|------|------|
| 播放 | `emby:launchPlayer` IPC + `apiClient.recordPlay()` | 启动本地播放器，同时记录播放 |
| 打分（1-5★） | `PATCH /v1/library/ratings { itemId, userRating }` | 写入用户评分到 service 媒体库表 |
| 已看/未看 | `POST /v1/library/actions/mark-played` / `mark-unplayed` | service 转发到 Emby API |
| 一键入队 | `POST /v1/tasks { itemId, actionType }` | 意图下发 |

### 5.2 媒体库管理（MediaManagePage）

**数据源**：service 统一媒体库表（`data/library.json`），包含 Emby 数据 + 豆瓣评分 + 用户评分。

```
MediaManagePage 挂载
    │ useEffect
    ▼
apiClient.getLibraryCache(subLibraryId)
    │ GET /v1/library?subLibraryId=
    ▼
service → MediaLibraryService → 返回 { items[], total }
    │
    ▼
MediaManagePage 展示 13 列表格（与 admin-web 对齐）
```

**策略重算流程**：

```
用户点击「刷新媒体库管理策略」
    │
    ▼
apiClient.recomputeStrategy()
    │ POST /v1/library/actions/recompute-strategy
    ▼
service → StrategyEngine.runOnce() → 全量重算 → 写回 library.json
    │
    ▼
MediaManagePage increment refreshKey → 自动重新加载列表
```

**用户操作**：

| 操作 | 实现 | 说明 |
|------|------|------|
| 已看/未看 | `POST /v1/library/actions/mark-played` / `mark-unplayed` | 同继续看，service 转发到 Emby |
| 打分 | `PATCH /v1/library/ratings { itemId, userRating }` | 单条更新评分 |
| 单条入队 | `POST /v1/tasks { itemId, actionType }` | 意图下发，逐条创建 |
| 批量入队 | 逐条 `POST /v1/tasks`（循环调用） | **不做批量端点**，每条独立创建；service 的 itemId 锁自然防止重复 |
| 批量已看/未看 | 逐条 `POST /v1/library/actions/mark-played` | 同上，循环调用 |

**desktop 不做的事**：
- **不模拟调度**：v1 的 `advanceTaskQueue()`、`batchRunning`、`batchRunSelectedIds` 全部删除。任务创建后由 service TaskScheduler（5s 轮询）自动接管
- **不计算策略**：`recommendedAction()` 的结果由 service 返回，desktop 侧仅做展示；客户端侧策略函数降级为"即时 UI 预览"，service 结果为 SSOT

### 5.3 实时日志（ActivityLogPage）

**数据源**：service 活动日志。

```
ActivityLogPage 挂载
    │ useEffect
    ▼
apiClient.getActivityLog(limit) → GET /v1/activity-log?limit=
    │
    ▼
展示日志条目列表（时间戳、来源、消息内容）
```

### 5.4 任务卡（FloatingTaskButton）

**数据源**：service TaskStore（通过独立轮询，不由 App 传递）。

```
FloatingTaskButton 挂载 → createPoller(400ms)（独立实例）
    │
    ▼
apiClient.getTasks() → GET /v1/tasks
    │
    ▼
返回全量任务列表（含 status、progress、flowState）
    │
    ▼
FloatingTaskButton 消费：
  - Badge: 待确认数（红色）或活跃任务数（蓝色）
  - 展开面板: 待确认（分组展示，红色高亮）+ 进行中（前 8 条）+ 最近完成（前 3 条）
  - 底部链接: 跳转 admin web /admin
```

**desktop 不做的事**：
- 不做全量任务列表（在 admin web /tasks）
- 不做任务执行日志（flowLog 在 admin web 查看）
- 不做任务筛选

### 5.5 本地设置（SettingsPanel）

仅管理 desktop 自身的本地配置（electron-store），不涉及 service 配置。

| 设置项 | 存储键 | 影响范围 |
|--------|--------|----------|
| service 地址 | `shelfdeck.mediaService.baseUrl` | CONNECTION 模块读取 |
| API Key | `shelfdeck.mediaService.apiKey` | ApiClient 注入 X-API-Key |
| 播放器路径 | `shelfdeck.playerExePath` | emby:launchPlayer 使用 |
| 全局路径映射（源） | `shelfdeck.localPathMapFrom` | 播放时路径转换 |
| 全局路径映射（目标） | `shelfdeck.localPathMapTo` | 播放时路径转换 |
| 媒体库目录映射 | `shelfdeck.subLibraryPathMaps` | 每媒体库播放时路径转换 |

### 5.6 API 端点汇总

desktop 调用的全部端点：

| 端点 | 方法 | 用途 | 调用方 |
|------|------|------|----------|
| `/v1/tasks` | GET | 任务列表（轮询） | App（全局）、FloatingTaskButton（独立） |
| `/v1/tasks` | POST | 意图下发创建任务 | ContinueWatchingPage, MediaManagePage |
| `/v1/tasks/:id` | GET | 单个任务详情 | FloatingTaskButton（展开详情时） |
| `/v1/tasks/:id` | PATCH | 更新任务（确认） | FloatingTaskButton |
| `/v1/tasks/:id/actions/execute` | POST | 手动执行 | FloatingTaskButton |
| `/v1/tasks/:id/actions/pause` | POST | 暂停任务 | FloatingTaskButton |
| `/v1/tasks/:id` | DELETE | 删除任务 | FloatingTaskButton |
| `/v1/library` | GET | 媒体库全量表（?subLibraryId=） | MediaManagePage |
| `/v1/library/status` | GET | 媒体库列表（subLibrary 元信息） | App（加载时） |
| `/v1/library/playback-log` | GET | 播放记录（本地操作记录） | ContinueWatchingPage |
| `/v1/library/playback-log/record` | POST | 记录播放 | ContinueWatchingPage（启动播放器时） |
| `/v1/library/queries/unplayed` | POST | 未观看列表 | ContinueWatchingPage |
| `/v1/library/ratings` | GET | 用户评分表 | ContinueWatchingPage, MediaManagePage |
| `/v1/library/ratings` | PATCH | 更新用户评分（{ itemId, userRating }） | ContinueWatchingPage, MediaManagePage |
| `/v1/library/actions/mark-played` | POST | 标记已看 | ContinueWatchingPage, MediaManagePage |
| `/v1/library/actions/mark-unplayed` | POST | 标记未看 | ContinueWatchingPage, MediaManagePage |
| `/v1/activity-log` | GET | 活动日志 | ActivityLogPage |
| `/v1/health` | GET | 健康检查 | ConnectionGate（内部） |

---

## §6 中文文案规范

### 6.1 任务状态

| 状态值 | 用户可见文案 |
|--------|-------------|
| `pending_manual` | 待启动 |
| `queued` | 排队中 |
| `precheck` | 预检中 |
| `executing` | 执行中 |
| `verify` | 校验中 |
| `awaiting_user_confirm` | 待信息确认 |
| `waiting_media_source` | 等待媒体片源 |
| `paused` | 已暂停 |
| `interrupted` | 已中断 |
| `resume_pending` | 待恢复 |
| `done` | 已完成 |
| `failed_hard` | 已失败 |

### 6.2 任务类型

| actionType | 用户可见文案 |
|------------|-------------|
| `transcode` | 码率压缩 |
| `upgrade` | 洗版 |
| `delete` | 删除 |

### 6.3 按钮文案

| 场景 | 文案 |
|------|------|
| 加入转码任务 | 码率压缩 |
| 加入洗版任务 | 洗版 |
| 加入删除任务 | 加入删除任务 |
| 执行任务 | 执行 |
| 暂停任务 | 暂停 |
| 删除任务 | 删除 |
| 标记已看 | 已看 |
| 标记未看 | 未看 |
| 保存本地设置 | 保存 |

### 6.4 导航与标签

| 页面 | 导航标签 |
|------|----------|
| 继续看 | 继续看 |
| 媒体库管理 | 媒体库管理 |
| 实时日志 | 实时日志 |
| 设置 | ⚙ 图标（打开 SettingsPanel，仅 desktop 本地设置） |

### 6.5 空状态与错误

| 场景 | 文案 |
|------|------|
| 正在连接 | 正在连接媒体管理服务... |
| service 未连接 | 媒体管理服务未连接 |
| 连接引导 | 无法连接媒体管理服务。请确认服务已启动，或手动配置服务地址。 |
| 媒体库为空 | 暂未获取到媒体库数据 |
| 无任务 | 暂无任务 |
| 无播放记录 | 暂无播放记录 |

### 6.6 规范

- 用户可见文案使用中文
- 技术术语保留英文（如 API Key、ffmpeg、Codec、slot）
- 按钮使用动词短语（"码率压缩" 而非 "进行码率压缩"）
- 状态使用简短名词（"排队中" 而非 "任务正在排队中"）
- 错误提示解释原因 + 建议操作（"保存配置不成功。原因：..."）

---

## §7 响应式布局

### 7.1 窗口尺寸

- 默认：1360×900（最大化启动）
- 最小：1024×768（Electron 默认约束）
- 不做移动端适配（desktop 仅桌面使用）

### 7.2 布局策略

| 页面 | 布局 |
|------|------|
| 继续看 | CSS Grid（海报网格）+ 列表（播放记录） |
| 媒体库管理 | 固定表格布局（横向滚动） |
| 实时日志 | 列表布局 |

### 7.3 主题

- 浅色主题（白色背景 + #4a90d9 强调色）
- 不实现深色模式切换（v4 范围外）

---

## §8 组件通信约定

### 8.1 页面与 App 通信

```typescript
// 页面通过 props 接收共享数据
<ContinueWatchingPage tasks={tasks} subLibraryId={subLibraryId} />

// 页面通过回调通知 App 切换页面
<TopNav setPage={setPage} />
```

### 8.2 组件与 API 通信

```typescript
// 组件直接 import apiClient 单例
import { apiClient } from '../api/client';

function MediaManagePage() {
  useEffect(() => {
    apiClient.getLibraryCache(subLibraryId).then(setItems);
  }, [subLibraryId]);
}
```

不通过中间层（如 custom hook useLibrary()）。瘦客户端不需要额外的抽象层。

### 8.3 组件与设置通信

```typescript
// SettingsPanel 通过 window.embyApi 读写
import { getSettings, saveSetting } from '../settings/store';

await saveSetting('serviceUrl', url);

// 其他组件通过 CONNECTION 模块读取
import { getBaseUrl } from '../connection/baseUrl';
```

---

## 关联文档

- `DESKTOP.md` — 瘦客户端总览（§3 子模块架构）
- `DESKTOP/CONNECTION.md` — 连接管理（ConnectionGate 组件）
- `DESKTOP/API_CLIENT.md` — API 客户端层（apiClient 消费）
- `DESKTOP/SETTINGS.md` — 配置持久化（SettingsPanel 组件）
- `archive/design/DESIGN_DESKTOP_UI_COPY.md` — v1 中文文案参考（历史归档）
