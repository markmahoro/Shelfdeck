# DESIGN_SERVICE/UPGRADE_FLOW — UpgradeFlowExecutor

> 状态：v4
> 基准架构：Phase 4，基于双向 API 通信模型
> SSOT：本文是 UpgradeFlowExecutor 可执行行为的唯一事实来源
> 依赖：MoviePilot REST API 集成、transcodeService（probe + preview clip）

---

## §1 职责定位

UpgradeFlowExecutor 负责执行升级/洗版任务，通过 MoviePilot REST API 搜索候选、触发下载、等待 MoviePilot 自动刮削后，执行原子替换。

**核心原则**：MoviePilot 负责搜索种子 + 下载调度 + 刮削整理。ShelfDeck 负责选择版本、触发下载、TMDB 身份校验、最终文件夹替换。

**依赖**：`taskStore`、`configStore`、`moviepilotService`、`transcodeService`、`smartSeedSelect`

**内部辅助函数**：
- `appendLog(taskId, level, msg)` — 写入结构化日志
- `setPhase(taskId, phase)` — 更新 task.phase

---

## §2 MoviePilot 集成架构

### 2.1 路径映射

| 配置字段 | 说明 |
|---|---|
| `moviepilot.savePath` | MoviePilot 容器内 shelfdeck 下载目录 |
| `upgradeStagingLocalPath` | ShelfDeck 视角的 staging 路径（SMB 映射后的 Windows 路径，如 `W:\shelfdeck`） |

MoviePilot 端 shelfdeck 目录配置为刮削模式。下载完成后 MoviePilot 自动识别媒体 → 重命名 → 生成 Kodi XML NFO → 整理至同一目录下的规范文件夹（"移动"操作）。

ShelfDeck 通过 SMB 读取 staging 中的刮削结果。

### 2.2 MoviePilot API 端点

| 端点 | 用途 |
|---|---|
| `GET /api/v1/search/title?keyword=xxx` | 关键词搜索 PT 站点种子 |
| `GET /api/v1/media/search?title=xxx` | 影片名 → TMDB/Douban ID |
| `POST /api/v1/download/add` | 添加下载（指定 `save_path`）。**注意**：返回不一定包含 `hash`，需通过 `acquireHash()` 轮询获取 |
| `GET /api/v1/download/` | 查询下载状态（含 `media.tmdbid`），按 `hash` 精确定位 |
| `GET /api/v1/download/stop/{hash}` | 暂停下载任务 |
| `GET /api/v1/download/start/{hash}` | 恢复下载任务 |
| `DELETE /api/v1/download/{hash}` | 删除下载任务（下载器清理 partial 文件） |
| `GET /api/v1/history/transfer` | 查询整理记录（刮削完成信号） |

认证方式：query param `?token=xxx`。

### 2.3 Hash 获取子系统

`addDownload` 的响应不一定包含 `downloadHash`。因此实现了一个独立的 `acquireHash()` 轮询循环：

- 轮询 `GET /api/v1/download/` 每 2 秒，通过 torrent 标题（规范化后）匹配返回的下载条目
- 备选匹配词：item 的中文名
- 超时：10 分钟（MoviePilot 注册下载任务的最长等待时间）
- 等待期间遵循 `pausingRequested` 和 `pendingCancel` 延迟操作标记

### 2.4 文件生命周期

| 阶段 | 特征 | 文件归属 |
|---|---|---|
| 1. 下载中 | `downloadHash` 在 download list 中，`stagingFolder` 未设置 | MoviePilot 下载器 |
| 2. 下载完/刮削未完成 | `downloadHash` 已从 list auto-remove，无新 transfer record，`stagingFolder` 未设置 | 原始文件在 savePath，MP 刮削器即将处理 |
| 3. 刮削完成 | 有新 transfer record，`stagingFolder` 已设置 | ShelfDeck（MP 不再管理刮削产出） |

---

## §3 FlowExecutor API 实现

### 3.1 driveTask(taskId)

入口函数。从 task 读取 `resumePoint`，路由到对应阶段。启动时清除该 taskId 的 `abortFlags`。

| resumePoint | 行为 |
|---|---|
| `'upgrade_precheck'` | 从 precheck 阶段开始 |
| `'upgrade_planning'` | 从 planning 阶段开始 |
| `'upgrade_executing'` | 从 executing 阶段开始（用户选择版本后恢复，或 hash 恢复） |
| `'upgrade_pre_replace_verify'` | 从 pre-replace-verify 阶段开始 |
| `'upgrade_replace'` | 从 replace 阶段开始 |

### 3.2 pause()

收到 `pause()` 调用时：

- 若处于 executing 阶段且 `downloadHash` 不存在（hash 查找中）：
  → 设置 `task.pausingRequested = true`（延迟操作标记）
  → `scheduler.reportStatus(taskId, 'pausing', task.progress)`
- 若 `downloadHash` 存在：
  → 调用 `GET /api/v1/download/stop/{hash}` 暂停 MoviePilot 下载器
  → 设置 abort flag 中断下载轮询或刮削等待
  → 保留 staging 中文件
