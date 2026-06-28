# ARCH_OVERVIEW - 系统结构总览

本文是 ShelfDeck 当前唯一架构入口。更细的实现细节以代码和测试为准；当代码行为改变到影响组件边界、数据所有权、部署目标或外部集成时，必须同步更新本文。

## 1. 产品定位

ShelfDeck 是媒体库管家：基于 Emby 媒体数据、观看状态、用户评分和 Douban 评分，判断影片应该保留、删除、转码或洗版，并把动作交给 service 执行。

当前主要能力：

| 能力 | 说明 |
| --- | --- |
| 资产盘点 | 同步 Emby 电影库，保存媒体技术信息和用户关系数据 |
| 策略推荐 | 根据评分、观看状态、码率、编码、分辨率计算 action/reason |
| 空间管理 | 执行 delete/transcode/upgrade/scrape 等统一任务 |
| 成人库管理 | 管理成人文件夹库的单 item 入库、刮削、整理和演员库；不再通过私有目录监听/扫描自动发现并批量入队 |
| Admin Web | 配置 service、媒体库、策略、任务和外部集成 |
| Desktop | 浏览媒体库、下发意图、展示任务状态 |

## 2. 当前模块

| 模块 | Directory | Runtime | 职责 |
| --- | --- | --- | --- |
| service Docker | `media-service/` | Container | Linux/Docker 版主服务；HTTP API、Admin Web、任务调度、外部集成、内置 face-service |
| service Windows | `media-service/` | Node.js + Fastify + systray2 | Windows 版主服务；同 Docker 版，但内嵌托盘并使用 bundled FFmpeg |
| desktop | `media-desktop/` | Electron + React | HTTP thin client；管理 service 地址、浏览媒体、下发意图 |
| worker node | `media-worker/` | Node.js + Fastify + FFmpeg + optional AI runtime | 被动算力补充节点；接收 service 下发的转码 job，欧美成人 AI job 仅作为兼容扩展路径 |

## 3. 组件边界

系统逻辑上分为主控侧和计算侧：

| 组件 | 职责 | 状态所有权 |
| --- | --- | --- |
| service | HTTP API、任务队列、任务执行、媒体库缓存、配置、Admin Web、外部集成、欧美成人本地抽帧/人脸匹配/封面生成 | 任务、配置、媒体库、策略结果、People 人物库 |
| desktop | 用户交互、service 地址管理、任务/媒体展示、播放助手 | service 连接地址和本地 UI 状态 |
| worker node | FFmpeg 计算、GPU 能力探测、临时 job 文件、AI source asset、帧缓存和模型推理 | 仅持有计算侧临时状态、上传源文件缓存和模型缓存 |

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
  internal only:
    InsightFace face-service :19110
  no tray
```

Worker node:

```text
container: shelfdeck-media-worker
  Fastify :19000
  /api/v1/health
  /api/v1/capabilities
  /api/v1/jobs
  /api/v1/assets
  /api/v1/ai/jobs
  temporary source/output files
  AI source assets / frame cache

  optional internal only:
    Ollama :11434
    InsightFace face-service :19110
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

1. service 同步 Emby 媒体库到 `media-service/data/library.db`。
2. service 同步 Douban 或接收用户评分。
3. `StrategyEngine` 计算每个媒体项的 `action/reason`。
4. `SmartTaskEngine` 或用户操作创建任务。
5. `TaskAdmission` 先判断任务是否允许入队，`PriorityEngine` 计算队列优先级。
6. `TaskScheduler` 根据 `actionType` 分派到 `IngestFlowExecutor`、`DeleteFlowExecutor`、`TranscodeFlowExecutor`、`UpgradeFlowExecutor` 或 `ScrapeFlowExecutor`。
7. 本机转码直接在 service 执行；远程转码通过 `NodeService` 上传源文件到 transcode node，轮询状态，下载输出，再由 service 完成校验和替换。
8. desktop 和 Admin Web 轮询 REST API 获取任务、媒体库和健康状态。

任务模型：

