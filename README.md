# ShelfDeck

Windows 桌面端 Emby 客户端：第三方播放器观影回写、媒体库治理与任务中心（删除 / 转码 / 洗版 等）。

## 文档

**唯一索引**：[docs/DOC_GOVERNANCE.md](docs/DOC_GOVERNANCE.md)（SSOT 路径、命名规则、归档政策；含 **ShelfDeck** 品牌与模块目录对照）。

## 代码

- **`media-desktop/`**：Electron + Vite/React **桌面客户端**
- **`media-service/`**：**媒体管理服务** HTTP 服务（Node/Fastify；历史目录名 `control-plane/`）

本地开发步骤见 [docs/dev/DEV_SETUP.md](docs/dev/DEV_SETUP.md)；API 与 IPC 对照见 [docs/api/API_README.md](docs/api/API_README.md)。
