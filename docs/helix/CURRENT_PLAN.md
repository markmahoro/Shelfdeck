# ShelfDeck 当前计划

2026-10-20 US Adult五议题本轮已完成生产标准部署af2257c423及恢复正常供给，既有唯一Phase继续承接使用反馈与正式收尾，不新增并行开发计划。身份准确率按用户决定不再统计；生产发布、隔离技术资格和未执行的完整生产媒体E2E分别记录于CURRENT_STATUS及既有Evidence，不扩大既有UAT关闭范围。

## US Adult 与全系统维护开发（2026-10-20）

2026-10-20最新授权与执行顺序：用户已允许清理停机前当前10项未上架整理，并补充授权其中新进入的1部电影；已完成上架项保持。随后明确要求先通过正式安全停机，等成功后再部署升级，并检查任务收敛。旧版现已通过公开stop API关闭供给、等待1个转码恢复动作，尚未stopped；在成功前不得Reset/迁移/部署。原第一次容器停服触发60秒超时，不计安全停机PASS，已恢复旧版并纠正顺序；冷备须在本次安全停机后重新捕获。候选完整Gate已完成PASS，见当前状态及既有Evidence。

发布承接：候选`64d1b06702`已构建/上传/checksum/dry run、具体版本UI及适用增量验证通过，独立完整Gate运行中。生产副本因10个未完成Run拒绝升级，30,941个人物归属无阻挡。标准10 Subject Reset只读预览已准备，但不得执行或添加跨迭代兼容；等待用户选择保留进度待完成，或明确授权清理这10项重整。选择后重核现场并继续完整冷备、副本Host/回退、标准apply，不能直接套用旧快照或清单。

唯一活动包仍为 [CURRENT_PHASE](implementation/CURRENT_PHASE.md)。五议题本地实现及ONNX worker thread、共享Schema编译优化完成，工程固定提交为0c82ee862a380bc1f590f94266ba656987ec3eff；该固定版本的全量资格继续保留。2026-10-20用户追加查询优化：在同一活动Phase内处理整季空间重复校验及评分候选重复扫描；增量代码单独记录回归和组件对照，不继承原固定版本完整发布资格。

最新授权：用户要求改完直接升级生产，并确认US Adult辅助搜图仅保留ThePornDB。固定官方GraphQL地址，设置只填写API Key；移除Wikimedia查询、入口及新选图合同。既有一次性测试凭据不复制到生产。继续同一Phase完成最终候选检查、精确版本UI审核和标准发布，先证明生产数据升级及回退资格，不Reset未完成整理。

TPDB连接摘要与线上查询协议缺陷已修复并通过隔离实测。当前验收环境为固定镜像加两处只读适配修复，不含查询优化、海报v3及单一来源增量，也不视为新完整发布镜像。

用户已确认海报新排版，v3共享Renderer及合同增量本地完成，Windows/Linux受影响回归与静态门禁通过；保留四帧2×2，暖白底、顶部姓名与页脚小肖像。后续最终候选整合须包含该增量；当前未更新NAS运行代码或已上架封面。用户已明确停止准确率统计，不继续收集或计算该项。

原始完整Architecture Gate通过：387文件、3129 total/3116 PASS/13既有skip/0fail，74个JAV场景（含22个动态定义）全部通过，4183个tracked输入前后摘要一致。Service648 PASS/29既有skip、Web242 PASS及build、Windows独立分发、Linux208专项及额外8个跨Profile场景通过；未选中/opt-in跳过不记覆盖。

实际N95隔离复验：1.5核/1.5GiB两片技术标签整理和单片指定刷新，434请求零错误、p95 410.05ms达到预定500ms预算，峰值887.6MiB、无OOM；仍有2.62s偶发长尾。四片各20点检出与旧版一致，维护截止/手动停机/跨Host及下周原Work续跑通过。NAS本轮进程已退出，原件及生产实例保持，无生产发布/升级或原媒体处置。

本轮工程验证已补齐；真实出演者身份准确性仍未评估，不用检出率或技术标签冒充准确率，因此保留Phase的业务验收开放状态，不宣称整版已发布或全部业务验收完成。证据及范围限制见 [US Adult Evidence](implementation/evidence/US_ADULT_LOCAL_IMPLEMENTATION_20261018.md)。既有发布和未关闭UAT保持，不新增平行活动计划或备份功能。

