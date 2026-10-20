# “死包”专项：Formation 全生命周期归宿审视

## 2026-10-21 实施检查点：首批本地修复，尚未发布

用户已授权实施；以下早期“仅审查”文字保留历史语境。当前产品修改：移除Libra以未变化非入藏历史额外拒收的门禁，保留Receipt幂等、活跃责任/席位等安全边界；新Run注册到当前turn_sequence，同来源同轮按路由锚定Intake的不可变Candidate publishedAtMs排序，保留正常轮转、加急与收尾；Procurement凭原技术失败精确证据允许下一轮普通Observation重做准备，同Observation及未变业务无效材料不重复成包；Arca恢复处理本轮选中的Offer，不再每次回头只处理列表首项。

验证：`node --test media-service/test/helix-architecture/source-fairness-store.test.js media-service/test/helix-architecture/p9-run-lifecycle-store.test.js media-service/test/helix-architecture/p14-uat019-executor-terminal-closure.test.js` 为46 PASS；`formation-cancel-reprocurement.test.js` 为3 PASS，包含原文件inode/size/mtime/hash不变的取消→普通扫描→新Run、临时媒体检查故障恢复，以及未变非媒体不重新开采。测试只用本地临时目录，均自动关闭Host并清理。`git diff --check`通过。不是完整Gate、跨平台或UI验收，未推送/部署。

未完成：持久接受取消（当前Host测试仍重复调用旧discard以完成收尾）、无Run退出、排除及撤销入口、退休Field闲置Control、前置终态失败闭环等。本批不将这些路径记为已修复。生产清理、人物请求恢复及旧备份已删除的记录见本文后部；清理没有更换生产代码。

日期：2026-10-21。状态：用户恢复完整排查后，已完成第二轮业务分支审查及关键断点的隔离验证，见本文「第二轮：从来源文件出发的完整业务路径审查」。证据区分源码、Coordinator fixture、正式 Host；不是 600 个生产包的实测，也不是全故障注入或 UI 验收。本文是 Evidence，不是平行活动计划，也不修改架构合同。前面首轮记录保留历史语境，最新分类以后面的第二轮为准。

## 用户目标与边界

用户明确要求：主体功能基本完成后，在进一步性能优化和 UI polish 前，先审视 Procurement → Libra → Arca 全生命周期。文件来源生成的 600 个包，对用户都必须有明确归宿；不能只证明大多数成功入藏。用户补充当前无法识别哪些是“死包”，也没有完整的维护、激活窗口。

用户已明确区分“结束本次尝试”和“排除这份材料”。前者不能隐含后者；后者的范围、Owner、撤销和生效时机仍待设计确认。本专项不预设必须新建页面、全局对象或跨域 Store。

用户随后纠正并确认：审视从 Material Field 中的媒体文件开始，包含从未成包的材料；第一优先级为业务流程是否走通，UI 与入口是第二层。两类核心问题是「某个模块持续持有 Control 却不能入藏或合法退出」与「材料本可开采但被系统错误地永久限制」。成功之后的 Aftercare、Off-deck 不作为首次未入藏，Commit 后 Workspace 清理另行核账。600 包是解释目标的案例，不是实际读取到的生产清单；Series/JAV 的 N:M、分段和多次交付不得套成“一包一部”。

## 讨论术语约定（2026-10-21 用户确认）

用户说「公平竞争机制」时，专指 **Libra 内部 Libra Run 的优先级排序策略规则**，对应 SSOT §6.4.9。不得将其与 Intake 的接包顺序、来源接收席位或 Procurement 的成包顺序混称。后续讨论分别使用「Libra Run 公平竞争机制」与「Intake 接包顺序」。此处仅记录术语约定，不表示已决定调整任一排序规则或实施功能变更。

## 后续讨论收敛（2026-10-21；尚未实施）

以下记录用户后续讨论，补充前两轮审查中的待决问题；不将讨论方向记成代码现状，不在本轮改写 SSOT 或实现功能。

- **持续收录意愿**：材料仍在有效来源范围内且未被明确排除，意味着仍纳入 ShelfDeck 的正常处理范围，不需要用户反复表达收录意愿。这不等同于某个模块永久持有 Material Control。
- **取消与排除**：用户提出将「放弃整理」改称「取消整理任务」，附默认不勾选的「以后不再整理本任务关联的来源文件」。取消仅结束当前任务，本身不构成防自动重试的依据；勾选另行表达文件排除。
- **撤销排除**：只解除排除限制，恢复按 Procurement 正常规则开采的资格；不表示立即再试，不额外授予一次重试，不恢复旧任务。排除范围展示、批量和在途原子收口等细节尚未闭合。
- **防重试讨论方向**：用户拒绝冷冻期及为少数误拦构造复杂判断或特殊通道。讨论由「包级人工放行」转向正常自动流程及 Libra Run 公平竞争；不把用户寻找旧任务或等待新包出现后点击放行作为必经恢复路径。当前历史失败未变化拦截仍在代码中，取消或替换它的最终合同与实现范围尚待闭合。
- **公平竞争的调整方向及接受边界**：用户希望将 Candidate Package 的发布时间纳入 Libra Run 内部优先级，使新一轮尝试相对靠后。用户已接受新包可能先占 Intake 席位、尚未接收的旧包不能参与 Run 竞争，以及公平轮转不保证等其他电影完成或固定冷却时长。此方向不意味着新增 Intake FIFO，也不意味着包时间戳已经参与当前排序。公平顺序的用户展示暂缓。

源码复核发现一个需明确处理的差距：`source-fairness-store.js` 为新 Run 初始化 `last_turn_sequence=0`，`source-fairness.js` 在同来源内按该值从小到大排序。因此新 Run 在公平加分这一项上可能先于已经获得过执行机会的旧 Run；这不是最终调度结果，但与「新一轮相对靠后」的目标不能直接等同。只在现有排序末尾用包时间戳打破平局，不能解决这个初始优先问题。后续须明确发布时间如何参与首次竞争并保留正常轮转、来源公平、加急及收尾优先；本次未改代码。

用户随后确认「可以的。这个讨论收个尾。进行下一步」：本轮取消/排除语义及用 Libra Run 公平竞争承接后续尝试的方向讨论收口，继续业务审查，未授权功能实施。具体排序组合仍须在实现前明确，不能仅增加时间戳平局规则便宣称目标成立。

本节不关闭退休 Field 残留 Control、无 Run 退出缺失、终态技术失败仍 pending、Arca 接收后非入藏退出等其他审查项，也不证明 Procurement 自身的失败准备重试限制已被解决。

### 下一项：Procurement 未成包失败后的自动再开采（重新核对）

业务背景：用户已配置来源并希望其中电影被收录，但某份文件在媒体检查或成包阶段发生技术失败，尚未交给 Libra；故障后来恢复，用户没有排除文件，仍期待正常扫描继续处理。

当前实现：`procurement-run-coordinator.js` 将 Evidence Assessment 技术终态失败和 Candidate Assembly 失败覆盖的未成包材料封口为 `triage_failed`，保留具体失败证据。`procurement-automation-service.js::availableForAutomaticRun` 的自动再开采门禁只看该终结分类和材料/Scope/Binding/Control、访问配置、类型提示、开采政策、Triage 规则是否变化，不按具体技术失败原因区分。故这些被比较的依据均未变化时，新的普通扫描仍不会重做准备；经过时间或单纯恢复技术服务不构成该函数的放行条件。

正式失败准备重试 API 和既有测试存在，SSOT §9 文件来源操作也要求该入口，但当前 Admin Web 源码未找到对应调用。本项不能用 Libra Run 公平竞争解决，因为材料尚未生成可进入 Libra 的包。待讨论：Procurement 是否应在后续正常开采轮次允许这些已结束的失败材料再次准备，以及如何与未尝试材料安排顺序；不预先决定复用 Libra 策略或新增人工特殊入口。本次仅源码复核和既有证据回看，未新增故障演练。

用户对此项明确确认为 bug：技术故障恢复后，本可开采且未排除的材料，不应仅因过去准备失败而持续失去正常再开采机会。缺陷范围为技术失败后的恢复阻断；不能由此推导文件本身不合格也必须放行。此前把这一点作为待用户选择的产品策略不准确。登记待修，未实施；具体重新进入和调度规则须遵循正常 Owner 流程。

