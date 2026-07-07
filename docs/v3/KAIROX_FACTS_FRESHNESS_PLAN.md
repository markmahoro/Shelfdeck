# Kairox Facts Freshness 业务能力设计与实施计划

## 1. 背景

Facts Freshness 是 Kairox 架构下的独立业务能力，不是为了让某个 E2E 样本继续跑而做的临时补丁。

它要解决的问题是：

```text
ShelfDeck 里的 source/media/metadata facts 不仅要“字段完整”，还要“仍然可信、仍然是最新认知”。
```

本轮 Frontend/API E2E 在 `公共_国产剧` 测试库中暂停，只是暴露了这个能力缺口。当前 E2E 直接原因是：

- 已把 `漫长的季节 (2023)/Season 1` 的 12 集真实文件切成约 1 分钟。
- 磁盘上的 episode 文件已经变小，`ffprobe` 可读到新 duration / size。
- Emby 刷新后，ShelfDeck 里的 season item 仍显示旧聚合 facts：
  - `size=39503732315`
  - `duration=49092`
  - `bitrate=6437502`
- 尝试通过 Kairox task 创建 `targetGate=metadata` 刷新 facts 时，被 TaskAdmission 拒绝：
  - `metadata_already_complete`

这说明当前实现仍把“字段完整”当成“事实有效”，没有把 Kairox 文档中已经定义的 freshness 模型落到工程里。

这不是 E2E 脚本问题，也不应通过直接改 DB、临时调用内部函数或在 transcode 参数里截断输出绕过。它暴露的是 Kairox 核心链路缺口：

```text
gate passed = required facts complete + required facts fresh + required facts satisfy gate objective
```

当前实现只覆盖了 `complete`，没有系统性覆盖 `fresh`。

因此本计划的主目标是完整补全 Facts Freshness 业务逻辑，并为该业务能力建立独立测试。E2E 恢复是并行验收项目，不是本能力的设计驱动力。

## 1.1 总目标

交付一个完整的 Facts Freshness 能力：

```text
Source Adapter observes external source
-> writes observation / stale signal / factRefreshRequest
-> Lifecycle projects facts freshness and next target gate
-> Task Creator creates targetGate refresh task through TaskAdmission
-> ingest / metadata task refreshes canonical facts
-> Lifecycle re-evaluates gates with complete + fresh facts
-> Frontend explains current facts, freshness, stale reason, and refresh action
```

完成后应满足：

- 用户能看懂一个媒体的事实是否可信。
- 系统能区分 `missing`、`needs_check`、`stale`、`fresh`。
- 自动巡检只观察 source，不直接推进生命周期。
- stale 才会阻断相关 gate。
- 手动 refresh intent 可以重新识别媒体，但仍走 TaskAdmission。
- metadata complete 但 stale 时可以创建 metadata refresh task。
- metadata complete 且 fresh 时不会重复创建无意义 task。
- transcode / upgrade 激活物理结果后，不能绕过 owner task 直接发布 media canonical facts。
- 旧 “refresh media library” 不再作为前端主业务模型。

## 2. 审计结论

### 2.1 Kairox 文档现有约定

`KAIROX_ARCHITECTURE.md` 和 `KAIROX_ENGINEERING_PLAYBOOK.md` 已经确认：

- Kairox 没有 `refresh` 这个一等概念。
- 旧 `refresh / startup refresh / manual refresh / scheduled refresh` 应收口为 `ingest` 或 `metadata` target gate。
- `sourceFacts / ingestFacts` 的权威刷新来源应是 `targetGate=ingest`。
- `mediaFacts / metadataFacts` 的权威刷新来源应是 `targetGate=metadata`。
- `transcode / upgrade / archive / delete` 只能写 staged facts、event evidence、fact refresh request，不能直接发布非 owner 的 canonical facts。
- `pending_canonical_refresh` 是 optimize flow 激活物理结果后、权威事实尚未刷新时应使用的状态。

