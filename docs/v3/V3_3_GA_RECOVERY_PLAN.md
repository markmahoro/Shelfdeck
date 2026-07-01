# ShelfDeck v3.3 GA Recovery Plan

Status: v3.3 GA accepted on production on 2026-07-02. v3.3-rc.1 through v3.3-rc.11 are implemented, deployed, and production-validated. v3.3 GA restores ordinary library, adult library visibility, task center, settings, automatic ingest, automatic metadata, and automatic optimize transcode. Automatic upgrade and delete remain out of scope for v3.3 GA.

本文记录 ShelfDeck 从已完成的 v3.3 alpha/beta 进入 v3.3 GA 的恢复计划。所有开发、修复、迁移、部署和验收都必须符合 `docs/v3/KAIROX_ARCHITECTURE.md`，不允许绕过 Kairox 的 Lifecycle、Task Creator、Task Scheduler、Flow Planner、Resource Runtime、Admin Web projection 和 production safety 边界。TaskAdmission 不是 Kairox 独立组件，只是 Task Creator 内部的准入校验实现细节。

## 1. Current State

v3.3 不是从头开始。以下阶段已经完成并提交：

- v3.2 控制面稳定化、dashboard 轻量化、资源视图普通前端入口移除。
- `docs/v3/ADULT_DATA_MODEL.md` 定义成人库 hot media facts、light adult metadata、cold AI artifacts、file assets 分层。
- 成人库新写入瘦身，冷 AI artifacts 不进入 `media_items` 热 payload。
- 生产 adult dry-run 已覆盖 `library.db` 和旧 `library.json`。
- 生产 adult apply guard 已提供备份、dry-run 和显式确认。
- JAV / US 成人库已恢复到媒体页可见路径，列表走热数据。

当前进入 v3.3 rc 的主要目标是恢复自动能力，但恢复时必须顺手把 legacy 概念收口到 Kairox：

- Kairox 没有 `refresh` 一等概念；旧 refresh / startup refresh / manual refresh / scheduled refresh 都收口为 `ingest`。
- Kairox 没有 `self-compute` 一等概念；确定性派生字段由 scrape / metadata repair flow 的 `scrape.project_media_facts` event 产出。
- Kairox 没有 `strategy` 一等架构层；旧 strategy engine 只能作为 optimize gate target projection 的实现细节。
- 自动授权拆成两层：自动 task 创建 allow-list 和 optimize flow operation allow-list。
- v3.3 GA 只恢复 optimize task 中的 `transcode` flow；`upgrade` / `delete` 后续专项处理，不进入本轮 GA。
- Task priority 归 Task Creator；Task Scheduler 只按已保存的 priority / createdAt 调度，不根据业务规则重算 priority。
- Resource capacity 归 Resource Runtime；任务调度配置页只表达 Task 语义，不再混入转码 / 洗版 / 删除等资源并发槽位。

## 2. Version Plan

