# ShelfDeck 当前状态

更新：2026-09-09。唯一条目及关闭条件入口为[UAT总表](UAT_ITERATION_REGISTER.md)，唯一排程为[CURRENT_PLAN](CURRENT_PLAN.md)。255项连续：53项本轮功能验收关闭、46项开放、153项历史关闭、220文档关闭、1项非缺陷接受、206被取代且承接已核实。历史关闭不是本次重新验收。

255项前后合同审查及三项用户决定已完成，SSOT/Beta已在`14cf2d9a0`同步。已无这三项待确认决定；合同确认不等于实现或验收。审查及覆盖关系见[全量证据](implementation/evidence/UAT_FULL_CONTRACT_CONSISTENCY_AUDIT_20260909.md)。

## 当前生产

- 镜像：`markmahoro/shelfdeck:helix-beta-20260909-6bcfd7b33b`；source `6bcfd7b33b`；config Image ID `sha256:17ffbd63935cc9cf69845fa817d68e3673d5271bc5ed3db23d547edd4dd1ebfe`。
- tar SHA256：`8f7b91de20c23197994979873fd7a507060a2a17fd6bb832f6be6042030e8d73`；StartedAt `2026-09-09T01:56:28.414159717Z`。标准构建、上传、校验、dry run、发布、readiness及挂载核验通过。备份、回滚版本及验证见[发布证据](implementation/evidence/UAT_RELEASE_6BCFD7B33B_20260909.md)。
- 最近发布后只读快照：2026-09-09 09:57:53北京时间，六路GET均200；79收藏，Formation汇总75、1整理中/1待处理/73完成/3结束；Care查询44完成/11结束；回收站4项。以上按各API原字段记录，不将Formation数量当收藏数，操作前仍须刷新。
- 集成区`E:/my_project/emby_third_party-helix-iteration`，分支`codex/user-pain-iteration`；发布区`E:/my_project/emby_third_party-helix-uat-release-20260908` detached `6bcfd7b33b`。原Aftercare调查Evidence未提交修改受保护，未夹带提交。

## 最近验收与开放事实

171按当前NFO Oracle独立关闭，Windows/Linux真实媒体改写后健康正常、记录刷新且不产生修复Case，原片及Accepted Product Facts保留，见[171证据](implementation/evidence/UAT-171_NFO_CURRENT_CONTRACT_ACCEPTANCE_20260909.md)。135/136按真实ISO完整链及生产发布分别关闭，见[135/136证据](implementation/evidence/UAT-135_136_ISO_SOURCE_ACCEPTANCE_20260909.md)。132按Windows/Linux真实Direct HEVC完整链独立关闭，没有转码或重封装，见[132证据](implementation/evidence/UAT-132_DIRECT_UNKNOWN_ACCEPTANCE_20260909.md)。137/160已按独立真实媒体正负路径关闭，Windows及生产同版Linux各30项通过，见[137/160证据](implementation/evidence/UAT-137_160_FRESH_MEDIA_ACCEPTANCE_20260909.md)。210完整关闭条件仍未满足。

172已独立关闭：正式持续授权、逐Scope持久Approval及删除前当前授权核验接通；Windows/Linux真实链、撤销/重启/范围不足负向、正式浏览器与生产新镜像复核通过。生产原授权revision 1及79收藏保持不变，见[验收](implementation/evidence/UAT-172_AUTHORIZATION_ACCEPTANCE_20260909.md)。134已完成同根精确范围、负向与端口重建重放验收，见[134证据](implementation/evidence/UAT-134_SCOPED_SETTLEMENT_ACCEPTANCE_20260909.md)。158已完成采样中时间戳变化与真实内容漂移的正负验收，见[158证据](implementation/evidence/UAT-158_STAGE_TIMESTAMP_ACCEPTANCE_20260909.md)。138已完成单Movie真实全链及未知/后生文件保护验收，见[138证据](implementation/evidence/UAT-138_THUMBS_MOVIE_ACCEPTANCE_20260909.md)。225/229/231/244/249已按[生产浏览器证据](implementation/evidence/UAT_SETTINGS_BROWSER_ACCEPTANCE_20260909.md)分别关闭。无新的用户待决策项。

251的三终局、仅手动修复已接受瑕疵、健康正常另附瑕疵标记及typed合同已确认；DTO/持久化/执行接入与验收尚未完成。125/250的`P4_EVENT_RECOVERY_INPUT_DRIFT`已定位同一旧Intake Continuity Head从827变830造成输入漂移；修复及生产治理尚未完成，没有Reset或手改Control。216样片及另一完整1080p版本保持原状。

此前逐项流水及旧时点状态保留在[整理前历史快照](implementation/evidence/UAT_STATUS_SNAPSHOT_BEFORE_172_20260909.md)，每项验收证据由总表链接；旧“最新发布”“仍开放”等措辞不覆盖本页和总表。
