# ShelfDeck v3.1 Discussion Notes

Status: Historical discussion log.

本文保留 v3.1 推进过程中的讨论证据和阶段性结论，不是当前架构契约。若本文与 `docs/v3/KAIROX_ARCHITECTURE.md` 冲突，以 Kairox 为准。

本文记录 v3.1 推进过程中已经讨论清楚、但容易在后续切片中被遗忘的产品语义、排查结论和工作约定。

后续继续 v3.1 P0/P1/P2 任务前，应先读本文，再读 `V3_1_PROGRESS.md` 和相关代码。本文不是最终架构合同；当代码和生产证据推翻本文时，应先更新本文，再继续实现。

## 1. 推进顺序与汇报约定

- 当前优先级按用户补充的 P0 到 P2 顺序推进，除非某个问题需要等待生产环境观察。
- P0-1 是 task 管理和每种库类型下 task 生命周期是否符合预期。一个问题可能需要多个 slice，不要把“做了诊断工具”当成问题已解决。
- P0-1 的核心不是性能或 UI 局部问题，而是当前整个业务流程是否满足已对齐的新业务模型：`ingest -> scrape -> optimize -> archive`，以及 `lifecycle / task / flow / event` 分层是否一致。
- 在 P0-1 排查过程中如果发现非 P0-1 问题，先判断它是否由“不满足新业务模型”导致：
  - 如果是，则纳入 P0-1 主线继续修；
  - 如果不是，则只在 `V3_1_PROGRESS.md` 记录为待修复，不抢 P0-1 主线。
- 当判断某个问题已经解决时，必须给完整报告：生产事实、根因、修复、验证、剩余风险。
- 后续每个完成的 slice 都要提交 git。前序已经合并成一次 checkpoint 的历史不再追求逐 slice 回溯。
- 用中文向用户汇报；代码、代码注释、commit message 继续用英文。

## 2. Dashboard 与任务中心语义

- 用户会去任务中心看任务状态，不会在 Dashboard 细看任务列表。
- Dashboard 上的任务列表卡片价值不高，不应该复制任务中心明细。
- Dashboard 的日志卡片本质上应该是 event 卡片。它有价值，因为它让用户感觉系统在动。
- Dashboard 原先还承担“添加媒体库”的入口；如果改 Dashboard，不要无意删除该入口。
- Dashboard 应是媒体库体检入口，任务明细和恢复动作归任务中心。

## 3. 用户可见术语

- `task` 统一表述为“任务”。
- `event` 统一表述为“任务节点”。
- `flow` 统一表述为“任务链路”。
- `lifecycle` 统一表述为“生命周期”。
- 不要把内部工程词 `bridge` 暴露成“任务桥”等用户难懂表述。
- “自动 flow”语义不清。后续应区分：
  - 自动创建任务；
  - 任务创建后自动执行；
  - 任务链路内部自动推进。

## 4. Dolby Vision 结论

- Dolby Vision 的修复方向是转码能力补强，不是任务管理绕行。
- 任务中心只展示能力路径、resource 和失败摘要；不能通过隐藏任务、阻断任务来替代真正的转码能力修复。
- 生产中曾看到的 DV 失败来自 FFmpeg `libplacebo` / Vulkan runtime 初始化失败，应由 transcode precheck、fallback 和 health 解释。

## 5. Task Lifecycle Audit 的定位

- Slice 41 的 lifecycle audit 是“听诊器”，不是业务问题本身的解决。
- 它用于按库类型、sub-library、status、lifecycle stage、bridge kind、operation kind、source 汇总任务，并给出异常 signal。
- 后续 P0-1 应用它挑生产任务中心里的具体任务继续分析，而不是只看汇总数字。

## 6. 普通库 scrape 的关键语义

本节是当前最容易重复讨论的结论。

### 6.1 “缺 metadata 所以要 scrape”这个产品直觉成立

普通 movie/tv 缺 metadata 时，用户直觉上认为“应该 scrape”并不错误。