- `scheduler.reportStatus(taskId, 'paused', task.progress)`

### 3.3 cancel()

核心语义：所有痕迹归零，如同任务从未发起。

根据文件生命周期阶段分三种处理路径：

**阶段3+ — 刮削已完成**（`stagingFolder` 已设置）：
- `DELETE /api/v1/download/{hash}` — 无论结果
- `fs.rmSync(stagingFolder)` 清理刮削产出
- `reportStatus('done')`

**阶段1 — 下载中**（`downloadHash` 在 MP download list 中）：
- `DELETE /api/v1/download/{hash}` — MP 通知下载器停止并清理
- `reportStatus('done')`

**阶段2 — 下载完/刮削未完成**（`downloadHash` 不在 list 中，`stagingFolder` 未设置）：
- 设置 `task.cancelAfterScraping = true`
- 不设 abort flag — 让流继续直到刮削自然完成
- `pre_replace_verify` 检测到 `cancelAfterScraping` → 清理 → `done`

**Hash 查找阶段**（在 executing 中但 `downloadHash` 不存在）：
- 设置 `task.pendingCancel = true`（延迟操作标记）
- `acquireHash()` 循环检测到该标记后，获取到 hash 后立即 delete + 上报 done

**预处理/规划阶段**（无 download 启动）：
- 直接设置 abort flag + `reportStatus('done')`

### 3.4 confirmReceived()

`PATCH /v1/tasks/:id { confirmed: true, confirmData: { selectedIndex } }` — 存储 `confirmData`，调度器以 `resumePoint='upgrade_executing'` 重新入队。

### 3.5 reportStatus(status)

| status | 触发时机 |
|---|---|
| `executing` | 进入 executing / pre_replace_verify 阶段 |
| `paused` | pause() 在下载轮询或刮削等待阶段 |
| `pausing` | pause() 在 hash 查找阶段（延迟，等 hash 到后执行） |
| `done` | 替换完成或取消清理完成 |
| `failed_hard` | 任意阶段不可恢复失败 |

**注意**：设计文档原先定义的 `waiting_media_source` 状态在当前代码中未实现。搜索无候选时当前直接报告 `failed_hard`（见 §4 planning）。

### 3.6 resume from pause

用户调用 `POST /v1/tasks/:id/actions/execute` → 调度器将 status 改为 `queued` → `flow.driveTask(taskId)` → 按 `resumePoint` 进入对应阶段。

| resumePoint | 行为 |
|---|---|
| `upgrade_precheck` | `runPrecheck` 重跑（幂等） |
| `upgrade_planning` | `runPlanning` 重跑（幂等，重新搜索） |
| `upgrade_executing` | `runExecuting` 检测场景：有 `downloadHash` → 调用 `GET /download/start/{hash}` 恢复；有 `downloadAdded` 无 hash → `recoverHashAndContinue()`；否则首次 → `addDownload` + `acquireHash` |
| `upgrade_pre_replace_verify` | `runPreReplaceVerify` 重跑 |
| `upgrade_replace` | `runReplace` 重跑 |

---

## §4 Flow 阶段定义

