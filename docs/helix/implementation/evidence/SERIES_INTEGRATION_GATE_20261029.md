# Series候选资格与NAS恢复记录（2026-10-29）

本记录描述独立候选`1d8a45843f9c8982c91bb0a367eb0adfa1c5c310`及其UI修复后继`7265d4b5ec4077cb21152219a9a53e85a97ac3f9`，不宣布生产发布或业务验收。原始日志在本任务工作区的`.codex/series-integration-20261029/`，下表摘要用于校验该忽略目录中保留的原始证据。新提交形成后须重新核验受影响的具体版本。

## 2026-10-29 当前冷态结构转换检查点

用户已授权本轮Fresh Reset、跳过真实CIFS测试及不等待低I/O；以下只解决独立的冷态结构前置，不代表可执行生产Reset。生产基线`a2bf2d6fd`的239表DDL摘要为`906ecacce4d6de62e875d1293cec93dd198564c1c53e2f7f7979d75b2eac2d0a`，当前主整合244表目标为`294bb8243aca2857729f70fa07fbc59b69efad5da5854a5db528386e19179bc6`。`bfc9f0cd4`使用固定原始DDL及manifest测试夹具，只对这两个精确版本允许新增已审核的五张表；旧表和索引须逐项相同、源marker与实际目录摘要吻合，244源只能原样转换。其他源/目标组合保持原有拒绝，目标结构后续变化须重新审查。

首轮隔离Linux测试在旧代码上为1通过/2失败：239→244被`RESET_SOURCE_SCHEMA_UNREVIEWED`拒绝，marker负例同样先被结构围栏拦住。修复后同一隔离Linux、只读源码及独立临时卷6项通过：239→244、未知索引、异常marker、伪造旧marker、244原样及既有235→239回归，源数据库字节不变。完整数据保留、Owner声明、Withdrawal及自定义Spec闭包、真实生产库、冷备和实际Reset不在本项结论内；244正式保留声明仍未放行。

后继已为244表补Owner保留声明和Withdrawal闭包；使用无真实收藏的239表隔离源通过复制及独立核验，完整管理流程85项和后续闭包85项通过。未终态旧执行的额外边界及首败/复验见[Withdrawal后继证据](ARCA_WITHDRAWN_OFFER_RESET_AUDIT_20261029.md)；本段前述“声明未放行”为结构首项完成时的历史状态。真实生产数据、最终整合版本、冷备和实际Reset仍待核验。

## CIFS隔离验证

| 记录 | SHA256 | 结论 |
| --- | --- | --- |
| `nas-cifs-first.log` | `df2cf1e22c5b7131000e05c186e0018afa29ce55acaa4173f31a020dcc2b835f` | 首轮将Workspace和SQLite误放共享盘，6/16通过；不能当生产布局资格。 |
| `nas-cifs-retest.log` | `4db97d19bbe4a0f672ca117b13389fb394586e5324288334c7aa88c1e7747fe1` | 按生产拓扑重跑，8项直接文件调用遇`PHYSICAL_MATERIAL_STAT_FENCE_CHANGED`，未通过。 |
| `nas-cifs-stat-probe-retry.log` | `f47babefd8106b20276c8de21910141a3a56802c53ddfcf6872b21d4e13ece25` | 隔离新文件的fd/path时间戳有短暂不一致与后续变化；不能凭该现象推定内容未变或降低围栏。 |
| `nas-cifs-host-diagnostic.log` | `d452fc5af2a3b32e8140c1ddae10e2909bbe93fbd59cc8247a9a28bef843e5fe` | 真实Host的Series publish Effect进入`reconcile_required`；首版测试把该恢复通知当作致命异常。 |
| `nas-cifs-host-observed.log` | `3a7916787dbc71f88edd16f230b012368c73017f9022805c117a4267a6e0265d` | 14:43启动的观察版本在NAS异常期间连接断开，日志没有最终测试结果；不能依据本地进程退出码判定通过。其测试专用DB、WAL及SHM复制前后源SHA一致，私有副本查询`total_changes=0`、integrity ok：48事件成功、1个Arca接纳事件执行中，尚无Series publish Event或On-deck Commit。 |

