# ARCH_INTEGRATIONS — 外部服务与集成边界

> **SSOT 路径**：`[ARCH_INTEGRATIONS.md](./ARCH_INTEGRATIONS.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

本文档描述 **Emby Server**、**豆瓣**、**MoviePilot（补源）** 及路线图中的 **OpenClaw / MCP** 等与产品的集成关系、依赖与降级原则。**任务中心 Flow**、HTTP 鉴权细节仍以 `[DESIGN_TASK_CENTER.md](../design/DESIGN_TASK_CENTER.md)` 为 SSOT；豆瓣抓取与匹配细则见 `[DESIGN_LIBRARY_AND_QUEUE.md](../design/DESIGN_LIBRARY_AND_QUEUE.md)`；战略形态见 `[ARCH_SYSTEM_OVERVIEW.md](./ARCH_SYSTEM_OVERVIEW.md)`。

---

## 上下文与目标

- **目标**：在单机桌面 + 可选媒体管理服务部署下，安全、可维护地对接外部系统；避免在多处重复业务规则（REST、MCP、UI 应共享同一领域语义）。
- **非目标**：替代 Emby/OpenAPI 官方文档；不展开各第三方 API 的字段级参考（以联调代码与 `[openapi.yaml](../api/openapi.yaml)` 为准）。

---

## 集成清单（索引）


| 系统                 | 用途                     | 细则位置                                                                                                                                                    |
| ------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Emby Server**    | 媒体库、播放、已播放回写、删除等治理 API | `[DESIGN_FRONT_PLAYBACK.md](../design/DESIGN_FRONT_PLAYBACK.md)`（前台 API 最小集）；删除鉴权 `[DESIGN_TASK_CENTER.md](../design/DESIGN_TASK_CENTER.md)` **§2.3.5** |
| **豆瓣**             | 「看过」个人评分、与本地片库匹配、有效星级  | `[DESIGN_LIBRARY_AND_QUEUE.md](../design/DESIGN_LIBRARY_AND_QUEUE.md)` **§5**                                                                           |
| **MoviePilot**     | 洗版/补源搜索、候选排序与入队        | 本文 **§与 MoviePilot 联动**；执行 Flow 见 DESIGN_TASK_CENTER **§2.5**                                                                                           |
| **OpenClaw / MCP** | 「经典回顾」等智能体场景           | `[ARCH_SYSTEM_OVERVIEW.md](./ARCH_SYSTEM_OVERVIEW.md)` **§4～§5**                                                                                        |


---

## 与 MoviePilot 联动方案

### 联动原则

- 优先使用 API（搜索/下载/历史），避免直接读数据库。
- 将“码率估算 + 候选排序”放在本应用侧执行，保持规则可控。

### 估算口径

- 总码率估算：`sizeGB * 8192 / durationSec`
- 视频码率估算：总码率减去音频和容器开销估计
- 结合编码标签进行加权评分

### 结果处理

- 候选达标：入队执行
- 候选不达标：`waiting_media_source`
- 接口鉴权或系统错误：`failed_hard`

---

## 接口与集成边界

- **HTTP 契约**（媒体管理服务自有 API）：`[openapi.yaml](../api/openapi.yaml)`、`[API_README.md](../api/API_README.md)`。
- **配置与密钥**：Emby、豆瓣 Cookie、MoviePilot 等仅存本机；不向产品方自有云端上传片库内容（除非用户另行配置同步工具）。
- **错误与降级**：外部不可达时，前台应阻断依赖该外部的动作并提示；治理任务进入可恢复状态（如 `waiting_media_source`）而非静默失败。

---

## 风险与演进

- 第三方站点/API 变更会导致抓取或补源失败，需版本化兼容策略。
- MoviePilot 与洗版真实链路在 beta 阶段可能仍部分占位，以 `[PRJ_MANAGEMENT.md](../project/PRJ_MANAGEMENT.md)` 与需求母版 **工程实现快照** 为准。

---

## 追溯与关联文档


| 文档                                                                                 | 关系                                      |
| ---------------------------------------------------------------------------------- | --------------------------------------- |
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`                                        | 全库索引                                    |
| `[REQ_PRODUCT_BASELINE_v1.0.0.md](../requirements/REQ_PRODUCT_BASELINE_v1.0.0.md)` | 需求母版                                    |
| `[ARCH_SYSTEM_OVERVIEW.md](./ARCH_SYSTEM_OVERVIEW.md)`                             | 前后端分离、MCP、路径 SSOT 原则                    |
| `[DESIGN_LIBRARY_AND_QUEUE.md](../design/DESIGN_LIBRARY_AND_QUEUE.md)`             | 洗版与转码边界、豆瓣                              |
| `[DESIGN_TASK_CENTER.md](../design/DESIGN_TASK_CENTER.md)`                         | `upgrade` / `waiting_media_source` Flow |
| `[openapi.yaml](../api/openapi.yaml)`                                              | REST 形状                                 |


