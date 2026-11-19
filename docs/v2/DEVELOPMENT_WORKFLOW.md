# DEVELOPMENT_WORKFLOW - 开发命令

本文件只保留开发时最常用的命令和平台规则。架构事实见 `docs/v2/ARCH_OVERVIEW.md`。

**平台范围（2026-10-29）：** Windows desktop（`media-desktop` / `dist:win`）与 Windows service 打包（`package-win`）**已退役、不再支持**。不要做 Windows 兼容修复或本机 Windows 部署。支持面是 **Linux Docker（`heavy` 生产）** 与 Linux/本机 Node 开发。CI 仅保留 Docker/Linux jobs。

## 开发与验证拓扑（迁移后标准工作流）

从 Windows 工作站出发时，直接按下面拓扑分流，不要盲目探测已停止的本机 Docker Desktop / WSL 或已退役的 `.230` 飞牛 NAS：

| 角色 | 主机 / 路径 | 硬件与运行时 | 适用范围 | 硬边界 |
| --- | --- | --- | --- | --- |
| **Windows 工作站** | `H:\shefldeck`（隔离开发用 `.worktrees/<slug>`） | Windows **Node `22.23.5 LTS`**（已预装 `media-service\node_modules`、`web\node_modules` 与 `tools\node_modules`），Docker Desktop/WSL 默认关闭 | 代码编辑、Git 分支/PR、纯 JS 契约测试、定向 `media-service` 单测 / SQLite / sharp / 静态架构守卫与 `npm run build:web` | **严禁为跑单测探测或拉起本机 Docker Desktop / WSL**；重装依赖须用 `npm ci --ignore-scripts` + 指定原生模块 `npm rebuild`（`usearch@2.25.3` 无 `win32-x64` prebuild）；全量 `test:helix-architecture`（含 `jav-host-journey.test.js` 等长文件/全宿主矩阵）、`usearch`、`/proc/self/fd`、POSIX/CIFS 语义与 Linux E2E 交由 `worker` 执行 |
| **CPU / Linux 专属验证 VM** | `worker` (`192.168.12.216`) | Linux 4 vCPU / 7.7 GiB RAM / **0 Swap**，Node 22 + `ffmpeg`/`ffprobe`，仅预装 `/home/gezhu/repos/Shelfdeck/media-service/node_modules`（无 `tools/node_modules` 与 `web/node_modules`），**无 GPU、无 Docker** | 全量 `test:helix-architecture`、`usearch` 原生检索、`/proc/self/fd` 与 POSIX/CIFS 语义校验、Linux E2E、`verify-shelfdeck` HTTP（SSH 工具契约单测在 Windows 工作站跑） | 禁止改 `/home/gezhu/repos/Shelfdeck` 原目录；并发严格限制 `--test-concurrency=2`；禁止 `pkill node`；结束即删 `/tmp/sd-verify-*` |
| **GPU / Docker 隔离副本** | `heavy` (`192.168.12.215`) | Debian 12 + NVIDIA Quadro T2000 (`TU117` NVENC)，Docker + `nvidia-container-toolkit` | `hevc_nvenc` / GPU 管线验证、容器化运行时 / Dockerfile / `verify-shelfdeck` Docker 模式 | 必须使用 `/tmp/sd-gpu-verify-*` 临时目录、一次性 `SHELFDECK_SECRET_ROOT`、非 `18080` 的 `127.0.0.1:<port>`；严禁碰 `shelfdeck` 容器、`:18080` 或生产挂载；用完即删 |
| **生产服务** | `heavy` (`http://192.168.12.215:18080`) | 容器 `shelfdeck`（SSD `/srv/apps/shelfdeck` + HDD `/srv/shelfdeck`） | 仅只读诊断，或用户明确授权的标准发布/Reset | 严禁未授权写数据、启停容器或执行 `--apply`；旧 `.230` 已退役禁止双跑 |

### 0. Windows 工作站（`H:\shefldeck`）Node 22 LTS 本地依赖与 Worktree 复用

本机已统一为 **Node.js `22.23.5 LTS`**（与 `worker` 一致），主工作区 `H:\shefldeck\media-service\node_modules`、`H:\shefldeck\media-service\web\node_modules` 与 `H:\shefldeck\tools\node_modules` 为常驻预装目录：

1. **隔离开发 worktree 零拷贝复用依赖**（禁止直接对每个 worktree 跑原生 `npm ci`，也禁止为此启动 Docker Desktop）：

```powershell
cmd /c mklink /J "H:\shefldeck\.worktrees\<slug>\media-service\node_modules" "H:\shefldeck\media-service\node_modules"
cmd /c mklink /J "H:\shefldeck\.worktrees\<slug>\media-service\web\node_modules" "H:\shefldeck\media-service\web\node_modules"
cmd /c mklink /J "H:\shefldeck\.worktrees\<slug>\tools\node_modules" "H:\shefldeck\tools\node_modules"
```

2. **清理 worktree 前必须先卸除 junction**（使用 `cmd /c rmdir`，**严禁**用 `Remove-Item -Recurse` 直接删 junction）：

```powershell
cmd /c rmdir "H:\shefldeck\.worktrees\<slug>\media-service\node_modules"
cmd /c rmdir "H:\shefldeck\.worktrees\<slug>\media-service\web\node_modules"
cmd /c rmdir "H:\shefldeck\.worktrees\<slug>\tools\node_modules"
git -C H:\shefldeck worktree remove H:\shefldeck\.worktrees\<slug>
```

