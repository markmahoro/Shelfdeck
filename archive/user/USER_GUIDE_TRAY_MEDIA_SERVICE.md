# USER_GUIDE — ShelfDeck 小助手（Windows）

> **SSOT 路径**：`[USER_GUIDE_TRAY_MEDIA_SERVICE.md](./USER_GUIDE_TRAY_MEDIA_SERVICE.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

## 文档状态

| 项 | 内容 |
| --- | --- |
| **行为 SSOT** | `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` |
| **连接配置 SSOT** | `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](../design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md)` |

## 小助手是什么

**ShelfDeck 小助手**是任务栏托盘里的常驻组件，用来：

- **一眼看到** 您当前连接的 **媒体管理服务地址** 是否健康；  
- **配置或修改** 该地址（**仅** 在小助手内保存；桌面客户端 **自动读取** 同一文件，**不能** 在桌面里改这个地址）；  
- 在 **已经保存了后端地址** 之后，对 **当前这套后端** 做 **启动 / 停止** 等操作（具体能做什么取决于服务装在本机还是 NAS，见下文「远端」）。

**打开桌面客户端时，一般会同时出现小助手**；**关掉桌面主窗口，小助手通常还在**。您也可以 **只开小助手**。小助手提供 **开机自启** 开关（默认关）：打开后，下次登录 Windows 时会自动出现托盘图标。

## 左键打开的主面板（必看）

**左键**托盘图标会打开一块 **小面板**。上面 **第一屏就会写明** 您当前连的 **完整服务器地址**（媒体管理服务，不是 Emby）。  
若显示「未配置」，请先在面板里 **填写并保存** 地址，再使用启停等功能。

同屏还提供：

- **打开 ShelfDeck 主界面**：一键启动或切换到已打开的桌面窗口；  
- **任务队列摘要**：只看一眼当前后台任务概况（与桌面读同一套数据）；  
- **设置**：**开机自启**；**退出小助手时是否同时停止本机媒体管理服务**（默认 **不**停止；仅在本机场景常见）。

在您点击 **启动** 后端后的几秒内，图标可能显示 **「启动中」**（黄色或灰色），属正常现象。

## 图标颜色（黄 / 绿 / 红）

| 颜色 | 含义 |
| --- | --- |
| **黄** | 还没配置好后端，或刚保存还在检查 |
| **绿** | **当前配置的这个地址** 上的服务健康检查通过 |
| **红** | 健康检查多次失败（网络、服务宕机或地址错误等） |

这与 **桌面里**「能不能正常用」看的是 **同一个后端地址**，不再区分「托盘只看本机、桌面看远端」。

## 启动与停止后端

- **必须先** 在小助手面板里 **配置并保存** 媒体管理服务地址，**启停按钮才可用**（桌面 **没有** 这一项设置）。  
- 界面上 **只有一套**「启动 / 停止」，**不会** 再分「本地一套、远端一套」。  
- **本机** 安装时：小助手可能会在本机为您拉起 `media-service` 进程。  
- **远端（如 NAS）** 上跑服务时：**停止** 往往要在 **NAS 自己的管理界面或 SSH** 里做；小助手若暂时做不到远程关机，会 **提示您去看说明或帮助**，而不是假装已经关掉了远端的进程。

## 和桌面客户端的关系

- **配置**：**只有小助手** 能改媒体管理服务地址；桌面 **只读** 同一份配置；小助手保存后，桌面会在短时间内 **自动跟上**。  
- **关桌面**：**不等于** 退出小助手；托盘图标可以还在。  
- **退出小助手**：默认 **不会** 关掉媒体管理服务。若您在设置里勾选了 **「退出时停止本机服务」**，则退出小助手时 **会** 尝试停止 **本机** 上由 ShelfDeck 管理的那份服务；连远端 NAS 时一般 **不应** 假装已远程关机。

## 准备与权限（开发/源码运行）

- Windows 10/11。  
- 从源码运行时：Node 与 `TRAY_MEDIA_SERVICE_ROOT` 等见 `[OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`。

## 故障排查

| 现象 | 建议 |
| --- | --- |
| 一直黄色 | 检查是否 **已保存** 地址；点「测试连接」或看桌面首屏提示 |
| 绿色但桌面仍不可用 | 确认桌面与小助手 **同一配置文件** 是否都刷新；重启小助手或桌面 |
| 红色 | 在浏览器访问 **面板上显示的同一地址** `/v1/health`；检查 NAS/防火墙/HTTPS 证书 |
| 启停无效（远端） | 正常：请到 **服务器侧** 管理进程；见 `[OPS_DEPLOY_CONTROL_PLANE.md](../operations/OPS_DEPLOY_CONTROL_PLANE.md)` |

## 追溯与关联文档


| 文档 | 关系 |
| --- | --- |
| `[REQ_FEATURE_windows-tray-media-service-supervisor.md](../requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md)` | 需求 |
| `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` | 行为 |
| `[OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` | 运维 |
