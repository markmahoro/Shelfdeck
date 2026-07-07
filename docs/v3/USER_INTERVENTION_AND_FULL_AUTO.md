# 用户介入与全自动模式

Status: Semantic reference under Kairox.

本文是 Kairox 架构下的用户介入和全自动模式参考。若本文与 `docs/v3/KAIROX_ARCHITECTURE.md` 冲突，以 Kairox 为准。

本文描述用户介入白名单和全自动模式，不改变 Kairox 的 Task / Flow / Event 分层。运行时用户语义只能使用 `targetGate/gateObjective`；旧 Mirex 字段只允许出现在迁移输入、历史数据解释或 executor 物理投影中。

本文记录 v3.1 对“用户介入”和“全自动模式”的架构定义。它是判断人工/自动边界的准绳。

## 1. 基本定义

人工介入不是一种 task 类型，也不是一套独立 task management 逻辑。

人工介入是用户在媒体处理旅程中允许提供规则、事实、授权或 task 级调度的范围。

全自动模式也不是另一套执行链路。全自动模式表示：用户完成规则和授权配置后，系统可以在不需要运行时人工介入的情况下，自动推进允许范围内的媒体生命周期。

一句话：

```text
用户介入 = 允许用户参与的白名单
全自动模式 = 这张白名单中可预授权项的一组配置组合
```

## 2. 用户可介入范围白名单

下表是用户可介入范围白名单。表外事项默认不开放给用户。

| 用户介入场景 | 类别 | 用户在解决什么 | 新架构落点 |
| --- | --- | --- | --- |
| 配置 metadata gate | 配置规则 | 定义每个子库什么叫“元数据完整” | Lifecycle |
| 配置 optimize objective 规则 | 配置规则 | 定义媒体最终应该变成什么，比如降码率、补字幕、换音轨、删除、keep | Lifecycle |
| 配置自动推进范围 | 配置规则 | 定义哪些 gate / objective 可以自动创建 task，哪些必须用户介入 | Task Creator |
| 配置风险确认规则 | 配置规则 | 定义哪些 flow 节点必须等用户确认 | Flow Planner |
| 建设欧美成人演员库 | 配置规则 | 建立人物身份、reference face、别名和识别知识库，提升后续识别能力 | Lifecycle facts / People Library |
| 修改成人番号 | 纠正机器判断 | 机器无法可靠识别成人影片身份 | Lifecycle facts / Flow Planner |
| 选择正确电影/剧集身份 | 纠正机器判断 | 外部 ID、标题、季集匹配不确定 | Lifecycle facts / Flow Planner |
| 命名 unknown face | 纠正机器判断 | 机器无法判断演员/人物身份 | Lifecycle facts / Flow Planner |
| 选择 scrape / metadata 候选 | 纠正机器判断 | 多个元数据候选都可能正确 | Flow Planner |
| 选择 upgrade / subtitle / audio 候选 | 纠正机器判断 | 多个实现候选都可能满足 objective | Flow Planner |
| 确认删除媒体 | 授权风险动作 | 允许破坏性删除以达成 optimize objective | Flow Planner |
| 确认替换原文件 | 授权风险动作 | 允许覆盖当前媒体文件 | Flow Planner |
| 确认移动/重命名目录 | 授权风险动作 | 允许改变文件组织结构 | Flow Planner |
| 确认覆盖 NFO/封面 | 授权风险动作 | 允许覆盖已有元数据文件 | Flow Planner |
| 确认画面/音频兼容性处理 | 授权风险动作 | 允许可能改变媒体表现的处理路径 | Flow Planner |
| 提高/降低 task 优先级 | 调度已有任务 | 改变已有 task 的运行顺序 | Task Scheduler |
| 暂停 task | 调度已有任务 | 暂停已有 task 的运行机会 | Task Scheduler |
| 继续/启动 task | 调度已有任务 | 让已有 task 重新获得运行机会 | Task Scheduler |
| 取消 task | 调度已有任务 | 停止已有 task | Task Scheduler |
| 放弃/标记无需处理 | 失败处理 | 用户接受不继续处理，并形成可解释状态 | Lifecycle / Flow Planner |

边界约束：

- 用户调度权限只作用于 task 级：priority、暂停、继续/启动、取消。
- 用户不直接调度 flow step、event、resource bucket、worker lease 或 FFmpeg/MoviePilot/Emby 队列。
- 单个媒体不开放 objective 覆盖。Objective 由 Lifecycle 规则产生；用户要改变目标，应修改规则/策略配置，而不是在 item 上临时改目标。
- retry、resume、fallback 等 flow recovery 细节不作为用户直接介入场景暴露。用户看到的是失败原因和可理解的处理选择；内部如何恢复由 Flow Planner 按 recovery contract 决定。
- 运维干预不属于媒体处理旅程的人工介入范围。暂停自动化、降低并发、切换 worker、修外部依赖、清理磁盘等属于系统维护/配置。

