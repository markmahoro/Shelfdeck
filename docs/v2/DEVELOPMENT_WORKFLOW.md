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
