# DESIGN_SERVICE/ADMIN_WEB/PAGES — 页面结构与组件

> 状态：v2 定稿
> 技术栈：Vite + React 18 + React Router v6（与 desktop 共享）

---

## §1 页面结构总览

```
http://service:18080/
├── /                   → 仪表盘（Dashboard）
├── /media-libraries    → 媒体库管理（含子库配置向导）
├── /transcode          → 转码设置
├── /douban             → 豆瓣设置
├── /moviepilot         → 洗版设置
├── /system             → 系统设置
└── /tasks              → 任务监控
```

**路由方案**：React Router v6，使用 BrowserRouter。
服务直接 Serve `dist/admin/` 下的静态资源，所有路径回退到 `index.html`（SPA 模式）。

---

## §2 页面定义

### 2.1 仪表盘（/）

**用途**：展示 service 整体运行状态，提供各模块入口链接。

**内容**：
- 服务健康状态卡片（green/yellow/red）
- 快速入口：媒体库、转码设置、任务监控
- 最近任务列表（最近 5 条）

**API 调用**：
- `GET /v1/admin/health` — 服务健康
- `GET /v1/admin/tasks?limit=5` — 最近任务

---

### 2.2 媒体库管理页（/media-libraries）

**用途**：管理所有子库（增/删/暂停/启用），通过向导添加新子库。

#### 2.2.1 子库列表

**布局**：

```
┌─────────────────────────────────────────────────────────┐
│ 媒体库管理                            [添加子库]         │
├─────────────────────────────────────────────────────────┤
│ 子库名称       Emby 服务器        媒体文件夹    状态    │
│ ─────────────────────────────────────────────────────  │
│ 电影库         NAS-Emby           电影          启用    │
│ 剧集库         NAS-Emby           剧集          启用    │
│ 美剧库         本地-Emby          美剧          暂停    │
│                                                         │
│                          [编辑]  [删除]  [暂停/启用]    │
└─────────────────────────────────────────────────────────┘
```

**API 调用**：
- `GET /v1/admin/sublibraries` — 获取子库列表

#### 2.2.2 添加子库向导（Modal 步骤式）

**Step 1：登录 Emby**

```
┌─────────────────────────────────────────────────────────┐
│ 添加子库                                        [ × ]  │
├─────────────────────────────────────────────────────────┤
│ Step 1/3：登录 Emby                                     │
│                                                         │
│ 服务器地址                                              │
│ [http://192.168.1.100:8096________________]            │
│                                                         │
│ Emby 用户名                                            │
│ [您的 Emby 登录用户名__________________]               │
│                                                         │
│ Emby 密码                                              │
│ [••••••••••••••••••••••••••••••]                     │
│ 密码仅用于登录 Emby 获取授权，不会明文存储              │
│                                                         │
│                          [取消]  [登录 Emby]            │
└─────────────────────────────────────────────────────────┘
```

点击"登录 Emby"时：
- 调用 `POST /v1/admin/emby/test`（传入 username + password）
- 后端通过 `POST /Users/AuthenticateByName` 换取 access token
- 自动获取 userId，无需用户手动选择
- 若成功，自动内联注册到 `embyServers`（token 存为 apiKey，密码存为 embyUserPassword）
- 失败则显示错误，不推进

**Step 2：选择媒体文件夹**

```
┌─────────────────────────────────────────────────────────┐
│ 添加子库                                        [ × ]  │
├─────────────────────────────────────────────────────────┤
│ Step 2/3：选择媒体文件夹                                │
│                                                         │
│ 选择要同步的 Emby 媒体文件夹（单选）                     │
│                                                         │
│ [ 电影 (section-abc123)  ▼]                           │
│                                                         │
│                          [取消]  [上一步]  [下一步]    │
└─────────────────────────────────────────────────────────┘
```

调用 `GET /v1/admin/emby/media-folders` 获取文件夹下拉列表（单选）。

**Step 4：完成**

