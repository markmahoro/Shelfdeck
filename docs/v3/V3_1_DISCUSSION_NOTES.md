# ShelfDeck v3.1 Discussion Notes

本文记录 v3.1 推进过程中已经讨论清楚、但容易在后续切片中被遗忘的产品语义、排查结论和工作约定。

后续继续 v3.1 P0/P1/P2 任务前，应先读本文，再读 `V3_1_PROGRESS.md` 和相关代码。本文不是最终架构合同；当代码和生产证据推翻本文时，应先更新本文，再继续实现。

## 1. 推进顺序与汇报约定

- 当前优先级按用户补充的 P0 到 P2 顺序推进，除非某个问题需要等待生产环境观察。
- P0-1 是 task 管理和每种库类型下 task 生命周期是否符合预期。一个问题可能需要多个 slice，不要把“做了诊断工具”当成问题已解决。
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
