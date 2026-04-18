# 版本变更记录

本文档汇总 **每个已打标签版本** 相对上一版的关键改动，便于发布说明与回归对照。  
版本号与 `mvp/package.json` 的 `version`、Git 附注标签 `v*` 对齐。

---

## 维护约定（给后续版本）

发布新版本时建议同步完成：

1. 更新 `mvp/package.json` 中的 `version`。
2. 执行 `git tag -a v<版本号> -m "…"` 打附注标签。
3. 在本文件顶部（或按时间倒序）追加一节 **「v…」**，用条列写清：**用户可见行为**、**集成/风险**、**已知限制**（如有）。

---

## 文档与规范（未绑定发版标签）

**日期：** 2026-04-17

- 新增 `**TASK_CENTER_FULL_LOGIC.md`**：任务中心端到端逻辑 **SSOT**（调度与 Flow 边界、状态/停泊/槽位、转码与补源双队列、配置中心项、三种添加入口与同视频互斥、用户操作 **执行/暂停** 定稿、移除概要、任务中心 UI、前后端职责、Flow 协作与 MVP 迁移提示）。引入该文件的提交可通过 `git log --follow -1 -- TASK_CENTER_FULL_LOGIC.md` 查看。

**日期：** 2026-04-18

- **产品 PRD 单一来源**：仓库内正式条文仅保留 **`EmbyDesktopPlayer_PRD_v1.0.0_modules.md`**（按模块 A–G 编排；附录 A 为完整修订历史）。原线性版 `EmbyDesktopPlayer_PRD_v1.0.0.md`、结构化副本、模块梳理稿等请置于本地 **`archive/`**（已加入 `.gitignore`，不入库）；`scripts/build_prd_modules_md.py` / `build_structured_prd.py` 从 `archive/EmbyDesktopPlayer_PRD_v1.0.0.md` 再生辅助稿（需本地归档文件）。
- 更新 `**TASK_CENTER_FULL_LOGIC.md`**：定稿 **三种任务类型 / 三条 Flow**（`delete`、`transcode`、`upgrade`）；**多逻辑队列** 与 `**deleteConcurrency` 等**配置约定；**Flow 可扩展与隔离**（§2.1–§2.2）；澄清 §7.3「从任务中心移除任务」与 **删除类 Flow** 的用语。`**EmbyDesktopPlayer_PRD_v1.0.0_modules.md`**、`**DEVELOPMENT_PLAN.md**` 已与之对齐。
- `**TASK_CENTER_FULL_LOGIC.md` §2.3**（及 PRD §7.1、§7.3.1）：**删除 Flow**——仅 **Emby** 删除；**自动模式不得跳过** `awaiting_user_confirm`；未确认则 **长期**停泊该状态；`**verify` 仅以条目不存在（如 404）** 为准。
- **文档分工（2026-04-18）**：**`transcode` Flow 技术实现**（含 DV、编码器/资源池、临时目录与 replace、异常 A1～F3 等）以 **`TASK_CENTER_FULL_LOGIC.md` §2.4、§17** 为 **SSOT**；**`DEVELOPMENT_PLAN.md`** 仅保留 **项目管理**（阶段、里程碑、参考索引），**不**承载上述实现细则。
- **PRD 模块 F 合并（2026-04-18）**：原 **`EmbyDesktopPlayer_PRD_v1.0.0_modules.md` 模块 F** 可执行条文 **全部迁入** `TASK_CENTER_FULL_LOGIC.md`（含 **§2.5.6**、**§19** mermaid、**§20** 文档维护）；PRD **§7** 仅 **摘要与索引**；删除鉴权引用统一为 SSOT **§2.3.5**。仓库打附注标签 **`v1.0.0-docs.20260418`** 标记该文档里程碑（对应提交短哈希：`git log -1 --format=%h v1.0.0-docs.20260418`）。

---

## v1.0.0-beta.8

**标签：** `v1.0.0-beta.8`  
**日期：** 2026-04-18（+08:00）

### 用户可见

- **删除任务 Flow**：可从媒体库入队，在任务中心完成预检、删除前确认、Emby 删除与 **404 验收**；任务卡片展示 **执行日志（`flowLog`）**。
- **配置**：**所选用户登录密码**（可选）— 用于删除前 `**AuthenticateByName`** 换取用户 **AccessToken**；解决仅用 API Key 时删除接口 `**Parameter 'user' null`** 的问题。

### 技术与集成

- `**mvp/electron/embyService.js**`：`authenticateEmbyUserAccessToken`、`deleteLibraryItem`、`getLibraryItem`、`getItemDeleteInfo`、`libraryItemExists`；`EmbyConfig.embyUserPassword` 经 IPC 传入。
- **前端**：`App.tsx` 删除 Flow 与手动调度；`MediaLibraryManageRow` / `mediaManager` 删除入队；`taskQueue` / `taskScheduler` 删除并发与状态机。

### 文档

