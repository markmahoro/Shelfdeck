# Series 历史生产副本升级预检

日期：2026-10-08；源码基线 `f052fb6bc79a4d0f0cd160c307a7dd60cf886d15`。对应当前 Phase 节点5升级/回退；初次结果为安全拒绝；后续修复、成功升级与恢复证据见后续章节，均不代表生产部署资格。

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


## 后续诊断与修复（2026-10-08）

后续基线为 `88886b0becbeb607b26f510ad6e4ae2b6acd6f4d` 加本轮修复。只读检查发现365份正式 On-deck Commit Receipt 均关联 committed Run，但对应 Custody 状态仍为 active；正式 Commit 实现本就不会同步修改该状态。原迁移将 Custody.state=committed 作为额外条件，错误要求清理全部已收藏交接。按 SSOT 的 Commit 权威修复为 exact package ID/digest + committed On-deck Run + 对应正式 Receipt，不修改历史 Custody，也不生成回执或迁移未完成运行。

修复后只剩1份未提交 Package及3个 active Run，合计4个 Subject；正式定向 `inspectPlan` ready=true。全局 Reset 的14条保留锚点/10条非目标 Control 保护没有放宽，也无需绕过。首次在新本地副本执行定向 Reset 时，独立外键校验发现遗留 `libra_run_outcomes`，整个事务回滚。补齐选定 Run 的 Outcome 删除及冻结 manifest 独立残留检查；目标外 Outcome 保留并验证重复执行。

回归先复现两类缺陷，再修复。Windows：升级、历史 DDL、Reset 共54项通过、0失败、0skip（54.60秒）。Linux：23项升级/历史 DDL通过；Reset 首轮因缺少测试要求的临时挂载被安全拒绝，补齐专用 tmpfs `/transcode` 与 `HELIX_TEST_ISOLATED_TRANSCODE=1` 后31项通过、0失败、0skip（67.79秒）。P2、package boundary、forbidden semantic 检查通过。四项旧迁移 fixture 改为保留 completed/discarded 历史；当前 active/frozen Run 不享有升级兼容权，专项仍验证必须 Reset，未放宽准入。

原始备份 SHA256 再次核验与上述摘要相同。所有演练使用仓库外新本地复制文件，`transcodeDir=null`，不启动 Host、不访问媒体、不操作 NAS。升级及恢复结果继续记录于下节；本轮无 UI 变更，不替代最终候选回归或生产部署资格。


## 成功升级（本地历史副本）

新副本 `receipt-upgrade-v3.db` 使用冻结的4 Subject定向计划执行正式 `applyReset`，独立验证 integrity=ok、foreignKeyViolations=0。未配置 transcode，未进行物理工作区或媒体删除。

随后正式 `migrateUatIdentitySelectionSchema` 从上述历史 schema 升至 `800afbadcc429b86aa8812cb6eea480ef4ccfa89be2213d7688c060aaa4b075a`，catalog 为 `6f95e51f7599def400bce9c4e2f5601f619125bed798395a3c496f484f9db4b0`。再次调用返回 already_current；当前 `openSqliteKernel` 成功打开；完整 integrity_check=ok、foreign_key_check=0。

对原有61张 Arca 表，按原列集、rowid顺序计算记录数量和 SHA256；Reset前、Reset后、升级后三次一致。仅按冻结计划的精确ID排除5类应删除的未提交验收记录（Attempt、Checks、Decision、Recovery Case、Handoff B Receipt），不排除已提交收藏。365条 Shelf Entry、365份 Commit Receipt 及 Inventory/Deck Fact/Aftercare/Offdeck 等已有记录保持。首次保护比对误将计划内未提交验收记录纳入“不应改变”，在断言处停止；修正验证范围后从另一份全新原始副本重跑成功，没有调整产品保护规则。

