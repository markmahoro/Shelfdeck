# DESIGN_SERVICE/TRANSCODE_FLOW — TranscodeFlowExecutor

> 状态：v4
> 基准架构：Phase 4，基于双向 API 通信模型
> SSOT：本文是 TranscodeFlowExecutor 可执行行为的唯一事实来源

---

## §1 职责定位

TranscodeFlowExecutor 负责执行转码任务的可执行行为，管理 phase 状态机和用户确认停泊点。

**依赖**：`transcodeService`、`taskStore`、`configStore`（注意：代码中不导入 `embyService`）

**内部辅助函数**：
- `appendLog(taskId, level, msg)` — 写入结构化日志
- `setPhase(taskId, phase)` — 更新 task.phase
- `resolveSourcePath(sourcePath, config)` — 路径映射（pathMapFrom → pathMapTo）
- `buildDeviceSlots(config)` — 从配置构建设备槽位列表
- `unlinkWithRetrySync(filePath)` — 带重试的文件删除（Windows 文件句柄释放延迟，重试最多 20 次 × 100ms）

**abortedTasks 机制**：`Set<string>`。pause/cancel 时将 taskId 加入该集合。各阶段 catch 块检查 `abortedTasks.has(taskId)`，若为 true 则静默跳过（不覆盖为 `failed_hard`），避免用户操作被错误处理覆盖。

**Phase 链式模型**：各 phase 函数内部调用下游 phase（`runPrecheck` → `runExecuting` → `runVerify` → `runReplace`），仅在两处停泊：DV confirm 和 replace confirm。调度器通过 `driveTask` 从停泊点恢复时，按 `resumePoint` 路由到对应入口。

---

## §2 FlowExecutor API 实现

### 2.1 driveTask(taskId)

入口函数。从 task 读取 `resumePoint`，路由到对应阶段。启动时清除该 taskId 的 `abortedTasks` 标记。

| resumePoint | 行为 |
|---|---|
| `'transcode_precheck'` | 从 precheck 阶段开始 |
| `'transcode_executing'` | 从 executing 阶段开始（DV confirm 恢复，跳过 DV 检测） |
| `'transcode_replace'` | 从 replace 阶段开始（替换 confirm 恢复，跳过 precheck + 压制 + verify） |

### 2.2 pause()

收到 `pause()` 调用时：

- 将 taskId 加入 `abortedTasks`
- 调用 `transcodeService.abortTask(taskId)` 中断 FFmpeg 进程
- **清理 partial 文件**（`unlinkWithRetrySync`，带重试。注意：若当前在 `transcode_replace` 阶段则不删除 partial，因为此时 partial 已是成品转码输出）
- 调用 `scheduler.reportStatus(taskId, 'paused', task.progress)`

### 2.3 cancel()

收到 `cancel()` 调用时：

- 将 taskId 加入 `abortedTasks`
- 调用 `transcodeService.abortTask(taskId)` 中断 FFmpeg 进程
- **清理 partial 文件**（`unlinkWithRetrySync`）
- `setPhase(taskId, 'done')`
- `scheduler.reportStatus(taskId, 'done')`

### 2.4 confirmReceived()

从 `awaiting_user_confirm` 阶段恢复。调度器调用 `driveTask(taskId)` 从当前 `resumePoint` 继续。

### 2.5 reportStatus(status, progress?)

| status | 触发时机 | progress |
|---|---|---|
| `executing` | 进入 executing / verify 阶段 | 0-99 |
| `done` | 替换完成 | 100 |
| `failed_hard` | 任意阶段失败 | - |
| `paused` | 用户暂停 | 当前进度 |

---

## §3 Flow 阶段定义

