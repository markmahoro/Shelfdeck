# ShelfDeck 当前状态

2026-10-13 UAT-319：用户授权NAS重启后的两服务重启及挂载缺陷修复。MoviePilot HTTP200；ShelfDeck容器已恢复SMB，但临时设备号0:93→0:81引发HELIX_MOUNT_SCOPE_UNSAFE，服务尚未就绪。Platform稳定CIFS指纹与显式CAS证据纠正工具Windows17项通过，尚未部署/纠正生产。媒体及Scope ID/revision保护，不Reset、不重处理五项媒体。aef性能/UI候选已获具体版本UI接受，但完整Host演练中断未通过，UAT-318仍开放。本机任务演练容器已停止删除；NAS先前nice_taussig在重启后已确认不存在，不再增加NAS重型对照。

2026-10-13追加UAT-318：用户明确“整理中”及“我的收藏”点击至实际内容小于1秒、管理响应优先于后台吞吐；原则已补SSOT §10.6，不新增调度器。505生产再次复现27–35秒等待，轻量health同样迟到；采样热点在Arca健康批量读取历史事实。当前本地按当前Inventory Revision提前过滤及克制加载反馈补丁已通过相关68服务/21 Web/4浏览器测试，1服务进程恢复未启用；514收藏同快照完整输出一致、局部428→212ms，不是生产达标。尚未发布、Linux最终镜像/UI负责人及生产1秒验收待完成。NAS SSH连续握手失败；只读隔离对照容器nice_taussig的停止未获确认，须先复核该任务自建容器；不停止生产业务，不重处理五项媒体。

2026-10-13最新生产为markmahoro/shelfdeck:505844a8b，git505844a8bade56e7705ee47e0d578874f9117efa，Image sha256:73484068340fec14df3e66d52d2689a6c586c5dbab21d91807faf58af20de6c4，tar1724124160 bytes/SHA25638362057d5b1f516861800485d3d947931e44fe3b8f3f8214dec61bce920932d。标准build/upload/checksum/dry run/readiness/health/供给/Admin/五挂载/QSV通过，RestartCount0，最终镜像Perception专项28通过。加载空态补丁生产多轮复验0次误报；本轮纯后端无UI字段变化，前端保持已验资产。十二轮48请求全部200，十一轮最长约0.99–1.91秒，一轮5896ms；未复现原数十秒，但性能UAT-318保持开放，非完整SLO窗口。五项失败媒体未人工重处理，狂暴女神/sample及正式安全停机/Reset仍暂缓；问题未全部验收，不执行全面生产清理。Avail约25GiB。

2026-10-13第四轮已标准发布24821200d34fe055036c0d11ac5b1dc9afbf6cbd，Docker markmahoro/shelfdeck:24821200d，Image sha256:7f77396fd54c7587969faf588f4a8da718f6585f735319ece6a7e55410028f9a，tar1724123136 bytes/SHA256251935ecf66e3ab26ebb3164d53fa21dd55b31b09d9963ff7189804a57be689b。readiness/health/供给/Admin/五挂载/QSV通过，RestartCount0，最终镜像141通过。前端资产与6feda已验版本一致，纯后端无UI字段或文字变更；实际两轮四Tab空态误报0。十二轮48请求均200，十一轮最长约1.2–2.1秒，另一次6172ms；性能UAT-318仍开放，未重处理五项媒体。追加Perception纯字符串计算缓存28项通过、尚未发布；没有缓存评分、业务事实、候选集合或决策。

2026-10-13第二轮已标准发布 `markmahoro/shelfdeck:6feda0d26`，git `6feda0d26a3d3ff5994a17d23d83ac1bc3a756ce`，Image ID `sha256:88ee3b310b9d07fab4c95914e3936152014a09e601163f9bf38e67b0dc0d9af7`，tar SHA256 `f7fb047d9ebecefa14a5db8b2b7e0e285900d7c46efb59337bd0ab0e5439f11d`。备份integrity ok/FK0/SHA、readiness/health/供给/Admin/五挂载/QSV通过，RestartCount0；最终镜像35通过，跨层UI具体版本66项及实际页面接受。生产Chromium两轮四Tab：有条目Tab误报空态0次；正常空结果保持，未执行媒体写操作。但HTTP仍有15.9秒长尾，UAT-318不关闭；追加采样定位Series候选恢复中反复构造未签发策略Work，局部修正139专项通过、未发布。未执行整季加工E2E/desktop全量，五项失败媒体仍未重处理。

2026-10-13生产已标准发布 `markmahoro/shelfdeck:9a23b01c7`，git `9a23b01c7ff8c5d16272898e2efe3296e500cd0c`，Image ID `sha256:23ec509e81511ee9fc84f50ad61f87c633a4ab8ac6d9cc2e4d508fc24f994a7b`，tar SHA256 `e7d95627ebc588c0161e6e109452f5edc5c479744c307558ea69f868695055ff`。标准checksum/readiness/health/Admin/五挂载/QSV通过，RestartCount0；最终镜像专项79/79，发布前备份509 Entry/509 Commit，本地integrity ok/FK0及SHA匹配。未重跑整季加工上架E2E或desktop全量，五项失败媒体未重处理。真实四请求并发样本旧版三轮4891/2530/4762ms，新版3626/1683/1750ms，仍有长尾，UAT-318不关闭；这不是完整SLO资格验收。用户追加整理中加载时误报空态，纯前端补丁专项14项及Web构建通过，尚未发布；服务优化生产UI审核仍进行中。

2026-10-12 9478a4fc7标准发布完成：Image sha256:d3fcc1f839494fb441835c23ac05da49635432af6db85f526e06ca2fcf6d78f7、tar SHA256 e530bdc7f880b12b8be312bc7134e1ead1a4f6baa6d81d6e2389aaf2580ac552。readiness/health/供给/Admin/挂载通过，RestartCount0；完整镜像120通过/1既有skip。发布前备份本地integrity ok/FK0及NAS SHA一致，509 Entry/509 Commit。生产UI已独立接受UAT-315计数，三query一致；六项原失败/放弃Run无Token，无人工重处理。用户新反馈Tab慢登记UAT-318：局部候选有界Result/评分读取，Linux79通过、同备份12次JSON等价、读取量下降86–87%，尚未发布或整页验收。盘Avail约46GiB。三部剧历史诱因及全面清理保持开放。

2026-10-12修复准备：用户要求先完成修复、暂不重处理五项失败媒体。计数/Reset/查询优化双平台各92通过；追加FFmpeg安全超时诊断双平台各28通过/1既有skip，Linux一次时序断言失败后原样复验通过。兰闺喜事原S01E17只读三点解码均通过，历史超时诱因仍未证实；两电影原Run均已discarded。当前盘约26GiB可用。修复尚未发布，UAT-313/315/316/317不关闭，详情见315–317 Evidence。

2026-10-12 MoviePilot恢复：用户授权启动、未授权暂停下载。追加清理UAT-281三份已被最终备份替代的中间DB后Avail约6.2GiB。精确清理满盘遗留网络endpoint，原MoviePilot容器/配置/数据及172.18.0.2:3000连接恢复；NAS本机和LAN页面HTTP200，启动日志Application startup complete，容器running且不重启；ShelfDeck health200/normalSupplyAllowed=true。未暂停或删除任何下载。剩余下载量未核清，6.2GiB不作为不会再次满盘的保证；UAT-313两片业务结果及新代码发布仍未完成。

2026-10-12最新复验：计数/Formation查询开销/Reset闭包相关Windows及Linux各92项通过；Linux先前失败已确定为测试包漏带前端源码，补齐后通过。未发布新产品代码。UAT-313释放后《绿头苍蝇》实际search发出3次请求，均ECONNREFUSED；MoviePilot容器因ENOSPC退出，恢复该容器待用户授权。继续清理已被05-stopped替代的01/02/03预检DB后Avail约6.1GiB；最终停机与Reset备份保留。两套大下载暂停亦待用户选择。生产问题尚未全部解决，不能结束收尾清理验收。

2026-10-12继续处理：用户授权的UAT-313旧Work恢复reservation已通过Foundation abandonExecution释放，保留31次事故及范围外全部Circuit/Incident；两搜索尚未产生Attempt，验收仍开放。当前卷再次满盘，Against.the.Current两套剧集下载近期写入；七份已完成升级测试的数据库副本也已按清理授权删除，正式05-stopped/Reset备份保留。计数统一及减小Formation查询范围仍为本地修正、未发布；Linux92项91通过/1失败，复验受ENOSPC阻断。临时暂停两套下载等待用户选择，详见UAT-313及UAT-315–317 Evidence。

2026-10-12后续：用户授权的两份旧镜像tar已删除，Avail恢复约3.3GiB；《罪恶之城》原正式放弃命令200/discarded，Run revision3且Token=0。投影恢复ready，但active/completed/ended仍为7/10/10，页面延迟仍在；UAT-315/316/313未关闭。按追加授权删除UAT-281四份已结束测试数据库副本，保留日志、正式备份、媒体及当前回退材料；四份逻辑8GiB不等于实际释放空间。容器未重启，cab3e2d77与health正常。用户要求问题解决后再统一清理生产；详见[清理与复验](implementation/evidence/UAT-315_317_PRODUCTION_DIAGNOSIS_20261012.md)。

2026-10-12升级后排查：生产仍cab3e2d77，发现/app/data所在卷Avail=0（100%）；备份约52G、test-runs约23G。三体/繁花/兰闺喜事已自动discarded且无Token，失败分别为资料网络错误、身份查询超时、FFmpeg验证超时；不是三项真实席位残留。Formation跨section summary为6/9，旧投影stale；查询一致性与Reset恢复探针闭包本地修正共65项Windows测试通过，未部署。用户已授权正式放弃罪恶之城，但入口500且Run/Token未改变；两个旧镜像tar限定清理等待明确授权。详见[UAT-315–317排查](implementation/evidence/UAT-315_317_PRODUCTION_DIAGNOSIS_20261012.md)与[UAT-313](implementation/evidence/UAT-313_RESET_ORPHAN_RECOVERY_CIRCUIT_20261012.md)。安全停机/用户Reset尚未设计实施，狂暴女神与sample仍待优化。

2026-10-12 17:34：Series生产升级完成，标准镜像markmahoro/shelfdeck:cab3e2d77，运行时git cab3e2d77ac0b6506a268c97ac07af82f4442e49，tar SHA256 bfe6769dedae1699d24c5349d6b9077cb364091e1ac8c6f55f9ea98aff4e9aa0。获批四项限定Reset完成并幂等，504 Entry/36111 Inventory/504 Commit及保留执行历史迁移后逐行一致，integrity=ok/FK=0；4原视频大小及指纹保留。NAS/LAN health=ok、normalSupplyAllowed=true、Admin HTTP200、挂载/QSV/fnOS及其他容器正常，RestartCount=0。用户可自行配置Series Shelf/来源。最终Windows/Linux两集NFO→Commit→迁移链路与Service602通过/0失败/29skip；未执行生产Series整季E2E或桌面全量。备份、精确身份、首次Reset回滚及最终部署证据见[生产升级记录](implementation/evidence/SERIES_PRODUCTION_UPGRADE_20261012.md)。下文为历史时点，不覆盖本次最终状态。

2026-10-12 17:21：四项获批生产Reset完成，4 Subject/4 Run/1 Package/59 Work清零，重复plan幂等，integrity=ok/FK=0，504收藏保护审计进行中。旧镜像Reset遗漏outcomes导致首次拒绝，DB/Workspace已完整回滚核验后，标准包装显式使用最终候选不可变镜像完成清理；包装专项10+闭包回归1通过。完整停机备份05及精确Workspace备份已核验，追加Reset备份formation-reset-20261012T091753Z保留。最终cab3e2d77标准deploy apply进入readiness，尚未确认服务恢复；不宣称已部署成功。

2026-10-12 17:08升级执行中：用户明确批准限定《万里归途》《周处除三害》《宇宙探索编辑部》《荒野猎人》四项旧未入藏进度Reset。17:00只停止生产ShelfDeck，停机标准plan ready=true且四Subject与授权完全一致，当前504 Entry/504 Commit保护；未Reset或加载新版。精确Workspace备份series-cab3e2d77-stopped完成7文件/7104409698字节逐文件SHA校验（另一Workspace不存在）；data/compose/secret停机备份05完整性及摘要校验运行中。在线只读备份方法在关闭WAL后报CANTOPEN，失败04副本保留，改为停机文件复制；未修补原库或绕过校验。

