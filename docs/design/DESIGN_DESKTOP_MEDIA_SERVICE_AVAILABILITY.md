# DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY — 媒体管理服务可达性与壳层门禁

> **SSOT 路径**：`[DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md](./DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`  
> **关联需求**：`[REQ_FEATURE_desktop-requires-media-service.md](../requirements/REQ_FEATURE_desktop-requires-media-service.md)`  
> **配置保存展示**：`[DESIGN_CONFIG_CENTER_SAVE_FEEDBACK.md](./DESIGN_CONFIG_CENTER_SAVE_FEEDBACK.md)` · **文案**：`[DESIGN_DESKTOP_UI_COPY.md](./DESIGN_DESKTOP_UI_COPY.md)`

---

## 0. 实现与验收状态（非行为 SSOT）

- **工程交付**：2026-04-20（UTC+8）按 `[REQ_FEATURE_desktop-requires-media-service.md](../requirements/REQ_FEATURE_desktop-requires-media-service.md)` 与本文完成实现与回归（含 `mediaService.checkHealth`、`GET /v1/health` 判据、壳层全屏门禁、配置保存路径与在线门槛对齐）。
- **产品验收**：2026-04-20（UTC+8）通过；REQ 文首「状态」为 **已实现（工程与产品验收通过）**；迭代摘要见 `[PRJ_ITERATION_SUMMARY_config_center_media_service_gate_20260420.md](../project/PRJ_ITERATION_SUMMARY_config_center_media_service_gate_20260420.md)`（与同迭代 **配置保存反馈** 一并记录）。

---

## 1. 目标与非目标

### 1.1 目标

- 用户在**未启动或未部署媒体管理服务**时，**不应**误以为本应用可独立完成配置与业务闭环。
- **服务不可达**：壳层提供**强门禁**（全屏或等效阻断），直至探测恢复为 **online**。
- **服务可达判据**：与 OpenAPI 一致使用 `**GET /v1/health`**（无鉴权），响应 `200` 且 JSON 含 `status: "ok"`（与 `[media-service/src/app.js](../../media-service/src/app.js)` 实现一致）。

### 1.2 非目标

- 不规定 Tray 与子进程细节（见 tray 专题文档）。
- 不替代任务中心状态机（`DESIGN_TASK_CENTER`）。

---

## 2. 状态机


| 状态        | 含义                                  |
| --------- | ----------------------------------- |
| `unknown` | 首次挂载后尚未完成一次成功的健康探测；**禁止**当作 online。 |
| `online`  | 最近一次探测成功；允许壳层与配置保存成功语义。             |
| `offline` | 最近一次探测失败（网络错误、非 2xx、超时）；壳层强门禁。      |


从 `offline` → `online` 时清除「服务不可用」主文案，恢复交互；**不**自动清空用户可能在 `configSaveFeedback` 中的其它错误（由配置页逻辑决定）。

---

## 3. 探测策略

- **首次**：应用挂载后立即发起一次 `GET /v1/health`。
- **轮询**：间隔 **12 秒**（与常见心跳同量级，可微调实现）。
- **焦点**：`window` 获得焦点时再触发一次探测（便于用户启动服务后无需等满一轮）。
- **URL**：与 Electron `preload` 中 `CP_BASE` 及 Vite `import.meta.env.VITE_MEDIA_SERVICE_URL` / `VITE_CONTROL_PLANE_URL` 同源（同义规则见 `[DEV_SETUP.md](../dev/DEV_SETUP.md)`）；必要时带 `X-API-Key`（与现有 `cpJson` 一致）。

---

## 4. 壳层表现（强门禁）

- `**unknown`**：覆盖壳层主区域的**连接中**遮罩（短句即可，避免与 offline 长说明混淆）；**禁止**切换五页与操作主内容。
- `**offline`**：覆盖壳层主区域的**不可用**遮罩；文案须说明**须先启动/连接媒体管理服务**；可提示默认 `http://127.0.0.1:18080` 作为开发参考，**禁止** `§`、仓库路径、`REQ_*` 文件名作为主句（见 `DESIGN_DESKTOP_UI_COPY`）。
- `**online`**：无上述遮罩；底部 `appErrorBanner` 仍可用于**任务执行**等非「服务门禁」类提示。

---

## 5. 与配置保存反馈的关系

- 配置保存成功/失败仍以 `configSaveFeedback` 为主通道（见 `DESIGN_CONFIG_CENTER_SAVE_FEEDBACK`）。
- **强门禁下**用户通常无法点击保存；若因竞态或未来弱化门禁触发保存，须在保存函数内**再次**校验 `online`，失败时使用 `formatSaveConfigFailed` 类人话，**不得**出现成功态。
- **服务不可用**与单条业务校验失败在文案上可共用「保存配置不成功。原因：…」句式。

---

## 6. 实现锚点（检索用）


| 区域      | 位置                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 健康 API  | `GET /v1/health` · `[openapi.yaml](../api/openapi.yaml)`                                                                                |
| Preload | `[media-desktop/electron/preload.js](../../media-desktop/electron/preload.js)`                                                          |
| 渲染进程    | `[media-desktop/src/mediaServiceHealth.ts](../../media-desktop/src/mediaServiceHealth.ts)`、`[App.tsx](../../media-desktop/src/App.tsx)` |


---

## 7. 测试要点（手工）

1. 停服务 → 启动客户端 → `unknown` 后 `offline` 遮罩；无法进入业务页完成操作。
2. 启服务 → 12s 内或焦点切换后应 `online`。
3. 运行中停止服务 → 应回到 `offline`（至多一轮轮询 + 焦点可选）。
4. `online` 后配置保存行为仍符合 `REQ_FEATURE_config-center-save-feedback`。