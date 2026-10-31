# ShelfDeck 当前状态（精简入口）

本文件是**生产部署身份**的写入点：仅在授权标准部署后更新，或在明确要求核验现网身份时读取。  
**不是** agent 默认读序、不是活 backlog、不记录开发流水。

默认 agent 读序：架构 SSOT + 根 `AGENTS.md` PR-ledger only（见 AGENTS）。Playbook / Plan / Phase **非**日常默认。

历史叙述全文（stub 前）保留在 git：

```bash
git show f096af1b40cf71a4ce26f0441c686f7f36e707bc:docs/helix/CURRENT_STATUS.md
```

活工作台账 = GitHub PR。可选产品/发布目标一行写在 [`CURRENT_PLAN.md`](CURRENT_PLAN.md)。

## 最近已记录生产身份（仓库 Status 行）

| 字段 | 值 |
| --- | --- |
| 记录日期 | 2026-10-31 |
| 镜像 tag | `markmahoro/shelfdeck:1.1.0` |
| Source commit | `623e71353c6ec7cd238741816b8829844b19d56f`（PR #49 name-first People bind） |
| Tar SHA-256 | `038bee328e39b70eabfe8e03bebbfc9a0bfddd0e554d62304084ffc60de80cfd` |
| NAS ImageId | `sha256:c9c563c14b315897e5892317583b816e0293af0fe3bfcd909220de0c43b3b795` |
| Runtime | `mode=running`；`normalSupplyAllowed=true`；revision **51** |
| 备注 | 标准 safe-stop → build/upload/deploy → Formation Reset（17→0）→ Resume；TLII-047 Tia Ling 身份步 done、无 `buffalo_reference_required`；完整入藏 E2E 未宣称 |

此后若 NAS 现网 tag 与上表不一致，以授权部署回写或只读核验结果为准再更新本表；**不要**把开发检查点堆回本文件。

## 写入规则

1. 只追加/替换**一次部署身份**与必要验收边界（备份、回退限制、明确未测项）。
2. 过程日志与验收编号流水 → `implementation/evidence/`；编号不作排期语言。
3. 产品版本 / Changelog → `docs/v3/VERSIONING.md` + 根 `CHANGELOG.md`。