以下为已交付开发与旧授权的历史记录，不是 US Adult 的并行活动计划。

2026-10-18 最新授权及结果：用户要求部署上线，已标准发布 `helix-beta-20261018-5367179429`（source `5367179429d6e6785c1adf8c8da363bc21def9bd`）；完整副本候选/使用后旧版回退、冷备、精确镜像及生产健康/历史保护通过。包含统一代理、空间不足转二号与UAT-318本轮热点优化，先前“未部署/暂停发布”仅为历史状态；未授权生产清理。未追加性能硬门槛或大批等价试验，未跑完整生产媒体E2E，UAT-318及其他未闭业务验收保持开放。详情见既有UAT-318 Evidence最新发布节。

2026-10-18 用户恢复 UAT-318，并澄清要连续完成本轮热点优化、无需每步停下；不追加大批等价测试或性能硬门槛，此前暂停及候选失败记录保留为历史。既有优化及后续开发已合并至57c7aa675。本轮已本地完成Settlement同步输入/资源准备共享一次完整上下文，以及Libra精确revision批量Fact读取、单次metadata解码校验、claims分组和同事务Run读取复用；跨Event/重试/恢复及异步实际执行仍独立重读，全部完整性与授权围栏保持。143项定向回归及一次真实Package记录的隔离前后对照通过；未构建或部署，详见既有UAT-318 Evidence。

2026-10-18 用户追加 `LIBRA-WORKSPACE-SPACE-WORKSHOP`：Workspace 空间不足连续重试后转二号，空间恢复后原位自动继续。沿用现有二号容量、Subject整体转区与执行安全收口合同；本地默认3次、计数间隔至少60秒，重启前尚未转入的观察重新开始。本地实现及验证完成：二号席位17项、API/复制4项、真实Host2条旅程及Service647通过/29既有skip；无生产发布、清理或Reset授权。验收与证据见唯一CURRENT_PHASE及[本项Evidence](implementation/evidence/LIBRA_WORKSPACE_SPACE_WORKSHOP_20261018.md)。

2026-10-18 用户确认新增 `GLOBAL-NETWORK-POLICY`：全站统一代理、JAV列表一键测试并启用、无逐站覆盖、明确失败原因；本地实现/适用Windows验证及12a4b4030 UI审核20/20完成，未授权生产发布或配置写入。另按只读授权调查Workspace积压，已登记UAT-322：约70.16 GiB superseded旧Run引用未释放、无Cleanup Scope，35.39 GiB保留/升级备份，当前活跃约7.55 GiB；同卷外部Landing约173 GiB独立管理。不得将调查推导为删除、Reset或扩大旧UAT-318优化范围。详见[网络Evidence](implementation/evidence/GLOBAL_NETWORK_POLICY_20261018.md)与[Workspace审计](implementation/evidence/UAT-322_WORKSPACE_RESIDUE_AUDIT_20261018.md)。


2026-10-18 最新用户决定：本轮UAT-318性能优化先到这里，暂停继续优化及后续发布。最后候选d6ef5fee3e未通过响应门禁，保留已实现代码和多轮证据，不视为发布接受；生产仍bfd97f36a。恢复工作时从既有CURRENT_PHASE及UAT-318 Evidence承接，不新建活动计划。

2026-10-16 已按用户最新“跳过NAS演练 升级吧”完成生产标准部署：`markmahoro/shelfdeck:dc7dcddbaf`（source `dc7dcddbaf6714d56aaa453610f862914863578f`）。UTC18:25复核health ok、mode/desiredMode running、normalSupplyAllowed=true、faulted=false、RestartCount0；`/adult`与原`/adult_media`绑定同一宿主目录，QSV/13无关容器/fnOS保持。完整备份及204→210/203旧表2,236,865行逐行保护通过，560原收藏、原Commit、两季精确Run/Workspace保持，54伴随文件与data目录物理身份保持，无Reset/删媒体。二号5席/占1，3来源已有公平记录。新鲜NAS完整Host演练按用户明确决定跳过，非PASS。UAT-318/UAT-320仍开放：两季尚等待资源，首开/静态大文件传输仍超时；不宣称完整媒体E2E或1秒SLO。详见既有双车间公平与UAT-318 Evidence。

