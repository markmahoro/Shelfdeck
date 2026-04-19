# DEV_ELECTRON_PRELOAD — Electron preload 开发注意（沙盒）

> **SSOT 路径**：[`DEV_ELECTRON_PRELOAD.md`](./DEV_ELECTRON_PRELOAD.md) · 文档索引 [`DOC_GOVERNANCE.md`](../DOC_GOVERNANCE.md)

## 背景

`mvp/electron/main.js` 里 `BrowserWindow` 使用 `contextIsolation: true`，且未关闭沙盒。在此模式下，**preload 脚本运行在沙盒环境中**。

## 避坑规则

1. **不要在 `mvp/electron/preload.js` 里使用 Node 内置模块**，例如 `require('path')`、`require('fs')`、`require('crypto')` 等。顶层或运行时的 `require` 一旦抛错，Electron 会报 **Unable to load preload script**，整段 preload 不会执行。
2. **后果**：`window.embyApi` / `window.doubanApi` 未注入；开发模式下 `mvp/src/main.tsx` 会执行 `installDevEmbyStub()`，界面出现 `**[模拟]`** 等假数据，转码相关桥接也不存在。
3. **推荐做法**：
  - 路径拼接等与平台相关的简单逻辑：用 **纯字符串**（与 `App.tsx` 中 `deriveReplaceBackupPath` 对齐）。
  - 必须用 Node 能力时：放到 `**electron/main.js` 主进程** 或 **control-plane**，通过 `ipcMain.handle` / HTTP 暴露，preload 里只保留 `ipcRenderer.invoke` 或 `fetch`。

## 自检

启动 `npm run dev` 后，在 Electron 开发者工具 Console 中执行：

`typeof window.embyApi?.transcodeStatPaths`

应为 `"function"`。若为 `undefined` 且 Console 有 preload 加载错误，优先检查 preload 是否新引入了 Node 模块。

## 追溯与关联文档

| 文档 | 关系 |
|------|------|
| [`API_README.md`](../api/API_README.md) | 业务走 HTTP 时的约定 |
| [`DEV_SETUP.md`](./DEV_SETUP.md) | 本地开发 |
| [`DESIGN_TASK_CENTER.md`](../design/DESIGN_TASK_CENTER.md) | 任务中心行为 SSOT |