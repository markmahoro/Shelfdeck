# PRODUCTION_DEPLOYMENT - 生产部署固定入口

本文是 ShelfDeck 当前唯一生产部署入口。当前生产部署方式固定为：本机 build image -> 导出 tar -> `upload-nas-image.js` 上传并校验 -> `deploy-nas.js` dry run -> `deploy-nas.js --apply`。Codex 处理任何“上线、部署、升级 NAS、发布 Docker、生产环境”相关任务时，必须先读本文，再读 `scripts/build-image.js`、`scripts/upload-nas-image.js` 和 `scripts/deploy-nas.js`。

## 当前生产环境

Helix-beta 已于 2026-08-28 在飞牛 NAS 上线。下列是 **当前生产配置快照**（不含凭据）。升级必须保留这些绑定，禁止 `--helix-clean-init`，除非 Product Owner 明确要求清库。

| 项 | 固定值 |
| --- | --- |
| 生产形态 | 飞牛 fnOS 1.1.19 Docker 单容器 `shelfdeck` |
| 生产地址 | `http://192.168.12.230:18080` |
| NAS SSH | `192.168.12.230:22`，用户 `gezhu`；优先私钥，见下方 SSH |
| NAS compose 目录 | `/vol1/1000/docker/shelfdeck` |
| NAS compose 文件 | `/vol1/1000/docker/shelfdeck/docker-compose.yml` |
| NAS 数据目录 | `/vol1/1000/docker/shelfdeck/data` |
| 镜像名 | `markmahoro/shelfdeck:<tag>`，同时打 `latest`，但生产不从 DockerHub pull |
| 当前运行镜像 | `markmahoro/shelfdeck:helix-beta-20260829-d1dd611d4`（git `d1dd611d4`，tar SHA-256 `582449a703271b35f933f39d48edf9e86c6b8aefacc70c87c561b888e9d5192f`） |
| 容器内 service 端口 | `18080` |
| 容器内数据目录 | `/app/data` |
| 普通媒体挂载 | NAS `/vol02/1000-0-c5b736af` -> 容器 `/media` |
| 洗版/外部落地 | NAS `/vol2/1000/shelfdeck_upgrade` -> 容器 `/upgrade` |
| Production Workspace / 转码目录 | NAS `/vol2/1000/shelfdeck_transcode` -> 容器 `/transcode`。**`/transcode` 就是本机 Production Workspace 根**，不是额外再挂一个 workspace |
| 成人库挂载 | NAS `/vol02/1000-0-24018892` -> 容器 `/adult_media` |
| QSV 核显 | 宿主机 `/dev/dri` -> 容器 `/dev/dri`，`LIBVA_DRIVER_NAME=iHD` |

### 当前业务对象（2026-08-28 只读快照）

| 项 | 值 |
| --- | --- |
| 文件来源 | `movie-field-52f6c848-af1b-4bdd-8655-d15bfdf30b5a`，名称「电影文件来源」，容器路径 `/media/Film`，status `active` |
| 收藏架 | `movie-shelf-2ba8e387-4cd7-4702-942a-a246da15d421`，名称「电影」，目标 `/media/Film`，status `active` |
| 路由策略 | 该来源 `direct`，始终指向上述收藏架 |
| Production Workspace | `platform_workspace_roots.resolved_root=/transcode`，`config_revision=2`，`state=active`。保存后须重启容器才生效 |
| TMDB | `tmdb-main` `active`，endpoint `https://api.themoviedb.org/3`，`proxyServer=http://192.168.12.230:7890`，language `zh-CN` |
| 豆瓣 | `douban-main` `active`，endpoint `https://movie.douban.com` |
| MoviePilot | `moviepilot-main` `active`，endpoint `http://192.168.12.230:3000` |
| Clash 代理 | 宿主机容器 `clash`（`metacubex/mihomo`）监听 `*:7890` |

SSOT 允许 Field 与 Shelf Target 同根；本机两者都是 `/media/Film`。Workspace 与转码共用 `/transcode` 是本机明确配置，不是疏忽。凭据只在 NAS `secret.env` 与本机 ignored 文件，不写入本文。

