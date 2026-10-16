# UAT-318：Series上线后媒体整理Tab切换延迟

## 2026-10-16 合并候选与正常供给竞争取证

性能修复`190e9a9f7`/`7a378b20c`已与双车间/公平`1f36d9ed8`合并。候选source `dc7dcddbaf6714d56aaa453610f862914863578f`已标准build/upload及独立SHA校验；最终实际镜像Foundation切片68/68、Windows Service645 pass/29既有skip。2356份canonical运行源码逐文件SHA匹配，UI JS/CSS与负责人已接受版本相同。标签、Image ID、tar和资格缺口见双车间既有Evidence的发布承接，不改写为已部署。

Metadata独立只读诊断：从历史210副本另建task-owned可写隔离件、正常Kernel检查后，通过真实`WorkResultReader`读取117/85/79个来源Work的三组历史Run，完整结果摘要两轮一致，Windows耗时28/20/25及27/19/23ms。117来源产生586次Repository调用，包含完整Bindings/Plan/Attempt/Result及digest验证；本机热读取不能解释或推翻NAS采样中的长尾，不能据此削弱完整性检查或宣称Metadata已修复。首轮直接readonly Kernel因该历史结构副本为非WAL模式而拒绝journal_mode调整，错误保留；改用独立复制件正常打开，没有绕过Kernel或改原副本。临时3GB诊断件已清理，原结构副本保留。

UTC 2026-10-15 16:39（北京时间10-16 00:39），原037为新鲜备份准备进入quiescing、仅1个真实转码仍执行时，顺序三轮GET：health5/5/2ms，Formation473/404/412ms，Care202/128/143ms，Collection48项353/417/370ms，全部成功。停止新增供给后HTTP显著缩短是后台同步工作竞争的现场证据，但取样时间、缓存和后台负载不同，不是严格同负载A/B、完整首次打开或已修复SLO；原profile未被当作新版本数据。

用户本轮明确选择暂不进行NAS完整副本演练；未启动该演练、不修改schema、不部署候选，也不将本机临时介质Host冒充真实CIFS/Workspace连续性。原037安全停机请求已受理，当前转码收口后由公开Resume恢复原供给；不重建生产容器。完整新鲜副本及正常供给下的页面验收继续开放。

实际收口：Stop `d16931f6c70d4f8e5ae4184bd8640c969af32374d1218862f6e78356e8494412`于UTC17:03:57完成，in-flight四项为0；Resume `0c58c2946e15df0c44a8e1beb80fbec9a65f252201b369af5b9a0b05e9461a58`于17:04:01受理、17:12:52完成。HTTP响应及后续认证/读取曾超时，恢复跟踪脚本因认证超时退出；主聊天改用同一持久Receipt只读核对，没有重复提交恢复。17:15:51公开API独立确认health ok、running/desired running/normalSupplyAllowed=true、faulted=false，原容器ID/启动时间/镜像及RestartCount0保持，两季原Run均active等待转码。没有NAS副本演练、原容器停止/重建或Reset。

恢复阶段另采13.12秒CPU并短暂核对调用栈；样本集中在Runtime start的recovery调用位置，另一时刻调用栈见Work Admission。不能将异步callsite样本全部等同于某条SQL；源码仍有Startup Recovery历史集合嵌套membership及Work Admission全历史读取，尚未逐项量化或修复。临时Inspector的首次延迟关闭未立即生效，后续独立确认`INSPECTOR_CLOSED`，不存在发布端口。此次约8分51秒的Resume及HTTP阻塞保留为318后续证据，不因最终恢复成功或候选局部提速而关闭。

## 2026-10-16 通用积压与资源历史读取修复

在`1f36d9ed8`双车间/公平交付之上，Foundation供给统计复用Scheduler既有`select-in(state)`，只返回原规则的open Work、active Attempt及dispatchable Event；阈值、snapshot字段/digest、completion/reserved lane、Circuit和Event排空语义均保持。Resource Governor发Permit前释放等待记录改用已有`list_for_event`，容量释放扫描只返回`waiting`；保持同Event完整历史的需求漂移/退避校验、全体等待者占用预算、优先级及资源原子性。公平任务此前已将`persistSoftWait/persistDeferred`的同Event读取收窄，这部分不重复计为本次修复。没有增加来源策略、缓存、调度队列、schema/API或UI改动。

Windows与本机Linux（037镜像只读绑定当前候选源码/测试）各68项通过，包含供给、Scheduler、Governor和Runtime Host。新增真实SQLite fixture：1000组终态Work/Attempt/Event不进入返回结果，全部活动状态仍贡献原精确snapshot digest；另一组1000条released/cancelled/expired资源记录在Permit与容量唤醒时不物化、不改写，当前等待者仍正常释放。首轮fixture将多个活动Attempt挂在同Work，触发原partial unique约束；改为每个Attempt独立Work后通过，没有修改产品约束。此项是受影响切片，不冒充最终镜像或生产SLO。

对照还使用已资格化的历史204→210结构副本（原204源3132153856 bytes；非新鲜生产副本、不含受保护S02/S03）。以只读Database及Linux只读bind运行实际旧/新SQL，顺序old/new/new/old：三项积压读取返回152635→0行，四个统计值及摘要保持；资源release/wake两项读取78104→1行，筛选后完整结果摘要保持。Linux耗时分别941.77/410.81/7.38/616.32ms及454.43/4.85/3.81/261.91ms，保留首读和冷热差异，不汇总为产品提速百分比。该历史库无活动积压，非零计数/门禁行为由上述fixture覆盖；这里仅证明查询与筛选的局部等价，不是完整Host/当前生产负载资格。私有脚本与原始Linux记录在ignored事故目录，未改该副本或生产。

Libra Metadata完整执行结果的反复读取、浏览器发送前排队和冷启动仍单独待查；必须在最终组合镜像、新鲜副本及真实生产页面继续验证，UAT-318不关闭。

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


## 2026-10-16 dc7dcddbaf已部署，首开及静态传输仍开放

用户明确跳过本轮NAS完整副本Host演练并要求升级；按标准入口发布dc7dcddbaf（source dc7dcddbaf6714d56aaa453610f862914863578f，NAS config92e98da866...，tar SHA25681cd04d16a46e515d9a1aaaf9286881d3d7ac148a841f4a812a6492baf247113）。Perception候选筛选及Foundation终态历史过滤已实际部署；相关输出等价、双平台及精确镜像证据继承上述已有记录，不把上线当作UI性能问题关闭。

实际冷启动：18:07:57.255容器启动、18:12:40.061才listening，约4m43s。Resume于18:12:55.684受理、18:18:41.823完成，5m46.139s；POST在25秒超时，独立SSH核对同一持久receipt442b9781...，没有重复请求。不同数据/负载/缓存下的时长不与旧版8m51s作因果A/B；Startup Recovery、Work Admission及Metadata等此前残余仍需独立定位。生产最终health/running/normalSupplyAllowed通过、faulted=false、RestartCount0，但尚有正常未完恢复与转码，不代表空载或完整收尾。

首轮探针误用无分页的/care和/collection，各返回560项；其中已保存一轮health1023ms、formation1557ms、care5170ms、collection10743ms。这不是当前UI25/48项路径，不用于页面SLO对比。三轮未增量保存的探针最终超时；该次失败保留，不补造已丢失的各请求耗时。随后按web/src/helix/api.ts及实际页面参数纠正，UTC18:22:43一轮：health1436ms，formation?section=active&limit=25为1336ms/12项，care?view=work&limit=25为1193ms/25项，collection?status=current&sort=recent&limit=48为1399ms/48项。仅为正常供给/真实转码期间单轮API样本，未验证浏览器首次绘制、海报和1秒SLO，也非与quiescing同负载对照。

新增明确失败证据：HTTP GET /admin可取得正确新index，但前端大JS请求多次超过15/45秒客户端预算；独立NAS本机curl到127.0.0.1:18080/assets/index-Kbt-DVCt.js，同样在20秒超时，HTTP200只取得131072 bytes，time_starttransfer13.645239s、总20.000548s。这说明不能只归因为Windows客户端或外部LAN/代理；支持后台负载下HTTP响应流推进缓慢的排查方向，尚未定位完整根因，不凭该现象推断唯一独占代码。实际容器文件JS/CSS hash与UI负责人接受版相同，只证明资产版本，不构成HTTP完整传输或首开通过。未加静态缓存/调度绕过来隐去残余。UAT-318保持开放。

私有原始材料：既有.codex/libra-production-upgrade-20261016/release-production-verified.json、release-resume-durable.json、release-live-api-partial.json、release-live-api-paged-partial.json、release-served-container-asset-sha.txt、各probe脚本/运行失败记录；不提交生产数据/凭据。本轮未做Electron或整季媒体E2E，NAS完整Host演练skip不改写PASS。

