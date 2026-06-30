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
source/discovered -> ingested -> scraped/metadata-ready -> optimized -> archived
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
- `scraped/metadata-ready` 表示识别、元数据、评分、观看状态、成人刮削等优化前提已经完成或明确失败。
- `optimized` 表示这个媒体已经经过策略判断和必要优化处置；如果策略结果是 `keep`，可以通过 no-op optimize flow 达成。
- `archived` 表示 ShelfDeck 对该 item 的本轮处理闭环已经验收完成，用户可以把它理解为“绿灯”或“处理完了”。

Gate 定义：

- `ingest gate` 证明外部候选已经成为 ShelfDeck 可管理 item。v3.1 第一版合同是：稳定 `itemId` 已建立；来源或归属子库明确；source refs / asset identity / 媒体路径 / 外部引用至少有一种可追踪；基础媒体事实已写入，或 probe/读取失败原因已经作为可见事实落库。普通 Emby refresh、成人文件 ingest、未来其他来源都必须收敛到这个 gate；没有过 gate 的对象只能停在 `source/discovered`，不能表现成可优化媒体。
- `metadata gate` 证明 item 已具备进入 optimize 的用户语义前提。它就是用户看到的“元数据完整” gate，不限于狭义 metadata 字段；子库可自定义 gate，但配置必须覆盖下游 optimize 策略会消费的字段，避免出现“元数据完整但不能优化”的状态。
- `optimize gate` 证明本次 optimize task/flow 声明的处置目标已经达成。Optimize flow 可以是 `keep`、`transcode`、`upgrade`、`delete` 等；delete 属于 optimize gate，不属于 archive gate。Gate 的判定对象不是“flow 是否跑过”，而是目标是否达成：例如转码不是 FFmpeg 执行完就成功，而是输出在宽容差内达到目标码率/编码/可播放/替换等合同。Optimize gate miss 属于当前 task 的 flow 结果；是否重试、重试次数、是否需要用户介入由该 task 的 flow retry policy 决定，SmartTaskEngine 和 TaskAdmission 不定义 gate miss 的重试策略。
- `archive gate` 证明本轮 ShelfDeck 处理闭环已经归档。v3.1 第一版合同是：item 已经具备 optimized-like 结果（`keep` 决策成立，或 transcode/upgrade/delete 等 optimize flow 已达成目标）；没有显式 `archiveBlockers`；终态事实和必要摘要可解释。它不承载 delete 的核心执行语义，而是 optimized 之后的最终收口；未过 gate 的 item 应停在 `optimized` 并等待 archive bridge，而不是直接显示已闭环。

当前普通 Emby 媒体的 scrape task 是“半假 scrape”：它是 metadata gate 未满足时的统一 metadata repair bridge，但不做 TMDB 等真刮削；它可以询问 Emby、读取本地 Douban 缓存、做本地技术字段 probe 和自算字段。成人 scrape 与未来真 scrape 仍属于同一座 metadata bridge，只是 flow/event 编排不同。

`archive` 是最后一座轻量桥。它更接近验收和归档，不是重计算任务，也不是 delete 动作本身。验收不通过时，应该回到明确的前置阶段或产生可见的待处理事件，而不是把 item 标成完成。

v3.1 第一版 Optimize Gate 已落地为读模型 evaluator：显式 `optimizeGate/optimizationGate` 结果优先；`keep` 是 no-op optimize；`transcode`/`upgrade`/`delete` 必须有对应完成 marker 或显式 gate 事实；转码/升级可按目标码率和目标编码做宽容差校验。Optimize gate miss 会输出可解释失败和 `automaticRetry=false` 的 retry policy，避免 SmartTaskEngine/TaskAdmission 把重资源 gate miss 误读成应该自动创建同类新任务。

## 3. Task

Task 是阶段和阶段之间的桥梁。

Task 的业务语义应该保持纯净：它表示“这个 item 要跨过某座业务桥”，而不是提前把所有执行细节混进 task 本身。

例子：

- ingest task：把 source/discovered 推进到 ingested。
- scrape/metadata task：把 ingested 推进到 scraped/metadata-ready。
- optimize task：表示这个媒体要跨过 optimize gate；具体方向可以是 transcode、upgrade、delete、keep/review 等 flow 内决策。
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

Flow 可以在 task 准入时确定整体意图，也可以按需懒展开后续 event，但必须能给资源调度提供足够的资源预测或 projection。

Flow 的职责是解释：

- 这个 task 为什么需要这些 event。
- 当前 event 完成后下一步是什么。
- 哪些失败可重试，哪些失败需要用户介入。
- 暂停、恢复、中断后如何回到正确位置。
- gate miss 后是否允许在当前 task 内重试、最多重试几次、是否必须用户介入。

## 6. Action

Action 更适合理解成 event 类型或 flow 中的操作类型，而不是 task 的同义词。

在 v2 里 `actionType=transcode/delete/upgrade/scrape/ingest` 承担了过多语义。v3 可以继续保留类似字段作为兼容或展示字段，但业务建模时应区分：

- task：跨阶段的桥。
- flow：桥里的编排规则。
- event/action：具体发生的操作。

## 7. Manual 和 Automatic

自动模式下，task 由系统触发，优化方向也由系统策略决定。

手动模式下，用户触发 task 的语义仍然应保持纯净：用户表达的是“这个媒体要优化/处理”。如果系统推荐方向和用户诉求可能不同，应在 flow 层询问用户选择：

- 遵循系统推荐方向。
- 改成用户指定方向。
- 暂停并等待进一步确认。

不要把“用户点了转码”直接等同于“task 的业务语义就是转码”。更准确的模型是：用户触发 optimize task，并在 flow 中指定或确认优化方向。

## 8. Task Management 和 Resource Scheduling

Task management 负责是否建桥、何时准入、何时准出，以及 task 当前是否还能推进。它使用 gate 判定结果，但不应该自己定义 gate 合同。

Resource scheduler 负责 event 维度的资源调度。原因是资源消耗不由 task 名称决定，而由具体 event 决定，例如 FFmpeg 编码、MoviePilot 等待、网络下载、AI 抽帧、SQLite 写入等。

Task management 可以有内存态加持，但 task/event 的事实必须持久化。内存态用于实时运行、快速查询和减少反复 IO；持久化 store 是恢复、审计和迁移的事实来源。

## 9. Projection

Projection 是从 task/flow/event 事实投影出来的读模型。

用户页面、调度器列表、统计面板、空间收益、健康诊断不应该每次从完整事件历史重新计算。v3 可以为不同读场景建立不同 projection，但 projection 只是视图，不是事实来源。

## 10. Keep 和 Archive

如果策略判断一个 item 不需要优化，结果是 `keep`，它仍然是 optimize gate 下的一种 no-op optimize flow 或 optimize decision。

但 item 是否进入 `archived` 取决于本轮 ShelfDeck 闭环是否验收完成。也就是说：

- `keep` 是优化方向或策略结果。
- `archived` 是处理闭环完成状态。

这两个概念不要混在一起。

同理，`delete` 是 optimize gate 下的一种处置 flow，而不是 archive gate。Archive gate 负责最终闭环归档，不负责执行删除动作。
