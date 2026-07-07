# ShelfDeck v3.4+ Roadmap

Status: Superseded draft. Needs full replanning after Kairox User Perception Management update and code audit.

本文记录 v3.3 GA 之后的版本推进计划。它不是新的架构合同；凡涉及 Lifecycle、Task Creator、Task Scheduler、Flow Planner、Resource Runtime、Admin Web projection 或生产部署，仍以 `docs/v3/KAIROX_ARCHITECTURE.md` 为准。

> 2026-07-02 更新：本路线图已经不能直接作为 v3.4+ 实施计划。Kairox 已新增 `User Perception Management`，并明确 `metadata gate passed != optimize objective ready`、Douban 私人评分属于 user perception、objective revision 由 Lifecycle projection 负责。后续计划必须先结合当前代码重新审计 `configStore` 默认模板、`strategyEngine`、`metadataStatus`、`lifecycleProjection`、`lifecycleTaskPlanner`、`businessFlowPolicy`、Task Creator、Rule Templates UI、Douban / Emby 感知同步入口，再完整重排。

本计划基于以下当前事实：

- `docs/v3/V3_3_GA_RECOVERY_PLAN.md` 已记录 v3.3 GA 在生产完成验收。
- v3.3 GA 已恢复 ordinary library、adult library visibility、task center、settings、automatic ingest、automatic metadata、automatic optimize transcode。
- v3.3 GA 明确没有恢复 automatic `upgrade` 和 delete gate 自动处置。
- 当前实现已经落地 `automaticTaskTargets`、`optimizeAllowedOperations`、target-gate priority、target-gate admission cooldown / queue limit、`resourceCapacity` 和独立的资源容量页面。
- `/system` 任务调度页已经按 Kairox task target / optimize operation 双授权表达；主要语义债在 `/rules` 策略模板页仍以 legacy rule `action=keep|transcode|upgrade|delete` 为用户主心智，其中 `delete` 应迁移到 delete gate 语义。
- `upgrade` / `delete` 后端 flow、approval policy、recovery contract 和 scheduler dispatch 路径已经存在，但它们当前仍带有 Mirex compatibility debt，automatic production readiness 仍未完成。
- `SmartTaskEngine` 的 `activeBacklog > 0` 整轮 defer 是 v3.3 恢复期保护策略，不是长期吞吐策略。

## 1. Version Summary

| Version | Theme | Goal |
| --- | --- | --- |
| `v3.4` | Optimize Objective 配置页 Kairox 化 | 把 `/rules` 从“策略动作模板”改成“优化目标模板” |
| `v3.5` | Automatic upgrade canary | 只恢复 upgrade 自动化，delete 仍不开 |
| `v3.6` | 调度压测与供给策略升级 | 去掉全局 active backlog defer 的长期依赖，提升资源利用率 |
| `v3.7` | Delete Gate Review | 建立 archive 后 delete candidate / 审批 / 确认执行链路 |
| `v3.8` | Admin Web 信息架构和 UI 统一 | 清理中英混杂、运维项过多、页面分组混乱 |

推荐顺序：

```text
v3.4  优化目标配置 Kairox 化
  -> v3.5  automatic upgrade canary
  -> v3.6  调度压测与去保守化
  -> v3.7  delete gate review-first 处置链路
  -> v3.8  Admin Web 信息架构统一
```

关键原则：

- 不先做 UI 大改；先修正用户配置 optimize objective 的入口。
- 不把 `upgrade` 和 delete gate 放在同一版本恢复。
- 不在没有压测数据前凭感觉放大调度并发或自动入队。
- 不让 flow operation 重新成为 task target。

## 2. v3.4 - Optimize Objective Config

目标：把 `/rules` 策略模板页从 legacy “策略动作模板”收口到 Kairox “优化目标模板”。

### Required Work

- 将用户可见心智从 `action` 改为 optimize objective / media facts target contract：
  - 目标媒体事实：码率区间、编码、分辨率、HDR、音轨、字幕、容器、体积上限或片源质量。
  - 可选 operation hint：`transcode`、`upgrade`，未来可扩展 `remux` / 字幕 / 音轨 / HDR repair。
  - 当前媒体事实已满足目标时，optimize gate 直接通过；这不是 `keep` 目标。
- 后端可继续兼容保存 `rule.action`，但新增 UI、文案和文档不再把 action 当作架构主语义。
- 将 rule editor 中的“动作”区域改为“优化目标”，operation 仅作为 objective 的 acceptable operation / operation hint。
- `delete` 不出现在 optimize objective 配置中。若旧模板包含 `action=delete`，v3.4 只做兼容读取和迁移提示，后续迁到 delete gate policy。
- 保存配置时继续依赖 metadata gate contract 校验，确保 optimize objective 会消费的 facts 被 metadata gate 覆盖。
- 对旧 rule template 做无损读取、编辑和保存。

### Not Doing

- 不新增 Kairox 架构层。
- 不把 legacy `strategyEngine` 改名成新的业务组件。
- 不恢复 automatic upgrade / delete gate。
- 不改变生产自动化授权范围。

### Acceptance

