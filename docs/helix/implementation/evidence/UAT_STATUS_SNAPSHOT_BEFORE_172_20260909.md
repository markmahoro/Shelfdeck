# 历史状态快照（非现行）

2026-09-09整理前原文；其中“最新”、开放状态及版本仅描述原记录，不能指导当前实施。现行事实见[CURRENT_STATUS](../../CURRENT_STATUS.md)。

# ShelfDeck 当前状态

2026-09-09：255项合同审查已完成，三项冲突均由用户确认（`14cf2d9a0`），SSOT/Beta/总表已同步。用户要求整理文档后继续推进；活动计划及执行包已清除旧暂停和待决策说明。当前42项本轮功能验收关闭、57项开放及206承接已核实；合同确认本身未新增关闭；随后171依据Windows/Linux真实媒体及生产只读证据独立验收关闭，见[验收记录](../../implementation/evidence/UAT-171_NFO_CURRENT_CONTRACT_ACCEPTANCE_20260909.md)。随后135/136的ISO修正已标准部署并验收，76收藏及六路接口正常；未直接写入生产授权或手工清理媒体。详见[审查及决定证据](../../implementation/evidence/UAT_FULL_CONTRACT_CONSISTENCY_AUDIT_20260909.md)。

更新：2026-09-09 04:09。唯一台账：[UAT总表](../../UAT_ITERATION_REGISTER.md)；唯一排程：[CURRENT_PLAN](../../CURRENT_PLAN.md)。

- 生产：`markmahoro/shelfdeck:helix-beta-20260909-48077d71bd`，source `48077d71bd`；config Image ID `sha256:44958b2ea574ecb3dee6bc544adca74491849ac11d0c42ad4f450eff37680364`；tar SHA256 `d7f6869f6fab37494a4f34dee890530e8d297a9e78403cc3e5bea683884ad155`；StartedAt `2026-09-08T21:14:02.579402666Z`。标准发布、readiness、挂载、六路GET与计数对照通过。132/135/136逐项关闭，见[发布/备份/回滚证据](../../implementation/evidence/UAT_RELEASE_48077D71BD_20260909.md)。
- 04:07六路生产GET均200：72收藏、1整理中/1待处理、44成功维护/11历史结束、4回收站条目。是当时快照，不替代操作前刷新。
- 本次接手新增关闭217、254、255、139、143、224、232、213、246、221、237、238、223、235、228、141、230、129、128、142、174、175、167、208，本轮累计42项；255连续编号中153历史关闭、1文档关闭、1非缺陷接受、57项待实施/验收，206另核被取代承接。历史关闭不是本次重新验收。
- 139/143/224/232逐行真实媒体/恢复/生产浏览器证据及回滚备份见[对应发布](../../implementation/evidence/UAT_RELEASE_7608C517CD_20260909.md)。217/254/255关闭记录在各自Evidence。取消Review误导已修正、生产复验通过；未作生产退出授权或规则修改。
- 213已关闭：真实Case链、生产旧Case未知和同生产JS资产的新目标展示已核对。剩余57项及206继续完整排程。
- 246已关闭：Arca精简工作台、按需分页搜索、完整ID全选和单Batch已发布；17 Windows/17 Linux/10 Web、真实十部链与千部浏览器通过，生产70部全选/清空通过。见[对应发布](../../implementation/evidence/UAT_RELEASE_1A3F4254DC_20260909.md)。
- 251：用户已明确仅手动修复已接受瑕疵、健康正常加瑕疵标记，已写SSOT；typed合同与完整三终局/重复进入/修复实现尚未完成。
- 125/250：`P4_EVENT_RECOVERY_INPUT_DRIFT`是重复出现的恢复错误，已定位同一旧宇航员Intake的Continuity Head由827变830导致输入漂移；修复与生产治理仍未完成。既有历史failed Settlement reconcile记录不可误判成新在飞删除。没有Reset或手改Control。
- 216样片及另一完整1080p版本未处置。253旧tar清理已关闭，发布前约60GiB可用，无需扩大清理。
- 集成区`E:/my_project/emby_third_party-helix-iteration`；发布区`E:/my_project/emby_third_party-helix-uat-release-20260908` detached 955fe42daf。原Aftercare Evidence修改未触碰、未夹带提交。

此前流水为[非现行快照](../../implementation/evidence/UAT_STATUS_SNAPSHOT_BEFORE_7608C517CD_20260909.md)。其旧“未发布”“待确认”等不再指导当前操作。

全站壳层221/237/238已逐项关闭，证据见[八页/会话/样式验收](../../implementation/evidence/UAT-221_237_238_SHELL_ACCEPTANCE_20260909.md)。251已补typed实施约束，尚待DTO/持久化/执行接入，其他开放项保持原顺序。

UAT-223文案、235注销模态、228人物能力文案分别关闭；235六项/隔离浏览器及新生产资产核对通过。见[收藏架验收](../../implementation/evidence/UAT-223_235_SHELF_DIALOG_20260909.md)。

前次发布及回滚备份：[841cbcf0c7](../../implementation/evidence/UAT_RELEASE_841CBCF0C7_20260909.md)。[228独立证据](../../implementation/evidence/UAT-228_PEOPLE_CAPABILITY_COPY_20260909.md)。

141/230已逐项关闭：当前片名、真实状态、错误/故障/未配置浏览器、5 Windows Query/5 Linux Query/5 Web/真实Host HTTP及生产资产核对通过。245真实全量查询尚待修正，不随本项关闭。见[概览验收](../../implementation/evidence/UAT-141_230_OVERVIEW_ACCEPTANCE_20260909.md)。

最新生产发布/回滚备份：[955fe42daf](../../implementation/evidence/UAT_RELEASE_955FE42DAF_20260909.md)。

129已关闭：当前异步准备失败→Intent提交后故障→Host自动恢复、唯一新Run、完整Inbox/ACK、两次HTTP及再次重启幂等。36相关回归、15 Host、3 Linux专项通过，95d7bb5734生产启动/挂载/六路GET通过。见[恢复验收](../../implementation/evidence/UAT-129_RETRY_INTENT_RESTART_20260909.md)。125/250输入漂移仍开放。

128已关闭：精确角色正负路径、Linux25项与当前完整Host真实迁移中断/自动恢复80.06秒通过；Inventory和最终文件逐字节不变、原Approval及Case收口，范围外文件保留。本次仅补测试，无新运行时代码。见[完整证据](../../implementation/evidence/UAT-128_SETTLEMENT_PROCESS_RESTART_20260908.md)。

142已关闭：八页核对、来源帮助折叠/计数去重、收藏架状态去重，17 Web/构建、相同生产资产与页面复验通过。240/241/247/248保持独立。见[文案验收](../../implementation/evidence/UAT-142_COPY_ACCEPTANCE_20260909.md)。

174/175/167逐项关闭：真实Host逐来源暂停、token重启持久化、无token负向隔离及Intake→Run窗口占位通过；修复UI缺幂等键，12 Web/构建、生产资产与浏览器核对通过。152等依赖项不自动关闭。见[席位证据](../../implementation/evidence/UAT-167_174_175_FIELD_SEATS_20260909.md)。

208按现行NFO合同关闭：源witness/原子改写/重启/精确Settlement，Linux94项及Windows12.96秒/Linux7.18秒真实媒体链通过；只补测试，无运行时变化。171/210及旧存量250仍开放。见[生命周期验收](../../implementation/evidence/UAT-208_NFO_LIFECYCLE_ACCEPTANCE_20260909.md)。
