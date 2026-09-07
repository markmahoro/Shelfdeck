# ShelfDeck Clean Helix Master Plan

Status: **用户痛点持续迭代中；已取消5分钟自动轮询，跳过Emby审查，未关闭活动包。**
Last updated: 2026-09-08

唯一活动包：[CURRENT_PHASE](implementation/CURRENT_PHASE.md)。用户已针对ENGINEERING_PLAYBOOK §3.3回复“授权本任务同步修改并继续”，范围限于[精确合同调整包](implementation/evidence/USER_PAIN_CONTRACT_CHANGE_PACKET_20260907.md)。不采用Aftercare→Libra Run方案。

交付顺序：Case准入与克制的工作区增量展示；列表读取性能；NFO职责收缩；源目录回收站；本地/集成测试、标准build/upload/deploy与生产监控。不能将其中一个子项完成宣称为全轮完成。

基线：独立worktree codex/user-pain-iteration从16ea06173创建。54部已恢复收藏保持原事实；不执行清库、重新退收藏或未授权媒体源删除。生产此前停止，用户最新授权允许全部验证通过后部署并恢复运行。

原PROD-066处理与审计见implementation/evidence。发布前完成schema变更离线备份、副本演练和收藏保护验证，不使用clean-init替代升级。
