# ShelfDeck Kairox Release Goals

本文档定义 ShelfDeck Kairox 阶段的“大版本目标语义”。它回答的是：

```text
我们说已经达到某个 XX 版，到底是什么意思？
```

它不定义 Docker tag、Git tag 或 package version。技术版本记录见 `VERSIONING.md`。

## Version Goal Rules

- 大版本按用户价值和业务能力命名，不按工程层级命名。
- 每个大版本必须有清晰的目标、必须具备、不要求、验收方式和达成后下一步。
- 一个大版本未验收通过时，不能宣称已达到。
- 后续版本不能反向补前一个版本的核心验收。
- 当前 worktree 只推进到 `Kairox Beta`。`Kairox Usable`、`Kairox Performance`、`Kairox GA Candidate`、`Kairox GA` 必须新开 worktree。

## Version Goals

| 大版本 | 一句话目标 | 当前状态 |
| --- | --- | --- |
| `Kairox Beta` | 证明 Kairox 业务主链路在生产真实样本中跑通；用户不一定好用，但系统语义必须正确 | Achieved，生产 E2E 已通过 |
| `Kairox Usable` | 普通用户可以通过前端完成核心媒体管理流程，不需要理解内部架构 | Not started，新 worktree |
| `Kairox Performance` | 在真实库规模下，系统能持续自动跑，控制面稳定，资源利用率可接受 | Not started，新 worktree |
| `Kairox GA Candidate` | 功能、体验、性能、恢复、安全处置都达到发布前候选状态 | Not started，新 worktree |
| `Kairox GA` | 正式用户可用版，后续进入常规迭代 | Not started，新 worktree |

## Kairox Beta

### Goal

证明 ShelfDeck 已经按 Kairox 架构跑通核心业务链路：

```text
media facts + user perception
-> lifecycle objective / gate projection
-> targetGate task
-> Flow Planner selection
-> Resource Runtime execution
-> gate facts
-> archive
-> delete review
```

### Must Have

- 生产环境部署 Kairox Runtime Cutover 后的代码。
- 使用生产指定测试库和真实样本完成 E2E：
  - 测试库：`公共 国产剧库`
  - 测试样本：`漫长的季节`
- facts freshness 生效：
  - 文件变化后旧 media / metadata facts 不被继续当成最新事实。
  - stale canonical facts 能驱动 metadata refresh。
- metadata / user perception / lifecycle objective 边界正确：
  - metadata gate 不等待 perception。
  - perception 变化触发 objective revision，不直接创建 task。
  - Lifecycle 负责计算 next target gate。
- task 语义正确：
  - task identity 是 `object + targetGate + gateObjective`。
  - optimize task 不是 transcode candidate。
  - delete task 是 `targetGate=delete`，不经过 optimize。
- Flow Planner 语义正确：
  - Flow Planner 决定 no-op / transcode / upgrade / blocked。
  - 前端和 Task Creator 不把 flow 当任务身份。
- Resource Runtime / executor 链路跑通：
  - 能执行或推进 flow。
  - 能产生 event evidence / staged facts / gate facts。
- archive 和 delete review 语义正确：
  - archive 不是永久终点。
  - delete candidate 需要 review。
  - 未确认前不执行 destructive delete。
- 前端只需 Beta 级可见：
  - Dashboard / Media / Task Center / Delete Review / Policies / Advanced 可打开。
  - 用户能看到关键 facts、lifecycle、objective、task、delete candidate 状态。

### Not Required

- 不要求普通用户完整顺滑地完成所有操作。
- 不要求 UI 文案完全统一。
- 不要求信息架构达到 GA 水平。
- 不要求调度资源吃满。
- 不要求生产库全量自动跑完。
- 不要求 package version bump。
- 不要求 Git release tag。

### Acceptance

- 执行 `docs/v3/acceptance/KAIROX_FRONTEND_API_E2E_PLAN.md`。
- 生产 E2E 必须 stage by stage 执行。
- 每个 stage 必须记录 pass/fail、证据和下一步。
- 如果 stage 失败，停在该 stage 定位根因，不跳 stage。
- 验收报告写入 `docs/v3/acceptance/KAIROX_FRONTEND_API_E2E.md`。

### Done Means

当生产 E2E 完整通过后，才可以说：

```text
Kairox Beta achieved.
```

### After Done

本 worktree 到 `Kairox Beta` 为止。下一阶段必须新开 worktree，并从以下目标中选择一个：

- `Kairox Usable`
- `Kairox Performance`
- `Kairox GA Candidate`

## Kairox Usable

### Goal

普通用户可以通过前端完成核心媒体管理流程，不需要理解 Kairox 内部架构。

### Must Have

- 普通用户能看懂 Dashboard 的系统健康和媒体库管理成果。
- 媒体库页面能解释每个媒体的 facts、目标、生命周期状态和下一步。
- 任务中心能解释正在做什么、哪里需要用户介入、失败后怎么恢复。
- 处置队列能让用户处理删除建议。
- 管理策略能让用户配置媒体库、用户感知、媒体优化目标、自动化和处置策略。

### Not Required

- 不要求调度资源达到最佳利用率。
- 不要求所有高级诊断都适合普通用户。

### Acceptance

- 用户视角完整前端 E2E。
- 不要求用户理解 `targetGate`、Flow Planner、Resource Runtime 等内部术语。

## Kairox Performance

### Goal

在真实库规模下，系统能持续自动跑，控制面稳定，资源利用率可接受。

### Must Have

- Dashboard / Media / Task Center / Policies 在后台任务运行时仍秒级可用。
- Scheduler supply policy 不因单个 heavy flow 或 awaiting confirmation 阻塞所有自动任务。
- 无同 item + targetGate 重复 active task。
- 无自动任务绕过 TaskAdmission。
- 有生产压测报告和推荐配置。

### Not Required

- 不扩展新业务能力。
- 不改变 Kairox 语义。

### Acceptance

- 真实库规模压力测试。
- API latency、queue growth、DB/WAL growth、duplicate task、failure storm 均有记录和结论。

## Kairox GA Candidate

### Goal

功能、体验、性能、恢复、安全处置都达到发布前候选状态。

### Must Have

- `Kairox Beta` 已达成。
- `Kairox Usable` 已达成。
- `Kairox Performance` 已达成。
- 恢复、重试、取消、确认、删除安全边界均通过验收。

### Acceptance

- 发布前完整验收清单。
- 用户视角、生产控制面、后台自动化、失败恢复和 destructive safety 均通过。

## Kairox GA

### Goal

正式用户可用版。

### Must Have

- GA Candidate 验收通过。
- 用户确认可发布。
- 发布记录、回滚说明、已知问题和后续计划完整。

### Acceptance

- 用户批准。
- Git release tag 可创建。
- 后续进入常规迭代。
