# TEST_ARCHITECTURE - 测试入口

## 常用命令

```bash
# Windows 工作站（Node 22.23.5 LTS；.worktrees/<slug> 通过 mklink /J 复用 media-service/web/tools node_modules，严禁拉起 Docker Desktop 跑单测）
node --test media-service/test/formation-reset-nas.test.js media-service/test/production-deploy-contract.test.js tests/nas-reset-bootstrap.test.js
cd media-service && node --test test/<target>.test.js
cd media-service && npm run build:web

# worker VM（192.168.12.216，在 /tmp detached worktree 中运行全量 helix-architecture / usearch / POSIX / Linux E2E 测试）
cd /tmp/sd-verify-<slug>/media-service
npm run test:helix-architecture
npm run test:helix-runtime
npm run test:us-adult-full-e2e
bash tests/runner.sh health-check tests/env/ci.env

# heavy 隔离 GPU/Docker 副本（192.168.12.215，--runtime=nvidia，/tmp 一次性目录）
docker run --rm --runtime=nvidia -e NVIDIA_VISIBLE_DEVICES=all -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility markmahoro/shelfdeck:<tag> node --test test/clean-ffmpeg-pipeline.test.js
```

## 环境

| 环境 | 覆盖 | 说明 |
| --- | --- | --- |
| Windows 工作站 | 代码编辑、`.worktrees/*`、纯 JS 契约、定向单测 / SQLite / sharp / `build:web` | Node `22.23.5 LTS`（`--ignore-scripts` + 原生模块 `rebuild` 预装 `better-sqlite3`/`sharp`/`onnxruntime-node`，`.worktrees/*` 用 `mklink /J` 复用 `media-service`、`web` 与 `tools` 依赖）；**严禁拉起本机 Docker Desktop**；`media-desktop` 已退役；全量 `test:helix-architecture`（含 `jav-host-journey.test.js` 等长文件/全宿主矩阵）、`usearch`、`/proc/self/fd`、POSIX/CIFS 行为与 Linux E2E 交由 `worker` 执行 |
| `worker` VM (`192.168.12.216`) | Linux 专属（全量 `test:helix-architecture` / `usearch` / `/proc/self/fd` / POSIX/CIFS）/ Linux E2E / `verify-shelfdeck` | `/tmp` detached worktree（4 vCPU / 7.7 GiB RAM / 0 Swap，限制 `--test-concurrency=2`；仅预装 `media-service/node_modules`，无 `tools/node_modules`、`web/node_modules`、GPU 与 Docker） |
| `heavy` 隔离 Docker 副本 (`192.168.12.215`) | Quadro T2000 NVENC + Docker 运行时 + E2E | `--runtime=nvidia` + `/tmp` 一次性目录 + `127.0.0.1:<ephemeral-port>`，严禁碰 `:18080` 或生产挂载 |
| `heavy` 生产 (`http://192.168.12.215:18080`) | 只读诊断 / 授权发布后复验 | 旧飞牛 `.230` 已退役禁止双跑 |
| CI | 无外部依赖 Docker smoke | GitHub Actions (`ubuntu-latest`) |

私有凭据在可选的 `tests/TEST_ENV_CHECKLIST.md`（gitignored，不提交；若本机不存在则 `tools/nas-ssh-config.js` 自动使用 `heavy` 默认 SSH 配置）。

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
- 历史成人库夹具：旧 Nexora/Kairox 名称只标识遗留测试路径，不是 clean Helix Domain 或当前 Beta 合同；
  后续 Series / JAV / Western Adult 测试必须先由 Helix SSOT 和活动 Phase 明确授权。
- 启动恢复：Libra durable work、Kairox Run/Task 和 source fencing 必须从持久化事实恢复；Governor permit 不持久化。
- 前端：`npm run build:web` 验证任务调度页、任务中心和审批字段类型。
