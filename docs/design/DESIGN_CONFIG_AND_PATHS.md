# DESIGN_CONFIG_AND_PATHS — 配置中心、字段与路径映射

> **SSOT 路径**：`[DESIGN_CONFIG_AND_PATHS.md](./DESIGN_CONFIG_AND_PATHS.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

本文档描述 **配置中心** 的职责边界、**持久化字段**（与实现命名一致）及 **路径映射** 约定。任务调度、并发、执行模式等 **调度类** 配置条文以 `[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)` **第 7 节** 为 SSOT；战略级「路径/配置权威在后端」见 `[ARCH_SYSTEM_OVERVIEW.md](../architecture/ARCH_SYSTEM_OVERVIEW.md)`。

---

## 范围与引用

- **In scope**：连接 Emby、第三方播放器、路径映射、回写阈值、与前台相关的必填项；配置中心内 **任务调度与补源** 分区中 **字段级** 说明（调度语义见 DESIGN_TASK_CENTER）。
- **Out of scope**：各 `actionType` Flow 步骤、状态机、删除/转码 HTTP 细节（见 DESIGN_TASK_CENTER）；OpenAPI 形状（见 `[openapi.yaml](../api/openapi.yaml)`）。

---

## 配置中心在顶层架构中的定义

1. **配置中心（Config）**：连接与播放器、**任务调度与补源**（执行模式、**删除/转码/洗版多队列**并发、补源重试节奏、海报墙打分自动入队等）及其他配置分区。

---

## 前台与治理相关配置字段

与 `[DESIGN_FRONT_PLAYBACK.md](./DESIGN_FRONT_PLAYBACK.md)` 中「配置项」交叉对照；实现须使用相同字段名。

- `baseUrl`、`apiKey`、`userId`（来自用户选择）、`embyUserPassword`（可选；删除等写操作鉴权见 `[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)` **§2.3.5**）
- `enabledSectionIds`、`playerExePath`、`argsTemplate`（支持 `{path}`、`{itemId}`）
- `pathMapFrom` / `pathMapTo`
- `markPlayedThresholdPercent`（默认 90）、`fallbackMinSeconds`

---

## 路径映射（产品约定）

- **Playback / 预检 / 转码** 使用的 **本机可读路径** 均经 `pathMapFrom` → `pathMapTo` 解析；映射 **权威** 以控制面持久化配置为 SSOT（见 ARCH_SYSTEM_OVERVIEW **§3.4**）；Electron 设置页仅展示与编辑并经 API 写回。
- **媒体库列表** 刷新时结合映射解析本机路径，用于原盘类（ISO/BDMV）判定；判定规则与任务中心互斥见 DESIGN_TASK_CENTER **§3.7.3**。

---

## 任务调度与补源类配置（索引）

- 执行模式、删除/转码/洗版并发、`wallRatingAutoEnqueue`、补源重试节奏等由 **配置中心 → 任务调度与补源** 维护；条文见 `[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)` **§6**。
- 需求母版中的产品范围与验收见 `[REQ_PRODUCT_BASELINE_v1.0.0.md](../requirements/REQ_PRODUCT_BASELINE_v1.0.0.md)`。

---

## 追溯与关联文档


| 文档                                                                                 | 关系           |
| ---------------------------------------------------------------------------------- | ------------ |
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`                                        | 全库索引         |
| `[REQ_PRODUCT_BASELINE_v1.0.0.md](../requirements/REQ_PRODUCT_BASELINE_v1.0.0.md)` | 需求母版         |
| `[DESIGN_FRONT_PLAYBACK.md](./DESIGN_FRONT_PLAYBACK.md)`                           | 前台配置与回写闭环    |
| `[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)`                                 | 调度与任务中心 SSOT |
| `[ARCH_SYSTEM_OVERVIEW.md](../architecture/ARCH_SYSTEM_OVERVIEW.md)`               | 路径/配置战略分工    |
| `[openapi.yaml](../api/openapi.yaml)` / `[API_README.md](../api/API_README.md)`    | REST 契约与说明   |
