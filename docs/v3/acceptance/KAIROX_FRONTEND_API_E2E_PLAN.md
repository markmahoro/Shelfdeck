# Kairox Frontend/API E2E 验收计划

## 1. 总目标

本 E2E 验收不是页面 smoke，也不是单个 API smoke。验收通过后必须证明：

1. ShelfDeck 前后端主路径已经按 Kairox 架构运行。
2. 用户视角核心业务链路已经跑通。

目标链路：

```text
用户可理解前端状态
-> API projection 表达 Kairox 语义
-> source/media/metadata facts 与 user perception facts 就位
-> Lifecycle 计算 gate / objective / eligibility
-> Task Creator 创建 object + targetGate + gateObjective task
-> Flow Planner 选择 flowPlan.flowKind
-> Resource Runtime / Executor 执行 flow event
-> staged facts / event evidence / fact refresh request
-> canonical facts refresh
-> Lifecycle 判定 gate achievement
-> archive
-> delete review
-> confirmed delete
```

本验收要特别证明三条硬边界：

```text
Task / Flow execution result is not Gate achievement.
Event retry budget is not Task attempt budget.
Refresh signal is not a chained task.
```

生产目标：

```text
http://192.168.12.230:18080
```

生产测试库：

```text
公共 国产剧库
```

当前建议 canary：

```text
81945 / 爱很美味 / Season 1
```

destructive 验收只允许作用于明确选中的 canary item。除非用户另行明确授权，不能扩大到整库 destructive 操作。

## 2. 执行前置条件

正式生产 E2E 前必须确认：

- 本地 `npm test` 通过。
- 本地 `npm run build:web` 通过。
- 修复 `Gate Achievement / Task Attempt / Event Retry` 边界的代码已经部署到生产。
- 生产部署记录写入 `docs/v3/CURRENT_STATUS.md`。
- 当前 canary item 已在 Emby 中刷新，并能从 ShelfDeck 读取。
- 若生产仍运行旧镜像，不进入 Stage 0 之后的 destructive 验收。

## 3. 验收原则

- 先只读预检，再进入 destructive 验收。
- 每个 stage 都是 gate。前一 stage 失败时，不继续假跑后一 stage。
- 每个 stage 都要给出 `PASS / FAIL / BLOCKED / SKIPPED`。
- `FAIL` 表示系统行为违反 Kairox 或业务链路不通，需要修代码。
- `BLOCKED` 表示环境、数据或外部依赖不足，需要补测试条件或用户确认。
- `SKIPPED` 只能用于本轮明确不覆盖的能力，例如 upgrade 真实下载执行。
- 不允许用 Mirex 字段绕过失败，例如 `actionType`、`operationKind`、top-level `selectedFlow`、`transcode candidate`。
- 如果验收发现架构语义不清，先更新 Kairox 文档或 playbook，再修实现。
- 文案不精确但不误导业务语义时，记录 P2，不阻塞业务链路验收。

## 4. Stage Gates

### Stage 0: 生产只读预检

证明目标：

- 生产服务可访问。
- 测试库存在。
- 当前生产状态适合进入 E2E。
- 不会在未知 active task 或异常状态下执行 destructive 操作。

执行：

- 记录 git commit、镜像 tag、时间、生产 URL、测试库名。
- 拉取：
  - `/v1/health`
  - dashboard health
  - library manage projection
  - task list
  - delete candidates
  - config / automation policy / delete policy
- 查询 `公共 国产剧库`。
- 查询 canary item `81945`。
- 查询 active tasks 和 awaiting confirmation tasks。

通过标准：

- 服务健康 API 返回成功。
- 测试库可读。
- canary item 可读。
- Dashboard、媒体库、任务中心、处置队列相关 API 秒级返回。
- 没有阻止验收的生产异常。

失败后动作：

- `health` 不通过：停止 E2E，先修生产服务。
- 测试库不可读：停止 E2E，先修媒体库配置或选择新测试库。
- canary item 不存在：停止 E2E，先重新刷新 Emby 或选择新 canary。
- active task 大量堆积：停止 destructive，先做任务队列状态审计。
- API 慢到不可用：停止业务 E2E，转入性能/控制面问题排查。

### Stage 1: 前端 Kairox 投影 smoke

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