| Version | Goal | Required Work | Explicitly Not Doing | Acceptance |
| --- | --- | --- | --- | --- |
| `v3.3-rc.1` | 文档与架构口径修正 | 更新 Kairox 文档；新建本文；把 self-compute 改为 `scrape.project_media_facts` event；说明 `refresh=ingest`、`strategy=optimize target projection`、双授权模型 | 不改生产数据；不恢复新自动动作 | 文档不再把 refresh / self-compute / strategy 当成 Kairox 一等概念 |
| `v3.3-rc.2` | optimize target projection 命名收口 | 用户可见文案改为“优化目标计算”；旧 `recompute-strategy` 仅保留兼容 alias；projection 只输出 optimize target facts | 不新增 strategy 层；不补 metadata；不创建 task | 页面、API、日志中的用户语义不再依赖 strategy |
| `v3.3-rc.3` | scrape 承接派生字段 | 在 scrape / metadata repair flow 中明确 `scrape.project_media_facts` 与 `scrape.verify_metadata_gate`；`bucket`、`equivalentBitrate` 等确定性派生由 scrape event 产出 | 不做后台 self-compute timer；不让 optimize 补事实 | metadata 不完整停在 metadata gate；完整后自然进入 optimize |
| `v3.3-rc.4` | ingest 替代 refresh | 旧 refresh / manual refresh / startup refresh 内部收口为 ingest source sync；启动后台 ingest 有预算和 backpressure | 不做全库阻塞 refresh；不阻塞 Admin Web | 重启后控制面先可用；后台 ingest 可观测但不拖页面 |
| `v3.3-rc.5` | 双授权配置落地 | 新增 `automaticTaskTargets` 与 `optimizeAllowedOperations`；旧 `smartTaskEnabledActions` 做一版兼容迁移 | 不继续让一个字段混合表达两层授权 | Task Creator 自动 task allow-list 只看 task target；optimize flow 只看 operation allow-list |
| `v3.3-rc.6` | 只恢复 automatic ingest | 生产仅开启 `automaticTaskTargets=['ingest']`；验证 duplicate active-task、queue cap、cooldown、priority | 不自动 metadata / optimize | 入库自动能力恢复，页面不卡，队列稳定 |
| `v3.3-rc.7` | Priority 归位到 Task Creator | 新增 `priorityEngine.explainTaskPriority({ source, taskTarget, itemInfo, config })`；manual / SmartTask 自动创建任务时由 Task Creator 结果计算 priority；兼容旧 `taskPriority.actionTypeWeights` 到 `targetGateWeights + optimizeOperationHints`；Scheduler 不再业务重算 priority | 不让 flowPlan 参与 Task Creator priority；不迁移历史任务 priority | 新任务 priority 不再以 actionType 为主语义；Scheduler 只按已存 priority / createdAt 排序 |
| `v3.3-rc.8` | Task 调度配置语义收敛 | 设置页“任务调度”只保留自动 task targets、optimize operation 授权、poll interval、maxPerRun、global queue cap、cooldown / queued limits、priority；cooldown / queue limit 从 action 迁移为 targetGate 语义，旧字段兼容投影 | 不展示资源并发槽位；不把 Resource Runtime 概念混入 Task 配置 | 页面不再展示转码 / 洗版 / 删除并发；Task 配置按 Kairox task target / gate 表达 |
| `v3.3-rc.9` | Resource Capacity 独立 | 新增 `/v1/config.resourceCapacity`；按 resource key 配置容量；新建“资源容量”设置页；Scheduler / resource projection 读取 Resource Runtime capacity；旧 concurrency 字段兼容一版 | 不恢复普通前端 Resource View 诊断页；不把容量配置当成任务语义 | Resource Runtime 容量不再由 action 字段主导；普通前端保持清爽 |
| `v3.3-rc.10` | 恢复 automatic metadata / scrape | 生产加入 `automaticTaskTargets=['ingest','metadata']`；成人 / 普通 metadata repair 都走 Task Creator，由 Task Creator 做 duplicate active-task、queue cap、cooldown、risk / safety 等准入校验 | 不链式私建 optimize task；不自动 optimize | metadata 缺失项可解释，失败不反复刷队列，页面响应稳定 |
| `v3.3-rc.11` | 恢复 optimize transcode flow | 生产加入 `automaticTaskTargets=['ingest','metadata','optimize']`，只开启 `optimizeAllowedOperations=['transcode']`；确认 optimize task 只自动选择 transcode flow | 不开启 upgrade；不开启 delete | transcode 自动优化稳定；全局 priority 队列不被 operation bucket 替代；页面不卡 |
| `v3.3` | GA 完整验收 | 全功能、性能、生产、回滚、用户路径验收；补最终文档状态 | 不新增新架构概念 | 普通库、成人库、任务中心、设置页、自动能力均可用且页面不卡 |

当前本地完成状态：