```
driveTask(taskId) → resumePoint === 'upgrade_precheck'
    ↓
precheck (runPrecheck)：
    → setPhase('precheck')
    → 校验 moviepilot.baseUrl + apiKey 非空
    → moviepilotService.checkConnection()
    → 失败 → failed_hard
    → 成功 → 设置 resumePoint='upgrade_planning'，通过 setImmediate 链式调用 runPlanning()

planning (runPlanning)：
    → setPhase('planning')
    → 从 task.itemInfo 获取影片名 + 从 path 提取年份
    → 搜索关键词 = name + " " + year
    → moviepilotService.searchTorrents(keyword)
    → 若中文搜索无结果 → searchMediaByTitle() 获取英文名重试
    → 存储 candidates（simplified）到 task.itemInfo
    → **Smart Seed Selection**：调用 smartSeedSelect.filterAndSelect()
      → 若 auto-select 命中 → 存储 selectedIndex 到 confirmData → 直接链式调用 runExecuting()（跳过用户确认）
      → 若 smartSelectEnabled 且有偏好但无匹配 → failed_hard
      → 否则 → pauseForConfirm('upgrade_executing')
    → **注意**：搜索无候选（非 smart select 场景）→ 当前直接 reportStatus('failed_hard')。设计文档原先的 `waiting_media_source` 停泊模型未实现。
        ↓ [用户选种 或 auto-select 绕过了确认] ↑
executing (runExecuting)：
    → setPhase('upgrade_executing')
    → reportStatus('executing', progress)
    → 三种进入路径：
      a) 有 `downloadHash`（resume）：→ resumeDownload → pollDownloadAndScrape()
      b) 有 `downloadAdded` 无 hash（recover）：→ recoverHashAndContinue()（重新 acquireHash）
      c) 首次执行：→ 确定 selectedIndex → 记录 baseline transfer history ID → **多候选 fallback 下载**：
         → smartSeedSelect.getRankedPool() → 筛选 score >= 0.8 的候选
         → 按序尝试 addDownload()（失败则试下一个）
         → 全部失败 → failed_hard
         → 设置 downloadAdded = true → acquireHashAndContinue()
    → acquireHash()：轮询 listDownloads() 通过标题匹配获取 hash（最长 10 分钟）
      → 若 pausingRequested：获取 hash 后立即 pause MP + 上报 paused
      → 若 pendingCancel：获取 hash 后立即 delete + 上报 done
    → pollDownloadAndScrape()：轮询下载进度 → 等待刮削完成
        ↓
pre_replace_verify (runPreReplaceVerify)：
    → setPhase('pre_replace_verify')
    → reportStatus('executing', 90)
    → 扫描 upgradeStagingLocalPath 找刮削后的文件夹
    → 若 task.cancelAfterScraping = true：
        → fs.rmSync(stagingFolder) 清理刮削产出
        → reportStatus('done')，流程结束
    → TMDB 校验：mpTmdbId（优先）或 NFO <tmdbid> vs 预期 TMDB ID
      → 不匹配 → failed_hard
    → transcodeService.probeSummary() 解析新文件参数
    → transcodeService.extractPreviewClip() 生成 30s 预览切片（失败只 warn）
    → 存储 verifyResult + upgradePreview 到 task
    → resolveSubLibSchedule() 检查 autoReplaceUpgrade：
      → 若 false → pauseForConfirm('upgrade_replace')
      → 若 true → 直接链式调用 runReplace()
    → 等待刮削 settle：upgradeScrapingSettleSeconds（默认 1800s = 30 分钟）用于 MoviePilot 异步刮削（NFO/poster 生成）
        ↓ [用户确认 或 auto]
replace (runReplace)：
    → setPhase('upgrade_replace')
    → 解析 Emby 目标路径（pathMapFrom → pathMapTo，resolveEmbyPath）
    → 跨设备复制：copyDirSync(staging → target.etp.tmp) → rmSync(旧) → renameSync(.etp.tmp → 目标)
    → 清理 staging 源
    → reportStatus('done', 100)
    → setPhase('done')
```

**死代码说明**：
- `runVerify(taskId, task)` — 定义了但 `driveTask()` 从未路由到它（没有 `'upgrade_verify'` resumePoint）。replace 阶段直接内联完成，不经过独立 verify。
- `atomicReplaceFolder(sourceDir, targetDir, taskId)` — 定义了但从未被调用。`runReplace()` 有自己的内联 copyDirSync + rename 替换逻辑。

---

## §5 Phase 状态

| phase | 说明 |
|---|---|
| `precheck` | MoviePilot 连接校验 |
| `planning` | 调用 MoviePilot 搜索 + Smart Seed auto-select |
| `upgrade_executing` | 下载（含 hash 获取 + 多候选 fallback）+ 轮询 + 等待刮削 |
| `pre_replace_verify` | TMDB 校验 + probe + 预览切片生成 + 刮削 settle 等待 |
| `upgrade_replace` | 文件夹原子替换 |
| `done` | 完成 |
| `failed_hard` | 硬失败 |

**注意**：`waiting_media_source` 为设计文档定义的停泊状态，当前代码未实现（直接 `failed_hard`）。

---

## §6 错误处理

| 场景 | 行为 |
|---|---|
| MoviePilot 未配置 | `reportStatus('failed_hard')` |
| MoviePilot 连接校验失败 | `reportStatus('failed_hard')` |
| 搜索接口返回错误 | `reportStatus('failed_hard')` |
| 搜索无结果 | `reportStatus('failed_hard')`（注意：非 `waiting_media_source`） |
| Smart select 启用但无匹配 | `reportStatus('failed_hard')` |
| 所有高分段候选下载失败 | `reportStatus('failed_hard')` |
| Hash 获取超时（10 分钟） | `reportStatus('failed_hard')` |
| 下载超时/失败 | `reportStatus('failed_hard')` |
| 刮削超时（10 分钟） | 记录 warn 日志，继续 |
| TMDB 不匹配 | `reportStatus('failed_hard')` |
| 替换失败 | `reportStatus('failed_hard')` |
| pause/cancel | 区分 hash 查找阶段延迟操作 vs 直接操作；catch 块检查 `isAborted()` |

---

## §7 关联文档

- `SERVICE/TASK_SCHEDULER.md` — 调度层 API 契约、confirm/pause/cancel 通用行为
- `SERVICE/TRANSCODE.md` — `extractPreviewClip`、`probeSummary`、`replaceWithRetries` 子流程
- `SERVICE/CONFIG.md` — MoviePilot 配置字段、upgradeStagingLocalPath、upgradeScrapingSettleSeconds、autoReplaceUpgrade
- `SERVICE/ADMIN_WEB/API.md` — 洗版配置 Admin API
- `SERVICE/ADMIN_WEB/PAGES.md` — 洗版设置管理页