## 2026-10-16 独立排查：主线程竞争与四处读取修复

沿用 UAT-318；起点 dee0a5a4a、共享 checkout clean，没有新增 UAT 或活动计划。生产仍 dc7dcddbaf，StartedAt/镜像/RestartCount 与前述发布记录相同。本轮只做 GET、只读 SQLite 子进程及一次约 13 秒 CPU 采样，Inspector 随后确认关闭。没有停服、Resume、Reset、部署、媒体/业务数据修改或 NAS 完整 Host 演练。

UTC 18:35 NAS loopback curl 读取 503,927-byte JS，20 秒只收到 311,296 bytes，TTFB 3.818 秒；health 1.104 秒。UTC 18:36:30 容器内 HTTP 子进程完整接收 JS 用 19.380 秒，首块 4.309 秒，后续 16 KiB 块间有约 2 秒停顿；六次 health 3105/458/234/213/294/4 ms。首次文件探针误用 `/app/dist/assets` 得到 ENOENT；纠正为 `/app/dist/admin/assets` 后同文件读取 1.105 ms。保留失败，不能当成磁盘慢或文件不存在。

12.99 秒 CPU profile 中，概览 producer 的 `readFormation → formationQuery.list` inclusive 约 5.429 秒，其中 Arca 状态经 Foundation `scopedWorkStatus` 的 SQL `all` self 累计约 2.195 秒。正常执行 `event input prepare → source media observations → primarySources → issuePhysicalReadHandle → bounded fingerprint` 同步 read/open/lstat self 合计约 1.645 秒。还有收藏健康读取、GC 等竞争，不能把整个 HTTP 延迟归给一个函数。证据支持主线程同步工作延迟静态流回调；API 查询、静态传输、浏览器发送前排队、启动恢复仍独立验收。旧 Metadata profile 不作为当前根因证明。

当前库采样 32,413 Work、93,998 Event、127,536 Event Attempt、74,659 Effect；以下对照均明确其边界。所有修复留在原 Owner，没有 schema、资源限额、优先级、业务结果或 UI 文案变化。

| 卡点 | 根因与修复 | 验证 |
| --- | --- | --- |
| Formation 上架状态 | Foundation `scopedWorkStatus` 的 optional state + DISTINCT/ORDER BY 导致按 Owner 索引扫描历史并临时排序。改用已有 exact Process 读取，再按原规则求 open/latest/failure。 | 当前生产同一只读事务运行实际 Reader，old/new/new/old 的 8 个完整输出 digest 一致：1393/2.19/0.94/1491 ms。独立 SQL explain：旧 `(owner_domain,idempotency_key)`，新已有 `process_id` 索引。另一个固定五状态探针 SQL 对照 2054/0.20/0.08/2085 ms，不混为实际 Reader 时间。 |
| Rating identity | Libra `ratingTarget` 以前读取完整 Routing Context；现在只读 Subject、accepted Intake、formal Identity，仍使用原 Subject/Delivery/formal identity digest fence。 | 当前生产同事务 24 个 Subject 的完整输出 digest 一致：54/43/30/60 ms，SQL/行 216→72。旧/新 Arca target port 均为空只读 stub，聚焦 Owner 读取；不是完整 Rating API 测量。 |
| Work Admission | 原全 Work/Owner Work/Event 物化终态历史后计数。改用既有 select-in 读取完整 open state 集，同事务推导全局/Owner 计数。 | 当前生产计数 SQL 256/7.79/0.62/240 ms，返回行 137,275→258；globalOpen=13、Libra open=6、openEvents=245 和 digest 一致。没有提交生产 Work；reserved slots、硬限额、并发和幂等不变。 |
| Startup Recovery | Effect 对全部 Attempt 逐个 `.some/.find`，取消 Work 子闭包也重复扫历史。改用本次完整 snapshot 的 Map/groupBy，保留全部历史 Catalog、孤儿及 Effect 检查。 | 本机保留的历史 210 snapshot，29,772 Work/120,513 Event Attempt/72,096 Effect，分类器 old/new/new/old 为 155.781/0.319/0.339/228.703 秒，完整输出 digest 一致。排除 snapshot I/O、真实 Integrity/Catalog/Effect recovery，输出含该历史 fixture 的 1,689 个既有 findings；绝不是当前生产 readiness 或完整 Host PASS。两次旧耗时有本机负载差异，不推断完整启动固定缩短比例。 |

新增回归：状态读取覆盖 2,000 条无关历史、相同 Process ID 的不同 Owner/type/kind、全部 open state、latest failure、同时间 Work ID 排序及 NULL/0 时间，并检查真实 SQLite plan 必须 seek Process；Rating 覆盖 Movie/Series/JAV 的 formal/weak identity、坏证据和非 active Subject 拒绝；Admission 覆盖 2,000 条终态 Work/Event 不进入热计数。Startup 新规模回归按实际 Attempt 元素访问次数约束线性增长，不用不稳定的墙钟阈值；终态 Effect 不重放。Windows 最后三文件 40 项通过。原 reserved/hard cap、Circuit、并发、回滚与全历史恢复安全测试保留。

Windows 定向 77 项、Event/Input/Series source 187 项通过；加入 Admission 专项后该文件 11 项通过。最终 `npm test` 为 645 pass/29 既有 skip/0 fail；该入口不包含 `test/helix-architecture` 子目录，不能拿 645 替代新增专项。最终本机 Linux disposable 容器以 dc7 基础镜像、只读绑定候选源码/测试，相关八文件 79 项通过；后续精确候选镜像再次完成同组 79 项，见下文。没有生产升级资格或 UAT PASS。

私有材料在 ignored `.codex/console-response-20261016/`：stream/profile/ancestry、readonly-counts、owner-query-baseline、module-equivalence、admission-counts、startup-equivalence 及验证日志；不提交生产对象、标题、凭据或原始 profile。

当前尚未部署。同步媒体指纹 I/O、概览重复重建、后台负载下静态分块长尾和浏览器首次绘制仍开放；本轮没有删物理 Identity/新鲜度检查或用缓存、停业务、Reset 隐藏问题，也没有宣称 1 秒 SLO 或 UAT-318 关闭。

### 冻结候选与最终验证

实现提交 `4ba8f04d97c0e8ac0352bbdf6751f819efd1fe84`；标准 `node scripts/build-image.js 4ba8f04d97` 成功，候选 `markmahoro/shelfdeck:4ba8f04d97`，本机 OCI image index `sha256:896d1c867c4b7cf6448dd229e2d8a93984d498b485a52a1eb95391e79e601d90`。tar `dist-image/shelfdeck-4ba8f04d97.tar` 565.1 MiB，构建输出及独立 `Get-FileHash` 均为 `fa862699e014cf9790d5d6d51a33f156e11b900b718f97c9c921c79c9daac7e6`。未上传或在 NAS load/deploy，不能将该本机 index 当 NAS classic config digest。

精确镜像 Node20.20.2，相关八文件 79/79 通过；只绑定测试文件，运行代码全部来自镜像。2356 份 canonical runtime COPY 文件逐字节匹配冻结源码，aggregate `7cbbd5fb631921a5b3f7cc410f3d2fbb51bc7972ede1e6b8660af7c109f12a0c`；四处修改源码 hash 与已接受 JS/CSS hash 均匹配。镜像 `org.opencontainers.image.revision` 是继承 FFmpeg base 的 `8158cc5c…`，不是 ShelfDeck commit；初轮证明工具错误地断言它等于当前源码而失败，已改为外部 source commit + canonical bytes/独立 SHA 证明，未伪造标签或忽略代码字节不一致。

直接静态门禁通过：package boundary、forbidden semantics、manifest、P2 contract baseline findings 全空，121 Capability/104 Result family/210 table/51 transaction/0 unresolved type。直接执行既有 `verifyP4RuntimeCrossProcess`，7 Effect Class、5 个非 pure crash point、31 场景全部通过，每个非 pure 场景保持一次 fake dispatch/marker；这是原 Foundation 跨进程 fixture，不是生产媒体恢复验收。首轮脚本把 temp root 放在系统临时根之外被边界拒绝；随后只为该子进程设置任务临时根，在同一受保护 workspace 下重跑通过，保留失败记录。

额外 `helix-p4-runtime-verify.js` 包装会先串联全部 332 个架构 fixture 文件，包含全部 JAV/Series 真实 Host 旅程。本轮该广泛运行在上述受影响专项/31 恢复及静态门禁独立通过后主动中断；已按 PID/parent/命令验证任务归属再停止本轮三个测试进程。包装最终退出 1 / `P4_VERIFY_ARCHITECTURE_FAILED`，不可记为全量门禁 PASS，也不可据此虚构全部旅程失败或通过。没有新增代码以绕过该包装。原始结果在 `runtime-guard.log`；本轮只声明前述精确覆盖，未运行最终新鲜完整副本 Host/升级回退、Electron 或生产前端验收。

