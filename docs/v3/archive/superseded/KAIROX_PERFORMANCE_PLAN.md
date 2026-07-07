# Kairox Performance Plan

Kairox Performance 是 Kairox Beta 之后的性能与调度版本。目标不是继续改变业务语义，而是让已经 Kairox 化的后端在生产库规模下更稳定地吃满资源，同时保持用户控制面可用。

## Goal

```text
在不改变 Lifecycle / Task Target / Flow Planner 业务边界的前提下，
提升自动任务供给和调度吞吐，
并建立可重复的性能 smoke / pressure 验收。
```

核心用户目标：

- 转码等长任务运行时，Dashboard / 媒体库 / 任务中心仍保持秒级可用。
- 一个 heavy flow 不再让 metadata / ingest 等轻任务完全停摆。
- awaiting confirmation 不再让所有 automatic task creation 停摆。
- 队列不会无界增长；同 item + target gate 不重复 active。
- 性能结论有报告，不靠主观观察。

## Scope

本版本处理：

- SmartTaskEngine supply policy。
- TaskAdmission / queue cap / cooldown 的观测。
- Resource backlog projection 的后端采集。
- API hot path timing。
- DB / WAL / diagnostic log 增长记录。
- 压测脚本和报告模板。

本版本不处理：

- 不改变 optimize objective、delete gate、archive semantics。
- 不恢复 full-auto destructive delete。
- 不让 Scheduler 重新计算业务 objective。
- 不把 DB/WAL/resource bucket 放回普通用户 UI 主路径。

## Implementation

### 1. Pressure-Aware Supply

旧恢复期策略：

```text
activeBacklog > 0 -> 整轮 SmartTaskEngine defer
```

Kairox Performance 默认策略：

```text
activeBacklog 只作为 pressure signal
Task Creator 仍继续评估 candidates
Admission 继续负责 cooldown / duplicate / target gate queue cap
SmartTaskEngine 只按 resource pressure 做额外 supply cap
```

配置：

| Config | Default | Meaning |
| --- | ---: | --- |
| `smartTaskDeferWhenActiveBacklog` | `false` | 显式回退旧全局保护模式；默认不用 |
| `smartTaskResourceQueueMultiplier` | `5` | 每个 resource bucket 默认可保留 `capacity * multiplier` 个 running/waiting backlog |
| `smartTaskMaxQueuedByResource` | `{}` | 按 resourceKey 覆盖 supply cap |

Resource pressure 只控制自动供给，不改变 Scheduler dispatch。Scheduler 仍只调度已存在的 runnable task。

### 2. Scan Summary

`SmartTaskEngine.getHealth().lastScanSummary` 需要至少解释：

- candidate / evaluated / enqueued。
- candidates / enqueued by targetGate。
- selectedFlow distribution only for implementation-path explanation。
- admission rejected reason。
- queue cap skip。
- resource pressure skip。
- active backlog by target gate。
- active backlog by resource running / waiting / blocked。
- max per run 是否触顶。
- 当前 supply policy。

### 3. Performance Smoke

新增脚本：

```bash
node media-service/scripts/kairox-performance-smoke.js \
  --base-url=http://127.0.0.1:18080 \
  --data-dir=media-service/data \
  --out=docs/v3/KAIROX_PERFORMANCE_SMOKE.md
```

生产可用：

```bash
node media-service/scripts/kairox-performance-smoke.js \
  --base-url=http://192.168.12.230:18080 \
  --data-dir=/app/data \
  --out=docs/v3/KAIROX_PERFORMANCE_PRODUCTION_SMOKE.md
```

脚本采集：

- `/v1/health`
- dashboard health
- library list
- tasks list
- admin tasks
- resource view
- delete candidates
- config
- SmartTask supply summary
- resource backlog buckets
- config/library/tasks DB 和 WAL 文件体积

## Acceptance

### Local

- `npm test`
- `npm run build:web`
- 新增 pressure policy 测试通过：
  - transcode running 时 metadata candidate 仍可自动入队。
  - awaiting confirmation 时 ingest candidate 仍可自动入队。
  - 显式 `smartTaskDeferWhenActiveBacklog=true` 时仍保留旧保护模式。

### Production E2E

生产验证必须从用户视角记录：

| Case | Expected |
| --- | --- |
| Basic control plane | Dashboard / Media / Tasks 秒级可用 |
| Heavy flow running | transcode running 不阻塞 metadata / ingest 少量补队列 |
| Awaiting confirmation | 等待确认任务不让所有自动任务停摆 |
| Queue growth | queue 不单调膨胀；max per run / resource cap 可解释 |
| Duplicate safety | 无同 item + targetGate active duplicate |
| Kairox safety | 无 delete-as-optimize、无 Scheduler 业务 objective 判断 |

## Recommended Starting Config

```json
{
  "smartTaskMaxPerRun": 3,
  "smartTaskMaxQueueSize": 20,
  "smartTaskDeferWhenActiveBacklog": false,
  "smartTaskResourceQueueMultiplier": 5,
  "smartTaskMaxQueuedByResource": {
    "local:ffmpeg": 5,
    "moviepilot": 2,
    "scraper:metadata": 5,
    "emby:metadata": 5,
    "filesystem:ingest": 10
  },
  "resourceCapacity": {
    "local:ffmpeg": 1,
    "scraper:metadata": 1,
    "emby:metadata": 1,
    "filesystem:ingest": 1
  }
}
```

该配置是起点，不是最终生产结论。最终值必须通过 production smoke / pressure report 决定。
