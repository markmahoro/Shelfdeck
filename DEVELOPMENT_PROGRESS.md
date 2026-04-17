# Emby Desktop Player — 开发进度总结

> **文档性质**：与仓库实现、PRD（`EmbyDesktopPlayer_PRD_v1.0.0.md`）及任务中心 SSOT（`TASK_CENTER_FULL_LOGIC.md`）对照的阶段性记录。  
> **最近更新**：2026-04-18（+08:00）；**标签 `v1.0.0-beta.8`**：**删除任务 Flow** 端到端（任务中心 +媒体库入队、Emby 真删、`flowLog`）；**`DELETE /Items/{id}`** 需用户 **`AccessToken`** 时通过配置 **`embyUserPassword`** + **`Users/AuthenticateByName`** 换取令牌；`embyService` IPC与 PRD **§7.3.1** / §14.8 对齐。其前 **`v1.0.0-beta.7`**：分星级治理、预测体积、PRD §4.5。再前 **`v1.0.0-beta.6`**：豆瓣与有效星级；**`beta.5`**：媒体库治理、原盘、列表缓存。  
> **主工作副本（Canonical）**：`E:\my_project\emby_third_party`（请将 Cursor / 终端默认目录统一到此路径；`C:\emby_third_party` 仅为迁移前副本，可归档或删除以避免混淆。）

---

## 时间线（仓库提交与里程碑）