历史暂停快照（已被顶部新授权及实际部署覆盖）：dc7dcddbaf组合候选已构建/上传/校验、具体版本UI接受及受影响回归完成；用户暂不NAS完整副本演练，同物理Scope的新鲜完整Host资格仍开放，因此本轮未部署，adult绑定随正式升级生效。原037经公开Stop/Resume恢复正常供给，容器未重建；已有条件式部署授权保留，不以历史副本/临时介质测试替代本轮发布条件。准确资格与剩余事项见唯一CURRENT_PHASE及既有Evidence。

## Libra 双车间与来源公平（2026-10-15 开发承接）

本聊天仅承接 LIBRA-ATTENTION-WORKSHOP 与 LIBRA-SOURCE-FAIRNESS 两个独立工作项；沿用本 Master Plan 与唯一 CURRENT_PHASE，不新增 UAT 或平行活动计划。保留每来源 Intake 席位和 Procurement 行为；二号全 Libra 共用，用户已确认默认 5、范围 0–32，0 停止新增转入、缩容不驱逐。需要处理的责任留在 Libra，原位恢复，不能以 release 冒充转区。来源公平由 Libra Owner 先来源后 Run，保留 normal/expedited、等待老化与安全收口；Foundation 通用执行理念保持。精确合同、接口资格、验收与未决项见 CURRENT_PHASE 对应工作项。共享 checkout 保留其他聊天的部署脚本及事故工作；本聊天不执行 NAS 部署/停机/Reset/媒体操作。 2026-10-16 本地实现、跨平台核心及真实Host验证已推进；具体实现1f36d9ed8已获UI负责人8项浏览器检查接受；包含受保护S02/S03的新鲜204副本资格仍开放，交付已回传原聊天，详见对应Evidence。


2026-10-15 JAV首版已完成本轮发布资格并标准部署生产：markmahoro/shelfdeck:037592bef4，source 037592bef4441ceda87b3270f6e70cb7857da3a7。11:46:57 UTC复核mode=running、normalSupplyAllowed=true、faulted=false；556条原收藏和原入藏Receipt保持，已观察11条新Libra执行成功。机器合同121/104/204/51、147 routes。完整生产副本200→204/199旧表逐行保护、真实完整Host正常供给/33协调器推进、停止及使用后回退拒绝通过；生产按授权清理6个未结束Subject与精确discarded旧记录，86表范围外保护及49个伴随文件物理身份保持。最终UI变更经负责人宽/窄两项接受，其余继承原接受；Web186、Service642 pass/29既有skip与Linux20条业务的精确backend字节继承范围明确，最终实际镜像Native/API/源码/资产及Windows独立Service包复核通过。生产五挂载/QSV、fnOS及13个无关容器保持。具体原始失败/观察超时、Annex、备份及回退限制见现有JAV_RELEASE_COPY Evidence；不追认为每站长期可用、整季生产E2E或Electron资格，不批量关闭既有UAT。以下较早段落为历史快照，不覆盖当前授权与事实。

2026-10-15 用户明确授权三步推进：另开聊天排查生产任务长期停滞并修复，合并修复后用生产完整副本演练升级/回退，演练通过后标准部署生产。诊断聊天01a13ebb-f373-7670-a207-64797e8c7c31已建立；主聊天统一控制安全停机、备份、精确清场及发布，诊断期间保持生产只读。必要生产停机/标准部署不再以旧“未授权”文字阻塞；Reset仍需冻结可审查范围并通过原保护门禁，不能清掉未决非pure Effects或已入藏事实。

2026-10-15 JAV-RELEASE-CANDIDATE：最终本地候选 markmahoro/shelfdeck:455873b377 已通过标准构建、导出及独立SHA256校验；实际该镜像Linux JAV核心6/终态恢复8/Movie3/Series3共20条选择场景全部通过。固定锁定依赖FFprobe解决HEVC色彩漏读；备份改为有界完整hash，镜像384MiB容器内P13六项通过。当前Windows独立Service包203表/147路由、包内Native/API及256MiB备份恢复/篡改拒绝通过。2318份Service源码及已接受1qAJmlnq UI字节一致，继承具体版本适用UI接受。P2 121/104/203/51与既有完整整合/精确计数复验的组合证据保持，不宣称重跑过一次全绿整合。剩余部署准备为生产完整一致副本、6 active Libra及20未决Arca settlement-delete Effects的明确收口与实际规模升级/回退资格；4 running Work仍须核验。NAS临时隔离Linux仍按用户决定skip，没有上传、部署、停服、Reset或改生产数据。下一步须先取得仅限原容器停机备份后原样重启的精确授权。详见现有JAV_RELEASE_COPY/JAV_CORRECTION_RECOVERY证据。