- 任务分为系统级定时任务、子库级定时任务、单 item 任务三类。`StrategyEngine` 是子库/全局长周期策略计算，不是 item task；`delete/transcode/upgrade/scrape/ingest` 属于单 item task。
- 子库只有两种调度模式：`automationMode=auto` 和 `automationMode=manual`。调度模式只决定任务创建后是否自动执行：`auto` 进入执行队列，`manual` 创建为待手动启动；后台是否自动创建任务由 `smartTaskEnabledActions` 和 `TaskAdmission` 统一控制。
- `TaskAdmission` 是任务创建闸门，统一处理自动/手动来源、active task 去重、失败冷却、按任务类型的自动队列上限、已转码不重复自动转码等规则。48 小时冻结属于 admission，不属于 priority。
- `PriorityEngine` 只决定可入队任务的执行顺序。优先级由任务来源基准、`actionTypeWeights`、子库 `priorityWeight`、规则叠加和用户手动调整共同决定，数值越小越优先。
- 审批策略与调度策略分离。`approvalPolicy` 控制任务内部关键节点是否暂停，模式为 `auto`、`confirm`、`forceConfirm`；`forceConfirm` 不能被全局、子库或任务级覆盖降级。
- 当前审批 gate 包括 `delete.beforeExecute`、`transcode.dolbyVisionTonemap`、`transcode.beforeReplace`、`upgrade.candidateSelect`、`upgrade.identityMismatch`、`upgrade.beforeReplace`、`scrape.beforeWriteMetadata`、`scrape.beforeOrganize`、`scrape.reviewResult`。
- `ingest` 是单 item 入库任务类型，用于把文件候选转换为媒体项和技术探测结果；成人库目录扫描/监听不再作为任务创建入口，也不把大量新文件展开成完整刮削或转码动作。
- 任务持久化使用 `data/tasks.db` SQLite。任务中心保留完成、失败等历史记录；调度器、节点统计、转码临时目录清理等热路径只读取非终态 active task，不能为了降低队列压力删除历史任务。
- 启动期全局维护不属于单 item task。普通媒体库启动刷新由 `mediaLibraryStartupRefreshOnStartup` 和 `mediaLibraryStartupRefreshDelaySeconds` 控制；自算字段立即运行由 `mediaLibrarySelfComputeOnStartup` 控制；`SmartTaskEngine` 首次自动入队扫描由 `smartTaskInitialDelaySeconds` 控制。生产部署可通过这些开关先恢复 API 响应，再让周期任务按节奏运行。
- 成人库 `ingest` 的媒体探测使用 `adultLibrary.probeTimeoutMs` 控制单文件 `ffprobe` 超时。坏文件或异常路径只记录 `probeError` 并继续入库，不应拖住整个 HTTP 服务。

成人文件夹库流：

1. 用户创建 `mediaType=adult`、`source=folder` 的子库，并配置 `watchRoot`。
2. 目录级 scan 只做只读核对和刷新时间，不创建 `ingest` 或 `scrape` 任务；`POST /v1/admin/sublibraries/:uuid/actions/scan` 已废弃并返回 `410 ADULT_FOLDER_SCAN_REMOVED`。
3. `IngestFlowExecutor` 每次只处理一个文件候选，完成文件探测、NFO 预解析和媒体项写入。已前置刮削的文件会直接成为 `scraped=true` item；未刮削文件在入库后再按统一 admission/priority 创建 `scrape` 任务。
4. 日本 JAV 子库使用 `scraperType=shelfdeck_japanese_jav`；欧美成人库使用 `scraperType=western_builtin`。两者的单 item 入库和后续刮削都复用统一任务模型。
5. `ScrapeFlowExecutor` 每次只处理一个 item。JAV 通过内置 Node.js scraper 拉取元数据；欧美成人默认在 service 内本地执行 FFmpeg 抽帧、调用容器内 face-service 生成 embedding、匹配 People 人物库并生成 deterministic composite poster。`computeMode=worker` 仅作为兼容扩展路径。
   service-local 欧美成人 AI 跑在主 service 进程内，为保护 Admin Web/API 响应性，调度器必须单独限制该路径同一时间只执行 1 个本地分析任务；JAV scrape 和 `computeMode=worker` 不受此本地 AI 槽限制。