2026-10-12 16:50：最后的Series UAT-307/310已由原大江大河33集新Run c884204c…正式Media Cast Fact验收关闭：67 Observation保留、63唯一relation、单份S3E001 NFO来源、Fact31550字节，34 NFO/海报及35 Artifact验证成功，失败0；原Run完整上架仍独立进行。UAT-311已按最终输入等价提速、双平台与原Artifact链路关闭，282–311本批Series问题各按自身Evidence收口。cab3e2d77最终镜像完整生产副本启动/退出正常；501 Entry、35946库存及501 Commit全量摘要一致，保留执行历史逐行一致，integrity=ok/FK=0。镜像构建、上传SHA256及dry run通过。生产仍旧镜像，未停服、Reset或升级；下一步仅待当前精确未完成Formation生产Reset授权及停机备份/标准升级。并行新增Movie外部BDMV问题不由此批Series关单代替。

2026-10-12 16:22：UAT-311最终修正cab3e2d77已加载本地18081/PID28364，停机备份integrity=ok/FK=0。相同武林外传冻结NFO事件输入摘要保持，准备耗时1082–1277毫秒降至135–145毫秒；仅是局部测量。Windows34专项、双平台重复NFO/Commit/迁移及Service602通过/0失败/29skip通过。精确镜像已标准构建/上传checksum及dry run通过（SHA256 bfe6769dedae1699d24c5349d6b9077cb364091e1ac8c6f55f9ea98aff4e9aa0），生产副本完整Host验证进行中。原大江大河重试已完成来源观察、进入273成员/6范围封包Run，媒体probe 59成功/214等待资源，尚无原33集新Fact。情满四合院Libra完成但Arca仍在来源结算，不能称入藏完成。307/310/311开放；NAS未停服、Reset或升级。

2026-10-12 15:52：现场CPU剖析定位新UAT-311，Artifact投影反复构建整季所有Episode草稿，15.25秒采样约9.56秒在productMetadataContext；此前不能将全部等待归因于142 GB复制。Libra内部按单次输入准备复用、仅构建所需Episode，34项专项、Windows完整NFO/Commit/迁移91.34秒、Linux同链路及相关专项7通过/0失败/43skip、四项静态门禁通过。已停止本地旧PID28208，停机DB备份375545856字节、integrity=ok/FK=0，准备加载验证。生产未动；d6097265e镜像已被本次运行时修复取代，须重建候选。

2026-10-12 15:39：两项获批本地放弃已完成，服务未重启。情满四合院46集mandatory media验收约623秒成功，已进入Arca stage；该步骤仍占共享写资源。大江大河正式重试的来源观察第一页成功，后续页等待资源，尚无新候选/演员Fact，307/310仍开放。生产只读范围已随正常运行变化，不能复用先前4 Subject清理计划；正式停服/Reset前须刷新并单独确认范围。NAS未停服、Reset或升级。

2026-10-12 15:25：用户批准的本地《大宅门2》《乔家大院》均已通过正式放弃入口进入discarded，77个原视频存在且大小一致。原大江大河33集新Run e26c2ffa…完成67份资料获取及34份NFO生成/验证，但海报失败，未生成最终人物Fact；相同配置的独立只读海报调用随后成功867619字节，尚不能确定原失败原因。已正式reprocess（intent 227638f0…）继续验收，307/310保持开放。凡人歌37集已completed，单Episode演员事实是额外现场旁证。生产未停服、Reset或升级。

2026-10-12 15:07：三国95个原文件在独立临时实例重新封包并正式Libra接纳，Claim16562字节、Handoff A Receipt1、失败0，未配置Shelf/未创建Run；实例已停，UAT-309关闭。用户明确批准放弃本地大宅门2及乔家大院以优先验收：前者已discarded，后者closure_pending；大江大河新33集Run e26c2ffa…经正式入口加急，继续UAT-307/310原场景验收。生产未改变。

2026-10-12 14:52：backup03原镜像完整Host冷启动health=ok/normalSupplyAllowed=true并正常退出，约23分钟；只读挂载的EROFS不代表旧任务恢复通过。UAT-293冻结历史兼容按自身证据关闭，生产仍旧版本。当前剩余307/309/310现场验收。本地来源通过正式API临时3→8席位以推进原问题候选，已接纳大江大河33集Intake进程并恢复策略为3；已占用Token自然完成释放，不改转码资源配置或生产配置。

2026-10-12 14:40：最终运行时候选d6097265e已标准构建/上传，生产副本candidate310完整Host健康启动，SQLite integrity=ok/FK=0。501份On-deck Commit及保留的Plan/Node/Edge/Result/Marker逐行摘要一致；一条Entry由Inventory Revision 2→3经正式人物引用刷新凭据解释，未改写旧执行历史。原镜像对backup03完整恢复启动仍运行。全架构2493通过/1旧摘要断言失败/12skip，更新该测试固定值后相关3项通过；Service602通过/0失败/29skip。当前开放293/307/309/310，其他前述已验条目以UAT总表为准。生产仍旧版本，未停服、Reset或升级。

2026-10-12 UAT-310用户最终选用首个非空Episode的单来源演员名单，取消拟议8 MiB扩容。原大江大河33集证据只读重放4166→63条，完整Draft31300字节；Windows32项合同及双平台NFO/入藏/整季迁移Host通过，静态门禁通过。原现场加载及重处理继续，生产未升级。详见UAT-310 Evidence。

2026-10-12 13:24后：用户选择的《大宅门》2001第1季40集已有正式On-deck Commit（Entry `1c1241dc1356fa408b65a89598b45ca1e39f955694358b3d581554c47da4d2ea`）；潜伏、Netflix三体此前外部调用失败，不计通过。三国95成员经正式failed-preparation retry建立新采购Run，大江大河33集复用原幂等键重放202，等待原问题链路验收。UAT-292当前源码原竞态完整Host92.42秒通过并独立关闭；291/284/293/307/308仍开放。

生产继续原版本正常处理，收藏已增至501。新完整备份`/vol1/1000/docker/shelfdeck/backups/series-preflight-20261012-03`：SQLite 2,545,827,840字节、SHA256 `f41a544d2e7e1e004c724f77b5f99094e73c9b93cb0481f88d68277d59fc0f4b`，39伴随文件一致、integrity=ok/FK=0；501收藏/35946 Material/501 Commit/615 Run。旧4 Subject范围因正常生产推进发生变化，不能复用旧授权范围。仅新增备份，未停服或Reset。5996cef8f8中间镜像已标准构建，tar SHA256 `e446d9acd5fd2e2bf6ee169e5fd03572d66c895289c5aec858db05bdf3bdf61d`；未包含后续308及UI修复，不是最终部署镜像。新快照隔离演练与原镜像冷启动回退验证仍运行。

2026-10-12继续升级：UAT-293冻结历史只读验证的完整生产副本Host已健康启动；499收藏/35915 Inventory Material/499 Commit及保留历史逐行摘要一致，integrity=ok/FK=0。Linux专项105通过、最终Service601通过/0失败/28skip，全量架构重跑中；精确候选镜像及回退仍待验，生产保持原版本。UAT-289已由指定UI负责人接受b87a61bc8；294/295/297/298/300/301/302按各自证据补齐关闭，不能外推其他未验UAT。用户已选定大宅门2001、潜伏2009、Netflix三体2024，三份身份命令已202接受；三体后续因网络失败退出，经正式入口重试一次，其他任务继续。

2026-10-12后续用户确认：同意已完成历史的只读兼容并继续执行升级，取代此前暂停决定。范围为冻结旧合同、逐条验证历史及跨Plan证据，不恢复旧未完成Formation、不改写历史、不绕过校验。生产仍须完整副本验证和全部Series UAT各自验收；生产Reset另行按当前精确范围授权。

2026-10-12最新用户决定：“暂不扩展历史兼容，保留生产现状”。不实施所提冻结旧合同兼容方案，不执行NAS升级或生产Reset。UAT-293继续阻断发布；既有修复和独立验收保留，不宣称全部Series UAT已清零。

生产副本在最小逻辑Reset及Schema升级后，完整Host仍因27,592项PLAN_CATALOG_DRIFT拒绝启动；生产未改变。最新全量架构运行：依赖/语义/manifest/合同扫描通过，2485通过、2失败、12skip；两项失败均为P7测试Governor缺少abandonWaiters，补齐夹具后该文件14项全部通过，未再次执行整个全量suite。Service601通过、0失败、28skip。UAT-307重复NFO完整Host Windows与Linux均通过，原现场新Run仍待验；UAT-289具体版本UI验收由指定负责人继续完成。

2026-10-12后续：按用户要求先逐项处理Series UAT再升级。UI负责人`01a0912a-0086-74e2-88ab-536c59d3862a`负责UAT-289具体版本验收。UAT-304停机/Effect恢复修复已通过Windows与Linux实际FFmpeg中断、重启唯一Commit及再次重启幂等；Service601通过/0失败/28skip。UAT-305实际依赖及manifest扫描已通过，原全量fixture8失败对应179项修复回归通过，全量重跑中。新增UAT-307精确重复人物hint修复，1022条本地Observation只读重放无重复relation，Windows两集NFO完整Commit通过；本地18081/PID33100加载后health正常。未将尚待现场或UI验收的条目批量关闭。

生产仍为`helix-beta-20260930-8e197b3c36`，未停服、升级或Reset。完整data/compose/secret备份在`/vol1/1000/docker/shelfdeck/backups/series-preflight-20261012-02`，receipt校验39伴随文件、2,545,827,840字节SQLite，SHA256 `9366b15b9d48812961b27ec52f7e70e9ad9a9fd67aa2b08e4f6604721c32c638`，integrity=ok/FK=0、499条收藏与499份Commit。副本升级命中`SERIES_OFFLOAD_FORMATION_RESET_REQUIRED`：3 active Run及1未入藏Package；默认全局Reset被保留Subject锚点保护拒绝，限定4 Subject的60 Work逻辑Reset在隔离副本通过，Schema升级至200表通过。未接入实际Workspace写权限；这不是完整发布演练或生产Reset授权，完整Host及最终镜像升级/回退仍须通过。

2026-10-12：用户授权NAS生产升级，剧集Shelf及来源由用户上线后配置。HEAD `eb56ef6f1`发布前实际package/manifest扫描仍失败（8项依赖违规、1项表清单envelope），UAT-305阻断发布，未构建/上传/apply或Reset。NAS只读preflight及health正常，仍运行`helix-beta-20260930-8e197b3c36`、RestartCount0、normalSupplyAllowed=true；备份与完整生产副本升级/回退演练尚未执行。详见[UAT-305复验证据](implementation/evidence/UAT-305_EXISTING_ARCHITECTURE_GATES_20261011.md)。

2026-10-11 19:31：UAT-306 Series自动观察修复`525469601`已部署本地18081/PID8704，health正常。Windows相关15项、双平台95集无手动扫描Host通过；国产剧总目录自动扫描成功，发现4955文件，自动建立2个Procurement Run，共1642 Material/40 Scope。后续封包与整理仍运行中，不声明全部上架完成。用户明确无需历史条目兼容或防重复处理；本次无兼容代码、无Reset、无NAS部署。UAT-306按自身条件关闭，UAT-304/305仍开放。详见[Evidence](implementation/evidence/UAT-306_SERIES_AUTO_OBSERVATION_20261011.md)。

2026-10-11 13:44：用户明确Series本地开发快速迭代，无需等待安全退出窗口，已记录CURRENT_PLAN持续授权。核对PID及18081监听后直接终止旧18116及FFmpeg子进程，停机SQLite backup SHA256为35ce7bd9760b70a79c186a4fb88388bf15bdbcdc8c7c497f580e518965bd8483。以5c3effc200b194d5b4a41d67a6dbef01dd612fb8启动PID41120，已加载UAT-284及301/302；health ok/normalSupplyAllowed=true，人世间恢复transcode且新FFmpeg进程34616已启动。失败计数保持FFmpeg3/Provider Transport3/Network1/Timeout15，Run6、Commit0，未Reset/重扫/NAS部署。UAT-304正常停机缺口和UAT-305架构门禁仍开放，强制中断恢复不等于这两项已修复。

