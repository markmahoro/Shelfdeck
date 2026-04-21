# DESIGN_CONFIG_AND_PATHS — 配置中心职责边界与索引

> **SSOT 路径**：`[DESIGN_CONFIG_AND_PATHS.md](./DESIGN_CONFIG_AND_PATHS.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

本文档描述 **配置中心** 的职责边界、信息架构位置及 **路径映射** 约定。**所有配置字段的详细定义（字段名、类型、默认值、验证规则）** 见 `[DESIGN_CONFIG_FIELDS_REFERENCE.md](./DESIGN_CONFIG_FIELDS_REFERENCE.md)` **（配置字段 SSOT）**。任务调度、并发、执行模式等 **调度类** 配置条文以 `[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)` **第 7 节** 为 SSOT；战略级「路径/配置权威在后端」见 `[ARCH_SYSTEM_OVERVIEW.md](../architecture/ARCH_SYSTEM_OVERVIEW.md)`。

---

## 范围与引用

- **In scope**：配置中心在信息架构中的定义、职责边界、路径映射约定、配置归属原则。
- **配置字段 SSOT**：`[DESIGN_CONFIG_FIELDS_REFERENCE.md](./DESIGN_CONFIG_FIELDS_REFERENCE.md)` — 所有字段的详细定义、类型、默认值、验证规则。
- **Out of scope**：各 `actionType` Flow 步骤、状态机、删除/转码 HTTP 细节（见 DESIGN_TASK_CENTER）；OpenAPI 形状（见 `[openapi.yaml](../api/openapi.yaml)`）。

---

## 配置中心在顶层架构中的定义

1. **配置中心（Config）**：**Emby 与播放器**、**任务调度与补源**（执行模式、**删除/转码/洗版多队列**并发、补源重试节奏、海报墙打分自动入队等）及其他配置分区。**不含** ShelfDeck **媒体管理服务** HTTP 基址/API Key 表单（该配置 **仅** 在 **小助手**，见 `DESIGN_DESKTOP_BACKEND_ENDPOINT`）。

---

## 配置归属原则（摘要）

- **谁消费、谁持有（客户端侧）**：仅被 **小助手** 使用的选项（如开机自启、退出是否停本机服务）放在 **小助手** 自己的设置存储；仅 **桌面** 使用的 UI 缓存等放在 **桌面**（如 `localStorage`）。  
- **多方共用（桌面 + 媒体管理服务 + 可选 MCP）**：业务真相在 **媒体管理服务** 持久化（如 `controlPlaneConfig`、任务队列等），见 `ARCH_SYSTEM_OVERVIEW`。  
- **「如何连上媒体管理服务」**：属于 **客户端拨号元信息**，**不**写入 `media-service` 自有数据文件；由 **小助手** 写入共享连接文件、**桌面只读**（`DESIGN_DESKTOP_BACKEND_ENDPOINT`）。

---

## ShelfDeck 媒体管理服务 HTTP 基址（非 Emby；持久化由小助手维护）

与 Emby Server 的 `baseUrl` **无关**；本条为 **ShelfDeck 媒体管理服务** HTTP 基址，供桌面壳层、`preload` 与渲染进程调用 `GET /v1/health` 及后续 REST。

- **信息架构顺序**：用户 **在 ShelfDeck 小助手** 完成 **媒体管理服务** 地址（及可选 API Key）配置并使服务 **健康** 后，再在桌面 **配置中心** 进入 **Emby 与播放器**、豆瓣、任务调度等分区。桌面 **无**「媒体管理服务连接」分区。细则见 [`DESIGN_DESKTOP_BACKEND_ENDPOINT.md`](./DESIGN_DESKTOP_BACKEND_ENDPOINT.md)。
- **持久化键名（SSOT）**：`shelfdeck.mediaService.baseUrl`（必填）、`shelfdeck.mediaService.apiKey`（可选，与 `X-API-Key` 对应）；**仅小助手** 写入该文件。
- **ShelfDeck 小助手**：**同一键名、同一存储文件**；**唯一** 用户向编辑入口；**左键面板** 须展示当前基址；详见 `DESIGN_DESKTOP_BACKEND_ENDPOINT`、`DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR`。

## 配置字段详细定义

**所有配置字段的详细定义（字段名、类型、必填、默认值、说明、验证规则）见**：

`[DESIGN_CONFIG_FIELDS_REFERENCE.md](./DESIGN_CONFIG_FIELDS_REFERENCE.md)` **（配置字段 SSOT）**

包括但不限于：
- Emby 服务器连接：`baseUrl`、`apiKey`、`userId`、`embyUserPassword`、`enabledSectionIds`
- 播放器配置：`playerExePath`、`argsTemplate`
- 路径映射：`pathMapFrom`、`pathMapTo`
- 播放回写：`markPlayedThresholdPercent`、`fallbackMinSeconds`
- 任务调度：`executionMode`、`deleteConcurrency`、`transcodeConcurrency`、`upgradeConcurrency`、`wallRatingAutoEnqueue`
- 转码配置：`transcodeTempRoot`、`transcodeReplaceConfirmRequired`、`transcodeEncodingDevices`、`transcodeCpuParticipationStrategy`
- 洗版配置：`upgradeRetryInterval`、`upgradeMaxRetries`

---

## 路径映射（产品约定）

- **Playback / 预检 / 转码** 使用的 **本机可读路径** 均经 `pathMapFrom` → `pathMapTo` 解析；映射 **权威** 以媒体管理服务持久化配置为 SSOT（见 ARCH_SYSTEM_OVERVIEW **§3.4**）；Electron 设置页仅展示与编辑并经 API 写回。
- **媒体库列表** 刷新时结合映射解析本机路径，用于原盘类（ISO/BDMV）判定；判定规则与任务中心互斥见 DESIGN_TASK_CENTER **§3.7.3**。

---

## 任务调度与补源类配置（索引）

- 执行模式、删除/转码/洗版并发、`wallRatingAutoEnqueue`、补源重试节奏等由 **配置中心 → 任务调度与补源** 维护。
- **字段定义** 见 `[DESIGN_CONFIG_FIELDS_REFERENCE.md](./DESIGN_CONFIG_FIELDS_REFERENCE.md)` **§5-§7**。
- **调度语义与行为** 见 `[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)` **§7**。
- 需求母版中的产品范围与验收见 `[REQ_PRODUCT_BASELINE_v1.0.0.md](../requirements/REQ_PRODUCT_BASELINE_v1.0.0.md)`。

---

## 追溯与关联文档


| 文档                                                                                 | 关系           |
| ---------------------------------------------------------------------------------- | ------------ |
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`                                        | 全库索引         |
| `[DESIGN_CONFIG_FIELDS_REFERENCE.md](./DESIGN_CONFIG_FIELDS_REFERENCE.md)`         | **配置字段 SSOT** |
| `[REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md](../requirements/REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md)` | 连接端点需求 |
| `[REQ_PRODUCT_BASELINE_v1.0.0.md](../requirements/REQ_PRODUCT_BASELINE_v1.0.0.md)` | 需求母版         |
| `[DESIGN_FRONT_PLAYBACK.md](./DESIGN_FRONT_PLAYBACK.md)`                           | 前台配置与回写闭环    |
| `[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)`                                 | 调度与任务中心 SSOT |
| `[ARCH_SYSTEM_OVERVIEW.md](../architecture/ARCH_SYSTEM_OVERVIEW.md)`               | 路径/配置战略分工    |
| `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](./DESIGN_DESKTOP_BACKEND_ENDPOINT.md)`       | 连接端点（小助手写、桌面读） |
| `[openapi.yaml](../api/openapi.yaml)` / `[API_README.md](../api/API_README.md)`    | REST 契约与说明   |
