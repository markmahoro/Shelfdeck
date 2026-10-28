# 2026-10-28 工作区剧集与电影寻源只读诊断

最新追加：用户随后明确允许尝试线上“重新上架”。10:35Z仅对飞天大盗执行一次既有重试命令，已复现新执行再次失败；其他动作仍保持下述只读边界。详见末节，不再把整份记录概括为从未发生线上重试。

本记录是现有 Phase 的诊断 Evidence，不是新计划或生产处置授权。用户要求排查剧集异常，并核对黑水、三峡好人、登堂入室为何没有瑕疵入库。本次没有修复代码、部署、重试、取消、Reset、修改数据库或媒体；此前容量清理继续暂停，自动观察没有恢复。

## 现场与取证边界

- 生产仍为 `a2bf2d6fd3271dc3a3741e28ed42f533a59d99d4`，镜像 `markmahoro/shelfdeck:a2bf2d6fd` / `sha256:894a07fd5c178536bebecc4d3dfb3951c9d225d217c62c2c2db2c49f8f4696df`，容器 `1792e7209ca39dcd83eb64d91107803bb7bdf234103a4d5b00d4381bf1d29493`。
- 08:54Z Runtime 为 running/revision37/normalSupplyAllowed=true/error=null，Restart0/OOM=false。09:25:59.830Z 实际 attention API 200、nextCursor=null：13进行中、13 attention；后者为7条Arca共享剧资料、2条Libra frozen剧集、3条电影寻源及1条演员确认。完成列表计数不是正式收藏 Own 数量，本次没有重验完整收藏摘要。
- SSH 使用统一 `tools/nas-ssh-config.js`。数据库以 readonly/query_only 和读事务访问；重放只调用实际 Observer，不调用会写入 reconcile journal 的 Recovery Classifier。相关查询及 Observer 重放的 `total_changes=0`。未调用带缓存/AI副作用的 MoviePilot title-search。
- 原始证据保存在实施工作区 ignored 目录 `E:/my_project/emby_third_party-helix/.codex/formation-diagnosis-20261023/diagnosis-20261028-*`，不提交生产导出。主要文件为 attention-page1/final、facts-first、inputs、series-prepared、series-files、recovery-context、observer-replay-details、nfo-alias-read、failure-evidence。不得直接输出包含整季资料的巨型原始行。

## FORMATION-SERIES-PRESENTATION-RECOVERY

飞天大盗、当你沉睡时、假如…？、真探、亿万、越狱、继承之战均在 `arca.series_presentation.files.publish@1` 终结为 `P4_EVENT_RECOVERY_REALITY_CONFLICT`。逐条实际文件与当前 Observer 重放确认同一个现实阻断点，而不是只凭错误码归并：

1. Source/Assets Prepared 已成功，Workspace 的 NFO/poster/fanart 字节与冻结摘要、大小一致。
2. 正式剧根的 tvshow.nfo 已存在且完整 SHA 等于本次 Prepared NFO；正式 poster/fanart 为 ENOENT。
3. NFO 对应的确定性 `.shelfdeck-<digest>.partial` 名称仍能被目录列出和 stat，但 open/read 返回原生 `EINVAL`。初始文件探测中的 `exists:false,error:EINVAL` 表示不可读，不能解释为不存在。
4. 以真实 SQLite Event/Node/Effect/Work Result、实际 Schema Validator 和当前 Series IO 重放全部失败项的只读 `observeEffectReality`，均在 `observeWrites` 读取上述临时路径时报 `PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED / causeCode=EINVAL`，最后归为 conflict。没有执行发布、删除或恢复写入。

飞天大盗的额外只读样本：正式 NFO 可 open/read16；临时 NFO stat 成功但 open EINVAL；两者 dev=81、inode=907065、7755字节，formal nlink=2、temp nlink=1。`/media` 实际位于 CIFS `//192.168.12.45/Media`。代码使用写临时文件→hardlink到正式路径→读取正式文件→移除临时文件的协议。本次已确认实际 SMB 上的临时别名读取阻断恢复，尚未在独立 SMB 工作区复现最初 link/cleanup 的完整时序，不能宣称已证实具体服务端或内核缺陷。

需要 Arca Owner 范围内的文件发布/恢复修复及真实 CIFS 隔离回归。必须基于冻结 Intent、正式文件完整摘要和可验证的物理关联判定，不能把 EINVAL 当 ENOENT、跳过校验、盲删临时文件或覆盖正式媒体。前轮 Handle/artifactKind、Source/Artifact 端口和历史展示修复均不是这个故障。

诊断证据链也有缺口：终态 Attempt 有 evidence_digest，但没有 failure Result binding；故障证据目录读取相应 digest 返回 null。当前 Event Runtime 仅在 evidence.diagnostics 存在时落诊断文件，Recovery terminal_failure 只保留 effectId/recoveryEvidenceDigest 等字段，具体 IO 原因在展示中丢失。修复应保留安全的底层阶段/错误码，不能补造历史响应。

## 另外两条 frozen 剧集