最终证明材料另含 `candidate-proof.json`、`canonical-image.json`、`linux-exact-image.log`、`static-guards.json`、`cross-process.json`。本机测试容器均 `--rm`，未留下任务开发服务器。生产仍保持 dc7；候选只是后续资格验证与审阅材料，之前跳过 NAS 演练的决定不自动适用本候选。

UTC 19:01:36（北京时间 10-16 03:01:36）最终只读复核：原 dc7 容器 ID/镜像/StartedAt 保持，RestartCount0；health ok、mode/desiredMode running、normalSupplyAllowed=true、faulted=false。没有因采样或本机修复改变生产运行状态，材料 `final-live.json`。

## 2026-10-16 追加三轮调查：People 分页与残余热点

按用户“再查几轮”继续原 UAT-318。三次约 13 秒 CPU profile、event-loop delay 与 NAS loopback 分块传输，以及三轮各十条真实 GET，均在原 dc7 正常供给下进行。每次 profile 与本机 JS/health 探针并行，十端点 GET 另行三轮；这些是含观察请求与采样成本的现状样本，不是空载基线或受控吞吐/SLO 验收。未部署 4ba 候选，也未执行生产停机、Reset、业务/媒体数据修改或新 NAS 完整 Host 演练。

| 指标 | 第一轮 | 第二轮 | 第三轮 |
| --- | --- | --- | --- |
| 503,927-byte JS 完整传输 / 首块 | 25.598 / 4.357 s | 24.765 / 7.949 s | 19.552 / 2.921 s |
| Event-loop delay mean / max | 627 / 2,098 ms | 888 / 5,083 ms | 524 / 1,814 ms |
| Formation 25 项请求（实际 14 项） | 1,736 ms | 1,626 ms | 2,347 ms |
| Collection 48 项请求 | 1,242 ms | 805 ms | 386 ms |
| People 25 项请求 | 7,414 ms | 6,800 ms | 6,895 ms |

30 条业务/health GET 均完成，未观察到 API 错误；空 Off-deck 请求仍出现一次 2,109 ms，说明返回空集合也可能等待主线程。Overview 返回 ready，projection age 20.075–25.116 s；本样本没有超过既有新鲜度阈值，不据此宣称错误地标记 ready。静态文件传输与 event loop 停顿持续复现，之前四处修复尚未部署，不能把本轮样本当其生产改善证明。

### 新确认并修复：People 列表先展开全量历史再分页

实现提交 `395560043f80d94039005d78fe8a3ce781e52dcf`，承接四处读取修复 `4ba8f04d9`；本轮新增 People Owner 内的分页读取，不改前一候选的历史证明。

原 `PeopleAdminQuery.list` 每次先执行 `listPeople()`，再执行 Registration/Merge Candidate 全量读取以计算四个计数，最后只返回 25 项。当前只读库有 28,996 Person、33,667 Registration Candidate；两项完整映射分别约 3.38/4.20 s，涉及当前 Person、alias/provider identity 和所有 Candidate payload/digest 展开。这个开销独立于原 Formation 状态查询修复。

修复保留 People Owner Repository/事务和现有 `mapPerson`：按二进制 Person ID 游标及 status 在数据库限定 head 页，只展开本页与一个 continuation probe 的精确当前事实；summary 复用 Owner 已有三个 grouped count。Search 仍按原 JS `toLocaleLowerCase().includes`，以 100-head 批次读取精确 current revision 的名字/alias，命中后才完整映射，保持 Unicode 规则，不使用 SQLite ASCII lower 替换。没有 schema、跨 Owner 读取、UI 字段/文字或新旧双读路径变化。

同一生产只读事务，实际新旧 Store + Admin Query 运行 old/new/new/old：**8,152 / 13.01 / 8.17 / 7,485 ms**，完整 DTO、nextCursor 和 summary 的 SHA256 一致；SQL 调用 **120,658→82**，返回行 **183,298→107**，字符串读取 **43,172,090→15,018 bytes**。四次都是子进程隔离的同步查询，不含 HTTP 排队、传输或浏览器绘制。另六组 100 项边界、第二页、空 merged、无匹配、当前名称和 alias 搜索的完整输出分别一致；参考值复用一次原全量快照，不能把它计为六次旧耗时对照。

验证发现初版 `select-page-after` 的 optional cursor 在稀疏筛选时会重复扫描较早 head：空 merged 约 2.06 s、全姓名搜索约 1.3–1.5 s。已改用现有声明式 Repository 的 mandatory greater-than cursor/status predicate，未改 Foundation：最终空 merged 31 ms/4 SQL/3 count rows，三类全姓名搜索仍需 **729–823 ms**、约 87k 轻量行。搜索成本保持开放；不能声称所有人物搜索或整页已小于一秒。测试检查实际 SQLite EXPLAIN 必须 `SEARCH … (person_id>?)`，防止仅返回量有界却反复扫描前页。

新增规模/分页回归覆盖 310 Person 只展开 26 个事实、summary 不展开 Candidate；130+Unicode Person、current revision 名称/alias、历史名称排除、真实 merge、二进制游标、100 项及非法 limit；选中事实继续执行原完整类型/来源校验，坏来源被拒绝。Windows People 六文件 52 项、最终本机 Linux 同组 52 项通过；Linux 使用 4ba 镜像运行时，只读绑定当前 src/test，**不是包含 People 修复的新精确镜像**。最终 Windows `npm test` 为 645 pass/29 既有 skip/0 fail，该入口不包含架构子目录，不能替代 People 专项。初次 Linux 调用误传 Windows 反斜线测试路径而未找到文件，规范为 `/` 后通过，失败日志保留。静态 boundary/semantics/manifest/P2 四类门禁均通过，121 Capability/104 Result/210 table/51 transaction/0 unresolved 保持。

### 新确认的剩余开销，尚未修改

- **Outbox 历史轮询**：Dispatcher 的 `list_due` 每秒读取全部 delivery 后过滤，当前 10,030 行中 10,029 acked/1 delivered/0 pending。同事务 SQL 对照 full/open/open/full 为 38.31/0.187/0.069/28.75 ms，0 待投递时仍有全量物化；三轮 profile 的 `due` inclusive 为 280/313/322 ms。现有 deferred key、retry recovery、先过滤再 batch 与投递顺序需保留；尚未改查询或宣称延迟已消失。
- **执行摘要的完整输入解析**：Formation list summary 仍以 `includePlans:true` 获取完整 Plan node input/parameters，然后构造详细投影再取当前行动摘要。第二/三轮在 `parseDurableJson(input_bindings_json)` 下的 canonical self 约 842/189 ms，第一轮未命中该栈；这是采样窗口累计，不是每请求固定成本。所需 Device Class、配置动作、当前事实及 canonical/digest fence 不能直接删掉；尚未建立更窄摘要读取合同或实现修复。
- Metadata context 的重复构造、同步 source fingerprint、Aftercare/Perception 等继续有采样命中。已有 artifact input scope WeakMap 只在单次同步 preparation 复用，不误记为完全没有复用，也不扩为跨请求事实缓存。上述开销与静态传输/浏览器首次绘制仍需后续独立定位和部署后验证。

UTC 19:22:25（北京时间 10-16 03:22:25）只读收尾：原容器 ID/镜像/StartedAt 保持、RestartCount0、health ok、running/normalSupplyAllowed=true/faulted=false，Inspector 确认关闭。第一轮只等一秒清理时曾得到 `INSPECTOR_OPEN`，随后 timer 已关闭；第二/三轮延长确认及收尾均 closed，保留短等待失败，不称为持续泄漏。没有任务开发服务器或保留测试容器。

本轮 People 修复尚未构建新产品镜像、上传或部署；原 4ba tar 不包含本轮变更。UAT-318 保持开放，不继承旧候选的完整资格，也不把只读局部查询加速当整页 1 秒 PASS。私有材料在 ignored `.codex/console-response-followup-20261016/`：round 1–3 profile/lag/stream/API、store-bench、people-equivalence-first/最终、stack-findings、双平台测试及 final-live；不提交生产 payload/profile/凭据。

## 2026-10-16 再查十轮：当前 Inventory 范围与交付重建

按用户“再查10轮”完成十个独立编号周期，UTC 19:28:35–19:34:18（北京时间 10-16 03:28:35–03:34:18）。生产全程为原 dc7，未部署此前四处读取或 People 补丁。本轮每次依次 GET health、overview、Formation active 25、Collection current/recent 48，再轮换第五个重点；同时一个容器内 loopback JS 请求。第 1/5/8 轮增加约 13 秒 CPU profile、delay monitor 与五次 health。两个只读 Owner bench 与第 5/10 轮静态流的部分时段重叠。请求/采样/子进程均有观察成本，后台工作也在继续；不能将这十轮与前三轮或未部署候选作同负载性能比较。

