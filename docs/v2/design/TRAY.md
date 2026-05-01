# DESIGN_TRAY — 系统托盘模块

> 状态：v4 定稿
> 关联 ARCH_OVERVIEW §1.2, §2, §5

## 组件定位

托盘不是独立进程，而是 **service 进程内的轻量模块**（`media-service/src/tray.js`）。使用 `systray2` 库（Go 原生二进制）通过 stdin/stdout 与 Windows 系统托盘 API 通信。零外部依赖，无需 .NET 运行时。

## 功能

| 功能 | 实现 |
|------|------|
| **静态品牌图标** | 使用 `assets/tray/shelfdeck.ico`（多尺寸 ICO），不随健康状态变化 |
| **健康状态展示** | 每 3s 轮询 `GET /v1/health`，结果以不可点击的菜单项展示（如"ShelfDeck — 正常"） |
| **打开管理页面** | 右键菜单项，在默认浏览器中打开 admin web（跳转到 `/media-libraries`） |
| **退出服务** | 右键菜单项，关闭托盘并停止 service 进程 |

## 菜单结构

```
打开 ShelfDeck 管理后台
──────────────
ShelfDeck — 正常          ← 只读健康状态，不随图标变化
──────────────
退出 ShelfDeck
```

## 技术细节

- **库**: `systray2`（Go 原生二进制 `tray_windows_release.exe`，PE32+，零运行时依赖）
- **图标**: `assets/tray/shelfdeck.ico`（静态，16/32/48px 多尺寸 ICO）
- **轮询间隔**: 3s
- **健康状态更新**: 仅更新菜单项文字（`update-item`），不动图标

### 健康状态文字

| `/v1/health` status | 菜单项显示 |
|---|---|
| `green` | "ShelfDeck — 正常" |
| `yellow` | "ShelfDeck — 部分就绪" |
| `red` 或其他 | "ShelfDeck — 异常" |
| null（启动中） | "ShelfDeck — 启动中…" |

## 依赖

- `systray2` — Go 原生托盘库（Windows 系统托盘 API）
- `http` — 健康检查 HTTP 请求
- `child_process.exec` — 打开浏览器

> 注：`trayicon` 已废弃（Mono/.NET 依赖导致干净 Win11 上崩溃），不再使用。
