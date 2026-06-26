# ShelfDeck 媒体库管家

ShelfDeck 用于管理 Emby 电影媒体库：同步媒体元数据、观看状态和评分，基于策略判断每部影片应该保留、删除、转码或洗版，并通过 service 执行任务。

## 当前范围

- 支持 Emby 电影媒体库。
- 支持 service Docker、service Windows、desktop、转码 node 四个模块。
- service 是任务和数据的 SSOT；desktop 是 HTTP thin client。
- 转码 node 是被 service 调用的被动计算节点，只负责接收源文件、执行 FFmpeg、返回输出文件。
- Windows 托盘已经内嵌到 `media-service`，不再有独立托盘进程。

## 主要目录

| 路径 | 说明 |
| --- | --- |
| `media-service/` | Fastify service、Admin Web、任务调度、Emby/Douban/MoviePilot/FFmpeg 集成 |
| `media-desktop/` | Electron + React desktop client |
| `media-worker/` | 转码 node，提供 `/api/v1/jobs` 等 worker API |
| `tests/` | E2E shell flow runner 和环境文件 |
| `docs/v2/` | 只保留架构、开发命令、测试命令、排查入口 |

## 开发命令

```bash
cd media-service && npm install && npm test
cd media-service && npm run build:web

cd media-desktop && npm install && npm test
cd media-desktop && npm run dist:win

cd media-worker && npm install && npm start

docker build -t shelfdeck media-service/
bash tests/runner.sh health-check tests/env/ci.env
```

不要在自动化上下文中直接跑长期阻塞的 `npm run dev`。

## 文档入口

- `docs/v2/ARCH_OVERVIEW.md` - 当前架构和模块边界
- `docs/v2/DEVELOPMENT_WORKFLOW.md` - 3-target 开发流程
- `docs/v2/TEST_ARCHITECTURE.md` - 测试分层和 flow 目录
- `docs/v2/DEBUG_WORKFLOW.md` - 排查工作流
- `tests/TEST_ENV_CHECKLIST.md` - 私有测试环境凭据，已被 `.gitignore` 忽略

## 许可

GPL-3.0。ShelfDeck 依赖 FFmpeg 相关二进制，用户需自行确保 Emby、MoviePilot、媒体内容和豆瓣数据使用符合各自授权与服务条款。