- **欲望都市**：Run `f633c7cd…`。冻结的 S05E01 Metadata Fetch Intent 精确请求 `episode_plot`；本地相关 NFO 没有剧情，Provider 成功 Observation 也没有返回该字段，最终 `product_metadata_required_fields_missing`。Adapter 会在季列表缺所需字段时补查同一集 detail，不借用其他集或整剧剧情；本次未重新查询 Provider，也未证实其他语言是否有资料，不能称 TMDB 所有语言均无剧情。属于明确的必填资料缺口，不是这7条发布故障；是否增加语言补充或人工资料能力须按现有合同另行确定。
- **大宅门2**：Run `1ca651f9…`。Poster Acquire 成功返回 `not_available/poster_not_available`，随后的 Manifest Verification 正确返回 `required_artifact_missing`，并非图片网络下载失败。冻结来源包含剧根 poster，但它是共享剧级只读引用，不是独占季 poster。当前季图 Adapter 查询精确 season images，未找到可选季图；不能将剧根海报无条件当成季海报来宣布修复。32集本地剧情/NFO存在，另有直接媒体检验中的编码/解码差距；本次没有把全部媒体差距展开或认定只补海报即可完成入藏。

## 三条电影：有搜索结果，未选出可准入候选

三条冻结 Spec 都要求 HEVC、4K、MKV、50GiB以内以及指定高规格主音轨；原材料实际 Probe 都是1080p H.264。元数据、海报、NFO不是当前缺项。Run 均 frozen；Candidate Selection 是成功执行的 `not_selected/no_requirement_eligible_candidate`，没有本次 Provider transport failure 的证据。

| 影片 | 冻结搜索候选 | availability=available | 规格 compliant | 阻断证据 |
| --- | ---: | ---: | ---: | --- |
| 黑水 (2019) | 34 | 18 | 1 | 唯一达标项 HEVC/4K/EAC3 Atmos、50,895,362,458字节；seeders7但 unavailable、identityAnchors为空 |
| 三峡好人 (2007) | 7 | 6 | 0 | 7项均宣称不足4K，另有音轨/编码信息差距 |
| 登堂入室 (2012) | 12 | 6 | 4 | 4个达标项均 unavailable、identityAnchors为空，seeders分别1/1/7/9 |

`h1-provider-adapters.js` 中 availability 同时检查做种和身份；无 Provider ID 时用可信别名+年份核对。上述5个有做种、无Anchor、规格达标但 unavailable 的项，由当前代码可定位为标题/年份身份检查未通过，不能解释为没有做种。当前 typed Candidate 不保留原始标题/年份及具体身份拒绝字段，尚不能证明它们实际属于目标电影，或断言属于误过滤。需以已有原始缓存/日志或隔离固定输入进一步核对，不在只读生产诊断中重新调用有副作用搜索。应完善“身份不符/规格不符/无可用来源”的可审查诊断。

## 瑕疵规则的实际版本

SSOT保留了历史 V1 `external_source_exhausted` 原片瑕疵接纳条款；用户的记忆有历史依据。但是2026-09-28“UAT-251 / UAT-274 双标准统一生产与外部身份匹配”明确取代它：次级目标只条件放宽演员关系及质量保护下的实际成品体积，不放宽HEVC/容器/音轨/其他必填资料/海报NFO；不可修复的身份、音轨、像素差距不能因寻源耗尽豁免。H.264可达内部转HEVC并非自动拒绝理由；真实1080不能伪写4K或通过系统放大冒充4K。另有精确证据约束的4K修复版本资格，本次没有据此确认三条原片具备该资格。

2026-10-23 FORMATION-TERMINAL-CLOSURE 又明确：候选不足、Provider/转码失败、暂缺资料附件在有界预算耗尽后进入 attention、保留责任，不能直接 system discard 或冒充无法上架证明。因此当前不能因“寻源无可选结果”自动把这三条1080原片按4K Shelf瑕疵入库。若用户希望恢复此能力，属于重新扩展次级目标，需明确允许差距和接纳授权，不能作为修bug暗中降低现行标准。

下一步优先完成7条实际CIFS发布/恢复缺陷修复与安全证据链；电影身份排除先做原始证据/隔离输入核对，确定是否误杀后再修；两条资料/季图缺口与任何验收标准变更分别决策。本次只读诊断没有自动执行上述动作，也不以再次Reset代替修复。

## 用户后续操作核对

用户追问 attention 之后实际可以做什么。当前 SSOT §5.6.7 明确 frozen 只有放弃整理和具备资格的瑕疵接纳两个决定；不会因Provider恢复、搜索结果或Policy变化自动唤醒。FormationPage 的 frozen 行实际也是 DefectAdmissionControl 加取消整理任务，没有 frozen Run 的重试寻源、换Shelf或修改目标入口；重试整理仅处理 preparationFailure，重试上架属于另一阶段。

进一步只读 GET 三条 `/formation/runs/:id/defect-admission-candidate` 均200且 ineligible：黑水、三峡好人为 P9_DEFECT_ADMISSION_NONWAIVABLE；登堂入室为 P9_DEFECT_ADMISSION_INELIGIBLE。此时UI只显示不可接纳原因及取消任务；重新检查只重读接纳资格，不重新寻源。取消可选择不排除来源，安全收口后允许正常重采，但不保证立即发生或解决原缺陷。静候以及修改Shelf标准都不会自动恢复这三个 frozen Run。