上述测试仅在任务专属目录及临时数据运行，未操作生产材料。候选镜像仅加载供测试，未部署；七条线上重试未执行。

## NAS响应与原绑定恢复

发生响应超时后，ICMP/TCP可达但SSH握手、管理页及健康接口无应用响应，停止任务容器的SSH请求未获握手。用户说明前序其他Docker部署导致NAS卡死并自行重启；该原因未独立验证。重启后任务容器不存在，生产仍为原容器`1792e7209ca39dcd83eb64d91107803bb7bdf234103a4d5b00d4381bf1d29493`与`markmahoro/shelfdeck:a2bf2d6fd`。

原`/media`和`/adult`宿主机CIFS源重启后缺失，生产容器先绑定到了启动时的本地空目录；用户重新挂载原共享后，宿主机源正确但容器内仍显示本地文件系统。核验两条原CIFS源、容器ID、镜像和bind路径后，执行仅针对该原容器的`docker restart --time 60 shelfdeck`；容器内两条路径随后均显示`smb2`，容器ID与镜像不变。健康接口返回200，Runtime曾返回running与normalSupplyAllowed=true；后续管理状态查询有一次10秒超时，NAS swap约2GiB，稳定性仍开放。不将这次恢复当作候选部署。

| 记录 | SHA256 |
| --- | --- |
| `nas-after-user-reboot.log` | `bce09ec8f08ce501c0530df97319de817812ece197a74c5408025ce781213091` |
| `nas-post-reboot-media-check.log` | `0cc88373992c337421072ab14f3c65d0673d7ff8f11364b97bdbbe0b79bad73b` |
| `nas-after-user-remount.log` | `f3968708c1475417beb955f936523f09381281337255c54fd11872c9a851cc96` |
| `nas-production-rebind-restart.log` | `7cf9a6903f1de9ee5e8e6c2246dcf34fc809f7c69374f85fff982147f79ccbaf` |
| `nas-after-production-rebind.log` | `8d49588f66b103a94c74921e00a70f54f9a7618a073439f99a5c5e7ec68ff5b6` |

## 本地固定候选

构建镜像的4541个跟踪文件与冻结检出字节一致。Linux Web初跑缺少相邻Service源码，48文件中2组无法加载；修正隔离环境后48文件、271测试通过，首跑和因只读挂载点缺失无法启动的重试均保留。对应日志`linux-web-test.log` SHA256 `a24b8786dcdecedf20e48e74f16a34fe8d13b3e2b94a7ff526f1e7e705fc2c63`、`linux-web-retry.log` `2add2022c052c3ea0ff3a18a718fc934e349686ecc94a63c6ee138b07c89e2b5`、`linux-web-second-retry.log` `80ac97e3577ddb9e469ebd03e80a5e3f8814ba1adfbf9cffc3de4bd198b317cf`。

Service首个容器命令未展开通配符；首个完整执行787通过、32失败、26跳过，其中有工具/Service/Web依赖和一次性`/transcode` tmpfs未挂入的环境问题，Linux下Windows路径断言另待核查。日志`linux-service-first.log` SHA256 `bad1169bd4e5008819ca97c2a65454ad1496a425840c77bc0027bff7bb336385`，完整执行`linux-service-retry.log` `03f0524d594bc283d5b655df3a4f3c069dee62a3c81e6e7c6102a6f4da0481cd`。

补齐三组依赖及一次性tmpfs后，第二次完整Service执行835通过、2失败、28跳过，`linux-service-second-retry.log` SHA256 `e028fe41899a3dc296cad21e33d0eefeea19f772ec753b1ec4a63be71b7c3772`。Event deadline失败的同一原测试单独通过，八次记录实际错误字段的诊断重放均满足原条件，但原失败未记录具体字段，原因不能断言；`linux-deadline-targeted.log` SHA256 `37bd1f06ac0a700c4d030a8481de3ab098aaf7bcba48e2f800a0bea61e20d7b9`。另一失败为Windows样式`Z:\\Film`在Linux先经`path.resolve`转成本地相对路径，生产基线与候选该实现/测试blob一致；电影线程独立处理，不能仅删断言。完整架构门禁仍在执行。