2026-10-15 JAV-WORKBENCH-RECOVERY：恢复Intent已原子保存完整Receipt/执行Snapshot/文件现场Observation并追加不可变历史；当前指针不覆盖旧证据。实际Host的Source失败恢复、资料已成功而NFO写入失败恢复均完成同一Correction及清理（2 pass），后一条验证站点选填资料变化不会重写冻结Source Result，原失败Work、视频与原On-deck保持。已接入有界只读现场Preparation；发布/提交后清理的终态恢复、producer temporary及反复恢复后取消、公开API/工作区继续动作和最终版本资格尚未闭合，不宣称恢复功能或生产部署就绪。详见既有JAV_CORRECTION_RECOVERY证据。

2026-10-15 JAV-WORKBENCH-RECOVERY：用户确认保留独立Arca Correction链路、统一显示为工作区维护任务，并在同一业务任务下显式恢复终态失败。实施顺序为有界Owner任务Projection/工作区及只读过程、正式Recovery Intent/独立执行与文件保护、真实失败恢复旅程、受影响完整回归与新具体版本UI审核。不是Aftercare Case迁移；NAS临时Linux测试继续按用户决定跳过。

2026-10-15 用户调整验证范围：跳过已准备的NAS临时隔离容器Linux测试，不再等待此项执行授权或创建该容器。该项记为用户决定跳过，不记PASS；完整Linux文件Effect/候选镜像资格仍无新增证明，也不将此决定扩大为发布、停机或生产数据处置授权。下一步继续终态失败恢复方案讨论、具体版本UI审核及生产一致副本准备。

2026-10-15 JAV-AFTERCARE-FANART：独立背景图维护与精确图片退役已实现，4条正常/纠正后Host通过；继续来源失败保护及当前Service/架构整合，再闭合恢复合同、Linux、真实一致副本及具体版本UI门禁。当前范围保持Service/Admin Web。

2026-10-15 JAV-FC2-FALLBACK：当前FC2官方proxy与JavMenu direct样本及正式故障主备旅程通过；单站成功停止备用、不拼资料和同站有界重试已实证。Source connection预期错误分类已修复。继续CID/其他最终来源残余、受恢复合同确认约束的开发及整合/平台/真实副本资格；不将周期live成功或受控HTTP扩为全站PASS。

2026-10-15 JAV-INTEGRATION：新增route相关5处旧计数已对齐并复验；318文件整合初轮与复验分开记录，不称整轮已通过。只读发现真实生产3.1 GB/553收藏和未结束责任，独立样本不能代替该规模资格；后续须真实一致副本及逐Plan/媒体保护验证，生产责任收口不能由本任务擅自Reset。Linux内存组件已验证，完整容器/文件I/O仍待可用环境。Recovery Intent的用户确认仍是恢复实现依赖；不增加旧Run兼容或放宽copy准入。

2026-10-15 JAV-WINDOWS-PACKAGE：完整Service回归及Windows独立分发启动/Native/只读Operator已通过，修复分发漏掉clean依赖。终态失败恢复存在SSOT冲突：failed Work/Event/Effect不能重新执行，“沿原Effect恢复”只适用于未决Effect；新的Arca恢复Intent方案正在等用户确认，不改旧状态机或擅自新建恢复授权。该依赖确认后闭合恢复；独立平台/混合副本和最终版本资格继续。

2026-10-15 JAV-CANCEL-UI：正式availability Projection与取消交互/重新查询已实现并完成本地Host及最终bundle宽/窄屏走查；用户凭短状态、后果勾选、取消结果和重新查询完成纯Source失败处理。下一步优先闭合有文件副作用失败的原Scope恢复入口，随后最终整合回归、Linux/混合副本及具体版本UI负责人验收和发布准备。上述本地UI证据不代替跨层负责人审核。

