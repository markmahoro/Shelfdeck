# ShelfDeck Helix 当前实施阶段

状态：**PROD-033 ACTIVE — EXECUTION RESIDUAL RECOVERY**

日期：2026-08-31

## 目标

修复生产执行事实的两类不收敛：

1. Foundation 中父 Supporting Work 已终态、Work Attempt 仍活动的残留占满 active-attempt hard cap，阻断新的 Libra Routing Work；
2. Arca 已接受 Handoff B 后，同一 On-deck Run 的 `material_commit` 恢复长期停留在 executing，Formation 持续显示 `in_progress`。

## 边界

- 保持现行 ShelfDeck / Helix SSOT 的 Owner、Handoff 和 Canonical Transaction 不变。
- 终态 Work 的活动 Attempt 只允许在所有子 Event、Event Attempt 和 Effect 均已安全终态时有界收口；有任何未决 Effect 必须 fail closed。
- Handoff B Accepted 后只允许 Arca 对同一 On-deck Run 前向恢复；不得退回 Libra、伪造 rejected、删除业务事实或建立第二个 On-deck Run。
- 不直接删除、移动或改写 `/media` 正式媒体；所有生产变更必须先备份、dry run、校验并使用标准 NAS 部署链路。

## Exit Gate

- Foundation recovery、runtime host、full Libra reset 的负向与回归测试覆盖一致性修复。
- 两条既有 Arca On-deck Run 的 Effect reality 已核实，修复后由正式恢复链收敛或给出可审计的明确阻塞；不得靠清行隐藏。
- 服务测试、Admin Web 测试、SQLite integrity、image checksum、NAS health 通过。
- 生产复核：39 条假活动 Attempt 清零；3 条待整理不再因 hard cap 停滞；Formation 不再保留无事实支撑的 `in_progress`。
