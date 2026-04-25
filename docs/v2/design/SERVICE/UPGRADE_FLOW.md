# DESIGN_SERVICE/UPGRADE_FLOW — UpgradeFlowExecutor

> 状态：v2 重写中
> 基准架构：Phase 3，基于双向 API 通信模型重写
> SSOT：本文是 UpgradeFlowExecutor 可执行行为的唯一事实来源
> 依赖：MoviePilot REST API 集成

---

## §1 职责定位

UpgradeFlowExecutor 负责执行升级/洗版任务，通过 MoviePilot REST API 搜索候选、触发下载、从 staging 目录执行原子替换。

**核心原则**：MoviePilot 是搜索引擎，ShelfDeck 是执行者。MoviePilot 只负责搜索和排名，实际下载和文件替换由 ShelfDeck 完成。

**依赖**：`taskStore`、`configStore`、`moviepilotService`

---

## §2 MoviePilot 集成架构

### 2.1 路径映射（关键设计）

MoviePilot 运行在 Docker 容器内，ShelfDeck 在宿主机（或另一容器），需要路径映射：

| 配置字段 | 说明 |
|---|---|
| `moviepilotSavePath` | MoviePilot 容器内下载目录（`save_path` 参数） |
| `moviepilotStagingPath` | MoviePilot 容器内 staging 目录（`target_path` 参数） |
| `upgradeStagingLocalPath` | ShelfDeck 视角的 staging 路径（通过 Docker 路径映射访问） |

### 2.2 MoviePilot API 端点

| 端点 | 用途 |
|---|---|
| `GET /api/v1/search/media/tmdb:{id}` | 搜索洗版候选 |
| `POST /api/v1/download/add` | 添加下载（指定 `save_path`） |
| `GET /api/v1/download/` | 查询下载状态 |
| `POST /api/v1/transfer/manual` | 手动整理（指定 `target_path` → staging） |

---

## §3 FlowExecutor API 实现

### 3.1 drive(resumePoint)

| resumePoint | 行为 |
|---|---|
| `'upgrade_precheck'` | 从 precheck 阶段开始 |
| `'upgrade_executing'` | 从 executing 阶段开始（用户选择版本后恢复） |

### 3.2 pause()

收到 `pause()` 调用时：

- 中断 MoviePilot 下载轮询
- **保留已下载的部分文件**
- 调用 `scheduler.reportStatus(taskId, 'paused')`

### 3.3 cancel()

收到 `cancel()` 调用时：

- 中断 MoviePilot 下载轮询
- **清理已下载的文件**
- 调用 `scheduler.reportStatus(taskId, 'done')`（非 failed_hard，不重试）

### 3.4 confirmReceived()

用户选择了版本后，从 `awaiting_user_confirm` 阶段恢复。

### 3.5 reportStatus(status)

| status | 触发时机 |
|---|---|
| `executing` | 进入 executing 阶段 |
| `waiting_media_source` | 搜索无候选，停泊等重搜 |
| `done` | 全部完成 |
| `failed_hard` | 任意阶段失败 |

---

## §4 Flow 阶段定义

```
drive('upgrade_precheck')
    ↓
precheck：
    → MoviePilot 连接校验
      - 失败 → reportStatus('failed_hard')

planning：
    → 调用 MoviePilot 搜索接口（GET /api/v1/search/media/tmdb:{id}）
    → 返回候选列表（含质量评分/码率/是否优于当前）
    → 有候选 → scheduler.pauseForConfirm('upgrade_executing')
        → status = awaiting_user_confirm，停住，展示候选列表给用户
    → 无候选 → reportStatus('waiting_media_source')
        → 定时重搜（间隔可配置）

用户选择版本，confirmReceived() 被调用
    ↓
executing：
    → reportStatus('executing')
    → POST /api/v1/download/add（save_path = MoviePilot 容器内下载目录）
    → 轮询 GET /api/v1/download/ 直到下载完成
    → POST /api/v1/transfer/manual（target_path = MoviePilot 容器内 staging 目录）
    → MoviePilot 把文件从 save_path 移动到 staging（容器内）
    → ShelfDeck 通过路径映射访问 staging 文件

verify：
    → 确认文件已落地
    → 原子 replace（.etp.new + .etp.bak 备份链）
    → reportStatus('done')
```

---

## §5 Phase 状态

| phase | 说明 |
|---|---|
| `precheck` | MoviePilot 连接校验 |
| `planning` | 调用 MoviePilot 搜索接口 |
| `waiting_media_source` | 搜索无候选，停泊等重搜 |
| `upgrade_executing` | 下载 + transfer + 文件替换 |
| `verify` | 确认新文件落地 |
| `done` | 完成 |
| `failed_hard` | 失败（硬失败） |

---

## §6 错误处理

| 场景 | 行为 |
|---|---|
| MoviePilot 连接校验失败 | `reportStatus('failed_hard')` |
| 搜索接口返回错误 | `reportStatus('failed_hard')` |
| 下载失败（重试 3 次后仍失败） | `reportStatus('failed_hard')` |
| staging 文件不存在或损坏 | `reportStatus('failed_hard')` |
| replace 失败（重试 3 次后仍失败） | `reportStatus('failed_hard')` |

---

## §7 关联文档

- `SERVICE/TASK_SCHEDULER.md` — 调度层 API 契约、confirm/pause/cancel 通用行为
- `SERVICE/TRANSCODE.md` — 原子 replace 子流程（replaceWithRetries）