错误不在这个产品语义，而在当前代码中存在一个“假的普通库 scrape”：

- task 名叫 `scrape`；
- bridge 是 `metadata`；
- 但执行时主要只是 `Emby metadata completion`；
- 它不是 ShelfDeck 自己去 TMDB、海报站、名称源等外部 metadata source 做真正刮削。

### 6.2 半假 scrape 与真 scrape

当前讨论确认普通库可以先支持“半假 scrape”。

半假 scrape：

- 架构组件上仍然是 `metadata` 任务链路里的 `scrape` operation；
- 不直接实现真正 TMDB/海报/名称刮削；
- 会问 Emby 获取最新 item/media stream facts；
- 会使用本地已有的 Douban 缓存/匹配结果，而不是直接临时去打 Douban；
- 会执行 ShelfDeck 自算字段，例如分辨率、码率、编码、大小、时长、策略判定所需事实；
- 完成后重新计算 `metadataStatus`，目标是让普通库 item 达到 metadata OK，进而允许进入 optimize。

真 scrape：

- 不再依赖 Emby 作为主要 metadata 来源；
- ShelfDeck 自己去找名称、海报、外部 metadata source；
- 具备真正的普通电影/剧集刮削能力。

### 6.3 当前生产暴露的问题

生产 lifecycle audit 显示：

- 当前 active scrape 为 0。
- 当前 active task 都是普通 movie 的 optimize/transcode。
- 历史终态中存在普通 movie/tv scrape 失败任务。
- 抽样普通 movie/tv scrape 失败任务实际执行的是 `Emby metadata completion`。
- 失败样例包括：
  - movie 缺 `media.resolution`；
  - tv 缺 `decision.providerId`。

这说明当前普通库 scrape 不是“不该有”，而是“半假 scrape 的生命周期和能力没有正式建模完整”。

### 6.4 不要再简单得出“普通 scrape 不支持所以应禁掉”

前序 `TaskAdmission` 已经会以 `scrape_not_supported_for_standard_media` 打回普通库 scrape。这个行为曾用于阻断纯假的旧流程，但现在看它过于粗糙。

后续修复方向不应只是：

- 禁止普通库 scrape；
- 禁止历史普通 scrape retry；
- 或把普通库 metadata 缺失永远停在 metadata 阶段。

更合理的方向是：

- 把普通库 scrape 正式定义成半假 scrape / metadata repair flow；
- 用明确的 resource/event 展示它问了 Emby、读了 Douban cache、做了 self-compute、写了 SQLite projection；
- 若完成后仍 metadata 不完整，失败原因必须说明哪个事实补不上，以及为什么补不上；
- 只有未来实现真 scrape 后，才把该 flow 升级为真正外部刮削能力。

### 6.5 用户验收标准

一个普通库媒体经过半假 scrape 后，理论上应该：

- 如果缺失事实可由 Emby / Douban cache / self-compute 补齐，则被标记为 metadata OK；
- metadata OK 后可以进入 optimize lifecycle；
- 如果仍无法 metadata OK，任务失败原因必须具体到缺失事实和不可补原因；
- 不应该反复无节制打 Emby，也不应该在任务中心显示一个无法解释的 scrape failed / retry。

## 7. 资源视图上的 Emby 压力判断

用户担心假的 scrape 会不停打 Emby。当前生产只读检查结论：

- Resource View 当前没有 `scraper` 或 Emby completion running/waiting。
- 当前 active scrape 为 0。
- SmartTask 最近一轮产生过普通 scrape candidate，但它们被 admission 拒绝，没有入队。
- 当前主要资源瓶颈是 `local_transcode`：1 running，49 waiting。

因此当前不是“系统正在不停打 Emby”的状态。但历史普通 scrape 失败任务说明旧流程曾经逐个触发过 Emby metadata completion。

半假 scrape 后续必须有节流、资源事件和失败分类，避免把 metadata 修复变成 Emby 噪声请求。

## 8. 媒体库字段展示

媒体库字段展示较混乱，后续 P2 需要统一：