| 时间点（UTC+8）              | 事件                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2026-04-17 16:05:44** | 仓库基线初始化（`chore: initialize repository baseline`）                                                                                                                                                                                                                                                            |
| **2026-04-17 20:30:03** | 补充任务中心单一事实来源文档（`docs: add task center SSOT`，`TASK_CENTER_FULL_LOGIC.md`）                                                                                                                                                                                                                                    |
| **2026-04-17 20:46:30** | 开发中版本快照：PRD 对齐 SSOT、五页壳层、任务调度 MVP 等（`chore: dev snapshot — PRD对齐任务中心SSOT、五页壳与调度MVP`，提交 `cfa6884`）                                                                                                                                                                                                           |
| **2026-04-17 ~21:12**   | **合并**：将 `C:\emby_third_party` 上 `release/v1.0.0` 的提交与 `E:\my_project\emby_third_party` 的 `master`（含 beta.3 等历史）做 `allow-unrelated-histories` 合并；冲突在 `mvp/` 与今日分支对齐；提交 `176a599`。本地分支 `release/v1.0.0` 已与 `master` 同指向该合并结果。                                                                                |
| **2026-04-17（晚间）**      | `**v1.0.0-beta.4`**：主进程 `embyService`打通 Emby REST（联通、库、未播放/已播放、PlaybackInfo、PotPlayer 启动）；预加载改为 IPC；播放记录页海报与筛选、列表拉取与合并逻辑修复；`markPlayed` 按官方文档使用查询参数 `DatePlayed=yyyyMMddHHmmss`；Vite 开发端口与 `wait-on` 对齐，插件写入实际 dev URL 以支持端口顺延。                                                                             |
| **2026-04-17（深夜）**      | `**v1.0.0-beta.5`**（`d6bf834`）：媒体库管理全库列表（含已观看）、侧栏搜索与多维筛选（码率相对目标、分辨率、编码、观看记录、蓝光原盘）、库容量与类型统计；表格行组件与性能优化；条目展示**体积（GB）**与**原盘**标记；主进程 `inferIsBluRayDisc`（`.iso`、路径 `BDMV`、本机 `BDMV` 目录探测，并应用配置中心 pathMapFrom/To与增强版 `applyPathMap`）；原盘条目禁止码率压缩/洗版**单条/批量/海报自动入队**；`devEmbyStub` 与类型定义同步；`DEVELOPMENT_PLAN` 更新。 |
| **2026-04-17（深夜）**      | **媒体库列表本地缓存**：`localStorage` 键 `embyDesktopPlayerLibraryManageCacheV1`（`version: 1` + `fingerprint` + `savedAt` + `items`）；指纹为规范化 `baseUrl`、`userId`、已勾选 `enabledSectionIds` 排序序列化，任一变化则丢弃旧缓存；启动与进入媒体库管理页仅从缓存恢复，**不自动**请求 Emby；「刷新媒体库列表」成功后再写入缓存并更新 `savedAt`。观看状态回写等路径上仍会按需静默刷新列表（`quietIfIncomplete`）。    |
| **2026-04-17（收尾）**      | `**v1.0.0-beta.6`**：豆瓣 `movie.douban.com/people/{id}/collect`（`type=movie`、`mode=grid`）分页抓取，解析 `comment-item` / `ratingN-t` / `subjectId`；**增量**（整页 subjectId 均在同步前缓存中则停）与约 **14 天**一次**全量**（`embyDesktopPlayerDoubanLastFullSyncAtMs`）；页间隔 ~800ms；会话 `douban-session.json`，条目缓存 `embyDesktopPlayerDoubanRatingEntriesV1`。`doubanUtils`：豆瓣按 `/` 分段键、Emby 按冒号/竖线拆段、最长键优先匹配；仅 **Movie**。`effectiveRatingForPolicy`：**豆瓣星优先**于本地标注星级，驱动 `targetBitrate` / `recommendedAction` / 筛选。UI：配置中心豆瓣分区（可选 Cookie 折叠）、媒体库表豆瓣列与有效星级；根目录 `douban-to-imdb/` 已 `.gitignore`（独立仓库）。 |
| **2026-04-18**              | `**v1.0.0-beta.7`**：`mediaManager` — `isDeleteTierRating`（1–2★ 删除档）、`UPGRADE_EQ_BELOW_TARGET_RATIO`、`recommendedAction` 分星规则、`targetBitrateFor`（5★1080p→4K 档）、`predictedSizeGbAtPolicyTarget`；默认 `defaultMediaPolicy` 梯度下调。UI：`MediaLibraryManageRow` 预测体积列、`App` 侧栏电影预测占用与筛选「删除档（1–2 星）」。PRD v1.0.0 **§4.1～§4.5**、§14.7；`mvp/package.json` **version** 同步 **1.0.0-beta.7**。 |
| **2026-04-18**              | `**v1.0.0-beta.8`**：**删除 Flow** 落地 — `taskQueue`/`taskScheduler`/`App.tsx`（预检、`awaiting_user_confirm`、`executing`、`verify`、`flowLog`）、`MediaLibraryManageRow` 与 `mediaManager.buildTaskPreview` 入队；`embyService`：`getLibraryItem`、`getItemDeleteInfo`、`authenticateEmbyUserAccessToken`、`deleteLibraryItem`、`libraryItemExists` 与 IPC；配置 **`embyUserPassword`**（可选）解决 API Key 下删除 `Parameter 'user' null`。PRD v1.0.0 **§7.3.1**、§14.8；`EmbyDesktopPlayer_PRD.md` §6.5；`mvp/package.json` **1.0.0-beta.8**。 |


*说明：更早的 beta.1～beta.3 能力见 PRD §14；本表仅列本仓库近期可追溯的 Git 时间点。*

---

## 当前已完成（相对 v1.0.0 目标）

### 产品与文档

- PRD 已刷新：五页信息架构、配置中心承载调度参数、任务中心专责调度操作；独立「质量审阅」顶页废弃，补源确认走弹窗。
- 任务中心行为与 `**TASK_CENTER_FULL_LOGIC.md`** 对表（执行/暂停、软停、批量操作、侧栏按钮语义等）。**§2.3** 删除 Flow（仅 Emby、自动模式仍须确认、`verify` 以条目不存在为准）已定稿，**已于 `v1.0.0-beta.8` 实现**（含用户令牌鉴权策略，见 PRD §7.3.1）。

### 前端 MVP（`mvp/`）

