# DESIGN_SERVICE/TRANSCODE_FLOW — TranscodeFlowExecutor

> 状态：v2 重写中
> 基准架构：Phase 3，基于双向 API 通信模型重写
> SSOT：本文是 TranscodeFlowExecutor 可执行行为的唯一事实来源

---

## §1 职责定位

TranscodeFlowExecutor 负责执行转码任务的可执行行为，管理 phase 状态机和用户确认停泊点。

**依赖**：`transcodeService`、`embyService`、`taskStore`、`configStore`

---

## §2 FlowExecutor API 实现

### 2.1 drive(resumePoint)

| resumePoint | 行为 |
|---|---|
| `'transcode_precheck'` | 从 precheck 阶段开始 |
| `'transcode_executing'` | 从 executing 阶段开始（DV confirm 恢复，跳过 DV 检测） |
| `'transcode_verify'` | 从 verify 阶段开始（替换 confirm 恢复，跳过 precheck + 压制 + verify） |

### 2.2 pause()

收到 `pause()` 调用时：

- 中断 FFmpeg 进程
- **保留 partial 文件**（后续可恢复）
- 调用 `scheduler.reportStatus(taskId, 'paused')`
- Flow 进入 `paused` 状态，调度器不再接管

### 2.3 cancel()

收到 `cancel()` 调用时：

- 中断 FFmpeg 进程
- **清理 partial 文件**
- 调用 `scheduler.reportStatus(taskId, 'done')`（非 failed_hard，不重试）

### 2.4 confirmReceived()

从 `awaiting_user_confirm` 阶段恢复，继续执行。

### 2.5 reportStatus(status, progress?)

| status | 触发时机 | progress |
|---|---|---|
| `executing` | 进入 executing 阶段 | 0-99 |
| `done` | 全部完成 | 100 |
| `failed_hard` | 任意阶段失败 | - |
| `paused` | 用户暂停 | 当前进度 |

---

## §3 Flow 阶段定义

```
drive('transcode_precheck')
    ↓
precheck：
    → transcodeService.precheck()
      - 需要 DV 确认 → scheduler.pauseForConfirm('transcode_executing')
      - 设备池为空 → reportStatus('failed_hard')
      - 临时目录不可写 → reportStatus('failed_hard')
      - 源文件不可读 → reportStatus('failed_hard')
      - 预估输出体积 ≥ 原文件 → reportStatus('done')（跳过无意义转码）
      - FFmpeg/ffprobe 不可用 → reportStatus('failed_hard')
    → reportStatus('executing', 0)

executing（confirm 后或 resumePoint 直接进入）：
    → 分配设备槽位（按 CPU 参与策略：normal 全可用，backup_only 仅 GPU）
    → transcodeService.startEncode(onProgress)
      → onProgress(pct) → scheduler.reportStatus('executing', pct)
    ↓
（压制中可被 pause/cancel 中断）

verify（三层校验）：
    → reportStatus('executing', 90)
    → transcodeService.probeSummary()
    → 基础层：容器可读、时长、分辨率、HDR 元数据
      - 不通过 → reportStatus('failed_hard')
    → 策略层：等价码率/文件大小是否落入目标带
      - 不通过 → reportStatus('failed_hard')
    → DV/色彩层：偏色回归抽检（仅 DV 源）
      - 不通过 → reportStatus('failed_hard')

replace（替换前确认）：
    → config.transcodeReplaceConfirmRequired
      → scheduler.pauseForConfirm('transcode_replace')
    → transcodeService.replaceWithRetries()
    → reportStatus('done', 100)
```

---

## §4 Phase 状态

| phase | 说明 |
|---|---|
| `precheck` | DV 确认、devicePool 校验、临时目录、源文件、预估体积 |
| `transcode_executing` | 执行转码压制 |
| `verify` | 三层校验（基础层 + 策略层 + DV/色彩层） |
| `transcode_replace` | 替换原始文件 |
| `done` | 完成 |
| `failed_hard` | 失败（硬失败） |
| `paused` | 用户暂停 |

---

## §5 错误处理

| 场景 | 行为 |
|---|---|
| devicePool 为空 | `reportStatus('failed_hard')` |
| FFmpeg/ffprobe 不可用 | `reportStatus('failed_hard')` |
| `startEncode()` 失败 | `reportStatus('failed_hard')` |
| `probeSummary()` 策略层不通过 | `reportStatus('failed_hard')` |
| `replaceWithRetries()` 失败 | `reportStatus('failed_hard')` |

---

## §6 关联文档

- `SERVICE/TASK_SCHEDULER.md` — 调度层 API 契约、confirm/pause/cancel 通用行为
- `SERVICE/TRANSCODE.md` — TranscodeService.startEncode() / probeSummary() / replaceWithRetries() 实现