- 旧模板可正常读取、保存、回写。
- 页面主语义是 optimize objective / media facts target contract，不是 `transcode task` / `upgrade task` / `delete task`。
- `strategyEngine` 仍只是 optimize target projection 的 legacy implementation module。
- `npm test` 和 `npm run build:web` 通过。

## 3. v3.5 - Automatic Upgrade Canary

目标：在 `optimizeAllowedOperations` 中恢复 `upgrade`，但只做 upgrade canary，不恢复 delete gate。

### Required Work

- automatic upgrade 必须同时满足：
  - `automaticTaskTargets` 包含 `optimize`。
  - `optimizeAllowedOperations` 包含 `upgrade`。
  - Lifecycle / optimize target projection 给出的 objective 是 `improve_source_quality` 或兼容 projection 显示 operation hint 为 `upgrade`。
  - metadata gate 完整。
  - active duplicate、cooldown、queue cap 和 sub-library scheduling 规则通过。
- upgrade task 顶层仍是 `targetGate=optimize`，`upgrade` 只是 flow operation。
- 保留现有 safety gates：
  - `upgrade.candidateSelect`。
  - `upgrade.identityMismatch` 必须保持 `forceConfirm`。
  - `upgrade.beforeReplace`。
- MoviePilot 不可用、候选为空、身份不一致、原盘不支持、下载等待等状态必须进入可解释 task / event / controlState。
- 生产 canary 从 1 个 automatic upgrade task 开始，确认 task target、flow operation、confirmation、event history 和最终 facts 后再扩大。

### Not Doing

- 不开启 delete gate 自动处置。
- 不把 upgrade 作为 task target。
- 不绕过 MoviePilot / identity / replace confirmation。
- 不用隐藏按钮或禁用任务代替 flow capability 修复。

### Acceptance

- 禁用 `upgrade` operation 时不会创建 automatic upgrade。
- 启用后只为 upgrade objective 创建 optimize task。
- 任务中心能解释 candidate selection、MoviePilot waiting、identity mismatch、replace confirmation。
- 失败或等待状态可 recovery / inspect，不重复刷同一个 item。
- 生产 canary 完成后有 API、浏览器和任务事件验收记录。

## 4. v3.6 - Scheduling Pressure Test And Supply Policy

目标：解决 v3.3 恢复期调度过于保守、资源吃不满的问题。此版本只处理压测、供给策略和容量策略，不夹带 delete gate 自动处置。

### Required Work

- 建立可重复压测脚本和报告模板，至少采集：
  - SmartTask candidate / evaluated / enqueued / rejected。
  - admission rejected reason。
  - skipped by queue cap / max per run。
  - active backlog。
  - resource bucket running / waiting / blocked。
  - dashboard / media / tasks / settings API latency。
  - `library.db`、`tasks.db`、WAL、diagnostic log 增长。
  - source missing、metadata gate failure、transcode failure 的失败风暴风险。
- 将 `smartTaskDeferWhenActiveBacklog` 从全局整轮 defer 演进为 pressure-aware supply policy：
  - long-running transcode 不应阻止 metadata / ingest 轻任务少量补队列。
  - awaiting confirmation 不应让所有 automatic creation 停摆。
  - 不同 resource bucket 按各自 capacity、queue cap 和 cooldown 控制。
- Scheduler 仍只按已保存 priority / createdAt / resource capacity dispatch，不回到 operation bucket 或业务目标判断。
- 保持 item lock、active duplicate prevention、risk confirmation 和 flow recovery contract。

### Suggested Test Phases

| Phase | Config | Acceptance |
| --- | --- | --- |
| Baseline | 当前保守模式，active backlog defer | 单个 transcode / metadata 任务运行时控制面稳定 |
| Queue Canary | `maxPerRun=1`、queue cap 小、逐步关闭全局 defer | 只补少量队列，不重复创建同 item |
| Mixed Light | metadata + ingest 小批量，`scraper:metadata=1` | scrape 不拖慢 dashboard / media |
| Mixed Heavy | metadata + transcode，`local:ffmpeg=1`，queue cap 5-10 | transcode 跑时轻任务可排队，API 仍秒级 |
| Stress Step | `maxPerRun` 1 -> 3 -> 5 -> 10 | 找到 API latency / queue growth 拐点 |
| Soak | 稳定配置跑 12-24h | 无持续膨胀、无失败风暴、无全页 loading |

### Not Doing

- 不恢复 delete gate 自动处置。
- 不让 Scheduler 根据业务规则重算 priority。
- 不让 Resource Runtime 反向决定 Lifecycle objective。
- 不把 DB / WAL / diagnostic log 放回普通前端主路径。

### Acceptance

- transcode running 时，metadata / ingest 可继续按 resource pressure 少量补队列。
- API 热路径保持秒级，媒体页不全页 loading。
- queue 不单调增长。
- 无同 item 并发、无重复 active task、无风险 flow 绕过 confirmation。
- 压测报告能解释推荐生产配置。

## 5. v3.7 - Delete Gate Review

目标：建立 archive 之后的 delete candidate / 审批 / 确认执行链路。delete 是独立 `targetGate=delete`，不是 optimize flow operation。

