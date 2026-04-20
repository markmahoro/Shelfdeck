# REQ_FEATURE — 桌面客户端强制依赖媒体管理服务在线

> **extends**: `[REQ_PRODUCT_BASELINE_v1.0.0.md](./REQ_PRODUCT_BASELINE_v1.0.0.md)`  
> **change-type**: iterative  
> **relates-to**: 桌面客户端 `media-desktop`；呈现与交互以 `[DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md](../design/DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md)` 为 SSOT；与 `[REQ_FEATURE_config-center-save-feedback.md](./REQ_FEATURE_config-center-save-feedback.md)` 一并交付；**连接端点**见 `[REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md](./REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md)`、`[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](../design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md)`：**小助手** **独占写入** 连接文件，Desktop **只读** **同源** `effectiveBaseUrl` 并做 `GET /v1/health`（见 `DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR`），判据与本文一致。

## 文档信息


| 项       | 内容                                                                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态      | 已实现（工程与产品验收通过）                                                                                                                                |
| 模块      | `media-desktop`（`electron/preload.js`、`src/App.tsx`、`src/mediaServiceHealth.ts` 等）                                                            |
| 行为 SSOT | 不修改 `[DESIGN_TASK_CENTER.md](../design/DESIGN_TASK_CENTER.md)` 任务状态机；不改变 `[openapi.yaml](../api/openapi.yaml)` 中既有路径语义（使用已有 `GET /v1/health`） |


## 背景与目标

- 若部分配置仅存 `localStorage` 而部分能力依赖 HTTP，在**媒体管理服务未启动**时用户仍可能误以为「已保存成功、可用」，与「使用桌面能力须部署后端」的产品叙述冲突。
- **目标**：（1）在未确认服务可达前，**不提供**完整业务壳层体验；（2）服务不可达时**禁止**将配置以成功语义写入（含 Emby/码率等原纯本地路径）；（3）健康检查与文案与 OpenAPI、开发环境变量约定一致。

## 范围

### 在内

- `**GET /v1/health`** 周期性探测与窗口焦点重试；**有效基址**解析优先级见 `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](../design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md)`（**小助手** 写入的持久化、环境变量、`VITE_`* 兜底、默认值）；Desktop **不** 写入连接文件；开发与打包仍见 `[DEV_SETUP.md](../dev/DEV_SETUP.md)`。
- **强门禁**：服务不可达时壳层级不可用态（遮罩/阻断主导航与主内容交互），首屏探测中的过渡态（`unknown`）行为见 DESIGN。
- **配置保存**：所有配置分区保存入口在**服务非 online** 时不得完成成功语义（含短路与 `formatSaveConfigFailed` 类人话，见 `[DESIGN_DESKTOP_UI_COPY.md](../design/DESIGN_DESKTOP_UI_COPY.md)`）。
- **与配置反馈**：离线/未就绪失败展示与 `[REQ_FEATURE_config-center-save-feedback.md](./REQ_FEATURE_config-center-save-feedback.md)` 中 `configSaveFeedback` 口径一致；任务执行类错误仍不限于本文（`appErrorBanner`）。

### 非目标

- 不要求将 Emby 配置改为**仅**服务端存储；本迭代仅**门禁与体验**。
- 不新增自动化测试门禁（可选后续）；验收以手工为准。

## 功能需求

1. **健康探测**：以无鉴权的 `GET /v1/health` 为判据；200 且响应体可解析为存活则认为 **online**（详见 DESIGN）。
2. **轮询与重试**：实现定时轮询与窗口获得焦点点检；从 offline → online 后恢复全壳层交互。
3. **强门禁**：offline（及 DESIGN 规定的 unknown 阶段）下用户**不能**使用五页主导航与主内容完成业务操作，直至恢复 online。
4. **配置保存**：仅在 **online** 时允许完成各分区「保存」的成功路径；否则提示原因（须含「无法连接 / 须先启动服务」类人话）。
5. **Electron 与 Vite 开发**：Electron 经 preload 调用与健康检查 **同源**（与 `DESIGN_DESKTOP_BACKEND_ENDPOINT` 一致）；浏览器直连 Vite 时仍可用 `import.meta.env` 作兜底（与 DEV_SETUP 一致）。
6. **小助手或环境变量生效后的基址**：门禁与健康探测须针对当前 **`effectiveBaseUrl`**（及可选 API Key），**不得**隐含「仅 `127.0.0.1:18080`」为唯一路径（该地址仅作未配置时的典型默认）；Desktop **内** **无** 保存基址入口。

## 验收标准

1. **停止** `media-service` 后启动桌面客户端：进入不可业务操作态，且文案人类可读、无 `§` / 仓库路径指引（见 DESIGN_UI_COPY）；须 **引导** 用户到 **ShelfDeck 小助手** 配置或启动后端（Desktop 无可改地址入口）。
2. **启动**服务后：在合理时间内（见 DESIGN）切入 **online**，原先受阻操作可用；配置各分区可按 `[REQ_FEATURE_config-center-save-feedback.md](./REQ_FEATURE_config-center-save-feedback.md)` 显示保存反馈。
3. Emby/码率：**offline** 时点击保存**不得**出现「保存配置成功」；**online** 后可正常成功。
4. 开发文档 `[DEV_SETUP.md](../dev/DEV_SETUP.md)` 与门面 `[README.md](../../README.md)` 已提示须先启动或可连接媒体管理服务（与仓库治理一致）。
5. 在实现 `REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle` 后：用户 **在小助手** 将基址配为**非本机默认**地址时，门禁与健康检查仍正确，且配置保存门槛与在线语义一致。

## 追溯与关联文档


| 文档                                                                                                                                                                                                                            | 关系            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `[REQ_PRODUCT_BASELINE_v1.0.0.md](./REQ_PRODUCT_BASELINE_v1.0.0.md)`                                                                                                                                                          | 母版（extends）   |
| `[DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md](../design/DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md)`                                                                                                                      | 呈现与探测 SSOT    |
| `[REQ_FEATURE_config-center-save-feedback.md](./REQ_FEATURE_config-center-save-feedback.md)`                                                                                                                                  | 同迭代：配置保存反馈    |
| `[DESIGN_DESKTOP_UI_COPY.md](../design/DESIGN_DESKTOP_UI_COPY.md)`                                                                                                                                                            | 用户可见文案        |
| `[openapi.yaml](../api/openapi.yaml)` · `[DEV_SETUP.md](../dev/DEV_SETUP.md)`                                                                                                                                                 | Health、本地开发变量 |
| `[REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md](./REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md)` · `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](../design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md)` | 连接端点          |
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`                                                                                                                                                                                   | 文档索引          |