### 后续逐项决定

- **D06 已决定**：用户确认一次取消后，系统持久保存取消意图并负责执行到底，用户无需留在页面或再次点击。服务重启后仍须继续安全收尾；完成前显示正在取消，只有安全终结后才显示已取消，不提前释放 Control 或伪造完成。现有 `closure_pending` 分支没有完整持久取消意图，作为待修实现差距；本轮未改功能。
- 无 Run Subject 的取消能力：用户确认既有合同明确的实现缺失直接列为待修缺陷，不反复作为产品选择讨论。后续只提交真正需要用户决定的业务规则。
- **D04 已决定**：用户明确回答「不能」——Arca 已接管、尚未 On-deck Commit 时，不允许取消本次上架。Arca 持续承担责任，经修复和重试完成上架；若条件长期不恢复，责任继续保留。F04 中「缺少非入藏取消出口」不再作为待补功能或未决合同；原始现状与风险证据保留，后续审查转为原因可辨、恢复路径有效以及条件恢复后能够继续推进。此决定不等于所有 Arca 恢复缺陷已关闭。

## 审查口径

每个来源包须能沿现有 Provenance 回答：对应材料范围、当前责任方、当前结果及原因、是否还会自动推进、下一步由谁做什么、用户操作入口、相关后续尝试/替代包/真实 Commit，以及未完成的清理义务。

区分三类问题：

1. 合法终结但不可发现、不可再操作：产品管理出口缺失。
2. 合法等待且有条件/动作：仍在途，不能算终态，也不能因等待长就自动判死。
3. 仍承担责任却没有可行推进或合法终结路径：业务 dead end 候选。

旧包、旧 Run 和已失效 Offer 是不可变历史，不能单独算一个待处理包。600 是冻结的一批根 Candidate，不是累计重试产生的所有版本，更不是 600 个 Shelf Entry。后续新尝试不应让旧失败与新成功同时占两个当前归宿；聚合是有出处的只读查询，不创设全局媒体 ID。

## 首轮路径枚举

表中“合同有出口”不表示当前版本实际旅程已验收。引用为 SSOT 节号及末尾有界修订，旧节与后续修订冲突时以修订为准。

| 路径 | 分支与当前责任 | 后续路径/归宿 | 首轮审视结果 |
| --- | --- | --- | --- |
| P01 | Candidate 已发布，Offer 尚待消费；Procurement | Handoff A 接收或正式拒绝 | 调度/投递/重启恢复属于技术在途，不是“无法上架”终态；需核可发现性 |
| P02 | Intake 席位为 0、已满或执行容量等待 | 配置改变、责任释放后接收 | 合法等待；不可计死包或假拒绝；二号满会继续背压 |
| P03 | Handoff A 合同、现场或 Control 不合格而拒绝 | Procurement 保留旧包/拒绝证据，释放精确选择责任；未来新 Observation 可新开采 | 拒收是该次交付终态，不是材料永久排除；逐包查看/处理出口需补审 |
| P04 | Handoff A 接受后，Routing/配置/Decision Input 未决，无 Run；Libra | 配置、补输入、一次性选 Shelf；也可显式结束未建 Run 的责任 | 合同有出口；须核用户入口及结束历史是否全覆盖 |
| P05 | Routing resolved，但 Spec Readiness/目标 Shelf/Basis 不就绪；Libra | 相关依据改变后重新准备；未建 Run 的责任结束按合法资格核对 | 不应长期只显示 preparing；与 P04 的实际操作覆盖需核 |
| P06 | 身份无匹配、多候选、错误 Claim、JAV 来源资格不足；Libra | 初次手动身份选择/确认后继续，或用户结束尝试 | 人工待决，不是排除材料；JAV 已锁号后不能途中换号 |
| P07 | 正常身份、资料、媒体加工、验证；Libra | 发布 Product Package → Handoff B | 成功主路；必须最终看 Arca Commit |
| P08 | CPU/GPU/Worker/Workspace/外部来源临时等待；Libra | 按真实预算恢复；符合条件可转二号原位继续 | 转区不是终结；配置为 0/满、环境永久不恢复时须可发现并可决定 |
| P09 | 技术失败/证据缺失，有界重试耗尽；Libra | 根据真实证据形成待决定、瑕疵资格或本次无法上架，再安全收尾 | 不能把超时解释为无片源，不能把 frozen 本身当最终用户答案 |
| P10 | 成品可用，存在可接受差距；Libra | 用户精确接受，或已有持续授权满足资格 → Handoff B → Commit | 瑕疵上架是入藏分支；无授权仍是待决定，不是死包 |
| P11 | 不可豁免问题/本次确实无法完成；Libra | 持久 unable_to_on_deck / processing_failed，原输入释放，清理义务登记 | 本次合法非入藏终局；材料仍未被用户排除，重新进入受准入约束 |
| P12 | 用户主动结束 active/frozen 尝试；Libra | Work/Effect 安全收尾后 discarded + user_cancelled，保原输入 | 本次合法结束；已确认 UI 重新激活缺口，见 F02 |
| P13 | 放弃请求时 Work/Effect 尚未安全结束；Libra | closure_pending → 同一责任收尾 → P12 | pending 不是成功；若 Effect 无法恢复/结束，可能形成长期无法退出的责任，需故障旅程核验 |
| P14 | Spec/初始 Basis 改变，旧 Run superseded；Libra | 唯一 Run Creator 建替代 Run，旧 Run 仅历史 | 旧 Run 不是材料归宿；需证明新责任承接和旧 Workspace 清理，不可有替代链断裂 |
| P15 | Handoff B Offer/Attempt 尚在取证或依据过期；Libra 仍持责任 | 有界完成接受/拒绝；失效 Offer 不可再接受 | 无 Decision 不能假定移交；永久失效后必须有 Owner 后续 |
| P16 | Handoff B 正式拒绝；Libra | 合同允许新包返工/新 Spec 替代；当前实现也有 processing_failed 安全终结 | 旧拒收不反向交接；各拒绝类别实际选路/有限性尚需逐项核验 |
| P17 | Handoff B Accepted；Arca | 建 On-deck Run/Custody，执行固定 Off-load 事务 | Libra completed 仅证明交付完成；尚未入藏，不能算成功终态 |
| P18 | Arca Placement/空间/目标冲突/验证/Effect 失败；Arca | 有界自动恢复后 blocked/attention_required，显式 Retry 同一 Run | 已确认合同只保责任并重试；永久不可恢复时缺少非入藏终结方案，见 F04 |
| P19 | Arca 缺 Settlement Authorization/映射或 Related 收敛证据；Arca | 授权/有效 Evidence 后继续，不可提前 Commit | 不愿授权、材料丢失或映射无法重建时不能假收尾；归入 F04 审议 |
| P20 | 固定事务与所有 disposition 成员证据完成；Arca | On-deck Commit → Shelf Entry/Inventory/Deck Fact | 唯一成功入藏依据；可带精确已授权瑕疵 |
| P21 | Commit 后来源目录/Libra Workspace 清理未完成 | 已入藏事实不撤销，各 Owner 继续原清理责任 | 清理故障另列，不能把成功包重新算死包，也不能藏掉积压 |
| P22 | P11/P12 后原文件未变，普通新扫描形成新候选 | Libra checkReentry 抑制相同失败条件；相关条件改变或新用户意图才准入 | 防循环机制必要，但抑制结果与来源“等待接收”间可能失配，见 F03 |
| P23 | 用户明确要求重新整理 | 持久新 Intent → 原来源正常观察 → 预留一次新 Intake → 新尝试 | 不复活旧 Run；手工意图不要求文件先变化；来源注销/不再可用等须明确反馈 |
| P24 | 用户明确不再收录该材料 | 需独立排除/撤销合同；不能等同 P12 | 尚未确认完整合同；不得以“失败抑制”冒充用户排除 |

上述是业务关口分支的首轮枚举，不声称穷尽实现中的所有错误码。后续须将每个实际拒绝/等待/终局 reason、公开操作资格和测试逐项映射到这些路径，无法映射的状态不得漏记。

## 已发现的缺口与待证明项

### F01：来源统计不是 600 个包的最终归宿账