- `v3.3-rc.1`：Kairox 口径已修正，`refresh`、`self-compute`、`strategy` 不再作为一等架构概念。
- `v3.3-rc.2`：用户语义已收口为“优化目标计算”，旧 `recompute-strategy` 仅作为 alias。
- `v3.3-rc.3`：确定性派生字段已收口到 media facts projection，由 scrape / metadata repair 流程触发；后台 self-compute timer 不再作为启动路径。
- `v3.3-rc.4`：旧 refresh 动作已收口为 ingest source sync，`/v1/library/actions/ingest` 为新入口，旧 refresh endpoint 仅作为 alias。
- `v3.3-rc.5`：`automaticTaskTargets` 与 `optimizeAllowedOperations` 已落地，`smartTaskEnabledActions` 保留兼容投影。
- `v3.3-rc.6`：已部署 `markmahoro/shelfdeck:v3.3-rc.6`，生产仅开启 `automaticTaskTargets=['ingest']`，`optimizeAllowedOperations=[]`。SmartTask 首轮扫描只启用 ingest，候选 0、入队 0、active backlog 0；dashboard / media / tasks / settings 浏览器验收无全页 loading、无控制台错误。
- `v3.3-rc.7`：Task priority 已归 Task Creator；manual 和 SmartTask 入队都使用 Task Creator 准入结果中的 taskTarget 计算 priority；Scheduler 不再业务重算 priority。
- `v3.3-rc.8`：任务调度页已按 Kairox task target / gate 收敛，资源并发槽位从该页移除。
- `v3.3-rc.9`：`resourceCapacity` 配置与“资源容量”设置页已落地；Resource Runtime capacity 以 resource key 为主，旧 concurrency 字段仅兼容。
- `v3.3-rc.10`：已部署生产并恢复 `automaticTaskTargets=['ingest','metadata']`。metadata / scrape 自动任务会通过 Task Creator 创建；source missing 不再伪装成 scrape failure，而是通过 upstream gate invalidation 回退到 ingest gate。生产观察中 dashboard / media / tasks / config 热路径保持可用。
- `v3.3-rc.11`：已部署生产并恢复 `automaticTaskTargets=['ingest','metadata','optimize']` + `optimizeAllowedOperations=['transcode']`。先用 canary 配置只放行 1 个 automatic transcode，确认 task target 为 `optimize`、flow operation 为 `transcode`、`upgrade/delete` 未被创建；canary task 完成 verify 和 replace。
- `v3.3`：生产 GA 验收通过。dashboard / media / tasks / settings / resource capacity 浏览器打开无白屏、无全页 loading、无控制台错误；API 热路径保持秒级；生产配置只恢复 automatic ingest / metadata / optimize transcode，不恢复 automatic upgrade / delete。

## 2.1 v3.3 GA Production Acceptance

2026-07-02 在 NAS production `192.168.12.230:18080` 完成 v3.3 GA 验收。

生产配置：

- `automaticTaskTargets=['ingest','metadata','optimize']`
- `optimizeAllowedOperations=['transcode']`
- `smartTaskEnabledActions=['ingest','scrape','transcode']`
- `smartTaskMaxPerRun=10`
- `resourceCapacity` 已启用 resource key 配置：`filesystem:ingest`、`filesystem:mutation`、`scraper:metadata`、`emby:metadata`、`local:western-ai`、`local:ffmpeg`、`worker:*`、`moviepilot`、`service:task`

API 秒表：

| API | Status | Latency | Payload |
| --- | --- | ---: | ---: |
| `/v1/health` | 200 | 125 ms | 57 B |
| `/v1/admin/dashboard/health` | 200 | 39 ms | 18,298 B |
| `/v1/library` | 200 | 418 ms | 7,187,864 B |
| `/v1/config` | 200 | 6 ms | 21,911 B |
| `/v1/tasks` | 200 | 4 ms | 12 B |
| `/v1/admin/tasks?pageSize=20` | 200 | 13 ms | 77,903 B |

