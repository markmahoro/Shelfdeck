# DESIGN_DESKTOP/UI — UI 组件与布局

> 状态：v2 编写中
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
- 设置持久化（由 SETTINGS 模块的 shelfdeckSettings 负责）
- 业务逻辑计算（由 service 负责；desktop 侧仅保留展示辅助函数）

---

## §2 页面结构

### 2.1 路由表

| 页面 ID | 导航标签 | 说明 |
|---------|----------|------|
| `wall` | 海报墙 | 未观看内容浏览、评分、一键入队 |
| `mediaManage` | 媒体库管理 | 全量媒体库表格、批量操作、码率策略预览 |
| `history` | 播放记录 | 已观看历史列表 |

> **配置管理不在 desktop**：Emby 连接、媒体策略、调度参数、转码设备池、豆瓣配置等均通过 service 内置的 admin web 管理（`http://service:18080/admin`）。
>
> **任务管理不在 desktop**：全量任务列表、详情、执行日志等通过 admin web 的 `/tasks` 页面管理。desktop 仅通过 FloatingTaskButton 展示活跃任务数 + 进行中/最近完成摘要（"任务卡 UI"），以及媒体库行内的任务状态指示。完整管理功能通过 FloatingTaskButton 面板中的"在浏览器中查看完整任务中心 →"链接跳转到 admin web。

### 2.2 导航结构

```
┌─────────────────────────────────────────────────┐
│ TopNav                                           │
│  [海报墙] [媒体库管理] [播放记录]          [⚙]   │
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

- TopNav：始终可见，3 个主 tab + 设置齿轮（打开 SettingsPanel）+ 管理端链接
- FloatingTaskButton：仅当有活跃任务时显示；点击展开任务摘要面板
- ConnectionGate：覆盖层，仅在 service 不可达时显示
- SettingsPanel：覆盖层，编辑 desktop 本地设置（service 地址、API Key、播放器路径、路径映射）

### 2.3 页面切换

不实现 URL 路由（Electron 非浏览器环境）。使用 React state 驱动页面切换：

```typescript
const [page, setPage] = useState<AppPage>('wall');

// 渲染（3 页面，无路由库）
{page === 'wall' && <WallPage />}
{page === 'mediaManage' && <MediaManagePage />}
{page === 'history' && <HistoryPage />}
```

---

## §3 组件层级

### 3.1 组件树

```
App
├── TopNav
│   ├── NavTab[] (wall, mediaManage, history)
│   ├── SettingsGear → 打开 SettingsPanel
│   └── AdminLink → 在浏览器中打开 admin web
│
├── ConnectionGate
│   └── (当前页面)
│
├── WallPage
│   ├── SectionFilter（媒体库选择）
│   ├── MediaCard[]
│   │   ├── PosterImage
│   │   ├── ItemInfo（名称、时长、大小、分辨率/编码）
│   │   ├── RatingSelector（1-5 星 + 豆瓣分展示）
│   │   └── ActionButtons（已看 / 未看 / 入队）
│   └── EmptyState（无内容时）
│
├── MediaManagePage
│   ├── FilterBar
│   │   ├── ActionFilter（全部 / 转码 / 洗版 / 达标 / 未标注 / 删除）
│   │   ├── ResolutionFilter（全部 / 1080p / 4K）
│   │   ├── CodecFilter（全部 / h264 / h265 / av1）
│   │   ├── WatchedFilter（全部 / 已看 / 未看）
│   │   └── BluRayFilter（全部 / 原盘 / 非原盘）
│   ├── BatchActions
│   │   ├── SelectAll
│   │   ├── BatchEnqueue（批量入队）
│   │   └── SelectionCount
│   ├── MediaLibraryManageRow[]
│   │   ├── Checkbox
│   │   ├── ItemName
│   │   ├── SizeGb / EquivalentBitrate / TargetBitrate / PredictedSize
│   │   ├── Resolution / Codec
│   │   ├── StarStatus（豆瓣分 / 本地分）
│   │   ├── WatchedStatus
│   │   ├── TaskCell（关联任务状态）
│   │   └── ActionButtons（观看 / 星级 / 码率优化入队）
│   ├── DeleteExplainModal（删除策略说明弹窗）
│   └── SummaryStats（体积汇总、节省预估）
│
├── HistoryPage
│   ├── FilterBar
│   │   ├── DaysFilter（7天 / 30天 / 全部）
│   │   ├── SectionFilter
│   │   └── TypeFilter（全部 / 电影 / 剧集）
│   └── PlayedItemRow[]
│       ├── ItemName + SeriesName + IndexLabel
│       ├── DatePlayed
│       └── SectionName
│
├── FloatingTaskButton
│   ├── Badge（活跃任务数）
│   └── TaskSummaryPanel（展开时）
│       ├── ActiveTaskList（进行中，最多 5 条）
│       │   └── TaskRow（itemName + progress% + status）
│       ├── RecentDoneList（最近完成，最多 3 条）
│       └── AdminLink → 在浏览器中查看完整任务中心（→ admin web /tasks）
│
└── SettingsPanel（覆盖层）
    ├── ServiceUrl input
    ├── ServiceApiKey input
    ├── PlayerExePath input
    ├── LocalPathMapFrom input
    ├── LocalPathMapTo input
    └── Save button
