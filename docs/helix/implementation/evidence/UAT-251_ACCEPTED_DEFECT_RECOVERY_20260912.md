# UAT-251 已接受瑕疵误识别与维护恢复

2026-09-12 用户确认实施。保持UAT-251开放，不新增重复事项。

## 问题与范围

生产286fe56f1e只读快照（22:59–23:02北京时间）：122收藏，103健康，9项自动体积维护（1 active、8 queued），10 attention。19项全部保留有效v1瑕疵授权，无手动修复意图。17项当前Finding与授权代码匹配；2项为旧media_strategy_unavailable结论。原始Libra冻结Spec与Arca错误重建要求的独立比对证明：旧代码遗漏评分分支，19项对应接受判断false；精确冻结要求下true。数据库检查不等于重新完成实际媒体检查。

## 实施合同

- 不改变Owner或Handoff。Libra通过现有ProductDeliveryPort增加有界历史Requirements读取，输入精确Package ID/digest集合，输出已发布AcceptanceRequirementSnapshot及来源；Arca只从自己的On-deck Commit/Custody取来源引用，禁止跨域SQL或依据当前评分重算历史。
- GET仅只读；单条与批量投影共用同一核验，缺证明确失败，不无条件豁免。
- 自动维护在准入、继续执行前核验已接受差距；手动意图保持独立。已经Commit者继续正式收尾；未Commit误触发者通过Work cancellation/drain及Case终结释放责任，不删除历史。
- 旧笼统Finding须重新做真实健康Assessment，不把其直接改名为已接受瑕疵。新缺失、损坏与未授权变化保留。
- 用户确认上述9项误建任务正式收尾及19项重查；不授权任意Reset/直接SQL、删改原媒体或其他任务。部署由既定负责人整合发布。

## 验证

- Windows 全架构校验 helix-architecture-verify.js：239 文件通过，原全套1819测试（1810通过、9跳过）；后增执行端转码拦截测试，专属6项再次通过。p15状态机15项、公开端口5项、Web care-workbench11项及Web production build通过。
- 全量回归最初仅2项因SSOT source map摘要未同步失败；通过标准materializer同步后全套通过，没有弱化校验。
- 生产一致只读副本940,773,376 bytes，仅保存在任务忽略目录；真实197表Kernel、Arca Store、Libra ProductDeliveryReader及ContextReader核对122项：111 healthy、8 unhealthy、1 repairing、2 attention。自动Case guard精确命中9项；仅模拟正式停止这9项后的投影为17/19 healthy，2项仍须真实Assessment。此模拟不等于生产已终结。
- Windows Node25.9完整评分读取遇到现有P6_PERCEPTION_RECORD_DIGEST_MISMATCH；部署负责人以三个相同冻结Record/Anchor及同源码独立确认：perception-store.js:484的未指定locale排序使Windows默认zh-CN和Linux默认en-US产生不同digest；两边ICU均78.2，交换locale即可互换结果，并非本次Aftercare回归。相同代码在生产Linux只读Database和固定事务内读取122评分成功。上述本地投影注入该公共端口输出，未跳过或改写记录校验。Linux候选镜像全链验收由部署负责人恢复实际Perception端口执行。
- UI负责人确认精确文案“已接受瑕疵，自动维护已终止”；保留unresolved，不展示已修复/成功。Web组件测试覆盖；生产实际页面验收待部署后完成。
- 未执行生产写入；部署、正式Case收尾、实际重查和原片/历史保护证据待部署负责人追加。UAT-251保持开放。

## 部署后正式执行与范围

