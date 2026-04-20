# USER_GUIDE — ShelfDeck 媒体管理服务托盘监督

> **SSOT 路径**：`[USER_GUIDE_TRAY_MEDIA_SERVICE.md](./USER_GUIDE_TRAY_MEDIA_SERVICE.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

## 概述

**媒体管理服务托盘监督**（Windows）在任务栏通知区提供常驻图标，用于 **启动、停止、重启** 本机 **ShelfDeck 媒体管理服务**，并通过图标颜色提示服务是否正常响应。

- 技术细则与状态含义：`[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`
- 安装与自启：`[OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`

## 准备与权限

- Windows 10/11。
- 已安装 **Node.js**（与 `[media-service](../../media-service)` 要求一致），且 `media-service` 目录对本机用户可读。
- 首次从源码运行时，需设置环境变量 `**TRAY_MEDIA_SERVICE_ROOT`** 指向 `media-service` 文件夹，或使用仓库默认布局（监督程序与 `media-service` 为同级目录）。

## 操作步骤

### 图标含义（摘要）


| 颜色/语义 | 含义                    |
| ----- | --------------------- |
| 绿     | 服务健康，可正常使用            |
| 红     | 进程仍在，但健康检查失败（可能卡住或异常） |
| 灰     | 未启动或已停止               |


详见设计文档 **展示状态** 表。

### 启动服务

1. 右键（或左键，视版本实现）托盘图标。
2. 选择 **「启动媒体管理服务」**。
3. 等待图标变为绿色；将鼠标悬停在图标上可查看 tooltip 状态与端口。

### 停止服务

1. 打开托盘菜单。
2. 选择 **「停止媒体管理服务」**，在确认对话框中选 **是**。

### 重启服务

在菜单中选择 **「重启媒体管理服务」**。

### 退出监督程序

选择 **「退出监督程序」**。若服务仍在运行，确认对话框会提示将**先停止服务**再退出。

## FAQ

**与 ShelfDeck 桌面客户端是什么关系？**  
桌面客户端用于观影与任务中心；媒体管理服务提供 API。托盘监督只负责在本机拉起/停止该服务。您可先开托盘启动服务，再打开桌面客户端。

**还能用命令行 `npm start` 吗？**  
可以。请注意同一端口通常只能有一个服务实例；若托盘已启动服务，命令行再次启动可能失败。

## 故障排查


| 现象                    | 建议                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| 提示找不到 `media-service` | 检查 `TRAY_MEDIA_SERVICE_ROOT` 是否指向包含 `src/server.js` 的目录                                                     |
| 端口被占用                 | 关闭其它占用 18080 的程序，或修改 `MEDIA_SERVICE_PORT` 环境变量（桌面端需同一端口）                                                    |
| 长期红色                  | 查看 `[OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` 日志与 Runbook |


## 追溯与关联文档


| 文档                                                                                                                             | 关系      |
| ------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `[REQ_FEATURE_windows-tray-media-service-supervisor.md](../requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md)` | 需求      |
| `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                                 | 行为 SSOT |
| `[OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                                   | 运维      |
