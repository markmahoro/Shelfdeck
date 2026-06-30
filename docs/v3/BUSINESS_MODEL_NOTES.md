# ShelfDeck v3 Business Model Notes

本文记录 v3 重构前已经确认过的业务概念共识。

它不是技术架构设计书，不规定数据库、模块、类名或具体实现方式。v3 agent 必须先排摸 v2 代码和生产事实，再决定实现方案。

## 1. ShelfDeck 的业务对象

ShelfDeck 管理的核心对象是媒体 item。

用户理解里的一个 item 是一部电影、一季剧集、一个成人影片或其他可管理媒体。`itemId` 是 ShelfDeck 识别媒体的稳定业务身份；外部系统 ID、文件路径、Emby ID、MoviePilot ID 都只是 source reference，不应该替代 ShelfDeck 自己的 item 身份。

## 2. 用户视角的主流程

ShelfDeck 是媒体库管家，不只是任务执行器。

用户关心的是一个媒体是否已经被 ShelfDeck 处理完成，以及它当前处于什么业务阶段。

核心业务流程是：

```text
source/discovered -> ingested -> metadata-ready -> optimized -> archived
```

这是 5 个阶段、4 个 gate：

```text
S0 source/discovered
  -- G1 ingest gate -->
S1 ingested
  -- G2 metadata gate -->
S2 metadata-ready
  -- G3 optimize gate -->
S3 optimized
  -- G4 archive gate -->
S4 archived
```

阶段是用户语义状态，gate 是从一个阶段进入下一个阶段的证明合同。Task 是跨 gate 的桥，flow 是 task 内部的 event 编排，event 是资源消耗、外部副作用、用户确认、失败和恢复事实。

阶段定义：

- `source/discovered` 是阶段 0，表示 ShelfDeck 已经知道一个外部媒体候选，但它还没有成为完整的 ShelfDeck media item。
- `ingested` 表示媒体已经归一成 ShelfDeck item，拥有稳定 itemId、source refs、路径和基础媒体事实。
- `metadata-ready` 表示识别、元数据、评分、观看状态、成人刮削等优化前提已经完成或明确失败。
- `optimized` 表示这个媒体已经经过策略判断和必要优化处置；如果策略结果是 `keep`，可以通过 no-op optimize flow 达成。
- `archived` 表示 ShelfDeck 对该 item 的本轮处理闭环已经验收完成，用户可以把它理解为“绿灯”或“处理完了”。

Gate 定义：

- `ingest gate` 证明外部候选已经成为 ShelfDeck 可管理 item。v3.1 第一版合同是：稳定 `itemId` 已建立；来源或归属子库明确；source refs / asset identity / 媒体路径 / 外部引用至少有一种可追踪；基础媒体事实已写入，或 probe/读取失败原因已经作为可见事实落库。普通 Emby refresh、成人文件 ingest、未来其他来源都必须收敛到这个 gate；没有过 gate 的对象只能停在 `source/discovered`，不能表现成可优化媒体。
- `metadata gate` 证明 item 已具备进入 optimize 的用户语义前提。它就是用户看到的“元数据完整” gate，不限于狭义 metadata 字段；子库可自定义 gate，但配置必须覆盖下游 optimize 策略会消费的字段，避免出现“元数据完整但不能优化”的状态。
- `optimize gate` 证明当前媒体的 optimize objective 已经达成。Optimize objective 由 Lifecycle 定义，是用户希望媒体最终变成什么，例如降低码率、提升画质、补中文字幕、替换更好音轨、修复编码/杜比视界兼容性、删除媒体或保持当前状态闭环。`transcode`、`upgrade`、`delete`、`remux` 等只是 Flow Planner 为达成 objective 选择的 flow operation，不是 gate 目标本身。delete 属于 optimize gate，不属于 archive gate。Gate 的判定对象不是“flow 是否跑过”，而是 objective 是否达成：例如转码不是 FFmpeg 执行完就成功，而是输出在宽容差内达到目标码率/编码/可播放/替换等合同。Optimize gate miss 属于当前 task 的 flow 结果；是否重试、重试次数、是否需要用户介入由该 task 的 flow retry policy 决定，Task Creator 不定义 gate miss 的重试策略。
- `archive gate` 证明本轮 ShelfDeck 处理闭环已经归档。v3.1 第一版合同是：item 已经具备 optimized-like 结果（`keep` 决策成立，或 transcode/upgrade/delete 等 optimize flow 已达成目标）；没有显式 `archiveBlockers`；终态事实和必要摘要可解释。它不承载 delete 的核心执行语义，而是 optimized 之后的最终收口；未过 gate 的 item 应停在 `optimized` 并等待 archive bridge，而不是直接显示已闭环。