因此不是遗漏了一个现成可用按钮：当前用户可改变方向的手段过窄，技术/寻源失败的恢复路径需要明确设计。建议讨论用户显式发起、有界且保留旧证据的再次寻源，以及明确变更目标后创建新Spec/Run；不能把它当作对旧 frozen Run 的自动解冻或偷偷扩大瑕疵资格。本次仅提出缺口，没有修改冻结合同或实现任何新命令。三份预览证据保存为 ignored `diagnosis-20261028-movie-defect-preview-{0,1,2}.json`。

## 按两层漏斗复核三部电影

用户要求逐部核对 S1。重新检查实际 Probe、冻结 Requirements、成功 Metadata Observation、全部候选及其可加工差距；没有以“requirementAssessment不是compliant”一概拒绝H.264候选。三条均有演员信息，现有原材料大小均低于50GiB，没有成功成品的质量保护体积超限证据；尚无可授权的演员/体积差距。对这三条的当前结果而言，S1仍保留与S0相同的4K及指定音轨门槛。

| 影片 | 本地Probe事实 | 可加工项 | S1仍未满足的明确要求 |
| --- | --- | --- | --- |
| 黑水 | 1920×1080/H.264/MP4，AAC立体声 | 可转HEVC并封装MKV | 4K；指定高规格音轨。重编码不能凭空补出原始画面或音轨信息 |
| 三峡好人 | 1920×1080/H.264/MKV，AC3 5.1 | 可转HEVC | 4K；指定高规格音轨 |
| 登堂入室 | 1920×1080/H.264原盘，已有DTS-HD MA及AC3音轨 | 可按合法原盘路径加工HEVC/MKV并保留合格音轨 | 4K；本次没有完整成品Verification，不能把Probe推导冒充终检通过 |

逐项递归检查当前成功Result及typed候选，未发现已绑定的editionEvidence/restored_4k证据；这不证明现实中没有修复版，但不能使用未确认版本豁免当前材料。三条当前都不能直接S1接纳。

候选可加工性复核允许已知H.264/HEVC且仅video_codec_unmet/max_size_exceeded的声明：黑水仅1项、登堂入室4项具备媒体声明可达性，均被身份门槛挡住；三峡好人没有声明可达项。现有available集合也没有只差编码/体积的可加工候选。黑水/登堂入室应优先核实身份排除；若确认同片并成功取得、实际验证达到当前Spec，可能正常入库而非必须瑕疵入库。当前仅声明，不保证下载及实际产品达标。未重搜、下载、转码、改标准或处置任何生产任务。

历史规则复核补充：9月28日确认的是完整S0→S1生产/再优化/最终验收流程，不仅是两项白名单。此前“只剩取消”描述的是这三条当前UI事实；不能用旧§5.6.7代替后续已确认的完整生产模型。10月23日attention收口修订仍需与两层资格及可用后续动作一起审查。

## 四星规格的反事实可达性评估

用户讨论按四星规格处理，未授权修改评分、Spec或生产任务。使用当前同版本 `media-production-contracts.selectCopyAudioStreamsForSizeBudget` 纯函数，输入三条冻结实际Probe，假设四星14GiB、无额外4K/高规格音轨要求；音轨仍按既有复制保留规则评估。三条均返回feasible=true、exceedsSizeCap=false。黑水原5.3865GiB，三峡好人原8.8178GiB，可保留原清晰度/音轨转HEVC/MKV；登堂入室原盘23.0266GiB，预算保留DTS-HD MA及AC3两条音轨，视频目标9,707,240bps，高于4,000,000bps质量下限，预测总量15,032,385,506字节（14GiB上限15,032,385,536字节，含容器预留）。后者原盘须先走合法Remux/实际Probe，不能直接将预算预测作为成品大小保证。

结论仅为四星目标下存在本地生产可达路径，尚未实际加工/解码/最终验证或Arca Commit。若真实最终成品满足调整后的S0，可正常入库；质量保护下最终仅体积超限时才另行核对S1条件。实际评分仍为豆瓣5星，讨论单片采用四星要求不等于修改评分；需要正式目标变更与Arca接纳/Aftercare一致性合同，当前frozen任务不会自动采用这份假设。本次没有生产写入、重新寻源或开单。

## 10:35Z 用户授权的单条线上重试与自愈缺口

用户强调应优先处理临时IO后的自愈，而不是先追究SMB产生错误的机制，随后明确表示自己点击重新上架无效，允许本任务再尝试。仅选择飞天大盗，通过与Web完全相同的POST入口提交一次请求；没有重试其他6条，没有Reset、部署、改库或手工删文件。