因此本计划不是修改 Kairox 方向，而是补齐实现。

### 2.2 当前实现中的 Mirex / refresh 残留

| 位置 | 当前行为 | 问题 | 处理方向 |
| --- | --- | --- | --- |
| `app.js` `/v1/library/actions/refresh` | 直接调用 `mediaLibraryService.triggerIngest(subLibraryId)` | 旧“刷新媒体库”入口绕过 task / TaskAdmission；语义不区分 ingest facts 与 metadata facts | 退役为 API adapter；新主路径改成创建 `targetGate=ingest` 或 `targetGate=metadata` refresh intent |
| `app.js` `/v1/library/actions/ingest` | 同样直接调用全库 ingest | 对 Emby 库不是 task；无法被任务中心解释、重试、限流、审计 | 保留短期兼容读入口，但前端主路径不调用；新增 Kairox task 主路径 |
| `mediaLibraryService.ingestSubLibrary()` | 从 Emby 拉全库 inventory 并直接 upsert | 作为内部实现能力可保留，但不应是用户/自动化主语义 | 改为 ingest flow executor 或 domain adapter 后端能力 |
| `mediaLibraryService.completeEmbyItemMetadata()` | 能拉单 item，season 时能拉 episodes 并重新聚合 | 能力正确，但未作为 freshness refresh task 正式暴露 | 作为 `targetGate=metadata` / `flowKind=scrape` 或 `metadata_repair` 的 executor 能力 |
| `taskCreationPolicy.js` | `targetGate=metadata && metadataComplete=true` 直接拒绝 | 把 complete 等同于 fresh，阻断手动或 lifecycle 驱动的 refresh | 改成只有 `complete && fresh && no explicit refresh intent` 才拒绝 |
| `scrapeFlowExecutor.runEmbyExecuting()` | live metadata complete 时直接跳过 repair | metadata task 即使被创建，也无法刷新 stale facts | 改为尊重 `gateObjective.refreshReason / factRefreshRequest / forceRefresh` |
| `lifecycleProjection.js` | 只看 `metadataComplete`，不看 freshness | 字段齐但过期仍进入 optimize/archive | 增加 ingest / metadata freshness gate 判断 |
| `lifecycleGateService.evaluateIngestGate()` | 检查 identity/source/basic media facts 是否存在 | 没有 source freshness / file fingerprint / refresh request | 增加 freshness status 和 stale reason |
| `gateInvalidationService.js` | 能 invalidate ingest/metadata/optimize/archive，但 metadata invalidation 会把 `metadataComplete=false` | 通过“改成缺失”表达 stale，语义混淆 | 保留 invalidation，但新增 `factsFreshness`，stale 不等同 missing |
| `ingestFlowExecutor.js` | 目前只服务成人 folder library | Emby ingest 没有 task 化 | 扩展 ingest executor 或新增 Emby ingest executor path |
| 前端 `MediaManagePage` | facts 可展示，但没有 freshness | 用户看不到“事实过期，需要刷新” | 媒体详情增加 freshness 区块和 next action |
| 前端 `SystemConfigPage` | metadata 自动化描述为“补元数据不完整” | 没有“刷新已过期事实”的产品语义 | 改为“自动刷新/补全媒体事实与元数据” |

### 2.3 这次 E2E 暴露的具体根因

`漫长的季节` 是 season item。ShelfDeck 保存的是 season 聚合 facts，不保存 episode item 作为主业务 item。

`mediaLibraryService.upsertItems()` 可以根据 episode 聚合 season facts，但前提是 incoming items 中含该 season 的 episodes。

普通全库 ingest 之后仍是旧 facts，说明至少存在一个实现缺口：

- Emby 对 season / episode facts 的刷新不稳定或返回旧聚合。
- 或 ShelfDeck 全库 ingest 使用的 incoming data 没有拿到最新 episode facts。
- 但 `completeEmbyItemMetadata()` 具备单 season 拉 episodes 并重算聚合的能力，应作为 metadata refresh flow 的正式能力。

