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
| 当前运行镜像 | 以 [Helix CURRENT_STATUS](../helix/CURRENT_STATUS.md) 与 NAS 当次只读 inspect 为准；本文不维护易过期的发布身份 |
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

Helix-beta 首次（或 schema 不匹配且 Product Owner 明确授权清库时）才使用 `--helix-clean-init`。clean-init 把 compose 目录挂到 `/run/helix-nas`，在 `/run/helix-nas/data` 初始化，避免把 bind-mount 的 `/app/data` 当成可 rename 的目录。确认词为 `INITIALIZE_HELIX_CLEAN_V1`。`SHELFDECK_SECRET_ROOT` 写入 NAS `secret.env`（不入库），compose 通过 `env_file` 注入。不得运行 v3 compatibility migration或dual read。只有 Product Owner 明确授权的 bounded destructive incident procedure 才可在停服、完整备份、plan/confirm、integrity check 和标准deploy或专用offline operator包装下修改 SQLite；历史PROD-032入口为`scripts/predeck-pipeline-upgrade-nas.js`，当前Formation清场固定入口为`scripts/formation-reset-nas.js`，不允许手工SQL。

PROD-047 的获授权旧 Aftercare reclaim 执行残留纠正只能使用
`scripts/prod047-aftercare-reclaim-correction-nas.js`。该包装要求逐条 `--expected-work-id`，执行标准 deploy
dry-run、停服、完整 data backup、离线 plan/apply/plan 与 integrity check，再进入标准 deploy；不得手工 SQL，
也不得把该事故纠正变成常驻 Runtime 兼容。

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

4. 升级候选须先完成最新完整一致生产副本的完整 Host 启动与升级/回退验证，再 dry run 部署脚本。副本必须包含 SQLite 一致备份及所有伴随文件，并逐文件校验；从冻结原件另复制演练目录，媒体与现有 Workspace 只读挂载、外部网络隔离，代码来自与待发布 tar 对应的精确镜像。验证不能只调用数据库 readiness 或按 process 过滤的执行轨：必须实际运行完整 `createCleanServiceHost`（生产 `server.js` 使用同一入口），检查 `/v1/health` 和 `normalSupplyAllowed=true`，记录启动/关闭、不可变历史及未决 Effect 保护结果。隔离导致的失败或超时须定位并记录，不能当作通过。当前镜像、候选和回退镜像均需有明确覆盖；历史 Catalog、schema 或 typed contract 变化尤其不能跳过此项。

记录快照时间/摘要、候选 source commit、镜像身份、tar SHA256及完整启动错误；实际发布前若队列或精确恢复范围发生变化，重核现场，不能沿用旧 Reset 清单。完整启动与回退证据不足时停止发布，不能改历史摘要、加无界 Catalog 白名单或删除数据绕过。该门禁由 [UAT-261 发布失败](../helix/implementation/evidence/UAT-261_CATALOG_STARTUP_DEPLOYMENT_20260912.md)确认，`deploy-nas.js` 的 readiness 并不替代它。

上述验证通过后，dry run 检查将要执行的生产步骤：

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

### Formation Reset 不是部署

历史Reset留下的superseded Offer发布可用`--superseded-offer-ids <逗号分隔ID>`精确退役（最多32个）。工具必须证明每个Offer已被后续占用覆盖，保留原终态Delivery/Reservation，不重新采购同一材料；如仍有Intake，须用`--subject-ids`同时明确纳入其未Commit闭包，否则拒绝。单独提供Offer范围不会扩大为全量Subject Reset。执行前须完成副本演练与收藏保护校验，仍适用下述生产授权、备份及离线确认要求。

Formation Reset是当前开发期的唯一offline调试能力，不发布新镜像、不替代标准部署，也不主动重新Intake。默认命令只读取
当前生产数据库并输出plan：

```powershell
node scripts/formation-reset-nas.js
```

只有用户明确授权该次生产Reset后才执行`--apply --confirm FORMATION_RESET_V2`。包装脚本只停止`shelfdeck` Compose service，在
`/vol1/1000/docker/shelfdeck/backups/formation-reset-*/data`创建并校验完整备份，使用当前精确镜像离线执行Reset，然后恢复服务并检查
`GET /v1/health`。Reset不挂载`/media`；失败时禁止继续部署或手工改库，应保留停止状态和备份路径先查明原因。

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

## PROD-036 Observation retention一次性迁移