3. **仅当依赖锁文件变更需要刷新 Windows 预装缓存时**（因 `usearch@2.25.3` 无 `win32-x64` prebuild，必须跳过其 install script）：

```powershell
cd H:\shefldeck\media-service
npm ci --ignore-scripts --no-audit --no-fund
npm rebuild better-sqlite3 sharp onnxruntime-node @ffprobe-installer/ffprobe ffmpeg-static
cd H:\shefldeck\media-service\web
npm ci --no-audit --no-fund
```

### 1. `worker` (`192.168.12.216`) CPU / Linux 隔离验证标准操作

1. **检查与建立独立 detached worktree**（先看 `free -h` 与运行中的 `node`，避免 7.7 GiB / 0 Swap OOM）：

```powershell
$env:SHELFDECK_NAS_HOST='192.168.12.216'
$env:SHELFDECK_NAS_USER='gezhu'
$env:SHELFDECK_NAS_KEY="$HOME\.ssh\shelfdeck-gezhu2403"
node tools/ssh-exec.js "free -h; pgrep -a node || true; cd /home/gezhu/repos/Shelfdeck && git fetch --all 2>/dev/null || true; git worktree prune && git worktree add --detach /tmp/sd-verify-<slug> <base-commit> && ln -s /home/gezhu/repos/Shelfdeck/media-service/node_modules /tmp/sd-verify-<slug>/media-service/node_modules"
```

2. **同步本地改动的少量文件**（通过 `tools/node_modules/ssh2` SFTP 写入 `/tmp/sd-verify-<slug>/<relpath>`，或 `git push worker` 后在 worktree 内 `git checkout FETCH_HEAD`），切勿直接修改 `/home/gezhu/repos/Shelfdeck` 主目录。
3. **执行验证**（尊重 7.7 GiB / 0 Swap 上限，E2E/全量加 `--test-concurrency=2`）：

```bash
cd /tmp/sd-verify-<slug>/media-service
node --test --test-concurrency=2 test/helix-architecture/<target>.test.js
npm run test:helix-runtime
```

4. **清理**（无论通过或失败均必须执行，禁止留下残留目录）：

```bash
cd /home/gezhu/repos/Shelfdeck && git worktree remove --force /tmp/sd-verify-<slug> && git worktree prune
```

### 2. `heavy` (`192.168.12.215`) GPU / NVENC / Docker 隔离副本验证标准操作

`worker` 无 GPU 且无 Docker；凡涉及 `NVIDIA Quadro T2000`（`hevc_nvenc`）、`--runtime=nvidia` 或完整 Docker 镜像行为的验证，必须在 `heavy` 的临时隔离容器中执行：

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

# worker node（转码补充节点；欧美成人 AI 默认不依赖 worker）
cd media-worker && npm install
cd media-worker && npm start
docker compose -f media-worker/docker-compose.example.yml up --build

# Docker service
docker build -f media-service/Dockerfile -t shelfdeck .
docker compose -f media-service/docker-compose.example.yml up -d
```

不要在自动执行中启动长期阻塞的 dev server。需要交互调试时，让用户手动运行。

上面的 Docker service 命令只用于本地或新环境验证。当前 NAS 生产部署固定走 `docs/v2/PRODUCTION_DEPLOYMENT.md`、`scripts/build-image.js`（及兼容包装 `build-image.sh`）和 `scripts/deploy-nas.js`；不要把 `media-service/docker-compose.example.yml` 当成生产 compose。

## 环境术语与硬件差异说明

项目语境约定：

| 术语 | 含义 |
| --- | --- |
| 测试环境 | Windows 工作站 **Node `22.23.5 LTS`**（常规单测 / SQLite / 架构校验 / `build:web`，不启 Docker Desktop）、`worker` (`192.168.12.216`) `/tmp` detached worktree（`usearch` / POSIX / Linux E2E），或 `heavy` 隔离 Docker 副本（GPU/Docker） |
| 生产环境 | `heavy` (`192.168.12.215:18080`) 上的 ShelfDeck Docker（旧飞牛 `.230` 已退役） |

普通切片默认先在测试环境验证，不需要每次部署生产。

> **历史 v2/v3 遗留脚本提示：** `scripts/sync-nas-runtime-data.js` 同步的是历史 v2/v3 文件（`config.json`、`library.db*`、`tasks.db*`、`douban-entries-cache.json`）并改写 `Z:\` / `Y:\` 路径，**不适用于**当前 Clean Helix 单库（`shelfdeck.db`）。保留下方命令仅作历史参考：

```bash
# 历史 v2/v3 用法（Clean Helix 不使用 config.json / library.db / tasks.db）
node scripts/sync-nas-runtime-data.js --rewrite-local-paths
```

| 范围 | 原因 |
| --- | --- |
| transcode 设备池 / 硬件加速 | `worker` VM（`192.168.12.216`）无 GPU 且无 Docker；NVIDIA Quadro T2000（`TU117` NVENC）编码与设备探测必须在 `heavy` 的隔离容器副本中验证 |
| 生产存储与系统压力 | `heavy` 的 SSD/HDD 分盘、CIFS（`.45`）、NFSv4（`.218`）挂载行为及磁盘压力不能由普通 CPU 单测证明 |
| 生产 Admin Web 最终验收 | 用户真实访问面仍是 `heavy` (`192.168.12.215:18080`) 上的服务 |

因此 `worker` 隔离环境用于快速定位业务逻辑、SQL/projection、API、前端状态和普通媒体流程；涉及 NVIDIA GPU/NVENC、Docker 镜像、真实存储 I/O 或最终用户视角时，在 `heavy` 隔离副本或授权生产检查中验证。

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
