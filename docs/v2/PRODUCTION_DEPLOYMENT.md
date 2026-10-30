# PRODUCTION_DEPLOYMENT - 生产部署固定入口

## 2026-10-27 停止态纠正后的只读发布复核

普通软件升级若已配置Fresh Reset管理，使用`--runtime-reset-config <原配置或本次明确作业配置>`保留该管理入口；同时指定SHA与两卷容量计划。它走正常readiness与Compose升级，普通停止态health为ok/供给关闭，不执行Bootstrap、Reset、依赖纠正或自动Resume，不能与对应变更选项混用。旧进程安全Stop、关闭连接后的完整恢复备份仍须先完成，使用同一`prepareNasStoppedBackup`包装；资格副本和实际发布分别记证，不能把配置保留参数当成数据处理授权。

Fresh Reset Bootstrap冷态管理的health为`maintenance/normalSupplyAllowed=false`；People依赖纠正完成后启动的是普通停止态Host，正确health为`ok/normalSupplyAllowed=false`。标准deploy按实际Host类型核对，不能把后者误判为未启动，也不能只以HTTP200通过。

已完成数据库发布而最终只读校验中断时，可在原tar、SHA、配置与scope参数后使用`--verify-only`，仅运行精确白名单中的tar校验、Compose验证、health、Admin Web、挂载和镜像检查，不上传配置、加载镜像、执行备份/纠正、重建容器或Resume。它要求SHA，拒绝`--apply`及继续变更选项。先前变更仍以原回执为准；该模式不重新宣称数据纠正或Reset已执行。每个首次失败及补验结果须独立保留。

## 2026-10-27 Fresh Reset 冷态发布入口（候选实现，资格以 CURRENT_STATUS 为准）

首次235→239结构切换不先打开新业务Host，也不为保留旧未入藏流程运行加性迁移。仍走标准build/upload/deploy入口；在已完成Runtime安全停机、完整恢复基线及容量清单获准后，使用`deploy-nas.js <tar> --sha256 <digest> --fresh-reset-config <本机配置JSON> --capacity-plan <本机容量JSON>`先dry-run，取得具体发布授权后才加`--apply`。这只部署停止态管理入口，不代表已授权或自动执行Reset。

配置schema为`shelfdeck.reset-configuration@1`，包含明确的`operationRoot`、`backupParent`、`backupSourceOptions`和`storage`；两个作业目录必须互不包含，位于容器`/operator-backups/`下，对应NAS`/vol2/1000/shelfdeck_backups/`中已审查且预先准备的精确目录。标准Compose保留原嵌套备份挂载并增加直接挂载；备份来源必须显式排除旧归档，不能递归备份嵌套备份卷。容量JSON采用`shelfdeck.deployment-capacity@1`，`volumes`精确列出`/vol1`和`/vol2`及十进制字符串`requiredAvailableBytes`；数值来自本次镜像加载、完整备份、数据库新代际及SQLite工作空间峰值，不抵扣尚未执行的删除。首次生产写入Compose/Secret之前先核对空间，Operator预检及每个后续阶段仍独立复核。

部署控制器核对已完成Stop回执、Runtime revision与quiesced活动计数，检查原容器成功退出、无OOM且已移除，再核对全部容器没有其他业务数据挂载。独立冷态程序验证精确源结构、数据库/WAL摘要、停止记录和Platform凭据事实，输出绑定这些证据的管理授权。管理面沿原Runtime预检/一次确认接口，只能Reset，不能Resume或访问业务；普通部署不因schema失败自动启用该模式。确认之后复用同一持久workflow/代际Fence/幂等请求；完成后重开stopped新Host。失败保持停止，不能为了通过health而启动旧任务或跳过源结构校验。

候选命令、配置示例或隔离回归不构成生产删除/停机/Reset授权。容量清理仍须逐项授权；保留原关闭证明、请求、备份和失败阶段，不能在部署中断后猜测状态重造证明。当前版本仍须取得固定候选镜像及生产副本资格后才可使用本流程。

若旧容器已移除、完整冷备已验证，但首次Bootstrap失败且管理容器尚未启动，可在同一标准命令增加`--continue-fresh-reset`，先dry-run再`--apply`。入口只读取原deployment-backup-request/bootstrap-request和验真backup receipt；禁止重造Stop/closure，拒绝旧容器仍存在或任何数据/转码共享挂载。必须保持相同配置、Secret和作业目录，镜像可为已验收修正版；保留原失败资格库，在独立continuation资格路径重新检查。源主库必须与原备份SHA一致，Runtime意图/Stop回执及物理文件集合由镜像再次验证；不覆盖已存在的失败续作、不回退或恢复业务。当前仅覆盖管理容器启动之前的冷态继续，其他阶段仍按各自持久回执处理。

