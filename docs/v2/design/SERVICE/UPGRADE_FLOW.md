# DESIGN_SERVICE/UPGRADE_FLOW — UpgradeFlowExecutor

> 状态：v2 定稿
> 基准架构：Phase 3，基于双向 API 通信模型
> SSOT：本文是 UpgradeFlowExecutor 可执行行为的唯一事实来源
> 依赖：MoviePilot REST API 集成、transcodeService（probe + preview clip）

---

## §1 职责定位

UpgradeFlowExecutor 负责执行升级/洗版任务，通过 MoviePilot REST API 搜索候选、触发下载、等待 MoviePilot 自动刮削后，执行原子替换。

**核心原则**：MoviePilot 负责搜索种子 + 下载调度 + 刮削整理。ShelfDeck 负责选择版本、触发下载、TMDB 身份校验、最终文件夹替换。

**依赖**：`taskStore`、`configStore`、`moviepilotService`、`transcodeService`

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
| `POST /api/v1/download/add` | 添加下载（指定 `save_path`），返回含 `hash` |
| `GET /api/v1/download/` | 查询下载状态（含 `media.tmdbid`），按 `downloadHash` 精确定位 |
| `GET /api/v1/download/stop/{hash}` | 暂停下载任务 |
| `GET /api/v1/download/start/{hash}` | 恢复下载任务 |
| `DELETE /api/v1/download/{hash}` | 删除下载任务（下载器清理 partial 文件） |
| `GET /api/v1/history/transfer` | 查询整理记录（刮削完成信号） |

认证方式：query param `?token=xxx`。

### 2.3 下载身份追踪

`addDownload` 返回后立即将 hash 持久化到 `task.itemInfo.downloadHash`，作为 ShelfDeck 与 MoviePilot 下载任务之间的外键。

后续所有 MP 操作——轮询进度、pause（stop）、resume（start）、cancel（delete）——均通过 `downloadHash` 精确操作，不依赖启发式匹配。

### 2.4 文件生命周期

| 阶段 | 特征 | 文件归属 |
|---|---|---|
| 1. 下载中 | `downloadHash` 在 download list 中，`stagingFolder` 未设置 | MoviePilot 下载器 |
| 2. 下载完/刮削未完成 | `downloadHash` 已从 list auto-remove，无新 transfer record，`stagingFolder` 未设置 | 原始文件在 savePath，MP 刮削器即将处理 |
| 3. 刮削完成 | 有新 transfer record，`stagingFolder` 已设置 | ShelfDeck（MP 不再管理刮削产出） |

---

## §3 FlowExecutor API 实现

### 3.1 drive(resumePoint)

| resumePoint | 行为 |
|---|---|
| `'upgrade_precheck'` | 从 precheck 阶段开始 |
| `'upgrade_planning'` | 从 planning 阶段开始 |
| `'upgrade_executing'` | 从 executing 阶段开始（用户选择版本后恢复） |
| `'upgrade_pre_replace_verify'` | 从 pre-replace-verify 阶段开始 |
| `'upgrade_replace'` | 从 replace 阶段开始 |

### 3.2 pause()

收到 `pause()` 调用时：

- 若当前处于 executing 阶段且 `task.itemInfo.downloadHash` 存在：
  → 调用 `GET /api/v1/download/stop/{hash}` 暂停 MoviePilot 下载器
- 设置 abort flag 中断下载轮询或刮削等待
- **保留** staging 中已下载和刮削产出的文件（不清理）
- **保留** `resumePoint` 不变（后续 resume 从同一阶段恢复）
- 调用 `scheduler.reportStatus(taskId, 'paused', progress)`

### 3.3 cancel()

**核心语义：所有痕迹归零，如同任务从未发起。**

收到 `cancel()` 调用后，根据文件生命周期阶段分三种处理路径：

**阶段1 — 下载中**（`downloadHash` 在 MP download list 中，`stagingFolder` 未设置）：
- 调用 `DELETE /api/v1/download/{hash}` — MP 通知下载器停止并清理文件
- 设置 abort flag 中断轮询
- `reportStatus('done')`

**阶段2 — 下载完/刮削未完成**（`downloadHash` 已从 download list auto-remove，无新 transfer record，`stagingFolder` 未设置）：
- `DELETE /api/v1/download/{hash}` 返回 404（忽略）
- **不设 abort flag** — 让流继续直到刮削自然完成
- 设置 `task.cancelAfterScraping = true`
- 流自然走到 `waitForScraping` → 检测到新 transfer → 进入 `pre_replace_verify`
- `pre_replace_verify` 检测到 `cancelAfterScraping = true`：
  → `fs.rmSync(stagingFolder)` 清理刮削产出
  → `reportStatus('done')`

**阶段3+ — 刮削已完成**（`stagingFolder` 已设置）：
- `DELETE /api/v1/download/{hash}` — 无论结果，不做判断
- `fs.rmSync(stagingFolder)` 清理刮削产出
- `reportStatus('done')`

**为什么阶段2不直接打断**：raw 文件散落在 savePath 中，刮削器正在/即将处理，与 MP 抢文件容易留残渣。等自然产出完整文件夹后一次性清掉更干净。此窗口通常仅几分钟。

### 3.4 confirmReceived()

`PATCH /v1/tasks/:id { confirmed: true, confirmData: { selectedIndex } }` — 存储 `confirmData` 到 task，scheduler 以 `resumePoint='upgrade_executing'` 重新入队。

### 3.5 reportStatus(status)

| status | 触发时机 |
|---|---|
| `executing` | 进入 executing / pre_replace_verify 阶段 |
| `waiting_media_source` | 搜索无候选，停泊等重搜 |
| `done` | 替换完成 |
| `failed_hard` | 任意阶段不可恢复失败 |

