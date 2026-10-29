# ShelfDeck / Helix 文档索引

导航 only。活工作 = GitHub PR（根 `AGENTS.md` PR-ledger）。禁止用「UAT」「Phase」作排期或默认 backlog。

**默认 agent 读序：** 架构 SSOT + 根 `AGENTS.md` PR-ledger only。Playbook / Status / Plan / Phase **不是**日常默认。

生产部署身份以精简 [`CURRENT_STATUS.md`](CURRENT_STATUS.md) 为准（部署后回写）；历史 Status 流水见该路径 stub 前的 git history。

## 默认权威

| 文档 | 用途 |
| --- | --- |
| [TOP_DOWN_ARCHITECTURE_CONFIRMATION](TOP_DOWN_ARCHITECTURE_CONFIRMATION.md) | 唯一架构 SSOT |
| 根 [AGENTS.md](../../AGENTS.md) | Agent 记忆 + PR-ledger |

可选薄目标：[CURRENT_PLAN](CURRENT_PLAN.md)（一行产品/发布目标，非工作项列表）。

## 按需

| 文档 | 何时 |
| --- | --- |
| [ENGINEERING_PLAYBOOK](ENGINEERING_PLAYBOOK.md) | UI / 部署授权 / 变更治理具体 § |
| [CURRENT_STATUS](CURRENT_STATUS.md) | 生产镜像身份核验或部署回写 |
| [BETA_FEATURE_ACCEPTANCE_BASELINE](BETA_FEATURE_ACCEPTANCE_BASELINE.md) | Movie-only Beta DoD |
| [../v3/VERSIONING.md](../v3/VERSIONING.md) / 根 [CHANGELOG.md](../../CHANGELOG.md) | 产品版本 |

## 遗留 / 追溯（非默认读）

| 文档 | 说明 |
| --- | --- |
| [implementation/CURRENT_PHASE](implementation/CURRENT_PHASE.md) | legacy stub；全文见 [archive/CURRENT_PHASE_LEGACY_PACKET_THROUGH_20261021.md](implementation/archive/CURRENT_PHASE_LEGACY_PACKET_THROUGH_20261021.md) |
| [UAT_ITERATION_REGISTER](UAT_ITERATION_REGISTER.md) | 上线后问题编号；Evidence 键 only |
| [implementation/evidence/](implementation/evidence/) | 按工作项打开；勿整目录塞进读序 |

冲突处理：以 **SSOT** 为架构权威；工程门禁打开 Playbook 对应 §；活工作以 **PR** 为准。Helix 高于历史 v3/Kairox、v2 架构与归档；部署/debug 流程按 `docs/v2/` 适用范围使用。

## 历史与证据

- STATUS 长叙事：本路径 git history（见 `CURRENT_STATUS` stub 内 `git show`）。
- Legacy phase 包：[implementation/archive/CURRENT_PHASE_LEGACY_PACKET_THROUGH_20261021.md](implementation/archive/CURRENT_PHASE_LEGACY_PACKET_THROUGH_20261021.md)
- [Movie 收尾快照](implementation/archive/20260930_BETA_MOVIE_CLOSEOUT/SNAPSHOT.md) 不能指导当前实施。
- [implementation/archive 索引](implementation/archive/README.md)；已关闭审查：[`archive/reviews/`](archive/reviews/)；历史 issue log：[`archive/issue-logs/`](archive/issue-logs/)；早期 canary：[`archive/acceptance-early/`](archive/acceptance-early/)。
- 根目录 issue-log / review 文件仅为指针 stub。

生产、Formation Reset 与真实媒体副作用继续按明确授权及精确范围执行。不删除历史 Evidence。