- 目标Subject `libra-subject-28ef982e6a224c7c367d4e019af4137d3ff53ffb`；Offer `8e5975ea343bbbe85b2b6a59b13887309ff968720330f16ac43d67050a6eff90`；原shared build `arca-series-build-ae7a6d899e3e50c247e286534973bc54c1dcf7e1`。
- 10:35:26Z前置快照：原Work `arca-series-work-ce4ca22a5d97ccafb7848b59dbada4fc83ca7d86` failed，无该build人工重试Receipt。正式NFO的SHA/7755字节/inode907065保持，临时NFO open仍EINVAL，poster/fanart均ENOENT。API canRetry=true。
- 请求幂等键 `diagnosis-hustle-retry-20261028-ded14887-d5fb-494e-a4e9-aeaaa72c600b`；POST `/v1/admin/formation/acceptance/8e5975ea343bbbe85b2b6a59b13887309ff968720330f16ac43d67050a6eff90/actions/retry`，body仅idempotencyKey。10:35:42.248Z返回202/pending，新Work `arca-series-work-eb90a3b99d3e630fb619e8a8723c83ddf8cb67e1`，同build generation2；Receipt于原始UTC 1793183740581提交。
- 新Source Event与Assets Event实际succeeded，并复用相同冻结Result摘要；Publish `series-publish-13fd20feaa1210b3706c580c`于1793183742593开始、1793183742641结束，约48ms后failed/P4_EVENT_RECOVERY_REALITY_CONFLICT，后续Inventory Commit cancelled。新失败Evidence digest `7a70afb0158c948167bccf07706b943203f3cf01ba4521750b86df860fab0922`。
- 10:35:52Z任务重新attention_required/canRetry=true。正式NFO SHA/大小/mtime/inode保持，临时NFO仍open EINVAL，poster/fanart仍ENOENT。临时路径stat的nlink由2读成1，属于现场不同读取结果，不据此声称元数据全无变化或已证明内容写入。没有正式入藏完成证据。

复核代码确认：Series `observeEffectReality` catch所有异常都返回status=conflict；Foundation据此terminal_failure，固化P4_EVENT_RECOVERY_REALITY_CONFLICT及retryDirective=never。当前代码未区分“无法读到现场，不能判断”和“成功观察到字节/身份/范围不符”；现有用户重试虽然能创建新代Work，仍进入同一分类死端。用户反映的无效重试已由真实生产新执行复现，不是请求未发送或按钮只刷新。

后续修复优先级调整为恢复语义：只读观察错误应保留可重查责任，自动有界退避、预算耗尽后显式可人工重查；只有成功观察后的具体不匹配才能判真实冲突。人工继续须重验原Scope/Intent/现实时点，成功成员复用、部分发布向前恢复，不覆盖未知文件、不把旧failed Event改成功、不无限重建Work。IO反复不可读时不得伪造缺失/成功；持久SMB特性可作为后续定位，不作为恢复机制改进的前置。此为待设计/实现事项，本次未修改观察分类或恢复合同，也未认定EINVAL一定为瞬时故障。

原始请求/响应、前后API与有限SQLite/文件快照保存在ignored `diagnosis-20261028-retry-hustle-*`。快照DB连接query_only、total_changes=0；这不否认正式POST命令及新执行产生的合法数据库写入。

## 本轮实施：Series恢复（开发资格，未发布）

已修订SSOT并实现两条独立语义：文件只读观察失败不再推导物理冲突，`observe_again`只重查原Effect、沿同一持久恢复预算、无Capability写入/Permit，耗尽后明确结束技术Attempt并由Arca保留责任与人工入口；成功观察的字节/身份/范围不符仍是冲突。已完整读取并验证SHA/大小的正式文件，与精确声明的producer temporary同时具有稳定同dev/ino/size/mtimeNs/ctimeNs时，形成可审计冗余硬链接证明；写入器不再重开该不可读别名，删除前重新检查Scope、执行资格、父路径和两个物理快照。其他inode、外来字节、符号链接或变化中的别名不得据此清理。

- Linux实际容器、真实Sharp/文件/硬链接：旧IO首跑3项1PASS/2FAIL；修复后完整15PASS。包含不同inode不可读、正式字节相同但不构成alias、执行资格撤销、证明后替换、不同临时字节负例。
- Foundation/Series Observer实际Linux批次：152项旧版144PASS/8FAIL，修复版152PASS，0skip/0fail。覆盖原Intent/Effect归属、无Dispatch、无Commit Marker、原持久预算、Host不阻挡普通供给、每次重查更新分类、真实冲突/越界仍拒绝。
- 完整Linux Host“中断后alias仍不可读→原Effect向前恢复→三项Shared Inventory→一次On-deck Commit”PASS；无额外failed shared Work。三次正式文件读失败的观察等待旅程PASS，沿真实30秒重查间隔约145秒；首次100秒夹具窗口不足失败保留，单独扩大该有三次定时重查的场景窗口至150秒，没有加速生产重试或放宽预算。正式“首次失败→用户线上重新上架→一次Commit”PASS，原失败与新执行分离，命令重放不产生第二次入藏。
- Host前置首跑在256MiB tmpfs中被真实Workspace容量门禁阻止；改用独立Btrfs作业根，保留首跑。随后EPERM注入命中既有明确failed Outcome、EIO注入被夹具当成非预期错误的两次失败均保留；改为精确可审计的预期中断后验证真实恢复，没有吞其他Runtime错误。
- 新增生产只读资格：七部全部正式NFO与冻结SHA/大小吻合，正式与temporary的dev/ino/size/mtimeNs/ctimeNs逐项相同且读前后稳定，七项positiveAliasProof=true。名单为飞天大盗、当你沉睡时、假如…？、真探、亿万、越狱、继承之战。未打开临时别名、未unlink、未改DB、未再次重试；只能证明严格恢复条件现场成立，不能冒充生产成功。

