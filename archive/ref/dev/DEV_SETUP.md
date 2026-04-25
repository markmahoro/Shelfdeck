# DEV_SETUP — 本地开发环境

> **SSOT 路径**：`[DEV_SETUP.md](./DEV_SETUP.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

## 依赖

- Node.js / npm（版本以各子项目 `package.json` 为准）
- Windows 目标环境

命名与目录对照（品牌 **ShelfDeck**、`media-desktop` / `media-service`）见 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)` **ShelfDeck 产品与模块命名**。

## 媒体管理服务

```bash
cd media-service
npm install
npm start
```

默认监听 **18080**（见 `media-service` 源码与 `[API_README.md](../api/API_README.md)`）。

## ShelfDeck 小助手（`media-tray-supervisor`，Windows）

**ShelfDeck 小助手**：托盘 + 左键面板；**独占写入** 连接文件；Desktop **只读** **同源** `effectiveBaseUrl`（见 `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](../design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md)`）；对健康探测 **同一 URL**（黄/绿/红）；可在 **已配置** 后对当前后端做启停（本机多为 `spawn`，远端行为见 DESIGN §3.3）。联调见 `[OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`；行为见 `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`。

```bash
cd media-tray-supervisor
npm install
npm start
```

可选：设置 `TRAY_MEDIA_SERVICE_ROOT` 为 `media-service` 目录绝对路径（未设置时默认使用与 `media-tray-supervisor` 同级的 `../media-service`）。

**验收**：2026-04-20（UTC+8）**本机 spawn + 托盘**能力 **整体验收通过**（`TEST_TRAY` **T1–T6**）；摘要见 `[PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md](../project/PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md)`。**小助手与桌面同源连接、黄/绿/红、左键全地址面板**等文档模型见 `[PRJ_ITERATION_SUMMARY_desktop_backend_connection_20260420.md](../project/PRJ_ITERATION_SUMMARY_desktop_backend_connection_20260420.md)`；**T7+** 待实现与代码对齐后签发。

## 桌面（Electron + Vite）

本地联调时**须先**在小助手或环境变量中 **指向可连的媒体管理服务**（默认 `http://127.0.0.1:18080`），并 **启动** 服务或使用 **小助手 spawn**；否则桌面壳层将处于**服务不可用**态（与 `[REQ_FEATURE_desktop-requires-media-service.md](../requirements/REQ_FEATURE_desktop-requires-media-service.md)` 一致）。桌面 **无** 应用内「保存媒体管理服务地址」入口。**有效基址**解析见 `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](../design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md)`。浏览器直连 Vite 时亦需能对同一逻辑基址发起健康检查（见下述环境变量与 `VITE_`*）。

```bash
cd media-desktop
npm install
npm run dev
```

开发脚本可设置 `MEDIA_SERVICE_URL` / `CONTROL_PLANE_URL` 与 `VITE_MEDIA_SERVICE_URL` / `VITE_CONTROL_PLANE_URL` 指向媒体管理服务（通常为 `http://127.0.0.1:18080`）；**同名变量两两同义**。优先级以 `DESIGN_DESKTOP_BACKEND_ENDPOINT` 为准（通常 **环境变量覆盖小助手写入的持久化**）。可选 API Key：`MEDIA_SERVICE_API_KEY` / `CONTROL_PLANE_API_KEY` 与 `VITE_`* 对应项（与服务端一致）。排错亦可 **手动编辑** 小助手所用 `connection.json`（仅开发）。

**模拟远端**：将上述 URL 设为 NAS / 其它主机可访问地址，并保证本机网络可达；**在小助手** 保存后，**小助手与桌面** 均应对 **该 URL** 做 health（**同源只读** 一致）。

## OpenAPI lint

在仓库根目录：

```bash
npx --yes @redocly/cli lint docs/api/openapi.yaml --config docs/api/redocly.yaml
```

## 媒体管理服务测试

```bash
cd media-service
npm test
```

## 追溯与关联文档


| 文档                                                                                                                  | 关系            |
| ------------------------------------------------------------------------------------------------------------------- | ------------- |
| `[API_README.md](../api/API_README.md)`                                                                             | IPC→REST、联调约定 |
| `[ARCH_SYSTEM_OVERVIEW.md](../architecture/ARCH_SYSTEM_OVERVIEW.md)`                                                | 媒体管理服务与客户端分工  |
| `[OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                        | 托盘监督安装与联调     |
| `[PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md](../project/PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md)` | 托盘监督迭代验收摘要    |
| `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](../design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md)`                                | 桌面连接端点与优先级    |
| `[REQ_PRODUCT_BASELINE_v1.0.0.md](../requirements/REQ_PRODUCT_BASELINE_v1.0.0.md)`                                  | 需求母版          |


