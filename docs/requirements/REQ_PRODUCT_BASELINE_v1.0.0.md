# REQ_PRODUCT_BASELINE — Emby Desktop Player v1.0.0 需求基线

> **SSOT 路径**：[`REQ_PRODUCT_BASELINE_v1.0.0.md`](./REQ_PRODUCT_BASELINE_v1.0.0.md) · 文档索引 [`DOC_GOVERNANCE.md`](../DOC_GOVERNANCE.md)

本文档是 **v1.0.0 产品范围、目标、全产品验收与术语索引** 的母版。域内细则已拆至下列文档，冲突时 **先修订至一致再改代码**（见 DOC_GOVERNANCE **SSOT 与冲突处理**）：

- 前台信息架构与播放闭环：[`DESIGN_FRONT_PLAYBACK.md`](../design/DESIGN_FRONT_PLAYBACK.md)
- 配置字段与路径映射：[`DESIGN_CONFIG_AND_PATHS.md`](../design/DESIGN_CONFIG_AND_PATHS.md)
- 媒体库、星级、豆瓣与治理动作（非 Flow 步骤级）：[`DESIGN_LIBRARY_AND_QUEUE.md`](../design/DESIGN_LIBRARY_AND_QUEUE.md)
- 任务中心、调度与 Flow：[`DESIGN_TASK_CENTER.md`](../design/DESIGN_TASK_CENTER.md)
- 外部集成（Emby / 豆瓣 / MoviePilot / MCP）：[`ARCH_INTEGRATIONS.md`](../architecture/ARCH_INTEGRATIONS.md)
- 媒体管理服务 REST：[`openapi.yaml`](../api/openapi.yaml) · [`API_README.md`](../api/API_README.md)

---

## 文档信息

- **产品名**：`Emby Desktop Player`
- **平台范围**：`Windows`（v1.0.0）
- **任务调度与任务中心交互**（状态机、Flow、危险操作）：以 [`DESIGN_TASK_CENTER.md`](../design/DESIGN_TASK_CENTER.md) 为 SSOT。
- **发版标签、用户叙事代际与开发时间线**：以 [`PRJ_MANAGEMENT.md`](../project/PRJ_MANAGEMENT.md) 为准。
- **修订过程与里程碑流水**：见 PRJ_MANAGEMENT **开发过程记录**，本文不维护长修订表。

---

## 背景与目标

### 定位

本产品是一个面向 Emby 用户的桌面应用，核心价值包含两条主线：

- **前台主线**：调用第三方播放器，提升观影体验。
- **后台主线**：媒体库质量治理，在体积与画质之间达到可控平衡。

### v1.0.0 目标

1. 保持并强化“未播放 → 第三方播放器 → 回写已播放”的前台闭环。
2. 新增媒体库管理能力，支持基于星级策略的压缩/补源治理。
3. 建立低占用后台任务体系（可托盘运行、可恢复、可重试、可审计）。
4. 明确前台与后台的职责分层，避免相互干扰。

---

## 范围

### In scope

- 五页信息架构（配置、海报墙、播放记录、媒体库、任务中心）及壳层行为。
- 配置中心、路径映射、Emby 连接与第三方播放器回写。
- 媒体库列表、筛选、星级/有效星级、码率策略与治理动作入队。
- 任务中心：删除 / 转码 / 洗版 等 Flow 的用户可执行路径（细节见 DESIGN_TASK_CENTER）。
- 与 MoviePilot、豆瓣等的外部集成 **在产品上定义的边界**（细则见 ARCH_INTEGRATIONS 与各 DESIGN 文档）。

### Out of scope

- 不做跨平台（macOS/Linux）。
- 不做播放器深度双向控制（暂停/进度回传/倍速同步）。
- 不做分布式任务集群，仅支持单机任务执行。

---

## 用户与场景

典型用户从 **配置并联通 Emby** 出发，在 **未播放海报墙** 观影并通过确认流 **回写已播放**；在 **媒体库** 中按星级与码率策略 **入队治理任务**；在 **任务中心** 执行、暂停或移除任务并处理补源确认。跨页旅程示意见 DESIGN_TASK_CENTER **§19**。

