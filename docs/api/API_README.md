# API_README — 媒体管理服务 REST API（契约）

> **SSOT 路径**：[`API_README.md`](./API_README.md) · 文档索引 [`DOC_GOVERNANCE.md`](../DOC_GOVERNANCE.md)

本目录存放 **媒体管理服务 HTTP API** 的机器可读契约与索引。仓库内 `media-service/`（Node + Fastify；历史目录名 `control-plane/`）实现本契约中与 beta.9 对齐的领域路径；**ShelfDeck 桌面客户端**通过 `preload` 的 `fetch` 调用媒体管理服务，**仅保留** `emby:launchPlayer` 等强本地 IPC（见下表「启动播放器」）。

## 最近更新

- **2026-04-20**：产品迭代「转码备份与临时文件清理」合入（需求：`docs/requirements/REQ_FEATURE_transcode-backup-and-temp-cleanup.md`）；对齐 `POST /v1/transcode/actions/stat-paths` 等与任务中心「替换前备份」「临时目录残留」相关能力；桌面 `preload` 约束见 `docs/dev/DEV_ELECTRON_PRELOAD.md`（**未**升 `media-desktop/package.json`）。

## 契约文件


| 文件                             | 说明                                 |
| ------------------------------ | ---------------------------------- |
| [openapi.yaml](./openapi.yaml) | OpenAPI 3.0.3；路径、方法、标签、全局安全方案与错误模型 |


## 校验（lint）

在仓库根目录执行（需 Node/npm；无需写入 `package.json` 亦可一次性拉取 CLI）：

```bash
npx --yes @redocly/cli lint docs/api/openapi.yaml --config docs/api/redocly.yaml
```

配置见 [redocly.yaml](./redocly.yaml)（草案阶段关闭 `operationId`/localhost 等噪音规则；收紧规则时可改回继承 `recommended` 并逐项修复）。

## 文档 SSOT 分工（避免冲突）


| 主题                           | SSOT                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| 任务状态机、Flow、验收、危险操作确认         | [`docs/design/DESIGN_TASK_CENTER.md`](../design/DESIGN_TASK_CENTER.md)                                   |
| 需求母版（范围、验收、工程实现快照 beta）     | [`docs/requirements/REQ_PRODUCT_BASELINE_v1.0.0.md`](../requirements/REQ_PRODUCT_BASELINE_v1.0.0.md)   |
| 配置字段与路径映射（字段级）           | [`docs/design/DESIGN_CONFIG_AND_PATHS.md`](../design/DESIGN_CONFIG_AND_PATHS.md)                         |
| 媒体库、星级、豆瓣、治理动作摘要         | [`docs/design/DESIGN_LIBRARY_AND_QUEUE.md`](../design/DESIGN_LIBRARY_AND_QUEUE.md)                       |
| 五页架构、前台播放闭环              | [`docs/design/DESIGN_FRONT_PLAYBACK.md`](../design/DESIGN_FRONT_PLAYBACK.md)                             |
| 外部集成（MoviePilot 等）         | [`docs/architecture/ARCH_INTEGRATIONS.md`](../architecture/ARCH_INTEGRATIONS.md)                        |
| 里程碑、用户叙事、维护制度                | [`docs/project/PRJ_MANAGEMENT.md`](../project/PRJ_MANAGEMENT.md)                                         |
| 媒体管理服务战略、部署、MCP 工具语义与分阶段        | [`docs/architecture/ARCH_SYSTEM_OVERVIEW.md`](../architecture/ARCH_SYSTEM_OVERVIEW.md)                   |
| **REST 路径、请求/响应形状、HTTP 错误码** | **本目录 `openapi.yaml`**                                                                                   |
| 全库索引与命名规则                    | [`docs/DOC_GOVERNANCE.md`](../DOC_GOVERNANCE.md)                                                         |


若本契约与任务中心 / 需求基线 / 域设计正文冲突：**先修订 OpenAPI 与条文直至一致，再按契约实现**，并回写 DESIGN / REQ 相关段落。

## 路径映射与配置（产品约定）

与 **读源、写临时目录、替换文件** 相关的路径映射及 `transcodeTempRoot` 等，**以媒体管理服务持久化配置为 SSOT**；Electron 设置页仅 **展示与编辑** 并经 API（如 `GET/PATCH /v1/config`）写回，**不在本地另存一套映射真相**。主界面须写清 **Worker 用映射**；仅当媒体管理服务与桌面环境不一致时，提供 **可选的「本机播放附加映射」** 区块。预检与转码 Worker **与上述规则同源**，避免「能播不能压」。战略条文见 `[docs/architecture/ARCH_SYSTEM_OVERVIEW.md](../architecture/ARCH_SYSTEM_OVERVIEW.md)` **§3.4**。

