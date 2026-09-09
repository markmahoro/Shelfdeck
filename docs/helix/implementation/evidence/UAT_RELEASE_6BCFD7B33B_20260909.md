# UAT-172 标准生产发布证据

2026-09-09。用户既有实施/本地验收后标准NAS发布授权持续有效，允许中断FFmpeg。本次修复正式Input Settlement Authorization执行与实际授权入口；没有修改生产授权、SQL或媒体数据。

## 发布身份与回滚

- source：`6bcfd7b33b`；镜像`markmahoro/shelfdeck:helix-beta-20260909-6bcfd7b33b`。
- NAS config Image ID：`sha256:17ffbd63935cc9cf69845fa817d68e3673d5271bc5ed3db23d547edd4dd1ebfe`；StartedAt：`2026-09-09T01:56:28.414159717Z`。
- tar：`/vol1/1000/docker/shelfdeck/shelfdeck-helix-beta-20260909-6bcfd7b33b.tar`；SHA256：`8f7b91de20c23197994979873fd7a507060a2a17fd6bb832f6be6042030e8d73`。
- 一致性备份：`/vol1/1000/docker/shelfdeck/backups/uat-iteration-20260909-6bcfd7b33b-predeploy`；数据库SHA256：`cc7ccafa7d37fb4e51b5ad927f7354f71b85b76ad3dcc32e0e2bcdc95042caf5`。只读SQLite在线备份完成并下载到`.codex/uat-backup-6bcfd7b33b-predeploy`复核hash；Compose、secret.env、Admin Secret及3个加密Integration envelope一并保存，无Secret写入仓库。
- 回滚保留`markmahoro/shelfdeck:helix-beta-20260909-48077d71bd`及前版tar、备份。本次Schema未变；必要时对前版tar使用相同`deploy-nas.js --sha256 d7f6869f6fab37494a4f34dee890530e8d297a9e78403cc3e5bea683884ad155`先dry run再apply，不默认恢复数据库。

## 标准步骤与证据

fnOS只读preflight通过，/vol1约56GiB可用；原镜像running。生产备份中79个成功On-deck Work、14个历史failed、无running On-deck Work；持续授权revision 1 enabled且范围old_primary_and_exclusive_related。没有为改动输入绑定迁移旧Work或原地改写历史失败。

在clean发布worktree构建；发布worktree缺少上传脚本本地ssh2依赖，改用集成worktree中相同已提交脚本上传同一tar，远端SHA256通过。标准dry run、runtime readiness、Compose重建、health、Admin、/media、/upgrade、/dev/dri和无源码覆盖挂载检查全部完成。启动期短暂connection reset，随后health返回status=ok；不把启动过渡误报为持续故障。

部署前2026-09-09T01:53:04.699Z与部署后01:57:53.111Z六路GET全部200：79收藏；Formation total75/inProgress1/attention1/completed73/ended3；Care44完成/11结束；Recycle4。两次同口径计数一致。01:57:53.335Z正式Readiness仍为原授权revision 1 enabled、包含exclusive Related；没有重新POST生产授权。

生产浏览器使用只读本地代理（拒绝全部非GET）加载NAS实际资产与API，收藏架配置显示“旧输入自动清理 · 已授权”、完整范围说明及79部收藏；未点击生产撤销。隔离真实Host浏览器则实际完成grant/revoke，两次POST200，证明按钮接入正式入口。

新镜像本身（不覆盖src）真实Direct HEVC完整链36.95秒PASS，六项检查通过、0失败、无转码或remux，19项名称过滤SKIP。此项补足构建包实际运行核验；Windows/Linux完整授权正负向及ISO撤销重启链见[172验收](UAT-172_AUTHORIZATION_ACCEPTANCE_20260909.md)。

启动后抽样日志47行仍有既有P4_EVENT_RECOVERY_INPUT_DRIFT（9次匹配），未发现新的授权错误代码；125/250保持开放，本发布不宣称修复该问题。`media-desktop`无上述授权/模式字段消费者，也未更改Desktop代码。

日志：`.codex/uat172-{preflight,build-image,backup,upload,dry-run,apply,production-startup,release-image-check}.log`；生产快照`.codex/production-monitor.jsonl`、`.codex/uat172-predeploy-snapshot.json`及`.codex/uat172-authorization-postdeploy.json`。

UAT-172按其现行条件验收关闭；累计43项本轮功能关闭、56项开放，206承接已核实。
