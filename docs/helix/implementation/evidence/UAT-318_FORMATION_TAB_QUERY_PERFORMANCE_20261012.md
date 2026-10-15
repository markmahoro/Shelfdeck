# UAT-318：Series上线后媒体整理Tab切换延迟

## 2026-10-15 独立热点复核，未确认唯一卡点

用户追问是否只有Perception这一处。继续复核同一份037生产、修复前约13037.751ms CPU profile：仅取`invoke/all/Statement/get/exec`叶子样本，每个样本按祖先调用栈归入一组，避免把Aftercare与其内部Perception的inclusive时间重复相加。这是采样归因，不是逐SQL计时或页面延迟分解，也不是候选修复后的剩余耗时。

独立路径包括：Libra `metadataResultItems → nextMetadataStage → reconcile`约1046ms；Foundation `work-supply-controller.evaluate`约2161ms；Resource Governor的`persistReleaseDefers`约515ms、`wakeDeferredForReleasedCapacity`约477ms、`persistSoftWait`约293ms；Arca `healthProjectionInputs`的`selectMany`约316ms。原始profile及两份归因JSON留在ignored事故目录。Perception约1083ms的同类叶子归因只覆盖其SQL/Repository部分，不等于原约3.02秒inclusive成本；其余GC、摘要计算及运行开销也没有被这些SQL分组覆盖。

源码核对：Libra每次决定Metadata下一阶段时，列出该Run全部Metadata Observation Work并逐个读取完整执行结果；Series逐集来源数量增加会放大读取。Foundation的`work_attempt`供给门禁仍完整读取Work、Attempt及Event历史，然后在JS中筛选活动状态；已有`event_dispatch`短路径不能消除这一分支的开销。以上是继续定位的独立热点，尚未完成各SQL/调用频率对照及修复资格，不能把采样占比直接当作可节省比例，也不据此改变Foundation调度或Owner优先级边界。

浏览器同源海报导致管理请求发送前排队已有历史网络证据；本次尚未重现完整首次打开旅程。升级后整库启动检查和恢复协调也须与服务就绪后的热请求分别计时。UAT-318继续开放；Perception局部修复、席位/公平功能通过或一次请求变快，均不替代首开及后台负载下的实际页面验收。

## 2026-10-15 Perception候选热路径局部修复

用户追加要求实际排查首开慢。既有约13秒生产profile中Aftercare Context约3.40秒、其内部Perception候选解析约3.02秒；这些是嵌套inclusive值，不能相加。后续生产LAN独立顺序读取health1737ms、Formation active349ms、Care1116ms、Collection48项2455ms，说明服务端仍有波动，不只是浏览器海报排队。

源码定位：Aftercare严格读取当前评分时，`readCurrentRating`为检查Record Set新鲜度重新组装候选。`readResolutionCandidates`对全体title_year锚点调用`deriveTitleEvidence`/`deriveTitleYearEvidence`，筛选只使用anchorValue，却为未入选记录生成完整Evidence摘要；强身份exact查询也先读取整类锚点再JS筛选。同步工作与HTTP共用主线程，是已证实的重复计算热点，不把它宣称为所有首开长尾的唯一原因。

修复只在Perception Owner Store内：筛选阶段用同一`splitTitleYear/titleAssociationAliases/titleAliases`算法比较纯别名值，最终入选Record仍由原Assembler生成完整digest-bound Evidence；exact强锚点及单目标评分查找复用已存在的有界select-in，撤销/更正保持方向；无候选时不读取无关Relation。未增加业务缓存、未改变Resolution新鲜度/Record完整性/候选overflow、未改schema/API/Foundation或UI。

Windows独立冻结`85f0b79fc11f09612e422105412d9e105fc865ec`源码基线＋候选Store及测试，57项通过；共享工作树重跑曾因并行新功能的210表manifest尚未纳入Kernel支持范围而报`P3_SQLITE_INVALID_SCHEMA_MANIFEST`，该失败保留，未绕过Kernel断言，最终混合版本由功能任务另行闭合。Linux实际037592bef4镜像RO绑定相同候选Store及测试目录，57项通过。新增多语言/全角、provider-delimited别名、technical suffix、title_year精确年份、入选Evidence digest保持、精确查找不物化无关201条锚点及两个overflow保护；原JAV纠正/评分/已看/撤销更正继续通过。Linux初次未挂完整测试目录导致缺测试文件，补正确只读测试绑定后通过，未改产品镜像伪装成最终镜像资格。

完整输出对照使用此前已保存的生产200表资格快照（3172913152 bytes），DB SHA256 `da8800c643e5a7774544c78a5bebdc3af7716612e263952851a1ca6649c6f8aa`。本机Docker原生磁盘副本hash一致；037 Linux Runtime按旧200表manifest完成正常只读Kernel检查，使用公开Arca目标Projection取12个真实收藏目标，逐个比较完整Resolution Context及scalar Rating。old/new/new/old各24次读取为730/420/424/649ms，SQL调用212→198，返回行173032→135640；全输出摘要始终`90f75e5477164478898edb89f63cb016042f427b02bc091385f5940a167b3de8`。平均耗时下降38.8%、返回行数下降21.6%；计时不含整库启动校验，不是当前204表生产首开SLO或浏览器验收。