所以正确修复不是“允许手动 refresh 调内部函数”，而是让 facts freshness 驱动 `targetGate=metadata` task，并由 metadata flow 执行这条 repair/probe 能力。

## 3. 目标模型

### 3.1 用户心智

用户不需要理解 `metadataComplete`、`lastRefreshedAt`、Emby season 聚合这些内部细节。

用户应该看到：

```text
当前 ShelfDeck 认知的事实是什么
这些事实是否可信 / 最新
如果不可信，系统下一步会刷新哪类事实
刷新完成后，生命周期会继续判断优化 / 归档 / 处置
```

建议前端文案：

- `事实已更新`
- `来源事实需要刷新`
- `媒体事实需要刷新`
- `元数据需要刷新`
- `执行结果已产生，等待刷新媒体事实`
- `重新识别媒体`
- `刷新媒体事实`

避免文案：

- `刷新媒体库` 作为一等动作。
- `重新 scrape` 作为普通用户主语义。
- `metadata missing` 表达 stale。
- `转码完成即优化通过`。

### 3.2 Freshness 判定原则

`stale` 不能靠猜，必须来自明确证据。

最小自动判定规则：

- 有 open `factRefreshRequest`：对应 facts stale。
- 有 open `gateInvalidation`：对应 gate/facts stale 或 invalidated。
- transcode / upgrade 等执行型 flow 已激活物理结果，但 canonical facts 尚未由 owner task 刷新：media/source facts stale。
- Source Adapter 观察到 source fingerprint 变化：对应 source/media facts stale。

用户手动刷新是另一类输入：

- 用户显式点击“刷新媒体事实 / 重新识别媒体”时，不要求系统先证明 stale。
- 这应创建 manual refresh intent，并仍通过 TaskAdmission。
- 手动 refresh intent 不是自动 stale 判定，但可以允许 `targetGate=metadata` 或 `targetGate=ingest` task 在 facts complete 时执行。

### 3.3 Soft TTL / needs_check

历史 Mirex 中的“定期刷新媒体库”不能在 Kairox 下继续作为万能业务动作，但它揭示了一个合理需求：facts freshness 需要“保质期”。

该保质期应定义为 soft TTL，而不是硬 stale：

```text
fresh:
  最近观察过，且没有变化证据。

needs_check:
  超过巡检周期，应重新观察外部 source，但不能直接说事实已错。

stale:
  已有证据表明权威事实可能不再正确，必须刷新后才能继续 gate 判断。
```

不建议：

```text
超过 7 天 -> 直接 stale
```

原因：

- 会导致大量媒体无证据回退 gate。
- 会制造自动任务风暴。
- 用户会看到大量“事实过期”误报。

建议：

```text
TTL 到期
  -> Source Adapter 做 ingest check
  -> 未发现变化：更新 observedAt，facts 仍 fresh
  -> 发现变化：写 source/media stale signal 或 factRefreshRequest
```

也就是说，Mirex 的“定期刷新媒体库”在 Kairox 下迁移为：

```text
定期观察外部 source
而不是直接重跑业务生命周期
```

### 3.4 Ingest Check 归属

`ingest check` 由 Source Adapter / Domain Fact Writer 管理。

它的职责是观察外部世界：

- Emby 子库是否新增 / 删除媒体。
- Emby item 的 MediaSource、size、runtime、path、DateModified 是否变化。
- 文件夹 watch root 是否新增文件、文件是否还存在。
- 成人库 watch root 是否新增文件或文件指纹变化。

它不属于 Lifecycle、Task Creator、Task Scheduler 或 Resource Runtime。

边界：