源码 `field-procurement-status-query.js` 当前计算 generated/accepted/rejected/waiting，waiting = candidates - accepted - rejected；accepted 是 Handoff A 接收，不是 Arca Commit。`MaterialFieldsPage.tsx` 只呈现来源聚合及席位，未提供完整逐包归宿、终局原因、跨后续尝试承接与恢复操作。

结论：已有来源数字不能回答 600 包各去了哪里。不得将累计接收当作成功入藏，也不能靠数字相减认定死包数。

### F02：用户放弃后的重新激活在 UI 中断开

`run-outcome-store.js::requestReprocess` 允许 unable_to_on_deck 的新用户意图，未限定 processing_failed。`formation-run-history-store.js::terminalPresentation` 将 user_cancelled 映射为 user_abandoned。`FormationPage.tsx` 的 ended 行仅对 outcome=unable_to_on_deck 提供“查看过程”，user_abandoned 没有操作；`RunOutcomeDetail.tsx::load` 又只接纳 processing_failed。

结论：源码静态证据表明“用户放弃→从该历史行重新整理”没有可达 UI 路径。服务端支持不等于用户可用。此前讨论中“有重新处理入口”的结论须限于系统处理失败分支，不能扩为所有放弃材料。尚未做浏览器复现，不记 UI 验收结果。

### F03：再进入抑制留下仍计入等待接收的 open 候选（本地 Host 已复现）

`run-outcome-store.js::checkReentry` 返回 reentry_suppressed / LIBRA_FAILURE_CONDITIONS_UNCHANGED。`intake-process-coordinator.js::admitOffer/reconcile` 在此结果下提前返回，未在该分支形成 Accepted/Rejected Decision。来源等待统计仍只区分这两种 Decision。

2026-10-21 追加结论：已在当前 checkout 的隔离 Host 复现“用户结束旧尝试→不改文件重新扫描→新包 open 且 waitingAcceptanceCount=1→Libra 不建新 Subject/Run”；服务重启后保持。不是已核验的生产现场事实。用户显式 reprocess 后，同一 open 包被接收并建立新 Run，未再生成第三包，见末节。不能简单改为 Rejected 或让 Procurement 读取 Libra 内部日志来掩盖问题。

### F04：Arca 接管后的不可恢复责任没有完整非入藏出口

SSOT §4.5.6、§6.5.3 明确：恢复耗尽进入 blocked/attention_required，保 Custody/Control，只允许显式 Retry；不能退回 Libra，不能放弃整理，不能释放 Accepted 责任。当前 `on-deck-process-coordinator.js` 有相应 attention/retry 路径。

结论：可修复故障有恢复路径；输入永久丢失、目标永久不可用或用户决定不再完成等情况下，“再试一次”并不保证可达 Commit。现有规则保护安全，但对于“所有包都有归宿”的新目标存在待决业务合同缺口。必须在 Arca owning contract 讨论如何安全终结、保留/归还哪些实际材料、如何核清部分副作用及残余责任；本专项不擅自添加 cancel、反向 Handoff 或 Control release。

### F05：尝试结束与材料排除尚无独立完整的产品闭环

SSOT 的终局抑制是避免同条件重复失败，不能表达用户不再收录。来源目录排除也不自动等于对已经接管责任的包作出合法终结决定。排除绑定物理输入/位置/内容身份的范围、重命名和新版本的行为、撤销及在途相交规则待确认；Owner 分配在确认前只是方案，不写成既有事实。

### F06：缺少实际路径全覆盖与管理可达性的验收证据

尚未逐例核验：A 拒绝原因的再开采、无 Run Subject 结束的可见历史/激活、Spec 未 ready 的用户出口、superseded 新责任承接、失效 B Offer、closure_pending/Effect 无法恢复、原来源注销后的重试反馈、重复影片/多个版本的各自包归宿、根包关联后续成功后的唯一当前结果，以及 Series/JAV 非 1:1 计数。

这些是审查清单，不预先宣称全部存在缺陷。既有 UAT-251/155/268/296/308、UAT-322 和二号车间证据可复用具体事实，但不能代替本专项的来源到最终归宿全覆盖验收，也不批量重开/关闭历史问题。

## 下一轮交付与验收约束

1. 为 P01–P24 建立 SSOT → 当前 Owner API/Projection/命令 → 现有测试的逐路径映射；列出所有实际 reason 和遗漏。
2. 以隔离 Host 构造关键失败/放弃/拒收/抑制/恢复/替代场景，核对每次责任、Control、原文件和实际结果；不对生产执行扫描、Retry、排除、Reset 或媒体处置。
3. 冻结待用户确认的有界合同方案，重点是 F04/F05。确认后才回写 SSOT 并传播实现；不以测试通过授权改变 Owner。
4. 产品须从正常入口可找出全部未入藏材料，分辨自动等待/需用户决定/本次结束/明确排除，并直接到达有效下一步。已有“已结束”历史不能代替当前材料管理。是否新页/现有页承载在方案中决定。
5. 验收用固定 600 根包集合逐包对账；入藏、合法非入藏归宿、明确在途三者覆盖全部根包且当前分类不重复。在途必须有责任、原因及明确条件/操作，不宣称已经达到终态；真正的终态完结演练不得残留无出口在途项。
6. 新尝试继续有不可变历史及有界幂等资格；文件不变也能由用户显式重新尝试；不重复自动失败，不假造入藏，不靠删历史/Reset 消掉死包。
7. UI 走查须以用户不读源码/日志、不依赖口头讲解完成发现→决定→结果确认为标准，按 Playbook §11.1/§12.3 及 Beta §7.1 记录具体版本证据。

本轮仅修改计划/事实/Evidence 文档；未更改产品代码、SSOT、UAT 编号或生产状态，未运行产品测试/构建/浏览器。不把上述首轮静态审视称为专项完成。

## 2026-10-21 精确核验：放弃后原文件不变，是否生成新包

本节是用户暂停全路径审视后，单独要求核实的关键事实；不表示恢复整项审查或开始设计/功能修改。上文“本轮未运行测试”是首轮时点，本节记录追加验证。

代码基线：`ac278f33e644f0fe52f93043bfa1ac0f2eb40b18`，验证期间无产品代码改动。Windows Node v25.9.0。使用系统临时目录中的全新数据库、来源文件及 Shelf；真实 Service Host、正式 Admin Command、SQLite/Control/Procurement/Libra 后台，mediaProbe 为受控可读媒体响应，不访问外部 Provider，不证明真实解码/最终入藏能力。全程原文件未编辑、移动、改名；对比 inode、size、mtimeNs 和完整字节摘要。Host 结束并删除本次临时数据。未启动长期服务器/操作生产。

### 已执行结果

| 步骤 | Package / Run 事实 | 原输入 Control |
| --- | --- | --- |
| 首次观察、Handoff A 接收并建立 active Run | 1 包 accepted；proc_run_materials=transferred/handoff_accepted | revision 2，controlled，Owner=Libra Subject |
| 正式 discard Command 成功 | 旧 Run discarded；Outcome=unable_to_on_deck，reason=user_cancelled；旧包仍 accepted | revision 3，released，Owner 三字段 NULL |
| 放弃后使用原观察结果的后台推进 | 包仍为 1，没有立即生成新包 | 仍 released |
| 正式发起第二次普通扫描，文件完全不变 | 包变为 2：旧包 accepted、新包 open；Subject 仍只有 1，Run 仍只有旧 discarded；来源 generated=2/accepted=1/waiting=1/rejected=0 | revision 4，controlled，Owner=Procurement Material Field |
| 第三次普通扫描，文件仍不变 | 包仍为 2，不产生第三包；新包 candidate_delivery selection guard 保持 | 仍 Procurement |
| 关闭/重启同一 Host 后复核 | 1 accepted + 1 open；只有旧 discarded Run，无第二次 Libra 处理 | 仍 Procurement revision 4 |
| 对旧 Run 正式发起 reprocess Command | 新用户 Intent 受理；原 open 包转 accepted，包数仍为 2；新建 active Run，旧 discarded 历史不变 | revision 5，controlled，Owner=Libra Subject |

两次隔离运行均复现第二包 open；第二次扩展运行另证重启保持与显式 reprocess 接通。runtime errors 数组为空。最终 reprocess 只证明新尝试建立，不声称该新 Run 已上架。

### 精确原因与适用条件

