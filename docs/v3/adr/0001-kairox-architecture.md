# ADR 0001: 命名 v3.1 架构契约为 Kairox

## Status

Accepted.

## Context

ShelfDeck v3.1 推进过程中，已经形成了一组重要架构约束：

- 单 item task 的主语义从旧 `actionType` 收敛到 `object + targetGate + gateObjective`。
- Lifecycle gate 拥有用户语义，Flow operation 只是实现路径。
- 自动 task 创建必须经过统一 TaskAdmission / Task Creator 语义。
- metadata gate 是 scrape exit gate，并且必须覆盖 optimize objective 输入。
- 全自动模式是预授权配置组合，不是另一套执行链路。
- Scheduler 和 Resource Runtime 不应继续承载新的业务目标判断。
- Service 拥有 orchestration，desktop 是 thin client，worker 是被动计算节点。

这些结论分散在 `BUSINESS_MODEL_NOTES.md`、`USER_INTERVENTION_AND_FULL_AUTO.md`、`V3_1_DISCUSSION_NOTES.md` 和 `V3_1_PROGRESS.md` 中。继续实现时，如果没有一个专有名称，后续 agent 或人类维护者容易把讨论结论理解成局部建议，而不是架构合同。

曾考虑使用 `Alpha Architecture`，但 `alpha` 容易被误读为 alpha release、早期实验版或不稳定版本，和本文想表达的“已收敛架构约束”相反。

## Decision

将 ShelfDeck v3.1 演进阶段的命名架构契约称为：

```text
Kairox Architecture
```

中文表述：

```text
Kairox 架构
```

`Kairox` 是项目内部造词，不对应常见技术术语或 release 阶段，用于降低误解概率。

正式定义：

```text
Kairox 架构是 ShelfDeck v3.1 演进阶段的命名架构契约，用于固定 Lifecycle、Task Creator、Flow Planner、Resource Runtime、全自动模式、用户介入、生产安全和模块边界的核心实现方向。
```

主契约文档为：

```text
docs/v3/KAIROX_ARCHITECTURE.md
```

## Consequences

- 后续修改 scheduler、task admission、automation、flow executor、resource runtime、production deployment 或模块边界前，必须先读 Kairox 文档。
- 讨论中可以直接使用“符合 Kairox”或“违反 Kairox”来判断方向。
- 若未来架构方向需要改变，必须更新 `KAIROX_ARCHITECTURE.md`，并用 ADR 记录为什么改变。
- `docs/v2/ARCH_OVERVIEW.md` 继续记录当前代码已经落地的架构事实；Kairox 负责约束 v3.1 之后继续演进的方向。