2026-10-15 JAV-CANCEL：无写入取消 Owner事务/API及取消→重新预览确认→完整纠正清理已在隔离真实Host通过；文件写入后的取消明确拒绝。下一步补齐正式可用操作Projection和Admin Web取消交互，并闭合原Scope文件失败恢复；随后完整最终回归、Linux、混合数据副本与具体版本UI。当前不进入Desktop、生产发布或数据处置。

2026-10-15：最终全架构/P3 已通过；继续 Arca 纠正失败处理。no-effect 只读依据已有模型/有界 Owner-bound Reader，下一步将新鲜 Basis/Control/执行无写入证明接入专用原子取消 Receipt，再开放交互按钮；已有文件副作用继续独立恢复收口，不能套用取消或 Reset。Linux、混合规模、精确版本 UI 与标准发布准备仍开放，不开发 Desktop 或操作生产。

JAV-RELEASE-SERIES/ROLLBACK（2026-10-15）：上一发布真实 Series 完整副本及 Movie/Series 实际备份恢复窗口通过隔离验证；已有新事实拒绝回退。继续收取原最终全架构/P3进程结果，闭合纠正 attention 的取消/恢复入口及其真实门禁，再完成 Linux、混合数据规模、具体版本 UI 与标准发布准备。Docker Desktop socket 故障保持显式平台缺口；不操作生产或重做 Desktop。

JAV-RELEASE-COPY（2026-10-15）：离线精确结构副本/回退资格 Operator、上一发布终态 Catalog 档案与完整 Record Evidence 证明已实现；真实上一发布 Movie 完整副本在当前 Host 恢复并经过后台周期，原收藏身份/Receipt/媒体保持。初轮全架构 24 个失败已按各自原因修正，相关 235 项及历史/Startup 101 项复验通过；最终全架构/P3 聚合正在运行。继续真实 Series 升级、回退窗口、异常交互、Linux 和 UI 负责人资格；参见 [证据](implementation/evidence/JAV_RELEASE_COPY_20261015.md)。仍未部署生产。

JAV-SOURCE-HOST（2026-10-15）：类型来源/主备 13 条及无号普通/FC2 人工确认 2 条正式 Host 旅程通过，Service 全量回归无失败；原公开运行控制 Facade 和严格清单生成已修复。继续收口正在运行的全架构/P3 检查，随后处理明确异常恢复入口和完整副本升级/回退；FC2 当前线路可用性、CID 映射、Linux 及精确版本 UI 负责人资格保持开放。参考 [本轮证据](implementation/evidence/JAV_SOURCE_HOST_20261015.md)，不进入 Desktop 或生产操作。

JAV-CORRECTION-DIRECTORY-RUNTIME（2026-10-15）：目录后台、空目录自动归档/非空精确确认、恢复及保护、Owner scoped通知/周期公平/停机收口已接通；真实Host两条旅程和最终UI走查通过。下一步闭合其余异常处理与类别来源正式旅程，继续Movie/Series完整回归、Windows/Linux、具体版本UI负责人及升级回退资格。当前不宣称可部署，不做生产动作，不进入Desktop开发。

JAV-CORRECTION-DIRECTORY（2026-10-15）：closed 旧目录 Scope、实际 cleanup/context 来源核验、独立目录检查责任与 cleanup 完成同事务种子、CAS 结果存储已实现并经真实 Host/退出恢复验证。下一步接 Arca 回收后台及公开交互，然后继续异常、类型来源、Movie/Series、Windows/Linux、精确版本 UI 与升级回退资格。按 SSOT §10.9.1 及用户本轮纠偏，Desktop 不进入 JAV 首版开发，不复接旧 API。

JAV-DIRECT-WATCHED（2026-10-15）：直接已看 API/收藏交互及日志、独立历史和重放、评分回归、Entry/accepted Subject 纠正承接已通过本地验证。下一步补持久隔离与异常/旧目录，并完成类型来源正式旅程、平台/UI及升级回退资格；本机 Docker Secrets Engine 启动故障使 Linux 构建仍开放，不宣称生产可部署。缺段不设门禁；未部署生产。

JAV-PERCEPTION-CONTINUITY（2026-10-15）：精确accepted Subject连续性与JAV scoped感知规则已接通，Entry/Subject评分及重启验证通过。下一步补直接已看API/UI/真实旅程及持久隔离，再完成异常、旧目录、来源/媒体/平台/UI与升级回退资格；未部署生产。