| 行为 | 是否 task | 归属 | 说明 |
| --- | --- | --- | --- |
| 只观察外部 source 是否变化，最多更新 subLibrary/item observation | 否 | Source Adapter / Domain Fact Writer | 不能推进 gate，不能创建后续 task |
| 发现 source fingerprint 变化并写 stale signal / factRefreshRequest | 否 | Source Adapter / Domain Fact Writer | 只写事实变化信号，不直接创建 task |
| 根据 stale signal 投影 item 需要重新跨过 ingest / metadata gate | 否 | Lifecycle | 只维护 projection |
| 创建 `targetGate=ingest` 或 `targetGate=metadata` task | 是 | Task Creator + TaskAdmission | 承接 Lifecycle projection 或用户 intent |
| 更新 item canonical source/media/metadata facts | 是 | ingest / metadata task | 只有 owner task 可以发布权威事实 |

标准链路：

```text
Source Adapter / Domain Fact Writer
  -> periodic ingest check
  -> observation / source fingerprint / change signal
  -> if changed, write stale signal or factRefreshRequest

Lifecycle
  -> reads stale signal / factRefreshRequest
  -> projects lifecycleNextTask=ingest or metadata

Task Creator
  -> creates targetGate task through TaskAdmission

ingest / metadata task
  -> refreshes canonical facts
```

明确禁止：

- Source Adapter 在 ingest check 中直接 createTask。
- Source Adapter 直接调用 TaskAdmission。
- Lifecycle 访问 Emby 或文件系统做 check。
- Task Creator 自己探测文件系统或 Emby 来判断 stale。

### 3.5 Facts Freshness

新增 normalized freshness projection：

```ts
type FactsFreshnessStatus =
  | 'fresh'
  | 'stale'
  | 'unknown'
  | 'refreshing'
  | 'blocked';

interface FactsFreshnessEntry {
  status: FactsFreshnessStatus;
  ownerGate: 'ingest' | 'metadata' | 'perception' | 'optimize' | 'archive' | 'delete';
  updatedAt?: string;
  observedAt?: string;
  staleReason?: string;
  staleSource?: string;
  evidence?: Record<string, unknown>;
  refreshTargetGate?: 'ingest' | 'metadata';
  refreshTaskId?: string;
}

interface FactsFreshnessProjection {
  sourceFacts: FactsFreshnessEntry;
  mediaFacts: FactsFreshnessEntry;
  metadataFacts: FactsFreshnessEntry;
  userPerceptionFacts: FactsFreshnessEntry;
  gateFacts: FactsFreshnessEntry;
}
```

工程实现必须使用正式持久化表承载 freshness，不允许先塞进 item payload 做最小落地。

原因：

- freshness 会被 lifecycle projection、Task Creator、媒体库列表和后台巡检同时读取，属于热路径。
- payload JSON 难以索引 `status / factGroup / refreshTargetGate / observedAt`，后续会形成性能债。
- canonical facts 和 freshness 是两个不同维度：item payload 描述事实本身，freshness 表描述事实可信度。

新增表：

```sql
media_fact_freshness(
  item_id,
  fact_group,
  status,
  owner_gate,
  updated_at,
  observed_at,
  stale_reason,
  stale_source,
  refresh_target_gate,
  refresh_task_id,
  evidence_json,
  created_at,
  row_updated_at
)
```

核心索引：

- `(item_id, fact_group)`：媒体详情和列表批量 decorate。
- `(status, fact_group)`：后台巡检和候选统计。
- `(refresh_target_gate, status)`：Task Creator 找 refresh 候选。
- `(fact_group, observed_at)`：soft TTL / needs_check 巡检。

### 3.6 Fact Refresh Request

Flow executor 或外部 source adapter 不直接创建后续 task，只写 declarative request：

```json
{
  "factRefreshRequests": [
    {
      "id": "frq-...",
      "targetGate": "metadata",
      "facts": ["mediaFacts"],
      "reason": "post_optimize_activation",
      "sourceTaskId": "task-...",
      "sourceFlowKind": "transcode",
      "createdAt": "...",
      "status": "open",
      "evidence": {
        "activatedPath": "...",
        "stagedFacts": {}
      }
    }
  ]
}
```