`media-service/docker-compose.example.yml` 只是新环境模板，不是当前 NAS 生产 compose 的来源。不要根据模板推断当前生产挂载；以 NAS 上的 `/vol1/1000/docker/shelfdeck/docker-compose.yml` 和本文件为准。

## 标准发布流程

Helix-beta 首次（或 schema 不匹配时）必须 `--helix-clean-init`。clean-init 把 compose 目录挂到 `/run/helix-nas`，在 `/run/helix-nas/data` 初始化，避免把 bind-mount 的 `/app/data` 当成可 rename 的目录。确认词为 `INITIALIZE_HELIX_CLEAN_V1`。`SHELFDECK_SECRET_ROOT` 写入 NAS `secret.env`（不入库），compose 通过 `env_file` 注入。不得运行 v3 compatibility migration、dual read 或直接修改 SQLite。

部署脚本会重写 NAS compose，但必须保留并校验：

- `/vol02/1000-0-c5b736af:/media`
- `/vol2/1000/shelfdeck_upgrade:/upgrade`
- `/dev/dri:/dev/dri`

1. 在本机从仓库根目录构建生产镜像 tarball：

```powershell
node scripts/build-image.js <tag>
```

输出文件为 `dist-image/shelfdeck-<tag>.tar`。

`scripts/build-image.sh` 仅为 Linux/Git Bash 兼容包装，内部调用同一个 Node 实现；Windows 不需要 WSL 或 Git Bash。

2. 计算本地 tarball 的 SHA-256，用于上传后校验：

```bash
sha256sum dist-image/shelfdeck-<tag>.tar
```

Windows PowerShell 可用：

```powershell
Get-FileHash dist-image\shelfdeck-<tag>.tar -Algorithm SHA256
```

3. 将 tarball 上传到 NAS 的 ShelfDeck 目录：

```powershell
node scripts/upload-nas-image.js dist-image\shelfdeck-<tag>.tar
```

上传脚本使用项目固定 NAS SSH 配置走 SFTP，不使用交互式 `scp`。SSH 由 `tools/nas-ssh-config.js` 统一读取，**优先私钥、密码仅作回退**：

1. 环境变量 `SHELFDECK_NAS_HOST` / `SHELFDECK_NAS_PORT` / `SHELFDECK_NAS_USER` / `SHELFDECK_NAS_KEY`（可选 `SHELFDECK_NAS_PASSWORD`）。
2. 本机 ignored 的 `tests/TEST_ENV_CHECKLIST.md` 表项：`飞牛 NAS IP`、`SSH 端口`、`SSH 用户名`、`SSH 私钥`（或 `SSH 密码`）。
3. 若仍未给出私钥路径，则尝试 `~/.ssh/gezhu_nas_health_it_ed25519` 与 `~/.ssh/id_rsa_shelfdeck`。

私钥文件只留在本机，不得提交。`tools/` 需要先 `npm install` 以提供 `ssh2`。脚本会先上传到 `.uploading-*` 临时文件，完成后 rename 为目标 tarball，并在 NAS 上校验 SHA-256。校验不通过不得部署。

4. 先 dry run 部署脚本，检查将要执行的生产步骤：

```bash
node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <local-sha256>
```

5. 如果 dry run、SHA-256 校验和脚本内检查通过，继续执行 apply：

```bash
node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <local-sha256> --apply
```

首次 Helix clean cutover 使用：

```powershell
node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <local-sha256> --helix-clean-init
node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <local-sha256> --helix-clean-init --apply
```

空 data 目录的 Helix-beta 首次初始化不要求旧 `config.json` 快照；已有数据时 clean-init 会在 compose 目录旁写 backup。Admin API key 只写本机 ignored 的 `tests/.env.nas-admin`，不得提交或打印。

## 部署脚本的固定契约

`scripts/deploy-nas.js` 是当前唯一允许的自动化生产发布入口。它默认 dry run；加 `--apply` 后才会连接 NAS 并执行变更。当前项目处于开发期，部署流程优先保持固定、快速、可重复；脚本会展示正在运行的 `ffmpeg` 进程，但不会因此阻塞部署。

apply 模式必须保持这些保护：

