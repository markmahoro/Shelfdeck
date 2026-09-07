# 当前活动包：用户痛点迭代

2026-09-07。状态：LOCAL_IMPLEMENTATION；精确SSOT调整、本地测试、通过后标准部署及监控均已获用户授权。

基线16ea06173，分支codex/user-pain-iteration。此前54部收藏恢复事实见PROD-066 Evidence。

| 项目 | Owner / 合同 | 实施与验证 | 状态 |
| --- | --- | --- | --- |
| Case准入 | Arca，SSOT本轮amendment/§6.6 | queued→active原子席位、重试保留、终结释放、重启/FIFO/失效测试 | local_verified |
| 工作展示 | Admin只读投影，§9.4.6修订 | 现有表格与详情增量纳入Case；真实等待与结果 | local_verified |
| 列表性能 | 各Owner Query与Web | 按需历史、有界摘要、轮询去重、收藏分页与实测 | local_verified |
| NFO共存 | Libra生成/Arca验收与维护 | 收缩呈现比较，同步Binding与人物观察；保留身份和文件安全 | local_verified |
| 回收站 | Arca源位置收尾 | 精确范围、物理归档、可恢复、30天/每日清理、跨盘与故障恢复 | local_verified |
| 发布验证 | 标准生产入口 | 本地测试和副本演练通过；构建部署与监控待完成 | in_progress |

Effect边界：Libra不写正式来源；Arca文件变更须精确范围与可恢复Evidence；回收站隔离于Field/Shelf/Provider扫描范围。自动回收只处理已完成移入且到期记录。新schema保护全部已Commit收藏，不为未完成Formation添加双路径。

停止条件：真实文件副作用范围无法证明、备份或副本验证失败、未确认的Owner/授权扩张。已批准调整不重复询问；额外产品范围不擅自扩充。
