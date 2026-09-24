# UAT-268 active Run 放弃整理

更新：2026-09-24。本项已按生产正式操作及文件保护验收关闭；UAT-267物理演练仍独立开放。

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
- 活动Work/Effect未收尾时保持pending、不提前释放Control与状态漂移路径由隔离SQLite定向测试覆盖；本次指定sample正式操作时未决Effect为0，未人为制造新的生产Effect。

## 独立标准发布

本次从已运行的`3fff5f7dc30145a97a5d6372817975321f349bf8`生产基线建立独立发布工作树，仅纳入UAT-268代码及生成合同修正；UAT-267 On-deck修复未进入镜像。发布源提交依次为`08a39571d`、`da21c642f`、`cdcab6dbab83e157af80068196d250b9eb236491`。镜像`markmahoro/shelfdeck:helix-beta-20260924-cdcab6dbab`，tar 561879552 bytes，SHA256 `9361e3c95edd69b195f9e63b6f6432175afd90c290981862da9e819c9b43b7fc`；NAS镜像ID `sha256:42c03c77c6567effb97a259f64bb9b21c7e58d8dd991563e865a50ef1804c564`。

- 发布镜像Web 108/108、构建、Windows Run生命周期20/20、应用schema10/10、P2/P3 12/12、完整架构校验通过；Linux镜像内相关42/42通过。全量`media-service npm test`为582项、540通过、18失败、24跳过；失败涉及旧UI/schema夹具、UAT-131 actor-only和size-cap JCS，其中size-cap JCS在修复前基线可复现。全量测试不能记为通过；未执行完整真实媒体E2E。
- 两次在线备份均包含46文件、1,273,074,242 bytes，SQLite`quick_check=ok`、FK0。最终上线前备份为`/vol1/1000/docker/shelfdeck/backups/uat268-preapply-3fff5f7dc3-20260924`，manifest SHA256 `a01ae7b2a251780c8c8b42e5e58e452615260e48307f0155642bc6c83b987cd9`。早前隔离副本基于`/vol1/1000/docker/shelfdeck/backups/uat268-3fff5f7dc3-20260924`，manifest SHA256 `ace244bfbd6246d5cce2f896b5cb1f3c4405a3cf07545ef5d4afd906f187d851`。
- 同一完整备份上，候选镜像和旧镜像回退Host均通过正常供给、health/Admin、SQLite、210项Shelf Entry及8表保护。候选副本对指定sample调用正式Admin接口并同键重放，两次均返回`discarded`，仅写入一条Decision/Receipt，Outcome为`user_cancelled`，收藏不变。隔离Host出现的只读挂载`EROFS`和既有UAT-267 On-deck告警在候选与回退均存在，未把它们解释为本次新缺陷。
- `scripts/build-image.js`、`scripts/upload-nas-image.js`的SHA校验、`scripts/deploy-nas.js` dry-run及`--apply`完成。生产容器StartedAt `2026-09-24T08:30:44.014036525Z`；健康响应`status=ok`、`normalSupplyAllowed=true`，Admin、必要挂载、Compose和源码SHA复核通过。部署后、用户操作前，sample仍是active rev2且Decision 0；部署动作没有替用户放弃。

## 指定sample生产正式验收

用户在新版本确认框内正式放弃`局内人 (2006) 1080p DTS-sample`。Admin Web显示“本次整理已结束”及“已结束 · 用户放弃”；“需要处理”1→0、“已结束”303→304。部署负责人在`2026-09-24T08:39Z`以最终上线前备份对照当前生产，只读核验：

| 事实 | 上线前备份 | 正式放弃后 |
| --- | --- | --- |
| 指定Run | active，revision 2 | discarded，revision 3 |
| 放弃Decision / Receipt | 0 / 0 | 1 / 1，actor `admin` |
| Outcome | 无 | `unable_to_on_deck`，reason `user_cancelled` |
| 唯一输入Control | `controlled`，revision 2，Libra Subject持有 | `released`，revision 3，owner清空 |
| Workspace / Cleanup Scope | 0 / 0 | 0 / 0；无Workspace材料需清理 |
| 已入库正片Shelf Entry | active，Inventory revision 15 | 同一Entry及revision，行SHA256相同 |
| 正片Inventory | 17项 | 17项全部行SHA256与Control行SHA256相同 |
| SQLite | `quick_check=ok`、FK0 | `quick_check=ok`、FK0 |

sample原文件仍存在，inode `13362`、大小`105120736` bytes、middle-256k SHA256 `f89bfb75d4c19d14dd1c2bc9a307c805ba58242b7aef3e7629454a5ee423a84e`，逐项与Run入场物理身份一致。已入库正片主文件亦存在，物理身份和有界指纹与当前Inventory匹配；其Entry、17项Inventory及Control在备份与生产的行摘要完全相同。Shelf Entry总数210、Inventory材料总数15352，在部署前后保持。整个核验只读，未重复提交放弃命令，也未直接修改生产库或媒体文件。

本项关闭仅覆盖用户指定的active Run主动放弃及其保护事实；UAT-267三条On-deck恢复仍需独立物理Effect演练，不由本次发布或验收推定完成。