1. 部署负责人按既定流程整合提交，fresh一致副本验证完整Host可恢复，备份/checksum/dry-run/apply完成后再进行生产验收。
2. 每项使用既有 POST /v1/admin/care/{shelfEntryId}/actions/check，JSON体为固定且可重放的idempotencyKey。9个未Commit误Case由coordinator.reconcile先走stopCase、cancelProcessWorks/drain，再持久化unresolved和accepted_defect_requires_manual_repair；如返回case_fence_draining等待在途工作结束，用相同key重试。正常后台reconcile也具相同保护。
3. 9项终结后，再以各项固定check key进入真实健康Assessment；其他10项同入口重查。旧media_strategy_unavailable会自动安排确定性deep assessment，不直接改写Finding。正常API检查会沿现有合同处理新真实问题；若线上事实与冻结范围不同，保留新问题并记录。
4. GET /v1/admin/collection及 /v1/admin/care/{shelfEntryId}验证当前结果；检查原Inventory、主片绑定/物理身份和已接受瑕疵仍保留，历史resolved Case不删除；核查误Case新Event未再启动转码。禁止直接SQL、伪造成功或清空历史。

| 影片 | Shelf Entry | 待终结Case（快照） | 后续 |
| --- | --- | --- | --- |
| 大风杀 | `2b34cd71a1040cce1427827ab09a88b0aa15ee8dcd9fdc24d1a629684808d159` | 无 | 精确已接受瑕疵，重查验证 |
| 黑匣子 | `50b4f763ac9e79108f44c7d19f84e877858ed579739c48094f6adc35c85fc1fc` | 无 | 精确已接受瑕疵，重查验证 |
| 守望者 | `2eb08381b9a6b92ed0a139635a5c31b24d4d1984187fb734cbc7d1e63b08b4bc` | `arca-care-db853f3adf6ea00dba44ae7439670a8b86b088eb` | 精确已接受瑕疵，重查验证 |
| 角斗士2 | `0ac9b83b4af863b20faba87839f5c3524a06cac93952fa6382e4f45e6618b0d2` | `arca-care-c73b14209bd642f44989fa85929e469d3001e94c` | 精确已接受瑕疵，重查验证 |
| 超脱 | `b08dc319efe4ae762701dd1f990c1f1cd66aeeae92fbc18037ed70fac38e578b` | 无 | 精确已接受瑕疵，重查验证 |
| 这个杀手不太冷 | `e032ddcbcceb3ff3b245f251f323791372268940b056f23352e3df7a2e4d2d51` | `arca-care-7cbfa046e3fd95b1e4858a8f40b588a3d3b2e841` | 精确已接受瑕疵，重查验证 |
| Black Widow | `eb3c9431ff78196e83e05643601a18902d551f31efc677486c626d784628126a` | `arca-care-751492a261dc1bd0fe574a9649dfd42f99ddbabb` | 精确已接受瑕疵，重查验证 |
| 美国队长 | `21cb4d40d855ccd50e3f72f69b511b6a1c0fa1809b8228e7b429864c99d59388` | `arca-care-8c592d807fde2f6aff22b775533eb0f65e2e4257` | 精确已接受瑕疵，重查验证 |
| 无可奈何 | `834f1ba751d4c5d699b2370eccd29a5fdca05f19c6a98d1ef741a32d6585c433` | 无 | 精确已接受瑕疵，重查验证 |
| 速度与激情：特别行动 | `4e5ab37996d88e87142f12563045d8aa9febb53e1ff63eaf7a69260975bf8441` | 无 | 旧笼统结论，真实重查 |
| 霍比特人3：五军之战 | `64031e840aff6ebebaa4c592a6ef0033e8fe4f236fd3097d378bb964b907318f` | 无 | 旧笼统结论，真实重查 |
| 阿姆斯特丹 | `14db9643fb87916c37ba0344bc03b9b9af3918cc9a3be8b401f1689f3e17e495` | `arca-care-5b01f82f6f4070e356bc40b9293dabff79baf792` | 精确已接受瑕疵，重查验证 |
| 浪客剑心：京都大火篇 | `d853df7969580eb92012d5f5d87fc0c1a02f9a2e41a76f62861ae6fcf36f9d37` | 无 | 精确已接受瑕疵，重查验证 |
| 哥斯拉-1.0 | `4e251672bf3aae5edbccdd57395a7a8c322bc29583c868b750e3eec71e66384c` | `arca-care-ddc792dcc673ee5cda1e240a5234f00fa902752f` | 精确已接受瑕疵，重查验证 |
| 不能说的秘密 | `192e8156148e09e4e6da8ce49c25e4308285c11c1580b88a7e78bf5c0af3f3ef` | 无 | 精确已接受瑕疵，重查验证 |
| 从21世纪安全撤离 | `a166fc7f35281a269a3462e40baa75a94609171d9e86f1576f32c05a94c60d25` | 无 | 精确已接受瑕疵，重查验证 |
| 唐人街探案3 | `e03a4eb97259a356deee3dc55eb3b4a209645dfffd2e5534694576fbdd1c1d26` | 无 | 精确已接受瑕疵，重查验证 |
| 养蜂人 | `f318297a2e229127ba56cdf2779d052b7a96cbe2ab1e3b67aa3e3094c9250bdc` | `arca-care-ba53d35e12874aea71559ef4d57ccf0dc585139d` | 精确已接受瑕疵，重查验证 |
| 拆弹部队 | `c475f05c6be85d2ce31d37cb17e57bee61c2d4d5710e2d83565e7494b3bfde53` | `arca-care-e21469ca587407343c72ea93f65404a861fcfae9` | 精确已接受瑕疵，重查验证 |

