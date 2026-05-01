# DESIGN_SERVICE/DELETE_FLOW — DeleteFlowExecutor

> 状态：v4
> 基准架构：Phase 4，基于双向 API 通信模型
> SSOT：本文是 DeleteFlowExecutor 可执行行为的唯一事实来源

---

## §1 职责定位

DeleteFlowExecutor 负责执行删除任务的可执行行为。

**依赖**：`embyService`、`taskStore`、`configStore`

**内部辅助函数**：
- `appendLog(taskId, level, msg)` — 写入结构化日志到 task（追加到 `task.logs[]`）
- `setPhase(taskId, phase)` — 更新 task.phase
- `getServerConfig(task)` — 从 task 解析 Emby server 配置（优先 subLibrary 关联的 server，fallback 到第一个 server）

---

## §2 FlowExecutor API 实现

### 2.1 driveTask(taskId)

入口函数。从 task 读取 `resumePoint`，路由到对应阶段。代码中存在的 `drive(resumePoint)` 未导出，实际调度器调用的是导出的 `driveTask(taskId)`。

| resumePoint | 行为 |
|---|---|
| `'delete_precheck'` | 从 precheck 阶段开始 |
| `'delete_executing'` | 从 executing 阶段开始（confirm 恢复） |

### 2.2 pause()

删除操作是原子性的，暂停没有实际意义。收到 `pause()` 调用时：

- **忽略**，不执行任何操作
- 不调用 `reportStatus()`

### 2.3 cancel()

删除操作不可逆，确认前已停住等待用户，确认后立即执行不可取消。收到 `cancel()` 调用时：

- **忽略**，不执行任何操作
- 不调用 `reportStatus()`

### 2.4 confirmReceived()

用户点了确认，从 `awaiting_user_confirm` 阶段恢复。调度器以 `resumePoint='delete_executing'` 重新入队。

### 2.5 reportStatus(status)

| status | 触发时机 |
|---|---|
| `executing` | 进入 executing 阶段 |
| `done` | 预检阶段项目已不存在，或 verify 通过（Emby 404 确认删除成功） |
| `failed_hard` | Emby server 未配置、预检失败、删除失败（非 404）、verify 失败（项目仍存在） |

---

## §3 Flow 阶段定义

```
driveTask(taskId) → resumePoint === 'delete_precheck'
    ↓
precheck (runPrecheck)：
    → setPhase('precheck')
    → embyService.getItemDeleteInfo() 获取删除信息
      - 返回 null/falsy → 项目已不存在 → reportStatus('done', 100) → 结束
      - 异常 → reportStatus('failed_hard')
    → embyService.libraryItemExists() 检查是否还存在
      - 不存在 → reportStatus('done', 100) → 结束
      - 存在 → 存储 itemInfo（name, path, originalSizeBytes）
        → scheduler.pauseForConfirm('delete_executing')
        → status = awaiting_user_confirm，停住

confirm API 触发 → 调度器以 resumePoint='delete_executing' 重新入队
    ↓
executing (runExecuting)：
    → setPhase('executing')
    → reportStatus('executing')
    → await embyService.deleteLibraryItem()（等待 Emby 响应）
      - 正常返回 → 继续 verify
      - 异常且含 404 → 视为幂等成功（项目已被其他方式删除），继续 verify
      - 其他异常 → reportStatus('failed_hard')

verify (runVerify)：
    → setPhase('verify')
    → embyService.libraryItemExists() 查询 Emby 404
      - 仍存在 → reportStatus('failed_hard')
      - 不存在/请求报错（预期的 404） → 视为验证通过
    → reportStatus('done', 100)
    → setPhase('done')
```

**注意**：verify 仅通过 Emby API 检查。不存在本地文件系统验证层。

---

## §4 Phase 状态

| phase | 说明 |
|---|---|
| `precheck` | 检查媒体项是否存在，获取删除信息 |
| `executing` | 执行 Emby 删除请求 |
| `verify` | Emby 404 校验（确认删除生效） |
| `done` | 删除成功完成 |
| `failed_hard` | 删除失败（硬失败） |

---

## §5 错误处理

| 场景 | 行为 |
|---|---|
| Emby server 未配置 | `reportStatus('failed_hard')` |
| `getItemDeleteInfo()` 返回 null/falsy | `reportStatus('done')`（视为已删除） |
| `getItemDeleteInfo()` 异常 | `reportStatus('failed_hard')` |
| `libraryItemExists()` 返回 false（precheck 阶段） | `reportStatus('done')`（视为已删除） |
| `deleteLibraryItem()` 失败（非 404） | `reportStatus('failed_hard')` |
| `deleteLibraryItem()` 返回 404 | 视为幂等成功，继续 verify |
| `libraryItemExists()` 返回 true（verify 阶段） | `reportStatus('failed_hard')` |
| `libraryItemExists()` 异常（verify 阶段） | 视为验证通过（已删除的项目预期返回 404 错误） |

---

## §6 关联文档

- `SERVICE/TASK_SCHEDULER.md` — 调度层 API 契约、confirm/pause/cancel 通用行为
- `SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER.md` — `libraryItemExists()` / `deleteLibraryItem()` 实现