- **壳层**：顶栏五页导航 + 各页左侧侧栏 + 右侧主区；暗色主题与基础样式。
- **任务中心**：本地持久化队列、状态筛选；**删除（`delete`）** 与 Emby 真删及 **`flowLog`**（`v1.0.0-beta.8`）；转码/洗版 **双队列**调度模拟（SSOT **三类型 / 三队列**）、`pauseRequested` 软停、单条与批量执行/暂停、信息确认弹窗、调试种子任务等。
- **配置**：媒体策略与任务调度相关表单向配置中心集中。
- **真实 Emby 与播放（beta.4）**：`electron/embyService.js` 实现 REST；海报墙拉取未播放、PlaybackInfo 解析路径、路径映射与参数模板启动第三方播放器；`markPlayed` / `markUnplayed` 与服务器同步。
- **播放记录页（beta.4）**：已播放列表（多库合并、时间窗与类型筛选、海报行、与本地已确认记录合并）；修复误用 `sectionId` 二次过滤与缺日期元数据导致列表为空的问题。
- **媒体库管理页（beta.5）**：`getLibraryItemsForManage` 拉取已启用库内电影/剧集（含已看）；侧栏片名搜索、定位首条高亮；筛选含**蓝光原盘**；列表列含体积、原盘、星级、观看、任务与单条操作；`MediaLibraryManageRow` 独立组件；原盘（ISO/BDMV，映射后本机探测）**拦截**转码/洗版入队；批量入队跳过原盘并提示；海报墙打分自动入队对原盘友好提示。
- **媒体库列表缓存**：全量列表持久化到 `localStorage`（`embyDesktopPlayerLibraryManageCacheV1`），与连接指纹绑定；进入管理页不自动拉取，依赖用户手动「刷新媒体库列表」与 Emby 对齐；配置变更时自动重hydrate（无效指纹则清空展示）。
- **豆瓣个人评分（beta.6）**：主进程 `doubanService.js` + IPC；渲染进程匹配与缓存；策略层 `effectiveRatingForPolicy`；详见 PRD v1.0.0 **§4.4**。
- **分星级治理与容量预测（beta.7）**：`mediaManager` 删除档、转码/洗版分星规则、5★1080p 的 4K 目标对齐、电影预测体积与侧栏汇总；详见 PRD **§4.5**、§14.7。
- **删除任务 Flow（beta.8）**：任务中心 + 媒体库入队；`embyService` 删除与验收；配置 **`embyUserPassword`** + **`AuthenticateByName`**；详见 PRD **§7.3.1**、§14.8。
- **开发体验**：Vite 默认端口5174、`strictPort: false` 顺延端口；`write-dev-server-url` + `scripts/run-electron-dev.js` 将实际 URL 注入 Electron。

### 工程

- Electron + React（Vite）工程可构建；Electron 主进程/预加载等已纳入版本控制（以该快照为准）。

---

## 进行中 / 未闭合（相对 PRD 正式版）

- **真实后台执行**：FFmpeg 转码、MoviePilot 联动、主进程调度与 worker 等仍以 PRD 目标描述为主，当前多为占位或模拟。
- **托盘、中断恢复、checkpoint**：PRD 已定义，完整实现待后续迭代对齐。
- **批量执行前耗时/磁盘/负载预估**：PRD 目标能力，尚未产品化。

---

## 版本与分支参考

- **里程碑标签**：`v1.0.0-beta.8`（删除 Flow + Emby 真删 + 用户令牌鉴权）；其前 `v1.0.0-beta.7`（分星级治理 + 预测体积 + PRD §4.5）；再前 `v1.0.0-beta.6`（豆瓣 + 有效星级）；再前 `v1.0.0-beta.5`（媒体库治理 + 原盘 + 列表缓存）；再前 `v1.0.0-beta.4`（真实 Emby 前台闭环 + 播放记录 + 回写格式修复）
- **分支**：`master`（可与 `release/v1.0.0` 对齐）
- **此前合并提交**：`176a599`（2026-04-17）

---

## 后续建议（可选）

- 在 `cfa6884` 上打轻量标签（例如 `v1.0.0-dev.20260417`）便于对外指代「开发中构建」。
- 每完成一个可演示里程碑时更新本文件「时间线」一节，并修订「已完成 / 未闭合」边界。