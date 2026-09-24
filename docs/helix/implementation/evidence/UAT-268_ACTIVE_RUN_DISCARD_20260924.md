# UAT-268 active Run 放弃整理

更新：2026-09-24。本项未关闭；生产发布及指定sample正式终结待验。

## 用户问题与只读现场

用户指定《局内人 (2006) 1080p DTS-sample》，与已上架的《局内人》正片是不同对象。生产Admin Web中该sample位于“需要处理”，影片身份选择列表无候选；点击“放弃整理”会打开确认框，确认后框关闭，但行和计数不变。只读SQLite核验其Run为`active` revision 2，身份查询为`provider_no_match`、候选0，仅1个已成功的`product_identity` Work、未决Effect为0。确认操作前后未触碰正片收藏或源文件。

根因：`FormationPage`把discard接口的所有HTTP 200 Result当作已完成；现有Libra Run Discard只接受`frozen`或已拒绝Handoff B的active Run。本sample返回`invalid_state/run_not_frozen`，却被前端关闭对话框并刷新，造成“没有反应”。

## 合同与实现

用户已在本任务明确允许active Run由用户主动放弃。SSOT现规定：仍由Libra持有Decision和终局；未接受Handoff B，Work/Effect必须先达到安全收尾，原始Input Control与`discarded`、`user_cancelled`终局及Workspace Cleanup义务同一事务成立。未决执行返回`closure_pending`，不虚报成功或释放Control；同条件再进入仍受已持久化终局抑制。未引入跨域写入、Reset或源文件删除。

实现复用现有Run Discard事务，扩展admin actor的active资格；自动system仅保留已拒绝Handoff B路径。Outcome读取当前Run revision Evidence，不把主动放弃伪造成frozen失败。前端复用同一幂等键，只有`discarded`关窗并显示完成；pending、状态变化、不可操作和其他失败在确认框就地反馈。

## 验证与待验

- Windows隔离SQLite：active用户放弃写入唯一Decision/Receipt、`discarded`与`user_cancelled`、释放精确Control，同键重放不新增事实；未决Work时保持`closure_pending`且无终局/Control变化，收尾后同键完成；既有frozen及已拒绝Handoff B路径不退化。`p9-run-lifecycle-store.test.js` 20/20。
- Admin Web：模拟身份无匹配sample，`closure_pending`同键重试；`invalid_state`禁用同框确认并在关闭后刷新；英文内部异常不直显，未知结果同键重试；仅真实`discarded`显示结束。`helix-copy.test.tsx` 13/13、全Web 108/108、`npm run build`通过。指定UI负责人已按Playbook §12.3复查可见语义/交互代码并认可；生产点击仍待验。
- SSOT source map及对应table/transaction contract按生成工具同步，source map check通过。
- `media-service npm test`全量运行未通过；失败包括UAT-131真实HTTP、旧schema迁移、Setup Readiness及`libra-run-admin-service.test.js`中的size-cap候选JCS错误。该全量门禁不能记作通过；此次放弃路径的定向20项及Web 108项结果另列如上。
- 待标准生产发布后以该sample实际点击/正式命令验收：Run/Outcome/Receipt/Control/Workspace及Formation活动/历史一致，sample原文件和正片收藏不变；必要时验证用户操作期间状态漂移、未决Effect保护。生产动作不能由本地测试代替。