Task Creator 只消费 Lifecycle projection，不直接消费 executor intent。

### 3.7 Gate 判定

ingest gate：

```text
passed = source/ingest required facts complete + sourceFacts fresh
```

metadata gate：

```text
passed = mediaFacts complete + metadataFacts complete + mediaFacts fresh + metadataFacts fresh
```

optimize gate：

```text
if mediaFacts stale:
  status = pending_canonical_refresh
  lifecycleNextTask = metadata
else:
  compare fresh canonical mediaFacts with optimize objective
```

archive gate：

```text
passed only after optimize gate passed with fresh canonical facts
```

delete gate：

```text
evaluates archived facts + perception facts + delete policy
does not depend on optimize/delete-as-action
```

## 4. 组件边界

### 4.1 Lifecycle

负责：

- 读取 `factsFreshness` 和 `factRefreshRequests`。
- 判定 ingest / metadata gate 是否 complete + fresh。
- 在 stale 时投影：
  - `lifecycleNextTask=ingest`
  - 或 `lifecycleNextTask=metadata`
  - `lifecycleReason=facts_stale`
- 在 optimize flow 完成但 canonical facts 未刷新时投影：
  - `optimizeGate.status=pending_canonical_refresh`

不负责：

- 调用 Emby。
- 读取文件系统。
- 创建 task。
- 更新 media facts。

### 4.2 Task Creator / TaskAdmission

负责：

- 基于 Lifecycle projection 创建 `targetGate=ingest` 或 `targetGate=metadata` task。
- 手动用户 intent 可以创建 refresh task，但仍要经过 duplicate prevention、cooldown、queue cap、安全确认。
- `targetGate=metadata` 不再只代表“补缺失字段”，也代表“刷新 stale media/metadata facts”。

准入规则调整：

```text
metadataComplete=true + metadataFresh=true + no explicit refresh intent
  -> metadata_already_complete

metadataComplete=true + metadataFresh=false
  -> allow targetGate=metadata

metadataComplete=true + explicit user refresh intent
  -> allow targetGate=metadata, source=manual, reason=user_requested_refresh

metadataComplete=false
  -> allow targetGate=metadata
```

### 4.3 Flow Planner

负责：

- `targetGate=metadata` 时规划 metadata flow。
- 根据 `gateObjective.kind` / freshness reason 区分：
  - `metadata_complete`：补齐缺失 metadata/media facts。
  - `metadata_refresh`：刷新 stale facts。
  - `media_facts_refresh`：只刷新 media technical facts。
  - `metadata_repair`：Emby / scraper repair。

注意：`scrape` 可以继续作为 `flowPlan.flowKind` 或 event family，但用户语义是 metadata gate。

### 4.4 Metadata Executor

负责：

- 对 Emby season item，拉 season + episodes 并重新聚合 season media facts。
- 对 movie / episode item，拉单 item 并必要时本地 probe。
- 对成人库，重新识别文件事实和 light adult metadata。
- 写 canonical `mediaFacts / metadataFacts`。
- 清理对应 `factRefreshRequest`。
- 更新 `factsFreshness.mediaFacts / metadataFacts = fresh`。

必须删除的行为：

- live item `metadataComplete=true` 就跳过 repair。

替代逻辑：

```text
if objective says refresh or freshness is stale:
  run refresh even if metadataComplete=true
else if metadataComplete=true:
  no-op done
else:
  repair missing facts
```

### 4.5 Ingest Executor

负责：

- 将 Emby / folder / adult source candidate 纳入 ShelfDeck 管理。
- 刷新 source identity、path、assetRootPath、externalRefs、source availability。
- 对 Emby 子库，提供 task 化的 subLibrary/item ingest 能力，而不是只靠 API 直接 refresh。

短期可以先保留 `mediaLibraryService.ingestSubLibrary()` 作为 executor 内部能力；但用户/API/自动化主路径应创建 task。

