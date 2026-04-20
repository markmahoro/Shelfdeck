# DESIGN — ShelfDeck 小助手（Windows 托盘媒体管理服务监督）

> **SSOT 路径**：`[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](./DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`  
> **用户向名称**：**ShelfDeck 小助手**（任务栏托盘常驻；工程目录仍为 `media-tray-supervisor/`）。

## 范围与引用

- **需求**：`[REQ_FEATURE_windows-tray-media-service-supervisor.md](../requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md)` · `[REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md](../requirements/REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md)`
- **架构**：`[ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../architecture/ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`
- **连接端点（与桌面同源读、小助手独写）**：`[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](./DESIGN_DESKTOP_BACKEND_ENDPOINT.md)`

本文规定小助手的**产品定位**、**主界面（左键）**、**红绿灯**、**启停能力**、**与 Desktop 的启停关系**及技术实现锚点（含本机 `spawn`）。

---

## 0. 产品定位与用户旅程（用户视角）

1. **与 Desktop 的耦合（体验层）**
  - **打开 ShelfDeck 桌面客户端时**，用户旅程上 **必定** 连带启动小助手（实现可为由 Desktop 拉起伴生进程、或单包内组合启动；用户不感知「开两个程序」）。  
  - **关闭 Desktop 主窗口** **不**关闭小助手；小助手可继续在托盘运行。  
  - 用户 **可单独启动** 小助手（快捷方式或 `media-tray-supervisor`）；此时可无主窗口，仅托盘与左键面板可用。  
  - **当前工程须交付**：**开机自启小助手** 的 **用户可切换开关**（小助手设置或安装器等价能力）；默认 **关闭**；开启后按 Windows 常规方式注册（任务计划 / 启动文件夹等，见 OPS）。推荐叙事：自启轻量托盘，需要时再开主界面。
2. **与后端（媒体管理服务）进程的关系**
  - 小助手进程的生命周期 **默认** 与 **后端服务进程** **解耦**：**退出小助手 ≠ 停止后端**（除非用户在高级选项中显式勾选「退出时停止本机服务」等，见 §5）。  
  - **启停后端** 是小助手提供的 **显式操作**，不是关小助手的副作用。
3. **配置**
  - **媒体管理服务基址与 API Key** 由 **小助手** **独占写入** 约定连接文件；Desktop **只读** 同一文件与环境变量优先级（`DESIGN_DESKTOP_BACKEND_ENDPOINT`）。小助手保存后，Desktop 须在合理时间内 **刷新**（文件监视或进程间通知），避免双源认知。

---

## 1. 主界面（左键，强制）

**左键**须打开 **独立轻量面板**（非完整 Desktop 窗口），且 **页首固定区域** **必须** 清晰展示：


| 元素          | 要求                                                          |
| ----------- | ----------------------------------------------------------- |
| **当前服务器地址** | 展示 **完整有效基址**（`effectiveBaseUrl`，无尾 `/`）；可复制；未配置时显示「未配置」类人话 |
| **连接状态**    | 与 §2 黄/绿/红一致的一句话摘要                                          |
| **API Key** | **不**明文展示完整密钥；可显示「已设置 / 未设置」                                |
| **更改连接**    | 进入 **唯一** 连接表单（**仅** 小助手可写 `DESIGN_DESKTOP_BACKEND_ENDPOINT` 约定存储）                                  |


**同屏须交付**（页首之下；可滚动区或折叠区，但 **不得** 藏进仅高级用户可见的深层菜单）：

| 元素 | 要求 |
| --- | --- |
| **打开 ShelfDeck 主界面** | **须**提供明确入口（按钮或链接）：启动或 **聚焦** 已运行的 Desktop（与 `media-desktop` 实现协同）。 |
| **任务队列摘要** | **须**提供只读摘要（至少：待处理/运行中等 **可辨状态** 或件数；数据与 **当前 `effectiveBaseUrl`** 上 Desktop 所用任务数据源 **一致**，复用同一 HTTP 接口或同步契约；若无现成只读端点，本工程 **须** 与 Desktop 对齐补最小只读能力或共用既有 sync/队列读取路径）。 |

右键菜单可与左键面板 **能力对齐** 或作为快捷入口；**不得以**仅右键菜单替代左键面板（用户须能一眼看到「连的是谁」）。

---

## 2. 红绿灯（与 Desktop 门禁同源判据）

健康探测目标为 `**{effectiveBaseUrl}/v1/health`**（含鉴权头规则与 `DESIGN_DESKTOP_BACKEND_ENDPOINT` 一致），**不得**写死仅 `127.0.0.1`（除非有效基址恰好为该值）。


| 状态               | 条件（优先级自上而下）                                | 图标语义                         |
| ---------------- | ------------------------------------------ | ---------------------------- |
| **Yellow（黄）**    | 无有效已保存基址；或有效基址尚未完成首次成功健康探测（实现可合并为「未就绪」）    | **黄**                        |
| **Running（绿）**   | 最近一轮探测满足「健康成功」（HTTP 2xx、`status === 'ok'`） | **绿**                        |
| **Unhealthy（红）** | 已连续 **N** 轮未满足「健康成功」（超时、非 2xx、body 非 ok 等） | **红**                        |
| **Starting（启动中）** | 用户触发 **启动** 后宽限 `START_GRACE_MS` 内尚未首次成功   | **须**体现为 **黄** 或 **灰** + tooltip「启动中」（与 §7 `START_GRACE_MS` 一致） |


**说明**：后端由命令行、脚本或 NAS 侧启动 **不影响** 绿灯判定；只要 **当前配置的 URL** 健康即可绿。