```
driveTask(taskId) → resumePoint === 'transcode_precheck'
    ↓
precheck (runPrecheck)：
    → setPhase('precheck')
    → resolveSourcePath() 路径映射
    → transcodeService.precheck()
      - 需要 DV 确认 → scheduler.pauseForConfirm('transcode_executing')
      - 异常（临时目录/源文件/ffmpeg/ffprobe/libplacebo） → failed_hard
    → buildDeviceSlots() 检查设备池非空（若为空 → failed_hard）
    → 记录 precheck 结果到 task.itemInfo（sourcePath, partialPath, tempDir, isDolbyVision, durationSec, originalSizeBytes, originalVideoCodec, originalWidth, originalHeight, originalAudioCodec, originalBitrate）
    → reportStatus('executing', 0)
    → 直接链式调用 runExecuting()

executing (runExecuting, confirm 后或 precheck 链式进入)：
    → setPhase('transcode_executing')
    → 清理残留 partial 文件（`unlinkWithRetrySync`，处理上次中断的残留）
    → buildDeviceSlots() 构建排序后的设备槽
    → transcodeService.startEncode(onProgress)
      → onProgress(pct) → scheduler.reportStatus('executing', pct)
    ↓
    （压制中可被 pause/cancel 中断）
    → 编码完成 → 直接链式调用 runVerify()

verify (runVerify)：
    → setPhase('verify')
    → reportStatus('executing', 90)
    → transcodeService.probeSummary() 探针新文件
    → 基础校验：durationSec > 0（不通过 → failed_hard）
    → 记录输出文件元数据（sizeBytes, videoCodec, audioCodec, width, height, bitrate, durationSec）
    → extractPreviewClip() 生成预览切片（30s，从 25% 位置开始；失败只 warn 不阻断）
    → 存储 verifyResult 到 task
    → resolveSubLibSchedule() 检查 autoReplaceTranscode：
      - 若 false → scheduler.pauseForConfirm('transcode_replace')
      - 若 true → 直接链式调用 runReplace()

    **注意**：当前 verify 仅做 duration > 0 基础检查 + 元数据记录 + 预览生成。文档原先描述的三层校验（容器/策略/DV 色彩）未实现。

replace (runReplace)：
    → setPhase('transcode_replace')
    → transcodeService.replaceWithRetries()（3 次重试）
    → reportStatus('done', 100)
    → setPhase('done')
    → cleanupTaskWorkdir() 清理临时目录
```

---

## §4 Phase 状态

| phase | 说明 |
|---|---|
| `precheck` | DV 确认 + 设备池校验 + 临时目录/源文件 + ffmpeg/ffprobe |
| `transcode_executing` | 执行转码压制 |
| `verify` | 基础校验（duration > 0）+ 元数据记录 + 预览切片生成 |
| `transcode_replace` | 替换原始文件 |
| `done` | 完成 |
| `failed_hard` | 失败（硬失败） |
| `paused` | 用户暂停 |

---

## §5 错误处理

| 场景 | 行为 |
|---|---|
| 设备池为空 | `reportStatus('failed_hard')` |
| FFmpeg/ffprobe 不可用 | `reportStatus('failed_hard')`（precheck 中抛出异常） |
| `startEncode()` 失败 | `reportStatus('failed_hard')`（若未被 abort） |
| `probeSummary()` 返回 duration <= 0 | `reportStatus('failed_hard')`（若未被 abort） |
| `extractPreviewClip()` 失败 | warn 日志，不阻断流程 |
| `replaceWithRetries()` 失败 | `reportStatus('failed_hard')`（若未被 abort） |
| pause/cancel 中断 | catch 块检查 `abortedTasks`，避免覆盖用户操作为 `failed_hard` |

---

## §6 关联文档

- `SERVICE/TASK_SCHEDULER.md` — 调度层 API 契约、confirm/pause/cancel 通用行为
- `SERVICE/TRANSCODE.md` — TranscodeService API（precheck / startEncode / probeSummary / replaceWithRetries / extractPreviewClip）
- `SERVICE/CONFIG.md` — 转码配置（pathMapFrom/To, transcodeTempRoot, transcodeEncodingDevices, autoReplaceTranscode）