### Stage 2: Canary facts baseline

证明目标：

- canary 当前 facts 可读。
- API projection 能按 Kairox facts ownership 展示媒体真实状态。

执行：

- 读取 canary detail / manage projection。
- 记录：
  - `sourceFacts`
  - `mediaFacts`
  - `metadataFacts`
  - `userPerceptionFacts`
  - `gateFacts`
  - `factsFreshness`
  - `lifecycle`
  - `activeTask`
  - `deleteCandidate`

通过标准：

- facts 分组可见。
- `source/media/metadata/userPerception/gate` 不混写。
- `factsFreshness` 可解释当前是否 fresh / stale / invalidated。
- canary 没有未知 active duplicate task。

失败后动作：

- facts 分组缺失：补 API projection。
- freshness 缺失：修 facts freshness projection。
- 当前 item 状态不可控：先清理 canary 任务状态或换 canary。

### Stage 3: Ingest / metadata freshness ownership

证明目标：

- `sourceFacts / ingestFacts` 由 ingest task 刷新。
- `mediaFacts / metadataFacts` 由 metadata task 刷新。
- 不存在 Mirex 式直接 refresh 写权威事实绕过 task 的主路径。

执行：

- 对 canary 或测试库触发公开 ingest scan intent。
- 观察是否通过 SmartTaskEngine / TaskAdmission 生成 `targetGate=ingest` task。
- 推进 ingest task。
- 若 media/metadata stale，创建并推进 `targetGate=metadata` task。
- 重新读取 facts 和 freshness。

通过标准：

- ingest task 只负责 source/ingest ownership。
- metadata task 负责 media/metadata ownership。
- refresh intent 不是独立 targetGate 或 flowKind。
- executor 不链式创建后续 task。
- freshness 从 stale/invalidated 变为 fresh 有明确 owner 证据。

失败后动作：

- domain module 直接 createTask：修 Source Adapter / Task Creator 边界。
- refresh 直接写 canonical facts：修 fact ownership。
- ingest / metadata 职责混写：修对应 executor 或 projection。
- 任务绕过 TaskAdmission：P0，先修 admission 主路径。

### Stage 4: User perception

证明目标：

- 用户感知是独立 facts。
- metadata gate 不等待用户感知。
- 用户感知变化不会直接创建 task。

执行：

- 记录初始 userPerceptionFacts 和 active tasks。
- 使用用户评分 API 修改 canary 评分。
- 重新读取 media projection 和 active tasks。

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

### Stage 5: Lifecycle objective projection

证明目标：

- Lifecycle owns objective readiness / revision。
- Task Creator 不自己比较 rating、watched、objectiveHash。

执行：

- 对 canary 触发 objective recompute 或等待 Lifecycle projection。
- 修改评分，使目标层级尽量发生变化。
- 读取 objective status、objectiveHash、objectiveVersion、lifecycleNextTask。

通过标准：

- metadata/media facts 完整时，Lifecycle 可以计算 optimize objective。
- perception 不足时是 `pending_perception`。
- perception 变化后 Lifecycle 会重新投影。
- 如果命中的目标变了，`objectiveHash/objectiveVersion` 应变化。
- 如果目标没变，`objectiveHash` 可以不变，但 projection 应能证明重新评估过。
- 若当前 facts 不满足目标，Lifecycle 投影 `lifecycleNextTask=optimize`。
- 若当前 facts 满足目标，不创建 optimize task。

失败后动作：

- objective 仍表达 action/delete：修 objective template / resolver。
- Task Creator 自行判断 objective revision：修 Task Creator 边界。
- objective 缺解释：补 lifecycle projection explanation。

### Stage 6: Task Creator / Admission

证明目标：

- 任务主身份是 `object + targetGate + gateObjective`。
- 创建任务必须经过 TaskAdmission。
- 重复 task attempt 防风暴属于 TaskCreationPolicy，不属于 Lifecycle。

执行：

- 对 optimize canary 创建 optimize intent。
- 请求体主路径只允许：

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
- 同一 `itemId + targetGate` active duplicate 被拒绝。
- 自动模式同 attemptKey 达到上限后返回 `automatic_attempt_limit_reached`。
- manual intent 可绕过 automatic attempt limit，但不能绕过 active duplicate、facts freshness、objective readiness 和安全策略。
- 新任务不依赖 `actionType`、`operationKind`、top-level `selectedFlow`。