当前普通 Emby 媒体的 scrape task 是“半假 scrape”：它是 metadata gate 未满足时的统一 metadata repair bridge，但不做 TMDB 等真刮削；它可以询问 Emby、读取本地 Douban 缓存、做本地技术字段 probe 和自算字段。成人 scrape 与未来真 scrape 仍属于同一座 metadata bridge，只是 flow/event 编排不同。

`archive` 是最后一座轻量桥。它更接近验收和归档，不是重计算任务，也不是 delete 动作本身。验收不通过时，应该回到明确的前置阶段或产生可见的待处理事件，而不是把 item 标成完成。

v3.1 第一版 Optimize Gate 已落地为读模型 evaluator：显式 `optimizeGate/optimizationGate` 结果优先；`keep` 是 no-op optimize；`transcode`/`upgrade`/`delete` 必须有对应完成 marker 或显式 gate 事实；转码/升级可按目标码率和目标编码做宽容差校验。Optimize gate miss 会输出可解释失败和 `automaticRetry=false` 的 retry policy，避免 Task Creator 把重资源 gate miss 误读成应该自动创建同类新任务。

当 `optimizeGate.status=failed` 且 retry policy 不允许自动重试时，后台自动化不得重新创建同类 `transcode` / `upgrade` / `delete` optimize task。后续是否重试应由原 task 的 flow recovery / manual retry 语义解释。当前 v3.1 仍保留 legacy manual create task 兼容入口；最终应收口到任务中心对原失败 task 的 retry/recovery 操作。

## 3. Task

Task 是阶段和阶段之间的桥梁。

Task 的业务语义应该保持纯净：它表示“某个对象要达成某个 lifecycle gate 目标”，而不是提前把所有执行细节混进 task 本身。

Task 的核心内容是：

- object：哪个 media item / asset。
- targetGate：要跨过哪一个 gate。
- gateObjective：该 gate 的目标合同。metadata gate 的 objective 是“元数据完整”；optimize gate 的 objective 是“媒体最终要变成什么”；archive gate 的 objective 是“闭环归档可解释”。
- creationReason：为什么创建，例如 gate miss、用户 intent、自动化扫描命中。
- constraints：风险策略、允许的 operation 范围、是否需要确认等。
- runtime state：等待、运行中、失败、完成、等待确认、暂停等。

例子：

- ingest task：把 source/discovered 推进到 ingested。
- metadata task：把 ingested 推进到 metadata-ready。
- optimize task：表示这个媒体要跨过 optimize gate；具体 objective 可以是降低码率、提升画质、补字幕、换音轨、兼容性修复、删除、keep/review 等，具体 operation 是 flow 内决策。
- archive task：把 optimized 推进到 archived，重点是验收和归档。

Task 本身不应该承载每一次底层执行尝试的完整日志。Task 可以有业务状态，例如等待、运行中、失败、完成、归档失败，但具体重试、中断、资源占用和执行细节应进入 event。

Task 可以失败。它失败的语义是“这座桥当前没跨过去”，不是每个 event 都必须失败。失败后的下一步应该由 flow 和 event 历史解释清楚。

## 4. Event

Event 是 task 内部发生的具体事件。

Event 应覆盖：

- 资源占用和释放。
- 外部依赖调用，例如 Emby、MoviePilot、Douban、FFmpeg、worker。
- 重试、暂停、恢复、中断、取消。
- 用户确认、用户改选、策略选择。
- 执行结果、错误原因、可恢复性。

Event 的主键更接近 `eventId`。一个 task 可以有多个 event；重试不是 task 外的临时变量，而是一串可解释的 event。

