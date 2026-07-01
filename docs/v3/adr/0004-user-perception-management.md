# ADR 0004: 引入 User Perception Management

## Status

Accepted.

## Context

Kairox 早期讨论中，optimize objective 被理解为 metadata gate 之后即可计算的目标。但默认策略模板和当前代码把 `doubanRating`、`userRating`、`watched` 等字段混在 metadata、strategy condition 和 optimize action 里，导致几个边界不清：

- 用户评分、已看状态、播放次数不是“媒体是什么”的元数据。
- 一个媒体没有评分，不应因此过不了 metadata gate。
- 用户可以在任意 lifecycle stage 改变评分、已看、收藏或播放行为；这些变化会修订 optimize objective，但不应回退 metadata gate。
- ShelfDeck 当前从 Douban 获取的是用户私人评分和用户自己的观看状态，不是公众评分。
- Task Creator 如果自行比较 rating 或 objective hash，会把 Lifecycle 的目标投影职责挪到 task 创建侧。

因此，metadata gate passed 不等于 optimize objective ready。Optimize objective 应由 Lifecycle 消费 metadata/media facts、user perception facts 和 policy facts 后计算。

## Decision

将 `User Perception Management` 定义为 Kairox 核心组件之一，和 Lifecycle、Task Creator、Task Scheduler、Flow Planner、Resource Runtime 并列。

User Perception Management owns user-perception facts：

- rating，包括本地用户评分、Douban 私人评分、Emby 用户评分和导入评分。
- watched、playCount、lastPlayedAt、favorite。
- manual tier，例如 premium / high / standard / baseline。
- perception source、source priority、perceptionVersion、perceptionUpdatedAt。

它负责从 Admin Web / Desktop 用户操作、Emby、Douban 私人账号、播放历史和导入数据采集、归一化、合并和版本化这些事实。

它不负责：

- 判断 metadata gate。
- 计算 optimize objective。
- 判断 optimize / archive / delete gate。
- 创建 task。
- 选择 flow。

Lifecycle consumes user-perception facts：

```text
metadata/media facts
  + user perception facts
  + policy facts
  -> optimizeObjectiveStatus
  -> gateObjective
  -> lifecycle projection
```

Objective revision 是 Lifecycle 的 declarative projection。User Perception Management 只写 perception facts 和 perception change facts；Lifecycle 重新计算 objectiveHash / objectiveVersion；Task Creator 扫描 Lifecycle projection 后再决定是否创建 task。

如果未来引入 Douban 公众评分、IMDb、TMDB vote、Bangumi 公共评分等外部群体评价，应建立 `Public Reception Management` 或等价组件。公众评价不属于当前 User Perception Management，也不属于 metadata gate。

## Consequences

- `doubanRating`、`userRating`、`watched`、`playCount`、`favorite`、`manualTier` 不得作为 metadata gate required facts。
- 当前默认策略模板和 v3.4+ 路线图需要结合代码重新审计和重排。
- 旧 `strategyEngine` 仍可作为 compatibility implementation module，但其新语义必须收口为 Lifecycle optimize objective projection。
- Task Creator 不得自行比较 perception facts 或 objective hash；它只承接 Lifecycle projection。
- 已 archived 媒体在 perception facts 改变后，可以因新 objective 不满足而重新投影为 optimize pending；这不是 archive gate 自行创建任务，而是 Lifecycle objective revision 的结果。