2026-10-11 13:24：用户确认UAT-284的Series Unit方案后已提交c60427d93，实现SSOT/typed合同/Owner重建，双平台95文件隔离Host各发布一个Season Candidate，完整Unit67785字节、Foundation Structure2022字节，持久证据重建通过。1024成员及8 MiB边界、缺失/篡改拒绝通过；Windows P7/Schema186项、Service599通过/0失败/27skip，P2合同与语义扫描通过。Linux P7为156通过/1项缺Git的旧Exit审计环境失败，独立95文件Host通过，不计整套PASS。全仓package8项、manifest1项失败与修复前HEAD完全一致，另记UAT-305开放。原三国现场新封包仍待验；18081保持旧81a5a2e41及真实转码，不为加载修复重启，UAT-304仍开放。详见UAT-284 Evidence。

2026-10-11：用户要求拉起本地继续修复。18081以81a5a2e41及原preview-uat294/data启动，health正常；12:49人世间仍转码，历史失败计数未增加，白鹿原上次已discarded，尚无新Commit。UAT-301/302读取优化已提交761c5e98a，最终77集混合NFO/Provider完整Host Windows984.83秒、Linux1302.94秒通过，231项来源结算及On-deck Commit完成，UAT-300完整Host阻塞解除；受控Provider/mediaProbe不代替真实影片验收。Service626项中599通过、0失败、27既有skip；Movie native4k完整Host及相关边界回归通过。UAT-303历史回退工具固定旧Schema，双平台各5项通过并按限定范围关闭，不关闭UAT-293。新增UAT-304：停机终止FFmpeg可能写成加工失败，尚未修复；现场未为加载优化重启，301/302现场加载仍待验。UAT-284的95集Unit合同方案待用户确认。停机数据库备份已核对，不Reset、不操作NAS；不完整Workspace副本清理被自动审批策略拒绝，副本保留。

2026-10-09 22:41后：77集混合来源诊断最终231项结算和Fulfillment均成功，On-deck Commit准备查询超过500项，登记UAT-300。Arca有界分批只读装配已修复，双平台各21项通过，完整77集容器重跑中；未将UAT-298或整体E2E计PASS，本地新Run未中断。

2026-10-09 UAT-299现场通过：e6a6a201d已加载18081 PID52284，健康正常。人世间/白鹿原旧Run均自动discarded，69942/91640字节完整Decision归Libra，Foundation引用各383字节；工作区清理推进。两条正式重新处理请求均202，等待新Run完整验收。UAT-299自身关闭，Series整体上架和77集诊断仍开放。用户授权无需安全窗口重启，失败历史保留，NAS未动。

2026-10-09后续：用户要求不等待窗口，18081已正常停机备份并以PID51504重启加载UAT-298，health200/normalSupplyAllowed=true。人世间被中断转码记录失败后frozen，自动discard又遇69942字节Evidence超64 KiB，UAT-299已确认并修复，双平台各43项通过，真实副本69942字节Decision/383字节Record原子回滚及重放通过，待本地加载；白鹿原仍active。未Reset/NAS部署，结算诊断容器继续。

2026-10-09 21:36后：UAT-298 Linux77集已通过发布、Arca验收/落位/最终校验，旧NFO上限消除；但40分钟测试终点来源结算160/231完成、71待处理，零失败Event，尚无Commit。带30秒进度/耗时和保留数据库的诊断复验已启动，不能仅延长预算就计PASS；现场转码仍执行，本次Schema尚未加载。

2026-10-09后续：UAT-298用户确认后，Series NFO来源交付证据1024条已实现，其他Profile16条、完整Provenance1 MiB保持；双平台41项边界/Schema/交付回归通过。Windows17集混合Host完整Commit通过（90.73秒），Linux77集原场景仍在跑。现场两Run均进入媒体处理且transcode执行中，暂未重启加载本次Schema，未关闭UAT。

2026-10-09 19:21后：UAT-297长预算混合来源Host双平台已越过metadata/artifact/fact/media/conformance，随后publish因ProductionProvenance.sourceNfoObservations仍最多16条失败；精确输入失败摘要匹配，登记UAT-298待独立合同确认。未完成Commit，不计完整PASS；现场18081仍在媒体处理，本轮未重启。

2026-10-09 18:42后：UAT-297用户确认后已实现Series资料集合1024项/8 MiB，生成器、Schema/Registry同步，双平台51项专项/领域回归通过。本地原进程退出原因未明；已用原data恢复18081 PID15316，白鹿原artifact Work恢复running、人世间media Work恢复running，未Reset。77集混合来源Windows首轮旧预算耗尽（资料与事实提交已成功，无失败Event），Linux首轮退出诊断未保全，均不计完整PASS；40分钟预算的持久日志重跑及监控继续，未关闭UAT或宣称现场上架。

2026-10-09后续：现场白鹿原新Run资料232项均成功，但汇总超过Series128项合同，artifact Planner反复P9_METADATA_INTENT_ORDER，登记UAT-297待容量确认。人世间59项资料已通过，目前workspace_media_production admitted；两部剧均未上架，先前资料阶段推进不能代表整体正常。

2026-10-09：UAT-295 TMDB按季响应复用已加载本地18081；真实人世间58集/白鹿原77集各仅2次HTTP且标题剧情完整，双平台69项相关测试及Windows77集完整Host通过。UAT-296修复Series重新处理入口遗留Movie-only限制，原两条意图通过公开API重放均202，新来源Observation已建立两条active Run，资料获取成功推进且暂未新增失败。旧失败记录保留，完整新Run上架仍待验，NAS未动。

2026-10-09 12:25：UAT-295两条新Run已自动结束：正式Lifecycle先以integration_exhausted frozen，再由actorId=system的Discard Decision终结，非人工放弃。Formation ended2、无非终态Event、Arca/Commit/收藏0；没有新增错误。原TMDB逐集超时及恢复验收保持开放。

2026-10-09 12:13：UAT-294已获用户确认并修复，Windows/Linux 77集完整Host最终On-deck Commit分别640.05/658.09秒通过，完整Stage/Final/Fulfillment证据及Foundation64 KiB保护均通过；定向Windows25项、Linux22项、表合同/边界40项通过。新18081现场两Run各有一集TMDB三次超时，登记UAT-295；精确端点复测6项均200，但原失败未消除，Run仍在正式失败前置媒体证据流程，未上架。旧数据/4收藏快照保留，NAS未动。

2026-10-09 11:58：用户确认干净测试目录切换及UAT-294 Arca最终决策8 MiB。新18081已健康启动，三集成/收藏架/路由/旧输入自动处理授权迁入；旧完整data与4收藏保留快照，实际文件不手工处置。人世间58集、白鹿原77集通过定向扫描各接纳1包，均为全新active Run。UAT-294定向25项通过，77集越过原决策限制及Stage/Placement/最终校验，完整Commit复验继续；未发布NAS。

2026-10-09 04:31：用户明确以本地测试排查为主、不保留旧Run；Reset仅在副本完成，4收藏保留但391历史Plan仍阻断升级，见[UAT-293](implementation/evidence/UAT-293_LOCAL_UPGRADE_TEST_RESET_20261009.md)。18081旧实例健康，独立18082新实例200表启动正常，TMDB/MoviePilot迁入通过、豆瓣传输失败；主实例是否切换干净数据目录待范围回复。UAT-292修复28+53定向及原时序完整迁移Host通过。新增77集实测发现UAT-294最终落位决策64 KiB限制，尚未通过、扩容待确认。

2026-10-09 04:13：UAT-291 sidecar/逐集NFO映射与命名已提交af5fe3901并推送，双平台入藏/旧空季目录清理、Windows迁移及改名回归通过。用户授权更新本地18081；SIGINT完整排空后新版本被PLAN_CATALOG_DRIFT阻断（UAT-293），已逐字节恢复停机备份并以a45d7b13f冻结源码回退，health正常，未Reset/NAS部署。新代码尚未现场生效；棋士历史遗漏关联文件未处置。存放规则更新与旧健康检查Basis竞争另记UAT-292。见[Evidence](implementation/evidence/UAT-291_SERIES_RELATED_SIDECARS_20261009.md)。

2026-10-09 UAT-290：最终校验/Fulfillment及最终Commit Evidence均已改为Arca完整不可变记录与Foundation有界引用，Windows/Linux 47集完整Host均通过；Movie上架、Series迁移/NFO维护及合同/升级回归通过，见[Evidence](implementation/evidence/UAT-290_SERIES_FINAL_VERIFICATION_20261009.md)。现场18081仍a45d7b13f，保护大宅门2真实转码，未重启/Reset/部署NAS；上海女子图鉴仍等待来源结算授权，未执行删除。各容量UAT仍待现场验收，不因隔离测试通过关单。

2026-10-09后续：UAT-287及生产追溯列表扩容已获确认并实现；Windows核心74/Linux50、升级24、边界60通过，两集完整Host通过。47集已通过成品验收/交付/Arca验收，Stage Manifest94041字节命中Foundation64 KiB，UAT-288已实现，Windows三类Host回归及Linux存储升级通过；47集越过Stage/Placement后最终校验74939字节超限，UAT-290已获确认待实施；尚无47集完整E2E通过。现场副本196表摘要保持，18081仍a45d7b13f，保护真实转码，未Reset。上海女子图鉴进入offloading但缺来源结算授权，20项delete均未执行，提示缺口UAT-289。

2026-10-09 02:02：UAT-285代码a45d7b13f已推送origin/main。后续46/47集93次媒体输入失败Evidence均精确命中完整空间集合32成员上限，登记[UAT-286](implementation/evidence/UAT-286_SERIES_MEDIA_SPACE_CAPACITY_20261009.md)，合同扩容待用户确认；未修改失败Run或Reset。

2026-10-09 01:57本地UAT：用户确认UAT-285有界逐集Owner记录，原3 Run完整32/46/47集资料及NFO正式提交通过，按自身关卡关闭；双平台大剧情Host与Windows追加Host通过。未Reset/重扫/部署NAS。下一关《情满四合院》46 Primary媒体verify输入准备失败，独立排查中；《大宅门2》32项verify/select通过并转码。真实E2E仍开放，见[UAT-285 Evidence](implementation/evidence/UAT-285_SERIES_METADATA_CAPACITY_20261009.md)。

2026-10-09 00:29本地UAT：经用户确认修复UAT-284 Manifest Result，原4个任务恢复封包，总43包；第二采购Run正式completed。Windows44/Linux22及Movie HTTP Host通过。三国95成员Unit限制仍开放；3个整理Run在72项Metadata获取成功后触及整季Draft 64 KiB上限，UAT-285方案待合同确认。未Reset/重扫/部署NAS。

2026-10-09真实Series UAT：UAT-282原1777 Probe全部完成，39包发布/3接受；UAT-283有界Admission/Lifecycle Evidence修复后，原3 Subject建立active Run并通过首次检查，身份已确认、逐集资料获取推进。两项按各自关卡关闭，完整上架未验收；UAT-284另记录4 Manifest Result超限与95成员Unit限制。双平台45相关项通过，P2/Schema13和DDL9项通过，未部署NAS、未Reset。

2026-10-08 本地真实Series UAT：新增[UAT-282](implementation/evidence/UAT-282_SERIES_PROCUREMENT_PROGRESS_20261008.md)，大来源Probe队列硬上限导致重复十分钟退避空窗。用户确认容量释放有界唤醒合同，共用Governor修复ff4617995已加载本地Windows18081，双平台相关127项各通过；原两个Run保持，实际封包/E2E验收继续，UAT未关闭。该修复未包含在原可部署镜像84c2cd9268内，未部署NAS。

2026-10-08 最终状态：Series首个可部署候选开发Exit，标准镜像`markmahoro/shelfdeck:84c2cd9268`，产品SHA `84c2cd92687ad55851cd1d0984e94c1d14334031`。负责人已接受最终受影响UI；全架构/服务/Linux/真实媒体及升级回退证据和各自版本边界见[最终Evidence](implementation/evidence/SERIES_FULL_REGRESSION_20261008.md)。tar SHA256 `a5c09f6cd69a9193b89453bc8fda9f75b75ff7dabfe3c8ec3945510b981adfdc`。NAS仍是旧Movie生产版本，未上传、部署或Reset；当前442收藏/3个active Run的现场处置需精确授权。

以下为历史过程记录，保留旧失败和中间状态；最新结论以上述最终Evidence为准。

2026-10-08 当前收尾：0f78f4240修正后Windows 280文件完整架构Gate已通过；真实集成冷配置和本地旧Movie镜像升级/正式恢复演练已通过。33dd11627外部Direct/Remux/Transcode实际浏览器运行至收藏分别通过116.11/141.46/162.71秒；打开的Formation详情刷新已修复。当前追加失败原因文案及放弃源保护验证，待UI负责人接受具体提交和重建最终镜像。以下逐批记录是历史进展，不代表当前仍存在对应旧缺口；尚未部署NAS。

