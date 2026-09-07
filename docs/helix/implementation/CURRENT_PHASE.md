# 当前活动包：用户痛点迭代

2026-09-08。状态：DESIGN_RETURN；用户要求先统一Aftercare合同并更新SSOT。自动化已PAUSED，Emby审查已跳过。当前暂停实施推进及追加部署，保留尚未发布的进度显示修改。

当前设计：健康状态检查及更新不创建Case，只更新收藏健康与有Evidence的管理记录；Case仅代表有实际处理目标的上架后处理，并在媒体整理区与Libra Run共用表现规范。SSOT §6.6、§9及2026-09-08修订已落盘。下一步闭合独立记录更新的Command/Receipt、Inventory/Control原子事务、并发Fence及健康—Case投影的Level 8派生合同，再进入实施。下表是此前实现证据，不是新合同验收通过。

用户确认七步计划后，第1—2步已完成[全链路审计及能力分类](evidence/AFTERCARE_FULL_CHAIN_AUDIT_20260908.md)：覆盖14个原生Capability、7个Planner及18个链路环节，10项已证实问题与待补证风险分开记录；真实projectHealth隔离复算证实缺口/queued/提交后Case关联投影问题。本轮未改实现或生产；原5个未提交源码/测试文件保留。

后续执行顺序：第3步合同闭合（独立记录更新、健康—Case、准入前后资源、统一过程投影及机器传播）；第4步后端；第5步两页及共用详情；第6步精确旧Case处置；第7步测试、标准部署、生产复验和最后清理。用户灯色/queued不可见/任务类型列/维护详情理念补充以审计报告“已确认用户合同”为准，须传播回SSOT和派生定义，不沿用旧queued可见规则。

基线16ea06173，分支codex/user-pain-iteration。此前54部收藏恢复事实见PROD-066 Evidence。

| 项目 | Owner / 合同 | 实施与验证 | 状态 |
| --- | --- | --- | --- |
| Case准入 | Arca，SSOT本轮amendment/§6.6 | queued→active原子席位、重试保留、终结释放、重启/FIFO/失效测试 | local_verified |
| 工作展示 | Admin只读投影，§9.4.6修订 | 现有表格与详情增量纳入Case；真实等待与结果 | local_verified |
| 列表性能 | 各Owner Query与Web | 按需历史、有界摘要、轮询去重、收藏分页与实测 | local_verified |
| NFO共存 | Libra生成/Arca验收与维护 | 收缩呈现比较，同步Binding与人物观察；保留身份和文件安全 | local_verified |
| 回收站 | Arca源位置收尾 | 精确范围、物理归档、可恢复、30天/每日清理、跨盘与故障恢复 | local_verified |
| 发布验证 | 标准生产入口 | fd8a8e6f35已标准部署；54 Entry / 451文件存在；历史接纳闭包冲突与扫描凭证过期仍待收敛 | monitoring_attention |

部署身份、验证和未关闭事项见[生产记录](evidence/USER_PAIN_DEPLOYMENT_20260907.md)及[持续迭代证据](evidence/USER_PAIN_CONTINUATION_20260908.md)。不将HTTP健康、本地测试通过等同于运行态全部正常。

监控后续修：Field访问凭证过期的明确失败收敛补丁，19项定向及完整恢复测试通过；历史接纳闭包已完成根因定位与精确副本演练。275923039f进入标准部署验证。

用户结果前次复验见[五项痛点验收](evidence/USER_PAIN_OUTCOME_VERIFICATION_20260907.md)：未全数关闭；Top Gun实际转码推进至14%，修正此前按stage不变推断停滞；旧版整页接口组合3.2–3.7秒，3份NFO Binding尚未收敛。旧目录此后已归档，见下文。

09-08继续实施：当前工作先于历史/配置加载；过期Field Handle明确失败收敛；Reset精确退役6个superseded历史Offer发布，消除重新intake来源，保留旧终态事实。生产副本演练仅移除1个被错误重建的Subject/Run和13个Work，56个Arca表及4276个其他Work逐行哈希保护，第二次应用零动作。100个独立Entry的Case单席位顺序排队与终结释放通过；详细范围见本轮Evidence。

Top Gun已通过正式回收站API移入应用回收站，11文件/4,015,976字节大小与SHA256全部复验一致，原目录不存在，30天保留；当前影片与转码来源未移动。用户明确跳过Emby审查；不再将外部索引作为本轮验收门槛。

Effect边界：Libra不写正式来源；Arca文件变更须精确范围与可恢复Evidence；回收站隔离于Field/Shelf/Provider扫描范围。自动回收只处理已完成移入且到期记录。新schema保护全部已Commit收藏，不为未完成Formation添加双路径。

停止条件：真实文件副作用范围无法证明、备份或副本验证失败、未确认的Owner/授权扩张。已批准调整不重复询问；额外产品范围不擅自扩充。
