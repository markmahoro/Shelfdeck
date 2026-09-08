# UAT-235 发布与独立关闭

2026-09-09 02:47。source `841cbcf0c7`，仅Shelf注销模态与局部CSS变更，未改变服务、Schema或desktop逻辑。

- Image：`markmahoro/shelfdeck:helix-beta-20260909-841cbcf0c7`
- NAS config Image ID：`sha256:19bea5f5ff2f067215ecaa092abd37b955f616748e547eeeec1d398b52965f8d`
- Build manifest-list digest：`sha256:505c1677045162f9bc1456cec344e2e0c481c754ffd13846a1345259f3db809e`
- Tar SHA256：`6de051421f8bac73a8b5c61029c49d41c9f69d4a1d3f4d66fe8e57a0544170a7`
- StartedAt：`2026-09-08T18:45:37.96025467Z`
- 一致备份：`/vol1/1000/docker/shelfdeck/backups/uat-iteration-20260909-841cbcf0c7-predeploy`，DB SHA256 `1f049e4d4b583eef6432f7255be4b251f9612d05b6c7ba9b6341f2c7872605dc`，下载校验一致；Compose/Secret/Admin凭据与3份加密Integration envelope完整。前版1a3f4254dc镜像与备份保留回滚。
- 发布前61GiB可用，无额外清理。clean detached release worktree构建、标准upload/checksum/dry-run/readiness/apply、健康/网页/媒体及GPU挂载验证通过，代码来自镜像。
- Web六项及TypeScript/build通过；Edge隔离模态真实点击、键盘、截图通过；生产新JS/CSS与隔离资产字节一致，生产实际打开收藏架无页面错误。按纯UI影响范围，没有无理由重复服务全套和desktop打包。
- 02:46六路GET200，70收藏、1整理中/1待处理、44维护完成/11历史结束、4回收站条目。启动日志仍出现既有P4_EVENT_RECOVERY_INPUT_DRIFT（本次读取两条），继续UAT-125/250定位，不吞错、不Reset或改生产冻结输入。

UAT-235按自身证据关闭；223文案此前独立关闭，228人物文案同期独立关闭，见各Evidence。本轮累计29关闭，70开放及206取代结果核实继续执行。

原始发布记录`.codex/uat-release-841cbcf0c7-{build,upload,preflight,backup,dry-run,apply}.log`、`.codex/uat235-asset-parity.json`与production-monitor.jsonl。