```
┌─────────────────────────────────────────────────────────┐
│ 添加子库                                        [ × ]  │
├─────────────────────────────────────────────────────────┤
│ Step 3/3：完成                                          │
│                                                         │
│ 子库名称                                                │
│ [ 电影库________________ ]（默认用服务器名称）           │
│                                                         │
│ [✓] 启用豆瓣评分同步                                     │
│                                                         │
│ 码率策略 (Mbps)                                         │
│           2★    3★    4★    5★                        │
│ 1080p    [2]   [4]   [7]   [12]                        │
│ 4K       [5]   [10]  [16]  [25]                        │
│                          （默认继承全局策略，可自定义）    │
│                                                         │
│                          [取消]  [上一步]  [完成添加]   │
└─────────────────────────────────────────────────────────┘
```

点击"完成添加"时：
- 调用 `POST /v1/admin/sublibraries` 创建子库
- 自动用 `subLibrary.uuid` 关联刚注册的 `embyServerId`

**API 调用**：
- `POST /v1/admin/emby/test` — 验证连接
- `GET /v1/admin/emby/users` — 获取用户列表（query: embyServerId）
- `GET /v1/admin/emby/media-folders` — 获取文件夹列表（query: embyServerId）
- `POST /v1/admin/sublibraries` — 创建子库

**子库删除**：
- 调用 `DELETE /v1/admin/sublibraries/:uuid`
- 同时清理 library.json 中该子库的所有 items
- 不删除 `embyServers` 中的服务器（其他子库可能共用）

---

### 2.3 转码设置页（/transcode）

**用途**：配置转码参数和设备池。设备池配置分两步完成。

**内容布局**：

```
┌─────────────────────────────────────────────────────────┐
│ 转码设置                                                │
├─────────────────────────────────────────────────────────┤
│ 基本设置                                                │
│                                                         │
│ 临时目录 [D:\transcode    ]                            │
│ FFmpeg路径 [D:\tools\ffmpeg.exe________________]     │
│ FFprobe路径 [D:\tools\ffprobe.exe______________]     │
│                                                         │
│                          [保存基本设置]  [检测设备]     │
├─────────────────────────────────────────────────────────┤
│ 编码设备池                                              │
│                                                         │
│ 设备                     编码器      优先级  槽位  入池 │
│ ─────────────────────────────────────────────────────  │
│ NVIDIA NVENC (CUDA 0)  hevc_nvenc  [100]  [1]   [✓] │
│ CPU · libx265           libx265      [200]  [2]   [ ] │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ 其他设置                                                │
│ [ ] 转码前需确认替换                                    │
│ CPU 参与策略 [normal ▼]                                 │
├─────────────────────────────────────────────────────────┤
│ 提示: 码率策略在「媒体库」→ 子库设置中独立配置          │
├─────────────────────────────────────────────────────────┤
│                              [重置默认]  [保存设备池]   │
└─────────────────────────────────────────────────────────┘
```

**Step 1：配置基本设置**
- 配置 ffmpeg/ffprobe 路径后，点击"保存基本设置"
- 点击"检测设备"调用 `GET /v1/admin/transcode/probe-devices`（探测本机可用编码器）
- 检测结果填充到"编码设备池"表格中

**Step 2：配置设备池**
- 从检测结果中选择设备入池（勾选"入池"）
- 设置每个入池设备的优先级和槽位数
- 点击"保存设备池"调用 `PATCH /v1/admin/transcode/config`

**API 调用**：
- `GET /v1/admin/transcode/config` — 加载当前配置
- `PATCH /v1/admin/transcode/config` — 保存配置（含设备池）
- `GET /v1/admin/transcode/probe-devices` — 探测本机可用编码设备
- `GET /v1/admin/transcode/device-pool` — 加载设备池状态（轮询 5s）

**设备池状态轮询**：
- 进入页面后自动开始轮询 `GET /v1/admin/transcode/device-pool`
- 间隔：5s
- 离开页面时停止轮询

---

### 2.4 洗版设置页（/moviepilot）

**用途**：配置 MoviePilot 连接信息、路径映射和重试策略。

**内容布局**：

```
┌─────────────────────────────────────────────────────────┐
│ 洗版设置                                                │
├─────────────────────────────────────────────────────────┤
│ MoviePilot 连接                                         │
│                                                         │
│ 服务地址 [http://192.168.12.230:3000_________________]  │
│ API Token [________________________________]           │
├─────────────────────────────────────────────────────────┤
│ 路径映射                                                │
│                                                         │
│ 容器内下载目录 [/vol1/1000/media_download/shelfdeck___]  │
│ 容器内 Staging 目录 [________________________]          │
│ 本地 Staging 路径 [W:\shelfdeck_______________________]  │
├─────────────────────────────────────────────────────────┤
│ 重试策略                                                │
│                                                         │
│ 重搜间隔 (ms) [3600000]  最大重试次数 [3]                │
├─────────────────────────────────────────────────────────┤
│                              [保存洗版设置]              │
└─────────────────────────────────────────────────────────┘
```

