# 当前实施阶段：PROD-065

2026-09-07。状态：DIAGNOSTICS_AND_BOUNDED_RECOVERY_IN_PROGRESS；用户已授权验证、标准部署及逐片恢复。
用户授权本任务完成 NFO 合同、完整审计和修复，并在11项排摸后授权逐步修复、推进异常影片。寒战2仅补齐网络失败诊断和正式新流程恢复。
基线 d486947c8；独立分支 codex/prod065-settlement-failure。

- 目标：关键媒体事实不变时，外部 NFO 改写不阻止新 Formation 完成上架。
- 证据：evidence/PROD-065_FORMATION_STALL_20260905.md。
- Owner：Libra 观察源与交接 Product；Arca 判定原唯一 Related 关联及 Settlement；Foundation 保留执行恢复证据。
- 合同：SSOT Final Reality amendment、MetadataObservation、ProductionProvenance、SettlementDeletionEvidence。
- 源观察：一次 bounded stable read，记录实际 Snapshot digest 和 key/value 语义 witness；不把旧 checksum 当永久写入锁。
- 持久化：使用已有 ProductionProvenance JSON，按 sourceRef 携带同Run观察；无新增表列、迁移或历史数据补写。
- Settlement：原 exclusive NFO mapping + 原语义 witness + 当前一致快照 + verified replacement；删除前再次核验快照。
- 恢复：前置错误 typed failure；continue-forward 预算耗尽有界停止；不把失败等同于副作用从未发生。
- 测试：同步/异步、同根/异根、原地/atomic改写、事实冲突、无证据、错误关联、删除后重放、源观察和重启交接。
- 最终验收：473项服务测试PASS、18条件SKIP、0 FAIL；210个架构测试文件及所有合同/依赖检查PASS；NFO改写+重启+不可变证据交接+On-deck专项PASS。
- 未执行生产写入、部署、真实媒体恢复、Reset 或 media-desktop 修改。

09-07后续11项只读审计发现D1：typed Settlement failure未保留具体目录/文件和语义冲突详情；D2：网络底层归因丢失。当前补齐白名单、有界、按 Attempt evidence digest 关联的诊断存储和查询；不把诊断当成业务事实、Result 或删除授权。验证后标准部署，再逐片恢复十项异常；哥斯拉不纳入清理。现有全量 Reset 不适用，需验证精确 Subject 范围及范围外数据保留。证据：evidence/PROD-065_ELEVEN_FORMATIONS_DEEP_AUDIT_20260907.md。

后续 Windows 验证：服务497项，479 PASS / 18条件SKIP / 0 FAIL；210个架构测试文件及依赖合同检查PASS；Admin Web构建PASS；Admin HTTP完整整理上架7项PASS；诊断持久化/不可用/读取专项PASS。逐片Reset及NAS参数29项PASS，六个生产目标只读范围检查均通过。Docker镜像验证与生产恢复仍待执行，不宣称完成。

09-07交付准备：代码提交 `93205bff21`，镜像 `helix-beta-20260907-93205bff21` 已构建、上传并通过SHA-256校验，标准deploy dry run通过，尚未apply。
Linux镜像的诊断和NFO改写/重启/完整On-deck链路通过；原Reset全套fixture使用临时路径，被Linux `/transcode`保护拒绝，未放宽生产保护。
使用真实`/transcode`临时挂载的逐片fixture通过；生产SQLite在线一致快照已下载校验，在Windows副本及Linux镜像副本上执行六Subject清理，89 Works、5 Workspaces、4 Packages闭包完整清零，51个范围外Run与44份既有Commit保持不变。
007的27506628703-byte Workspace合格文件已复制到独立保留目录，原件与副本完整SHA-256均为`1d274a41ee12b713535bce364a8ad2b9e2812cec48b6b5ab69af2aab4491677a`；原件仍在原位置。

Design待确认D3：SSOT§5.5.10明确要求目录closed-world，§10.10.2.1允许范围外材料残留且不授权空目录删除；当前实施按前者停机。
夺宝奇兵5同目录另一1080p具有独立`candidate_delivery`，禁止通过挪走该候选规避检查。已向用户提出具体合同调整：Settlement仅清理本Candidate有授权和替代证明的精确文件，范围外材料原地保留，目录不删除。确认前不改变该合同及其实现；其余已授权恢复继续准备。