隔离容器均network none、生产不可见数据/媒体、只读源码，只挂载独立qualification临时根；均自动删除容器，失败副本与日志保留。ignored证据在`.codex/series-recovery-20261028/`：`linux-red.log`、`linux-green.log`、`foundation-red/green.log`、四次`linux-host-journey-*`、`linux-host-followups*`、`readonly-alias-proof.jsonl`；NAS独立作业根保留原始Host分场景日志和副本。未构建最终镜像、未部署、未改变生产任务；完整架构、最终版本及生产逐项验收仍开放。

季图复用已按用户后续决定实现：本季无图后依次使用已资格化同剧本地poster、同剧Provider poster，正常生产并保存closed source proof；网络/协议失败不等于缺图，本地关联变化不静默换源。原“不得借用”诊断描述当时合同，已由SSOT的SERIES-SEASON-POSTER-REUSE明确取代。实际Linux合同30PASS，本地复用与Provider复用两条完整Host→On-deck Commit各PASS；真实TMDB Handle/Secret/Adapter来源切换定向1PASS/10名称过滤skip。未据此关闭大宅门2生产验收。

## 同Episode多语言剧情补全：实现与只读现场

Libra在新Episode资料Intent中显式冻结`tmdb.episode-plot-language@1`；Platform仅对同一Provider Episode的首选语言剧情为空或空白时补充一次translations请求，使用原操作剩余时间，不自行决定另一个Provider/集/剧的优先级。按精确首选locale、同语言其他locale、原语言、英语、其余locale稳定选择；完整有界响应、错误身份、同locale矛盾剧情或协议错误明确拒绝，资料全空形成not_available证明。结果proof绑定原Provider集引用、保留的本地季集号、语言、剧情SHA及完整可用翻译集合摘要；进入Observation/Fact证据闭包。未声明此策略的资料请求仍是正常单语言合同，不补造已检查翻译的历史事实。

- Linux源码source-7合同批次298PASS/0skip，含完整Foundation恢复、资料合同/作用域、生成Schema及静态边界；完整Host的真实NFO、本地季集编号、逐集proof和一次正式Commit旅程PASS，另29名称过滤skip。
- 2026-10-28T14:25:48.619Z实际只读查询：欲望都市TMDB剧105/S05E01精确Episode1011371，简体中文剧情空，港台中文及英文等同集资料非空。新规则选择zh-HK，120UTF8字节；proof digest `1dceba8d52b95d2cdac6d8dfdab2b41a846d37ddfbbc24057d382b7ce69c2755`。不在文档复制Provider剧情全文，SQLite total_changes=0，未重试或修改任务。
- Linux source-8额外运行三个现有Movie Service文件：29项/7PASS/22skip/0FAIL，约309秒。22项因未配置隔离真实Material Field或专门场景环境变量跳过，不能称完整Service/真实源验收通过。相邻三个新模型文件16PASS。

## 外部候选身份与可用性：证据边界

只读检查MoviePilot源代码与其last-only缓存：`__search_result__`保留19条黑水相关记录，12550字节，SHA `0c3a0eb6d7872b20a247f5c719babad1f9be55b1f4b22bd02a0dcb87373cdef8`。使用不执行应用类/全局对象的受限读取，仅提取姓名/年份/媒体ID/大小/做种数白名单，不导出下载URL或凭据。以当前函数重放原冻结查询，18条通过标题/年份门槛，1条Dark Waters1993正确拒绝。这是现存缓存子集，不保证等于历史HTTP联合返回的34条；不足以证明其他被排除项全部有效或全部错误，不能推导与其他两片同根因。未调用会产生缓存/AI副作用的title-search GET。

独立代码审查发现做种数类型缺陷：`Number(null)`、空串或布尔值被误认作明确0，导致有效备用字段被忽略。通过真实Host/Handle/Secret/Adapter隔离HTTP用例先红（null+备用7得到0），修正后8组类型场景通过：只接受有界非负安全整数或十进制整数字符串，未知跳过并检查备用字段；明确0保持优先，无正数事实的候选仍不可用。修复不改变身份门槛或媒体规格，也未证实该缺陷解释三片历史失败；Linux正式增量复验继续。

## 第三层目标与People姓名查询实施边界

SSOT已完整补三层目标、并发确认、新Run替代、Handoff与Arca独立接纳/Aftercare连续性。当前代码只有要求变换与不可变预览/确认模型：精确字段及本地Episode例外、64KiB记录、actor/Run revision/Spec/决策Head/Shelf/材料/身份/目标revision绑定；旧预览变化拒绝、只确认实际展示的子集、accepted责任拒绝。原评级/50GiB/未选择要求保持。模型11PASS；首跑1项使用非法Episode键被正确拒绝，修正测试输入为正式E001/E002后通过。尚无持久Intent、正式Spec发布/新Run、API/UI或Arca消费，不能据此声称用户已能自定义入藏。

