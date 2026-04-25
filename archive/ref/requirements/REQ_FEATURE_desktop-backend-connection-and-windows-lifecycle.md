# REQ_FEATURE — 桌面后端连接显性化、Windows 本机单实例与 ShelfDeck 小助手

> **extends**: `[REQ_PRODUCT_BASELINE_v1.0.0.md](./REQ_PRODUCT_BASELINE_v1.0.0.md)`  
> **change-type**: iterative  
> **relates-to**: `[openapi.yaml](../api/openapi.yaml)`（本迭代 **不** 变更 REST 契约；仅使用既有 `GET /v1/health` 与可选 `X-API-Key`）  
> **波及模块**: `media-desktop` · `media-service` · `media-tray-supervisor`（**ShelfDeck 小助手**）

## 文档信息


| 项 | 内容 |
| --- | --- |
| 状态 | **文档已落库**；工程实现满足本文验收标准后更新为「已实现」并补迭代摘要 |
| 行为 SSOT（连接端点） | `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](../design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md)` |
| 行为 SSOT（壳层门禁） | `[DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md](../design/DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md)` |
| 行为 SSOT（小助手） | `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` |
| Windows 单实例决策 | `[ADR_001_windows-single-local-media-service-instance.md](../architecture/adr/ADR_001_windows-single-local-media-service-instance.md)` |

## 背景与目标

- **媒体管理服务基址与 API Key** 的 **用户配置与持久化** **唯一** 在 **ShelfDeck 小助手** 完成，以 **避免**「Desktop 须连上后端才能保存地址、小助手又须先有地址才能启停」的 **死循环**（理由见 `DESIGN_DESKTOP_BACKEND_ENDPOINT` §1.1）。  
- **Desktop** **只读** 连接文件（及环境变量优先级）解析 `effectiveBaseUrl`，执行 `GET /v1/health` 门禁；**配置中心不包含** 媒体管理服务连接表单；壳层 **小型** 黄/绿/红 **联通状态**（见 `DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY`）；不可达时遮罩 **引导用户到小助手** 配置或启停。  
- **ShelfDeck 小助手** 红绿灯表示 **当前有效基址** 是否健康（**黄** = 未配置/未就绪，**绿/红** = 健康/不健康），与后端是否由小助手启动、是否在本机 **无必然绑定**。  
- **打开 Desktop 时** 用户旅程上 **必定** 连带启动小助手；**关闭 Desktop 不关闭小助手**；用户可单独启动小助手；**退出小助手默认不停止后端**（细则见 DESIGN）。  
- Windows 本机默认端口 **单实例** 策略见 ADR。

## 范围

### A. 桌面客户端：只读连接与门禁

**在内**

- **打开应用** → 读取 `effectiveBaseUrl`（见 `DESIGN_DESKTOP_BACKEND_ENDPOINT`）→ 健康探测 → **online** 后用户可进入配置中心（Emby、豆瓣、任务中心等）与五页业务；门禁与保存语义服从 `DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY`。  
- **不得** 提供「媒体管理服务地址 / API Key」的配置中心分区或等价路由。

**非目标**

- 不重写任务中心状态机或 OpenAPI 路径。

### B. Windows：同一主机仅一个本机媒体管理服务实例（默认端口）

**在内**：同前文 ADR；与 Desktop 指向 **远端** NAS **不冲突**。

**非目标**：不限制用户在不同端口手动多实例（高级）。

### C. ShelfDeck 小助手

**在内**

- 左键 **主面板** **醒目展示** 当前 **有效** 服务器基址；**唯一** 用户向 **写入** 连接文件（`baseUrl` / `apiKey`）入口。  
- **未配置后端** 时 **禁用** 启停类操作。  
- **启停** 对用户为 **统一入口**（不分本地/远端两套按钮）；具体能力依赖实现矩阵（本机 spawn、远端管理通道或引导），见 DESIGN §3.3 与 OPS/帮助。  
- 健康探测与 Desktop **同源** `effectiveBaseUrl` **判据**。

**非目标**

- 不要求第一版即实现任意 NAS 的远程进程 kill；可提供文档引导与降级 UX。

## 功能需求（摘要）

1. **Desktop**：只读连接、健康、`preload`/渲染同源；**无** 连接写入。  
2. **media-service（Windows）**：本机单实例（ADR）。  
3. **小助手**：按 `DESIGN_TRAY` 实现面板、黄绿红、连接保存、启停门槛与退出语义；更新 TEST/USER。

## 验收标准

### A. 桌面

1. **无** 配置中心「媒体管理服务连接」表单；检索与手工确认。  
2. **offline / unknown** 时强门禁；文案 **明确** 引导用户到 **小助手** 配置或启动后端（见 UI_COPY）。  
3. **online** 后可正常使用配置中心其它分区与五页；健康与 `effectiveBaseUrl` 一致。  
4. 顶栏（或约定位置）有 **小型** 联通状态指示，与门禁状态一致。

### B. Windows 单实例

同前文 ADR 验收。

### C. 小助手

1. 已保存基址且后端健康：**绿**；连续失败：**红**；无基址或未就绪：**黄**（与 DESIGN 一致）。  
2. 左键面板 **可见完整当前基址**；**仅** 小助手 **可** 保存连接；保存后 Desktop **可** 在合理时间内刷新为同一基址。  
3. 未配置时 **启停** 不可用；已配置后 **可操作**（能力以 §3.3 矩阵与实现为准）。  
4. **关闭 Desktop** 后小助手 **仍可运行**；**退出小助手** **默认** 不停止后端（除非高级选项）。  
5. `TEST_TRAY_MEDIA_SERVICE_SUPERVISOR` 准出更新后签发。

## 追溯与关联文档


| 文档 | 关系 |
| --- | --- |
| `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](../design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md)` | 连接端点 SSOT |
| `[DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md](../design/DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md)` | 门禁 |
| `[DESIGN_CONFIG_AND_PATHS.md](../design/DESIGN_CONFIG_AND_PATHS.md)` | 配置分区 |
| `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` | 小助手 SSOT |
| `[REQ_FEATURE_desktop-requires-media-service.md](./REQ_FEATURE_desktop-requires-media-service.md)` | relates-to |
| `[REQ_FEATURE_windows-tray-media-service-supervisor.md](./REQ_FEATURE_windows-tray-media-service-supervisor.md)` | 托盘/小助手需求 |
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)` | 索引 |