- `candidate-acceptance-consumer.js:97` 将旧开采成员从 candidate_delivery 变为 transferred。`material-selection-snapshot.js:17` 只把 run_selection/candidate_delivery 当活跃选择约束，因此已转交旧包不会永久阻止再开采。
- `run-discard-store.js:473` 的 Discard Commit 释放精确原输入。释放后 Control 是 released/uncontrolled；这不是永远无人持有，新 Procurement Run 可重新取得它。
- `procurement-automation-service.js:288` 阻止同一 Observation completion 重放成为新轮次，但对历史 terminal_disposition=handoff_accepted 没有“文件不变就永远不再开采”限制。文件仍在 active Field、符合 Policy、无其他 Control/活跃选择冲突且 Triage 成功时，新扫描可产生新包。
- `field-observation-automation.js` 还存在默认 12 小时周期及启动扫描调度；“新扫描”不必一定来自用户点击。不承诺放弃后立即开采或恰好 12 小时后完成，本次实际验证使用显式普通扫描，未等待真实周期。
- `run-outcome-store.js:209` 的 checkReentry 针对同一 stable_input_digest 的 unable_to_on_deck 历史做准入，user_cancelled 也在其内；相同要求/相关恢复条件、无新显式意图时返回 reentry_suppressed。`intake-process-coordinator.js:106/138` 提前返回，不建新 Accepted/Rejected Decision，因而新包保持 open。
- 新包仍占 candidate_delivery 选择约束，所以第三轮扫描不会不停生成更多包。准确行为是“可以多一个等待接收但受抑制的新包”，不是“每次扫描无限产包”。
- 用户修改文件不是再次尝试的必要条件；正式 reprocess 意图已在原文件不变时让该 open 包完成 Handoff A 并新建 Run。不是恢复旧 Run。

### 验证限制与原始执行

现有定向测试：`node --test --test-name-pattern "(discard|terminal|Eligibility|guard|suppression)" test/helix-architecture/p9-run-lifecycle-store.test.js test/helix-architecture/uat251-terminal-history.test.js test/helix-architecture/p7-extraction-eligibility.test.js`，12 pass/0 fail。包含 Discard 原子释放及 user_cancelled 后同条件抑制/新意图准入断言；该测试本身不证明包生成，包生成由上述 Host 验证补足。

首次运行因本 checkout 缺 better-sqlite3 不能加载两份测试；本地 npm ci 安装依赖后复验通过。首个临时 Host 脚本因省略 optional sharp native 包不能启动，补本地依赖后修正脚本中一个错误模块路径才成功；这些准备失败不是业务链路失败。package.json/package-lock.json 未改动。

临时复核脚本位置为系统 TEMP 的 `shelfdeck-discard-reprocure-20261021.cjs`，SHA256=`2a07695594e154bed0e96995b48c7811769c43a64cc4041a128c66d88b51c263`；脚本不提交产品仓库。需要复验时使用 Service 目录为 cwd，启动全新临时数据，不指向生产数据。未运行全量 Service、Docker/Linux、浏览器或 600 包演练；结论限于当前基线已执行路径及上述代码条件。

## 第二轮：从来源文件出发的完整业务路径审查

用户恢复指令：「对的，需要做一轮完整的排查。」本轮按来源文件 → 观察/资格 → Triage → Handoff A → Routing/Spec → Libra Run → Handoff B → Arca On-deck Commit 审查正常、等待、失败、取消、拒绝、替代、恢复和重新进入分支。保持 `ac278f33e644f0fe52f93043bfa1ac0f2eb40b18` 产品代码不变；不访问生产。

### 结论与证据等级

**业务路径确实存在缺口，不能通过增加“死包”展示就闭合。** 四项主要实现问题为：无 Run Subject 缺失放弃实现（F07）；Run 之前的终态 Work 仍被当作 pending（F08）；注销来源留下阻断重新开采的 Procurement Control（F09）；重试所绑定的 Offer 被拒绝后，新意图仍被禁止（F10）。其中 F07/F09/F10 由正式 Host/API 复现；F08 用实际 Coordinator 和 Work Admission/SQLite、受控终态 Work 输入验证。

另外确认 Arca 自动恢复存在首项阻挡后项问题（F12），以及同一验收 Offer 的人工恢复也受 32 代上限约束（F13）。它们与 Arca Accepted 后没有非入藏终结合同（F04）不同，不能合并成“Arca 无恢复”。

- **H：隔离 Host**——全新本地来源、DB、正式 HTTP 命令与后台协调；受控 Probe，不证明真实编解码或最终入藏。
- **C：Coordinator/Store fixture**——真实业务模块与持久层，控制输入条件；证明指定状态下实际分支，不冒充整链 Host 故障注入。
- **S：源码/合同**——确认实现和合同分支；未实测的具体异常保持此等级。
- **T：既有定向测试**——复用并本轮执行的具体断言，不以测试总数证明所有路径安全。

### 全流程分支与实际出口

此表替代首轮“从包开始”的覆盖口径。`B` 是本 Evidence 的路径编号，不是 UAT 或新业务状态。源文件、Candidate、Subject、Run 与 Entry 不能做 1:1 相减；Related/分段/剧集多次交付须按物理成员及明确 Provenance 对账。