电影线程独立提交`db539e9df79520edbeb207f46345c786bade6633`，在主机解析前拒绝盘符/UNC字符串并补覆盖，报告Linux和Windows各14项通过；只说明字符串形式防护，不宣称该工具能识别Linux上已挂载的SMB。此提交与US功能改动分开，适合独立挑入候选后重跑完整Service。

UI负责人独立结果为浏览器28 PASS/8 FAIL，隔离Linux 231 PASS、Host 3 PASS；两处失败各在四视口复现，整体UI为FAIL。精确错误码及证据已交Series线程；修复后重新绑定实际最终候选复验。

Series线程在上述候选后追加纯Web修复`60f123a71`、浏览器回归`567ad89ca`和Evidence `7265d4b5e`。实现线程报告Linux Web 274通过/0失败、四视口浏览器44通过/0失败，含原失败的重新验证；具体局限见该线程专属Evidence。新候选`7265d4b5ec4077cb21152219a9a53e85a97ac3f9`的标准镜像已在本地构建，tar SHA256 `42ba2e2497b2db51d4a2889599895f337779f5dc30203f545e06100159cb3697`，日志`image-build-7265d4b5e.log` SHA256 `3f7f29cbfdeca447e9caa92062936741097075c238cfa71ae699f2e423de4e70`；UI负责人已收到新镜像的独立复验请求，尚未出具结论。

## 后继bc4固定版本

从7265仅挑入电影测试工具/测试的`db539e9df`后得到`bc4f5c952849ed6079baedde159ddaa5ce1d39c1`，不含US功能；标准镜像tar SHA256 `59bcd40c566af686da84d861ea9b4d8f1cb9c785b3586172320e568e9237a3d6`。固定Linux检出4544个跟踪文件与构建工作区逐字节一致（`linux-bc4-source-compare.log` SHA256 `906274208171696ded1553bb5f5901d26e8700dfe31b20fc4a007f53ea301286`）；Service依赖目录4995文件与实际候选镜像一致（`linux-bc4-dependency-compare.log` `0aa3fbc9fcf5b462cf014ff9f9ad4ebbd63e380b8d9cf4e2bc86bb6152557526`）。

精确版本Linux Web 49文件/274通过，`linux-web-bc4f5c952.log` SHA256 `b0499f5ceb2deb2c3a34e2d104b71da284b63e1228b5b2287bd3ae41f755b82e`；Service 846通过/28跳过/0失败，`linux-service-bc4f5c952.log` `c2f691ffe328c75d3ef2ae2171d244a7b89ffe197dc0fc7f8bab5e58f863ad6f`。跳过包含未配置的真实媒体和专用浏览器fixture，不代表这些场景通过。

UI负责人对bc4适用UI验收PASS：在7265完成四视口浏览器56通过、定向3通过，再核对bc4的178个Web输入、9个页面资源和2878个镜像运行文件与已测版本一致；季poster与剧情以既有Linux Host和正式NFO证据覆盖。完整独立证据位于`E:/my_project/helix-git-consolidation-20261008/series-ui-review-bc4f5c952-20261029/owner-review.json`。这不替代生产验收或其他发布门禁。

前候选1d8a完整架构结果为3402通过/5失败/27跳过，四项与缺少依赖路径有关，补齐后四项定向通过；1081视频Host有一次`P8_ACCEPTANCE_CONTINUITY_BASIS_STALE`，独立重跑通过但原失败原因未确定，Series线程继续查收敛。首跑`linux-architecture-first.log` SHA256 `328e4ac84688453e9492e8681e256979b438a13c87c6f4927c3b65c5d2d3f952`；四项依赖重验`linux-architecture-dependency-diagnostic.log` `d36a37dcfdeca5a552708a5db96f3a784397e503e39791be899e360d54653d16`；Host单项`linux-procurement-targeted.log` `f1d24f3aa423d19a20d06e131ae3608f3c13e96ebd5d25a46a4673625b873bbd`。bc4完整架构重跑仍进行。

## 后继27a固定版本

