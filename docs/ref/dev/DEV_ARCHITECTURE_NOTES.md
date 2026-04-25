# DEV_ARCHITECTURE_NOTES — 前端与联调备忘

> **SSOT 路径**：[`DEV_ARCHITECTURE_NOTES.md`](./DEV_ARCHITECTURE_NOTES.md) · 文档索引 [`DOC_GOVERNANCE.md`](../DOC_GOVERNANCE.md)

## 目录

- `**media-desktop/**`：Electron 壳、渲染进程（Vite/React）、与本机播放相关的 IPC。
- `**media-service/**`：**媒体管理服务** HTTP 服务、任务与转码等领域逻辑（历史目录名 `control-plane/`）。

## 联调

业务请求默认走 **HTTP** 至媒体管理服务；详见 `[API_README.md](../api/API_README.md)` 中 IPC→REST 对照表。

## 模拟数据

开发模式下若 preload 未加载成功，`main.tsx` 可能安装 Emby stub，界面出现 `[模拟]` 标识；优先按 [`DEV_ELECTRON_PRELOAD.md`](./DEV_ELECTRON_PRELOAD.md) 排查。

## 追溯与关联文档

| 文档 | 关系 |
|------|------|
| [`API_README.md`](../api/API_README.md) | REST 与 IPC 对照 |
| [`DEV_ELECTRON_PRELOAD.md`](./DEV_ELECTRON_PRELOAD.md) | preload 沙盒 |
| [`ARCH_SYSTEM_OVERVIEW.md`](../architecture/ARCH_SYSTEM_OVERVIEW.md) | 架构 |
