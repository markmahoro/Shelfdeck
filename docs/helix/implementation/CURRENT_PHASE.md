# 当前 Phase：JAV 首版发布与用户验收

2026-10-16 UAT-318继续：ffa85c9a6第二候选概览10轮不再stale，但JS仍有27.53s长尾，未部署。保持Effect精确读取修复，追加Admin构建JS/CSS有界512KiB传输，原sendFile语义及UI字节保持；不缓存业务事实，不放松Owner/恢复规则。继续完整回归、精确镜像、完整副本多轮/历史保护和使用后回退；全部沿原Evidence记录失败与资格。

2026-10-16 UAT-318候选b84f36509a未获部署资格：同完整快照旧/新各10轮证明API改善但JS仍1.67–28.40s、概览1/10 stale。567收藏概览与3目标五组投影等价，61表705,991不可变行/Effect意图/两条Run保持。两轮新profile发现Foundation恢复/完成Marker及Effect intent全历史读取，继续原Owner内精确条件查询修复，保持digest/冲突/恢复语义，后续验证和部署仍按用户条件执行。详见原UAT-318 Evidence，不新建活动计划。

2026-10-16 UAT-318继续修复：用户授权按多轮根因方案实施，在架构边界与数据正确性保持、多轮性能验证通过后标准部署。当前实现限于一次同步Binding准备的临时read scope（Arca持有上下文，Foundation不持有业务事实）、单次Libra概览读取复用、Arca健康10项分页及概览完成后5秒间隔；没有跨Event缓存、Schema/Fact迁移或UI字段变更。已有恢复/资源/维护172项及首批定向23项通过；完整Service、生产同规模完整Host对照/历史保护与发布资格仍待完成，不把局部性能试验视为允许部署的证据。560原收藏和两季精确Run/Workspace继续保护，无Reset授权扩大。

