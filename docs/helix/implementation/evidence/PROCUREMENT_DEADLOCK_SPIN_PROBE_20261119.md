# 恢复期重规划死锁、pre-attempt 延后空转与 Linux `ffprobe` 修复验收记录（2026-11-19）

## 问题根因

1. **恢复预留持有者与 `dispatchableEventHard` / 同伴 Work 调度死锁**：
   - 当同类 `workKind`（如 Procurement `evidence_assessment`）触发熔断并进入 `open`/`recovering` 后，重规划产生的持有恢复预留 `Work` 仍被 `WorkSupplyController` 的 `dispatchableEventHard`/`Soft` 与 `activeAttemptSoft` 上限拦截（`SUPPLY_HARD_CAP` / `SUPPLY_SOFT_CAP`），而堆积的 Dispatchable Events 来自被熔断阻塞的同伴 `Work`；与此同时 `WorkScheduler` 持续选中被阻塞的同伴 Event，导致 Event 被立即拒发（`circuit_deferred`）而恢复预留 `Work` 无法规划或推进关闭熔断，形成活锁。
2. **Pre-attempt 延后结果引发 100ms 忙等空转**：
   - `ExecutionRuntimeHost.drainOneEvent()` 在 `eventRuntime.run()` 返回 `circuit_deferred`、`waiting`、`unavailable` 或无 `eventAttemptId` 的 pre-attempt `deferred` 时仍执行 `workLifecycle.aggregateEvent(eventId)`，且 `tick()` 仅以 `result.actions > 0` 判定有进展，使 `queueTick()` 不断将 `idlePollMs` 重置为 `tickIntervalMs`（100ms），无有效任务时持续维持十余个百分点 CPU 空转。
3. **纯观测存储/挂载 I/O 错误未按 `'io'` 隔离作用域**：
   - `event-runtime.js` 中 `observationFailureClass(error)` 未将 `EIO`/`ESTALE`/`ENOTCONN`/`PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED` 等纯观测存储与挂载 I/O 错误映射为 `'io'`，导致异常按全局 `executor` 作用域计次触发全 `workKind` 熔断，而不是收敛到 `volume_read:<mount>` 资源作用域。
4. **Linux 容器 `/usr/local/bin/ffprobe` 二进制崩溃与库符号冲突**：
   - `media-service/Dockerfile` 原先将 `@ffprobe-installer/ffprobe`（旧静态构建 `N-66595`）覆盖到 `/usr/local/bin/ffprobe`，在 `heavy` 生产镜像中探测部分 MPEG-TS 样本时异常退出；而直接安装发行版 `ffmpeg` 使用 `/usr/bin/ffprobe` 时需前置系统库路径避免 `/usr/local/lib` 符号版本冲突。

## 修复内容

- `media-service/src/helix/foundation/execution/work-supply-controller.js`：
  - 新增 `work_supply_circuits.list_by_state` 查询与 `holdsRecoveryReservation` 校验，仅豁免恢复预留持有者对 `dispatchableEventHard`/`Soft` 及 `soft` 阈值的限制，同时严格保留 `activeAttemptHard` 硬上限。
- `media-service/src/helix/foundation/execution/executor-incident-registry.js` & `executor-incident-observer.js`：
  - 新增 `scopeCircuitStatus` 与 `allowsTargetScheduling(request)`，在 `recovering` 状态仅放行恢复预留持有者（Work 与 Event），在 `open` 且无 `running` Work 时放行单个探活 `work`、`event` 阶段放行待收敛在途任务，其余同伴目标在调度层提前过滤。
- `media-service/src/helix/foundation/execution/work-scheduler.js` & `media-service/src/helix/composition/create-procurement-execution-runtime.js`：
  - `WorkScheduler` 新增 `incidentTargetEligibilityProvider`（校验布尔返回值并在单次 `acquire()` 内按 `workId` 记忆化缓存），Composition Root 将 `executorIncidentObserver` 构造前移后接入 `scheduler`。
- `media-service/src/helix/foundation/execution/execution-runtime-host.js`：
  - 新增 `isPreAttemptDeferral(outcome)` 与 `dispatchProgress` 追踪；pre-attempt 延后跳过 `aggregateEvent` 与终止唤醒；`tick()` 输出精确的 `progressed` 状态，`queueTick()` 仅在 `result.progressed` 时重置 `idlePollMs` 为 `tickIntervalMs`，恢复指数退避（如 `100ms -> 250ms -> 500ms -> 1000ms`）。
- `media-service/src/helix/foundation/execution/event-runtime.js`：
  - 新增 `OBSERVATION_IO_CODES` 集合，在 `observationFailureClass(error)` 中识别存储与挂载 I/O 错误码并返回 `'io'`。
