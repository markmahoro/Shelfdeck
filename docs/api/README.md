# 媒体控制面 REST API（契约）

本目录存放 **控制面 HTTP API** 的机器可读契约与索引。仓库内 `**control-plane/`**（Node + Fastify）实现本契约中与 beta.9 对齐的领域路径；**Electron 桌面**通过 `preload` 的 `fetch` 调用控制面，**仅保留** `emby:launchPlayer` 等强本地 IPC（见下表「启动播放器」）。

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


| 主题                           | SSOT                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| 任务状态机、Flow、验收、危险操作确认         | 根目录 `[TASK_CENTER_FULL_LOGIC.md](../../TASK_CENTER_FULL_LOGIC.md)`                                 |
| 产品模块与 beta 工程落地摘要            | 根目录 `[EmbyDesktopPlayer_PRD_v1.0.0_modules.md](../../EmbyDesktopPlayer_PRD_v1.0.0_modules.md)` §11 |
| 里程碑、用户叙事、维护制度                | 根目录 `[PROJECT_MANAGEMENT.md](../../PROJECT_MANAGEMENT.md)`                                         |
| 控制面战略、部署、MCP 工具语义与分阶段        | 根目录 `[CONTROL_PLANE_OPENCLAW_REVISIT.md](../../CONTROL_PLANE_OPENCLAW_REVISIT.md)`                 |
| **REST 路径、请求/响应形状、HTTP 错误码** | **本目录 `openapi.yaml`**                                                                             |


若本契约与任务中心 / PRD 正文冲突：**先修订 OpenAPI 与条文直至一致，再按契约实现**，并回写 TASK_CENTER / PRD 相关段落。

## 路径映射与配置（产品约定）

与 **读源、写临时目录、替换文件** 相关的路径映射及 `transcodeTempRoot` 等，**以控制面持久化配置为 SSOT**；Electron 设置页仅 **展示与编辑** 并经 API（如 `GET/PATCH /v1/config`）写回，**不在本地另存一套映射真相**。主界面须写清 **Worker 用映射**；仅当控制面与桌面环境不一致时，提供 **可选的「本机播放附加映射」** 区块。预检与转码 Worker **与上述规则同源**，避免「能播不能压」。战略条文见 `[CONTROL_PLANE_OPENCLAW_REVISIT.md](../../CONTROL_PLANE_OPENCLAW_REVISIT.md)` **§3.4**。

## MCP 与 REST（后续里程碑）

MCP 工具应 **调用与控制面 REST 相同的领域服务**，禁止维护两套业务规则；工具名与 REST 的对照表在 **MCP 搭建** 阶段补全。原则见 `[CONTROL_PLANE_OPENCLAW_REVISIT.md](../../CONTROL_PLANE_OPENCLAW_REVISIT.md)` §4.1。

## IPC（历史）→ REST（已迁移）对照

渲染进程仍经 `[mvp/electron/preload.js](../../mvp/electron/preload.js)` 暴露 `window.embyApi` / `window.doubanApi`，但 **业务调用已改为 HTTP**（默认 `CONTROL_PLANE_URL` / `VITE_CONTROL_PLANE_URL` → `http://127.0.0.1:18080`）。`[mvp/electron/main.js](../../mvp/electron/main.js)` 仅注册 `**emby:launchPlayer`** 与 `**cp-bridge-progress**`（把轮询得到的进度转发为原 `transcode:progress` / `douban:fetchProgress` 事件，减少 `App.tsx` 改动面）。

下表为 **IPC 概念 → 控制面 REST** 对照；**路径与方法以 `openapi.yaml` 为准**。