6. 刮削/整理成功后由 ShelfDeck 移动影片到库目录下的统一归拢目录（默认 `scraped/`），写入 `movie.nfo`、同名 NFO、封面、`.shelfdeck.json`，并通过 `ScrapeVerification` 合同校验后才更新 `adultMetadata`、`scraped=true` 和媒体技术信息；欧美成人未识别 protagonist 时任务失败，只保留 unknown face 诊断数据，不写成功态 NFO/封面。
7. `StrategyEngine` 使用成人库策略模板计算 `transcode/keep`；`scrape` flow 不直接链式创建转码任务，后续是否转码由 `SmartTaskEngine` 根据 `scraped=true` 等策略条件决定。
8. 后续转码继续复用现有 `TranscodeFlowExecutor`。

欧美成人库补充规则：

- 裸视频以 path identity 入库，不做番号识别；欧美成人番号由识别出的 protagonist 和 People canonical code 自生成。
- People 人物库归 service 持久化；用户搜索/上传高清正脸图建立 reference face，后续匹配以该 reference embedding 为真值。演员图片搜索源包括 Stash-box GraphQL（默认 TPDB endpoint，可配置 FansDB/其他 stash-box）、MetadataAPI、TMDB、Wikimedia，出站请求默认复用日本 JAV scraper 的代理配置，并在无候选/源失败时向 UI 返回诊断信息；同时保留手动图片 URL/本地上传兜底以覆盖素人演员。
- service Docker all-in-one 内部启动 InsightFace face-service，默认地址为 `http://127.0.0.1:19110/v1/face/embeddings`；该地址不是用户配置项，仅可通过环境变量覆盖。
- 初次未知人脸由 service-local 分析返回 `unknownFaces`，包含头像样本和 embedding 诊断；用户命名后，service 通过 `/v1/admin/adult/people/from-face` 将该 cluster 写入 People reference faces。
- 欧美成人匹配不到 protagonist 时等同于 JAV 识别不到番号：任务 `failed_hard`，item 保持 `scraped=false`，不会进入自动转码策略。
- 自动通过的 item 标记 `scraped=true`，后续转码继续复用现有 `TranscodeFlowExecutor`。
- 刮削成功会在库目录下的统一归拢目录（默认 `scraped/`，可通过 `adultLibrary.organizedFolderName` 或分区配置覆盖）中新建标准影片目录并移动当前视频：欧美成人目录/视频名为 `{adultId} {protagonist}`；JAV 目录/视频名沿用 scraper 返回的标题命名规范。已有目录不直接改名，目录内其他视频不被一起移动。ShelfDeck 的目录核对默认忽略该归拢目录，Emby 可只监控这个归拢目录。
- `scraped=true` 不能由目录位置推断。ShelfDeck scrape 成功必须满足结构化合同：任务完成、媒体文件存在、`adultMetadata.scrapeStatus=done`、关键元数据存在、按配置写出的 NFO/封面存在、`.shelfdeck.json` 可读且 `itemId/subLibraryId/mediaPath/scrapeTaskId/scrapedAt` 与当前 item 匹配。任务报告会返回 `scrapeVerification` 结果。

混合成人库处理：

- 已经由 JavSP 或其他工具前置刮削的目录，只要媒体旁边存在 `movie.nfo` 或同名 `.nfo`，`ingest` 时会解析 NFO，标记为 `scraped=true`，不会再自动创建刮削任务。
- 未刮削的裸视频会在 `ingest` 时从文件名/路径识别番号或生成欧美成人占位番号，标记为 `scraped=false`、`adultMetadata.scrapeStatus=pending`，并按子库自动化配置创建 `scrape` 任务。
- Admin Web 的媒体库管理页在成人库条目的名称下展示“已刮削 / 待刮削 / 刮削失败”状态、番号和 studio，并提供刮削状态筛选；整目录手动扫描入口已移除。

