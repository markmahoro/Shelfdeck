# ShelfDeck 当前状态

更新：2026-09-09。唯一条目及关闭条件入口为[UAT总表](UAT_ITERATION_REGISTER.md)，唯一排程为[CURRENT_PLAN](CURRENT_PLAN.md)。255项连续：42项本轮功能验收关闭、57项开放、153项历史关闭、220文档关闭、1项非缺陷接受、206被取代且承接已核实。历史关闭不是本次重新验收。

255项前后合同审查及三项用户决定已完成，SSOT/Beta已在`14cf2d9a0`同步。已无这三项待确认决定；合同确认不等于实现或验收。审查及覆盖关系见[全量证据](implementation/evidence/UAT_FULL_CONTRACT_CONSISTENCY_AUDIT_20260909.md)。

## 当前生产

- 镜像：`markmahoro/shelfdeck:helix-beta-20260909-48077d71bd`；source `48077d71bd`；config Image ID `sha256:44958b2ea574ecb3dee6bc544adca74491849ac11d0c42ad4f450eff37680364`。
- tar SHA256：`d7f6869f6fab37494a4f34dee890530e8d297a9e78403cc3e5bea683884ad155`；StartedAt `2026-09-08T21:14:02.579402666Z`。标准构建、上传、校验、dry run、发布、readiness及挂载核验通过。备份、回滚版本及验证见[发布证据](implementation/evidence/UAT_RELEASE_48077D71BD_20260909.md)。
- 最近发布后只读快照：2026-09-09 05:15:17北京时间，六路GET均200；76收藏，Formation汇总72、1整理中/1待处理/70完成/3结束；Care查询44完成/11结束；回收站4项。以上按各API原字段记录，不将Formation数量当收藏数，操作前仍须刷新。
- 集成区`E:/my_project/emby_third_party-helix-iteration`，分支`codex/user-pain-iteration`；发布区`E:/my_project/emby_third_party-helix-uat-release-20260908` detached `48077d71bd`。原Aftercare调查Evidence未提交修改受保护，未夹带提交。

## 最近验收与开放事实

171按当前NFO Oracle独立关闭，Windows/Linux真实媒体改写后健康正常、记录刷新且不产生修复Case，原片及Accepted Product Facts保留，见[171证据](implementation/evidence/UAT-171_NFO_CURRENT_CONTRACT_ACCEPTANCE_20260909.md)。135/136按真实ISO完整链及生产发布分别关闭，见[135/136证据](implementation/evidence/UAT-135_136_ISO_SOURCE_ACCEPTANCE_20260909.md)。132按Windows/Linux真实Direct HEVC完整链独立关闭，没有转码或重封装，见[132证据](implementation/evidence/UAT-132_DIRECT_UNKNOWN_ACCEPTANCE_20260909.md)。137/160和210完整关闭条件仍未满足，不随上述项目关闭。

172已核实：生产正式standing Authorization revision 1已enabled且明确覆盖exclusive Related；当前执行链未读取该授权，仍合成system-policy Approval。逐Scope持久Approval和删除前当前授权核验尚未接通，保持开放，见[执行链审查](implementation/evidence/UAT-172_AUTHORIZATION_EXECUTION_AUDIT_20260909.md)。本次只读核验，没有重复发布授权或直接修改生产数据。

251的三终局、仅手动修复已接受瑕疵、健康正常另附瑕疵标记及typed合同已确认；DTO/持久化/执行接入与验收尚未完成。125/250的`P4_EVENT_RECOVERY_INPUT_DRIFT`已定位同一旧Intake Continuity Head从827变830造成输入漂移；修复及生产治理尚未完成，没有Reset或手改Control。216样片及另一完整1080p版本保持原状。

此前逐项流水及旧时点状态保留在[整理前历史快照](implementation/evidence/UAT_STATUS_SNAPSHOT_BEFORE_172_20260909.md)，每项验收证据由总表链接；旧“最新发布”“仍开放”等措辞不覆盖本页和总表。
