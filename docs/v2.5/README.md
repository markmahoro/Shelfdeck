# ShelfDeck v2.5 Architecture Upgrade

v2.5 是从 v2.0 生产基线出发的渐进式 service 架构升级。

它不是 v3 全量重建，也不是把 v2 功能重新实现一遍。v2.5 的目标是在保留 v2 已验证生产能力的前提下，优先升级 `media-service` 的核心架构边界、数据模型、调度模型、projection 和 service Admin Web 语义。

## 版本定位

```text
v2.0  当前生产基线，tag: v2.0.0
v2.5  service 架构内核升级，保留 v2 flow 能力
v3.0  暂缓；是否需要更彻底重构，等 v2.5 稳定后再决定
```

## 本轮优先对象

- `media-service/`
- `media-service/web/`
- service Docker/NAS 部署流程

## 本轮非优先对象

- `media-desktop/`：只做兼容影响排摸，不主动重构。
- `media-worker/`：只做接口和资源边界排摸，不主动重构。
- FFmpeg/MoviePilot/adult scrape/delete/transcode/upgrade 细节：先保留 v2 能力，通过 adapter/event/projection 包起来，再逐步替换。

## 文档入口

| 文件 | 用途 |
| --- | --- |
| `UPGRADE_STRATEGY.md` | v2.5 总体升级策略 |
| `DATA_RUNTIME_MODEL.md` | SQL facts、内存 runtime、projection 的 v2.5 落地模型 |
| `IMPLEMENTATION_STAGES.md` | 分阶段实施路线 |
| `V2_6_TO_V3_ROADMAP.md` | v2.6、v2.7、v3.0 三段迭代计划与验收标准 |
| `GOAL_PROMPT.md` | 可用于开启 v2.5 长程任务的提示词 |

## 关键原则

- 不重写 v2 已经稳定运行的复杂 flow，先包起来。
- 不用大爆炸迁移，优先 shadow write、dual read、可回滚。
- 不为了“干净架构”丢失生产细节。
- 性能优化优先落在数据读取、任务列表、媒体库列表、调度扫描和 projection。
- Admin Web 按新业务语义重整展示，但底层能力可以先复用 v2。