---

## 功能需求（按域索引）

### 信息架构与前台观影

顶层五页、页面职责边界、海报墙与播放记录、前台播放闭环（配置、流程、mermaid、Emby API 最小集、前台补充验收）见 [**DESIGN_FRONT_PLAYBACK**](../design/DESIGN_FRONT_PLAYBACK.md)。

### 配置与路径

配置中心字段、路径映射约定、调度类配置入口（条文索引至任务中心）见 [**DESIGN_CONFIG_AND_PATHS**](../design/DESIGN_CONFIG_AND_PATHS.md)。

### 媒体库、星级、豆瓣与治理动作

媒体库页能力、目标码率与 H265 等效、分星级推荐动作、转码/洗版/删除档与原盘规则、豆瓣与有效星级见 [**DESIGN_LIBRARY_AND_QUEUE**](../design/DESIGN_LIBRARY_AND_QUEUE.md)。

### 任务中心、调度与 Flow

任务列表、三类 Flow、调度层、并发、配置中心调度分区、验收与异常分类等 **全部** 见 [**DESIGN_TASK_CENTER**](../design/DESIGN_TASK_CENTER.md)。本文仅强调产品侧：**任务执行控制** 统一在任务中心；**信息确认** 一律弹窗；**删除** 仅经 Emby API，不得直删影片文件夹。

### 外部集成

MoviePilot 联动原则与结果处理、集成清单与边界见 [**ARCH_INTEGRATIONS**](../architecture/ARCH_INTEGRATIONS.md)。

### 工程形态（摘要）

前后端分离目标、Electron 桌面客户端（`media-desktop/`）进程与队列现状、媒体管理服务 REST 迁移策略见 [**ARCH_SYSTEM_OVERVIEW**](../architecture/ARCH_SYSTEM_OVERVIEW.md) **§6 及 §6.1**。

---

## 非功能需求

- **性能与资源**：默认低并发；观影时降载；磁盘阈值保护（见 ARCH_SYSTEM_OVERVIEW **§6.1**）。
- **可靠性**：任务可恢复、不重复破坏媒体文件；checkpoint/幂等/落盘日志等 **以正式版目标表述为准**，当前 beta 差距见下文 **工程实现快照**。
- **壳层**：关闭窗口默认托盘驻留；显式退出才终止（见 ARCH_SYSTEM_OVERVIEW **§6.1**）。

---

## 假设与依赖

- 用户自备 **Emby Server** 与网络可达性。
- **Windows** 桌面环境；第三方播放器路径由用户配置。
- **MoviePilot / 豆瓣** 等外部系统可用性受第三方约束；应用需降级提示（见 ARCH_INTEGRATIONS）。

---

## 验收标准（v1.0.0）

1. 用户可在**顶层五页**（配置、海报墙、播放记录、媒体库、任务中心）完成「观影 + 治理」闭环；补源确认走任务中心弹窗，**不依赖**独立质量审阅顶页。
2. 星级策略可正确驱动删除、压缩、补源三类动作。
3. 高码率压缩任务可稳定执行并完成验收替换。
4. 低码率补源可执行搜索、估算、筛选与入队。
5. 无达标补源时任务进入 `waiting_media_source`，并可自动/手动再触发。
6. 任务支持 **自动/手动执行模式**、单条与批量**执行/暂停**（含占槽软停语义），双队列并发可配置。
7. 关闭窗口默认最小化到托盘，不中断后台进程。
8. 显式退出后，任务状态可恢复，且不重复下发、不污染媒体文件。

**前台闭环补充检查项**见 DESIGN_FRONT_PLAYBACK **§3.8**。

---

## 术语表（摘要）

| 术语 | 含义 |
|------|------|
| **有效星级** | 豆瓣匹配星级优先，否则用户标注星级；驱动目标码率与推荐动作（见 DESIGN_LIBRARY_AND_QUEUE）。 |
| **删除档** | 1★～2★；不参与转码/洗版码率治理，对应 `delete` Flow。 |
| **原盘类** | ISO 或 BDMV 结构；禁止 `transcode` 入队，允许 `upgrade`（见 DESIGN_LIBRARY_AND_QUEUE **§4.0**）。 |
| **任务 / Flow / 调度层** | 定义见 DESIGN_TASK_CENTER **§1～§2**。 |

