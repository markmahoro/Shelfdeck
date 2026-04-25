# DESIGN_SERVICE/DELETE_FLOW — DeleteFlowExecutor

> 状态：v2 重写中
> 基准架构：Phase 3，基于双向 API 通信模型重写
> SSOT：本文是 DeleteFlowExecutor 可执行行为的唯一事实来源

---

## §1 职责定位

DeleteFlowExecutor 负责执行删除任务的可执行行为。

**依赖**：`embyService`、`taskStore`、`configStore`

---

## §2 FlowExecutor API 实现

### 2.1 drive(resumePoint)

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

用户点了确认，从 `awaiting_user_confirm` 阶段恢复，继续执行。

### 2.5 reportStatus(status)

| status | 触发时机 |
|---|---|
| `executing` | 进入 executing 阶段 |
| `done` | 双重校验全部通过 |
| `failed_hard` | 任意校验失败 |

---

## §3 Flow 阶段定义

```
drive('delete_precheck')
    ↓
precheck：
    → embyService.getItemDeleteInfo() 获取删除信息
      - 失败 → reportStatus('failed_hard')
    → embyService.libraryItemExists() 检查是否还存在
      - 不存在 → reportStatus('done') → 结束
      - 存在 → scheduler.pauseForConfirm('delete_executing')
        → status = awaiting_user_confirm，停住

confirmReceived() 被调用
    ↓
executing：
    → reportStatus('executing')
    → embyService.deleteLibraryItem()（fire-and-forget，不等 Emby 返回）

verify（双重校验）：
    → 第一层：embyService.libraryItemExists() 查询 Emby 404
      - 仍存在 → reportStatus('failed_hard')
    → 第二层：文件系统验证
      - 基于路径映射查本地文件是否真实删除
      - 文件仍存在 → reportStatus('failed_hard')
      - 全部通过 → reportStatus('done')
```

---

## §4 Phase 状态

| phase | 说明 |
|---|---|
| `precheck` | 检查媒体项是否存在，获取删除信息 |
| `executing` | 执行 Emby 删除请求 |
| `verify` | 双重校验（Emby 404 + 文件系统） |
| `done` | 删除成功完成 |
| `failed_hard` | 删除失败（硬失败） |

---

## §5 错误处理

| 场景 | 行为 |
|---|---|
| `getItemDeleteInfo()` 失败 | `reportStatus('failed_hard')` |
| `libraryItemExists()` 返回 false（precheck 阶段） | `reportStatus('done')`（视为已删除） |
| `libraryItemExists()` 返回 true（verify 阶段） | `reportStatus('failed_hard')` |
| 文件系统验证失败 | `reportStatus('failed_hard')` |

---

## §6 关联文档

- `SERVICE/TASK_SCHEDULER.md` — 调度层 API 契约、confirm/pause/cancel 通用行为
- `SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER.md` — `libraryItemExists()` / `deleteLibraryItem()` 实现