Series线程在候选和原生产基线均用可控跨Subject竞争复现相同stale code/evidence：旧输入投影失败无Effect或Result，随后同一Work重规划成功且交接责任闭合。原大规模测试禁止任何历史失败与该合同冲突；`92df7fa5e`仅修正测试，在允许此精确stale前逐条证明无副作用、后继成功、来源和交接闭合，其他失败仍拒绝，并新增受控回归和负例。首次完整门禁临时数据库已清理，不能断言该具体失败最终收敛，详见`SERIES_CONTINUITY_GATE_INVESTIGATION_20261029.md`。

挑入后`27a0f68af3599a3422b21853632fc8a01878b750`的标准镜像tar SHA256 `e87f6628edc20732df35889aa7195bd7de1e52ba6753984635a7e39f95a3166e`；4547个跟踪文件与构建输入逐字节一致（`linux-27a0-source-compare.log` SHA256 `3181ffd379118a3d1acc770565ca0402e040aa293de865dd3ad031c2016119b7`）。完整Service 846通过/28 skip/0失败（`linux-service-27a0f68af.log` `6d97f0a5903f7955e0ff8705c85e7da7a081e5307b8b91fc0d90c2e277170b6e`），Web 49文件/274通过（`linux-web-27a0f68af.log` `ad48df654a247ce7ecd6224b81480cb201b705951d237b74dc0ad836cbb2103a`）；跳过范围不视为通过。UI负责人核对178 Web输入、9资源及2878镜像运行文件与已验收版一致，具体版本UI PASS，证据`E:/my_project/helix-git-consolidation-20261008/series-ui-review-27a0f68af-20261029/owner-review.json`。完整架构重跑仍执行，真实CIFS未通过。

生产副本准备：本任务ignored辅助器`snapshot-qualification-data.cjs` SHA256 `09489eee23969f634d05f8330dd5f385808e1bee137da181d68007e369f96d58`，在本地禁网Linux验证了含未检查点WAL的SQLite一致副本、关闭后无WAL/SHM的稳定文件复制，以及已有目标、源挂载可写和复制中源变化的明确拒绝。首轮测试因fixture未初始化ENOENT保留；辅助器未在NAS使用，尚需完整真实生产副本、完整Host/Owner reconciliation、回退以及独立停机冷备，不能以合成夹具替代这些门禁。

## 16:25 完整架构失败与历史对象补齐

bc4的完整Linux架构为3440项：3410通过、3失败、27跳过，dependency/semantic/manifests/contracts静态项均通过；原JSON日志`linux-architecture-bc4f5c952.log` SHA256 `1c07502a962be1eb0ed77dd043657b4943e4496d799a66256ce975ae5d0dfed2`。P6及P8退出审计分别缺失历史对象`f2846fd1`、`72df5a9d`；这两个对象在主仓库存在，但候选测试卷中的隔离Git对象集不包含它们。JAV特殊来源海报维护另一次失败提示Aftercare目标在missing finding后重新出现；是否真实缺陷尚在隔离追因，不能按环境失败或通过处理。

精确27a的P6/P8对应测试和审计器与bc4字节无差异。首次尝试在生产镜像直接运行历史审计因镜像无git而未启动测试，`linux-history-objects-27a.log` SHA256 `1aeed98310b04444dc2b59b17836290be257ce29733afe9436fc74bd13a12e23`。改用基于相同生产镜像且只补git工具的原gate镜像、候选只读卷和主仓库objects只读alternate，验证两个对象均可读后，原P6/P8测试6通过/0失败；日志`linux-history-objects-gate-27a.log` SHA256 `78593c320e1678d1264e873f46e3ba7cf0998d014ed001b193331bf94cef7f80`。精确27a另已启动带相同只读历史对象的完整架构，不以定向复验代替结果；此前启动的27a全量也继续保留结果。

精确27a首轮全量后续结束，3441项中3411通过、3失败、27跳过，四项静态检查均通过。P6/P8仍因缺`f2846fd1`/`72df5a9d`；第三项Series并发非重叠Episode完整Host在`waitFor`捕获`Resolution Commit Handle does not fence the exact typed Resolution Draft`，不是前一轮已分析的continuity stale。首份日志`linux-architecture-27a0f68af.log` SHA256 `e582a61b35ee2fcd9d5f7efb61e731b5cfe40b69e437ebf8cf729351571bf50d`；是否基线既有、是否有Effect/Result及最终收敛尚未确定，独立调查已启动，不能通过忽略runtime error或单项重跑宣称消除。带历史对象全量继续执行。