2026-10-08 候选终态：服务592通过/0失败/27skip，实际镜像Linux545通过/0失败/4skip；Windows全架构2410通过/2个过期摘要或生成清单失败/12skip。正式重建P3 manifest并同步P2固定摘要，12项复验通过，DDL不变；最终全量/镜像须重新冻结。本地精确旧Movie镜像→候选→正式备份恢复→旧镜像联合演练通过，1收藏/3文件及历史事实保持；未部署或修改NAS。

2026-10-08 候选验证进行中：36100db30标准构建镜像已导出，2121个运行时输入摘要与镜像一致；Windows架构全量和实际镜像内Linux Series回归仍在执行。服务总测试591通过/1个200ms看门狗测试时序失败/27skip，单独复验通过；仅将测试活动周期放大至跨越两个2秒静默预算，硬截止测试同样留出启动预算，三项专项通过，完整服务复验待完成。无生产代码/UI变更。NAS只读核验仍为原Movie镜像、442个收藏及3个active Run，无修改或部署。

2026-10-08 外部多part与进程恢复：三个真实4K文件经转码后按E01两part/E02一文件逐集验收，Windows124.69秒/Linux147.79秒通过；两个part各自整集超限Evidence保持，最终完整集合通过。加工/结算完成、On-deck Commit前退出进程后，新Host唯一提交及再次重开一致，Windows135.59秒/Linux174.19秒通过；恢复零外部调用，成品/Provider/范围外字节保护保持。21专项/P2/diff通过，仅测试增量，剩余失败矩阵审查与最终发布Gate继续，无NAS动作。

2026-10-08 外部Series转码接续：精确Import成员进入既有设备Assessment/有界策略，沿完整Scope预算生产，全部合格后重建实际成品映射；保留质量下限终结与禁止再次获取。真实H.264→HEVC两集Host Windows119.16秒/Linux130.84秒通过，映射/一次获取/Provider字节保护保持；双平台各147专项、Movie外部4项、外部Remux回归及P2/边界/语义通过。外部多part体积与进程恢复、最终冻结发布Gate仍开放，无UI或NAS动作。

2026-10-08 外部Remux已贯通：精确Import Work/Handle/Probe/Claims绑定加工源，两分集MP4封装MKV后重建全部替换目标，经全Run验收/Arca结算。真实4K HEVC/AAC Host Windows112.66秒/Linux120.66秒通过，逐段核对Remux→Package→Stage→Inventory、一次获取及Provider字节保护；双平台各145专项、Movie外部4项、普通Series混合Host及P2/边界/语义通过。外部Transcode/恢复及最终发布Gate继续，无UI变更或NAS动作。

2026-10-08 真实外部媒体Host：3秒4K HEVC/AAC分集素材经正式Probe/Playback/Import/验收/结算，Windows111.34秒/Linux118.70秒通过；Provider字节保护、两集覆盖及一次请求保持。仅网络仍受控，后加工/恢复及最终发布Gate继续，未改产品代码或操作NAS。见外部Host Evidence。

2026-10-08 服务总回归13项失败已修复：过期UI/Readiness断言、旧列数及缺正式映射/摘要的fixture、事故工具Inventory写入、评分Host授权/等待窗口。Windows619项592通过/0失败/27skip，Linux相关58项通过，P2通过；无产品UI变更或NAS动作。外部后加工/恢复及最终冻结发布Gate继续。见[全量Evidence](implementation/evidence/SERIES_FULL_REGRESSION_20261008.md)。

2026-10-08 已确认的EpisodeDelivery Requirement集合摘要落地，正式Event状态误用修复；共文件→两个分集的完整外部Host Windows97.67秒/Linux116.86秒通过，一次请求、Claims/结算/Provider文件保护保持。合同58/35项、外部失败路由3项、Movie外部4项及P2/架构通过。外部后加工/恢复、服务总回归13项失败及其他发布Gate继续；旧全架构因运行中变更仅作诊断，无NAS动作。

2026-10-08 多季退出：Arca正式身份投影季号，搜索/已选/审阅/记录可区分同名季；实际页面只退出S02四成员，S01六文件/事实/Control保持，Windows98.45秒/Linux103.84秒通过，单季40.74秒回归通过。138前端/构建/查询与架构检查通过；UI负责人已接受bfefd19ae此路径（独立Host99.13秒）。前轮完整路由Host29项通过，仍非最终发布Gate。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 同名双Season：S01两集后S02E01独立上架，首季六文件/历史事实保护通过；Windows94.71秒、Linux103.27秒、实际浏览器键盘/双视口95.11秒通过。修复收藏卡aria-label缺少季号，137前端/构建通过；UI负责人已接受b490aad36已验证收藏路径，多季运营及其他发布Gate继续。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 历史副本升级/恢复：修复迁移误用Custody状态、Reset遗漏Run Outcome；正式定向清理4个未完成Subject后升级成功，61张Arca表的保留记录不变，365个收藏受保护。原备份覆盖恢复后SHA256逐字节一致，双平台54项相关回归及架构检查通过。仅本地历史数据库演练，不代表当前生产/应用联合回退资格，无NAS动作。[Evidence](implementation/evidence/SERIES_HISTORICAL_UPGRADE_PREFLIGHT_20261008.md)。

2026-10-08 首次业务配置：无用户模板/收藏架起步，页面复制系统模板至两集实际上架38.12秒通过，系统revision不变、实际Spec每集0.5GiB；原混合加工37.36秒回归通过。负责人已接受31b1df37b本路径（独立38.40秒），真实集成凭据/完整冷启动及其他发布Gate继续，无NAS动作。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 页面退出：实际Series审阅/关闭/取消/最终授权至6成员删除39.13秒通过，范围外文件及取消字节保护/唯一终结保持。修复退出剧名搜索投影、弹窗焦点和busy保护、历史记录粘连；136前端/Windows及Linux查询/构建/架构检查通过；警示去重后38.36秒复验，负责人已接受51ed1bb6e已验证退出路径。其他发布Gate继续，无NAS动作。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 浏览器维护修复：真实NFO修复/复核91.66秒通过；补齐批量健康评分目标series_title，使列表与详情一致。追加演员按正式ID展示去重，72.26秒追加复验通过；movie_only资格不再误报文件损坏。133前端/8浏览器/Windows及Linux各61专项/构建与架构检查通过。UI负责人已接受a5dc10fac本轮路径（独立追加76.02秒/维护91.80秒）；其他运营/外部/冷配置/升级回退Gate继续，无NAS动作。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 浏览器追加：页面再次扫描/确认E03，唯一Season累计3集，旧文件/历史事实/追加原子性及重放保持，桌面窄屏73.15秒通过。负责人已接受2aaa423ce规则修复，新增追加待复验；运营/外部及升级回退Gate继续，无NAS动作。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 真实规则发布修复：已发布用户模板的旧Draft基线/响应解包错误修复，保留双CAS；冲突固定在弹窗操作区并保留输入。页面0.5GiB/集进入正式Spec且实际上架38.35秒通过，131前端/8浏览器/5正式HTTP及构建/P2通过。c7354defd创建授权段已获接受，新修复待负责人复验；其他发布Gate继续，无NAS动作。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 浏览器收藏架与授权：页面创建收藏架/选择模板/命名预览及自动清理确认接入来源至上架旅程，动态Shelf ID及实际结算断言38.35秒通过。负责人已接受a2910cc08来源段，新增创建/授权待验收；规则模板仍API预置，完整发布Gate继续，未操作NAS。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 浏览器来源到上架：真实页面登记Series来源、发布年份分拣并扫描，接续人工身份/Arca上架/收藏双视口38.41秒通过；仅测试增量。负责人已接受573444125登录至收藏段，新增来源段待复验。收藏架/规则仍由API配置，完整运营/外部及发布Gate继续。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 真实浏览器Host：页面登录→人工Series身份确认→实际两集上架→Collection详情37.26秒通过，无API拦截；修复截图发现的窄屏五列工具栏溢出，128前端/双视口收藏/原Host/构建及P2通过。待UI负责人精确版本复验；预配置仍经API，完整旅程与发布Gate不关闭，未操作NAS。[Evidence](implementation/evidence/SERIES_BROWSER_HOST_JOURNEY_20261008.md)。

2026-10-08 历史生产副本预检：只读下载9月30日既有备份并核验SHA256，正式升级因未完成Formation拒绝，拒绝后副本字节不变；Reset预检因14条保留路由锚点和10条非目标控制事实拒绝，未执行清理。仅安全拒绝证据，成功升级/回退仍开放，未修改NAS。[Evidence](implementation/evidence/SERIES_HISTORICAL_UPGRADE_PREFLIGHT_20261008.md)。

2026-10-08 部署准备只读核验：NAS容器shelfdeck仍running，镜像`markmahoro/shelfdeck:helix-beta-20260930-8e197b3c36`/`sha256:168be0bb2101b79424f7f978c32d3724852eb5267b2234a4c981c22fe075ac2b`，原五个数据/媒体挂载保持。只读数据库元数据为2359238656字节、197表；未获取副本、未创建远端文件、未部署/重启/修改生产数据。生产副本升级回退门槛仍开放。

2026-10-08 完整Aftercare重启：真实N:M成品落位后、Inventory Commit前退出进程，新Host完成同Case唯一提交，第三次启动结果不变；Windows108.19秒/Linux100.67秒通过，成品字节/Claims/未改成员与范围外文件保护通过。06a8ce7c0冻结278文件全量2402通过/0失败/10skip；新增重启专项单独通过。尚非完整发布资格。[Evidence](implementation/evidence/SERIES_AFTERCARE_HOST_RECOVERY_20261008.md)。

2026-10-08 Series长时媒体：20分钟带AAC的N:M正式Host在Linux CPU181.85秒、Windows NVENC183.57秒通过，成品时长/音轨/Claims/上架验证完整；素材为循环合成，不外推真实复杂画面质量。278文件冻结全量仍运行，未操作NAS。[Evidence](implementation/evidence/SERIES_LONG_MEDIA_HOST_20261008.md)。

2026-10-08 Series HDR专项：Windows44.08秒/Linux42.23秒真实N:M Host通过，Remux/CPU转码后两成品保留10-bit PQ/BT.2020及完整Episode Claims。仅3秒合成素材，长片/HLG/DV/画质等未覆盖。上一轮全量2396通过/1个已修复Stage误报/10skip，后续冻结全量仍需完成；无NAS操作。[Evidence](implementation/evidence/SERIES_HDR_HOST_20261008.md)。

2026-10-08 Stage并发误报修复：全部祖先保留身份/权限/链接校验，仅精确slot比较内容时间戳，避免兄弟目录活动被当作slot变化。Windows84项、Linux21项、并发10次及P2/边界/语义通过；原全量仍运行，最终冻结全量尚未通过。无UI变更或NAS操作。[Evidence](implementation/evidence/SERIES_STAGE_OBSERVATION_CONCURRENCY_20261008.md)。

2026-10-08 UI负责人接受冻结SHA `d4d86d234`：四项原缺陷及详情空槽修复通过；仅覆盖已复验来源/收藏架/整理详情/收藏详情状态，完整旅程与发布Gate仍开放。全架构仍执行，历史Stage测试的共享祖先目录时间戳并发失败已复现，尚未修复；未操作NAS。[Evidence](implementation/evidence/SERIES_UI_REVIEW_FIXES_20261008.md)。

2026-10-08 UI负责人四项拒绝已修复：Series分拣身份类型/摘要、弹窗键盘与忙碌关闭保护、收藏共文件去重分组、Formation进度去重。128项前端、8项Series双视口及2项Movie浏览器、构建通过；待新提交负责人复验，整体发布门槛不关闭，未部署NAS。[Evidence](implementation/evidence/SERIES_UI_REVIEW_FIXES_20261008.md)。

2026-10-08 完整架构回归结束：277文件2407项，2396通过/1入口健康等待超时/10skip；入口helper改30秒墙钟预算与1秒请求上限，相关83通过/2skip及重型并发3通过。原失败保留，最终全量PASS尚未建立。UI负责人已开始76ed35e32验收并报告分拣类型/弹窗键盘缺口，待正式结论和修复，未部署NAS。[Evidence](implementation/evidence/SERIES_FULL_REGRESSION_20261008.md)。

