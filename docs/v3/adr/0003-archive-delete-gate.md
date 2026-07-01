# ADR 0003: 将 delete 从 optimize 拆为 archive 后独立 gate

## Status

Accepted.

## Context

Kairox 早期合同把 Lifecycle 收敛为 5 阶段 4 gate，并在旧兼容实现中把 `delete` 和 `transcode`、`upgrade` 一起放在 optimize flow operation 语境下。

这个模型在业务语义上有两个问题：

- Optimize 的本质是让媒体事实达到归档前目标，例如码率、编码、分辨率、音轨、字幕、HDR、体积或来源质量。删除媒体并不是把某个媒体事实优化到目标值。
- 5 阶段模型容易让 `archive` 被误读为生命周期终点，无法自然表达“已归档一段时间后，根据评分、观看状态、用户长期归档偏好等规则进入删除候选”的后续处置流程。

典型业务场景是：2 星电影完成 metadata / optimize / archive 后，继续在归档库中保留 6 个月；满 6 个月后进入 delete candidate，等待用户确认删除、继续已归档、延后提醒或不再建议。

同时，用户界面应继续使用“已归档”。它表达的是媒体已经安全进入库内闭环，不应改成“保留中”等容易造成不安全感的新术语。

## Decision

Kairox Lifecycle 改为 6 阶段 5 gate：

```text
source/discovered -> ingested -> metadata-ready -> optimized -> archived -> deleted
```

对应 gate：

```text
ingest -> metadata -> optimize -> archive -> delete
```

`archive` 继续保留“已归档”的用户语义。已归档表示媒体已经完成入库、元数据和必要优化，当前可以安心放在库中；它不是生命周期终点，也不等于永不删除。

`delete` 是 archive 之后的独立 gate：

- Delete eligibility 由已归档媒体事实和策略计算，例如归档时间、评分、观看状态、用户长期归档偏好。
- Delete candidate / 处置队列是普通业务页面，用户可以确认删除、保持已归档、延后提醒或不再建议。
- Delete flow 属于 `targetGate=delete` 的实现路径。
- Delete 不再是 optimize flow operation。
- 默认模型是 review-first；destructive delete 只有在用户确认或显式 destructive pre-authorization 后才能执行。

Optimize objective 收敛为媒体事实目标合同。若当前 observed media facts 已满足目标，optimize gate 直接通过；不需要把 `keep` 建模成独立目标。

## Consequences

- `automaticTaskTargets` 可以包含 `delete`，但 `optimizeAllowedOperations` 不能包含 `delete`。
- 旧 `smartTaskEnabledActions=delete` 只能迁移为 `automaticTaskTargets` 的 delete 授权，不能迁移为 optimize operation 授权。
- 后续 v3.4+ 设置页、任务中心、flow planner 和测试应以 `targetGate=delete` 表达删除语义。
- 现有代码或文档中把 delete 当成 optimize operation 的描述属于 Mirex compatibility debt，需要在后续版本清理。
- Delete 自动化必须保留 review / confirmation / destructive authorization / audit / verify 的独立安全边界。