**防抖**：进入 **红** 前连续失败 **N = 3**（与实现 `FAIL_THRESHOLD` 对齐）；**绿** 在首次成功后即可。

---

## 3. 启停（统一产品句，UI 不分本地/远端）

### 3.1 用户旅程门槛

- **未配置**或未保存有效基址：**启动 / 停止 / 重启** **全部禁用**，并提示「请先配置媒体管理服务地址」。  
- **已配置**后：才允许上述操作（具体能否完成取决于 §3.2 实现矩阵）。

### 3.2 产品句（对用户）

**启停** = 对 **「当前已配置后端」** 执行 ShelfDeck **所支持** 的 **生命周期操作**。界面 **不** 提供「本地一套按钮、远端另一套按钮」。

### 3.3 实现矩阵（工程与运维 SSOT，不写死在按钮标签上）


| 部署场景                | 「启动」典型实现                                  | 「停止」典型实现                          | 不支持时的 UX                                      |
| ------------------- | ----------------------------------------- | --------------------------------- | --------------------------------------------- |
| 本机进程（开发/便携）         | `spawn('node', ['src/server.js'], …)` 或等价 | 终止受管子进程；或按端口查找 PID 终止（产品须定义并写清风险） | 对话框说明                                         |
| 本机 Windows 服务 / 安装器 | 调用服务控制或安装器脚本                              | 同上                                | 见 OPS                                         |
| 远端（NAS 等）           | 受控 API、SSH、Docker Remote、**或** 无自动化       | 同上                                | **打开帮助/运维链接** 引导用户在 **服务器侧** 管理；**禁止**假装已成功停止 |


远端能力以 `**OPS_DEPLOY_CONTROL_PLANE.md`**、`**OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md**` 与用户帮助 **故障排查** 为准；若当前版本对某类远端仅支持「打开管理页」，按钮可显示为「打开服务器管理说明」而非空失败。

---

## 4. 技术流程：本机 spawn（保留）

当实现判定可对 **本机** 执行 `spawn` 时：

1. 若已有受管子进程且存活，**忽略**或提示「已在运行」。
2. 解析 `TRAY_MEDIA_SERVICE_ROOT` / 默认相对路径，校验 `src/server.js`。
3. **端口/健康预检**：若目标 URL 对应端口已有健康实例且非本小助手刚起的子进程，**提示**可能双实例，**不** spawn。
4. `spawn('node', ['src/server.js'], { cwd: mediaServiceRoot, env: process.env, windowsHide: true })`。
5. 注册 `exit` 监听。

**停止**（本机受管路径）：向受管子进程发终止信号，宽限期后强制结束；清除受管引用。若当前后端 **非** 本小助手 spawn，**停止** 的实现须符合 §3.3（可能为按端口杀进程或提示用户到 NAS 管理）。

---

## 5. 退出小助手

- **默认**：**退出小助手** **不**停止媒体管理服务进程（与「监控生命周期 ≠ 后端生命周期」一致）。  
- **当前工程须交付（高级设置）**：**须提供**「退出时同时停止本机媒体管理服务」**勾选框**（或等价设置项）；默认 **未勾选**；仅在本机受管/可安全停止的场景下生效，远端须诚实降级（见 §3.3）。  
- **与历史行为差异**：若曾实现「退出前必先停子进程」，以本文为准迭代实现与 TEST。

---

## 6. 术语


| 术语               | 含义                                                                        |
| ---------------- | ------------------------------------------------------------------------- |
| 受管子进程            | 由小助手 `spawn` 且仍持有 `ChildProcess` 引用的 `media-service` 进程                   |
| 健康成功             | 对 `effectiveBaseUrl` 的 `GET /v1/health` 在超时内 2xx 且 JSON `status === 'ok'` |
| effectiveBaseUrl | 与 Desktop 一致的解析结果（`DESIGN_DESKTOP_BACKEND_ENDPOINT`）                      |


---

## 7. 轮询参数（建议默认）


| 参数      | 默认       | 说明                  |
| ------- | -------- | ------------------- |
| 轮询间隔    | 3000 ms  |                     |
| HTTP 超时 | 2000 ms  |                     |
| 启动宽限    | 30000 ms | 用户点「启动」后宽限内失败可不立即判红 |


---

## 8. 可观测性

- Tooltip 建议含：状态短句 + **主机可辨片段**（来自 `effectiveBaseUrl`，非仅 127.0.0.1）。

---

## 9. 验收与迭代状态


| 项                 | 内容                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| **2026-04-20 迭代** | 独立托盘 + 本机 spawn 能力验收通过（历史摘要见 `PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md`）              |
| **小助手模型与连接独写**    | 以本文与 `REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle` 为准；**连接文件仅小助手写入**；含 **开机自启开关**、**左键同屏（主界面 + 队列摘要）**、**启动中态**、**退出时停本机服务** 设置项；工程实现后更新 `TEST_TRAY` 签发 |


---

## 10. 测试要点

见 `[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`。

---

## 11. 追溯与关联文档


| 文档                                                                                                                                                   | 关系      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `[REQ_FEATURE_windows-tray-media-service-supervisor.md](../requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md)`                       | 需求      |
| `[REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md](../requirements/REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md)` | 连接与小助手  |
| `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](./DESIGN_DESKTOP_BACKEND_ENDPOINT.md)`                                                                         | 端点 SSOT |
| `[ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../architecture/ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                                                     | 架构      |
| `[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                                                          | 准出      |
| `[PRJ_MANAGEMENT.md](../project/PRJ_MANAGEMENT.md)`                                                                                                  | 项目管理    |