Bootstrap资格必须使用逐字节验真的私有源副本，禁止只读打开原业务SQLite：SQLite只读连接也可能在原目录生成空WAL/SHM。源主库及存在/缺失的WAL物理集合在操作前后严格保持；私有副本和资格库留在vol2作业目录，不把空伴随文件的自动生成当成可忽略漂移。

同一规则覆盖Bootstrap管理面后续的每次Reset预检与确认：显式bootstrapId的冷态预检从验真私有副本读取Owner事实、重建与复核保留集，结束前核对原main/WAL集合严格不变；非空WAL拒绝，不按旧数据特征回落。普通已安全Stop但Host仍持有连接的预检继续使用SQLite一致读事务。成功的资格临时文件仅清理本进程精确路径，失败副本保留证据；副本/retained/SQLite工作量均纳入同一预检卷预算。


## 2026-10-30 US Adult catalogue 239→242 结构切换

当前生产 a2bf / 1.0.0 标记 digest `906ecacce4d6de62e875d1293cec93dd198564c1c53e2f7f7979d75b2eac2d0a`（239表）到 tip / 1.1.0 `572bd48d999c83c86ffd5c2ccc496e7177b14df2edfd09ebcffadf56e2706cb9`（242表）使用候选镜像内`helix-us-adult-catalogue-schema-copy.js`准备独立一致源快照、新库及反向副本，逐行证明238张原事实/执行表保持。仅新增三张空 catalogue 表，并扩展`people_person_revisions.origin_kind` CHECK 允许`catalogue_auto`；不能复用旧`lifecycle-schema-cutover.js`或`formation-retirement-schema-cutover.js`的表数与 digest 常量。

完整停机冷备必须保留main DB及存在的WAL/SHM/journal、全部伴随文件、Compose及Secret；来源和备份逐文件SHA一致。准备目录包含`source.sqlite`、`prepared.sqlite`、`copy-receipt.json`、`rollback-receipt.json`和`source-files.json`。后者使用`shelfdeck.frozen-sqlite-files@1`，记录`source.sqlite`的`snapshotSha256`及原始SQLite物理文件的`name/bytes/sha256`。

使用`scripts/us-adult-catalogue-schema-cutover.js <data-dir> <prepared-dir>`先dry-run，再加`--apply`同卷切换。包装必须确认唯一生产容器已停止、镜像及目录身份精确。工具验证目标/反向证明、原始main/WAL/SHM完整集合和字节；非空WAL保持于`retained-source-wal`，不能仅因它非空而丢弃。持久cutover marker支持保留旧辅助文件后及新库rename后的继续执行。新库准备和切换不执行Reset、不更改媒体；出现 catalogue 新表事实或`catalogue_auto`修订后，旧结构回退必须拒绝，不用冷备覆盖新增事实。本段仅定义结构切换纪律；标准`deploy-nas.js --apply`仍须另行授权。

## 2026-10-25 Plan 合同证据加性切换

采用新镜像中的`helix-plan-contract-schema-copy.js --source <frozen.sqlite> --target <new.sqlite> --source-schema <exact-digest>`，只新增三张证据/审计表及三个Foundation查询索引，231张原事实表逐行核对，禁止改旧约束。`helix-import-plan-contracts.js`只操作持久停止意图的准备副本，临时空Host用于捕获当前合同，目标Kernel只允许读取和追加三张新表；原表前后摘要必须一致。无法验真的历史保留明确持久失败，不增运行兼容白名单。

标准停机、完整冷备和冻结SQLite物理文件集合仍必需；准备目录保存`source.sqlite`、已导入的`prepared.sqlite`、`copy-receipt.json`、导入报告和`shelfdeck.frozen-sqlite-files@1`的`source-files.json`。`helix-plan-contract-cutover.js <data-dir> <prepared-dir>`先dry-run再`--apply`，原表保护及原始main/WAL/SHM/journal全量字节一致才可同卷替换。非空WAL保留，cutover marker支持中断恢复；不执行Reset。NAS离线容器必须将应用共同父目录作为一个bind mount，使data与prepared路径处于同一挂载边界；仅底层设备号相同不足以保证rename，分别bind两目录会被Linux以EXDEV拒绝。若停在qualified marker，先核对原库与准备库SHA未变，再用相同工具重验重试，不手工替换文件。生产启动/Resume必须以同候选完整副本资格为前提。供给恢复后不得用旧冷备覆盖新事实；任何回退先核对原表是否仍等于切换时保护清单。

