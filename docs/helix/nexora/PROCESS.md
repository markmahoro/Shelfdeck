# Nexora Development Process

Status: current Nexora domain process.

本文定义在 Helix Architecture 下推进 Nexora Source Management 的工作方式。目标是避免两类问题：

- 把 Kairox `ingest/delete/source_missing` 换名后误报为 Nexora。
- 把 source reality、Membership、Kairox lifecycle 再次混在同一条 runtime 主路径里。

## 1. Process Summary

Nexora 使用三阶段流程：

```text
Design
-> Implementation
-> Audit
```

Design 形成当前域合同。Implementation 开发 Nexora 域并接入 Kairox。Audit 证明 Nexora facts 和 Kairox lifecycle 没有互相串门。

## 2. Design Order

Design 顺序固定为：

```text
Architecture Hypothesis
-> Code Reality Review
-> Architecture Contract
-> Work Thread Plan
```

当前 contract 是：

```text
docs/helix/ARCHITECTURE.md
docs/helix/nexora/ARCHITECTURE.md
```

## 3. Work Thread Model

Nexora implementation 不是重写 Kairox。它只做：

- 建立 Membership / SourceBinding 最小事实。
- 建立 source observation / debounce。
- 建立 Kairox eligibility bridge。
- 隔离 Kairox legacy `ingest/delete/source_missing` 语义。

执行线程只有三个：

```text
1. Nexora Core + Nexora E2E
2. Nexora + Kairox Integration
3. Full Business E2E
```

每个线程必须包含：

- implementation。
- static audit。
- automated tests。
- E2E / production-like evidence，或说明为什么不适用。
- status update。

详细任务清单只放在 `docs/helix/nexora/SLICES.md`，不要新建并行计划文档。

## 4. Audit Rules

Audit 必须检查：

- `targetGate=ingest` 是否仍决定入库。
- `targetGate=delete` 是否仍决定出库。
- `source_missing` 是否仍由 Kairox lifecycle 直接解释。
- Kairox 是否修改 Membership / SourceBinding。
- Nexora 是否修改 Kairox basedata / metadata / optimize lifecycle。
- Resource evidence 是否被错误解释为 Nexora facts。

## 5. Clean-Cut Rules

Helix clean runtime 不包含 migration、dual read 或 compatibility adapter。旧概念只允许出现于：

- historical documents。
- negative tests。

发现旧 schema/config 时必须返回 `HELIX_CLEAN_INIT_REQUIRED`。初始化工具必须显式 dry-run/apply、先备份，只清理 ShelfDeck-owned state，且不得写 Emby 或媒体目录。

## 6. Completion Report Format

Codex 完成 Nexora 线程时，最终回复必须包含：

```text
Scope
Changed files
Contract impact
Legacy impact
Audit evidence
Open questions
```