| 路径 | 触发条件 / 责任 | 当前实际推进或退出方式 | 判定 / 依据 |
| --- | --- | --- | --- |
| B01 | Field 未注册、已注销或类型不在当前公开支持范围 | 注册有效 Field；当前公开支持 movie/series/jav/mixed，western_adult 不宣称已支持 | 合法范围限制；注销后的旧责任另看 B10，不能用“来源已注销”掩盖旧 Control |
| B02 | 来源不可访问、扫描技术失败、部分页未完成 | 保留失败证据；显式新观察或周期新轮次；未完成轮次不作为全来源成功观察 | 有恢复路径。`field-observation-automation.js` 对失败轮次有 12 小时节制，非永久失败封锁（S） |
| B03 | Policy/Control 证据不可取得 | Eligibility=unknown，恢复证据后重新评估 | 合法安全等待；不能归为用户排除（S/T） |
| B04 | 不在最新完整观察、目录/后缀/大小/精确 materialKey 被策略排除 | 新完整观察或修订相应策略后重评 | 合法不能开采；原文件确实不存在与暂时不可访问必须分别追踪（S/T） |
| B05 | 存在活跃 Run Selection / Candidate Delivery | 等原责任结束；不能重复开采 | 合法互斥本身；若原责任卡在 B12/B13/B26，则此处只是传播阻塞（T/H） |
| B06 | Material Control 在 Libra/Arca 或另一 Field | 到当前 Owner 继续/退出；新 Field 不能抢占 | 合法安全约束；旧 Field 已退休却残留 Control 的例外见 F09（H） |
| B07 | 不可分 Scope 超过 1024 个成员 | 当前 Run Creator 返回 `procurement_selection_scope_too_large`，不创建 Run；范围/规则改变后再评估 | 现有明确容量合同；可能含完全正常影片。不是坏媒体，实际原因未接成用户可维护记录，见 F14（S/T） |
| B08 | Triage Work 在途 / 资源暂不可用 | Foundation 有界执行/恢复；Run 保 Selection 与 Procurement Control | 正常在途；没有“取消任意 Procurement Run”的通用业务出口，永久不可恢复需按失败封口而非一直等待（S） |
| B09 | Triage 证据/Assembly 失败，或媒体/结构无法成包 | Run sealed；逐成员 `triage_failed`，释放 Selection，保同 Field Control；相关事实/Policy/Rule 改变或显式 Retry Intent 创建新 Run | 既有合法本次结束与重试实现；普通重扫同条件不重做。UI 缺重试入口，见 U02（T） |
| B10 | B09 或 A 拒收后注销原 Field，再注册同目录 | 原 Field 不再新观察/开采，新 Field 因 `control_not_acquirable` 被拒 | **业务断点 F09**；本地 H 已复现 Triage 失败分支 |
| B11 | Candidate 发布/投递中，Libra 席位 0/满、Work admission 容量不足 | 同 Offer 保留；调席位/原责任释放/资源供给恢复后继续，耐久投递可重放 | 有等待与恢复；0 不终止 Procurement 成包，也不取消已有责任（T） |
| B12 | 旧失败/放弃后，同材料同条件且无新意图 | 新扫描可成新包并由 Procurement 控制；Libra 暂不接收、不出正式 Rejected | F03：合法防循环规则留下未结交付；新意图或相关条件改变可接通，不能称绝对永久死锁（H） |
| B13 | Handoff A 取证/接收/拒收 Work 技术终态失败 | Coordinator 持续返回 evidence/acceptance/rejection pending；同 Work Admission 重放不重开终态 Work | **F08**。取证分支 C 已复现；后两者同型分支 S；特殊 continuity stale replan 不在此缺陷范围 |
| B14 | Handoff A 正式 Rejected：包合同、物理存在/可读/身份或 Control 不合格 | Procurement 消费正式拒绝，释放 Candidate guard，保同 Field Control；下一正常新观察重新 Triage | 有出口；拒绝不是材料永久排除。重复同因拒绝需要诊断合同匹配，不得隐藏排除（S/T/H） |
| B15 | Handoff A Accepted | 原子建立/扩展 Subject、Bindings 和 Libra Control；消耗/持有相应席位 | 进入 Libra，不代表上架成功（T/H） |
| B16 | Movie 重复/其他版本，或 Series continuity 多匹配/集范围重叠 | 当前 continuity resolver 对不能唯一无重叠扩展者建立新 Subject；不能把重复影片当无出口拒收 | 后续 Arca placement/Inventory 仍独立验收；Entry 数不等于包数（S） |
| B17 | 无 Run，缺 routing policy/规则不匹配/高优先规则未知/目标无效 | 配置路由、补有效输入、对已形成 unresolved Decision 一次性选择 Shelf | 这些是合法人工等待；配置恢复可建立 Run，已 H 验证；但放弃分支缺失 F07 |
| B18 | Routing 的 NFO/provider/basis Work 终态失败 | 固定 subject/policy/basis 的 Work ID 反复 replay；没有正常新恢复 Intent；无 Decision 时 manual choose 也不合资格 | **F08**；basis 分支 C，NFO/provider 分支 S。相关 Policy/Basis 改变可走新 Work，不等于同条件恢复已实现 |
| B19 | Routing resolved，Spec 的 Shelf Standard/Perception/输入暂未准备好 | 相关 Owner 输入就绪后重建；不会因尚无 Run 自动释放材料 | 有条件推进；完全不再继续时仍受 F07；`shelf_standard_unavailable` 不等于已失败终结（S） |
| B20 | Acceptance Spec basis Work 终态失败 | 原 inputSetDigest 的 Work 仍返回 pending；变更输入可另建 Work | **F08**，C 已复现同 basis 不会复开。不能把修配置强行改变 Basis 当正式重试出口 |
| B21 | Run active：身份不明/多候选/初次选错、JAV 未锁号 | 人工确认身份；Run 可合法放弃。JAV 已锁号后不允许途中换号 | 有人工路径；锁号后的改变属于既有明确合同，不判为实现死胡同（S） |
| B22 | Run active：CPU/GPU/Worker/空间/外部来源等待 | 有界执行或相关条件恢复；符合资格转二号仍保责任；用户合法放弃 | 不能把二号当最终归宿。空间恢复原位继续已有专项 Host Evidence；本轮不重测该整旅程 |
| B23 | Run Basis 未决/变化 | suspended 有界 freshness recovery，必要时 frozen；语义改变创建 replacement 并 supersede 旧 Run | 当前 Creator 把 replacement Admission 与旧 Run 替代放在 Owner 事务；旧 Run 不单算一份死材料（S/T） |
| B24 | Work/业务证据证明产品不能达成 | frozen 后审查成品：精确瑕疵可人工/持续授权接纳；无合格成品或不可豁免问题走 processing_failed + discard 收尾 | 有本次终局；未决 Effect 不得提前释放。资源/接口错误不能伪造寻源穷尽（S/T） |
| B25 | 用户结束 Run | active/frozen 合资格且 Work/Effect 安全 → discarded/user_cancelled、释放原输入、登记清理；否则 closure_pending | 有出口，但 pending 不是已受理并必然后台结束，见 F11；suspended 依既有恢复/freeze流程，不直接 discard（S/T/H） |
| B26 | 失败/取消后显式 reprocess | 新意图触发原 Field 正常观察，准入预留到一个 Offer，新 Run 使用新身份 | 正常链 H 已验证；**所预留 Offer 拒收后资格无法重新请求：F10**（H） |
| B27 | 旧 Field 已注销/无法观察时请求 reprocess | Intent 先持久化，随后公开 Observation 可能报不可用；同键重放不制造另一个 Intent | 未产生新 Run 不能报恢复完成；旧 Field/观察失败的恢复反馈属于 U04，残余 Control 另看 F09（S） |
| B28 | Product 发布前后的旧 Run/Offer 被替代 | 旧交付身份必须被 fencing；新 Run 发布新产品；不可接受旧包来绕过当前 Basis | 当前 delivery lifecycle/Manifest A→B 资格测试通过；无证据将旧失效 Offer 单列“死包”（T） |
| B29 | Handoff B 取证/提交技术失败，尚无 Accepted/Rejected | Arca Acceptance Recovery Case；条件改变有界自动恢复或用户 retry；Control 仍在 Libra | 有恢复；自动首项阻挡 F12、32代硬上限 F13；不可称已由 Arca 接管材料（C/T） |
| B30 | Handoff B 正式 Rejected | 当前 Libra `reconcileRejected` 走 processing_failed/discard；原始输入保留，随后按 B26 重新尝试 | 当前自动出口是结束本次尝试，不能把 SSOT 的可返工描述误称代码会原 Run 无限重做（S/T） |
| B31 | Handoff B Accepted | Arca Custody/Control + On-deck Run；Libra completed，释放 Libra 席位 | 尚未入藏。之后的失败不能回改 Rejected，也不能走 Libra discard（T） |
| B32 | On-deck 空间、碰撞、文件/Placement/验证故障或执行失败 | 自动有限代恢复后保 blocked，用户 retry 同 Run/冻结 Decision；不重新 Handoff | 环境能修复时有出口；环境/产品永久不可恢复时缺非入藏终结，F04（S/T） |
| B33 | Final Product 已验证，但 Input Settlement 未获授权 | 在原 On-deck 等 standing authorization，授权后逐成员取 Approval、处置/验证再 Commit | 是合法等待；用户永不授权时流程永不 Commit，属于待决业务选择 D04，不是后台重试缺陷（S/T） |
| B34 | Related/原输入映射或真实 Effect 无法证明收敛 | 保留当前 Arca 责任，拒绝伪造完成；根据精确 Effect 恢复 | 若永久无法证明，仍是 F04；不能用删除记录或 Reset 假闭合（S） |
| B35 | 所有 Inventory/Control/处置 Evidence 合格 | Arca On-deck Commit 才建立/扩展 Shelf Entry 和 Deck Fact；Libra 读取真实 Commit Receipt 形成成功结果 | 唯一入藏成功终点（T；本轮不追加真实媒体完整 Commit 演练） |
| B36 | Commit 后 Workspace/目录清理失败 | 已入藏事实保持，各 Owner 继续清理责任 | 是残余清理，不是电影未上架。UAT-322 等历史问题不得混入本专项首次归宿计数（S） |
| B37 | 用户明确排除材料、以后撤销 | 已有 `ExtractionPolicy.excludedMaterialKeys[]` 可阻止将来选材；不会自动结束既有 Selection/Libra/Arca 责任 | 前置排除机制已存在；在途排除、撤销及再进入衔接合同仍欠闭环，F05/D01 |

### 主要判定原因到业务出口的映射

这里列出控制选路的 closed reasons 与阶段结果；底层文件系统、Provider、Executor 的技术错误统一先落到所属 Work 的 waiting/failed/Effect recovery 分支，不把每个异常字符串虚构成新业务归宿。

