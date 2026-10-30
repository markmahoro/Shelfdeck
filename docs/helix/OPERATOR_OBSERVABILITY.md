# Operator Observability（维护套件 · 低开销）

官方 **Operator Maintenance Suite** 的只读可观测切片。目标：Admin 卡住后能事后对照结构化请求时长与 event-loop lag，而不是堆叙事式运维文案。

## 始终开启（生产默认）

Clean Service Host 对已登记 API 路由（含 `GET /v1/health`）每请求发出 **一条** 紧凑事件：

```text
[shelfdeck] operator.http {
  kind: 'operator.http',
  method, route, status, durationMs, correlationId
  [, errorCode]
}
```

- `route` 使用路由模板（如 `/v1/admin/formation`），不是带 query 的原始 URL。
- 默认 **不** 记录请求/响应体、Secret、Cookie。
- 请求处理抛错时另发 `operator.http.error`（含稳定 `errorCode` 与截断 message）。

Docker / 进程 stdout 即可检索；无需打开更深 debug 才能看到基本卡顿时长。

## Event-loop lag（阈值 + 限流）

默认约每 2s 采样一次；仅当区间 `maxMs` ≥ 阈值（默认 **500ms**）且距上次写出 ≥ **10s** 时发出：

```text
[shelfdeck] operator.event_loop_lag {
  kind: 'operator.event_loop_lag',
  maxMs, meanMs, thresholdMs
}
```

## 临时加深 debug

| 变量 | 作用 |
| --- | --- |
| `SHELFDECK_OPERATOR_OBSERVABILITY_DEBUG=1` | 更深 debug 标记；降低 lag 阈值（默认 100ms）与采样间隔（默认 1s） |
| `SHELFDECK_OPERATOR_OBSERVABILITY_EVENT_LOOP_THRESHOLD_MS` | 覆盖 lag 阈值（毫秒） |

启用后重启 Clean Service 进程/容器即可；排查结束务必去掉 debug 环境变量并重启，避免无谓日志量。

**不要**依赖 debug 才能发现基本 Admin 卡住——始终开启的 `operator.http` duration 已足够对照。

## 只读状态入口

`GET /v1/admin/runtime/operator-maintenance` catalog 可含只读字段：

```text
observability.schemaRef = platform.operator-observability-status@1
```

显示 request metrics / lag 开关与阈值、debug 是否开启。此处 **不** 提供破坏性维护动作。

## 硬边界

- 不引入 OpenTelemetry / Jaeger / Prometheus 整栈。
- 不写业务步骤中文叙事日志。
- 不在热路径上对大对象做 `JSON.stringify`，不在 instrumentation 内做同步磁盘 IO。
- 不触碰 Formation Reset / 生产数据 / US Adult 业务边界。