- 各子库字段排列一致；
- 每个条目建议按“元数据 / 生命周期 / 操作区”排列；
- 不要让不同库类型各自发明一套字段顺序。

## 9. 当前 P0-1 下一步建议

不要继续以“普通 scrape 是否应该被完全禁止”为问题。

下一步应围绕普通库半假 scrape 建一个清晰 slice：

- 复核 `TaskAdmission`、`SmartTaskEngine`、`scrapeFlowExecutor`、`metadataStatus` 对普通 movie/tv scrape 的当前行为；
- 定义 `standard metadata repair scrape` 的准入条件、资源节点、完成条件和失败条件；
- 让普通库 metadata 缺失 item 在该 flow 后能 metadata OK，或给出明确不可补原因；
- 用生产样本如“黑炮事件”和“凛冬的已至”验证，不只用合成测试；
- 观察 Resource View，确认不会形成 Emby 请求风暴。

## 10. “元数据完整”是用户语义 gate，不是技术字段分类

本节记录 2026-06-30 继续讨论后确认的更高层模型。它会影响普通库半假 scrape、`metadataStatus`、TaskAdmission、SmartTask 和子库配置校验的后续实现。

### 10.1 顶层产品心智

ShelfDeck 对用户暴露的顶层生命周期心智是：

```text
ingest -> scrape -> optimize -> archive
```

在这个心智里，Admin Web 显示“元数据完整”时，用户会自然理解为：

- 这个媒体已经完成 scrape 阶段；
- 它已经具备进入 optimize 阶段所需的一切前置条件；
- 如果它没有进入 optimize，应能看到明确的 optimize 阶段状态、资源等待、任务阻断、配置错误或系统 bug，而不是隐藏的前置条件缺失。

因此，“元数据完整”不是工程上狭义的 metadata facts complete。它是用户语义上的 scrape completion gate，也可以理解为 optimize-ready gate。它叫“元数据完整”只是产品命名；即使命名为任意别的词，本质仍是这个生命周期 gate。

### 10.2 子库可自定义 gate

每个子库对“元数据完整”的定义可以不同。

例如：

- 电影子库可以要求技术事实、身份信息，并要求 `userRating` / `doubanRating` 至少一个存在。
- 国产剧集子库如果后续 optimize 策略不消费评分，则可以不要求本地评分或豆瓣评分。
- 成人子库可以要求成人 scrape 结果、番号/标题、整理状态和技术事实。

用户可以把 gate 配得比下游 optimize 真正需要的字段更严格。系统应允许这种配置，因为它只是让 scrape 阶段完成条件更高。

但用户不能把 gate 配得比下游 optimize 要消费的字段更宽松。否则就会破坏产品心智：页面显示“元数据完整”，但媒体无法进入 optimize，用户会困惑。

### 10.3 系统必须校验 gate 覆盖 optimize 输入

系统校验的核心合同是：

```text
metadataCompleteGate >= optimizeRequiredInputs
```

这里的 `>=` 是覆盖关系，不是字段数量。

后续实现不能只做简单字段集合比较，还要支持组合语义：

- `all`: 必须全部存在；
- `any`: 至少一个存在，例如评分可以是 `any(userRating, doubanRating)`；
- 按媒体类型或子库类型分支，例如 movie / season / adult 的 gate 不同；
- 策略模板中 OR 条件、catch-all 规则、默认值和缺失分支需要谨慎分析。

### 10.4 双相校验

配置校验建议做成双相：

1. 保存配置时校验。
   - 用户修改子库“元数据完整 gate”、策略模板或子库绑定时，立即校验 gate 是否覆盖当前 optimize 策略会消费的输入。
   - 覆盖则允许保存。
   - 未覆盖则阻止保存或至少给强错误，提示“当前优化策略会使用 X，但元数据完整 gate 未要求 X”。

