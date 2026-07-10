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

上面的 Docker service 命令只用于本地或新环境验证。当前 NAS 生产部署固定走 `docs/v2/PRODUCTION_DEPLOYMENT.md`、`scripts/build-image.sh` 和 `scripts/deploy-nas.js`；不要把 `media-service/docker-compose.example.yml` 当成生产 compose。

## 本机生产同构测试 Profile

项目语境约定：

| 术语 | 含义 |
| --- | --- |
| 测试环境 | 本机 Windows 环境 |
| 生产环境 | NAS 上的 ShelfDeck Docker |

普通切片默认先在本机测试环境验证，不需要每次部署 NAS 生产。需要生产同构配置或生产数据规模时，先同步 NAS runtime 数据到 ignored 目录：

```bash
node scripts/sync-nas-runtime-data.js --rewrite-local-paths
```

默认输出目录是 `.codex/local-prod-data/`，不会提交。脚本会只读下载：

| 文件 | 用途 |
| --- | --- |
| `config.json` | 生产同构配置，包括 Emby / MoviePilot / 自动化配置 |
| `library.db*` | 生产规模媒体库投影 |
| `tasks.db*` | 生产规模任务和 task event 投影 |
| `douban-entries-cache.json` | 本机复现 Douban cache 匹配 |

`--rewrite-local-paths` 会保留 `config.nas-original.json`，并把本机测试路径改成：

| 库类型 | 本机根目录 |
| --- | --- |
| 普通 Emby 库 | `Z:\` |
| adult folder 库 | `Y:\` |

本机运行时可使用：

```powershell
$env:CONTROL_PLANE_DATA_DIR=(Resolve-Path .codex\local-prod-data).Path
$env:MEDIA_SERVICE_DATA_DIR=$env:CONTROL_PLANE_DATA_DIR
cd media-service
npm test
```

涉及真实媒体文件探测、普通 Emby metadata repair、adult observation/scrape 的本机复现，应优先使用这个 profile。只有重大版本验收、真实 NAS 行为验证、Admin Web 生产浏览器验收，或用户明确要求时，才部署 NAS 生产。

本机测试环境不是生产环境的完全等价替身，以下内容必须在 NAS 生产环境或 Linux/Docker 等价环境上验证：

| 范围 | 原因 |
| --- | --- |
| transcode 设备池 / 硬件加速 | 本机设备池和 NAS 不同，QSV/VAAPI/驱动/设备槽位不能完全复现 |
| Linux Docker 行为 | 本机是 Windows 非 Linux Docker runtime，路径、权限、进程和 I/O 行为不同 |
| NAS 存储与系统压力 | NAS 的 iowait、swap、overlay、SMB/NFS 挂载和磁盘压力不能由本机证明 |
| 生产 Admin Web 最终验收 | 用户真实访问面仍是 NAS 上的服务 |

因此本机 profile 用于快速定位业务逻辑、SQL/projection、API、前端状态和大数据规模下的代码路径；涉及设备、容器、NAS I/O 或最终用户视角时，再进入生产环境验证。

## 成人库 / Nexora Observation + Metadata Maintenance 开发

日本 JAV 成人库使用 ShelfDeck 内置 Node.js scraper。Source discovery 由 Nexora observation adapter 完成，进入 Libra onboarding 后才能获得 Kairox admission；Helix 不创建 `targetGate=ingest` 任务。Metadata maintenance 仍通过 Kairox `targetGate=metadata`、Flow Planner 和统一 TaskAdmission 执行。

真实刮削可以配置代理服务器；默认不配置时使用直连。普通 service API 测试不依赖真实网络刮削；可以用临时目录或 `E:\my_project\emby_third_party\jav_test` 做单 item 入库和端到端验证。

成人库子库约定：

| 字段 | 说明 |
| --- | --- |
| `source=folder` | 直接监听本地文件夹，不走 Emby 刷新 |
| `mediaType=adult` | 成人库大类 |
| `adultRegion=japanese_jav` | 日本 JAV，使用 ShelfDeck 内置 scraper |
| `adultRegion=western_adult` | 欧美成人库，默认由 service-local 做抽帧、人脸匹配和封面生成 |
| Nexora observation | 把单个文件候选转换为 SourceBinding 和 onboarding evidence，不创建 Kairox ingest task |
| `targetGate=metadata` | Kairox metadata 维护任务；Flow Planner 可选择 `scrape` flow |
| `libraryAutomationMode=auto/manual` | 是否周期观察 Source；manual 只响应显式 observe intent |
| `maintenanceAutomationMode=auto/manual` | auto 自动建立 Maintenance Run；manual 由用户一次启动 Run，Run 内都连续推进 |
| `approvalPolicy` | 任务内部关键节点审批策略，支持 `auto`、`confirm`、`forceConfirm` |
| `adultLibrary.probeTimeoutMs` | folder observation 单文件 FFprobe 超时，坏文件不应阻塞 SourceBinding 观察 |

欧美成人库约定：

- People 人物库归 service 持久化，用户通过搜索/上传高清正脸图建立 reference face。
- 刮削整理完成的成人库影片默认归拢到 `watchRoot/scraped/` 下；ShelfDeck 的目录核对默认忽略该目录，Emby 可只监控这个归拢目录。
- service 默认使用自身 FFmpeg 抽帧，并调用 service Docker 内部 InsightFace face-service 做 embedding；face-service 不作为用户配置项暴露。
- Docker service 是 all-in-one 容器，内部启动 Node service 和 face-service；容器外只暴露 `18080`。
- 人脸模型目录默认是 `/app/data/face-models`，挂载数据卷后容器重启不会重新下载模型。
- 匹配不到 protagonist 时等同于 JAV 识别不到番号：任务失败，item 保持 `scraped=false`，不会自动进入转码策略。
- 成人库不得新增独立调度规则。Metadata refresh 只提交中性 intent；Run、TaskAdmission、MediaItem Priority 和 Governor 与普通媒体共用。
- 物理删除属于 Libra 授权的 Nexora `delete_source` offboarding，不再创建 Kairox delete task。必须显式 destructive authorization，且目标必须仍在 `watchRoot` 内，不能是 `watchRoot` 或 `scraped/` 根目录。

## Task Store

Libra 主存储是 `media-service/data/library.db` SQLite，Kairox Run/Task/Facts 主存储是 `media-service/data/tasks.db` SQLite。Helix clean runtime 不迁移 `library.json`、`tasks.json` 或 mixed `media_items`；旧 schema/config 必须先执行显式 clean initialization。

不要通过删除数据库“清队列”。供给由 Maintenance Run 决定，用户只能在允许的模式下开始 Run 或设置 MediaItem Priority；Task Scheduler 只派发既有 Task，Resource Governor 是唯一 capacity owner。

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
