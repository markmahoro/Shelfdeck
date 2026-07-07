# Kairox Frontend/API E2E 验收计划

## 1. 总目标

本 E2E 验收不是单纯验证页面可打开，也不是只验证某个 API smoke。验收通过后必须能够证明两件事：

1. ShelfDeck 前后端架构主路径已经完全 Kairox 化。
2. 用户视角的核心业务流程已经跑通。

目标链路：

```text
用户可理解前端状态
-> API projection 表达 Kairox 语义
-> source/media/metadata facts 与 user perception facts 就位
-> Lifecycle 计算 gate / objective / eligibility
-> Task Creator 创建 object + targetGate + gateObjective task
-> Flow Planner 选择 flowPlan.flowKind
-> Resource Runtime / Executor 执行 flow event
-> gate facts / event evidence 写入
-> archive
-> delete review
-> confirmed delete
```

生产目标：

```text
http://192.168.12.230:18080
```

生产测试库：

```text
公共 国产剧库
```

destructive 验收只允许作用于明确选中的 canary item。除非用户另行明确授权，不能扩大到整库 destructive 操作。

## 2. 验收原则

- 先只读预检，再进入 destructive 验收。
- 每个阶段都是 gate。前一阶段失败时，不继续假跑后一阶段。
- 每个阶段都要给出 `PASS / FAIL / BLOCKED / SKIPPED`。
- `FAIL` 表示系统行为违反 Kairox 或业务链路不通，需要修代码。
- `BLOCKED` 表示环境、数据或外部依赖不足，需要补测试条件或用户确认。
- `SKIPPED` 只能用于本轮明确不覆盖的能力，例如 upgrade 真实下载执行。
- 不允许用 Mirex 字段绕过失败，例如 `actionType`、`operationKind`、top-level `selectedFlow`、`transcode candidate`。
- 如果验收发现架构语义不清，先更新 Kairox 文档或 playbook，再修实现。

## 3. 阶段门禁

### Stage 0: 只读生产预检

证明目标：

- 生产服务可访问。
- 测试库存在。
- 当前生产状态适合进入 E2E。
- 不会在未知 active task 或异常状态下执行 destructive 操作。

执行：

- 记录 git commit、时间、生产 URL、测试库名。
- 拉取：
  - `/v1/health`
  - dashboard health
  - library manage projection
  - task list
  - delete candidates
  - config / automation policy / delete policy
- 查询 `公共 国产剧库` 条目。
- 查询 active tasks 和 awaiting confirmation tasks。

通过标准：

- 服务健康 API 返回成功。
- 测试库可读。
- Dashboard、媒体库、任务中心、处置队列相关 API 秒级返回。
- 没有阻止验收的生产异常。

失败后动作：

- `health` 不通过：停止 E2E，先修生产服务。
- 测试库不可读：停止 E2E，先修媒体库配置或选择新测试库。
- active task 大量堆积：停止 destructive，先做任务队列状态审计。
- API 慢到不可用：停止业务 E2E，转入性能/控制面问题排查。

### Stage 1: 前端 Kairox 投影验收

证明目标：

- 用户能从前端理解系统是否正常、媒体库管理成果、媒体当前事实、任务进程和处置队列。
- 前端主语义是 Kairox，不是 Mirex。

执行页面：

- Dashboard
- 媒体库
- 任务中心
- 处置队列
- 管理策略
- 高级

通过标准：

- Dashboard 展示服务健康和媒体库管理成果，不把 DB/WAL/resource bucket 当普通用户主路径。
- 媒体库展示 facts 分组、lifecycle、objective、next action。
- 任务中心按 targetGate / status / attention 组织，flowKind 只作为实现路径细节。
- 处置队列展示 delete candidate review，不把 delete 表达为 optimize。
- 管理策略表达媒体优化目标、用户感知、自动化策略、处置策略。
- 高级页才展示资源和诊断信息。
- 页面无全页 crash，无关键 console error。

失败后动作：