## 联合部署验证与收尾阻塞

2026-09-12 16:04Z（北京时间9月13日00:04）由部署负责人追加。正式源`e7c84dd536b8c2b9a1bac103f037ed9422225f92`已fast-forward整合；独立干净发布树构建`markmahoro/shelfdeck:helix-beta-20260912-e7c84dd536`。标准build/upload完成，tar SHA256 `513e039e29fa3f04cd7db66d5950076331a607de6e3d9d670dd7d3d8b1038fdc`，NAS Config ID `sha256:9bf0d71a20240ce0ccd067a8bb8f835759b4188f740e25c0b8e2f2069d7efb86`。仅加载候选，**生产仍286，未apply，未执行生产Case收尾或检查**。

- 精确候选Linux：专属6、状态机15、公开端口5，共26/26通过。15:53Z候选容器对生产DB只读，使用真实Perception公共端口和Foundation WorkResultReader，122批量及19详情的originalRequirements/CareBasis完全一致，guard精确命中9 Case，无评分注入。
- 15:48:41Z fresh完整一致副本：`/vol1/1000/docker/shelfdeck/test-runs/aftercare-release-20260912/data`，45文件manifest digest `12fba691a3e2c9f4c3df0d27e6d713d5dc97e3715cce180f4f8a01e4bd343abf`，122收藏，971 Delivery=138 accepted/824 open/9 rejected，integrity ok/FK0。
- 候选完整Host：生产媒体/Workspace只读、网络none、独立data；ready/normalSupplyAllowed、60s观察、正式close及8保护表全行摘要保持均通过。只读挂载导致其他Libra工作EROFS/ENOENT，已识别；新增`ARCA_AFTERCARE_MANUAL_DEFECT_INTENT_REQUIRED`拦截被真实执行轨触发，不按无错误全链报告。旧286在候选运行后的同格式副本启动/观察/关闭也通过，8保护表不变。切回候选使用同一fallback数据，并调用真实session/actions/check，仍在本节时点运行。
- 完整生产备份：`/vol1/1000/docker/shelfdeck/backups/unified-helix-beta-20260912-e7c84dd536`，45文件，原件及复制件aggregate digest `1a1c14458287881de9a7e27c524a1110d774dfc09449e76b5aacda7f3a44e278`，SQLite/FK正常，compose/Secret保留；15:59:55Z完成。标准deploy dry run通过，等待业务收尾门禁。
- 生产只读保护基线：122 Entry、19指定Entry的141个当前Inventory文件均可读取，采样指纹/size/inode/mtime已记录，无物理错误；所有旧Case、Assessment、Inventory事实和执行尝试已导出到ignored Evidence，生产没有变更。

