# DESIGN_SERVICE/ADMIN_WEB — Web 管理端

> Phase 3 为基准架构。
> 状态：v2 定稿

## §1 职责定位

Web 管理端是 service 内置的 React 管理页面，用于运维人员直接配置和管理 service，无需通过 desktop 客户端。

| 维度 | 说明 |
|---|---|
| **访问地址** | `http://service:18080/`（直接访问 service 根路径） |
| **静态资源** | `dist/admin/`（由 Vite + React 构建输出） |
| **专用端点** | `/v1/admin/*`（与 desktop 端 `/v1/*` 端点分离） |
| **调用方式** | 管理页面 JS 调用 service REST API |

**与 desktop 的关系**：
- desktop 是普通用户的瘦客户端，承载媒体库浏览和任务下发
- admin_web 是运维人员的配置管理界面，承载媒体库/子库管理、转码设置、任务监控
- 两者调用不同的端点域（`/v1/*` vs `/v1/admin/*`），但底层共用同一套 service 模块

## §2 技术栈

| 层级 | 技术选型 | 说明 |
|---|---|---|
| 构建工具 | Vite | 与 desktop 相同技术栈，共享 vite 配置 |
| 前端框架 | React 18 | 与 desktop 相同 |
| 路由 | React Router v6 | 管理页面内部路由 |
| 状态管理 | React Context + Hooks | 各子模块独立 Context，无需 Redux |
| HTTP 客户端 | fetch | 复用 service REST API 调用 |
| UI 组件 | 待定 | 建议复用 desktop 的组件库（如有） |

**构建输出**：`dist/admin/` 目录由 Vite 构建产生，service 通过 `fastify-static` 或内置中间件直接 Serve。

## §3 组件边界

根据 `ARCH_OVERVIEW.md` §1 的组件边界定义：

```
┌─────────────────────────────────────────────────────┐
│                  media-service 进程                   │
│                                                      │
│  ┌─────────────────┐    ┌─────────────────────────┐ │
│  │  REST API 层     │    │   React 管理页面（静态）  │ │
│  │  /v1/admin/*    │    │   dist/admin/*          │ │
│  └────────┬────────┘    └──────────┬──────────────┘ │
│           │                        │                  │
│           └──────────┬─────────────┘                  │
│                      ▼                                │
│            ┌─────────────────────┐                    │
│            │   Admin API Handler │                    │
│            └────────┬────────────┘                    │
│                     │                                  │
│  ┌─────────────────────────────────────────────────┐ │
│  │              内部模块（不暴露给 admin_web）        │ │
│  │  TaskScheduler / FlowExecutor / EmbyService   │ │
│  │  MediaLibraryService / TranscodeService         │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**边界规则**：
- admin_web 只能通过 `/v1/admin/*` API 与 service 通信
- admin_web 不能直接调用内部模块（TaskScheduler、FlowExecutor 等）
- service 内部模块对 admin_web 不可见，仅通过 API 间接操作

## §4 子模块结构

```
ADMIN_WEB/
├── ADMIN_WEB.md         # 本文，总览与架构定义
├── API.md               # Admin API 端点设计（SSOT）
└── PAGES.md             # 页面结构与组件层次
```

| 子文档 | 职责 | 状态 |
|---|---|---|
| `ADMIN_WEB.md` | 职责定位、架构边界、子文档索引 | 本文 |
| `API.md` | `/v1/admin/*` 端点定义（SSOT for HTTP paths/models） | 见该文档 |
| `PAGES.md` | 页面路由、组件层次、与 API 的交互方式 | 见该文档 |

## §5 页面结构

admin_web 包含四个主要功能模块：

| 路径 | 功能 | 对应 API 模块 |
|---|---|---|
| `/media-libraries` | 媒体库与子库管理 | `/v1/admin/sublibraries/*` |
| `/transcode` | 转码设置 + 设备池 | `/v1/admin/transcode/*` |
| `/tasks` | 任务监控（列表 + 详情） | `/v1/admin/tasks/*` |
| `/emby` | Emby 连接配置（已废弃） | `/v1/admin/emby/*`（兼容保留） |

详情见 `PAGES.md`。

## §6 与 desktop 端点的区别

根据 `ARCH_OVERVIEW.md` §3 的组件间协议：

| 维度 | desktop 端点 `/v1/*` | admin 端点 `/v1/admin/*` |
|---|---|---|
| 调用方 | 桌面客户端（Electron 渲染进程） | 浏览器直接访问 |
| 用途 | 桌面媒体库展示 + 任务下发 | 运维配置 + 任务监控 |
| 认证 | 可选 API Key | 可选 API Key |
| 页面 | 无（纯 API） | React 管理页面 |
| 实时性 | 轮询 400ms | 可刷新或轮询 |

**API 设计原则**：
- admin API 与 desktop API 共用同一套 service 内部模块（TaskStore、ConfigStore 等），仅路径前缀不同
- 未来如需 admin 专属数据，可扩展 `/v1/admin/*` 端点，不影响 desktop API

## §7 认证与鉴权

同 service 其他端点：可选 `X-Api-Key` header。
详见 `SERVICE/CONFIG.md` §5。

## §8 关联文档

- `SERVICE.md` — 胖服务组件总览（定义了 ADMIN_WEB 在 service 中的位置）
- `ARCH_OVERVIEW.md` — 系统结构总览（组件边界、数据流）
- `SERVICE/ADMIN_WEB/API.md` — Admin API 端点 SSOT
- `SERVICE/ADMIN_WEB/PAGES.md` — 页面结构与组件
- `SERVICE/CONFIG.md` — 配置管理（含 API Key 认证配置）
- `SERVICE/HEALTH_CHECK.md` — 健康检查（admin 页可展示服务状态）
- `SERVICE/API.md` — REST 端点 SSOT