People姓名模型已接`PersonReferenceQueryFacade.resolveUsAdultName`正式只读Owner查询：单事务按100人分页读取完整active US库，精确姓名/别名优先，轻度拼写仅唯一最优返回；同名歧义、库摘要变化、完整库/工作预算超界明确拒绝。结果保留内部personId及Person revision/digest，不要求Provider身份，不写演员、Reference或影片出演关系。原生本机34PASS；实际Linux source-9总71项69PASS/2FAIL，People/模型通过，两个失败为资格镜像缺Git且未携带reuse基线对象；正在补齐独立测试镜像/精确基线，首跑日志保留，不放宽Manifest Guard。此查询尚未接Stash自动工作、建档或出演链路。

生产仍a2bf2d6fd，未部署/再Reset/生产重试。独立资格构建第一次误将本地image ID用于Dockerfile FROM，触发镜像源403且未开始apt；保留日志，改用已核对ID的本地固定tag再构建。所有Git/源码/依赖准备只在qualification根及专用镜像；不改变生产镜像或容器。最新定向通过不能替代完整固定候选、真实SMB、具体UI及正式生产逐项验收。

## source-10 Linux增量复验

已完成原Manifest环境修正：测试专用镜像`sha256:fd51005f74c069031e0e0c2fbd32fbb282ffcf61f87e1e141f5b71438a0dbf5d`由已核对的生产依赖镜像增加Git，不发布或替换ShelfDeck。精确原reuse基线`4a16f0a94ef23fcf732843e9547bd7b724d9c19d`以浅层独立bare Git对象只读提供给资格容器，不以伪造Git输出或跳过历史证据校验通过。source-10归档9888427字节/SHA `490ea0134c0f297cdbc0a29b78f93fabbe53de6c91ee7b4e94e85486a3a3955a`；基线归档1590850字节/SHA `a96477f441fb19ac54b52d8ca56e511fbdf2b2792ac9e88c68921d911f92e3e2`。传输和解压前均校验。第一次source-9归档曾在本地tar进程结束前上传，发现大小不完整后于任何解压/执行前重新上传完整校验副本；不将首次部分传输当已测试源码。

- 实际Linux包边界、禁止语义、Manifest、P2合同四项全通过，0findings；最新P2 aggregate `d52597a20dc877c4c468396192331ed31db3bb099bb46d7a617cfed4780511c3`，仍138 Capability/117 Result family/239 Table/62 Transaction/150 Domain Input，无新增数据库表或Schema升级。
- 本轮Owner/目标/姓名/传输及静态负例批次78PASS/0skip/0FAIL。原source-9两个Manifest失败保留，修正后包括同一负例在内均通过。
- MoviePilot真实Host→Handle→Secret→Adapter：3PASS（新做种数类型、原完整身份门槛及稳定候选、100候选保留/选择），22名称过滤skip；未调用真实MoviePilot搜索或下载。
- Stash私有传输7场景：源图Handle/revision/SHA/大小绑定；只POST图片字节；姓名/原名、分数/脸框、源图/服务revision及响应摘要投影；外部ID/URL不产生People身份/文件权限；无脸/无结果、歧义多脸、协议错误/超界、HTTP失败、并发占用、取消/timeout和监听器释放。上游参数沿已验证0.6/0.5阈值，无额外外部ID验证。源码尚未接正式Platform配置、Work或自动建档，不代表业务链已集成，也未启动独立Stash容器。

本机生成Manifest时首跑一次Node25原生UNKNOWN/-4094 open（shared.worker.asset.upload）后原命令重试成功，原输出保留；不是Linux产品修复或门禁放宽。全部新资格日志保存在ignored`.codex/series-recovery-20261028/linux-stage9-first-*`、`linux-git-qualification-build*`、`linux-stage10-full.log`及NAS专用作业目录。仍须最终固定代码完整Architecture/Service/Web/镜像、具体UI及生产逐条验收。

## 未知人脸推荐与认领退役（2026-10-29）

完整移除推荐列表、推荐图、认领命令及认领查询四条路由；删除两条Libra专用Public端口、People后台推荐/Claim写入器与维护扫描、UI推荐列表/来源联动建档。保留手工建档、上传图片、姓名查询、Reference维护、影片演员选择与已入藏纠错。五张历史证据表及其DTO未删，数据库仍239表；不能以当前为空替代发布前停止态责任复核。活跃Claim preparing_person/confirming_source或active_source_id非空须阻断本项发布，不能直接放弃、自动迁移或由日常启动处理。

2026-10-28T15:38:18.836Z生产只读查询五表均0、claims=[]、SQLite total_changes=0，只是现场样本，未修改生产。路由现164项（163 Admin及health），不是删表。最新P2 aggregate `3f0c172f612b748ad7cff1f94e0d1bc8cc83f24c33e84d51d465667098783c42`，138 Capability/117 Result family/239 Table/62 Transaction/150 Domain Input保持。