## 6. Service 模块

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| HTTP API | `src/app.js` | `/v1/*` 和 `/v1/admin/*` 路由 |
| Server | `src/server.js` | 启动、关闭、可选 tray |
| Config | `src/configStore.js` | `data/config.json` 读写、默认值、平台路径 |
| Library store | `src/libraryStore.js` | `data/library.db` SQLite 读写；启动时从旧 `library.json` 一次性迁移 |
| Task store | `src/taskStore.js` | `data/tasks.db` SQLite 读写；启动时从旧 `tasks.json` 一次性迁移 |
| Scheduler | `src/taskScheduler.js` | 轮询、锁、并发、flow dispatch |
| Task admission | `src/taskAdmission.js` | 自动/手动入队闸门、去重、冷却、业务幂等 |
| Approval policy | `src/approvalPolicy.js` | 任务内部关键节点审批策略 |
| Priority engine | `src/priorityEngine.js` | 任务优先级计算 |
| Delete flow | `src/deleteFlowExecutor.js` | 删除任务执行 |
| Transcode flow | `src/transcodeFlowExecutor.js` | 转码任务执行 |
| Upgrade flow | `src/upgradeFlowExecutor.js` | MoviePilot 洗版任务执行 |
| Ingest flow | `src/ingestFlowExecutor.js` | 文件候选入库任务执行；单文件探测、NFO 预解析、媒体项写入 |
| Scrape flow | `src/scrapeFlowExecutor.js` | 成人库刮削/整理任务执行；JAV 调用内置 scraper，欧美成人默认 service-local AI |
| Library | `src/mediaLibraryService.js` | 子库和媒体缓存管理 |
| Adult folder library | `src/adultLibraryService.js` | 成人文件夹库单 item 入库、刮削、整理、演员库和只读目录核对 |
| Policy | `src/mediaPolicyService.js`、`src/strategyEngine.js`、`src/smartTaskEngine.js` | 策略计算和自动入队 |
| External adapters | `src/services/*Service.js` | Emby、Douban、MoviePilot、FFmpeg、成人库 scraper、欧美成人 service-local/worker AI |
| Tray | `src/tray.js` | Windows 系统托盘 |
| People store | `src/peopleStore.js` | `data/people.json` 欧美成人人物库 |
| Node registry | `src/nodeStore.js` | `data/nodes.json` worker 节点登记、健康状态、设备池 |
| Node client | `src/nodeService.js` | 调用 worker 的 transcode job、AI asset/job、capabilities/health API |

## 7. Worker Node 模块

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| Worker API | `media-worker/src/server.js` | `/api/v1/jobs`、上传源文件、查询状态、下载输出、清理 job、AI asset/job API |
| AI service | `media-worker/src/aiService.js` | source asset 缓存、抽帧、People 快照匹配、face embedding 调用、VLM 调用 |
| Worker config | `media-worker/src/config.js` | 默认端口、API key、临时目录、AI data root、FFmpeg 路径、VLM endpoint、face embedding endpoint |
| All-in-one image | `media-worker/Dockerfile.all-in-one` | 单容器 GPU 算力节点，内部启动 Node worker、Ollama 和 InsightFace |
| Face service | `media-worker/face-service/` | InsightFace HTTP embedding 服务，仅在 all-in-one 容器内部暴露 |
| Worker admin | `media-worker/src/admin.html` | 简单配置页面 |

worker node 是被动计算节点，欧美成人管理不依赖 worker：

- 不知道 Emby、MoviePilot、媒体库路径映射或 service 地址。
- 转码 job 保存内存状态和临时源/输出文件。
- AI job 通过 `/api/v1/assets` 接收 service 上传的源视频，worker 本地保存 source asset 和抽帧缓存；该路径仅用于 `computeMode=worker`。
- People 不在 worker 持久化；service 在创建 AI job 时传入当前 People 快照。
- 默认 service 部署只启动一个容器；face-service 是 service 容器内进程，不作为用户可见的独立 Docker 服务。
- VLM endpoint 必须兼容 OpenAI chat completions：`POST {VISION_BASE_URL}/chat/completions`，支持 image_url data URI。默认 all-in-one 内部地址是 `http://127.0.0.1:11434/v1`。
- Face endpoint 由 `FACE_EMBEDDINGS_URL` 指定，约定输入 `{ images: [{ imageId, imageIndex, data, mimeType }], detect, returnCrops }`，输出 `{ faces: [{ faceId, imageIndex, bbox, embedding, sampleImageBase64 }] }`。默认 all-in-one 内部地址是 `http://127.0.0.1:19110/v1/face/embeddings`。
- 由 service 负责任务持久化、调度、校验和替换。
- 默认端口是 `19000`。

