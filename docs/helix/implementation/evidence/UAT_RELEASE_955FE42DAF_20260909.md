# UAT-174/175/167 发布与关闭

2026-09-09 04:09，source `955fe42daf`。

- Image：`markmahoro/shelfdeck:helix-beta-20260909-955fe42daf`
- NAS config Image ID：`sha256:252261f4e075ceb2e1b771c84c535c365fe6714b55c5fbea83c447e98a97eb48`
- Build manifest-list digest：`sha256:6a062f30f9d78ecd75d0f35cafa522660581549e0136a99ef6301082288083b2`
- Tar SHA256：`43b88bc21fa5bb6f67c0ad66fb0a7b5f723b13575f42ea1698cee67f7f3fe6ae`
- StartedAt：`2026-09-08T20:06:48.698378213Z`
- 一致备份：`/vol1/1000/docker/shelfdeck/backups/uat-iteration-20260909-955fe42daf-predeploy`，DB SHA256 `5a7835c9680193e96ccdd7c62fd621be07b4c2dab2b79a086536f57dc1e86261`，已下载并校验；Compose/Secret/Admin及3份加密Integration envelope保留。efd9387756镜像/备份保留回滚；本次无Schema变化。
- clean release worktree构建、标准upload/checksum/dry-run/readiness/apply、media/upgrade/transcode/adult/GPU挂载全部通过。只读NAS预检55GiB可用。构建初次9位短SHA被标准脚本拒绝，改为准确10位SHA后成功，没有绕过校验。
- 启动中提前一次资产读取尚未监听而失败；标准部署继续等待并通过health。04:07六路GET全部200，72收藏、1整理中/1待处理、66整理完成/3结束、44维护成功/11历史结束、4回收站，与04:05发布前计数相同。日志仍有既有P4_EVENT_RECOVERY_INPUT_DRIFT，125/250未关闭。
- 生产JS `/assets/index-DT9MqlLS.js` 430378 bytes，SHA256 `a1dae919fd0c1dbc05cd4c9bcf2ac45afb601882e9b8682982453a9335ca23e3`；CSS `/assets/index-dHf_jm9q.css` 53695 bytes，SHA256 `083bb0e2ec6b7ed08d48eac2868f4ce68e6f80a501878e31b926318dfaf3deba`。与真实隔离Host浏览器验收资产逐字节一致。
- 实际生产浏览器来源页：956已生成、83接收、865等待、8未接收，3占用/3席；展开编辑显示3并收起，没有修改生产配置。暂停保存操作在真实隔离Host完成，不能称作生产PATCH测试。

三项各自证据见[逐来源席位验收](UAT-167_174_175_FIELD_SEATS_20260909.md)。本轮累计37关闭，62项开放，206承接另核。原始记录`.codex/uat-release-955fe42daf-{build,upload,backup,preflight,dry-run,apply}.log`、`uat174-asset-parity.json`及`production-monitor.jsonl`。