Series线程随后在基线a2bf和bc4隔离环境以同inode/同字节重建复现真实Aftercare身份碰撞；bc4完整Host受控案例中首个materialize Effect/Receipt已提交，final与retired Physical Material Key相同，inventory.commit报`ARCA_AFTERCARE_INVENTORY_NO_CHANGE`，后续materialize再报冻结missing finding后的目标重现并进入reconcile_required。外部不同内容仍拒绝。首次全架构测试的临时现场已清除，不能证明首次失败恰由相同inode造成；修复仍须在Arca Owner边界内覆盖完整Host、外部冲突及崩溃重放，不得将首跑失败改记通过。

独立初版`c2e2127e9`虽通过同inode受控Host及其原有回归，主整合审查指出首次执行前已出现同字节外来目标时，代码仅凭字节相同及可选Stage别名可能误认归属。Series线程已用Windows/Linux真实文件各2个负例证实：无Stage的同字节外部目标，以及外部预构造同字节Stage/目标硬链接都被错误接受；后者还删除Stage。调用方未传入可证明本Effect创建者的证据，现有Effect intent与continue_forward只证明范围。初版不进入最终候选；继续验证同一Effect的持久归属、外部冲突和崩溃恢复，必要时先返回Owner合同。真实Shelf文件系统的hard link支持仍未证明。

两种情形进一步在隔离完整GETCHU Host证实：在Case active且materialize Event executing/Effect intended时，由夹具预先放入同字节、不同inode外部目标。无Stage与外部Stage/目标硬链接两例均将外部inode作为final，materialize和inventory Effect committed，旧Control released、新Control归Arca且Case resolved；后者还清除外部Stage。原旅程测试显示PASS是缺陷复现，不是安全通过。`jav-preexisting-target-only-host.log` SHA256 `3130585ed2ea59f2f1a4f217d74eb696eebb5c8610701e852490a732a68025c5`，`jav-preexisting-target-stage-host.log` `de68834e1e31569c4a5b809bf12fe251edb036abf0c15e543508154f558a2465`；数据库副本与日志保存在Series线程专属ignored证据目录，未操作生产。

普通停机升级入口的本机预演：对27a标准tar和SHA调用`deploy-nas.js` dry-run，携带现有Runtime Reset配置及初步双卷容量计划，输出包含SHA核验与普通readiness，不包含冷态Reset或apply；日志`deploy-dry-run-27a-preliminary.log` SHA256 `967c088be0083202696143c165e624c6874fe769a12db6e80dddfab892b755d4`。此预演未连接NAS、未上传或校验远端tar，容量为16:06的初步估算，不替代发布前重新测量。`--runtime-reset-config`本身不会执行停机完整冷备，且普通apply会先发布配置；必须先独立完成Runtime Stop、`prepareNasStoppedBackup`关闭证明和全量备份验真，再运行标准发布。现有历史作业目录不可复用成新备份目标，须先按安全目录规则准备本次独占作业位置。真实副本/回退、CIFS与完整版本门禁仍开放，不执行生产发布。

已在本机ignored目录准备27a专属独立冷备作业配置（原Runtime配置单独保留），仅引用`/app/data`和`/transcode`来源；配置`backup-job-27a0f68af.json` SHA256 `0b4d654b4b19bf14f4a455a04fedaffc970b9927884f659ab248c5f90598c67f`，远端目录尚未创建，若候选变化须重新冻结。闭合证明和冷备实现/测试在主树与27a相同；Windows和基于27a实际镜像的禁网Linux各9项通过/0跳过，覆盖未完成Stop、共享挂载、原配置及中断工作区备份、容量不足和备份中断重试；分别保留`deployment-backup-windows.log` SHA256 `4996c21d3b5ae3643ac4350fcb44a7a45554e0c6b6dd15ca539532a2635756dd`及`deployment-backup-linux-27a.log` `28df5fffa22a9ce3f83aa4afb0fbc081a0b124d2f986e5018ce9b43206ec195c`。这些为隔离夹具，普通升级仍需编排实际已停止容器、完整备份及独立回执，不能将冷态管理测试当作生产备份。

