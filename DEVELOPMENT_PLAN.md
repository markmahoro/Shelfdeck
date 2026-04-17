# Emby Desktop Player — 开发计划

> **文档性质**：基于当前仓库实现、`DEVELOPMENT_PROGRESS.md`、`EmbyDesktopPlayer_PRD_v1.0.0_modules.md` 与 `TASK_CENTER_FULL_LOGIC.md` 整理的阶段性开发路线。  
> **生成日期**：2026-04-18（+08:00）；**当前里程碑**：`v1.0.0-beta.8`（删除任务 Flow、Emby 真删、用户访问令牌鉴权）

---

## 1. 项目概况

**Emby Desktop Player** 目标是在 Windows 上提供：

- **前台**：未播放 → 第三方播放器 → 回写已播放的闭环。
- **后台**：按星级策略的媒体库治理（转码 / 补源）与可恢复、可审计的任务调度。

当前 `**mvp/`** 已具备与 PRD / SSOT 对齐的 **五页壳层**、**任务中心调度 MVP（模拟）**、**配置与媒体策略 UI**、**真实 Emby REST（`embyService` + `preload` IPC）** 与 **豆瓣 collect 抓取（`doubanService` + `doubanApi`）**。**FFmpeg、MoviePilot、托盘与主进程 worker** 仍以占位或规划为主。

---

## 2. 已实现（可在代码中对照验证）


| 领域                   | 内容                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **文档**               | PRD v1.0.0（五页架构、配置集中、任务中心专责调度）；任务中心以 `TASK_CENTER_FULL_LOGIC.md` 为 SSOT；`DEVELOPMENT_PROGRESS.md` 记录里程碑与时间线。                    |
| **壳层与导航**            | 顶栏五页：配置中心、海报墙、媒体库管理、任务中心、播放记录；每页左侧栏 + 右侧主区；暗色主题与基础样式（`mvp/src/App.tsx`、`mvp/src/styles.css`）。                                   |
| **任务中心（前端逻辑）**       | 本地持久化队列（`mvp/src/taskQueue.ts`）、状态筛选；**删除（`delete`）Flow** 已与 Emby 真删对齐（`v1.0.0-beta.8`，含 `flowLog`、手动模式调度修复）；转码/洗版仍为 **双队列** 模拟与并发上限；SSOT **三类型 / 三队列**。调度推进与软停（`pauseRequested`）、单条/批量执行与暂停、信息确认弹窗、调试种子任务（`mvp/src/debugSeed.ts`）等。 |
| **配置中心**             | Emby 连接/播放器相关表单；媒体策略与任务调度（并发、等待重试节奏、`wallRatingAutoEnqueue` 等）集中在配置页。                                                           |
| **媒体治理（前端侧）**        | `mvp/src/mediaManager.ts`：等效码率估算、`targetBitrateFor`（含 5★1080p→4K 档）、`isDeleteTierRating`（1–2★删除档）、`recommendedAction`（§4.5：3★仅压、4★压+80% 洗版、5★不压与洗版规则）、`predictedSizeGbAtPolicyTarget`；默认梯度见 PRD §4.2。 |
| **工程**               | Electron + React（Vite）可开发构建；`mvp/electron/main.js` 负责窗口、开发期连 Vite、生产加载 `dist`；`mvp/package.json` 含 Windows portable 构建脚本。       |
| **Electron 预加载**       | `mvp/electron/preload.js` 暴露 `window.embyApi`（真实 IPC 至 `embyService`）与 `window.doubanApi`（会话与抓取进度）；无 Electron 时浏览器可走 `mvp/src/devEmbyStub.ts`。`taskControl` 仍以主进程占位为主。 |
| **豆瓣个人评分（实验）**    | `doubanService.js` 拉取 collect 分页；`doubanUtils.ts` / `mediaManager.effectiveRatingForPolicy`；配置页与媒体库列表 UI。详见 PRD §4.4。                                        |


---

## 3. 未实现或仅占位（相对 PRD 正式版）


| 领域                           | 说明                                                                    |
| ---------------------------- | --------------------------------------------------------------------- |
| **真实后台执行**                   | FFmpeg 转码、临时文件与原子替换、MoviePilot 搜索与候选排序等未接入；任务生命周期在渲染进程内模拟推进。          |
| **进程分层（PRD §8）**             | 设计为 main 调度中枢 + worker 执行；当前无独立 worker，调度核心在 `taskScheduler.ts`（渲染层）。 |
| **豆瓣抓取稳定性**               | 依赖豆瓣网页结构；账号隐私、风控、Cookie 过期等需用户自行处理；剧集等非电影 collect 不在范围内。 |
| **托盘与窗口策略（PRD §8.3）**        | 无托盘；`window-all-closed` 在非 macOS 上直接退出，与「关窗最小化到托盘」不一致。                |
| **中断恢复与 checkpoint（PRD §9）** | 文档已定义，完整实现待迭代。                                                        |
| **批量执行前预估（PRD §7.4）**        | 耗时、磁盘、负载提示未产品化。                                                       |
| **任务日志**                     | 删除 Flow 已持久化 **`flowLog`** 并 UI 展示；其它类型完整采集与检索为后续。                                                |
| **观影时自动降载**                  | 观影活跃时降低/暂停高负载任务未做。                                                    |


