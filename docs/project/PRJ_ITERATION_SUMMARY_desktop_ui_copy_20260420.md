# ShelfDeck 迭代总结 — 桌面客户端用户可见中文文案

> **类型**：迭代交付与工程验收摘要（非 SSOT 条文；产品/行为仍以 REQ/DESIGN_TASK_CENTER 等为准）  
> **索引入口**：`[PRJ_MANAGEMENT.md](./PRJ_MANAGEMENT.md)`

## 1. 迭代目标与背景

配置中心、任务中心、海报墙等界面存在工程向用语（设计文档章节号、内部枚举、英文错误码等），与普通用户心智不符。本迭代按 **`[REQ_FEATURE_desktop-ui-copy-zh.md](../requirements/REQ_FEATURE_desktop-ui-copy-zh.md)`** 与 **`[DESIGN_DESKTOP_UI_COPY.md](../design/DESIGN_DESKTOP_UI_COPY.md)`** 统一**展示层**文案与分区，不改动任务状态机与 Flow 行为 SSOT。

## 2. 交付物清单


| 类别   | 内容                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 实现   | `media-desktop`（`App.tsx`、`taskQueue.ts`、`transcodePool.ts`、`styles.css` 等）；`media-desktop/electron/transcodeService.js` 与 `media-service/src/services/transcodeService.js` 用户向错误串对齐 |
| 需求   | `[REQ_FEATURE_desktop-ui-copy-zh.md](../requirements/REQ_FEATURE_desktop-ui-copy-zh.md)`（状态：工程验收通过，待产品验收）                              |
| 设计   | `[DESIGN_DESKTOP_UI_COPY.md](../design/DESIGN_DESKTOP_UI_COPY.md)`（§0 实现状态、§3 术语、§4.1 配置分区与保存心智）                                      |
| 治理/入口 | `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`；根 `[README.md](../../README.md)`；`[PRJ_MANAGEMENT.md](./PRJ_MANAGEMENT.md)`                         |

## 3. 工程验收结论

- **验收日**：2026-04-20（UTC+8）。
- **验证方式**：`npx tsc --noEmit`、`npm run build`（`media-desktop`）；对用户可见路径检索（`§`、`docs/design`、`补源` 等）；手工抽查配置中心、任务中心日志默认行、海报墙按钮、典型保存/检验失败提示。
- **应用包版本**：本迭代 **未** 提升 `media-desktop/package.json` 的 `version`。

## 4. 产品验收

以 REQ 文首「状态」为准：**待产品侧抽检**通过后，可将 REQ 状态更新为「已实现（产品验收通过）」或团队等价表述。

## 5. 明确未纳入本迭代的能力

- **真实洗版链路**（搜种/下载/替换）仍以 `[PRJ_MANAGEMENT.md](./PRJ_MANAGEMENT.md)` **§3** 为准，与本文迭代无关。
- **OpenAPI / REST 契约**未因文案迭代修改。

## 6. 追溯


| 文档                                         | 关系        |
| ------------------------------------------ | --------- |
| `[PRJ_MANAGEMENT.md](./PRJ_MANAGEMENT.md)` | 项目管理锚点与时间线 |
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)` | 全库文档索引    |