2026-10-16 UAT-318 本次读取修复已标准发布 `markmahoro/shelfdeck:3c3991fabe`。精确Linux236、最新完整一致副本候选及旧镜像使用后回退Host/正常Owner周期/不可变历史保护完成，冷备份及标准apply通过；错误低heap演练OOM、原进程checkpoint超时及隔离媒体失败均留证。正式Resume完成，health/running/供给正常、RestartCount0；560收藏及两季原Subject/Run/Workspace保持，无Reset。三轮15 API及3次完整JS通过，但JS仍20–25s、部分API超过1秒，UAT-318保持开放；启动公平投影时序问题新增UAT-321待修，不因供给恢复而关闭。继续使用原[Evidence](evidence/UAT-318_FORMATION_TAB_QUERY_PERFORMANCE_20261012.md#2026-10-16-本次读取修复发布资格)，不新建活动包；未重跑整季媒体生产E2E/Electron。

2026-10-16 UAT-318 再查10轮已完成：50 API无错、JS8/10未在30–35s完整传输、overview8/10 stale。当前Inventory健康读取漏掉的Representation/Material role历史展开已在Arca本地限定head/revision，三范围完整输出相同，双平台各63及静态门禁通过；完整交付Package反复重建新增为未修复热点，微调decode试验不宣称提速。生产身份/供给保持，无新构建或部署；继续原UAT及原[Evidence](evidence/UAT-318_FORMATION_TAB_QUERY_PERFORMANCE_20261012.md)，不另建活动包、不关闭首开/一秒资格。

2026-10-16 UAT-318 追加三轮调查沿用原包：People全量展开后分页的新问题已本地修复395560043，同快照完整输出等价、25项8152/13/8/7485ms，双平台People各52、Service645 pass/29既有skip及静态门禁通过。初版游标前页重扫已通过mandatory cursor修正；完整Unicode姓名搜索729–823ms仍记录。Outbox历史全量轮询与执行摘要完整输入canonical开销新增为未修复热点；生产仍dc7正常供给/RestartCount0，无新部署。People补丁尚未构建新产品镜像，4ba旧候选不包含本轮变更；全部首开/1秒SLO、后续资格及UAT关闭仍待实证，见原[Evidence追加](evidence/UAT-318_FORMATION_TAB_QUERY_PERFORMANCE_20261012.md)。

2026-10-16 UAT-318 独立调查承接既有 [Evidence](evidence/UAT-318_FORMATION_TAB_QUERY_PERFORMANCE_20261012.md)：dc7 静态传输超时复现，当前 profile/SQL explain 定位主线程竞争与 Owner 历史扫描。四处修复4ba8f04d9保持Owner/完整输出/恢复检查；Service645 pass/29既有skip、精确候选Linux79、31跨进程恢复及静态门禁通过；额外332文件全量包装主动中断，不计PASS。4ba候选标准构建及字节/SHA证明完成，未上传部署、新鲜完整副本Host资格未完成。同步媒体指纹、HTTP/浏览器长尾及1秒目标仍开放；不另建活动包、不关闭UAT。

2026-10-16 已按用户最新“跳过NAS演练 升级吧”完成生产标准部署：`markmahoro/shelfdeck:dc7dcddbaf`（source `dc7dcddbaf6714d56aaa453610f862914863578f`）。UTC18:25复核health ok、mode/desiredMode running、normalSupplyAllowed=true、faulted=false、RestartCount0；`/adult`与原`/adult_media`绑定同一宿主目录，QSV/13无关容器/fnOS保持。完整备份及204→210/203旧表2,236,865行逐行保护通过，560原收藏、原Commit、两季精确Run/Workspace保持，54伴随文件与data目录物理身份保持，无Reset/删媒体。二号5席/占1，3来源已有公平记录。新鲜NAS完整Host演练按用户明确决定跳过，非PASS。UAT-318/UAT-320仍开放：两季尚等待资源，首开/静态大文件传输仍超时；不宣称完整媒体E2E或1秒SLO。详见既有双车间公平与UAT-318 Evidence。

历史暂停快照（已被顶部新授权及实际部署覆盖）：双车间/公平具体版本UI已接受，原聊天将性能修复及adult绑定整合为dc7dcddbaf候选并完成标准build/upload与源码/资产校验。用户选择暂不NAS完整副本演练；本机不能保留原CIFS/Workspace物理namespace，完整新鲜副本Host资格及生产发布暂缓，不以原历史结构副本或临时介质Host代替。生产保持037；安全停机收口后原供给已恢复，UTC17:15 health/running/normalSupplyAllowed通过、容器身份及两季原Run保持。UAT-318/UAT-320仍按各自Evidence开放，不因实现交付关闭。

2026-10-15 新合同已获用户确认：Series 按 Subject 整体转入二号；允许 Foundation 最小通用只读分页执行摘要。继续实现与资格验证；不修改 Foundation 调度/执行语义、不接管原聊天 Arca/Perception 性能路径。

## LIBRA-ATTENTION-WORKSHOP / LIBRA-SOURCE-FAIRNESS（2026-10-15）

状态：已随dc7dcddbaf部署，具体实现1f36d9ed8的UI负责人8/8接受；新鲜生产结构副本/原行保护已完成，NAS完整Host演练用户明确跳过。生产二号5席/占1、3来源有公平记录；两个目标的持续用户体验仍各自验收，不以短观察替代长期均匀推进证明。

源码核对及精确接口缺口见[审查 Evidence](evidence/LIBRA_WORKSHOP_FAIRNESS_INTERFACE_AUDIT_20261015.md)。

2026-10-16 本地：Service 645 pass/29 既有 skip，Web190、宽窄 Playwright4、Linux核心36及真实二号Host1通过；Windows二号重启恢复1、三来源真实长转码1已分别通过。204→210结构Operator及3.13 GB/203表/2,138,297行完整结构副本通过，源字节不变；历史副本不含受保护S02/S03，不替代新鲜生产副本资格。机器合同121/104/210/51、149 routes。最终Windows Host组合2/2、独立Service包1及route/TMDB21复验通过；具体实现1f36d9ed8已获UI负责人8项独立浏览器检查接受；上述为本地交付时点；当前生产已部署，完整Host演练skip与真实保护结果以顶部及Evidence最新记录为准。

独立 UAT-320 readiness 修复已本地实现：后台68项、Web12项及受控宽/窄浏览器2项通过，构建通过；具体版本 UI 负责人审核已随1f36d9ed8完成，展示已随dc7dcddbaf发布，整季用户验收仍开放。证据见既有 UAT-320 Evidence，独立修复原切片不等同双车间/公平验收。

- 已确认容量：全 Libra 二号共用默认 5 席，配置 0–32；0 只停止转入，缩容不驱逐；一号每来源原 0–8/默认3及 Procurement→Libra 门禁保持。用户解决后留在二号至 Handoff B 或合法责任终结，不回一号、不重新 Intake、不重复 Run；维护/Arca 席位独立。
- 已确认公平：Libra 先按来源再按 Run；相同 priorityClass 内 localPriority/priorityRevision，保留用户加急、安全/交接/收口和 aging；新 Work、已排队 Event、资源等待队列均覆盖；阻塞跳过、恢复有限补偿、长执行开始交棒、不抢占；无变化轮询/提交/失败资源请求不记推进。
- 用户已确认：Subject 整体转入；允许最小通用只读执行摘要；另行允许现有 updateWaiterPriority 按更高 revision 刷新已存在 durable deferred 的元数据。Libra 决定来源公平；Foundation 不新增来源策略、不增队列、不发额外 Permit。
- 合同落点：SSOT §6.4.9、§7.2.4、§8.5.11 token责任、§9 Admin 配置；需要处理统一规则要覆盖身份、业务冻结、配置与执行异常，不能仅监听 identity。转区需持久位置/revision/原因及事务容量判断；执行中安全收口，不硬杀、不伪造终态；重启重建与重复转入幂等。
- UI旅程：工作区沿用“整理中/需要处理”与就地解决动作，恢复后真实状态刷新；设置提供二号容量控件与占用数量，缩容不驱逐。后端/前端均变化时须具体版本 UI 负责人验收；1f36d9ed8已获负责人8项浏览器检查接受，详见审查Evidence。
- 验收：二号满背压/空位原子转入/并发与回滚/0与缩容/批量恢复/合法终结及Season责任/重启；三来源真实推进、Run数不均、阻塞恢复、长转码、用户加急、已有资源等待队列刷新、aging和收口；平台验证按影响范围；真实Host旅程不能被排序单测替代。
- 相关缺陷：沿用已登记 [UAT-320](evidence/UAT-320_SERIES_ROUTING_READINESS_20261015.md)，统一 readiness/attention 覆盖无 Routing Decision 的缺配置态，并提供可达配置动作；不新建重复 UAT。原聊天已通过正式策略发布解除 S02/S03 原停滞点，不代表整季完成或本缺陷关闭。
- 边界：/adult 部署绑定、生产剧集配置修复及 UAT-318 首开性能由原聊天处理；本聊天不部署生产、不停机/Reset/媒体处置。后续升级须保留 UAT-320 Evidence 列明的 S02/S03 两个精确 Subject、Run 及新增事实，不能默认清场或沿用旧 Reset 授权；若 schema 变化影响其连续性，先完成该精确范围的副本资格，不扩为通用历史兼容。初始 git status 干净，沿用共享 checkout，保留其他聊天修改。


2026-10-15 JAV首版已完成本轮发布资格并标准部署生产：markmahoro/shelfdeck:037592bef4，source 037592bef4441ceda87b3270f6e70cb7857da3a7。11:46:57 UTC复核mode=running、normalSupplyAllowed=true、faulted=false；556条原收藏和原入藏Receipt保持，已观察11条新Libra执行成功。机器合同121/104/204/51、147 routes。完整生产副本200→204/199旧表逐行保护、真实完整Host正常供给/33协调器推进、停止及使用后回退拒绝通过；生产按授权清理6个未结束Subject与精确discarded旧记录，86表范围外保护及49个伴随文件物理身份保持。最终UI变更经负责人宽/窄两项接受，其余继承原接受；Web186、Service642 pass/29既有skip与Linux20条业务的精确backend字节继承范围明确，最终实际镜像Native/API/源码/资产及Windows独立Service包复核通过。生产五挂载/QSV、fnOS及13个无关容器保持。具体原始失败/观察超时、Annex、备份及回退限制见现有JAV_RELEASE_COPY Evidence；不追认为每站长期可用、整季生产E2E或Electron资格，不批量关闭既有UAT。以下较早段落为历史快照，不覆盖当前授权与事实。

2026-10-15 用户明确授权三步推进：另开聊天排查生产任务长期停滞并修复，合并修复后用生产完整副本演练升级/回退，演练通过后标准部署生产。诊断聊天01a13ebb-f373-7670-a207-64797e8c7c31已建立；主聊天统一控制安全停机、备份、精确清场及发布，诊断期间保持生产只读。必要生产停机/标准部署不再以旧“未授权”文字阻塞；Reset仍需冻结可审查范围并通过原保护门禁，不能清掉未决非pure Effects或已入藏事实。

2026-10-15 JAV-RELEASE-CANDIDATE：最终本地候选 markmahoro/shelfdeck:455873b377 已通过标准构建、导出及独立SHA256校验；实际该镜像Linux JAV核心6/终态恢复8/Movie3/Series3共20条选择场景全部通过。固定锁定依赖FFprobe解决HEVC色彩漏读；备份改为有界完整hash，镜像384MiB容器内P13六项通过。当前Windows独立Service包203表/147路由、包内Native/API及256MiB备份恢复/篡改拒绝通过。2318份Service源码及已接受1qAJmlnq UI字节一致，继承具体版本适用UI接受。P2 121/104/203/51与既有完整整合/精确计数复验的组合证据保持，不宣称重跑过一次全绿整合。剩余部署准备为生产完整一致副本、6 active Libra及20未决Arca settlement-delete Effects的明确收口与实际规模升级/回退资格；4 running Work仍须核验。NAS临时隔离Linux仍按用户决定skip，没有上传、部署、停服、Reset或改生产数据。下一步须先取得仅限原容器停机备份后原样重启的精确授权。详见现有JAV_RELEASE_COPY/JAV_CORRECTION_RECOVERY证据。


### 历史窗口方案（已由后续精确授权及本轮实际发布取代）

用户提醒升级过程可复用既有安全停机与Reset：先用已上线安全停机命令关闭供给，等待mode=stopped、in-flight为0及后台收口；不能以直接docker stop/超时硬杀替代该证明。记下原desiredMode，备份后原镜像启动仍须按原Operational合同明确恢复运行，不假设容器重启会清除stopped意图。Reset先在完整本地副本内按冻结精确Subject范围预检/演练；实际生产Reset另以当次清单、后果与明确授权为准。只读现有工具确认六个active Run对应Subject逐项scoped plan均ready；默认用户Reset则因额外历史重叠及未决Effect拒绝。20项Arca未决Effect不因此可清除，不能扩大Reset或删除已入藏责任。

仅针对192.168.12.230现有shelfdeck容器及其原数据/部署配置，保持原image 0dbd762d2：现场核验容器身份、挂载、配置位置及本地私有备份目的目录；允许正常checkpoint的停机窗口（预留75秒grace），原容器停止后流式取得完整data及私密配置备份，确认传输完成/文件清单与hash后原样重启同一容器并检查健康。离线副本完整性/200表结构和旧责任分析在隔离路径执行；失败时优先原样恢复原服务并保留失败证据。预计停机包含约3.17GB数据传输，时长取决于现场吞吐，不承诺固定分钟数。

该窗口不包含新版镜像应用、Reset、取消旧任务、改Effect状态、删源或媒体，也不包含NAS临时Linux测试容器。运行配置/Secret仅保存于私有ignored位置，不进入日志/文档/提交；先清点外部Workspace/Media绑定，data备份不冒充全部媒体备份。冷副本不自动解除6 active Libra/20未决Arca Effect的升级阻断；取得副本后只读确定逐项责任与可审查收口方案，任何生产数据处置另按明确范围授权。标准发布仍须完整副本/回退验证、checksum/dry-run以及用户明确部署授权。

2026-10-15 JAV-WORKBENCH-RECOVERY：恢复Intent已原子保存完整Receipt/执行Snapshot/文件现场Observation并追加不可变历史；当前指针不覆盖旧证据。实际Host的Source失败恢复、资料已成功而NFO写入失败恢复均完成同一Correction及清理（2 pass），后一条验证站点选填资料变化不会重写冻结Source Result，原失败Work、视频与原On-deck保持。已接入有界只读现场Preparation；发布/提交后清理的终态恢复、producer temporary及反复恢复后取消、公开API/工作区继续动作和最终版本资格尚未闭合，不宣称恢复功能或生产部署就绪。详见既有JAV_CORRECTION_RECOVERY证据。

2026-10-15 JAV-WORKBENCH-RECOVERY进展：工作区承载切片通过Web177/宽窄Playwright10/实际Host1，真实Foundation过程与取消操作分离；后续继续正式Recovery Intent及新Work/Effect、提交前/后恢复与现场冲突保护，再做受影响最终整合和新具体版本UI。详见JAV_SOURCE_HOST新增切片记录；旧等待用户确认的文字保留为历史，非当前阻塞。

2026-10-15 JAV-WORKBENCH-RECOVERY（实施中）：用户已确认独立Correction链路与统一维护任务视图、同任务有界Recovery Intent；下方“恢复合同待用户确认”历史记录被本决定覆盖。SSOT必要条款已更新。验收需覆盖受理即入列表、分页/筛选/计数/精确定位、详情只读/交互区动作、取消及提交前/后终态恢复、重启/重放/并发/未知冲突保护和新具体版本UI。完成前不声称已有恢复入口。

2026-10-15 当前决定覆盖下方历史等待记录：用户要求跳过NAS临时隔离容器Linux测试，取消该执行项及其授权等待，prepared worker不执行；不将skip改写为平台PASS或推导其他生产授权。终态失败恢复Intent尚处方案讨论，具体版本UI审核及生产一致副本资格继续。完整Linux支持/发布风险须按实际未测范围表达。

2026-10-15 JAV-CURRENT-INPUT-QUALIFICATION：当前321文件整合2692/12/0且全输入一致，验证进程全部收口。已授权独立本地实现/资格工作到此已完成可推进部分；Linux临时容器尚未获准、终态恢复Intent仍未确认。具体版本UI材料已获用户授权并发送，负责人聊天已开始审核，结论待收取；生产6 active Libra/20未决Effect等仍不具一致升级副本资格。保持这些门禁，不以重复测试或生产Reset替代用户决定；完整目标未达成。

2026-10-15 JAV-REAL-SCALE-KERNEL：真实3.133 GB源库只读结构/FK/完整性/历史消息/Control检查已通过、结束JS堆约16.9 MB；此前仅合成138 MB的规模证据已补强。此项不代替实际升级副本、Candidate Host/媒体保护或Linux业务写入旅程。当前Source/Web输入冻结的整合仍运行；等待中的Linux/恢复合同/负责人发送授权不视作同意。

2026-10-15 JAV-PRODUCTION-HISTORY-READONLY：从declared摘要推进到七Catalog实际分层样本，156/156按各自既有方法通过，未新增兼容/退役规则或执行Owner IO。最新生产556收藏，仍有6 active Libra、2 running Work、20 reconcile_required Effect；完整一致副本资格未成立，不能用有界样本关闭。继续在授权范围内准备发布，Linux/Recovery Intent/具体版本负责人等决定保持待确认。

2026-10-15 JAV-REAL-CORRECTION-UI：宽/窄真实浏览器入藏后保留视频纠正至cleanup completed已通过；321文件架构测试2692/12/0，完整输入守卫如实拒绝两Web变化，backend Annex同摘要。当前UI改动由对应构建/Web/浏览器资格承接。下一步继续发布准备的真实历史Catalog/副本及待用户决定的Linux/Recovery Intent，不为未完成生产责任增加兼容或擅自Reset；具体版本负责人门禁保持。

2026-10-15 JAV-REAL-SERVICE-UI：已完成当前CSS/JS构建下真实浏览器确认至入藏的宽/窄两条旅程；真实长路径溢出已按grid/content约束修复，Web175/Playwright10及实际Host2通过。冻结架构输入的backend未变、两Web文件变化仍由严格守卫记录，当前UI适用证据独立承接；下一步收取该轮真实结果、继续Linux/恢复合同及副本/负责人门禁，不重复Desktop或生产动作。

2026-10-15 JAV-SERIES-RECOVERY-QUALIFICATION：三条显式Series真实进程恢复已通过；初轮架构唯一Series失败在当前JAV范围围栏下复验（组合113 pass），321文件初轮失败记录保持。下一步收取冻结输入的新整合，并在用户允许NAS临时容器后执行已准备Linux worker；不把旧镜像依赖测试等同候选镜像构建或生产升级。恢复Intent/真实副本/具体版本UI继续独立门禁。

2026-10-15 JAV-OPERATIONS-QUALIFICATION：实际入藏后的公开Off-deck与非空Shelf注销各1 pass，精确范围/历史事实/无关文件及Control验证通过；既有Movie三条实际媒体验证无skip。下一步收取已运行的Series维护/外部转码/退出进程恢复和319文件整合，再推进剩余发布资格；合法preparing Review按正常后台等待，未改产品状态机或授权。

2026-10-15 JAV-AFTERCARE-FANART：按当前JAV Standard补齐独立背景图检测、同站uncropped派生、明确类型Receipt及精确退役；修复fanart误退役poster，保留其他Artifact与收藏身份。5条正常/纠正后/源失效Host、最新102相关回归、Service641 pass/29 skip/0 fail通过；Movie/Series及非要求fanart的JAV不新增义务。P2更新b9eae8313bce1eb107eef441546b36efe1a813070c906adbfb0fab6d4529307b、计数121/104/202/50不变。下一步收取319文件架构整合（早于最后范围收窄，不能单独证明最终版），再继续平台/真实副本/版本门禁。

2026-10-15 JAV-AFTERCARE-RECOVERY-CONDITIONS：修复JAV错用TMDB恢复条件，按当前accepted站点冻结语义配置摘要。41回归、实际失败→相关源配置变化→新Case修复/旧failed Effect保持通过；FC2官方/GETCHU两条维护Host通过并保留seller/circle。P2/边界/语义保持，恢复Intent与Linux选择仍待用户回复，不因本次普通维护新Case传播未确认的Correction恢复合同。继续其他Required Artifact/运营覆盖及最终整合、真实副本/具体版本资格；无Desktop/生产动作。

2026-10-15 JAV-AFTERCARE-POSTER：当前accepted单站海报维护、current config Handle及完整来源/crop/output证明已接。缺失NFO/海报、纠正后当前来源、失效源无写入failed Effect四条实际Host通过；压缩Metadata按唯一durable Source Result恢复并核验全Fact digest，原事实/视频/身份/Receipt保持。89相关回归/P2/边界/语义通过，合同计数与aggregate不变。继续维护恢复条件/其他类型、终态恢复决定、Linux环境及最终整合/负责人/真实副本资格；不扩Desktop或生产，旧318整合不覆盖此版。

2026-10-15 JAV-AFTERCARE-NFO：当前Canonical号/已接受Metadata/Cast的NFO重建、冲突身份处理及精确Custody缺失证明的admission前新检查已接通。真实Host修复→resolved并保留视频/Primary Control/身份/原Receipt、旧NFO Control释放且无新来源查询通过；JAV/Movie/Series及Case/Effect保护92通过，P2不变。原318文件整合2678 pass/12 skip/0 fail，但不覆盖随后NFO与部分Kernel改动。继续JAV封面维护接入、终态恢复决定、Linux环境选择及最终版本/真实副本资格；不扩Desktop或生产动作。

2026-10-15 JAV-RELEASE-MEMORY：隔离138 MB历史Outbox在64 MiB堆复现Snapshot检查OOM；Kernel改为逐条完整校验，相同样本通过且末尾损坏仍拒绝。Operator/Kernel/Outbox 22 pass，不改Owner/Schema/完整性检查。已有318文件整合早于这项改动，不能充作其完整最终版本证据。Linux环境修复/替代选择已询问；Recovery Intent仍待确认，未擅改环境或终态合同。真实生产规模副本/具体版本审核继续开放。

2026-10-15 JAV-CID-MANUAL：显式CID文件名不再猜成番号，真实Host待确认→公开预览→确认→唯一Commit通过；查询前零Provider请求/正式身份，原文件名hint和不可变Candidate保持，确认重放/锁号通过。普通/特殊番号及A/B模型6 pass，P2不变。自动CID映射仍缺实际来源Evidence；整合回归继续，Recovery Intent与完整平台/副本/版本验收保持开放。详见[JAV来源证据](evidence/JAV_SOURCE_HOST_20261015.md)。仅Service/Admin Web范围。

2026-10-15 JAV-FC2-FALLBACK：live FC2官方proxy和JavMenu direct各自同号/封面/固定资源通过，JavMenu proxy拒绝；路线分别冻结，不自动切route。Host 403及503三次重试后fallback两条通过，原failed Work/Attempt不删除，最终资料同JavMenu、不补首站字段，无重复加工/入藏。已知连接Probe上游错误现进入既有Platform错误合同，不发布Proof/保存配置；后端32与相关Web7通过。只修改adapter错误翻译与测试，不改身份/Owner/事务/机器计数。Recovery Intent、CID、完整平台/副本/版本验收仍开放。

2026-10-15 JAV-INTEGRATION / NAS-SCALE：当前318文件部分整合2687项初轮有5个旧route计数失败，相关5文件修正后45 pass/2 skip；其他通过及长JAV Host证据独立保留，尚无此版完整P3结论。只读生产规模553收藏/约3.1 GB及active Run/未决Effect已核实，source200结构符合冻结源但copy资格未成立；没有导出生产库或调整旧责任。7 Catalog只有declared coverage，需真实副本完整proof。Linux memory components通过不代表文件Effect/Docker qualified。当前恢复方案待明确回复，不改终态合同；独立代码/回归及发布准备按这些真实限制继续。

2026-10-15 JAV-WINDOWS-PACKAGE / RECOVERY-DESIGN-GATE：新增实际独立Windows包验证及overwrite/nested/alias负例通过，Service670（641/29/0）与Foundation56通过。Windows包只携带clean runtime与必要tools，不复接历史入口。待确认的恢复方案由Arca冻结原failed Work/Event/Effect/Source Result/File Plan及当前Basis/reality，显式用户Intent创建独立恢复Work/Effect；保留旧terminal历史、原Entry/视频与门禁，同范围核验/收尾才完成，未知冲突文件不自动覆盖或删除。此方案尚未获用户回复，未写入Canonical SSOT或实现其typed合同；现有非终态恢复保持。具体证据见恢复/分发Evidence，Linux、混合规模及负责人/发布门禁仍开放。

2026-10-15 JAV-CANCEL-UI：attention状态明确展示已确认旧号→新号；只有Arca actual no-effect校验通过才有后果勾选/取消按钮。真正cancelled后显示重新查询，重新预览/确认，不复用旧授权。174 Web、最终11项相关复验、当前build的宽/窄屏10条浏览器流程、2条实际Host与21项后端/合同组合通过；final JS be48d04168d3079b3efe301e5a584a8a199dfa1857a40f486f103634c8012abc。已查看最终走查状态对应截图，键盘/axe/可视范围无新问题。跨层具体版本负责人尚未审核，有副作用恢复与其余全量/平台/发布资格继续，不关闭整个JAV工作项。

2026-10-15 JAV-CANCEL：专用 No Effect Cancel transaction #50、Arca Cancellation Receipt/Command replay/CAS及Admin endpoint已经落地；实际Host晚期提交失败整体回滚、纯资料失败取消、新预览/确认至cleanup completed及写入冲突取消拒绝通过。50事务通用crash suite exit0；当前121/104/202/50、Arca app26、145 routes、aggregate b61d66725c9f5145a08fc7b4a71915ae4f138d9a951f24c2d8eee3501870712d，DDL未变。后端完成不代表UI入口完成：继续操作资格Projection、取消确认/结果/重新查询控件与原文件Effect范围恢复，再完成全量/平台/发布资格；无Desktop/生产动作。

2026-10-15 JAV-P3/NO-EFFECT：最终全架构/P3 聚合已收取 exit0（317 fixture files、202 tables、49 transactions）；当前两份新增 no-effect 源码位于此聚合之后。有界只读执行证明与模型负例组合 10 pass；拒绝所有 write attempt、Effect、登记输出、额外 Work、Scope/Basis 漂移，保持 attention 门禁。待接专用 atomic cancellation、API/UI 和有文件副作用恢复；不把内部 Observation 视为终态 Receipt 或已完成用户入口。

2026-10-15 JAV-RELEASE-SERIES/ROLLBACK：真实旧发布两集 HEVC Season→独立202结构/完整runtime副本→旧会话/Collection/公开resume/31秒正常周期通过；原Entry/Canonical/唯一Commit/媒体与源库保持。Movie/Series无新事实候选均创建并核验完整backup、恢复到新空目录，用旧Host恢复运行；已经有新事实的新副本拒绝回退且未恢复覆盖。原最终全架构/P3进程继续运行，不因观察超时重启。下一步纠正attention的明确用户操作/取消与恢复范围，随后Linux、混合规模及UI资格；Docker Desktop socket故障未通过Reset/配置处置绕过，生产和用户材料保持。

2026-10-15 JAV-RELEASE-COPY：离线结构副本/回退资格 Operator 和只读 Kernel snapshot 验证、精确上一发布终态档案及完整 typed Result Evidence 模式已完成本地实现。8 Operator/6 Kernel、17 P2组合、46运行组合、69历史证明和最终101组合通过。上一发布真实 Movie 完整副本经当前 Host/旧会话/公开 resume/31秒周期保持收藏身份、唯一原入藏 Receipt、源库及媒体字节；人物合法关联刷新 Inventory2。全架构初轮24失败的过期计数/不完整身份 fixture/重复 Retry revision已修正，235项复验无失败；最终全架构/P3运行中。下一切片继续 Series 真实旧数据保护、无新事实回退窗口及新增事实拒绝、错误恢复交互、Linux及精确版本UI资格；未部署。见 [证据](evidence/JAV_RELEASE_COPY_20261015.md)。

2026-10-15 JAV-SOURCE-HOST：13 个类型/主备正式 Host 及 2 个未确认身份公开人工选择旅程通过；同站可选署名角色、Artifact/唯一入藏及原失败 Evidence 保持。真实联网 15 个样本三步资格通过，FC2 两次 proxy unavailable，T38 的 JavDB 优先规则与实测一致；CID 不关闭。专用资源 key 重验和运行控制路由生成缺陷已修复，42 项相关回归及 Service 670 项（641 pass/29 skipped/0 fail）通过。121/104/202/49 和严格 P2 闭合，aggregate `c5b16223e6a5b4743e7f2a558e1a88333bdb1b0d6fe82caf2da6a046c249b454`。全架构/P3 检查运行中；下一切片闭合异常交互和完整副本升级/回退资格，不改旧 marker、不提供未完成 Formation 兼容、不操作生产。详情见 [证据](evidence/JAV_SOURCE_HOST_20261015.md)。

2026-10-15 JAV-CORRECTION-DIRECTORY-RUNTIME：独立目录责任→空目录自动回收/非空精确确认→公开当前回收事实/恢复已接，真实Host最终两条旅程通过并保留原视频/唯一入藏；原On-deck目录责任保持独立。已接注册Owner scoped通知及周期公平、stop等待，6新IO/DAO、原15回收、8Runner、58相关/32启动、37Series与21P2/DDL/Movie组合通过。Web170、构建及桌面/窄屏4条最终目录/纠正走查通过，负责人版本验收继续开放。121/104/202/49，aggregate97b14fc6f567b9f0ba6c41735807b8852d6e5773475b8697a089d38348e1dc1f。继续其余异常/类别来源正式旅程及全发布资格；无生产、用户测试材料或Desktop动作。

JAV目录交互：系统设置的回收区分别展示原上架与身份纠正的目录责任，以真实等待/受保护/已回收状态引导；“检查这部影片的具体清单”打开既有精确预览，逐目录确认完整清单才归档。回收记录提供恢复，不以阅读详情、刷新或点击检查代替授权；错误及两类分页各自就地表达。

2026-10-15 JAV-CORRECTION-DIRECTORY：旧目录 closed Scope及真实cleanup/context证明、独立检查Table/与cleanup完成原子种子/CAS存储已实现。真实Host冷读、未知文件保留和Store负例、seed INSERT后实际退出回滚及COMMIT后重启承接通过。121/104/202/49，Arca app25，aggregate48ac04ac733509853ec65a4290271c12dcd94600435de4b6bf42a16c078fcbe8。下一步接Arca目录后台及公开回收交互，继续剩余功能与发布资格；此切片不等于旧目录自动收尾已完成。Desktop按SSOT §10.9.1及用户本轮纠偏不进入JAV开发；先前“转向clean Desktop验证”的计划判断撤回，不复接历史API，既有旧测试失败记录保留。

2026-10-15 补充：持久 SQLite 候选装配/Resolver 的旧身份与其他 direct 目标隔离测试已通过；Perception/Movie组合37项通过。Desktop build 通过，但现存旧集成 harness 不能启动 clean server，40项未执行，不能以 build 关闭 Desktop 资格。下一步保留这项真实失败并转向 clean Desktop 验证、异常/旧目录及其他发布资格。

2026-10-15 JAV-DIRECT-WATCHED：独立 direct 已看记录/修订/撤回、严格重放、独立 Resolution、只读 Projection、收藏交互和日志已实现。真实 Host true/false/clear/重启及评分独立性、两条 JAV Entry/accepted Subject 纠正旅程、168 项 Web 测试与桌面/窄屏走查通过。合同仍121/104/201/49，aggregate43c7a841c98d1545fe4036e6c2f8a22d66933bb50a8681c3825f6f6cafdf9f94。下一步补持久旧身份/其他 Entry 隔离、异常/旧目录，再闭合正式类型来源及平台/UI/升级回退资格。Docker Secrets Engine socket 故障使 Linux qualification 开放；未修复全局引擎或操作生产，缺段不设门禁。

2026-10-15 JAV-PERCEPTION-CONTINUITY：公开Libra accepted origin→Arca持久Commit/Correction连续性→Perception scoped query/Rule4已实现。Entry/accepted Subject直接评分真实Host纠正后及Subject重启查询通过，历史Record保持；范围隔离、冲突、撤销、watched Resolver等8项单元及28/32项相关组合通过。普通Movie规则不改。121/104/201/49、aggregate24549d1b6bfc6ba091e9c0c302077d24fd7076d2b79e5331f22e50299ae08d2a。下一步直接已看创建/修正合同、独立fact lineage及API/UI和真实旅程；还需持久级旧身份/其他Entry隔离、异常/旧目录和全部发布资格。无生产动作。

2026-10-15 JAV-CORRECTION-CLEANUP-COMMIT：专用完成事务/Receipt及门禁释放已实现；正常、实际事务内/COMMIT后退出、Entry评分、新演员接受/Inventory3后历史Receipt等真实Host证据通过，26项合同/DDL/门禁及139项Foundation回归通过。原Identity/Inventory/Control/原On-deck Receipt不重写，正式技术IO继续由原Work/Permit承担；两种Foundation marker协议精确区分。121/104/201/49、domain123/type refs228、aggregatea677477cddc7f7b908c38d9cad78afda88cb53bc032b55ecfed7aab0bc8d0848。JAV-PERCEPTION剩余：现有POST /perception/records仅rating且directInput.watched=null，queryFor只构建本目标/provider/title Anchor；须由Perception补齐direct已看合同及精确accepted Subject连续性、外部/其他Entry隔离，不能由Arca复制Record或借共享旧身份。完整异常恢复、旧目录责任、媒体/平台/UI/发布资格继续开放，未部署生产。

2026-10-15 JAV-CORRECTION-WORKSPACE-WORK：独立Workspace回收Work/Effect/Receipt及登记状态原子事务已接Runtime；正常真实Host/重启与四个真实进程退出、事务回滚/重放、foreign冲突保持视频场景通过。143项Foundation/相关模型与28项DDL/物理回归、Catalog/P2/扫描通过。121/104/201/48、domain123/type refs228、aggregate00df625ecd5d6b4d20b36529cac69b856a1a266796b3250449f75b2f3cf0f5a2。下一步Owner专用cleanup完成事务释放门禁，再重验People/Perception及全部媒体、平台、UI/发布资格；不以临时回收成功宣称身份纠正流程总体完成。无生产动作。

2026-10-15 JAV-CORRECTION-WORKSPACE-RECLAIM：回收Plan/精确committed Registry查询/原成功Work准备/物理端口及8项新测试已完成；公开真实Host重启四Material/三Artifact只读预检、错误context/active入口/stale root拒绝通过，视频/唯一原Commit/网络请求保持。21项相关文件回归、21项P2/DDL/回收组合及边界扫描通过，合同120/103/201/47保持。下一步接独立回收Work/Effect/Registry与Artifact生命周期原子提交，再由专用cleanup完成事务释放门禁；当前cleanup仍active，未部署生产。A/B及单独A/B沿实际成员处理，不新增缺段门禁。

2026-10-15 JAV-CORRECTION-FORMAL-WORK：独立jav_correction_formal_retirement Supporting Work/Planner/Executor、material_commit leaf、资源映射与reality恢复已接自动Runtime。三个真实Host场景通过：公开正常→精确formal Receipt及重启不重复；实际退出在两个unlink后沿原Effect完成；残留alias被foreign替换时原Effect失败、cleanup attention门禁保持，已提交身份/视频/冲突不变。当前视频依实际Current Inventory Binding核验，旧位置退出不再误读为视频丢失；未重抓网站、不新增原On-deck Commit。Foundation Dispatcher修复await异步input/result semantic核验，并有晚期失败/未完成不发布成功的回归；未改变Owner权威。127项Foundation Runtime/Event/Startup、11项合同图、18项相关模型/Planner/Dispatcher及P2/边界扫描通过。120/103/201/47，Domain inputs122/type refs226，P2 aggregate1809881ae48fbc77e2b856ce4e741005f93473bb14e47a85d2b723d2de4ff186。formal Receipt只表达old/retained/stage收口，Workspace Registry/Artifact回收、专用cleanup完成事务/门禁释放、旧目录责任、People/Perception再验证及全部发布资格继续开放；当前正常纠正停在cleanup active等下一步，不宣称总体完成。无生产或用户测试材料动作。

2026-10-15 JAV-CORRECTION-CLEANUP-GATE：实际Identity Commit原子初始化独立cleanup_state=pending，committed身份/原Receipt保持。Entry/Shelf门禁及partial-unique持续覆盖pending/active/attention_required，缺状态观察不释放；另一纠正、普通维护/人物刷新、退出和相关Shelf操作被拒绝。本纠正的只读清理准备可在自己的committed cleanup gate内运行，不借active。completed要求closed Cleanup Receipt及digest，数据库拒绝无证据清门禁；专用完成事务尚未实现，没有通用状态完成接口。真实Owner提交/Off-deck拒绝和公开正常/重启重放两条Host通过；4项门禁、10项正式收口、10项DDL、3项P2及扫描通过。UI新增真实cleanupState，等待/需处理时不提供第二次查询；7项组件、构建及桌面/窄屏2条受控浏览器走查通过，负责人精确版本验收仍开放。自动正式清理Work/Effect/Receipt和Workspace回收未接，当前本地纠正后将保留清理门禁；人物后续关联需待此链闭合后重验，不继承旧版本通过。119/102/201/47、144routes，P2 aggregate 2316cba15fc01372d5623bc9ad9c133769c03ed148871eac24d8efbfe4612ebf。无生产操作。

2026-10-15 JAV-CORRECTION-COMMITTED-CONTEXT：Owner Inventory Commit已在同一原子事务保存closed ArcaJavCorrectionCommittedContext（≤4 MiB）：实际Work/Event/Attempt/idem、精确Receipt digest、完整File Plan及正式Staged Record。非committed必须全NULL，committed三联列齐备且固定Schema；4 MiB仅对该列精确登记，不放宽其他JSON。新增readCommitted与retirementPreparation沿actualResult/marker/历史Revision/Manifest恢复，不伪造active、不重新抓资料。原子回滚/提交后实际进程退出恢复、正常公开重放及引用篡改拒绝已有真实Host证据；独立重启后的只读预检已通过，未发生额外网络请求，原视频字节与唯一原On-deck Commit保持。23项P2/DDL/正式收口测试与package/semantic扫描通过，119/102/201/47、144routes保持，P2 aggregate e8a80dc542e815d17516791fa92c582f444700c8ce4f8bfaa0f9b55161386fe7。自动清理Supporting Work/Capability/Effect/Receipt、提交后竞争门禁、Workspace/旧目录责任与完整发布资格继续开放；无生产动作。

2026-10-14 JAV-CORRECTION-FORMAL-RETIREMENT：已增加 closed ArcaJavCorrectionFormalRetirementPlan（≤4 MiB）及本地物理端口；actual committed Receipt/terminal Evidence、当前 heads、完整 old/new Control、精确 Final/old/retained/stage 路径集合共同构成 guard。只退出已批准 rename 的旧 Binding及声明临时 link，保留当前视频完整字节/Identity，不改 Inventory、Control或历史 Commit。10 项新测试及7项原正式文件测试通过：路径重叠、不同inode的已验证copy、未知/错字节/foreign或reacquired材料、移除中断、head变化、范围扩张和缺失Owner观察拒绝。不同inode测试是同卷copy模拟，不能作为真实跨卷资格。真实Host的Owner原子提交fixture已按实际数据库/Control/Manifest构造并完成只读preflight；公开纠正正常/重启重放回归通过。尚未接入自动清理：正式Supporting Work/Capability/Effect/Receipt、提交后竞争门禁、真实清理进程丢失、旧目录责任及Workspace Registry/Artifact回收仍开放。当前119/102/201/47、144routes与P2 aggregate保持；package/semantic扫描通过。无生产或用户测试材料动作。

2026-10-14 JAV-CORRECTION-ADMIN：收藏交互区新增“核对影片”，通过 Arca 独立 GET 预览、POST 确认、GET 指定/最近纠正状态完成查询、新旧影片/完整路径预览、后果勾选、持久受理及完成反馈；Libra 过程详情保持只读。真实 Host 公开接口旅程通过：错误字段/伪造 actor 拒绝、精确重复确认重放、异摘要同 key 冲突、其他 Entry 状态拒绝、完成后重启无预览缓存仍重放同 Receipt，不重复原 On-deck Commit。预览检查在提交前，Owner 事务内仍复验实际 Basis/Control；修复嵌套 SQLite 事务，没有放宽原子约束。前端 164 项、桌面/窄屏 JAV 初次确认/纠正与 Series 收藏 6 条受控浏览器走查、构建通过；本次浏览器使用受控响应，不替代真实来源或 UI 负责人对具体版本的验收。当前 144 routes（143 Admin + public health）、119/102/201/47 合同；P2 aggregate 12cbd8f039bbdc8b9017d9ff933ef974e223964522e9e2efaa9db568f3554e58。A/B 合并、单独 A、单独 B 真实 Host 复测通过，不设缺段门禁。提交后清理、Perception 剩余连续性、完整错误恢复、UI 负责人及跨平台/发布资格仍开放；无生产操作。

2026-10-14 JAV-CORRECTION-OWNER-CONTINUITY：带演员的真实Host旅程已验证当前Arca normalized relation Projection与People公共接口：新站New Actor进入新Inventory，旧Old Actor只保留历史；新姓名无Person且不阻断入藏，经精确People Registration Candidate用户接受后，Arca依公开accepted-origin proof形成人物记录新Inventory revision，原Correction Receipt与唯一On-deck Commit保持。后台证据及记录刷新按既有30秒cadence，测试覆盖完整周期，未修改调度规则。另一真实Admin API旅程验证同一Entry的直接评分4在号码纠正后重建Resolution仍为4、record identity及direct revision保持。已接受Subject的连续性、watched直接记录/纠正、旧身份外部或其他Entry隔离仍未验收，不以本次两条通过宣称Perception完整关闭。提交后清理、完整用户入口/错误处理、平台/媒体回归及发布资格继续开放；无生产操作。

2026-10-14 JAV-CORRECTION-RUNTIME：inventory.commit 已接正式 Supporting Work/Planner/Executor/Coordinator和独立资源解析。正常真实Host从Source/Assets→stage→publish→独立verify→atomic commit完成新Canonical/Inventory/Control/Receipt，重启不重复；原视频及唯一原On-deck Commit保持。路径重叠的提交前HTTP旧poster/旧身份与提交后新head已通过；原Owner晚期失败回滚fixture保持。独立进程在Receipt事务COMMIT后、journal完成前退出可沿原Effect消费同一bound Receipt；在事务内部写入Result后而COMMIT前退出，则身份/库存及全部Control完全回滚，随后原Effect恢复提交。短Workspace写入、Stage进程退出和冲突attention三个回归通过。当前119/102/201/47合同、相关模型/Planner/P2及package/semantic扫描通过。提交后旧路径/retained/stage/Workspace清理、People Origin与Perception连续性、错误处理及用户入口、各类来源/平台/回归和发布资格仍开放；无生产操作。

2026-10-14 JAV-CORRECTION-ATOMIC-STORE：专用 inventory.commit Capability/Receipt/Canonical transaction 合同已闭合（119/102/201/47，P2 digest 931dd050a09fcd938bb41a6bab9efdf0a6aebdc645b61d617e81bcdf6cdc6356）。Owner事务在同SQLite UOW重验五个精确前置Result、成功Work/执行fence、actual active Admission、完整Manifest/Verification、当前Basis及逐材料Control；新Canonical/Inventory双head、Control、Correction terminal和Receipt/marker全有或全无。隔离真实Host持久证据加执行fixture已通过：晚期identity写入失败、Result写入失败与过期执行fence均零残留；成功与精确重放不新增任何On-deck/Aftercare Commit，原视频及原Receipt保持。Metadata/Cast以有界Record+来源/规范化relation证据保存，64名长姓名预算及完整重建/tamper测试通过，不截断可选资料。当前仍未接最终commit Supporting Work/Executor/自动Coordinator；正式Runtime进程丢失重放、提交后清理、People Origin/Perception连续性、UI与跨平台/发布资格继续开放。不是完整纠正旅程PASS，无生产操作。

2026-10-14 JAV-CORRECTION-INVENTORY-PREPARE：从同 Scope 完成的 Source/Assets、stage、publish、final Verification 持久结果构造新 Arca Identity/Metadata/Cast、Inventory revision 及精确 Control changes，真实 Host 提交准备旅程通过，尚不写任何收藏 head。当前 actor hints 仅名称；经 People 公共 Reference Query 的逐 hint accepted-origin proof 关联，不按姓名猜测、不借整片 Observation digest 关联所有演员。未知人物保留新站署名且不阻断。原质量/瑕疵 Facts、Shared Related 和原 On-deck Receipt 保持；未变视频 assert 原 Control，替换资料 release/acquire，跨卷 copy 身份变化按精确新旧 Material set 处理。25 项相关模型/合同测试及 package/semantic 扫描通过，当前 118/101/201/46 合同保持。专用最终原子事务/Receipt、crash replay、清理、People 后续 Origin 消费、Perception 连续性、UI/跨平台和发布资格仍开放；未部署或修改生产。

2026-10-14 JAV-CORRECTION-VERIFY：独立 files.verify/domain_fact_commit Work 已接通，真实 Host 普通及路径重叠两条旅程通过，完整目标 SHA-256/Identity、旧 retained Identity、实际 NFO 番号/title 独立核验；Verification/Record/Result/marker 原子且重启保持。漂移、缺失 retained、错误/重复/旧 TMDB identity、无实际 active Admission 等负例通过；原视频、旧 Canonical/Inventory/唯一 On-deck Commit 保持。当前合同 118/101/201/46，package/semantic 扫描通过。Canonical/Inventory/Control 原子提交、提交后清理、验证事务中进程丢失专项、People/Perception/UI、跨平台及完整发布资格仍开放；files_verified 不代表纠正成功。无生产操作。

2026-10-14 JAV-CORRECTION-PUBLISH正式Work/Effect/Receipt已接入，真实Host普通及路径重叠切换、提交前原poster读取通过，视频/旧身份/Inventory/原Commit保持；替换途中恢复与碰撞负例通过。下一切片闭合独立最终Verification及Canonical/Inventory/Control原子提交，随后完成清理、People/Perception/UI及发布资格；不把files_published作为纠正成功。

2026-10-14 JAV-CORRECTION-RECOVERY已完成专用本地reality恢复、四输出byte recipe冻结及短期Handle从持久输入分离。四条真实Host旅程与110项Foundation Runtime/Policy/Startup测试通过：完整部分文件在原Effect下继续，冲突则结束Work/进入attention_required并保留旧收藏及视频。Workspace临时字节原子发布及短producer partial的分类恢复已完成，三个真实进程退出场景和抢占目标负例通过；下一切片完成正式收藏文件替换/验证/最终Arca提交、完整冲突的处理入口及People/Perception/UI和发布资格；不能以本次Workspace恢复宣称身份纠正已完成。

2026-10-14最新执行前切片：Correction持久Record读取、nonterminal lifecycle CAS/重放及禁止普通状态更新伪造成功已接通；同Entry维护/记录刷新/退出、整架注销及相关Standard/Placement/Template变更已加Owner gate，真实入藏Host验证拒绝并保持旧Inventory/Commit/视频。维护/退出回归通过；旧注销fixture identity_kind已修正为tmdb_movie，超过10000-member及重启注销复验通过。Arca自己的同站Metadata fact value/NFO重建及tamper/escape tests通过；仍未接正式Correction Supporting Work、Workspace注册/文件Effect、最终Canonical+Inventory Commit、People/Perception承接和UI，不把本切片视为已完成纠正或可部署生产。无生产操作。


JAV-PARTS（2026-10-14）：Procurement实际同目录同号A/B冻结一包，Libra明确copy Intent/逐段Probe/合计时长及接缝实际decode，Arca单Primary/唯一Commit；六条隔离Host旅程通过，单独B不要求A，不兼容参数明确失败并保留原源。DDT-548真实合并及完整H.264/AAC顺序流核验已完成，原测试材料未改动。

2026-10-14持续开发事实：正式单站 Identity Observation→原子 Fact/Subject lock、Metadata 同源 binding、真实 Workspace poster/fanart/nfo、真实 HEVC Direct/播放核验→Handoff B→Arca 验收/落位/结算/唯一 Commit 已在隔离 Host 通过；无号材料经工作区正式 preview/choose 入藏、重复 Receipt replay 和确认后异号拒绝也通过。Artifact Result 现在保留完整 source/crop/renderer/output 派生证明，JAV不沿用 Related NFO/图片。独立 JAV 推荐模板不改旧标准；Arca Profile 按正式身份选择。Admin Web 编译和既有152项测试通过，新JAV交互6项通过；尚无浏览器/负责人验收、Arca已入藏Correction、完整跨平台/来源各类资格或生产升级资格。本目标保持 active，无生产动作。以下2026-10-13准备段为历史设计/证据，未完成项以本条实际状态为准。

更新：2026-10-13。用户已确认第二种单站主备方案：单站取得title和可用cover即资料成功，其他字段能拿就拿，不因缺失阻断上架；不跨站拼接。JAV321不强制，参考Yuukiy/JavSP，按番号类型明确选择来源，多分段暂不考虑。用户最新简化为Libra首次确认后锁定番号、不途中改号，取消未实现的核对等待门禁；未确认阶段的补填/选择与首版已上架保留视频纠正保持。Owner及范围已写入SSOT，初次确认/锁定和Arca Correction继续typed工程细化。真实来源有正负样本；当前仍在准备，尚无JAV功能/全链路/UI/发布资格PASS。

## 目标、权威与边界

目标：用户通过既有设置、文件来源、收藏架及媒体整理入口，将JAV材料形成正式收藏，随后维护、检查及按精确授权退出。仅Arca On-deck Commit代表入藏完成。

上位入口：[Master Plan](../CURRENT_PLAN.md)、[工程Playbook](../ENGINEERING_PLAYBOOK.md)。唯一SSOT：[TOP_DOWN_ARCHITECTURE_CONFIRMATION](../TOP_DOWN_ARCHITECTURE_CONFIRMATION.md) §3.2.5–3.2.6、§3.3–3.5、§4.4–4.5、§5.3.2–5.3.6、§5.5.3–5.5.10、§5.6、§5.8、§6.1.5、§6.4.7.1、§6.5–6.7、§8.6.18–8.6.20、§9.4–9.7及末尾JAV资料合同。UI遵守Playbook §11.1/§12.3与Beta baseline §7.1；Movie-only Beta不扩写为JAV验收。

- Procurement产生可纠正的Claim，不承担Provider确权；显式JAV Hint没有番号时仍保留原文件名/最低Claim。mixed分类优先级保持。
- Libra负责正式身份、来源选择、Spec、Run与Workspace；Arca负责完整包验收、落位、来源结算及收藏事实。single仍恰一份Primary Video。
- 网站最低资料为title+该站同一影片声明且可解码的cover。日期、studio、genre、演员等可选；无值省略，不造默认值。缺少选填项不是资料失败或上架Gap。
- 同一选定站的资料生成NFO/fanart/poster；不要求网站分别提供三项。Artifact完整性、媒体可播放、稳定番号、Control与安全验收保持独立，不用两项网站资料豁免身份/技术失败。
- 推荐HEVC、实际Matroska、.mkv、single上限2 GiB，无rating/4K/音轨新增要求；Direct/Remux/Transcode沿既有合同。Movie/Series及用户冻结标准保持。
- FC2 seller与GETCHU/GYUTTO circle可作为可选studio署名，保留角色/来源。特殊类别仍须完成资料至入藏旅程，不退成只识别。
- Western Adult、AI/人脸识别、显式同目录同号A/B之外的分段格式、新媒体下载/升级来源、独立Runtime/资源体系、全局媒体ID不在范围内。开放UAT、已入藏历史与保护收藏保持；本轮只执行用户明确授权的安全停机、精确Reset、离线升级及标准部署，不追溯重处理保护收藏。

## 单站主备合同及范围

用户最新指令替代此前“跨站补齐全部Required字段”。一个站缺title、cover不存在/不可解码或来源不可用，才发布下一站独立Plan；同站暂时失败先有界重试。失败证据保留，不把站A的标题、站B的封面或其他字段拼成成功。成功选定一站后停止备用查询；为填选填字段持续遍历、默认继续抓取或非阻塞后台跨站合并均不在首版方案内。

同站可有多个明确封面候选，逐项失败仍属同站预算。真正歧义/Identity冲突进入人工确认；普通错误页面或错误返号只使该站结果不合格，不污染下一站。换站不重复媒体加工、上架或来源处置。

2026-10-13启动阶段历史快照（后续交付以顶部当前状态为准）：SSOT已经细化匿名/登录Handle variant、号码/CID区别、Snapshot来源/预算、逐站Outcome、图片host/network route及deterministic crop。独立来源基础子合同Ready后已进入本地机器实现：完整query anchor、按类型Source Selection Snapshot及闭合anonymous/secret JAV IntegrationHandle已有代码与negative tests，未接Provider Runtime。正式identity/selection variant、source qualification Result/Effect、首次Fact事务、派生Artifact及Arca Correction仍待传播；Source Map同步不能算它们Done。推荐Template源码仍要求release_date/studio/genre，节点1需对齐为requiredFieldCodes=[title]，Identity仍独立验证jav_code；不改其他Profile。

## 来源实测与映射

Reference冻结HEAD为`c4cfe61188234dd24c75b53b42b054327fef3e58`，只读源码、未运行应用或复制执行器。[来源证据](evidence/JAV_SOURCE_READINESS_20261013.md)保存编号、HTTP/主内容身份、字段presence、图片解码/裁剪及digest；原HTML/图片、runtime与凭据不提交。

测试使用用户提供的NAS代理`192.168.12.230:7890`及独立直连探针；没有修改代理服务、NAS或生产。页面/图片在不同route实测成功只构成各自Evidence，产品必须冻结route，不隐藏切换。以下是样本资格和拟选顺序，非全站、全系列、正式Host或上架资格。

| 番号类别 | 已观察来源与拟选候选 | 实际结果 / 剩余资格 |
| --- | --- | --- |
| 常规发行番号 | JavDB → JavMenu；JAV321可作为未来已配置候选 | IPX-177两站各自title+cover/解码通过；JavDB MIDV-001有两条exact记录，需人工候选选择。JAV321多次timeout，不是首版门禁 |
| FC2/PPV | FC2官方 → JavMenu；其他站只有实测Ready后登记 | FC2-718323官方title+article identity+cover通过；JavMenu同号title+声明图片可解码，图片200×200只证明解码，内容关联与缩略图适用性需Adapter qualification；JavDB详情要求登录，用户无Cookie；FC2PPVDB挑战403 |
| 日期型 | JavMenu → 对应发行方官方站（必须先能辨明issuer） | 082713-417在JavMenu与Caribbeancom各自有完整身份/title/cover样本；官方评论日期不能作release_date，其缺日期/署名不再阻断资料资格。不同发行方同号仍需消歧 |
| MUGEN / IBW / T28 | JavMenu → 经验证的JavDB等候选 | MKD-S148、IBW-398Z、T28-557均title+exact主品番+图片解码通过，缺片商/分类不再阻断。JavDB搜索各一条exact，但详情timeout/挑战，备用链不能记为成功 |
| RED / SKY / EX / K | JavMenu → 后续经验证的发行站/其他候选 | RED030、SKY066、EX0010、K1095声明封面解码通过；RED-030/SKY-066/EX-0010使用明确系列别名，不能全局删横杠。EX0001仍是无主资料负例；样本不足以宣称全部东热系列覆盖 |
| N | JavMenu → 经验证的JavDB等候选 | 新样本N1230主番号/title及820×462封面解码/裁剪通过；NAS连接reset、独立直连成功。N0001无cover/N0002无主资料负例保持；JavDB搜索一条exact，但详情timeout，备用未通过 |
| 数字前缀259LUXU | AvWiki → 经验证的MGStage等候选 | 新样本259LUXU-1022直连主厂家品番/MGS品番/canonical/product link一致，title及声明840×472封面解码/裁剪通过；NAS返回无主资料壳页。旧593直连仍404，MGStage区域403。route必须显式冻结，不隐藏绕过代理 |
| T38 | JavDB → 经验证的JavMenu等候选 | 通过T38前缀搜索发现实际记录，T38-071/072匿名详情的主品番/title与各自1000×673声明封面解码/裁剪通过。T38-001无exact负例保持；JavMenu072=429/071无主资料，备用未通过；不由T28样本替代 |
| HEYDOUGA三段 | HEYDOUGA官方 → 后续合格来源；JavMenu此样本拒绝 | 官方HEYDOUGA-4030-2113的canonical/主player full scope、title及声明WebP封面960×540解码/裁剪通过；JavMenu主品番截为HEYDOUGA-4030必须拒绝，不能用canonical回显补造第三段 |
| CID | FANZA及明确提供CID→番号关联的站点 | 新增官方ipx00177/ssis00698：NAS均200但返回相同28723-byte壳页，无主身份/title/cover，直连connect timeout；公开content-page脚本只证明客户端逻辑存在，不运行脚本/猜API确权。JavMenu猜号重定向无主资料；JavDB CID query未取得完整映射。保持Identity Gap，未宣称source Ready |
| GETCHU | DL.Getchu | GETCHU-4052694的item/video/title/cover解码通过；旧样本4016932=404，仅该item缺失 |
| GYUTTO | Gyutto | GYUTTO-242158的item/video/title/cover解码通过；HTTPS及声明的image.gyutto.com redirect有效，不需要HTTP例外 |

Reference采用并行跨站汇总，按priority补空、封面候选轮换、汇总后检查cover/title；本项目仅借鉴单站页面与编号/图片处理，不照搬跨站合成、番号多数票或浏览器Cookie池扫描。当前JavMenu布局不同于Reference，主影片区域必须明确绑定，推荐列表/搜索回显不能确权。

旧japaneseJavScraper不能whole-executor reuse：输入ID回填不等于返回品番；normalizeAdultId会截断三段；transport无byte/redirect bounds，旧task/config/running Map不接回。cleanText/splitList/fieldFromText/absoluteUrl等仅是逐函数候选，真正复用前进入reuse ledger；本轮没有复制。

## 未确认身份：用户旅程与锁定边界

用户最新简化决定：JAV在Libra首次正式确认身份后锁定番号，不允许途中换号；取消尚未实现的核对等待、执行中纠正及跨Run换号成果承接。Movie/Series不变。首版仍保留已入藏后由Arca保留实际视频的Correction。以下是已确认设计，尚无JAV UI/运行资格。

2026-10-13用户已明确接受以下未确认身份旅程。文件名/目录提取的号码只是未确认Claim，不是锁定号码。自动唯一匹配并完成单站身份/title/cover核验可首次确认；自动无号、未匹配、歧义或来源不合格则显示“需要处理”，保留原媒体，不开始依赖正式身份的加工/交付。未确认时用户仍可修改输入和重新查询，不能因“Libra禁止途中改号”把初次确认入口关掉。

| 场景/步骤 | 用户操作与反馈 | 后台约束 |
| --- | --- | --- |
| 自动不能确认 | 媒体整理工作区“需要处理”显示原文件名/位置、识别出的未确认号码及原因，交互区【确认番号】 | 没有合法号、查不到、有多个候选、缺title/cover分别表达；详情只读，原Candidate/文件不变 |
| 输入/修改号码 | 完整号码输入框可预填提取值，用户可改为正确号码后【查询】 | 词法规范化保留零/尾缀/三段；无效格式就地反馈，不发布Fact或启动加工 |
| 查询失败 | “未找到匹配影片”/“来源暂不可用”/“未取得可用封面”；保留输入，允许再改再查，设置问题给设置入口 | 按类型同站主备；不拼字段，选填缺失不失败；旧查询迟到结果不能替换新预览 |
| 查询成功/多候选 | 展示完整号码、title、cover及来源，选填只展示实际取得值；多记录由用户选，不默认首条 | 返回的是预览/候选，不是正式身份；即使只有一个手动查询结果，也等用户【确认影片并继续整理】 |
| 不是这部 | 在首次确认窗口中修改号码再查询 | 清除旧预览和确认资格，可反复修改；不需要改源文件名、重新扫描或操作数据库 |
| 确认选定影片 | 【确认影片并继续整理】，展示核验/提交中；成功回列表进入“整理中” | exact重验同一资源与selected source title+cover，CAS仍未确认的Identity head，原子写首次Identity/Provenance/Result；重放不重复提交 |
| 确认时状态已变 | 刷新列表/当前身份，说明“身份已确认，整理中不能更改番号” | 另一客户端/自动路径先确认时异号拒绝，不停原Plan、不覆盖Fact、不创建纠正replacement；同规范番号幂等 |
| 不知道番号/暂时关闭 | 可以关闭窗口后稍后继续，条目仍“需要处理”；完全无法确定则保留或用既有允许的放弃动作 | 关闭/断网不算确认；不新增持久Review Session、Pause/Cancel门禁，不猜造内部JAV身份或强行上架 |
| 确认后发现错片 | 整理工作区只读显示已确认号码，不提供途中换号/核对等待；完成后到“我的收藏”【纠正影片身份】 | Handoff/Commit按锁定号码正常执行；已入藏后Arca独立Correction保持Entry/视频，原历史不改。不得用Reset、改Fact或隐式重建绕过锁定 |

初次确认窗口只在身份仍未确认且有可处理Outcome时可用。正在自动查询/状态发生变化必须按实际Projection显示，不把UI窗口当后台锁；确认命令用现有revision/幂等模式拒绝并发异号。人工等待来自Identity尚未解决，区别于给执行中的Plan增加暂停能力。首次锁定时点是正式Product Identity Fact成功提交；仅解析文件名、用户输入、查询预览或失败来源返号不锁定。网站最低资格同时要求title与可用co

ver，避免先锁定“有番号但无合格资料”的不完整来源；NFO/派生图等后续技术失败仍沿同一已确认号码恢复。

Synthetic例：文件名ipx00177.mkv提取IPX-00177，但未能确权；用户输入IPX-177，查看该站标题/封面后确认，系统再次查证成功才锁IPX-177。不是自动去前导零，也不是修改已经成立的Product Identity。自动唯一成功也会锁定，不要求所有媒体逐片人工审批。

已入藏纠正旅程保持：“我的收藏”【纠正影片身份】→输入新号码/查询→新旧资料/路径预览→【确认纠正】→Arca保留视频、重新生成资料/验证并发布新revision。People/直接评分/已看按Owner合同承接，外部或其他Entry旧身份记录不迁移，同号收藏不自动删除。Correction typed/事务/Effect/crash仍在节点1闭合，取消Libra途中改号不等于删除已批准的Arca范围。

现有电影依据：`web/src/helix/FormationPage.tsx`在用户操作列触发`ManualIdentityDialog.tsx`的查询→预览→确认；`product-identity-selection-service.js`目前只支持TMDB/movies/series，不能视为JAV已经接入。JAV补齐初次选择variant及首次锁定服务端校验即可；不为此引入执行中Review Session。mixed错误分类仍单独检查，不在番号窗口偷偷改已有Movie Subject类别。

2026-10-14最新Correction实现：Arca独立同Entry预览与持久受理已有typed机器合同/Store及实际入藏Host的Control rollback、Receipt replay、old ownership/视频保留证据；未接正式Work/文件Effect/最终Commit或UI，不宣称已完成身份纠正。后续先闭合竞争门禁与执行/crash恢复，再接People/Perception及用户入口。当前机器库存201 tables/46 transactions；旧200-table迁移target保持冻结，不自动迁移当前Formation。

## 开发起点差距（历史对照）

本表保留起点核对，不代表当前缺失；当前交付与剩余门禁以顶部最终候选记录、下表及现有Evidence为准。

| Owner / 链路 | 已核对差距 | 工作项 |
| --- | --- | --- |
| Procurement / Handoff A | Triage有jav Claim；public observe/reprocess与MaterialFieldsPage仅movie/series；无番号的显式JAV最低Claim已有模型基础 | 公开JAV来源/观察/重试，Hint/Rule冻结、Related完整交接与幂等；mixed错误分类恢复单独验收 |
| Libra / Identity | Planner/Commit/Observation及Selection只接受movie/series/TMDB | JAV typed Intent/Observation、初次确认/预览/号码锁定，原子Fact/Result/marker；正常replacement保留原号码 |
| Platform + Libra / 单站资料 | clean ThePornDB存在但不作为首版门禁；Metadata Planner按provider:jav前缀只允许一次来源 | 精确site/config/ordinal/source-attempt规划；匿名Handle、同站title+cover qualification、失败下一站、同站Artifact生产；选填缺失不阻断 |
| Arca + Libra / 标准和上架 | 推荐Template仍要求日期/studio/genre；On-deck把single推成movie，Aftercare非season也推movie | 推荐title-only Metadata规则、原生JAV profile、三条媒体链、独立Arca验收/落位/结算/唯一Commit |
| Arca / 运营 | provider namespace与Artifact维修有Movie假设；Canonical Correction范围已确认但无typed/runtime实现 | 健康/资料维修/Duplicate/退出/注销；独立身份纠正先闭合工程合同，不能借普通维修实现 |
| Admin | 配置、来源/标准、身份选择只有Movie/Series或TMDB | 既有页面接入JAV，身份需处理→查询预览→恢复、来源失败反馈、收藏详情；不新建任务调度台 |
| 测试 | 两个旧p14-jav纵切skip；历史open Handoff B checkpoint早于当前合同 | 重建当前正式Host纵切；[历史checkpoint](evidence/P14_JAV_PRODUCTION_OPEN_HANDOFF_B_CHECKPOINT.md)不能直接转PASS |

## 五节点工作项与Gate

| 节点 | Owner交付 | 必需验收 |
| --- | --- | --- |
| 1 / JAV-CONTRACT、JAV-SOURCE、JAV-IDENTITY-RECOVERY（本地已实现；资格收尾） | 单站主备/title+cover及首版已入藏Correction已确认；传播typed identity/selection/Handle/source qualification/Artifact/Template，闭合初次确认/锁定、已入藏Correction及Owner感知连续性 | SSOT/机器合同一致、真实正负fixture；Correction的typed事务/Effect/并发/恢复Ready后才实施，不重复请求已确认范围 |
| 2 / JAV-IDENTITY-METADATA（本地已实现；适用具体版本UI已接受） | 公开Handoff A→原生身份→单站资料/NFO/poster/fanart及用户恢复入口 | 缺选填通过、缺title/cover失败下一站不合并；首次错号选择/歧义/CID/revision/重放/登录/图片与确认后异号拒绝矩阵；具体版本UI |
| 3 / JAV-FORMATION-ONDECK（本地链路与最终镜像场景已验证） | Direct/Remux/Transcode→Arca Handoff B/落位/结算/Commit | 隔离真实文件、2 GiB、范围外保护、崩溃/重放、旧结果不能错误上架 |
| 4 / JAV-OPERATIONS-SURFACE（恢复已实现；本地场景及适用UI已验证） | 健康/资料修复、布局/标准、重复审阅、授权退出/注销、已入藏Canonical Correction | 同Entry保留视频、资料/命名/评分已看连续性、身份冲突与并发/crash/重放；profile/Inventory revision连续、缺图恢复及全部保留重复；具体版本UI |
| 5 / JAV-QUALIFICATION（本轮发布资格完成，已部署；待用户验收） | Movie/Series回归、真实Provider/媒体、Windows/Linux Service与Admin Web最终版 | 必需链路无skip、历史保护、精确版本UI、旧版/候选/候选数据回退与未测边界；开发Exit与发布分开；Desktop本轮不开发 |

当前实现覆盖typed identity/单站source attempt/Artifact/推荐标准、首次确认/锁定、A/B包与媒体加工、Arca独立Correction及显式Recovery Intent。部署资格已按顶部当前记录完成，生产037592bef4正常运行。CID无可信映射时保持明确未确认与手工完整番号选择；代表性来源实测不等于所有站点长期可用。用户原skip仍保留，本次NAS完整副本例外已明确授权并完成；Libra途中换号不在范围。下一步收取实际使用反馈，正式Phase Exit与旧UAT关闭仍按各自验收条件，不新增开发UAT。

### 节点1启动阶段记录（历史，后续已实现）

来源基础子合同本地交付：`src/helix/contracts/jav-source-contracts.js`提供完整号码/CID的互斥anchor、grammar digest、单站title/cover要求与有界Source Snapshot；schema与语义校验均限制按类型候选站，连续ordinal/重复配置/篡改摘要/混入Cookie或代理值均拒绝。`shared-type-schema-builder.js`/现有IntegrationHandle schema新增jav_source闭合分支，其他Secret-bound Provider不能附加JAV字段或变匿名。已完成9项源合同negative/positive、P2与dispatcher专项；source helper的Snapshot尚未绑定正式Intent/Result目录，Platform resolver不接受新型Handle，来源资格/首次Fact与功能工作项不因此Ready。此次纯合同实现没有UI或业务投影改动。

节点1本轮补齐的工程约束：首次Identity锁定要求合格cover，但现有Metadata Fetch输入要求正式resolvedIdentityDigest，直接复用会形成依赖循环。SSOT末尾已冻结closed未确认query anchor资格variant：source Observation→同站cover Artifact Evidence→qualification→首次Identity原子提交→正式Metadata/Artifact。不全局放松resolvedIdentityDigest、不把浏览器预览cache当Fact、不把下载藏进Commit。机器schema/Capability和对应Effect/Handle证明尚待传播；latest Selection Intent head/revision、自动与人工竞争、旧候选迟到、原Receipt优先重放及核验失败保持未确认纳入negative fixture。当前代码支持的TMDB choose只提交Intent，与首次Fact不是一个动作，JAV UI必须显示受理后的核验状态，不能把Command Receipt当已确认。

## 启动阶段验证与保护记录（历史）

Windows准备专项37项：35 pass、0 fail、2 skip，约35.55秒。命令：

~~~powershell
node --test test/helix-architecture/p14-jav-handoff-a.test.js test/helix-architecture/p14-jav-routing-spec-run.test.js test/helix-architecture/p14-h1-provider-integrations.test.js test/helix-architecture/p9-product-metadata-planner.test.js test/helix-architecture/p14-rule-template-public-http.test.js
~~~

skip为旧JAV public Handoff A与routing/production纵切；其余使用受控响应，不是live/真实FFmpeg/上架资格。Reference源码与live网络结果分别见Evidence；没有启动Reference应用、登录站点或下载媒体。

SSOT Source Map、P2 contract baseline与diff/link检查为文档/引用资格，不等于新JAV机器variant或UI通过。本轮无完整Service/Desktop/Linux镜像、实际JAV媒体加工/Host/浏览器验收；源站解析及原图→派生图仅为隔离探针。

来源基础切片Windows专项最终84 pass/0 fail/0 skip（source/shared/domain/result/P2/P4/H1，27.47秒），最后IBW有/无Z的独立grammar修正后源合同9项复验通过。P2 aggregate为5fd2804cb07c64ca3223f5a0255117421b67909e6ba1904a0ed59ca8a77ee83b，31个shared type/120个domain input及113/99/200/45目录count不变；anonymous Handle改变既有shared schema业务形状，不能再把本轮全部diff称为source-ref-only。源码与测试在JAV-CONTRACT来源基础子项，正式source qualification/身份锁定/Correction并未因这些tests自动Ready。无UI/Projection改动，未新增依赖，未做Linux Docker/完整Service/Desktop构建或真实Host。

代码基线`da23711dd`，初始main干净；当前文档/引用变更属于本任务，不覆盖用户文件。最近记录生产仍`0dbd762d2`，未查询实时生产/部署/停机/Reset或重处理。开放UAT全部保留，不分配开发UAT、版本名或release tag。OPS/Series既有Exit见[OPS归档](archive/OPS_RUNTIME_STARTUP_RELEASE_20261013.md)、[发布证据](evidence/OPS_RUNTIME_RESET_20261013.md)，不扩大其历史授权。