| 轮 | 追加重点 / 耗时 ms | Formation ms | Collection ms | Overview state / age s | 503,927-byte JS |
| --- | --- | --- | --- | --- | --- |
| 1 | Care first page / 1,067 | 2,687 | 3,096 | stale / 45.451 | 30 s 超时，294,912 bytes |
| 2 | People 25 / 8,294 | 3,534 | 600 | stale / 54.488 | 35 s 超时，376,832 bytes |
| 3 | Material Fields / 958 | 2,101 | 2,766 | ready / 20.277 | 35 s 超时，425,984 bytes |
| 4 | Shelves / 1,082 | 4,010 | 2,414 | stale / 37.619 | 35 s 超时，344,064 bytes |
| 5 | Off-deck candidates empty / 300 | 2,032 | 875 | stale / 44.506 | 完整 25.746 s |
| 6 | Off-deck cases empty / 2,440 | 3,861 | 2,875 | ready / 24.526 | 35 s 超时，311,296 bytes |
| 7 | Care next cursor page / 1,229 | 4,066 | 2,287 | stale / 43.757 | 35 s 超时，393,216 bytes |
| 8 | Collection next cursor page / 383 | 2,920 | 469 | stale / 44.167 | 完整 27.008 s |
| 9 | People merged empty / 7,983 | 2,565 | 1,141 | stale / 31.106 | 35 s 超时，294,912 bytes |
| 10 | People unmatched search / 8,851 | 2,955 | 1,158 | stale / 49.327 | 35 s 超时，278,528 bytes |

50 条 API 均完成且没有错误，health 范围 85–3,110 ms；这不等于页面体验通过。十次静态流都取得 HTTP 200 headers，但 **8/10 未取得完整 JS**；不能只据状态码判成功。8/10 overview 已超过 30 秒并如实标记 stale，区别于前三轮未观察到 stale 的事实。现有代码以 producer startedAt 作为快照时间，读请求没有同步重建；本轮不调大阈值或改为结束时间掩盖新鲜度不足。第 1/5/8 轮 event-loop max 为 2,598/2,106/2,136 ms，mean 为 1,090/559/742 ms。

### 新确认并修复：健康投影仍载入旧 Inventory Representation / Material role

实现提交 `f6670f7d52bb33da1a76c3ab193888127a35fc21`，沿用 UAT-318；与此前 People `395560043` 及四处读取 `4ba8f04d9` 分别留证。

已有 current Fact 过滤正确，但 `AftercareStore.healthProjectionInputs` 对 Representation 与 Material role 仍按 Entry 读取所有 revision，之后才查当前 revision。只读拆解：560 active Entry 返回 5,203 份 Representation、40,660 个 Material role；前者约 1.00 MB、后者约 2.98 MB 字符串。另有 18,842 Assessment 和 2,435 Finding，属于健康历史合同，不将它们冒充同一种可直接删除的读取。

修复仅在 Arca Owner 内复用当前 Entry head 的 revision 分组：Representation 加 exact `revision`，Material role 加 exact `inventory_revision`，每批不超过 500；与已存在的 current Fact 查询使用同一 head/事务。历史 Assessment/Finding/Case/Commit、当前 metadata digest、健康 Basis 及异常处理保持，不新增缓存、迁移或 fallback，不修改 schema、Foundation、API 字段或 UI 文字。

当前生产库同一只读事务，实际 Store 的完整 health projection 按 old/new/new/old 对照，三组输出各自完全一致：

| 范围 | old / new / new / old ms | Representation 返回行 | Material role 返回行 |
| --- | --- | --- | --- |
| 25 Entry | 97 / 49 / 55 / 70 | 189→25 | 1,363→167 |
| 48 Entry | 81 / 55 / 73 / 71 | 397→48 | 2,891→327 |
| 560 Entry | 1,290 / 1,017 / 918 / 1,216 | 5,203→560 | 40,660→4,339 |

560 范围的两类字符串读取合计从 **3,981,268→426,143 bytes**。revision 分组使这两类查询各由 2 次增到 21 次，真实权衡是少物化历史，并非声称 SQL 调用下降。完整范围仍需约一秒，且原 Overview 以 100 Entry 分页调用，还包含其它 Owner/投影成本；以上不是整体概览、HTTP 或浏览器的加速证明。

规模回归扩展现有 503 Entry fixture：跨 500 bound、混合 current revision、历史 revision9、inactive Entry，逐项检查当前 role/metadata、实际 SQL exact revision/IN/无 inactive 及只返回 502 份当前 Representation/role。保留缺失当前 Fact 的既有行为，不借旧 revision 填补。相关六文件 Windows/Linux 各 **63/63** 通过；Linux 只读绑定当前 src/test 到 4ba 基础运行时，不是新精确候选镜像。静态 boundary/semantics/manifest/P2 均通过，121/104/210/51/0 unresolved 保持。

最终修改后的 Windows `npm test` 再次完成：645 pass/29 既有 skip/0 fail，约 158 s；该根入口不包含架构子目录，相关 63 项仍单独验收。未重跑完整架构包装、整季媒体/新鲜副本 Host 或 Electron，不继承上一候选的精确镜像资格。

### 新确认但未修复：上架完整交付包反复重建

第 1/5/8 轮 `product-delivery-reader` inclusive 为 **6.056/1.033/1.081 s**；第一轮的 6 秒是约 13 秒窗口累计，不是单次读取固定耗时。堆栈是 Arca Settlement input preparation → `readSettlement/readOffer` → Libra `readPackage/reconstruct`，包含完整 Package/Fact/Manifest 的 canonical 与 digest 检查。当前 `createOnDeckProjections` 会对每个 binding 分别读取 context；同一次 prepare 的重复获取及跨成员执行的完整包重建仍需专门收口，不能直接缓存跨 Event 的可变责任/许可或删完整性围栏。

独立只读代表性 Season Package 有 145 members、完整返回 1,280,745 bytes。确认每份 Fact 在 reference digest 和返回值处重复调用 `readStoredMetadataValue`；试验仅改为本次重建复用 decoded value，调用 6→3、处理字节 278,170→139,085，完整输出 digest 一致。但 old/experiment/experiment/old 墙钟为 **355/233/201/143 ms**，存在明显热身/负载影响，**不能宣称该微调已证明提速**；试验没有写入 tracked 代码，也没有替代真正的大包重复重建治理。实际生产完整性校验保持。

额外检查没有支持另两条猜测：当前 Perception relation 表为 0 行，故其全量 relation 读取不能作为本次现场主因；抽样事务没有 delivered Outbox（此前的一条已由正常业务推进），没有证据称其落入无 Inbox 黑洞。Outbox 历史轮询和执行摘要重解析仍分别在三轮命中，文件级 inclusive 各约 164–303 ms、370–1,799 ms；这些集合可重叠，不能相加当总占用。

UTC 19:34:43（北京时间 03:34:43）只读收尾确认原容器 ID/镜像/StartedAt 保持，RestartCount0、health ok、running/normalSupplyAllowed=true/faulted=false、Inspector closed。十轮没有生产停机、重启、Reset、数据/媒体处置、上传、部署或新 NAS 完整 Host 演练；本轮当前 Inventory 补丁和此前 People 补丁均未打入新产品镜像，4ba 旧 tar 不能代表它们。UAT-318 和实际整页一秒资格继续开放。

私有材料：ignored `.codex/console-response-ten-20261016/ten-rounds.json`、每轮 api/complete、1/5/8 profile/summary、analysis、owner-bench、health-equivalence、双平台测试、static-guards、final-live。仅提交聚合证据，不提交原始生产对象、profile、密钥或 session。

## 2026-10-16 本次读取修复发布资格

用户明确要求“好的 先部署这次的修复升级吧”，授权本次标准生产发布；不包含 Reset、清库、迁移或媒体清理。候选合并四处读取修复、People 分页及 Arca 当前 Inventory 范围，source `3c3991fabe29678a5a51793a98ace8f9a0b99124`、Docker `markmahoro/shelfdeck:3c3991fabe`。本次没有 schema、依赖、UI 字段或文案变化。