---

## 工程实现快照（beta）

### 与正式版目标的关系

各 `v1.0.0-beta.*` **附注标签**、用户叙事 **v0.x** 及开发时间线仅在 [**PRJ_MANAGEMENT**](../project/PRJ_MANAGEMENT.md) 维护。本节为 **截至 `package.json` `1.0.0-beta.9`** 的可核对实现边界摘要；若与 DESIGN_TASK_CENTER 冲突，**以 DESIGN_TASK_CENTER 为行为规格**。

- **`delete`**：主进程经 Emby HTTP 完成预检、`DELETE` 媒体、验收；可选 `embyUserPassword`（DESIGN_TASK_CENTER **§2.3.5**）。
- **`transcode`**：`PlaybackInfo` + 路径映射；`transcodeTempRoot` 下任务隔离；FFmpeg/ffprobe 子进程在 `main`；编码资源池与 DESIGN_TASK_CENTER **§5.1** 系一致；替换语义含 `.etp.new`/`.etp.bak`；驱动以渲染进程分阶段调用 IPC 为主。
- **`upgrade`**：队列与界面存在；**真实**搜种、下载、媒体替换主路径与 MoviePilot **未**完整接入。
- **横切**：`flowLog` 在 UI 侧；**无**系统级落盘审计日志与全链路 checkpoint 恢复；托盘/观影降载/显式退出恢复 **未**完整达到目标态。
- **媒体管理服务 REST**：对外 HTTP 形状以 **openapi.yaml** 为准；**当前发版**业务仍以 IPC/主进程摘要为准，迁移见 ARCH_SYSTEM_OVERVIEW **§6**。

### 相对 v1.0.0 仍突出的差距

洗版与补源闭环、MoviePilot（或等价）集成、托盘与后台可靠性、主进程持久化队列、checkpoint 与幂等落盘、批量执行前粗估等——与上文 **验收标准**、PRJ 功能表对表仍部分未闭合。

---

## 版本结论

`v1.0.0` 正式版定义为：

- 前台观影体验稳定可用；
- 后台媒体治理能力可持续运行；
- 在托盘、恢复、重试、补源刷新等关键机制上具备工程可行性与用户可控性。

---

## 追溯与关联文档

| 文档 | 关系 |
|------|------|
| [`DOC_GOVERNANCE.md`](../DOC_GOVERNANCE.md) | 全库索引与命名 |
| [`DESIGN_FRONT_PLAYBACK.md`](../design/DESIGN_FRONT_PLAYBACK.md) | 五页架构与前台闭环 |
| [`DESIGN_CONFIG_AND_PATHS.md`](../design/DESIGN_CONFIG_AND_PATHS.md) | 配置与路径 |
| [`DESIGN_LIBRARY_AND_QUEUE.md`](../design/DESIGN_LIBRARY_AND_QUEUE.md) | 媒体库与豆瓣 |
| [`DESIGN_TASK_CENTER.md`](../design/DESIGN_TASK_CENTER.md) | 任务中心 SSOT |
| [`ARCH_INTEGRATIONS.md`](../architecture/ARCH_INTEGRATIONS.md) | 外部集成 |
| [`ARCH_SYSTEM_OVERVIEW.md`](../architecture/ARCH_SYSTEM_OVERVIEW.md) | 系统架构与 `media-desktop` 现状 |
| [`ARCH_DEPLOYMENT.md`](../architecture/ARCH_DEPLOYMENT.md) | 部署 |
| [`openapi.yaml`](../api/openapi.yaml) / [`API_README.md`](../api/API_README.md) | REST |
| [`PRJ_MANAGEMENT.md`](../project/PRJ_MANAGEMENT.md) | 版本与时间线 |
| [`REQ_FEATURE_<topic>.md`](./REQ_FEATURE_transcode-backup-and-temp-cleanup.md)（示例） | 专题需求（增量） |
