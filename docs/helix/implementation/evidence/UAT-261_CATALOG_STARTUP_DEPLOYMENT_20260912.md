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
# 2026-09-12 5428 精确启动修复验证

## 12:17Z 联合版本复验及恢复收口

联合镜像 `helix-beta-20260912-fa96edc6b9` 已标准构建、上传和 NAS checksum 验证，tar 561873408 bytes，SHA256 `4c0efe5fe92f8c11680b1cb9c418951b6e605fa60e85354969120736b72f4453`，NAS Config ID `8d3d7ae8924e5c205b37cf5ab06c7b0d801fef96416d94736f8b2632e97a58eb`。镜像内运行时代码的 Linux 专项 121/121；另真实媒体 HTTP 自动瑕疵上架、手动海报修复、保留演员 Gap 及重启链约125秒通过，2 pass/1个未选择的手动场景 skip。测试目录只读挂载，未替换镜像 src；最初误以为镜像包含 test 的启动失败单独保留，不计测试通过。

12:17:36.651Z 新完整一致副本 `test-runs/joint-host-20260912/data` 共45文件，aggregate `3829f2e2db182c1857c3f5ab9ecee8911ee2dc29f696bbaaab74f115b81bf304`；下载后逐文件校验，121收藏、970 Delivery（137 accepted/825 open/8 rejected），integrity ok/FK0。冻结原件未运行 Host。cd4f对照与fa96候选均完整启动、health200、normalSupplyAllowed=true、关闭成功，8组保护表不变/FK0。12:27:48Z独立复核原38 Effects（23 reconcile_required）及原Events未变，指定旧Run仍blocked/Commit0。

首轮联合 Host 的 Aftercare root conflict 已定位为**副本挂载改变物理根身份**：Aftercare root 为 `/app/data/workspaces/aftercare`，不能用另一路径复制品冒充原挂载。修正测试容器，将隔离可写数据放 `/probe-data`，原生产 `/app/data`、媒体、Workspace 全部只读，读取当前正式配置冻结 Aftercare root；不改产品指纹校验。12:26:38–12:29:22Z 的 `joint-mount-preserved` 完整 Host 通过，root conflict 消失。仍有只读现有 Workspace 下 mkdir 的 ENOENT、输入预检 fingerprint I/O 失败，以及后者暴露的重复聚合 CARDINALITY，不能笼统写成全绿。

重复聚合的精确 Work 为 `libra-deliverable-promotion-work-b95d531290fc079b4eb008a4d6d11a54be705a2f`，在冻结原件不存在。Event input projection 同步失败后，Owner扫描先终结 Attempt、尚未完成 Work 决策，原Event回调再次聚合而误报运行Attempt数量。最终Work/唯一Attempt均failed，保留 `PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED`，没有新造成功或删除历史。该Foundation旧缺陷由源任务修复，须补最终精确镜像验证。

此前 Workspace authority 缺失已追至 Capability 未传递当前 `recoveryDecision`，以及 media commit 硬编码 `intended` 未接受正式恢复入口冻结的 Effect 状态。源 `3a49090899b50bcdbb945e136f8caf89de2cb235` 已合入 `e056c64aff7e0135bea6eb19a4db8409f34f8662`；保持同一 Effect、Attempt、幂等键及 intent fence，没有新兼容或历史回写。Windows合并验证170 pass/1既有skip；精确 e056 镜像 Linux contract/workspace 44项与producer22项通过，另1个既有live BDMV skip。初次producer加载缺少开发用fixture生成脚本，补只读单文件fixture挂载后通过，不将其混入生产镜像。

e056备用候选 tar 561873408 bytes，SHA256 `89c72f1f6c77610bca3ebd11e0e6c46294fcf47d8d37806aedc66375f9b33ca6`，已标准上传并校验，尚未生产部署。回退方向为验证同197表/d8格式的精确备用版本，保留升级后新事实；不能把旧cd4f称为联合版无损binary回退。另12:33:27–12:34:34Z已完成隔离备份恢复演练：保留候选数据现场、恢复45文件逐字校验的原备份并用cd4f完整启动成功。这只证明**生产媒体写入被只读挂载禁止时**匹配旧数据与旧程序可以恢复，不授权在真实媒体处置后用旧DB覆盖新事实。

本节原始日志和JSON保存在集成区ignored `.codex/unified-release-20260912/` 与发布区 `.codex/`，包括 `joint-*-host-result.json`、`joint-promotion-work-audit.json`、`joint-restore-manifest-verification.json`、`joint-recovery-regression.log`、`fallback-real-media-http-20260912.log`。生产仍cd4f及原StartedAt，尚无本批apply、Reset或直接改库；定时任务保持停止。

