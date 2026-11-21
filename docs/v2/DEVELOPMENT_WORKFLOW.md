# DEVELOPMENT_WORKFLOW - 开发命令

本文件只保留开发时最常用的命令和平台规则。架构事实见 `docs/v2/ARCH_OVERVIEW.md`。

**平台范围（2026-10-29）：** Windows desktop（`media-desktop` / `dist:win`）与 Windows service 打包（`package-win`）**已退役、不再支持**。不要做 Windows 兼容修复或本机 Windows 部署。支持面是 **Linux Docker（`heavy` 生产）** 与 Linux/本机 Node 开发。CI 仅保留 Docker/Linux jobs。

## 开发与验证拓扑（迁移后标准工作流）

> 术语消歧：`worker-dev`（主机 `worker` / `192.168.12.216`，主力 Linux 开发机）与 `media-worker`（被动 FFmpeg/AI 转码计算节点 `:19000`）严格区分；旧 Windows 工作站（`H:\shefldeck`）与旧验证目录（`/home/gezhu/repos/Shelfdeck`）已退出 ShelfDeck 日常开发。

在 `worker-dev` 上开展日常开发时，按下面拓扑分流，不要探测已退役的 `.230` 飞牛 NAS 或尝试在 `worker-dev` 上运行 GPU/NVENC 用例：

| 角色 | 主机 / 路径 | 硬件与运行时 | 适用范围 | 硬边界 |
| --- | --- | --- | --- | --- |
| **主力开发与 CPU / 非 GPU Docker 验证机** | `worker-dev`（`worker` VM `192.168.12.216`，主目录 `/home/gezhu/work/Shelfdeck` = `/srv/dev/workspaces/Shelfdeck`；隔离开发用 `.worktrees/<slug>` 或 `/tmp/sd-verify-<slug>`） | Debian 12，8 vCPU / 12 GiB RAM + 4 GiB swap，Node `22.23.5 LTS`，Docker `20.10.24`（`data-root=/srv/dev/docker`；本机为 `docker-compose` v1 `1.29.2`，无 `docker compose` v2），`media-service`/`web`/`tools` 三套 `node_modules` 全齐（含 `usearch` / `ffmpeg-static` / `@ffprobe-installer/ffprobe` / `ssh2`，系统 PATH 无全局 `ffmpeg`/`ffprobe`），**无 GPU** | 代码编辑、Git 分支/PR、全量单测与 `test:helix-architecture`、`usearch` 原生检索、`/proc/self/fd` 与 POSIX/CIFS 语义校验、`npm run build:web`、Linux E2E、`verify-shelfdeck`、非 GPU Docker 验证与 `scripts/build-image.js` 镜像构建 | 并发有界（如 `--test-concurrency=4`）；禁止 `pkill node`；临时 worktree/容器用完即删；严禁在本机存放 PVE 高权私钥；系统时区为 `Etc/UTC`，日志与汇报一律换算北京时间（`Asia/Shanghai`，UTC+8） |
| **GPU / NVENC 与生产同构隔离副本** | `heavy` (`192.168.12.215`) | Debian 12 + NVIDIA Quadro T2000 (`TU117` NVENC)，Docker + `nvidia-container-toolkit` + `docker compose` v2 | `hevc_nvenc` / GPU 管线验证、生产同构容器运行时 / `verify-shelfdeck` GPU/Docker 模式 | 必须使用 `/tmp/sd-gpu-verify-*` 临时目录、一次性 `SHELFDECK_SECRET_ROOT`、非 `18080` 的 `127.0.0.1:<port>`；严禁碰 `shelfdeck` 容器、`:18080` 或生产挂载；用完即删 |
| **生产服务** | `heavy` (`http://192.168.12.215:18080`) | 容器 `shelfdeck`（SSD `/srv/apps/shelfdeck` + HDD `/srv/shelfdeck`） | 仅只读诊断，或用户明确授权的标准发布/Reset | 严禁未授权写数据、启停容器或执行 `--apply`；严禁对 CIFS/NFS 挂载（尤其 `/mnt/shelfdeck_upgrade`）执行无界 `ls`/`stat`/`df`/`du`；旧 `.230` 已退役禁止双跑 |

