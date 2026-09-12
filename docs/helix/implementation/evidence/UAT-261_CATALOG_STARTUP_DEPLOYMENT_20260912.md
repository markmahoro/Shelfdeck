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

随后源任务只读审计已定位直接原因，部署任务核对`catalog-startup-audit.json`：87项启用Capability的manifest执行语义中，`libra.intake.material.verify@1`新增必需`intakeControlReadHandle`，policyDigest保持`ae00df0088735fdfbba1c6f2c1b324b1abed005a86bf181b47a4e549c692affa`；Catalog从`d2f4691efff1460f421d6a76ce06e537c0728a159dae7f548edc06ca5dc63e59`变为`d8d6a237f3cdcda20b1548d5064b94dc483cf58da1ed2ca326f5e1ca2cfb6a74`。执行registry已排除source trace，不应把该失败归因于源码行号漂移。一致快照有4464项旧Catalog Plan（4461终态、原两Acceptance及Fast X三项活跃）；精确Reset删除相关4 Plan后仍有4460项，现有已知Catalog规则没有此次升级边。manifest摘要差异不是完整schema依赖审计，input/result/evidence内容的变化闭包仍须逐Plan验证；安全规则及完整Host复验尚未交付，不能仅加digest白名单。原始审计位于`%TEMP%/shelfdeck-intake-recovery-20260912/catalog-startup-audit.json`。

原始日志及receipts保存在集成区ignored `.codex/unified-release-20260912/`：`control-preflight.log`、`control-backup.log`、`backup-helix-beta-20260912-d7a6da2802.json`、`control-upload.log`、`control-reset-dryrun.log`、`control-reset-apply.log`、`control-deploy-dryrun.log`、`control-deploy-apply.log`、`control-boot.log`、`control-rollback-dryrun.log`、`control-rollback-apply.log`、`control-rollback-postflight.log`及Owner/Control只读JSON。失败日志保留Node打印的摘要截断，不声称已逐条审计数千条findings。未重复完整媒体E2E/Desktop/Worker；回退成功不关闭261。

## 人工续接与最新完整副本

2026-09-12用户要求继续，定时任务保持停止。09:49Z只读复查确认当前cd4f镜像、Config ID及StartedAt未变，NAS/LAN health正常，五挂载、Secret root匹配和fnOS管理页200。正常队列已推进至118收藏、970份Delivery（828 open/134 accepted/8 rejected），最新普通扫描revision1368–1440共73页succeeded。当前三Token已与回退时不同，原宇航员同一subject ID在1789162455613被重新取得，Fast X不再占Token。不能把同一ID误认为原Reset未执行，也不把新Token加入旧授权。

新的完整副本位于NAS `/vol1/1000/docker/shelfdeck/test-runs/uat261-host-20260912-resume/data`；独立容器`--network none`、生产data只读挂载，通过在线SQLite backup及全部伴随文件复制生成，原库未写。完成时间2026-09-12T09:52:01.807Z，45文件aggregate digest `ac818aa75b1eb2b8ef266b6e23eefbc260be82cf8bbef72bb98b18e72e06b11d`；SQLite 940773376 bytes，SHA256 `57d42faa5f0a69a512f6cfde9fc2079b6122a497e937a193344573039f522867`，integrity ok/FK0。已下载至集成区ignored `.codex/unified-release-20260912/uat261-host-20260912-resume/data`并逐文件重验size/SHA256；manifest在父目录。该目录为冻结原件，完整Host运行必须另复制副本，不能再使用Reset前旧快照替代。

261源任务补充确认：当前持久Plan表没有完整原始WorkflowPlanDefinition字段，不能诚实地重算完整原始graph_digest。后续实现必须保留原摘要、明确这项证据限制，并验证可证明的持久DAG、Work/Attempt与节点/Event归属、依赖、Result/Evidence精确引用和canonical digest；缺失证据仍阻断，不为补证据重写历史事实。

同一快照的精确镜像完整Host对照已完成，均使用`createCleanServiceHost`实际启动所有领域、HTTP surface和startup recovery，未按process过滤或bind mount源代码；`--network none`、真实媒体及`/transcode`/`/upgrade`均只读，data使用各自新副本。候选d7在09:57:45–09:58:30Z返回`P4_EXECUTION_HOST_RECOVERY_BLOCKED`，4764项全部为`PLAN_CATALOG_DRIFT`，该时点nonterminal Work/Event均0。完整findings已保存，无打印截断。当前cd4f在09:59:34–10:00:56Z启动成功，readiness ready、health200/normalSupplyAllowed=true、正常关闭、runtime errors0。两者八组Shelf Entry/Deck Fact/Inventory/不可变Candidate表逐行hash未变，quick_check ok/FK0。第一次cd4f 60秒限时不足，保留timeout结果；上述成功对照是新副本的180秒窗口，不能删除第一次失败证据或把timeout视作通过。

