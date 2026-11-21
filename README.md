# ShelfDeck 媒体库管家

ShelfDeck 从用户配置的物理 Material Field 建立并运营个人媒体收藏。Emby、TMDB、豆瓣和 MoviePilot
都是可选 External Provider；ShelfDeck 自己拥有收藏形成、成品入架、保养、退出收藏和整架注销事实。

当前产品是 Movie-only 的 Helix-beta 全链路版本。架构、当前状态、计划和验收范围分别以
`docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`、`docs/helix/CURRENT_STATUS.md`、
`docs/helix/CURRENT_PLAN.md` 和 `docs/helix/BETA_FEATURE_ACCEPTANCE_BASELINE.md` 为准。

## 主要目录

| 路径 | 说明 |
| --- | --- |
| `media-service/` | Fastify service、Admin Web、Helix modular monolith、集成与 Docker/Linux runtime |
| `media-desktop/` | 历史 Electron thin client 目录（**已退役 / 不再支持**） |
| `media-worker/` | 被 service 调用的被动 FFmpeg/AI 转码计算节点（`media-worker`，与 `worker-dev` 开发机区分） |
| `tests/` | Shell E2E runner 与本地私密环境文件 |
| `docs/helix/` | 当前 ShelfDeck / Helix 权威文档 |
| `docs/v3/` | 已关闭的 Kairox 历史与版本管理入口 |
| `docs/v2/` | 现存实现图、开发、测试、部署和排错入口；不能覆盖 Helix SSOT |

## 开发命令

```bash
# worker-dev（/home/gezhu/work/Shelfdeck，Debian 12 + Node 22 LTS + Docker）
cd media-service && npm ci && npm test
cd media-service && npm run build:web
cd tools && npm ci

# 被动 media-worker 计算节点（按需）
cd media-worker && npm install && npm start

# E2E smoke（针对已运行的服务实例）
bash tests/runner.sh health-check tests/env/ci.env
```

不要在仓库根目录执行 `npm install`，也不要让自动化长期阻塞在 `npm run dev`；`worker-dev` 上隔离 `.worktrees/*` 或 `/tmp/sd-verify-*` 通过软链（`ln -s`）复用主目录 `node_modules`（详见 `docs/v2/DEVELOPMENT_WORKFLOW.md`）。Windows desktop / service 已退役，不再支持。

生产部署（当前目标为 `heavy` `192.168.12.215`）只走 `docs/v2/PRODUCTION_DEPLOYMENT.md` 规定的
`scripts/build-image.js` → `scripts/upload-nas-image.js` → `scripts/deploy-nas.js`。当前部署身份见
`docs/helix/CURRENT_STATUS.md` 和 `docs/v3/VERSIONING.md`。

## 许可

GPL-3.0。用户需自行确保 Emby、MoviePilot、媒体内容、External Provider 数据及 FFmpeg 相关二进制的使用
符合相应授权和服务条款。