### 4.6 API Adapter

需要新增 / 调整：

```http
POST /v1/tasks
{
  "itemId": "...",
  "targetGate": "metadata",
  "gateObjective": {
    "kind": "metadata_refresh",
    "refreshFacts": ["mediaFacts", "metadataFacts"],
    "reason": "user_requested_refresh"
  }
}
```

保留但降级：

```http
POST /v1/library/actions/refresh
POST /v1/library/actions/ingest
```

短期处理：

- 标记为 deprecated API。
- 前端主路径不再调用。
- 返回中明确 `deprecated: true`。
- 后续版本改为创建 `targetGate=ingest` task，或只允许高级诊断调用。

### 4.7 前端

媒体库列表：

- facts 分组继续保留。
- 增加 freshness badge：
  - 来源事实：已更新 / 需刷新
  - 媒体事实：已更新 / 需刷新
  - 元数据：已更新 / 需刷新
- nextAction 支持：
  - `refresh_source_facts`
  - `refresh_media_facts`
  - `refresh_metadata_facts`

媒体详情：

- 增加“事实新鲜度”区块。
- 显示：
  - 当前权威事实。
  - 上次刷新时间。
  - stale 原因。
  - 需要跨过的 gate。
  - 进行中的 refresh task。

任务中心：

- `targetGate=metadata` 下用二级说明区分：
  - 补齐元数据
  - 刷新媒体事实
  - 重新识别媒体
- 不把 `scrape task` 当主任务类型。

管理策略：

- 自动化策略里的 metadata 描述改为：
  - “允许系统为元数据缺失或事实过期的条目创建元数据/媒体事实刷新任务”
- 高级页可保留旧 refresh API 的诊断入口，但普通路径不出现“刷新媒体库”作为一等模型。

## 5. 实施阶段

### Phase 0: 暂停 E2E 并记录当前事实

交付：

- `KAIROX_FRONTEND_API_E2E.md` 标记当前阻塞：
  - stage：facts freshness / metadata refresh
  - canary：`82397 漫长的季节`
  - blocker：`metadata_already_complete`
- 不继续 archive / delete stage。
- 不用 DB 或内部函数绕过。

### Phase 1: Facts Freshness Projection

后端：

- 新增 `factsFreshnessService.js`。
- 为 item projection 增加 `factsFreshness`。
- 从现有字段投影最小 freshness：
  - `lastRefreshedAt`
  - `metadataUpdatedAt`
  - `gateInvalidations`
  - `factRefreshRequests`
  - `optimizationStatus / verifyResult / optimizeGate`
- stale 初始来源：
  - explicit `factRefreshRequest`
  - explicit `gateInvalidations.metadata`
  - optimize activated but canonical facts not refreshed

前端：

- `KairoxMediaProjection` 增加 `factsFreshness`。
- 媒体详情展示 freshness。

测试：

- 字段完整但 `factsFreshness.mediaFacts.status=stale` 时，metadata gate 不 passed。

### Phase 2: Metadata Refresh Task Admission

后端：

- `taskCreationPolicy.js` 修改 metadata 准入。
- 支持 `gateObjective.kind=metadata_refresh`。
- manual refresh intent 可创建 metadata task。
- automatic refresh 只有 Lifecycle 投影 `lifecycleNextTask=metadata` 时才创建。

测试：

- metadata complete + fresh + no intent -> reject `metadata_already_complete`。
- metadata complete + stale -> allow。
- metadata complete + manual refresh objective -> allow。
- duplicate active metadata task -> reject `active_task_exists`。

### Phase 3: Metadata Executor Refresh Mode

后端：

- `scrapeFlowExecutor.runEmbyExecuting()` 不再对 refresh objective 跳过。
- `completeEmbyItemMetadata()` 作为 Emby metadata refresh 能力保留。
- season refresh 必须拉 episodes 并重新聚合。
- refresh 成功后：
  - update canonical media/metadata facts。
  - mark freshness fresh。
  - clear factRefreshRequest。
  - recompute lifecycle/objective。

