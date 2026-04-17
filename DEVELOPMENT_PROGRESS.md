# Emby Desktop Player — 开发进度总结

> **文档性质**：与仓库实现、PRD（`EmbyDesktopPlayer_PRD_v1.0.0.md`）及任务中心 SSOT（`TASK_CENTER_FULL_LOGIC.md`）对照的阶段性记录。  
> **最近更新**：2026-04-17（+08:00）  
> **主工作副本（Canonical）**：`E:\my_project\emby_third_party`（请将 Cursor / 终端默认目录统一到此路径；`C:\emby_third_party` 仅为迁移前副本，可归档或删除以避免混淆。）

---

## 时间线（仓库提交与里程碑）

| 时间点（UTC+8） | 事件 |
|----------------|------|
| **2026-04-17 16:05:44** | 仓库基线初始化（`chore: initialize repository baseline`） |
| **2026-04-17 20:30:03** | 补充任务中心单一事实来源文档（`docs: add task center SSOT`，`TASK_CENTER_FULL_LOGIC.md`） |
| **2026-04-17 20:46:30** | 开发中版本快照：PRD 对齐 SSOT、五页壳层、任务调度 MVP 等（`chore: dev snapshot — PRD对齐任务中心SSOT、五页壳与调度MVP`，提交 `cfa6884`） |
| **2026-04-17 ~21:12** | **合并**：将 `C:\emby_third_party` 上 `release/v1.0.0` 的提交与 `E:\my_project\emby_third_party` 的 `master`（含 beta.3 等历史）做 `allow-unrelated-histories` 合并；冲突在 `mvp/` 与今日分支对齐；提交 `176a599`。本地分支 `release/v1.0.0` 已与 `master` 同指向该合并结果。 |

*说明：更早的 beta.1～beta.3 能力见 PRD §14；本表仅列本仓库近期可追溯的 Git 时间点。*

---

## 当前已完成（相对 v1.0.0 目标）

### 产品与文档

- PRD 已刷新：五页信息架构、配置中心承载调度参数、任务中心专责调度操作；独立「质量审阅」顶页废弃，补源确认走弹窗。
- 任务中心行为与 **`TASK_CENTER_FULL_LOGIC.md`** 对表（执行/暂停、软停、批量操作、侧栏按钮语义等）。

### 前端 MVP（`mvp/`）

- **壳层**：顶栏五页导航 + 各页左侧侧栏 + 右侧主区；暗色主题与基础样式。
- **任务中心**：本地持久化队列、状态筛选、转码/补源双队列调度模拟、`pauseRequested` 软停、单条与批量执行/暂停、信息确认弹窗、调试种子任务等。
- **配置**：媒体策略与任务调度相关表单向配置中心集中。

### 工程

- Electron + React（Vite）工程可构建；Electron 主进程/预加载等已纳入版本控制（以该快照为准）。

---

## 进行中 / 未闭合（相对 PRD 正式版）

- **真实后台执行**：FFmpeg 转码、MoviePilot 联动、主进程调度与 worker 等仍以 PRD 目标描述为主，当前多为占位或模拟。
- **托盘、中断恢复、checkpoint**：PRD 已定义，完整实现待后续迭代对齐。
- **批量执行前耗时/磁盘/负载预估**：PRD 目标能力，尚未产品化。

---

## 版本与分支参考

- **分支**：`release/v1.0.0`
- **最新合并提交**：`176a599`（`master` / `release/v1.0.0`，2026-04-17）

---

## 后续建议（可选）

- 在 `cfa6884` 上打轻量标签（例如 `v1.0.0-dev.20260417`）便于对外指代「开发中构建」。
- 每完成一个可演示里程碑时更新本文件「时间线」一节，并修订「已完成 / 未闭合」边界。