### 0. `worker-dev`（`/home/gezhu/work/Shelfdeck`）本地依赖与 Worktree 复用

本机运行 **Node.js `22.23.5 LTS`**，主工作区 `/home/gezhu/work/Shelfdeck`（200 GiB NVMe `/srv/dev/workspaces/Shelfdeck`，受 `/home/gezhu/work/AGENTS.md` 约束）已预装 `media-service/node_modules`、`media-service/web/node_modules` 与 `tools/node_modules`；`ffmpeg`/`ffprobe` 由 `ffmpeg-static` 与 `@ffprobe-installer/ffprobe` 提供（系统 PATH 无全局二进制），Playwright 浏览器缓存按需安装：

1. **隔离开发 worktree 零拷贝复用依赖**（使用软链 `ln -s`，无需在每个 worktree 重复安装）：

```bash
git -C /home/gezhu/work/Shelfdeck worktree add -b sd/<slug> /home/gezhu/work/Shelfdeck/.worktrees/<slug> <base-commit>
ln -s /home/gezhu/work/Shelfdeck/media-service/node_modules /home/gezhu/work/Shelfdeck/.worktrees/<slug>/media-service/node_modules
ln -s /home/gezhu/work/Shelfdeck/media-service/web/node_modules /home/gezhu/work/Shelfdeck/.worktrees/<slug>/media-service/web/node_modules
ln -s /home/gezhu/work/Shelfdeck/tools/node_modules /home/gezhu/work/Shelfdeck/.worktrees/<slug>/tools/node_modules
```

2. **清理 worktree 前先移除软链再删除 worktree**：

```bash
rm -f /home/gezhu/work/Shelfdeck/.worktrees/<slug>/media-service/node_modules \
      /home/gezhu/work/Shelfdeck/.worktrees/<slug>/media-service/web/node_modules \
      /home/gezhu/work/Shelfdeck/.worktrees/<slug>/tools/node_modules
git -C /home/gezhu/work/Shelfdeck worktree remove /home/gezhu/work/Shelfdeck/.worktrees/<slug>
```

3. **仅当依赖锁文件变更需要刷新预装缓存时**：

```bash
cd /home/gezhu/work/Shelfdeck/media-service && npm ci --no-audit --no-fund
cd /home/gezhu/work/Shelfdeck/media-service/web && npm ci --no-audit --no-fund
cd /home/gezhu/work/Shelfdeck/tools && npm ci --no-audit --no-fund
```

### 1. `worker-dev` 本机隔离验证与非 GPU Docker 检查

1. **建立临时 detached worktree**（避免污染当前正在开发的分支）：

```bash
git -C /home/gezhu/work/Shelfdeck worktree prune
git -C /home/gezhu/work/Shelfdeck worktree add --detach /tmp/sd-verify-<slug> <base-commit>
ln -s /home/gezhu/work/Shelfdeck/media-service/node_modules /tmp/sd-verify-<slug>/media-service/node_modules
ln -s /home/gezhu/work/Shelfdeck/media-service/web/node_modules /tmp/sd-verify-<slug>/media-service/web/node_modules
ln -s /home/gezhu/work/Shelfdeck/tools/node_modules /tmp/sd-verify-<slug>/tools/node_modules
```

2. **执行 CPU / Linux 验证**（限制并发 `--test-concurrency=4`，禁止 `pkill node`）：

```bash
cd /tmp/sd-verify-<slug>/media-service
node --test --test-concurrency=4 test/helix-architecture/<target>.test.js
npm run test:helix-runtime
```

3. **非 GPU Docker 容器验证（可在 `worker-dev` 本机 Docker 直接执行）**：

```bash
RUN_ID="local-$(date -u +%Y%m%dT%H%M%SZ)-$$"
VERIFY_DIR="/tmp/sd-docker-verify-${RUN_ID}"
SECRET_ROOT="$(openssl rand -hex 32)"
mkdir -p "${VERIFY_DIR}/run"
docker run --rm --network none \
  -e "SHELFDECK_SECRET_ROOT=${SECRET_ROOT}" \
  -v "${VERIFY_DIR}/run:/run/verify" \
  markmahoro/shelfdeck:<tag> \
  node scripts/helix-clean-init.js --data-dir /run/verify/data --apply --confirm INITIALIZE_HELIX_CLEAN_V1
docker run --rm --name "shelfdeck-verify-${RUN_ID}" \
  -e "SHELFDECK_SECRET_ROOT=${SECRET_ROOT}" \
  -e MEDIA_SERVICE_DATA_DIR=/run/verify/data \
  -v "${VERIFY_DIR}/run:/run/verify" \
  -p 127.0.0.1:28080:18080 \
  markmahoro/shelfdeck:<tag>
```

