# DESIGN_TRAY/LIFECYCLE — 托盘生命周期

> 状态：实现完成

## 1. 启动

```
server.js: app.listen() 成功
    → startTray(port)
        → new SysTray({ menu: {...}, copyDir: true })
        → systray.ready() → 开始健康轮询
```

托盘在 service 启动成功后自动创建。无需用户干预。

## 2. 运行中

- 每 3s 轮询 `http://127.0.0.1:${PORT}/v1/health`
- 健康 (status === 'ok') → 绿色图标 + tooltip "ShelfDeck — 正常"
- 异常 → 红色图标 + tooltip "ShelfDeck — 异常"

## 3. 退出

两种退出路径：

| 路径 | 触发 | 行为 |
|------|------|------|
| 托盘右键 → "退出" | 用户主动 | `systray.kill()` → `process.exit(0)` |
| 外部信号 (SIGTERM/SIGINT) | 系统/终端 | server.js 的 shutdown handler → `app.close()` → `process.exit(0)` |

## 4. 托盘不存在时

如果 systray2 初始化失败（例如非 Windows 平台），service 正常运行但无托盘图标。错误日志输出到 console。