联合检查结果：`joint-architecture.json`覆盖238个文件/1782项，1771 pass、9 skip、2 fail；四类static gate均通过。失败一为DDL trace manifest仍保留SSOT行号更新前的8表contract摘要，用原`p3-ddl-materializer`重生成，DDL字节及摘要不变；失败二为UAT-129完整HTTP重启链已完成，但最后断言仍读取旧`admissionRequest`导致TypeError。已改为验证新的closed typed binding及其精确newRunId/newRunBasisDigest，未删去真实重启/Outbox/唯一Run检查。`joint-regression.log`对该HTTP场景、DDL可重现、P2基线和完整witness四项复验4/4，无skip；无需因这两处测试/生成trace修正重复全部已通过测试。尚无联合精确镜像Linux/完整Host或生产放行。

后续回退结论：11:57:02.240Z–11:57:40.875Z，将`integer-candidate/data`再复制为`integer-rollback/data`并运行cd4f完整Host，得到4项PLAN_CATALOG_DRIFT，未就绪；8组保护表摘要仍不变、quick_check ok/FK0。`integer-rollback-plan-diff.json`逐行核对这4个Plan在冻结原件不存在，在candidate及rollback副本均为新d8 Catalog：field-observation `e879b530…`已succeeded；aftercare `cda0aee3…`、offdeck `bf5dc39a…`和`07d68502…`仍running。旧cd4f不认识新Catalog；本次d2→d8单向历史证明不覆盖反向回退，不改写新Plan摘要、不添加旧版泛化白名单。

251源任务已明确：其`production-copy-schema`的rollback=true仅验证8表DDL在提交前故障的原子回滚，不覆盖成功升至197并运行后退回189。cd4f对197 marker/DDL有硬拒绝，无197→189降级路径。因此即便无新增Plan，联合版亦不能宣称仅换旧binary即可回退；先保留事故现场再恢复匹配旧数据只在文件及责任状态仍匹配旧备份时成立，不能覆盖新收藏/媒体处置事实。当前生产部署暂停于此验证条件，不是缺少用户已有部署授权。

联合整合：251源`9bd17be50`与260源`5096ab55a`已并入集成树（260落地`085febc5d`）。对87个当前Capability重新计算完整schema传递闭包，保持旧摘要与历史证据来源不变：在原2项Intake之外，新增6项Arca acceptance（accept.commit/identity/mandatory_media/metadata/space/structure）、Libra product.conformance.verify、product_package.publish及shared.artifact.manifest.verify，共11项受影响。原同ref/Catalog值不能证明schema未变；活动Plan及其实际依赖继续按完整受影响集合拒绝，未新增旧Formation兼容。联合witness target为`085febc5daedf1a79e180864129badc41a2e872a`，详细新旧摘要保存在ignored `joint-schema-closure-changes.json`。合并260的SSOT段落导致251新增8表source行号顺延16行，使用原生成器同步source map和table contracts，不改变197 DDL；P2 aggregate为`ec7fe9a914011306263ffd6449aadcdd17c376989aafc0d6d805943e552c2fc2`。初次定向110项109通过/1项生成摘要不一致已定位，修正生成物及断言后完整架构验证结果另记。

本节为最新增量，历史失败证据保留。source `5428fbea998106c2e0ea479f1b162e8f23219420`，tag `helix-beta-20260912-5428fbea99`，tar 561819648 bytes、SHA256 `a0b1c0afbc8c31fc18fbb5ae7f35e380031de7b12483615ec1b6b9897b53642a`，Config Image ID `sha256:397d9d98ea2058ddbf0429ec29acfcc6db7c037d69e3cea94a8057bd767b8ff9`。标准build/upload及NAS SHA256重核后仅load供隔离测试，生产仍固定cd4f；load随tar更新latest标签不改变生产容器。

31bd的formal Handoff B transfer scope修正后，精确镜像仍3项阻断；诊断报`JCS input contains a non-JSON member`，源任务追至`statuses[0].latestAttempt.ordinal` BigInt，并对Owner Fence的ordinal及Work时间只接受非负safe integer后转Number。不是Shelf字段故障，不放宽canonical JSON或全局reader。源5269已合入5428，Windows/精确Linux镜像针对性各74/74。31bd Linux运行时适用81项通过，另一次误带开发source-map测试因镜像不打包scripts失败；相应Windows4项已通过，保留该覆盖区别。

11:54:32.468Z–11:56:32.787Z，在冻结`uat261-host-20260912-final`（11:20:06.625Z，45文件aggregate `b283998892633a06750ed8014379387c6d16a798f9df75c9754b3501a6df8eb2`）另复制的`integer-candidate`运行未插桩完整Host：health200、ready、normalSupplyAllowed=true、启动findings0、closed=true；8组保护表摘要不变，quick_check ok/FK0。文件`integer-candidate-host-result.json`、`integer-candidate-host-console.log`位于集成工作区ignored `.codex/unified-release-20260912/`。