机器证据 `scoped-reset-plan.json`、`receipt-upgrade-result.json` 保存在上述仓库外目录；计划含内部标识，不提交。日志 `series-receipt-upgrade-v3.log`、Windows/Linux回归日志位于父目录。


## 备份恢复验证与边界

成功升级且所有连接关闭后，对同一本地工作副本执行原始备份覆盖恢复。升级文件 SHA256 为 `78d27b5877fa3658db495b61682bf6737d6eef9ea98cd67eb5bebfe918b16ee5`；恢复后为原始 `b0d8455ab87312a49f7e59dffd342d206432975584131040c95cb25e33ce7be9`，逐字节恢复原 schema/catalog、365个收藏条目、365份 Commit Receipt及3个 active Run。恢复后完整 integrity_check=ok、foreign_key_check=0。证据 `receipt-upgrade-rollback-result.json`、父目录 `series-receipt-rollback.log`。

本次关闭的是“此历史数据库副本的正式清理、升级、幂等及备份恢复验证”，不是应用/容器/媒体联合回退或当前生产升级。未启动历史版本 Host、未操作物理 Workspace/媒体、未升级 NAS；真实部署仍需最终候选构建、当前生产准备与明确部署授权。外部交付合同缺口和其余 Phase Gate保持开放。

## 本地实际镜像、应用、数据及媒体联合回退

只读从NAS流式导出正在运行的精确旧镜像markmahoro/shelfdeck:helix-beta-20260930-8e197b3c36，未写远端文件。旧镜像tar 1814789632字节，SHA256 861e0af8cecfec91da2814e939a7bb52c8f83ee7b43fbbe25d4e6a5a6cb11e16；tar manifest的Config为168be0bb2101b79424f7f978c32d3724852eb5267b2234a4c981c22fe075ac2b，与NAS容器Image相同。Docker Desktop导入后的index/image显示ID不同，不能把该ID混称NAS配置摘要。

全部后续操作在本地隔离/audit挂载及--network none容器内。使用旧提交8e197b3c36的native4k Movie Host fixture生成真实上架条目：1通过、0失败、3其他场景skip，52.24秒；无active Run。正式createBackup备份9个数据文件，aggregateDigest 5000e219d40d6af5576390efce1691b914a1945d557f829808f8f7db571e0f10。旧Host、候选36100db30e Host依次启动，均健康、normalSupplyAllowed=true、Admin页面正常、认证后收藏1项。候选schema升级至800afbadcc429b86aa8812cb6eea480ef4ccfa89be2213d7688c060aaa4b075a。

停止连接后保留data-upgraded，正式restoreBackup恢复原data，恢复前后快照精确相同，9文件aggregateDigest匹配原备份。再由精确旧镜像启动，旧schema 14c18e017bfce8b78230d0509be1c46fb11c0da95a240396628173a9e71bed73、健康/正常供给、登录及收藏读取通过。三个媒体/附属文件SHA256始终一致，历史Inventory/Product Fact/Deck Fact及唯一Commit保留，无新收藏、无active Run，SQLite integrity=ok、foreign keys=0。

初版检查把后台正常Inventory observation新增revision也当损坏：旧镜像首次重启即从revision1更新至2、旧行active_guard转0。检查保留原失败，修正为允许仅该历史guard退休及新增revision，仍逐字段验证其他历史记录、当前完整三成员、全部文件字节和唯一Commit；恢复尚未启动Host时仍要求完整快照精确相同。这是核对正常生命周期，不放宽产品迁移或删除保护。

脚本/输出位于仓库外helix-git-consolidation-20261008/series-rollback-runtime及series-rollback-*.log；生成的隔离凭据未输出或提交。此证据覆盖精确旧镜像→候选→恢复备份→旧镜像的一条实际Movie收藏，结合前述365条历史库保护；不代表当前NAS442条收藏已执行迁移，不修改3个生产active Run，不构成生产部署授权。后续生成manifest修正的最终镜像仍须校验身份。