4. **清理**（无论通过或失败均必须执行，禁止留下残留目录或容器）：

```bash
rm -f /tmp/sd-verify-<slug>/media-service/node_modules \
      /tmp/sd-verify-<slug>/media-service/web/node_modules \
      /tmp/sd-verify-<slug>/tools/node_modules
git -C /home/gezhu/work/Shelfdeck worktree remove --force /tmp/sd-verify-<slug> && git -C /home/gezhu/work/Shelfdeck worktree prune
rm -rf "${VERIFY_DIR}"
```

### 2. `heavy` (`192.168.12.215`) GPU / NVENC / Docker 隔离副本验证标准操作

`worker-dev` 已具备本机 Docker 但无 NVIDIA GPU；凡涉及 `NVIDIA Quadro T2000`（`hevc_nvenc`）、`--runtime=nvidia` 或生产同构挂载行为的验证，必须在 `heavy` 的临时隔离容器中执行：

1. **准备一次性 `/tmp` 数据与只读测试片段**（使用短合成素材；生产容器共用唯一 `Quadro T2000` `validatedConcurrentSlots=1` 槽位，避免长时间占满硬件编码器）：

```bash
RUN_ID="gpu-$(date -u +%Y%m%dT%H%M%SZ)-$$"
VERIFY_DIR="/tmp/sd-gpu-verify-${RUN_ID}"
SECRET_ROOT="$(openssl rand -hex 32)"
mkdir -p "${VERIFY_DIR}/run"
docker run --rm --network none \
  -e "SHELFDECK_SECRET_ROOT=${SECRET_ROOT}" \
  -v "${VERIFY_DIR}/run:/run/verify" \
  markmahoro/shelfdeck:<tag> \
  node scripts/helix-clean-init.js --data-dir /run/verify/data --apply --confirm INITIALIZE_HELIX_CLEAN_V1
```

2. **启动一次性 GPU 隔离容器（只绑 `127.0.0.1` 临时端口，严禁复用 `18080` 或挂载生产卷）**：

```bash
# 纯脚本/单测模式（随用随删）：
docker run --rm --name "shelfdeck-verify-${RUN_ID}" \
  --runtime=nvidia --network none \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility \
  -v "${VERIFY_DIR}/run:/run/verify" \
  markmahoro/shelfdeck:<tag> \
  node --test test/clean-ffmpeg-pipeline.test.js

# 需要 HTTP / Admin Web 端口时，绑定 127.0.0.1 随机高位端口，结束后立刻 rm -f 并删 ${VERIFY_DIR}：
docker run -d --name "shelfdeck-verify-${RUN_ID}" \
  --runtime=nvidia \
  -e "SHELFDECK_SECRET_ROOT=${SECRET_ROOT}" \
  -e MEDIA_SERVICE_DATA_DIR=/run/verify/data \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility \
  -v "${VERIFY_DIR}/run:/run/verify" \
  -p 127.0.0.1:28080:18080 \
  markmahoro/shelfdeck:<tag>
```

- **禁止挂载**：`/srv/apps/shelfdeck/data`、`/srv/shelfdeck/transcode`、`/srv/shelfdeck/operator-backups`、`/media`、`/adult`、`/mnt/shelfdeck_upgrade` 均不得以可写方式挂入验证容器；不得操作线上 `shelfdeck` 容器或读取线上 `secret.env`。
- **清理**：验证结束后立即执行 `docker rm -f "shelfdeck-verify-${RUN_ID}" 2>/dev/null || true; rm -rf "${VERIFY_DIR}"`。

## 命令