| Owner 判定来源 | 实际 reason / 结果 | 对应出口 |
| --- | --- | --- |
| `extraction-eligibility.js` | unknown：`policy_unavailable_or_invalid`、`control_projection_unavailable` | B03，恢复正式证据后重评 |
| 同上 | `field_inactive`、`not_observed_in_current_terminal_work` | B01/B04，Field/存在性条件；不是失败历史去重 |
| 同上 | `outside_procurement_region`、`selection_conflict`、`control_not_acquirable` | B05/B06，追到实际 Owner；退休 Field 特例 F09 |
| 同上 | `policy_material_excluded`、`policy_directory_excluded`、`policy_directory_not_included`、`policy_extension_not_allowed`、`policy_size_below_minimum` | B04/B37，配置排除或范围限制；不得误报已上架 |
| `triage-contracts.js` 的 STRUCTURE_REASONS | `probe_not_media`、`no_video_stream`、`non_positive_duration`、`content_profile_unresolved`、`conflicting_season_claim`、`episode_claim_unresolved`、`disc_structure_incomplete`、`disc_multi_title_unsupported`、`disc_non_primary_title`、`triage_unit_contract_too_large`、`structure_ambiguous` | B09，逐成员未成包 Evidence；附属 disc title 不是另一部电影。BDMV assessment 未就绪先转换为对应结构原因，不将所有 Triage 失败解释成损坏 |
| `procurement-run-creator.js` | `procurement_selection_scope_too_large` | B07，不建 Run，区别于已建 Run 的 triage_unit_contract_too_large |
| `intake-rejection-contracts.js` | `candidate_contract_invalid`、`candidate_material_identity_changed`、`candidate_material_unavailable`、`candidate_material_unreadable`、`candidate_control_scope_unavailable` | B14，正式 Rejected 后 guard 释放并回普通新轮次；与 B13 技术 Work 失败无 Decision 区分 |
| `intake-process-coordinator.js` / `run-outcome-store.js` | `PREDECK_PIPELINE_FULL`、`PREDECK_PIPELINE_SUBJECT_PENDING`、`LIBRA_FAILURE_CONDITIONS_UNCHANGED` | 分别 B11 容量等待、Subject 解析待准备、B12 同条件抑制；不得都显示成需要无限等候 |
| `routing-contracts.js` / readiness | `routing_policy_unavailable`、`higher_priority_rule_unknown`、`no_matching_shelf`、`manual_target_invalid`、`target_shelf_inactive` | B17，配置/有效输入/明确手选；技术 Work 终态失败另归 B18 |
| `acceptance-spec-context-reader.js` | `routing_not_resolved`、`shelf_standard_unavailable`、pending_perception、`no_pending_episode_delivery` | B19；最后一项是 Series 当前没有待交付集范围，不得把已完成范围再算阻塞 |
| Libra Run lifecycle/admin | active、suspended、frozen、superseded、discarded、completed；`processing_failed` / `user_cancelled` | B21–B26；completed 只是交付结束；真实成功还需 B35，不能直接统计入藏 |
| Handoff B acceptance | identity / metadata / structure / mandatory_media / space 五类 typed check，以及 Inventory feasibility、Basis/Control fences | typed 不合格走 B30；取证/commit 技术失败走 B29；Accepted 后才进入 B31，不能跨边界重用前置 rejection |
| Arca On-deck | ready / offloading / blocked / committed；awaiting_authorization / target reservation / Effect recovery | B32–B35，按固定九阶段追溯；冻结目标及部分物理动作决定能否恢复，不能只看 Run 状态字 |

### 新确认的业务问题

#### F07：无 Run 的 Subject，没有实现合同规定的放弃出口（H）

触发：Handoff A Accepted 后尚未产生 Run，例如没有路由配置。SSOT §6.4.3 允许显式放弃该 Pre-deck Scope、终结 Subject 并释放 Primary Control；数据库也定义 Subject abandon Decision/Receipt。但实际 facade 初始化成 `unavailable` 后没有覆盖这条 route，公开 POST 返回 **503 / CLEAN_FACADE_NOT_IMPLEMENTED**。

Host 证据：成功创建 Subject，Run 数 0，Control=Libra；POST abandon 返回上述 503；随后补正常 Routing Policy 可建立 active Run。这证明“继续整理”路径存在，而“到此为止”的既定业务出口缺失。不能通过在 UI 添加按钮独立修好。

依据：[create-clean-facades.js](../../../../media-service/src/helix/composition/create-clean-facades.js)、`route-inventory.json` 的 subject abandon 路由、SSOT §6.4.3/Subject abandon tables。当前产品目录检索没有 Subject abandon Owner 实现。无 Run 的技术失败叠加此缺口时，用户更难退出。

#### F08：Run 之前的终态技术失败被持续视为 pending（C/S）

三个独立关口有同型分支：

1. [intake-process-coordinator.js:153](../../../../media-service/src/helix/domains/libra/application/intake-process-coordinator.js)：Intake evidence 非 succeeded 就 `evidence_pending`；acceptance/rejection 同样只看 succeeded。失败取证仍占预留席位，Candidate guard/Procurement Control 不结束。
2. [routing-process-coordinator.js:109](../../../../media-service/src/helix/domains/libra/application/routing-process-coordinator.js)：NFO、provider、routing basis 非 succeeded 就 pending。对应 Work ID 只由冻结 subject/policy 等依据决定。
3. [acceptance-spec-coordinator.js:27](../../../../media-service/src/helix/domains/libra/application/acceptance-spec-coordinator.js)：basis Work 非 succeeded 就 pending。

`work-admission.js::replay` 返回原 Admission Receipt，不把终态 Work 重新执行。运行时 `domainReconciler` 对 Intake acceptance 的三个已知 stale code 有特殊 replan，对 Spec 已知 stale basis 会重新 reconcile；**此结论针对不满足这些专用恢复分支的真实终态失败**，不是声称所有 stale/暂时失败都会卡死。

C 验证分别输入已经 failed 的取证/routing-basis/spec-basis Work，连续两次 reconcile 都得到同一 Work ID 的 pending；Intake seat release 次数为 0，Routing/Spec 第二次 Admission 明确 replayed。相关配置改变有时能生成新 Work；Intake 的不可变 Candidate evidence basis 尤其不能仅靠网络/权限恢复产生新 Work。正常 same-condition Retry/终止出口缺失，属于实现问题，不是正常资源排队。

#### F09：已退休 Field 的残留 Control 阻断新来源开采（H）

最短复现：文件 → Triage 无法成包 → sealed/triage_failed，Selection released 但 Procurement Control 保留 → 注销 Field → 同目录/同材料新注册 Field → 新来源 `ineligible/control_not_acquirable`。

Host 实际输出：旧 Field=deregistered、新 Field=active；材料 Control 仍为 `procurement/material_field/旧 fieldId`；新来源已观察到材料但无法开采，runtime errors 为空。修复 Probe 不能改变“另一 Field 控制”这一准入事实。

[material-field-store.js:168](../../../../media-service/src/helix/domains/procurement/persistence/material-field-store.js) 注销只改变 Field status；[extraction-eligibility.js:116](../../../../media-service/src/helix/domains/procurement/model/extraction-eligibility.js) 拒绝另一 Field 的 Control。SSOT §3.8.5/§6.8 的“注销不取消已建责任”是已决定的保护规则；这里缺的是 **已经 sealed、没有活跃 Selection/交付的保留责任如何收口**，不能据此全量释放尚在途 Control。该例同时落入用户两类 concern。

建议方向仅供讨论：由 Procurement 处理退休 Field 中精确无在途占用材料的退役/释放或合法承接，所有活跃/已交付范围继续保留。未授权修改该合同。

#### F10：重新尝试资格被拒收 Offer 消耗后，不能再发新意图（H）

实际链路：

1. Run1 被用户放弃；原文件不变的新扫描产生 Package2，但因同条件被抑制。
2. 暂时把测试文件移出来源，用户明确 reprocess。Libra 把该 Intent 预留给 Package2 的 Offer；Intake 因原材料不可取得正式拒绝它，没有建立 Run2。
3. 将同一个文件移回原位置（inode/字节均保持），普通扫描产生 Package3。
4. Package3 持续受旧结果抑制，Control 在 Procurement；使用**新的幂等键**再请求 reprocess 返回 **409 / LIBRA_REPROCESS_ALREADY_REQUESTED**。库中仍只有旧 discarded Run。独立第二次运行在 Package3 出现后额外等待 35 秒，结果相同；持续抑制的判断同时由下述稳定预留/准入分支支持，不单靠短时未推进推断。

