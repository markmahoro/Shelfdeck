# Arca 目标目录占用：rename-own-write 设计问题陈述（2026-10-30）

Status: **design / problem-statement only** — 本 PR 不含运行时实现与部署。

## Problem（用户确认）

目标标题目录 **不是** Arca 独占空间。目录内第三方字幕、孤儿 `.nfo`、其它合法但未纳入本 Run Control 的文件不得整夹拒写、不得冻结整个 On-deck。

若 ShelfDeck 拟定写出的文件名与 **非本域拥有** 的既有文件冲突：必须 **重命名本侧 outbound** 并继续写入；禁止覆盖外来文件；允许同目录最终出现两份 `.nfo`（旧文件保留 + Arca 新文件使用非冲突名）。Arca Inventory / Control **只记录自己写出的成员**。

现场对照：DDOB-019 — `CLEAN_ARCA_STAGE_TARGET_OCCUPIED`，长标题目录残留同名 `.nfo`；应留下孤儿并写出非冲突名，而不是 attention 冻结。

## 审计结论（摘要）

完整审计见 Project store：`docs/arca-target-occupancy-compat-audit.md`（本机绝对路径见该 PR / 协调回复）。

1. **首次 On-deck stage 并不是 `readdir` 整夹 closed-world**；它对 **计划成员目标路径** 做指纹冲突预检。异名外来文件今天已不挡 stage。缺口是：**同名外来字节 → 终态占用冻结**，而不是 rename。
2. 诊断字段复用 `unknownNames` / `unknownMemberCount`，易被读成“整夹未知成员”；实际 stage 上报的是 **冲突的计划路径 basename**。
3. **真整夹独占** 在别处：JAV short 目标目录必须不存在；JAV 纠正 / US Adult 发布 / Series root 搬迁 / Aftercare settlement 等 closed-world。不可与首次 On-deck 混成一刀切。
4. Settlement（PROD-065 D3 / 历史 narrowing）已按“只结算授权文件、旁系保留”收紧；整夹拒写的兼容债主要是 **attention/recheck UX** 与 **operator quarantine 脚本**，不是引擎内大规模 mid-state dual-write。
5. Placement `collisionPolicy`（`reject`|`suffix`）今天只处理 **包内重名**，不处理 **盘上外来同名**。

## 拟议合同增量（待用户确认后改 SSOT §5.5.10）

解析 Final Inventory Decision 时对照当前现实：对非本域拥有的同名占用，**确定性后缀重命名本侧 `finalName`** 并冻结进 Decision；不得再因该污染抛 `CLEAN_ARCA_STAGE_TARGET_OCCUPIED`。Commit 仍只入库 Decision 成员。

## 非目标（本设计默认排除，另开确认）

- JAV 纠正、US Adult 发布、Series root 搬迁、Aftercare settlement 的 closed-world 规则一并改写
- 覆盖外来文件、把孤儿并入 Inventory、静默扫描 Shelf Target 当 Field 再 Procurement
- 为旧 blocked Run 增加 mid-state 兼容双写（清理靠安全 Reset / recheck）
- 本 PR 实现代码或生产部署

## 阻塞实现的开放问题

1. `poster.jpg` / `fanart.jpg` 固定名是否也后缀，还是仅 primary / nfo / subtitle？
2. “拥有”以本 Shelf Entry 当前 Inventory 为准，还是更宽？
3. Shelf `collisionPolicy=reject` 是否仍允许“外来同名则冻结”，还是产品强制始终 rename？
4. JAV short：保持空目录独占，还是允许写入已存在目录并 rename？

## 推荐交付切分

| 阶段 | 内容 |
| --- | --- |
| A（本 PR） | 问题陈述 + 审计结论 + 非目标 / 开放问题 |
| B（后续实现 PR） | 仅首次 On-deck 落盘（movie + 非 short JAV）：外来同名 → rename-own-write + 测试 |
| C | JAV short / 纠正 / US Adult / 退役 quarantine 文案 — 各自独立 PR |

**本轮选择：暂停大改实现，先确认问题陈述。**
