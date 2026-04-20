# OPS — 媒体管理服务托盘监督（Windows）

> **SSOT 路径**：`[OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](./OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

## 制品与拓扑


| 制品                                | 说明                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `shelfdeck-media-tray-supervisor` | 仓库内 `[media-tray-supervisor](../../media-tray-supervisor)` npm 包             |
| 依赖                                | **Electron**（与 `media-desktop` 同 major）、本机 **Node** 用于 spawn `media-service` |
| 被监督服务                             | `[media-service](../../media-service)`（`node src/server.js`）                 |


拓扑：**监督进程（父）** → **子进程 `media-service`**；**ShelfDeck 桌面客户端** 可选，经 HTTP 连接同一端口。

## 安装 / 升级 / 回滚

### 开发仓库内运行

```bash
cd media-tray-supervisor
npm install
npm start
```

环境变量：


| 变量                                          | 说明                                                             |
| ------------------------------------------- | -------------------------------------------------------------- |
| `TRAY_MEDIA_SERVICE_ROOT`                   | `media-service` 根目录绝对路径；未设置时默认监督包上一级的 `media-service`（与仓库布局一致） |
| `MEDIA_SERVICE_PORT` / `CONTROL_PLANE_PORT` | 与子进程一致，默认 18080                                                |


### 打包分发（后续）

- 可将 `media-tray-supervisor` 与 `media-service` 一并打入安装器；安装时写入 `TRAY_MEDIA_SERVICE_ROOT` 或注册表等效项（实现迭代）。

## 健康检查

- **URL**：`http://127.0.0.1:{PORT}/v1/health`
- **期望**：HTTP 2xx，`status` 字段为 `ok`（见 `[media-service/src/app.js](../../media-service/src/app.js)`）

## 备份与恢复

- 本监督程序无独立持久化状态；媒体管理服务数据目录仍按 `[ARCH_SYSTEM_OVERVIEW.md](../architecture/ARCH_SYSTEM_OVERVIEW.md)` / `media-service/data` 策略。

## Runbook

### 端口被占用

1. 确认 `netstat -ano | findstr :18080`（或当前端口）占用 PID。
2. 若为用户手动启动的 `node`，结束该进程或由托盘「停止服务」统一停止受管实例。
3. 若占用者非本服务，更换 `MEDIA_SERVICE_PORT` 并同步桌面端 `CONTROL_PLANE_URL`。

### 托盘显示红色

1. 打开任务管理器，确认是否存在对应 `node` 子进程。
2. 浏览器访问 `http://127.0.0.1:18080/v1/health` 是否返回 JSON。
3. 查看监督进程控制台输出（开发模式下从启动终端查看）。

### 日志

- **第一版**：监督进程与子进程的标准输出可在 **启动终端** 查看；后续可增加落盘路径（环境变量 `TRAY_SUPERVISOR_LOG_DIR` 等，待实现迭代）。

## 开机自启（可选）

- **启动文件夹**：将监督程序快捷方式放入 `shell:startup`。
- **任务计划程序**：触发器「登录时」，操作启动 `ShelfDeckTraySupervisor.exe`（打包后）或 `npm start` 包装脚本。

权衡：自启仅拉起监督程序；是否在登录后自动 spawn `media-service` 由产品配置决定（第一版可默认「仅托盘常驻，用户手动启动服务」或「随托盘启动服务」——以 `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` 实现为准）。

## 追溯与关联文档


| 文档                                                                                               | 关系   |
| ------------------------------------------------------------------------------------------------ | ---- |
| `[ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../architecture/ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` | 架构   |
| `[USER_GUIDE_TRAY_MEDIA_SERVICE.md](../user/USER_GUIDE_TRAY_MEDIA_SERVICE.md)`                   | 用户说明 |
| `[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`      | 验收   |