浏览器验收：

| Route | Result |
| --- | --- |
| `/` dashboard | 无白屏、无全页 loading、无控制台错误 |
| `/media` media library | 无白屏、无全页 loading、无控制台错误；可见渲染约 3.9s |
| `/tasks` task center | 无白屏、无全页 loading、无控制台错误 |
| `/system` settings | 无白屏、无全页 loading、无控制台错误 |
| `/capacity` resource capacity | 无白屏、无全页 loading、无控制台错误 |

自动能力验收：

- Automatic metadata / scrape 已恢复，并通过 Task Creator 创建任务。
- Source missing 不再伪装成 metadata scrape failure；flow 上报 upstream gate invalidation，Lifecycle 回退到 ingest gate。
- Automatic optimize 仅恢复 `transcode` flow；canary transcode task 完成 encode / verify / replace，未自动创建 `upgrade` / `delete`。
- 当前 active / queued / running 任务为 0，控制面热路径稳定。

GA 结论：

- v3.3 GA 达成“普通库、成人库、任务中心、设置页、automatic ingest、automatic metadata、automatic transcode 可用且页面不卡”的目标。
- `upgrade` / `delete` 自动化、吞吐压测和容量调优进入后续专项，不阻塞 v3.3 GA。

## 2.2 Production Capacity Test Note

2026-07-02 讨论确认：当前 `SmartTaskEngine` 的 `activeBacklog > 0` 整轮 defer 策略适合恢复阶段的生产保护，但不是长期最优形态。它能防止自动任务在刚恢复 metadata / transcode 时堆积，但也可能让资源利用走向另一个极端：

- 一个长时间 transcode 正在执行时，metadata / ingest 这类轻任务也会被整轮挡住。
- 一个任务处于 executing / queued / awaiting confirmation 时，自动创建整体暂停，可能造成资源空闲。
- scrape 与 transcode 使用的 Resource Runtime 容量不同，长期应该由 queue cap、global priority、resource capacity 和 scheduler dispatch 共同控制，而不是只靠全局 active backlog。

后续若要从保守恢复模式进入更高吞吐模式，先做压测计划，不直接凭感觉调参。压测目标：

- 控制面：dashboard / media / tasks / settings 在后台任务存在时仍不卡。
- 自动创建：`smartTaskMaxPerRun`、queue cap、cooldown 不导致队列单调增长。
- 调度：Scheduler 按已保存的 global priority / createdAt 调度，不回到 operation bucket。
- 资源：`scraper:metadata`、`local:ffmpeg`、`filesystem:*` 可以分别限流，互不拖死控制面。
- 数据：`library.db`、`tasks.db`、WAL、diagnostic log 不持续快速膨胀。
- 失败：source missing、metadata gate failure、transcode failure 都可解释，且不会重复刷同一个 item。

压测分阶段建议：

| Phase | Config | Acceptance |
| --- | --- | --- |
| Baseline | 当前保守模式，active backlog defer | 单个 transcode / metadata 任务运行时控制面稳定 |
| Queue Canary | 关闭全局 defer 之前，`maxPerRun=1`、queue cap 小 | 只补少量队列，不重复创建同 item |
| Mixed Light | metadata + ingest 小批量，`scraper:metadata=1` | scrape 不拖慢 dashboard / media |
| Mixed Heavy | metadata + transcode，`local:ffmpeg=1`，queue cap 5-10 | transcode 跑时轻任务可排队，API 仍秒级 |
| Stress Step | `maxPerRun` 1 -> 3 -> 5 -> 10 | 找到 API latency / queue growth 拐点 |
| Soak | 稳定配置跑 12-24h | 无持续膨胀、无失败风暴、无全页 loading |

这部分是后续容量调优输入，不阻塞 v3.3 GA；v3.3 GA 仍以“可用、稳定、不卡、自动 transcode 可控恢复”为优先。

## 3. Public Interfaces