Arca目标Projection来自与200表快照配套的冻结发布源码，Perception Store分别为037现有实现与本候选；不把该局部对照称为完整当前Host演练。直接Windows共享挂载的首轮整库校验未完成，已停止该task-owned只读容器，不计通过；随后原生副本完成对照。对照后DB SHA仍与原快照相同，原快照保留，临时容器/3GB原生副本卷清理结果保留ignored记录。未在NAS创建额外Linux测试容器，生产没有热替换源码或重启。

本修复提交`190e9a9f7`，待与席位/公平功能整合成最终候选，按既有授权统一升级后复测实际页面及后台负载。完整Service/最终镜像与生产首次打开资格未由这组57项替代；UAT-318保持开放。

## 2026-10-15 JAV升级后首开慢追加现场

用户反馈037592bef4升级后第一次打开控制台极慢，随后好转，要求先保留记录。LAN只读复测`/v1/health`200但耗时7738ms、`/admin/`200耗时4797ms；主Node累计CPU约106%、容器即时CPU201%且同时存在FFmpeg，不能由HTTP200或供给正常推定页面性能合格。后续认证6917ms、Runtime读取1109ms、Formation active读取2481ms，说明仍有波动；不是首次打开全过程的浏览器复现。

北京时间22:06前后采集约13.04秒生产主Node CPU profile，仅临时启用容器loopback Inspector且结束后独立确认closed。热点包含同步Owner Repository/SQLite读取，Aftercare Context约3.40秒、Perception候选解析约3.02秒、GC约1.56秒；inclusive时间有嵌套，不相加，也不是逐SQL精确计时。它支持后台同步计算/数据库工作会争用服务主线程的判断，但不是首次打开慢的唯一因果证明，也不能直接认定Foundation需要改调度。原始profile保留于ignored事故目录，不提交生产数据。

本轮不以短采样宣布优化或SLO通过，不增加后台缓存/降级/Reset；首开性能与既有UAT-318继续开放，待独立复现及有界Owner内优化。此次合并升级不得将新席位功能验收当作性能问题已经解决。

2026-10-12用户追加现场反馈。生产9478a4fc7计数已通过，但性能独立开放。原API、浏览器样本及I/O边界见[315–317 Evidence](UAT-315_317_PRODUCTION_DIAGNOSIS_20261012.md)和[UAT-315生产走查](UAT-315_FORMATION_COUNT_UI_ACCEPTANCE_20261012.md)。

## 根因及修正范围

Tab切换按现有分页合并读取Formation/Aftercare；后端读取当前Plan时，顺带装配完整Event Results，Series逐集资料使单请求读取量增长。summary又读取当前活动事实，因此completed/ended也重复读取活动Run相关结果。Perception的批量评分方法还全扫约1941个head/1961个Resolution，先读完整历史再在JS中过滤目标。此处量化了多余读取，不声称解释全部NAS I/O或HTTP长尾。

现有Owner内修正：Foundation progress reader新增有界resultCapabilityRefs查询范围，只为调用者所需能力读取完整Result，其他Event保留outcome/schema/digest/committedAt头部；默认详情读取保持完整及原JCS/digest校验。Libra列表显式声明分类、分支与当前动作所需结果，完整过程仍按原入口读取。Perception按请求的target/query digest/head分批读取当前记录和Resolution，保留retraction、最新head、Winner及全部既有Evidence校验。没有新Owner、缓存权威、兼容修复、业务终态规则或HTTP写副作用；API与页面字段不变。

## 验证

Windows四组初次77通过；新增有界读取/一致性测试后相关76通过，Linux同源四组79通过/0失败/0skip。测试覆盖600缺失target跨500边界、retraction仍可见、当前Resolution/Winner不变、评分查询拒绝全表历史扫描、Result头部与时间保留、列表/详情当前动作一致，以及所需Result篡改仍拒绝。尚未构建或发布本项最终镜像；不是生产性能验收关闭。

NAS disposable容器CPU1/memory1GiB，以已验证生产备份作只读业务输入，对旧版/候选按before-after-after-before交错运行active/completed/ended。所有12次完整返回JSON一致（含计数、当前动作、分页及Series交付范围）；不挂生产媒体，不修改原运行DB。启动使用完整Kernel校验，因此备份验证期间会占NAS I/O；容器--rm已退出。

| section | 旧版处理ms | 候选处理ms | 旧版结构化Result bytes | 候选bytes |
| --- | --- | --- | --- | --- |
| active | 1096–1717 | 703–787 | 8938153 | 1200767 |
| completed | 1312–1981 | 803–898 | 15067635 | 1906516 |
| ended | 625–704 | 316–375 | 8779871 | 1200767 |

每次读取的字节数下降约86–87%。completed的评分历史读取从3922行变33行（含summary当前活动目标），active/ended从1961变8；结构化读取保持目标数据等价。这是同快照查询层测量，未含真实Clean Host后台执行、HTTP及浏览器渲染，不能把它称作整页Tab性能通过。

本地Node25读取同快照遇历史Perception Record digest fence；同一代码/数据在生产Node20只读剖析及隔离对照通过。本项没有修改或放宽Record完整性规则，也没有处置历史记录。

## 剩余验收

最终版本需精确UI负责人接受、标准镜像及部署资格、生产真实Tab/刷新/后台更新和HTTP长尾复验。五项失败媒体保持用户“暂不重处理”决定；性能改善不得用停止业务、Reset、丢弃过程或改变事实口径实现。

## 2026-10-13生产复验及加载空态补充

