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
| 记录日期 | 2026-10-30 |
| 镜像 tag | `markmahoro/shelfdeck:1.1.0` |
| Source commit | `f01af83cae01e6d1e697e0883723bf0a53564407`（含 #31–#35 + #38） |
| Tar SHA-256 | `0fa5d7fdfef09a677dd4ba738f7cd8d84f1255f04c65f03ce40486792a731a93` |
| NAS ImageId | `sha256:98b4cfba3008b6fe5a062ffc48ec02b74752946ba7ab597f4d45ee62c7a5bb2f` |
| E2E / 验收边界 | 产品安全停机 → 标准 deploy → 官方安全 Formation Reset（18/20，FK=0）→ #34 维护重建 30 markers → US Adult catalogue 卷挂载 → Resume；health ok / Formation ended 200；完整生产媒体功能抽查未新增 |
| 备注 | 版本号仍 1.1.0（未发明 hotfix）；catalogue compose 挂载为 deploy 后补丁，下次 deploy-nas 须保留 |

此后若 NAS 现网 tag 与上表不一致，以授权部署回写或只读核验结果为准再更新本表；**不要**把开发检查点堆回本文件。

## 写入规则

1. 只追加/替换**一次部署身份**与必要验收边界（备份、回退限制、明确未测项）。
2. 过程日志与验收编号流水 → `implementation/evidence/`；编号不作排期语言。
3. 产品版本 / Changelog → `docs/v3/VERSIONING.md` + 根 `CHANGELOG.md`。
