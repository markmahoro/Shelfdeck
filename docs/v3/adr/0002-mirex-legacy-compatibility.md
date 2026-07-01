# ADR 0002: 命名旧兼容模型为 Mirex

## Status

Accepted.

## Context

Kairox 被命名为 v3.1 架构契约后，剩余风险是 Kairox 之前的旧实现仍然缺少清晰名字。

“旧逻辑”“legacy action”“兼容行为”这些说法太模糊，容易让后续实现一边声称只是保持兼容，一边继续扩张旧模型。

旧模型有以下特征：

- `actionType` 拥有 task 主语义。
- `transcode`、`upgrade`、`delete` 被当成 task 类型。
- Task、Flow、Event 边界经常折叠在一起。
- Scheduler、SmartTask、admission 和 executor 都可能承载业务判断。
- Resource 和 event facts 相比 Kairox 的 event/resource 模型不完整。

## Decision

将 Kairox 之前的旧兼容模型命名为：

```text
Mirex
```

定义：

```text
Mirex 是 Kairox 之前 ShelfDeck 的 legacy compatibility model。
```

Mirex 不是未来架构，也不是 Kairox 的替代选项。它只是一个用于识别、迁移和约束旧行为的名字。

## Consequences

- Kairox 代码可以为了 backward compatibility、migration 和 rollback 读取或写入 Mirex 字段。
- 新行为不能从 Mirex 字段派生用户语义。
- `actionType` 和 operation 名称继续作为 compatibility hints，除非被明确转换成 Kairox target facts。
- 文档或代码冲突时，除非正在处理明确的兼容或迁移工作，否则以 Kairox 为准。
- 后续清理可以使用“Mirex compatibility removal”表达，不再使用含糊的“old logic cleanup”。
