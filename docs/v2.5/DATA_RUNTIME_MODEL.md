# ShelfDeck v2.5 Data Runtime Model

本文描述 v2.5 推荐落地的数据和运行态模型。

它是渐进升级模型，不要求一次替换 v2 的 `tasks.db`、`library.db` 或现有 payload。

## 1. 三层模型

v2.5 将数据分为三层：

```text
SQL facts       可恢复事实
memory runtime  实时运行态
projections     查询/展示/调度读模型
```

## 2. SQL Facts

SQL facts 是事实来源。

v2.5 可以先在现有 SQLite 基础上新增表或索引，候选包括：

- `task_events`：记录 task 内发生的 event。
- `task_current` 或等价 projection：记录 task 当前轻量状态。
- `item_lifecycle_projection`：记录 item 当前业务阶段。
- `resource_projection`：记录 active/waiting resource usage。
- `admin_media_projection`：Admin Web 媒体库列表读模型。
- `admin_task_projection`：Admin Web 任务列表读模型。

具体是否放在现有 `tasks.db` / `library.db`，还是新增 `events.db`，由实施前排摸决定。

## 3. Event Journal

v2.5 不要求一步到位重写 flow，但要求旧 flow 执行时写 event。

第一阶段 event 可以是 coarse-grained：

- task admitted
- task queued
- flow started
- approval requested
- external call started/finished
- resource acquired/released
- retry scheduled
- paused/resumed/cancelled/interrupted
- flow done/failed

后续再细化到每个 flow 的专属 event。

## 4. Memory Runtime

内存只保存实时运行态，不作为事实来源。

适合放内存：

- running tasks
- active events
- resource slots
- ffmpeg process handles
- cancellation tokens
- progress/status hot cache
- dependency short health cache

service 重启后，必须能从 SQL facts 和 v2 当前 task 状态恢复。

## 5. Projection

projection 是 v2.5 性能收益的主要来源。

优先 projection：

- task list projection：任务中心不扫全量 payload。
- media list projection：媒体库列表分页、筛选、排序走轻量字段。
- space stats projection：空间统计走结构化字段。
- lifecycle projection：item 是否处理完成、处于哪个阶段。
- diagnostics projection：外部依赖和最近失败。

projection 可以先由现有写路径同步更新，也可以由后台 rebuilder 从 facts 重建。

## 6. Shadow Write

推荐第一阶段采用 shadow write：

旧逻辑继续工作，新 event/projection 同步记录。

验证方式：

- 旧 API 返回和新 projection 对比。
- Admin Web 可以先加隐藏 debug view 对比。
- scheduler 可先只读取 projection 做统计，不直接调度。

稳定后再切读路径。

## 7. Recovery

v2.5 必须优先处理恢复语义：

- task 状态和 event 状态不一致时，以可解释规则修复。
- running runtime 丢失时，active task/event 进入 interrupted 或 queued recovery。
- FFmpeg partial 文件不能被误删。
- replace 阶段不能重复破坏原文件。
- MoviePilot 已提交下载但本地 task 中断时，需要可见事件和人工恢复入口。

恢复模型必须比 v2 更清晰，但不要求第一阶段覆盖所有 edge case；至少不能比 v2 更危险。
