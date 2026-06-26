# ARCH_OVERVIEW - 系统结构总览

本文是 ShelfDeck 当前唯一架构入口。更细的实现细节以代码和测试为准；当代码行为改变到影响组件边界、数据所有权、部署目标或外部集成时，必须同步更新本文。

## 1. 产品定位

ShelfDeck 是媒体库管家：基于 Emby 媒体数据、观看状态、用户评分和 Douban 评分，判断影片应该保留、删除、转码或洗版，并把动作交给 service 执行。

当前主要能力：

| 能力 | 说明 |
| --- | --- |
| 资产盘点 | 同步 Emby 电影库，保存媒体技术信息和用户关系数据 |
| 策略推荐 | 根据评分、观看状态、码率、编码、分辨率计算 action/reason |
| 空间管理 | 执行 delete/transcode/upgrade 三类任务 |
| Admin Web | 配置 service、媒体库、策略、任务和外部集成 |
| Desktop | 浏览媒体库、下发意图、展示任务状态 |

## 2. 当前模块

| 模块 | Directory | Runtime | 职责 |
| --- | --- | --- | --- |
| service Docker | `media-service/` | Container | Linux/Docker 版主服务；HTTP API、Admin Web、任务调度、外部集成 |
| service Windows | `media-service/` | Node.js + Fastify + systray2 | Windows 版主服务；同 Docker 版，但内嵌托盘并使用 bundled FFmpeg |
| desktop | `media-desktop/` | Electron + React | HTTP thin client；管理 service 地址、浏览媒体、下发意图 |
| transcode node | `media-worker/` | Node.js + Fastify + FFmpeg | 被动计算节点；接收 service 下发的转码 job、执行 FFmpeg、返回输出文件 |

## 3. 组件边界

系统逻辑上分为主控侧和计算侧：

| 组件 | 职责 | 状态所有权 |
| --- | --- | --- |
| service | HTTP API、任务队列、任务执行、媒体库缓存、配置、Admin Web、外部集成 | 任务、配置、媒体库、策略结果 |
| desktop | 用户交互、service 地址管理、任务/媒体展示、播放助手 | service 连接地址和本地 UI 状态 |
| transcode node | FFmpeg 计算、GPU 能力探测、临时 job 文件 | 仅持有临时 job 状态和临时文件 |

跨组件通信一律使用 HTTP REST。desktop 不直接访问 Emby、Douban、MoviePilot 或 service 运行时数据文件。transcode node 不直接访问 Emby、MoviePilot 或 service 数据文件。

## 4. 进程模型

Windows:

```text
media-service
  Fastify :18080
  Admin Web static files
  embedded tray module

media-desktop
  Electron main process
  React renderer
  HTTP client -> media-service
```

Docker/Linux:

```text
container: media-service
  Fastify :18080
  Admin Web static files
  no tray
```

Transcode node:

```text
media-worker
  Fastify :19000
  /api/v1/health
  /api/v1/capabilities
  /api/v1/jobs
  temporary source/output files
```

desktop 退出不影响 service。service 退出会中断任务并让 desktop 断连。

## 5. 数据流

```text
Emby/Douban/MoviePilot
        ^
        |
service API + engines  ----HTTP----> transcode node(s)
        ^
        |
desktop / Admin Web
```

核心流：

1. service 同步 Emby 媒体库到 `media-service/data/library.json`。
2. service 同步 Douban 或接收用户评分。
3. `StrategyEngine` 计算每个媒体项的 `action/reason`。
4. `SmartTaskEngine` 或用户操作创建任务。
5. `TaskScheduler` 根据 `actionType` 分派到 `DeleteFlowExecutor`、`TranscodeFlowExecutor` 或 `UpgradeFlowExecutor`。
6. 本机转码直接在 service 执行；远程转码通过 `NodeService` 上传源文件到 transcode node，轮询状态，下载输出，再由 service 完成校验和替换。
7. desktop 和 Admin Web 轮询 REST API 获取任务、媒体库和健康状态。

