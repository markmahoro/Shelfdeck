# ARCH_OVERVIEW — 系统结构总览

> Phase 3（服务执行引擎）为基准架构。

## §1 组件边界

### 1.1 逻辑组件

系统分为 2 个逻辑组件：

| 组件 | 职责 | 定位 |
|------|------|------|
| **service** | 任务执行引擎、任务持久化、Web 管理端、Emby 集成、豆瓣集成 | 胖服务 |
| **desktop** | 意图下发、任务卡 UI、媒体库浏览 | 瘦客户端 |

### 1.2 物理进程

对应 3 个独立进程：

| 进程 | 包 | 职责 |
|------|-----|------|
| `media-desktop` | media-desktop | Electron 主进程 + 渲染进程 |
| `media-tray-supervisor` | media-tray-supervisor | Windows 托盘 Supervisor |
| `media-service` | media-service | Fastify HTTP 服务 |

> tray-supervisor 在 Phase 3 的定位是 **service 的 Windows 托盘外壳**，不承载独立业务逻辑。

### 1.3 组件间协议

全部跨组件通信均为 **HTTP REST**。

---

## §2 进程模型

### 2.1 启动关系

```
用户点击 desktop 快捷方式
    └── desktop 进程启动（独立）

用户点击 tray 快捷方式
    └── tray 进程启动
            └── spawn media-service 子进程（生命期绑定 tray）
            └── 退出 tray → 带走 service 子进程
```

- **desktop 独立启动**：不依赖 service 是否运行；未连接时显示引导界面
- **tray 启动**：spawn service 子进程，service 生命期与 tray 绑定；Windows 外壳模式下 tray 退出则 service 终止

### 2.2 退出影响

| 进程退出 | 影响范围 |
|----------|----------|
| desktop 退出 | service 和 tray 不受影响；任务继续执行 |
| tray 退出 | 一定带走 service（Windows 外壳模式）；desktop 连接中断 |
| service 退出 | 正在执行的任务中断；desktop 连接中断 |


---

## §3 数据流

### 3.1 意图下发（桌面 → 服务）

桌面不承载任务逻辑，仅下发用户意图：

```
desktop 渲染进程
    │ POST /v1/tasks { itemId, actionType }
    ▼
service REST API
    └── taskScheduler 接收任务
            └── taskExecutor 执行（见 TASK_SCHEDULER）
```

**意图内容（Phase 3 简化）**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `itemId` | string | Emby 媒体项 ID |
| `actionType` | string | `transcode` \| `delete` \| `upgrade` |

service 根据 `itemId` 调用 Emby API 获取详细信息（路径、名称、时长等），桌面不持有任何任务细节。

### 3.2 进度推送（服务 → 桌面）

Phase 3 从 IPC 迁移到 REST 后，进度推送改为轮询机制。desktop 通过以下端点轮询任务状态：

```
desktop 渲染进程
    │ 轮询 GET /v1/tasks（间隔 400ms）
    ▼
service REST API
    └── 返回当前任务列表（含 status、progress、flowState）
```

### 3.3 状态数据流（桌面只读）

桌面通过以下端点读取任务状态（不写）：

| 端点 | 用途 |
|------|------|
| `GET /v1/tasks` | 任务队列列表 |
| `GET /v1/tasks/:id` | 单个任务详情 |
| `GET /v1/health` | 服务健康状态 |

**状态所有权**：

| 状态 | service | desktop | tray |
|------|---------|---------|------|
| 任务队列 | ✅ 读写（SSOT） | ❌ 只读 | ❌ |
| Emby 连接信息 | ✅ | ❌ | ❌ |
| service 地址 | ❌ | ✅ 自己管理 | ❌ |
| 路径映射 | ✅（SSOT） | ❌ | ❌ |

---

## §5 部署拓扑

Phase 3 service 端固定部署在 Windows 上，由 tray-supervisor 作为 Windows 外壳管理。

```
同一台 Windows 机器
┌─────────────────────────────────────────────┐
│  tray (ShelfDeck 小助手)                     │
│      └── spawn service 子进程                │
│  desktop (Electron) ──HTTP──▶ service :18080│
└─────────────────────────────────────────────┘
```

- tray 不管理连接配置，只负责 spawn service 子进程
- service 端口固定 18080
- desktop 通过 electron-store 保存的地址连接 service

---

## §6 相位对照

| | P1 | P2 | P3 | P4 (v1.0.0) |
|---|-----|-----|-----|-----|
| **组件边界** | 单体 | 3 组件 | 2 逻辑组件（service 胖服务 + desktop 瘦客户端） | 同 P3 |
| **进程模型** | 1 进程 | 3 进程 | 3 进程；tray spawn service 子进程 | 同 P3 |
| **数据流** | IPC | IPC | REST | 同 P3 |
| **部署拓扑** | 无 tray | tray 独立进程 | tray Windows 外壳（spawn service） | 同 P3 |

---

## §7 外部集成

外部系统通过 service 集成，不与 desktop 直接通信：

| 系统 | 集成方式 | 说明 |
|------|----------|------|
| **Emby** | service → Emby REST API | 用户认证、媒体库、播放 |
| **豆瓣** | service → 豆瓣 API | 评分同步 |
| **外部播放器** | desktop → spawn | emby:launchPlayer IPC |
| **MoviePilot** | service REST API | 未来洗版功能（预留） |

---

## §8 整体产品定位与架构关系

### 8.1 产品定位

媒体库管家 = 资产盘点 + 推荐消费 + 空间管理 + 发现缺口

| 模块 | 本质 | 差异化 |
|------|------|--------|
| 精准资产盘点 | 清楚"我和我的内容是什么关系" | 用户私有数据（评分、观看记录、个人评价、场景标签） |
| 推荐已有 | 告诉你接下来看库的哪部 | 基于私有数据推荐，不是公开榜单 |
| 空间分级管理 | 每个内容占用它值得的空间 | 转码层/永久层/缓存层智能决策 |
| 发现缺口 | 发现你自己都不知道缺什么 | 关联查询，不是遍历公开库 |

**核心竞争力**：用户和内容的关系数据。内容本身谁都能爬，但"你和每部电影的关系"只有你有。

**元数据**：Emby/TMDB 只能提供内容元数据，是基础设施，不是竞争力。内容来源层可插拔。

### 8.2 当前架构如何支撑

| 产品模块 | 支撑架构 |
|----------|----------|
| 资产盘点 | service 持有用户私有数据（评分、观看记录、个人评价） |
| 推荐已有 | service 计算推荐逻辑，desktop 只展示结果 |
| 空间管理 | service 执行转码/删除/洗版任务（taskExecutor） |
| 发现缺口 | 待实现 |
| 内容来源可插拔 | service 通过 Emby 适配器获取媒体元数据，未来可替换为其他适配器 |

### 8.3 未来演进

- 支持 Docker 部署：service 可运行在 NAS/Docker 环境，desktop 通过 HTTP 远端连接
- #4 发现缺口：需要新的查询/推荐算法模块
- 内容来源多适配器：同时支持 Emby + 本地文件夹，以 TMDB ID 去重

---

## 关联文档

