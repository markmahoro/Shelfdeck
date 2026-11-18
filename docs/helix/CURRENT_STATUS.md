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
| 记录日期 | 2026-11-19 |
| 镜像 tag | `markmahoro/shelfdeck:helix-beta-20261119-515d19b38a` |
| Source commit | `515d19b38ae6b146ff6918872785e6ba555cf311`（branch `sd/heavy-migration-cutover-20261119`） |
| Tar SHA-256 | `ae63003579b7136b0384e37f8de2667063cf8970d3cc6ba9762685675faa1782` |
| NAS ImageId | `sha256:de67585639d087083438c56f74d36c64758c6958e509b6b93b6212587aa776a6` |
| Runtime | `heavy` (`192.168.12.215:18080`) `mode=stopped`；`normalSupplyAllowed=false`；revision **62** |
| 备注 | 正式落盘 SSD `/srv/apps/shelfdeck/data` (`/dev/sdc1`) + HDD `/srv/shelfdeck/{transcode,operator-backups}` (`/dev/sdb1`)；4 个活跃 Aftercare workspace（29 文件）重绑 `/dev/sdc1`；`network-main`、`tmdb-main` 及 8 个 `jav-*` 源切换至 `http://192.168.12.219:7890`；804 入架条目完好；`software_cpu` ready，`nvidia_nvenc` 待宿主驱动升级 `>=610` 或容器 FFmpeg 降级决策（镜像内 FFmpeg 9.0.2 需 NVENC API 13.1，宿主 `535.309.01` 为 12.1）；待确认后再 Resume；完整入藏 E2E 未宣称 |

此后若 NAS 现网 tag 与上表不一致，以授权部署回写或只读核验结果为准再更新本表；**不要**把开发检查点堆回本文件。

## 写入规则

1. 只追加/替换**一次部署身份**与必要验收边界（备份、回退限制、明确未测项）。
2. 过程日志与验收编号流水 → `implementation/evidence/`；编号不作排期语言。
3. 产品版本 / Changelog → `docs/v3/VERSIONING.md` + 根 `CHANGELOG.md`。