- Linux source-12四项实际静态门禁PASS；受影响Service/Owner/模型78项，76PASS/2既有skip/0FAIL。该批次早于通用人物404与Host夹具修正，后续增量按单项记录。
- 真实Host旅程首次缺只读源码内的YUNET许可证，补入已有跟踪许可证；source-13第二次发现退役列表URL被通用人物详情匹配，返回200/null。修正通用人物不存在为PEOPLE_PERSON_NOT_FOUND/404，并补原有认证HTTP回归，不添加旧URL兼容分支。
- source-14第三次实际跑至维护退出后人工登记，因持久维护phase仍settling收到RUNTIME_MAINTENANCE_WRITES_DISABLED。夹具增加有界等待真实normalSupplyAllowed及maintenanceActive=false，未放宽运行屏障。source-15真实Host旅程79.5秒，1PASS/5名称过滤skip：两部真实合成视频完成分析，四个旧接口404；跨维护窗口/重启五表仍0且无自动登记；手工登记并选择第一部后仅一次On-deck Commit，第二部仍active且无演员选择head。
- source-15源码包10,252,002 bytes，SHA `00361a2e8f78dc9d2ffb455c9849c5a4073fc4031f3931511ce8e3f318aaa893`。测试使用既有独立Git/CPU模型镜像、隔离SQLite及良性图片，无生产媒体/数据库挂载，无外网。
- 本机四个UI定向文件33PASS；入口/Surface批次首轮27PASS/7FAIL/2skip，修正仍写168的readiness断言为164后34PASS/2既有skip。只算开发反馈。
- Linux Web首次脚本未创建、第二次只读Vite缓存目录不可写，修正为专用有界tmpfs；第三次47套中45套/252项PASS、两套因scratch父目录没有Service源码加载失败。source-14补只读Service src挂载后仅复验这两套14PASS，tsc/Vite构建通过（既有574.20kB chunk告警）。合计47套266项已分别通过，但不宣称首次全量全绿。

NAS qualification目录保留stage12/13/14/15原始失败与成功日志；源码归档均SHA校验后独立解压，不修改旧快照。具体浏览器/最终版本UI负责人、停止态责任预检自动化及全量固定候选仍待完成。此检查点不是最终发布，不改变生产a2bf2d6fd，不Reset或重试任何生产任务。

## 自定义目标持久化及新增表副本准备（2026-10-29）

Libra新增`libra_custom_target_previews/intents/heads`，完整模型、命令身份与Header绑定、64KiB上限、必填列和subject/product scope/revision/intent/digest复合FK；不可变Preview/Intent与按范围CAS Head分离。原239个表的sqlDigest与e1bd7315c逐项比较changedOldTables=[]，新表3个，未改变旧表或加运行时迁移分支。当前242表DDL digest `9c6af0d89160d0b061dff9f86c7bdaf43151adb164eba558d0433933ff58577e`，未形成最终发布身份。

Foundation Command preflight在BEGIN IMMEDIATE后的Receipt检查之后、任何Owner写入前验证同UOW opaque read fence。当前view通过；同连接写入、外部SQLite提交、伪造/跨UOW token拒绝；已提交Receipt重放不受后来view变化阻断，body变化仍幂等冲突。不引入Arca/Perception Repository或全局业务revision。Store额外核对Run/state revision/state+execution digest、Spec/decision head、原始requirement JSON、material member_set_digest、resolved_identity revision1 Fact及当前目标revision；记录确认仅为Intent，绝不是Spec发布或入藏。

- Linux source-17四项实际静态门禁通过，13文件94PASS/0skip/0FAIL，覆盖P2/P3/DDL/Owner contracts、原子Receipt/Audit与目标Store。归档10,266,675 bytes，SHA `0d746080c70a61195d59ec94cd8c8955e7575a85c1f2b1d93a60705932af8bc7`。首轮source-16因新增模板插值不被P1保守CommonJS扫描器接受而拒绝；改字符串拼接，SQL生成字节保持，不放宽扫描器。
- Store新增确认基线requirement JSON与实际冻结Spec一致后，source-18该7项通过。另独立副本工具首跑3PASS/1FAIL：目标验证后测试自身readonly SQLite读取创建WAL/SHM，最终目录断言错误归因给准备器。把“准备器不留下sidecar”的断言放到测试额外打开目标之前，未改变副本准备行为；保留原失败。
- source-19四项实际静态门禁通过，7项Store+4项副本准备=11PASS/0skip/0FAIL；归档10,270,520 bytes，SHA `f637f53fa13310e0018e1406dd51dd64f3b13d724153868b16290cff46f71b6c`。两个actor并发确认revision0只准一个；二次明确确认推进revision2、旧记录不变；真实外部写入/Owner相关变化/未展示修改/Result中断不留下目标、Receipt或Audit。

