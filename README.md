# ShelfDeck

本项目为 vibe coding 实战练习仓库；在正式发布前可能频繁迭代，文档与接口以实际代码为准。

Windows 桌面端 Emby 客户端：第三方播放器观影回写、媒体库治理与任务中心（删除 / 转码 / 洗版 等）。

## 文档

**唯一索引**：[docs/v2/DOC_GOVERNANCE.md](docs/v2/DOC_GOVERNANCE.md)（SSOT 路径、命名规则、归档政策；含 **ShelfDeck** 品牌与模块目录对照）。

**最近迭代验收摘要**（2026-04-20，UTC+8，已归档）：

- **ShelfDeck 小助手**（托盘监督）与桌面后端连接文档包：[docs/archive/project/PRJ_ITERATION_SUMMARY_desktop_backend_connection_20260420.md](docs/archive/project/PRJ_ITERATION_SUMMARY_desktop_backend_connection_20260420.md)（早期托盘迭代摘要仍见 [docs/archive/project/PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md](docs/archive/project/PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md)）
- 桌面客户端用户可见中文文案（工程验收）：[docs/archive/project/PRJ_ITERATION_SUMMARY_desktop_ui_copy_20260420.md](docs/archive/project/PRJ_ITERATION_SUMMARY_desktop_ui_copy_20260420.md)
- 配置中心保存反馈与媒体管理服务壳层门禁（整体验收）：[docs/archive/project/PRJ_ITERATION_SUMMARY_config_center_media_service_gate_20260420.md](docs/archive/project/PRJ_ITERATION_SUMMARY_config_center_media_service_gate_20260420.md)

## 代码

- `**media-desktop/`**：Electron + Vite/React **桌面客户端**
- `**media-service/`**：**媒体管理服务** HTTP 服务（Node/Fastify；历史目录名 `control-plane/`）
- `**media-tray-supervisor/`**（Windows）：ShelfDeck 小助手——与桌面客户端**同源** `effectiveBaseUrl` 健康（黄/绿/红）、左键面板展示当前地址；**已配置**后才提供统一启停入口（本机 `spawn` 与远端仅运维差异，见 [docs/archive/design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](docs/archive/design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md) / [docs/archive/operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](docs/archive/operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)）

本地开发步骤见 [docs/archive/dev/DEV_SETUP.md](docs/archive/dev/DEV_SETUP.md)；**正常使用桌面端能力须在本机运行媒体管理服务**（健康检查 `GET /v1/health`，详见 [docs/archive/requirements/REQ_FEATURE_desktop-requires-media-service.md](docs/archive/requirements/REQ_FEATURE_desktop-requires-media-service.md)）。API 与 IPC 对照见 [docs/archive/api/API_README.md](docs/archive/api/API_README.md)。

## 开源合规

**许可协议**：本项目以 [GPL-3.0](LICENSE) 发布。

**FFmpeg**：本软件捆绑 FFmpeg（`ffmpeg-static`、`@ffprobe-installer/ffprobe`），FFmpeg 以 GPL-3.0 授权。FFmpeg 源码可在 [https://ffmpeg.org/download.html](https://ffmpeg.org/download.html) 获取。

**第三方依赖**：`npm install --production` 涉及约 108 个第三方包，主要协议为 MIT、ISC、BSD 及 BlueOak-1.0.0，均与 GPL-3.0 兼容。`npx license-checker --summary --production` 可查看完整列表。

**合规风险提示**：
- **豆瓣评分同步**：通过 HTTP 抓取豆瓣用户公开"看过"页面。豆瓣网站的数据抓取未获豆瓣官方授权。用户应评估自身使用场景的法律风险。可完全禁用豆瓣评分功能（不配置豆瓣用户 ID 即可）。
- **Emby/Jellyfin 授权**：ShelfDeck 不包含 Emby/Jellyfin 软件，但需要通过 HTTP 与 Emby/Jellyfin 服务器通信。Emby 服务器需用户自备合法授权。