# 当前活动包：逐项关闭UAT

更新：2026-09-12。ACTIVE；合同审查及三项用户确认已完成，用户要求整理文档后继续推进。
唯一排程为[Master Plan](../CURRENT_PLAN.md)，状态及每项现行关闭条件为[UAT总表](../UAT_ITERATION_REGISTER.md)。

## 当前执行位置

UAT-259：第二轮UI精简已获实施授权，沿用既有ui-polish detached工作区；仅呈现变更，保留251/257/258功能接入，完成本地走查后交统一部署。[范围与验收](evidence/UAT-259_UI_REFINEMENT_20260912.md)。

发布由“收口并部署上线”任务统一负责合并、工作区清理及上线，按UAT-251、接收恢复、UAT-257扫描修复的实际依赖与验证结果自主安排批次；UAT-258完整提交38e89d145已接收，仍待生产验收。此次任命无需广播，不限制必要技术协调。各开发任务不独立部署；当前生产仍为83235c9260，交接预检不等于发布。见[接手审计与发布缺证](evidence/UAT_JOINT_DEPLOYMENT_READINESS_20260912.md)。

UAT-257扫描阻塞：`codex/field-observation-recovery`隔离实现、受影响回归与真实临时Host浏览器验证完成，UI负责人复查通过；保留旧失败事实，失败重启节流及成功启动检查均验证。统一部署任务接收提交及[正常扫描验收步骤](evidence/UAT-257_SCAN_RECOVERY_IMPLEMENTATION_20260912.md)，该扫描任务未部署或生产重扫，整项开放。

UAT-258：用户授权将收藏架清理折叠入口改为“自动清理残留文件”授权按钮，对齐UAT-256视觉及去多余层级规则；集成区本地实现完成，90项测试、构建及真实临时Host桌面/窄屏走查通过，未部署。仅改前端呈现和交互，沿用Arca授权范围/API。[交互及验收](evidence/UAT-258_RESIDUAL_CLEANUP_AUTHORIZATION_BUTTON_20260912.md)。

2026-09-12接收恢复修复：UAT-125/250在独立`codex/intake-recovery-20260912`提交`9820e7b85`。新Movie并发/事务中断/两次重启、投影负向Fence和两文件隔离/回滚验证通过，精确2个pre-Subject Reset在一致备份副本闭包清零且范围外逐行不变。但5个open旧Candidate存在23项Control revision失配，正式Control Evidence/拒绝恢复分叉合同缺口未收口，生产Reset保持阻塞；详见[证据](evidence/UAT-125_250_INTAKE_RECOVERY_20260912.md)。该修复任务不执行生产操作，统一部署负责人安排整合、发布及后续现场验收。

2026-09-12：UAT-256已获用户实施授权，在`codex/ui-polish`隔离工作区完成前端视觉与文案整理，89项测试、桌面八页本地与83235c9260生产八页/五Tab验收通过，已独立关闭；[范围与证据](evidence/UAT-256_UI_POLISH_20260912.md)。不夹带其他开放项，不修改媒体整理现有列表或业务逻辑。

1. 整理已确认合同及活动文档，去除旧暂停/待决策和已关闭队列；检查259项连续、状态计数、剩余35项归属及链接。历史过程保留Evidence。
2. UAT-171已按现行Oracle关闭，见[真实媒体/生产证据](evidence/UAT-171_NFO_CURRENT_CONTRACT_ACCEPTANCE_20260909.md)。135/136已按真实ISO完整链与生产48077d71bd发布逐项关闭；132已按Windows/Linux真实Direct HEVC完整链关闭；137/160已按[独立真实媒体证据](evidence/UAT-137_160_FRESH_MEDIA_ACCEPTANCE_20260909.md)关闭。
3. UAT-210：记录更新已部署，继续单席位、批量变化、健康与处理状态分离的完整验收；已接受瑕疵及同条件重复Case部分按251已确认合同实施，不把局部通过当整项完成。
4. 接续B1–B5：125/152使用新确认规则；172已按正式授权闭环独立关闭，见[验收](evidence/UAT-172_AUTHORIZATION_ACCEPTANCE_20260909.md)；134已按[精确范围及重放证据](evidence/UAT-134_SCOPED_SETTLEMENT_ACCEPTANCE_20260909.md)关闭；159/163回收已关闭；156/157真实设备及预检亦已关闭。继续125/152更广恢复与压力条件核验。218真实质量保护已独立验收关闭；210/125接续检查过程中更换标准导致旧Assessment提交/恢复失败的隔离复现。251已确认typed合同，继续实现，无待询问的旧业务决定。
5. 125/250恢复输入漂移保留精确因果证据，不吞错/Reset；209/216存量核验保护现有收藏、正常生产、sample及另一完整版本。
6. 245已按独立生成快照、Owner计数/分批读取、真实备份完整服务及生产浏览器验收关闭；240/241/248已按[八页浏览器及隔离确认验收](evidence/UAT-240_241_248_BROWSER_ACCEPTANCE_20260909.md)分别关闭；接续251已确认typed合同落地。247跨页缓存仍独立开放。