```bash
# service
cd media-service && npm install
cd media-service && npm test
cd media-service && npm run build:web

# media-worker 被动计算节点（转码补充节点；欧美成人 AI 默认不依赖 media-worker）
cd media-worker && npm install
cd media-worker && npm start
# 注：worker-dev 本机为 docker-compose v1（1.29.2），heavy 生产为 docker compose v2
docker-compose -f media-worker/docker-compose.example.yml up --build

# Docker service
docker build -f media-service/Dockerfile -t shelfdeck .
docker-compose -f media-service/docker-compose.example.yml up -d
```

不要在自动执行中启动长期阻塞的 dev server。需要交互调试时，让用户手动运行。

上面的 Docker service 命令只用于本地或新环境验证。当前 NAS 生产部署固定走 `docs/v2/PRODUCTION_DEPLOYMENT.md`、`scripts/build-image.js`（及兼容包装 `build-image.sh`）和 `scripts/deploy-nas.js`；不要把 `media-service/docker-compose.example.yml` 当成生产 compose。

## 环境术语与硬件差异说明

项目语境约定：

| 术语 | 含义 |
| --- | --- |
| 测试环境 | `worker-dev` (`192.168.12.216`) 本机 Node `22.23.5 LTS`（常规单测 / `test:helix-architecture` / `usearch` / POSIX / `build:web` / Linux E2E / 非 GPU Docker），或 `heavy` 隔离 Docker 副本（GPU/NVENC 与生产同构） |
| 生产环境 | `heavy` (`192.168.12.215:18080`) 上的 ShelfDeck Docker（旧飞牛 `.230` 已退役） |

普通切片默认先在测试环境验证，不需要每次部署生产。

> **历史 v2/v3 遗留脚本提示：** `scripts/sync-nas-runtime-data.js` 同步的是历史 v2/v3 文件（`config.json`、`library.db*`、`tasks.db*`、`douban-entries-cache.json`）并改写 `Z:\` / `Y:\` 路径，**不适用于**当前 Clean Helix 单库（`shelfdeck.db`）。保留下方命令仅作历史参考：

```bash
# 历史 v2/v3 用法（Clean Helix 不使用 config.json / library.db / tasks.db）
node scripts/sync-nas-runtime-data.js --rewrite-local-paths
```

| 范围 | 原因 |
| --- | --- |
| transcode 设备池 / 硬件加速 | `worker-dev`（`192.168.12.216`）虽有 Docker 但无 GPU；NVIDIA Quadro T2000（`TU117` NVENC）编码与设备探测必须在 `heavy` 的隔离容器副本中验证 |
| 生产存储与系统压力 | `heavy` 的 SSD/HDD 分盘、CIFS（`.45`）、NFSv4（`.218`）挂载行为及磁盘压力不能由普通 CPU 单测证明 |
| 生产 Admin Web 最终验收 | 用户真实访问面仍是 `heavy` (`192.168.12.215:18080`) 上的服务 |

因此 `worker-dev` 用于日常研发以及快速验证业务逻辑、SQL/projection、API、前端状态、普通媒体流程和非 GPU Docker 行为；涉及 NVIDIA GPU/NVENC、真实存储 I/O 或最终用户视角时，在 `heavy` 隔离副本或授权生产检查中验证。

## 历史成人库 / Nexora Observation + Metadata Maintenance 开发（非当前 Helix 实施入口）

本节只描述遗留代码维护位置。clean Helix 不承认 Nexora/Kairox 为一级 Domain；Series / JAV / Western Adult
也不属于 Movie-only Helix-beta 当前实施范围。任何后续产品工作必须先回到 Helix SSOT 与当前 Phase。

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

- 支持面：Linux Docker + Linux/本机 Node。Windows desktop/service **retired**。
- Docker/Linux 专用行为用 `process.platform === 'linux'`。
- 历史 Windows tray / optional 依赖可保留守卫；不要新增 Windows 支持面或 CI job。
- Docker 安装可用 `--omit=optional`。
- 路径使用 `path.join()` 和可配置根目录。
- FFmpeg/FFprobe 路径优先读取环境变量。
- runtime 配置、任务、媒体库缓存、节点配置、构建产物不入库。

## 改动时最低验证

```bash
cd media-service && npm test
bash tests/runner.sh health-check tests/env/ci.env
```

涉及 Docker、Admin Web、转码 node、外部服务或真实媒体时，再运行对应构建或 E2E flow。不要求 Windows desktop/service 验证。
