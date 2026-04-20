# 迭代摘要 — ShelfDeck 小助手与桌面连接端点、保存管线（2026-04-21）

## 范围

- **小助手**（`media-tray-supervisor`）：左键面板、`connection.json` 独写、黄/绿/红、本机 spawn、开机自启与退出停本机服务选项；**保存连接**统一管线（先 `GET /v1/health`，不通过则按地址尝试启动；本机 `spawn`，远端占位提示先手动启动）。
- **桌面**（`media-desktop`）：只读 `effectiveBaseUrl` / API Key（`shelfdeckConnection` + preload `sendSync`）、伴启小助手（Windows）、壳层遮罩与顶栏联通状态、`cpBase` 与任务队列/配置同步同源。
- **媒体管理服务**：`server.js` ADR_001 注释；无新 REST。

## 文档（SSOT 修订）

| 文档 | 要点 |
| --- | --- |
| `DESIGN_DESKTOP_BACKEND_ENDPOINT.md` §4 | 保存 = 可用；统一保存管线（健康 → 尝试启动 → 再健康 → 落盘）。 |
| `DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md` | 保存管线与独立启停门槛区分。 |
| `DESIGN_CONFIG_AND_PATHS.md` | 配置归属原则摘要。 |
| `DESIGN_DESKTOP_UI_COPY.md` §4.11 | 保存连接提示用语。 |
| `OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md` | 保存连接与运维一句。 |
| `TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md` | 保存管线回归说明；T7–T14 实机签发待办。 |

## 验收

- Windows 实机按 `TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md` 手工签发 T1–T14 及保存管线用例。

## 关联需求/设计

- `REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md`
- `REQ_FEATURE_windows-tray-media-service-supervisor.md`
- `DESIGN_DESKTOP_BACKEND_ENDPOINT.md` · `DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md`
