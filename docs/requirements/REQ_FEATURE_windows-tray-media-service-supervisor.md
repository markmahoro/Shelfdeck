# REQ_FEATURE — Windows 托盘媒体管理服务监督

> **extends**: `[REQ_PRODUCT_BASELINE_v1.0.0.md](./REQ_PRODUCT_BASELINE_v1.0.0.md)`  
> **change-type**: additive  
> **relates-to**: 前后端分离后本地运行媒体管理服务的可观测性与生命周期

## 文档信息


| 项         | 内容                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------- |
| 状态        | 已定稿待实现核对                                                                                       |
| 平台范围      | **Windows**（第一版）；macOS/Linux 非目标                                                               |
| SSOT 行为细则 | `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` |


## 背景与目标

- 前后端分离后，**媒体管理服务**（`media-service`）常独立运行于终端外，用户**启动/停止**时缺少即时、常驻的反馈，排障不便。
- **目标**：提供 **Windows 系统托盘**常驻的**监督进程**（父进程），用于 **启动 / 重启 / 停止** 子进程形式的媒体管理服务，并以 **红 / 绿（及未运行态）** 等可视化状态反映 **HTTP 健康检查** 与子进程存活情况。

## 范围

### 在内

- 托盘图标与 tooltip 反映服务状态（见验收）。
- 通过托盘菜单 **启动、重启、停止（终止受管子进程）** 媒体管理服务。
- 与 **受监督子进程** 对应的 **HTTP `GET /v1/health`** 轮询（端口与环境变量约定与现有服务一致）。
- **退出托盘应用** 与 **停止媒体管理服务** 菜单项分离，降低误操作（细则见 DESIGN）。

### 非目标（第一版）

- macOS / Linux 托盘等价物。
- 将 Fastify 与托盘合并为**单一 Node 进程**（架构上保持两进程：监督者 + `media-service`）。
- 远程主机上的媒体管理服务监督（仅本机 `127.0.0.1` 或配置的主机名）。
- 替代现有 `**npm start`** 文档路径：开发者仍可命令行启动；托盘为**面向本地用户的推荐入口之一**。

### 与桌面客户端（`media-desktop`）的关系

- **独立安装/启动单元**：监督进程可与 ShelfDeck 桌面客户端分别启动；桌面客户端仍通过 `MEDIA_SERVICE_URL` / `CONTROL_PLANE_URL` 连接服务。
- **双实例**：默认**不允许**两个媒体管理服务同时绑定同一端口；监督进程启动前应检测端口/健康（见 DESIGN），冲突时提示用户。

## 功能需求

1. **启动服务**：由监督进程 `spawn` 子进程运行 `media-service`（命令行、`cwd`、环境变量见 `[ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../architecture/ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`）。
2. **重启服务**：顺序停止受管子进程（可配置宽限期）后再次启动。
3. **停止服务**：终止监督关系下的子进程；**不**退出监督进程本身（除非用户选择退出托盘）。
4. **状态展示**
  - **绿灯（正常）**：健康检查在约定窗口内成功。  
  - **红灯（异常）**：受管子进程 **PID 仍存在**，但健康检查在约定窗口内**持续失败**（含端口未监听、HTTP 错误、超时等）。  
  - **灰或未运行态**：当前**无受管**子进程，或尚未启动（具体图标策略见 DESIGN）。
5. **退出托盘**：关闭监督进程；若子进程仍在运行，行为在 DESIGN 中定义（建议：提示或默认一并停止子进程，避免孤儿进程）。
6. **可选**：开机自启监督进程（OPS 文档描述；实现可分期）。

## 验收标准

- Windows 上安装/运行监督程序后，用户可通过托盘 **启动** 媒体管理服务，桌面或其它 HTTP 客户端可访问原有 API。
- 服务正常时托盘显示 **绿色** 语义；模拟子进程存活但健康接口失败时显示 **红色** 语义。
- **停止服务** 后，受管子进程退出；**退出托盘** 与 **停止服务** 在菜单上可区分。
- 默认端口 **18080**（可被环境变量覆盖）与现有 `[media-service/src/server.js](../../media-service/src/server.js)` 行为一致。
- 与 `[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` 手工准出步骤一致。

## 实现与代码入口

- 托盘监督：`media-tray-supervisor/`（`npm start`）；媒体管理服务：`media-service/`（`src/server.js`）。

## 追溯与关联文档


| 文档                                                                                               | 关系               |
| ------------------------------------------------------------------------------------------------ | ---------------- |
| `[REQ_PRODUCT_BASELINE_v1.0.0.md](./REQ_PRODUCT_BASELINE_v1.0.0.md)`                             | 母版（extends）      |
| `[ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../architecture/ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` | 组件与启动拓扑          |
| `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`   | 状态机、菜单、探测参数 SSOT |
| `[USER_GUIDE_TRAY_MEDIA_SERVICE.md](../user/USER_GUIDE_TRAY_MEDIA_SERVICE.md)`                   | 用户操作说明           |
| `[OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`     | 安装与运维            |
| `[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`      | 测试准出             |
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`                                                      | 文档索引             |