## 完整历史对象的第二次架构与备份摘要调查

精确27a补只读历史Git对象后的完整Linux架构为3441项：3413通过、1失败、27跳过；dependency、semantic、manifests及contracts均通过。唯一失败是`p13-operational-cutover.test.js`中备份哈希期间修改文件的负例未抛错，不能记为全量通过。原JSON日志`linux-architecture-27a-with-history.log` SHA256 `629129e7d9e8ccd6a7eb2dfde88551f92255f33bb973e53addd797f2c5debd4d`；单独重跑通过只能说明一次未复现，不能消除原失败。前一轮真实Resolution Effect错误及其独立重现仍保留，不能因本轮未触发关闭。

相同27a只读源码和gate镜像的本机Linux tmpfs上，`p13-hash-timestamp-probe.cjs`对2 MiB隔离测试文件在读取首块后覆写，60次中9次正确拒绝、51次前后mtime/ctime相同而误接受，51次接受的摘要均不等于最终完整文件摘要，属于实质哈希一致性缺口，而非仅测试断言过严。输出`p13-hash-timestamp-probe.log` SHA256 `3e8fd894257bd7e252d328734ff69f0b8ae37e8f218eea1c137241bc1c535cf8`。该旧P13工具依赖stat前后比较，真实停止和独占仍是任何一致快照的必要前提；修复须保留原失败及时间戳不变负例。

普通部署使用的`formation-reset-backup.js`另有重复源清单、复制前源摘要、目标摘要和最终源清单/目标验证。在同一隔离受控变化下，其第一次清单也出现一次同时间戳混合摘要，但`createVerifiedBackup`在再核对源清单时报`RESET_BACKUP_SOURCE_CHANGED`，目标备份目录未创建；`reset-backup-hash-probe.log` SHA256 `7bbab3cc5ba4a6b7553f9f3c3621c3dc77cf33886d5a0f4ca933432c26043260`。测试的Stop callback为合成桩，不能证明真实停机、任意并发写入安全或生产备份已完成。

## 跨电影与演员Reset依赖的隔离整合

主整合叠加电影`24a199ee0`的Libra精确Custom Spec/Intent/Preview闭包及`9a472d6b3`对既有已入藏历史标准Spec的只读校验；历史行不改写，未入藏旧Run不恢复。演员模拟已保留Run的测试夹具原无标准Spec，在新增校验下被拒绝；本整合测试补齐真实western_adult标准Spec与Run引用，未放宽产品校验。历史测试最初仅模拟243表，因Actor新增表触发正式未审查拒绝；仅在各测试进程模拟五张新表的分类后复验。正式239表声明未改，244表继续`RESET_RETENTION_SCHEMA_UNREVIEWED`。

固定index tree `ef032e7cf1d9179f4980c91bf17d2d34f48f780d`的4662个跟踪文件在Linux隔离卷逐个Git blob核验一致；Windows/Linux各34项通过，覆盖自定义目标依赖、历史/当前标准、篡改拒绝、演员Basis及正式未审查拒绝。日志`reset-combined-windows.log` SHA256 `1f4bc2f14e7d290cb0a8e8377e62433a3294451692e116126e306ff3244544a0`，`reset-combined-linux.log` `40ea4a0f9f2e203aa512fc5921788347f3897e06c21cb959e27173ce3ea71863`。人物Reference保护另在进程内临时模拟表分类下Windows/Linux各12项通过；`reset-people-simulated-windows.log` `95a4e0493b24640bff52e376a8f06870f60dffa09f6cf6e46796df943e66ba8b`，`reset-people-simulated-linux.log` `29915ce048ef7b2ec465bf79b209e1ffd742e6ea2ea2ad1b687db934f57577ff`。直接运行People测试先因正式声明未审查而拒绝，属于保护动作；模拟结果不构成正式分类审查、真实旧库到新Schema转换、完整Reset资格或生产授权。

