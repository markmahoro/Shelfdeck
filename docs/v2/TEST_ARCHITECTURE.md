# TEST_ARCHITECTURE - 测试入口

## 常用命令

```bash
cd media-service && npm test
cd media-service && node --test test/task-model.test.js test/priority-engine.test.js
cd media-service && npm run build:web
cd media-desktop && npm test
bash tests/runner.sh health-check tests/env/ci.env
bash tests/runner.sh all tests/env/docker-fn.env
```

## 环境

| 环境 | 覆盖 | 说明 |
| --- | --- | --- |
| local Windows | service Windows + desktop | `http://127.0.0.1:18080` |
| NAS Docker | service Docker + 外部依赖 | `http://192.168.12.230:18080` |
| transcode node | remote FFmpeg/GPU worker | 默认 `http://<node>:19000` |
| CI | 无外部依赖 smoke | GitHub Actions |

私有凭据在 `tests/TEST_ENV_CHECKLIST.md`，不提交。

## Flow 脚本

| Flow | Script | 依赖 |
| --- | --- | --- |
| health-check | `tests/flows/test-health-check.sh` | 无 |
| task-crud | `tests/flows/test-task-crud.sh` | 无 |
| config-roundtrip | `tests/flows/test-config-roundtrip.sh` | 无 |
| delete-flow | `tests/flows/test-delete-flow.sh` | 真实媒体 |
| transcode-flow | `tests/flows/test-transcode-flow.sh` | FFmpeg/GPU/真实媒体 |
| upgrade-flow | `tests/flows/test-upgrade-flow.sh` | MoviePilot/Emby/真实媒体 |
| media-library-flow | `tests/flows/test-media-library-flow.sh` | Emby/Douban |

报告测试结果时说明实际运行的命令和覆盖范围。

## 任务模型专项

任务调度改动必须覆盖：

- `TaskAdmission`：自动/手动来源、`smartTaskEnabledActions` 全局自动入队 allow-list、active task 去重、失败冷却、按 `actionType` 的自动队列上限、已成功转码不重复自动转码；子库 `automationMode` 只决定已创建任务是自动进入队列还是待手动启动。
- `PriorityEngine`：任务类型权重、子库权重、规则叠加、手动任务基准和用户手动 priority 调整。
- `approvalPolicy`：全局/子库/任务级覆盖，以及 `forceConfirm` 不可降级。
- `TaskStore`：旧 `tasks.json` 迁移到 SQLite 后必须保留历史；调度热路径只能读取 active task；任务中心分页和 summary 不能丢失完成/失败记录。
- 成人库 `ingest`：目录级 scan/watch 不再创建任务；单 item `ingest` 完成后才允许后续 `scrape` 按统一 admission 入队。
- 启动保护：普通媒体库启动刷新、字段自算和 `SmartTaskEngine` 首扫必须可延迟/可关闭，且 `stop()` 能取消尚未触发的启动定时器。
- 前端：`npm run build:web` 验证任务调度页、任务中心和审批字段类型。