- 页面崩溃：先修前端连接或 API projection。
- 页面依赖 Mirex 主语义：修前端 projection adapter，不继续业务 E2E。
- API 缺 Kairox projection：先补后端 projection，再继续。
- 只是文案不精确但语义不误导：记录 P2，不阻塞业务链路验收。

### Stage 2: Fact ownership 与 metadata/perception 分离

证明目标：

- 权威事实 ownership 符合 Kairox。
- metadata gate 不等待用户感知。
- 用户感知变化不会直接创建 task。

执行：

- 选择 perception canary。
- 记录初始 source/media/metadata/userPerception/gate facts。
- 使用用户评分 API 修改评分。
- 重新读取媒体 projection 和 active tasks。

通过标准：

- `userPerceptionFacts.rating` 更新。
- `perceptionVersion` 或 `perceptionUpdatedAt` 更新。
- metadata missing reasons 不包含：
  - `decision.rating`
  - `decision.watched`
  - `userRating`
  - `doubanRating`
  - `watched`
  - `playCount`
- perception API 不直接创建 task。
- 如果策略需要评分但评分缺失，应显示 `pending_perception`，不是 metadata missing。

失败后动作：

- 评分写到 metadata：修 User Perception Management / projection。
- metadata gate 仍要求评分：修 metadata gate required facts。
- perception API 直接创建 task：修 perception 写入边界。
- projection 看不到 facts 分组：补 API projection 或前端 adapter。

### Stage 3: Lifecycle objective projection

证明目标：

- Lifecycle owns objective readiness / revision。
- Task Creator 不自己比较 rating、watched、objectiveHash。

执行：

- 对 canary 触发 objective recompute。
- 修改评分，使目标层级发生变化。
- 读取 objective status、objectiveHash、objectiveVersion、lifecycleNextTask。

通过标准：

- metadata/media facts 完整时，Lifecycle 可以计算 optimize objective。
- perception 不足时是 `pending_perception`。
- 评分变化导致目标变化时，objectiveHash/objectiveVersion 变化。
- 若当前事实不满足新目标，Lifecycle 投影 `lifecycleNextTask=optimize`。
- 若当前事实满足目标，不创建 optimize task。

失败后动作：

- objective 仍表达 action/delete：修 objective template / resolver。
- Task Creator 自行判断 objective revision：修 Task Creator 边界。
- objective 缺解释：补 lifecycle projection explanation。

### Stage 4: Task Creator / Admission

证明目标：

- 任务主身份是 `object + targetGate + gateObjective`。
- 创建任务必须经过 TaskAdmission。

执行：

- 从前端或 API 对 optimize canary 创建 optimize intent。
- 请求体只允许：

```json
{
  "itemId": "...",
  "targetGate": "optimize",
  "gateObjective": {}
}
```

通过标准：

- 新任务 `taskTarget.targetGate=optimize`。
- `gateObjective` 是 gate 目标合同。
- task 创建响应包含 admission 结果或拒绝原因。
- 同一 `itemId + targetGate` 重复创建会被 duplicate prevention 拒绝。
- 新任务不依赖 `actionType`、`operationKind`、top-level `selectedFlow`。

失败后动作：

- 仍要求 selectedFlow：修手动 task API / 前端请求。
- duplicate 按 flow 防重：修 TaskAdmission / taskCreationPolicy。
- 自动入口绕过 TaskAdmission：修对应 source adapter 或 SmartTaskEngine。

### Stage 5: Flow Planner selection

证明目标：

- Flow Planner 是唯一 flow selection 点。
- optimize 覆盖 `no_op / transcode / blocked / upgrade explanation`。
- delete 不可能作为 optimize flow。

执行：

- 使用不同 canary 或不同目标配置，验证：
  - 已满足目标 -> `no_op`
  - 本地转换可满足 -> `transcode`
  - 事实不足或授权不足 -> `blocked`
  - 源质量不足 -> `upgrade` 或 `blocked_needs_upgrade`

通过标准：

- flow 只出现在 `flowPlan.flowKind`。
- explanation 包含 current facts、target facts、gap、reason。
- 用户 flow preference 只能作为重新规划输入，不能直接 dispatch executor。
- optimize flow 不出现 delete。

