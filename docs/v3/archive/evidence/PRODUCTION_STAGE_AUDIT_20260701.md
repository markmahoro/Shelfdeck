# 生产 Stage 盘点问题记录 - 2026-07-01

本文记录 2026-07-01 对生产环境 5 个媒体库进行 lifecycle stage 盘点时暴露出的业务问题。本文只记录事实、样本池和后续设计问题，不引入运行时状态，不作为任务池清理逻辑的一部分。

## 1. 盘点边界

- 生产服务：ShelfDeck Docker `192.168.12.230:18080`
- 数据范围：5 个生产媒体库，共 2575 个 item
- 盘点方式：按当前代码重新投影 lifecycle stage，并与生产库中存储的 stage 对比
- 结论：`stageDiffCount = 0`

因此，本轮没有发现需要批量校准 stage 的 item。后续任务池清零只处理任务过程数据，不修改媒体库 item 数据。

## 2. 关键样本池

### 2.1 Optimize Gate Failed 样本

这类 item 已经有过转码完成记录，但当前 optimize gate 验收未通过，因此停留在 `metadata_ready`，`lifecycle_next_task` 为空，`lifecycle_reason = optimize_gate_failed`。

| 媒体库 | 数量 | 说明 |
| --- | ---: | --- |
| 公共_电影_原生 | 220 | 全部有 `lastTranscodeDoneAt`，其中当前任务池仍有 39 个活跃转码任务交集 |
| 公共_剧集 | 45 | 全部有 `lastTranscodeDoneAt` |
| US | 1 | 有 `lastTranscodeDoneAt` |
| 公共_国产剧 | 0 | 无该类样本 |
| JAV | 0 | 无该类样本 |

合计 266 个样本。该样本池用于后续分析 optimize gate 是否合理，以及转码成功但验收失败时应如何处理。

### 2.2 JAV 非标准 AdultId 样本

JAV 中有 60 个 item 停留在 `ingested -> metadata`。其中约 59 个已经 `scrapeStatus = done` 且 `scraped = true`，但 metadata gate 缺 `adult.adultId`。

典型路径包括：

- `081422_001.mkv`
- `120319_937.mkv`
- `caribbeancom092023-001.mkv`
- `n0651.mkv`
- `031309_548-CD1.mkv`
- `IBW-481z.mkv`

这说明历史 JAV 数据中存在非标准番号格式。当前 adultId 识别主要适配 `ABC-123` / `FC2-123456` 这类格式，导致 NFO 已读入但 `adultMetadata.adultId` 为空。

### 2.3 Strategy Missing 样本

公共_国产剧有 26 个 item 处于 `metadata_ready -> optimize`，原因是 `strategy_missing`。这些 item 已具备基础元数据，但策略方向没有落下来。

## 3. 任务池清零前的业务状态分层

| 媒体库 | 总数 | 已归档 | 待 archive 收口 | Optimize Gate Failed | 待优化候选 | 待 metadata |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 公共_电影_原生 | 924 | 272 | 242 | 220 | 160 | 30 |
| 公共_剧集 | 211 | 0 | 122 | 45 | 38 | 6 |
| 公共_国产剧 | 47 | 0 | 5 | 0 | 42 | 0 |
| JAV | 682 | 305 | 0 | 0 | 317 | 60 |
| US | 711 | 28 | 0 | 1 | 310 | 372 |

这些状态本身与当前代码投影一致，不视为 stage 错误。

## 4. 老保护逻辑与新架构的冲突

老架构中，“转码成功后不再触发转码任务”是合理保护逻辑，因为当时“转码成功”基本等同于业务完成。

新架构中，业务完成应以 optimize gate 是否达成为准，而不是单纯以 `lastTranscodeDoneAt` 为准。因此出现了新的冲突：

- item 已经转码成功过；
- 当前媒体事实仍未满足目标码率或目标 codec；
- lifecycle 认为 optimize gate failed；
- admission 又因为已有转码完成记录或 gate failed 阻止自动重转；
- item 因此既不能归档，也不会自动再次转码。

电影 220、剧集 45、US 1 就是这类冲突的生产样本。后续设计应从“是否转过一次”转向“当前 optimize objective 是否验收通过”。

## 5. 后续设计问题

后续不应在任务池清零中顺手加运行时逻辑。建议单独设计以下问题：

- optimize gate 的码率容差是否合理；
- 转码后节省空间明显但仍未达目标时，是否允许接受并归档；
- codec 未达标和 bitrate 未达标是否应分开处理；
- Emby 未刷新导致的旧媒体事实是否应有重新验收入口；
- gate failed 是否应有独立 admin web 视图；
- 是否允许人工选择“接受当前结果并归档”；
- 是否允许人工选择“重新转码/重新验收”；
- JAV 非标准 adultId 是否应扩展识别规则，或放宽 metadata gate；
- 国产剧 `strategy_missing` 是否需要独立策略补算入口。

## 6. 本轮处理原则

- 不修改媒体库 item 数据；
- 不新增 frozen 字段；
- 不新增运行时状态；
- 不改变 SmartTask 逻辑；
- 不删除兼容接口；
- 样本冻结只做离线审计快照；
- 任务池清零只清 `tasks` 和 `task_events`；
- 旧任务数据通过备份保留，用于后续排查。