JAV-CORRECTION-CLEANUP-COMMIT（2026-10-15）：自动完成清理并释放门禁、实际事务退出/重放、Entry评分及人物刷新后的历史Receipt验证已通过。下一步补Perception直接已看及精确accepted Subject连续性/旧身份隔离，随后闭合异常恢复、旧目录、媒体/平台/UI和升级回退资格。未部署生产。

JAV-CORRECTION-WORKSPACE-WORK（2026-10-15）：自动临时回收与Registry/Artifact/Receipt原子提交、实际进程退出恢复已通过；下一步闭合Arca cleanup完成事务并释放门禁，然后重验People/Perception与媒体/平台/UI/发布资格。当前cleanup仍active，未部署生产。

JAV-CORRECTION-WORKSPACE-RECLAIM（2026-10-15）：精确四文件回收实现及真实重启预检已通过；下一步接后台Work/Effect、Foundation Registry/Artifact状态提交及专用cleanup完成事务，随后重验People/Perception、媒体/平台/UI与发布资格。缺段不设门禁；未部署生产。

JAV-CORRECTION-FORMAL-WORK（2026-10-15）：正式文件清理已接后台Work/Effect/Receipt，正常与实际进程退出/冲突恢复通过。下一步完成独立Workspace Registry/Artifact回收和cleanup完成事务释放门禁，再处理旧目录及People/Perception重验、全部媒体/平台/UI/发布资格。未部署生产。

JAV-CORRECTION-CLEANUP-GATE（2026-10-15）：提交后的独立清理责任、持久门禁和真实状态UI已实现，本地测试/浏览器证据通过；自动清理尚未接入，门禁保持。下一步接正式材料清理Supporting Work/Effect/Receipt及Workspace回收，再闭合完成事务释放门禁并重验People/Perception与全部发布资格。未部署生产。

JAV-CORRECTION-COMMITTED-CONTEXT（2026-10-15）：完整执行上下文随实际Commit原子冻结，提交后只读恢复已实现；下一步接正式清理Work/Effect/Receipt和竞争门禁，再完成Workspace/旧目录、Perception剩余连续性及Movie/Series、跨平台、UI和升级/回退资格。未部署生产。

JAV-CORRECTION-FORMAL-RETIREMENT（2026-10-14）：正式材料收口模型/物理端口及实际Owner提交后的预检已有代码和证据；尚未接自动Runtime。下一步闭合清理的Supporting Work/Effect/Receipt、提交后门禁和进程恢复，再完成旧目录与Workspace回收、Perception剩余连续性及完整发布资格。

JAV-CORRECTION-ADMIN（2026-10-14）：收藏区独立纠正入口及公开接口正常/重放旅程已实现，初次确认/纠正/Series 收藏桌面与窄屏受控走查通过。完整异常恢复与具体版本 UI 负责人验收继续开放；下一步完成提交后清理及 Perception 剩余连续性，再闭合来源、媒体、跨平台与升级/回退资格。A/B、单独 A、单独 B 本地真实 Host 复测通过，不考虑缺段。

JAV-CORRECTION-RECOVERY（2026-10-14）：正式资料准备及真实进程丢失后的恢复/冲突停止已通过，仍保留旧收藏及视频。临时字节原子发布及短写入的分类恢复已通过，正式暂存Work/Effect及进程丢失恢复已通过，正式切换Work及提交前原视图已通过，独立最终验证 Work/原子 Evidence 及两条真实 Host 旅程已通过，新 Arca Cast/Inventory/Control 提交准备及真实 Host 构造已通过，专用Owner原子事务/Receipt及隔离失败回滚/重放已通过，正式commit Work/Executor/Coordinator及事务前后实际进程退出恢复已通过，下一步完成提交后清理、People/Perception承接及完整冲突处理入口，再完成People/Perception/UI及发布资格；Workspace恢复不代表身份纠正完成。

JAV-PARTS（2026-10-14）：实际同目录同号显式A/B在Procurement合为一包，Libra按冻结顺序在Workspace合并后沿现有加工流程产出一个视频，Arca一次入藏；单独实际A或B按单文件，不设缺段门禁。六条隔离Host旅程通过；用户测试集番号Claim10/10，DDT-548在原源之外完成合并及完整流验证。当前继续完成已入藏Correction、各类型/回归及生产资格；原测试材料未改动。