---

## 4. 下一步开发计划（按依赖与风险排序）

### 阶段 A — 主进程与真实 Emby（打通前台闭环）

> **现状**：`embyService.js` + `preload` 已在 beta.4+ 打通核心 REST与播放回写；下列条目保留为路线图核对项。

1. 持续维护主进程 Emby REST：连接探测、用户/媒体库、未播放与已播放列表、路径解析、`markPlayed` / `markUnplayed` 及版本差异兼容。
2. 扩展 `preload.js`：将现有桩替换为 IPC 桥接到主进程；保留可选「调试桩」开关便于无服务器开发。
3. 实现真实 `launchPlayer`：路径映射、参数拼装、启动外部播放器、会话时长与阈值判断（与配置中 `markPlayedThresholdPercent` 等对齐）。

### 阶段 B — 后台任务真执行（最小可用）

1. 引入 worker 或主进程子任务：FFmpeg 转码完整链路（预检 → 执行 → 校验 → 失败重试语义），输出与原子替换按 PRD §5 分步落地。
2. MoviePilot：HTTP 客户端与配置项；先做「搜索 → 候选列表 → 人工/半自动确认」，再完善排序与自动化。
3. 将任务调度与队列状态逐步迁到 main（或 main 单例 + IPC），渲染层仅展示与下发控制指令。

### 阶段 C — 体验与可靠性（正式版必备）

1. **托盘**：关窗最小化、托盘菜单（显示窗口 / 开始批量执行 / 暂停队列 / 退出应用）。
2. **checkpoint 与中断恢复**：与真实执行步骤绑定，持久化到磁盘。
3. **批量执行前预估**：基于队列、历史转码速度、磁盘可用空间、并发配置的粗估 UI。
4. **任务日志**：结构化落盘 + 任务中心内可检索（可分步：先文件日志，再 UI）。
5. **渲染进程缓存 →主进程持久化**：当前大量状态在渲染层 `localStorage`（如 `App.tsx` 中的 Emby 配置、媒体库列表缓存、豆瓣评分条目、任务队列 `taskQueue.ts`、本地已标记播放等）。开发期 Vite 端口变化会导致 **origin 切换、`localStorage` 看似「清空」**；生产与调试环境也不易共用同一套数据。后续应分批迁移：**主进程 `userData` 落盘（JSON或 `electron-store` 等）+ `preload` IPC读写**，渲染层仅缓存与 UI 强相关的临时状态；迁移时需定义版本号与一次性从 `localStorage` 导入的升级路径。

### 并行维护

- 每完成一个可演示里程碑，更新 `DEVELOPMENT_PROGRESS.md` 时间线与「已完成 / 未闭合」边界。
- 以当前 `release/v1.0.0` / `master` 合并结果为迭代基线。

---

## 5. 后续可选方向（可实现 Idea）

>下列条目**不纳入当前 MVP 排期**，仅作技术调研结论的落盘，供后续里程碑评审。

### Idea：应用内播放 — mpv / libmpv 集成

- **背景**：当前路线为「海报墙 → 唤起第三方播放器 → 回写已播放」。部分用户诉求为 madVR、LAV、HD 音频直通等；纯 Web/Electron 内置 `<video>` 无法承接 madVR（DirectShow）。另一路线为 Windows 原生层自组 DirectShow 图（LAV + madVR），工程量与维护成本显著高于 MVP。
- **方案概要**：在 Windows 上以 **mpv / libmpv**作为应用内播放内核（与当前官方 Emby Windows 客户端公开的 **MPV** 路线同类）。音频可通过 **WASAPI 独占 + `audio-spdif`** 等实现直通（具体格式依赖声卡/AVR/驱动，需矩阵测试）；画质依赖 mpv（如 `gpu-next`、HDR 策略等），**不承诺**与 PotPlayer + LAV + madVR 逐像素等价。
- **可行性（调研摘要）**：项目若整体 **开源**，与 **GPLv2+** 的 mpv 栈易对齐；集成难度 **中等**（窗口嵌入、生命周期、选项桥接、片源/设备测试）。可参考 GitHub 上既有 mpv 前端及 libmpv 嵌入实践。
- **与 Emby 客户端关系**：在「播放引擎选型」上与现版 Emby for Windows **同属 mpv 派系**；完整产品能力（串流、转码、账户、下载等）仍可差异很大。
- **状态**：**暂不实施**，纳入 Idea 池；若启动需单独立项（范围、测试矩阵、与外部播放器配置的共存策略）。

---

## 6. 参考文件


| 文件                                | 用途             |
| --------------------------------- | -------------- |
| `DEVELOPMENT_PROGRESS.md`         | 仓库进度与时间线 SSOT  |
| `EmbyDesktopPlayer_PRD_v1.0.0_modules.md` | 产品能力定义（按模块编排；附录含原 MVP 基线） |
| `TASK_CENTER_FULL_LOGIC.md`       | 任务中心与调度逻辑 SSOT（含 **§2.3** 删除 Flow：仅 Emby、确认停泊、验收 404） |
| `mvp/`                            | 可运行 MVP 工程     |