## 验收及保护

UAT-257：拒绝后下一轮普通Triage、未决交付占用保护、同轮幂等及历史包统计，按[合同与验收](evidence/UAT-257_PROCUREMENT_REJECTION_CYCLE_20260912.md)本地实现及验证通过。来源统计UI与UAT-256任务已明确分工；已联合部署，最终Linux闭环与生产统计通过；六条旧资格仍无新成功扫描，整项保持开放。

每项按原问题、现行SSOT、实现、正负路径、适用真实媒体/浏览器与生产版本核验；提交、测试或部署不单独等于关闭。仅有新变化、失败或缺证时重复已通过检查。发现已被取代要求时按当前条件验收，不能为使旧测试通过恢复旧行为。

本轮68项功能关闭、35项开放及206承接已核实。当前生产`83235c9260`，[发布及回滚证据](evidence/UAT_RELEASE_83235C9260_20260912.md)。

用户授权实施、本地验证后标准发布、允许中断FFmpeg；精确Input清理持续授权已明确。有效媒体/持久事实/Secret/备份/回滚保护不变，不直接SQL修改生产，不任意Reset。原Aftercare调查Evidence修改不覆盖、不夹带提交。工程选择自主处理，真正新增业务边界才逐项询问。

## 已部署三片修复的剩余范围

9月11日已部署代码纳入本次集成；《太阳帝国》恢复已完成，其他条目不随本次UI发布自动关闭。以下保留原包冻结范围，不在本次UI/Procurement验收中额外执行。



1. 已完成：标准build-image → upload-nas-image → SHA256 → deploy dry-run/apply；完整data和配置备份位于`/vol1/1000/docker/shelfdeck/backups/three-films-c10e516e64-20260911`。未clean-init/Reset或直接改SQLite。
2. 《人生密密缝》精确 On-deck Run 为 `844d2564f525ee73c36564559e8b5cbefc704f8cf65457796af7b72bf6215615`。停服后重验下面两个冲突文件的 size、SHA256、非 symlink、路径 containment，以及当前 Inventory/Libra Binding/Off-load Context 未引用它们；任何变化停止。
   - `/media/Film/人生密密缝 (2017)/人生密密缝 (2017).nfo`：7427 bytes；SHA256 `0c36f85dad179428446e6fb946a98df535913aa297dc9e90be83285560df25d4`。
   - `/media/Film/人生密密缝 (2017)/poster.jpg`：1031527 bytes；SHA256 `db80299781122985c4dea6001f88bcffce25c7f5952c91823259eb3bc98f8619`。
   - 两项先复制到应用根下独立备份目录，验证复制的 SHA256 及原件仍未变化，再移出冲突位置；保留 manifest 与原件恢复路径。原 MKV、字幕、旧源 NFO、fanart、torrent 不在隔离范围。
3. 已完成：《太阳帝国》精确On-deck Run为`28c2d89e239b3e6d50bbbcdaeafe37fb5e04685fe9a1aa1c68238863d673fbb9`。恢复前重新验证7项Final；generation 5正式retry成功，11项精确旧输入均absent，7项当前Inventory核验通过，246项范围外文件前后不变，BACKUP/META保留。详情见本包证据。
4. 两条均使用正式 `POST /v1/admin/formation/acceptance/:offerId/actions/retry`，以当前持久事实解析 Offer ID，不手改 Work/Event/Effect。若旧执行仍活动，先让修复后的当前 Owner 恢复流程收敛，不人为置终态。
5. 验收必须看到每条恰好一个 On-deck Commit、相应 Shelf Entry/Deck Fact、精确 Inventory 文件、settlement/member 终态及无活动相关执行。只看到 UI 进度变化不算恢复。
6. 《一战再战》保留合法外部下载；验证页面当前阶段及解释，不取消下载、不放宽 DV 转换、不调整14 GiB要求。
7. 回滚先保留新现场及失败证据；新镜像无 Schema 变更，可回滚 binary，但不把已完成的正常业务 Commit 当作应回滚数据库。冲突备份只在目标无人占用且核实当前 Owner 后恢复，禁止覆盖新产品。