**API 调用**：
- `GET /v1/admin/upgrade/config` — 加载当前配置（含脱敏 apiKey）
- `PATCH /v1/admin/upgrade/config` — 保存配置

**配置字段**（详见 `SERVICE/CONFIG.md` §3.3）：

| 字段 | 说明 |
|---|---|
| `moviepilot.baseUrl` | MoviePilot 服务地址 |
| `moviepilot.apiKey` | API Token（保存后脱敏显示）|
| `moviepilot.savePath` | 容器内下载目录 |
| `moviepilot.stagingPath` | 容器内 Staging 目录（可选）|
| `upgradeStagingLocalPath` | 本地 Staging 路径（SMB 映射后路径）|
| `upgradeRetryInterval` | 重搜间隔 (ms)，默认 3600000 |
| `upgradeMaxRetries` | 最大重试次数，默认 3 |

---

### 2.5 任务监控页（/tasks）

**用途**：查看所有任务状态，支持详情和删除。

**内容布局**：

```
┌─────────────────────────────────────────────────────────┐
│ 任务监控                          [刷新]                │
├─────────────────────────────────────────────────────────┤
│ 状态筛选: [全部 ▼]  类型筛选: [全部 ▼]                   │
├─────────────────────────────────────────────────────────┤
│ 任务ID    媒体项      类型    状态      进度   操作      │
│ task-001  电影名称    转码    进行中    45%    [详情]   │
│ task-002  电视剧名称  删除    待确认    -      [详情]   │
│ task-003  电影名称    转码    已完成    100%   [删除]   │
└─────────────────────────────────────────────────────────┘
```

**任务详情弹窗**：

```
┌─────────────────────────────────────────────────────────┐
│ 任务详情                              [ × ]             │
├─────────────────────────────────────────────────────────┤
│ 任务ID:    task-001                                     │
│ 媒体项:    电影名称                                       │
│ 类型:      转码                                          │
│ 状态:      进行中                                         │
│ 阶段:      编码中                                         │
│ 进度:      45%                                           │
│ 创建时间:  2026-04-26 10:00:00                          │
│ 更新时间:  2026-04-26 10:05:00                          │
├─────────────────────────────────────────────────────────┤
│ 执行日志:                                               │
│ [10:00:00] 任务开始                                     │
│ [10:00:01] precheck 通过                               │
│ [10:00:02] 开始编码                                     │
├─────────────────────────────────────────────────────────┤
│                                      [关闭]  [删除任务]  │
└─────────────────────────────────────────────────────────┘
```

**API 调用**：
- `GET /v1/admin/tasks` — 加载任务列表
- `GET /v1/admin/tasks/:id` — 加载任务详情
- `DELETE /v1/admin/tasks/:id` — 删除任务

**轮询策略**：
- 任务列表不自动轮询，用户手动刷新
- 详情弹窗内执行日志实时更新（轮询 `GET /v1/admin/tasks/:id`，间隔 2s）

---

## §3 组件层次

### 3.1 组件树

```
App
├── Layout（布局容器）
│   ├── Sidebar（侧边栏）
│   │   ├── NavLink → /media-libraries
│   │   ├── NavLink → /transcode
│   │   └── NavLink → /tasks
│   └── Outlet（子路由出口）
│
├── DashboardPage（/）
│   ├── HealthCard
│   └── QuickLinks
│
├── MediaLibrariesPage（/media-libraries）
│   ├── SubLibraryTable
│   │   └── SubLibraryRow × N
│   └── AddSubLibraryWizard（Modal，3 步）
│       ├── Step1Login（服务器 + 用户名 + 密码）
│       ├── Step2FolderSelect（媒体文件夹）
│       └── Step3NameAndConfig（名称 + 豆瓣 + 路径映射 + 策略模板）
│
├── TranscodeConfigPage（/transcode）
│   ├── TranscodeConfigForm
│   │   ├── InputField（transcodeTempRoot）
│   │   ├── InputField（ffmpegPath）
│   │   ├── InputField（ffprobePath）
│   │   ├── Button（保存基本设置）
│   │   └── Button（检测设备）
│   ├── EncodingDevicePoolTable
│   │   └── DeviceRow × N
│   │       ├── Text（deviceName）
│   │       ├── Text（encoder）
│   │       ├── NumberField（priority）
│   │       ├── NumberField（maxSlots）
│   │       └── Checkbox（inPool）
│   └── Checkbox（transcodeReplaceConfirmRequired）
│
└── TaskMonitorPage（/tasks）
    ├── TaskFilters
    ├── TaskTable
    │   └── TaskRow × N
    └── TaskDetailModal
        └── LogViewer
```

