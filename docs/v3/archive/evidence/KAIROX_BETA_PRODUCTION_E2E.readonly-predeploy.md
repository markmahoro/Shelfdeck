# Kairox Beta Production E2E

> 本文件由 `media-service/scripts/kairox-beta-production-e2e.js` 生成或补充。破坏性验收只能使用本次明确授权的 E2E 白名单库，不能扩散到其他生产库。

## Run Metadata

- 时间: 2026-07-01T21:43:44.879Z
- 目标: `http://192.168.12.230:18080`
- 镜像: 待填写
- 备份 manifest: 待填写
- Canary item: 未提供
- Destructive E2E library: 公共 国产剧库

## API Timing

| Name | Route | Status | ms | Result | Error |
| --- | --- | ---: | ---: | --- | --- |
| health | /v1/health | 200 | 29 | PASS |  |
| dashboardHealth | /v1/admin/dashboard/health | 200 | 36 | PASS |  |
| library | /v1/library?page=1&pageSize=20 | 200 | 16 | PASS |  |
| tasks | /v1/tasks?activeOnly=1 | 200 | 3 | PASS |  |
| adminTasksOptimizeDelete | /v1/admin/tasks?targetGate=optimize&selectedFlow=delete&page=1&pageSize=20 | 200 | 3 | PASS |  |
| deleteCandidates | /v1/admin/delete-candidates | 200 | 309 | PASS |  |
| config | /v1/config | 200 | 3 | PASS |  |

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
| 1 Basic Navigation | Dashboard / 媒体库 / 任务中心 / 归档前目标 / 处置队列均可打开，无全页崩溃 | TODO |  |
| 2 Metadata vs Perception | 无评分 canary 不因评分缺失卡 metadata gate；需要评分时显示 pending_perception | TODO |  |
| 3 Perception Revision | 修改 canary 评分后 perceptionVersion 增加，objectiveVersion/hash 按目标变化 | TODO |  |
| 4 Optimize TargetGate | 需要本地转换时任务为 targetGate=optimize，flow selection 为 transcode | TODO |  |
| 5 Transcode Objective Verify | 转码完成后 optimize gate facts 携带 objectiveHash，生命周期进入 archive ready | TODO |  |
| 6 Archive Gate | archive task 为 targetGate=archive，archive facts/history 存在 | TODO |  |
| 7 Delete Candidate Review | 低评分 archived canary 进入处置队列，未确认前无 delete task | TODO |  |
| 8 Confirmed Delete | 确认后创建 targetGate=delete task；delete gate facts 写入，archive facts 保留 | TODO |  |
| 9 No Legacy Regression | 无 optimize.delete 新事件/任务，无 remove_media 新 objective | TODO |  |
| 10 Control Plane Smoke | 后台任务运行时页面和热路径 API 保持秒级 | TODO |  |

## Rollback Notes

- 如 cutover apply 已执行，优先使用 cutover manifest 中的备份路径恢复数据。
- 回滚前记录当前镜像、容器状态、`/v1/health`、任务列表和最新错误事件。