## 3. 全自动模式

全自动模式的定义：

```text
在用户预先配置规则和授权范围后，系统可以不依赖运行时人工介入，自行推进允许范围内的媒体从 discovered 到 archived。
```

全自动模式不是“没有任何规则”，也不是“所有风险都自动执行”。它是用户提前配置好规则与授权后，运行时尽量不打断用户。

全自动模式下：

- 配置规则仍需要用户事先完成。
- 纠正机器判断尽量通过规则、缓存、演员库和置信度阈值自动完成。
- 授权风险动作由配置预授权；未预授权的动作必须停下。
- 任务调度由系统按 priority 自动完成。
- 失败处理由 Flow Planner 按 recovery contract 自动处理允许范围内的失败；不可自动恢复时必须停在可解释状态。

## 4. 全自动模式配置组合

全自动模式本质上是用户可介入白名单中的一组预授权配置。

| 配置项 | 全自动含义 |
| --- | --- |
| metadata gate 配置完成 | 系统知道什么叫“元数据完整” |
| optimize objective 规则配置完成 | 系统知道每类媒体最终应该变成什么 |
| 自动推进范围配置完成 | 系统知道哪些 gate / objective 可自动创建 task |
| 风险动作预授权配置完成 | 系统知道 delete / replace / move / overwrite / 画面处理等哪些可自动执行 |
| 机器判断阈值配置完成 | 系统知道 metadata/identity/候选/演员匹配达到什么置信度可自动接受 |
| 失败自动处理策略配置完成 | 系统知道哪些失败可自动处理，哪些必须停下 |
| People Library / 缓存足够 | 成人库识别能减少运行时人工判断 |

## 5. 全自动模式允许自动完成的事情

在配置允许且 facts 足够时，全自动模式可以自动完成：

- 自动 ingest。
- 自动 metadata repair / scrape。
- 自动接受高置信度 metadata / identity 候选。
- 自动根据 optimize objective 创建 optimize task。
- 自动选择 flow implementation operation。
- 自动执行 transcode / upgrade / delete / remux / subtitle / audio 等 flow operation。
- 自动 archive。
- 自动按 priority 调度 task。
- 自动处理 recovery contract 允许的可恢复失败。

这里的 `transcode`、`upgrade`、`delete`、`remux`、`subtitle`、`audio` 都是 Flow Planner 为达成 optimize objective 选择的 operation，不是 task 目标。

## 6. 全自动模式必须停下的事情

全自动模式必须在以下情况停下，并给用户可解释的待处理/失败状态：

- metadata gate / optimize objective / archive gate 配置不完整或自相矛盾。
- metadata gate 未覆盖 optimize objective 消费的输入字段。
- 机器识别低置信度或多候选冲突，且没有达到自动接受阈值。
- 成人 unknown face / protagonist 无法确定，且当前规则要求身份明确。
- 需要未预授权的风险动作，例如 delete、replace、move、overwrite 或画面/音频兼容性处理。
- Flow 多次失败，且 recovery contract 不允许继续自动处理。
- 外部依赖不可用，导致系统无法可靠判断或执行。
- Resource Runtime 安灯信号表明系统处于不可继续自动推进的拥塞或降级状态。

停下不是失败的产品缺陷。停下必须可解释，不能乱跑、不能无限重试、不能绕过配置。

## 7. v3.1 交付标准

v3.1 必须交付可用且符合预期的全自动模式。

交付标准：

- 用户可以配置 metadata gate、optimize objective、自动推进范围和风险确认规则。
- 用户可以理解当前是否处于全自动模式，以及哪些事项仍会要求人工介入。
- 系统可以在允许范围内自动创建 task，并从 discovered 推进到 archived。
- 系统不会把 flow operation 当成 task target 或 gate objective。
- 系统不会在未预授权情况下自动执行高风险动作。
- 系统遇到无法自动判断或无法自动恢复的事项时，会停在任务中心/确认台/失败队列中的可解释状态。
- Dashboard / Task Center / Resource View 能解释全自动模式为什么在动、为什么停下、停在哪个 gate / objective / flow / resource。
- 全自动模式不能绕过 Task Creator、Lifecycle gate、Flow Planner recovery contract 或 Resource Runtime 安灯信号。

## 8. 和当前实现的关系

当前代码的判断口径：

- 自动触发入口由 `SmartTaskEngine` 扫描 lifecycle projection，并统一经过 `TaskAdmission`。
- 准入规则主要在 `TaskAdmission` / `BusinessFlowPolicy`。
- flow path 只能作为 `selectedFlow/flowKind` 表达，不能反向成为 task target 或用户业务目标。
- Resource Runtime 仍是物理执行投影，不拥有业务 objective。

人工/自动边界和全自动模式验收必须按本文定义判断。