2. 运行时 invariant 校验。
   - 即使保存时通过，后续迁移、模板变化、代码版本变化仍可能破坏合同。
   - 当系统发现 item 已显示 metadata complete，但 strategy/TaskAdmission/SmartTask 无法推进 optimize 且原因是 gate 未覆盖必要输入时，必须产出明确诊断。
   - 建议内部诊断码为 `metadata_gate_contract_broken`。
   - 用户层表达为“元数据完整规则与优化策略不一致，请检查子库配置”。

### 10.5 技术拆分可以存在，但不能破坏用户语义

内部实现可以为了清晰拆出：

- technical facts；
- identity facts；
- strategy inputs；
- automation signals；
- operation-specific admission。

但这些技术分类不能在用户层制造互相打架的生命周期状态。

用户看到“元数据完整”时，它必须意味着该子库的 scrape completion gate 已通过，并且后续 optimize 没有隐藏的前置输入缺失。

### 10.6 对半假 scrape 的影响

普通库半假 scrape 的目标也要按这个模型修正：

- 它不是满足一套全局硬编码 metadata required fields；
- 它是尽量补齐当前子库配置的“元数据完整 gate”；
- 它可以通过 Emby、已有 Douban 缓存和 ShelfDeck 自算技术事实来补齐；
- 如果补不齐，失败原因必须指向该子库 gate 中哪个条件无法满足；
- 如果 gate 已满足，后续应能进入 optimize lifecycle，或者出现明确的 optimize 阶段阻断/资源等待/配置错误诊断。

因此后续实现顺序应先收敛 `metadataStatus` / gate 模型，再继续普通库半假 scrape 的准入和 executor 修复。

## 11. Lifecycle / Task / Flow / Event 的分层模型

本节记录 2026-06-30 继续讨论后确认的任务模型，后续 P0-1 不应再回到 `actionType` 作为主语义的旧模型。

### 11.1 四层定义

ShelfDeck 的顶层模型应按以下层次理解：

```text
lifecycle = 媒体状态
task      = lifecycle 状态转换的桥梁
flow      = task 内部 event 的编排
event     = 原子能力 / 资源消耗节点
```

- `lifecycle` 是用户心智中的状态机，例如 `ingest -> scrape -> optimize -> archive`。
- `task` 是一次状态转换尝试，例如“把这个媒体从 scrape 阶段推进到 optimize-ready”。
- `flow` 是该 task 内部如何编排多个 event，例如普通 Emby repair、成人 JAV scrape、转码、洗版等。
- `event` 是真正消耗资源的原子能力节点。未来如果存在大量 worker 节点，worker 提供的也应是 event 级能力，而不是直接抢 lifecycle 主语义。

因此，任务管理不能把 `flow`、`event` 或旧 `actionType` 当成用户层 lifecycle 主语义。

### 11.2 Flow 选择不属于 Task Management

一个 task 类型下可能存在多种 flow。最典型的是 `optimize`：

- 某个媒体的 optimize 可以走 `transcode` flow；
- 另一个媒体的 optimize 可以走 `upgrade` flow；
- 还有媒体可能通过 `keep` 直接收口。

过去这些差异由“策略计算引擎”产出，但代码里常被压缩成 `actionType=transcode/upgrade`。后续应收敛为：

- Task Management 只管理任务实例：创建、去重、排队、暂停、恢复、取消、历史。
- Strategy / policy 产出阶段转换所需的业务事实，例如 optimize 阶段到底应压缩、洗版、保留还是删除。
- Flow Selection / Task Planning 根据 lifecycle 阶段、item facts、strategy result、子库配置选择该 task 的 flow plan。
- Scheduler 只执行已经确定的 flow event 编排。

也就是说，task management 不应该“决定一个 task 走哪个 flow”。它应接收已经规划好的 task/flow facts，并负责生命周期内的任务实例管理。

### 11.3 SmartTaskEngine 不是智能决策器，而是任务触发器

在新模型下，`SmartTaskEngine` 不应该继续承担业务聪明判断。它应被理解为后台任务触发器：

```text
扫描 media item
检查该 item 是否达到触发下一个 lifecycle task 的 gate
若无同 item / 同阶段 active task，且触发层限额允许，则创建 task
```

