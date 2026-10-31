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
| Source commit | `943d874aa6380daa1967d6afeba5232dbb462685`（#59 Formation Reset People image reclaim） |
| Tar SHA-256 | `4f2e849673cb6751e102c3cac84cb303b48219b1850ddcffde547240a44fd6f5` |
| NAS ImageId | `sha256:139eddf6ec9c89fcb0bdad4158a83d8f19d18dc676757c805555f52330f8ddfc` |
| Runtime | `mode=running`；`normalSupplyAllowed=true`；revision **59** |
| 备注 | 标准 build/upload/deploy + 安全 Formation Reset（People reclaim 1→0）+ Resume PASS；先验 `PLAN_CATALOG_DRIFT` 已清；脸库/builtin buffalo 仍在；US Adult Layer-3 pulse：3 western `identity=done`、无 buffalo hang/drift，poster/shelf 仍 pending；证据见 Project store `docs/deploy-post-59-run.md` |

此后若 NAS 现网 tag 与上表不一致，以授权部署回写或只读核验结果为准再更新本表；**不要**把开发检查点堆回本文件。

## 写入规则

1. 只追加/替换**一次部署身份**与必要验收边界（备份、回退限制、明确未测项）。
2. 过程日志与验收编号流水 → `implementation/evidence/`；编号不作排期语言。
3. 产品版本 / Changelog → `docs/v3/VERSIONING.md` + 根 `CHANGELOG.md`。
