# REQ_FEATURE — 配置中心保存与检验反馈（呈现统一）

> **extends**: `[REQ_PRODUCT_BASELINE_v1.0.0.md](./REQ_PRODUCT_BASELINE_v1.0.0.md)`  
> **change-type**: iterative  
> **relates-to**: 桌面客户端（`media-desktop`）配置中心；呈现与交互细则以 `[DESIGN_CONFIG_CENTER_SAVE_FEEDBACK.md](../design/DESIGN_CONFIG_CENTER_SAVE_FEEDBACK.md)` 为 SSOT  
> **同迭代交付**：`[REQ_FEATURE_desktop-requires-media-service.md](./REQ_FEATURE_desktop-requires-media-service.md)`（媒体管理服务未可达时不得产生保存成功语义；壳层门禁见该 REQ 与 `[DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md](../design/DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md)`）

## 文档信息


| 项       | 内容                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------- |
| 状态      | 已实现（工程与产品验收通过）                                                                                                                 |
| 模块      | 桌面客户端 `media-desktop`（`src/App.tsx`、`src/styles.css` 等）                                                                 |
| 行为 SSOT | 不修改 `[DESIGN_TASK_CENTER.md](../design/DESIGN_TASK_CENTER.md)` 任务状态机与 Flow；不改变 `[openapi.yaml](../api/openapi.yaml)` 契约 |


## 背景与目标

- 配置中心各分区「保存」按钮的反馈不一致：部分分区无成功/失败提示，部分使用全局底部横幅或与「检验转码资源池」混用同一展示位，用户难以确认是否已安全写入、是否可按当前配置使用相关能力。
- **目标**：（1）各分区保存操作有**可预期、一致**的反馈；（2）**成功**表示本页所涉配置已持久化，且用户可合理认为**后续相关功能将按本次配置生效**（与分区职责一致，见 DESIGN）；（3）**失败**须说明原因，并统一为「未保存成功」语义下的可读中文。

## 范围

### 在内

- 配置中心四分栏：**Emby 与播放器**、**码率策略**、**任务中心**（含「保存转码相关配置」「保存任务中心」及依赖的校验）、**豆瓣个人评分（实验）**。
- 与上述保存相关的 **异步** 路径（含转码工具链检验、本机写入等）的**进行中**与**完成**反馈。
- 配置页内 **「检验转码资源池」** 与 **持久化保存** 的展示区分（见 DESIGN）。

### 非目标

- 不重新定义 Emby 配置字段含义（仍以 `[DESIGN_CONFIG_AND_PATHS.md](../design/DESIGN_CONFIG_AND_PATHS.md)` 为准）。
- 不改变任务中心任务列表、调度推进、Flow 步骤等行为规格（`DESIGN_TASK_CENTER`）。
- 不强制新增自动化测试；验收以本文与 DESIGN 的手工要点为准。  
- 服务可达与壳层门禁的**非目标**以 `[REQ_FEATURE_desktop-requires-media-service.md](./REQ_FEATURE_desktop-requires-media-service.md)` 为准（本 REQ 仅约束配置保存反馈与「保存成功」语义在服务离线时不得成立）。

## 功能需求

1. **专用反馈通道（方案 A）**：引入配置专用状态（见 DESIGN），与壳层底部 `appErrorBanner` 所用全局 `error` **解耦**；**配置保存/检验（配置语义下）** 的成功与失败**不占用**该全局横幅。
2. **检验与保存分开展示**：「检验转码资源池」的结果与「保存配置」的结果**不得**长期共用同一 UI 状态导致语义混淆（独立变量或等价结构，见 DESIGN）。
3. **成功提示定时清除**：成功反馈在展示后 **数秒内自动清除**（具体时长见 DESIGN）；避免切换侧栏分区后仍显示过时成功信息。
4. **异步保存**：进行中的保存/检验操作，对应按钮 **禁用** 并展示「保存中…」等进行中态（具体文案遵守 `[DESIGN_DESKTOP_UI_COPY.md](../design/DESIGN_DESKTOP_UI_COPY.md)`）。
5. **失败原因**：持久化失败（含 `localStorage` 异常）、校验失败、非桌面环境无法检验等，均对用户给出**未保存成功**语义下的说明；句式与可读性要求与 `[DESIGN_DESKTOP_UI_COPY.md](../design/DESIGN_DESKTOP_UI_COPY.md)` 第 4.1 节一致，并可用 `formatSaveConfigFailed` 类人话改写。  
6. **媒体管理服务未可达**：与 `[REQ_FEATURE_desktop-requires-media-service.md](./REQ_FEATURE_desktop-requires-media-service.md)` 对齐：在 **non-online** 时**不得**出现保存成功反馈；若用户仍可触发保存入口，须失败提示（原因须体现须先启动或连接媒体管理服务，详见同迭代 DESIGN）。

## 验收标准

以下**全部满足**视为本需求验收通过：

1. 在配置中心各分区分别触发 **保存**：成功时出现明确成功反馈（且符合 DESIGN 的清除规则）；失败时出现失败说明（含原因）。
2. 配置保存类失败**不出现**在底部全局 `appErrorBanner`（与任务执行类、其它页错误区分）。
3. 「检验转码资源池」与「保存任务中心 / 保存转码相关配置」的结果展示**不**因共用单一 hint 状态而无法区分当前语义。
4. 异步保存路径下，进行中**不可**对同一操作重复提交（按钮禁用或等价互斥）。
5. 成功反馈在展示后按 DESIGN 自动消失，切换分区后**不**长期残留误导性成功文案。  
6. **媒体管理服务离线或未发现**：在壳层处于离线或探测中门禁时，不应出现配置保存**成功**语义；恢复在线后保存成功行为仍满足第 1～5 条。

## 追溯与关联文档


| 文档                                                                                         | 关系              |
| ------------------------------------------------------------------------------------------ | --------------- |
| `[REQ_PRODUCT_BASELINE_v1.0.0.md](./REQ_PRODUCT_BASELINE_v1.0.0.md)`                       | 母版（extends）     |
| `[DESIGN_CONFIG_CENTER_SAVE_FEEDBACK.md](../design/DESIGN_CONFIG_CENTER_SAVE_FEEDBACK.md)` | 呈现与交互 SSOT      |
| `[DESIGN_DESKTOP_UI_COPY.md](../design/DESIGN_DESKTOP_UI_COPY.md)`                         | 用户可见中文句式、禁区、术语表 |
| `[DESIGN_CONFIG_AND_PATHS.md](../design/DESIGN_CONFIG_AND_PATHS.md)`                       | 配置字段含义          |
| `[DESIGN_FRONT_PLAYBACK.md](../design/DESIGN_FRONT_PLAYBACK.md)`                           | 五页信息架构与配置页语境    |
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`                                                | 文档索引            |
| `[REQ_FEATURE_desktop-requires-media-service.md](./REQ_FEATURE_desktop-requires-media-service.md)` | 同迭代：服务可达与壳层门禁 |
| `[DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md](../design/DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md)` | 服务探测与门禁 SSOT    |
| `media-desktop/src/App.tsx`                                                                | 主要实现入口          |


