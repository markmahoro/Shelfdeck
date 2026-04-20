# DESIGN_DESKTOP_BACKEND_ENDPOINT — 媒体管理服务连接端点（小助手编辑、桌面只读）

> **SSOT 路径**：`[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](./DESIGN_DESKTOP_BACKEND_ENDPOINT.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`  
> **关联需求**：`[REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md](../requirements/REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md)`  
> **关联**：壳层门禁 `[DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md](./DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md)` · 文案 `[DESIGN_DESKTOP_UI_COPY.md](./DESIGN_DESKTOP_UI_COPY.md)` · 配置分区 `[DESIGN_CONFIG_AND_PATHS.md](./DESIGN_CONFIG_AND_PATHS.md)` · 小助手 `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](./DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`

本文规定 **ShelfDeck 小助手**（`media-tray-supervisor`）如何 **写入** 与用户 **媒体管理服务** 相关的 **基址 URL** 与可选 **API Key**，以及 **ShelfDeck 桌面客户端**（`media-desktop`）如何 **只读** 解析 `**effectiveBaseUrl` / `effectiveApiKey`** 并与小助手 **对齐同一物理存储**，避免双源；**Desktop 不参与** 该连接的表单编辑与持久化写入。

---

## 1. 目标与非目标

### 1.1 目标与死锁规避

- **问题（须避免）**：若 Desktop 承担「保存后端地址」且该保存依赖「已与后端通信 / 在线」，而「启动后端」又依赖「已配置地址」，则出现 **配置—启停—门禁** 死循环。  
- **原则**：**后端基址与 API Key** 的 **用户配置、校验与持久化** **唯一入口** 为 **小助手**（左键面板「更改连接」等）。用户 **在小助手** 完成首配并在本机场景下可 **spawn** 后端后，Desktop **读取** 同一连接文件并探测 `GET /v1/health`，**online** 后解锁壳层，用户再在 Desktop **配置中心** 配置 **Emby、豆瓣、任务** 等（与 `DESIGN_CONFIG_AND_PATHS` 一致）。  
- **Desktop**：**不得** 在配置中心提供「媒体管理服务地址 / API Key」分区；**须** 在壳层提供 **小型联通状态**（黄/绿/红，与 `effectiveBaseUrl` 健康一致，占位尽量小，如顶栏一隅，见 `DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY`）；**offline / unknown** 时 **强门禁**，文案 **明确引导** 用户到 **任务栏小助手** 配置地址或启动后端（见 `DESIGN_DESKTOP_UI_COPY`）。  
- **单一物理文件**、统一键名；**禁止** Desktop 与小助手默认使用两份互不透明的路径。

### 1.2 非目标

- 不新增 REST 资源；健康校验仍用 `[GET /v1/health](../api/openapi.yaml)`。

---

## 2. 持久化字段与存储

下列键名为 **文档 SSOT**。


| 键                                | 类型     | 必填  | 说明             |
| -------------------------------- | ------ | --- | -------------- |
| `shelfdeck.mediaService.baseUrl` | string | 是   | 基址，**无**尾部 `/` |
| `shelfdeck.mediaService.apiKey`  | string | 否   | `X-API-Key`    |


**写入者**：**仅** 小助手在「保存连接」流程中 **写入或更新** 上述键（及实现所需的文件版本字段等）。  
**读取者**：小助手与 Desktop **均读取**；Desktop **禁止** 向该文件写入 `baseUrl` / `apiKey`（开发排错可 **手动** 编辑文件，见 `DEV_SETUP` 说明，**不**作为产品路径）。

**存储位置**：须为 **用户可写、两进程可读** 的 **单一路径**（如 `%AppData%\ShelfDeck\connection.json`），并在 `DEV_SETUP` / OPS 中写明；**禁止** Desktop 与小助手各用默认路径却不一致。

---

## 3. 解析优先级（从高到低，两进程一致）


