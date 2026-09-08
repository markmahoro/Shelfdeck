# Aftercare健康检查与实际维护分离：实施证据

2026-09-08。本报告记录本地实现和验收；生产部署结果须另外追加，不能用本报告替代上线验证。

## 合同与实现

- SSOT直接事务行和新增修订已同步：Case Creation先queued，实际Inventory Commit通过Receipt衔接原Case，独立Inventory Record Refresh Commit不创建Case。45个Canonical Transactions；113 Capability、99 Result family、187 tables不变。
- 健康投影区分健康事实与维护状态。queued为红灯、active为黄灯；自己的Inventory提交后，结算和复查仍关联同Case；只有重新验证健康并结束维护后转绿。未知状态为灰灯。
- Case Creator拒绝空目标、仅记录更新和未支持目标。已提交的健康检查可以直接进入Case准入，不因下一次周期未到而卡住；精确Assessment Work及Evidence仍是建单依据。
- 每日Custody发现新可修复缺口而Presentation/Conformance证据较旧时，按Custody Evidence去重取得一次完整检查，不等七天。过去的unresolved Case不得压住其后新取得的完整健康证据；只有三个维度均在失败之后验证健康才转绿，旧Case历史保留。新完整检查确认仍需处理时，可按新触发建立下一次Case。
- readable NFO指纹变化走Arca内部RefreshInventoryRecords命令。新Inventory/精确Control变更/Command Receipt/marker/audit原子提交；冻结Source Package/Facts/人物关系保持不变，没有文件写入、Supporting Work、Workspace或Case。
- 提交重验Entry/Shelf、Inventory/Standard/Placement/Identity、active Case、Off-deck Reservation和文件stat/fingerprint。Control冲突与外部再次写入导致整笔回滚。同输入重放原Receipt，无变化不增加revision。外部恢复原字节但旧Finding尚在时，进行按Basis、Finding kinds和周期去重的健康复查。
- 三条既存NFO queued Case由新规则的精确记录更新及Basis失效收敛，不新增常驻历史格式兼容。未取得席位的失效记录不进入已维护历史。
- 健康检查不运行FFmpeg试编码；使用当前Probe和Platform已验证设备能力形成结构策略Evidence。真正编码、播放验证和失败处理仍位于取得席位后的Case，受encoder/volume Governor约束。
- 维护列表在Arca Repository分页和计数，queued不进入列表/统计/分页。Case详情按精确Case Requirement或reassessment cycle选取Work，再读取其真实Plan/Event；进度摘要只读该Case的prepare Work。
- Foundation进度读取按Event的current_progress_revision与精确Event集合查询，不再加载全部历史采样。Shelf要求变更HTTP入口仅唤醒，实际Entry检查由持久、有界巡检处理。
- 整理列表新增任务类型列，九列宽度合计100%；维护与上架详情共用ProcessDialog和ProcessStages，保持原有Libra详情样式。收藏详情删除重复灯，保留健康文字/Evidence及指向同Case的维护链接。

## 本地验证

- 完整架构Gate通过，214个Fixture文件通过；Source Map/Capability/Domain Input/Result/Table/Transaction派生已重新生成。
- P2 aggregate digest：`8e289cf619081a5745fe4d07d0bc02d0f16b04a2c9a569d3f94ac213bdfaea6a`。
- DDL字节digest保持`642c62d6d55e95ce31a097435ae7052c26d0ea5b65d049d90c724522db204784`；本次没有新增列或索引。
- 最终独立service重跑500通过、18跳过；前端44通过并构建成功。此前并行执行完整架构Gate时，service的200ms FFmpeg watchdog时间敏感测试超时一次；未放宽测试或生产超时，独立重跑通过。共享弹层调整后的前端44项测试与构建也通过。
- 22项定向测试覆盖100 Entry单席位排队/重启、检查不执行encoder、NFO复查去重、Case/提交/结算/复查边界；34项效果安全与记录更新测试通过，包括非空已接受Cast Facts和人物关系原样保留。
- 进度查询测试插入5000历史采样，验证查询携带精确revision及Event集合；空Work集合不会回退成全Entry查询。共享详情和相关投影32项测试通过。
- 本地合成浏览器场景验证四灯色、详情无重复灯、黄灯链接到同Case、资源等待和后续实际验证步骤。此场景只证明UI交互与布局，不是生产数据库或真实转码端到端证据。