## 5. Flow

Flow 是一个 task 内部如何编排 event 的业务规则。

Flow 接收 task 的 object、targetGate 和 gateObjective，然后选择并控制达成目标的实现路径。它可以按需懒展开 event，但必须能给 Resource Runtime 提供足够的资源预测或 projection。

Flow 的职责是解释：

- 这个 task 为了达成 objective 为什么需要这些 event。
- 当前 objective 适合走哪个 flow operation，例如 reduce bitrate 可能走 transcode，补字幕或换音轨可能走 upgrade/remux/subtitle flow。
- 当前 event 完成后下一步是什么。
- 哪些失败可重试，哪些失败需要用户介入。
- 暂停、恢复、中断后如何回到正确位置。
- gate miss 后是否允许在当前 task 内重试、最多重试几次、是否必须用户介入。

Flow Planner 不是 gate 的裁判。它不能自己定义 optimize objective，也不能把“flow 跑完”当成 gate 通过。最终 gate 是否通过，由 Lifecycle 根据 gateObjective 和 observed facts 判定。

## 6. Action

Action 更适合理解成 event 类型或 flow 中的操作类型，而不是 task 的同义词。

在 v2 里 `actionType=transcode/delete/upgrade/scrape/ingest` 承担了过多语义。v3 可以继续保留类似字段作为兼容或展示字段，但业务建模时应区分：

- task：跨阶段的桥。
- flow：桥里的编排规则。
- event/action：具体发生的操作。

## 7. Manual 和 Automatic

自动模式下，task 由系统触发，但系统触发的是 targetGate / gateObjective，不是直接把内部 flow operation 当作 task 目标。

手动模式下，用户触发 task 的语义仍然应保持纯净：用户表达的是“这个媒体要达成某个目标”。如果系统推导出的 objective 或 flow operation 和用户诉求可能不同，应在 flow 层询问用户选择：

- 遵循系统推荐方向。
- 改成用户指定方向。
- 暂停并等待进一步确认。

不要把“用户点了转码”直接等同于“task 的业务语义就是转码”。更准确的模型是：用户触发 optimize task，Lifecycle 给出 optimize objective，Flow Planner 再选择或确认具体 operation。

## 8. 架构组件职责

v3.1 的目标语义收敛为 5 个架构组件。这里的组件是职责边界，不要求当前代码立刻做到一个组件对应一个物理文件。

| 架构组件 | 核心问题 | 负责 | 不负责 |
| --- | --- | --- | --- |
| Lifecycle | 媒体现在在哪，gate 过没过，目标是什么 | 定义 5 阶段 4 gate；定义 gate objective；by 子库计算 ingest/metadata gate；为每个媒体计算 optimize objective；根据 objective + observed facts 判定 optimize gate；推进 stage | 创建 task；选择 flow；执行 event；控制资源 |
| Task Creator | 现在要不要创建 task，创建什么目标 task | 消费 lifecycle snapshot、自动化扫描、用户 intent、Resource Runtime 安灯信号；执行准入；创建 object + targetGate + gateObjective 的 task；拒绝时给 blocked reason | 定义 gate/objective；选择 flow；执行 event；控制资源 |
| Task Scheduler | 哪些 task 现在获得运行机会 | 找 runnable task；控制 task 级并发；控制 item lock；按 priority/retryAt/createdAt 排序；给 task 一次 tick；保存 Flow Planner 返回的 task-level signal | 创建 task；判断 gate；选择 flow；生成 objective；生成 event；决定 retry/fallback；控制资源 |
| Flow Planner | 为了达成 task 目标，具体怎么做 | 根据 task.object + targetGate + gateObjective 选择 flow operation；生成 event 编排；发出 event intent；消费 event/resource facts；处理 retry/fallback/wait/needs-review/fail；写 task facts/gate facts；返回 task-level signal | 定义 gate/objective；判定 lifecycle stage；控制资源容量；创建 task |
| Resource Runtime | event 怎么执行，工厂产能如何 | 读取 event intent；管理 event queue、resource bucket、capacity、concurrency、lease；调用 executor/worker；处理 timeout/worker lost/orphan lease；写 event/resource facts；输出安灯信号并提供 Resource View | 创建 task；判断 lifecycle gate；选择 flow operation；定义 optimize objective |