`/v1/config` 在 v3.3 rc 中新增两个 Kairox 配置字段：

- `automaticTaskTargets`: automatic Task Creator allow-list。允许值是 `ingest`、`metadata`、`optimize`、`archive`。
- `optimizeAllowedOperations`: optimize flow operation allow-list。允许值是 `transcode`、`upgrade`、`delete`。
- `taskPriority.targetGateWeights`: Task Creator priority 的 target gate 权重。
- `taskPriority.optimizeOperationHints`: optimize task 内 flow operation 的轻量提示权重，不改变 task target。
- `taskPriority.rulesByTargetGate`: 基于 target gate 的 priority 规则。
- `taskAdmission.cooldownHoursByTargetGate` / `taskAdmission.maxQueuedByTargetGate`: Task Creator 准入配置的兼容字段名，语义按 target gate 表达。
- `resourceCapacity`: Resource Runtime capacity flat map，例如 `filesystem:ingest`、`scraper:metadata`、`local:ffmpeg`、`moviepilot`、`service:task`。

迁移期保留 `smartTaskEnabledActions` 作为兼容字段，但新实现不得继续把它当成架构主语义：

- `ingest` 投影为 `automaticTaskTargets=['ingest']`。
- `scrape` 投影为 `automaticTaskTargets=['metadata']`。
- `transcode`、`upgrade`、`delete` 投影为 `automaticTaskTargets` 包含 `optimize`，并写入对应 `optimizeAllowedOperations`。
- `delete` 不作为 v3.3 GA 默认自动项；即使兼容字段中存在，也必须继续受风险动作确认、显式授权和 flow safety 校验约束。

旧 refresh / strategy API 可以保留 alias，但新文档、UI、测试和新增代码使用 Kairox 语义：

- refresh alias -> ingest source sync。
- recompute-strategy alias -> recompute optimize target projection。

## 4. Test And Production Acceptance

每个 rc 本地必须跑：

```bash
cd media-service && npm test
cd media-service && npm run build:web
```

相关 focused tests 必须覆盖：

- config migration / compatibility。
- Task Creator allow-list and admission checks。
- BusinessFlowPolicy task target selection。
- scrape metadata gate。
- optimize operation authorization。
- SmartTask queue / cooldown / duplicate active-task。
- priority-engine target gate calculation and legacy action compatibility。
- resource capacity by resource key and legacy concurrency compatibility。

每个 rc 生产验收必须符合：

- 使用标准部署脚本，不手改生产数据。
- 浏览器打开 dashboard、media、tasks、settings，无全页 loading、无控制台错误。
- API 计时 `/v1/health`、`/v1/admin/dashboard/health`、`/v1/library`、`/v1/config`、`/v1/tasks`。
- 检查 queue length、DB / WAL、日志、失败事件。
- 自动能力一次只恢复一项，上一步稳定后再进入下一项。

## 5. Guardrails

- 不提交 `docs/v3/PRODUCTION_STAGE_AUDIT_20260701.md`，除非单独确认它应进入版本。
- 不把资源、DB / WAL、payload、I/O guard、diagnostic log 放回普通前端。
- 不新增绕过 Task Creator 准入校验的自动任务入口。
- 不把 flow operation 当成 task target。
- 不让 Resource Runtime 或 scheduler 反向决定 Lifecycle objective。
- 不让 Scheduler 根据业务规则重算 priority。
- 不在未备份、未 dry-run、未显式确认时修改生产数据。
- 未经明确授权，不再自行修改 `docs/v3/KAIROX_ARCHITECTURE.md`。

## 6. Out Of Scope For v3.3 GA

- 不恢复 automatic `upgrade`。
- 不恢复 automatic `delete`。
- 不把 `upgrade` / `delete` 作为 v3.3 GA 默认自动能力。
- 后续另开专项处理 `upgrade flow` 和 `delete flow`，包括风险确认、资源容量、flow recovery、用户语义和生产验收。