## 6. Service 模块

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| HTTP API | `src/app.js` | `/v1/*` 和 `/v1/admin/*` 路由 |
| Server | `src/server.js` | 启动、关闭、可选 tray |
| Config | `src/configStore.js` | `data/config.json` 读写、默认值、平台路径 |
| Task store | `src/taskStore.js` | `data/tasks.json` 读写 |
| Scheduler | `src/taskScheduler.js` | 轮询、锁、并发、flow dispatch |
| Delete flow | `src/deleteFlowExecutor.js` | 删除任务执行 |
| Transcode flow | `src/transcodeFlowExecutor.js` | 转码任务执行 |
| Upgrade flow | `src/upgradeFlowExecutor.js` | MoviePilot 洗版任务执行 |
| Library | `src/mediaLibraryService.js` | 子库和媒体缓存管理 |
| Policy | `src/mediaPolicyService.js`、`src/strategyEngine.js`、`src/smartTaskEngine.js` | 策略计算和自动入队 |
| External adapters | `src/services/*Service.js` | Emby、Douban、MoviePilot、FFmpeg |
| Tray | `src/tray.js` | Windows 系统托盘 |
| Node registry | `src/nodeStore.js` | `data/nodes.json` 转码节点登记、健康状态、设备池 |
| Node client | `src/nodeService.js` | 调用 transcode node 的 job/capabilities/health API |

## 7. Transcode Node 模块

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| Worker API | `media-worker/src/server.js` | `/api/v1/jobs`、上传源文件、查询状态、下载输出、清理 job |
| Worker config | `media-worker/src/config.js` | 默认端口、API key、临时目录、FFmpeg 路径 |
| Worker admin | `media-worker/src/admin.html` | 简单配置页面 |

转码 node 是被动计算节点：

- 不知道 Emby、MoviePilot、媒体库路径映射或 service 地址。
- 只保存内存 job 状态和临时源/输出文件。
- 由 service 负责任务持久化、调度、校验和替换。
- 默认端口是 `19000`。

## 8. Runtime Data

Runtime JSON 不入库：

| 文件 | 所有者 | 说明 |
| --- | --- | --- |
| `media-service/data/config.json` | service | 配置 |
| `media-service/data/tasks.json` | service | 任务队列 |
| `media-service/data/library.json` | service | 媒体库缓存 |
| `media-service/data/nodes.json` | service | 转码节点登记 |
| `media-worker/config.json` | transcode node | worker 本机配置 |

不要把生产/测试环境导出的 `tasks_*.json`、`config_*.json`、截图、构建产物或日志提交到仓库。

## 9. API 契约

- Desktop domain: `/v1/*`
- Admin domain: `/v1/admin/*`
- Health: `GET /v1/health` public
- Protected APIs: `X-Api-Key`
- Error shape: `{ error: { code, message } }`
- GET 无副作用，PATCH 幂等部分更新

API 细节以 `src/app.js` 和现有 tests 为准。新增或变更 API 时必须补充对应 service inject test、desktop integration test 或 E2E flow。

Worker API:

- `GET /api/v1/health`
- `GET /api/v1/capabilities`
- `POST /api/v1/jobs`
- `PUT /api/v1/jobs/:id/source`
- `GET /api/v1/jobs/:id`
- `GET /api/v1/jobs/:id/output`
- `DELETE /api/v1/jobs/:id`

## 10. 平台约束

- Docker/Linux 专用行为使用 `process.platform === 'linux'`。
- Windows-only tray 代码必须可选加载，Docker 中缺失 optional dependency 是正常情况。
- 路径使用 `path.join()` 和可配置根目录。
- FFmpeg/FFprobe 优先读取 `FFMPEG_PATH`、`FFPROBE_PATH`，Dockerfile 提供默认值。

## 11. 关联文档

- `docs/v2/DEVELOPMENT_WORKFLOW.md`
- `docs/v2/TEST_ARCHITECTURE.md`
- `docs/v2/DEBUG_WORKFLOW.md`
- `tests/TEST_ENV_CHECKLIST.md`（私有凭据，不提交）
