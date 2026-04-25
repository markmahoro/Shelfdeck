# DEV_ELECTRON_PRELOAD — Electron preload 与沙盒

> **SSOT 路径**：[`DEV_ELECTRON_PRELOAD.md`](./DEV_ELECTRON_PRELOAD.md) · 文档索引 [`DOC_GOVERNANCE.md`](../DOC_GOVERNANCE.md)

`media-desktop/electron/main.js` 里 `BrowserWindow` 使用 `contextIsolation: true`，且未关闭沙盒。在此模式下，**preload 脚本运行在沙盒环境中**。

## 约束（必读）

1. **不要在 `media-desktop/electron/preload.js` 里使用 Node 内置模块**，例如 `require('path')`、`require('fs')`、`require('crypto')` 等。顶层或运行时的 `require` 一旦抛错，Electron 会报 **Unable to load preload script**，整段 preload 不会执行。
2. **后果**：`window.embyApi` / `window.doubanApi` 未注入；开发模式下 `media-desktop/src/main.tsx` 会执行 `installDevEmbyStub()`，界面出现 `**[模拟]`** 等假数据，转码相关桥接也不存在。
3. **正确做法**：
  - 业务数据与任务：**HTTP** 调用 **媒体管理服务**（`preload` 内 `fetch`；见 `API_README`）。
  - 必须用 Node 能力时：放到 `**electron/main.js` 主进程** 或 **`media-service`**，通过 `ipcMain.handle` / HTTP 暴露，preload 里只保留 `ipcRenderer.invoke` 或 `fetch`。
