# DESIGN_TRAY — 系统托盘模块

> 状态：v4 定稿
> 关联 ARCH_OVERVIEW §1.2, §2, §5

## 组件定位

托盘不再是独立进程，而是 **service 进程内的轻量模块**（`media-service/src/tray.js`）。使用 `trayicon` 库（Go 便携二进制）替代 Electron，通过 stdin/stdout 与系统托盘 API 通信。

## 功能

| 功能 | 实现 |
|------|------|
| **健康状态指示灯** | 每 3s 轮询 `GET /v1/health`，`resolveHealth()` 处理三层状态：绿色（正常）、黄色（部分就绪）、红色（异常） |
| **打开管理页面** | 右键菜单项，在默认浏览器中打开 admin web（跳转到 `/media-libraries`） |
| **退出服务** | 右键菜单项，关闭托盘并停止 service 进程 |

## 技术细节

- **库**: `trayicon`（Go 便携二进制 `tray_windows_release.exe`，无需原生编译）
- **图标**: `assets/tray/status-running.ico`（绿），`status-unhealthy.ico`（红），`status-stopped.ico`（黄/灰色，启动中或部分就绪）
- **轮询间隔**: 3s
- **右键菜单**: "打开 ShelfDeck 管理后台" → 打开 `/media-libraries`，"退出 ShelfDeck" → 停止进程

### 健康状态映射 (`resolveHealth()`)

| `/v1/health` status | 托盘图标 | Tooltip |
|---|---|---|
| `green` | `status-running.ico` | "ShelfDeck — 正常" |
| `yellow` | `status-stopped.ico` | "ShelfDeck — 部分就绪" |
| `red` 或其他 | `status-unhealthy.ico` | "ShelfDeck — 异常" |

## 依赖

- `trayicon` — Go 便携二进制托盘库（Windows 系统托盘 API）
- `http` — 健康检查 HTTP 请求
- `child_process.exec` — 打开浏览器

> 注：`systray2` 仍在 `package.json` 中但已不再使用，实际依赖为 `trayicon`。

## 生命周期

参见 `TRAY/LIFECYCLE.md`

## 关联文档

- `media-service/src/tray.js` — 实现源码
- `media-service/assets/tray/` — 图标资源
- `media-service/src/server.js` — 调用 `startTray(port)` 的入口