失败后动作：

- 仍要求 selectedFlow：修手动 task API / 前端请求。
- duplicate 按 flow 防重：修 TaskAdmission / taskCreationPolicy。
- 自动入口绕过 TaskAdmission：修对应 source adapter 或 SmartTaskEngine。
- Lifecycle 因失败 attempt 停止投影 optimize：修 Lifecycle gate boundary。

### Stage 7: Flow Planner selection

证明目标：

- Flow Planner 是唯一 flow selection 点。
- optimize 覆盖 `no_op / transcode / blocked / upgrade explanation`。
- delete 不可能作为 optimize flow。

执行：

- 使用 canary 当前 facts 和 objective 验证本地转换可满足时选择 `transcode`。
- 用只读或脚本构造验证：
  - 已满足目标 -> `no_op`
  - 事实不足 -> `blocked`
  - 源质量不足 -> `upgrade` 或 `blocked_needs_upgrade`

通过标准：

- flow 只出现在 `flowPlan.flowKind`。
- explanation 包含 current facts、target facts、gap、reason。
- 用户 flow preference 只能作为重新规划输入，不能直接 dispatch executor。
- optimize flow 不出现 delete。
- Task Creator 不预选 flow。
- Scheduler 不选择 flow。

失败后动作：

- Task Creator 预选 flow：修 Task Creator。
- Scheduler 选择 flow：修 Scheduler / Resource Runtime 边界。
- delete-as-optimize：P0，立即停止后续 destructive，先修 delete gate。
- explanation 不足：补 Flow Planner projection。

### Stage 8: Resource Runtime / execution

证明目标：

- Scheduler 只调度 runnable task。
- Resource Runtime / Executor 执行 flow event。
- task 执行过程对用户和 API 可解释。
- event retry 不等于 task attempt retry。

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
- task 内部 `retryCount/resumePoint` 只表达 event retry / recovery。
- flow attempt failed 不写成 optimize gate failed。

失败后动作：

- Scheduler 做 executor routing：修 Resource Runtime 边界。
- executor 私自创建 task：修 executor。
- task 没有 recovery 解释：补 flow recovery contract。
- flow failure 写 gate failed：修 gate / runtime 边界。
- 控制面变慢：停止业务推进，转性能排查。

### Stage 9: Post-optimize canonical refresh

证明目标：

- optimize 不是 executor 说完成就完成。
- transcode / upgrade 不能直接发布 source/media/metadata canonical facts。
- 物理结果激活后必须进入 `pending_canonical_refresh`。

执行：

- optimize flow 完成后读取媒体 projection。
- 检查 task events、staged facts、verify evidence、fact refresh request。
- 检查 factsFreshness 和 optimize gate projection。

通过标准：

- transcode / upgrade executor 写 staged facts / event evidence。
- executor 不直接发布 source/media/metadata canonical facts。
- executor 不直接判定 optimize passed。
- 权威事实未刷新时显示 `optimizeGate.status=pending_canonical_refresh`。
- Lifecycle 在 pending refresh 下不重复投影 optimize task。
- 下一步只投影为 `targetGate=ingest` 或 `targetGate=metadata`。

失败后动作：

- executor 直接发布非 owner canonical facts：修 fact ownership。
- 无 pending refresh 且 facts 明显过期：修 Lifecycle freshness。
- pending refresh 仍重复创建 optimize：修 Lifecycle / Task Creator。
- pending refresh 没有 ingest/metadata 下一步：修 Lifecycle projection。

### Stage 10: Refresh 后 gate achievement

证明目标：

- gate 是否达成回到 Lifecycle 和权威事实。
- flow attempt result 与 gate achievement 分离。

执行：

- 按 `lifecycleNextTask` 创建并推进 `targetGate=ingest` 或 `targetGate=metadata` refresh task。
- 等待刷新完成。
- 重新读取 media projection。
- 由 Lifecycle 基于 refreshed canonical facts 判断 optimize gate。

通过标准：

