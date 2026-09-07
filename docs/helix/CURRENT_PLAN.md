# ShelfDeck Clean Helix Master Plan

Status: **ACTIVE：健康检查与维护Case合同、独立记录更新及前后端核心实现已通过本地验证，正在准备标准发布。已取消5分钟自动轮询，跳过Emby审查。**
Last updated: 2026-09-08

唯一活动包：[CURRENT_PHASE](implementation/CURRENT_PHASE.md)。用户已针对ENGINEERING_PLAYBOOK §3.3回复“授权本任务同步修改并继续”，范围限于[精确合同调整包](implementation/evidence/USER_PAIN_CONTRACT_CHANGE_PACKET_20260907.md)。不采用Aftercare→Libra Run方案。

09-08用户进一步明确要求统一合同并更新SSOT：健康状态检查及更新作用于“我的收藏”，Aftercare Case收敛为真正上架后处理，在媒体整理区与Libra Run统一表现。该边界、独立NFO记录更新Command/Receipt/事务与机器派生已本地实现，完整架构Gate通过。继续最终测试、Linux副本验证及标准部署；未通过发布验证前不修改生产Case。AC-09人物观察/确定关联能力仍明确开放，不能宣称全审计关闭。

用户确认的当前交付顺序：①Aftercare全链路审计；②全部能力分类；③SSOT及派生合同闭合；④后端对齐；⑤统一前端；⑥精确生产Case审查处置；⑦验证、标准部署与清理。第1—2步已完成，核心第3—5步已实现并进入验收；第6步已只读核对2 active/3 queued Case，等待发布后精确复验。保留当前转码实际进度，避免多轮部署；第7步进行中。证据见[本次实施](implementation/evidence/AFTERCARE_HEALTH_CASE_IMPLEMENTATION_20260908.md)。

补充约束：海报绿=健康、红=已确认不健康（含queued）、黄=已取得席位的维护Case、灰=未知；queued不进入整理区。黄灯关联同一维护任务，整理列表新增上架/维护任务类型列；收藏详情去重复灯，维护详情复用Libra Run设计理念与真实过程组件。

基线：独立worktree codex/user-pain-iteration从16ea06173创建。54部已恢复收藏保持原事实；不执行清库、重新退收藏或未授权媒体源删除。生产此前停止，用户最新授权允许全部验证通过后部署并恢复运行。

原PROD-066处理与审计见implementation/evidence。发布前完成schema变更离线备份、副本演练和收藏保护验证，不使用clean-init替代升级。
