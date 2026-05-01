# DESIGN_TRAY/LIFECYCLE — 托盘生命周期

> 状态：v4 定稿

## 1. 启动

```
server.js: app.listen() 成功
    → startTray(port)
        → Tray.create({ icon: status-stopped, title: "ShelfDeck — 启动中…" })
        → tray.ready() → 开始健康轮询
```

托盘在 service 启动成功后自动创建。无需用户干预。

## 2. 运行中

- 每 3s 轮询 `http://127.0.0.1:${PORT}/v1/health`
- `resolveHealth()` 根据 `/v1/health` 返回的 `status` 字段映射三层状态：
  - `green` → 绿色图标 + tooltip "ShelfDeck — 正常"
  - `yellow` → 灰色图标 + tooltip "ShelfDeck — 部分就绪"
  - `red` 或其他 → 红色图标 + tooltip "ShelfDeck — 异常"

## 3. 退出

两种退出路径：

| 路径 | 触发 | 行为 |
|------|------|------|
| 托盘右键 → "退出 ShelfDeck" | 用户主动 | `tray.kill()` → `process.exit(0)` |
| 外部信号 (SIGTERM/SIGINT) | 系统/终端 | server.js 的 shutdown handler → `app.close()` → `process.exit(0)` |

## 4. 托盘不存在时

如果 `trayicon` 初始化失败（例如非 Windows 平台），service 正常运行但无托盘图标。错误日志输出到 console。