2026-10-08 跨文件系统恢复：Workspace tmpfs设备106、Inventory设备93，正式Materialize在三个rename边界退出后由新进程恢复/重放一致，外部写入冲突拒绝；Linux专项通过、Windows默认28项通过。完整Host其他崩溃矩阵及发布Gate继续，未操作NAS。[Evidence](implementation/evidence/SERIES_CROSS_DEVICE_RECOVERY_20261008.md)。

2026-10-08 跨文件系统真实Host：Linux来源/Workspace设备93、Shelf tmpfs设备106，96.91秒完成N:M上架及Remux/CPU Aftercare，Claims/原子回滚/结算断言通过；显式测试开关已保存。277文件Windows全量回归仍在执行，已见正式入口1失败但隔离复验通过，未宣称全量PASS。其他发布Gate继续，未操作NAS。[Evidence](implementation/evidence/SERIES_CROSS_DEVICE_HOST_20261008.md)。

2026-10-08 Linux Docker验证：本机Engine恢复，372768b68原Dockerfile构建通过；438项Series专项、E03追加、真实CPU N:M加工、99.70秒跨进程退出恢复及4条Movie外部场景通过。原生/投影专项缺测试挂载已补齐复验，1个live BDMV素材skip保留。其他发布Gate继续，未操作NAS。[Evidence](implementation/evidence/SERIES_LINUX_DOCKER_20261008.md)。

2026-10-08 Series命名示例与空间展示：收藏架按实际Profile提供单集/共文件/part示例，模板变更即时反馈；Formation明确每集空间上限。55项后端、125项前端、双视口/Axe及构建/P2/架构/语义通过。UI接受与其他发布Gate继续，未部署NAS。[Evidence](implementation/evidence/SERIES_NAMING_PREVIEW_20261008.md)。

2026-10-08 Formation本批范围：从当前展示Run的冻结Claims投影Season/实际集号/物理文件数，列表及过程详情保持一致。55项后端、124项前端、双视口及构建通过；94.15秒真实E03追加Host确认Formation仅E03、Collection累计三集。P2/架构/语义通过，负责人验收及其他发布Gate继续，未部署NAS。[Evidence](implementation/evidence/SERIES_FORMATION_SCOPE_20261008.md)。

2026-10-08 Collection Series详情：从当前Inventory及Canonical Season事实输出实际集数/文件关系，支持共文件和多part；不拿首文件规格代表整季。7项查询专项、共文件/part两个Host及E03追加94.2秒通过，124项前端、双视口及构建/P2/架构/语义通过。负责人验收和其他发布Gate仍开放，未部署NAS。[Evidence](implementation/evidence/SERIES_COLLECTION_EPISODES_20261008.md)。

2026-10-08 Series 人工身份UI：Formation区分剧集操作，预览冻结Season且确认不提交季/集；124项前端、Movie/Series双视口4项及构建通过。新增实际Host从无匹配经正式HTTP人工选择到两集Direct/Remux上架36.9秒通过。窄屏弹窗越界修复；Episode范围展示/Collection和负责人验收继续，未部署NAS。[Evidence](implementation/evidence/SERIES_MANUAL_IDENTITY_UI_20261008.md)。

2026-10-08 Series 人工身份命令：经用户确认扩展SSOT，TMDB Series ID绑定Run冻结Season/basis，拒绝改季扩集和跨类型，仍仅记录Intent并由provider_exact复验。49项专项、普通Direct/Remux Host35.9秒及P2/架构/语义通过。前端与人工选择完整Host继续，EpisodeDelivery摘要缺口保留，未部署NAS。[Evidence](implementation/evidence/SERIES_MANUAL_IDENTITY_COMMAND_20261008.md)。

2026-10-08 Series 收藏架规则UI：按Movie/Series展示与编辑，支持每集小数GiB，保留其他Profile和未改媒体要求；窄屏弹窗尺寸修复。121项前端全量、双视口规则/来源4项及构建通过；正式Arca规则校验通过，浏览器API受控。负责人接受、真实发布/重评及其他Series页面继续，未部署NAS。[Evidence](implementation/evidence/SERIES_SHELF_RULES_UI_20261008.md)。

2026-10-08 Series 文件来源 UI：登记可显式选择电影/剧集，卡片显示正式类型；失败重试与重复提交保护、标题层级修复。前端114项、双视口浏览器/Axe及构建通过；5项后端回归通过、1项缺本地素材skip。浏览器使用受控API，UI负责人同版本接受仍待完成；EpisodeDelivery摘要缺口按用户要求保留，未部署NAS。[Evidence](implementation/evidence/SERIES_SOURCE_UI_20261008.md)。

2026-10-08 Series正式观察入口：后台现有Admin API允许movie/series，其他Profile保持拒绝；9项真实SQLite准入/幂等/过期拒绝专项通过。首次上架37.1秒、同Season E03追加94.1秒、两个来源并发93.6秒均从正式HTTP入口通过。基线全架构2384通过/7失败/10skip，7项Offload扩展后的陈旧fixture/断言已修复，相关231项复验通过；Web构建及原生126通过/2skip。页面/浏览器及UI负责人同版本接受未完成；未操作NAS。[Evidence](implementation/evidence/SERIES_PUBLIC_OBSERVATION_20261008.md)。

2026-10-08 Series本地耗尽寻源：真实策略耗尽后进入完整关联Scope，其他技术失败保持终止；首个实测仅体积成品仍走既有质量保护。耗尽→搜索拒绝、技术失败不寻源、普通Direct/Remux Host及46项专项/P2/架构/语义通过。EpisodeDelivery合同缺口及整体发布Gate仍开放，未操作NAS。[Evidence](implementation/evidence/SERIES_LOCAL_EXHAUSTION_ROUTING_20261008.md)。

2026-10-08 外部Host修复：Series源像素缺口不再误走Movie路径，Query读取正式Run basis；搜索拒绝Host3.7秒、普通Host36.7秒、57项专项通过。Movie后加工残留候选次数调用修复，真实Transcode/Remux上架45.1/38.4秒通过。用户暂保留EpisodeDelivery逐集Requirement摘要合同缺口，完整外部替换Host显式skip，尚不可部署；未操作NAS。[Evidence](implementation/evidence/SERIES_EXTERNAL_HOST_GAPS_20261008.md)。

2026-10-08 Series外部调度：spec_external按完整Scope推进Search/Acquire/Import并恢复既有Work，完整consumer通过后按实际文件Claims附着Workspace，再回全Run终检；拒绝前序或失败媒体明确终结。14项专项、35.4秒普通Host及P2/架构/语义通过。内部耗尽/后加工/完整外部Host继续，未操作NAS。[Evidence](implementation/evidence/SERIES_EXTERNAL_COORDINATOR_20261008.md)。

2026-10-08 外部Series验收源：共用Import/成品Handle时也从唯一同Run成功Workspace记录重建endpoint/实际位置/revision，拒绝缺失/重复/跨Run，不伪造Field Binding。10项专项、35.4秒普通Host及P2/架构/语义通过。外部Coordinator与完整端到端继续，未操作NAS。[Evidence](implementation/evidence/SERIES_ACCEPTANCE_WORKSPACE_SOURCE_20261008.md)。

2026-10-08 Series完成绑定：Aftercare识别完整多目标结算回执，严格列表/摘要/时间资格后仅移除已完成旧source监控；16项历史回归通过。原生新Node进程重开保留完整证据，成品变更拒绝；P2/架构/语义通过。旧UAT-261见证不扩展为新Series兼容，完整Host恢复继续，未操作NAS。[Evidence](implementation/evidence/SERIES_COMPLETED_BINDINGS_20261008.md)。

2026-10-08 Series结算完成Evidence：Capability传全部目标及Final Decision，typed final_targets进入回执摘要；Commit逐一匹配当前落位key/位置/观察摘要，拒绝缺失/重复/截断/旧证据。20项专项、35.8秒普通Host及P2/架构/语义通过。历史恢复与完整外部Host继续，未操作NAS。[Evidence](implementation/evidence/SERIES_SETTLEMENT_COMPLETION_20261008.md)。

2026-10-08 Series原生源结算：异步端口逐目标匹配Package/Final Decision并核验真实落位指纹，全部通过后复核审批、仅删除唯一source；完整目标证据与重放核验，junction/缺目标/变更拒绝。81项原生回归及P2/架构/语义通过。Capability完成证据/恢复和端到端继续，未操作NAS。[Evidence](implementation/evidence/SERIES_NATIVE_SETTLEMENT_20261008.md)。

2026-10-08 Series结算Handle：完整有序目标key/位置与Final Verification证据进入一个原source审批摘要，缺目标/重复/乱序拒绝，任一位置变化使旧scope失效。16项回归、36.7秒普通上架Host及P2/架构/语义通过。原生多目标现场复核、结算完成证据与恢复继续，未操作NAS。[Evidence](implementation/evidence/SERIES_SETTLEMENT_HANDLES_20261008.md)。

2026-10-08 Series结算上下文：一个原source携带全部唯一Product/Final Decision目标，全管理路径及摘要保持；任一目标缺失/重复拒绝。14项回归、36.6秒普通混合上架Host及P2/架构/语义通过。多目标Handle/审批/原生结算与恢复仍待接通，未操作NAS。[Evidence](implementation/evidence/SERIES_SETTLEMENT_CONTEXT_20261008.md)。

2026-10-08 Arca多目标处置：ProductDispositionManifest传播完整互斥目标集合，一source一member；投影逐目标核对Package，Final Product Verification对全部落位成员检查缺失/重复。12项专项、35.8秒普通混合上架Host及P2/架构/语义通过。源结算/恢复与完整外部Host继续，未部署NAS。[Evidence](implementation/evidence/SERIES_ARCA_DISPOSITION_20261008.md)。

2026-10-08 Series Offload装配：Promotion重建完整外部候选映射，原文件携带全部成品且仅一row，保留原物理/Control；单目标scalar、缺失/篡改拒绝。30项专项、36.6秒普通混合上架Host及P2/架构/语义通过。外部Read Set、Arca/Coordinator和真实外部Host继续，未部署NAS。[Evidence](implementation/evidence/SERIES_OFFLOAD_ASSEMBLY_20261008.md)。

2026-10-08 Offload旧表升级：精确旧DDL/hash经既有事务扩展多目标列，保持已完成Movie原列、Package摘要及Arca/Custody/Shelf记录；未完成或错关联拒绝，复制后异常完整回滚并可重试。28项回归及P2/架构/语义通过。生产副本升级/回退仍未验收，Assembler/Arca/Coordinator继续，未部署NAS。[Evidence](implementation/evidence/SERIES_OFFLOAD_SCHEMA_UPGRADE_20261008.md)。

2026-10-08 Series进程恢复：N:M媒体物化三个rename边界退出/新进程恢复及冲突保护通过；真实Off-deck Host在删除完成、terminal提交前退出，新Host完成唯一终态，第三次启动Evidence不变。主动注入EPERM仍沿同Case/同Authorization恢复，增强Host 115.1秒通过。修复删除环境错误分类与退出Entry旧Aftercare纯观察恢复；118项专项、全架构2,311通过/10skip/0失败。跨设备/其他中断点/UI/Linux等发布Gate继续，未部署NAS。[Evidence](implementation/evidence/SERIES_PROCESS_RECOVERY_20261008.md)。

2026-10-08 Series Off-deck：真实N:M成品经正式Review/Selection/Authorization完成整季退出，2个Primary/3条Claims未重复删除，6个材料精确结算，范围外文件保留；11表终态事务故障回滚/正常提交通过，Host 45秒。原生SQLite跨Season/Movie共享引用与实际删除保护、18项专项及架构/语义通过。仅测试/证据，跨收藏完整Host和进程恢复等仍待验证，整体发布Gate继续，无NAS部署。[Evidence](implementation/evidence/SERIES_OFFDECK_HOST_20261008.md)。

2026-10-08 Linux环境预检：本机Docker Desktop启动因Inference socket错误失败，Engine未就绪，Linux验证未执行；失败日志已核对并结束本次启动/查询进程，未重置Docker数据。其他Series工作继续，详见媒体Host Evidence。

