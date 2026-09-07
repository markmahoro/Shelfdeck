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

AC-09仍是独立能力缺口：已有Arca人物关系Evidence Projection保留；完整新NFO人物观察→People注册→确定性Arca关系记录更新尚未实现。本次记录更新不会猜测演员匹配或改写已接受Cast，也不会为人物记录更新创建维护Case。不能据此宣称People全链路验收通过或全部审计项关闭。后续继续在唯一CURRENT_PHASE下跟踪，不创建平行计划。
