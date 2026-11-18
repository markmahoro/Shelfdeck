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
| 镜像 tag | `markmahoro/shelfdeck:helix-beta-20261119-5be6fa6879` |
| Source commit | `5be6fa6879b9b0475cc0cb810594a814fe8c31e3`（branch `sd/heavy-migration-cutover-20261119`） |
| Tar SHA-256 | `d41e768664275ebcbb54ec67fdd7286f1587dbe39bd323e911c795e27f2f9d17` |
| NAS ImageId | `sha256:123bb0dd0326a9933355e918e3d8b2763588b44f92afb547bc5a85c3683a40bc` |
| Runtime | `heavy` (`192.168.12.215:18080`) `mode=stopped`；`normalSupplyAllowed=false`；revision **62** |
| 备注 | 正式落盘 SSD `/srv/apps/shelfdeck/data` (`/dev/sdb1`, `UUID=2e4fda48-ccbd-40cd-9b6b-1b66c4eb2dda`) + HDD `/srv/shelfdeck/{transcode,operator-backups}` (`/dev/sdc1`, `UUID=11cf7e64-e7fa-4573-8588-5afb97ce3854`)；Aftercare (`rev 4`, 4 个活跃 workspace / 29 文件) 与 Libra `/transcode` (`rev 3`) workspace roots 重绑启动盘序作用域；`network-main`、`tmdb-main` 及 8 个活跃 `jav-*` 源切换至 `http://192.168.12.219:7890`；804 入架条目完好；`heavy` 升级至 NVIDIA Open Driver `620.70.06` (`6.1.0-56-cloud-amd64`) 并对齐 FFmpeg 9 / Turing `TU117` NVENC 参数后，`local-nvidia-nvenc-0` (`ordinary_to_hevc@1` + `pq_bt2020_base_to_sdr_bt709_hevc@1`) 与 `local-software-cpu-0` 均 `ready`；保持 `stopped` 待确认后 Resume；完整入藏 E2E 未宣称 |

此后若 NAS 现网 tag 与上表不一致，以授权部署回写或只读核验结果为准再更新本表；**不要**把开发检查点堆回本文件。

## 写入规则

1. 只追加/替换**一次部署身份**与必要验收边界（备份、回退限制、明确未测项）。
2. 过程日志与验收编号流水 → `implementation/evidence/`；编号不作排期语言。
3. 产品版本 / Changelog → `docs/v3/VERSIONING.md` + 根 `CHANGELOG.md`。
