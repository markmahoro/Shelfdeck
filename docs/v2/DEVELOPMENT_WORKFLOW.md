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

# transcode node
cd media-worker && npm install
cd media-worker && npm start

# Docker service
docker build -t shelfdeck media-service/
docker compose -f media-service/docker-compose.example.yml up -d
```

不要在 Codex 自动执行中启动长期阻塞的 dev server。需要交互调试时，让用户手动运行。

## 成人库 / Scrape Task 开发

日本 JAV 成人库使用 ShelfDeck 内置 Node.js scraper。刮削是一等任务类型：目录监听和扫描只负责发现文件、写入 `library.json`、创建 `actionType=scrape` 任务；具体执行由 `TaskScheduler` 按 `scrapeConcurrency` 统一分配槽位。

真实刮削可以配置代理服务器；默认不配置时使用直连。普通 service API 测试不依赖真实网络刮削；可以用临时目录或 `E:\my_project\emby_third_party\jav_test` 做扫描和端到端验证。

成人库子库约定：

| 字段 | 说明 |
| --- | --- |
| `source=folder` | 直接监听本地文件夹，不走 Emby 刷新 |
| `mediaType=adult` | 成人库大类 |
| `adultRegion=japanese_jav` | 日本 JAV，使用 ShelfDeck 内置 scraper |
| `adultRegion=western_adult` | 欧美成人库，预留自研 scraper adapter |
| `actionType=scrape` | 刮削任务，完成后只更新 metadata 和 `scraped=true`；是否转码由策略和 `SmartTaskEngine` 决定 |

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