### 3.6 resume from pause

用户调用 `POST /v1/tasks/:id/actions/execute` → scheduler 将 status 改为 `queued` → 调度轮询调用 `flow.driveTask(taskId)` → 按 `resumePoint` 进入对应阶段。

| resumePoint | 行为 |
|---|---|
| `upgrade_precheck` | `runPrecheck` 重跑（幂等，连接检查） |
| `upgrade_planning` | `runPlanning` 重跑（幂等，重新搜索） |
| `upgrade_executing` | `runExecuting` 检测到 `downloadHash` 已存在 → 调用 `GET /download/start/{hash}` 恢复下载 → 跳过 `addDownload`，直接进入轮询 |
| `upgrade_pre_replace_verify` | `runPreReplaceVerify` 重跑 |
| `upgrade_replace` | `runReplace` 重跑 |

---

## §4 Flow 阶段定义

```
drive('upgrade_precheck')
    ↓
precheck：
    → 校验 moviepilot.baseUrl + apiKey 非空
    → 调用 moviepilotService.checkConnection()
    → 失败 → reportStatus('failed_hard')
    → 成功 → 设置 resumePoint='upgrade_planning'，继续

planning：
    → 从 task.itemInfo.name 获取影片名
    → 从 itemInfo.path 提取年份（如 "(1994)"）
    → 搜索关键词 = name + " " + year
    → 调用 moviepilotService.searchTorrents(keyword)
    → 若中文搜索无结果，尝试搜索 moviepilotService.searchMediaByTitle() 获取英文名后重试
    → 有候选 → 存储 candidates 到 itemInfo → pauseForConfirm('upgrade_executing')
    → 无候选 → reportStatus('waiting_media_source')
        ↓ [用户选种，confirm API 传入 selectedIndex]
executing：
    → reportStatus('executing')
    → 从 task.confirmData.selectedIndex 取用户选择的 TorrentInfo
    → 若 task.itemInfo.downloadHash 已存在（resume 场景）：
        → GET /download/start/{hash} 恢复下载
        → 跳过 addDownload，直接进入轮询
    → 否则（首次执行）：
        → 记录 baseline transfer history ID（用于后续刮削完成检测）
        → moviepilotService.addDownload(torrentInfo, savePath=shelfdeck)
        → 持久化返回的 hash 到 task.itemInfo.downloadHash
    → 轮询 listDownloads() 每 5s，按 downloadHash 精确匹配，更新 progress
    → 下载完成后，从 download.media.tmdbid 获取 mpTmdbId
    → 进入 waitForScraping（轮询 transfer history，检测 shelfdeck 新条目）
    → 刮削完成 → 设置 resumePoint='upgrade_pre_replace_verify'，继续
        ↓
pre_replace_verify：
    → reportStatus('executing', 90)
    → 扫描 upgradeStagingLocalPath 找刮削后的文件夹
    → 若 task.cancelAfterScraping = true：
        → fs.rmSync(stagingFolder) 清理刮削产出
        → reportStatus('done')，流程结束
    → TMDB 校验：mpTmdbId（优先）或 NFO <tmdbid> vs 预期 TMDB ID
    → 不匹配 → failed_hard
    → probeSummary() 解析新文件 info
    → extractPreviewClip() 生成 30s 预览切片
    → 存储 verifyResult + upgradePreview 到 task
    → 若 transcodeReplaceConfirmRequired → pauseForConfirm('upgrade_replace')
    → 否则直接进入 replace
        ↓ [用户确认]
replace：
    → 解析 Emby 目标路径（pathMapFrom→pathMapTo）
    → 跨设备复制：copyDirSync(staging→.etp.tmp) → rmSync(旧) → renameSync(.etp.tmp→目标)
    → 清理 staging 源
    → reportStatus('done', 100)
    → setPhase('done')
```

---

## §5 Phase 状态

| phase | 说明 |
|---|---|
| `precheck` | MoviePilot 连接校验 |
| `planning` | 调用 MoviePilot 搜索接口 |
| `waiting_media_source` | 搜索无候选，停泊等重搜 |
| `upgrade_executing` | 下载 + 轮询 + 等待刮削 |
| `pre_replace_verify` | TMDB 校验 + probe + 预览切片生成 |
| `upgrade_replace` | 文件夹原子替换 |
| `done` | 完成 |
| `failed_hard` | 硬失败 |

---

## §6 错误处理

| 场景 | 行为 |
|---|---|
| MoviePilot 未配置 | `reportStatus('failed_hard')` |
| MoviePilot 连接校验失败 | `reportStatus('failed_hard')` |
| 搜索接口返回错误 | `reportStatus('failed_hard')` |
| 搜索无结果 | `reportStatus('waiting_media_source')` |
| 下载失败 | `reportStatus('failed_hard')` |
| 刮削超时（10 分钟） | 记录 warn 日志，继续 |
| TMDB 不匹配 | `reportStatus('failed_hard')` |
| 替换失败 | `reportStatus('failed_hard')` |
| pause/cancel | catch 块检查 `isAborted()`，避免覆盖用户操作 |

---

## §7 关联文档

- `SERVICE/TASK_SCHEDULER.md` — 调度层 API 契约、confirm/pause/cancel 通用行为
- `SERVICE/TRANSCODE.md` — `extractPreviewClip`、`probeSummary`、`replaceWithRetries` 子流程
- `SERVICE/CONFIG.md` — MoviePilot 配置字段定义
- `SERVICE/ADMIN_WEB/API.md` — 洗版配置 Admin API
- `SERVICE/ADMIN_WEB/PAGES.md` — 洗版设置管理页