- `EmbyDesktopPlayer_PRD_v1.0.0_modules.md` §7.3.1、§11（小节 14.8）；`DEVELOPMENT_PROGRESS.md`；`DEVELOPMENT_PLAN.md`（项目管理）；`TASK_CENTER_FULL_LOGIC.md`（SSOT，含 §2.4 转码）。

### 已知限制

- 密码与 API Key 同为本地明文存储；后台 FFmpeg / MoviePilot 仍为模拟或占位。

---

## v1.0.0-beta.3

**标签：** `v1.0.0-beta.3`  
**提交：** `371779b`  
**日期：** 2026-04-17（以提交时间为准）

### 用户可见

- **播放记录**：可稳定拉取已播放条目；支持按时间范围、类型、已启用媒体库筛选。
- **播放记录行操作**：「标记为已观看」「标记为未观看」「重新播放」；与 Emby 的已播放状态同步。
- **标记已看完（海报墙）**：回写成功后刷新播放记录逻辑，并与本机记录合并，避免列表被空结果覆盖。
- **V1 窗口与导航**：应用最大化、隐藏菜单栏；海报墙键盘操作；配置与海报墙、播放记录页面切换。

### 技术与集成

- **主进程 `getPlayedItems`**：使用 `Filters: IsPlayed`；请求 `UserData` 以解析 `LastPlayedDate` 等播放时间；按库优先走 `/Sections/{id}/Items`，404 时回退到带 `ParentId` 的 `/Items`；去掉易误判空的 `MinDateLastSaved` 服务端过滤，改为客户端按 `DatePlayed` 过滤（无日期的条目在时间筛选下仍保留）。
- **本机兜底**：`localStorage` 中保存本应用内「确认已播放」的条目，与服务器列表合并；标记未观看时移除对应本地条目。
- **新 IPC**：`markUnplayed`（`DELETE .../PlayedItems/{itemId}`）。

### 文档

- 当时以独立文件 `EmbyDesktopPlayer_PRD.md` 增补与 V1 范围相关说明；该内容已反映在现行模块化 PRD 附录（见 `EmbyDesktopPlayer_PRD_v1.0.0_modules.md`）。

---

## v1.0.0-beta.2

**标签：** `v1.0.0-beta.2`  
**提交：** `78f9231`  
**日期：** 2026-04-17

### 用户可见

- 配置页对部分 **高级 MVP 字段** 做隐藏/收敛，降低误操作面。

### 技术与集成

- **打包与生产环境启动**：加固打包后渲染进程加载（如 `vite` 的 `base`、构建脚本等），减少白屏/空白界面问题。
- **electron-builder**：调整配置，便于生成 **Windows portable / `win-unpacked`** 等可分发的构建产物。
- **主进程**：与启动、日志或加载路径相关的小幅调整（见该提交的 `mvp/electron/main.js`）。

---

## v1.0.0-beta.1

**标签：** `v1.0.0-beta.1`  
**提交：** `e0af596`  
**日期：** 2026-04-17

### 用户可见

- **首个可运行的 MVP 基线**：Electron 桌面壳 + React（Vite）前端。
- **Emby 集成**：Base URL、API Key、用户与媒体库（Section）选择并持久化到本地。
- **未播放海报墙**：按已选媒体库拉取未播放电影列表并展示海报；调用本机配置的 **第三方播放器**（如 PotPlayer）路径与参数模板启动播放。
- **观看结束流程**：基于会话时长估算进度，**用户确认**后向 Emby **回写已播放**。

### 文档与工程

- 首版 **产品需求说明**（原 `EmbyDesktopPlayer_PRD.md`；现行条文见 `EmbyDesktopPlayer_PRD_v1.0.0_modules.md`）。
- 基础工程文件：`.gitignore`、`mvp/` 下前后端入口、类型声明与样式等。

---

## 版本对照（快速索引）


| 版本号          | Git 标签          | 说明摘要                   |
| ------------ | --------------- | ---------------------- |
| 1.0.0-beta.8 | `v1.0.0-beta.8` | 删除 Flow、Emby 真删、用户令牌鉴权 |
| 1.0.0-beta.7 | `v1.0.0-beta.7` | 分星级治理、预测体积、PRD §4.5    |
| 1.0.0-beta.6 | `v1.0.0-beta.6` | 豆瓣评分与有效星级              |
| 1.0.0-beta.5 | `v1.0.0-beta.5` | 媒体库治理、原盘、列表缓存          |
| 1.0.0-beta.4 | `v1.0.0-beta.4` | 真实 Emby 前台闭环、播放记录      |
| 1.0.0-beta.3 | `v1.0.0-beta.3` | 播放记录与行级已看/未看同步         |
| 1.0.0-beta.2 | `v1.0.0-beta.2` | 打包/生产启动与配置页收敛          |
| 1.0.0-beta.1 | `v1.0.0-beta.1` | MVP 基线 + PRD 初稿        |


若需核对某标签指向的提交：`git show v1.0.0-beta.8 --no-patch`。