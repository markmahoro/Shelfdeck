# DESIGN_TRAY/HEALTH_MONITORING — 健康监控（已迁移）

> 状态：已迁移到 TRAY/LIFECYCLE.md

健康监控逻辑已内嵌到 tray 模块（`media-service/src/tray.js`）。每 3s 轮询 `GET /v1/health`，驱动托盘图标颜色（green/red）。

详见 `TRAY/LIFECYCLE.md` §2 "运行中"。