2026-10-13生产已标准发布 `markmahoro/shelfdeck:9a23b01c7`，git `9a23b01c7ff8c5d16272898e2efe3296e500cd0c`，Image ID `sha256:23ec509e81511ee9fc84f50ad61f87c633a4ab8ac6d9cc2e4d508fc24f994a7b`，tar SHA256 `e7d95627ebc588c0161e6e109452f5edc5c479744c307558ea69f868695055ff`。标准checksum/readiness/health/Admin/五挂载/QSV通过，RestartCount0；最终镜像专项79/79，发布前备份509 Entry/509 Commit，本地integrity ok/FK0及SHA匹配。未重跑整季加工上架E2E或desktop全量，五项失败媒体未重处理。真实四请求并发样本旧版三轮4891/2530/4762ms，新版3626/1683/1750ms，仍有长尾，UAT-318不关闭；这不是完整SLO资格验收。用户追加整理中加载时误报空态，纯前端补丁专项14项及Web构建通过，尚未发布；服务优化生产UI审核仍进行中。

加载空态根因：切换筛选使用新filter过滤旧pageRows，且onPartial可能先收到空stream，rows.length===0直接呈现真实空态，没有检查pageLoading。纯前端修正：筛选事件即刻进入加载态，空行在全部分页stream完成前显示短加载状态；读取失败保留错误和刷新入口，不再宣称无条目。不改变API、分页或业务分类。延迟测试覆盖空stream先返回、全部完成后真实空结果、回到整理中迟到的真实条目，以及请求失败。Web专项14通过、TypeScript/Vite构建通过；尚未做该补丁实际浏览器走查或生产发布，不把测试通过称为已解决生产闪现。按用户新流程，此纯UI补丁可由实施任务核验，跨层查询优化仍须UI负责人审核。

## 第二轮根因及候选（2026-10-13）

生产10.76秒CPU采样中，概览Formation调用累计约2.85秒，收藏健康汇总约2.19秒；这是含子调用的样本时间，不能相加当作总CPU或解释每个43秒请求。临时Inspector仅容器loopback启用，采样后已关闭并复核连接拒绝，无业务写操作。整理列表为读取架名称经listShelves装配注销摘要，每架遍历当前Inventory Materials；概览一次同步调用四遍Formation，增加主线程等待。候选在现有Arca public facade新增listShelfNames，仅返回同一Shelf持久事实的ID/name；Formation只使用这份姓名投影，不读取注销摘要，完整Shelf Admin入口保持不变。概览四次查询之间setImmediate让出线程，不改变五秒cadence或概览原子发布。没有移转Owner、弱化校验或新增缓存事实。

Windows相关Shelf/Formation27通过，Overview及4000条分页汇总8通过；纯前端补丁实际Chromium桌面延迟走查通过（首轮因fixture误用care-work URL失败，改为实际/v1/admin/care后通过）。覆盖等待→真空态→等待→条目，截图保存在ignored Playwright输出，临时Host由runner关闭。当前候选仍待精确镜像、跨层UI审核及生产复验。

## 第二轮发布准备（6feda0d26）

产品git `6feda0d26a3d3ff5994a17d23d83ac1bc3a756ce`，镜像`markmahoro/shelfdeck:6feda0d26`，Image ID `sha256:88ee3b310b9d07fab4c95914e3936152014a09e601163f9bf38e67b0dc0d9af7`，tar 1724121600 bytes、SHA256 `f7fb047d9ebecefa14a5db8b2b7e0e285900d7c46efb59337bd0ab0e5439f11d`。固定build/upload入口通过，上传SHA一致，fnOS只读preflight及部署dry run完成。最终镜像35/35（相关Shelf/Formation/Overview，测试文件注入临时容器，产品源自完整镜像），未重跑整季加工E2E/desktop全量。Chromium加载截图已目检，结果移至ignored `.codex/series-release-20261012/uat318-second-browser`，不是仓库生成物。

发布前备份 `/vol1/1000/docker/shelfdeck/backups/uat318-6feda0d26-predeploy`：DB2735779840 bytes，SHA256 `13b7bde97fbe41c91327011e0cb9fee25437647add3d570f3c4754daa6466278`，512 Entry/512 Commit/36575 Inventory Materials/647 Run，45份companion稳定复制；Compose/Secret保留原权限，目录700/Secret600。本地下载integrity ok/FK0/完整SHA匹配，verification-local.json已回存备份600。业务继续运行，因此不是部署后DB逐字节保护快照或恢复生产数据的授权；常规回退保留9a23镜像及备份，不直接倒灌业务DB。

前一版9a23在本次备份结束后的四请求并发三轮为6569/2022/1376ms，首轮真实业务从attention转ended期间summary头发生变化，不能判为再次计数横跳；此处保留全部样本，未编造固定DB或SLO资格。第二轮当前尚未apply，跨层具体版本UI审核仍待完成。

## 第二轮生产复验与第三轮热点