| 优先级 | 来源                  | 说明                                                       |
| --- | ------------------- | -------------------------------------------------------- |
| 1   | 启动进程环境变量            | `MEDIA_SERVICE_URL` 或 `CONTROL_PLANE_URL`（建议前者优先）        |
| 2   | 用户持久化               | `shelfdeck.mediaService.baseUrl` / `apiKey`（**仅小助手** 写入） |
| 3   | 构建期（仅 Desktop 渲染兜底） | `VITE_MEDIA_SERVICE_URL` / `VITE_CONTROL_PLANE_URL`      |
| 4   | 默认值                 | `http://127.0.0.1:18080`                                 |


**API Key**：推荐 **环境变量覆盖持久化**；须在发布说明中写死一种顺序。

**Desktop**：Electron **主进程** 计算 `effectiveBaseUrl` / `effectiveApiKey`，经 `contextBridge` 等与渲染一致；**无**「保存连接到文件」的 IPC。

**小助手**：启动时、轮询前及保存连接时使用 **相同优先级**；环境变量指 **小助手进程** 的环境（安装器可为两进程注入 **相同** 用户级环境）。

**Desktop 刷新**：须在启动后及连接文件变更后 **重读**（`fs.watch`、短周期轮询，或小助手 **IPC / 命名事件** 通知——实现择一）；验收：**小助手保存后 Desktop 在合理时间内** 与 **小助手** 显示同一有效基址与健康结论。

---

## 4. 校验与保存 UX（仅小助手）

**语义**：持久化写入仍表示 **保存 = 可用**（落盘后 `GET {base}/v1/health` 能成功）。

**统一管线（本机 / 远端同一套步骤；仅「尝试启动」的实现不同）**：

1. 合法 HTTP(S) URL；去尾 `/`。
2. `GET {base}/v1/health`；`200` 且 `status === 'ok'`；若启用 API Key 则带 `X-API-Key`。
3. 若第 2 步 **未通过**：**按该地址尝试启动** 媒体管理服务（**本机**：`spawn` 等，与 `DESIGN_TRAY` §4 本机矩阵一致；**远端**：当前版本可为 **占位**，不假装已启动，并提示用户先在服务器侧启动后再保存）；随后在宽限时间内 **重试** 健康检查直至成功或超时。
4. **仅当**最终健康检查成功时，由 **小助手** 写入连接文件。
5. 文案与面板提示：`DESIGN_TRAY` · `DESIGN_DESKTOP_UI_COPY` §4.11。

---

## 5. 信息架构（IA）

- **Desktop 配置中心**：**不包含**「媒体管理服务连接」表单分区；用户 **不可** 在 Desktop 内改 `baseUrl` / `apiKey`。  
- **小助手**：**唯一** 用户向连接配置入口；左键面板须首屏展示当前基址（`DESIGN_TRAY`）。

---

## 6. 与 Windows 本机单实例

远端部署不触发本机 ADR；本机 `media-service` 单实例见 `[ADR_001_windows-single-local-media-service-instance.md](../architecture/adr/ADR_001_windows-single-local-media-service-instance.md)`。

---

## 7. 实现锚点（检索用）


| 区域                          | 位置                                                      |
| --------------------------- | ------------------------------------------------------- |
| Desktop Preload / IPC（只读基址） | `media-desktop/electron/preload.js`、`electron/main.js`  |
| 健康检查                        | `media-desktop/src/mediaServiceHealth.ts`、`src/App.tsx` |
| 连接写入                        | `media-tray-supervisor/`（面板 + 持久化）                      |
| 环境变量                        | `docs/dev/DEV_SETUP.md`                                 |


---

## 8. 追溯与关联文档


| 文档                                                                                                                                                   | 关系       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `[REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md](../requirements/REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md)` | 需求       |
| `[DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md](./DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md)`                                                     | 门禁与顶栏小状态 |
| `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](./DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                                                               | 小助手      |
| `[DESIGN_CONFIG_AND_PATHS.md](./DESIGN_CONFIG_AND_PATHS.md)`                                                                                         | 字段索引     |
| `[DEV_SETUP.md](../dev/DEV_SETUP.md)`                                                                                                                | 开发说明     |