## 2026-10-23 Formation retirement 结构切换

当前231→232结构使用候选镜像内`helix-formation-retirement-schema-copy.js`准备独立一致源快照、新库及反向副本，逐行证明230张原事实/执行表保持。不能复用旧`lifecycle-schema-cutover.js`的223表与旧digest常量。

完整停机冷备必须保留main DB及存在的WAL/SHM/journal、全部伴随文件、Compose及Secret；来源和备份逐文件SHA一致。准备目录包含`source.sqlite`、`prepared.sqlite`、`copy-receipt.json`、`rollback-receipt.json`和`source-files.json`。后者使用`shelfdeck.frozen-sqlite-files@1`，记录`source.sqlite`的`snapshotSha256`及原始SQLite物理文件的`name/bytes/sha256`；源快照读取前后重新核对冻结文件不变。

使用`scripts/formation-retirement-schema-cutover.js <data-dir> <prepared-dir>`先dry-run，再加`--apply`同卷切换。包装必须确认唯一生产容器已停止、镜像及目录身份精确。工具验证目标/反向证明、原始main/WAL/SHM完整集合和字节；非空WAL保持于`retained-source-wal`，不能仅因它非空而丢弃。持久cutover marker支持保留旧辅助文件后及新库rename后的继续执行。新库准备和切换不执行Reset、不更改媒体。

新镜像以持久停止意图启动，管理接口可用且`normalSupplyAllowed=false`。用户明确授权Reset后经正式Runtime API执行，完成仍停止；不能用历史物理删除CLI替代。发生行政退役、停止态终止Receipt或Series迁移后，旧结构回退必须拒绝，不用冷备覆盖新增事实。本轮停止态资格与通常正常供给资格分别记录，不把停止态PASS称为恢复供给成功。


本文是 ShelfDeck 当前唯一生产部署入口。当前生产部署方式固定为：本机 build image -> 导出 tar -> `upload-nas-image.js` 上传并校验 -> `deploy-nas.js` dry run -> `deploy-nas.js --apply`。Codex 处理任何“上线、部署、升级 NAS、发布 Docker、生产环境”相关任务时，必须先读本文，再读 `scripts/build-image.js`、`scripts/upload-nas-image.js` 和 `scripts/deploy-nas.js`。

UAT-304：标准Compose的`stop_grace_period`为75秒。Service收到停止信号立即停止供给，最多60秒等待执行checkpoint，再回收自身FFmpeg进程；超预算保留未决执行，按既有Effect合同在重启时恢复，不将技术停机记录成媒体加工失败。

## Formation Reset 的备份卷（2026-10-23 新标准，生产采用情况见 CURRENT_STATUS）

新版工作台 Reset 保留历史，并完整备份选中 Workspace；转码/待上架成品可能远大于数据库。NAS 标准 Compose 新增 `/vol2/1000/shelfdeck_backups:/app/data/operator-backups`，与 `/transcode` 分离；不能只按数据库大小判断容量。容量预检只遍历大小，正式备份仍完整核对来源前后及副本 SHA256，空间不足不得开始退役。

部署入口只在固定父根验证后创建精确备份目录。若原 `data/operator-backups` 非空或路径是链接，直接拒绝覆盖挂载；保留旧备份并取得明确的迁移范围后另行处理。该卷必须跨升级/回退保留，停机 Reset 恢复会重新验证它；盘点和恢复清单必须包含这个外部备份卷，不能把单独的 data 冷备称为所有备份均已保存。新增配置不等于已修改当前生产，亦不构成 Reset 或迁移授权。

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
| 成人库挂载 | NAS `/vol02/1000-0-24018892` -> 容器 `/adult_media`；标准部署另提供同目录 `/adult` 挂载，保留现有路径绑定。实际生效版本以当次部署Evidence为准 |
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

当旧生产镜像中的Reset工具缺少已验证修复时，标准`formation-reset-nas.js`可用`--reset-image-id sha256:<完整镜像ID>`指定已验收候选的离线工具。必须同时指定`--keep-stopped`和非空`--subject-ids`；包装核对本机镜像ID，仍执行停服、完整备份、plan/apply/plan。该选项不部署镜像，不扩大清理授权；后续仍走标准deploy入口。

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