主链路是：

```text
Lifecycle
  -> Task Creator
  -> Task(object + targetGate + gateObjective)

Task Scheduler
  -> Flow Planner
  -> Resource Runtime
  -> event/resource facts
  -> Flow Planner
  -> task/gate facts
  -> Lifecycle
```

Task/event 的事实必须持久化。内存态用于实时运行、快速查询和减少反复 IO；持久化 store 是恢复、审计和迁移的事实来源。

## 9. Projection

Projection 是从 task/flow/event 事实投影出来的读模型。

用户页面、调度器列表、统计面板、空间收益、健康诊断不应该每次从完整事件历史重新计算。v3 可以为不同读场景建立不同 projection，但 projection 只是视图，不是事实来源。

## 10. Keep 和 Archive

如果 Lifecycle 判断一个 item 的 optimize objective 是保持当前状态即可，结果可以是 `keep`，它仍然是 optimize gate 下的一种 no-op optimize objective / flow decision。

但 item 是否进入 `archived` 取决于本轮 ShelfDeck 闭环是否验收完成。也就是说：

- `keep` 是优化方向或策略结果。
- `archived` 是处理闭环完成状态。

这两个概念不要混在一起。

同理，`delete` 是 optimize gate 下的一种处置 flow，而不是 archive gate。Archive gate 负责最终闭环归档，不负责执行删除动作。

## 11. Optimize Objective 和 Flow Operation

这是 v3.1 P0-1 期间重新明确的关键结论。

早期 `StrategyEngine` / `action` 模型把两件事混在了一起：

- 用户希望这个媒体最终变成什么。
- 系统应该用哪条实现路径达成这个目标。

v3.1 后必须拆开：

| 概念 | 含义 | 例子 | 归属 |
| --- | --- | --- | --- |
| Optimize Objective | 用户语义目标，即媒体最终应该变成什么 | 降低码率、提升画质、补中文字幕、替换更好音轨、修复 Dolby Vision/编码兼容性、删除媒体、keep 闭环 | Lifecycle / optimize gate |
| Flow Operation | 达成目标的实现路径 | transcode、upgrade、delete、remux、subtitle fetch、audio replace 等 | Flow Planner |

因此，`optimize task` 的目标不是“转码”或“洗版”，而是让某个媒体通过 optimize gate。它携带的是 object + targetGate + gateObjective。Flow Planner 读取这个 objective 后，才决定走哪条 flow operation。

例子：

- objective 是降低码率：Flow Planner 可以选择 `transcode`，也可以在未来选择更合适的 remux/transcode 组合。
- objective 是补中文字幕：Flow Planner 可以选择 subtitle fetch、remux 或 upgrade，而不是把它提前建模成“洗版任务”。
- objective 是替换更好音轨：Flow Planner 可以选择 upgrade 或 remux。
- objective 是 Dolby Vision 兼容性修复：这是转码/封装能力补强问题，不是任务管理绕行问题。
- objective 是删除媒体：Flow Planner 选择 `delete`，但 delete 仍属于 optimize gate 下的 destructive flow operation，不是 archive gate。

Flow Planner 不能自己设定 optimize gate 的通过标准。它是实现层，不是裁判。Lifecycle 定义 objective，并在 flow 执行后根据 objective + observed facts 判定 gate 是否通过。

这条拆分的直接后果：

- `action=transcode/upgrade/delete` 只能作为兼容字段或 flow hint，不能作为用户语义 task 目标。
- 任务中心应优先表达 optimize objective 和当前 flow operation，而不是把 operation 当 task 名称。
- metadata gate 自定义校验必须覆盖 optimize objective 会消费的输入字段，而不是覆盖某个旧 action 名称的隐式字段。
- optimize gate failed 后是否重试属于原 task 的 flow recovery 语义；Task Creator 不应把失败 objective 简单重建成同类重资源 operation task。

## 12. 用户可介入范围

详细定义见 `docs/v3/USER_INTERVENTION_AND_FULL_AUTO.md`。本文保留核心约定，具体白名单和 v3.1 全自动模式交付标准以后以该文档为准。