同一固定源码的Linux包边界、禁止语义、Manifest和P2静态检查通过，P2 digest `003aa5741300d9fbc2804601132a55db9f97dbfe169dd8e815ef7e17b4ac840f`；完整历史对象只读挂载后的`reset-combined-static-linux-retry.log` SHA256 `e3447bbfc9c4b932e5aa46b61955b8f07e1240451e3a40badda514c09b2c07eb`。首次静态容器未启动，原因是只读源码卷缺少`.git`挂载点；日志`reset-combined-static-linux.log` SHA256 `383db1c2aed6b9373b7e2a1833b8168c49e91aec817dd462708bf38b84ea167e`保留，补空挂载点后未修改源码或历史对象。

另用Git固定27a的239表Schema在本机创建空隔离源库，与当前244表目标Schema逐对象比较：旧对象定义无变更，新增`arca_offer_withdrawal_receipts`、三张Libra Custom Target表及`libra_us_adult_catalogue_bases`。以真实`initializeResetTarget`对该源/目标进行冷转换预检返回`RESET_SOURCE_SCHEMA_UNREVIEWED`；这是独立于239表保留声明的第二道fail-closed围栏。`reset-239-to-244-probe.log` SHA256 `9b95f3c042a2888761c3e55e4bbe992fb6d62d859ff9f3a01f783be9e6845bf2`；空隔离库不代表已验证生产数据、真实版本回退或五张表各自保留合同。

## 后继4774候选与UI失败

在独立27a候选工作区依序挑入Foundation/Perception恢复、提交窗口测试和P13稳定摘要修复，形成固定`4774a7e9056f644c29b8034ea07baeb4f578c4f6`；标准`build-image.js`生成本机tar SHA256 `1a280a3efea6f67b97019552d8fd76ed7c8fe655bf5aa52998686c559b6b3023`，构建日志`image-build-4774a7e905.log` SHA256 `0c999a2891e2949fcb39d8ab44e795bc8978062292e2c5639a3b501dfe90190c`。4550跟踪文件在Linux源码卷逐个Git blob一致；七个变更后的运行文件与实际镜像逐字节一致，测试用Service依赖目录与镜像`/app/node_modules`递归字节一致。Linux完整架构以该固定源码、同依赖、只读完整历史对象及27a gate工具镜像执行中；具体版本Service用4774镜像执行。

该源码Linux Web首跑因只读`node_modules/.vite-temp`无法写入而未启动，日志`linux-web-4774a7e90.log` SHA256 `f085026fb4a9eb3a66796527aa0828dad6f4dfdc7bf5c68ff325b8b50b015488`；用临时可写缓存覆盖目录后49文件/274项通过，`linux-web-4774a7e90-retry.log` `2ecccfefbb1d9e495350c8b69a16b01175a5bc36e82eb84203d40e5c6b93fa11`。Service首轮828通过/25失败/28跳过，25失败均在未设置`HELIX_TEST_ISOLATED_TRANSCODE=1`时要求专用转码挂载；已同时挂载一次性`/transcode`但遗漏开关，日志`linux-service-4774a7e90.log` `9c1115cead5f9e6ba277e99b9886028222ec10ec8f777be7b7d5da847902d09a`保留，补开关后的完整重跑进行中。

补齐一次性tmpfs与隔离开关后，4774实际镜像Linux Service完整重跑853通过/0失败/28跳过；跳过的真实媒体或专用夹具不作为通过。日志`linux-service-4774a7e90-retry.log` SHA256 `fc582d72882409ac747a43086093095a71d762edb2cf4f239cd6685e3231e0a5`。这不覆盖完整架构、CIFS或UI失败，也不推翻首轮记录。

UI负责人对精确4774报告**FAIL**：受控注入同basis评分Resolution重试耗尽后，Decision为failed，单条/批量评分投影仍为pending，实际镜像Web显示“正在匹配豆瓣评分”。报告`E:/my_project/helix-git-consolidation-20261008/series-ui-review-4774a7e905-20261029/owner-review.json`；该注入不证明真实Host自然到达该终态或生产受影响。Perception修复线程正在补真实Host、评分投影与Decision当前性一致性及性能保护；后继版本须重新接受具体版本UI核验，4774不得发布。电影`db824ddb3`返焦开发版经UI负责人独立复核通过，报告`E:/my_project/helix-git-consolidation-20261008/movie-ui-precheck-db824ddb3-20261029/owner-review.json`，不等于最终镜像验收。