### 3.2 共享组件

| 组件 | 说明 |
|---|---|
| `InputField` | 输入框，封装 label + input + error message |
| `PasswordField` | 密码输入框，带显示/隐藏切换 |
| `NumberField` | 数字输入框，支持 min/max 校验 |
| `Select` | 下拉选择框 |
| `Checkbox` | 复选框 |
| `Button` | 按钮（primary / secondary / danger 变体） |
| `Modal` | 弹窗容器 |
| `LoadingSpinner` | 加载状态 |
| `Alert` | 成功/错误提示 |

> 建议：共享组件复用 desktop 的组件库（如有），避免重复实现。

### 3.3 Context 划分

| Context | 作用域 | 用途 |
|---|---|---|
| `ServiceApiContext` | 全局 | 封装 fetch 调用，提供 base URL 和错误处理 |
| `MediaLibrariesContext` | MediaLibrariesPage | 子库列表状态 |
| `TranscodeConfigContext` | TranscodeConfigPage | 转码配置表单状态 |
| `TaskContext` | TaskMonitorPage | 任务列表和详情状态 |

---

## §4 ServiceApiContext 设计

所有页面通过 `ServiceApiContext` 调用 service API。

### 4.1 提供的方法

```typescript
interface ServiceApiContextValue {
  // GET
  get<T>(path: string): Promise<T>;
  // PATCH
  patch<T>(path: string, body: object): Promise<T>;
  // POST
  post<T>(path: string, body?: object): Promise<T>;
  // DELETE
  delete<T>(path: string): Promise<T>;
  // 错误处理
  error: ApiError | null;
  clearError: () => void;
}
```

### 4.2 错误处理

API 错误统一在 Context 层处理：

```typescript
// 错误展示：使用 Alert 组件
{error && <Alert type="error" message={error.message} onClose={clearError} />}
```

---

## §5 与 service API 的交互约定

### 5.1 数据获取时机

| 页面 | 获取时机 |
|---|---|
| Dashboard | 组件挂载时（useEffect） |
| MediaLibrariesPage | 组件挂载时加载，子库列表不自动轮询 |
| TranscodeConfigPage | 组件挂载时加载，设备池状态 5s 轮询 |
| TaskMonitorPage | 组件挂载时加载，手动刷新触发 |

### 5.2 加载状态

- 每个数据获取操作显示 `LoadingSpinner`
- 多字段表单：整体加载状态统一管理
- 设备池轮询：后台静默更新，不遮挡用户输入

### 5.3 保存操作

- 保存前做表单校验
- 保存中按钮显示 loading 状态
- 保存成功后显示成功 Alert（3s 后自动消失）
- 保存失败后显示错误 Alert，用户可重试

---

## §6 路由配置

```typescript
// 路由配置（使用 React Router v6）
const routes = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'media-libraries', element: <MediaLibrariesPage /> },
      { path: 'transcode', element: <TranscodeConfigPage /> },
      { path: 'tasks', element: <TaskMonitorPage /> },
    ],
  },
];
```

**SPA 回退**：服务配置 `fallback: true`，所有路径回退到 `index.html`。

---

## §7 关联文档

- `SERVICE/ADMIN_WEB.md` — Web 管理端总览
- `SERVICE/ADMIN_WEB/API.md` — Admin API 端点定义
- `SERVICE/CONFIG.md` — 配置字段定义（用于表单校验）
- `SERVICE/TASK_SCHEDULER.md` — 任务状态定义
- `SERVICE/HEALTH_CHECK.md` — 健康检查 API
