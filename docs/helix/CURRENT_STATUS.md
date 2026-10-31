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
| 记录日期 | 2026-11-01 |
| 镜像 tag | `markmahoro/shelfdeck:1.1.0` |
| Source commit | `2b67ddc065e8f96478fced7fb4556c428b1fb3c2`（#62 PROVIDER_PENDING fail-closed） |
| Tar SHA-256 | `83384917e0244cc24b63cbe6d974e517f760f12aadbf3b5f67c371c0c1b90db5` |
| NAS ImageId | `sha256:acf80a7d71a49dc13137293d208ae3f362f6f60310d2bc5158df582b4832271d` |
| Runtime | `mode=running`；`normalSupplyAllowed=true`；revision **59** |
| 备注 | 标准 build/upload/deploy + 全量安全 Formation Reset（subjects 19→0 / works 12→0）+ supply running；先验 tip 启动 `PLAN_CATALOG_DRIFT` 经 Reset 清除；L3：3 western `identity=done`、`silentProviderPendingHang=0`；证据见 Project store `docs/deploy-post-62-run.md` |

此后若 NAS 现网 tag 与上表不一致，以授权部署回写或只读核验结果为准再更新本表；**不要**把开发检查点堆回本文件。

## 写入规则

1. 只追加/替换**一次部署身份**与必要验收边界（备份、回退限制、明确未测项）。
2. 过程日志与验收编号流水 → `implementation/evidence/`；编号不作排期语言。
3. 产品版本 / Changelog → `docs/v3/VERSIONING.md` + 根 `CHANGELOG.md`。