本节是新镜像部署后的**一次性维护流程**，不是普通每次升级步骤。只有Product Owner明确授权生产迁移时才执行；
代码合并或本地测试本身不授权连接NAS。迁移不使用`--helix-clean-init`，不清空业务数据。

1. 按本文标准流程build、upload、`deploy-nas.js` dry run及`--apply`部署包含PROD-036的镜像，保留部署脚本生成的数据库备份。
2. 服务启动后确认health/readiness正常，让`field-observation-entry-retention`以每批最多1,000行清理；满批backlog按30秒继续，
   直到连续两次只读诊断的`gcEligible.rows=0`且`olderThanSevenDays`只剩引用保护行，Entry总数不再快速下降。不得因想缩文件而提前跳过引用安全清理。
3. 运行`node scripts/production-readonly-diagnostics.js`并保存输出；确认没有新增running Observation、没有FFmpeg/其他关键操作需要保护，
   且NAS数据目录旁可用空间至少为`1.2 × shelfdeck.db`。
4. 在NAS compose目录停止`shelfdeck`服务。使用**刚部署的新镜像**和同一`/app/data`挂载先执行dry run：

   ```bash
   docker compose run --rm --no-deps shelfdeck node scripts/helix-observation-storage-compact.js --database /app/data/shelfdeck.db
   ```

   输出必须为`mode=dry_run`、`enoughFreeSpace=true`、marker为`shelfdeck/helix-clean-v3`。任一条件不满足就停止。
5. 显式执行一次apply；脚本获取exclusive lock、TRUNCATE checkpoint、`VACUUM INTO`临时库，验证integrity/FK、Entry行数和
   `auto_vacuum=2`后才同卷rename。原库保留为`.pre-observation-compact-<timestamp>.bak`：

   ```bash
   docker compose run --rm --no-deps shelfdeck node scripts/helix-observation-storage-compact.js --database /app/data/shelfdeck.db --apply
   ```

6. 启动`shelfdeck`，检查health/readiness、`foreign_key_check`空、`integrity_check=ok`、`autoVacuum=2`，并再次保存只读诊断。
   至少观察两个12小时Observation周期后，才把PROD-036标为生产FIXED；备份在该观察期结束前不得删除。

如果apply后服务不能通过启动门禁：保持服务停止，把当前`shelfdeck.db`复制为带时间戳的事故现场；从脚本输出的精确backup path
复制回`/app/data/shelfdeck.db`，确认不存在未checkpoint的sidecar，再按标准流程恢复上一已知可用镜像。不要修改Work/Attempt/Event行，
不要手工DELETE Entry，也不要覆盖唯一备份。

### PROD-036监控清单

- Observation cadence：同一active Field相邻完整Work应约12小时；连续两轮小于11小时或超过13小时需调查。
- 开放Work年龄：`admitted|ready|running|blocked`的Field Observation数量和最老`created_at_ms`；超过一次12小时周期仍不终结报警。
- 执行中Observation：`executingObservationAttempts.count`及`oldestStartedAtMs`；任一Attempt超过冻结的1小时deadline报警。
  `intendedWithoutResultOrMarker`表示仍停在领域提交前；replacement保留原Attempt deadline，已过期的旧第69个Attempt应在启动恢复中直接
  失败收口并使该值归零。不得把重启当作刷新一小时预算，不得人工改状态。
- 独立聚合崩溃窗口：`runningAttemptWithOnlyTerminalEvents.count`仍应为0；该指标不是本次第69页卡住的根因。
- Entry容量：总行数、窗口外行数、最老/最新`observed_at_ms`及distinct Work；窗口外行只允许由保护集合解释。
- 清理批次：Admin Overview的`field-observation-entry-retention` registration应为`normal|waiting_business_time`，无`errorCode`；
  backlog期间应持续processed，稳定后为not_due。每批上限1,000，Entry count差值不得超过已报告批次上限总和。
- SQLite：记录`pageCount`、`freelistCount`、`autoVacuum`、`shelfdeck.db/-wal/-shm`字节；迁移后`autoVacuum=2`，
  freelist应被有界回收，WAL不应持续单调增长。文件大小短时不降不等于GC失败，应同时看Entry数与freelist。
- 容量阈值：39.5 MiB/轮时7天base约553 MiB；每个窗口外受保护Work另加约39.5 MiB。超过该模型时先查保护Work/backlog，
  不得通过缩短retention、删header或绕过FK来压库。

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