## 生产只读事实与待验收

02:27（Asia/Shanghai）生产仍为275923039f；54份NFO均可读，其中3份与存储指纹不同。2个既存active Case中仅1个FFmpeg实际运行，Top Gun约58%，另一个等待资源；3个NFO Case仍queued、没有Work。NAS /vol1约34GiB可用。未访问Emby。

02:44补充：提交7c712fc581的Linux镜像在无网络、无媒体挂载的生产副本启动ready，关键HTTP均200。三条真实NFO Observation在独立数据库副本通过Coordinator→记录Command→旧queued Case失效的演练；各自Inventory推进1版，54部收藏和所有主视频标识/Facts/人物关系保留、无新Case/Work，integrity ok、FK 0。副本SHA256为`d6c8537fe43df92125cd57d71a8bf1dd199962f9b7c522593d1d000f981f21d6`。

发布前追加相同terminal时间的分页测试：SQL分页与跨状态合并使用一致的terminal/created/ID顺序，79个可见Case逐页读取无重复/缺失。待发布镜像包含此小修；前一候选只上传、未部署。仍须完成最终exact-image验证及标准apply，检查现有长转码，避免多轮部署反复丢失其临时进度。上线后必须核对收藏/文件保留、NFO三项收敛、queued不可见、黄灯对应Case、实际分页与进度响应，最后清理本任务临时文件并保留回滚备份。

## 未关闭的审计项

最终发布准备：f0201b2cfe候选完整service 500通过/18跳过、214文件架构Gate通过；exact-image Linux隔离副本的12次关键HTTP请求均200、readiness ready，上传SHA256一致。补充混合维度回归：已确认auto_repair缺口时，即使另一个维度not_assessable或observe，也保持红灯；没有Case时不伪造维护关联。合同及过程详情34项测试通过；终止的Work/Plan明确显示已终止，外部结果等待不再显示尚未开始；前端44项测试及构建通过。该灯色修正将进入最终候选，尚未生产部署。

副本SQL采样确认Formation当前计划与任务状态在同一请求重复读取Libra/Arca执行记录。改为复用本请求已取得的完整投影，不增加跨请求缓存；既有47项Formation状态/详情测试通过。副本绑定Windows磁盘的时延不能充当NAS生产性能结论，仍须上线后并发两页实测。

进一步定位到列表摘要读取已完成Procurement Run的全部历史，再从中筛出已完成材料准备计划。Subject的当前计划只会来自媒体整理或上架阶段，列表现不再请求该Procurement历史；点开详情仍保留真实材料准备计划。回归验证列表与详情的currentPlan/currentRun完全一致，并验证列表只读一次执行投影；47项相关测试通过。旧生产03:33实测Formation 2110ms、Collection 775ms，作为上线对照。

3653f5a16a exact-image副本中Formation列表两次为165/117ms（前一候选1900/1692ms），三项真实列表/详情currentPlan逐项相等、详情仍含三个阶段；service 501通过/18跳过。该数字是副本环境对照，生产复验仍待执行。

追加NFO边界修正：已存在文件的健康判断仅检查regular/nonempty/readable，读取1字节，不把256KiB解析预算升级为文件损坏条件；已变为可读的NFO使旧textRender目标失效，不产生重写。61项合同及效果安全测试通过，包含300KiB文件。记录同步和源语义取证仍有各自有界预算，超限路径及AC-09人物观察继续开放，不能声称所有尺寸的NFO记录已支持完整自动收敛。

AC-09仍是独立能力缺口：已有Arca人物关系Evidence Projection保留；完整新NFO人物观察→People注册→确定性Arca关系记录更新尚未实现。本次记录更新不会猜测演员匹配或改写已接受Cast，也不会为人物记录更新创建维护Case。不能据此宣称People全链路验收通过或全部审计项关闭。后续继续在唯一CURRENT_PHASE下跟踪，不创建平行计划。

## 生产黄灯依据复核（2026-09-08 04:11）