## MCP 与 REST（后续里程碑）

MCP 工具应 **调用与媒体管理服务 REST 相同的领域服务**，禁止维护两套业务规则；工具名与 REST 的对照表在 **MCP 搭建** 阶段补全。原则见 `[docs/architecture/ARCH_SYSTEM_OVERVIEW.md](../architecture/ARCH_SYSTEM_OVERVIEW.md)` §4.1。

## IPC（历史）→ REST（已迁移）对照

渲染进程仍经 `[media-desktop/electron/preload.js](../../media-desktop/electron/preload.js)` 暴露 `window.embyApi` / `window.doubanApi`，但 **业务调用已改为 HTTP**（默认 `MEDIA_SERVICE_URL` / `CONTROL_PLANE_URL` 与 `VITE_MEDIA_SERVICE_URL` / `VITE_CONTROL_PLANE_URL` → `http://127.0.0.1:18080`，**同义变量以 `MEDIA_SERVICE_*` 优先**）。`[media-desktop/electron/main.js](../../media-desktop/electron/main.js)` 仅注册 `emby:launchPlayer` 与 `cp-bridge-progress`（把轮询得到的进度转发为原 `transcode:progress` / `douban:fetchProgress` 事件，减少 `App.tsx` 改动面）。

下表为 **IPC 概念 → 媒体管理服务 REST** 对照；**路径与方法以 `openapi.yaml` 为准**。


| IPC 通道                          | preload / 调用方                         | 建议 REST（媒体管理服务）                                                                    | 备注                                                                 |
| ------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `emby:testConnection`           | `embyApi.testConnection`              | `POST /v1/emby/actions/test-connection`                                         | Body：连接参数（与现 `payload` 对齐）                                         |
| `emby:getUsers`                 | `embyApi.getUsers`                    | `POST /v1/emby/actions/list-users`                                              | 同上（含服务端点与密钥）                                                       |
| `emby:getMediaFolders`          | `embyApi.getMediaFolders`             | `POST /v1/emby/actions/list-media-folders`                                      | 同上                                                                 |
| `emby:getUnplayedItems`         | `embyApi.getUnplayedItems`            | `POST /v1/library/queries/unplayed`                                             | 列表/分页与筛选                                                           |
| `emby:getLibraryItemsForManage` | `embyApi.getLibraryItemsForManage`    | `POST /v1/library/queries/manage`                                               | 媒体库治理列表                                                            |
| `emby:getPlayedItems`           | `embyApi.getPlayedItems`              | `POST /v1/library/queries/played`                                               | 播放记录                                                               |
| `emby:getLibraryItem`           | `embyApi.getLibraryItem`              | `POST /v1/library/actions/get-item`（紧凑 body） / `GET /v1/library/items/{itemId}` | 桌面 preload 走 **POST**；GET 需媒体管理服务已缓存 `embyClient`（`PATCH /v1/config`） |
| `emby:getItemDeleteInfo`        | `embyApi.getItemDeleteInfo`           | `POST /v1/library/actions/delete-info` / `GET .../delete-info`                  | 同上                                                                 |
| `emby:deleteLibraryItem`        | `embyApi.deleteLibraryItem`           | `POST /v1/library/actions/delete-item` / `DELETE /v1/library/items/{itemId}`    | 同上                                                                 |
| `emby:libraryItemExists`        | `embyApi.libraryItemExists`           | `POST /v1/library/actions/exists` / `GET .../exists`                            | 同上                                                                 |
| `emby:markPlayed`               | `embyApi.markPlayed`                  | `POST /v1/library/actions/mark-played` / `POST .../played`                      | 同上                                                                 |
| `emby:markUnplayed`             | `embyApi.markUnplayed`                | `POST /v1/library/actions/mark-unplayed` / `DELETE .../played`                  | 同上                                                                 |
| `emby:launchPlayer`             | `embyApi.launchPlayer`                | **仅 Electron** `ipcMain`；`POST /v1/client/actions/launch-player` 实现为 **501**    | 与契约一致：起进程以桌面会话为准                                                   |
| `taskControl`                   | `embyApi.taskControl`                 | `POST /v1/transcode/actions/abort-all`                                          | 现仅 `action: simulateExit` 时 `abortAllEncodes`                      |
| `douban:saveSession`            | `doubanApi.saveSession`               | `PUT /v1/integrations/douban/session`                                           | 会话持久化由媒体管理服务存储                                                        |
| `douban:getSession`             | `doubanApi.getSession`                | `GET /v1/integrations/douban/session`                                           |                                                                    |
| `douban:stopFetch`              | `doubanApi.stopFetch`                 | `POST /v1/integrations/douban/fetch/stop`                                       |                                                                    |
| `douban:fetchRatings`           | `doubanApi.fetchRatings`              | `POST /v1/integrations/douban/fetch/ratings`                                    | 进度事件见下「事件」                                                         |
| `transcode:validateTools`       | `embyApi.transcodeValidateTools`      | `POST /v1/transcode/actions/validate-tools`                                     |                                                                    |
| `transcode:probeEncodeDevices`  | `embyApi.transcodeProbeEncodeDevices` | `POST /v1/transcode/actions/probe-encode-devices`                               |                                                                    |
| `transcode:precheck`            | `embyApi.transcodePrecheck`           | `POST /v1/transcode/actions/precheck`                                           |                                                                    |
| `transcode:startEncode`         | `embyApi.transcodeStartEncode`        | `POST /v1/transcode/jobs`                                                       | 返回 `202` + `jobId`；进度见 `GET /v1/transcode/jobs/{jobId}` 轮询         |
| `transcode:abort`               | `embyApi.transcodeAbort`              | `POST /v1/transcode/jobs/{jobId}/actions/abort`                                 |                                                                    |
| `transcode:probe`               | `embyApi.transcodeProbe`              | `POST /v1/transcode/actions/probe`                                              | ffprobe 摘要                                                         |
| `transcode:replace`             | `embyApi.transcodeReplace`            | `POST /v1/transcode/actions/replace`                                            | 产出替换                                                               |
| `transcode:cleanupTaskWorkdir`  | `embyApi.transcodeCleanupTaskWorkdir` | `POST /v1/transcode/actions/cleanup-workdir`                                    |                                                                    |
| `transcode:scanOrphans`         | `embyApi.transcodeScanOrphans`        | `POST /v1/transcode/actions/scan-orphans`                                       |                                                                    |
| `transcode:statPaths`           | `embyApi.transcodeStatPaths`          | `POST /v1/transcode/actions/stat-paths`                                         | 存在性 + 文件大小（用于替换前备份列表）                                              |
| `transcode:deletePaths`         | `embyApi.transcodeDeletePaths`        | `POST /v1/transcode/actions/delete-paths`                                       |                                                                    |


