# Kairox Beta Production E2E

> 本文件由 `media-service/scripts/kairox-beta-production-e2e.js` 生成或补充。破坏性验收只能使用本次明确授权的 E2E 白名单库，不能扩散到其他生产库。

## Run Metadata

- 时间: 2026-07-01T22:01:54.245Z
- 目标: `http://192.168.12.230:18080`
- 镜像: `markmahoro/shelfdeck:kairox-beta-itemfacts-20260702-055519`
- 备份 manifest: `/app/data/kairox-beta-cutover-2026-07-01T21-45-51-630Z.manifest.json`
- Canary item: `99215` optimize verification; `90921` archive/delete destructive verification
- Destructive E2E library: 公共 国产剧库

## API Timing

| Name | Route | Status | ms | Result | Error |
| --- | --- | ---: | ---: | --- | --- |
| health | /v1/health | 200 | 28 | PASS |  |
| dashboardHealth | /v1/admin/dashboard/health | 200 | 31 | PASS |  |
| library | /v1/library?page=1&pageSize=20 | 200 | 11 | PASS |  |
| tasks | /v1/tasks?activeOnly=1 | 200 | 3 | PASS |  |
| adminTasksOptimizeDelete | /v1/admin/tasks?targetGate=optimize&selectedFlow=delete&page=1&pageSize=20 | 200 | 4 | PASS |  |
| deleteCandidates | /v1/admin/delete-candidates | 200 | 312 | PASS |  |
| config | /v1/config | 200 | 4 | PASS |  |

## Automated Checks

| ID | Check | Result | Detail |
| --- | --- | --- | --- |
| api_hot_paths_ok | API hot paths return successfully | PASS | {"failedRoutes":[]} |
| api_hot_paths_seconds_level | API hot paths are seconds-level | PASS | {"slowRoutes":[]} |
| optimize_operations_no_delete | optimizeAllowedOperations does not contain delete | PASS | {"optimizeAllowedOperations":["transcode"]} |
| automatic_targets_can_express_delete | automaticTaskTargets may express delete independently | PASS | {"automaticTaskTargets":["ingest","metadata","optimize"],"smartTaskEnabledActions":["ingest","scrape","transcode"]} |
| no_active_optimize_delete_task | No active targetGate=optimize task uses delete operation | PASS | {"count":0} |
| no_remove_media_task_objective | No active task uses remove_media objective | PASS | {"count":0} |
| no_action_type_projection | Task API does not expose actionType compatibility fields | PASS | {"count":0} |

## Manual User-View E2E

| Case | 用户视角证明 | Result | Notes |
| --- | --- | --- | --- |
| 1 Basic Navigation | Dashboard / 媒体库 / 任务中心 / 归档前目标 / 处置队列均可打开，无全页崩溃 | PASS | Browser smoke: `/`, `/media`, `/tasks`, `/rules`, `/delete-candidates` 均有 root 内容，控制台无 critical error。 |
| 2 Metadata vs Perception | 无评分 canary 不因评分缺失卡 metadata gate；需要评分时显示 pending_perception | PASS | 公共国产剧库 47 个条目 metadata incomplete 为 0；metadata missing reasons 不包含 `decision.*`、`userRating`、`doubanRating`、`watched`。 |
| 3 Perception Revision | 修改 canary 评分后 perceptionVersion 增加，objectiveVersion/hash 按目标变化 | PASS | `90921` 通过评分 API 设置 `userRating=1`，`userPerceptionFacts.rating=1`，`perceptionVersion=2`。 |
| 4 Optimize TargetGate | 需要本地转换时任务为 targetGate=optimize，flow selection 为 transcode | PASS | `99215` 创建任务 `68ebb4fb2efa32e2`，`taskTarget.targetGate=optimize`，`gateObjective.targetBitrate=7/targetCodec=h265`，`flowSelection.selectedOperation=transcode`，验证后暂停并删除测试任务。 |
| 5 Transcode Objective Verify | 转码完成后 optimize gate facts 携带 objectiveHash，生命周期进入 archive ready | PARTIAL | 生产条目为 36GB，未等待完整转码；已验证 objective-aware flow selection、target facts、current facts 和任务执行启动。完整转码完成验收仍建议使用更小 fixture。 |
| 6 Archive Gate | archive task 为 targetGate=archive，archive facts/history 存在 | PASS | `90921` 创建 archive task `bdb6af4562cab879`，`targetGate=archive`，`flowDirection=archive.finalize`，完成后 `lifecycleStage=archived`、`archiveStatus=archived_like`。 |
| 7 Delete Candidate Review | 低评分 archived canary 进入处置队列，未确认前无 delete task | PASS | 启用测试库专用 delete policy 后，`90921` 进入 `pending_review`，命中规则 `kairox-beta-e2e-public-chn`；候选确认前没有 delete task。 |
| 8 Confirmed Delete | 确认后创建 targetGate=delete task；delete gate facts 写入，archive facts 保留 | PASS | 确认候选创建 delete task `8f2cf433ae2160c2`，`targetGate=delete`，`flowDirection=delete.execute`；任务先停在 `delete.beforeExecute`，用户确认后执行完成，`deleteGate.passed=true`，`archiveStatus=archived_like` 保留。 |
| 9 No Legacy Regression | 无 optimize.delete 新事件/任务，无 remove_media 新 objective | PASS | 自动脚本和 API 复核均通过：active optimize-delete 数量 0，delete task 事件中 `optimize.delete` 数量 0，Task API 不暴露 `actionType`。 |
| 10 Control Plane Smoke | 后台任务运行时页面和热路径 API 保持秒级 | PASS | `/v1/health` 28ms，dashboard health 31ms，library 11ms，active tasks 3ms，config 4ms；delete candidates 312ms。 |

## Production Findings

- 本次生产 E2E 发现并修复 `flowPlanner.planFlow()` 未接收 `taskTarget.gateObjective` 的问题；修复后手动 optimize task 可以用 gate objective 正确选择 transcode。
- 本次生产 E2E 发现并修复手动创建 optimize task 时 `itemInfo` 缺少 codec facts 的问题；修复后 `flowSelection.currentFacts.codec=h265`，不再误判为 `facts_missing`。
- 公共国产剧库原绑定 `chn_series` 模板，模板条件包含 `bucket/equivalentBitrate` 等 media facts，会干扰 Kairox perception-condition 验证；本次 E2E 已将该库切到 `tv_default` 并重算 47 个目标。
- 处置队列页面会显示已删除候选并仍露出操作按钮，这是 UI/文案层残留；后端 API、task target、flow direction 和 gate facts 语义已经通过。

## Rollback Notes

- 如 cutover apply 已执行，优先使用 cutover manifest 中的备份路径恢复数据。
- 回滚前记录当前镜像、容器状态、`/v1/health`、任务列表和最新错误事件。
