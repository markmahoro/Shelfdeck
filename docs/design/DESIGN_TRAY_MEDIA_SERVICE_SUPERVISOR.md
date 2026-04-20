# DESIGN — Windows 托盘媒体管理服务监督

> **SSOT 路径**：`[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](./DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

## 范围与引用

- **需求**：`[REQ_FEATURE_windows-tray-media-service-supervisor.md](../requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md)`
- **架构**：`[ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../architecture/ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`

本文规定监督进程**状态机**、**健康探测参数**、**托盘菜单与确认**、**端口冲突**行为；实现须一致。

## 术语与数据模型


| 术语    | 含义                                                                                         |
| ----- | ------------------------------------------------------------------------------------------ |
| 受管子进程 | 由监督进程 `spawn` 且当前仍持有 `ChildProcess` 引用的 `media-service` 进程                                 |
| 健康成功  | `GET http://127.0.0.1:{PORT}/v1/health` 在超时内返回 2xx，且 body 为 JSON 且 `status === 'ok'`       |
| PORT  | `Number(process.env.MEDIA_SERVICE_PORT || process.env.CONTROL_PLANE_PORT || 18080)`，与子进程一致 |


## 状态机 / 生命周期

### 展示状态（驱动图标与 tooltip）


| 状态            | 条件（优先级自上而下）                 | 图标语义                               |
| ------------- | --------------------------- | ---------------------------------- |
| **Stopped**   | 无受管子进程                      | **灰**                              |
| **Starting**  | 已 spawn 但尚未取得首次健康成功，且子进程未退出 | **灰** 或 **黄**（实现可选用灰+tooltip「启动中」） |
| **Running**   | 健康成功                        | **绿**                              |
| **Unhealthy** | 受管子进程仍存在，且连续 **N** 次健康检查失败  | **红**                              |
| **Crashed**   | 受管子进程已退出（非用户主动停止）           | **灰** + tooltip「已退出」；可选自动重试不在第一版强制 |


**红灯**与需求对齐：**子进程 PID 仍存在**，但在约定时间内健康**持续不达标**。

**防抖**：进入 **Unhealthy** 前需 **连续失败次数 N = 3**（可配置常量）；**Running** 需 **连续成功 1 次**即可（或首次成功即绿）。

### 轮询参数（建议默认）


| 参数      | 默认       | 说明                                    |
| ------- | -------- | ------------------------------------- |
| 轮询间隔    | 3000 ms  | `setInterval`                         |
| HTTP 超时 | 2000 ms  | `AbortSignal` / 客户端 timeout           |
| 启动宽限    | 30000 ms | spawn 后在此时间内失败不计入「连续失败」判红，仍属 Starting |


## 主流程

### 启动服务

1. 若已有受管子进程且仍在运行，**忽略**或提示「已在运行」（实现：直接 return）。
2. 解析 `TRAY_MEDIA_SERVICE_ROOT` / 默认相对路径，校验存在 `src/server.js`。
3. **端口预检**：对 `PORT` 发起一次 TCP 连接或健康请求；若健康已成功且**非**本监督进程刚启动的子进程，则 **提示**：「端口已被占用，可能已有其它实例」，**不 spawn**（避免双实例）。
4. `spawn('node', ['src/server.js'], { cwd: mediaServiceRoot, env: process.env, windowsHide: true })`。
5. 注册 `exit` 监听以更新状态。

### 停止服务（菜单「停止媒体管理服务」）

1. 向子进程发送 **SIGTERM**（Windows 下为 `child.kill()` 默认）。
2. **宽限期** 5000 ms；仍存活则 `**child.kill('SIGKILL')`**（Node 在 Windows 上对 SIGKILL 的行为为强制终止子树，以实际 Electron/Node 为准）。
3. 清除受管引用。

### 重启服务

顺序：**停止服务** → **启动服务**。

### 退出托盘（菜单「退出监督程序」）

1. 若存在受管子进程：**默认行为** — 先执行 **停止服务**（与 REQ「避免孤儿」一致），再 `app.quit()`。
2. 若无受管子进程：直接 `app.quit()`。

## 异常与边界

- **端口被占用且无法连接 health**：启动失败，对话框或 tooltip 错误，状态 **Stopped**。
- **健康接口返回非 ok**：计一次失败；达 N 次 → **Unhealthy**。
- **用户手动 taskkill 子进程**：`exit` 事件触发 → **Crashed/Stopped**。

## 托盘菜单（第一版文案）


| 菜单项      | 行为                            |
| -------- | ----------------------------- |
| 启动媒体管理服务 | `start`                       |
| 停止媒体管理服务 | `stop`（需二次确认：「将终止本机媒体管理服务进程」） |
| 重启媒体管理服务 | `restart`（可选确认；默认可不确认）        |
| —        | —                             |
| 退出监督程序   | `quit`（若子进程在运行：确认「将先停止服务再退出」） |


**左键**：可选 **无操作** 或 **弹出与右键相同菜单**（实现选 Windows 惯例：**左键显示菜单** 或 **仅 tooltip**；第一版：**左键与右键均打开同一上下文菜单**，简单一致）。

## 与其它模块契约

- 不修改 `media-service` 对外 API 即可交付；若未来增加专用 supervisor 端点，再迭代 OpenAPI。

## 可观测性

- Tooltip 格式建议：`ShelfDeck 媒体管理服务 — 运行中 / 启动中 / 异常 / 已停止` + `127.0.0.1:PORT`。

## 测试要点

见 `[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`。

## 追溯与关联文档


| 文档                                                                                                                             | 关系  |
| ------------------------------------------------------------------------------------------------------------------------------ | --- |
| `[REQ_FEATURE_windows-tray-media-service-supervisor.md](../requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md)` | 需求  |
| `[ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../architecture/ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                               | 架构  |
| `[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                                    | 准出  |