失败后动作：

- Task Creator 预选 flow：修 Task Creator。
- Scheduler 选择 flow：修 Scheduler / Resource Runtime 边界。
- delete-as-optimize：P0，立即停止后续 destructive，先修 delete gate。
- explanation 不足：补 Flow Planner projection。

### Stage 6: Resource Runtime / execution

证明目标：

- Scheduler 只调度 task。
- Resource Runtime / Executor 执行 flow event。
- task 执行过程对用户和 API 可解释。

执行：

- 推进 optimize task。
- 观察 task status、events、progress、controlState。
- 若需要用户确认，执行确认。
- 若失败，观察 recovery / retry / failure explanation。

通过标准：

- task 有 event evidence。
- progress/controlState 可见。
- Resource Runtime 按 `flowPlan.flowKind` 执行。
- executor 不创建后续 task。
- 失败时不会无限重试。

失败后动作：

- Scheduler 做 executor routing：修 Resource Runtime 边界。
- executor 私自创建 task：修 executor。
- task 没有 recovery 解释：补 flow recovery contract。
- 控制面变慢：停止业务推进，转性能排查。

### Stage 7: Optimize gate 与 canonical refresh

证明目标：

- optimize 不是 executor 说完成就完成。
- gate 判断回到 Lifecycle 和权威事实。

执行：

- optimize flow 完成后读取媒体 projection。
- 检查 optimize gate facts、objectiveHash、event evidence。
- 若显示 `pending_canonical_refresh`，按 `lifecycleNextTask` 只通过公开 API 创建 `targetGate=ingest` 或 `targetGate=metadata` 刷新任务。
- 等待 ingest / metadata 刷新完成后重新读取媒体 projection。
- 再由 Lifecycle 基于刷新后的 canonical facts 判断 optimize gate。

通过标准：

- optimize gate facts 与 gateObjective/objectiveHash 对齐。
- transcode / upgrade executor 不直接发布 source/media/metadata canonical facts。
- 权威事实未刷新时显示 `pending_canonical_refresh`，且下一步只投影为 `ingest` 或 `metadata`。
- ingest / metadata 刷新完成后，Lifecycle 可投影 optimize passed；若不满足目标，必须给出 blocked/mismatch 原因。
- 不会基于旧 mediaFacts 重复创建 optimize task。

失败后动作：

- executor 直接发布非 owner canonical facts：修 fact ownership。
- 无 pending refresh 且 facts 明显过期：修 Lifecycle freshness。
- pending refresh 没有 `ingest/metadata` 下一步：修 Lifecycle projection。
- ingest / metadata refresh 无法通过 TaskAdmission：修 Task Creator / Admission。
- 重复创建 optimize：修 Lifecycle/Task Creator 对 pending refresh 的处理。

### Stage 8: Archive gate

证明目标：

- archive 是独立 gate，不是生命周期永久终点。

执行：

- 创建或等待 archive task。
- 推进 archive task。
- 读取 archive facts/history。

通过标准：

- task 为 `targetGate=archive`。
- archive facts/history 写入。
- item 进入 archived / archived-like。
- archived item 可进入 delete eligibility。
- archive flow 不创建 delete task。

失败后动作：

- archive 与 optimize 混在一起：修 Lifecycle gate。
- archive 后无法进入 delete eligibility：修 deleteCandidateService / Lifecycle。
- archive flow 创建 delete：P0，停止 destructive，先修 flow 边界。

### Stage 9: Delete candidate review

证明目标：

- delete 是 review-first 的独立 gate。
- 低评分 archived item 不在 optimize 阶段删除。

执行：

- 将 delete canary 调整为低评分。
- 确认 delete policy 命中。
- 查询处置队列。

通过标准：

- item 出现在 delete candidates。
- candidate 展示 matched rule、archived age、perception summary。
- 未确认前没有 destructive delete task。
- 前端有确认删除、继续已归档、延后、不再建议动作。

失败后动作：