2026-10-13第二轮已标准发布 `markmahoro/shelfdeck:6feda0d26`，git `6feda0d26a3d3ff5994a17d23d83ac1bc3a756ce`，Image ID `sha256:88ee3b310b9d07fab4c95914e3936152014a09e601163f9bf38e67b0dc0d9af7`，tar SHA256 `f7fb047d9ebecefa14a5db8b2b7e0e285900d7c46efb59337bd0ab0e5439f11d`。备份integrity ok/FK0/SHA、readiness/health/供给/Admin/五挂载/QSV通过，RestartCount0；最终镜像35通过，跨层UI具体版本66项及实际页面接受。生产Chromium两轮四Tab：有条目Tab误报空态0次；正常空结果保持，未执行媒体写操作。但HTTP仍有15.9秒长尾，UAT-318不关闭；追加采样定位Series候选恢复中反复构造未签发策略Work，局部修正139专项通过、未发布。未执行整季加工E2E/desktop全量，五项失败媒体仍未重处理。

两轮实际桌面Tab/DOM MutationObserver没有出现“有条目Tab”的空态闪现；正常需要处理0项仍显示空结果。样本包含700ms稳定观察等待，不作为精确首绘时间。实际认证后请求范围约0.312–15.856秒，保留全部长尾；初始未登录401属于正常session交换前请求，不作为服务故障。独立三轮四请求并发3269/1382/2004ms，不是P95/完整资格。第二轮切换65.0秒，冷启动比之前更长；追加10.36秒startup采样发现9.54秒落在Libra Run reconcile，readSeriesProductionCandidates及整季依据/策略Work重复构造占主要部分，不能再把全部启动耗时称作数据库校验。临时Inspector仅容器loopback，采样结束服务就绪后已关闭并复核。

第三轮局部修正：用同一Libra Work工厂的确定性stage前缀预筛当前Run已成功Work包含的策略ordinal，只为这些ordinal构造成员的完整Work；仍按原升序、精确Work ID及原Result/Verification/Selection完整性栅栏消费，未签发Work不能产生候选。无新路径算法、状态兼容、跨域事实、全局缓存或资源管理。139项原Series Source/External Scope/Replacement/Episode Space通过，新增缺省不构造任何transcode策略、failed策略跳过、完成ordinal64仍严格读取并拒绝缺失Result的真实fixture测试；其生产表现尚待最终验证，不能称长尾已修复。

第三轮最终补充：同一readDirectMediaSelections调用内整季space basis及requirement只构建一次，成员Input仍经过原buildProductMediaCandidateInput及完整Verification/Allocation/Selection栅栏。共享仅在该次调用内，未跨调用缓存。新增真实Direct fixture计数与独立公开Input digest等价测试，四组140通过。计数测试首轮VM跨realm对象触发既有P3_JCS_NON_JSON_VALUE，改为同realm独立Module测试载入后通过，没有修改JCS或业务校验。5314f66d0中间镜像未部署，最终包将包含此补充，前端/HTTP Projection没有diff，继续沿用6feda已验界面；不将其称为新的UI负责人具体版本验收。生产仍6feda，长尾开放。

## 第三轮生产与第四轮候选

第三轮标准发布d7a6c71dd48c50f2dc94001b7549b124801a95df，Image sha256:69ed9b33083aa688bcf9e2f9ecf8e9426ec2731bcaefdc47ffc95ef65bb2a800，tar1724122624 bytes/SHA256 90a3cf76ab8e0d9db4d54c354ea2464b3b54e15b4bdd1ba0961317a069a3348c。最终镜像140通过；首次139通过/1测试包漏带schema构建脚本失败，补入仅测试依赖后原产品镜像140通过。前端资产SHA与已验6feda完全相同，后端无Projection/UI字段或文案修改；没有以本次代码复验冒充新的UI负责人接受。备份uat318-5314f66d0-predeploy DB2755584000 bytes/SHA4b508acda0dab1cc4505855da72b28970a241f55a5444cc95073dca8bd52cf1b，本地integrity ok/FK0/摘要一致，513 Entry/513 Commit/36705 Inventory Materials/650 Run，verification-local.json已回存600。

健康/供给/Admin/五挂载/QSV/代码来自镜像通过，RestartCount0。容器启动17:46:55.788 UTC，服务监听17:52:25.327，冷启动329.54秒；前轮733.04秒，负载和现场在变化，不把比值当作严格因果benchmark。生产两轮四Tab误报空态0，整理中请求446/560ms，本次正常认证后请求最长2054ms，完整Tab计时含700ms稳定观察。12轮按10秒间隔共48请求均200，仍有6554ms样本，不是SLO资格；不能关闭318。

第四轮追加10.32秒CPU采样中Libra reconcile约6.12秒，external-material Work定义/Scope重建约3.49秒，主要在readSeriesProductionCandidates对每个Scope构造外部Import定义，即使当前Run没有成功Import。Inspector已在采样helper中关闭。新增同一Owner工厂的确定性external stage前缀；仍先执行完整replacementScopes校验，只在存在成功Import时派生完整Scope Work并走原Result栅栏。候选输出及选择顺序不变，无全局缓存或新路径策略。141项通过；新测试证明无Import仍校验Scope、不构造Import，已成功Import但缺Result仍拒绝。仅后端内部计算，前端/Projection未改；待最终镜像及标准发布，不称性能已解决。

## 第四轮生产与第五轮纯计算修正

