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

## Helix 验证入口

- `media-service/test/helix-full-auto-e2e.test.js`：disposable auto/auto onboarding 到 `maintenanceComplete`。
- `media-service/test/maintenance-run-priority.test.js`：Maintenance Run、MediaItem Priority、Runner/Scheduler ordering。
- `media-service/test/helix-resource-governor.test.js`：capacity、bounded queue、control liveness 与 expedited waiter。
- `media-service/web/e2e/admin-shell.spec.ts`：八个产品页面、四个 viewport 与 Axe。
- `tests/runner.sh health-check` 只保留为部署 smoke；旧 task-crud/config-roundtrip/delete target flow 不属于 Helix clean runtime 验收。

报告测试结果时说明实际运行的命令和覆盖范围。

## 任务模型专项

任务调度改动必须覆盖：

- `Maintenance Run`：auto/manual 启动互斥、每个 playable MediaItem 最多一个 open Run、跨 Gate 自动推进、incident/restart/offboarding/terminal failure 恢复。
- `MediaItem Priority`：canonical `normal|expedited`、revision、Run 完成自动清除；Runner、Scheduler、Governor 各自严格 expedited-first，同档再使用局部优先级、aging 与 FIFO。
- `TaskAdmission / Task Creator`：只接收 Lifecycle 选出的 `basedata|metadata|optimize`；active task 去重、generation fencing、自动失败阻断与 approval safety。
- `PriorityEngine`：只计算同一 MediaItem priority class 内的 task-local priority；Run 来源不得形成手工任务加权，用户不得调整 Task priority。
- `approvalPolicy`：全局/子库/任务级覆盖，以及 `forceConfirm` 不可降级。
- `TaskStore`：旧 `tasks.json` 迁移到 SQLite 后必须保留历史；调度热路径只能读取 active task；任务中心分页和 summary 不能丢失完成/失败记录。
- 成人库：Nexora folder observation 建立 SourceBinding，Libra admission 后才允许 Kairox Metadata Run；不得创建 ingest Task。
- 启动恢复：Libra durable work、Kairox Run/Task 和 source fencing 必须从持久化事实恢复；Governor permit 不持久化。
- 前端：`npm run build:web` 验证任务调度页、任务中心和审批字段类型。
