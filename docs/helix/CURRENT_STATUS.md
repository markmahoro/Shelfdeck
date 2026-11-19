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
| 记录日期 | 2026-11-20 |
| 镜像 tag | `markmahoro/shelfdeck:helix-beta-20261120-90671f13f0` |
| Source commit | `90671f13f0e00f46a0d811f69a5d68437c64fec8`（branch `main`） |
| Tar SHA-256 | `eb5e45f27f3477f6c0e4675360e01696673f57ec68ee82babc34c523152a2c1f` |
| NAS ImageId | `sha256:d4911501168b8e54890cc76df93f9f949ed469dd99531a01635895c481316ac7` |
| Runtime | `heavy` (`192.168.12.215:18080`) `mode=running`；`normalSupplyAllowed=true`；revision **69** |
| 备注 | 合并 10 个 20261119 迭代分支（PR #67/#69/#72/#73/#74/#75/#76/#77/#78/#79）至 main 并修复代理下 ONNX Runtime CUDA EP 安装与 /usr/bin/ffprobe 包装；升级前全量冷备落盘 /srv/shelfdeck/operator-backups/pre-deploy-20261120-90671f13f0/（含 SHA-256 校验）；授权离线收口历史 Aftercare 残留 TLII-068（unresolved）与 3 个遗留 .230 intel_qsv Aftercare Case（invalidated），清理 9 个无 DB 引用孤儿 .shelfdeck-* 暂存目录（约 6.6 GiB）；执行正式 Runtime Formation Reset（generation c38d6ac78364ce06ad2abdc5722f897dd49ed9b6b462c61c23b4f63bc864fa87，回收 140 个临时 workspace 条目共约 30.86 GiB，清除未完结 Libra/On-deck/People/Procurement/熔断残留）并完成 Resume；804 active + 2 offdecked 入架馆藏完好，local-nvidia-nvenc-0 与 local-software-cpu-0 均 ready；完整入藏 E2E 未宣称 |

此后若 NAS 现网 tag 与上表不一致，以授权部署回写或只读核验结果为准再更新本表；**不要**把开发检查点堆回本文件。

## 写入规则

1. 只追加/替换**一次部署身份**与必要验收边界（备份、回退限制、明确未测项）。
2. 过程日志与验收编号流水 → `implementation/evidence/`；编号不作排期语言。
3. 产品版本 / Changelog → `docs/v3/VERSIONING.md` + 根 `CHANGELOG.md`。