2026-10-13第四轮已标准发布24821200d34fe055036c0d11ac5b1dc9afbf6cbd，Docker markmahoro/shelfdeck:24821200d，Image sha256:7f77396fd54c7587969faf588f4a8da718f6585f735319ece6a7e55410028f9a，tar1724123136 bytes/SHA256251935ecf66e3ab26ebb3164d53fa21dd55b31b09d9963ff7189804a57be689b。readiness/health/供给/Admin/五挂载/QSV通过，RestartCount0，最终镜像141通过。前端资产与6feda已验版本一致，纯后端无UI字段或文字变更；实际两轮四Tab空态误报0。十二轮48请求均200，十一轮最长约1.2–2.1秒，另一次6172ms；性能UAT-318仍开放，未重处理五项媒体。追加Perception纯字符串计算缓存28项通过、尚未发布；没有缓存评分、业务事实、候选集合或决策。

本轮备份uat318-24821200d-predeploy DB2798891008 bytes，SHA d5ceec74018f1a4a96a5354afa5aef8d23efaeb85e54928b30e291bd369da50f，513 Entry/513 Commit/36712 Inventory Materials/650 Run，45 companion稳定复制；本地integrity ok/FK0/SHA匹配、verification-local.json回存600。切换76秒，容器18:13:36.216 UTC启动、18:19:28.733监听，冷启动352.52秒；不能据时长单独推断停机是否强杀。保留AbortSignal 11监听器警告，不把警告直接认定为泄漏。

生产浏览器有条目Tab误报空态0、正常需要处理0仍为空；整理中实际852/628ms，其他已认证请求最长2624ms，Tab完整采样含700ms观察等待。12轮48请求按页面10秒cadence全部200，6172ms样本保留。追加10.54秒CPU采样中主要热点切换为Perception候选组装/读评分上下文，约3.84秒在readResolutionCandidates；字符串归一化反复处理相同Corpus是其中一项成本，不声称解释全部SQL/I/O等待。临时Inspector按helper关闭。

第五轮只缓存确定性normalizeAlias和normalizeAnchor的字符串输入/归一化profile输出，单Map8192项上限、超过512字符不缓存；算法仍用原NFKC、大小写/und Locale及原Regex。没有缓存Record、Rule、候选成员、Resolution、评分事实或业务决策：每次读取仍读取当前记录、关系、规则、完整digest及候选溢出栅栏。输入改变使用不同键；类型错误和未知profile保持。新增真实Unicode İ/Greek终结sigma/全角/连字、多profile、可变对象String转换、伪装toJSON输入拒绝与8300项驱逐测试；Windows相关28通过。纯后端，无UI字段改变；最终镜像/发布/性能复验仍待，不关闭318。

## 第五轮最终发布及验收边界

2026-10-13最新生产为markmahoro/shelfdeck:505844a8b，git505844a8bade56e7705ee47e0d578874f9117efa，Image sha256:73484068340fec14df3e66d52d2689a6c586c5dbab21d91807faf58af20de6c4，tar1724124160 bytes/SHA25638362057d5b1f516861800485d3d947931e44fe3b8f3f8214dec61bce920932d。标准build/upload/checksum/dry run/readiness/health/供给/Admin/五挂载/QSV通过，RestartCount0，最终镜像Perception专项28通过。加载空态补丁生产多轮复验0次误报；本轮纯后端无UI字段变化，前端保持已验资产。十二轮48请求全部200，十一轮最长约0.99–1.91秒，一轮5896ms；未复现原数十秒，但性能UAT-318保持开放，非完整SLO窗口。五项失败媒体未人工重处理，狂暴女神/sample及正式安全停机/Reset仍暂缓；问题未全部验收，不执行全面生产清理。Avail约25GiB。

最终包包含505844a8b的profile类型拒绝补充：只允许真实string/string参与缓存键，伪装toJSON的profile仍报原未知profile错误。6d877b6d6中间包未部署；最终Windows及Linux精确镜像相关28/28，Unicode/驱逐/Rule未知profile/对象类型和既有候选/Record/digest/Resolution语义通过。未执行完整Service、Desktop或Series整季加工E2E。既有跨层UI审核及纯UI实施核验见对应Evidence，未把本次后端纯计算优化称作新增UI负责人接受。

备份/uat318-6d877b6d6-predeploy DB2813448192 bytes/SHA256 cf3e5ae50fa79ca548c9d65724d2bf93d39c62572a333b82450e020aff1f218e，514 Entry/514 Commit/36868 Inventory Materials/650 Run，45 companion稳定复制，Compose/Secret按原权限保留；本地integrity ok/FK0/SHA匹配，verification-local.json已回存600。常规回退只更换代码镜像，不恢复旧业务DB。

切换61.3秒，新容器18:42:00.986 UTC启动，18:47:16.345监听，冷启动315.36秒；仍有较大启动开销，没有声称完整解决停机/恢复设计问题。启动日志出现Duplicate Group Evidence page is stale，定位在Arca duplicateCommit输入依据与当前Projection digest不一致，抛错发生在写Group前；仅记录观察，未压制栅栏或改变数据，尚未证明属于新缺陷还是恢复旧Evidence遇到真实事实变更。

生产Chrome两轮四Tab有条目空态误报0、正常需要处理0项仍呈现真空；整理中请求1420/523ms，其他已认证请求最长1883ms；Tab结果时间含700ms稳定等待，不作为首绘或P95。随后按10秒cadence十二轮48请求全部200，本轮5896ms值保留，其他轮最长987–1912ms，业务负载变化中不能简单归因全部改善。实际截图已目检；临时浏览器与测试容器/转发均已关闭。原42.9秒、第二轮15.9秒及后续6秒样本保留，不将“这次没出现”当作所有工况不再出现。正式30分钟活跃/10分钟静默与固定资源profiles未执行，318性能不关闭。下一步关注Perception候选Universe查询/Owner上下文读取及SQL等待，任何优化仍保留Owner/实时候选与完整性边界。

