# DOC_GOVERNANCE — 文档治理与全库索引

> 状态：v2 重写中
> 版本：2.0

---

## 文档地图

### 架构层

| 文档 | 路径 | 状态 |
|---|---|---|
| 文档治理（本文） | `DOC_GOVERNANCE.md` | v2 重写中 |
| 系统结构总览 | `ARCH_OVERVIEW.md` | v2 已编写 |

### 设计层 — 总览

| 文档 | 路径 | 状态 |
|---|---|---|
| 胖服务组件总览 | `design/SERVICE.md` | v2 重写中 |
| 瘦客户端组件总览 | `design/DESKTOP.md` | v2 编写中 |
| Windows 托盘外壳 | `design/TRAY.md` | 待编写 |
| 跨组件共享约定 | `design/SHARED.md` | 待编写 |

### 设计层 — Service 子模块

| 文档 | 路径 | 状态 |
|---|---|---|
| REST API 契约 | `design/SERVICE/API.md` | v2 重写中 |
| 配置与路径映射 | `design/SERVICE/CONFIG.md` | v2 定稿 |
| 任务调度引擎 | `design/SERVICE/TASK_SCHEDULER.md` | v2 重写中 |
| Delete Flow 执行器 | `design/SERVICE/DELETE_FLOW.md` | v2 重写中 |
| Transcode Flow 执行器 | `design/SERVICE/TRANSCODE_FLOW.md` | v2 重写中 |
| Upgrade Flow 执行器 | `design/SERVICE/UPGRADE_FLOW.md` | v2 重写中 |
| 转码执行层 | `design/SERVICE/TRANSCODE.md` | v2 重写中 |
| 媒体库管理 | `design/SERVICE/MEDIA_LIBRARY.md` | v2 重写中 |
| Emby 适配器 | `design/SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER.md` | v2 重写中 |
| 豆瓣适配器 | `design/SERVICE/MEDIA_LIBRARY/DOUBAN_ADAPTER.md` | v2 重写中 |
| 健康检查 | `design/SERVICE/HEALTH_CHECK.md` | v2 重写中 |
| Web 管理端总览 | `design/SERVICE/ADMIN_WEB.md` | v2 定稿 |
| Admin API 端点 | `design/SERVICE/ADMIN_WEB/API.md` | v2 定稿 |
| Admin 页面结构 | `design/SERVICE/ADMIN_WEB/PAGES.md` | v2 定稿 |

### 设计层 — Desktop 子模块

| 文档 | 路径 | 状态 |
|---|---|---|
| UI 组件与布局 | `design/DESKTOP/UI.md` | v2 编写中 |
| REST API 客户端层 | `design/DESKTOP/API_CLIENT.md` | v2 编写中 |
| service 连接管理 | `design/DESKTOP/CONNECTION.md` | v2 编写中 |
| 配置持久化 | `design/DESKTOP/SETTINGS.md` | v2 编写中 |

### 设计层 — Tray 子模块

| 文档 | 路径 | 状态 |
|---|---|---|
| 进程生命周期 | `design/TRAY/LIFECYCLE.md` | 待编写 |
| 连接配置写入 | `design/TRAY/CONNECTION_WRITER.md` | 待编写 |
| service 健康监控 | `design/TRAY/HEALTH_MONITORING.md` | 待编写 |

### 设计层 — 共享约定

| 文档 | 路径 | 状态 |
|---|---|---|
| 意图下发 + 轮询机制 | `design/SHARED/DATA_FLOW.md` | 待编写 |
| 核心数据模型 | `design/SHARED/DATA_MODEL.md` | 待编写 |
| 错误码与降级策略 | `design/SHARED/ERROR_HANDLING.md` | 待编写 |

---

## SSOT 与冲突处理

### 规则优先级

当冲突发生时：

1. **产品范围与用户故事**：`docs/v2/design/` 文档
2. **任务调度可执行行为**：`design/SERVICE/TASK_SCHEDULER.md` + 各 Flow 文档
3. **HTTP 路径、模型、错误码**：`design/SERVICE/API.md` + `design/SERVICE/ADMIN_WEB/API.md`
4. **配置字段定义**：`design/SERVICE/CONFIG.md`

> 如果 API 文档与设计文档冲突：先更新设计文档对齐，再改代码。

### 子模块 SSOT 映射

| 领域 | SSOT 文档 |
|---|---|
| 任务调度行为 | `SERVICE/TASK_SCHEDULER.md` |
| Delete Flow 行为 | `SERVICE/DELETE_FLOW.md` |
| Transcode Flow 行为 | `SERVICE/TRANSCODE_FLOW.md` |
| Upgrade Flow 行为 | `SERVICE/UPGRADE_FLOW.md` |
| 转码执行层 | `SERVICE/TRANSCODE.md` |
| 媒体库数据模型 | `SERVICE/MEDIA_LIBRARY.md` |
| 配置字段 | `SERVICE/CONFIG.md` |
| Admin API | `SERVICE/ADMIN_WEB/API.md` |
| 跨组件数据流 | `SHARED/DATA_FLOW.md` |
| 错误处理约定 | `SHARED/ERROR_HANDLING.md` |

---

## 命名规范

- **文件名**：`DESIGN_<模块>_<子模块>.md`（如 `DESIGN_SERVICE/CONFIG.md`），实际显示时省略 `DESIGN_` 前缀
- **章节编号**：`§1`、`§2.1` 格式，使用 `§` 而非 `#`
- **子文档**：按目录结构组织（如 `SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER.md`）
- **中文内容，英文技术术语**：如 REST、API、Flow、SSOT 等保留英文

---

## 归档政策

- **已归档**：所有 v1 历史文档位于 `archive/` 目录，仅供只读参考
- **禁止引用**：`docs/v2/` 下的任何文档不得引用 `archive/` 中的文件
- **归档时机**：文档被新版本完全替代时移入 `archive/`

---

## 关联文档

- `ARCH_OVERVIEW.md` — 系统结构总览