对照结果位于ignored `resume-candidate-host-result.json`与`resume-baseline-180-host-result.json`，NAS对应`uat261-host-20260912-resume/resume-candidate`及`resume-baseline-180`目录。该结果确认当前发布回归，尚不证明261新规则可放行。源任务严格审计已发现7个终态Plan仍含`reconcile_required`物理Effect，保持blocker；合法Result alias、同Work前驱投影及Attempt Evidence名义关系仍在分类，不能用当前schema重解释已冻结终态Result，也不能略过实际未决副作用。

10:05:57–10:07:04Z另复制候选失败后的`resume-candidate/data`运行cd4f回退完整Host，未还原原始DB：readiness ready、health200/normalSupplyAllowed=true、正常关闭、runtime errors0、八组protected表hash未变、quick_check ok/FK0。结果为ignored `resume-rollback-cd4f-host-result.json`；三个正式对照的task-owned容器均已退出，生产health仍正常。这是新副本上的二进制回退验证，不覆盖尚未交付的261/251合并版本。

## UAT-261 精确镜像集成验证

源实现`e6ab87955`已合入为`d5c00f0cc46ba8a950ff0b137a2072750eb95afe`；源测试基线修正`e685e272e`合入为`04d1f4ef5`，后者只改测试与Evidence，不改镜像运行时代码。干净发布树完整架构共1695项，1685通过、9项既有skip、1项失败；唯一失败为P2 aggregate digest旧常量，更新为实际派生的`faa39ed26084596b67ea06686c3fe1cada31639fa67c26731a68dc38009ab1dc`后相关3项全部通过。未把这次定向复验写成完整套件重跑；原失败日志保留。结构、Owner、语义及manifest合同检查通过，unresolvedTypeRefs=0。

标准`build-image.js`构建候选`markmahoro/shelfdeck:helix-beta-20260912-d5c00f0cc4`成功；tar 561808384 bytes，SHA256 `b6691bbad517ce4429c96b0beb90276cde7e26ad65579bc4b9ae2525b74239d6`，NAS Config ID `sha256:6419f7b6a0f31d5a09717bea2a83d63cfab2aa4b97b1418108897fcbca8a0e75`。标准upload后远端SHA验证并仅导入镜像用于隔离测试，未执行生产deploy apply。tar同时携带latest标签，导入已移动该标签；生产Compose使用精确cd4f标签，运行容器及StartedAt未变，后续仍必须按精确版本操作。精确镜像Linux上bounded Catalog、startup recovery、execution runtime Host共84/84通过，代码来自镜像、仅挂载测试文件。

10:33:55–10:35:15Z，在09:52完整冻结快照的新副本上运行d5完整Host：仍返回`P4_EXECUTION_HOST_RECOVERY_BLOCKED`，findings从旧d7的4764项缩减为恰好7项`PLAN_CATALOG_DRIFT`，与源审计的23个未决物理Effect/5个Arca Run闭包一致。normalSupplyAllowed=false、actions为空、nonterminal Work/Event均0、runtime errors0；八组保护事实hash不变、quick_check ok/FK0。该结果证明门禁保留真实未决责任，**不是成功启动或可发布结论**；261继续开放。结果为ignored `uat261-proof-host-result.json`，原始Windows架构、Linux及构建日志在发布工作区`.codex/uat261-*-20260912.log`。

10:34:27Z另对三项旧stage共同的精确slot `/media/Film/.shelfdeck-stage-aa7783bd30f39459`只读lstat/readdir与当前Binding查询：非symlink目录、inode857313、size0、mtime2026-09-11T09:54:05.528Z，无子项或临时文件，Arca/Libra当前Material Binding对该路径及前缀均0。结果为ignored `uat261-stage-slot-read.json`。没有调用stage/prepareSlot或写生产；当前空目录不证明旧Effect从未产生写入，仍需Arca当前Reality及精确责任证据闭包，不能抹除失败历史。另20项旧settlement Effect的后续成功Evidence关联仍由源任务核对完整Owner与成员集，不因Run已committed直接放行。

10:35:55–10:37:14Z以本次d5运行后的副本再复制运行cd4f，未恢复原始DB：完整Host ready、health200/normalSupplyAllowed=true、正常关闭、runtime errors0、八组保护事实hash未变、quick_check ok/FK0。结果为ignored `uat261-proof-rollback-host-result.json`。两个本轮隔离容器均已退出，随后生产精确cd4f标签、原StartedAt及health正常再确认。该回退验证只覆盖当前d5运行时代码，不覆盖尚未交付的后续责任证明或251合并版本。