## 8. Runtime Data

Runtime data 不入库：

| 文件 | 所有者 | 说明 |
| --- | --- | --- |
| `media-service/data/config.json` | service | 配置 |
| `media-service/data/tasks.db` | service | 任务队列和任务中心历史 |
| `media-service/data/tasks.json` | service | 旧版任务存储；存在时启动自动迁移到 `tasks.db`，迁移后仅作为原始记录保留 |
| `media-service/data/library.db` | service | 媒体库主存储；列表分页、筛选和 item 读写从 SQLite 读取 |
| `media-service/data/library.json` | service | 旧版媒体库缓存；存在时启动自动迁移到 `library.db`，迁移后仅作为原始记录保留 |
| `media-service/data/nodes.json` | service | 转码节点登记 |
| `media-service/data/people.json` | service | 欧美成人 People 人物库 |
| `media-worker/config.json` | worker node | worker 本机配置 |
| `media-worker/data/ai/` | worker node | AI source asset、抽帧缓存和模型侧运行数据 |

不要把生产/测试环境导出的 `tasks_*.json`、`config_*.json`、截图、构建产物或日志提交到仓库。

## 9. API 契约

- Desktop domain: `/v1/*`
- Admin domain: `/v1/admin/*`
- Health: `GET /v1/health` public
- Protected APIs: `X-Api-Key`
- Error shape: `{ error: { code, message } }`
- GET 无副作用，PATCH 幂等部分更新

API 细节以 `src/app.js` 和现有 tests 为准。新增或变更 API 时必须补充对应 service inject test、desktop integration test 或 E2E flow。

成人库相关 API：

- `POST /v1/admin/sublibraries` 支持 `source=folder`、`mediaType=adult`。
- `POST /v1/admin/sublibraries/:uuid/actions/scan` 已废弃，返回 `410 ADULT_FOLDER_SCAN_REMOVED`。
- `GET/PATCH /v1/admin/adult/config` 管理成人库全局默认配置、日本 JAV scraper 默认项和欧美成人配置；face-service 不作为用户配置项暴露。
- `GET/POST/PATCH/DELETE /v1/admin/adult/people` 管理 service-owned People 人物库。
- `POST /v1/admin/adult/people/from-face` 从某个 item 的 unknown face cluster 创建 People reference face。
- `actionType=ingest` 和 `actionType=scrape` 都是正式任务类型，进入统一任务队列和任务监控。
- `approvalPolicy` 和 `automationMode` 属于子库任务配置；旧的 `scheduleMode/custom/autoReplace*` 字段仅作为兼容旧配置保留。

Worker API:

- `GET /api/v1/health`
- `GET /api/v1/capabilities`
- `POST /api/v1/jobs`
- `PUT /api/v1/jobs/:id/source`
- `GET /api/v1/jobs/:id`
- `GET /api/v1/jobs/:id/output`
- `DELETE /api/v1/jobs/:id`
- `POST /api/v1/assets`
- `PUT /api/v1/assets/:id/source`
- `GET /api/v1/assets/:id`
- `POST /api/v1/ai/jobs`
- `GET /api/v1/ai/jobs/:id`

## 10. 平台约束

- Docker/Linux 专用行为使用 `process.platform === 'linux'`。
- Windows-only tray 代码必须可选加载，Docker 中缺失 optional dependency 是正常情况。
- 路径使用 `path.join()` 和可配置根目录。
- FFmpeg/FFprobe 优先读取 `FFMPEG_PATH`、`FFPROBE_PATH`，Dockerfile 提供默认值。
- 日本 JAV scraper 是 service 内置 Node.js 实现，不依赖 Python。需要访问受限站点时，在成人库配置中设置代理服务器。
- 欧美成人 AI 默认在 service Docker all-in-one 内执行；worker 可保留为额外算力补充或兼容路径。

## 11. 关联文档

- `docs/v2/DEVELOPMENT_WORKFLOW.md`
- `docs/v2/TEST_ARCHITECTURE.md`
- `docs/v2/DEBUG_WORKFLOW.md`
- `tests/TEST_ENV_CHECKLIST.md`（私有凭据，不提交）
