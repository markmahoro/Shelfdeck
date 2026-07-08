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

其中：

- `source/discovered` 是阶段 0，表示 ShelfDeck 已经知道一个外部媒体候选，但它还没有成为完整的 ShelfDeck media item。
- `ingested` 表示媒体已经归一成 ShelfDeck item，拥有稳定 itemId、source refs、路径和基础媒体事实。
- `scraped/metadata-ready` 表示识别、元数据、评分、观看状态、成人刮削等优化前提已经完成或明确失败。
- `optimized` 表示这个媒体已经经过策略判断和必要优化动作；如果策略结果是 `keep`，通常不需要创建优化 task。
- `archived` 表示 ShelfDeck 对该 item 的本轮处理闭环已经验收完成，用户可以把它理解为“绿灯”或“处理完了”。

`archive` 是最后一座轻量桥。它更接近验收和归档，不是重计算任务。验收不通过时，应该回到明确的前置阶段或产生可见的待处理事件，而不是把 item 标成完成。

## 3. Task

Task 是阶段和阶段之间的桥梁。

Task 的业务语义应该保持纯净：它表示“这个 item 要跨过某座业务桥”，而不是提前把所有执行细节混进 task 本身。

例子：

- ingest task：把 source/discovered 推进到 ingested。
- scrape/metadata task：把 ingested 推进到 scraped/metadata-ready。
- optimize task：表示这个媒体要进入优化处理；具体方向可以是 transcode、upgrade、delete、keep/review 等 flow 内决策。
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

Task management 负责是否建桥、何时准入、何时准出，以及 task 当前是否还能推进。

Resource scheduler 负责 event 维度的资源调度。原因是资源消耗不由 task 名称决定，而由具体 event 决定，例如 FFmpeg 编码、MoviePilot 等待、网络下载、AI 抽帧、SQLite 写入等。

Task management 可以有内存态加持，但 task/event 的事实必须持久化。内存态用于实时运行、快速查询和减少反复 IO；持久化 store 是恢复、审计和迁移的事实来源。

## 9. Projection

Projection 是从 task/flow/event 事实投影出来的读模型。

用户页面、调度器列表、统计面板、空间收益、健康诊断不应该每次从完整事件历史重新计算。v3 可以为不同读场景建立不同 projection，但 projection 只是视图，不是事实来源。

## 10. Keep 和 Archive

如果策略判断一个 item 不需要优化，结果是 `keep`，通常不需要创建 optimize task。

但 item 是否进入 `archived` 取决于本轮 ShelfDeck 闭环是否验收完成。也就是说：

- `keep` 是优化方向或策略结果。
- `archived` 是处理闭环完成状态。

这两个概念不要混在一起。