标准 `build-image.js` / `upload-nas-image.js` 及独立本机 SHA 校验完成：tar 592,583,168 bytes，SHA256 `b8392874942e46278d9f14a802b8690ddbceb8a49f9d0895318c7f9408348bf3`；本机 OCI index `sha256:20679f6af7cc86834bd4bf4dddb37d40699b3fcc7a87aba7059a3139bca9f170`，NAS classic config `sha256:4d6609cd47f5537096d18f357f7477d4ebf31bd9bbb95aa2aec5d0ef7e2559d3`。2356 份 canonical runtime 文件与冻结源码全部一致，aggregate `9c7b177125b0ba14a0d2ff2ba2d394c3ae7f9b2459b31da3bfd2569f7b9a6f6b`。最终镜像直接运行受影响 Linux 专项 **236/236** 通过；继承同一代码的 Windows Service645 pass/29既有skip、此前相关专项及静态门禁，不补称全量架构包装或整季媒体 E2E 已通过。

已验 UI 的 JS `index-Kbt-DVCt.js` 503,927 bytes / SHA256 `484017837528e53f778648c4b37f05620f97c516901ba32fc72c87112e92584f`，CSS `index-BYV0LKeb.css` / SHA256 `82cb8561be6544293d0f6850171d0df02a9a97e53bf60a075ec262ede15df4e2` 在候选保持；未产生新 UI 版本。纯后端读取变化不以 hash 校验冒充浏览器首开性能验收。

### 最新完整副本与候选 Host

UTC 19:45:37.028 从仍运行的 dc7 捕获 SQLite 已提交一致快照及全部伴随文件，56文件/210表/560收藏，两季指定 Run 存在，integrity ok/FK0。冻结 aggregate `26508df100992bca533c7b8ff6243a94439dae83c265d872b0584be792628397`；NAS 独立目录 `backups/uat318-release-20261015T194429-3c3991fabe`。每份 Host 演练使用另外复制的目录，网络隔离，真实媒体和现有 Workspace 全部只读，生产 data 没有用于演练写入。

首次准备被 `P13_BACKUP_DIGEST_MISMATCH` 拒绝：检查工具在冻结副本打开 SQLite 后生成 32KiB SHM/空 WAL。逐文件证明原 manifest 所列字节均未变化，仅把原清单文件及原 manifest 复制到新 `full-canonical`；官方 verifyBackup 在相同 aggregate 下通过，原件及辅助文件保留。没有重签摘要或修改生产来源来绕过检查。

首个候选容器错误设置为 1GiB/cgroup 和约512MiB V8 heap，完整规模启动发生 V8 OOM、exit139；Docker OOMKilled=false 不能抹去此失败。实际生产 V8 heap limit约2GiB，故重试明确匹配2048MiB heap，cgroup3GiB，CPU最终2核。重试完整 `server.js` / `createCleanServiceHost` 于 UTC20:06:49 health ok、normalSupplyAllowed=true；从启动到本次探针约499s，包含初期1核限制，不能当作生产启动耗时。继续正常调度超过30秒后正常关闭、exit0。61张不可变表的704,292行、全部历史Effect意图及终态执行、560原收藏和两季Run基础保持。媒体写入的 EROFS/ENOENT 已定位到演练只读挂载，不能记为媒体旅程通过。

候选启动期间 UTC20:05:14–20:05:55 出现118次 `P4_RESOURCE_PRIORITY_UPDATE_INVALID`，开放HTTP及正常供给之前已停止。根因证据：快照 Libra fairness revision895 的持久化 waiter 含195/188/143分，进程初始化尚未重建 eligible 来源集合时同 revision 投影为100分，Foundation正确拒绝同 revision 改优先级。旧、新精确镜像使用相同实际 Owner 代码的初始化投影对照均复现，四个相关文件 SHA相同；不是本轮读取补丁引入的新优先级语义，也不因此删除 Governor fence。该既有启动时序问题留存，不把演练错误笼统算成网络隔离。

候选在首次 V8 OOM 后保留同一演练目录重试，没有删条目或重建数据掩盖恢复问题。再从已经运行并正常关闭的候选目录复制 `rollback`，使用原 dc7 精确镜像完整启动。UTC20:23:51 探针确认 health ok / normalSupplyAllowed=true，约782s（2核限制、完整恢复检查，另含一次约11s的任务容器采样观察成本）；至少30s正常调度后 exit0 关闭。61张不可变表704,334行、原Effect意图/终态执行、560收藏/两季Run保护通过，25项reconcile_required保持。回滚仅有只读媒体产生的EROFS/ENOENT，没有优先级错误。本次当前镜像覆盖来自原生产健康运行及该精确dc7回退Host，候选及候选使用后数据的回退均有实际完整Host证据；不是只验数据库readiness。隔离媒体/外网限制保持，不声称整季媒体E2E通过。

私有发布材料在 ignored `.codex/uat318-release-20261016/`；包含原失败日志、精确镜像证明、snapshot envelope 核对、Host 观察及逐行历史核对。实际生产切换结果见下，不以构建/上传或 readiness 代替发布成功。

### 标准生产升级结果

UTC20:25:50 仅提交一次正式 Stop，desiredMode=stopped、新供给关闭，仍有1 Event/1 Recovery，Owner/Admin命令为0。在线Stop没有强制完成长任务；按获授权标准发布的75s信号窗口关闭进程。旧进程保留 `P4_SHUTDOWN_CHECKPOINT_TIMEOUT` / exit1 的实际记录，不称优雅关闭完全成功，不将技术中断伪写成媒体失败或删除Journal。停机后官方完整冷备份59文件，aggregate `66e7392db520ad6c5b0e4e98a5c7e75fc27682a332452c938cc0149b01d5c1aa`，位置 `backups/uat318-release-20261015T194429-3c3991fabe/cold`；compose/secret另存同一受保护目录。560收藏、两季active Run和2个Workspace被精确冻结，未Reset/改库/清理媒体。

最终dry run及SHA通过后，标准 `deploy-nas.js --apply` exit0；最新停机数据readiness、health/Admin Web/原六个数据与媒体绑定/QSV/实际tag/镜像源码检查通过。新容器 `04f7ddfa9333db446004c37f5348621a4abbf179af63930c2637ef345febfd93`，StartedAt `2026-10-15T20:30:45.883315242Z`。首次启动保持stopped/quiesced，UTC20:34:01复核无活动执行和fault。

UTC20:34:01.067正式Resume仅提交一次；25s客户端响应超时（code23）不等于操作失败，没有重复提交。持久化Receipt于UTC20:37:08.729 completed，约187.7s；UTC20:37:26复核mode/desiredMode running、normalSupplyAllowed=true、faulted=false、RestartCount0、OOMfalse。实际容器七个修复源文件及两份已验UI资产SHA均匹配候选；adult双绑定同inode、QSV/13无关容器/fnOS200保持。

生产恢复同样出现既有启动时序优先级错误149次，UTC20:35:56.800–20:36:19.371，Resume完成前约49s已停止。UTC20:38观察供给正常且没有新错误类，不将该历史错误隐藏为“完全无启动错误”，也不将其写成新修复已经解决的问题。任务的3个隔离演练容器（包括原OOM失败者）已按准确ID/镜像/label核对后移除，演练数据、原失败日志、冻结备份及旧镜像/tar保留。

生产恢复后的独立一致副本与冷备份逐行核对通过：61张不可变表 **704,421行**、所有原Effect intent及原终态执行均保留；原560 Entry和原Commit保留，当前仍560收藏。两季精确Subject/Run的不可变基础、2个Workspace绑定及原物理目录身份保持，data目录dev/inode保持。56个伴随文件中仅 `operator-runtime/intent.json` 因正式Resume从stopped/revision9变为running/revision10，按原atomic write更换inode/hash；其它55个文件字节和inode均相同。没有替换数据库、迁移、Reset或人工媒体处置。材料 `production-verified.json` / `production-history-proof.json` / `production-object-proof.json`。

UTC20:40:35–20:41:45（北京时间04:40–04:41）正常供给下做三轮只读抽查。未开CPU profile；完整副本/历史核对进程已经结束，每轮五个API顺序请求并与一次容器内loopback静态流并行。15 API全部成功，3次503,927-byte JS完整返回且SHA与已验资产相同：

| 轮 | health ms | Overview ms / age s | Formation25 ms | Collection48 ms | People25 ms | JS首块 / 完整 s |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 476 | 100 / 27.586，ready | 1084 | 1552 | 523 | 2.947 / 24.969 |
| 2 | 1019 | 312 / 25.960，ready | 1460 | 1027 | 3012 | 3.532 / 20.327 |
| 3 | 160 | 71 / 12.582，ready | 802 | 219 | 988 | 5.228 / 23.371 |

这些是上线后短窗口、含探针观察成本的样本，负载与此前十轮不同，不声称同负载A/B改善幅度。没有本轮静态传输超时或stale，但JS仍20–25s、部分API仍超过1秒；**UAT-318继续开放**，不据三轮成功关闭浏览器首开、整页一秒SLO、交付包重建/同步I/O/Outbox/执行摘要等剩余热点。未重跑整季媒体生产E2E或Electron；不修改此前测试局限。材料 `production-smoke.json`。