《霍比特人1：意外之旅》Entry `fb83bebf65cad90e9abb5452a5b6cd633d1cad1508a4d9640f9b24e406b8bc7d` 的黄灯成立：主视频磁盘实测与当前 Inventory 均为 11,666,913,036 bytes（10.8657 GiB）；当前电影 Shelf Standard revision 1 的 2 星分支上限为 4,294,967,296 bytes（4 GiB）。当前 Perception Resolution 采用豆瓣个人评分 2 星，其 factDigest 重新计算的 decisionFactSetDigest 与活动 Case CareBasis 完全相等；当前 Inventory 没有 authorized_defect_manifest。唯一处理目标为 conformance:max_size_exceeded，Custody/Presentation 均健康。

Case `arca-care-7a7e5123b1f7a834e5b44d613dbe22e0c8421232` 已获席位、工作列表与黄灯指向同一 Case；现场 FFmpeg 正从该主视频执行 hevc_qsv 转码，音频和字幕 copy，输出位于该 Case 的 Workspace。04:11:19 进度 3,296,918,625 / 10,949,460,000（按影片时长约 30.1%）。这是实际体积维护，不能把“存在 Case”本身作为黄灯合理性的证明；本次同时验证了实际文件、现行规则、评分依据、豁免与真实执行。尚未完成输出验收，不能宣称已修复或已变绿。

本次只读检查未访问 Emby、未修改生产数据库或评分。私有原始证据保存在本任务忽略目录 .codex/hobbit-*-audit.*，不提交导出的生产记录。

## 黄灯结论范围修正与 Libra 漏转码根因（2026-09-08）

用户进一步指出码率保护后，前节“黄灯成立”只能证明当前体积缺口及活动 Case 的真实存在，不能证明所选转码策略满足质量保护。Aftercare 的技术最低预算为 100,000 bps；Libra 对 below_4k 的 2 星策略有 2,000,000 bps 策略底线，并取策略底线与源视频码率的较小值。现场 Aftercare 视频目标仅 1,475,269 bps。两者保护不一致，必须继续审计源码率并统一质量保护，不能将当前转码无条件认定为正确。

已精确复现 Libra 未转码的直接根因：该 Subject 的 Candidate claimedTitle 是“霍比特人1：意外之旅 - Extended Edition (2012)”。clean-service-host 的 Subject Rating Target 从原 Candidate Claim 派生，providerIdentity 为 null；派生 title 为“霍比特人1:意外之旅 - extended edition”。使用现行 buildRatingTargetIdentity/queryFor 重算 queryInputDigest，精确等于历史 `c71b08f4bc3606b31ebfbcb996cbb7263b4b9c192c49184990635de968d45df2`。豆瓣记录的 title Anchor 为“霍比特人1:意外之旅”，当前标题规则未去掉 Extended Edition，历史 Resolution 为 no_matching_record。

时间线（北京时间）：豆瓣 2 星记录 08-28 23:15 已入库；未匹配 Resolution 08-30 20:31；09-04 04:58 发布 Acceptance Spec，maxSizeBytes=null/videoCodec=any；09-04 13:53 发布 Product Package，direct_input 验证 passed，实际 11,666,913,036 bytes，maxSizeBytes=null。09-07 18:52 上架后以标准片名匹配同一条已存在的 2 星记录，Aftercare 因 4 GiB 上限创建 Case。Shelf Standard digest/revision 未发生变化。

因此不是上架后新增评分，也不是 Libra 的码率保护阻止过转码：Libra 根本未进入带 4 GiB 目标的转码决策。需要修复的是前后阶段身份/评分查询输入一致性与 Aftercare 质量保护两处；不能仅增加 Aftercare 返工来掩盖上游问题。本轮定位只读，尚未实施这两处修复。

## 真实浏览器交互验收（2026-09-08）

使用用户 Edge 的生产管理台，通过实际点击验收，没有用API脚本代替页面操作。旧页面刷新后载入新版任务类型列和维护文案。覆盖：整理中筛选、维护过程弹窗、收藏海报详情、黄灯维护链接跳到同一个Case、收藏搜索007、48/55继续浏览到55部、上架任务过程详情、整理加载更多。期间正常恢复到期登录会话，未改变任何用户评分、席位或媒体文件。

已验证：维护弹窗真实Plan/Event出现；收藏健康详情无重复灯；收藏搜索最终只有007一项；继续浏览出现余下7部；黄灯链接指向原Case。实际点击整理加载更多，CDP记录completed第二页HTTP200，request→response为386.9ms，页面最终79行且加载更多整理按钮消失。此前一次观察停在正在读取状态，没有完整网络计时，不能据此声称服务器长时间阻塞；后一次通过真实网络与行数共同核验成功。