- 低评分触发 optimize delete：P0，立即修正。
- 未确认就创建 delete task：修 delete review / destructive authorization。
- candidate 无解释：补 delete candidate projection。

### Stage 10: Confirmed delete

证明目标：

- 用户确认后才进入 destructive delete。
- delete gate 不污染 optimize/archive gate。

执行：

- 对 delete candidate confirm delete。
- 推进 delete task。
- 读取 task、events、delete gate facts、archive history。

通过标准：

- 创建 `targetGate=delete` task。
- delete flow 只属于 delete gate。
- 不出现 `optimize.delete`。
- delete gate facts 写入。
- archive facts 保留历史。
- optimize gate 不被 delete facts 覆盖。
- destructive 操作只作用于 canary item。

失败后动作：

- delete 写 optimize gate：P0，修 delete executor / gate facts。
- archive history 丢失：修 delete flow。
- 删除范围超出 canary：立即停止，按生产事故处理。

### Stage 11: Kairox/Mirex 残留审计

证明目标：

- 前后端主路径没有 Mirex 语义残留。

执行：

```bash
rg -n "SelectedFlow|selectedFlow|preferredFlow|businessFlowDecision|transcode candidate|scrape candidate|upgrade candidate" media-service/web/src
rg -n "actionType|operationKind|operation_kind|selectedOperation|bySelectedFlow|optimize\\.delete|remove_media" media-service/src media-service/test
```

通过标准：

- P0/P1 残留为 0。
- 允许残留只能属于：
  - 历史文档
  - 一次性 migration/cutover 输入
  - 负向测试
  - 明确注释的 legacy adapter/type compatibility

失败后动作：

- P0 残留：停止宣称 Kairox 化，先修 runtime/API/UI 主路径。
- P1 残留：进入 cleanup 分支，修完后重跑相关 E2E stage。
- P2 残留：记录，不阻塞业务验收。

## 4. 验收报告

实际验收报告输出：

```text
docs/v3/acceptance/KAIROX_FRONTEND_API_E2E.md
```

报告必须包含：

- run metadata。
- 生产目标和测试库。
- canary item 列表。
- 每个 stage 的 `PASS / FAIL / BLOCKED / SKIPPED`。
- 每个失败 stage 的下一步动作。
- API timing。
- 前端页面记录。
- destructive 操作清单。
- 关键 API 响应摘要。
- Kairox 语义断言结果。
- 未覆盖风险。

## 5. 执行命令

基础验证：

```bash
cd media-service && npm test
cd media-service && npm run build:web
```

生产只读预检：

```bash
cd media-service
node scripts/kairox-frontend-api-e2e.js --base-url=http://192.168.12.230:18080 --frontend-url=http://192.168.12.230:18080 --mode=readonly --allow-production --library-name="公共 国产剧库" --out=../docs/v3/acceptance/KAIROX_FRONTEND_API_E2E.md --state=../docs/v3/acceptance/.kairox_frontend_api_e2e_state.json
```

生产 destructive E2E：

```bash
cd media-service
node scripts/kairox-frontend-api-e2e.js --base-url=http://192.168.12.230:18080 --frontend-url=http://192.168.12.230:18080 --mode=destructive --allow-production --confirm-destructive-e2e --library-name="公共 国产剧库" --out=../docs/v3/acceptance/KAIROX_FRONTEND_API_E2E.md --state=../docs/v3/acceptance/.kairox_frontend_api_e2e_state.json
```

## 6. 完成判定

只有同时满足以下条件，才算本次 E2E 验收通过：

- 前端主要页面表达 Kairox 主语义。
- API projection 能解释 facts、lifecycle、objective、task、delete candidate。
- user perception 更新不直接创建 task。
- Lifecycle 能正确投影 objective readiness/revision。
- Task Creator 创建 targetGate task。
- Flow Planner 选择 flow。
- Resource Runtime/Executor 执行 flow event 并写证据。
- optimize/archive/delete gate 独立闭环。
- delete 是 review-first。
- destructive delete 只作用于 canary。
- 无 delete-as-optimize。
- 无 P0/P1 Mirex 主路径残留。