新增通用`additive-schema-snapshot.js`只接受显式新增表清单、精确源/目标DDL及所有旧表/索引定义不变。源必须是无sidecar的独立单链接快照；先容量预算（3×源大小+512MiB），复制到私有验证区后只在副本打开SQLite，原快照完整SHA及物理快照前后保持。完整源验证、逐表stream copy与行摘要比较、新库完整FK/integrity后排他发布独立目标，返回prepared=true/applied=false。Linux验证239→242、238张原数据表（marker由目标建立）、原行类型/文本不变、新表为空；既存目标、源alias/sidecar、空间不足及复制中断均拒绝且无输出/临时残留。它不是运行库升级器、Reset或切换完成证明；真实停止屏障、完整备份、租约、生产全量副本和发布切换仍需接入并验证。未加入生产镜像/执行本工具，生产239表保持。

本机首次Store测试因先写Run外键再写Spec失败，调整夹具建立顺序；第二次错误预期业务校验先于Receipt幂等冲突，按既有Receipt优先规则纠正断言。未弱化FK或幂等。最新P2 aggregate `99c5fe2638335abcd1213188f71ffb4ddb5afe95b77c7c27aebd8b83088f2e94`，Capability138/Result family117/Table242/Transaction62/Domain Input150。完整固定候选/新Spec与Run/Arca/UI/实际生产副本尚未完成，不能发布此中间Schema或开放自定义入口。

## Custom Spec解析与内部Publication事务（2026-10-29）

预览Basis现在分别冻结当前Run Spec、原始标准Spec和Decision Head当前pointer；首轮标准→custom相同引用不再掩盖后续不同引用。模型从真实P8标准Resolver生成的Spec重建draft/semantic/record/ID闭包，拒绝未知字段、原始记录漂移或以custom Spec递归当作原标准。新variant保持六类Requirement及原Product Scope，包含targetKind=user_custom、原始要求、closed Intent/Preview引用、targetInputDigest、逐集metadata override。只取消4K+指定音轨时50GiB/HEVC保持；只取消一集剧情时全季通用episode_plot及其他集要求保持。不同用户确认的同样实际要求有相同semantic digest、不同provenance/record/Spec ID。此处是模型与Store资格，不是已完成生产。

独立`custom-spec-publication-store`实际验证当前confirmed Intent/目标Head、当前Run/Spec/Decision Head/材料/身份及新鲜外域公开Projection Basis；opaque fence验证在同Owner事务写入前。新Spec、Decision Head CAS和Command Receipt/marker/Audit原子完成，原始Spec与Run不改；异常发生在全部写入后仍全回滚。相同命令在后续Run完成、Arca已接纳或原token变旧后重放同一Receipt，不再发布第二个revision；不同Intent digest仍冲突。Reader按完整关系Header及原标准/Intent重建记录，不用可变head读历史。Supporting Work和API尚未调用它。

Canonical Catalog新增两项：Custom Target Commit（Preview及精确Confirmation override）与Custom Acceptance Spec Publish，合计64 Transaction；不修改普通四表Spec Publish的ready Basis规则。标准Spec查询显式筛选已声明variant；新增P8真实持久化回归用同Basis标准/custom两行及reverse_unordered_selects，确认custom先返回时标准重放仍返回原ID，不按SQLite顺序选择。

- source-20：前一增量60PASS/0skip，含模型、Store、读屏障、独立副本/P2和P8原规则；SHA `235f171a97e72d082c596b3e8776c395dba73a19a2576649e8dc8005724beace`。
- 本机事务生成首跑遗漏exact variant的fixture/selector元数据，生成器拒绝；补完整定义，没有放宽生成器。原Validator仍固定62及精确selector未登记、测试仍指向旧062 shard而失败；只新增精确Libra confirmation selector、更新当前库存，并补外域command selector负例。通用崩溃fixture只证明Preview SQL Header/原子性，完整closed业务语义另由实际Store测试覆盖，不冒充完整流程。
- source-21首次Linux静态阶段由forbidden-semantic guard拒绝：既有精确豁免仍指旧entries-001-062.json。仅把同一豁免定位改成新entries-001-064.json，规则和允许语义不扩大，失败日志保留。
- source-22归档10,288,877 bytes，SHA `ced418f4abe91c8f23febaaa3b8128de06e8e9666fb2860a672221031b29bedf`。实际Linux四项静态门禁PASS；12个文件91PASS/0skip/0FAIL，另Canonical新增事务/库存定向7PASS/202名称过滤skip/0FAIL（32.1秒及11.4秒）。不声称完整64事务或全量Architecture已重跑。
- 原239表sqlDigest无变化，三个目标表DDL及总242表DDL digest仍`9c6af0d89160d0b061dff9f86c7bdaf43151adb164eba558d0433933ff58577e`。最新P2 aggregate `a52686fa2086042ae1dec0932ba1fedccb464acae7ef9f7954e824c983950197`，138/117/242/64，150 Domain Input。

明确剩余：确认后的旧Run提交资格撤销/未接纳Offer失效、Supporting Work/新Run、逐集元资料与Conformance/NFO、Arca/Inventory/Aftercare、精确保留闭包、API/UI和实际停止态生产副本升级均未闭合；禁止开放内部方法为用户功能或发布本中间版本。推荐退役最终UI/停止态旧Claim责任门禁仍待收口。生产仍a2bf2d6fd，无新部署、Reset或任务处置。
