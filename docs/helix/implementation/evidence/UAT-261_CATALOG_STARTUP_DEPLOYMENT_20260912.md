# UAT-261：Catalog变更后完整Host启动失败及发布回退

2026-09-12。第二批d7a6da2802发布未成功，已通过标准流程回退cd4f3f5b2d并恢复服务。261保持开放；125/250生产恢复未完成，不能将隔离正常链通过写成生产验收。

## 当前生产与备份

- 当前镜像`markmahoro/shelfdeck:helix-beta-20260912-cd4f3f5b2d`，source `cd4f3f5b2d2e1ebd80e4ec0bf4119e4cd7442beb`，Config ID `sha256:f4d48cd326dba8b551af63fad7c3ce0ffdc0b3040c43c6153d1987cbc9a13452`，回退StartedAt `2026-09-11T21:32:51.809272745Z`。
- 已回退tar SHA256 `4d3f1b1c51d47d10bb2d3afaa5ce1b4cb6a63586b4a8887a458f8f72ec4beaed`，此次在NAS重新完整核验，镜像及tar继续保留。
- 失败候选`markmahoro/shelfdeck:helix-beta-20260912-d7a6da2802`，source `d7a6da2802fc0838a273633a5225a5c9e4929fae`，Config ID `sha256:42f7b2d8ba5ba56472e014a224f728f5b536bd95ba0b585470ff74c13cdd626f`，tar SHA256 `291a20e18595f8f08916155eca8b184339c38c7496a6a86fa581f60bc6b08282`，失败容器StartedAt `2026-09-11T21:31:28.274398508Z`。候选tar保留用于调查，不得当作可直接重发版本。
- 发布前完整一致备份`/vol1/1000/docker/shelfdeck/backups/unified-helix-beta-20260912-d7a6da2802`，包含完整data、Compose及Secret；45文件aggregate SHA256 `9571b8afcbf30ee373d089f6e6b66f04be58b8942a27c4fc546ae881ca22a715`，在线SQLite一致backup、伴随文件复制、远端逐文件hash与quick_check/FK校验全部通过。
- 停服精确Reset额外备份`/vol1/1000/docker/shelfdeck/backups/formation-reset-20260911T212841Z/data`保留。没有恢复数据库、扩大Reset、清库或处置媒体。

## 已执行的生产变更

按此前精确范围，标准`formation-reset-nas.js --subject-ids`仅选择宇航员与光荣岁月原两个pre-Subject Token，使用`--apply --confirm FORMATION_RESET_V2 --keep-stopped`。现场plan ready、无blocker；冻结manifest digest `12e637fc225ee7774a14919f37838e58be4c8cde769f3b854fd11f7d5132780a`与演练一致。删除4个旧Work及其关联执行闭包，Subject/Run/Package/On-deck Run/Workspace/Control删除均0，Delivery/Reservation重开均0，旧两Token已删除；integrity ok、FK0，再次plan无相关活跃Work/Attempt，保持停服。

随后执行已校验候选tar的标准deploy dry-run/apply。readiness返回ready、Compose重建成功，但完整Host启动出现大量`PLAN_CATALOG_DRIFT`，涉及历史Arca Aftercare、Perception等Plan，startup recovery为faulted、normalSupplyAllowed=false，记录actions为空、1个nonterminal Work/4个nonterminal Event。健康未成功，不能因容器running或数据库readiness通过宣告上线。保存启动失败日志后，停止本任务仍等待health的本机deploy进程，避免回退后旧发布命令误报成功；使用cd4f tar重新执行标准dry-run/apply，exit0。

回退复核：NAS及LAN health均`ok/helix-clean-v3/normalSupplyAllowed=true`，5项原挂载和QSV配置保持、源码来自镜像、secret root匹配、fnOS管理页200，根权限及其他容器与基线一致。113条收藏、970份Delivery（834 open/128 accepted/8 rejected）仍在；原8份Rejected记录及持续清理授权revision1逐字不变，5个目标旧Package/Primary摘要不变且Delivery仍open。旧两Token Reset效果未通过恢复DB撤销；回退后旧版正常队列已另行产生新Token，Fast X原Token保持。**下一次不得复用旧现场或将新的Token自动加入原两项授权范围。**

## 验证缺口及后续约束

该候选已通过Windows组合38、完整架构1647/9既有skip、精确镜像Linux117项和真实NAS只读媒体的scoped rail恢复；这些检查没有覆盖最新生产副本的完整Host startup/catalog recovery。部署负责人将这种覆盖不足的候选推进生产，发布门禁遗漏已在本事件确认。后续候选必须先在最新完整一致副本、明确隔离和只读媒体环境验证完整Host启动、历史成功事实、真实未决执行保护及升级/回退；数据库readiness或按process过滤的执行轨不得替代。

Catalog digest的构成、历史Plan/retained contract的加载与比较语义仍由原实现任务优先定位。不得改历史Plan摘要、删除历史记录、全量Reset、屏蔽terminal Plan检查或放宽unknown保护来绕开。若安全修复需要新增Owner/合同边界，先明确缺口；不能借发布事故扩大授权。261优先于260修复，251保持独立交付；没有新生产业务POST或显式扫描。

原始日志及receipts保存在集成区ignored `.codex/unified-release-20260912/`：`control-preflight.log`、`control-backup.log`、`backup-helix-beta-20260912-d7a6da2802.json`、`control-upload.log`、`control-reset-dryrun.log`、`control-reset-apply.log`、`control-deploy-dryrun.log`、`control-deploy-apply.log`、`control-boot.log`、`control-rollback-dryrun.log`、`control-rollback-apply.log`、`control-rollback-postflight.log`及Owner/Control只读JSON。失败日志保留Node打印的摘要截断，不声称已逐条审计数千条findings。未重复完整媒体E2E/Desktop/Worker；回退成功不关闭261。
