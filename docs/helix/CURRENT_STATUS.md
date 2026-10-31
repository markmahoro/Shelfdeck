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
| Source commit | `cf852a4f72626fdaf9bc1a50feb8d16379d2fb7a`（Merge #64；含 #65 TPDB retry/wait） |
| Tar SHA-256 | `de31fd9e084f60ce5c7b5cdf0290b91a619b10b8c7d62e953056b25fc7bd5cc6` |
| NAS ImageId | `sha256:8f516e2d90fd6e768cea906aa569a74d1709cb5658b0e074ba1cb274140d5ece` |
| Runtime | `mode=running`；`normalSupplyAllowed=true`；revision **59** |
| 备注 | 标准 build/upload/deploy → 全量安全 Formation Reset（18→0）→ Resume；L3 no silent `PROVIDER_PENDING` hang PASS；本窗 TPDB HTTP 500 → Attention fail-closed；未宣称健康 TPDB 成功推进 / 完整入藏 E2E |

此后若 NAS 现网 tag 与上表不一致，以授权部署回写或只读核验结果为准再更新本表；**不要**把开发检查点堆回本文件。

## 写入规则

1. 只追加/替换**一次部署身份**与必要验收边界（备份、回退限制、明确未测项）。
2. 过程日志与验收编号流水 → `implementation/evidence/`；编号不作排期语言。
3. 产品版本 / Changelog → `docs/v3/VERSIONING.md` + 根 `CHANGELOG.md`。
