# DEBUG_WORKFLOW - 排查工作流

排查目标是找到根因并修复，不做绕过、兜底或降级。

## 1. 必读文件与当前拓扑

排查任何 runtime 问题前，先读：

1. `docs/v2/DEBUG_WORKFLOW.md` - 本文。
2. `tests/TEST_ENV_CHECKLIST.md`（可选、已 gitignore，含凭据，不得提交或泄露；若本机不存在该文件，**不要扫描局域网 IP**，直接使用 `tools/nas-ssh-config.js` 默认生产连接：`heavy` `192.168.12.215`、用户 `gezhu`、私钥 `~/.ssh/shelfdeck-gezhu2403`）。

当前生产拓扑速查（旧飞牛 NAS `192.168.12.230` 已退役，禁止当作在线生产排查）：

| 角色 | 地址 / 路径 | 说明 |
| --- | --- | --- |
| 生产主服务 (`heavy`) | `http://192.168.12.215:18080` | Debian 12 Docker 容器 `shelfdeck`；NVIDIA Quadro T2000 (`TU117` NVENC) |
| SSD 应用与主库 | `/srv/apps/shelfdeck/data/shelfdeck.db` (`/dev/sdb1`) | 容器内挂载为 `/app/data` |
| HDD 转码与备份 | `/srv/shelfdeck/transcode`、`/srv/shelfdeck/operator-backups` (`/dev/sdc1`) | 容器内 `/transcode` 与 `/app/data/operator-backups` |
| 外部存储挂载 | `/media` (`192.168.12.45/Media` CIFS)、`/adult` (`192.168.12.45/Adult` CIFS)、`/mnt/shelfdeck_upgrade` (`192.168.12.218` NFSv4) | 容器内 `/media`、`/adult`（含 `/adult_media`）、`/upgrade` |
| 外部上游 | HTTP 代理 `http://192.168.12.219:7890`；MoviePilot `http://192.168.12.217:3000` | `network-main`、`tmdb-main` 及活跃 `jav-*` 均走 `.219:7890` |
| CPU 验证 VM (`worker`) | `192.168.12.216`（用户 `gezhu`） | 仅用于隔离 `/tmp` worktree 跑单测/E2E（无 GPU、无 Docker） |

## 2. 诊断层级

### Layer 1 - Clean Helix Runtime（当前现网）

优先使用只读脚本与 Clean Helix Admin API，禁止向运行中的 `shelfdeck.db` 写入或创建额外 WAL/SHM：

| 入口 | 用途 |
| --- | --- |
| `GET /v1/health` | 公开存活与供给开关（`status`、`generation`、`normalSupplyAllowed`） |
| `GET /v1/admin/runtime` | Runtime 模式（`running`/`stopped`）、revision、在飞活动计数 |
| `GET /v1/admin/formation` | 当前整理工作区条目状态、Attention 与运行投影 |
| `GET /v1/admin/care` | 照看 / 异常与恢复状态 |
| `node scripts/production-readonly-diagnostics.js` | 只读汇总容器、SSD/HDD 空间、DB 大小与聚合计数 |
| `node scripts/formation-active-production-diagnostics.js` | 只读诊断当前整理工作区在飞任务、Effect 与源文件状态 |
| `node scripts/production-helix-execution-diagnostics.js` | 只读诊断 Execution Foundation 残留与 `/srv/shelfdeck/transcode` 存储 |
| 容器内只读 SQLite 查询 | `new Database('/app/data/shelfdeck.db', { readonly: true, fileMustExist: true })` + `db.pragma('query_only = ON')` |

### 历史 v2/v3 ShelfDeck API（Clean Helix 已废弃，仅留作兼容参考）

> 注意：以下端点（`/v1/admin/health`、`/v1/tasks`、`/v1/config`）以及 `/app/data/config.json` 属于历史 v2/v3 架构，Clean Helix 现网不存在。

| 端点 | 用途 |
| --- | --- |
| `GET /v1/health` | 服务存活和总体状态 |
| `GET /v1/admin/health` | scheduler/emby/transcode/upgrade 等模块状态（历史） |
| `GET /v1/library/status` | 子库刷新和同步状态 |
| `GET /v1/library?subLibraryId=X` | 媒体库内容、action、评分 |
| `GET /v1/admin/sublibraries` | 子库配置、pathMap、sectionId、embyServerId |
| `GET /v1/tasks` | 活跃任务（历史） |
| `GET /v1/admin/tasks/:id` | 单任务详情和日志（历史） |
| `GET /v1/activity-log` | 最近活动 |
| `GET /v1/config` | 配置，敏感字段可能被掩码（历史） |

### Layer 2 - Emby API

| 端点 | 用途 |
| --- | --- |
| `/System/Info?api_key=X` | Emby 基础信息 |
| `/Library/VirtualFolders?api_key=X` | section 和 Locations |
| `/Library/MediaFolders?api_key=X` | 媒体库配置和 TypeOptions |
| `/Users/:uid/Items?...&api_key=X` | 验证 Emby 是否扫描到媒体 |
| `/ScheduledTasks?api_key=X` | 扫描任务状态 |

### Layer 3 - MoviePilot API