### Required Work

- delete candidate 必须来自 archived 媒体：
  - archive gate 已通过，并有可解释 `archivedAt` / archive facts。
  - delete policy 输入完整，例如评分、观看状态、归档时长、用户保留偏好。
  - delete eligibility 规则命中，例如 `rating <= 2 and archivedFor >= 6 months`。
- 新增或整理 delete candidates / 处置队列页面，支持：
  - 确认删除。
  - 保持已归档。
  - 延后提醒。
  - 不再建议。
- 用户确认删除或显式 destructive pre-authorization 后，Task Creator 才能创建 `targetGate=delete` task。
- delete flow 必须覆盖 path safety、Emby delete、本地文件删除、missing target as success、delete verify、event history 和 audit。
- delete 成功后写 delete gate result；archive facts 保留为历史，不把 delete 伪装成 optimize 或 archive。
- 若未来允许 full-auto delete，必须新增更明确的 destructive pre-authorization，不建议仅用 `delete.beforeExecute=auto` 作为唯一授权语义。

### Not Doing

- 不默认开启 destructive delete。
- 不批量直接删除生产数据。
- 不绕过 confirmation、path safety 或 target verification。
- 不让 optimize gate 承担 delete 语义。
- 不让 archive gate 变成生命周期终点或永久保留语义。

### Acceptance

- 未确认或未显式 destructive pre-authorize 时，绝不执行 destructive delete。
- delete candidate 能解释命中的 archive 后处置规则。
- 用户确认后创建可解释 `targetGate=delete` task。
- delete task event history 能解释 precheck、confirmation、execute、verify。
- 删除成功后 item delete gate facts 可解释，archive history 保留。
- 生产 canary 从 1 个 delete task 开始，并保留回滚 / 审计记录。

## 6. v3.8 - Admin Web Information Architecture

目标：统一 Admin Web 信息架构、术语和普通用户路径。此版本不夹带核心 scheduler / flow 行为。

### Required Work

- 侧边栏按使用心智重组：
  - 日常：仪表盘、媒体库、任务中心。
  - 配置：媒体库、优化目标、自动化、外部集成。
  - 高级：资源容量、节点、内部诊断。
- 清理中英混杂。英文只保留必要技术名词，例如 Emby、MoviePilot、FFmpeg、API Key。
- Dashboard 只展示用户决策相关状态：
  - 服务是否可用。
  - 外部集成是否配置正确。
  - 哪些库需要处理。
  - 哪些任务需要确认 / 恢复。
- 任务中心主标题优先展示 target gate / objective，operation 作为实现路径。
- delete candidates / 处置队列作为普通业务页面，展示用户决策，不展示 resource bucket、DB/WAL 或内部 payload。
- `/system` 拆轻或重组：
  - 自动化授权。
  - 审批策略。
  - 队列优先级。
  - 高级队列参数。
- Resource Capacity 保留为高级配置；Resource View / DB / WAL / diagnostic log 不进入普通用户默认路径。

### Not Doing

- 不重写后端 task / flow / scheduler。
- 不把内部 resource bucket 当作普通产品主页面。
- 不在 UI 优化中改变 production automation 授权。

### Acceptance

- 普通用户首屏能回答：服务是否正常、哪些库需要处理、哪些任务需要我确认。
- 运维细节仍可查，但不污染主路径。
- 任务中心和媒体库不再以 legacy actionType 作为主解释。
- `npm run build:web` 通过，关键页面浏览器验收无白屏、无全页 loading、无控制台错误。

## 7. Cross-Version Guardrails

- 自动 task 创建必须通过统一 Task Creator / TaskAdmission 语义。
- 手动 intent 可绕过 automatic allow-list，但不能绕过 active duplicate、风险动作确认和 flow safety。
- `transcode`、`upgrade` 是 optimize flow operation，不是长期 task target。
- `delete` 是独立 delete gate 的 flow operation，不是 optimize flow operation。
- Flow executor 不能私自修改 `targetGate` 或 `gateObjective`。
- Scheduler 只调度 runnable task 和 dispatch flow event，不决定业务 objective。
- Resource capacity 只表达 Resource Runtime 容量，不表达任务业务语义。
- 普通 Admin Web 不默认展示 DB / WAL / payload / resource bucket / diagnostic log 等内部运维事实。
- 生产部署和生产数据操作必须遵守 `docs/v2/PRODUCTION_DEPLOYMENT.md` 与 `docs/v3/OPERATION_CONTEXT.md`。

## 8. Required Verification Per Version

每个版本本地至少执行：

```bash
cd media-service && npm test
cd media-service && npm run build:web
```

涉及生产部署时必须补充：

- 标准构建、上传、dry-run、checksum、apply 流程。
- `/v1/health`、`/v1/admin/dashboard/health`、`/v1/library`、`/v1/config`、`/v1/tasks` API 计时。
- dashboard、media、tasks、settings、capacity 浏览器验收。
- queue length、DB / WAL、diagnostic log、failed task events 检查。
- canary 自动任务的 task target、flow operation、event history、resource context、controlState 和最终 facts 验收。
