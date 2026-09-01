# DEBUG_WORKFLOW - 排查工作流

排查目标是找到根因并修复，不做绕过、兜底或降级。

## 1. 必读文件

排查任何 runtime 问题前，先读：

1. `tests/TEST_ENV_CHECKLIST.md` - NAS SSH、Emby API Key、MoviePilot token、测试库和影片清单。
2. `docs/v2/DEBUG_WORKFLOW.md` - 本文。

`tests/TEST_ENV_CHECKLIST.md` 含凭据，已在 `.gitignore` 中，不提交。

## 2. 诊断层级

### Layer 1 - ShelfDeck API

| 端点 | 用途 |
| --- | --- |
| `GET /v1/health` | 服务存活和总体状态 |
| `GET /v1/admin/health` | scheduler/emby/transcode/upgrade 等模块状态 |
| `GET /v1/library/status` | 子库刷新和同步状态 |
| `GET /v1/library?subLibraryId=X` | 媒体库内容、action、评分 |
| `GET /v1/admin/sublibraries` | 子库配置、pathMap、sectionId、embyServerId |
| `GET /v1/tasks` | 活跃任务 |
| `GET /v1/admin/tasks/:id` | 单任务详情和日志 |
| `GET /v1/activity-log` | 最近活动 |
| `GET /v1/config` | 配置，敏感字段可能被掩码 |

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

Common remote checks:

```bash
docker ps
docker logs shelfdeck 2>&1 | tail -80
docker exec shelfdeck cat /app/data/config.json
docker exec shelfdeck ls /media/test/
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
已Commit物料重叠的闭环必须报告并保护。禁止仅因Libra领域根已被旧Reset删除就把Procurement闭环误判为正常。

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

NAS包装会解析当前精确镜像、只停止ShelfDeck服务、在应用目录下创建并校验完整data备份、离线执行Reset、重复plan验证幂等，
然后启动服务并对连接重置等瞬时启动错误进行有界health重试。任一步骤失败都停止继续执行；apply失败时ShelfDeck可能保持停止，必须先保留现场并按脚本输出的
`/vol1/1000/docker/shelfdeck/backups/formation-reset-*/data`恢复，禁止手工补SQL。

## 5. 排查后必须产出

- 根因：一句话说明真正原因。
- 修复：代码、配置或环境动作。
- 验证：列出实际运行的命令和覆盖范围。
- 文档：如果影响架构或流程，更新 `ARCH_OVERVIEW.md`、`DEVELOPMENT_WORKFLOW.md` 或 `TEST_ARCHITECTURE.md`。
