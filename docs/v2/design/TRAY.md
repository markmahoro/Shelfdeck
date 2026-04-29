# DESIGN_TRAY — 系统托盘模块

> 状态：实现完成
> 关联 ARCH_OVERVIEW §1.2, §2, §5

## 组件定位

托盘不再是独立进程，而是 **service 进程内的轻量模块**（`media-service/src/tray.js`）。使用 `systray2` 库（Go 便携二进制）替代 Electron，通过 stdin/stdout 与系统托盘 API 通信。

## 功能

| 功能 | 实现 |
|------|------|
| **健康状态指示灯** | 每 3s 轮询 `GET /v1/health`，托盘图标绿/红切换 |
| **打开管理页面** | 右键菜单项，在默认浏览器中打开 admin web |
| **退出服务** | 右键菜单项，关闭托盘并停止 service 进程 |

## 技术细节

- **库**: `systray2`（Go 便携二进制 `tray_windows_release.exe`，无需原生编译）
- **图标**: `assets/tray/status-running.ico`（绿）, `status-unhealthy.ico`（红）, `status-stopped.ico`（灰）
- **轮询间隔**: 3s
- **右键菜单**: "打开管理页面" → shell.openExternal, "退出" → process.exit

## 生命周期

参见 `TRAY/LIFECYCLE.md`

## 关联文档

- `media-service/src/tray.js` — 实现源码
- `media-service/assets/tray/` — 图标资源
- `media-service/src/server.js` — 调用 `startTray(port)` 的入口
