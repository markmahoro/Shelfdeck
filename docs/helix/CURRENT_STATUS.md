# ShelfDeck 当前状态

更新：2026-09-09 02:30。唯一台账：[UAT总表](UAT_ITERATION_REGISTER.md)；唯一排程：[CURRENT_PLAN](CURRENT_PLAN.md)。

- 生产：`helix-beta-20260909-1a3f4254dc`，source `1a3f4254dc`。NAS config Image ID `sha256:e5fb3d29e5f9a0dbe2c24776ccc0c5a872ea0d1017beaec9049ba98759ae2c5b`；tar SHA256 `1d1f41052ae1f95aae7078a8dab0556675e508f791204b1e8896a8494f12c113`。StartedAt `2026-09-08T18:09:08.0985278Z`。标准build/upload/checksum/dry-run/readiness/apply及挂载验证通过。
- 02:09六路生产GET均200：70收藏、1整理中/1待处理、44成功维护/11历史结束、4回收站条目。是当时快照，不替代操作前刷新。
- 本次接手新增关闭217、254、255、139、143、224、232、213、246、221、237、238，本轮累计26项；255连续编号中153历史关闭、1文档关闭、1非缺陷接受、73项待实施/验收，206另核被取代承接。历史关闭不是本次重新验收。
- 139/143/224/232逐行真实媒体/恢复/生产浏览器证据及回滚备份见[最新发布](implementation/evidence/UAT_RELEASE_7608C517CD_20260909.md)。217/254/255关闭记录在各自Evidence。取消Review误导已修正、生产复验通过；未作生产退出授权或规则修改。
- 213已关闭：真实Case链、生产旧Case未知和同生产JS资产的新目标展示已核对。剩余73项及206继续完整排程。
- 246已关闭：Arca精简工作台、按需分页搜索、完整ID全选和单Batch已发布；17 Windows/17 Linux/10 Web、真实十部链与千部浏览器通过，生产70部全选/清空通过。见[最新发布](implementation/evidence/UAT_RELEASE_1A3F4254DC_20260909.md)。
- 251：用户已明确仅手动修复已接受瑕疵、健康正常加瑕疵标记，已写SSOT；typed合同与完整三终局/重复进入/修复实现尚未完成。
- 125/250：`P4_EVENT_RECOVERY_INPUT_DRIFT`是重复出现的恢复错误，已定位同一旧宇航员Intake的Continuity Head由827变830导致输入漂移；修复与生产治理仍未完成。既有历史failed Settlement reconcile记录不可误判成新在飞删除。没有Reset或手改Control。
- 216样片及另一完整1080p版本未处置。253旧tar清理已关闭，本次约62GiB可用，无需扩大清理。
- 集成区`E:/my_project/emby_third_party-helix-iteration`；发布区`E:/my_project/emby_third_party-helix-uat-release-20260908` detached 1a3f4254dc。原Aftercare Evidence修改未触碰、未夹带提交。

此前流水为[非现行快照](implementation/evidence/UAT_STATUS_SNAPSHOT_BEFORE_7608C517CD_20260909.md)。其旧“未发布”“待确认”等不再指导当前操作。

全站壳层221/237/238已逐项关闭，证据见[八页/会话/样式验收](implementation/evidence/UAT-221_237_238_SHELL_ACCEPTANCE_20260909.md)。251已补typed实施约束，尚待DTO/持久化/执行接入，其他开放项保持原顺序。