| 端点 | 用途 |
| --- | --- |
| `/api/v1/download/?token=X` | 连通性和下载列表 |
| `/api/v1/search/title?keyword=X&token=X` | 搜索种子 |
| `/api/v1/history/transfer?token=X` | 刮削历史 |

### Layer 4 - SSH / Docker

Use:

```bash
node tools/ssh-exec.js "<cmd>"
```

Common remote checks (`heavy` `192.168.12.215`):

```bash
docker ps
docker logs shelfdeck 2>&1 | tail -80
docker exec shelfdeck ls /media/ /adult/
```

## 3. 常见决策树

### 子库刷新无数据

1. `GET /v1/admin/sublibraries` - 确认 subLibrary、sectionId、pathMap、embyServerId。
2. Emby `/Library/VirtualFolders` - 确认 section 和 Locations。
3. Emby `/Users/:uid/Items` - 确认 Emby 本身是否有电影。
4. Docker `ls /media/test/` - 确认容器挂载。
5. `POST /v1/library/actions/refresh` - 手动刷新后复查。

常见根因：Emby Movie `TypeOptions` 的 `MetadataFetcherOrder` / `ImageFetcherOrder` 为空，导致 Emby 没识别电影。

### 任务卡在 created

1. `GET /v1/admin/health` 看 scheduler。
2. `GET /v1/tasks` 看并发和活跃任务。
3. `GET /v1/config` 看 `executionMode`。
4. 检查同一 `itemId` 是否已有活跃任务。
5. 检查 SmartTaskEngine 是否重复入队或被禁用。

### 升级流程失败

1. MoviePilot download endpoint 连通性。
2. MoviePilot title search 是否有结果。
3. 下载列表状态。
4. transfer history 是否完成刮削。
5. 任务日志里确认 stage 和外部错误。

### 转码失败

1. `GET /v1/admin/health` 看 FFmpeg。
2. 检查 `FFMPEG_PATH` / `FFPROBE_PATH`。
3. 检查编码设备配置和 busy 状态。
4. 查任务日志和 ffprobe 输出。

## 4. Formation Reset 调试能力

当前Helix迭代阶段不为既有、未完成Arca On-deck Commit的Formation条目增加兼容、迁移、恢复或fallback代码。
版本迭代需要清理旧整理现场时，使用唯一脚本`media-service/scripts/helix-formation-reset.js`。Formation Reset物理删除
未完成On-deck Commit的Intake→Libra→Arca业务图和Execution Foundation执行图，使其在当前数据库中视同未发生；
不保留`normal|nuclear`模式或旧确认串。

Reset以`arca_ondeck_commit_receipts`为保护线，不删除已Commit的Shelf Entry或Deck Fact，不挂载或修改`/media`，也不主动
触发Observation/Intake。目标Workspace先在同一`/transcode`文件系统内原子staging；数据库事务和独立postcondition通过后
才删除，失败则恢复原目录。其他目录保留。

Discovery必须同时从Formation领域根向下闭包，并反向查找“Procurement Delivery已经accepted/rejected、但不存在完全匹配的
Libra Handoff A Receipt”的闭环残留。未与任何Arca Commit物料链重叠的残留Delivery/Reservation进入Reset并重新打开；存在
已Commit物料重叠的闭环必须报告并保护。同一Material存在多代闭环时，只重新打开最新且不与现有active Procurement
Reservation重叠的一代；旧代作为被新Reservation取代的Procurement历史保留，禁止同时恢复为多个active Reservation。
禁止仅因Libra领域根已被旧Reset删除就把Procurement闭环误判为正常。

本地或disposable fixture先执行plan：

```powershell
node media-service/scripts/helix-formation-reset.js --data-dir <data-dir> --transcode-dir <transcode-root>
```

直接apply要求服务已经停止，并显式提供offline确认和唯一确认词：

```powershell
node media-service/scripts/helix-formation-reset.js --data-dir <data-dir> --transcode-dir <transcode-root> --apply --offline-confirmed --confirm FORMATION_RESET_V2
```

生产NAS只允许使用`scripts/formation-reset-nas.js`，且当前Running image必须已经包含
`media-service/scripts/helix-formation-reset.js`；实际部署状态以`docs/helix/CURRENT_STATUS.md`为准。默认命令是只读plan：

```powershell
node scripts/formation-reset-nas.js
```

用户明确授权该次生产Reset后才允许apply：

```powershell
node scripts/formation-reset-nas.js --apply --confirm FORMATION_RESET_V2
```

NAS包装会解析当前精确镜像、只停止ShelfDeck服务、在应用备份目录下创建并校验完整data备份、离线执行Reset、重复plan验证幂等，
然后启动服务并对连接重置等瞬时启动错误进行有界health重试。任一步骤失败都停止继续执行；apply失败时ShelfDeck可能保持停止，必须先保留现场并按脚本输出的
`/srv/shelfdeck/operator-backups/formation-reset-*/data`恢复，禁止手工补SQL。

## 5. 排查后必须产出

- 根因：一句话说明真正原因。
- 修复：代码、配置或环境动作。
- 验证：列出实际运行的命令和覆盖范围。
- 文档：如果影响架构或流程，更新 `ARCH_OVERVIEW.md`、`DEVELOPMENT_WORKFLOW.md` 或 `TEST_ARCHITECTURE.md`。