UTC20:44:49（北京时间04:44:49）收尾复核：原新容器ID/镜像/StartedAt保持，health ok、running/normalSupplyAllowed=true、faulted=false、RestartCount0/OOMfalse；启动优先级错误仍累计149次，最后一次20:36:19，没有在恢复运行后继续增长。媒体工作由原Owner正常继续，无人工重处理；原备份/回退镜像保留。

### UAT-321：启动来源公平投影时序

上述优先级错误是上线后新确认的独立问题，登记为UAT-321，不混入UAT-318性能关闭条件。已确认旧/新代码初始化阶段的相同Owner revision可能对应不同localPriority，Foundation拒绝正确；本次生产149次错误在Resume完成前消退，最终供给及fault状态正常。本次发布没有实现此项修复。

关闭需由Libra Owner在既有合同内保证启动/重建/等待恢复阶段的revision与投影值一致，覆盖已有持久化waiter及新建执行的冷启动、正常Owner周期和精确规模完整Host复验；保留来源公平、Governor的同revision不可变围栏及历史数据。不能简单忽略错误、提高revision掩盖缺失的Owner事实、把业务优先级移入Foundation或Reset数据来关闭。

## 2026-10-16 生产当前版本继续排查（UTC03:27–03:33）

生产仍为 `3c3991fabe`、原容器 `04f7ddfa9333`，RestartCount=0、health ok、normalSupplyAllowed=true；没有部署、停服或数据处置。UAT-321 同 revision priority 错误仍为启动期间149次，未新增；日志另出现 PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED，尚不能据此判定与本轮延迟的因果关系。

两次当前进程 CPU 采样分别约13.95/13.98秒，Arca `aftercare-context-reader.read` inclusive 时间为9637/9785ms，约占69%/70%；其子路径 Perception `readCurrentRating` 为5418/5352ms，`readResolutionCandidates` 为4515/4744ms。inclusive 数值相互包含，不能相加。事件循环最大延迟2069/2525ms。同期 JS 在30秒预算内只收到360448/262144字节，均未完成；HTTP 200不计下载成功。采样含观察开销及少量health请求，不当作无负载基准。

Inspector 两次均确认关闭。之后不运行采样器或等价对照，只进行单个容器 loopback HTTP 下载：503927字节完整传输29553ms，首块3830ms，SHA256为484017837528e53f778648c4b37f05620f97c516901ba32fc72c87112e92584f；同文件直接读取2ms、字节及SHA相同。分块之间持续停顿，说明延迟在当前服务路径上存在，不能只归因于客户端网络或Inspector。

代码与现场只读记录对应：当前8个 `arca.aftercare.conformance.observe@1` Event处于waiting_for_resource，另有1 pending、1 executing。每次conformance输入准备的CareBasis/InventoryRevision/KnownBindings/Standard/Placement五个Projection均独立调用完整 `ctx → reader.read`，重做评分候选、历史Settlement结果与摘要。Governor已有5秒有界preparationWait，容量释放可立即重读；未发现“完全没有等待抑制”，不能用永久跳过新鲜读取或任意增大等待时间冒充修复。当前候选anchor为provider_identity1558、subject_id12、title2826、title_year2821；Outbox10074条均acked，仍有全历史轮询，但本窗口不是最大热点。

两项未保留的实验：改纯字符串memo FIFO淘汰、将normalized_exact查询值预先归一化为Set。使用同一只读事务的6个实际收藏目标比较完整Resolution Context及Rating，均保持完整输出等价；第二项old/new/new/old合计851/630/769/571ms，未证明稳定收益。第一项同样无稳定收益。两项源代码均已恢复，不将其列为已修复，也没有热补丁到生产进程。

后续修复重点应放在Arca维护Projection的重复完整读取及其正式新鲜度范围。现有 `p15-aftercare-projection-source` 明确验证后续调用读取新事实；不能简单加跨调用缓存。需证明同次准备的读取一致性、下一次准备的新鲜性、CareBasis/Settlement完整性fence及Owner职责均保持，再以实际完整Host和完整JS下载验收。本轮完成热点定位，没有新增有效产品修复；UAT-318及整页1秒SLO继续开放。

原始证据保存在ignored `.codex/console-response-current-20261016/`：两份profile及summary、current-counts、perception-equivalence、unprofiled-transfer；私有数据不入库。

## 2026-10-16 多轮因果对照（UTC03:36–03:41）

用户要求继续多次排查以确认根因。本轮不修改产品代码、不部署、不停止生产供给；追加8轮同容器传输对照、2份新CPU采样及3个真实目标的只读事务反事实测量。生产镜像/容器/RestartCount保持；诊断Inspector已关闭，临时loopback HTTP对照server随每个探针进程关闭。

### 传输路径对照

每轮在独立短生命Node进程内，以127.0.0.1随机端口和16KiB stream发送同一份JS；同时向正式18080请求同文件。两端均核对完整503927字节及既有SHA256，另测正式服务16KiB Range和health。对照不加载业务Host，验证的是同容器文件/网络/基本stream能力，不冒充同配置Fastify或完整Host修复资格。

| 轮次 | 独立stream并发对照 ms | 正式JS ms | 正式16KiB Range ms | health ms |
| --- | ---: | ---: | ---: | ---: |
| 1 | 39 | 11537 | 473 | 646 |
| 2 | 12 | 18968 | 807 | 459 |
| 3 | 20 | 9859 | 19 | 2 |
| 4 | 15 | 193 | 3 | 1 |
| 5 | 14 | 7252 | 231 | 8 |
| 6 | 12 | 7955 | 50 | 594 |
| 7 | 21 | 13785 | 378 | 75 |
| 8 | 33 | 22639 | 25 | 634 |

第7/8轮与03:39:32新profile窗口部分重叠，不能当作无采样基线；第1–6轮没有Inspector采样。第4轮CPU tick增量25，其他慢轮增量679–1970，测量区间包含JS/Range/health，不能作为精确CPU百分比。单轮193ms没有修复或部署发生，不是问题解决的证据；完整JS多chunk延迟会累积，小响应快不能代表首开快。上述反复差异排除了“静态文件读取/容器网络本身固定要几十秒”这一解释，支持应用主线程繁忙造成回调延后。

### 主导负载发生变化，推翻单一热点即可解决的假设

03:31现场有8个conformance资源等待Event；03:37:28只读盘点中已无该组活动检查，最新health_assessment Work记录03:34:42 succeeded。不能把03:37:11那次快速下载直接等同该Work的精确完成瞬间。此后第5–8轮仍7–23秒，证明先前Aftercare重复context并非全部原因。

03:39:32窗口12.63秒：Formation list inclusive3825ms、概览Collection overviewStats2945ms、周期Owner runRegistration3110ms；Perception候选路径仍在周期rating/watched resolution核对中出现。该窗口有其他传输探针并行，保留观察限制。

03:40:27另一个独立采样窗口13.12秒：Formation list inclusive6524ms、currentFacts6036ms、progress-projection read4506ms；其中概览readFormation4103ms。profile同时观察到真实Formation HTTP请求，不能全算后台概览。event-loop max2131ms、完整JS13175ms。以上inclusive父子时间重叠，不能累加。Inspector确认关闭。

代码机制与两种负载下的证据一致：

- conformance准备5个Projection时，每个均独立调用完整Arca context，重复Perception候选与历史结果校验；资源等待期间仍需有界刷新，原5秒preparationWait已存在，不是完全缺少等待抑制。
- 概览生产者默认5秒cadence，每轮readFormation分别调用active summary、attention、in-progress、completed四次list；active路径在当前配置触发完整activeSnapshot/currentFacts，重建进度与canonical输入。Collection overviewStats另以100项分页读取全部active收藏健康。yield位于批次/reader之间，不能中断一个内部同步长调用。
- 当一次概览重建耗时超过cadence，当前tick以max(1,cadence-elapsed)安排下一轮，即几乎立即再次重建；周期Owner评分/已看状态核对、用户列表请求也占用同一Node主线程。多个高频读取的总开销与单次连续阻塞共同影响静态stream。

### 重复读取的独立量化与限制

在独立进程、同一个query_only只读SQLite事务内，对3个实际收藏目标调用真实Aftercare/Perception/WorkResult/ProductDelivery reader，按five/one/one/five顺序比较五个Projection所需字段。one仅在实验固定快照内重用一次context，不是产品补丁；完整输出digest相同。

| 目标 | five / one / one / five ms | SQL prepare次数 five→one |
| --- | --- | --- |
| 0 | 1323 / 233 / 173 / 1173 | 180→36 |
| 1 | 459 / 71 / 55 / 348 | 205→41 |
| 2 | 363 / 54 / 72 / 301 | 205→41 |