## 2026-10-13当前追加候选及验证边界

用户确认管理页面响应优先于后台吞吐，不要求新增调度器；具体目标为“整理中”及“我的收藏”，已登录生产LAN后台正常运行时点击至实际内容可见小于1秒，不以动画、旧内容或P95替代。SSOT §10.6已补充。用户追加克制动画，不新增动画开关；既有系统reduced-motion CSS保留。

505生产8轮GET对照首轮Formation/Care/health为26771/34823/35455ms，后续仍有14987/12250/9482/8361ms，全部200。23秒CPU样本overviewStats→Aftercare批量健康约14.76秒，SQL all约17.91秒，其中12.26秒在Aftercare selectMany；包含子调用时间不可相加，不是逐SQL精确计时。Inspector首次连接失败，重试采样成功、复核closed。

生产只读统计15517条Product Facts约136647644字符，当前active Inventory事实1641条约13534593字符；SQLite length(TEXT)计字符，不冒充UTF-8字节。Aftercare旧查询先读所有历史正文再过滤当前revision。补丁在Arca内复用select-in/fixedKeyColumns按当前revision分组、500 ID一批读取，保持当前完整事实、metadata/Basis/Case校验，不缓存健康、不删除历史；不同revision组数会影响SQL条数，未宣称全局SQL数量资格通过。

本地只读同一已核验生产备份514 active Entry完整输出digest四次均c42d75a2dcfea4bbca1587e40081dabbe27af0408ff87a2c7071ab83a3ce3ada；old/new/new/old耗时428/212/227/414ms。Windows Node25局部对照不等于生产浏览器、Linux Node20或1秒验收。相关68通过、1进程恢复未启用。新增fixture覆盖501同revision跨批、混合revision、inactive排除和当前事实缺失不借旧事实兜底；首轮fixture非法retired改合法offdecked，未放宽产品约束。

UI首次读取用轻微明暗骨架，刷新已有内容保留并显示读取标记，aria-busy跟随读取，装饰aria-hidden，无假进度/ETA。Collection初始loading=true。Web相关21通过、build通过；实际Playwright桌面1440/窄屏390共4通过，延迟加载/空结果/迟到条目/保留内容/键盘通过。两份桌面截图已目检，ignored截图uat318-current-loading-browser；runner测试Host关闭。本次实际跨层diff仍须精确UI负责人审核。

NAS只读隔离对照容器nice_taussig在openSqliteKernel整库检查阶段长时间未返回，无最终证据；随后SSH多次握手超时。已尝试docker stop -t 3，但未得到成功确认；本地该客户端PID1908已结束，远端容器是否随断连退出待复核，不能宣称已清理。转本地副本验证，不再增加NAS重型测试；没有停止生产ShelfDeck/其他业务，没有处置媒体。当前未发布，生产仍505844a8b，1秒目标及UAT-318开放，五项媒体不重处理。

## 2026-10-13 NAS重启恢复与本机验证

用户重启NAS后SSH恢复，nice_taussig在docker ps -a精确过滤中不存在，隔离对照未获得结果且不再重启。505生产容器初始Exited255、OOMKilled=false，原restart policy unless-stopped；通过docker start仅启动同一已有容器，StartedAt 2026-10-13T02:22:21.27553841Z。02:29:04 UTC前后public health200/status ok/normalSupplyAllowed=true；冷启动约6分多钟，不以container running冒充就绪。磁盘Avail25GiB，刚重启可用内存约5.8GiB/Swap0；生产恢复后台后容器约5.2GiB，进一步拆分主Node RSS约378672KiB、一个FFmpeg RSS约3580724KiB，不把容器总量认定为Node泄漏。旧内核日志因权限未读取，不能证明NAS重启前OOM或断言唯一事故原因；测试共享物理资源是已知风险，后续对照放本地。任务创建的IAB诊断login标签已关闭，没有登录或修改fnOS设置，没有停止媒体加工。

本机Docker Desktop已启动，标准build-image.js ed8e96b84完成，tar562216448 bytes/SHA25608a37a276abfd5d6df393a4da69eb8fa701c4755c87b495454bb95f695f328c2。Linux精确镜像在本机执行相关69项，68通过、1未启用进程恢复skip；测试容器--rm且已确认不在运行。本机build未使用NAS Docker forwarding。

UI负责人指出初次未知数量0及初次失败真空态边界；后续6ce4aedb8f065e9edf81570e19fa41f5ee89c569仅修该UI：hasResult区分未知与成功，未知数量—、不显示分页；首次失败仅错误/刷新，成功0项保留真空态。Web22、build、实际桌面/窄屏6项通过，新增失败→刷新→真空结果与无假0数量。负责人已收到新精确SHA继续审核；旧ed8不是最终候选验收。最新产品未发布，生产仍505；不重处理五项媒体，1秒目标保持开放。

## 2026-10-13 用户授权生产重启与挂载启动阻塞