更新：2026-10-14。用户要求持续开发至可部署生产；当前 JAV 本地实现已接通正式 Identity Work/Fact、同站 Metadata/Workspace Artifact、真实 HEVC Direct 与 Arca 唯一 Commit。无号材料通过正式 Admin preview/choose 恢复入藏；首次锁号、迟到/CAS/Receipt 负例已通过。工作区确认窗口、8站连接设置、JAV来源类型和独立推荐模板入口已有代码；已入藏 Correction、各类/Remux/Transcode 纵切、精确版本 UI、Windows/Linux 与生产副本升级/回退仍开放。唯一活动包为 CURRENT_PHASE；未部署或修改生产。

最近已记录生产产品为 `0dbd762d2`，发布文档 commit `da23711dd`。安全停机与用户 Formation Reset 已标准发布，OPS-RUNTIME-STARTUP 已 Exit；旧候选0bc启动失败及修正后完整副本/回退证据保留，见 [OPS 发布记录](implementation/evidence/OPS_RUNTIME_RESET_20261013.md)。本次 JAV 准备不重复部署，不执行生产停机、Reset 或媒体重处理。

## 当前范围与顺序

2026-10-13用户最新简化决定：JAV在Libra首次正式确认身份后锁定番号，不允许途中改号；取消尚未实现的点击核对等待、Review Session、执行中号码纠正及换号成果承接。未确认时仍允许在工作区交互区补填/查询/预览/选定，过程详情只读；确认后只读展示号码，正常replacement也延续该号。已上架保留视频的Arca Correction继续纳入首版。

JAV 沿用 Procurement → Libra → Arca 及现有 Platform/Foundation；不新增 Owner、全局媒体 ID、独立 Runtime 或资源管理体系。SSOT保留single、稳定番号、HEVC/Matroska/.mkv、推荐2 GiB且不按评分分档。用户本轮将网站最低资料改为title+可用cover，其他字段可选；NFO/poster/fanart由同站资料与cover在Workspace生成，不要求网站分别提供。Movie/Series标准保持。