后续派生责任证明审查发现历史授权差异：`6bcfd7b33`父版本的settlement Projection合成`actorId=system-policy/approvedAtMs=0`，未读取正式授权Store；此缺口已由[UAT-172历史审计](UAT-172_AUTHORIZATION_EXECUTION_AUDIT_20260909.md)明确记录。旧`finalProductVerificationDigest`也来自Libra历史conformance，不能当作Arca本次Final Verification。按冻结旧算法与不可变材料重建namedInputs，只有精确匹配原/后继Event Attempt输入摘要和包含原Fence摘要的Effect intent时，才可证明历史输入来源；这不证明授权合规，也不允许回填Approval或以当前授权追认。责任证明仍须独立核对实际后继Final Verification、Placement、Settlement及On-deck Commit完整链，任何缺证保持阻断。未新增生产动作。

源提交`e1bbc467a`已审查并合入`4f6953ad1`，独立Arca历史读取仅使用原Receipt指定的Inventory/DeckFact revision，保留现有current读取语义；Foundation在Owner只读观察后重新核验完整技术图，不嵌套Owner事务，不改旧失败Journal。干净发布工作区四组针对性检查（bounded Catalog、Owner history observer、startup recovery、execution runtime Host）共104/104通过，日志`.codex/uat261-settlement-merged-20260912.log`。该提交只覆盖4个Plan的20项Settlement责任，3个stage仍显式阻断；没有构建新镜像、运行新版本完整生产副本Host或执行生产发布。其他未提交Aftercare Evidence的SHA256保持`81729d8c6ec35bec5494929bb19b46e6c83412b769a2cb8cff6db859bad35a3c`，未夹带260工作。

## 3项stage实现后的精确Linux门禁

源`1b6b3c3f9`合入`1c550eff9131000e8023a3114a458566dc3c1d55`。干净发布树完整230个架构测试文件及dependency/semantics/manifests/contracts门禁全部通过，unresolvedTypeRefs=0；精确镜像Linux125/125通过、无skip。标准构建并上传`markmahoro/shelfdeck:helix-beta-20260912-1c550eff91`，tar 561819648 bytes/SHA256 `4ed6b040f22f13752478bb21a7028c5efb81f13f9d7e01472af09a1e55198f96`，NAS Config ID `sha256:f676f77fa79c5f49a98538ff22fc997d3feac8f37bc9506e992313152e4cc0f7`。仅导入用于隔离验证，没有生产apply；生产仍为cd4f及原StartedAt。

11:20:06.625Z获取新完整一致副本`/vol1/1000/docker/shelfdeck/test-runs/uat261-host-20260912-final/data`：45文件aggregate `b283998892633a06750ed8014379387c6d16a798f9df75c9754b3501a6df8eb2`，DB 940773376 bytes/SHA256 `14648fff9028c8d734f494730a625ee80d788b781d935a8f253a842de5555388`，quick_check/integrity ok、FK0；121收藏、970份Delivery（825 open/137 accepted/8 rejected）。下载至集成区同名ignored目录并逐文件验证；冻结原件未运行Host，各次均另复制。

旧cd4f在该副本11:20:59–11:22:26Z完整Host ready/health200并正常关闭，但有两条runtime错误：只读`/transcode`上旧partial清理触发EROFS，另有`CLEAN_WORKSPACE_RUNTIME_EFFECT_AUTHORITY_MISSING`；第二条的完整因果尚未确认，不将其直接当作EROFS连锁，也不宣称运行时全绿。候选1c550在11:22:31–11:23:52Z完整启动仍为`P4_EXECUTION_HOST_RECOVERY_BLOCKED`，仅余原3个stage Plan，runtime errors0。两者八组保护事实hash不变，quick_check ok/FK0。

11:24:47–11:26:12Z另用新副本运行同一精确镜像诊断Host，仅包装`createBoundedCatalogTransition`的`onRejected`记录拒绝原因，不改变判定；结果仍3项阻断，唯一拒绝原因是`Arca stage history: Custody has missing or extra Control`。因此不能把开发区输入/Control局部查询或Linux单测通过写成7→0。源任务接回核对实际控制集合与原Package范围，任何真实缺失/额外Control继续阻断；未修改生产或放宽条件。原始证据为ignored `final-baseline-host-result.json`、`final-candidate-host-result.json`及`final-diagnostic-host-result.json`，诊断包装与普通精确Host结果分开保留。