2026-10-08真实有界媒体维修：20秒1080p SDR/AAC源68,526,141字节，经NVIDIA target_size转码为14,280,933字节，低于每集32 MiB；939个音频包SHA256原样保持。正式Host 102.9秒通过，含Claims、事务故障回滚/提交、Control及Settlement；43项专项与架构/语义通过。仅测试/证据修改，N:M有界/长片/HDR/进程恢复/Linux/UI及整体发布Gate继续，无NAS部署。[Evidence](implementation/evidence/SERIES_MEDIA_AFTERCARE_HOST_20261008.md)。

2026-10-08 N:M真实媒体维修追加：共文件E01–E02与E01独立part经正式Host完成Remux/NVIDIA转码、Claims保持、Inventory-Control故障回滚/提交及Settlement，98.5秒通过；最终逐集实测13,493/5,927字节。该维修无空间上限，1 MiB仅作事后计量比较；真实有界压缩仍待合适尺寸源验证。仅测试/证据修改，30项专项及架构/语义检查通过；进程恢复/UI/Linux与整体发布Gate继续，未部署NAS。[Evidence](implementation/evidence/SERIES_MEDIA_AFTERCARE_HOST_20261008.md)。

2026-10-08真实Series媒体维修：正式隔离Host经规则/Shelf标准API触发一集保持、一集Remux、一集NVIDIA NVENC Transcode，Case健康终结；实际Inventory-Control事务末尾故障注入全回滚后正常提交，Claims保持、旧Control释放及Settlement通过，增强复验约100秒。安全成员策略对应缺陷已开放自动维修，缺策略仍需处理；全架构2,300通过/9既有skip/0失败。N:M/长片/进程恢复/UI/Linux与整体发布Gate继续，无NAS部署。[Evidence](implementation/evidence/SERIES_MEDIA_AFTERCARE_HOST_20261008.md)。