用户因NAS重启时SMB未正确挂载，明确要求先重启ShelfDeck及MoviePilot。重启前宿主两处挂载均为cifs；MoviePilot重启后/media为SMB且HTTP200。ShelfDeck旧容器/media及/adult_media仍为本地ext文件系统，重启后两者均恢复SMB，但启动失败HELIX_MOUNT_SCOPE_UNSAFE，不能宣称服务已恢复。只读核对当前Field/Shelf四个reference：filesystem type、endpoint、mount boundary、inode能力均相同，仅stable_mount_fingerprint及probe_evidence_digest变化。对同一mountRoot/sourceIdentity/filesystemType重算证据，旧deviceIdentity=0:93精确命中已存fingerprint，当前Linux设备号为0:81。现有probe将重启不稳定设备号当成稳定证据，问题尚未修复；没有改写Registry、绕过校验或Reset。版本仍505844a8b，aef候选未部署。任务自建本机shelfdeck-uat318-aef-host已停止并删除，中断演练不计通过，未重处理五项媒体。

## 2026-10-13原版恢复后本机完整查询对照

用户明确先恢复原生产版本、修复在本机验证，再升级及单独生产前端验收。原版505已通过明确的Platform证据纠正恢复，详情319；没有混合为新性能包发布。NAS full Host副本演练已停止，不计通过。最新完整518 Entry/655 Run快照本地SHA/integrity/FK与45 companion通过；本机Docker native copy上以精确b471镜像Node20/en-US执行真实Collection Query、Aftercare Context/Health、Perception rating及Libra Product Delivery读取，冻结相同now与完整输出digest。

old/new/new/old：最近48项浏览102/52/51/73ms，健康attention筛选760/403/393/708ms，overview627/303/306/584ms；12次完整输出全部一致。事实正文最近10851129→2347086 bytes，健康筛选153469343→27639508，overview139780924→13951089 bytes。局部SQL统计127→136、1037→1056、1071→1165，不能宣称全局SQL资格已满足；剩余逐Record读取在Perception的findCurrentTargetRatings/readCurrentResolvedRatings。后续仍在其Owner Store内按500批读取完整Record及Anchors，继续使用原digest校验、supersedes/retracts与最新排序，不新增评分缓存或跨Owner决策。新501真实Record测试与原相关测试Windows34通过，未构建最终新镜像。

Windows Node25默认zh-CN的首次完整读取报P6_PERCEPTION_RECORD_DIGEST_MISMATCH；相同数据库及ICU78.2在Node20/en-US通过。保留该环境差异失败，不忽略digest或修改历史记录，不能把Windows查询对照算通过。后续前端及最终Linux数据路径继续验证。完整本地Host发布演练仍缺同一群晖共享的Linux登录配置，已向用户询问本机凭据文件路径；既有WindowsDomain凭据不能供Linux只读挂载使用，不请求在聊天发送密码。

用户随后提供Z:\映射。最终精确2f9560bcb镜像以network none、256MiB、1CPU、只读Z:/→/media探针确认Film可读；/proc/self/mountinfo显示ext4 /dev/sde及/mnt/host/uC/192.168.12.45/Media根，设备号2112。Windows映射经Docker Desktop转换，不能等同于生产CIFS Mount Scope，不改写历史Scope、不绕过探针。已继续请求仅本机凭据文件路径；该探针不是完整Host资格。

最终2f9560bcb与已验收aef74a3ef精确镜像的前端资产一致：index-DWXi77Md.js SHA256 da9ade83362f7b2b5ee55d8ea89e28e6db2fea29891ee5aaa0875150eb318f85；index-D6t0BdHs.css SHA256 2741749991f5156a27ba41745eb756ed8dd5d91c50e9dfe29fab75711d5a0ba8。无新增前端差异，不重复执行已有相同资产的交互测试。生产只读复核health200/status ok/normalSupplyAllowed=true；未升级候选，未新增生产前端性能通过结论。

2026-10-13用户明确建议“直接上生产”，在完整本地生产副本Host/回退验证尚未完成的已知背景下，指示执行本次直接生产升级。此次为用户指令覆盖该项演练要求，不修改一般发布规范，不补记演练通过；保留57项最终Linux测试、完整查询等价、前端相同资产验收等已有证据，继续标准build/upload/checksum/dry run/apply及真实生产验证，不重处理五项媒体。

直接升级备份：/vol1/1000/docker/shelfdeck/backups/uat318-2f9560bcb-direct-predeploy，冻结后完整复制数据库/WAL及45项伴随文件、Compose和Secret。旧505服务在docker stop -t 60后ExitCode137、OOMKilled=false，留下4177712-byte WAL；备份副本执行checkpoint后integrity ok/FK0，2026-10-13T04:58:31.925Z数据库2887331840 bytes/SHA256 56111c33f0dd7e8aae0d833acbdb2bea919cb55d6e813ebc9d2d7178c8800bf7，518 Entry/518 Commit/38218 Material/655 Run。原始冻结DB及WAL先一起保留，未修改业务历史或Reset；安全停机缺口保持待优化。

2f9560bcb tar上传及NAS校验一致；Media CIFS Scope revision1纠正预检通过，当前runtime-v1设备0:81对应摘要8a5a37…/1b8205…，目标stable-cifs-v2摘要727ee62…/10d2060…，receiptDigest da36f67cff8ba2c5542c6db293def2742af30d61dd5cdff1691ced42046ec4b0。仅两摘要改变，ID/revision/endpoint/boundary/inode/effectiveAt保持；正式apply及新Host启动状态另续记。