测试：

- Emby season metadata refresh 拉 episodes 并更新 season duration/size/bitrate。
- metadata complete item 在 refresh objective 下不会 skip。
- refresh 后 objective 重算。

### Phase 4: Ingest Refresh 收口

后端：

- 明确 `/v1/library/actions/refresh` deprecated。
- 新增或改造 API adapter：用户从前端“刷新来源事实”时创建 `targetGate=ingest` task。
- Emby subLibrary ingest task 化：可以先支持 subLibrary object，再逐步 item object。

原则：

- API 可以触发 task creation。
- API 不直接调用 `mediaLibraryService.triggerIngest()` 作为普通用户主路径。
- startup/background ingest 仍可作为系统维护能力，但要在文档中标为 source adapter maintenance，不作为用户 task E2E 主路径证据。

测试：

- 前端主路径不调用 `/v1/library/actions/refresh`。
- manual source refresh 创建 `targetGate=ingest`。
- adult/folder/emby source refresh 都经过 TaskAdmission。

### Phase 5: Frontend Productization

前端：

- 媒体库 facts 展示 freshness。
- nextAction 显示“刷新媒体事实”。
- 点击后创建 `targetGate=metadata` refresh task。
- 任务中心 metadata task 显示“刷新媒体事实 / 补齐元数据”的目的，不显示为 scrape 主语义。
- 管理策略文案更新。

测试：

- 页面 smoke。
- 请求体不含 legacy flow/action 字段。
- stale item 的 next action 是 refresh target gate。

### Phase 6: E2E 恢复

重新跑 E2E：

1. 使用 `82397 漫长的季节`。
2. 确认磁盘文件已是 1 分钟短文件。
3. ShelfDeck projection 显示 media facts stale。
4. 创建 `targetGate=metadata` refresh task。
5. metadata task 完成后，facts 变成约：
   - duration ≈ 721 秒
   - size ≈ 0.53GB
6. 继续 perception -> objective -> optimize -> archive -> delete review。

通过标准：

- E2E 证明完整 Kairox 链路，而不是旧 refresh API。

## 6. 不做事项

本计划不做：

- 直接改生产 DB。
- 在 E2E 脚本中调用内部函数绕过 API。
- 在 transcode flow 中用 `-t 60` 假装完整转码。
- 把 stale 写成 metadata missing 来绕过准入。
- 让 executor 创建后续 ingest/metadata task。
- 把 `/v1/library/actions/refresh` 包装成新 Kairox 语义继续扩张。

## 7. 代码改造清单

新增：

- `media-service/src/factsFreshnessService.js`

修改：

- `media-service/src/lifecycleGateService.js`
- `media-service/src/lifecycleProjection.js`
- `media-service/src/taskCreationPolicy.js`
- `media-service/src/flowPlanner.js`
- `media-service/src/scrapeFlowExecutor.js`
- `media-service/src/mediaLibraryService.js`
- `media-service/src/app.js`
- `media-service/web/src/kairox/media.ts`
- `media-service/web/src/kairox/types.ts`
- `media-service/web/src/pages/MediaManagePage.tsx`
- `media-service/web/src/pages/TaskMonitorPage.tsx`
- `media-service/web/src/pages/SystemConfigPage.tsx`
- `media-service/scripts/kairox-frontend-api-e2e.js`

测试：

- `media-service/test/task-model.test.js`
- `media-service/test/api-inject.test.js`
- `media-service/test/scrape-flow-metadata-gate.test.js`
- 新增或扩展 Frontend/API E2E stage。

文档：

- `docs/v3/KAIROX_ARCHITECTURE.md`：如发现 contract 需要补充，追加 freshness 细节。
- `docs/v3/KAIROX_ENGINEERING_PLAYBOOK.md`：补充施工规则。
- `docs/v3/KAIROX_FRONTEND_API_E2E_PLAN.md`：把 facts freshness 作为 Stage 2/7 的明确门禁。