评分及历史Work读取均5→1，证明确有重复计算放大；不能据此声称可安全跨Event缓存、正式并发新鲜度已通过，或网页将等比例提速。生产facts/digest/fence保持，未进行热替换或数据修复。

当前证据支持的根因是：业务查询/投影在HTTP同一主线程中执行高频、范围较大的同步读取及校验；同次准备/同轮概览重复计算进一步放大，使静态stream回调长时间得不到执行。Aftercare、Formation/概览和周期Perception核对是已实证的不同贡献路径，不能再把其中一个当作唯一根因。具体修复须分别验证各Owner读取范围、同次计算复用及每次执行新鲜性，随后用完整Host同负载对照验证，不能仅改慢轮询间隔、移除完整性检查或扩大缓存来宣称达标。

本轮没有新增有效产品修复或发布；UAT-318继续开放。证据目录为ignored `.codex/uat318-causal-20261016/`，包含8轮传输、after-fast-counts、history、context-counterfactual及两份profile/summary；其中profile round-1/round-3的编号独立于传输round-N.json，不能混淆。

## 2026-10-16 按多轮根因实施（进行中）

用户明确授权修复并在多轮同负载验证真正改善、架构及数据正确性保持后部署。第一批只改变读取/投影计算边界：Foundation Binding准备生成不持久化的opaque preparationScope，每次prepare唯一，Arca Projection通过WeakMap只在该同步scope内复用完整context；Executor、Effect、Result、持久输入和业务事务不接收此对象。直接Projection调用未给scope时仍每次读取，重试/其他Event/后续prepare均重新校验，读取失败不缓存。Owner职责不转移。

Libra新增同次overview组合读取，复用当前activeSnapshot而保留原summary/分类/完整DTO规则；后续overview重读。Arca概览健康页100缩为10，每页之间yield，保留完整最终汇总；概览完成后至少等待原cadence再开始下轮，保留generatedAt、age/stale和失败显式状态。没有全局业务缓存或跳过canonical/fence，也没有新增持久健康投影；是否需要进一步机制调整以完整Host实测为准。

首批23项定向、172项恢复/资源Governor/维护副作用/Settlement/Formation回归通过；新增超cadence测试独立3项通过。完整Service及精确候选Linux/完整数据副本/多轮性能对照仍在执行，未部署。原生产3c镜像、RestartCount0与61GB可用磁盘已复核，NAS preflight记录在ignored `.codex/uat318-fix-20261016/`。

### 2026-10-16 b84f36509a 候选完整副本对照（进行中）

- 用户授权保持架构边界和数据正确性，多轮确认改善后再部署。候选源提交 b84f36509a2244d51b8f902903fd43db8e7e8680；尚未 apply 到生产。
- Windows 完整 Service：646 pass、29 既有 skip、0 fail；相关恢复/资源/维护 172 pass；精确候选 Linux 196 pass。镜像内 2356 个运行文件逐一匹配源码，aggregate e4eae9b850573044d6ce801932857137d6e5bf0df3431d97ae81f8918de6f0b7。
- 最新一致快照 UTC 03:53:13：58 文件、210 表、567 当前 Shelf Entries，两条受保护 Run 保持；完整 SQLite integrity/FK 及伴随文件清单通过。原 560 条及不可变历史的逐行资格仍需候选使用后检查。
- 完整旧版 Host 使用同一冻结副本，2 CPU / 3 GiB、媒体与生产 data 只读、network none。启动约 585 秒，normalSupplyAllowed=true；正常 Owner 周期及测试后退出码 0。既有 UAT-321 priority revision 错误和隔离媒体 ENOENT/EROFS 如实保留，不算媒体生产 E2E。
- 旧版 10 轮：50/50 API 200；JS 7 次完整 hash 相同，耗时 11.83–33.38 秒，另 3 次在 35 秒截止未完成。Health 最大 12.69 秒，Formation 最大 2.89 秒；overview 1/10 stale，age 58.97 秒。复现主线程长尾，不能以 API 成功判性能达标。
- 原始证据位于 ignored `.codex/uat318-fix-20261016/`。候选同副本 10 轮、历史保护和使用后回退资格正在进行；本段不构成发布通过。

### 2026-10-16 b84 候选不通过及 Effect 精确读取追加修复

- 候选10轮50 API成功，Health最大455ms、Formation最大1121ms；JS全部完整hash正确但1.67–28.40s，overview1/10 stale（32.74s）。旧/新整轮资源相同；背景工作随各自恢复推进，不冒充锁步相同业务状态。由于长尾仍显著，不apply生产。
- 候选正常停止ExitCode0。61不可变表705,991行逐行保持、所有Effect意图保持、567原Entry及两条Run基础保持。冻结副本上完整Arca概览digest为020fd97fd6846fd5ef1b41e165f3e737ec10ba6d37a444d7e2facc29da3bf782，三个目标各五组投影digest为6773db226060710dd31d0f1e0be3d61b899dee8830193dee8a0f829b8808de1a，旧/新完全相同；首次辅助脚本漏传posterReader依赖失败后修正，未改产品数据。
- 候选两个12秒采样分别见Effect Journal intent/恢复/完成Marker全量读取、Perception候选组装、People注册Evidence查找及物理指纹等竞争。两次Inspector均关闭；采样轮不混入10轮无profiler性能结果。
- Foundation内部新增精确条件读取：Effect intent沿原唯一(effect_class,idempotency_key)查询；恢复和prebound completion只读取当前effect_id全部Marker。保留原identity/digest/CAS/marker完整字段与基数校验，未限定LIMIT隐藏多Marker异常；没有新Schema/索引、全局事实缓存或跨Owner事实迁移。
- 最新冻结副本75468 Effects/57630 Markers，5轮×3真实目标旧/新完整结果逐项相等：旧1181.89–1478.15ms，新15.45–53.61ms。此为同只读事务的局部反事实测试，不替代下一候选完整Host性能验收。
- 相关恢复/幂等/冲突/历史131测试通过；新增2000条无关Effect/Marker回归证明不物化无关历史，仍返回同Effect的两条Marker供原基数判断，digest冲突继续拒绝。后续完整Service及新精确镜像/Host资格进行中，生产保持3c3991fabe。

### 2026-10-16 ffa85c9a6 完整副本与静态传输追加修复（进行中）

- Effect精确读取候选 `ffa85c9a62ab446eca96ba7c406787eb9818560e`：Windows Service646 pass/29既有skip；精确Linux138 pass；2356运行文件对应源码；tar SHA256为551a4d586703ee214c6680436582e9d755277e517c783530925e539a100d3582。首次Linux调用未挂载tests失败，修正后通过。镜像OCI revision标签继承底层FFmpeg镜像，不能冒充ShelfDeck source；本次使用完整运行文件hash与tar SHA证明源对应。
- 同冻结副本完整Host启动约495秒、正常供给后10轮：50 API成功，JS均完整，前8轮2.64–8.42秒，第9/10轮仍27.53/19.51秒；overview10/10 ready，age6.55–26.04秒。改善但长尾未消除，仍未apply。
- 后续独立采样event-loop max909ms，JS9598ms；Effect历史读取已不占此前热点，剩余People Evidence/Perception/Arca workspace等周期读取仍有成本。Inspector已关闭；候选正常停止ExitCode0。
- 新增仅Admin构建资产传输的有界读取：保留插件生成的精确现有asset路由，仅JS/CSS委托原sendFile使用512KiB highWaterMark，减少多个文件读取回调反复等待Owner同步工作的放大。未引入业务缓存、全文件无界缓冲、Schema/Owner边界或UI资产字节变更；Range/HEAD/ETag/路径限制仍由原sendFile处理。
- 新增真实Fastify测试验证503927字节完整相等、512KiB上界、Range、HEAD、304、未知路径/目录穿越拒绝和index no-store通过。新完整Service、最终镜像与多轮Host资格尚待，不把静态测试计为正式提速。

### 2026-10-16 bfd97f36a 最终修复、多轮资格及生产发布

本轮按用户要求在原 Owner 内修复，并在完整副本反复验证改善、历史保护与使用后回退后发布；不等于 UAT-318 全部达标。