交付前语义边界补查：`premiered/releasedate`统一为同一上映日期事实，别名冲突不形成witness；仅有TMDB ID而缺显示名的Actor仍须保护其身份。日期别名、Settlement及完整上架专项64项通过，Actor ID补充用例通过。最终部署镜像需包含该补查修正，先前93205bff21镜像尚未切换生产。

09-07后续生产执行：最终 `15bee70546` 镜像已标准部署；上述“尚未apply/未生产写入”均为此前时间点。六Subject离线精确Reset完成，DB integrity/FK通过，007合格视频完整SHA校验后进入正式Field，原件保留在Field外，哥斯拉独立正常完成。
恢复追加缺陷：历史失败的68页Field Observation被误当成必须先成功完成的前驱，导致所有新观察第一页回滚。依据现有SSOT§6.3.2，允许已准入的不同Work从null cursor及当前revision开始，不改变历史partial页、不原地重开旧Work。新round与同Work禁止重开两项回归、既有观察/Sidecar专项共22 PASS。

Field Observation补充验证：关联自动观察/枚举/保留15 PASS；210文件架构与合同/依赖检查PASS；最终1125d232c6 Linux镜像3项精确新round/连续性测试PASS（9项按名称未运行）。补充镜像标准上传SHA匹配、deploy dry run通过，apply进行中。

补充镜像1125d232c6已完成生产apply；Health ok，Admin Web/mount/exact image通过。真实新Observation已经提交第0至12页（revision1089至1101），上一轮partial页不变。D3等待用户确认，四部共享目录均已进入有界attention；原六项恢复等待正式整轮观察及入队，不能宣称全部上架。

2026-09-07 D3用户明确“确认”：本任务获授权修订Movie文件型On-deck逐文件Settlement合同并实施、验证、部署及推进四部共享目录影片。精确成员授权与Final验证保持，范围外文件/子目录及普通父目录保留，BDMV原子容器和其他生命周期不扩权。

D3实施：普通文件源清理只验证当前成员及Final，目录存在不要求closed-world，普通父目录始终保留并返回retained_directory；BDMV分支维持既有行为。同步/异步覆盖独立版本/子目录保留、身份漂移拒绝、重复执行和空目录；真实Admin链路覆盖候选冻结后新增范围外文件、NFO改写及重启到On-deck Commit。服务501项：483 PASS /18条件SKIP /0 FAIL；Settlement专项58 PASS，Projection/有界上下文23 PASS。SSOT source map按确认文本重新生成，P2合同检查PASS。


09-07恢复工具闭包修正：原六Subject Reset虽通过DB完整性与业务根清理检查，但遗漏Final复制产生的新Physical Identity控制记录，导致新观察仍判outside_procurement_region。改为同时从选定Arca custody直接枚举控制成员；官方工具新增有界精确orphan custody范围，拒绝仍存在的custody/On-deck Run及任何Inventory引用，不扫描清理其他孤儿。原始快照确认四个已授权Subject对应14条残留控制；生产副本演练只删除这14条及14条revision，0 Subject/Run/Work/Workspace删除，9340条范围外控制、全部Run/Work/Commit逐行不变，integrity/FK通过。Reset与NAS参数32项PASS（含空/非法范围、活跃custody与Inventory保护）；生产清理尚未执行。

NAS正式包装同步透传并校验精确orphan custody参数，继续使用停服、完整data备份、离线plan/apply/plan、重启健康检查；生产清理固定经formation-reset-nas.js执行。该工作站operator补充不改变5565a03eb2镜像内的已验证业务代码。

D3四部影片生产On-deck Commit全部完成，22个范围外文件操作前后完全一致；正式orphan控制清理14条完成。补充两部历史证据不足旧包已精确退场、媒体保留，《九月五日》旧snapshot重建问题仍在有界恢复中。详细凭证与备份见本包11项审计证据。

《九月五日》1 Run定向Reset已完成，Field正片保留，3条控制中1条回到Procurement、2条释放，integrity/FK通过；完整备份backups/formation-reset-20260907T105708Z/data。最后一次重启以来日志仅正常listening，旧Product Metadata snapshot重建错误未再出现。Field观察已继续到第30页；新Intake acceptance正在正式执行。总体恢复未全部上架，Phase保持进行中。
