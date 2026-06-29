# ShelfDeck v2 Production Baseline

本文记录 v2 的固化边界。

## 定义

v2 是当前 NAS 生产环境正在运行的 ShelfDeck service 版本。它不是旧 `v1.0.0` Git tag，而是生产容器中实际运行的 service 代码快照。

当前生产容器信息：

```text
image: markmahoro/shelfdeck:codex-20260629-space-stats-columns
container: shelfdeck
runtime: Docker/Linux service
```

本轮回退目标：

```text
media-service/src/ == production container /app/src
```

## v2 范围

- ShelfDeck service 当前生产代码。
- service Admin Web 当前生产构建结果对应的源码状态。
- 当前 `tasks.db` / `library.db` SQLite 模型。
- 当前 task/actionType/flow executor 模型。
- 当前 NAS Docker 部署流程。

## 非 v2 范围

- 已经被暂停或回退的半成品重构代码。
- 下一轮 v3 全库重写的具体架构设计。
- 尚未经过排摸、确认和实现验证的新数据模型或新组件拆分。

这些内容不应进入 v2 生产基线 tag。`docs/v3/` 只保留后续 agent 开工所需的操作上下文和排摸要求，不作为 v3 架构设计约束。

## 固化规则

固化 v2 前必须确认：

- 本地 `media-service/src` 与生产容器 `/app/src` 文件哈希一致。
- v3 半成品源码和迁移脚本已移除。
- v3 文档只存在于 `docs/v3/`，不改变 v2 runtime 行为。
- 如创建 tag，tag 应使用新的 v2 tag，例如 `v2.0.0`，不要复用或移动历史 `v1.0.0` tag。
- v3 全库重写完成后再使用 `v3.0.0` 或其他明确的 v3 tag。
