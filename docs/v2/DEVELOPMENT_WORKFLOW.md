# DEVELOPMENT_WORKFLOW - 开发命令

本文件只保留开发时最常用的命令和平台规则。架构事实见 `docs/v2/ARCH_OVERVIEW.md`。

## 命令

```bash
# service
cd media-service && npm install
cd media-service && npm test
cd media-service && npm run build:web

# desktop
cd media-desktop && npm install
cd media-desktop && npm test
cd media-desktop && npm run dist:win

# worker node（转码补充节点；欧美成人 AI 默认不依赖 worker）
cd media-worker && npm install
cd media-worker && npm start
docker compose -f media-worker/docker-compose.example.yml up --build

# Docker service
docker build -f media-service/Dockerfile -t shelfdeck .
docker compose -f media-service/docker-compose.example.yml up -d
```

不要在 Codex 自动执行中启动长期阻塞的 dev server。需要交互调试时，让用户手动运行。

## 成人库 / Ingest + Scrape Task 开发

日本 JAV 成人库使用 ShelfDeck 内置 Node.js scraper。目录监听和扫描只负责发现稳定文件，并通过统一 `TaskAdmission` / `PriorityEngine` 创建 `actionType=ingest` 任务；`ingest` 完成单文件探测、NFO 预解析和媒体项写入后，未刮削 item 再创建 `actionType=scrape` 任务。具体执行由 `TaskScheduler` 按 `ingestConcurrency` / `scrapeConcurrency` 统一分配槽位。

真实刮削可以配置代理服务器；默认不配置时使用直连。普通 service API 测试不依赖真实网络刮削；可以用临时目录或 `E:\my_project\emby_third_party\jav_test` 做扫描和端到端验证。

成人库子库约定：

| 字段 | 说明 |
| --- | --- |
| `source=folder` | 直接监听本地文件夹，不走 Emby 刷新 |
| `mediaType=adult` | 成人库大类 |
| `adultRegion=japanese_jav` | 日本 JAV，使用 ShelfDeck 内置 scraper |
| `adultRegion=western_adult` | 欧美成人库，默认由 service-local 做抽帧、人脸匹配和封面生成 |
| `actionType=ingest` | 入库任务，把单个文件候选转换为媒体项和技术探测结果 |
| `actionType=scrape` | 刮削任务，完成后只更新 metadata 和 `scraped=true`；是否转码由策略和 `SmartTaskEngine` 决定 |
| `automationMode=auto/manual` | 子库自动调度开关；审批节点由 `approvalPolicy` 单独控制 |
| `approvalPolicy` | 任务内部关键节点审批策略，支持 `auto`、`confirm`、`forceConfirm` |
| `mediaLibraryStartupRefreshOnStartup` | 普通媒体库启动后是否自动刷新 |
| `mediaLibraryStartupRefreshDelaySeconds` | 普通媒体库启动刷新延迟，避免服务刚监听端口就被全量刷新压住 |
| `smartTaskInitialDelaySeconds` | `SmartTaskEngine` 首次自动入队扫描延迟 |
| `adultLibrary.probeTimeoutMs` | 成人库 `ingest` 单文件 FFprobe 超时，坏文件不应阻塞 API |

欧美成人库约定：

- People 人物库归 service 持久化，用户通过搜索/上传高清正脸图建立 reference face。
- 刮削整理完成的成人库影片默认归拢到 `watchRoot/scraped/` 下；ShelfDeck 扫描/监听默认忽略该目录，Emby 可只监控这个归拢目录。
- service 默认使用自身 FFmpeg 抽帧，并调用 service Docker 内部 InsightFace face-service 做 embedding；face-service 不作为用户配置项暴露。
- Docker service 是 all-in-one 容器，内部启动 Node service 和 face-service；容器外只暴露 `18080`。
- 人脸模型目录默认是 `/app/data/face-models`，挂载数据卷后容器重启不会重新下载模型。
- 匹配不到 protagonist 时等同于 JAV 识别不到番号：任务失败，item 保持 `scraped=false`，不会自动进入转码策略。
- 成人库不得新增独立调度规则。新建、重试、冷却、队列上限、去重、优先级都必须走统一任务模型。

## Task Store

任务中心主存储是 `media-service/data/tasks.db` SQLite。`tasks.json` 是旧版运行时文件，启动时会一次性迁移到 SQLite；迁移不会删除原 JSON。不要通过删除任务数据库来“清队列”，否则会丢失完成和失败历史。需要控制雪崩时应使用 `TaskAdmission` 队列上限、冷却、启动延迟和子库 `automationMode`。

## 平台规则

- Docker/Linux 专用行为用 `process.platform === 'linux'`。
- Windows tray 代码必须可选加载或由 `process.platform === 'win32'` 守卫。
- Windows-only 依赖放入 `optionalDependencies`，Docker 安装用 `--omit=optional`。
- 路径使用 `path.join()` 和可配置根目录。
- FFmpeg/FFprobe 路径优先读取环境变量。
- runtime 配置、任务、媒体库缓存、节点配置、构建产物不入库。

## 改动时最低验证

```bash
cd media-service && npm test
cd media-desktop && npm test
bash tests/runner.sh health-check tests/env/ci.env
```

涉及 Docker、Admin Web、转码 node、外部服务或真实媒体时，再运行对应构建或 E2E flow。