2026-10-13用户最终确认第二种单站主备：按番号类型选有序来源，单站取得title和可用cover成功，失败再换站；选填字段缺失不阻断上架，不跨站合并，不为补满字段继续遍历。JAV321不强制，特殊号码与封面参考 [Yuukiy/JavSP](https://github.com/Yuukiy/JavSP)，已确认同目录同号显式A/B在Procurement合为一个Candidate Package并在Workspace Remux为一份视频，单独A或B不设缺段门禁；其他分段格式不扩展。FC2 seller/GETCHU-GYUTTO circle作为可选署名保留角色和来源。用户进一步确认首版含尚未确认身份时的号码补填/选择和已上架保留视频的身份纠正：后者由Arca独立Correction拥有，不借Aftercare改身份、不改旧入藏历史、不重复Commit。真实来源样本、旧误匹配/新旧预览、初次确认/锁定及Arca Correction的typed闭合只在唯一Phase维护，证据见[来源核验](implementation/evidence/JAV_SOURCE_READINESS_20261013.md)。

| 顺序 | 目标 | 门禁 |
| --- | --- | --- |
| 节点1 / 首版已实现并发布 | 按番号类型的JAV资料来源、身份/封面合同与fixture | 单站资格与范围已确认；typed identity/selection、初次确认/番号锁定、已入藏Correction、匿名Handle、来源预算、派生Artifact及真实来源矩阵Ready |
| 节点2 / 已实现；适用UI已接受 | 公开来源至各类型正式身份、资料与图片 | 各类型正式Host的Handoff A、原生Fact/Artifact、单站失败换站/人工恢复/重放证据；适用UI验收 |
| 节点3 / 链路及本轮发布资格完成 | 三类媒体加工与完整上架 | Direct/Remux/Transcode 真实隔离链；Arca 独立验收、落位、结算及唯一 Commit |
| 节点4 / 恢复及适用UI已验证 | 收藏维护、退出与用户入口 | JAV健康/资料维修、保留视频身份纠正、重复审阅、授权退出/注销；感知Owner连续性及正常/异常交互 |
| 节点5 / 已标准发布；待用户使用验收 | Movie/Series 回归与 JAV 发布资格 | Windows/Linux、真实 Provider/媒体、精确版本 UI、完整副本及候选数据回退，未测边界声明 |

每节点分别记录实现、业务/技术验证和适用 UI 结论；跨层且涉及 UI 的改动由用户任命的 UI 负责人审核具体版本，纯 UI 层按 Playbook §11.1/§12.3由实施任务核验。不能集中到末尾或继承已变化页面的旧 PASS。开发工作及缺口用 Phase 内有名工作项管理，不分配开发 UAT 编号。

## 已完成基线与历史决定

- Movie 全链路阶段成果已获用户接受，仍以 Movie-only Beta A–I 为回归 Oracle；[UAT-278 收尾](implementation/evidence/UAT-278_BETA_MOVIE_CLOSEOUT_20260930.md)不代表残余全清。
- Beta 工程清理已按精确授权完成，[UAT-280 Evidence](implementation/evidence/UAT-280_BETA_WORKSPACE_CLEANUP_20260930.md)保留恢复和依赖修复记录，不扩大为当前清理授权。
- Series 原五节点开发已 Exit，见[冻结包](implementation/archive/SERIES_DEVELOPMENT_20261008.md)；已完成生产升级与历史保护证据见[发布记录](implementation/evidence/SERIES_PRODUCTION_UPGRADE_20261012.md)。2026-10-12“暂不扩展历史兼容、暂停升级”已被同日后续确认及最终发布取代；已完成历史的有界只读兼容保持，不恢复旧未完成 Formation。
- 安全停机/用户 Reset 本地开发包及后续启动竞态发布包均已 Exit，见 [OPS 本地归档](implementation/archive/OPS_RUNTIME_RESET_20261013.md)、[OPS 发布归档](implementation/archive/OPS_RUNTIME_STARTUP_RELEASE_20261013.md)。当前活动 Phase 已由 JAV 准备承接，“无活动开发包”只描述承接前时点。

## 残余与保护范围

[UAT 总表](UAT_ITERATION_REGISTER.md)继续唯一管理上线后测试/验收问题，既有编号、历史和未关闭状态全部保留；UAT-279保留误登记及转移事实。开发或部署不构成问题关闭，JAV准备不重新开启已关闭项或批量关闭开放项。

目录恢复自愈、sample/remux、前端1秒目标及其他既有残余不并入 JAV 开发范围。若某问题确实阻断 JAV 媒体安全或共享链路，关联原 UAT 为依赖并记录证据；独立准备继续。Movie/Series 行为、已入藏历史及用户确认保护的瑕疵收藏保持，不追溯重加工、不因新标准自动撤架。

## 授权、工作区与交付

当前统一工作区 `E:/my_project/emby_third_party-helix`、本轮开发分支 `codex/jav-release-preparation`（从原`main`既有JAV工作区变更建立）；工程整合与旧工作区恢复见[2026-10-08 Evidence](implementation/evidence/GIT_WORKSPACE_CONSOLIDATION_20261008.md)。UAT-267原工作区退役不等于问题关闭；保留用户修改、archive refs及必要恢复资料。

用户2026-10-15明确授权另开聊天排查修复、合并后升级演练、演练通过则标准部署；另明确授权discarded旧记录的精确清理和一次NAS完整副本演练。本轮已按这些范围执行并验证恢复运行，不扩大为后续任意NAS Reset、媒体处置或历史改写。下一步承接实际使用反馈，正式Phase Exit按Playbook记录；既有UAT逐项验收，不以本轮部署批量关闭。

未完成 Formation 不享有跨迭代兼容权利；除用户明确指定精确条目外，不加 migration、dual-read/write、fallback、resume 或 repair。需要 Reset 时使用既有正式工具及对应授权；不得通过 Reset 掩盖新条目仍复现的缺陷。已完成历史保护遵守现行合同。

集中部署负责人已于2026-09-28取消；后续获得明确发布授权的任务自行完成标准构建、上传、checksum/dry run、完整资格与部署闭环。生产停机/Reset/媒体处置仍按其精确授权执行。事实写 CURRENT_STATUS，过程证据写 implementation/evidence，完成 Phase 冻结归档；只保留本 Master Plan 与一个活动 Phase。