- ingest / metadata refresh 完成后 factsFreshness 变为 fresh。
- canonical media facts 反映实际物理结果。
- 若满足 objective，`optimizeGate.status=passed`。
- 若不满足 objective，`optimizeGate.status=not_passed`，reason 是 objective mismatch，不是 flow attempt failed。
- 旧 failed attempt evidence 不阻断新的 lifecycle projection。

失败后动作：

- ingest / metadata refresh 无法通过 TaskAdmission：修 Task Creator / Admission。
- refresh 后 facts 不变：修 ingest / metadata owner。
- objective 满足但 gate 不 passed：修 Lifecycle gate evaluation。
- objective 不满足却 gate passed：P0，修 Lifecycle gate evaluation。

### Stage 11: Archive gate

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

### Stage 12: Delete candidate review

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

### Stage 13: Confirmed delete

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

### Stage 14: Kairox / Mirex 残留审计

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
  - 历史文档。
  - 一次性 migration/cutover 输入。
  - 负向测试。
  - 明确注释的 legacy adapter/type compatibility。

失败后动作：

- P0 残留：停止宣称 Kairox 化，先修 runtime/API/UI 主路径。
- P1 残留：进入 cleanup 分支，修完后重跑相关 E2E stage。
- P2 残留：记录，不阻塞业务验收。

### Stage 15: 控制面性能 smoke

证明目标：

- 后台任务运行时，用户仍能使用控制面。
- 本轮不宣称完成性能优化，只证明 Beta 业务可用。

执行：

- 在任务运行或刚完成后访问：
  - `/v1/health`
  - dashboard health
  - library list / manage projection
  - task list
  - delete candidates
  - config / policies

通过标准：

- API 均返回成功。
- 正常 page-size 秒级返回。
- 后台任务不导致 Dashboard / 媒体库 / 任务中心不可用。
- 无同 item + targetGate duplicate active task。
- queue 不出现明显失控增长。

失败后动作：

- 控制面不可用：停止 GA 判断，转入性能/调度问题。
- duplicate active task：修 TaskAdmission / task store query。
- queue 失控：修 SmartTaskEngine supply policy。

## 5. 验收报告

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

## 6. 执行命令

基础验证：

```bash
cd media-service && npm test
cd media-service && npm run build:web
```

生产只读预检：

```bash
cd media-service
node scripts/kairox-frontend-api-e2e.js --base-url=http://192.168.12.230:18080 --frontend-url=http://192.168.12.230:18080 --mode=readonly --allow-production --library-name="公共 国产剧库" --canary-item-id=81945 --out=../docs/v3/acceptance/KAIROX_FRONTEND_API_E2E.md --state=../docs/v3/acceptance/.kairox_frontend_api_e2e_state.json
```

生产 destructive E2E：

```bash
cd media-service
node scripts/kairox-frontend-api-e2e.js --base-url=http://192.168.12.230:18080 --frontend-url=http://192.168.12.230:18080 --mode=destructive --allow-production --confirm-destructive-e2e --library-name="公共 国产剧库" --canary-item-id=81945 --out=../docs/v3/acceptance/KAIROX_FRONTEND_API_E2E.md --state=../docs/v3/acceptance/.kairox_frontend_api_e2e_state.json
```

单 stage 执行时使用：

```bash
--stage=stage0
```

后续 stage 依次替换为 `stage1` 到 `stage15`。如果某 stage `FAIL` 或 `BLOCKED`，停止，不跳 stage。

## 7. 完成判定

只有同时满足以下条件，才算本次 E2E 验收通过：

- 前端主要页面表达 Kairox 主语义。
- API projection 能解释 facts、freshness、lifecycle、objective、task、delete candidate。
- ingest / metadata / perception 的 fact ownership 正确。
- user perception 更新不直接创建 task。
- Lifecycle 能正确投影 objective readiness / revision。
- Task Creator 创建 targetGate task。
- TaskAdmission / TaskCreationPolicy 能防 active duplicate 和 automatic attempt storm。
- Flow Planner 选择 flow。
- Resource Runtime / Executor 执行 flow event 并写证据。
- flow attempt result 不等于 gate achievement。
- event retry 不等于 task attempt budget。
- optimize 后经过 canonical refresh 再判 gate。
- archive / delete gate 独立闭环。
- delete 是 review-first。
- destructive delete 只作用于 canary。
- 无 delete-as-optimize。
- 无 P0/P1 Mirex 主路径残留。