| IPC 通道                          | preload / 调用方                         | 建议 REST（控制面）                                                                    | 备注                                                                 |
| ------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `emby:testConnection`           | `embyApi.testConnection`              | `POST /v1/emby/actions/test-connection`                                         | Body：连接参数（与现 `payload` 对齐）                                         |
| `emby:getUsers`                 | `embyApi.getUsers`                    | `POST /v1/emby/actions/list-users`                                              | 同上（含服务端点与密钥）                                                       |
| `emby:getMediaFolders`          | `embyApi.getMediaFolders`             | `POST /v1/emby/actions/list-media-folders`                                      | 同上                                                                 |
| `emby:getUnplayedItems`         | `embyApi.getUnplayedItems`            | `POST /v1/library/queries/unplayed`                                             | 列表/分页与筛选                                                           |
| `emby:getLibraryItemsForManage` | `embyApi.getLibraryItemsForManage`    | `POST /v1/library/queries/manage`                                               | 媒体库治理列表                                                            |
| `emby:getPlayedItems`           | `embyApi.getPlayedItems`              | `POST /v1/library/queries/played`                                               | 播放记录                                                               |
| `emby:getLibraryItem`           | `embyApi.getLibraryItem`              | `POST /v1/library/actions/get-item`（紧凑 body） / `GET /v1/library/items/{itemId}` | 桌面 preload 走 **POST**；GET 需控制面已缓存 `embyClient`（`PATCH /v1/config`） |
| `emby:getItemDeleteInfo`        | `embyApi.getItemDeleteInfo`           | `POST /v1/library/actions/delete-info` / `GET .../delete-info`                  | 同上                                                                 |
| `emby:deleteLibraryItem`        | `embyApi.deleteLibraryItem`           | `POST /v1/library/actions/delete-item` / `DELETE /v1/library/items/{itemId}`    | 同上                                                                 |
| `emby:libraryItemExists`        | `embyApi.libraryItemExists`           | `POST /v1/library/actions/exists` / `GET .../exists`                            | 同上                                                                 |
| `emby:markPlayed`               | `embyApi.markPlayed`                  | `POST /v1/library/actions/mark-played` / `POST .../played`                      | 同上                                                                 |
| `emby:markUnplayed`             | `embyApi.markUnplayed`                | `POST /v1/library/actions/mark-unplayed` / `DELETE .../played`                  | 同上                                                                 |
| `emby:launchPlayer`             | `embyApi.launchPlayer`                | **仅 Electron** `ipcMain`；`POST /v1/client/actions/launch-player` 实现为 **501**    | 与契约一致：起进程以桌面会话为准                                                   |
| `taskControl`                   | `embyApi.taskControl`                 | `POST /v1/transcode/actions/abort-all`                                          | 现仅 `action: simulateExit` 时 `abortAllEncodes`                      |
| `douban:saveSession`            | `doubanApi.saveSession`               | `PUT /v1/integrations/douban/session`                                           | 会话持久化由控制面存储                                                        |
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
| `transcode:deletePaths`         | `embyApi.transcodeDeletePaths`        | `POST /v1/transcode/actions/delete-paths`                                       |                                                                    |


### 推送事件（IPC 桥接 → 轮询契约）


| 事件                     | 说明                                                 | 目标态                                                                              |
| ---------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `transcode:progress`   | `preload` 轮询后 `**cp-bridge-progress`** → 原 channel | **轮询** `GET /v1/transcode/jobs/{jobId}`；主进程转发为 `transcode:progress`              |
| `douban:fetchProgress` | 同上                                                 | **轮询** `GET /v1/integrations/douban/fetch/jobs/{jobId}` → `douban:fetchProgress` |


## 本地启动（桌面 + 控制面）

1. 终端 A：仓库根下 `cd control-plane && npm install && npm start`（默认 **18080**）。
2. 终端 B：`cd mvp && npm install && npm run dev`（`dev:electron` 已带 `CONTROL_PLANE_URL`；Vite 侧见 `mvp/.env.development` / `.env.production` 的 `VITE_CONTROL_PLANE_URL`）。
3. 可选：设置 `CONTROL_PLANE_API_KEY` / `VITE_CONTROL_PLANE_API_KEY` 时，两处需一致。

集成测试：`cd control-plane && npm test`（Fastify `inject`，无需监听端口）。

## 经典回顾（控制面 P0，当前无对等 IPC）

见 `openapi.yaml` 中 `Revisit` tag：`GET/POST/DELETE /v1/revisit/...`，与 `[CONTROL_PLANE_OPENCLAW_REVISIT.md](../../CONTROL_PLANE_OPENCLAW_REVISIT.md)` §3 一致。