发现并已本地修正：上架过程等待完整请求后才弹窗，用户缺少即时反馈；现立即打开原弹窗并显示加载状态，关闭后迟到响应不再重新打开。维护过程初始加载不应显示失败文案；现在显示正在读取。Aftercare Event rate实际是FFmpeg倍率，UI原除以一百万导致0.00倍速，现按倍率显示。新增慢详情关闭/迟到响应与倍率显示回归。前端46测试通过、TypeScript/Vite构建成功。本地改动尚未部署，不把生产旧界面的观察算成修复后验收。

操作调用耗时包含自动化传输与观测成本；弹窗出现也不等同于真实步骤加载完成，不以这些数值宣称整页响应SLA。下一次候选仍需真实点击复验这三处修正，完整主线继续包含AC-09、记录观察边界、两个旧绑定红灯及最终清理。

额外分支按用户要求单独登记于 USER_PAIN_ADDITIONAL_BRANCHES_20260908.md，当前不实施。

## 13:05主线继续检查点（本地修正未发布）

- 12:57正式只读API分页复验56个Entry，原54个全部保留；54绿、2红、0黄，三个未准入记录型Case不在工作历史中。新增两部是正常运行增长，不执行回退到54的Reset。
- 真实浏览器再次输入“寒战2”，整理表格正确收敛到一行且任务类型为上架任务；实际点击“我的收藏”后首屏显示56部，最新信使与新·奥特曼均为健康。工具调用与页面异步完成之间存在间隔，不以工具耗时作为页面完成SLA。
- 维护详情读取失败现在在弹层内显示失败依据，避免背后页面报错而弹层一直显示“正在读取”。慢Libra详情立即开弹层、关闭后迟到响应不重开、FFmpeg倍率单位修正均保留。
- NFO记录同步原先以256 KiB完整文件读取为前提，导致较大但可读的NFO无法同步Binding。改为现有Physical Identity的middle-256k指纹观察，并要求读取前后inode/size/mtime/ctime一致；仍在提交前重新观察，无文件写入。解析和人物Evidence不借此获得完整NFO内容。
- 6项独立记录更新测试全部通过，新增大NFO每次读取不超过256 KiB、零Case/Work/字节变化，以及同尺寸并发时间戳变化拒绝提交。完整Service 501 PASS/18 SKIP，Web 47 PASS，Architecture 214 Fixture文件通过，Web构建通过。原始日志位于忽略目录`.codex/aftercare-current-*`。

两部红灯的精确只读证据：

| Entry | 旧残留文件 | 当前大小/完整文件SHA-256（文件小于256 KiB） | 结论 |
| --- | --- | --- | --- |
| 007：大战皇家赌场 | `/media/Film/007：大战皇家赌场 (2006)/007：大战皇家赌场 (2006) 1080p DTS.nfo` | 1439 / `3ebb97bc458c786a4adb07b3c5e99f63ce93bcb0a9da193994e45d28dc55ace8` | 旧offload相关文件身份改变；当前正式NFO/影片在同目录的另外位置 |
| 第三度嫌疑人 | `/media/Film/第三度嫌疑人 (2017)/第三度嫌疑人 (2017) 1080p AAC.nfo` | 1453 / `6ac646bfc7c4d3dc1112ddf08ee7c062284d210e41d2a3c21ef2d8b92924c11e` | 同上 |

两项回收站预览均200且items为空；当前回收站仅接受未被当前材料占用的旧目录，因此不能以整个父目录移入回收站处理这两份文件。未修改它们、生产数据库或健康值。需要精确文件级回收合同/实现或独立的精确处置授权，不能把此状态误判为当前影片/NFO缺失。AC-09人物观察/确定关联仍未实现；现有关系游标只按relation_id分页存在跨Inventory revision重复键风险，尚需独立fixture证明与合同传播，不在本检查点宣称已修。

生产仍运行6e37bf5679；寒战2正在真实转码。本检查点只完成本地修正与现有生产只读验收，不重启生产，不恢复自动化，不开展Emby审查。部署/回滚身份已同步回Current Status和部署文档，最终发布复验与工作区清理尚未执行。