## 8. 验收标准

基础验证：

```bash
cd media-service && npm test
cd media-service && npm run build:web
```

核心断言：

- 字段完整但 stale 时，metadata gate 不 passed。
- metadata complete + stale 可创建 `targetGate=metadata` task。
- metadata complete + fresh + no refresh intent 仍拒绝重复 task。
- metadata refresh executor 不因 complete 直接 skip。
- Emby season refresh 拉 episodes 后重算 season aggregate facts。
- optimize flow 激活物理结果后，若 canonical facts 未刷新，显示 `pending_canonical_refresh`。
- stale 状态下 Task Creator 创建 refresh target gate task，不重复创建 optimize。
- 前端能展示 facts freshness 和 refresh next action。
- 旧 `/v1/library/actions/refresh` 不作为前端主路径。

## 9. 专项测试计划

Facts Freshness 必须有独立测试，不依赖生产 E2E 才能证明正确。

### 9.1 后端模型测试

- `fresh` facts + complete fields -> gate passed。
- `stale` media facts + complete fields -> metadata gate not passed。
- `needs_check` 不直接阻断 gate，但可触发 source observation。
- `factRefreshRequest` 会投影对应 facts stale。
- `gateInvalidation` 会投影对应 gate invalidated / stale。

### 9.2 TaskAdmission 测试

- metadata complete + fresh + no refresh intent -> reject `metadata_already_complete`。
- metadata complete + stale -> allow `targetGate=metadata`。
- metadata complete + manual `metadata_refresh` intent -> allow。
- metadata incomplete -> allow。
- duplicate active metadata task -> reject `active_task_exists`。
- source adapter observation 不直接 create task。

### 9.3 Metadata Refresh Executor 测试

- Emby season metadata refresh 拉取 episodes 并重算 season aggregate facts。
- metadata complete item 在 refresh objective 下不会 skip。
- refresh 成功后 freshness 变为 fresh。
- refresh 成功后清理对应 factRefreshRequest。
- refresh 后 objective / lifecycle projection 重新计算。

### 9.4 Frontend Projection 测试

- media projection 展示 `factsFreshness`。
- stale item 显示刷新 action。
- metadata refresh 创建请求只包含 `itemId + targetGate + gateObjective`。
- 前端主路径不调用 `/v1/library/actions/refresh`。

## 10. E2E 并行项目

当前生产 E2E 应保持暂停。E2E 不是 Facts Freshness 的实现目标，而是在本能力完成后作为并行项目恢复。

恢复前置条件：

- Phase 1-5 完成。
- 专项测试通过。
- 部署到生产后，再恢复 `KAIROX_FRONTEND_API_E2E_PLAN.md`。

恢复时使用当前 canary：

- `82397 漫长的季节`
- 该 season 的 12 集文件已被 destructive 切成约 1 分钟短文件。

恢复链路：

1. projection 显示 media facts stale 或用户可手动发起 metadata refresh。
2. 创建 `targetGate=metadata + gateObjective.kind=metadata_refresh` task。
3. metadata refresh 完成后，canonical facts 变成约 12 分钟 / 0.53GB。
4. 继续 perception -> objective -> optimize -> archive -> delete review。

## 11. 对当前生产 E2E 的影响

当前 E2E 应保持暂停。

已完成的生产操作：

- `93662 繁花` 长转码任务已取消。
- `/transcode` 已清理。
- `82397 漫长的季节` 的 12 集文件已 destructive 切成约 1 分钟短文件。

当前阻塞：

- ShelfDeck canonical season facts 仍是旧值。
- Kairox task 主路径不能刷新 complete-but-stale metadata/media facts。

恢复条件：

- 完成 Phase 1-3，至少支持 `targetGate=metadata + metadata_refresh`。
- 专项测试通过。
- 部署后重新从 facts freshness stage 开始 E2E。