它不应该决定：

- 普通库 repair 和成人 scrape 是否是两套任务管理逻辑；
- optimize 是走 transcode 还是 upgrade；
- scrape 未 meet gate 后是否新建另一个 scrape task；
- 某个 task 下游会消耗哪些资源。

因此，SmartTaskEngine 应尽量简单。它只负责根据 lifecycle gate 触发 task；真正的 flow 选择、失败恢复和资源消耗不属于它。

这里还缺一个需要后续明确的 gate：`ingest -> scrape` 的触发 gate。初步模型是：当 media item 已进入 ShelfDeck 的 `media_items`，并拥有稳定 `itemId`、`subLibraryId`、source identity / asset identity 后，就可以触发 scrape 阶段 task。

### 11.4 MetadataGate 是 scrape exit gate，不是 scrape trigger

此前容易混淆的一点是：`metadataGate` 不是“是否触发 scrape”的条件。

正确模型是：

```text
ingest 完成后必然进入 scrape 阶段；
scrape flow 执行后，用 metadataGate 判断 scrape 阶段是否完成；
metadataGate 通过后才进入 optimize；
metadataGate 不通过时，媒体停在 scrape 阶段，并由当前 scrape task/flow 给出失败、恢复或用户确认语义。
```

因此，`metadataGate` 是 scrape 阶段的完成判定，也就是 scrape exit gate。它不是 SmartTaskEngine 判断“要不要 scrape”的根条件。

如果一个 scrape task 执行后没有 meet gate，不能依赖 SmartTaskEngine 下一轮再创建一个新的 scrape task 来补救。是否 retry、resume、confirm、fail hard、从哪个 event 继续，属于该 scrape flow 的 recovery contract。

### 11.5 每种 Flow 的 Recovery Contract 必须补设计

目前每种任务类型下失败重试的 flow 语义没有被认真完整设计过。后续 P0-1 需要逐类补齐 recovery contract：

- `ingest`: 文件探测失败、部分写入 media item、文件移动或缺失后如何 retry。
- `scrape`: 普通 repair 未 meet metadataGate、成人 scrape ambiguous / needs_review / 写入部分海报 NFO 后如何 retry 或转用户确认。
- `transcode`: precheck、encode、replace、verify 各阶段失败后是否可重试、从哪里恢复、临时文件如何处理。
- `upgrade`: 搜索、候选选择、下载、替换前验证、替换失败后是否会重复提交 MoviePilot 请求。
- `delete/archive`: path safety、部分删除、marker 校验失败后是否可安全 retry。

通用 retry endpoint 只能是外壳。真正能不能恢复、恢复点在哪里、是否幂等，必须由具体 flow contract 决定。

### 11.6 SmartTaskEngine 不管理资源，只消费资源刹车信号

SmartTaskEngine 触发 task 时理论上不消耗资源。真正消耗资源的是 task 开始执行 flow，并 dispatch 到具体 event/node 的时候。

因此 SmartTaskEngine 不应该自己理解或计算：

- 下游会走哪个 flow plan；
- flow 里有多少 event；
- event 会消耗 `emby`、`local_transcode`、`moviepilot`、`scraper` 还是其他资源；
- 当前资源是否足够。

如果需要避免任务触发过多，应该由资源视图/资源治理层给出刹车信号：

```text
Resource View / ResourceGovernor 观察 backlog、resource pressure、外部依赖健康
=> 给 SmartTaskEngine 一个“暂时不要触发更多任务”的结论
=> SmartTaskEngine 记录 skip reason，但不自己推导资源消耗
```

这和 Scheduler 的 event dispatch 限流是两件事：

- Trigger pressure: 是否允许继续创建新 task，避免任务中心/队列膨胀。
- Dispatch pressure: 是否允许 scheduler 分派某个 event，避免资源过载。

SmartTaskEngine 只消费 trigger pressure 的结论；Scheduler 才负责 dispatch pressure 下的 event 执行节奏。