2026-10-08提交前现场复核：Series Inventory入口检查完整维修回执、最终落位文件、暂存原文件及未替换Primary，再按原Claims重建逐集空间；文件漂移在Control查询/事务写入前拒绝。57项专项及全架构2,300通过/9既有skip/0失败。真实原子事务、Claims持久化、Settlement/崩溃恢复及媒体Host继续，自动维修与发布Gate保留。[Evidence](implementation/evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。

2026-10-08完整成品集合门禁：Commit Planner和媒体Projection要求全部冻结目标的唯一同Work/Attempt/Plan成品与验证，维修输出和未替换文件共同按N:M规则逐集计量；集合摘要进入VerifiedCareInventoryChange。45项专项及全架构2,300通过/9既有skip/0失败。正式提交前现场复核、事务/Claims/Settlement/崩溃恢复与真实媒体Host继续，自动维修及发布Gate未开放。[Evidence](implementation/evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。

2026-10-08精确媒体物化：Series成品从源Handle摘要匹配唯一冻结Case目标，校验施工意图、Workspace归属与实际字节，回执明确原成员。三个目标实际文件替换、旧文件保护、forward恢复及精确Control变更计算通过；全架构2,297通过/9既有skip/0失败。完整集合终检、正式事务/Claims持久化/Settlement/崩溃恢复及真实媒体Host继续，未开放自动媒体维修或部署NAS。[Evidence](implementation/evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。

2026-10-08逐目标维修接线：准备Planner逐成员调度Remux/Transcode与验证，Effect按冻结Case选择原文件，Series输出身份/Remux路径按成员区分，部分输出清理读取精确Plan参数。混合Case计划、入口Fence和真实SQLite/文件清理验证通过；分组全架构2,297通过/9既有skip/0失败。完整物化/集合终检/原子Commit/恢复与真实媒体Host仍待完成，自动媒体维修及发布Gate未开放。[Evidence](implementation/evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。

2026-10-08精确媒体成品绑定：[Evidence](implementation/evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。Commit逐项绑定验证Event，经同Work/Attempt/Plan、输入Binding、Handle和Result摘要取唯一生产成品，拒绝错取或歧义。15项专项及分组全架构2,296通过/9既有skip/0失败；逐目标Effect、完整集合终检/原子Commit/恢复仍待完成，自动媒体维修与发布Gate保持开放，未部署NAS。

2026-10-08 Case成员策略消费：[Evidence](implementation/evidence/SERIES_CASE_MEMBER_STRATEGY_20261008.md)。完整成员集合纯校验由Arca观察与规划共用；Case从冻结健康Work及正式Assessment/Finding重建精确目标，Projection按materialKey取对应策略，拒绝错来源、缺成员及改写证据。39项专项、分组全架构2,293通过/9既有skip/0失败。逐目标维修Plan/Effect与完整媒体维修仍待完成，自动维修门禁保留，未部署NAS。

2026-10-08 完整成员调度：[Evidence](implementation/evidence/SERIES_MEMBER_ASSESSMENT_SCHEDULING_20261008.md)。健康Planner调度完整Series Primary集合，整季Conformance消费同Work/Attempt/Plan的精确成员证据并绑定集合摘要；缺失/重复/错scope拒绝，不重复Probe。26项专项及24集Plan通过，正式两集NFO维修Host验证成员结果持久化、摘要重建、专业Commit与最终健康（约92秒）；分组全架构2,292通过/9既有skip/0失败。媒体Case消费/逐目标Effect和完整维修仍待完成，未部署NAS。

2026-10-08 成员Conformance Result：[Evidence](implementation/evidence/SERIES_MEMBER_CONFORMANCE_RESULT_20261008.md)。现有Capability增加显式成员参数和closed memberScope，生成独立有界策略Evidence；专业Assessment投影/Commit排除成员结果，保持三维整季健康事实。37项成员/投影专项、合同生成及分组全架构2,291通过/9既有skip/0失败，Result仍限64 KiB。尚未调度完整成员集合或接通维修闭环，Series可部署Gate继续，未部署NAS。

2026-10-08 逐成员媒体策略：[Evidence](implementation/evidence/SERIES_CARE_MEMBER_STRATEGY_20261008.md)。Series策略引擎显式选择当前Inventory成员并校验对应Probe Evidence，Intent/preflight绑定完整空间Basis和文件预算；质量下限保持原单集档位，零预算不退成无上限模式。26项专项及全架构2,289通过/9既有skip/0失败。多策略正式Assessment、Planner/Effect和完整维修闭环仍待完成，未启用自动媒体维修或部署NAS。

2026-10-08 媒体维修空间基础：[Evidence](implementation/evidence/SERIES_CARE_MEDIA_SPACE_20261008.md)。Arca以自身完整Inventory的Physical Identity/正式Claims/Binding、revision与Care Basis建立逐成员保守预算；Libra仅复用纯字节算术，Owner边界保持。23项专项及共文件两集正式Host通过；最终全架构2,284通过/9既有skip/0失败。逐成员媒体Strategy/Effect/完整成品验收与Commit仍待完成，Series自动媒体维修尚未开放，未部署NAS。

2026-10-08 实际Placement：[Evidence](implementation/evidence/SERIES_PLACEMENT_CASE_20261008.md)。正式Host整季换目录和同目录Primary改名均完成迁移、Inventory/Control事务、旧位置结算及健康终结；修复旧评估Basis失效分类，以及未变化NFO/poster被错误结算的缺陷，并在删除入口保护当前Inventory位置。最终全架构2,281通过/9既有skip/0失败。进程崩溃/跨设备恢复、其余运营/UI/Linux及Series发布资格继续，未部署NAS。

2026-10-08 Placement输入：[Evidence](implementation/evidence/SERIES_AFTERCARE_PLACEMENT_INPUT_20261008.md)。Aftercare已携带完整Series/Season身份、各批Episode资料及当前Inventory NFO scope，真实两批Host可精确复原原位置并规划新目录；评估修正同目录改名漏检。全架构2,279通过/9既有skip/0失败。实际迁移Case/恢复、其余运营/UI/Linux发布条件继续，未部署NAS。

2026-10-08 联合展示维护：[Evidence](implementation/evidence/SERIES_PRESENTATION_CASE_20261008.md)。正式隔离Host同一Case恢复缺失poster和两集NFO，验证精确TMDB Series/Season请求、三份Artifact物化、原子事务、Settlement、正常/历史成员保护及收敛后Host重开，92秒通过。本批仅新增验证；完整运营/恢复/UI/Linux发布门槛仍开放，无NAS部署。

2026-10-08 NFO完整Case：[Evidence](implementation/evidence/SERIES_AFTERCARE_NFO_CASE_20261008.md)。已登记且scope/资料齐全的缺失或空Series NFO启用自动维修；正式隔离Host同时修复两集，Inventory-Control原子回滚/提交、Settlement、正常成员及旧revision保护通过。People关联收敛后Host/SQLite关闭重开保持事实及健康状态；全架构2,271通过/9既有skip/0失败。真正进程崩溃恢复、其余运营/UI/Linux和完整发布资格仍开放，未部署NAS。

2026-10-08 NFO维修副作用：[Evidence](implementation/evidence/SERIES_AFTERCARE_NFO_EFFECTS_20261008.md)。精确Profile到独立Workspace NFO、来源Fence、只替换目标成员的物化及forward恢复已接通；12项真实文件Capability专项及全架构2,269通过/9既有skip/0失败。尚缺正式Host的Case/Inventory-Control事务、结算与重启验证，自动维修仍关闭；UI/Linux与完整发布资格继续，未部署NAS。

2026-10-08 NFO维修目标冻结：[Evidence](implementation/evidence/SERIES_AFTERCARE_NFO_TARGET_FREEZE_20261008.md)。Series逐成员Finding、Case历史证据到精确目标、独立TextRender Planner/Profile已接通，错Binding/Scope/Basis拒绝；299项维护相关回归通过。Series实际维修写入仍关闭，下一段接副作用、物化、原子提交与恢复；UI/Linux及完整发布资格继续，无NAS部署。

2026-10-08 NFO重建增量：[Series NFO Render Evidence](implementation/evidence/SERIES_AFTERCARE_NFO_RENDER_20261008.md)。已按正式Artifact scope及原批次资料重建整季/单集NFO，实际两批Host全部四份目标通过；Commit Planner修正多NFO重复取首个结果。专项39项、全架构2,233通过/9既有skip/0失败。尚未启用Series NFO实际维修，目标冻结/副作用/原子提交及恢复继续；完整UI/Linux/发布Gate保持开放，未部署NAS。

2026-10-08 NFO关联持久化：[Inventory Artifact Scope Evidence](implementation/evidence/SERIES_INVENTORY_ARTIFACT_SCOPE_20261008.md)。Series NFO目标与已接受来源已纳入Inventory/Deck摘要及Commit，追加保留旧关联、历史回执可重建。E01/E02→E03完整隔离Host通过；全架构2,202通过、9既有skip、0失败；最终维护/Scope回归239通过。Movie精确旧schema新增空列并保持事实，旧Series缺关联拒绝升级。逐Artifact维修/UI/Linux及完整发布资格仍待完成，未部署NAS。

2026-10-08 NFO目标映射：[Artifact Targets Evidence](implementation/evidence/SERIES_ARTIFACT_TARGETS_20261008.md)。Arca按完整Metadata scopes及Artifact Requirement/材料摘要确定整季与逐集NFO目标，正式落位复用同一映射，拒绝重复/错季/歧义目标。共文件两集隔离Host上架通过；全架构2,190通过、9既有skip、0失败。Inventory关系持久化和逐集维修尚未接通，UI/Linux及发布资格仍开放，未部署NAS。

2026-10-08 NFO完整性：[NFO评估Evidence](implementation/evidence/SERIES_AFTERCARE_NFO_ASSESSMENT_20261008.md)。Series现检查全部已登记NFO，后集缺失/空文件不再被Season NFO掩盖；现有单NFO写入路径在Series上明确拒绝，防止误修其他集。Aftercare回归225项通过。精确Artifact目标到逐集维修提交尚未接通，不能视为完整维护交付；UI/Linux与发布门槛仍开放，未部署NAS。

2026-10-08海报维护身份：[Provider Identity Evidence](implementation/evidence/SERIES_AFTERCARE_PROVIDER_IDENTITY_20261008.md)。修正Series Aftercare请求被固定成TMDB Movie的问题，以全部已接受批次验证Series/Season后调用原Artifact Adapter；错季/身份不一致拒绝。95项相关测试及边界/语义检查通过。完整展示维护、逐集NFO、逐成员维修、UI/Linux及发布资格仍待完成；无NAS部署。

2026-10-08全成员健康评估：[Aftercare媒体Evidence](implementation/evidence/SERIES_AFTERCARE_MEDIA_ASSESSMENT_20261008.md)。Series当前Inventory全部Primary现执行Probe/播放抽样，空间按完整N:M集合精确逐集计算；15项专项通过，正式Capability/schema验证通过。全架构复验2,150通过、9既有skip、0失败；首次曾有1项目录变化Fence失败，独立复验通过，原始记录保留。Series媒体维修策略仍未接通，缺陷明确保留attention_required；UI/Linux、完整运营与发布资格继续，未部署NAS。

2026-10-08补集资料检查：[Inventory Metadata Evidence](implementation/evidence/SERIES_INVENTORY_METADATA_20261008.md)。Aftercare修正逐集标题/剧情误查第一份Metadata顶层字段的问题，改为当前Inventory范围内全部批次的精确Episode资料；两批正式Host Owner context验证通过。全架构2,135通过、9既有skip、0失败。完整Aftercare、Series UI/浏览器/Linux和发布资格继续；外部N:M替换合同仍待此前用户确认。未部署NAS。

2026-10-08升级测试债修复：[历史schema Evidence](implementation/evidence/SERIES_HISTORICAL_UPGRADE_FIXTURES_20261008.md)。原9项失败来自伪旧DDL和过时自动retire预期，现改为8份可校验Git来源的真实历史DDL及current schema不改写运行记录的断言；联合升级门禁20项通过。本轮不改生产迁移，不构成同库发布/回退验收。外部Series N:M替换的多值源→成品映射方案已写入Phase并等待用户确认，其余独立工作继续。

2026-10-08真实Series加工：[真实媒体Evidence](implementation/evidence/SERIES_REAL_MIXED_MEDIA_20261008.md)。Windows正式Host的三集Direct/Remux/NVENC Transcode和共享文件＋同集part的N:M完整上架通过；最终实际字节数在Libra/Arca两端逐集复核通过。105项成员/预算回归通过。本批为短SDR无音轨/无上限样本；有界加工重试、逐成员外部寻源/恢复、运营、UI/Linux及发布资格继续，未部署NAS。

2026-10-08混合成品接线：[终检与交付Evidence](implementation/evidence/SERIES_MIXED_FINAL_SELECTION_20261008.md)。完整实际候选集合终检及逐成员Staging/交付/源结算已接通，受控Direct+Remux两集隔离Host完整上架通过；100项专项通过。全架构复验2,121通过、9既有skip、0失败。真实Series转码Host、逐成员外部寻源/运营、UI/Linux及发布资格仍未完成，未部署NAS。

2026-10-08逐成员Transcode Planner：[规划Evidence](implementation/evidence/SERIES_MEMBER_TRANSCODE_PLANNING_20261008.md)。源/策略历史/输出按成员隔离，完整Assessment连续性和N:M物理预算接通，质量下限保持原单集Policy；全架构2,106通过、9既有skip、0失败。Coordinator、混合成品Staging/终检/交付仍需接线，真实Series转码、UI/Linux及发布资格未完成。

2026-10-08逐成员加工增量：[成员范围与Remux Planner](implementation/evidence/SERIES_MEMBER_MEDIA_SCOPE_20261008.md)。成员Work身份/策略依赖、单文件读取Fence、Remux四节点及输出完整空间Basis已实现；全架构2,091通过、9既有skip、0失败，Direct共享文件完整Host保持通过。Coordinator混合成品调度及逐成员Transcode仍未接通，不构成完整加工交付或可部署版本。

2026-10-08 Direct N:M接通：[空间Basis Evidence](implementation/evidence/SERIES_DIRECT_SPACE_BASIS_20261008.md)。完整冻结成员集合进入Direct验证，支持共文件均分与多part累加；共享文件12字节/集、两part合计48字节/集的正式隔离Host上架通过。修正Procurement错误拒绝同Candidate内部Episode重叠，保留跨批Intake约束；电影真实媒体回归通过。逐成员加工/混合成品、UI及真实Series/Linux和发布资格仍未完成。

2026-10-08逐集空间接纳：[最终空间Evidence](implementation/evidence/SERIES_FINAL_SPACE_ACCEPTANCE_20261008.md)。Arca已修正整季总量误判，保存逐集精确份额；Libra最终Conformance独立重算，支持共文件/多part最终数学验收。两集各24字节、每集上限24字节的正式Host上架及24集回归通过；bounded N:M的Libra入口保护仍在，逐成员加工与完整首版发布资格继续。无UI交付或生产动作。

2026-10-08并发增量：[并发Run与目标预约](implementation/evidence/SERIES_CONCURRENT_TARGET_20261008.md)。两批非重叠Run保持各自范围，Arca以持久化目标预约避免共享文件接管冲突；并发Host已通过。预约/恢复/精确旧schema升级与拒绝未完成责任专项通过；历史迁移测试9项失败已在修改前基线复现，保留为发布资格缺口。尚未完成逐成员加工、N:M完整验收、UI及真实媒体/Linux，不宣称可部署。用户已要求每批验证后提交并推送，保持GitHub与本地一致。

2026-10-08连续性增量：[同Subject分批补集](implementation/evidence/SERIES_SUBJECT_CONTINUITY_20261008.md)。显式Series Claim经过正式Provider查证后，E03沿用原Subject并独立Run扩充同一Season，旧集/Run/历史保持；顺序Host通过。并发Run及完整首版发布资格仍未完成，无新部署。

2026-10-08最新追加：[Season扩充Evidence](implementation/evidence/SERIES_SEASON_EXTENSION_20261008.md)。实际隔离Host E03扩充唯一Season收藏，原文件/历史及两批元数据保留；该无claim样本为两个Subject，同Subject连续性入口仍待接通。254文件回归仅旧固定摘要断言失败，已更新并专项复验通过，9项既有skip。Series发布资格仍未达到，无新部署。

2026-10-08最新增量：[Direct On-deck Evidence](implementation/evidence/SERIES_DIRECT_ONDECK_20261008.md)。2/24集实际隔离Host已完成Arca接纳、Season/逐集落位、正式授权源结算及唯一Season Entry/Deck Fact提交；正式Inventory/Claim/文件/NFO与Provenance核验通过。完整架构251文件及边界/语义/合同通过。仍未满足首版部署门槛：逐成员加工、N:M聚合、追加/运营、真实媒体/Linux和UI验收继续，未发布生产。

更新：2026-10-08。Helix Beta Movie全链路获用户阶段验收，Movie阶段文档收尾及Beta工程清理完成；用户已要求开始Series开发，以Phase工作项管理。UAT只用于上线后的测试、验收问题；原279保留误登记及转移记录，278/280保留历史收尾/清理事实。记录与证据边界见[UAT-278](implementation/evidence/UAT-278_BETA_MOVIE_CLOSEOUT_20260930.md)。Series完整功能尚未交付，未声明新的技术资格总体PASS或正式release tag。

2026-10-08节点1增量：[逐Primary Direct验证](implementation/evidence/SERIES_DIRECT_MEDIA_20261008.md)。2/24成员独立Verification与Selection已接通，小数GiB及用户确认的共文件均分/多part累加计算核心已实现。Run多Selection消费、加工、Package及N:M最终证据接线仍待完成，节点1保持开放；无生产发布。

2026-10-08接续：[多成员Direct交付](implementation/evidence/SERIES_DIRECT_PACKAGE_20261008.md)已完成2/24集Host的完整Conformance及Product Package发布，验证所有Primary、claim、NFO与读取权限。schema容量升级专项通过，完整架构复验250文件通过；Arca正式上架、加工、N:M最终验收、发布资格仍未完成。

## 最近已记录生产身份

标准apply已切换 `helix-beta-20260930-8e197b3c36`，git `8e197b3c3685d21d87c581bae1016ed70896e2c3`，tar SHA256 `c6b84d0de15b92a38a5ecbe58003f2dc2fdafb2f42c41d66408f3b16e3711d02`，Image ID `sha256:168be0bb2101b79424f7f978c32d3724852eb5267b2234a4c981c22fe075ac2b`。243架构文件及完整检查、Windows相关138项、最终Linux165通过/1canary跳过；最新完整副本候选及同库旧镜像回退均完整启动、正常调度、关闭且保护十一类历史事实。生产health/normalSupplyAllowed、Admin、挂载/QSV/Secret及十一类发布前事实保护通过。16:45:49 CST《网诱惊魂》原Run自动完成封装、输出验证、来源处置及唯一On-deck Commit，页面“已进入收藏架”，Shelf Entry active、Inventory/Deck Fact revision1；UAT-281关闭。见[UAT-281证据](implementation/evidence/UAT-281_REMUX_PROBE_RETRY_CONVERGENCE_20260930.md)。全量Service/Desktop/全库整理E2E未执行，没有UI修改、Reset或直接SQL改写。本次整合仅核对既有证据，未查询生产实时状态。

### 前一生产版本（历史）

| 项目 | 值 |
| --- | --- |
| 镜像 | `markmahoro/shelfdeck:helix-beta-20260928-c147188485` |
| 源码 | `c14718848597063dcd28fed002ae8e5e5897a7e5` |
| tar SHA256 | `df9a74befe6ac9bd5ac3014222598c2ff7bd57f1958079decb6aaa4c14400ffa` |
| NAS Image ID | `sha256:a928dc2cb13a03e6e379f3f88420a104dbf83d06fe658b0192a6d9de6a4e9fb0` |
| StartedAt | `2026-09-28T15:19:12.747534143Z` |
| 发布 Evidence | [UAT-275/276/277](implementation/evidence/UAT-275_276_277_ONDECK_FAILURES_20260928.md) |

该发布 Windows 架构241文件、适用真实媒体与精确 Linux 镜像、完整候选/同库回退 Host、标准发布及8类事实摘要保护通过；全量 Service/Desktop/全库整理 E2E 未运行，历史失败片未重跑。上线前后321 Shelf Entries/24635 Inventory Materials不变，未 Reset 或自动重跑。以上为历史发布证据。2026-09-30清理重新核验生产镜像、StartedAt、挂载和RestartCount0保持原值，health200；未重跑媒体链或重新核验上述业务计数。

## 已接受成果与保留事项

- 2026-09-30 用户确认当前运行比较稳定，接受 Helix Beta Movie 全链路阶段成果。Beta 保持 Movie-only A–I；Series 不追认进原 Beta。
- 现有 UAT 逐项状态见[总表](UAT_ITERATION_REGISTER.md)。已部署、待实际影片或完整业务验收的项继续开放；历史待核实记录不能直接视为当前缺陷。
- 2026-09-29 “检查整体运行状态”聊天只读检查报告：health/Admin 200、无容器重启/OOM，转码仍推进，最近一小时14次成功无新增失败；321上架，保管检查正常。标准符合性63项及呈现5项降级可能重叠，未逐项核验，不据此宣称全部收藏健康。
- 同次检查保留三项风险：《侏罗纪公园2》记录94.4%但输出增长；73次监听器超限警告；系统盘85%/约28GB可用。关联 UAT-127/170/212、125/152、262。2026-09-30工程副本清理后系统盘60%/约70GiB可用，原85%为空间历史快照；进度与监听器风险本轮未修复。
- 已上架瑕疵条目不追溯重加工、不撤销上架、不因新接纳标准触发历史瑕疵修复。未完成 Formation 条目仍按 Playbook 的精确授权及 clean-cut 纪律处理，当前没有新增 Reset 授权。

## 当前开发与归档

2026-10-08 Git整合：当前开发回到主工作区 main，已合入Series 1d998a43c及维护eb0bd08a3，合并提交2c2998827。24个旧本地分支名已退役，10个附属工作区已移除，现在只保留main。原提交保存在archive refs与恢复包，未提交修改及必要非重建资料保存在preserved目录，重复完整副本已清理。UAT-267工作区经用户确认退役，问题本身仍开放；不表示所有历史独有改动已合入。验证与恢复见[整合Evidence](implementation/evidence/GIT_WORKSPACE_CONSOLIDATION_20261008.md)。以下日期段落为各次实现时点，旧工作区描述不再表示当前归属。

2026-09-30用户确认Series按5节点推进，UI遵循现行规范并由UI负责人验收。Master Plan/Phase及AGENTS已记录逐节点门禁；隔离分支补齐主工作区已确认的Playbook §11.1和Beta baseline §7.1，主工作区既有其他用户修改保持。UI负责人已确认职责并回传[验收范围矩阵](implementation/evidence/SERIES_UI_ACCEPTANCE_SCOPE_20260930.md)；具体页面结论仍需同版本实际走查，当前没有Series页面交付或UI PASS。

Series初审及Windows专项测试见[审查Evidence](implementation/evidence/SERIES_READINESS_AUDIT_20260930.md)：13项中12通过、1跳过；跳过项正是Series Handoff A纵向fixture。已有Episode Claim/Run合同基础；TMDB字段、逐Episode NFO及外部落地快照仍有明确缺口，不能直接启用。未执行真实Series E2E或浏览器验收；范围、开发工作项和准备Exit均在[唯一 Phase](implementation/CURRENT_PHASE.md)。

首批Series元数据基础已交付`ea3d33d16d1bb19949f379e36ea648cfafd003a6`：[实现与验证Evidence](implementation/evidence/SERIES_METADATA_FOUNDATIONS_20260930.md)。TMDB显式验证Series/Season tuple与Season响应，支持series_title/season_number；Renderer新增冻结到Season/Episode的episodedetails NFO并保护Related源。Windows两批共103项通过，无失败/跳过，含Movie相关回归。当时尚未接入逐Episode Observation/Draft、Artifact调度；后续进展见下文。Series入口保持阶段限制，不能把旧初审或叶子验证当完整链路结论。

逐集接线已交付`cca63288607aab127edd8e000221c00b373bca7a`：[接线Evidence](implementation/evidence/SERIES_EPISODE_METADATA_WIRING_20260930.md)。Intent/Observation按冻结集范围取资料；Draft/Fact保留typed逐集资料，Artifact Planner及Owner projection生成Season/各集NFO，Verification核验目标覆盖。172项受影响回归及最终12项重叠专项通过，P2通过；不能将两批计数相加。节点1仍未关闭：真实Foundation/Workspace/原生Fact commit、Artifact正式交付关联及普通长Season容量需继续贯通。没有Series UI交付或新生产部署。

原生验证追加`a36b22dab`：实际Workspace文件/Handle、3条Artifact verification、E01/E02 Product Metadata Fact及来源引用保存与重放，Owner写入失败原子回滚和Source Result改写拒绝均通过；相关48项测试通过，最终16文件受影响回归176项通过、0失败/跳过，P2再次通过。计数有重叠，不相加。上游Series身份和完整调度仍未接通，普通长Season容量待验证；节点2还需补Arca Season/Episode正式命名，当前默认NFO映射会碰撞。上述补充取代前段原生Fact commit未覆盖的状态，证据及未测边界见同一Evidence追加。

2026-10-01节点1增量`215af03f5261029410c2d8e8041778ba1396a8dd`：[Series身份与continuity发布](implementation/evidence/SERIES_PRODUCT_IDENTITY_20261001.md)。Series Product Identity的Plan/Owner projection、TV+Season search/exact、closed Intent/Observation和正式Subject identity/continuity事务已接通；native commit/replay、最后head CAS失败回滚、跨Season拒绝及未来Intake匹配查询通过。15文件302项回归通过，生成manifest后44项重叠复验通过，P2通过；追加`f61beacb1`实际Identity Capability入口的原生发布通过，专项最终31项通过。仍未验证从Field经Routing/Scheduler到完整Series Run、实际E03追加、长Season容量或Arca正式落位；节点1未关闭，无UI PASS和新部署。

实际调度本批交付`4831a923b`：[Routing与调度Evidence](implementation/evidence/SERIES_ROUTING_SCHEDULING_20261001.md)。2/24集从正式Field经Intake、Routing、Spec、身份及逐集生产执行到原生Metadata Fact；24集生成Season加逐集25份NFO、海报及25条资料来源。Series来源上限128，Movie/JAV16，字节界保持。最终181项基础/Series及17项Movie/集成回归通过，无失败/跳过，P2通过。节点1继续逐Primary媒体与交付关联；没有Arca上架、Series UI验收、真实媒体/Linux或生产部署结论。两处测试Temp递归清理被自动审批拒绝，目录暂保留，Host均已关闭。

节点1追加逐Primary源探测`51d8ab8d018321f6c754eb88c4f7313c8e90e6ed`：[Source Media Evidence](implementation/evidence/SERIES_SOURCE_MEDIA_20261001.md)。实际Host的2/24个物理Primary分别产生只读Probe，Plan冻结完整成员digest，Owner projection与Result reconstruction拒绝跨成员/旧Binding、缺失/重复/foreign或payload改写；Movie单源及原盘合同保持。13文件100项通过、0失败/跳过，最终22项重叠专项通过；另3文件25通过、2项因Windows/缺少live BDMV fixture跳过，P2通过。测试停止Source Work边界，完整产品验证、逐Primary加工、Conformance/Package关联仍待实施；节点1未关闭，无UI PASS或生产部署。

原活动文档及残余队列已冻结到[Movie 收尾快照](implementation/archive/20260930_BETA_MOVIE_CLOSEOUT/SNAPSHOT.md)。隔离分支 `codex/beta-closeout-series` 基于 `ecccf7ba9b`继续开发，最新代码见上述实现提交。主工作区、集成区及其他有未提交修改的工作区保留，修改状态未变化。

UAT-280已完成：[清理证据](implementation/evidence/UAT-280_BETA_WORKSPACE_CLEANUP_20260930.md)。NAS删除60项废弃工程资料（20个tar、21个测试目录、19个备份）及142个旧镜像标签；全部29个容器身份/启动状态未变，保留当前/回退及必要验收镜像、含原媒体和事故恢复备份。本地37个Git worktree退役27个，保留10个；34个旧镜像包、40个测试副本、另2份过时测试数据库及5处退役残余全部清除，本地可用空间较原快照增加约99.7GiB。首次审批拦截已通过明确文件及空目录操作安全完成。37个源码snapshot ref/恢复bundle及1670份必要文件复验通过，三处共享依赖和三个有用户修改的工作区状态保持；无剩余选定待删项。

同日追加只读复查发现首轮Git沿junction清理还影响了主Service及主/集成Web依赖，前次仅恢复SSH工具依赖不完整；续作的metadata保护比较基于首轮之后，不能证明首轮依赖未受影响。现已在三处按各自锁文件`npm ci`补齐，SQLite/Sharp及两处esbuild原生绑定smoke通过，用户修改及锁文件无新增变更；修复后本地净可用空间较原快照增加约98.7GiB。未新增文件删除。另有约0.94GB的UAT-125旧诊断库、约32MB测试包及约1.6MB忽略的构建输出；诊断库仍关联开放项，暂保留，不扩大已关闭280的精确清理范围。

清理阶段未构建或部署新版本、未改动生产业务数据/媒体、未重启服务；未新增功能测试或技术资格PASS。后续Series准备专项测试事实见上文，不改写清理阶段结论。部署集中负责人职责已按用户2026-09-28决定取消，UI负责人职责保留。

2026-10-08 N:M有界维修：两个20秒大文件正式Host通过111.4秒，E01/E02按均分加part分别41,778,237.5/15,218,166.5字节，均低于每集64 MiB；独立part 939音频包保持，Claims/事务回滚/Control/Settlement通过。修复MP4→MKV未指定语言und/缺省等价误报，42项专项及架构/语义通过；小共文件比例预算限制仍开放。外部寻源完整范围替换方案已获用户确认，合同传播待实施；UI授权及Linux等发布Gate继续。未部署NAS。[Evidence](implementation/evidence/SERIES_MEDIA_AFTERCARE_HOST_20261008.md)。

2026-10-08外部替换范围模型：用户确认已写入SSOT §3.2.6；Libra完整冻结关联分量与source-to-all-final映射纯校验完成，17项专项及架构/语义通过。尚无生产调用方，外部Work/Provider Evidence、多值schema/持久化/Promotion/Arca结算与完整Host继续，不声明寻源已启用或可部署。[Evidence](implementation/evidence/SERIES_EXTERNAL_REPLACEMENT_SCOPE_20261008.md)。

2026-10-08外部Scope Work接线：Series三个阶段Work及依赖/并发/幂等身份绑定完整Scope，正式Planner按范围构造查询和Package EpisodeDelivery并拒绝跨范围Query，Movie身份保持。34项专项、36秒正式Series上架Host及完整P2基线通过；SSOT源行号/摘要410个生成文件已同步，无字段语义变化。多文件Import、Coordinator/Provider和多值交接/Arca结算仍待闭环，未部署NAS。[Evidence](implementation/evidence/SERIES_EXTERNAL_WORK_SCOPE_20261008.md)。

2026-10-08 Series外部多成员Import：正式Planner逐成员导入/Probe，每个Verify依赖完整范围结果，以实际Handle及冻结Claims进行均分+part验收；不同Scope目标路径隔离，跨范围Package和错Event/Probe拒绝。23项合同/Planner及30项原生端口测试、完整P2/架构/语义通过；原生第二成员ENOSPC重试保留第一成员和全部Landing。Coordinator/Provider/完整候选终检及多值交接/Arca结算继续，未声明端到端可用或部署NAS。[Evidence](implementation/evidence/SERIES_EXTERNAL_MULTI_IMPORT_20261008.md)。

2026-10-08外部Import Result消费：校验成功Scope Work最新Attempt/Plan、全部Import/Probe/Verify/Select及原Acquire Evidence，重算完整范围验收/Selection和source-to-all-final映射；不合格媒体保持ineligible。26项专项和P2/架构/语义通过。consumer待接入Coordinator/全Run候选替换，后续多值交接及Arca结算仍待闭环，未部署NAS。[Evidence](implementation/evidence/SERIES_EXTERNAL_IMPORT_RESULTS_20261008.md)。

2026-10-08外部候选合并：完整Scope Import集合接入正式Series候选Reader，整分量替换、范围外保留；最终空间Basis覆盖全Run并重建映射/Claims/Handle。110项专项、37.2秒普通Direct/Remux混合上架Host及P2/架构/语义通过。Coordinator触发、外部不合格媒体后处理和多值交接/Arca结算仍待闭环，未声明外部端到端可用或部署NAS。[Evidence](implementation/evidence/SERIES_EXTERNAL_CANDIDATE_MERGE_20261008.md)。

2026-10-08 Provider搜索覆盖：MoviePilot季号与Episode集合改为读取实际meta_info明确范围，禁止从Query复制；下载前复验同候选身份/覆盖，缺集/错季/跨季/矛盾字段在POST前拒绝。21项Provider回归及P2/架构/语义通过，使用受控网络响应；Landing逐文件Claims、Coordinator和多值交接/结算继续，未部署NAS。[Evidence](implementation/evidence/SERIES_PROVIDER_SEARCH_COVERAGE_20261008.md)。

2026-10-08 Series Landing：同job逐文件Transfer History绑定真实文件和明确Season/Episode Claims，支持共文件+part；稳定性端口重读记录与SHA256，拒绝目录/重复/错季/越界/junction，不纳入同目录无关文件。45项Provider/协议/外部流水线及P2/架构/语义通过；受控网络与真实临时字节，未验证真实Provider下载。Coordinator、多值交接/结算及发布Gate继续，未部署NAS。[Evidence](implementation/evidence/SERIES_PROVIDER_LANDING_20261008.md)。

2026-10-08 Series获取空间：修复总包误判逐集超限和缺大小被转为0；按本轮用户确认将仅逐集分配unknown、其余合格且总大小已知的多集候选准入写入SSOT，正式Select与P5提交前复验已消费。33项回归及强化Select专项、P2/架构/语义通过。实际逐集终检不变，Coordinator/多值交接与结算继续，未部署NAS。[Evidence](implementation/evidence/SERIES_ACQUISITION_SPACE_20261008.md)。

2026-10-08多成品Offload合同：SSOT/Package/Promotion支持互斥单目标及2..1024多目标，后者仅原Primary替换；Promotion校验所有目标为具备Claims的同Package Workspace Primary。15项专项、生成合同/P2/架构/语义通过。持久化、Reader/Assembler及Arca多目标验证/一次结算待接通，未启用多目标交付或部署NAS。[Evidence](implementation/evidence/SERIES_OFFLOAD_TARGET_CONTRACT_20261008.md)。

2026-10-08多目标Offload存储：互斥单目标与固定schemaRef/128 KiB完整JSON列表、Promotion事务写入和Reader重建已接通。14项专项、35.8秒普通混合上架Host、6项既有回归及P2/架构/语义通过。新库启动摘要已对齐；旧Offload表升级尚未验证并明确拒绝，必须完成历史保护升级后才可发布。Assembler/Arca/Coordinator继续，未部署NAS。[Evidence](implementation/evidence/SERIES_OFFLOAD_TARGET_STORAGE_20261008.md)。
