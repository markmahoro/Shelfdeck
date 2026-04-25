# ShelfDeck 迭代总结 — 配置中心保存反馈与媒体管理服务壳层门禁

> **类型**：迭代交付与整体验收摘要（非 SSOT 条文；产品/行为仍以 REQ/DESIGN 为准）  
> **索引入口**：`[PRJ_MANAGEMENT.md](./PRJ_MANAGEMENT.md)`

## 1. 迭代目标与背景

在前后端分离与配置多入口并存的前提下，用户可能在 **媒体管理服务未启动** 时仍看到「部分保存成功」或误以为业务可闭环。本迭代交付两件事，**一并验收**：（1）**配置中心**各分区「保存 / 检验」反馈与全局错误展示 **分流**，成功 / 失败语义与 `DESIGN_DESKTOP_UI_COPY` 一致；（2）以 `**GET /v1/health`** 为判据的 **壳层强门禁**，在服务 **unknown / offline** 时阻断完整业务壳层，且 **禁止** 将需服务背书的配置以成功语义写入。

## 2. 交付物清单


| 类别      | 内容                                                                                                                                                                                                                                                                |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 实现      | `media-desktop`：`src/App.tsx`（`configSaveFeedback`、`configAsyncOp`、`mediaServiceGateOverlay`、`ensureMediaServiceOnlineForConfigSave` 等）、`src/mediaServiceHealth.ts`、`src/styles.css`；`electron/preload.js` 暴露 `window.mediaService.checkHealth`；`src/global.d.ts` |
| 需求      | `[REQ_FEATURE_config-center-save-feedback.md](../requirements/REQ_FEATURE_config-center-save-feedback.md)` · `[REQ_FEATURE_desktop-requires-media-service.md](../requirements/REQ_FEATURE_desktop-requires-media-service.md)`                                     |
| 设计      | `[DESIGN_CONFIG_CENTER_SAVE_FEEDBACK.md](../design/DESIGN_CONFIG_CENTER_SAVE_FEEDBACK.md)` · `[DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md](../design/DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md)`                                                             |
| 治理 / 入口 | `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`；根 `[README.md](../../README.md)`；`[DEV_SETUP.md](../dev/DEV_SETUP.md)`（健康检查与联调变量）                                                                                                                                     |


## 3. 验收结论

- **整体验收通过**（UTC+8：**2026-04-20**）。
- **验证方式**：`media-desktop` 构建与手工烟测（服务 **离线** 时壳层门禁与保存被门禁、**上线** 后恢复；配置分区保存成功 / 失败提示与检验转码探针分流等）。
- **应用包版本**：本迭代 **未** 提升 `media-desktop/package.json` 的 `version`。

## 4. 明确未纳入本迭代的能力

- **独立托盘监督**以外的 **关窗驻留托盘、观影时降载**（桌面壳层其它叙事仍见 `[PRJ_MANAGEMENT.md](./PRJ_MANAGEMENT.md)` **§3**）。
- **任务中心状态机、OpenAPI 路径语义**未因本迭代改变（仅使用既有 `GET /v1/health`）。

## 5. 追溯


| 文档                                          | 关系         |
| ------------------------------------------- | ---------- |
| `[PRJ_MANAGEMENT.md](./PRJ_MANAGEMENT.md)`  | 项目管理锚点与时间线 |
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)` | 全库文档索引     |