- 实现提交：b84f36509a（单次 Binding 准备 scope、Libra 单次概览读取复用、Arca 健康分页及完成后 cadence）、ffa85c9a6（Effect intent/current-effect Marker 精确读取）、aa8c76bd7（Admin JS/CSS 512KiB 有界传输）、bfd97f36a（Docker/Windows 显式运行包纳入新 helper）。Arca 上下文仍由 Arca 持有，仅同步准备内复用；下次 Event/重试重新读取。Foundation 不保存业务事实，无跨 Event 全局缓存、Schema 迁移或 digest/CAS/基数校验弱化。
- aa8 镜像首次 Linux 138 pass/1 fail，发现 Docker 显式 COPY 漏掉新 helper；未启动或部署该镜像。bfd 同时修正 Docker 与 Windows 包清单后，实际最终镜像 Linux 139/139 通过。失败记录保留，不能只引用本机通过结果。
- Windows 完整 Service 647 pass/29既有 skip/0 fail；实际 Windows 独立包的 Node/Native SQLite/Host、JS 完整字节及 Range 通过。最终镜像 2357 运行文件逐一匹配 source，aggregate `d48ce5a3bbd922ccde77987a9adb2c2dbb1c76f6e66af02cb850301b0229cfdb`；OCI revision 标签继承底层 FFmpeg，不能作为 ShelfDeck source。两份 UI 构建资产字节保持，未改 UI/展示文案，不冒充新浏览器首开验收。
- 同一冻结完整副本、相同 2 CPU/3GiB/Node heap 2GiB、正常 Owner 周期且不并行运行多个完整 Host：原版10轮与最终候选20轮，API 中位660→250ms、P95 3789→1431ms；JS中位30838→491ms、P95 35037→5355ms，超时3/10→0/20，最终100 API成功且20份503927字节JS hash全相等。原版超时按预算记入分位数。最终仍有7.81s尾部与2/20概览 stale（33.32/40.14s），原版1/10 stale；不宣称新鲜度比例改善或1秒目标达标。相同冻结输入不代表运行推进锁步，生产仍共享NAS资源，不夸大为完全隔离负载实验。
- 最终候选完整 Host 约480秒 ready，正常停止 ExitCode0；61不可变表705991旧行、所有原Effect意图、567收藏和两季精确Run保护通过。旧3c镜像使用候选运行后的数据启动约449秒，正常Owner周期与停止ExitCode0；61表720380候选历史行及Effect/收藏/两季Run保持。只读隔离介质导致的EROFS/ENOENT/物理指纹错误单独记录，不视为生产媒体E2E成功。
- 最终生产 Docker `markmahoro/shelfdeck:bfd97f36a`，source `bfd97f36a7c0913c22403add226abf48218cd40b`；NAS config `sha256:e5cdaef4bf929fbf7d17a2f3cc4cc5a404481bd4d424c70f1ce2862fe5183ed5`；本机OCI `sha256:67415a640b4be141c459fcee88b3c9d0040bc22bd368ad06adf690a19b64289f`；tar SHA256 `995ff4a7554274bb3026b3859c1727f0a66c24f29797268e1c8f965eea69623e`。标准build-image/upload-nas-image/deploy-nas dry-run/checksum/readiness/apply通过。
- 最新冷备UTC05:23:54.851，62文件aggregate `545f3462b862bd483e31e113c9ce2c8ae3561b47e9bf348c3d6d16cf4450e4b4`，目录 `/vol1/1000/docker/shelfdeck/backups/uat318-release-20261016T035155-b84f36509a/cold`，含568收藏；目录沿用首候选名称，不代表部署b84。旧生产Stop后SIGTERM checkpoint 60秒超时、ExitCode1/P4_SHUTDOWN_CHECKPOINT_TIMEOUT如实保留，未伪造终态或Reset。
- 新容器 `515d60b240ff5b6e6ee84a54b87c5e28a8efc5af07667bbf845408ff6b9331a3`，StartedAt `2026-10-16T05:27:40.09005934Z`。Resume初始HTTP25秒超时，通过持久receipt观察同一操作约130秒完成，未重复提交。UTC05:33:06.511完成，05:37复核running/health ok/normalSupplyAllowed=true、RestartCount0、无fatal/OOM。挂载、QSV、adult双别名、13个无关容器和fnOS保持。UAT-321告警在05:32:09–05:32:42出现133次，恢复后消退，仍未修复。
- **生产环境上线后独立10轮**（每轮间隔10秒，无Profiler）：50 API全200；JS10/10完整且hash一致，322–1977ms，中位883ms，无超时。概览API中位89ms/最大656ms，但4/10为stale、age31.958–42.251秒，另6轮ready。API响应快不等于投影新鲜，生产与上述隔离副本分开报告；本次不宣称概览问题解决、整页1秒SLO或整季媒体E2E通过。
- 原始私有证据在忽略目录 `.codex/uat318-static-20261016/`，含canonical-image、Linux/Windows包、candidate/candidate-steady/production-steady性能、performance-qualification、history、cold、apply及receipt；前两候选证据保留于fix/effects目录。未执行生产Reset、直接编辑业务数据、迁移或人工媒体处置。UAT-318与UAT-321保持开放。
- 上线后数据核验补充：最新冷备61不可变表706253旧行逐行保持，所有Effect意图与既有终态执行记录保持，568收藏及两条精确Run保持。两季Subject/Workspace/根记录及物理inode、data目录inode通过。59伴随文件中57份内容与身份均相同；operator-runtime/intent.json按正式Stop/Resume更新，另一个Aftercare `.tmp.normalized-video.ts` 内容变化但inode保持。UTC05:39:41确认FFmpeg PID1842正引用该精确producer临时路径，mtime05:39:39；属于正常运行输出，不声称全部伴随文件字节不变或完整媒体E2E已结束。5个本次已停止且ExitCode0的演练容器经精确ID核验移除，保留全部备份/演练数据与回退镜像，生产容器未改动。

### 2026-10-16 发布后回到 UAT-318 的只读定位

- 用户澄清资源等待不作为整机卡死问题，本轮回到概览新鲜度与剩余响应长尾；未重启、修改生产数据或部署新代码。
- bfd生产两轮各约12秒CPU采样均完成Inspector关闭核验：event-loop max 2254/2096ms；采样期间JS完整4183/3041ms。这是有Profiler干扰的诊断样本，不能混入前述无Profiler10轮验收结果。热点分别包含Perception candidate anchors全量检索/别名匹配、Arca health输入、Aftercare Workspace生命周期重复历史读取、Formation评分目标组装及Outbox历史扫描。
- 同冻结完整副本567收藏，以当前bfd只读查询连续三轮计算collection overview：2884/1449/1597ms，完整输出digest均为`020fd97fd6846fd5ef1b41e165f3e737ec10ba6d37a444d7e2facc29da3bf782`。每轮57页，18890条Assessment历史、2436条Finding；现有按当前Inventory revision分组使三类Inventory输入分别有431/436/436次SQL调用。没有省略历史或修改健康判断；此为隔离查询成本，不是生产完整概览重建时间。
- 代码与现场时序支持的待验证判断：collection每10项让出事件循环；57次让出与其他Owner同步周期交错，会放大重建墙钟时间。生产05:48:17.198开始的概览在05:48:37.688请求时仍未替换旧快照，05:48:40.807已可见、年龄约23秒；随后再次超过30秒stale。因此HTTP返回快与新快照及时产出是两项指标，不能把generatedAt改为发布时刻或放宽stale阈值掩盖延迟。
- 下一步优化优先保留Owner合同：缩减Perception/Workspace/Outbox不必要的同步历史读取，评估概览按实际计算预算让出而非固定小批次产生的大量等待；所有方案必须证明完整结果、候选集合、恢复/回收fence与新鲜度不变，再做同规模正常Owner周期多轮验证。当前仅完成定位，没有新增产品修复或性能达标结论。私有采样与只读副本计时保留在`.codex/uat318-overview-20261016/`。

### 2026-10-16 概览刷新后续修复候选（验证中）

- 用户要求继续保持架构边界与数据正确性，多轮确认概览刷新和响应改善后再部署；当前生产仍bfd97f36a。
- Outbox按原pending/failed资格在SQL读取层限定，保留retry时间、启动Retry Intent恢复、consumer筛选、digest与ACK语义；不修改投递状态或历史记录，原无显式排序的读取不提供FIFO合同。
- Arca定期Workspace生命周期检查先读取Case/Registry当前head，活动、已回收或保留期内状态不展开历史；真正回收仍走原完整审计、未决Effect/引用/producer/物理身份及双次观察围栏，不引入跨调用缓存或兼容逻辑。
- collection overview仍每页最多10个完整health输入，以50ms计算预算或最多10页形成一个slice后让出事件循环。预算在页边界检查，单页自身仍可能超预算，不能宣称硬50ms延迟上界。聚合字段、分页顺序、真实generatedAt及30秒stale阈值保持。
- Windows完整Service647 pass/29既有skip，受影响44项通过，包括2000条已ACK历史不被物化、活动→终态重新审计/未决Effect阻止回收、4000收藏完整聚合与页/slice上限。NAS当前版本与候选的同完整副本正常周期对照、精确镜像、历史保护与使用后回退仍待验证；没有新增部署资格。