### 推送事件（IPC 桥接 → 轮询契约）


| 事件                     | 说明                                             | 目标态                                                                              |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `transcode:progress`   | `preload` 轮询后 `cp-bridge-progress` → 原 channel | **轮询** `GET /v1/transcode/jobs/{jobId}`；主进程转发为 `transcode:progress`              |
| `douban:fetchProgress` | 同上                                             | **轮询** `GET /v1/integrations/douban/fetch/jobs/{jobId}` → `douban:fetchProgress` |


## 本地启动（桌面 + 媒体管理服务）

1. 终端 A：仓库根下 `cd media-service && npm install && npm start`（默认 **18080**）。
2. 终端 B：`cd media-desktop && npm install && npm run dev`（`dev:electron` 已带 `CONTROL_PLANE_URL`；Vite 侧见 `media-desktop/.env.development` / `.env.production` 的 `VITE_*` URL，与 `MEDIA_SERVICE_*` 同义）。
3. 可选：设置 `CONTROL_PLANE_API_KEY` / `VITE_CONTROL_PLANE_API_KEY`（或 `MEDIA_SERVICE_*` 对应项）时，各处需一致。

集成测试：`cd media-service && npm test`（Fastify `inject`，无需监听端口）。

## 经典回顾（媒体管理服务 P0，当前无对等 IPC）

见 `openapi.yaml` 中 `Revisit` tag：`GET/POST/DELETE /v1/revisit/...`，与 [`ARCH_SYSTEM_OVERVIEW.md`](../architecture/ARCH_SYSTEM_OVERVIEW.md) **§3** 一致。

## 追溯与关联文档

| 文档 | 关系 |
|------|------|
| [`openapi.yaml`](./openapi.yaml) | REST 形状 SSOT |
| [`DESIGN_TASK_CENTER.md`](../design/DESIGN_TASK_CENTER.md) | 任务领域 |
| [`ARCH_SYSTEM_OVERVIEW.md`](../architecture/ARCH_SYSTEM_OVERVIEW.md) | 架构与路径原则 |
| [`DEV_SETUP.md`](../dev/DEV_SETUP.md) | 本地启动 |
