# ShelfDeck 当前状态

更新：2026-09-09 03:06。唯一台账：[UAT总表](UAT_ITERATION_REGISTER.md)；唯一排程：[CURRENT_PLAN](CURRENT_PLAN.md)。

- 生产：`helix-beta-20260909-3489ea0ccf`，source `3489ea0ccf`。NAS config Image ID `sha256:95a4f20253de4cffd612a25c869f1fc9203b06e3119034323c413893cda4f9c6`；tar SHA256 `d5f639ff02e940d6aa060ad0eaea5da879bde213096e49ce8de663452b1d6f37`。StartedAt `2026-09-08T19:04:26.98822919Z`。标准build/upload/checksum/dry-run/readiness/apply及挂载验证通过。
- 03:05六路生产GET均200：71收藏、1整理中/1待处理、44成功维护/11历史结束、4回收站条目。是当时快照，不替代操作前刷新。
- 本次接手新增关闭217、254、255、139、143、224、232、213、246、221、237、238、223、235、228、141、230，本轮累计31项；255连续编号中153历史关闭、1文档关闭、1非缺陷接受、68项待实施/验收，206另核被取代承接。历史关闭不是本次重新验收。
- 139/143/224/232逐行真实媒体/恢复/生产浏览器证据及回滚备份见[对应发布](implementation/evidence/UAT_RELEASE_7608C517CD_20260909.md)。217/254/255关闭记录在各自Evidence。取消Review误导已修正、生产复验通过；未作生产退出授权或规则修改。
- 213已关闭：真实Case链、生产旧Case未知和同生产JS资产的新目标展示已核对。剩余68项及206继续完整排程。
- 246已关闭：Arca精简工作台、按需分页搜索、完整ID全选和单Batch已发布；17 Windows/17 Linux/10 Web、真实十部链与千部浏览器通过，生产70部全选/清空通过。见[对应发布](implementation/evidence/UAT_RELEASE_1A3F4254DC_20260909.md)。
- 251：用户已明确仅手动修复已接受瑕疵、健康正常加瑕疵标记，已写SSOT；typed合同与完整三终局/重复进入/修复实现尚未完成。
- 125/250：`P4_EVENT_RECOVERY_INPUT_DRIFT`是重复出现的恢复错误，已定位同一旧宇航员Intake的Continuity Head由827变830导致输入漂移；修复与生产治理仍未完成。既有历史failed Settlement reconcile记录不可误判成新在飞删除。没有Reset或手改Control。
- 216样片及另一完整1080p版本未处置。253旧tar清理已关闭，发布前约60GiB可用，无需扩大清理。
- 集成区`E:/my_project/emby_third_party-helix-iteration`；发布区`E:/my_project/emby_third_party-helix-uat-release-20260908` detached 3489ea0ccf。原Aftercare Evidence修改未触碰、未夹带提交。

此前流水为[非现行快照](implementation/evidence/UAT_STATUS_SNAPSHOT_BEFORE_7608C517CD_20260909.md)。其旧“未发布”“待确认”等不再指导当前操作。

全站壳层221/237/238已逐项关闭，证据见[八页/会话/样式验收](implementation/evidence/UAT-221_237_238_SHELL_ACCEPTANCE_20260909.md)。251已补typed实施约束，尚待DTO/持久化/执行接入，其他开放项保持原顺序。

UAT-223文案、235注销模态、228人物能力文案分别关闭；235六项/隔离浏览器及新生产资产核对通过。见[收藏架验收](implementation/evidence/UAT-223_235_SHELF_DIALOG_20260909.md)。

前次发布及回滚备份：[841cbcf0c7](implementation/evidence/UAT_RELEASE_841CBCF0C7_20260909.md)。[228独立证据](implementation/evidence/UAT-228_PEOPLE_CAPABILITY_COPY_20260909.md)。

141/230已逐项关闭：当前片名、真实状态、错误/故障/未配置浏览器、5 Windows Query/5 Linux Query/5 Web/真实Host HTTP及生产资产核对通过。245真实全量查询尚待修正，不随本项关闭。见[概览验收](implementation/evidence/UAT-141_230_OVERVIEW_ACCEPTANCE_20260909.md)。

最新生产发布/回滚备份：[3489ea0ccf](implementation/evidence/UAT_RELEASE_3489EA0CCF_20260909.md)。
