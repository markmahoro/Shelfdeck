# REQ_FEATURE — 桌面客户端用户可见中文文案

> **extends**: `[REQ_PRODUCT_BASELINE_v1.0.0.md](./REQ_PRODUCT_BASELINE_v1.0.0.md)`  
> **change-type**: iterative  
> **relates-to**: 桌面客户端（`media-desktop`）可理解性与表述一致性；字段级与场景级细则以 `[DESIGN_DESKTOP_UI_COPY.md](../design/DESIGN_DESKTOP_UI_COPY.md)` 为 SSOT

## 文档信息


| 项       | 内容                                                                                   |
| ------- | ------------------------------------------------------------------------------------ |
| 状态      | 已实现（工程验收通过，待产品验收）                                                                    |
| 工程完成日期  | 2026-04-20（UTC+8）；迭代摘要 `[PRJ_ITERATION_SUMMARY_desktop_ui_copy_20260420.md](../project/PRJ_ITERATION_SUMMARY_desktop_ui_copy_20260420.md)` |
| 模块      | 桌面客户端 `media-desktop`                                                                |
| 行为 SSOT | 不变更 `[DESIGN_TASK_CENTER.md](../design/DESIGN_TASK_CENTER.md)` 等既有行为定义；仅约束**用户可见表述** |


## 背景与目标

- 当前界面存在工程向用语（设计文档章节号、仓库路径、内部枚举、API 名片语等），普通用户难以理解。
- **目标**：（1）用户易理解；（2）用户视角下前后语义无冲突；（3）表述清晰、尽量精炼。  
细则与禁区见 `[DESIGN_DESKTOP_UI_COPY.md](../design/DESIGN_DESKTOP_UI_COPY.md)`。

## 范围

### 在内

- `media-desktop` 内所有**默认可见**的用户界面字符串：配置中心、海报墙、播放记录、媒体库管理、任务中心（含执行日志默认展示）、相关确认弹窗。
- 最终在 UI 错误横幅或等价反馈中展示的 `**Error.message`**（含 Electron 主进程等与界面联动的错误串）。

### 非目标

- 不修改 `[openapi.yaml](../api/openapi.yaml)` 或 REST 契约。
- 不替代 `[DESIGN_TASK_CENTER.md](../design/DESIGN_TASK_CENTER.md)` 状态机与 Flow 行为规格；`DESIGN_*` 正文可保留 § 编号供开发阅读，但产品 UI **不得**暴露（见 DESIGN）。
- 不强制要求独立 `TEST_`* 自动化；验收以本文 + DESIGN **测试要点** 手工准出为主。

## 功能需求

1. **全局禁区**：默认 UI、默认执行日志行、用户可见错误信息中，不得出现 `§`、不得引导用户阅读 `docs/` 下设计文档路径或 `DESIGN_`* / `REQ_*` 文件名作为主说明；不得以英文 `TaskStatus` 枚举作为状态行的唯一展示（须中文为主，见 DESIGN）。
2. **配置中心 · 任务相关页**：页眉、小节标题、按钮、字段标签、保存提示符合 DESIGN 第 4.1 节；不得出现「与某 md 对表」「模块一/二/三」及括号内 §。
3. **任务中心**：侧栏分组命名、任务说明、任务状态展示符合 DESIGN 第 4.2 节；执行日志默认格式符合 DESIGN 第 4.3 节（中文叙事；`code` 级内容默认隐藏或置于技术详情）。
4. **媒体库 · 删除档说明**：不得要求用户打开仓库内 md 或 § 锚点；改为应用内步骤说明（DESIGN 第 4.4 节）。
5. **海报墙 · 确认已观看**：主按钮文案符合 DESIGN 第 4.5 节（避免单独使用「回写」）。
6. **Emby/播放器配置区**：字段标签与帮助语符合 DESIGN 第 4.6 节。
7. **删除信息确认**：路径类说明符合 DESIGN 第 4.7 节（不得裸用 `DeleteInfo` 作为用户主标签）。
8. **转码体积摘要**：失败/不采纳类提示符合 DESIGN 第 4.8 节。
9. **转码确认弹窗**：信息分层符合 DESIGN 第 4.9 节（首句人话，冷术语折叠）。
10. **术语一致**：对外用语遵循 DESIGN 第 3 节术语表；模拟任务标题与 `taskStatusLabelZh` 中文一致。
11. **Electron/服务错误**：用户可见错误串符合 DESIGN 第 5 节（人话 + 指引，无 §）。

## 验收标准

以下可与 DESIGN 第 7 节测试要点合并执行，**全部满足**视为本需求验收通过：

1. 在 `media-desktop` 源码中对用户可见字符串构建路径检索：`§`、`docs/design`、`DESIGN_TASK`、`REQ_FEATURE` 等不得出现在默认 UI 字符串字面量中（注释与仅开发者分支除外）。
2. 任务中心：默认展开的执行日志行**不包含**英文 `code` 前缀（如 `delete.precheck.start`），除非实现「显示技术详情」且默认关闭。
3. 任务中心：任务状态展示以中文为主，**不**要求用户从 `(queued)` 等英文枚举理解状态。
4. 配置中心任务页：无「模块一」「对表」及带 § 的按钮或标签文案。
5. 人为触发至少一条转码/配置相关错误：界面展示为中文说明 + 可操作路径指引，**无** § 与文档锚点。
6. 海报墙「确认已观看」主按钮文案与 DESIGN 第 4.5 节一致。
7. 对外术语与 DESIGN 第 3 节无冲突（同屏不混用未定义的「压制/转码/压缩」表述指代同一产品动作）。

## 追溯与关联文档


| 文档                                                                                     | 关系                            |
| -------------------------------------------------------------------------------------- | ----------------------------- |
| `[REQ_PRODUCT_BASELINE_v1.0.0.md](./REQ_PRODUCT_BASELINE_v1.0.0.md)`                   | 母版（extends）                   |
| `[DESIGN_DESKTOP_UI_COPY.md](../design/DESIGN_DESKTOP_UI_COPY.md)`                     | 文案 SSOT（术语、禁区、分区域）            |
| `[DESIGN_FRONT_PLAYBACK.md](../design/DESIGN_FRONT_PLAYBACK.md)`                       | 五页与播放闭环行为                     |
| `[DESIGN_TASK_CENTER.md](../design/DESIGN_TASK_CENTER.md)`                             | 任务中心行为                        |
| `[DESIGN_CONFIG_AND_PATHS.md](../design/DESIGN_CONFIG_AND_PATHS.md)`                   | 配置字段含义                        |
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`                                            | 文档索引与升格规则                     |
| `[scratch/FRONTEND_COPY_REVIEW_TABLE.md](../../scratch/FRONTEND_COPY_REVIEW_TABLE.md)` | 来源工作笔记（非 SSOT；以本文与 DESIGN 为准） |
