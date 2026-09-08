# UAT-171 当前NFO合同验收关闭

2026-09-09。现行Oracle为9月7/8日SSOT修订：已声明NFO存在、非空、可读；外部呈现变化只刷新必要记录，零Case，不反写文件或Canonical Identity/已接受Product Facts。PROD-028旧持续语义全等已被取代，见[优先级核对](UAT_NFO_CONTRACT_PRECEDENCE_20260909.md)。

## 真实媒体与正式Host证据

`helix-libra-handoff-b-scenario-e2e.test.js`的one-movie真实媒体场景在正式On-deck之后先快照accepted Product Facts，再两次原子替换当前NFO：第一份XML修改title/plot/actor且不提供TMDB identity，第二份是非XML可读文本。每次通过正式Admin检查与Owner后台周期推进；验证Inventory恰好增加一版、正式record-refresh Receipt恰好增加一条、当前Basis健康收敛、Case总数为零、NFO字节完整保留、已接受Product Facts逐字节不变。

同一场景随后删除当前NFO、正式海报，分别触发并完成实际修复；继续Shelf Target迁移收尾、重启、失败保留及退出。不是只测helper，也未用旧presentation equality测试替代当前产品行为。外部Provider为受控测试替身，实际媒体Probe/decode与正式Host正常执行；不宣称真实Emby并发集成验收。

Windows实际场景128.55秒PASS；Linux当前生产镜像真实场景PASS（进程126.51秒，1实际场景、17名称过滤SKIP）。日志`.codex/uat171-real-media-windows.log`与`.codex/uat171-real-media-linux.log`。最初30秒health等待碰到Owner周期边界，观察到新Inventory暂未评估；修正测试等待为两个既有30秒周期后通过，没有改运行时周期或伪造立即健康。期间展示是否清楚属212，不由171代替验收。

## 生产与承接证据

2026-09-08T20:55:04.384Z只读正式Care API：原Searching Entry（实际取证ID见`.codex/uat171-production-health.json`），当前Inventory revision 6、healthy、0 queued/active Case。生产仍955fe42daf，无生产NFO写入、无清理、无手改健康字段。

此前210生产7部当前NFO变化正常收敛、12条记录刷新且0新增Case；211旧Settlement路径排除、214正式人物观察关联和208原witness/精确物理处置各有独立关闭证据。171仅关闭当前NFO变化不抢写这一结果；210单席位/批量变化/251重复Case与瑕疵语义仍开放。

本次仅补验收测试与Evidence，无业务运行时代码变化，无需为本项重复部署。UAT-171验收关闭；本轮39项功能关闭、60项开放，206承接另核。