正式接口副本截至16:04Z：8/9误Case为`unresolved / accepted_defect_requires_manual_repair`。最后《拆弹部队》仍`case_fence_draining`，Work `arca-care-work-5628687565aa0fa423f510aa443450605d8d8dbc`为running，Event `care-transcode-0171e951386bd80307` executing，Attempt `event-attempt-d67fcdb0-a894-4713-8e80-6ea90fd0d56c` executing，Effect `cab0c91289510f34bc5e536a7aaa669f76778aa55bfba37440971025dcd7bece`为reconcile_required；后继media.verify已cancelled。Host反复出现manual-intent-required，疑似执行前拦截同时挡住已有Effect的只读reconcile证明，已交原开发任务核验，尚不把假设写成最终根因。

其余检查已提交真实Work，例《大风杀》`arca-care-work-6db9979fd16115b5a4cf9ad48eef2d254fd6104e`的custody/conformance/presentation三个观察均succeeded，但assessment.commit waiting_for_resource；新Assessment尚未成立。不能仅凭17项旧投影已healthy宣称19部重查完成，也不能把被占用资源直接删掉放行。

本时点决定：暂停生产apply，保留8成功终结及未决Effect现场；补修既有Owner正式reconcile/cancel/drain后再验，不Reset、不手改Effect/资源/历史摘要。原始文件位于集成区ignored `.codex/unified-release-20260912/aftercare-*`；活动切回副本为NAS `aftercare-release-20260912/aftercare-fallback/data`，容器`shelfdeck-uat261-aftercare-cutback`，不得在其运行时并发写入。生产locale未改变，Perception跨语言排序问题继续单独记录。

## 副本验收发现的Workspace终态缺口（2026-09-13）

e7c84dd53候选完整Host及旧286回退均ready；实际检查在一致副本中结束8/9误Case，但《拆弹部队》持续case_fence_draining。精确Event care-transcode-0171e951386bd80307及Attempt仍executing，Effect cab0c91289510f34bc5e536a7aaa669f76778aa55bfba37440971025dcd7bece为reconcile_required。生产尚未apply。

原因不是recovery observer无法读取，而是Workspace无已提交marker被分类safe_retry后，执行端activeCase抛出的新授权拒绝异常被non-pure recovery原样重抛，未生成正式failed Outcome，因此无限重入。修正为Arca四个Workspace生产入口在写入前返回明确failed/executor、retryDirective=never，由既有Foundation正式abandonUncommitted并完成Event/Attempt，再由Case cancellation/drain收尾；不生成成功Result。只适用于新执行与safe_retry/safe_retry_before_intent；continue_forward/already_committed、formal material commit及Inventory后Settlement权责保持原合同，不将未知正式源变更伪装为无效应。

追加验证覆盖四个Workspace入口在读取/探测/写入前拒绝、未知或已提交恢复不被直接放弃，以及真实EventRuntime恢复后不产生Result、发出abandon并允许Work取消且drainingWorks=0。该运行时测试使用真实SQLite/EventRuntime/WorkLifecycle，Effect Journal是观察调用的test double；真实Effect持久化链仍由部署负责人在保留的故障副本复验。完整回归结果及最终生产结果待追加。

同时使Foundation恢复分支与正常dispatch遵循同一技术终态规则：仅在abandonUncommitted已成功且Outcome明确never重试时强制terminal_failure，避免safe_retry_before_intent仍等待reconcile；不以Arca业务码作Foundation分支，continue_forward与timeout未知Effect不满足此条件。EventRuntime52项通过（包括上述两种恢复与无Result/Work可取消），Arca专项21项通过；此前完整239文件回归通过，最终追加后的全套正在运行。

