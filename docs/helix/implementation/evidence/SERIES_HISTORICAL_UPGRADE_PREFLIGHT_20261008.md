# Series 历史生产副本升级预检

日期：2026-10-08；源码基线 `f052fb6bc79a4d0f0cd160c307a7dd60cf886d15`。对应当前 Phase 节点5升级/回退；本次结果为安全拒绝，不是升级资格通过。

## 副本与隔离

仅以只读 SFTP 下载 NAS 已存在的 `backups/uat281-preapply-20260930-162230/data/shelfdeck.db`；它是2026-09-30历史备份，不代表当前生产状态。未创建远端文件，未重启、部署或修改生产。既有备份出处见 UAT-281_REMUX_PROBE_RETRY_CONVERGENCE_20260930.md。

数据库2157551616字节，远端与本地 SHA256 均为 `b0d8455ab87312a49f7e59dffd342d206432975584131040c95cb25e33ce7be9`；备份 WAL 为0字节。quick_check=ok，foreign_key_check=0。原副本保留，在另一个本地复制文件执行正式 migration，不启动 Host、不访问原媒体路径。

原 schema digest `14c18e017bfce8b78230d0509be1c46fb11c0da95a240396628173a9e71bed73`，catalog digest `9c598ca164b4b4242c4943c71419751c00a2e6dfa27108405893e8fb93c2ca5c`。含365个 active/single Shelf Entry、365个 committed On-deck Run；Libra Run 为active 3、completed 359、discarded 53、superseded 16。

## 正式入口结果

`migrateUatIdentitySelectionSchema` 拒绝，代码 `SERIES_OFFLOAD_FORMATION_RESET_REQUIRED`。拒绝后工作副本与原备份逐字节 SHA256 相同，schema/catalog marker不变，quick_check=ok，foreign_key_check=0；证明事务拒绝没有留下部分升级。

继续只读调用正式 Formation Reset `inspectPlan`，ready=false：

- `RETAINED_SUBJECT_ROUTING_ANCHOR_IN_RESET`：14条。
- `MATERIAL_CONTROL_OWNED_BY_NON_TARGET`：10条，涉及 Arca Shelf Entry 的控制事实。

没有执行 Reset，没有手动删除历史记录，没有绕过保护或放宽 migration。故没有执行成功升级及其回退；不能将拒绝后未变化等同于成功升级后的回退证明。此历史副本的清理依赖仍需单独诊断；生产当前状态需用正式发布准备流程另行验证，历史拒绝不直接断言当前生产同样失败。

## 证据与后续

本地原始副本、拒绝副本和私有计划保存在仓库外 `E:/my_project/helix-git-consolidation-20261008/series-prod-backup-20261008/`。机器摘要：`snapshot-manifest.json`、`baseline-summary.json`、`upgrade-rejection-result.json`、`reset-plan-summary.json`；日志 `series-production-copy-upgrade.log` 位于其父目录。数据库和包含内部标识的完整计划不提交 Git。

本次仅文档和隔离预检，无产品代码/UI变更；不重复全量测试或构建。UI负责人已接受的冻结版本不受影响。升级/回退、完整用户旅程及外部交付合同缺口仍开放；不操作 NAS 生产。
