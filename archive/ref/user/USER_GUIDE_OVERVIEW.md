# USER_GUIDE_OVERVIEW — 用户能力概览（占位）

> **SSOT 路径**：[`USER_GUIDE_OVERVIEW.md`](./USER_GUIDE_OVERVIEW.md) · 文档索引 [`DOC_GOVERNANCE.md`](../DOC_GOVERNANCE.md)

**ShelfDeck**（Windows）提供：连接 Emby、海报墙与第三方播放器观影、媒体库治理与任务中心（删除/转码/洗版等）、播放记录与配置。

**推荐首次使用顺序**（产品口径）：在 **ShelfDeck 小助手**（任务栏托盘）里 **先配置并保存** ShelfDeck **媒体管理服务** 基址（必要时 **启动** 本机服务），确认 **绿** 或桌面已解锁后，再打开桌面 **配置中心** 完成 **Emby、豆瓣、任务调度** 等设置，最后使用五页能力。桌面 **不提供** 改媒体管理服务地址的页面。细则见 [`DESIGN_DESKTOP_BACKEND_ENDPOINT.md`](../design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md)。

**ShelfDeck 小助手**：**唯一** 用户向配置媒体管理服务地址的入口；**左键**面板写明当前服务器地址；图标 **黄/绿/红** 表示健康状态。桌面 **只读** 同一连接并与小助手 **同源** 探测 `GET /v1/health`，顶栏有 **小型** 联通提示。打开桌面时一般会 **同时出现** 小助手；**关掉桌面主窗口** 通常 **不会** 关掉小助手。说明见 [`USER_GUIDE_TRAY_MEDIA_SERVICE.md`](./USER_GUIDE_TRAY_MEDIA_SERVICE.md)。

详细操作与任务中心说明见 [`USER_GUIDE_TASK_CENTER.md`](./USER_GUIDE_TASK_CENTER.md)（待扩写）。

## 追溯与关联文档

| 文档 | 关系 |
|------|------|
| [`REQ_PRODUCT_BASELINE_v1.0.0.md`](../requirements/REQ_PRODUCT_BASELINE_v1.0.0.md) | 产品范围 |
| [`DESIGN_FRONT_PLAYBACK.md`](../design/DESIGN_FRONT_PLAYBACK.md) | 观影与五页架构 |
| [`DESIGN_DESKTOP_BACKEND_ENDPOINT.md`](../design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md) | 连接端点（小助手写、桌面读） |
| [`USER_GUIDE_TRAY_MEDIA_SERVICE.md`](./USER_GUIDE_TRAY_MEDIA_SERVICE.md) | ShelfDeck 小助手 |
| [`USER_GUIDE_TASK_CENTER.md`](./USER_GUIDE_TASK_CENTER.md) | 任务中心（占位） |