- 部署前检查 tarball、可选 SHA-256 和 NAS compose 文件。
- `upload-nas-image.js`、`deploy-nas.js` 和 `tools/ssh-exec.js` 必须复用 `tools/nas-ssh-config.js`，不要在脚本内硬编码 SSH 凭据。
- 由 tarball 文件名 `shelfdeck-<tag>.tar` 推导目标镜像 `markmahoro/shelfdeck:<tag>`，并更新 NAS compose 的 `image:`。
- 展示 live 容器里当前 `ffmpeg` 进程，作为中断风险提示；开发期部署允许中断这些任务，后续孤儿文件可另行清理。
- 部署前备份 `config.json`、`library.json` / `library.db`、`tasks.json` / `tasks.db`。
- Helix clean cutover 必须先有 `helix-clean-init.js` plan，停止旧容器后才允许 apply，并保留脚本生成的 backup 目录。
- 通过 NAS 上的 compose 文件 `docker compose up -d --force-recreate` 重建容器。
- 部署后检查 `/v1/health`、成人库挂载、代码来自镜像而不是源码挂载、关键 scraper 模块可加载。
- 部署前后输出数据文件大小，便于发现配置或任务数据异常。

不要绕过此脚本直接在生产 NAS 上执行 `docker stop`、`docker rm`、`docker compose down`、删除数据文件、清空任务、替换 compose，除非用户明确要求这类生产破坏性操作。

## Codex 处理规则

- 当用户要求“部署、上线、发布到 NAS、升级生产”时，该请求本身就是执行完整标准发布流程的授权；Codex 不需要在 dry run 后再次询问是否可以 `--apply`。
- dry run 失败、SHA-256 不匹配、health check 失败、挂载校验失败或其他脚本检查失败时，必须停止并报告失败原因，不能强行继续。
- 生产是 `192.168.12.230:18080`，本地测试是 `127.0.0.1:18080`；不要混用。
- 本地 `media-service/data/*.json` 和测试数据库可以重置；NAS `/vol1/1000/docker/shelfdeck/data` 不可随意修改。
- `docker compose -f media-service/docker-compose.example.yml up -d` 只用于本地或新环境验证，不是 NAS 生产部署方式。
- 不使用 DockerHub pull 作为当前生产部署路径；如以后切换 registry 部署，必须先更新本文和部署脚本的安全检查。
- 不要把源码目录 bind mount 到生产容器；生产代码必须来自构建出的 Docker image。
- 当前开发期允许部署中断正在运行的转码、刮削、删除、洗版任务；不要改用其他部署方法规避这个固定流程。
- 涉及生产问题排查时，先读 `tests/TEST_ENV_CHECKLIST.md` 和 `docs/v2/DEBUG_WORKFLOW.md`，但只做只读诊断，除非用户明确授权变更生产状态。
- v3.2.5 起，生产安全基线见 `docs/v3/PRODUCTION_SAFETY_BASELINE.md`。排查生产实验态、数据文件大小、最近备份、DB 聚合计数时，优先使用只读脚本：

```bash
node scripts/production-readonly-diagnostics.js
```

该脚本不得支持 `--apply`，不得写生产数据，不得输出凭据或媒体标题。

## 部署后的最小验收

```bash
curl -fsS http://192.168.12.230:18080/v1/health
```

如果改动涉及 Admin Web、配置、任务调度、成人库、转码或外部集成，还应按 `docs/v2/TEST_ARCHITECTURE.md` 补跑对应 flow。生产验收命令应优先使用只读接口。

## Helix 回滚

v3.0 回滚分两层：

1. 镜像回滚：重新部署上一个已知可用 tarball，仍使用 `scripts/deploy-nas.js` 的 dry-run 和 `--apply` 流程，不直接改 compose。
2. 数据回滚：如果必须回到 clean cutover 前的状态，停止容器后从 `.pre-helix-<timestamp>.bak` 和 `backups/helix-production-cutover-<timestamp>/` 恢复。恢复前先复制当前数据目录作为事故现场，不删除现有文件。

只要旧镜像能忽略新增 columns，就优先做镜像回滚，不做数据回滚。只有旧镜像启动失败或业务语义必须回退时才恢复备份数据。