## 2026-09-20 生产只读复核：黑寡妇与磁盘满

本轮用户要求整体排查整理阻塞及自动接受体积瑕疵后仍发起转码，并追问 `/vol1` 满盘原因。仅执行只读检查，未重启、发布、Reset、取消任务、清理文件或修改生产数据库。

- 08:06–08:10Z 生产仍为 `markmahoro/shelfdeck:helix-beta-20260912-286fe56f1e`。集成 HEAD `b87b92ab8` 已含 `e7c84dd53` 的精确冻结要求读取/自动 Case 拦截及后续 typed recovery 修复，但不能把已合入当作已上线。
- 《黑寡妇》Entry `eb3c9431ff78196e83e05643601a18902d551f31efc677486c626d784628126a` 当前 Inventory 仍保存 `AuthorizedDefectManifest/v1`，明确豁免 `max_size_exceeded`。Case `arca-care-751492a261dc1bd0fe574a9649dfd42f99ddbabb` 却 active，目标为同一 `conformance:max_size_exceeded`，没有 `repair_accepted_defects` 手动 trigger，且没有 Aftercare Inventory Commit。当前自动体积 Case 共 1 active、6 queued。
- 对照旧版实现及本记录前次独立验证：旧 `aftercare-store` 从 initial Standard/Fact 重算 originalRequirements，未完整重现冻结评分分支，导致旧 v1 授权要求摘要比较失败；已接受体积差距被当成普通健康维护。SSOT 要求精确已接受瑕疵只能手动修复，当前行为属于既有 UAT-251 缺陷。
- 《黑寡妇》Event `care-transcode-9c2933fb85f83901a7` 自 2026-09-13 起仍 executing，Effect `042e1d1253d6a0846c0d7d44bfc52511e1624d0d31ef29dfaa1760d28b5fd4ab` 为 intended。另外 3 个 Libra Work 中 1 个 input.verify executing、2 个 waiting_for_resource；后两项均在等待 `encoder:local-intel-qsv-0` 和源卷读取资源。`docker top` 仅有 Node，没有 FFmpeg/FFprobe。因此不是正常持续转码；持久执行未收尾。资源 timing 在 finally 落库，本轮未取得进程内 Governor permit 快照，不能仅凭持久 Event 宣称黑寡妇独占全部资源。
- `/vol1` 总 175G、已用 174G、可用 0、100%；`/vol2` 可用 392G。日志 2026-09-13T21:04:59Z（北京时间 9 月 14 日 05:04）有 `SQLITE_FULL: database or disk is full`。Node 约占一个 CPU 核，公开 health 仍返回 ok/normalSupplyAllowed=true，不能据此判断任务正常。满盘是当前已证实的全局写入阻断；不能据本轮快照断言它解释了此前全部停滞时序。

### 空间归因

`/vol1/1000/docker/shelfdeck` 实占约 156G，主要为：

| 类别 | 只读盘点 |
| --- | --- |
| backups | 57G |
| test-runs | 38G |
| 根目录镜像 tar | 53 个，29,773,700,000 bytes 左右，约 27.7 GiB |
| data | 22G；其中 Aftercare Workspace 21G，SQLite 主库约 1G |
| 根目录旧 data.backup/data.failed | 11 个，合计约 9.3G |
| task-audit-20260908 | 2.5G |

Aftercare Workspace 中《这个杀手不太冷》转码文件 10,513,633,969 bytes、《拆弹部队》10,169,631,926 bytes、《黑寡妇》未完成 `.mkv.tmp` 1,763,704,832 bytes。上述空间是历史部署/排障资料累计与维护转码工作文件共同占用，不能归因于数据库本身或仅黑寡妇。

