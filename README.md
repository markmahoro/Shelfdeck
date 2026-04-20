# ShelfDeck

本项目为 vibe coding 实战练习仓库；在正式发布前可能频繁迭代，文档与接口以实际代码为准。

Windows 桌面端 Emby 客户端：第三方播放器观影回写、媒体库治理与任务中心（删除 / 转码 / 洗版 等）。

## 文档

**唯一索引**：[docs/DOC_GOVERNANCE.md](docs/DOC_GOVERNANCE.md)（SSOT 路径、命名规则、归档政策；含 **ShelfDeck** 品牌与模块目录对照）。**最近迭代验收摘要**（媒体管理服务托盘监督，2026-04-20）：[docs/project/PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md](docs/project/PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md)。

## 代码

- **`media-desktop/`**：Electron + Vite/React **桌面客户端**
- **`media-service/`**：**媒体管理服务** HTTP 服务（Node/Fastify；历史目录名 `control-plane/`）
- **`media-tray-supervisor/`**（Windows）：系统托盘监督进程，用于启动/停止本机 `media-service`（见 [docs/operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](docs/operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)）

本地开发步骤见 [docs/dev/DEV_SETUP.md](docs/dev/DEV_SETUP.md)；API 与 IPC 对照见 [docs/api/API_README.md](docs/api/API_README.md)。