依据：[run-outcome-store.js:159](../../../../media-service/src/helix/domains/libra/persistence/run-outcome-store.js)：每个 previousOutcome 只允许一条 Intent；`reserveAttempt` 永久绑定其第一个 Offer；`checkReentry` 不为该 Offer 已正式 Rejected 的情况释放/结束预留，也没有新 Run outcome 推进 previousOutcome。正常拒收回到普通开采的合同与这条预留限制组合后形成缺口。

这是“文件已恢复、用户再次明确要求处理，系统仍挡住”的业务缺陷。不是 F02 的按钮缺失，也不能建议用户改文件字节来绕过。相关要求/环境再次产生另一条自动变化资格可能绕开，但不构成原手动处理流程的合法完整出口。

#### F11：closure_pending 不是持久的用户终止请求（S/T，待决定语义）

[libra-run-admin-service.js:422](../../../../media-service/src/helix/domains/libra/application/libra-run-admin-service.js) 先检查并取消 Work；若仍 draining，返回 `closure_pending`，此时没有持久 Discard Decision/Receipt。现有 `p9-run-lifecycle-store.test.js` 明确断言未结束 Work 时 Decision 数为 0，等 Work 安全后由调用者再次执行 discard 才落终态。

UI 明确让用户“稍后重试”；当前并没有承诺一次点击后后台必定完成同一个 user_cancelled 意图。取消后的 Work 可被协调器读成 `work_cancelled`，Run 仍未结束，原 Control 仍持有。已有第二次命令出口，所以不算永远无解；但若本次用户决定应持久受理并自动收尾，就需要明确对应合同。不能把 pending 当作已放弃，或让用户退出对话框后默默失去终止意图。

#### F12：Arca 自动恢复总检查首项，使后续符合条件者不能自动推进（C/S）

后台 `acceptance-technical-recovery` 为每条 Case 调用 `recoverAttentionCases(1)`；[on-deck-process-coordinator.js:339](../../../../media-service/src/helix/domains/arca/application/on-deck-process-coordinator.js) 又从全部 attention Case 的第一条开始取 1 条，再判断条件。第一条条件未变/自动额度已用时，被枚举到的后续 Case 也只会重复检查第一条。

C 验证建立按 offerId 排序的 a/b 两条：a 条件未变、b 的 failedTrigger 与当前 trigger 不同且未使用自动额度。调用两次均返回空，b 留 generation=1。独立手工 Retry 仍可用，所以分类为**自动推进缺陷，有人工出口**，不夸大为绝对永久死包。源码后台入口在 `create-procurement-execution-runtime.js:1197` 附近。

#### F13：Handoff B 验收的人工恢复也被 32 代上限永久拒绝（C/S）

[acceptance-recovery-store.js:94](../../../../media-service/src/helix/domains/arca/persistence/acceptance-recovery-store.js) 在区分 automatic/user、检查条件变化之前就拒绝 generation≥32。C 验证真实 Store 连续创建并失败 32 代后，即使新的明确用户请求且 trigger 已变，仍抛 `ARCA_ACCEPTANCE_RECOVERY_LIMIT`。

这个上限发生在 **尚未 Accepted 的验收 Offer**，材料仍属 Libra，不能与 Accepted 后的 On-deck 自动 3 代预算混淆。当前 Libra active Run 在安全且未 Accepted 时有 discard API，可结束该轮再从原输入新尝试；因此不是所有业务出口都不存在。但 UI 会优先提供验收 Retry，不能继续向用户展示永远失败的恢复动作。需要确认硬上限是单次自动预算还是同 Offer 的终身预算，以及耗尽后正式转哪条 Owner 路径；不得直接解除所有预算。

#### F14：成包前容量关闭原因没有成为可维护的结果（S/T）

[procurement-run-creator.js:167](../../../../media-service/src/helix/domains/procurement/model/procurement-run-creator.js) 对超大不可分目录/BDMV Scope 返回 `closedGroups`。Automation 继续返回该数组，但运行时 Observation 完成分支只消费 `created.runs`，没有将该关闭原因写成一份用户能查询/维护的失败 Run。材料可能仍 eligible、包数为零。

现有 1024 边界测试证明它是明确合同限制，不是随机丢片。业务上可以调整目录/选择范围；产品入口却无法告诉用户“正常影片是因 Scope 过大未成包”。归为结果记录/用户可发现性缺口，不假称需要取消 1024 安全界限。

### 第二层：缺失或不完整的用户入口

此层不改变上面的业务分类。仅源码检查，不宣称浏览器走查 PASS。

| 编号 | 业务能力 / 当前用户路径 | 缺口 |
| --- | --- | --- |
| U01 / F02 | user_cancelled 后 backend 支持 reprocess | 历史映射为 user_abandoned，Ended 行及 RunOutcomeDetail 不开放对应处理；用户无法从该放弃历史直接重新整理 |
| U02 | Procurement 有 `actions/retry-failed-preparation`、一次性 Intent 与消费实现 | 当前 MaterialFieldsPage 只有来源/扫描/席位/统计/路由等操作，web 客户端未找到该失败准备重试调用。普通扫描不等价于重试，同条件 Triage 失败材料实际没有通常可用入口 |
| U03 / F01/F14 | 文件 Eligibility、Control、未成包/Package/Run/Commit 分别有 Owner 事实 | 没有完整文件级归宿查询；累计 Accepted 是 A，不是入藏；超大 Scope 甚至没有失败 Run 可进入详情。600 包列表也找不到第 601 个从未成包的文件 |
| U04 | reprocess 先保存 Intent，再请求原来源观察 | 若原来源不可用或观察终态失败，需展示意图是否仍待消费、何处失败及下一有效动作，不能以 API 已受理等同新 Run 已成立 |
| U05 / F07 | 无 Run Subject abandon | 后端未实现；属于业务缺口在 UI 的表现，不能仅补按钮 |
| U06 / F03 | 被 Libra 历史抑制的 Candidate | 来源仅“等待接收”，无法区分暂满与明确需要新意图；缺面向材料的激活入口 |
| U07 / F13 | 验收重试代数已耗尽 | 重试可用性需要表达真实 Owner 资格与替代出口，不能始终提供同一个无效动作 |
| U08 / F05 | 精确 materialKey 排除/撤销与在途终结 | Policy schema/API 能表达排除不等于用户已有逐材料排除管理；当前来源页的目录排除也不结束已有责任 |

### 待用户逐项决定的业务合同

以下是需要决定的业务结果，不是待批准的实现补丁；SSOT 尚未改写。

| 决策 | 具体问题 | 建议讨论边界 |
| --- | --- | --- |
| D01 尝试结束与材料排除 | 结束本次尝试后，材料默认回到什么待处理状态？“不再收录”作用于精确物理材料、位置还是未来版本？撤销后是否直接获得一次新处理意图？ | 保持两个独立意图；承认已有 materialKey 精确排除机制，补齐在途相交与撤销语义；不能默认排除所有未来同路径文件 |
| D02 重试资格何时用完 | 请求重试 → Offer 预留 → A Rejected，算不算已经发生了用户要求的下一次处理？ | 建议允许明确失败的预接收尝试结束后重新发起新意图；同键幂等和在途互斥继续保护，直接解决 F10；不倒改拒收历史 |
| D03 退休 Field 的闲置责任 | 已 sealed/拒收、没有活跃 Selection 的 Control，Field 注销时如何合法释放或移交？ | 活跃 Procurement/Handoff/Libra/Arca 责任保持；只对 Owner 能证明没有在途占用的范围作精确收口，解决 F09 |
| D04 Arca Accepted 后无法或不愿继续 | 输入永久丢失、目的地永久不可用、部分 Placement/Settlement 已发生，或者用户永不授权清理时，能否结束为未入藏？ | 必须由 Arca owning contract 定义物理残局、保留/返还材料、已发生 Effect 与残余义务；不回改 Accepted，不造 Entry，不用 Libra discard/Reset。若决定必须继续到 Commit，就必须接受某些材料会无限期保责任的业务结果 |
| D05 等待与终态的边界 | 无 Run 未决、长期资源等待、无法安全完成 Effect，哪些必须保等待，哪些应结束本次尝试？ | 不以固定超时假造不可达；每类等待要有真实解除条件及适用退出资格。F07 已有合同可实施，不必重新发明 Subject abandon |
| D06 放弃是否一次受理到底 | 返回 closure_pending 后，是否由后台保留并完成同一用户终止意图，允许关页面/重启？ | 现在要求用户重发，需明确是否改成持久请求；未决 Effect 的安全边界保持，不能先释放再慢慢清理 |
| D07 自动与人工恢复预算 | 验收同 Offer 的 32 代上限是否应同时封死后续人工意图/环境已修复的恢复？ | 自动有界不必等同人工终身封锁；若保硬上限，耗尽时必须显式引导合法终结/新尝试。F12 是现有自动遍历实现问题，无需改变 Owner |