人工介入不是一个统一组件，也不是一种特殊 task 类型。它是用户在媒体处理旅程中允许提供规则、事实、授权或调度的范围。

v3.1 的约定是：用户可介入范围是一张白名单；表外事项默认不开放给用户。后续讨论“人工还是自动”时，以这张白名单判断。

| 用户介入场景 | 类别 | 用户在解决什么 | 新架构落点 |
| --- | --- | --- | --- |
| 配置 metadata gate | 配置规则 | 定义每个子库什么叫“元数据完整” | Lifecycle |
| 配置 optimize objective 规则 | 配置规则 | 定义媒体最终应该变成什么，比如降码率、补字幕、换音轨、删除、keep | Lifecycle |
| 配置自动推进范围 | 配置规则 | 定义哪些 gate / objective 可以自动创建 task，哪些必须用户介入 | Task Creator |
| 配置风险确认规则 | 配置规则 | 定义哪些 flow 节点必须等用户确认 | Flow Planner |
| 建设欧美成人演员库 | 配置规则 | 建立人物身份、reference face、别名和识别知识库，提升后续识别能力 | Lifecycle facts / People Library |
| 修改成人番号 | 纠正机器判断 | 机器无法可靠识别成人影片身份 | Lifecycle facts / Flow Planner |
| 选择正确电影/剧集身份 | 纠正机器判断 | 外部 ID、标题、季集匹配不确定 | Lifecycle facts / Flow Planner |
| 命名 unknown face | 纠正机器判断 | 机器无法判断演员/人物身份 | Lifecycle facts / Flow Planner |
| 选择 scrape / metadata 候选 | 纠正机器判断 | 多个元数据候选都可能正确 | Flow Planner |
| 选择 upgrade / subtitle / audio 候选 | 纠正机器判断 | 多个实现候选都可能满足 objective | Flow Planner |
| 确认删除媒体 | 授权风险动作 | 允许破坏性删除以达成 optimize objective | Flow Planner |
| 确认替换原文件 | 授权风险动作 | 允许覆盖当前媒体文件 | Flow Planner |
| 确认移动/重命名目录 | 授权风险动作 | 允许改变文件组织结构 | Flow Planner |
| 确认覆盖 NFO/封面 | 授权风险动作 | 允许覆盖已有元数据文件 | Flow Planner |
| 确认画面/音频兼容性处理 | 授权风险动作 | 允许可能改变媒体表现的处理路径 | Flow Planner |
| 提高/降低 task 优先级 | 调度已有任务 | 改变已有 task 的运行顺序 | Task Scheduler |
| 暂停 task | 调度已有任务 | 暂停已有 task 的运行机会 | Task Scheduler |
| 继续/启动 task | 调度已有任务 | 让已有 task 重新获得运行机会 | Task Scheduler |
| 取消 task | 调度已有任务 | 停止已有 task | Task Scheduler |
| 放弃/标记无需处理 | 失败处理 | 用户接受不继续处理，并形成可解释状态 | Lifecycle / Flow Planner |

边界约束：

- 用户调度权限只作用于 task 级：priority、暂停、继续/启动、取消。用户不直接调度 flow step、event、resource bucket、worker lease 或 FFmpeg/MoviePilot/Emby 队列。
- 单个媒体不开放 objective 覆盖。Objective 由规则产生；用户要改变目标，应修改 Lifecycle 规则/策略配置，而不是在 item 上临时改目标。
- retry、resume、fallback 等 flow recovery 细节不作为用户直接介入场景暴露。用户看到的是失败原因和可理解的处理选择，例如重新处理、放弃或补充必要事实；内部如何恢复由 Flow Planner 按 recovery contract 决定。
- 运维干预不属于媒体处理旅程的人工介入范围。暂停自动化、降低并发、切换 worker、修外部依赖、清理磁盘等属于系统维护/配置，不进入本表。

全自动模式是这张白名单中可预授权项的一组配置组合。用户完成规则和授权配置后，系统应能在无需运行时人工介入的情况下，自动推进允许范围内的媒体生命周期；遇到超出预授权或无法可靠判断的事项，必须停在可解释的待处理/失败状态。
