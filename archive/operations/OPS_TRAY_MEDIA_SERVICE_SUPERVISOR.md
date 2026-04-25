# OPS — ShelfDeck 小助手（Windows 托盘媒体管理服务监督）

> **SSOT 路径**：`[OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](./OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

## 验收与迭代状态

| 项 | 内容 |
| --- | --- |
| **行为 SSOT** | `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` |
| **连接 SSOT** | `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](../design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md)` |
| **历史验收** | 2026-04-20 独立托盘能力见 `PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md` |

## 制品与拓扑


| 制品 | 说明 |
| --- | --- |
| `shelfdeck-media-tray-supervisor` | `[media-tray-supervisor](../../media-tray-supervisor)` |
| 依赖 | Electron；**本机场景**下可 **spawn** 本机 `media-service`（非本机仅健康/运维引导） |
| 配置存储 | **小助手** 写入、**Desktop** 只读的 **同一** 连接文件/键（见 DESIGN_DESKTOP_BACKEND_ENDPOINT） |

拓扑：**小助手** 对 **`{effectiveBaseUrl}`** 做 `GET /v1/health`；**Desktop** 对 **同一基址** 调业务 API；**本机** 场景下小助手可 **spawn** 子进程 `media-service`。

## 安装 / 升级 / 回滚

### 开发仓库内运行

```bash
cd media-tray-supervisor
npm install
npm start
```

环境变量：


| 变量 | 说明 |
| --- | --- |
| `TRAY_MEDIA_SERVICE_ROOT` | `media-service` 根目录；未设置时默认上一级 `media-service` |
| `MEDIA_SERVICE_PORT` / `CONTROL_PLANE_PORT` | 与本机子进程一致，默认 18080 |
| `MEDIA_SERVICE_URL` 等 | 与 Desktop 同义；覆盖持久化基址（见 DESIGN_DESKTOP_BACKEND_ENDPOINT） |

### 打包分发（当前工程）

安装器须写入 **共享连接存储路径**，并为 Desktop 与小助手配置 **相同** `%AppData%`（或等价）约定；**须提供** 小助手 **开机自启** 的用户开关及其实际注册方式（任务计划 / 启动项等，与 DESIGN §0 一致）。

## 健康检查

- **URL**：`**{effectiveBaseUrl}**/v1/health`（**非**固定 127.0.0.1，除非当前配置如此）  
- **期望**：HTTP 2xx，`status === 'ok'`（见 `media-service/src/app.js`）  
- **鉴权**：若启用 API Key，须带 `X-API-Key`

**保存连接（产品）**：小助手「保存」仍表示 **落盘后地址可用**；流程为先健康检查，失败则 **按地址尝试启动**（本机为 spawn；远端自动启动可为占位，见 `DESIGN_DESKTOP_BACKEND_ENDPOINT` §4），再在宽限内重试健康。

## 启停实现矩阵（运维对照）

| 场景 | 启动 | 停止 | 文档 |
| --- | --- | --- | --- |
| 本机开发 | `spawn` / `npm start` | 受管 kill / 按端口 PID | DESIGN §4 |
| 本机服务化 | NSSM / Windows Service | 服务管理控制台 | 本文 Runbook |
| 远端 NAS / Docker | **NAS 侧** compose、面板或 SSH | **同上** | `[OPS_DEPLOY_CONTROL_PLANE.md](./OPS_DEPLOY_CONTROL_PLANE.md)` |

**产品句**：用户界面 **不分** 本地/远端按钮；若某环境无法远程 kill，小助手 **须** 以文案/链接引导用户在 **服务器侧** 操作。

## 备份与恢复

小助手无独立业务持久化；连接文件含 URL/Key，备份须 **脱敏**。

## Runbook

### 端口被占用（本机）

1. `netstat -ano | findstr :18080`（或当前端口）。  
2. 结束占用 PID 或调整 `MEDIA_SERVICE_PORT` 并 **同步** 连接配置中的基址端口。

### 托盘红色但浏览器可访问

1. 核对小助手面板显示的 **完整 URL** 与浏览器是否一致。  
2. 核对 API Key、HTTPS 证书、公司代理。  
3. 确认 **小助手** 已写入预期连接文件，且 Desktop **已 reload**（只读）同一文件。

### 远端「停止」无效

**预期行为之一**：须在 NAS/宿主机上停止容器或进程；见 `OPS_DEPLOY_CONTROL_PLANE.md`。

### 日志

开发模式从启动终端查看；后续可 `TRAY_SUPERVISOR_LOG_DIR`（待实现）。

## 开机自启（当前工程须交付）

- 小助手 **须**提供 **设置内开关**（默认关）；用户开启后，使用 **任务计划程序** 或 **启动文件夹** 等 Windows 常规方式注册/撤销（具体以实现为准，须在发布说明中写明）。  
- 产品叙事：自启 **小助手**（轻量）；用户从左键面板 **打开 Desktop**。

## 追溯与关联文档


| 文档 | 关系 |
| --- | --- |
| `[ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../architecture/ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` | 架构 |
| `[USER_GUIDE_TRAY_MEDIA_SERVICE.md](../user/USER_GUIDE_TRAY_MEDIA_SERVICE.md)` | 用户 |
| `[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` | 验收 |