讨论顺序建议：先 D01/D02 确定“结束、排除、再次尝试”语义，再 D03/D04 收口 Owner 责任，最后 D05–D07 定义等待与恢复。F07/F08/F12 可在既有 Owner 内规划修复，但用户当前只授权审查，本轮不实施。

### 关键验证与限制

本轮新增正式 Host 三条均通过：

| 临时脚本（系统 TEMP） | 已证明结果 |
| --- | --- |
| `shelfdeck-no-run-audit-20261021.cjs` | A Accepted/Libra Control、0 Run；abandon 503；补路由后正常建 Run |
| `shelfdeck-retired-field-audit-20261021.cjs` | Triage failed/sealed → 原 Field 注销 → 同目录新 Field 已观察但 control_not_acquirable；旧 Field 保 Control |
| `shelfdeck-retry-rejection-audit-20261021.cjs` | 原包 accepted、重试包 rejected、恢复后新包 open；只有旧 discarded Run；新键 reprocess 409；同 inode/字节 |
| `shelfdeck-terminal-coordinator-audit-20261021.cjs` | 五项 C 验证：Intake/Routing/Spec failed→pending、自动恢复首项阻挡、32代后新用户意图/新条件仍拒绝 |

运行方式：在 `media-service` 为 cwd，`node <对应绝对TEMP脚本路径>`。所有脚本使用独立 `mkdtemp` 数据及 `finally` 关闭 Host/kernel、删除自己创建的临时目录；没有长期服务器或生产文件操作。Arca fixture 第一版漏传 `incidentKey:null`，触发 Repository 参数校验；补齐 fixture 后五项全通过，该准备错误不算产品故障。

脚本 SHA256（仅为本轮可追溯性，TEMP 不承担仓库长期资产保存）：

~~~text
shelfdeck-no-run-audit-20261021.cjs                 0b4613b4bce0405e3086a49d60a512ae3a4554fb277a7c86ba28c81ab2fb5246
shelfdeck-retired-field-audit-20261021.cjs          7c22b508ccc9d82448a01ae3cadbc86cac0767dd6a7e7adddfd6d8c761d98151
shelfdeck-retry-rejection-audit-20261021.cjs        b5a6bd06c2c73ac7fb13876d3b8c61e61bfbc5416133d5fa5cddbe74604cc2ca
shelfdeck-terminal-coordinator-audit-20261021.cjs  7b0cb58fb983031724828778c9d870eccecd5c3f36854107c1c9264a61f8e433
~~~

本轮现有定向测试两批 **90 + 30 = 120 pass / 0 fail / 0 skip**：

~~~text
node --test test/helix-architecture/p7-extraction-eligibility.test.js test/helix-architecture/p7-procurement-run-creator.test.js test/helix-architecture/p7-procurement-run-coordinator-failure.test.js test/helix-architecture/p7-procurement-retry-eligibility.test.js test/helix-architecture/p8-intake-rejection.test.js test/helix-architecture/p8-intake-control.test.js test/helix-architecture/p8-acceptance-spec-planner-stale.test.js test/helix-architecture/p9-run-lifecycle-store.test.js test/helix-architecture/uat251-recovery-conditions.test.js test/helix-architecture/uat251-accepted-requirements-recovery.test.js test/helix-architecture/p10-handoff-b-ondeck.test.js test/helix-architecture/p9-delivery-lifecycle.test.js

node --test test/helix-architecture/p14-uat019-executor-terminal-closure.test.js test/helix-architecture/p14-formation-truth.test.js test/helix-architecture/p14-predeck-intake-seats.test.js test/helix-architecture/p14-procurement-retry-outbox-recovery.test.js test/helix-architecture/p9-uat131-product-delivery-recovery.test.js
~~~

这些断言覆盖资格/范围限制、失败封口、显式重试的资格与投递、A 拒绝/Control、Run 安全退出/替代/旧包 fencing、Arca 接收与 Commit 边界、恢复与状态真相。没有运行全量 Service/Docker/Linux/Desktop/browser；没有真实 Provider/FFmpeg 完整失败矩阵、未决非纯 Effect 永久毁损实景、Series/JAV 全旅程或 600 文件实盘核账。它们是后续修复验收需要的证据，不用“已完成一轮业务审查”冒充所有实现已安全。

### 之后如何对账而不隐藏未成包材料

验收分母必须先冻结来源中的物理媒体范围与观察时点，再关联成员归属与后续尝试。每项应落到：①真实 Commit；②明确合法排除/本次终止且无未说明责任；③仍在途且有 Owner、原因、真实下一条件/动作；④本轮发现的无效等待/错误准入/缺失退出。第二类还要继续区分“此轮结束”和“材料长期不再收录”，不能把所有 discarded 当永久归宿。

同一材料的新包/旧包、新 Run/旧 Run 要沿精确已有 provenance 归并展示当前责任，保留历史；不建立跨域全局媒体 ID。包未形成、材料被政策排除、旧 Control 仍阻挡的情况不能从分母消失。待处理并不要求立即成功上架，但不得靠无限重试、改源文件、数据库清场或删除历史才有出口。

## 2026-10-21 实施承接与生产建档阻塞

用户已授权整合工作区、修复专项及部署未上线增量；随后明确要求删除 NAS 的 ShelfDeck 测试、备份等残留。本节为新执行事实，前文“只审查”的限制属于当时时点。

- 本地合并：`9357688b0` 保存审查记录，`fde48ef32` 整合 `codex/us-adult` 的 `d15bdb993`；尚未推送/发布。
- 生产原版本：`helix-beta-20261020-af2257c423`，容器自 `2026-10-20T12:07:21.989Z` 运行。数据库只读检查发现两次 People registration 的 IMPORT Event 等待资源，EMBED 尚 pending，Operation 长期 preparing。
- 日志确认 SQLITE_FULL/ENOSPC；数据卷175 GiB，处置前可用约1.8 GiB（df显示100%）；旧备份/演练目录的du分配量约207 GiB，独立US Adult资格目录27 GiB，另有tar/旧镜像。du存在共享块，不能把目录数字直接相加认定释放量。验收ISO临时抽取位于同卷 `data/runtime/arca-acceptance-observation`，当时约12 GiB；它属于在用生产过程，不手动删除。
- 用户授权清理仅针对测试/备份/旧归档和停用镜像；通过 `tools/nas-ssh-config.js` 连接，先校验真实路径、符号链接、挂载与运行容器引用，再用精确路径删除。未直接编辑数据库、Reset Formation、移动正式来源或中断生产；未使用全机Docker prune。
- 释放部分空间后，两次建档请求均自动进入 completed、failure_code=null（`1792533397118`、`1792533398463`）；对应阻塞中的Arca验收Event后来failed。此证据确认生产空间/资源阻塞消退后人物流程可自行完成，不证明Arca失败和生命周期其他缺陷已修复。
- 清理完成：主应用 backups/tests/releases/data/backups、16个镜像tar、旧调试脚本；独立 shelfdeck-test/backups/releases/us-adult-qualification；两处独立测试转码/下载目录与转码盘 .prod065-preserved-20260907/.upgrade-backups。删除13个已退出测试容器及1个经package.json确认的ShelfDeck失败构建容器，移除21个未被使用的ShelfDeck旧镜像Tag及该失败构建中间镜像；仅保留当前0434b691b4da镜像的生产Tag和latest。
- 最终现场 df：数据卷175 GiB，总使用71 GiB、可用101 GiB、42%；转码卷477 GiB，使用118 GiB、可用358 GiB、25%。生产health=ok、normalSupplyAllowed=true，StartedAt与清理前一致、RestartCount=0；fnOS HTTP200，应用/系统根权限保持。既有文档中的NAS备份/测试路径现为历史记录，不再是可用恢复副本；本轮未创建替代备份。