runtime仍有两条与同冻结副本cd4f对照相同的错误：EROFS在`removeProducerPartials`尝试unlink只读/transcode测试挂载；随后`runtimeEffectAuthority`报`CLEAN_WORKSPACE_RUNTIME_EFFECT_AUTHORITY_MISSING`。后者不能仅凭先后顺序归因于EROFS，尚未证明正常可写生产路径受影响或无影响，不宣称运行时全绿。

11:57:01.597Z独立只读复核原7个Plan：38个Effect中23个reconcile_required，全部原Effect及Event字节摘要未变；《人生密密缝》Run未变、blocked、Commit0。只证明旧未决物理责任符合本次startup只读证据，不伪造原操作成功或业务恢复。候选运行后副本的binary回退验证随后另记；UAT-261保持开放，尚未部署联合版本。

## 联合 Host 发现的 Attempt 聚合窗口缺口（UAT-261）

`fa96edc6b9` 的隔离 `joint-mount-preserved` Host 在输入准备失败后报 `P4_WORK_RUNNING_ATTEMPT_CARDINALITY`。只读前后导出 `joint-promotion-work-audit.json` 证明：该 deliverable-promotion Work 在冻结原件不存在，候选新建，最终 Work、唯一 ordinal 1 Attempt、唯一 Event 均为 failed；Event Attempt 为 completed/failed，技术原因仍为 `PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED`。没有最终 running/0 Attempt 孤儿。UAT-251 未改这两份 Foundation 实现，其 cancelProcess 的 Attempt/Work 同事务取消或 draining 路径亦不产生该中间状态。

根因是 `EventRuntime.run` 的 prepare 同步失败并提交 Event 终态，Host await 回调尚未恢复时，同一 drain 的 pendingTerminalEventAggregations 已先聚合 Attempt；Owner reconcile 的 await 窗口中，原 Event 回调重复聚合，旧实现把合法的“Attempt terminal、Work running 等待 Owner”误判为数量损坏。

本次修复基于联合树 `e056c64af`，保留 SSOT §7.2 的 Owner 分工：Foundation 仅在最新 Attempt 终态、完成时间/Basis、对应 immutable Plan 与全部精确终态 Event 状态一致时幂等返回；零 Event 仅接受 no_effect_required/succeeded 或 contract_unplannable/failed。缺失证据或多个活跃 Attempt 继续拒绝。aggregateEvent 固定原 Event 的 attempt_id，缺绑定显式拒绝，旧回调不聚合新 Attempt。Host 以 exact Work+Attempt 合并正在进行的 Owner reconcile，错误仍上报，失败后释放并发记录以允许持久扫描重试；Owner 判定与 settleWork 职责不变。没有业务状态补丁、DDL/Catalog 变化、旧数据修正或 UI 修改。

验证：Windows 与 Linux 各119/119、无跳过，包含真实 EventRuntime+WorkLifecycle+Host 的同步输入失败交错、Owner await 中重复聚合、并发 Owner 合并及失败后重试、旧 Attempt/replan、SQLite 关闭重开后的待 Owner 收尾、无 Attempt 绑定及7类非法数量/证据负向、两种合法零 Event Plan。Linux 使用本地 fa96 镜像依赖，当前 src/test 只读挂载，network none、rootfs readonly、仅临时目录可写；不是最终发布精确镜像。dependency/semantic/manifests/P2 contracts 静态检查通过，P2 unresolvedTypeRefs=0。

另以独立 require 预加载原 `9bd17be50` 两份 Foundation 源码运行相同5个关键回归：5/5按预期失败，其中真实组合精确得到先 `PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED`、后 `P4_WORK_RUNNING_ATTEMPT_CARDINALITY`，新代码只保留前者。旧源码对照首次预加载脚本遗漏 Module.loaded，产生工具自身错误；修正后才得到上述有效负向证据，未把工具错误计为缺陷复现。

原始日志在开发任务 ignored `.codex/uat251/uat261-attempt-window-{windows,linux,original-negative}.log`，静态记录同前缀。此为局部恢复缺口交付；联合精确镜像、完整生产副本 Host 与最终发布验收仍由部署任务执行，UAT-261/UAT-251 不据此关闭。未构建新的发布镜像、未操作 NAS、未改生产或冻结副本。


## 2026-09-12 联合发布后独立验收关闭

286fe56f1e生产完整Host正常，health200/normalSupplyAllowed=true；最新完整副本升级、同格式备用及切回验证通过，8270 Plan含新d8逐字保留，38历史Effects/Events与122收藏保留。不改旧digest、不扩Reset、不屏蔽校验；历史Run业务恢复仍归125/250。 精确image/source/SHA、完整Host及回退边界、备份与生产只读证据见[286发布记录](UAT_RELEASE_286FE56F1E_20260912.md)。此前未部署/开放状态为历史时点，本段满足本项关闭条件；不连带关闭251或历史存量项。