正式纠正apply返回相同receiptDigest/applied=true。第一次标准deploy apply在readiness副本捕获报SQLITE_CANTOPEN，尚未recreate正式容器；已定位关闭后的WAL-mode DB没有辅助文件，来源只读导致SQLite无法创建SHM。修复工作站部署入口注入的create-readiness-snapshot.js：无WAL/SHM时复制独立数据库、核验SHA256及size/mtime/ctime/辅助文件不变；有辅助文件时保留SQLite backup。捕获后仍执行原readiness检查，无跳过合同或修改源数据。Windows及Linux各3项通过（在线未提交隔离、关闭WAL源字节/辅助文件保护、复制期间写入拒绝）。Linux使用精确2f镜像加只读部署工具/测试绑定，属于部署工具验证，未将其记为新产品镜像；再次dry run及标准apply继续。

最终标准apply完成：readiness ready、health200/status ok/normalSupplyAllowed=true、Admin及五挂载/QSV通过。正式容器2026-10-13T05:08:58.52928435Z启动，NAS Image sha256:48e229fce27309ca1860d73f0cfebb93f9fb34d76ac3cc65ef5536531aa38462，RestartCount0/OOMKilled=false；启动校验约5分钟，独立于热页面SLO。MoviePilot200及其他既有服务正常；/media及/adult_media实际smb2。最终生产518 Entry/518 Commit/38218 Material/655 Run与冻结备份相同，未人工重处理五项媒体；Avail约20GiB，保留旧镜像/备份，不全面清理。

真实Chromium1440x900生产测量：第一轮脚本仅等待aria-busy，整理中提前读取加载行得到60–62ms，四项整理中样本作废并保留原记录；该轮收藏等待本次JSON响应完成及48个真实tile，994/746/1463/1779ms有效。修正整理中为等待本次formation+care响应完成、aria-busy=false及两帧绘制，四轮为411/842/844/345ms、均6条真实行且完成时无错误空态；收藏346/1464/780/246ms、均48条。追加两轮网络timing取证：整理中326/477ms，收藏680/347ms。六轮整理中0.326–0.844秒，十次有效收藏0.246–1.779秒，不构成持续SLO窗口通过。

网络取证发现从收藏返回工作区时，active请求1501ms中requestStart=1198ms，responseStart-requestStart约302ms；completed2027ms中发送前1501ms、TTFB523ms；ended/care发送前约1505ms。同时同源海报在途，说明浏览器发送前排队是剩余延迟的一部分，不能归因于所有时间都在SQL，也不能认定它是唯一原因。首轮海报另有1.6–11.6秒长尾；收藏标题/列表完成时间不等于所有海报完成时间。后续需处理海报并发与管理请求竞争，并复核服务TTFB/后台竞争，UAT-318保持开放。本次仅部署既有候选及修复部署工具，不增加资源管理体系。

回退保留原505 tar及完整备份配置。若需代码回退，先停止ShelfDeck，在同一Media Scope上通过显式工具--rollback-legacy-runtime转换到实际设备的runtime-v1证据，再使用标准deploy-nas.js发布原505已校验tar；不把旧DB恢复当成常规代码回退，不回滚媒体副作用。该回退步骤本次未实际演练，用户直接部署覆盖本次前置演练要求，不修改后续一般门禁。

追加Perception局部开发验证：两个批量评分入口使用每批500个Record及完整Anchors，复用scalar reader的typed校验与原recordDigestFor；按SQLite PK排序保留Anchor数组顺序。新501实际Record覆盖多Anchor、重复输入、缺失target、无关坏Record不旁读、选中坏Record仍拒绝；原撤销/更正关系与最新排序通过。Windows相关40项通过。单次调用内临时Map不是持久业务缓存。

本机task-owned b471容器替换该单文件后开发对照（非最终镜像资格）：完整old/new/new/old，最近浏览89/51/49/70ms、健康筛选749/392/394/700ms、overview597/291/301/592ms，全部12份完整输出digest保持前述值。SQL127→64、1037→154、1071→273，事实正文量保持前述减少；不把此计数解释为50/200规模SQL增长资格已经通过。尚待冻结最终产品SHA、精确镜像、完整Host及生产前端实测。

最终局部候选source2f9560bcb：标准build-image.js本机构建tar562221568 bytes，SHA256 ac797372cc19715a241f3b25217154127df0161175199890cc0485f6e76204f2；本机Linux精确镜像Perception/Aftercare/挂载相关57项通过。从任务自建local fixture进程的/tmp/shelfdeck.db只读复制至最终--rm容器独立/tmp，未访问或编辑Docker Overlay私有文件；候选代码来自最终镜像，旧Aftercare及Perception模块来自冻结505源，query driver为同一只读公开Owner查询组合。old/new/new/old：最近87/50/50/77ms、筛选726/398/411/655ms、overview560/292/294/604ms，12份完整结果digest保持一致，SQL及读取正文数同前。任务fixture容器已停止，不阻塞前台开发服务器。

发布仍未执行：完整Host缺同一群晖共享Linux登录配置，不能把只读查询结果或既有mock浏览器加载测试冒充完整Host/实际前端1秒验收。按用户要求后续所有修复演练留本机，不再用NAS副本测试替代。待补配置并完成本机完整Host/升级/回退，再标准上传/dry run/apply和真实生产点击到内容测量。原版生产已恢复，两个目标页面的原性能问题仍在，UAT-318不关闭。