```

### 3.2 App.tsx 职责收缩

v1 的 App.tsx 是 ~1500 行的单体组件，包含所有页面逻辑、状态、效果。v2 收缩为：

```typescript
// v2 App.tsx（~80 行）
function App() {
  const [page, setPage] = useState<AppPage>('wall');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tasks, setTasks] = useState<MediaTask[]>([]);
  const [connectionHealthy, setConnectionHealthy] = useState(false);

  // 全局轮询：任务进度（FloatingTaskButton + 各页面需要）
  // 全局轮询：健康检查（ConnectionGate 需要）

  return (
    <div className="appShell">
      <TopNav page={page} setPage={setPage} onSettingsClick={() => setSettingsOpen(true)} />
      <ConnectionGate healthy={connectionHealthy}>
        {page === 'wall' && <WallPage tasks={tasks} />}
        {page === 'mediaManage' && <MediaManagePage tasks={tasks} />}
        {page === 'history' && <HistoryPage />}
      </ConnectionGate>
      <FloatingTaskButton tasks={tasks} />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
```

---

## §4 状态管理

### 4.1 原则

- **每页独立管理状态**：不使用全局状态管理库（Redux、Zustand 等）
- **共享状态通过 props 下传**：只有 `tasks` 和 `connectionHealthy` 需要跨页面共享
- **API 数据就近获取**：每个页面组件在自己的 `useEffect` 中调用 apiClient
- **不做客户端缓存**：数据总是从 service 重新获取（desktop 是瘦客户端）

### 4.2 状态归属

| 状态 | 持有者 | 传递方式 |
|------|--------|----------|
| `page` (当前页面) | App | props 到 TopNav |
| `tasks` (任务列表) | App | props 到 WallPage、MediaManagePage、FloatingTaskButton |
| `connectionHealthy` | App | props 到 ConnectionGate |
| `settingsOpen` | App | 控制 SettingsPanel 显示 |
| 媒体库列表 + 过滤 | MediaManagePage | 内部 useState |
| 播放记录列表 + 过滤 | HistoryPage | 内部 useState |
| 海报墙列表 | WallPage | 内部 useState |
| 本地设置表单 | SettingsPanel | 内部 useState |

### 4.3 任务轮询策略

```
App 挂载 → 启动任务轮询（createPoller, 400ms）
    │
    ▼
每次 poll 获取全量任务列表 → setTasks()
    │
    ├── FloatingTaskButton 消费 tasks（显示活跃任务数）
    ├── WallPage 消费 tasks（标记已入队条目）
    └── MediaManagePage 消费 tasks（标记已入队条目）
```

任务轮询始终运行（只要组件挂载），不随页面切换启停。因为 FloatingTaskButton 需要跨页面显示任务状态。

### 4.4 健康检查轮询策略

```
App 挂载 → 启动健康检查轮询（createPoller, 5s）
    │
    ▼
每次 poll → checkHealth() → setConnectionHealthy()
    │
    ▼
ConnectionGate 消费 connectionHealthy
```

---

## §5 各页面数据流与 API 交互

### 5.1 海报墙（WallPage）

**数据源**：Emby（通过 service 代理），返回未观看内容列表。

```
WallPage 挂载
    │ useEffect
    ▼
apiClient → GET /v1/library/queries/unplayed (POST { config, sectionId })
    │
    ▼
service → EmbyService → Emby API → 返回 Emby 未观看列表
    │
    ▼
WallPage 展示卡片网格
```

**用户操作**：

| 操作 | 实现 | 说明 |
|------|------|------|
| 打分（1-5★） | `PATCH /v1/library/ratings { itemId: rating }` | 写入用户评分到 service 媒体库表 |
| 已看/未看 | `POST /v1/library/actions/mark-played` / `mark-unplayed` | service 转发到 Emby API |
| 一键入队 | `POST /v1/tasks { itemId, actionType }` | 意图下发；actionType 由 service 侧 mediaPolicyService 决定或用户在 UI 选择 |
| 播放 | `emby:launchPlayer` IPC | 启动本地播放器 |

**desktop 不做的事**：
- 不计算 `recommendedAction`（由 service `mediaPolicyService` 计算，通过 API 返回）
- 不管理播放器生命周期（仅触发启动）

### 5.2 媒体库管理（MediaManagePage）

**数据源**：service 统一媒体库表（`data/library.json`），包含 Emby 数据 + 豆瓣评分 + 用户评分。

```
MediaManagePage 挂载
    │ useEffect
    ▼
apiClient.getLibraryCache()
    │ GET /v1/library/cache
    ▼
service → MediaLibraryService → 返回 items[]（含 effectiveRating、recommendedAction）
    │
    ▼
MediaManagePage 展示表格（含策略预览列）
```

**用户操作**：

| 操作 | 实现 | 说明 |
|------|------|------|
| 已看/未看 | `POST /v1/library/actions/mark-played` / `mark-unplayed` | 同海报墙，service 转发到 Emby |
| 打分 | `PATCH /v1/library/ratings` | 同海报墙 |
| 单条入队 | `POST /v1/tasks { itemId, actionType }` | 意图下发，逐条创建 |
| 批量入队 | 逐条 `POST /v1/tasks`（循环调用） | **不做批量端点**，每条独立创建；service 的 itemId 锁自然防止重复 |
| 批量已看/未看 | 逐条 `POST /v1/library/actions/mark-played` | 同上，循环调用 |

**desktop 不做的事**：
- **不模拟调度**：v1 的 `advanceTaskQueue()`、`batchRunning`、`batchRunSelectedIds` 全部删除。任务创建后由 service TaskScheduler（5s 轮询）自动接管
- **不计算策略**：`recommendedAction()` 的结果由 service 返回，desktop 侧仅做展示；客户端侧 `mediaManager.ts` 中的策略函数降级为"即时 UI 预览"，service 结果为 SSOT

### 5.3 播放记录（HistoryPage）

**数据源**：Emby 播放记录（通过 service 代理），不是 desktop 本地记录。

```
HistoryPage 挂载
    │ useEffect
    ▼
apiClient → GET /v1/library/queries/played (POST { config, days, type, sectionId })
    │
    ▼
service → EmbyService → Emby API → 返回 UserData 中已观看的 item 列表
    │
    ▼
HistoryPage 展示列表（名称、观看日期、媒体库、类型）
```

**定位**：查看"我看过什么、什么时候看的"。属于"媒体库浏览"的一部分（已看内容的只读浏览）。

**用户操作**：

| 操作 | 实现 | 说明 |
|------|------|------|
| 标记已看 | `POST /v1/library/actions/mark-played` | 在 Emby 中标记为已观看 |
| 标记未看 | `POST /v1/library/actions/mark-unplayed` | 在 Emby 中取消已观看标记 |
| 重播 | `emby:launchPlayer` IPC | 启动本地播放器重新播放 |

### 5.4 任务卡（FloatingTaskButton）

**数据源**：service TaskStore（通过轮询）。

```
App 挂载 → createPoller(400ms)
    │
    ▼
apiClient.getTasks() → GET /v1/tasks
    │
    ▼
返回全量任务列表（含 status、progress、flowState）
    │
    ▼
FloatingTaskButton 消费：
  - Badge: 活跃任务数（status !== 'done' && !== 'failed_hard'）
  - 展开面板: 进行中（前 5 条）+ 最近完成（前 3 条）
  - 底部链接: 跳转 admin web /tasks
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
| 路径映射（源） | `shelfdeck.localPathMapFrom` | 播放时路径转换 |
| 路径映射（目标） | `shelfdeck.localPathMapTo` | 播放时路径转换 |

### 5.6 API 端点汇总

desktop 调用的全部端点：

| 端点 | 方法 | 用途 | 调用页面 |
|------|------|------|----------|
| `/v1/tasks` | GET | 任务列表（轮询） | App（全局） |
| `/v1/tasks` | POST | 意图下发创建任务 | WallPage, MediaManagePage |
| `/v1/tasks/:id` | PATCH | 更新任务（确认/暂停/删除） | FloatingTaskButton |
| `/v1/tasks/:id/actions/execute` | POST | 手动执行 | FloatingTaskButton |
| `/v1/tasks/:id/actions/pause` | POST | 暂停任务 | FloatingTaskButton |
| `/v1/tasks/:id` | DELETE | 删除任务 | FloatingTaskButton |
| `/v1/library/cache` | GET | 媒体库全量表 | MediaManagePage |
| `/v1/library/queries/unplayed` | POST | 未观看列表 | WallPage |
| `/v1/library/queries/played` | POST | 播放记录 | HistoryPage |
| `/v1/library/ratings` | GET | 用户评分表 | WallPage, MediaManagePage |
| `/v1/library/ratings` | PATCH | 更新用户评分 | WallPage, MediaManagePage |
| `/v1/library/actions/mark-played` | POST | 标记已看 | WallPage, MediaManagePage, HistoryPage |
| `/v1/library/actions/mark-unplayed` | POST | 标记未看 | WallPage, MediaManagePage, HistoryPage |
| `/v1/health` | GET | 健康检查 | App（ConnectionGate） |

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
| 海报墙 | 海报墙 |
| 媒体库管理 | 媒体库管理 |
| 播放记录 | 播放记录 |
| 设置 | ⚙ 图标（打开 SettingsPanel，仅 desktop 本地设置） |

### 6.5 空状态与错误

| 场景 | 文案 |
|------|------|
| service 未连接 | 媒体管理服务未连接 |
| 连接引导 | 请确保 ShelfDeck 小助手（托盘）正在运行，或手动配置服务地址 |
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
| 海报墙 | CSS Grid，自动填充列（最小卡片宽度 220px） |
| 媒体库管理 | 固定表格布局（横向滚动） |
| 播放记录 | 列表布局 |

### 7.3 主题

- 浅色主题（白色背景 + #4a90d9 强调色）
- 不实现深色模式切换（v2 范围外）

---

## §8 组件通信约定

### 8.1 页面与 App 通信

```typescript
// 页面通过 props 接收共享数据
<WallPage tasks={tasks} />

// 页面通过回调通知 App 切换页面
<TopNav setPage={setPage} />
```

### 8.2 组件与 API 通信

```typescript
// 组件直接 import apiClient 单例
import { apiClient } from '../api/client';

function WallPage() {
  useEffect(() => {
    apiClient.getLibraryCache().then(setItems);
  }, []);
}
```

不通过中间层（如 custom hook useLibrary()）。瘦客户端不需要额外的抽象层。

### 8.3 组件与设置通信

```typescript
// SettingsPanel 通过 shelfdeckSettings 读写
await window.shelfdeckSettings!.set('shelfdeck.mediaService.baseUrl', url);

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