仅 Service 源码变化时可使用 `build-image.js <tag> --reuse-runtime <exact-image> <source-commit> <image-id>`。
脚本核对镜像身份、依赖锁文件、Git 差异及完整 canonical COPY；依赖、Web、Dockerfile变化或删除 Service文件均拒绝复用。
相同目录内未改名的文件 COPY 合并为单层，目录 COPY 保留原目标，避免逐文件层数累积导致 `max depth exceeded`；不改变源文件覆盖范围。
本机 Docker engine 不可用时，可由本机脚本通过统一 SSH 配置建立仅 loopback 的临时 Docker socket 转发，使用 NAS daemon 构建和本机导出 tar；结束后关闭转发，不向 LAN 暴露 Docker API，不跳过后续上传、checksum、副本门禁与标准 deploy。

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

完整Host还应覆盖ready之后至少一轮正常Owner/Intake reconciliation，并核对当前未终结业务是否仍读取旧成功Evidence；不能因Supporting Work已经terminal就推断该Result可供新合同继续消费。UAT-125/250上线后旧pre-Subject占位的实际教训与精确副本验证见[286发布记录](../helix/implementation/evidence/UAT_RELEASE_286FE56F1E_20260912.md#上线后存量接收阻碍)。有需清理的旧条目时先冻结当前范围并演练，再按具体生产数据授权处理，不用上线后反复Reset代替这项检查。

2026-10-21 生命周期 schema 升级仅增加 `libra_task_cancellations`，使用候选镜像内 `scripts/helix-lifecycle-schema-copy.js`，逐表证明其余223张业务表全部列/行保持。完整副本资格通过后，先通过 Runtime stop 完成安全停止，再停止唯一生产容器、保存完整冷备，生成 `source.sqlite`、`prepared.sqlite`、`copy-receipt.json` 及逆向复制的 `rollback-receipt.json`。仓库 `scripts/lifecycle-schema-cutover.js <data-dir> <prepared-dir>` 先 dry run，核对来源未漂移与同卷条件；加 `--apply` 原子安装，保留来源及冷备，随后仍执行标准 deploy。离线容器通过 `SHELFDECK_SERVICE_ROOT=/app` 使用精确镜像依赖，并挂载应用父目录，避免跨 bind mount rename。该流程不授权 Reset。逆向复制必须基于当前最新事实；已有取消意图时明确拒绝旧版回退，不能覆盖回冷备丢掉新增事实。

readiness副本捕获不得向只读生产来源创建SQLite辅助文件。来源含WAL/SHM时通过SQLite backup读取已提交快照；两者均不存在时，将独立数据库复制到可写检查目录，校验来源/副本SHA256及来源size/mtime/ctime不变，并再次确认没有出现WAL/SHM，漂移报READINESS_SOURCE_CHANGED。该捕获步骤不代替后续readiness内完整性/合同检查，也不构成完整Host演练通过。

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
- 部署负责人在 apply 前单独创建并校验完整 Helix data、compose 和 secret 备份，包括 SQLite 一致副本及全部伴随文件；不要只备份历史 v3 文件名。当前 `deploy-nas.js` 普通升级本身不创建完整备份，必须保存独立备份 receipt 后再 apply。
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

镜像回退必须用候选运行后的同一份数据验证完整 Host，不以“仅新增 columns”推断兼容。UAT-251/261 联合版本为197表/d8，旧cd4f的189表/d2镜像不能直接回退；已验证的同格式备用版本及其精确SHA256见本次发布Evidence。切换备用镜像仍使用上述标准dry-run/apply，保留升级后的数据和媒体事实。备用版本对哪些问题有效应按实际diff和验证说明，不能宣称能撤销所有新功能。

升级前完整备份是事故恢复材料。若升级后已经发生媒体处置、接收或收藏提交，不得因为旧镜像无法启动就直接覆盖旧DB；必须先保留新现场，核对数据库与当前物理事实的一致性，并按精确生产数据恢复范围取得授权。


### UAT-251/274 历史合同发布门禁与回退（2026-09-28）

当前完整历史启动可能超过3分钟，标准部署health轮询上限调整为180次，间隔5秒、单次HTTP上限5秒；不得在旧3分钟阈值误判后反复重启。完整副本Host通过仍是apply前置条件。

secondary_target结构发布的离线回退由`media-service/src/helix/foundation/persistence/secondary-target-schema-rollback.js`提供`rollbackSecondaryTargetSchema({Database,databasePath,baselinePath,apply})`。仅在服务已停止、使用经校验的完整升级前副本时调用；默认dry run。它验证精确新旧schema/实际DDL、197表集合、全部业务表逐行比对与FK；只有全部事实等于升级前基线才原子还原原CHECK、索引及对应marker，业务行始终保留。任何新Revision、Work、Result或其他事实变化均拒绝，不能覆盖恢复来绕过。正常供给产生新事实后应保留当前数据并向前修复；若确需备份覆盖恢复须另行明确范围及授权。本轮没有授权重置生产，也不修复旧已瑕疵上架条目。


### UAT-326/327/328 候选的结构复制（2026-10-22，尚未发布）

225表`b8c36a0bfc04e7789ca1e49e2639a749c1fe90b52cb80a8a6bb8ecf9b592232b`到231表`4549671e37bedb285feb0bb6dc08d9e431aa040136bd9ee668de248a2f0782a6`使用候选镜像内`node scripts/helix-series-presentation-schema-copy.js --source <standalone-snapshot> --target <new-prepared-snapshot>`。原225表除schema marker外224张业务表全部原列/原行必须逐表摘要相同；新增六张Arca共享表、共享健康head/Off-deck共享范围/Procurement只读来源共五列，327的完整local_media_group CHECK取值扩展保持1024上限。此工具只准备独立副本，无in-place或Reset，既有Formation不获得兼容权益。

未产生任何新增Owner/来源/健康/分组事实时可加`--rollback`准备逆向副本；已经有新事实则明确拒绝丢数据回退，只能修复前进。结构复制成功不等于完整Host启动/原任务恢复资格。上线仍需完整生产副本、精确镜像UI与Gate、Runtime安全停机和完整冷备，再通过既有cutover/标准deploy完成，不直接SQL或替换旧输入摘要。旧剧根内容补齐是独立的Arca维护数据动作，须先列精确预览，不随代码部署自动补写历史收藏。


### 标准镜像层数预算（2026-10-27）

`build-image.js` 从 canonical Dockerfile 生成构建用 recipe，仅合并同一连续 COPY 区间内的同目标目录文件，不跨 RUN 或 COPY --from 等构建边界。Dockerfile 继续保留精确源文件清单；生成 recipe 留在 dist-image，不提交。镜像导出前要求 RootFS 层数不超过 96，为 NAS overlay2 与容器可写层预留空间。Docker Desktop 构建/运行通过不能替代 NAS 实际装载资格；127 层候选的 max depth exceeded 首跑必须保留，禁止用全局 prune 清理或削弱应用文件清单绕过。


### Fresh Reset 发布前恢复基线（2026-10-27）

People保留依赖纠正沿用标准build/upload/deploy入口：在正常停止证明与全量当前备份的基础上，显式提供 `--recover-people-references <scope.json>`、`--fresh-reset-config <job.json>`、SHA及两卷容量计划。此模式保留Runtime Reset配置但不创建另一轮Bootstrap/Reset，补回登记在完整隔离库通过真实People端口和全库事实保护核验后才原子发布。原档案必须绑定现有完成Reset回执，scope限定精确缺失Handle集合、数量和参考事实摘要；不能覆盖已存在的不同登记。切换前后的持久阶段和原库副本保留，`--continue-people-reference-recovery`只能复用原关闭/备份/请求，不补造新Stop或丢弃新任务。任何阶段失败不启动业务；成功先以stopped Host核验，再按用户授权Resume。该纠正不重写旧Reset回执，不迁移媒体、不重新选图或清除本轮新采购。

`--fresh-reset-config` 明确要求完成 Runtime Stop，独占 data 与 transcode 挂载、退出并移除旧容器后，以只读源挂载运行 `formation-reset-deployment-backup.js`。配置需列出 `/app/data`、`/transcode` 两个来源，历史档案排除必须有审阅 inventory digest。原 Compose、secret.env 及存在的 reset-config.json 精确暂存并加入完整校验备份；不扫描整个 Compose 父目录，不打印密钥。确认备份 receipt 后才覆盖线上配置、准备冷态管理入口；失败保持停止、原配置不发布。部署前恢复基线和 Reset 自身备份位于各自独立目标，均不可递归包含旧备份。

容量计划必须包含两次完整备份、数据库重建/资格副本、镜像装载与按卷余量。部署前容量检查不计未获准删除的空间；停止后仍需 Reset 预检按实际大小重算。当前仅完成隔离资格不授权生产操作。若部署准备在旧容器移除后中断，保留 closure/request/manifest/partial 文件及原配置，按具体阶段核验后继续或申请恢复；不能自动重启旧业务服务，也不能用重跑覆盖失败现场。