- `media-service/Dockerfile`：
  - 在 `service-runtime` 阶段安装 `fontconfig ffmpeg`（保留 `linuxserver/ffmpeg` 于 `/usr/local/bin/ffmpeg` 承担转码），并移除 `@ffprobe-installer/ffprobe` 拷贝，改为创建 `/usr/local/bin/ffprobe` POSIX shell 包装脚本前置 `LD_LIBRARY_PATH="/usr/lib/x86_64-linux-gnu:/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"` 后 `exec /usr/bin/ffprobe "$@"`。
- 回归测试：
  - `p4-work-supply.test.js`、`p4-work-scheduler.test.js`、`p4-execution-runtime-host.test.js`、`p4-event-runtime.test.js`、`p15-foundation-executor-incident-observer.test.js`、`clean-media-probe-runtime.test.js`。

## 验证结果

### 1. RED 基线复现（未打补丁 `main` `cf852a4f7` + 新增测试，Linux `worker` `192.168.12.216`）

- 6 个测试文件共 168 项中 8 项 PR 2 目标测试按预期失败：`WorkSupplyController` 对恢复预留持有者返回 `SUPPLY_HARD_CAP` 延后、`WorkScheduler` 未过滤受阻同伴目标、`ExecutionRuntimeHost` 在 140ms 内无退避空转 14 次（`14 !== 0` `aggregateEvent` 调用）且恢复预留死锁（`dispatched[0] === undefined`）、`observationFailureClass` 将 `EIO`/`ESTALE` 归类为 `executor`、`ExecutorIncidentObserver` 缺少 `allowsTargetScheduling`、旧静态 `ffprobe` 无法读取真实 MPEG-TS 且 Dockerfile 合同匹配失败。

### 2. GREEN 单元与架构边界验证（Linux `worker` `192.168.12.216` & Windows）

- **Linux `worker`（`192.168.12.216`）隔离 worktree**：运行 8 个测试文件（`p4-work-supply.test.js`、`p4-work-scheduler.test.js`、`p4-execution-runtime-host.test.js`、`p4-event-runtime.test.js`、`p4-foundation-public.test.js`、`p15-foundation-executor-incident-observer.test.js`、`forbidden-semantic-guard.test.js`、`package-boundary-guard.test.js`）：
  - **184 / 184 全部通过（0 失败）**。
- **架构边界检查**：执行 `node scripts/helix-architecture-check.js`，全仓基线 findings 总数为 **24**（与 `main` 持平，本次触达 Foundation/Composition 文件新增违规 **0**）。
- **Layer 1 `createCleanServiceHost` 实时 HTTP 冒烟（Linux `worker`）**：临时数据目录启动宿主（`routeCount=167`），`GET /v1/health -> 200`、`POST /v1/admin/session -> 204`（含 `Set-Cookie`）、`errors=0`，随后优雅 `close()` 并清理远端临时目录及 worktree。
- **Windows 本地**：`node --test test/clean-media-probe-runtime.test.js` 中 `FFPROBE_PATH` 优先级与 Dockerfile 契约测试通过（`ffmpeg-static` 未安装在本地无依赖工作树中属预期跳过环境范围）。

### 3. `heavy`（`192.168.12.215`）隔离临时容器实测（未触碰生产容器与生产数据）

- 在不停止、不重启、不挂载生产数据目录与端口的前提下，从 `heavy` 当前生产镜像 `markmahoro/shelfdeck:helix-beta-20261119-5be6fa6879` 拉起一次性只读挂载测试文件的 `--rm` 临时容器，按 `media-service/Dockerfile` 方式安装 `fontconfig ffmpeg` 并写入 `/usr/local/bin/ffprobe` 包装脚本后实测：
  - `/usr/local/bin/ffmpeg -version` 保持 `linuxserver/ffmpeg`（`ffmpeg version 9.0.2`）。
  - `/usr/local/bin/ffprobe -version` 正常执行发行版 `/usr/bin/ffprobe`（`ffprobe version 8.0.1-3ubuntu2`），无库符号阴影错误。
  - 在容器内执行 `FFMPEG_PATH=/usr/local/bin/ffmpeg FFPROBE_PATH=/usr/local/bin/ffprobe node --test /tmp/work/test/clean-media-probe-runtime.test.js`：
    - `mpegts` 真实编码样本探测 + 色彩事实保留：`ok 1`
    - `matroska` 真实编码样本探测 + 色彩事实保留：`ok 2`
    - `FFPROBE_PATH` 与 `binary` 优先级：`ok 3`
    - `ffprobe` 进程信号崩溃错误分类：`ok 4`
    - Dockerfile 契约校验：`ok 5`
    - **5 / 5 全部通过（0 失败）**。
- 测试前后核查 `heavy` 上 `docker ps`，生产容器 `shelfdeck` 保持原状持续运行（`Up 19 hours`），未做任何部署、重启或数据清理。