`ARCA_AFTERCARE_WORKSPACE_ROOT` 在生产未设置；`clean-service-host.js` 默认使用 `dataDir/workspaces/aftercare`，实际落于 `/app/data` 对应的 `/vol1`。Libra `/transcode` 挂载在 `/vol2` 并不自动覆盖独立 Arca Workspace 配置。根路径调整必须核验现有 Workspace Handle、未决 Effect 和 Owner 收尾，不能直接搬目录或删除输出冒充修复。

### 后续处置顺序与限制

先为生产数据库恢复空间：核验现存备份/回滚职责及不再使用的测试副本、镜像归档，形成精确迁移/清理范围并取得对应授权；保护运行数据、未决 Workspace 和必需回滚资料。随后在隔离副本完成最终修复的真实 Effect/cancel/drain 验收，再由既定部署负责人标准发布、正式收尾误 Case、重新检查健康与资源释放；另核验 Aftercare 独立工作盘配置及满盘后的调度/health 行为。本次仅诊断，不宣称已恢复或 UAT 关闭。

验证命令：`production-helix-execution-diagnostics.js`、经 `nas-ssh-config.js` 的只读 SQLite 查询、`docker ps/top/stats/logs/inspect`、`df`、定点 `du/find`、公开 health GET。原始快照只保存在集成区 ignored `.codex/black-widow-*-20260920.json`。未运行修改后测试，因为本轮没有产品代码变更；未实施媒体全量验证或生产恢复。

## 2026-09-20 UAT-262/263/264 授权实施

用户明确要求清理工程过程资料、让 Aftercare 自动使用用户 vol2 Workspace，并将自动回收与 Libra 对齐；完成后继续本线程 UAT-251 主线。无需用户另设 Aftercare 路径；不增加任意 Formation Reset。

UAT-262 第一批已执行：冻结98个目标，逻辑文件大小113,578,322,075 bytes；精确清理50个旧tar和48个闲置工程目录，逐目标核对realpath、inode、文件数/大小、symlink及全部Docker挂载。保护data、所有媒体、当前286/备用e056/候选e7 tar、有原媒体的aftercare-health-case备份、三片/最近Reset/本次完整备份和待验Aftercare副本；不清Docker engine目录。清理后vol1从100%降至57%，可用75G；未以逻辑文件总大小冒充实际释放量。随后正常后台恢复Libra转码和健康检查，并自行回收约19G旧终态Aftercare输出；当前该目录剩黑寡妇约1.7G临时文件。工程删除未触及运行数据。

本次新完整一致备份为 `/vol1/1000/docker/shelfdeck/backups/workspace-recovery-20260920`，44文件、2,821,517,507 bytes；逐文件SHA256 manifest摘要 `ce53cc80835ab96e20d6004371afb73629ae3b17e2876363b31ec8e1026f084a`。SQLite online backup、quick_check及FK0通过；compose/secret随备份保存。旧副本含21G文件不等于当前活跃目录仍为21G。生产健康GET仍正常，但资源诊断路由返回未实现503，不能把该接口当作Governor占用证明。

264实现：取消终态额外24小时等待，保留至少60秒间隔的两轮引用/成员审计；重启重做。Case相关活动Work（包括尚未生成Handle的producer）或未决Effect阻断；注册成员逐文件身份重验、正式Work/Receipt和恢复路径保持。冻结Assessment策略精确推导的输出/临时路径经两轮稳定观测后登记为回收成员；未知文件仍阻断，不能按 `.tmp` 通配删除。无引用未决责任不伪造成功。旧Root只有所有Registry已回收且物理空才能推进Platform revision，不改历史Handle。

计划分两次标准发布完成同一修正：先保持旧Root使当前Aftercare正式收尾/回收，再启用统一Workspace派生子目录；这样无需跨卷搬运/重写未决Material身份，也无需用户增加配置。17项定向检查通过（随后增加Root切换检查）；全架构首轮只有新增SSOT行号派生合同摘要和纯模型path依赖门禁失败，已通过标准materializer及纯函数修正，不放宽门禁。最终完整验证与生产结果待追加。
