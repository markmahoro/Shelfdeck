# Formation 终态收尾接手诊断（2026-10-23）

2026-10-27 RESET-PEOPLE-REFERENCE-CLOSURE修复候选（未部署）：People公开声明图片/embedding两条必选Artifact边；预检、保留库验证及protectedSummary增加People参考事实/登记/真实Image Port读取核验，缺失、错属、摘要变化、文件损坏明确拒绝。独立保留依赖纠正工具只从原完成Reset回执绑定的完整档案恢复仍被当前People要求的缺失embedding登记，精确数量/Handle及参考事实摘要绑定；已有不同登记不覆盖。先完整备份当前停止态，再在全量副本补回原始行，239表除Registry允许18行之外逐表摘要完全不变，旧失败和新采购历史保持。双备份验真、原生生命周期租约、已完成Stop revision、独占挂载和原子切换journal均接标准deploy；原Reset marker/回执不改写，恢复后仍stopped，原请求可续跑。原档案在Operator容器中额外只读挂载，工作目录与原档案重叠在停机前拒绝。Windows/Docker均已列入新脚本。

本轮增量验证：完整Service862/833PASS/29skip/0FAIL（concurrency4、原90秒断言未放宽）；受影响Reset/Supervisor138PASS；最新People原生Handle/端口/缺失源/物理文件/错属/新事实保护/备份及Stop/lease/切换中断/重放11PASS；标准NAS控制器含旧Bootstrap11PASS。首轮policy夹具修改frozen对象、冷工具函数泄露临时环境及Compose断言路径错误均保留日志后修正；SSOT source-map首轮drift已重新生成，capability138/result117/table239/transaction62未改变。完整固定候选Architecture、Linux实际镜像和NAS生产副本纠正资格仍待完成；生产仍b0c32d0e9、stopped/revision34，无生产登记恢复/再次Reset/新Resume。

2026-10-27 01:48Z 新生产回归阻断（覆盖上方/下方恢复成功检查点）：恢复后3个新US任务均frozen，失败码PEOPLE_IMAGE_ARTIFACT_CHANGED。只读前后对比证实：Reset前18个active people_reference_faces均有active embedding Artifact，Reset后这18条Registry行缺失；图片Artifact仍18条正常。Owner保留策略只声明people_reference_assets.artifact_handle_id，遗漏people_reference_faces.embedding_handle_id，而原库没有People fx_artifact_references记录，FK检查无法发现该opaque引用遗漏。18个物理特征文件/48,996字节SHA全部与原备份一致，691收藏保护仍通过。此为本轮Reset缺陷，不能记为全面恢复正常或业务待确认。01:44:55.318Z正式Stop完成：revision34/stopped/quiesced/所有inFlight0/error=null，operation3b4ac11e5c4270be038b2540c5bdaf0b36202866bc3192b546029d005d046133。继续补People所需的必选Artifact闭包和负例验证，并准备从校验备份精确恢复18条登记的停止态副本方案；不再次清空已生成的新任务，不直接编辑运行库，不重建自动观察。修复及恢复后仍须正常Resume与真实新任务验证，目标尚未完成。

2026-10-27 01:37Z恢复后第五份有限样本：五来源仍可读、JAV/US完整新扫描已完成，国产剧/剧集/电影继续推进；已自然生成691个western_adult新包，API为3进行中/0 attention，Libra身份、依据、接纳和一次媒体生产已有真实成功，当前691收藏/0个本次新Commit，无新孤儿。01:38Z Restart0/OOM=false，vol1实际可用19,065,085,952、vol2 335,631,990,784字节。最新新容器日志累计66次AbortSignal警告；同一cgroup样本memory.current4,939,501,568、扣除inactive_file2,839,191,552、anon382,468,096字节，oom计数0；不同指标不作性能改善或泄漏结论。未扩展4K吞吐/启动风暴实施，不重建自动观察；自然入藏与人工确认项继续开放。

## 2026-10-27 生产执行与独立保护验证（已完成 Reset 和 Resume）

用户明确授权vol1清理、生产部署、Reset，并追加核验后恢复正常生产。最终固定来源b0c32d0e9bdc4f86103d8d2d8dcae92d315e5ad6，tar SHA256 8cc3be32fa7ca9e04e8cdc3ff075347d6d7e2a6e6e0cca16e181ef72b36f15cd，NAS image sha256:86c43ced7ad713b263763f4bd86d000efdcb6984c89624546df1bffbee2cb949。原e78已安全Stop，无等待转码完成；标准continue仅凭原closure、完整恢复备份重新验真继续，不重建或伪造停止证明。初次Bootstrap读取原SQLite生成空WAL被严格拒绝，修复为私有源后全量资格通过；未放宽源库物理集合检查。

- vol1两份完全重复旧主库逐字节验真后删除，共9,229,676,544逻辑字节；两份非重复诊断SQLite完整六文件转存vol2后移除vol1原件，共9,229,742,080字节。保留原清单及替代映射回执，没有Docker prune或其他应用清理。最终实际卷可用空间见CURRENT_STATUS，不能按逻辑字节相加推算。
- 部署恢复基线910文件/32,689,623,577字节已完整复验，verificationDigest197165d53c8879206c3577da60eedc6e41d1af5ac9fa73e2f06ee4ccdfd1c4b5；Reset专属完整备份另为32,689,656,630字节、1196清单项（含目录），inventoryDigeste718312ea0102e7a0d1a6868044b5d91ba74993942480ae8c4dcd0f7f5764da6、verified/complete。备份及隔离文件均在/vol2/1000/shelfdeck_backups/fresh-reset-final-20261027，不递归包含旧备份。
- Reset请求fresh-reset-b0c32d0e9-20261027绑定预检65ea3dc26e745b0a42f7702823d348a60ab0836c269f7a4bc81769e7a788dae4，完整重复核验后返回202；operation07aba5a6e80a4ee4c808279a1ac7550b49996a84f827663f9620630ce27d9ddf，generation13fcd0d320da5dcc0d02040fc22461b11afbb05729db089d9bacba4fc205711c。01:23:00.036Z完成，revision32/stopped；Receipt、switch、cleanup均complete。新库candidateDigest4068f97466961963f490c7e9c15f36eb3e3f4a3ec4908a20fe1fac8f4ba76739，retainedDigest45596ff901af69fc10fa835b15d95fd25ad5a7f319c14a1c1ab82f39a79e1925。
- 实际迁入必要依赖1,332,064行、移除2,002,021行，迁入计数不含后续Reset审计新增；685个Subject收口、695个Workspace归档。清理868项/27,436,291,513逻辑字节，保留4个Arca Workspace的39项/2,119,794字节；来源和正式根未清理。cleanup receiptDigestaf7c876f97506432578f58732ae3a9eda24ab966164e45ea80508afc14cde2e8。
- 独立镜像进程只读核验当前库与私有原备份副本：691 Commit/691 Package逐个重建、10组保护表摘要、两组共享scope及两项资料依赖一致，239表完整FK/integrity通过，峰值RSS172232KiB；原备份主库SHA187b57fb8d51d3e486ff71c48740e43673722471f2e401933e11708c3cc0540d保持。SQLite临时排序明确在vol2作业目录。39,317来源/正式路径stat完全一致，6570库存路径、91个原已缺失不变；未宣称全体媒体内容SHA。
- 停止态独立查询open Offer、active Subject、active/suspended/frozen Run、token、workshop placement、无Commit的active custody、旧observation entries均0，五Field reset barrier为新代际。辅助审计首跑误将691个已有Commit的active custody算作未入藏，原失败日志保留；依据Owner Commit事实修正查询后通过，未改写生产custody。Host交接一次ECONNREFUSED后正常打开stopped，未重启容器；不是重复Reset或失败回退。
- Resume请求fresh-reset-b0c32d0e9-20261027-resume，operation2ce9340c8c3b227597de1da48d42fd3d48c8c9055e9c53632090f88533135f66；01:26:22.293Z完成，running/revision33/normalSupplyAllowed=true/error=null。增量时间用Node Date.parse原始UTC createdAt，sinceMs1793064380831，未使用PowerShell隐式本地日期。五来源新扫描和新的材料评估已实际推进，分时结果以CURRENT_STATUS最新节为准；不把health、Handoff接纳或Formation completed当新收藏Own。

证据留在本机忽略目录.codex/formation-diagnosis-20261023及NAS作业operations：b0c32d0e9-reset-final-summary.json、reset-completed-runtime、production-independent-verify-first、production-files-after-first、production-stopped-audit-first/second、resume-submit/runtime和business-sample-N。原代码/测试/构建首跑失败均保留，最终b0 Architecture428文件3408项（3382PASS/26skip/0FAIL）、四项静态、Service全量复验851/822PASS/29skip及三轮Supervisor各10PASS、实际Linux13PASS、Windows与具体版本UI已通过；e69中间Gate主动终止仅记incomplete。高达/凡人歌不强制采购；未确认映射、演员和体积瑕疵不代选。监听器警告未证明泄漏，4K吞吐及启动风暴未在本轮扩展实现；自动观察不重建。

恢复供给后若需回退，必须先安全停止并保存新的当前基线，检查是否新增Commit或物理变化；不能用旧备份自动覆盖Resume后的新收藏事实或复活旧未入藏状态。以上是生产事实，以下为此前开发与发布检查点。

## 2026-10-27 冷态主流程与界面开发证据（未发布）

正式 `server.js` 已使用新 Supervisor，旧退役 Worker 不再是裸 Host 的默认备选。Operator 配置由明确 `SHELFDECK_RESET_CONFIG_FILE` 提供，未配置即拒绝预检；当前生产配置未改变。Platform 在旧 Repository 关闭前签发代际/凭据 revision 绑定的管理授权，冷态仅允许鉴权、状态和原确认请求重放，保持同一 HttpOnly session；常规业务和 Resume 拒绝。成功后才构建新的 stopped Host。来源、历史目标、People 根及必要维护子树由 Owner 保留库配置派生并再次核验，`reset-owner-boundaries-second.log` 14 PASS。

- `reset-supervisor-first.log` 新 fixture 缺初始化确认，3 FAIL；第二轮补确认后缺 Admin build，3 FAIL；第三轮产品完整切换通过，但测试比较被 Fastify 附加 callback 的 address 对象失败，13 PASS/1 FAIL。listen 改传配置副本后第四轮 14 PASS，未掩盖前三轮。
- 生命周期独占租约绑定 dataDir，覆盖正常 Host 与冷态管理；不能按另一个 operationRoot 绕过。持久写入退出凭据 + 新进程取得租约共同证明中断关闭可继续；无退出凭据仍阻断。`reset-supervisor-lifetime-first.log` 14 PASS/2 FAIL：强杀测试未保持 lease JavaScript 引用而被 GC 释放；裸 Host 新错误未进入 HTTP error classifier 而返回500。测试保持真实 lease 引用，分类新增明确 Reset 错误后第二轮3 PASS；完整 Service 第八轮再覆盖所有相关用例。
- `reset-fresh-reprocurement-first.log` 1 PASS：无 Run Subject/Accepted Offer 与旧采购证据退出在线库，停止态重启不采购，显式 Resume 后只产生新一代任务，源文件 inode/mtime/bytes 保持。`reset-fresh-media-journey-first.log` 1 PASS：旧未入藏 Work/Circuit/Incident 在线清除，重新观察→新 Candidate→真实 FFmpeg→正式 On-deck Commit。该旅程初始无已入藏收藏，不冒称混合收藏保护验收。
- 完整 Service `reset-generation-service-eighth.log` 837 total / 808 PASS / 29 skip / 0 FAIL。随后仅补安全中文 Reset 错误文案，后续新增功能仍须新门禁。
- 浏览器 `reset-supervisor-browser-first.log` 四视口12 PASS/4 FAIL：冷态首次访问仍先挂业务页面，缺正式 Runtime 的 fixture 页面先失败。新增 Runtime 首次读取边界，未知时不挂业务页面；第二轮16 PASS，覆盖一次确认、容量不足、原请求继续、其他会话改变 revision、完成后停止及适用 axe 检查。第二轮截图/trace 位于 `.codex/formation-diagnosis-20261023/reset-browser-second-artifacts`；不是 UI 负责人验收。
- 完整 Web 第一轮39 FAIL/227 PASS：原 App fixtures 没有提供新启动所需 Runtime 响应；加入明确的 running fixtures。第二轮42 FAIL/224 PASS：新 beforeEach 误返回 spy，被 Vitest 当 cleanup 调回已恢复的真实请求；改成不返回值。第三轮 `reset-generation-web-full-third.log` 47 files /266 PASS。未放宽 Runtime 状态门禁。
- Source-map 已按 SSOT 重建，aggregate `d3729f4c94aaae08f38b3ffd995c8fb1434e5229cfc91b9b718bedcdd5c41b3b`；manifest/contract 独立检查 PASS。当前未跑最终完整 Architecture、Windows/Linux 固定包与最新生产副本；季集映射 Store/API/UI、容量删除清单及最终具体版本 UI 负责人仍开放。

本段期间未访问或修改生产，未 Reset、删除任何生产备份/媒体、部署或重新创建观察。下面时点记录保留。

## 2026-10-26 彻底 Reset 实施检查点（未发布）

本节为当前开发事实，下方早期“未执行”等状态按其时点理解。当前代码尚未形成可发布的新 Reset；生产没有部署、Reset、删除备份或媒体操作，已取消的观察不重建。

当前增量及首跑记录：

- 第七轮完整 Service `reset-generation-service-seventh.log`：826 total / 797 PASS / 29 skip / 0 FAIL。
- 新 `run` 冷态编排在同一 Operator lease 内完成全量校验备份、保留库准备、切换、临时清理和 generation fence 完成；重复请求绑定相同 spec/idempotency key，已完成回执重放不重复处置。备份 allocation/manifest/staged file/files verified 四处中断保留旧尝试，新尝试重核业务逻辑快照、私有字节清单及各卷峰值预算，允许收录新管理失败审计但不放过旧 Offer/Workspace 改变；已验证备份损坏拒绝且不悄悄替换。`reset-cold-pipeline-first.log` 首跑测试把备份目录旁的 journal 算作第二份备份，按实际目录区分后第二轮 14 PASS；`reset-cold-pipeline-recovery-second.log` 27 PASS。本机 Linux 一次性无网络/生产卷容器 `reset-linux-cold-development-first.log` 29 PASS，仍是源码覆盖、不是发布镜像资格。
- `reset-cold-child-recovery-first.log` 7 PASS：在原生 schema 全链路中注入 old_database_moved/文件 unlink 后异常，再由真正新子进程继续同一操作，均完整结束且保持 stopped、来源/收藏样本字节不变。注入点使用异常，不冒称该两点是 OS 强杀；真实强杀释放的独立 lease 测试已另记。
- 新 Runtime adapter 已经通过真实鉴权 HTTP（以 Host factory 注入，未替换默认入口）完成 preview→pending intent→关闭旧 Host 的所有连接→独立冷流程→Runtime 完成回执→新 Host stopped 重开。`reset-runtime-cold-handoff-first.log`、第二轮均 FAIL；第二轮只补安全错误码定位，确认 `HELIX_MOUNT_SCOPE_UNSAFE` 来自全新 Host 生产工作区使用固定 synthetic scope、未注册实际挂载。修复为先由已有 Platform Workspace Root Admin 探测/注册初始根，再由 Product Port 使用该根；有任何旧 Workspace 历史却缺根时拒绝，已有配置保持。第三轮 1 PASS，首跑保留。`createFormationResetPort` 是当前注入点，默认路径仍旧 Worker；未宣称已交付新 Runtime 主流程。

- 第六轮完整 Service `reset-generation-service-sixth.log`：807 total / 778 PASS / 29 skip / 0 FAIL；不包含下列后续代码。
- Libra/Arca 各自提供保留 Workspace 声明，Operator 仅按精确 Platform root Handle 解析当前主机路径。Libra active/reclaiming 必须有一致 Foundation registry，Arca 必须对应所选 Aftercare/Series/JAV correction；reclaimed 仅作历史，不根据 Artifact active 标志保留物理文件。增加精确 Libra Workspace→registry 闭包，未保留 Subject 所有 Run。预检由所选保留库生成私有保留子树并绑定摘要，执行再次验证；根不明、路径冲突、整根保留冒充精确依赖均拒绝。`reset-owner-workspace-first.log` 首跑为 Windows fixture 先删目录后关闭 SQLite 的清理错误，顺序修正后第二轮 9 PASS；加入自动路径绑定后第三轮 15 PASS。此项未完成全部来源/正式根配置派生或 Runtime 主入口。
- 独立 Operator 在其配置作业根使用原生 SQLite 排他锁，操作期间不打开业务库来锁定，不依赖 PID 文件的存活猜测。重复预检/切换请求拒绝；异常或真实子进程 SIGKILL 后 OS 释放锁，可重试且不删旧锁文件。`reset-operator-lease-first.log` 7 PASS（含实际原生 Operator）。锁以同一配置 operationRoot/dataDir 为界；Supervisor 尚未接通，未宣称不同配置根间已有系统级仲裁。

- Windows 独立分发新增真正 fork 的预检检查，服务经现有 HTTP stop 进入 stopped 后读原生库，分发包自身依赖可完成预检，随后仍停供给。首跑新增测试误写 `/runtime/stop`（404），修正为既有 `/runtime/actions/stop` 后 `reset-windows-native-preflight-second.log` 1 PASS；首跑保留，未改产品路由。Linux 本机一次性容器使用已验证 b2 镜像的 native dependencies、只读绑定本轮源码/脚本/测试、无网络和生产卷，`reset-linux-native-development-first.log` 64 PASS；这是开发源码覆盖，不是本轮最终镜像资格。
- 新增 Control opaque scope 核验：SQL FK 全绿不能证明 current Control 未指向已清除 Subject/Procurement 或未提交 Custody；验证器只接受保留收藏/共享 scope 的 Arca Control 及合法无主 released 事实，未知责任拒绝而不虚构 release。`reset-control-closure-first.log` 6 PASS；冷备 08 只读核验为 6,286 shelf_entry Control / 434 released / 0 shared，无异常。这是增加阻断证明，未声称已实现所有混合历史场景的 Owner 责任正规化。此项代码晚于上面的 Windows/Linux 资格，最终固定版本仍须完整验证。
- 试图补充 root `fuser` 检查的只读执行未获 sudo 凭据，`fresh-capacity-open-file-check.json` 保留明确失败；未输出任何凭据、未绕过权限、未把它当成无占用证据。精确删除方案仍未提交执行。

- 系统专用 Workspace 内允许 Owner 明确保留的维护子树/单文件；冻结清单分别标记 retain/clear，只删除 clear 精确文件并保留必要祖先。hard-link 指向保留文件、越界/符号链接、迟到写入均拒绝；结束时再次比较保留文件和目录身份，不把“仅剩保留项”当作字节未变。`reset-private-retention-first.log` 43 PASS，含清理中断恢复/来源保护/真实原生 Operator。Owner→实际路径的生产闭包及主入口配置仍待接通，未据此清理生产 Workspace。

- 最新完整 Service 第五轮 `reset-generation-service-fifth.log`：790 total / 761 PASS / 29 skip / 0 FAIL。Architecture 开发首跑 `fresh-reset-architecture-development-first.json`：424 文件 / 3389 total / 3344 PASS / 19 FAIL / 26 skip，约 61 分钟；JAV 长旅程已结束，四项静态检查 PASS。修复 schema/public export/dependency 固定断言和 Windows 打包漏项后，`reset-architecture-failures-second.log` 为 102 total / 97 PASS / 3 FAIL / 2 skip；余下 aggregate、Procurement table count、FK count 修正后 `reset-architecture-failures-third.log` 11 PASS。Windows 独立分发本次已通过。后续代码尚在变化，未宣称固定候选全量资格。
- 旧三表合同导入 CLI 的 235-table 历史目标仍固定；当前 Host 为 236-table，因此旧回执必须拒绝。p4 Host 测试改为明确 `CONTRACT_COPY_RECEIPT_INVALID` 且目标 SHA/行不变的负例，未扩大旧导入工具或运行兼容分支。这项现在不覆盖“旧 CLI 正向打开当前 Host”，原历史切换正向资格留在原时点证据，不伪装覆盖继承。
- `reset-generation-qualified-08`：1,317,301 retained / 1,851,761 removed，耗时 898,578ms；676 个保留 Subject 行政结束旧准入，682 个 Commit/Package 逐项 Reader 一致，完整 FK/integrity 和十组保护摘要通过，ownershipDigest 仍为 `1d850e5a55b59cd9c8a3f49b5f8459aa02b758521ba52d11f48936552db49efb`。相比 07 增加 319,268 行，主要是纠正 Aftercare/acceptance/JAV correction 的实际 process type/id 后保留收藏维护所需 Foundation Work 闭包，未扩大到 Subject 所有 Run。补充 Arca 已提交共享版本→Libra Metadata Observation 精确 evidence/result/payload 证明，只保存所需事实与执行证据，不因此保留来源未入藏 Run 全生命周期。3 个 Shared model + 3 个 Metadata model、维护副本和真实进程组合 9 PASS。原冷备共有 shared scopes 仍为 0，生产混合共享根资格未完成。
- 新准备/切换恢复：备份逐文件发布、最终 staging 发布、构建 retained DB 的失败尝试都有持久阶段；失败副本保留，新尝试不覆盖不删除旧证据。已完成冷 Reset 的 Runtime intent/receipt 在新 Kernel 打开前收口，始终 stopped；未完成切换仍拒绝普通启动。`reset-backup-recovery-first.log` 11 PASS，`reset-staging-partial-first.log` 14 PASS，`reset-cold-finalization-first.log` 9 PASS。
- 独立检查库的复制原先若被杀会留下无法继续的半文件；现复用 journaled staging 发布。真实子进程从 123-byte 失败副本重试，保留失败件及完整备份 SHA，`reset-inspection-copy-recovery-first.log` 3 PASS。
- 新预检使用完整只读逻辑快照绑定所有表内容，包括待清除行；不是只核收藏数或 retained digest。关闭连接时 WAL checkpoint 改变物理 DB 字节不会误判旧确认；相同条数但旧 Offer 内容变化、Runtime revision、Owner policy 或保护边界变化均拒绝。独立子进程在真实停止态 Host 完成原生 schema 保留/正规化/Owner Reader 检验，仅写专用可丢弃检查库；成功后只清自身精确命名文件，失败文件留证，不改业务库/intent/媒体或产生真实备份。容量不足返回各卷预算与 `selectionStatus=not_evaluated`，不编造保留/清除数。`reset-native-preflight-first.log` 18 PASS，增加不足空间返回后第二轮 10 PASS；目前仍未接通用户 Runtime 主入口。`reset-snapshot-fence-first.log` 24 PASS / 2 FAIL 为 Windows fixture 先删目录后关闭 SQLite，修正顺序后第二轮 26 PASS，首跑保留。
- 容量审计 `fresh-capacity-audit.json` / `fresh-capacity-details.json`：/vol1 available 8,370,216,960 B，/vol2 available 376,877,453,312 B；vol1 backups 45,744,103,424 B、diagnostics 76,106,862,592 B、releases 20,994,064,384 B，vol2 backups 117,487,677,440 B。独立 Operator 的当前保守同卷 staging 预算超过 /vol1 可用量，不能借用 /vol2 余额或未来清理空间。容器挂载确认 `/vol2/1000/shelfdeck_upgrade` 同时属于 ShelfDeck/MoviePilot，禁止整体清理。ShelfDeck 现有备份卷挂在 `/app/data/operator-backups`；新独立作业根/备份根必须在部署方案中明确，避免输入树包含输出或递归旧档案。
- 14:09Z 起只读逐文件重复件核证 `fresh-capacity-duplicate-proof.json`：vol1 `backups/history-cutover-c91fbed63-20261025/source.sqlite` 与 vol2 `pre-c91fbed63-20261025/data/shelfdeck.db` 均为 4,615,077,888 B、SHA256 `44ed9880bb7867bb701458b334afdb5cc8ef2ca131ec4e08c278392226e2f6cd`；前后 stat 稳定。相同字节数的 `diagnostics/history-contracts-230a3100a/source.sqlite` 为另一 SHA `306f76a315cce5713e35d45edc1fc6946964e18fee9278c54958bcc357708e64`，不能按名字/大小视作重复。`fuser` 对部分 `/proc` 返回 permission denied，未将空结果作为无占用证明；仍无可执行删除名单，不删除文件。

- `formation-reset-process` 通过真正 fork 的 Operator 执行原生 schema 准备/切换/私有空间清理，再构建停止态 Host；SQLite 临时环境仅在子进程设置。首跑因只读打开备份 SQLite 仍创建 WAL/SHM 而被严格备份校验拒绝；改为验证后创建逐字节相同的私有检查副本，备份文件不由 SQLite 打开，2 项复验通过。这是空收藏原生流程测试，不是媒体入藏验收。
- Arca Owner 区分已提交收藏的维护 builder 与新未入藏 Season builder；只保留前者及其明确依赖，后者从共享 head 清除，已提交版本和文件关系不变。3 项混合状态回归通过。历史 Linux 路径在 Windows 检查时曾被执行态 path.resolve 改写而误拒；改为验证不可变事实的规范摘要，不改变执行路径校验。
- 冷备 04 因未索引逻辑边遍历缓慢，人工停止本地验证 Node；05/06 改为 Operator 私有磁盘索引后完成。06 保留 999,354 / 清除 2,169,708；07 增加 Procurement 指针投影与新观察屏障后保留 998,033 / 清除 2,171,029，耗时 332,452ms。两轮均 676 个保留 Subject 结束旧准入、682 个正式 Commit 与 Package 经 Owner Reader 一致；07 完整 FK/integrity 和十组收藏事实摘要保护通过。原冷备无已提交共享剧资料 scope，不能据此称生产混合季样本通过。
- `proc_field_reset_barriers` 由 Procurement 持有；复制时仅显式解除 Field 当前扫描头，保留需要的历史观察，Owner 将头设为保留最大 revision 并创建本代际屏障。新扫描 Work 含代际且从空 cursor 开始；旧失败 TTL 不抑制新代际首次扫描；旧页写入与旧 terminal Observation 的采购准入均在 Owner 边界拒绝。首跑发现空头 CAS 未使用 null-safe 比较，修正后通过；一次负例误将 fixture 原有 marker 视为新产生，改为逐行前后相同验证。`reset-epoch-third.log` 65 PASS。
- 本轮新增表使用冷导入 schema 资格检查：既有表/索引必须与目标逐项一致，仅允许明确声明的新增空表；Platform marker 由新 Kernel 生成并进入回执，不复制旧 marker 冒充新 schema。没有给业务运行时添加旧包或旧 schema 兼容分支。
- Service 第三轮 770 项为 741 PASS / 29 skip；第四轮 771 项为 735 PASS / 7 FAIL / 29 skip。7 项均为历史合同证据切换测试以当前 schema 作为历史目标；测试改用固定 235-table 验收 fixture，旧工具不放宽增量范围，`reset-historical-target-second.log` 9 PASS。静态首跑新增表产生 `field_id` FK 推导歧义，补明确目标；生成物来源定位漂移通过正常 materializer 同步。后续契约静态 PASS，不抹去首跑失败。
- 映射查询增量：真实 TMDB Adapter 支持独立 Provider Episode 坐标，Season 0 仅用于资料查询；精确 show/season/episode/id 不符或 404 均拒绝。Libra 负责投影回本地季集编号；Provider 响应与来源引用仍记录 Provider 编目。测试使用合成唐顿特别篇/暗算跨季坐标，不代表用户已确认现场映射；Store、版本输入发布和 UI 仍待实现。

- 已新增按 Owner 声明复制保留库、逐卷峰值容量核算、系统专用临时目录冻结清单、逐文件可恢复清理、冷数据库代际切换、显式备份排除清单及文件校验。`formation-reset-offline.js` 将复制、Owner 正规化、收藏核验、切换、清理和回执串联，要求外部提供真实关闭连接的停止屏障与已校验完整备份；目前未接入 Runtime 主入口，不能据其单元测试执行生产 Reset。
- 备份排除要求逐项 `inventoryDigest` 与用途依据；不按文件名/日期排除，不递归包含旧备份。空间不足、热 WAL、别名路径、源漂移、部分备份、额外文件均显式拒绝。清理只按冻结清单逐项执行，保留私有根目录；来源与收藏目录不参与递归清理。
- 下载的冷备数据库为既有 `pre-ba75692d4-20261026` 中的 4,882,046,976-byte 文件，SHA256 `8817cfa34e8ef847ff5ad4dbcf3d1cc92b02b8553297cbbebee8ad1ab131f361`，NAS/本地一致。它只有 682 收藏，不能代表当前生产 690 收藏或替代最终 Reset 前完整备份。
- 保留库 01 通过 SQL FK 却漏掉无 FK 的 Arca→Libra Package 依赖；02 被 Event progress FK 阻断；03 补齐后保留 960,733 行、清除 2,208,329 行。原库与 03 的 682 个 Libra Package、682 个 Arca Commit 均经真实 Owner Reader 重建一致，完整 FK/integrity/Kernel 检查通过。Owner 结束保留 Subject 的旧准入资格时首轮完成 56 条后暴露 Arca 历史读取缺陷；修复后继续完成余下 620 条，所有 682 Commit/Package 复验一致，ownershipDigest `1d850e5a55b59cd9c8a3f49b5f8459aa02b758521ba52d11f48936552db49efb`。该验证没有改变来源/收藏文件，也不是最新完整保留策略的最终资格。
- 新发现 `P14_ONDECK_INVENTORY_HISTORY` 根因：写入 Inventory 摘要包含 `relatedPrimaryMappings`，历史读取漏掉该项。Arca Reader 现在只使用自己的冻结 Placement Decision 与 Inventory mapping facts，把实际放置材料键还原为摘要所用的产品键。没有改写历史摘要、没有逆向读取文件系统、没有借用 Libra 私有表。
- 新缩略图 Host 回归首先在 Promotion 前超时。诊断定位为本地集 NFO 字段完整但缺演员，规划器只检查全局演员、未补集级来源，Media Cast 按现有代表集来源规则得不到演员。修复规划器的集级资料请求后，36 项 Metadata/Fact 测试通过。完整 Host 后续两类测试断言问题（新增一次 cast 请求使来源证据数加一；新断言误读嵌套 Commit Receipt 字段）修正后，`reset-collection-thumb-after-cast-04.log` 真实 Host 旅程 PASS：新包→资料→正式 Commit→历史 Reader→原有来源清理。首轮及中间 FAIL 日志均保留，不冒称首次全绿。
- Service 首次全量为 760 项：730 PASS / 1 FAIL / 29 skip。唯一失败是 Secret 包装失败现已保留 allowlist `causeCode`，既有精确 diagnostics 断言未同步；未改变错误分类或泄漏过滤。同步后 102 项受影响组合测试通过，包含备份、离线 Operator、切换/清理中断、迟到输出拒绝、停机子进程、映射模型、Metadata/Fact、真实读取关联等。完整 Service 首跑记录为 `reset-generation-service-first.log`，定向为 `reset-generation-targeted-02.log`。本节不代替最终固定候选全量门禁。
- 风骚律师原始失败为 `P5_SECRET_LEASE_INVOCATION_FAILED`，进击的巨人为三次 `P5_PROVIDER_TRANSPORT_FAILED`；原始 diagnostics 空，尚不能还原底层 HTTP/网络原因。新增安全 causeCode 传递只能改善后续证据，不能当作两条历史失败根因已被修复。

尚未完成且阻断发布：Runtime/API 真正关闭并重建业务连接的集成、Owner 对混合共享剧根/当前观察指针与重新采购资格的完整正规化、旧 Worker 回执的真实跨代际验证、季集映射持久化及确认入口/Provider 查询/新执行输入、生产精确容量清单与最终全备、Linux/Windows/完整架构和具体版本 UI 验收。季集映射当前只有纯模型及负例，不能当成已可用的用户功能。所有生产动作仍按已批准计划最后的具体材料单独确认。

状态：诊断完成，产品修复与生产处置未执行。基线：`ee0c4786b`（`codex/formation-big-release-20261022`）。

本聊天原 checkout 为 `983b6a04a`，诊断实际读取 `ee0c4786b` 所在开发目录。没有切换分支、修改产品代码、部署、生产 Reset 或生产数据写入。本次没有重新查询 NAS；198/214/11、Control 分布等是用户交接的现场快照，不能当作本次实时核验结果。

## 工作项与范围

沿用唯一 CURRENT_PHASE，新增命名工作项 `FORMATION-TERMINAL-CLOSURE`，本次完成其诊断。Owner 为 Libra；Procurement 只负责正常观察、资格与新 Candidate；Material Control 维持既有 release/acquire 合同。性能、旧收藏离线补文件及生产处置不在本次诊断实施范围。

用户交接的新方向作为后续设计输入：保留有界系统 auto-discard，但不能把 Provider/网络/FFmpeg/候选不足直接终结；Run、Subject、Control、token、可见结果及审计必须闭合。没有改为 Subject 长期保有 Control，也没有引入逆向 Handoff。

## 已确认发现

### 1. 自动结束使用了错误的判定代理

`libra-run-admin-service.js:409` 的 `reconcileFrozen` 调用 `defectCandidate`；`P9_DEFECT_ADMISSION_INELIGIBLE` 或 `P9_DEFECT_ADMISSION_NONWAIVABLE` 直接进入 `discard(..., 'processing_failed')`，并不独立验证“这是允许自动终结的业务原因”。因此“不能豁免要求”与“本次应自动结束”被耦合。缺少必需 Artifact、缺少安全验证等均可能到达此路径。现有 integration unavailable fixture 确实在有界等待后自动 discarded。

这不是本次 ee0c4786b 新增的路径。后续应把产品资格、技术重试预算、业务终局资格分开；失败码字符串或 `integration_exhausted` 分类本身不能授权释放责任。

### 2. 系统终局不执行 Subject 收尾

`libra-run-admin-service.js:544` 仅当 `terminalReason === 'user_cancelled'` 调用 `cancellations.complete(subjectId)`；系统 `processing_failed` 跳过此步，但继续释放 token、失效 Projection 和 wake。

`task-cancellation-store.js:102` 内才有“无剩余 Control、全部 Run discarded/superseded → Subject abandoned”的检查，并且依赖 pending 用户取消意图。不能给系统补一个伪造用户取消意图来绕过此缺口；应由 Libra 定义双方共用的责任终结及可恢复收尾。

真实当前 SQLite schema 的隔离 fixture 复现：single Subject `active`；Run `discarded`；Decision actor `system`；原输入 Control `released` 且 owner 为 NULL；取消意图 0；Outbox 仅含 `libra.workspace-cleanup.requested@1`。因此新运行即可产生该组合，不是必须由旧数据迁移才能出现。

### 3. 活动列表隐藏不证明责任已终结

`formation-query.js:726` 用 `!currentRun && nextAction.label === '等待重新入库'` 判断 `isIdleAfterUserAbandon`，没有检查 actor 或终局 Receipt。`countHiddenActive` 和 `isVisibleActiveItem` 同时影响列表与计数；后者还要求 token/currentRun/Handoff B，单纯删掉文案判断仍不足以修复可见性。

但“系统丢弃彻底不可见”不成立：`formation-run-history-store.js` 可从 Discard Receipt 和 `processing_failed` Outcome 在 ended 区显示“无法上架”。活动列表按 Subject，结束历史按 Discard Receipt/Run（另合并无 Run 的 Subject abandon Receipt），不能直接把两区行数视为同一粒度。缺少 Receipt/Outcome 的历史仍需独立核账。

### 4. Reset 的历史保护承诺存在可复现交集

`user-formation-reset.js:22` 选择 active 且 Projection 为 in_progress/attention_required 的 Subject；`helix-formation-reset.js:335` 收集所选 Subject 下所有未 Commit 的 Run，不排除 discarded；随后删除 Discard Receipt、Decision、Outcome 和 Run。`RuntimeControls.tsx` 却无条件声称保留已完成/已结束历史，preview 的 `protected.endedRunCount` 也是全库计数，未扣除删除范围。

隔离复现 seed `active Subject + discarded Run + in_progress Projection + unable_to_on_deck Outcome`：公开 preview 返回 `ready=true`、`protected.endedRunCount=1`，选中该 Subject；同一 scope 的 apply 后 Run=0、Outcome=0。此 fixture 证明 selector/deletion 交集，不冒充完整生产副本演练。

因此 scoped Reset 198 项也会删除这些 Subject 所含终态历史。全量备份使其可离线追溯，不等于运行库保留历史。既有“删除所选未 Commit 闭包”和最新“保留 ended 历史”不能在这个交集上同时成立；修复前不能把当前 Reset 作为满足全部保护要求的方案执行。

## 需要纠正或保留开放的判断

1. **自动 discard 并非天然违反 SSOT。** §5.6.7 等旧段要求用户决定，但后文 `UAT-251 / UAT-212：2026-09-08已确认结果与展示修订`、9 月 12 日持久结果修订明确覆盖旧规则，允许“本次无法上架”及责任收尾。用户本次进一步限制技术失败的自动终局，需要同步相关 SSOT/typed 规则；不能仅据旧段把自动终局整体删除。
2. **release 不等于把 Control 直接交给 Procurement。** Discard 对 Run Manifest 逐成员执行 `release`、`toScope:null`，释放后无主合法。Procurement 后续正常 acquire 才成为 Owner；不能为“完整回 Procurement”实现反向责任转移。
3. **198 个旧 Subject 不等于 198 份材料当前完全停摆。** 当前 Control 已是 Procurement 的材料可能已进入新流程，也可能停在新资格/Selection；必须沿 materialKey 检查新的 Observation、Procurement Run、Candidate、Handoff A 和新 Subject。旧 Subject active 残留与材料没有后续进度是两个问题。
4. **不是完全没有定期重采机制。** `field-observation-automation.js` 已有启动扫描和 12 小时周期（本轮相关 11 项测试通过）。Discard Outbox 没有 Procurement 通知；现有 `reconcileMaterialControlChanges` 消费入口仅用于 Shelf deregistration。并且 `availableForAutomaticRun` 明确拒绝同 Observation 重放新轮次，简单新增 wake/重跑旧 Observation 不足以保证新尝试。需查实际周期 Observation 是否成功、资格与 Selection，而非直接新增重复 TTL。
5. **5 个 Subject / 202 个仍由 Libra 持有的材料尚不能直接定性为 release 部分提交。** 当前 release 是同事务、精确 Run Manifest 集合。必须逐项比对被丢弃 Run Manifest、当时/当前 Control revision、其他 Run 与后续 intake；可能是 Run 范围外的 Subject 剩余输入或重新取得责任。所有 Run 已 discarded 且责任仍无消费者确属需闭合的异常，但不能不核范围便释放整个 Subject，Series 尤须保留其他范围。
6. **6 条缺 Decision 单独追踪。** 汇总无法证明是合法历史变体还是完整性损坏；需查原 Run revision 内 Decision、Receipt、marker、Outcome 与 Control history，不补造审计。

## 验证

Windows / Node：

```text
node --test test/helix-architecture/p9-run-lifecycle-store.test.js test/helix-formation-projection.test.js test/helix-architecture/p7-field-observation-automation.test.js
73 PASS / 0 FAIL / 0 SKIP
```

另以 Node Module 在内存加载上述 lifecycle fixture 和 Reset fixture，注入只读诊断断言/临时 SQLite 测试数据，各 1 PASS；未修改原测试文件或产品代码。前者复现系统终局后的 active single Subject，后者复现 Reset 的历史保护交集。临时 fixture 按原测试清理；无生产访问。原测试 PASS 说明旧行为被测试固化，不等于满足本轮要求。

未执行：完整 Gate、Linux/Docker、浏览器 UI、生产只读逐材料核账、完整副本 Reset、新版部署或生产验收。不继承交接里其他测试为本次 PASS。

## 后续验收顺序

1. 先冻结本轮有界终局资格；恢复仍在原 Owner/Work 合同内，不重开不可变 failed 执行，不重试绕过安全边界。
2. 新建 single/Series 的系统终局和用户取消均验证责任闭合；保留其他 Series Run/待分配 Episode，Subject 结束或保持有明确理由，token 不早放、不漏放；覆盖提交前后崩溃与重放。
3. UI 从正式终局/责任事实分类，活动列表与 ended 历史各自粒度清晰，不能靠中文文案推断用户决定。
4. 验证 release → 普通新 Observation → Procurement acquire → 新 Candidate → Handoff A；对已进入新链的材料不重复触发，不加逆向 Handoff。
5. 解决 Reset 范围与历史保护的交集，真实生产副本验证当前保留集合和删除闭包后，再按明确生产授权处理旧数据。198/225 均不能直接作为已冻结执行清单。

目前结论是可复现的生命周期收尾缺陷，且 Reset 存在独立保护缺口；不需要因此推翻 A 模型或引入长期 Subject-scoped Control。

## 最近提交与版本上下文复核（2026-10-23）

用户要求先恢复版本上下文，暂不进入修复。复核 Git log、关键产品 diff、git blame、CURRENT_STATUS 与原专项 Evidence，主要范围为 10 月 21 日生命周期版至 ee0c4786b；对自动 discard 和 UI 隐藏追溯更早来源。下述上线状态来自已记录发布证据，不是本次重新查询 NAS。package version、旧 VERSIONING 当前值及 Git release tag 不能替代实际镜像/commit。

本轮另重跑 `node --test test/helix-architecture/series-shared-presentation.test.js test/helix-architecture/p14-h1-tmdb-integration.test.js`：20 PASS / 0 FAIL / 0 SKIP，约44.7秒；涵盖真实Integration Runtime Handle及NFO正反例，不等于生产五项重试成功。仅更新本Evidence，无产品改动。

| 批次 | 关键提交 | 实际解决的问题 | 状态/边界 |
| --- | --- | --- | --- |
| 10-21 普通重采与公平竞争 | 63ad3baa2 | 移除 Libra 的历史失败同条件 reentry 抑制；Procurement 技术准备失败可在下一次普通 Observation 重做；Libra Run 按来源轮次及 Candidate 发布时间公平竞争；Arca 恢复不再只处理分页首项 | 已随后续生命周期版上线；未修改系统 auto-discard 的终局判定，也未补系统 Subject 收尾 |
| 10-21 取消与恢复生命周期 | 843bdff25、40861e877 | 持久取消、安全收尾后完成；无 Run Subject abandon；取消与排除分开；Intake/Routing/Spec 准备失败可人工重试；退休来源闲置 Control 释放；superseded Workspace 回收；Arca 人工恢复取消32代限制，自动限制保留；优先级投影重启恢复 | 已记录部署；Subject 终结检查新增在用户 cancellation.complete 中，系统分支仍绕过 |
| 10-21 重试界面及分页修正 | 438822156、6c7493964 | 撤销独立准备异常入口，准备异常并入原任务行；统一“重试任务”；修 ended 只读数组分页500、混合分页、迟到请求错误覆盖 | 6c7493964 已记录部署，是3.1.0前生产基线；这不是后来三段重试标签方案 |
| 3.1.0 主功能开发 | 85ab5c7e1、ab5f610ae、29824b87d及后续 | UAT-326：JAV来源资格稳定，执行时签短期Handle，处理TTL后恢复漂移；UAT-327：分类目录按完整媒体组确定性分批，保留1024上限；UAT-328：剧根tvshow.nfo/poster/fanart、剧/季/集Provider scope、跨季复用、重试补图、维护、退出、Workspace回收 | 经hostfix3进入生产；5部剧集异常属于新公共资料路径首次上线的缺陷，不是旧版已运行同路径后来失效 |
| 10-22 发布前增量 | 3917633f8、48cd492c7 | Season目录poster/fanart/season.nfo作为相关来源；Movie从源文件名/父目录派生edition，避免不同版本撞同一目标；不能形成安全edition时明确报错 | 已包含在后续上线镜像；作用于新事实/新包，不重写旧冻结Package；高达/凡人歌现场未因提交自动收口 |
| 10-22 其他增量 | 27a43e6c5、91e991c4b、16665e604、62624bc45、99ff13e14、23abf7705 | 筛选刷新保留计数；US Adult新分析阈值0.42；冲突诊断及“处理冲突”入口；恢复错误带Event身份；写入类输入漂移显式失败并保留Effect，pure observation改为新Attempt重试 | “处理冲突”随后由ee0c删除；这些不是本轮P1–P4性能优化。pure observation先被626纳入终态，后被23ab改为重试，不能只读中间提交描述最终行为 |
| 3.1.0 首次部署尝试 | 23abf7705 | 上述组合候选225→231结构升级 | 10-22 17:25记录因Aftercare root冲突回滚，不能视为成功上线 |
| Host修复并成功升级 | c18618177、37a264935、064f01d13、2664b4014 | 读取持久Aftercare root；识别旧生产Catalog；blocked投影避免嵌套事务；接受精确旧业务终态Result的reason vocabulary | 10-22 20:20记录3.1.0-hostfix3成功；注意37a包含旧active Plan按当前Capability/Projection检查后恢复，不只是历史展示兼容，未在本轮评价其授权充分性 |
| 3.1.0-hostfix4 | b70a9f6f6 | 已取消Subject不再请求仅接受active Subject的评分，消除Formation列表/详情/后台投影500 | 10-22 21:36记录部署；只修查询，不修剧集Handle/NFO或系统discard |
| 最新本地修复 | ee0c4786b | TMDB profile声明artifactOperations；真实Handle接受剧集source/assets的poster/fanart；NFO允许-1占位；三段重试标签、删除冲突对话框；扩大工作台Reset并增加receipt | 未记录部署、生产重试尚未验收；Reset保护交集见本报告，不能以已有40项PASS宣称完整保护成立 |

另有 ddc904b24 仅退役新增UAT编号，e204b7b71/435438250/38cf87426 等为缺陷/发布记录，不是额外产品修复版本。

### 新发现问题与版本的因果边界

- `git log -S` 与 blame 确认 `reconcileFrozen → ineligible/nonwaivable → processing_failed discard` 核心分支来自 **eae6bb3da（2026-09-12）**；不是3.1.0或ee0c新加。
- `isIdleAfterUserAbandon` 可追溯 **e4d601cd9（2026-08-29）**，后续接包可见性另有调整；不能归咎于hostfix4新增。
- **843bdff25（10-21）** 新增用户取消完成后的Subject收尾，但没扩到系统终局；**63ad3baa2** 去掉同条件再入抑制。历史终局遗留、后续新尝试与当前材料归属因此须分开核账。它们可能共同使残留更显著，但尚未证明198条的增长因果或唯一引入版本。
- **ee0c4786b** 同时包含原7条问题所需的部分修复与额外Reset扩展；必须逐工作项验收，不能把这一提交整体标为“7条问题已解决”。
- 原主线不变：5部剧集重试验收、高达两条独立收藏、凡人歌一条Season且正常替换poster、三段重试UI；性能本轮不修。198项是新增生命周期诊断，不自动替代主线或授权清场。

## 生产独立复核与下一步计划（2026-10-23 02:18–02:25，Asia/Shanghai）

本次实际连接NAS；通过项目`nas-ssh-config.js`读取连接配置，Docker inspect只输出镜像/commit/运行/挂载白名单；容器内SQLite使用`readonly:true`及`query_only=ON`，查询通过stdin执行。只读取4个现场NFO的root/season/episode结构，没有导出完整生产库或Secret。一个逐材料查询耗时过长，已终止本任务独有诊断进程（不是服务），改为一次读取必要列后在内存聚合，约2秒完成；后续查询加25秒强制时限。未执行扫描、重试、Reset、部署或任何生产数据/媒体写入。

### 运行事实及原问题范围

- 镜像`markmahoro/shelfdeck:3.1.0-hostfix4`；revision `b70a9f6f6dde90654fbdef70e226b11f25f709f5`；image ID `sha256:d94bcda0875bc51059dfa601f5fec3b0f220d9b0925029fadd75886c649a886e`；启动时间2026-10-22 21:36:23，restartCount=0。health HTTP200、status=ok、normalSupplyAllowed=true。ee0c未上线。
- Projection：attention_required14、in_progress213、completed676。197个active且无current Run/token的Subject，另2个abandoned投影；实际active Run14、token14。上述为有限时点快照，不能当成未来操作清单。
- 11个共享剧根Work失败影响12条attention（风骚律师有两条Subject）：Handle错误7根——开端、权力的游戏、空战群英、风骚律师、匹兹堡医护前线、越狱、枪口彼端；NFO_SCOPE错误4根——西北岁月、风声、隐秘的角落、武林外传。当前失败Event均为`arca.series_presentation.source.observe@1`。现场4份tvshow.nfo根均为tvshow且season/episode均为-1，与ee0c修复条件一致；不能把“同一错误码”单独当作全部修复成功。
- 高达、凡人歌仍为`arca.inventory.product.stage@1 / CLEAN_ARCA_STAGE_TARGET_OCCUPIED`，custody active、On-deck blocked。高达旧包发布于10-22 09:01，源文件名带1080p FLAC；凡人歌旧包发布于10-21 22:57，包有37个Primary。两者均早于10-22的edition/Season related source修复。已有青瞳收藏的On-deck committed事实存在。未重新枚举全部媒体文件/计算大文件Hash，旧现场细节仍按原Evidence处理，实际新包目标和替换集合必须在副本/正式新链验收。

### 对“198孤儿”的更正

实时active残留Subject为197（single175、season22），latest Run actor：system175、admin16、缺Decision6。它们是Subject残留，不是197个仍执行的孤儿Run。

从这些Subject的current绑定取Primary/structural_dependency，按materialKey去重为937个：

| 当前Control | 去重材料数 | 含此类材料的旧Subject数 |
| --- | ---: | ---: |
| Procurement / material_field | 380 | 152 |
| released / 无主 | 435 | 40 |
| Libra / **其他Subject** | 41 | 4 |
| Arca / on_deck_custody | 81 | 1 |

旧Subject绑定重复，不能把绑定行数当成独立物理材料数。41个Libra材料归属两个其他Subject（一个40集Series与一个JAV），81个已到Arca On-deck；**未发现Control仍属于这些对应旧Subject**。因此本轮现场证据不支持“5个旧Subject的202个材料release不完整”。不据此证明每个历史事务均正确，但不能执行旧绑定集合的强制释放。

按每个去重材料关联的最早旧Run terminal时间，与该材料最新Procurement Selection比较：660个有后续Selection，其中264个candidate_delivery、280个transferred/handoff_accepted、62个released/triage_failed、54个released/handoff_rejected；277个未见晚于该比较点的Selection。这个口径证明有后续流程，**不代表660个现在都正常推进，也不代表277个全部故障**，更不证明每次最新失败之后都已重采。下一步只对未闭合/失败分支按新Owner和真实资格原因核账。Field表也有后续Observation，不能再说系统完全没有重采触发/TTL。

6条缺Decision的latest discarded Run同时没有Discard Receipt或Outcome：有话好好说、网络谜踪、怦然心动、2001太空漫游、银翼杀手：2022黑暗浩劫、猎头游戏。暂列审计完整性待查，未认定损坏原因或补造记录。

系统终局后single Subject保持active的隔离复现仍成立，UI按“等待重新入库”文案推断用户放弃仍不正确；上述更正不取消这两个产品缺陷。Run ended历史已有展示入口，不应夸大为完全不可见。

### 建议交付及验收

1. **原问题优先交付。** 继续ee0c真实Handle/NFO修复、三段动作；当前12条共享资料attention走原条目重试上架，不先Reset。验收11个剧根的正式资料、关联Season Commit、健康与无重复收藏；共享资料由Arca负责，与Libra残留Subject专项分开。
2. **Reset先补保护，再只准备两项。** 解决selected active Subject包含ended Run时的删除/保留合同交集；在生产副本验证历史、其他Subject新Control、共享资料引用及收藏保护。精确选择高达/凡人歌，检查accepted custody/target与已有物理effects闭包；原文件和已Commit收藏保留。经具体生产授权后采用新镜像工具，必要顺序为构建/校验新镜像→标准停机/完整备份→新镜像scoped Reset keep-stopped→部署/启动→普通新Observation/新包；禁止旧镜像Reset。高达验收两条独立收藏，凡人歌一条Season并正常替换poster。部署重启仍可能中断在途转码，但Reset范围不得包含其他active Run。
3. **生命周期独立收口。** 明确何种原因可系统自动终局，不能把“不能带缺陷上架”直接当成“永久不可继续”；技术故障在所属Owner预算内重试或attention。single/Series终局、其他Episode/Run保留、精确Control revision、token、审计、Projection与重放统一验证。保持A模型，不借此引入Subject-scoped Control或逆向Handoff。完整UI状态不能依赖中文文案或伪造用户取消。
4. **旧197项最后决定。** 先完成新任务不会复现的验收，再核对缺审计6项和真实无进展材料；按闭包准备历史处置方案。当前不推荐统一Reset197/198/225，更不释放已转到新流程的Control。迭代期不为旧在途增加兼容恢复层；若最终选择行政退役，也必须满足历史保留及新Owner保护约束。

本轮只更新唯一CURRENT_PLAN/CURRENT_PHASE及CURRENT_STATUS事实。产品未改、未提交，既有全量/平台/浏览器证据不继承为新候选PASS；本次新增验证为前述73项、真实Handle/NFO20项和两个隔离复现。性能P1–P4与旧剧根统一离线补文件继续不纳入。

## 实施开始与生产停机冻结（2026-10-23 02:36–02:43）

用户随后确认七项实施范围：剧集修复、三段重试、整体Reset重做、生命周期根因、高达/凡人歌隔离验证、独立性能诊断迭代、发布验收。性能不沿用前序agent的分项/根因；两部真实入藏等待正常采购，不阻塞本轮开发交付。上节“只记录/性能不纳入”和精确两项运维Reset推荐已被此决定替代；用户界面整体Reset没有单片选择能力。生产Reset仍未执行。

用户明确要求先安全停机。02:36:28 POST Runtime stop（idempotency key `incident-freeze-20261023-main`），持久intent revision23/desiredMode stopped，normalSupplyAllowed=false。Runtime有1个inFlightRecovery未排空；只读容器采样CPU357.95%、内存2.088GiB，Node累计CPU71.5%、FFmpeg累计261%，FFmpeg已运行04:56:53。这些混合瞬时/累计指标仅是现场采样，不能直接推断所有界面慢都由FFmpeg导致。

随后对精确容器ID `9250d8f8a15267aa1d370ddfd37a618dbf9dfb7677abff831f641b6756c3d9be`执行`docker stop --time 75 shelfdeck`。02:38:23退出，exitCode1、OOMKilled=false、RestartCount0；日志收到SIGTERM后报`P4_SHUTDOWN_CHECKPOINT_TIMEOUT / Operational checkpoint deadline expired`，是既有60秒检查点超时保护退出，不能记作完整优雅排空PASS。其他15容器运行保持。持久intent为stopped/revision23/pendingReset=null；未将执行补写为业务失败，无Reset或源文件改动。

完整data冷备：`/vol1/1000/docker/shelfdeck/backups/incident-freeze-20261023T023823/data`。源及副本196个文件逐文件SHA256清单一致，清单SHA256为`7e115a1b966f5f9c947d455d4aa60a832facd580c02093296026644bf2260d1a`。此备份不包含媒体/整个transcode Workspace，不冒充未来Reset所需完整范围备份。SQLite主文件4,614,598,656 bytes，WAL11,045,752 bytes、SHM32,768 bytes随副本保留。初次25秒只读quick_check/FK组合未返回、被诊断时限结束，不能记SQLite完整性PASS；有限聚合查询正常读取。

冻结后Projection仍14 attention/213 in_progress/676 completed，Libra14 active/690 completed/199 discarded/38 superseded。Foundation保留1 executing Event，20 destructive_commit/reconcile_required Effect和1 workspace_write/intended Effect，未抹掉未决证据；后续Reset必须处理这类阻挡，不能绕过。

进一步读取6个缺审计Run：current state_revision均4/discarded，terminal_at_ms一致为1788097290969（2026-08-30）；修订链仅有1 admitted、2 freshness_confirmed、3 completed，缺4号revision。与当前自动discard链不同，证明其不是10月新建终局；历史PROD-031/032记录了同期仅改Run/Work的早期full reset，但尚未取得本6条精确命令receipt，不能把因果推断写成已证实。无补造记录。

产品最小防误删保护已加入`user-formation-reset.js`：检查实际删除闭包是否包含discarded/superseded Run，有则RESET_ENDED_HISTORY_OVERLAP阻止apply，不能仅按Subject的当前tab判历史保护。新增4种classification/state组合回归验证保留Run且不进入备份/授权apply；Reset41 PASS。此保护不是整体Reset重做完成，保留历史与物理清除交集的对象生命周期方案已向用户请求确认，依赖部分待答复，独立项继续。

本轮重新执行真实Handle/NFO20 PASS；Web五文件31 PASS（series retry、collection、runtime controls、Formation tabs/stage conflict）。生产同构性能诊断在独立工作副本与隔离容器进行：当前生产镜像、network none、媒体及transcode只读、生产服务保持停止；使用正式Host入口且不跳过完整性/恢复检查。完整Host测量尚未完成，不宣称性能根因或优化收益。

## 2026-10-23 03:06 隔离性能测量与实施检查点

上节Host测量已完成。生产保持同一容器exited/restartCount0；本任务诊断容器已退出并自动移除，15个其他容器保持运行。无生产Reset、部署或正式媒体改动。完整七项迭代尚未完成，不以本节局部修复替代发布资格。

### 测量环境与边界

从已校验冷备复制出独立可写目录`diagnostics/incident-20261023/data`；使用生产镜像的正式`createCleanServiceHost`入口，网络禁用、3 GiB内存上限、容器根只读、媒体/transcode/生产data均只读。Host的dataDir明确指向`/rehearsal/data`独立副本，生产data只在原`/app/data`位置作为物理Workspace身份来源。前两次隔离挂载因Aftercare mount scope不一致而拒绝启动；改正挂载后通过原守卫，没有改写持久root或跳过检查。完整性/外键检查、启动恢复和正式HTTP路由均实际执行，Runtime一直为stopped，没有运行FFmpeg或恢复普通业务供给。Host完整性检查通过不等于未决Effect已完成。

基线Host启动约162.6秒，其中FK检查4.0秒、integrity_check29.7秒；诊断候选启动约169.5秒，FK6.7秒、integrity35.3秒。CPU profile含启动期，最大事件循环延迟约110秒主要发生在启动核验，不能把它当成稳态页面延迟。未取消完整性/历史证据核验来缩短启动。

基线是生产image ID；诊断候选在同一镜像中只读挂载本轮两个修改文件`formation-query.js`、`progress-projection-reader.js`。两次顺序使用同一工作副本，Host会更新该副本的技术状态；不是随机交叉实验，也不是正式候选整包资格。每条HTTP路径测3次，带SQL计时和CPU采样；结果如下（毫秒，范围/中位数）：

| 路径 | 基线范围 / 中位 | 修改后范围 / 中位 | 判断 |
| --- | --- | --- | --- |
| Runtime | 4.6–29.4 / 9.1 | 3.8–25.8 / 8.1 | 停供给状态读取正常 |
| overview已有快照 | 4.4–4.9 / 4.9 | 5.1–5.2 / 5.2 | 请求不重建快照；不能代表后台构建成本 |
| Formation active limit25 | 982.1–1128.6 / 1063.9 | 813.4–861.2 / 830.7 | 中位约下降21.9%，仍有约0.8秒同步工作 |
| collection limit24（未指定sort） | 422.3–491.7 / 482.4 | 432.6–775.8 / 523.1 | 未改此链，未证明改善；此请求默认标题排序，不能冒充所有UI筛选/排序 |

Formation三次共2208条SQL，改前后相同；collection三次987条SQL，同样相同。没有通过少读证据或放松完整性换速度。Formation/collection响应bytes分别108297/155176保持相同，仅byte数量相同不作为语义等价证明。当前测量没有并发4K、真实浏览器海报请求或网络Provider，不能宣称线上整体卡顿已解决。

### 已实现的两项局部性能修正

1. overview内部四次Formation切片复用同次读取的summary/count/history和active Owner事实。复现原groupedCounts/history各4次、active Owner读取重复；修后每个overview读取一次，下一次请求仍重读最新Owner。只在一次同步调用中共享，没有全局业务缓存。
2. CPU profile定位`progress-projection-reader`在每个Work上全量filter Plan/Event、每个Plan全量filter Edge。改为按Work/Plan一次建索引，保留Plan排序、Event顺序、Result摘要验证和缺Plan拒绝。新增128 Work/256 Event用例验证归属、共用node名称隔离、线性membership读取上界及缺node失败，防止退回平方遍历。

最终三文件回归`formation-process-projection`、`helix-formation-projection`、`clean-arca-inventory-port`共145 PASS。另已执行相关Candidate/Series layout/disposition等组合99 PASS；不能简单相加成无重复总数。Reset保护41 PASS、Handle/NFO20 PASS、Web31 PASS为本轮前述独立证据；尚无完整新候选Gate、Windows发行包、正式Linux镜像及具体版本UI验收。

### 两片现场与4K继续项

Season poster新隔离用例把真实Inventory port的prepare→stage（注入一次中断）→verify→switch→settle串起，确认`Season 01/poster.jpg`被新受管字节替换且settle不会删掉最终poster；Movie变体同时通过。此前完整Episode Claim fixture不足的首轮失败已补为精确claim digest/集合后通过，未放松产品验证。此用例与Candidate Season关联测试仍是分层证据，尚不是凡人歌37集完整新包旅程，也没有为高达创建真实双Entry；生产两项保持开放。

冻结库唯一executing Event为`libra.media.transcode@1`，immutable encodeIntent和device snapshot均为`intel_qsv`；video为`hevc`、`tone_map_to_sdr_bt709`、`pq_bt2020_base_to_sdr_bt709_hevc@1`、target_size/25,700,738 bps。最新进度50.6%，rate0.244、eta17,426,397ms（按记录原单位，不将rate擅自解释为fps）。代码`compileFfmpegPipeline`对该组合显式采用`cpu_decode_cpu_filter_gpu_encode`，HDR→SDR使用zscale/浮点格式/hable后QSV编码。高CPU与此混合路径一致，不证明硬件选择失效，也不能证明它单独导致页面延迟。后续需用有界真实媒体样本验证吞吐、色彩/播放正确性和交互竞争；本轮没有临时替换色彩管线、降清晰度或修改生产转码参数。

### Reset合同决定（03:06提出，随后用户已同意）

已提出的具体方案：整体Reset冻结选择集合，保留completed/ended历史及其外键闭包；对包含历史的当前Subject另持久化管理性退役记录，使它失去调度资格并退出工作台，来源资格交回正常Procurement链。记录明确区分系统管理退役与用户取消，不补造历史Run Outcome；旧/新Owner的Control按精确revision核对，未决物理Effect拒绝清除，不能把新Subject占用从旧绑定中释放。没有新单片UI。

当时 SSOT 的历史保留与 Playbook§3.4 的整过程物理删除存在交集冲突，因此提出了具体退役方案。用户随后回复“同意”，已据此更新 SSOT 和 Playbook 并进入实现，不再等待这项设计确认。该决定不等于生产 Reset 执行授权。

### 03:57 退役与系统终局实现检查点（未部署）

- Libra/Arca 各自以 Owner UOW + immutable Command Receipt 收口；MCA 精确 current scope/CAS 释放，追加 Control revision，不截断历史。Arca 保留 Accepted Decision、拒绝已 Commit，关闭未 Commit custody/target；Libra 保留旧 terminal Run，对未完成 Run 追加行政退役 revision，Subject 进入 administratively_retired。已收藏 Season 与未完成 Run 共存的隔离用例通过。
- Arca 迟到 Offer、后台恢复、人工重试读取退役 Receipt，不重新准入；Libra terminal Subject 不能重取 pipeline token。管理退役历史与取消/系统失败区分，缺少 marker 拒绝伪造历史。
- Operator journal 先冻结 manifest/request，再逐 Owner 执行；真实数据库在 commit 成功但 journal 尚未确认时注入中断，重建 journal 后重放精确命令只产生一份 Run revision/Command Receipt。仍需接入完整用户 Reset 和 Runtime pendingReset 恢复，不能把此核心测试冒充端到端完成。
- 最新退役/席位两文件16 PASS；首次 journal 测试发现 CommandCoordinator 返回含 undefined 的非持久成员，改为明确只记录 replayed + durable Receipt 后通过，未弱化 canonical JSON 校验。
- 系统 frozen 不能接纳瑕疵时，只有现有有限 Freshness Assessment 或精确 Product Media Verification 业务终局可自动 discard；Provider不可用耗尽保持 frozen/attention，不释放责任。single 的系统 discard 同事务结束 Subject 为 ended、核验无其他 Control/active Run并释放 token/workshop；Season 保留，由剩余责任决定席位。列表依据明确 Owner 终态隐藏，active Subject 缺 Run/token 仍显示。相关63 PASS，额外 Control/Series/恢复矩阵继续验证。
- 未完成：pending intake 的跨 Owner 收尾、共享 builder、Workspace 正式回收、用户 Reset wiring、旧231库升级及完整 Host/Catalog资格。原用户 Reset 删除实现仅加保护，不能发布使用。未执行生产 Reset、部署或源媒体改动；最近03:30核验生产停止状态不变。


## 2026-10-23 04:29 开发验证追加

2026-10-23 04:29 开发检查点：新版历史保留 Reset 已接入用户入口与 worker；pending intake 分别经 Libra/Procurement Owner 命令终结，不伪造 Handoff；持久日志支持 commit 后中断重放，恢复保持停止。退役 intake 的低层席位准入也有同事务门禁。未被 Arca 观察的已发布 Offer 已接入真实 ProductDeliveryReader 验证，保留旧 Package。Reset/Runtime/intake 70项、真实 Promotion/退役29项、Web262项和Web build通过；完整Service首跑689项中657通过/29skip/3失败，发现并修复终态短路跳过拒绝席位释放，另一失败为旧隐藏规则断言；三个失败文件重跑6项通过，完整Service尚待重跑，不能记全绿。新增精确231→231结构副本仅扩展11处状态CHECK，230个事实/执行表逐行保留，副本/回退保护2项通过，尚未做生产副本Host资格。共享builder和Workspace物理回收仍未完成；当前回执明确保留Workspace字节。04:29只读复核生产仍为hostfix4 exited、RestartCount0，无Reset/部署。性能后续诊断、两片新包旅程、完整Gate和同版UI资格仍开放。

所有测试均为隔离数据。结构复制工具尚未接入生产发布；它不修改旧事实、不解决未决 Effect、不赋予旧在途继续运行资格。完整Service暴露的新拒绝席位回归已以原真实Host测试修复，未通过调大超时或放宽断言处理；可见性断言则明确更新为 active Subject 无 token 仍可见。


## 2026-10-23 05:03 资格推进检查点（未发布）

2026-10-23 05:03 开发检查点（未部署、生产仍停机）：共享 Series 预约退出已复用 Arca retained-root retirement，保留其他 Season 的 builder 与正式文件；Owner Receipt 缺失/篡改、commit 后中断、worker pending Intake、备份改动拒绝恢复已补回归。登记过材料的管理退役 Workspace 接入原有两次 Reference/Control 观察和 Cleanup Scope；未登记字节仍保留并由回执报告，不宣称物理全清空。Service 最近一轮690/661 PASS/29 skip/0fail，但其后又改了停机顺序和依赖分层，不能作为最终固定版本全绿。静态包边界/语义/Manifest/合同四项通过，完整架构测试进行中；首轮两项旧 public exports/历史查询 fixture 已定向修正，完整Gate仍未PASS。首轮NAS结构副本230表逐行摘要一致（17.2分钟），只读Reset范围225 Subject/14 Run/11 shared scope，21未决Effect及1executing Event继续阻挡；该轮目标是11处CHECK扩展版本，新增Workspace trigger后的12处最终结构仍待重验。NAS收藏页性能复测进行中。真实转码停机已能在10秒预算内排空子进程并保留执行记录，重启首跑因测试Provider未重建而失败，修复测试依赖后重跑中。高达/凡人歌完整新包、最终副本Host/平台/UI/发布资格仍开放；没有生产Reset授权。

新增证据与限制：

- 共享 builder：两季预约中退出一季保留 builder，退出最后一季进入既有 Arca retained-root retirement；注入 Receipt 写失败全事务回滚，重放只保留一份 Receipt。完成核验改为纯读取。与核心 Reset/分页历史组合29 PASS。
- 整体 Reset：Subject 状态不再足以充当完成证明，复验精确行政命令 Receipt/marker/manifest/backup、Run 终态和 token/workshop。真实 worker 退役 pending Intake 后 Candidate/旧 Outbox/无伪 Handoff 保持，备份 SQLite 被改动后拒绝恢复并保持 stopped。该新增用例1 PASS。
- Workspace：管理退役专用 trigger 验证不可变 Run revision 与管理命令 Receipt；已有 superseded 路径继续共用正式清理权限。两类事务、Execution/Effect 阻挡、同事务注入失败和重建 replay 的组合16 PASS。尚未完成新 trigger 的完整物理删除/崩溃 Host 旅程；没有 Reference 的私有文件未自动删除。
- Schema：NAS独立源快照 `4549671e…` → `f9cf2100…` 首轮复制耗时1,032,181ms，231表中230个事实/执行表逐行值及类型摘要相同；只改11处枚举CHECK，未执行Reset。新增 Workspace trigger 后当前目标是 `40dfcbb6a6a64294098c72093ba03ce61e6696c5fb8d162b76a3272af73f409c`（12处CHECK），不能将首轮PASS冒充新目标资格。演练目录 `diagnostics/retirement-copy-20261023` 只写隔离副本。
- 未决Effect进一步分组：20条是 Arca `arca.ondeck.input_settlement.delete@1`，Event/Work均failed、Effect仍reconcile_required；1条是正在执行的Libra转码。20条的历史Owner完成证明尚须精确核查，不能仅按状态数认定仍在删文件或直接补写终态。
- 收藏查询：标题/年份/搜索先按身份与metadata选页，再只读取当前页的people/material/详细facts。真实SQLite八项回归PASS；NAS同库性能复测未返回，暂不报收益。
- 停机：`clean-service-host.stop`原来先等待Execution停止，再在finally关闭FFmpeg，长转码会一直占住排空窗口。改为停止派发后并行关闭本服务进程，再等待Execution。真实测试确认停机完成、无业务失败Outcome；首轮重启最终未入藏，诊断为测试重启缺少原先共享资料Provider（ARCA_SERIES_SOURCE_STALE），修复测试依赖继续复验。保留首轮失败证据，不放宽产品来源版本校验。
- 690项Service结果发生在停机与依赖分层最终修正之前；完整架构测试尚在运行，已出现两项fixture遗漏并定向修正。静态检查发现的新增Persistence→Execution/Capability非法依赖已通过抽出Foundation持久化读participant、由组合根注入validator解决，没有扩大包边界豁免；另修已有注释触发的membership语义扫描。四项静态检查重新通过。

## 2026-10-23 05:35 资格与性能追加（未发布）

- **20条历史Effect的性质纠正**：对冻结源库调用实际 Arca TerminalEffectHistoryObserver，4个原Plan分别5/7/3/5条均为 `fulfilled_by_successor`。Reset只读适配器使用同一read transaction，Foundation独立验证原Intent/Attempt和严格后继Work/Event/Result/committed Effect；篡改拒绝用例通过。它不改写旧Effect状态。最终preview仍有225 Subject、14 active Run、11共享scope；真正阻挡只剩1条 `libra.media.transcode@1` 的intended Effect及executing Event。没有执行恢复、Reset或终态补写。
- **最终结构复制**：`4549671e…` → `40dfcbb6…`，新增状态/trigger共12处CHECK，231表/115index/23partialUnique保持。NAS `diagnostics/retirement-copy-final-20261023` 中源只读，复制1,129,241ms；230张事实及执行表逐行值与类型摘要相同，FK/integrity通过。目标catalog `8d37d7c2471e6b95810efe2ee83e06bee35cfddfcc4294563502aa37eca32da5`。新增标准结构副本入口 `helix-formation-retirement-schema-copy.js`，仅准备新文件，不能自行切生产库或处理未决执行。候选Host使用另一个诊断副本和只读原媒体挂载，验证尚在进行。
- **Reset独立完成核验**：Libra/Procurement/Arca均要求本次resetId、manifestDigest、backupDigest对应的不可变Receipt/marker；Procurement当前afterDigest必须匹配，不能仅看delivery状态。直接按冻结Owner/process scopes复核无current Control/Work，原Control有精确下一revision release，原terminal Run、已Commit Package/Receipt逐行保持。注入历史行变化或Receipt/marker缺失拒绝恢复。61项Reset组合PASS。
- **真实用户入口旅程**：配置正式Workspace Root后，正常Intake接纳Subject，正式HTTP stop→preview→Reset成功；历史Candidate/Accepted/Receipt保留，Subject行政退役、token归还、历史可见且active列表退出；重启保持stopped且没有新采购，随后显式正常观察创建第二个Subject，原Subject仍退役，源文件inode/mtime/bytes不变。1 PASS。首轮fixture只有bootstrap逻辑Workspace而没有正式Mount Scope，安全检查拒绝；改为正式settings配置后重启，无产品校验降级。
- **正常停机根因回归**：停止派发后并行停止FFmpeg子进程，再等待Execution排空。真实Series转码停机小于10秒，无子进程、无伪业务失败，保留执行Effect；正式重启完成一次Arca Commit，二次重启不重复产物或Commit（1 PASS/57.6秒）。首轮restart fixture共享Provider未重建失败记录保留，已修测试依赖。
- **性能对照**：NAS同数据、同镜像运行时、Formation/progress代码相同，仅切换collection-query，标题页三次中位451.170→212.607ms（约52.9%），返回155176 bytes相同。顺序样本，没有4K并发，不能外推全站。早期Formation1063.9→830.7ms属于另一个明确的2文件对照，不与后续不同响应版本混用。overview已有缓存HTTP约5ms不代表后台聚合构建成本。
- **海报**：原每次请求读图并重新resize/WebP；保留所有Owner/路径/物理稳定读取检查，仅用内容SHA256+尺寸复用派生字节，32MiB/128项LRU、同图并发合并、失败不缓存。实际sharp测试3 PASS。Windows合成1600×2400 JPEG约2.78MB，wall派生重复渲染约32–36ms，命中约1.05–1.09ms，输出9162 bytes一致；这不是NAS真实海报端到端延迟测量。
- **4K限制**：冻结intent为intel_qsv/25.7Mbps/PQ-BT2020→SDR，当前合法路径是CPU decode+float zscale/hable filter+GPU encode。进度最后约50.6%、speed0.244x，只是冻结采样；不能据此断言GPU没有使用。未修改质量/色彩合同、未做忙载对照，不报4K加速收益。
- **平台/完整Gate**：Service最新694total/665PASS/29skip/0fail。Windows首个包build成功但独立启动失败，发现新poster模块和Reset脚本未进显式文件清单，修正Dockerfile/package-win，第二个独立包自带node/native依赖启动health200、空Reset预检成功。完整架构仍运行；最早public exports、retired历史query fixture及JAV不兼容分段旧自动终局预期三个失败均已定向修正（5/3/1 PASS），首轮FAIL保留。JAV真实Plan拒绝现在进入attention并保留两源Control/token、无虚构Outcome；符合本轮终局规则。静态包边界/语义/Manifest/P2合同检查通过。没有宣称最终固定候选全Gate、NAS真实UI或完整生产验收通过。


## 2026-10-23 06:08 最终实现回归与未关闭边界

- **Handoff A 收尾**：停机可留下 Libra Accepted 已提交、Procurement 原消息尚未消费的正常窗口。Reset planner 只接受原 Libra Outbox 的确定性 message ID、dedup key、schema、payload digest 及完整原 Receipt 对应；缺少证明拒绝。operator 先调用现有 Procurement CandidateAcceptanceConsumer，使用原 Inbox 幂等键，再退役 Subject。未创建新 Handoff、未撤回 Accepted、未由管理工具直接写 Procurement 业务表。postcondition核对原 Receipt 不变、accepted delivery、所有 transferred/handoff_accepted成员和精确 Inbox closure。commit后日志未落盘重放、篡改原消息或成员的负例通过。原 Outbox 传输确认由恢复后的普通 dispatcher 幂等收口。
- **界面与计数**：Reset完成后一次性失效overview查询；Procurement waiting统计排除administratively_retired候选，latest stage有独立退役状态。真实浏览器原先复现完成后仍显示旧待办；修复后旧Subject退出active，等待接收/待办清零，历史和源inode/mtime/bytes保持。检查980px/1920px确认框、错误确认词禁用、Enter提交、完成仍停机、空工作台不可重复Reset和Escape关闭。截图位于忽略目录reset-browser-v3，已目视核查。
- **平台与回归**：最新产品源Service695 total/666 PASS/29 skip/0fail（135.0秒）；Web262/262；构建通过。NAS只读源覆盖运行最新Reset+真实Host取消/重采53/53（111.4秒）；Windows候选v3使用包内node/native依赖启动health200并通过空preview（empty=true、ready=false、blockers=[]）。包装smoke前两次错误断言把空preview当ready=true，保留FAIL日志并按接口语义修正；未改产品允许空Reset。另一次smoke测试secret字符串不足最小长度在初始化前拒绝，改隔离测试输入。
- **NAS候选Host**：最终结构副本上独立Host完成启动和正常关闭，保持stopped；health200/20ms、runtime200/4.64ms、Formation200/1407.49ms、collection200/252.11ms，总440651ms。该Host快照早于最后的配置Workspace Root与接纳回执收尾；后两者由最新Linux53项覆盖。不得将此记为最终Docker精确版本或生产验收。
- **两片对应新包路径**：同片1080p AAC/FLAC使用真实FFmpeg和实际Provider Handle完整旅程，形成两条Entry/不同目录，首条Receipt与文件不变（1 PASS/78秒）。测试最终使用带年份括号的识别文件名与匹配NFO；不声称任意文件名均识别成功。Series新包两集、已有Season 01/poster.jpg被纳入相关来源并正常Commit，只形成一个Season（1 PASS/35.8秒）；该fixture使用既有媒体适配替身和真实文件，先前真实poster port替换/重试证据继续有效。没有将这些隔离旅程当成高达/凡人歌生产已验收。
- **完整架构原始结果**：3278 total/3224 PASS/28 FAIL/26 skip，58.1分钟，执行期间发生后续修正，不是固定最终快照。未修改原FAIL日志。基线ee0c独立archive的18文件329 total/310PASS/19FAIL证明19项原已失败；另单独Series迁移在基线也FAIL（156.9秒），共20项既有失败。基线archive仅一个无关Windows非法文件名未提取，相关service/test/docs完整；不宣称完整分发基线。
- **失败修正范围**：19项既有清单/fixture按当前真实136/115/231/61合同、149 inputs、Schema依赖及实际Season scope更新；保留严格digest、精确集合与拒绝测试。本轮public exports、retired分页fixture、JAV技术失败应attention保留Control、P3新纯Persistence模块清单、Workspace新trigger、重启Provider测试依赖分别补齐。最终17文件129/129（7.6秒）、canonical inventory定向1 PASS；JAV/停机实际重启各1 PASS及其日志另存。尚未重新完成一次固定快照全量架构，因此只报告定向通过。
- **保留失败：Series既有根目录迁移**。测试修改folderTemplate期望完整迁移，但已有Series root binding固定root_location，resolveTargetLocation继续采用该根，Aftercare评估healthy，不创建迁移Case。原基线与当前相同。共享根是跨季Owner正式绑定，不能为通过单季测试绕过它或单独移动一季。该路径需按已有共享根迁移合同进一步设计/确认，本轮未擅自扩大实现、未删除或skip测试、未声称发布资格通过。
- **仍开放**：管理退役Workspace新trigger已有两次Reference/Control检查、事务/重放用例，尚无新trigger完整物理回收崩溃Host旅程；未登记字节保留。4K未做质量/色彩策略变更或忙载性能收益验证；启动仍需分钟级。生产中断转码1 intended Effect/1executing Event必须通过正式恢复/核验处理后才可Reset，不补写终态。精确Docker候选/UI负责人验收及生产Reset、部署、自然重采验收均未完成。

06:07只读复核：生产仍hostfix4，exited1、RestartCount0，FinishedAt=2026-10-22T18:38:23.87218858Z；其余15容器运行，诊断容器已退出。所有诊断写入均位于隔离副本/临时工作区，没有生产Reset、结构安装或源媒体修改。


## 2026-10-23 06:11 固定提交与构建环境阻塞

产品候选提交为 `44b725e6a`（126文件，包含合同/实现/回归/Evidence）。提交后工作树干净。标准入口 `node scripts/build-image.js 44b725e6a` 在desktop-linux context启动构建前失败：本机Docker Desktop Linux Engine pipe不存在。启动本机Docker Desktop后，backend在Inference manager初始化时因dockerInference监听文件无法访问而崩溃；未进入镜像build、未产生image/tar/SHA256，未上传NAS。没有执行Docker恢复出厂、清理镜像/volume或修改系统设置。Windows v3独立包与最新Linux53项源码回归不能替代最终Docker镜像资格。

当前不能申请生产Reset/发布：除镜像阻塞外，完整固定架构Gate仍未通过（既有Series根目录迁移FAIL保留），跨层UI尚无本候选负责人结论，生产1条中断转码Effect/1executing Event尚需正式恢复/核验。高达/凡人歌生产自然重采可按本轮约定后验，不将其提前宣布通过。生产保持02:38的停止状态；没有本轮数据Reset或部署授权。


## 2026-10-23 09:11 Docker候选与精确版本UI收口（未发布）

用户恢复本机Docker并授权继续，另明确授权将候选发送给既有UI负责人。生产授权范围未扩大。

- 标准构建入口先完成694d3b429，再按UI修正完成b9c033573及最终d4b5c00b8。最终镜像`markmahoro/shelfdeck:d4b5c00b8`绑定完整提交`d4b5c00b8509cc8b6e49ae09c2e873729e3d601e`，本机image ID `sha256:451738b8254f9804aa03fb4601b0241c669f5404733b2a6d676bf4c94405aa7d`。导出`dist-image/shelfdeck-d4b5c00b8.tar`约771.8MiB，SHA256 `3a2c2434dfecfdb0a0d27491eda3820c70a0e2156a343c26221e19bb08a925b1`，独立Get-FileHash一致。未上传、未部署，无Git release tag。
- 镜像内资格不覆盖src/scripts，仅挂载测试：694d镜像Reset/取消/重采53/53 PASS（84.9秒）；真实Host使用镜像自带dist完成配置Workspace Root、启动health、正式停机、空Reset preview，694d及b9均PASS。两片对应新包旅程在694d镜像2 PASS；真实转码停机→原Effect保留→重启一次Commit→二次重启不重复，在b9镜像1 PASS（49.6秒）。b9相对694d只改前后端提示，d4相对b9只改侧栏一个字符串；不把这些继承证据标成最终镜像所有测试重跑。
- 首轮媒体FAIL保留：测试tmpfs `/transcode`仅512MiB、`/tmp`1GiB，不满足现有`1.2×输入+5GiB`空间准入。仅扩大隔离挂载为8GiB后两片旅程通过，未放宽准入或测试超时。停机测试另触发256 PIDs上限：4个并行FFmpeg设备能力探测耗尽253线程/进程，docker exec也被拒；采集docker top/stats后停止该任务容器，改隔离PIDs上限1024后通过。此为测试资源约束下的实证，未修改产品探测并发策略，也不据此宣称生产4K性能已修复。诊断脚本首次缺少预建shutdown根目录的ENOENT单独保留，不与产品失败混淆。
- UI负责人对694d完成真实隔离Host重置闭环、三段重试/历史浏览器核验，要求去除Aftercare/正在Reset内部术语。b9修为收藏维护/正在重置工作台，并同步中断/确认/阻挡错误提示；Runtime9、前端定向6 PASS。b9复验指出App侧栏遗漏同一字符串，d4单行修正后两个视口2/2 PASS、0未决UI问题。精确候选最终结论PASS，其他业务行为证据按验证过的差异继承。
- 负责人任务`01a0912a-0086-74e2-88ab-536c59d3862a`；最终记录本机`E:/my_project/helix-git-consolidation-20261008/formation-ui-review-d4b5c00b8-20261023/owner-review.json`，报告SHA256 `c9848f0c140a03cb70c4eafe795f736ae7453884d46adabf381290da09f9e8a1`。记录绑定171个冻结Web输入，包含构建/截图/原版失败和修正版通过证据。不是整体发布许可。
- 本轮结束时本地任务诊断容器均退出。生产只读检查仍为原hostfix4 stopped/exited1、RestartCount0，其余15容器运行。没有生产Reset、结构切换、源媒体写入或恢复供给。

仍开放：已有Series根目录迁移FAIL（基线与候选均存在，未skip或放宽断言），完整固定架构Gate尚未通过；生产1条中断转码Effect/1executing Event尚需正式恢复核验，Reset继续拒绝。4K忙载吞吐及启动耗时未解决，Workspace管理退役新trigger的完整物理崩溃旅程仍无新增证据。高达/凡人歌真实自然重采验收按约定后验，不将隔离通过等同现场收口。


## 2026-10-23 后续独立合同核查（方案待确认，未改产品）

1. Series迁移不是单纯旧测试断言：SSOT §2.5附近明确Placement revision变化须被识别为Aftercare Placement Conformance Gap；共享Series补充又要求同Shelf/剧身份唯一正式根。当前clean-arca-inventory-port.resolveTargetLocation在计算新folder后直接采用旧rootBinding.rootLocation；Aftercare conformance与placementMatchesInventory共用该解析结果，导致新模板被忽略、健康评估为healthy。Series scope保存placement_revision，但当前解析未比较此值；既有Store只有创建/版本/预约/引用，无整剧根迁移事务。不能通过简单忽略rootBinding让单季迁走，那会使共享文件与其他季分离。
2. 建议补齐的Arca合同：冻结同shared scope全部active Season、当前Inventory/head、共享版本/Control及目标；存在pending Accepted预约、builder、Aftercare/Off-deck/身份纠正竞争时延后，不偷改其冻结目标。共享文件与各季成员按精确集合执行、验证，使用可恢复Effect与持久Receipt推进Arca当前根绑定及各Inventory，旧Commit/Identity/Deck Fact保持。未知目录文件不搬、不删；冲突保持明确待处理。先修当前布局差异被隐藏，再完成共享迁移；不得把auto_repair降为healthy或skip既有测试来取得资格。此跨季合同尚待用户确认，未写入SSOT/实现。
3. 运行恢复核查：clean-service-host在desiredMode=stopped时调用ExecutionHost.start({quiesced:true})，Foundation只分类恢复动作并保持normalSupplyAllowed=false，不执行它们。普通resume/start则会启动fallback reconciler，drainOnce同轮恢复、新Work、新Event及Owner reconcile全部推进，因此普通恢复运行不能作为“只处理既有Effect”的替代。
4. 冷备只读查询再次确认唯一executing项：libra.media.transcode@1，Event libra-transcode-media-event-8aad245ef3023e69b22e557adc4eb9ad1b15d3c6，原Run 8ecba91fddbf9286cbbfac859fa7eff098e06f21f9d3cf6c75563d30907989cc。查询只列白名单字段，未改生产。建议增加显式管理性停止态恢复：冻结精确Event/Attempt/Effect清单，经Foundation原reality分类及replay，保持原身份与供给门禁；只允许既有技术执行和Work结果聚合，不运行新Plan/Owner reconcile/Outbox采购。结束仍stopped，重新分类无未知Effect后才可另行Reset；不能把resume→立即stop的竞争窗口当成隔离保证。
5. clean-workspace-product-port.materializeMedia先清理精确producer partial；缺少已登记/最终产物时按原Intent重新produce，再rename与正式记录。故中断转码可能从头重做，不能声称续接50%编码进度，也不能用临时文件存在证明成功。恢复机制不得重签不同Intent或补写终态规避校验。

已向用户请求确认是否把“整剧共享根迁移”和“停止态仅恢复既有执行”两条合同纳入本轮。该请求不等于生产恢复/Reset/发布授权。在答复前继续保留生产停机，未实现依赖新合同的修改。


## 2026-10-23 转码终止方向澄清

用户指出FFmpeg不提供本项目所需的断点续转，并明确认为Reset无需等待转码完成。撤回上一节把“停止态恢复原执行并完成转码”作为Reset前置的建议；前述范围问题不能再视为当前待批准方案。Reset目标是结束未完成条目，重新完整转码只为取得成功结果没有必要。后续核查应聚焦精确执行终止、Workspace实际写入结果与未决Effect收尾，再由Owner完成行政退役。

当前代码核对：Foundation `work-lifecycle.cancelProcess` 遇到executing Event，会保留该Work为draining；现有用户取消合同亦要求未决Effect安全收尾后才能释放Control。这说明“安全收尾”仍须具备真实依据，但不等于“媒体必须转码成功”。尚未确认停机后精确中止的完整实现，不能直接改终态、虚构Outcome或把残留文件视为已清理。本次仅调整计划/Evidence，未改产品或生产，整剧共享根迁移范围也未获确认。


## 2026-10-23 追加范围确认与停止态终止实现

用户已确认将整剧共享根迁移、停止态既有执行收尾一并纳入本轮。停止态条目按随后澄清：Reset无需等待或重跑转码。SSOT已记录该规则及整剧迁移边界；该确认仍不构成生产Reset、媒体迁移或部署授权。

`STOPPED-EXECUTION-CLOSURE`已接入新Reset的冻结清单、完整备份和durable journal：仅精确选中的未提交Libra转码可终止。验证原Work/Plan/Event/Attempt/Intent、全部literal输入、当前Workspace/root登记、目标及临时文件实际身份；成功Result/Commit Marker、已登记输出、其他能力、范围外或不明责任仍阻断。原Event为cancelled、原Attempt为completed/cancelled、Effect为failed，与含文件现实/清单/备份摘要的管理终止Receipt在Foundation同事务提交；不生成Libra业务失败、不生成新的Attempt、不执行FFmpeg、不删除字节。后续原Owner分别退役。Host前置校验quiesced且没有在途执行/规划/恢复/Owner reconcile及FFmpeg子进程；停止意图与pending Reset身份每次验证。已提交未写journal ack可按同Receipt重放。

验证：Reset相关组合77/77 PASS；新增终止测试4/4（包含运行态拒绝、文件/执行漂移、事务回滚、journal ack前中断重放、硬链接/异域/异能力拒绝）。真实Series Host启动FFmpeg后关闭服务，使用新Reset完整备份/退役，1/1 PASS、11.68秒；子进程归零、原Attempt数量不增加、未产生On-deck Commit、未决Effect归零、FK/integrity通过、停止意图保持。该项是实际终止路径，不是转码完成/续转演练。日志：本地忽略目录`stopped-termination-tests-final.log`、`stopped-transcode-host.log`。增加最后的Receipt闭形/尺寸检查后4/4复验通过。尚未完成新固定候选完整资格、Docker/Windows包、具体版本UI审查或生产操作。

`SERIES-ROOT-PLACEMENT`仍进行中：当前仅新增按现行规则读取期望根的纯查询，正常入库继续服从durable binding；整剧冻结计划及物理移动模块已通过18项相关隔离测试（其中8项为新整剧边界）。两季+三份共享文件同移、物理rename后重入、未知文件/目录、占用目标、文件漂移、漏季/异Provider/其他维护及Accepted reservation拒绝已测。Arca持久占用、真实Work/Effect及全季Inventory/共享版本原子提交尚未接通；这些模块尚不能作为生产迁移工具，原Aftercare假healthy问题仍未完成修复。


## 2026-10-23 整剧迁移运行链检查点（尚未固定候选）

Arca已新增持久`arca_series_root_relocations`，冻结同剧全部当前Season、共享版本、材料物理身份与Control责任；Accepted预约、共享Builder、维护/退出/身份纠正及漏季阻断。活动迁移围栏阻止相关新增入藏、共享重建、Inventory刷新及Shelf变更。专用两阶段Work先核验并移动整根，再验证真实文件及原Effect/前序Result，以一个正式Owner事务推进各季Inventory、共享根与新版本，连同Foundation Result/Commit Marker原子提交。旧Canonical/Deck/入藏Receipt和Control责任保持；未决迁移不自动释放围栏。合同为138 Capability、117 Result family、232表、62事务、150 Domain Inputs，四项静态检查已通过。

精确旧231表到新232表结构复制仅允许既定12处终态CHECK扩展及新增空Arca迁移表/索引；230个原事实表逐行保护，已存在迁移或行政终止事实时拒绝有损回退。旧225→231工具继续使用原冻结目标档案，不改变历史结构路径。

定向验证：Windows计划/物理/双季数据库事务及结构复制15/15，Linux源码挂载隔离容器12/12；不是新镜像构建资格。单季真实Host完整迁移1/1，36.45秒。两季Host首次因前置检查不继续而超时；保留隔离数据库后证明手动检查更新人物关联并提前返回，没有启动健康检查。已修为同请求重新读取新Inventory后继续；Owner状态机与旧结构副本组合19/19，新增测试确认只点一次且新Assessment使用更新后的basis。再次两季Host迁移/全部文件与旧事实保护断言通过，末尾原共享版本计数仍预期1而实际为2，整体该次仍记FAIL（97.85秒）；已将断言按迁移新增版本修正，待重跑。

真实进程退出回归覆盖rename之后、Inventory+Result原子提交之后及二次重启。首轮测试误用外层`node --test`，导致注入79退出码被runner改写为1，未进入恢复；已沿既有进程退出测试方式修正。跨重启须保持同一隔离虚拟时钟，不能把前置维护窗口测试的未来时间换回真实时间。当前仍回归，未记PASS，未新增生产操作或发布资格。


## 2026-10-23 整剧迁移恢复、冲突重试与Projection回归

真实进程退出测试在修正测试启动方式后暴露产品缺陷：StartupRecovery的Work投影不含basis_digest，迁移Observer错误把缺失字段当成输入漂移，导致P4_EVENT_RECOVERY_REALITY_CONFLICT。修复为通过声明的Foundation只读Participant重验持久Work basis、原Event/Attempt/Effect；保留精确Owner和Intent围栏。两处真实进程退出及每处二次重启均通过（rename后112.92秒、Inventory/Result原子提交后105.61秒），原计划/两条入藏Receipt/Control/Identity/Deck保持，共享版本只新增一次。原失败日志保留，不追记PASS。

迁移文件冲突按明确失败结果返回，持久整剧围栏保留。现有“立即检查健康”入口用新幂等键触发重试，原键重放不新增Work；复核所有旧Work已终态、原Attempt已停止、精确输入摘要/Effect intent、完整物理集合及Control后，才提交同一冻结计划的新Work。未知旧Effect不直接改终态或伪造成功，实际文件执行仍重复核验。真实两季Host注入未登记文件→明确失败→原键重放→移除测试文件→新键重试→完整迁移通过（97.57秒）；补验两季收藏列表与详情同源的阻塞状态/真实季数/失败码后再次通过（97.54秒）。两季原有共享版本计数断言同步为迁移新增一版。

当前定向结果：迁移计划/Store/恢复与人工重试围栏24/24；Arca受影响449项中445PASS、4既有skip、0FAIL；Service695项中666PASS、29既有skip、0FAIL（在后续人工重试/UI增量前，最终固定候选仍须复验）。Web新增整剧冲突→同入口重试状态测试，完整263/263和build通过。四项静态检查通过。Linux先前12/12仅为当时源码覆盖，不视为当前新镜像资格。Docker/Windows打包清单已加入新根目录IO模块。

当前合同台账固定为138/117/232/62，150 Domain Inputs、254 referenced types；相应当前基线测试更新精确计数，旧225→231历史结构复制测试保持。完整新固定候选架构门禁、独立分发/镜像、真实UI负责人验收及停止态生产副本核验仍待完成。本轮无新增NAS操作；生产仍应保持停机，未Reset、迁移、升级或恢复供给。


## 2026-10-23 12:47 固定候选资格发现与修正

- 固定 `2c520418669977ac9a2429fc5020b9e47bad1e58`、干净源码完整Architecture实际完成，414文件、3321 total/3290 PASS/5 FAIL/26 skip，3686101ms；四项静态检查PASS。三项FAIL为Root IO白名单、138个Capability及115个输出family的精确断言未同步；另外两个是真实Host普通NFO/NFO+poster修复被新增Series迁移预检挡住。保留原失败，不把此轮算全绿。
- 根因是判断新规则的期望目录时调用了完整Inventory prepare，先对待修复的旧文件做不可变字节验证。已将Arca持有的Placement测算Basis与实际prepare分开；Series预检仅测算目标，迁移及正常修复执行时仍各自完整验证。没有放宽物理身份、漂移或Owner守卫。两个原失败Host用例重新通过（95.43s、124.78s），两季冲突→同Plan显式新Work重试→完整迁移亦PASS（98.84s）。
- 标准2c镜像构建成功，image `sha256:b835d8803a35b554f87c61baf9ee7ad17b0d9f524fcd60e80c2e65a0d664ff1a`，tar独立SHA256 `8f2b1648dd31556e41be6e120e41401f98e168cb2d33860d83ce6da6c6737ed9`。镜像内迁移/真实进程退出恢复26项PASS，但停止态脚本缺失导致1FAIL；此镜像不可发布。已同步Docker/Windows打包清单，补充真实分发包内空工作台Reset预检；新Windows独立启动、原生依赖与Reset预检1PASS。仅补挂该脚本的Linux实际FFmpeg停止→行政终止预演3PASS/3过滤skip，不代替新镜像资格。
- UI负责人2c具体版本审核为10PASS/4FAIL，桌面/窄屏均复现迁移完成后列表不刷新、检查按钮禁用后焦点掉到body。修正为详情状态变化后重读整个当前页，保持不变不重复加载；检查前将焦点移到弹窗健康标题。Web264PASS/build PASS，实施方复用负责人浏览器场景14PASS；最终新提交负责人复验仍待。原负责人报告保留在本机独立review目录，不混同真实Host证据。
- 新232结构在NAS原冻结库副本实际完成，1140939ms；230个原事实/执行表逐行摘要一致、FK/完整性通过，新迁移表为空。原库与Workspace只读。旧21个未决Effect中20个保留后继履行证明，唯一中断转码的14,193,262,592-byte partial具备精确停止态终止证明；带实际Workspace的只读预览blockers为空。
- 完整Reset演练范围225Subject/14Run/14Work/14Workspace/0pendingIntake，保护682收藏记录与927已结束Run。首次完整备份被`RESET_BACKUP_SPACE_INSUFFICIENT`正确拒绝，未进入退役：14个Workspace共88,669,733,359 bytes，数据库4,614,053,888 bytes，数据卷仅余约56GiB；另一卷余约386GiB。先前只看14.2GB中断产物不足以估计整体工作台备份。
- 容量预检原本先完整hash Workspace，导致空间不足也需数分钟。现仅容量统计使用无摘要枚举，正式备份来源前后、副本和恢复时的完整SHA校验不变。新增容量不足时不得读取媒体、不得授权或改变Run回归；Reset47PASS。未降低空间条件、未删除现场或备份。
- 新标准NAS部署增加专用`/vol2/1000/shelfdeck_backups:/app/data/operator-backups`，校验精确父根/路径、拒绝以挂载隐藏非空旧备份目录；部署dry-run合同3PASS。生产目录/Compose未改变。实际演练在独立`/vol2/1000/shelfdeck_diagnostics/formation-reset-232-2c5204186`进行，以单文件精确预检补丁覆盖固定2c脚本；原冻结源码保留。完整备份/Reset和随后停止态Host仍在进行。
- 本轮后续源码：Service696 total/667PASS/29既有skip，Web264PASS，受影响合同/入口/Reset/部署75PASS/2skip，四项静态检查PASS。P2仍138/117/232/62/150，aggregate `07bb897d8657031067ff42e9e693f472762a67970f55637b4d4338e1295ff459`。将冻结新候选重跑完整Gate及镜像/UI；当前不称发布资格完成。

原始日志保留在ignored `formation-diagnosis-20261023`：`gate-2c5204186.json`、`image-2c5204186-relocation.log`、`relocation-ordinary-repair-retest.log`、`qualification-fixes-*`、`schema-232-rehearsal.log`、`reset-232-rehearsal.log`与`reset-232-volume2.log`。所有生产操作仍停留在已授权停机状态。


## 2026-10-23 13:09 已Commit历史证明的真实副本缺陷

26ce2a6b8固定候选具体版本UI负责人PASS，独立浏览器14/14、Web264/264、真实隔离Host迁移1/1，0开放UI问题；记录在`formation-ui-review-26ce2a6b8-20261023/owner-review.json`。标准镜像revision为26ce2a6b8e3b18942437d17e25547128277c7b71，image ID `sha256:9db06db3ec6776c7f37a1587547e1006d02f65f66d30a2d68f4471cd84de0fe9`，tar SHA256 `44ebaaf8e40ec120dba8891953419df1e3c14da923e32ea87e714d4f694ab8ff`。实际镜像的Series迁移/两类真实退出恢复/停止态转码终止32项及新版Reset22项PASS。额外旧Reset测试25项因漏设既有`HELIX_TEST_ISOLATED_TRANSCODE=1`而正确拒绝/tmp路径，保留54PASS/25FAIL原报告；启用已挂载独立/transcode的fixture配置后该文件47/47 PASS，未降低产品挂载守卫。

NAS完整备份约35分钟后，Operator.prepare以`ARCA_RETIREMENT_PROOF_PENDING`拒绝，尚未写journal或调用beforeApply，未提交管理退役。独立核账发现选中14个当前Package之外有6个历史包，全部为Libra discarded、Arca正式Run committed、有Commit Receipt、recovery resolved、Custody仍active。这是既有正式On-deck finalize的实际输出；Reset新证明函数错误假设Custody必须committed，原微型fixture也手写该状态而掩盖缺陷。不能因此扩大Reset范围或把6个收藏退役。

修正保留Arca Owner边界，使用已有`readCommittedByPackage`核对原Completion、Final Decision、Shelf与不可变Inventory/Deck历史；还要求每个Custody都有对应已Commit Run、无active/waiting验收及未关闭recovery。Custody标记不能代替正式提交证据，历史状态/Control不改。NAS6包实际证明全部通过；真实Host入藏后的active Custody正例、破坏Inventory来源的负例及恢复后证明一致通过。Libra混合历史单元测试明确仅测试公开Arca证明消费，新增Arca伪Commit行/无Inventory反例；组合65项PASS。真实Host首次负例误用只读测试连接，记FAIL后修为独立fixture写连接，原运行断言不放宽。

原26ce完整Gate因这一候选被副本缺陷淘汰而停止（不是因耗时停止），STOPPED不计PASS；原414文件完整2c失败报告继续保留。最终新候选将重新固定并完成全量资格。

副本后续沿用已完成的同一完整备份：新旧previewDigest必须完全相等，真实Operator.prepare生成journal，真实userReset.recover重新hash全部备份数据/Workspace后再执行同一Owner退役链。不提供产品“忽略备份/强制继续”入口，也不删除或复写原备份。这是分段隔离演练，不能冒充一次成功的原API调用或Runtime崩溃恢复。实际生产仍须新完整备份与正式用户Reset入口。后续停止态Host测试只在实际退役receipt通过后结束诊断fixture的外层pending标记，生产原Workspace一直只读；该夹具操作不构成生产修复，也不计为完整Host pending-reset恢复证据。Runtime/Owner中断重放另由真实隔离回归覆盖。


## 2026-10-23 13:25 Reset空执行步骤性能修正

013aec7ce标准镜像image ID `sha256:02d8e3267f78094e2e3293a8ce732ea42ad208175dead4cfb8a2905a766e72f2`、tar独立SHA256 `744bcfec417f68523c4e0647d754ed012a1963edbaaedd7936846960a73e7440`；实际镜像Series/真实进程恢复/停止态转码/新旧Reset/Arca退役97/97 PASS、278809ms，真实Host已Commit历史正反例1PASS/29名称过滤skip。后者首轮/tmp只配2GiB，低于既定`1.2×输入+5GiB`准入，未创建Run而等待超时；扩大隔离tmpfs为8GiB后37.2s通过，不降低产品守卫。Service696 total/667PASS/29既有skip；UI负责人核对171前端文件和9资源一致，将26ce证据限定继承至013，未冒充重新跑UI。

NAS在完整备份重验后进入真实Owner退役，原停止转码已新增1个正式终止Receipt。journal共992步（execution_termination1、execution741、arca14、arca_shared11、libra225），其中execution仅14个scope在冻结plan中有open Work。13:19:56至13:20:43只从71步推进到83步；每步重复校验/持久化约30,168,268-byte清单，多数取消没有实际Work，存在可复现的管理Reset性能浪费。

修正仅在journal.prepare时选取冻结plan.works对应的processScopes；仍保留全量manifest.plan.processScopes、各Owner执行状态门禁和完成时逐scope核验。shared Builder仍按Arca既定判断收尾，不重写任何已存在journal或兼容旧运行时。新增回归证明只取消实际open Work，若被省略scope后来出现新Work，正式Owner仍拒绝退役、Subject保持active、日志保持executing；与原Reset/重放/保护组合66/66 PASS。

旧慢速演练容器已明确停止，保留output/data及原992步journal和partial管理终止证据；新`output-fast/data`从原prepared.sqlite与冷备伴随文件重新建立，不删除现场或回改旧journal。重用同一冻结previewDigest的已验证完整备份，真实recover继续全量字节SHA核验。该诊断性能修正使候选变更，013完整架构Gate按STOPPED保留、不计PASS；将对新固定版本重跑。生产shelfdeck始终exited，未Reset、部署或恢复供给。


## 2026-10-23 14:28 固定Gate与生产授权检查点

固定f280e6bd495e8bb75f4185d532adc18e0f1b0071完整Architecture Gate PASS：414文件、fixture exit0，无signal/executionError，dependency/semantic/manifests/contracts四项PASS。Gate成功分支省略stdout，不宣称无法直接核对的逐项总数。期间tracked工作树保持冻结，原STOPPED/FAIL报告保留。Service696 total/667PASS/29skip；实际镜像98/98、272230ms，真实Host已Commit历史正反例1PASS/29名称过滤skip、37204ms。UI负责人对该精确版本按171源码/9资源一致继承浏览器14/Web264，未重复运行。

标准tar SHA256为192445c85c44a26f38cb1490a30f5b7b29a8ab48b8e24732861a017a545c107c。Docker Desktop报告OCI index digest 27027fd11a007f7ba091567260b53205d07d4e38edbe4b0305296f819a64d403；NAS传统image config ID为6f57fec925c007f810ab23af323a75f3dd3499259e6f18b8acbb56186a78e723，两者由同一tar manifest核对，revision一致。首次load后误把两类ID直接比较而退出，未部署；tar附带latest标签，诊断加载后已立即恢复原d94bc镜像的latest指向，生产容器始终原image/exited。标准upload只写隔离诊断目录，SHA已校验。

实际候选镜像对原232副本的停止态Host启动495434ms通过，health/runtime/Formation/collection全200，normalSupplyAllowed=false，158424 Attempt、682 Entry、0停止态终止Receipt及1 executing Event均保持。源码覆盖版先前522363ms的PASS单独保留，不替代实际镜像。NAS真实Operator最终完成275步：225Subject/14Run退役、14Workspace字节保留、10张Arca保护表摘要完全相同、Attempt不增、executing归零、1条停止态终止Receipt、FK/integrity通过。此为重用已完成完整备份且全量SHA重验的分段演练，不宣称一次完整Runtime API成功。实际镜像的正式256MiB Worker重放738072ms通过，回执完全一致、Attempt/Receipt/Entry计数保持；其他最后资格仍在完成。

原232副本经实际候选镜像反向复制1905272ms完成，230表逐行摘要同源；初始隔离配额1.5GiB/1CPU发生173101次内存上限回收、读盘158GB，无OOM，后调到3GiB/2CPU，不调整产品守卫。旧镜像完整停止态Host正在核验。

用户明确授权生产部署后执行新版整体Reset；另外明确4K忙载吞吐延后、不阻塞发布。新冷备`backups/pre-f280e6bd4-20261023/data`于05:56:05Z校验196文件一致，清单SHA256为7e115a1b966f5f9c947d455d4aa60a832facd580c02093296026644bf2260d1a，另保存Compose/Secret，原事故冷备保留。生产原库仍未切换。准备新一致快照及正反向结构副本，首次部署辅助fixture误假设镜像内包含只供部署包装加载的create-readiness-snapshot.js，未开始捕获即失败；改为只读挂载同提交的既有辅助脚本后继续，没有修改镜像或产品规则。

新增专用formation-retirement-schema-cutover工具，避免旧223表/旧schema发布器误用；严格绑定230表正反向证明、独立源快照SHA及原main/WAL/SHM物理集合，保留非空WAL并进行持久同卷切换。真实WAL含已提交Subject的正例、WAL漂移/缺失、反向事实证明漂移及两处中断继续共6项，Windows与实际Linux镜像各PASS。该工具属于部署辅助，不改变f280产品镜像；生产前仍执行dry-run及完整门禁。正式deploy-nas dry-run已通过，尚未apply。


## 2026-10-25 生产操作前最终资格核对

用户再次明确要求部署并执行新版Reset，完成后保持停止，核对收藏与历史。原生产仍为d94bc/hostfix4、exited、restartCount0，15个其他容器运行；fnOS只读preflight和部署Secret一致性复核通过。标准deploy dry-run再次通过。

补记已完成但14:28检查点尚未结束的资格：实际候选Reset后停止态Host 725874ms PASS；旧镜像在反向副本完整停止态Host 713539ms PASS，原158424 Attempt/682 Entry/1 executing保持。256MiB Worker prepare修正fixture Reset ID格式后437245ms PASS，保留plan 7185665 bytes，heapUsed216278880；首轮ID守卫拒绝记录保留，不修改产品守卫。新生产冷备的正向230表结构复制及反向还原于2026-10-23T06:59:30.916Z全部验证通过。

2026-10-25T09:03:44.900Z生产cutover dry-run通过，原main/WAL/SHM与冻结物理集合完全一致，源一致快照SHA256 `56cf17a43327a0b533fb8a92e2ff90a2e10f1652d17deaf76b2765692d709ecc`，目标SHA256 `cc3f026824919c3d3b7ea6fa5821b611a9b4ef939b8b9a0acd4b0a85262cbca4`。正在执行切换；本节不宣称部署或生产Reset成功。


2026-10-25生产切换与部署：cutover apply成功，目标SHA与预检一致，原冷备及WAL/SHM保留。标准deploy-nas --apply完成，镜像 `markmahoro/shelfdeck:f280e6bd4`，source `f280e6bd495e8bb75f4185d532adc18e0f1b0071`，NAS image ID `sha256:6f57fec925c007f810ab23af323a75f3dd3499259e6f18b8acbb56186a78e723`，tar SHA256 `192445c85c44a26f38cb1490a30f5b7b29a8ab48b8e24732861a017a545c107c`。StartedAt `2026-10-25T09:11:22.486206343Z`，启动约5分钟后health/Admin/挂载/镜像身份全部通过；启动前连接重置属于监听前轮询，未重启容器，restartCount0。Runtime stopped/desiredMode stopped/normalSupplyAllowed false、error null。

生产Reset前只读基线22组摘要保存于冷备verification/protected-before.json：10张Arca收藏表、10张Libra Decision/Receipt/Outcome历史表、927个既有ended Run及其Revision；682 Shelf Entry、158424 Attempt、1 executing Event、0停止态终止Receipt。相比先前12组验证，增加历史表核账只改变只读诊断脚本，不改产品镜像。

正式Runtime Reset API于 `2026-10-25T09:17:40.244Z`受理 operation `35f56422b3e3f8f2dc52d539bae7a261427637c0a9daa95352b94fef49c35454`，范围225Subject/14Run/14Work/14Workspace、pending Intake0、无blocker。使用同一幂等键，未重复提交。当前resetting/desired stopped/normalSupplyAllowed false，备份ID `formation-reset-8d5c2351-dcbb-4174-962c-163d98f2bd39`，位于 `/vol2/1000/shelfdeck_backups/`；本检查点尚未完成Reset，不宣称后置核对通过。


## 2026-10-25 正式生产Reset完成及独立保护核验

本次实际通过正式Runtime API执行，非隔离副本或分段重放。operation `35f56422b3e3f8f2dc52d539bae7a261427637c0a9daa95352b94fef49c35454` 于09:17:40.244Z受理、10:13:54.769Z完成；reset ID `formation-reset-ffd78384-295c-4bdb-9736-215035e4a4fa`，275/275步骤完成，225Subject/14Run行政退役、pending Intake0、14Workspace保留。原1个停止态转码执行正式终止，新增1条Foundation停止态终止Receipt，executing=0，未重跑转码。API后置preview subjects/intakes/runs/works/workspaces全部0、无blocker；Runtime stopped/desired stopped/normalSupplyAllowed false/error null/recoveryBackup null，未Resume。

完整备份于09:45:36.033Z生成回执，目录 `/vol2/1000/shelfdeck_backups/formation-reset-8d5c2351-dcbb-4174-962c-163d98f2bd39`；backupDigest `df162e66ae9b65da163df7d383acb9b0344ab0f23ab2eb182c6de91ac5a3b309`，一致数据库SHA256 `606b9bd3309f1925a496a1cfbf60c8b267702cf8f096bb6973bbfd20c2c11218`。现存Workspace 88,669,733,359 bytes，14项中2项原目录不存在、按absent记录；含数据库/伴随文件逻辑总量约93.3GB。提交前再次全量SHA复核通过；不把reflink逻辑字节等同新增物理占用。原升级前196文件冷备及精确结构切换证据另保留。

独立只读前后核验22组事实完全一致，涵盖：

- Arca的Shelf Entry、Canonical Identity revisions、Deck Fact revisions、Inventory materials/person relations/product facts/related references/representations/verification records、On-deck Commit receipts，共10张表；682条Shelf Entry保持。
- Libra既有discard decisions/receipts、Run outcomes、Handoff A receipts、intake decisions、delivery receipts、Subject abandon decisions/receipts、decision basis inputs/revisions，共10张表。
- 原927条已结束Run及其Run revisions逐行摘要保持；结束总数941是原927加本次14条administratively_retired，不删除或改写原终局。158424条Attempt总数保持；原未完成执行的状态改变由新增正式终止Receipt说明，不冒充全部Execution字节不变。

foreign_key_check为空、integrity_check=ok。后置检查初始隔离1GiB/1CPU产生11004次memory.max回收、没有OOM；只把读数据容器提升到3GiB/2CPU后完成，所有生产数据与媒体挂载均readonly，仅verification证据目录可写，未改生产资源配置。辅助容器自动退出；只剩正式ShelfDeck容器运行且业务stopped。health/runtime/Formation/collection通过，fnOS HTTP200，15个无关容器持续运行；正式容器restartCount0/OOMfalse。

正式回执位于 `/vol1/1000/docker/shelfdeck/data/reset-receipts/formation-reset-ffd78384-295c-4bdb-9736-215035e4a4fa.json`；journalDigest `8d8f7aa1871c432ce75f85ef2d49eb66ee5822982e46251b5b56d71ba7cdeb50`。前后摘要位于 `/vol1/1000/docker/shelfdeck/backups/pre-f280e6bd4-20261023/verification/protected-before.json` 与`protected-after.json`。本地ignored目录保存标准deploy日志、API受理/最终结果、冷备/Reset回执及前后摘要，不提交原始生产数据。

本次已产生正式管理退役新事实，不能仅切回旧镜像或覆盖旧数据库；反向结构复制仅证明无新增事实时可回退。冷备保留作事故恢复材料，本次没有执行回退。未重新遍历全收藏媒体字节，保护结论以正式收藏事实/历史摘要、Reset正式边界及上述证据为准。原剧集问题、高达/凡人歌的正常新流程媒体验收继续开放；不以Reset或隔离测试代替自然重采验收。4K忙载吞吐继续延后。


## 2026-10-25 Resume 阻断与来源目录提示

Reset 完成后的用户授权 Resume 在 10:21:42.470Z 创建 operation `08c21ab53416aa594dd461a3c6c5aeec61ae305e437fee50951f949ac2f72126`，10:23:46.265Z 失败，`P4_EXECUTION_HOST_RECOVERY_BLOCKED`。HTTP 客户端超时不代表请求未受理；未重复投递。Runtime error / desired stopped / normalSupplyAllowed=false，容器无重启/OOM。此前完整副本验证只证明 stopped Host，不包含正常 Resume，这是本次资格遗漏。

五个真实来源 `/media/Film`、`/media/chn_series`、`/media/Series`、`/adult/JAV/toscrape`、`/adult/US` 均通过 stat/opendir 且非空。最新 Field Observation 的 ROOT_UNAVAILABLE 来自 2026-10-22T11:52:23–36Z；overview 优先投影该历史失败，不能由提示推断当前挂载失效。未清除旧记录或修改路径。后续需恢复供给并等待正式新观察证明，而非伪造成功。

未改动镜像 f280e6bd4 的完整生产副本正式 Resume 恰好得到 1707 个 `PLAN_CATALOG_DRIFT`，无其他类型 finding。这些 Plan 全部对应 hostfix4 Catalog `8f5dded28a5fea846f45a7c7b715109f1cf92ef36473d7a1b7f67cc68b4208db`，所属 Work 全部终态；8 个范围外保留非终态 Work 不是本次阻挡原因。两次前置诊断因副本挂载身份与持久 Aftercare root 不匹配而中止，属于 fixture 配置错误，已保留失败日志；使用生产 `/app/data` 只读保留原物理身份、独立 `/diagnostic/data` 写入副本后复现成立。

修复沿 SSOT 既有 Frozen Catalog History：从不可变旧镜像 `sha256:d94bcda0875bc51059dfa601f5fec3b0f220d9b0925029fadd75886c649a886e`、revision `b70a9f6f6dde90654fbdef70e226b11f25f709f5` 的空隔离 Host 提取 125 Capability / 1368 Schema 及原策略与完整 Result 证据闭包。新增 `published-terminal-contracts-20261022.json`，canonical SHA256 `51dca4f218fdeae45ec2a72c53056afe3fb0486b056e5a794117658fa6c1046b`。只读验真终态 DAG/Owner/Result/Effect，不注册旧执行器、不增加 Catalog 白名单、不修改历史、无数据结构迁移。定向历史合同/暂停批次/启动恢复 118/118 PASS，含活动 Attempt 与篡改拒绝。新鲜生产副本正常恢复、Service 与修复镜像资格仍在执行；本节不是发布成功声明。


## 2026-10-25 历史兼容累积机制审视（设计待确认，候选暂停发布）

用户明确担心逐次升级叠加兼容补丁。复核实现与 Git 历史后，不能把本次问题仅定性为漏带文件：

- `workflow-plan.js:executionCatalogDigest` 对全部注册 Capability 与完整 Policy digest 求摘要，Plan 持久化该全局标识；与某 Plan 无关的能力变化也可能改变 Catalog。
- `startup-recovery.js` 的 snapshot 全读执行表，逐一把全部历史 Plan 送入 Catalog verifier；`PLAN_CATALOG_DRIFT` 属 hard finding，任何一项均令全局 normalSupplyAllowed=false。缺档与当前实际责任风险在该门禁中没有区分。
- 9月以来多个提交持续扩充 transition/history；现有五份 terminal contract archives 合计约8.4MB，包含本次未部署档案。附加档案有最多8份的硬上限；该上限不是退出机制，不能以扩大上限解决增长。
- 既有 SSOT UAT-251/274、UAT-293 允许完整原合同只读验真，禁止旧 Executor 和活动 Attempt；本次678687b8e符合这一现有机制，但不消除机制本身的发布耦合。§10.3原有按责任Scope恢复/隔离与后续全局历史Catalog阻断规则需统一，不应擅自把历史全部跳过。

建议的新合同方向（尚未批准或实现）：Foundation在发布新Plan时原子冻结其实际使用的合同及Schema/Policy闭包，以不可变内容摘要保存且去重；历史合同作为随数据备份的证据，不再按发布日硬编码加入服务源码。正常启动验证当前责任与未决Effect及其必需依赖闭包；已经闭合且不被当前责任引用的历史审计独立有界执行。缺失依赖必须阻断受影响操作，无法证明风险Scope时仍全局阻断；不能仅凭terminal字段认定无责任。历史审计结果不能授权执行，引用旧Result须通过明确的当前消费合同。需要定义证据版本支持边界、完整性/来源信任、备份恢复、缺失/篡改行为，不能把新的存储层变成通用兼容执行器。

既有历史只允许一次性从可证明的原镜像/合同建立精确证据引用，原事实不改写、不复活已退役Formation；无法证明的历史显式报告，不猜Schema。验收必须覆盖：无关Capability升级无需旧版本分支；多次合同升级及无旧镜像环境仍能启动；历史篡改被发现；有未决Effect或当前依赖时仍严格拒绝；断电发布不形成无合同Plan；备份恢复及既有收藏/历史保持。

这涉及启动门禁及持久合同，需要先确认新SSOT再实施。当前补档案候选暂停部署，生产保持供给关闭，不再Reset。Windows Service复验673 PASS/29 skip/0 fail；定向118 PASS仍只证明现有补档案方案，不作为新机制通过证据。


## 2026-10-25 历史合同机制清理开发检查点

用户已确认按机制清理，不单独上线678687b8e补档案候选。SSOT §8.5.10.1及三个Phase工作项已同步。本节为开发证据，不是部署或生产恢复完成声明。

- 新Plan保存实际使用的Capability manifest、schema传递闭包、执行策略和结构绑定，两个证据表与Plan同事务；同步Owner命令单独采用其正式合同，不伪造Executor或Effect。
- 启动根为当前Work/Attempt/Event、未决Effect、资源等待和Circuit，按实际关系展开；终态Work的未决Effect仍必须验真。闭合无关历史不再构成整机启动前置条件。
- 历史审计纳入既有存储维护：每批8项、时间预算、持久cursor及内容寻址审计Receipt。缺失或错误证据有明确finding，不能静默视为通过。
- 原日期档案和专用旧版本证明移至`scripts/helix-architecture/history-evidence`。一次性迁入仅接受精确来源及原严格验证；终态封存原图与依赖图摘要，不产生旧执行权。实际依赖仍必须校验，未知来源记unverified。尚未证明生产所有历史均可迁入。
- 精确232→235结构复制只增加`fx_execution_contracts`、`fx_plan_contracts`、`fx_plan_history_audits`，逐表核对231张原事实/执行表。旧232目标工具冻结其原DDL，避免未来版本重新改变旧工具语义。
- 新增原表前后校验抓到正常Host初始化会写系统Rule Template，因此导入改为临时空Host仅捕获合同，目标使用SQL受限Kernel，只能SELECT及INSERT两张证据表。修复后真实进程回归通过，旧表全部保持；该失败及修复日志保留。

开发证据（ignored日志位于`.codex/formation-diagnosis-20261023`）：

| 检查 | 实际结果/边界 |
| --- | --- |
| 完整Service上一检查点 | 702 total / 673 PASS / 29 skip / 0 fail，`history-mechanism-service-2.log`；不代表此后追加修改已完整复测 |
| Clean Host | 15 PASS / 2 skip，`history-mechanism-clean-host.log` |
| Owner重试 | 26 PASS，`history-mechanism-owner-command.log` |
| 责任根/合同证明/导入 | 34 PASS，`history-mechanism-roots-proof.log` |
| 最新隔离导入 | 1 PASS，`history-mechanism-import-protection-4.log`，含原表保护 |
| 静态模块/语义/manifest/合同门禁 | 全部通过；旧版本移出运行目录后的完整固定门禁待执行 |

当前生产容器仍为f280e6bd4，业务供给关闭。旧Reset已经完成，不重复执行。下一步固定候选完整门禁、NAS生产副本逐表保护与历史迁入、正常Resume及适用平台资格；完成后才沿标准发布入口恢复生产。Docker Desktop当前命令超时，尚无新镜像，不以源代码overlay演练替代最终镜像资格。


### 机制副本演练追加检查点

- 固定230a3100a的Service再次取得673 PASS / 29 skip / 0 fail；完整Architecture仍运行于独立固定checkout，JAV旅程持续创建新fixture，未提前终止或记PASS。
- NAS只读生产副本232→235复制完成：231张原表逐行一致，外键/完整性通过。旧无索引候选的逐Plan导入反复扫描Effect及Marker；保留已得复制证据后停止该隔离容器，生产未操作。新增三个明确SSOT技术索引，查询计划回归证明使用索引而非全表扫描。不会在运行旧副本上偷偷加索引，将从冻结源重新准备新候选。
- 三组更早的Catalog已用原提交真实Host复原：b06b70ba10对应37264ba7、999a94fa8对应a30cf21a、04bf24190对应b39d3635；档案canonical摘要分别35b0bb78、9131d24f、999a72c8。仅纳入一次性导入输入；缺少当时Schema声明的Result仍验真失败，不沿用后来的名义合同补授权。
- 终态证明的未决物理Effect必须重新取得当前Owner证明，不能靠封存摘要通过启动；复用相同输入/Intent/Source Commit/Slot链验证，观察后重读封存事实。85项正反例通过。
- 加性复制/导入、原表保护与同卷原子切换10项通过；包含保留非空WAL、rename前后中断恢复、来源漂移及运行意图拒绝。失败历史现在立即写持久审计Receipt。
- Docker引擎经用户恢复后已确认29.4.1可用。Windows及Docker包装已补一次性工具及冻结档案依赖；最新固定候选完整门禁、镜像和NAS演练继续，尚未部署或恢复生产。

- 最新组合`history-mechanism-final-targeted.log`：41项，40 PASS/1历史快照未配置skip/0 FAIL，覆盖两个P3持久化门禁、旧JAV复制/验真、合同导入/加性复制、终态Owner证明、Windows独立分发与切换工具。两个过期索引总数断言改为对照当前manifest；精确索引查询计划仍独立检查。
- `history-current-jav-first.log`：新建真实HEVC JAV完整入藏1 PASS（约44秒）；输入清理等待是fixture主动验证授权前不删除，授权后正常完成，并非已证实的运行回归。完整Gate仍待结果。


### 2026-10-25 完整门禁发现的机制缺口及副本导入结果

固定230a完整Architecture结果为3346项：3296 PASS / 24 FAIL / 26 skip，四项静态通过。失败日志保留，不作为发布资格。除旧fixture断言、归档checkout缺Git历史外，确认了以下真实缺口并补回归：

- Owner原子写入Result/Commit Marker后、Event Journal收尾前退出，是合法恢复窗口。当前Plan仍须使用未变合同，并精确证明Event/Attempt/Intent、Marker/Result摘要、Owner及Scope和提交时序；Receipt与DomainFact两种既有typed提交合同分别核对。不会直接将Effect改成committed。
- Procurement的Triage Evidence引用不是完整观察对象；新增显式`evidence_reference`序列化声明，严格四字段及摘要/Marker检查。JAV资料修正的验证Record按实际生产者声明为`full_result`，不从字段形状推断合同。
- 一个依赖闭包可涉及多个终态Owner观察，逐图取得精确未决Effect集合并重验整图；限制100轮，外来/缺失/不推进证明继续拒绝。
- 维护窗口旅程暴露Host注入时钟未传到文件观察和FFmpeg Event deadline。统一使用同一执行时钟，实际进程本地时限/停滞保护继续使用原规则，不调整4K吞吐或时限。

定向证据：合同/历史/Owner正反例及P2基线100 PASS；静态fixture23 PASS；Git历史及文件观察11 PASS；媒体Effect24 PASS/1现场BDAV fixture未配置skip。真实同名多季入藏、整剧rename后退出恢复、整剧原子Commit后退出恢复、JAV原子修正/回收退出恢复、维护窗口人物建档均通过。定向通过不代替最终固定版本完整门禁。

固定76724153e镜像已标准构建及上传，仅用于NAS隔离诊断：tar SHA256 `fb70783d5c546e87292d3ba8bfabecb5c5b6ea805c11bcb960ee8d78e85b8d4a`，NAS image ID `sha256:ccf311034f84204fd51514b0aef911bac6b42201739ef907928295ab04be0e5f`。232→235副本导入扫描51273个Plan，其中51246 imported、27 unverified；导入后231张原表逐行摘要保持，FK/integrity检查通过。27项均为终态且Effect已committed：4项成功Event缺Result、20项旧生产者缺可证明的prebound Evidence声明、3项旧Result缺其冻结Schema要求字段。保留原事实及持久失败审计，不补造证据；它们不因此获得执行权。

767副本首次正常Host启动因演练漏复制加密凭据失败，补齐后由于将副本挂到`/app/data`改变原Workspace mount身份再次失败。演练改为副本数据库位于`/diagnostic/data`、原Workspace及媒体只读挂载以保留真实物理身份，正常Resume/Stop及22组收藏历史保护继续验证。两次演练配置失败保留，不记PASS。当前生产仍f280e6bd4且供给关闭，本段没有生产部署或Reset；最终新候选门禁/镜像/副本恢复资格待完成。


### 最终镜像 c91fbed63 与新冷备（2026-10-25，资格进行中）

候选 `c91fbed637b99a80611a30f4601a8e2acf74410b`，镜像 `markmahoro/shelfdeck:c91fbed63`。标准build/upload已完成，tar SHA256 `b322c4d163fae4a62e28ed7b7b6e0349a8e6c8eacb97d4144e021deef35af394`；NAS image ID `sha256:0a85ab1aaf13d554871013c1cc9973a09412d7869780f6d0e705a011c7721e02`，本机containerd ID `sha256:83e9b4bfb63ea1b63a35c70be1707f26d1518d7d53baecf87228189579ecf11c`。完整Gate在真实detached Git worktree运行，避免先前archive checkout缺Git历史导致P6/P7资格环境失败；尚未结束。

- Service710项：681 PASS / 29既有skip / 0 fail；Web build PASS。UI/Projection源码与生产f280对应范围无差异，不新增UI资格声明。
- 实际最终镜像合同/证据/导入100 PASS。实际整剧rename/commit进程退出恢复及两项资料修复4 PASS；JAV correction原子Receipt、reclaim Receipt、cast维护窗口及Series shared reclaim进程恢复4 PASS。
- Windows独立分发、原生依赖、包内Host、打包工具完整性及覆盖拒绝1 PASS。资格工作树使用node_modules junction导致旧完整运行package-win复制junction报EPERM；相同c91输入在有实体依赖的主工作区完整复验通过，不能把环境失败记为原运行PASS。
- 实际镜像切换/同步命令/media组合33项：30 PASS / 2 FAIL / 1 live BDAV fixture缺失skip。两项FAIL为ISO concat输入触发FFprobe SIGSEGV；f280生产镜像以相同测试复现2/2失败，FFprobe、clean-media-probe及输入预算源码SHA完全相同。该既有ISO问题不归为本次合同机制回归，不记PASS或声称已修，4K忙载吞吐仍延后。日志 `probe-baseline-f280e6bd4.log`、`probe-baseline-hashes.log`。
- Docker测试首次缺测试专用builder的MODULE_NOT_FOUND和中断重配记录保留；只补只读测试夹具，不覆盖镜像运行源码或将测试builder加入生产包。最终上述4项JAV/shared旅程日志 `docker-c91fbed63-jav-final.log`。
- 767前候选NAS副本Resume→running→Stop→重开stopped通过，22组保护摘要不变，errors/rejected均空。该前候选记录不替代c91最终镜像副本；c91从同一冻结232源重新复制/导入，231原表逐行保护已通过，正常Resume资格继续。

生产操作：本轮只做标准升级准备，尚未切换。14:03Z前后正常停止原f280容器，exit0/RestartCount0，持久intent desiredMode=stopped/revision26/pendingReset=null。14:05:09Z冷备198文件逐项SHA前后/副本一致，清单SHA `eadf6bca1c485e60679e10055f48845c79b8f3c4151f072e1b258a87be3b37bc`，位置 `/vol2/1000/shelfdeck_backups/pre-c91fbed63-20261025`，含完整data/Compose/Secret；既有Reset外部备份卷继续保留，未复制其全部历史备份。准备源物理集合仅主DB一文件，无WAL/SHM/journal；冷备没有被打开写入。

独立准备目录 `/vol1/1000/docker/shelfdeck/backups/history-cutover-c91fbed63-20261025`。加性结构生成与证据导入的临时目标放在上述专用备份卷的preparation子目录，减少vol1峰值空间；关闭后复制到同卷prepared.sqlite并核对SHA，再由正式cutover工具二次核验原表与原始物理字节。部署仍必须使用标准deploy入口，且以最终副本和测试资格为前提，不重复Reset。22组保护基线保存原记录主键及逐行SHA，682收藏/941 ended Run；原始只读WAL模式主库检查因辅助文件缺失被SQLite拒绝，已改为读取相同字节的准备源副本，未修改冷备或生产原库。

容量记录：本轮完成的767隔离副本data已按精确路径清除，冻结源、导入/恢复报告、冷备及生产数据保留；未清理Docker私有目录、无关容器或历史生产备份。后续部署前继续核对可用空间。


22:48资格追加（同一c91候选，产品输入未变）：完整Architecture首跑3351项，3322 PASS / 3 FAIL / 26 skip，四项静态门禁PASS。失败为formal HTTP入口30秒启动超时、Windows包构建90秒超时、1081媒体采购已完成65包但发现1条带failure_code的Attempt。最后一项原测试没有输出具体失败码且清理了fixture，不能宣称已证实其根因。相同候选、原断言、独立串行复验HTTP入口及完整1081媒体采购2/2 PASS，Windows实体依赖独立包此前1/1 PASS；组合3325 PASS / 26 skip / 0剩余失败，首跑记录不改记PASS。JAV及Series完整流程已在首跑完成。日志`gate-c91fbed63.json`、`gate-c91fbed63-failed-fixtures-rerun.log`、`windows-c91fbed63-qualified.log`。

最终NAS副本已完成51,273条旧Plan检查，51,246导入/27 unverified；与767前候选的27个Plan ID及失败类别逐条一致。导入后231张原表逐行保护通过，verifierDigest `5611043165290541c59fbc0fc9a71fe90367ff74246095180c158a2ba4f84132`。14:41:59.543Z正式Resume达到running/normalSupplyAllowed=true/error=null，Stop→重开及最终保护复查仍在运行，尚未宣称完整副本资格结束。

生产冷备来源准备副本于14:33:12.517Z通过独立结构复制及231表保护，继续证据导入；原生产容器保持exited0，原库尚未替换。本次复制目标跨备份卷生成后，进入同卷cutover之前还须对已核对SHA的prepared.sqlite及父目录执行fsync，随后正式工具dry/apply分别核验字节与原表；不因等待时间取消任何保护检查。


14:50:09.310Z最终c91镜像副本资格结束：Resume=running、Stop=stopped、重开=stopped，errors/rejected均空，682收藏/941 ended Run及22组逐行摘要保持，FK/integrity通过。总耗时694369ms含大库读取；不把0.8秒Resume状态切换当作整个冷启动耗时。结果已保存`history-c91fbed63-resume-qualified.json`与`qualification-c91fbed63.json`。

NAS为7.6 GiB物理内存；两个验证容器并行时出现交换区压力，准备容器曾短暂pause后恢复，未修改生产资源配置。其4GiB限制累计触发16903次memory.max事件、约2125万次文件页重读，OOM/oom_kill均0。其他验证已退出后，仅将准备及后续单独cutover校验容器提高到6GiB（同值memory-swap、2 CPU），继续完整校验；原生产保持exited0。生产准备副本也完成51246导入/27失败审计，尚待最终原表保护结束及发布。


### 2026-10-25 23:19 生产准备库最终关闭与交付

最终准备库完成 checkpoint 并关闭日志模式，复制到同卷 prepared.sqlite、同步文件及父目录，复制前后 SHA256 为 `f416d76fb1acd52eb38c0182c021f4f48576d738770c71cf98e54ab75e89c91f`。来源快照 SHA256 为 `44ed9880bb7867bb701458b334afdb5cc8ef2ca131ec4e08c278392226e2f6cd`，原生产物理文件集合再次保持。准备阶段先前因只读验证产生空 WAL/SHM 而拒绝交付的记录保留；仅对准备库正式 checkpoint/close，没有修改原生产库或业务事实。

生产准备导入 51246、未证明 27，231 原表保护通过；27 项记录与最终 c91 隔离资格报告逐项完全相等。ready.json 与导入、结构 Receipt 已取回；正式切换 dry run 正在独立复核，尚未宣称安装或恢复。证据为 ignored `production-c91fbed63-finalize.log`、`production-c91fbed63-ready.json`、`production-c91fbed63-import-report.jsonl`。


23:30 切换阶段：正式dry run于15:26:18.590Z通过。首次apply完成全部保护核验后，因运维包装分别bind data/prepared两个目录，Linux在rename返回EXDEV；marker保持qualified，原生产SHA `44ed9880...2f6cd`、prepared SHA `f416d76f...c91f`完全不变，生产仍旧镜像exited。改为共同应用父目录单一bind mount，复用同一正式cutover工具的幂等恢复及完整验证重试，不手工mv、不删marker、不改产品源码。失败日志及独立SHA确认分别为`production-c91fbed63-cutover-apply.log`、`production-c91fbed63-cutover-exdev-state.log`，部署标准补明挂载边界。


15:34:26.866Z 正式cutover安装成功，schema235，installed=true/applied=true/sourceRetained=true；目标SHA保持`f416d76fb1acd52eb38c0182c021f4f48576d738770c71cf98e54ab75e89c91f`。共同父目录挂载重试保留原记录并重新完整验证；实际源main/WAL/SHM/journal集合无漂移。回执`production-c91fbed63-cutover.json`已取回。标准`deploy-nas.js ... --sha256 b322c4d1... --apply`随后开始；部署/Resume结果尚待，不重复Reset。


### 2026-10-25 23:41 标准部署与正式恢复成功

标准deploy完成readiness、镜像身份、API/Admin Web及所有既有媒体/Workspace/备份/QSV挂载检查，15:39:15.565Z启动c91镜像，RestartCount0/OOM=false；15:40:59Z Runtime stopped/error=null/供给关闭。15:41:07.819Z恢复前22组记录精确比较missing=[]/changes=[]，682 Entry/941 ended Run/3221 ended Run revisions、所有原Decision/Receipt/Inventory逐行原样保持。日志`deploy-c91fbed63-apply.log`、`production-c91fbed63-facts-exact.log`。

15:41:28.209Z通过正式Runtime Resume入口受理，15:41:29.688Z完成，revision27、running/normalSupplyAllowed=true/error=null；operation db56931ab4e885c7b0bf8b6cd8e4d64644d10483910e82fab9b9e67fb2c99d93。首次五来源stat/opendir可读，观察时间仍为旧记录，继续等待正式自动扫描，不能据health200宣布完整业务验收通过。没有再次Reset，没有手工修改来源或指定媒体优先采购。


### 2026-10-25 23:46 恢复后业务与历史核对

- 15:41:40–15:44:45Z 七轮、42次health/Runtime/来源/overview/Formation/collection请求全部成功，持续running/normalSupplyAllowed=true/error=null。Formation请求65–123ms（中位94ms），collection207–417ms（中位253ms）；只代表短时本机样本，不是4K忙载吞吐验收。
- 五来源stat/opendir可读并已正式自动扫描；23:46 API中国产剧新21页扫描完成、JAV新1页完成，其余扫描仍进行。工作台12 in_progress/0 attention/676 completed；raw旧Projection缓存含行政退役项，不能把其classification计数当作当前工作台结果。23:45按active Subject+无current Run+无token筛选为空。
- 15:43:49.324Z恢复后原22组记录missing=[]/changes=[]，682原收藏与941原ended Run保持。Handoff A/Intake Receipt从930增至936及Decision增加来自本次正常新接纳，未覆盖旧行。没有人为优先重采、移动或替换两部目标影片，真实自然媒体验收继续开放。
- 一条新Attempt失败`P8_ACCEPTANCE_CONTINUITY_BASIS_STALE`由Owner既有终态处理返回replan，ordinal2成功，当前acceptance Work=succeeded。失败记录保留，不记服务故障或伪造首次成功；资源等待media probe从687降至592，队列在推进，仍不可据此作吞吐结论。
- 容器RestartCount0/OOM=false，15个无关容器保持，fnOS HTTP200；应用/用户目录权限不变。readiness临时容器释放后vol1可用约9.4 GiB，vol2约368 GiB。
- 日志出现`MaxListenersExceededWarning`（共享AbortSignal超过10个监听器）；尚无泄漏/功能失败证据，保留为观察项，不靠调高监听器阈值掩盖。两项既有ISO FFprobe故障、27项旧证据不足及4K忙载吞吐延后边界保持。
- 既有`shelfdeck-2`只读24小时heartbeat已更新为c91运行状态，保留原周期和窗口，不延长；仅变化/故障通知，不自动Reset/部署/重启/改媒体。

证据：`production-c91fbed63-monitor.log`、`production-c91fbed63-facts-preserve.log`、`production-c91fbed63-source-final.log`、`production-c91fbed63-new-failures.jsonl`、`production-c91fbed63-host-final.log`、`qualification-c91fbed63.json`。恢复供给后已有新事实，回退禁止直接覆盖冷备；须先停机、冻结当前事实并使用经保护验证的回退方案，旧f280镜像也不能直接启动235结构。


### 2026-10-26 00:53 恢复后停滞：只读诊断确认两项缺陷

用户要求“查一下”，本次未重启、Reset、改库、部署或修改媒体。产品仍c91fbed63。00:45观测167 ready且最近15分钟无Attempt，00:47又有Libra身份/资料执行，因此准确结论是媒体生产类别被持续阻塞，不能称整个调度器死亡。7个Arca duplicate事件归维护类别，当前不在维护窗口，等待本身合法。

**EXECUTION-RECOVERY-RESERVATION-CLOSURE（根因确认、未修）**

- `owner/libra/libra_run/workspace_media_production` Circuit仍为recovering，旧reason `LIBRA_MEDIA_FFMPEG_TIMEOUT`，incident occurrence_count=9。其evidence_digest `e14c694f92961f25c0e740b5fb9f3f34c400a9b0af0e02272183038c02c88c3a`精确等于按正式canonicalDigest算法为旧Work `libra-workspace-media-transcode_2_selection-work-fef144ddcf3c0adb3aa63416ae59da68e15a6ac5`计算的恢复占用摘要；不是仅凭名称猜测。
- 占用者Run `88246654238fce5a61a4992d41de68e630a36bdc5d92ffc46f078855088ffbd8`与Subject均administratively_retired；Work/Attempt及4个Event已cancelled，Attempt reason为administrative_formation_retirement。恢复资格仍指向这个已取消Work。
- Foundation `prepareExecution`会拒绝任何workId摘要不同的请求，返回resource_recovery_in_progress；00:49共14个新workspace_media_production Work/194个ready Event受该类别门禁影响，无未满足的图依赖，不是FFmpeg正在占满CPU。
- `work-lifecycle.cancelProcess`直接结束Work，但没有通知Incident Observer；`pendingOwnerReconciliations`仅查running Work，永远不会重新找到该cancelled Work。正常Host终态路径才调用`observeTerminalWork → abandonExecution`。由此Reset/直接取消遗漏技术占用收尾。
- 临时真实SQLite+实际Foundation Registry/Observer/WorkLifecycle复现：取得恢复资格→真实cancelProcess→Work cancelled、pending scan为空→新Work被拒；在临时库显式做cancelled终态观察后新Work可取得资格，原Incident没有被伪造为resolved。`stall-cancellation-repro.test.cjs`及同名log：1 PASS（断言缺陷存在与受控对照，不是修复PASS）。
- 修复归Foundation，既要覆盖正常取消/行政退役，也要对持久恢复占用的Owner终态作可重放收尾。应只释放失效的恢复占用，保留Incident和历史失败，由新任务真实执行决定是否恢复；不能清空全部Circuit、伪造成功或再次Reset。前次副本Resume/记录保护资格没有覆盖Reset后实际媒体执行的这项技术责任，验收遗漏成立。

**SERIES-SOURCE-ABSOLUTE-ROOT（根因确认、未修）**

- 《走向共和》本次新包 `candidate-package-d25744b21f5687c1965fa43200bd18b01aa42889`冻结fieldRoot=`/media/chn_series`，却冻结sourceRoot=`media/chn_series/走向共和 (2003)`，缺开头`/`。三项实际reference均位于正确绝对剧根下。
- Procurement `procurement-candidate-context-reader`使用本来用于相对Scope的`normalizedLocation(fieldRoot)`拼接绝对sourceRoot；所调用`bdmv-scope.normalized`明确删除首尾斜杠。对实际Linux路径调用该函数已复现缺失`/`。资料读取端`series-local-source-io.readReference`要求绝对路径，因此正确报SERIES_LOCAL_SOURCE_SCOPE_INVALID。这是新包生成缺陷，不是目录不可用，不能放宽下游路径安全校验掩盖。

其他事实：唐顿庄园及新一次暗算资料请求出现PLATFORM_INTEGRATION_HTTP_FAILED；当前持久失败仅保留通用码，尚无具体HTTP status证据，不能直接归因为网络或凭据。15:57Z P7_TRIAGE_UNIT_RECORD_DRIFT及Procurement探测失败继续独立调查，不能用它们解释已证实的恢复占用阻塞。监听器警告144次，但内存样本2.62→2.386 GiB，无OOM/restart，尚未证实泄漏。五来源新扫描完成，682收藏记录保持，无active且无Run/token异常。

只读现场证据（ignored）：`stall-gates.jsonl`、`stall-reservation-owner.jsonl`、`stall-series-source-scope.jsonl`、`heartbeat-20261025T1644-*`、`diagnose-stall-api.log`；生产无写入。后续发布资格须增加“Reset/取消持有恢复资格的Work→重启→普通新任务实际完成媒体探测”的完整旅程。


### 2026-10-26 恢复占用与Series根路径修复资格（未部署）

- 根因修复均留在既有Owner：Foundation负责取消后的Circuit reservation收尾；Procurement负责新Candidate的物理sourceRoot构造。没有结构迁移、旧包改写、Circuit全清或版本白名单。
- 在线cancelProcess及独立formation-retirement-operator均在取消事务提交后核对当前责任；普通Host start/Resume在供给开放前补查。以当前recovering Circuit为入口分页寻找exact reservation Work，要求全部Work/Attempt/Event闭合、Event Attempt completed、Effect committed/failed、无waiting defer；无法证明则保留占用。重新open保留故障与次数，只有后续实际成功路径才能resolved/close。
- 定向新增正反例覆盖通知正常/丢失、Incident状态更新中断、活跃Work/Attempt/Event、执行中Attempt、未决Effect、未知持有者，以及嵌套剧根与Field即剧根的真实NFO qualification。保留-1占位、错误相对路径拒绝及来源字节不变断言。
- 完整真实Host首轮Reset旅程FAIL：独立Operator另建WorkLifecycle，在线composition接线不覆盖它。补齐该生产入口后，同断言完整旅程PASS（47.7s）：真实媒体产生被阻塞Work→正式Runtime Stop/Reset→验证Work取消且Circuit重新open、未冒充resolved→注入通知中断→重建Host保持stopped→正式Resume→正常重采→真实媒体处理与Arca Commit→实际成功关闭Circuit。首轮失败日志与修正复验均保留。
- 当前小组合23 PASS及Host回归33 PASS；扩大定向、Service、完整架构门禁、Windows打包和Linux实际镜像资格继续。生产未部署、未新Reset、未手动改任何Incident或Candidate。
- 修复只约束新Candidate路径；既有不可变错误包不静默修补。高达/凡人歌及原五剧仍须以自然新包/实际执行结果验收，不能把这个隔离旅程称作全部生产媒体通过。


### 2026-10-26 01:40 发布前复核与最终候选重固

- ba75692d4生产副本资格通过：当前唯一recovering媒体Circuit由真实Foundation重新open，保留原LIBRA_MEDIA_FFMPEG_TIMEOUT原因与9次发生证据；全库235表中只有fx_circuit_states/fx_executor_incidents改变，另外233表逐行摘要一致，682收藏保持，FK/integrity通过。首次只读冷备开库因WAL数据库需要SHM报SQLITE_CANTOPEN，未执行修复；改为完整物理SQLite集合复制到可写隔离目录后通过，原冷备始终只读。
- 发布前自检发现另一个可复现边界：同一Circuit有多条非resolved Incident时，取消可能选中较旧错误。新增回归先FAIL，现按Circuit实际reason_code选择错误归属，同时将同scope仍recovering的Incident收回open；所有次数/错误/evidence不变。15项observer正反例PASS，包括Incident状态更新中断。
- 最终代码比ba75692d4只收紧该Foundation收尾条件，未改SourceRoot、UI、schema或依赖。ba的长门禁在开发目录执行，不符合独立固定checkout要求，且期间有以上开发修改，因此不计最终候选完整资格。最终候选使用独立固定验证checkout，长旅程可按完整注册用例名单分片，每个用例恰好覆盖一次，并运行同四项架构静态门禁；保留全部原始输出，不修改测试断言或产品时间限制。
- 生产已于17:16:12Z停止并正常退出；201文件冷备于17:17:53Z校验完成，清单SHA256 46d5b36ed903bbd82e42f1c78f6c66eaaa6cb841dbc112cc7ebad13d3a923fb7。目录/vol2/1000/shelfdeck_backups/pre-ba75692d4-20261026。尚未部署或再次Reset。


### 2026-10-26 02:07 最终副本与派生门禁复核（仍未部署）

- 固定e2cc23c81实际Linux镜像与Windows独立包各56 PASS；NAS冷备完整副本重新验证于18:05:46Z完成：examined1/reopened1，235表中仅fx_circuit_states、fx_executor_incidents改变，233表摘要完全一致；682收藏不变，完整Kernel integrity、全库FK及两张变更表写后integrity通过。22组保护基线包含682收藏、941 ended Run。
- 419普通文件首跑3261项：3231 PASS、4 FAIL、26 skip。两项来自SSOT行为条款误放物理表约束行且派生摘要漏同步；将行为放独立SSOT条款并生成source map，表/执行合同摘要保持，P2与source-map原断言通过。另整剧commit中断旅程在并行负载时等待已有任务收口超时，原用例独立复验PASS（102.4s）；Windows打包被验证checkout的node_modules junction触发EPERM，用实际依赖副本同用例PASS。原失败均保留，不改断言、timeout或产品门槛。长JAV/Series分片尚未结束，不提前称完整架构PASS。
- 静态门禁发现本轮Procurement新增node:path未声明，按已有包粒度仅给domains.procurement.persistence声明该纯路径工具依赖，未放宽跨Owner调用或文件读写权限；四项静态全部PASS，boundary正反例和合同/来源定向19 PASS。
- e78dbd82f相对e2cc23c81仅SSOT、来源摘要及依赖策略三个文件；运行JS、数据库Schema、测试均相同，继承上述真实副本/平台证据，最终镜像另作运行回归。e78dbd82f标准build/upload及独立SHA通过，tar SHA256 83dcf92ab2012e651fa3cb6034489e81d3660704392e9225712c29794cd3fadf；NAS加载镜像ID sha256:e3b2241a86f09f2a21adc459a25a38691349f6ee447d5ee4da8f299aec5952c4，正式deploy dry run已完成。生产仍c91停止，无Reset/手工改库/媒体改写。


### 2026-10-26 02:33 标准发布与真实执行验证

- 最终镜像 `markmahoro/shelfdeck:e78dbd82f`，source `e78dbd82fcb1d99fe76855f8d3951fdcc30b7ad6`；NAS image ID `sha256:e3b2241a86f09f2a21adc459a25a38691349f6ee447d5ee4da8f299aec5952c4`，tar SHA256 `83dcf92ab2012e651fa3cb6034489e81d3660704392e9225712c29794cd3fadf`。e2cc23c81与最终镜像内802个运行JS逐项SHA完全相同，清单digest `60eae5e7a604087254757fb1b62effde9ecddcc0bb18765cb190be1f419abf77`；最终版本仅补SSOT派生摘要和node:path依赖声明，未改变执行/表合同或UI。
- 固定checkout完整421测试文件覆盖：普通419文件首轮3231 PASS/4 FAIL/26 skip；JAV74、Series30全部PASS。四项原失败分别经SSOT来源修正、实际依赖副本打包、原整剧commit中断用例独立复验收口；最终四项静态全部PASS。组合3365项/3339 PASS/26 skip/0未解决失败；原e2报告中boundary/contracts FAIL保留，不能将其原始报告改写为PASS。最终候选定向19 PASS、实际Linux最终镜像56 PASS（含真实媒体和Reset恢复）、同运行代码Windows独立包56 PASS及独立打包用例PASS。Service681 PASS/29 skip属于ba候选，后续仅Foundation实际opening cause收紧另有15项正反例和完整架构覆盖，未伪称重跑最终Service全套。
- 生产17:16:12Z正式Stop后201文件冷备逐项SHA一致；最终部署前再次核对全部生产文件与该冷备完全一致。真实完整副本235表仅Circuit/Incident两表预期变化、233表完全一致，682收藏保留，Kernel全库integrity、FK及写后变更表integrity通过。没有再Reset、清库、改旧包或移动媒体。
- 标准build/upload、独立SHA、deploy dry run、readiness、apply完成；18:22:26.920Z容器启动，运行意图仍stopped。18:26:06Z恢复前22组历史逐行完全相等。正式Resume操作从18:26:14.688Z至18:26:15.819Z完成，running/normalSupplyAllowed=true/error=null。18:27:34及18:30:09Z再次检查22组原行missing=[]/changes=[]，682收藏、941 ended Run及其3221修订保留。
- Foundation先按终态证据重新open原恢复占用，真实媒体Work成功后于18:26:16.346Z将原Circuit closed，reason INVARIANT_RESTORED；没有人为伪造恢复成功。真实媒体生产Event成功数64→137→238→288，18:32:04Z仍closed；另US分析7、conformance1、Procurement观察3次成功。不存在active且无Run/token的异常Subject，FK正常。此为Event次数，不是新入藏影片数；采样时仍682收藏，没有新Arca Commit的验收声明。
- 7轮/42次健康、Runtime、Field、overview、Formation和collection请求全部成功；五个来源实际stat/opendir可读，JAV新完整扫描完成，其他新观察继续。原始Formation projection含225个行政退役投影及旧attention，必须按当前Subject/业务资格过滤，不能报为新孤儿或当前attention。18:32当前API summary为13进行中/1 attention/676 completed。
- 新attention是《地狱尖兵 (2022)》的 `libra.external_material.search@1`，18:29:41Z起连续三次 `P5_PROVIDER_TRANSPORT_FAILED` 后Work failed、Run frozen；诊断载荷为空，尚不能把原因认定为网络、凭据或Provider服务器错误。其他媒体仍继续、原Circuit仍closed。这是新失败，保留明确开放项，不能称全业务正常。唐顿庄园/暗算既有资料请求blocked继续开放。
- 《走向共和》当前Run仍为e2e307359a9883a1f335b32fee058bf23be68836de9b7676664b3aae315bae93，旧不可变包仍含错误sourceRoot。已向用户提出仅通过现有线上入口取消此一任务、保留历史并等待正常重采的明确确认；截至本记录未收到同意，未执行。其他历史包也不静默改写。修复后尚无新Series Candidate进入本次样本，故真实NFO资格回归PASS不等于自然重采生产验收完成。高达/凡人歌未强制采购。
- 首次监控辅助脚本经PowerShell DateTime转换丢失UTC偏移，错误把采样起点提前8小时，输出中的旧失败和16个旧Series包不得算作本次新增。已改为Node直接解析原JSON的UTC createdAt并拒绝不匹配边界；所有本节恢复后增量使用1792952774688。原错误样本保留用于审计，未据此改变生产。
- 容器RestartCount0/OOM=false，其他15个容器保持。运行负载CPU约328–337%、容器内存3.703→3.32 GiB，包含真实媒体/AI子进程；AbortSignal监听器警告2次，尚无泄漏结论。4K忙载吞吐仍按用户要求延后。已清理本轮被最终版本替代的三个NAS tar（逐个精确SHA和路径核验），备份/数据库/媒体不动；vol1恢复约8.3GiB可用。两个本地验证checkout删除被自动审批以blocked by policy拒绝，未执行，继续保留，不重试绕过。
- 既有24小时只读观察窗口继续，起点/截止不因这次发布延长；以本节新版本和UTC Resume边界为准，保留新增外部检索故障及旧包待确认，27个旧终态Plan证据不足不当作新启动阻断。未打Git release tag或批量关闭UAT。

本节ignored证据：`e78dbd82f-final-qualification.json`、`e78dbd82f-runtime-image-identity.json`、`e78dbd82f-linux.log`、`e2cc23c81-production-copy.log`、`e78dbd82f-deploy-apply.log`、`e78dbd82f-facts-exact.log`、`e78dbd82f-facts-preserve-final.log`、`e78dbd82f-production-resume.json`、`e78dbd82f-monitor.log`及带时间戳的progress/failures/host日志。恢复后已有新事实，禁止直接用冷备覆盖当前数据库。


### 2026-10-26 02:36 只读监控：两项新attention变化

- Runtime/health及六项API均成功，生产仍e78dbd82f，running/normalSupplyAllowed=true/error=null。相对18:32样本，媒体成功Event288→385，field_observation成功3→5，并出现deliverable_promotion、acceptance等成功步骤；原媒体Circuit持续closed/INVARIANT_RESTORED。收藏仍682，无新Arca Commit验收声明；FK检查空、active且缺Run/token异常为空。五来源stat/opendir均可读，JAV已完成本轮扫描，国产剧/剧集/媒体文件来源有新观察，其他扫描仍在进行，不能把页观察成功次数等同全部扫描完成。
- API summary为12进行中/3 attention。新进入需要处理的一条Violet Monroe影片是us_adult_actor_unmatched，候选为空，当前Run仍active，抽帧/embedding/聚类/参考比对均完成，需用户确认演员，不是Executor错误。唐顿庄园原有PLATFORM_INTEGRATION_HTTP_FAILED现收口为Run frozen，详细失败诊断不可用；本次增量查询没有新增该HTTP失败Attempt，不应报告为新网络故障。地狱尖兵三次外部检索失败仍是同一Event的已知失败。
- 走向共和单条取消确认仍待答复，本监控未执行取消或任何生产变更。容器RestartCount0/OOM=false、其他15容器运行；CPU338.17%，容器内存3.73GiB（前样本3.32），包含媒体/AI子进程。AbortSignal警告累计4次，尚无泄漏或功能故障证据，单纯增长不重复提醒同一警告。
- 修正自动化仍引用c91未修缺陷的过时提示，保留既有周期和原created_at=1792924332930；固定观察截止2026-10-26T10:32:12.930Z，不因更新或发布延长。此次通知仅针对attention实质变化/人工确认，既有地狱尖兵、旧包及监听器问题不重复报警。

证据位于ignored目录的heartbeat-20261025T1835-api.log/progress.json/sources.log/host.log/failures.json、两条任务详情JSON及本次带时间戳容器日志。未执行Reset、改库、配置变更、媒体操作或任务重试。


### 2026-10-26 02:47 获授权的《走向共和》单条线上取消

- 用户对明确问题答复“允许，仅处理《走向共和》这一条”。目标固定为Subject `libra-subject-ec2f99a679ef3c2cd6412b7eb2bbc547c9d58169`、旧Run `e2e307359a9883a1f335b32fee058bf23be68836de9b7676664b3aae315bae93`、Candidate `candidate-package-d25744b21f5687c1965fa43200bd18b01aa42889`。当前版本e78dbd82f正常running，未接受Handoff B。
- 第一次读取Run为active/revision2；取消前只读证据发现其已正常收口为frozen/revision3，重新读取最新version/digest后提交，没有绕过版本CAS。只调用现有POST `/v1/admin/formation/runs/{libraRunId}/actions/discard`，参数excludeSourceFiles=false，幂等键 `user-approved-republic-old-package-cancel-20261026-e78dbd82f`。没有调用Reset、材料排除、重试、重采命令或其他影片取消入口。
- 正式结果discarded，18:46:48.665Z提交，revision4；Decision `86ba05605b0d8708b23bb5b6d71079f40db842c17e21d5d0864f8c4ba462ba8f`，Receipt `b2166510e5b712b1ac230bfcf977b5a1879278d30ee9f142abef8382b27b1e76`，cleanupMemberCount0。复核取消state completed、Subject abandoned、Run discarded，全部原Run Work为succeeded/failed/cancelled，流水线token归零，原59个材料Control全部released且不再由Libra持有。释放状态合法，不等于已经产生新采购任务。
- 操作前后实际来源根 `/media/chn_series/走向共和 (2003)` 的182个文件相对路径/inode/size/mtimeNs清单完全一致；这是完整stat清单核对，不声称做过全部视频字节SHA。旧Candidate完整行摘要相同，错误冻结包留作原历史，不改写sourceRoot。
- 18:47:09Z保护核验：原22组记录missing=[]/changes=[]，682收藏保持，原941 ended Run及修订保持。总endedRuns943及其他新增正常事实不算原历史被改写；本次增加一个discard Decision/Receipt/Outcome，未覆盖旧行。详情UI显示“已取消整理任务”。
- 本次目标已收口，后续只等待正常观察/采购创建新的正确包，不保证第一时间选中，不强制调度。既有监控提示已更新为该单条取消完成，避免重复确认或重复执行，原24小时截止仍2026-10-26T10:32:12.930Z。新包自然验收仍开放，其他影片未获得本次取消授权。

ignored证据：`republic-cancel-prepared.json`、`republic-cancel-result.json`、`republic-cancel-before.json`、`republic-cancel-after.json`、对应status详情及`republic-cancel-history-preserve.log`；辅助脚本仅使用正式HTTP命令与统一SSH只读核验，未直接改生产数据库。


### 2026-10-26 03:20 用户状态询问：业务异常扩大，非全绿

- 新鲜API summary为9进行中/13 attention/676 completed。13条分为：5条Arca剧集共享资料、1条目标冲突、4条Libra资料失败（唐顿庄园两条独立任务、暗算、琅琊榜）、1条地狱尖兵外部检索失败、2条人工演员确认。演员确认是正常业务选择，不能把13条全部称Executor bug，也不能据服务running声称业务正常。
- 辐射、黑镜、棋士、沙丘：预言、越狱的Arca Status逐条确认reasonCode=PLATFORM_TMDB_EFFECT_CLASS_MISMATCH、blockedPhase=series_presentation；Foundation失败事件均为arca.series_presentation.source.observe@1。TMDB adapter的Observation/Artifact端口按operationId校验effect class，这属于本地操作类型校验拒绝，不应泛称网络失败；具体调用接线和修复尚未开展。前次artifactKind及恢复占用修复不能作为此路径已通过的证据。
- 庆余年Season 02三次stage失败均指向既存poster.jpg，CLEAN_ARCA_STAGE_TARGET_OCCUPIED；未替换或删文件。琅琊榜本轮触发SERIES_LOCAL_SOURCE_SCOPE_INVALID，须核对其旧冻结包，不能直接宣称新生成路径修复失效。新唐顿庄园有本轮三次HTTP_FAILED；没有具体HTTP状态证据。5次P8_ACCEPTANCE_CONTINUITY_BASIS_STALE所对应Work均最终succeeded，不报为仍未解决的五项故障。新增Procurement媒体probe失败尚需看后续状态，未据单次Attempt下最终结论。
- 原workspace_media_production Circuit仍closed/INVARIANT_RESTORED。恢复后媒体成功Event385→979，Procurement观察145、组包3等继续；Arca acceptance_commit成功6次表示Handoff接纳，不能当作新收藏Own。当前收藏仍682。五来源实际stat/opendir正常，本次完整扫描时间均在Resume后；FK检查空，无active缺Run/token异常，容器RestartCount0/OOM=false，内存约3.011GiB、CPU166%。Runtime running/normalSupplyAllowed=true/error=null，采样activity.state=draining且2个inFlight Event，未推断全局卡死或擅自重启。
- 已取消的走向共和自然生成新Candidate candidate-package-0334a510eadd34ec93ce07800c20899385873c21，publishedAt=1792955571530，sourceRoot=/media/chn_series/走向共和 (2003)，绝对路径正确。只证明正常重采和新包路径，尚无新Run完整上架验收。
- 本轮仅只读检查，未因用户状态问题擅自扩大修复/取消/Reset。新状态已告知用户，下一轮监控不将相同13条重复作为新增故障通知。

证据：ignored current-health-api.log、current-health-progress.json、current-health-formation.json、current-health-runtime.json、current-health-failures.json、current-health-sources.log及current-health-host.log。首次尝试从最新monitor文件读取时仍是18:36旧样本，未以该旧样本作当前统计；最终以19:20新鲜直接API为准。

### 2026-10-26 03:31 只读观察：首条真实入藏

- ABF-153的Arca正式收藏记录、Canonical Identity和On-deck Commit Receipt三者一致：shelf_entry_id=e80017fbdd902ed1781c076f7e877f965db8f6b635006dd931928ad9eb68ddb8，receipt_id=9ef674ecd7e5ddef06d0b95fcdc09ffe68274721c6170e2ee51ce231b6f5566f，committed_at_ms=1792956587799（19:29:47.799Z），inventory/deck revision均为1。这是正式Own证据，区别于先前仅Handoff接纳；未宣称全部媒体质量或Series验收通过。
- 收藏总数682→683，API分为current682/history1；工作台8进行中/13 attention。原13条attention未变化，不作为新增重复报警。媒体成功Event979→988，Arca on_deck_execution成功3→12，原Circuit仍closed；Runtime running/normalSupplyAllowed=true/error=null，activity已ready。
- 五来源stat/opendir可读，最新完整扫描均晚于Resume；无active缺Run/token异常，FK检查空。RestartCount0/OOM=false，容器内存3.011→2.601GiB、CPU129.14%。监听器警告累计144次，内存未持续增长，尚无泄漏结论，不重复报告为新故障。
- 本轮全程只读，未重试、取消、Reset、部署或改配置；固定观察截止仍为2026-10-26T10:32:12.930Z。ignored证据：heartbeat-20261025T1931-api.log、progress.json、sources.log、host.log、new-collections.json及带时间戳日志。

### 2026-10-26 13条attention逐项诊断及代码修复（尚未发布）

用户明确要求先查清五条剧集公共资料为何前次修过仍失败，再诊断处理其他异常。本次以19:39Z及后续新鲜API、只读SQLite、来源stat/NFO和配置中的实际Provider为依据，不复用旧错误码判定现状。ShelfDeck生产没有执行重试、取消、Reset、停机、部署、改库或媒体修改。

| 条目 | 现场根因及证据 | 当前处理边界 |
| --- | --- | --- |
| 辐射S01、黑镜S06、棋士S01、沙丘：预言S01、越狱S03（5） | arca.series_presentation.source.observe@1全部被PLATFORM_TMDB_EFFECT_CLASS_MISMATCH拒绝；Host无条件调用artifactPort，adapter要求Source走observationPort | 已修Host接线，不放宽adapter或Handle校验；生产五条仍待部署后线上重试/Commit验收 |
| 唐顿庄园S02、S06（2） | 各有E009，实际失败Plan冻结请求E009的episode_plot。NFO为第9集且plot为空；TMDB show/season为200，每季仅列E001–E008，两个E009精确接口为404 | 普通重试无效；保留本地编目或按TMDB编目方向待用户确认，不猜special映射、不借用别集剧情 |
| 暗算S01（1） | 本地34集；失败Plan精确请求E011的episode_number/episode_plot/episode_title/season_number。TMDB show/season200，第1季列E001–E010，E011–E020抽查均404 | 与唐顿同类编目差异，但独立实例；不以网络抖动或任意补剧情收口 |
| 琅琊榜S01（1） | 当前Run的Material Binding直接引用candidate-package-6f292fe7bb74bc281f6fab8aefb8e56ccdd7a366，发布时间15:49:27.230Z，早于18:26修复Resume；sourceRoot为media/chn_series/琅琊榜 (2015)，缺绝对路径首斜杠 | 新Run时间不能证明新包。读取端范围拒绝正确，不加入旧包修补/双读；仅走向共和的取消授权不能扩展到此片 |
| 庆余年S02（1） | 当前绑定10月12日11:11:33.364Z的candidate-package-e28c7053cd1b6c3d3d495cd581699d5ef8f9309d。现有poster.jpg为811218bytes，原Binding没有该位置或任何poster Reference；stage明确unknown poster | 拒绝覆盖正确。已Accepted，不能冒充Libra可取消任务或删图绕过；旧包处置需要精确线上方案，不再次全工作台Reset |
| 地狱尖兵（1） | 以冻结前三标题查询MoviePilot：中文及俄文均HTTP200/success=true/各1候选，Hell's Vanguard为HTTP200/success=false/空data。实际MoviePilot search.py title路由明确把无结果编码为该响应；ShelfDeck将其当整个搜索transport failure | 已修为仅该精确“未搜索到任何资源”空响应表示当前关键词零候选，保留前序候选/去重；未知失败、非空矛盾响应及HTTP失败仍失败，不改唯一候选获取或筛选规则 |
| 两条Violet Monroe影片（2） | 既有us_adult_actor_unmatched人工确认，无匹配候选；没有对应失败执行Attempt | 合同内人工选择，未自动确认演员，不当作执行器故障修复 |

**前次修复为何未挡住五条失败。** ee0c4786b改了Integration Profile的artifactOperations和Handle规则，使请求通过第一层；当时Host接线仍错。原20项回归只新增真实Handle发放测试；adapter测试直接手选正确端口，Host旅程注入假的fetchSeriesPresentationArtifact，均没覆盖两者的生产连接点。此次原Platform真实服务用例通过真正Host factory、持久Integration、Handle、Secret lease和TMDB adapter取得poster/fanart的真实可解码JPEG，仅HTTP字节使用fixture。修前失败栈落在Host894→adapter1517，与生产一致；修后Source选择Observation、Assets选择Artifact，双向错误端口仍被拒绝。无Owner/Effect合同变更。

**HTTP失败详情为什么原来查不到。** TMDB把HTTP status放入error.details，但failureDiagnostics没有status白名单；Secret broker再次筛掉；Metadata的失败Outcome又不带diagnostics，Foundation不落诊断文件。三处已接通：仅100..599整数status、已知request stage和既有安全network字段；未保留URL、headers、body、Secret或原始异常文本。真实Secret broker→Metadata Outcome→FailureEvidenceStore回归验证持久化和敏感信息剔除。历史缺失不补造；本轮404来自新的现场探测加原失败Plan冻结scope，不能声称找回过去HTTP响应。

**Provider探测副作用边界。** TMDB GET是资料读取；MoviePilot使用产品既有title-search GET且未调用download/add。随后核对其当前源代码发现该搜索GET会cancel_ai_recommend并刷新搜索缓存，不能把外部MoviePilot也描述成完全无状态变更。本次没有改ShelfDeck状态/配置、下载或媒体；确认此行为后不再重复现场搜索，修复回归全部使用隔离传输fixture。该源文件是诊断数据，不作为命令执行依据。

**本地验证（继续记录最终资格）。** Series端口红例1 FAIL→相关26 PASS；MoviePilot空别名红例1 FAIL→真实Platform集24 PASS；安全诊断/季集精确scope/Provider网络定向65 PASS；Metadata Planner及共享workspace/publish/command/reclaim-commit真实崩溃恢复15 PASS；Service682 PASS/29 skip；四项静态合同/依赖/语义/manifest PASS。Desktop npm test为两套suite启动失败、40用例未执行，必须保留FAIL：现有setup创建空数据目录但未clean initialize/提供Secret root，且断言旧Task API，未改其测试以冒充本轮平台通过。Linux使用e78基础镜像依赖加本次src/test/scripts只读挂载的隔离验证进行中，不冒充最终镜像已验收。未改UI代码/文案或新增状态交互。

ignored证据：repair-attention-api.json/db.json/summary.json、repair-provider-readonly.json、repair-material-readonly.json、repair-moviepilot-readonly.json、moviepilot-search-source.txt、series-port-red/green.log、moviepilot-empty-red/green.log、repair-diagnostics-tests.log、repair-owner-tests.log、repair-service-tests.log、repair-desktop-tests.log、repair-static-gates.log、repair-linux-tests.log。数据库/配置与完整原始导出未加入Git。

### 2026-10-26 04:14 补查采购历史查询及TS探测

- 19:15:38Z的P7_TRIAGE_UNIT_RECORD_DRIFT来自采购自动准入判断的readTechnicalPreparationFailures。最近24个有Structure的Work中，当前规则生成的两组Series可重建；三组旧sealed Run（6923924688b1582599e5e284e0a6424f6fce1507、bf2848b74ecbf82cb2ef64dd3de1cc2696ec25bf、e9562a86c405b91294ce9e37119a10636430f81c，均带procurement-run-前缀）的1/1/2个Candidate Work全部succeeded。当前reader仍无条件用active规则重建旧Structure，原规则authority f1635b88…与当前d5ca3641…不同，导致没有技术失败的历史挡住新一轮材料资格判断。不是本轮新Series结果漂移；旧冻结规则也不满足当前精确规则校验，不能加旧规则fallback。
- 修复只改变该查询的必要依赖：在精确Procurement Run下读取Candidate Work和终态Attempt，若无技术失败即返回已取得的Evidence失败映射，不读取无关Structure；真有Candidate失败仍通过原结构校验定位材料。没有变更Owner、自动重试资格、旧规则、历史行或材料处置。真实SQLite隔离回归覆盖全成功旧Structure不可解释、Evidence失败但无需Candidate结构、Candidate确实失败仍拒绝旧证据：修前2 FAIL，修后连同取消/正常重采/排除/Field退役15 PASS。现场独立诊断进程使用readonly SQLite+query_only和拒绝写SQL的reader，旧/新函数分别读相同三组事实：旧均报DRIFT，新均返回0技术失败，total_changes=0；未替换运行服务代码或调用写入入口。
- 采购媒体失败精确为《解除好友2：暗网》4,217,174,264bytes TS，19:20Z的Probe Attempt和当前重放均CLEAN_MEDIA_PROBE_EXECUTION。独立限时只读子进程捕获FFprobe退出signal=SIGSEGV、stdout/stderr均0；固定二进制版本N-66595-gc2b38619c0-static（2023）。最简format=duration,size与去掉show_data_hash仍崩溃，排除本次HTTP资料修复、网络和输出字节超限；不能据此断言源视频损坏。当前Dockerfile为保留HEVC VUI色彩事实特意固定该artifact，不能直接回退8.1或降低probe预算。独立媒体artifact资格仍开放，不纳入此次三项资料修复的已解决范围。
- 庆余年旧包线上recheck仅重新检查现有条件，不提供旧包新增海报Reference。核对发现scripts/formation-reset-nas.js仍封装旧物理删除CLI并带subject-ids，但Playbook §3.4已禁止它作为新管理入口或生产处置路径；新user-formation-reset的当前scope为完整未结束工作台，没有精确影片过滤。故本轮不调用旧CLI，也不冒称新版已支持安全单片Reset；该条已Accepted的线上处置仍待设计。
- 0438334a4标准构建完成：image markmahoro/shelfdeck:0438334a4，image ID sha256:d2799144489ab2db28a269c4b6b8647315099e05468ad73839ec0479c993548e，tar SHA256 e70fc9ccfae94be3acf2c0aa911edf81235718f39051519440d9d9f4ecdd1297。Linux隔离111 PASS；该实际镜像只挂测试/文档的两条真实Platform连接回归2 PASS/33按名称过滤skip；Windows独立package自身Node25.9.0及native依赖clean initialize→Host→health200→close通过。完整Architecture固定在043冻结checkout继续运行；该结果不覆盖随后采购查询增量，不记完整PASS。Desktop旧测试FAIL保留。没有上传/部署该候选。

新增ignored证据：repair-other-failures.json、repair-triage-readonly.json/log、repair-probe-readonly.json、triage-history-red/green.log、0438334a4-build.log/image-tests.log/windows-build.log/windows-smoke.log/architecture-tests.log。原始数据不入Git。

### 2026-10-26 04:31 固定Linux FFprobe缺陷及替代资格

- 为避免依赖用户影视，新增运行时测试通过当前FFmpeg生成1秒HEVC BT.709 MPEG-TS/Matroska，再调用实际配置的CleanMediaProbe。7d48b0c7c Linux镜像TS直接SIGSEGV、Matroska通过；Windows同一测试通过。这把故障缩小到固定Linux静态artifact，不是来源影片损坏、Libra规则或源目录权限。原Probe把进程崩溃作为技术失败而非not_media的负例继续保留。
- 从NAS仅只读提取原TS前8MiB到ignored本地诊断目录，未复制完整4.2GB影片或改媒体。原artifact及John Van Sickle官方7.0.2构建（下载MD5匹配官方记录）对同一片段均exit139；基础镜像8.1以及BtbN n8.1.3-24-g92611900bb能读TS。但BtbN候选执行原真实媒体测试为26 PASS/3 FAIL，三个源的HEVC VUI primaries/transfer变unknown，原本独立原始探测为BT.709；不得放宽验收或推断缺失色彩来接受它。
- BtbN archive源为FFmpeg官方download页链接的构建项目，固定autobuild-2026-10-25-13-00资产及GitHub发布SHA256 3300aa8c1d68e79e20d22117d3748a6121a49fe09b7eece3dcc38b84a1104e71一致；未安装到生产或产品镜像。相关来源：https://ffmpeg.org/download.html 、https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-25-13-00 、https://johnvansickle.com/ffmpeg/ 。这些下载只用于隔离资格，不作为采用结论。
- Ubuntu24.04签名软件源的ffmpeg包7:6.1.1-3ubuntu5所含/usr/bin/ffprobe读取现场TS样本成功，原29项媒体验收全部PASS（含三个真实HEVC色彩/源损坏/产物损坏场景）。第一次HTTP apt下载因archive连接失败未完成；改用同一官方源HTTPS后成功，未禁用签名/TLS检查。Docker候选固定该包，并把原/usr/local/bin/ffprobe位置链接到/usr/bin/ffprobe；原/usr/local/bin/ffmpeg、编码器、预算、配置路径及媒体准入标准不改。约206MB安装体积需接受为当前方案成本，不声称解决忙载吞吐。
- 另发现Compute自测忽略FFPROBE_PATH、总用npm默认Probe。新增“明确配置不存在的Probe不能发布成功自测”真实CPU红例，修前错误通过、修后正确失败；有正常Probe的完整CPU管线仍通过。只尊重已有环境配置，不增加配置项或备用Probe路径。Windows相关34项为32 PASS/2 skip（平台signal用例及外部live fixture），最终Linux镜像资格待完成。
- 7d48b0c7c中间候选标准构建：image ID sha256:d5b6a56f5552b77429f13c0764b2decf2c1c77e40464ee6dae3eaa165572d095，tar SHA256 3a200aba9a68ee9fd15feabef1ed9075a3364b043c396144a088495d1d83cbc5；镜像自身Source实际关键回归7 PASS，Windows独立包health200，采购增量Linux15 PASS。该中间候选不含Probe修复，不作为最终发布身份。043完整Architecture仍在固定checkout执行，采购/Probe增量单独资格，不把旧候选门禁结果直接改名。

新增ignored日志：probe-format-red.log、probe-format-windows.log、probe-config-red.log、probe-windows-green.log、probe-ts-{pinned,base,7.0.2,btbn-8.1}.log、probe-btbn-color-qualification.log、probe-ubuntu[-https]-qualification.log；私有8MiB样本及下载artifact不入Git。全程无新增生产数据操作。

### 2026-10-26 04:46 最终修复镜像资格与剩余处置

本轮实现由0438334a45a46e6084edb33a0d4db978bc3fd9e8（真实Host端口、空搜索及安全HTTP证据）、7d48b0c7c3ee3891ee27b5f39cda4bfda34ba11a（采购终态失败查询）、b2dac98fca63f45b673616c36b322a031f687c4b（Linux Probe及配置自测）组成。没有新增Schema、Owner权限、旧包兼容或UI交互。

- 最终镜像：`markmahoro/shelfdeck:b2dac98fc`，revision `b2dac98fca63f45b673616c36b322a031f687c4b`，image ID `sha256:336b657d165ff051f1db143092ee58d90b583d7bcd693c568cecf9910cc18e5f`；标准build-image.js产物tar 824.2MiB，独立Get-FileHash复核SHA256 `27171b1e74958d65cc4d7b8dbd7acf4a7f01e78bc8c0a7d0a566915cac22ed5d`。没有上传或部署。
- 原FFmpeg SHA256仍为`d840b4874847a49142dc86977db727758203360eca6cbb3eb8e7e8fd3d229d69`；新Probe SHA256为`272f6ebc634a63d9c8b4ca68e964119d980f25154e5aa2c35e5487da48e9a58f`。本轮不改变编码器或宣称解决4K吞吐。
- 最终Service：713 total / 684 PASS / 29 skip / 0 FAIL。实际最终Linux镜像只挂测试及文档、不覆盖src或二进制：103 total / 102 PASS / 1 skip / 0 FAIL，覆盖TS、ISO remux与产物解码、三条真实HEVC色彩与损坏负例、Compute明确Probe配置、采购失败查询、TMDB及MoviePilot连接。唯一skip为未配置外部live BDAV fixture；现场8MiB TS片段可读仅证明Probe不再崩溃，不等于整部影片入藏验收。
- Windows相关Probe/ISO/Compute为32 PASS / 2平台或外部fixture skip；最终Windows独立包自身Node25.9.0及native依赖初始化→Host→health200→close通过。最终Linux镜像network none、只读根、临时data的冷启动health200通过。四项静态边界/语义/manifest/合同全部PASS。Desktop既有两套启动失败、40用例未执行仍为FAIL，未把独立包smoke替代该套测试。
- 完整Architecture仍在固定0438334a4 checkout执行真实长旅程；采购与Probe增量另有相关回归及最终镜像资格，不能把043结果直接标成b2全量结果。最终结果在完成后追加。

20:38:36.142Z生产GET快照：running、normalSupplyAllowed=true、error=null；Formation 8进行中/14 attention（其completed数不是收藏Own数量）。相对最初13条多出一条Lia Ponce无演员候选人工确认，当前共三条此类确认，未自动代选。03:45保存的快照已经包含这第14条，不能把它说成此次20:38请求中新产生的故障。生产仍e78dbd82f，本轮没有重试、取消、Reset、部署或源文件改动；缺陷仍待上线验收。

20:37:24.498Z新的TMDB只读事实补充：暗算68670的S1听风10集、S2看风12集、S3捕风12集，另有S4第4季34集；唐顿Specials包含S00E02（2011圣诞特别篇，2011-12-25）及S00E11（2015圣诞特别篇大结局，2015-12-25），两者有剧情。它们是可供核对的资料候选，不证明本地S02E09/S06E09或暗算34集必然对应，不能自动借用剧情、改季集号或降低验收。用户关于保留本地编号/采用Provider编目的方向尚待答复。

旧包逐条处置边界：琅琊榜尚未Accepted，可在取得该条明确授权后使用既有线上取消，再等待正常采购生成正确绝对根的新包；不复用走向共和授权。庆余年S02已Accepted且旧包缺poster Reference，普通重试/recheck不能获得覆盖资格；当前SSOT与新管理入口仅定义整工作台Reset，禁止把旧physical-delete CLI的subject-ids当成新功能。该条保持开放；如需限定管理退役，必须先确认其范围合同、共享责任闭包与历史保护，不先改实现或执行全量Reset。

最终ignored证据：b2dac98fc-build.log、b2dac98fc-service-tests.log、b2dac98fc-image-qualification.log、b2dac98fc-static.log、b2dac98fc-windows-build.log、b2dac98fc-windows-smoke.log、b2dac98fc-linux-smoke.log、b2dac98fc-binary-identity.log、b2dac98fc-production-sample-probe.log、repair-series-numbering-readonly.json、repair-final-production-*。原始资料与媒体片段不入Git。

### 2026-10-26 04:55 庆余年旧包为何在Reset后首次进入Libra

不能止于“旧冻结包”结论。20:53–20:54Z只读溯源确认：Candidate e28c7053…与Offer 3409c049…于10月12日11:11:33.364Z发布/发出，原Offer直到10月25日15:55:49.548Z才形成首次accepted_resolution，并创建Subject 3e88f54c…；15:57:10.464Z创建本轮Run。没有旧Subject重启或旧Accepted Decision回卷。正式10月25日Reset预览/Receipt是225 Subject、0 pending Intake，该Offer及包不在退役范围。

`formation-retirement-plan.js`仅从工作台Subject、pre-deck token及非终态libra_intake Work发现pending process，再匹配其Offer；尚未进入Libra执行的Procurement open Delivery不在该范围。SSOT当前Administrative Formation Reset保持Procurement事实/Field Control，未定义任意待接纳旧Offer的退役资格。这是“清理整理工作台”与“重新形成所有采购包”之间的范围缺口，不能以普通重试或再次相同Reset证明解决，也不能擅自把旧physical-delete CLI当替代。

20:54:28.450Z现场open Delivery计数：Movie258、Series129、Western Adult689；129个Series中114个series_source_refs_json为NULL、15个非NULL。该数是排队包数，不是新增attention、影片数或必然失败数，NULL不等于已证明每包都会冲突。庆余年的精确因果已证明；其他待接纳包需要独立按当前输入要求识别，不能按发布日期直接判坏或删除。readonly/query_only查询total_changes=0，证据`repair-old-package-lineage.json`及原Reset Receipt均保留。

新增唯一Phase工作项PROCUREMENT-QUEUED-OFFER-RETIREMENT为Design：拟在停止态冻结未Accepted/Rejected的精确Offer及当前Selection，先证明无Handoff A接纳与未决执行，由现有Owner分别追加管理退役Receipt，仅释放精确Selection，保留Candidate/观察/Run与Procurement Field Control，迟到Offer消费同一退役事实；随后只允许正常观察重评，不强制采购。现有合同只定义已进入Libra pending Intake的该链路，向未准入队列扩展仍需用户确认；未实施或执行生产退役。本项也不自动解决已Accepted的庆余年单条处置。

### 2026-10-26 04:58 完整门禁首跑与定向收口

固定0438334a4 checkout的完整Architecture用时3447821ms，3367 total / 3338 PASS / 3 FAIL / 26 skip，原始日志与退出1保留。采购查询及Probe后续增量按前述定向/实际b2镜像资格单独证明，不把完整门禁改名为b2一次全绿。

1. `p4-contract-dispatcher`精确清单断言漏了已在生产e78dbd82f中声明的`domains.procurement.persistence -> node:path`（绝对路径修复所需）。只同步该断言，未扩展运行权限、删除负例或修改manifest；相关7项PASS。
2. `windows-service-package`在冻结checkout中复制junction型node_modules导致Windows EPERM；不是独立包Host失败。相同测试原断言在真实依赖目录运行，完整构建、native依赖、独立启动、API/模型/二进制及禁止覆盖/越界路径负例通过；不是仅复用前述health smoke。
3. `procurement-category-host`首跑在65个包/1081材料与两个sealed completed Run均已满足后，因存在一个failed Attempt违反零失败断言。原测试没有输出该Attempt明细且fixture已清理，不能声称确定为资源竞争或产品缺陷。原代码/原断言复验PASS；随后仅把同一零失败断言补成输出最多10条event_id/failure_code/evidence_digest，二次运行仍PASS，未放宽任何成功/材料守恒条件。根因证据不足作为本次资格限制保留，未来复现可直接定位。

新增定向日志：`final-architecture-rechecks.log`（采购及Windows2 PASS）、`final-boundary-expectation.log`（7 PASS）、`final-category-diagnostic-check.log`（1 PASS）。此次最终追加仅涉及测试和记录，b2dac98fc运行源码、Schema、依赖及镜像字节不变。Desktop旧套件启动失败限制继续保留。原24小时监控截止不变，自动化基线已同步为生产14 attention和旧队列诊断，仍只读且禁止自动实施修复。

### 2026-10-26 09:05 只读监控增量：16 attention及真实入藏继续

- 01:04Z生产仍e78dbd82f，running/normalSupplyAllowed=true/error=null；API6进行中/16 attention。相对23:59Z的14新增两条：Subject 12735f12…《进击的巨人：编年史 (2020)》，Run eb85d75b…已frozen；Subject 6d8b4b52…为western_adult演员无候选确认，当前此类共4条，不自动代选。
- 新影片精确Event `libra-external-search-event-0b88c9bf6fd3ae509d9651cb368c9dffb4a0e51a`的3个Attempt均`P5_PROVIDER_TRANSPORT_FAILED`，Work已failed；三次Evidence同digest ad1a500b…且diagnostics为空。只能确认外部素材检索失败，不能据同错误码认定MoviePilot空别名缺陷或实际网络故障。未再次调用有缓存/AI推荐副作用的外部搜索接口；该条留给修复工作承接，未生产重试。
- 旧转码Event 66c8d660…已succeeded。23:59Z后取得4个新的Arca On-deck Commit Receipt，1条tmdb_movie(provider_key299054)、3条internal_identity；收藏总数684→688（API current687/history1）。01:04Z另有接纳强制媒体验收及新转码executing；新FFmpeg输出5秒增加4,456,448bytes，证明执行推进但不宣称全部任务完成或4K吞吐达标。走向共和仍未见本轮入藏证明。
- 五来源stat/opendir均可读，最新完整扫描仍为Resume后的既有成功记录；无active且无Run/token异常，Circuit closed。容器RestartCount0/OOM=false；内存2.433GiB，CPU277.74%，AbortSignal监听器警告仍144次，无新增日志码。只读/query_only且total_changes=0，libra_runs及arca_shelf_entries限定FK为空。前次全量进展查询未返回完整结果后采用有界核验，本次不宣称全表FK或全历史再次逐行验证。
- ignored证据：heartbeat-20261026T0103-{api,host,sources,log-summary,db,transcode,new-failures}及正式API快照。诊断脚本首轮引用不存在的Event updated_at_ms列被SQLite拒绝，修为只读state后通过；它不是生产服务异常。本次无部署、Reset、取消、重试或媒体改动；既有截止2026-10-26T10:32:12.930Z不变。

### 2026-10-26 10:10 只读监控增量：旧采购包继续进入工作台

- 02:06Z API4进行中/19 attention（较01:04Z新增3条）、收藏690（current689/history1，较前次总数增2）。Runtime仍e78dbd82f running、normalSupplyAllowed=true/error=null；候选b2dac98fc未部署。
- 《凡人歌》Subject a4289c56…于01:14:19.555Z新建，Run 68016b13…frozen，`SERIES_LOCAL_SOURCE_SCOPE_INVALID`。其实际绑定Candidate 6385daae…于10月25日15:49:27.026Z发布，sourceRoot仍`media/chn_series/凡人歌 (2024)`，早于18:26Z修复后的Resume；当前绑定已包含Season 01/poster.jpg。此次阻塞是旧包绝对根缺失，不是“Season海报引用修复仍失效”，也不是旧UI残留；原凡人歌生产验收继续开放。未取消、重采或重试。
- 《边水往事》Subject 40b33bb4…于01:06:35.512Z创建，来源Candidate 27ebce11…发布于10月12日11:14:41.783Z，seriesSourceRefs为NULL、当前poster绑定为空。Arca On-deck 2e7f730d…的三次stage失败均`CLEAN_ARCA_STAGE_TARGET_OCCUPIED`，精确冲突为`Season 01/poster.jpg`，已Accepted、retryAvailable=false/canRecheck=true。这是已知旧队列范围问题的又一现场实例，不以重复recheck取得覆盖资格。
- 另一新增Subject b032bb07…，Run 42baf129…frozen。正式Formation展示转码步骤完成，因质量保护下无法达到1GiB上限而保留较优超限成品、等待接受体积瑕疵；未出现新的FFmpeg执行失败码。该条按业务待决记录，不代替用户接受或降低上限。
- 原五条TMDB端口失败及两条外部检索失败仍未解决。五来源可读，最新扫描仍既有Resume后完整观察；无active且无Run/token异常，限定libra_runs/arca_shelf_entries FK为空、Circuit closed。新转码5.145秒输出增加3,932,160bytes；不宣称所有业务正常或4K吞吐验收。
- 容器inspect仍Restart0/OOM=false，日志警告144次未增加。本轮宽范围host helper在docker stats阶段停滞，精确终止的仅本机该只读探测Node进程；再次有界docker stats在10秒内未返回，未重启Docker或服务。容器内cgroup只读2秒采样CPU91.97%、memory.current 4,119,040,000bytes、inactive_file 2,125,967,360bytes，差值约1.856GiB，memory.events所有OOM项为0；该数为独立采样，不冒充同一Docker stats时间序列或整体性能结论。
- ignored证据：heartbeat-20261026T0206-{api,db,sources,host,log-summary,transcode,package-lineage}、heartbeat-bounded-host-*、heartbeat-cgroup-resources-*；无生产写入，未扩大任务处置范围，原24小时截止不变。

### 2026-10-26 11:02 只读监控：新增第二条体积瑕疵待决

03:01Z仍e78dbd82f running/normalSupplyAllowed=true/error=null，API3进行中/20 attention，收藏690（current689/history1）。新增Subject66d32240…/Run414b263e…已frozen，正式Formation显示转码100%完成，但质量保护下不能满足1GiB，保留较优超限成品并等待用户决定；该类现2条，未接受瑕疵或改配置。失败Attempt按码计数全部与02:06Z相同，不把业务待决报成FFmpeg失败。另一转码Event39a1b801…/Runb773088f…executing，5.012秒输出增长4,718,592bytes。

五来源可读，最新扫描时间未变；无active且无Run/token异常，限定运行/收藏表FK为空，Circuit closed、Restart0/OOM=false。警告144次未增加；cgroup采样CPU177.92%、memory.current减inactive_file约1.654GiB、OOM项0。docker stats在10秒预算内再次无结果，已自动终止探测，未修改服务。ignored证据heartbeat-20261026T0301-*与API快照1792983695103；本次无部署/重试/取消/Reset，原截止不变。


### 2026-10-26 12:05 只读监控：新增三条资料异常

2026-10-26 12:05（Asia/Shanghai）只读监控：生产仍e78dbd82f，2进行中/23 attention，收藏690。新增继承之战、飞天大盗两条Arca公共资料端口错误（该类由5增至7），以及风骚律师Libra海报下载LIBRA_ARTIFACT_FETCH_FAILED（diagnostics为空，根因未定）。候选b2未部署，不能将新增风骚律师失败认定为已修端口错误。另一转码5秒输出增长3,932,160bytes，五来源可读、扫描时间未变、无新孤儿/重启/OOM，Circuit closed、警告144；cgroup扣除inactive_file约1.982GiB。仅运行/收藏表有界FK检查，无生产变更，原监控截止不变。

正式API快照1792987538273：风骚律师Subject8bb564d5…/Runbef5f8eb…frozen，海报步骤blocked，Event0d27640e…诊断为空；继承之战Subject8b078467…和飞天大盗Subjectf2c33049…均Arca series_presentation失败。失败Attempt总计端口错误7、素材下载1，其余各码计数未变。新转码Runec3c7b45…执行中。docker stats再次预算内无结果，探测自动终止，未重启服务。证据保存在ignored heartbeat-20261026T0405-*及observations样本；本次不诊断外部有副作用搜索、不重试、不代替修复线程。


## 2026-10-27 季集确认与冷态恢复增量（开发检查点）

2026-10-27 季集映射与冷态 Reset 增量（开发中，未发布）：已新增 Libra 持久 Review / Mapping Intent / head，以及新 Run 冻结 mapping ref；当前目标 239 表、168 路由。真实 Host 隔离旅程完成显式跨 Provider Season 0/2 选择 → 新 Run → 真实媒体处理 → 一次正式 On-deck Commit，本地 S01E01/E02 与 NFO 编号保持，完整 FK/integrity 通过。首跑路由计数不同步失败、第二/三跑因新身份证据改变完整摘要而失效，均保留；已分离原确认 identityDigest 和精确身份范围 identityScopeDigest，未修改旧身份事实。映射模型/原生 SQLite/执行适用性 16 PASS，Web 交互 5 PASS，Run Admission 既有回归 16 PASS；真实 Handle/Secret/TMDB 候选查询定向已通过，最新增量仍须全量复验。UI 初版尚未完成固定候选浏览器及 UI 负责人验收。唐顿特别篇与暗算 34 集的生产逐项资料核实、两项独立失败诊断、生产新副本/共享剧混合 Reset 验证、最终镜像/完整架构门禁仍开放。

Reset 持久 pending intent 与 workflow 已改为同一次原子写入，完成 Receipt 先于清除 pending；新 Reset 不会误认前一代 complete fence。Windows 中断与管理入口定向 11 PASS；Linux 第二轮 13 PASS / 1 FAIL（容器加载了 startup 修正前源码），修正后原失败定向 1 PASS / 5 filtered skip；这是本地源码覆盖旧依赖镜像，不能替代最终镜像资格。完整旧版本 Series Routing/metadata 批次 60 PASS（约 15 分钟）发生在最新映射接入之前，不能当作最终候选全量验收。生产本轮未部署、未 Reset、未删除备份；观察保持已取消，最终生产动作仍须具体方案授权。

证据位于本机忽略目录 `.codex/formation-diagnosis-20261023/`：`episode-metadata-host-journey-first/second/third/fourth.log`、`episode-metadata-identity-scope-first/second.log`、`episode-metadata-web-first.log`、`episode-metadata-admission-second.log`、`episode-metadata-execution-first.log`、`reset-atomic-workflow-first/second/third.log`、`reset-linux-supervisor-first/second/third.log`。不得只保留最后一次 PASS。


### 2026-10-27 生产 691 收藏副本、混合共享剧与首次冷态入口

2026-10-27 冷态首次升级与生产副本检查点（开发中、未发布）：新生产只读快照包含 691 个正式 Commit，SHA256 `1789531be27e6b68079f94cf29ad16893f6c44541af75f5208fd01f7c85ae8bd`，5,126,340,608 bytes。239 表隔离保留库保留 1,332,064 行、移除 1,962,627 行，685 个保留 Subject 结束旧准入；691 个 Commit/Package、十组保护摘要、两组共享剧资料及两个精确资料依赖通过 Owner Reader、完整 FK/integrity 核验（约 1,055 秒）。这是隔离副本，不是生产 Reset，也不是完整恢复备份。

真实混合 Series 旅程证明一季 Commit/另一季 Accepted 未 Commit 时，保留前者及共享资料、清除后者责任，10 个来源/正式/共享文件字节保持。真实资料失败后 frozen Run 的显式跨 Provider Season 0/2 映射、重新执行与正式 Commit 旅程通过；本地 S01E01/E02 编号保持。四视口 Reset/映射浏览器最新 32 PASS；早期窄屏横向溢出 FAIL、修正及截图均保留，尚非固定版本 UI 负责人验收。

首次 schema 升级不能先启动新业务 Host 再 Reset，已新增显式部署关闭证明与冷态管理入口：旧 235 表仅开放原 Runtime 预检/确认，独立切换 239 表后重开 stopped；真实 SQLite 入口及源变化拒绝 2 PASS，组合 14 项首跑 13 PASS/1 FAIL（父根挂载重叠遗漏），修正后部署约束 4 PASS。标准 deploy 新模式和 Windows/Docker 打包接线仍须完整资格，生产未执行。当前完整 Architecture 长跑基于变化中的开发树，只作为开发诊断；最终长门禁必须固定 commit/独立 checkout，不能挪用。

进击的巨人三次原始 MoviePilot 日志均对应首标题“未搜索到资源”，支持零候选被误报为技术失败的独立原因；没有完整 HTTP 响应，不能声称其他别名必有候选。风骚律师旧海报失败的底层 HTTP 状态仍不可恢复；已补 TMDB image HTTP stage/status 诊断贯穿真实 Host/Handle/Secret 的 503 红绿例，不回填历史或宣称其具体网络根因已证实。生产未部署、Reset、删除备份或修改媒体，自动观察保持取消。

证据文件位于忽略目录 `.codex/formation-diagnosis-20261023/`：`reset-generation-qualified-production-01-copy.json` / `-verify.json`、`reset-production-source-20261027-proof.json`；`series-mixed-reset-first.log`、`episode-mapping-frozen-host-second.log`、`episode-mapping-omission-first.log`、`tmdb-image-http-diagnostics-first.log` / `-second.log`、`reset-mapping-browser-fourth.log`、`reset-bootstrap-first.log` / `-second.log`、`reset-bootstrap-deploy-third.log` / `-fourth.log`。完整 Service 第九轮 839 项（810 PASS/29 skip）、Web 第四轮 271 PASS 发生在本节后续 Bootstrap/诊断增量之前，不作为最终资格。


### 2026-10-27 固定候选、UI 焦点复验与 NAS 镜像层数失败

2026-10-27 固定候选资格进行中：af525a728c Windows 独立包 PASS；实际 Linux 镜像通过新 Reset 核心、真实重新观察/新包/FFmpeg/Commit、独立收藏及资料 404 后显式映射旅程。镜像测试首跑混入仓库侧脚本和旧物理删除 CLI 的环境失败，保留原日志，不计为全量 Linux PASS。UI 负责人对 af525 的 pending 焦点问题判 FAIL；c2c07084f 修复后本任务四视口 40 PASS、负责人补充 16 PASS/定向 Web 5 PASS，具体版本 UI 已通过。完整架构门禁仍在固定 af525 独立 checkout 运行，后续仅 UI/镜像构建变化。

NAS 隔离装载 c2 镜像时遇到 `max depth exceeded`：镜像 127 层，本机 containerd 可运行不代表 NAS overlay2 可装载。标准构建改为合并连续 COPY 文件且不跨 RUN/多阶段边界，导出前增加 96 层预算，定向 4 PASS；新镜像资格尚未完成。691 收藏保留库在本机 Docker 因真实挂载身份不同被正确拒绝，不能当作生产启动通过。隔离副本已准备于 /vol2；生产容器未替换、未 Stop/Reset/Resume。

容量：19:28Z /vol1 可用 8,247,119,872 bytes，/vol2 可用 371,751,084,032 bytes；两个重复 DB 候选共 9,229,676,544 bytes，逐字节 SHA 与保留副本相同，尚未获准或执行删除。pre-ba75692d4 恢复基线 201 文件重新 SHA 校验通过；这是旧基线，不替代本轮停机后完整备份。

证据：`fixed-af525a728c-windows-package-first.log`；Linux Reset 首跑115项/114PASS/1仓库脚本缺失，扩展批次170项/145PASS/25旧CLI固定transcode路径约束失败，`fixed-af525a728c-linux-reset-first.log`/`-second.log`。实际镜像 Host 批次17项/16PASS/1仓库scope-guard未打包，含两个真实媒体旅程和真实Handle/Secret/HTTP503诊断链；`fixed-af525a728c-linux-host-first.log`。实际镜像 Series 两旅程2PASS/29按名称未选，`fixed-af525a728c-linux-series-first.log`。c2 Provider/Handle/失败诊断补充31PASS，`fixed-c2c07084f-linux-integration-first.log`。这些是分项覆盖，不能汇总冒称全量门禁通过。

UI证据保存在 `E:/my_project/helix-git-consolidation-20261008/formation-ui-review-c2c07084f-20261027/owner-review.json`；原af525负责人40通过/8焦点失败保留在对应af525目录。c2比af525仅两个Web文件变化，后端及其长门禁输入一致。


### 2026-10-27 NAS 停止态资格、摘要内存与发布前基线

45b5bfe82 标准镜像 28 层，tar SHA256 `413eb3960a18284b6bf57ac4332fd8ea2c2fdcdf8818efdd4c78a26f51c6ff84`，NAS Config image `sha256:8547f7add2c0003de6c30497a048668c0a841e5fd7d6aec17e469553ed5866e4`。Docker Desktop index identity 与 NAS Config identity 不同，已按校验 tar 的 manifest Config 核对；最初拿 index 比较失败保留。2870 个运行文件与 c2 字节一致，9 个 Web 资源匹配负责人验收；45b 适用 UI 复核通过。NAS 独立 691 保留库三次停止态启动、API 与完整 FK/integrity 通过（180s/29s/29s）；生产容器 ID、image、StartedAt、restart 未变。隔离目录、备份副本及镜像缓存有新增写入，不表述为 NAS 零修改。

混合 Series 完整旅程增加独立 Operator：一季已 Commit、一季 Accepted 未 Commit，预检/确认/新库切换/清理、两次 stopped 重开与保留摘要核验；来源/正式/共享 10 文件不变、token 清空。Windows 1 PASS、45b 实际 Linux 1 PASS/29 名称未选；见 `mixed-series-full-operator-first.log` / `-linux-first.log`。

NAS 启动后的全量收藏摘要校验先后以隔离 1536MiB、2560MiB/1536MiB V8 heap 失败（exit 134）。定位十组大表用 all()+JSON复制+canonical长字符串造成内存膨胀；不能仅靠提高限制称解决。改为逐行同一canonical数组字节流，保留 BigInt 编码及顺序；48MiB heap 的 30000 行压力和原摘要等价回归通过。完整 691 副本重验待最终镜像，不提前宣称 PASS。两个失败日志为 `nas-after-start-verify-first.log` / `-second.log`。

发布前基线缺口：原标准 fresh-reset 分支会先覆盖 Compose/secret，再做关闭证明。已改为退出并移除旧容器、只读备份数据及转码Workspace和原配置、逐文件校验之后才发布配置。冷态 Bootstrap 绑定备份回执及原 DB 摘要；Reset 确认后的备份另行保留。定向备份/部署顺序/内存 10 PASS，真实冷态 Supervisor 9 PASS，后续组合门禁继续。旧 pre-ba75692d4 的 201 文件 SHA PASS 仅覆盖旧 data 备份，不能称当前包含转码与外部 secret.env 的完整恢复基线。

当前 /vol1 容量不足以直接开始最坏峰值作业；两个重复数据库的精确删除候选合计 9,229,676,544 bytes 尚未授权。fuser 因权限无法完整证明无其他宿主进程打开文件，仍为删除前阻断项。没有全局 prune 或按名称清理其他目录。完整架构门禁继续运行于 af525 独立 checkout，本段新增 Operator/验证工具不冒充该固定提交已覆盖。


2026-10-27 20:13Z 资格补充：e6c817319 实际 NAS 镜像对 691 收藏的启动后摘要复核 PASS；691 Commit/Package、十组保护表、两组共享资料、两个 metadata 依赖及完整 FK/integrity 均通过，与最初本地验证的 protections/ownershipDigest/packageReadDigest/shared/controls 完全相同。峰值 RSS 166576 KiB，V8 heap 上限 768MiB；证明流式校验保留原合同且消除两次大表物化内存失败。`nas-e6-verification-first.log`、`nas-e6-after-start-verification.json` 保留证据。

Service 固定 e6 849 项：820 PASS/29 skip/0 FAIL；新增实际 Linux 23 PASS，Windows 组合24 PASS。Windows 独立包补齐新备份脚本后1 PASS。静态门禁首跑3 PASS/1 SSOT源文本摘要漂移；materializer仅更新sourceDocumentDigest，8项合同回归通过，不修改基线计数或Owner合同。e6适用UI负责人核验通过，后续仅生成摘要/打包清单及证据变化仍需最终身份核对。固定af525完整Architecture仍未结束。

容量精确清单及按卷逻辑字节峰值见 [发布审查材料](FRESH_RESET_RELEASE_REVIEW_20261027.md)。2026-10-26T20:15:08.684Z采样 /vol1 可用7,382,339,584 bytes，保守要求15,233,318,624；/vol2可用367,174,250,496，保守要求132,445,032,992。未提前计入清理收益。宿主fd只读补查仍受EACCES限制，删除前可见性阻断未解除。生产未变。


### 2026-10-27 生产授权、固定候选与容量整理（执行中）

用户明确授权直接部署、执行新 Reset、部署前清理 vol1，随后追加完成后恢复正常生产；这取代此前最终保持停止的交付要求。恢复前仍须完成切换/清理回执、收藏依赖和文件保护核验，失败保持停止；不重新创建自动观察。

固定候选101ce2fe04a0991ded2ba705d66f9d56a8664dba：Architecture428文件、3408项（3382 PASS/26 skip/0 FAIL），四项静态全通过；Service850（821 PASS/29 skip/0 FAIL），Windows独立包1 PASS、实际Linux增量17 PASS，具体版本UI负责人PASS。NAS私有文件实际副本27,438,411,307 bytes：中断3项后续跑删除868项、释放27,436,291,513逻辑字节、保留4个Arca Workspace共2,119,794 bytes；重复回放相同，原生产文件manifest摘要不变。首次Host资格总900秒预算内两次API/FK/integrity通过、第三次被预算中断；复制I/O结束后1800秒批次三次均通过（33s/29s/27s）。691 Commit/Package/十组保护表/两组共享资料与metadata依赖复核PASS，峰值164776KiB。原失败均保留。

21:19:28.760Z 原生产正式Stop完成，revision30、quiesced、所有inFlight0。停止前仍e78dbd82f，容器c114f0b088f7…、StartedAt2026-10-25T18:22:26.920343521Z、Restart0。容量整理仅ShelfDeck：两份已列明重复备份SHA重验一致后精确清除9,229,676,544逻辑字节，保留相同字节副本及manifest；实际可用先增至11.96GB，仍不足峰值要求。额外两个诊断源库SHA不同，重复删除断言拒绝且没有删除。随后将独立历史SQLite文件及WAL/SHM完整转存至vol2作业树operations/relocated-diagnostics-v2，六文件共9,229,742,080 bytes；两份主库SHA分别79bc22f714ada687490b595a6ab16521c5f334f23c43fee893aa0ea4fd98edfb、306f76a315cce5713e35d45edc1fc6946964e18fee9278c54958bcc357708e64，来源前后和副本一致后才移除vol1原文件。manifest保留原处，精确替代路径在diagnostic-relocation-receipt-v2.json。没有全局prune或其他应用清理。vol1实际可用21,192,990,720，vol2可用355,080,953,856；要求15,233,324,768/132,445,037,700 bytes，标准发布继续独立核验。

宿主fd探测始终有EACCES，不能宣称完整证明无打开文件；最终删除依据是明确用途、未被容器或当前资格任务引用、前后稳定身份与保留的逐字节副本，回执保留此局限。第一个清理容器因drop-all缺少目标目录写入能力在任何删除前失败；限于精确挂载增加DAC_OVERRIDE后成功，未改宿主权限。第二次清理已完成后脚本尾部CRLF导致shell127，后续只核对已完成receipt和文件现实，没有再次删除。两份诊断源快照并非重复的失败，以及首次转存因发现伴随文件拒绝，均保存，第二次按完整SQLite物理集合转存。

来源/正式文件stat基线：691收藏、6570库存路径、五来源根、39317条路径，其中91条原已缺失，其他stat错误0。摘要f61a5951a192b7e99cdd395fd01da078de84ca06e1d94d4d0578c9397e2929c5；这是路径身份/大小/时间/类型保护，不是全体媒体内容SHA。完整旧代际冷备仍由标准部署控制器在关闭旧容器后完成，不能用这个stat清单代替恢复备份。

标准deploy首次使用了遗漏images/的tar路径，在ls阶段拒绝，未停止容器或发布配置；按标准upload回执修正精确路径并重新dry-run。21:33Z旧容器已干净退出并移除，独立完整冷备正在运行；新配置尚未发布、未执行Reset/Resume。本地原始证据位于ignored formation-diagnosis-20261023/production-101ce2fe0-*，NAS作业树/vol2/1000/shelfdeck_backups/fresh-reset-final-20261027。

## 2026-10-27 People 闭包纠正资格与最终反馈修正

7fee9650865e35f0bacfbbfd2540ddba3b043980 的 Service 862项（833 PASS/29 skip）、实际Linux镜像19项、NAS生产停止态一致副本资格均通过。NAS只补回18条原登记，其余238表及Registry原有行摘要不变；18图与18特征经真实People端口可读。proofDigest=8d115b9e4c34f054821262f04800a075cacd51601f29997962c259aa221ffd54。此为隔离副本，不是生产补回。

该候选完整Architecture首跑FAIL：两项精确公共接口清单没有登记新增的People Owner依赖描述出口；其余全部测试及四项静态检查通过。现同步两个清单，保留原失败日志与报告。不是删除断言或开放跨Owner实现访问。UI负责人对7fee判FAIL（一项P2，两种People阻断原因×四视口）；原12安全/交互PASS、8反馈FAIL不改写。修正真实GET预检阶段的原因文案，确认后的POST和执行失败保持实际阶段；通用Owner错误不被误称People。预检在构建副本前先核验People必需登记与真实字节，给出Owner明确错误。

新增定向首跑31 PASS/1 FAIL为测试清理顺序：fixture先删目录，Host尚未关闭导致Windows EPERM；改为finally先关闭Host。功能断言当时均通过，首跑日志保留。新精确候选须重新完成定向、完整门禁、平台及UI资格，之后才通过标准部署包装作停止态完整冷备、18条依赖纠正和恢复供给。生产仍b0/revision34/stopped，未再次Reset。


## 2026-10-27 People纠正发布、恢复供给与残余边界

生产Runtime镜像为markmahoro/shelfdeck:6ad98f1f6，git6ad98f1f60f9d7717414caf379ae3fcbd72da394，tar864245248字节/SHA256 c2c1f834813881899706f63bec425211c14c498318ace0dd084773a4656054f2，NAS image sha256:d07b930e5804b1528a43eb2688992996b8eb4087b4397a1fed98c2376759db56，容器1df9bc654123116f8c908fbba24569720cd8fcac6e9529875d49b0dbffe3f19d。固定clean checkout完整Architecture428文件/3408项，3382PASS/26skip/0FAIL，四项静态通过；Service865/836PASS/29skip/0FAIL，实际Linux25PASS、Windows独立包及原生Host停止/预检反馈通过。UI负责人具体版本36浏览器、28组镜像HTTP、4项原生阶段复验通过，176 Web inputs/9页面资源保持。7fee完整门禁2项出口清单FAIL及UI一项P2 FAIL均保留。Service首轮因固定worktree缺少tools/ssh2依赖导致2项加载失败（856总数），npm ci后复验865项全过；Linux首轮临时卷仅256MiB，触发原有256MiB保留预算，14PASS/11FAIL，改用2GiB隔离临时卷后25PASS，不放宽预算。

标准deploy完成Stop34闭合证明、旧容器移除、独占数据挂载、完整当前冷备后执行精确18登记纠正。新冷备228文件/7383159971字节，inventoryDigest=a6ffb72298299ff4c29bbfad0afd7a0a5b7991270783ded52b6ed9ab0033f695，verificationDigest=0d2e8cb5e3d67cdbc4aea417ef6f561d520a60064a7c3bf3ec0d5b359ae5e2e7，receiptDigest=d7dcc34a0b992d1f45d20635a033454473a24c2546fdfec377da6bdecb3c7bdf。目录/vol2/1000/shelfdeck_backups/people-reference-recovery-20261027；未递归备份旧档案。原Reset32.69GB档案和当前恢复后新增事实均保留。

纠正operation=be52dca360b2bbdf115ad62ea8211551de92a2eb9855fb2c67f9faa06ebdeeda，receiptDigest=f5f399257fa52b6c5b3d8226f3eb8ca42d1030dbb405d841033371d569f880d4，proofDigest=54f72049432478c2b00f63807ef092ddf992c862f6e89c19ecd628cfe448f55d。current主库SHA=e3532a3a81edfe2bbc012868e8466924238dabdf830cb0f2980b9b56434838ee，纠正候选SHA=0444c68a56b42091ddeed5cf2ad53c77951fec1b477e86fcf4cb6e513ea91ebf。只补18条原active embedding登记，其他238表及Registry原有行摘要相同；原18图/18特征经真实端口可读，239表FK/integrity通过；保持数据库代际13fcd0d320da5dcc0d02040fc22461b11afbb05729db089d9bacba4fc205711c及原Reset marker/完成回执不变，另记纠正Receipt。没有再次Reset、裸改运行库、重新计算特征、恢复旧在途Control或历史包兼容分支。

独立复核首跑误用了纯Reset后置条件verifyRetainedControls，因本来必须保留的3条新Run及Procurement当前Control而得到RESET_VERIFY_UNCOMMITTED_CONTROL_RETAINED。未修改数据来通过此检查，未改原验证器。随后使用适合当前生命周期的只读审计：691收藏/691 Commit、10组保护表与原Reset前摘要相同，36 People Artifact可读、239表FK/integrity通过；三个Libra Control精确属于这三条当前冻结Run。原691 Package/Commit逐条重建资格来自本次最初Reset核验，本次未冒称重跑；纠正工具另证238表和Registry其他行完全不变。39,317来源/正式路径stat保持，6,570 Inventory路径/原91项ENOENT保持；不是全部媒体内容SHA核验。独立脚本及首跑错误分别保留在ignored诊断目录，NAS结果operations/production-after-people-collection-audit.json。

标准发布最后health检查误用Bootstrap的maintenance条件，普通停止态Host实际ok/normalSupplyAllowed=false，API及Runtime34已正常。只停止本机旧health轮询Node PID30108，没有再次停止或重建生产。修正scripts/deploy-nas.js按Host模式核对；新增--verify-only精确白名单只读复核，拒绝apply/continue变更，不上传配置、加载镜像、重建容器、执行备份/纠正或Resume。根目录控制器与Service部署合同16PASS，实际生产只读复核PASS。后续这部分仅主机部署工具/测试/文档变更，不进Runtime镜像，无镜像重建或冒称另一Runtime全量Gate。原apply被停止于错误health轮询，不记录原apply退出0；数据变更与原回执、只读补验各自记证。

2026-10-27T04:39:06.288Z Resume完成，operation=8199494ed9c0c8a7a9be31921ed13a654b87eb35c49257150cfeb49d601a0117，原始UTC createdAt=2026-10-27T04:39:03.544Z（sinceMs=1793075943544）。Runtime revision35/running/normalSupplyAllowed=true/error=null。用户随后明确允许仅取消Arielle Aquinas、Cherie Deville、TTIA-152三条因本轮遗漏新冻结的任务；经线上API逐条discarded，原失败/Run revision/历史均留，cleanupMemberCount均0、excludeSourceFiles=false，Subject abandoned、无旧token/旧Libra占用，等待正常采购，不强制重采。全部三条回执和校验备份保留，没有复用到其他任务。

2026-10-27T04:51:21.480Z有限分时核验：3个新Series Run、4个新US Run active，Libra新Work succeeded208、媒体生产成功Event61、US分析成功Event16、资料观察142、Artifact生产201；这些是明确有界Event样本，不是整库历史总量。原us_adult_analysis Circuit由真实成功执行closed/INVARIANT_RESTORED；People18 embedding登记均在，无新孤儿，五来源stat/opendir成功。JAV/US/Series有本次Resume后新完整观察，国产剧/电影仍有新分页在推进，不能冒称全部扫描完成。收藏仍691，无本次Resume后新正式Commit；不以接纳、资料成功或运行状态冒充入藏。工作台6进行中/1 attention，该项是演员确认，不自动选择。容器Restart0/OOM=false；vol1约16.7GB、vol2约324GB可用。

仍开放FORMATION-HISTORICAL-SERIES-PROJECTION：启动及运行日志重复P14_MOVIE_PRODUCTION_RELATED_BINDING_DRIFT（04:45Z后Resume日志样本67次）；真实只读Owner Reader定位全部7个当前新Run可读，19个旧completed Series Run及1个superseded Run失败。Formation seriesDelivery当前使用生产执行Reader，需要活跃Related authority；Reset已按合同清掉旧非收藏责任，历史展示不能继续借用当前执行资格。未恢复旧Control、未补旧authority、未削弱执行校验；后续应从不可变历史事实构造展示，保留本项开放。691 Arca收藏事实及完整证据核验通过不等于Libra历史详情展示也已修复，不能将整体Phase判Exit或宣称零缺陷。

另观察到本容器Resume后53次AbortSignal监听器警告（04:45Z样本），当前未证明泄漏；现有内存样本含页缓存，不能跨不同采样法声称性能改善。4K忙载吞吐、启动风暴继续延后。高达/凡人歌自然生产入藏验收、未确认Provider季集映射及人工演员/体积决定仍各自开放。未恢复已取消的定时观察，未新增Git release tag。


最终交付前补样：04:56:17Z三条获准取消项均Subject abandoned/Run discarded revision4，旧token0/旧Libra Control0/收藏691，readonly total_changes0。04:57:02Z Runtime仍running/normalSupplyAllowed=true/error=null；Libra新Work succeeded213，新Series3/US4 active，当前6进行中/1演员确认，Event末2000样本内无本次Resume后失败，Circuit仍closed，18 embedding登记无缺，无新孤儿，尚无新的正式Commit。新Run真实Owner Reader7/7可读，旧失败实际为19 completed+1 superseded，共20个历史Run，前述口头“19旧终态”只覆盖completed数量。Root部署工具修正与发布记录提交1a24f7d58934fc5b1f3b0daacc94ed02725626ee，仅部署工具/测试/文档，不改变已验收运行镜像6ad98f1f6；本次不再部署、不重建观察。

## 2026-10-27 工作区泛化500的真实复现与读取边界修正

用户再次报告媒体整理工作区Clean Service请求处理失败。05:10Z只读核验：runtime/active/ended/care/corrections均200，GET /v1/admin/formation?section=completed&limit=25为500，correlation6653edf9-bf3b-4803-838f-d485fe2cf406。页面all同时读取多个入口，已完成列表500可在进行中数据仍可见时显示横幅；不是新增一个失败媒体，也不能以health200判定页面正常。

原seriesDelivery使用生产执行readRunSnapshot读取展示；该Reader正确要求当前Related authority，Fresh Reset则按合同已撤去旧责任。当前修改共用原不可变输入验真内核，另提供只返回既有seriesDelivery DTO的readDeliveryPresentation；列表/详情统一使用该展示端口，不按版本/Run状态回退，不补旧绑定，不授予执行权。readRun/readRunSnapshot的当前权限校验和错误保持。展示仍严格校验Run/Spec/Manifest/Accepted来源、Primary、Episode声明与本地Season，不用当前Head填历史。

真实隔离Host先完成2集正式Commit，再停止写入并仅在夹具中撤去当前Related资格；原生产Reader拒绝不变，历史详情及completed列表从500转200，未恢复资格、未启动任务。首跑夹具错误使用只读DB写入，未触发目标缺陷；修正夹具连接后真实500红例和修复后的绿例都保留。相关26项投影测试、两条Native Host（含来源/Primary/Episode/Subject/Season负例）及18项部署控制器资格通过。生产尚未发布，后续固定版本完整门禁/UI/NAS证据待追加。


## 2026-10-27 历史剧集展示固定候选资格与普通升级准备

固定候选a2bf2d6fd3271dc3a3741e28ed42f533a59d99d4；镜像markmahoro/shelfdeck:a2bf2d6fd；tar SHA256 cfe80143a74bba30f3cb92c9db4f3a03017701358cf8424fa81ce3b3a1770c03，NAS image sha256:894a07fd5c178536bebecc4d3dfb3951c9d225d217c62c2c2db2c49f8f4696df。Service865项836PASS/29skip/0FAIL；投影单测26PASS；标准部署配置18PASS。Windows独立包与真实Linux镜像各通过1个正式Commit后撤去当前Related资格的Host旅程；历史读取成功，严格执行Snapshot仍拒绝。Linux首轮2GiB临时卷低于原有5GiB+120%材料保留预算，未达到目标断言；16GiB临时卷复验通过，没有改变产品阈值或超时。

固定clean checkout完整Architecture覆盖428文件/3408项，首轮3381PASS/1FAIL/26skip，四项静态均PASS。失败为ordinary procurement retry and cancellation: reset返回EPERM；无改动原断言定向两次各1PASS，整个文件7PASS。精确瞬时操作原因未能重现，不把原FAIL覆盖或称一次全绿。首跑、定向、整个文件及完整覆盖清单分别保留在ignored诊断目录a2bf2d6fd-architecture-*。

NAS实际生产数据库只读新镜像Reader回归27个Series Run全部可生成不可变展示，20个历史Run的执行Snapshot仍拒绝，total_changes=0。完整HTTP隔离副本使用既有已校验People纠正候选SHA0444c68a56b42091ddeed5cf2ad53c77951fec1b477e86fcf4cb6e513ea91ebf；7个公共/工作区请求及19历史详情共26个200，stopped且不Resume。首个180秒预算尝试没有接口证据；第二次明确ARCA_AFTERCARE_WORKSPACE_ROOT_CONFLICT：跨卷复制改变物理挂载身份。最终副本仅在测试装配中显式使用生产只读记录的Aftercare挂载身份Fixture，其他路径仍私有且网络关闭；这不属于完全未经适配的物理副本启动证明，不是生产兼容分支或数据修复。原位发布保留真实挂载，须以后续真实生产接口核验为准。两个任务专用资格容器均在保存退出状态后移除，副本及失败日志保留。

用户授权的UI负责人完成同候选适用验收：16浏览器PASS（四视口）、2原生Host PASS（只有1个实际撤权历史Capture）、26投影PASS；176 Web输入、9页面资源及两个镜像Reader源码一致。完整报告E:/my_project/helix-git-consolidation-20261008/formation-ui-review-a2bf2d6fd-20261027/owner-review.json。未把上一版UI数量加入新数量；无生产访问。首轮Capture数假设与分页合成总数错误已在私有Fixture更正，原记录保留。

普通升级新增--runtime-reset-config仅保留现有管理配置，走正常readiness/health，不进入Bootstrap、Reset或People纠正。先使用共用prepareNasStoppedBackup完成Stop凭据、旧进程关闭/移除、独占挂载、完整当前数据/Workspace/配置冷备，备份verified之后才允许标准deploy发布新配置；业务库不迁移。容量预检要求vol1至少10GiB、vol2至少40GiB，不计删除收益；已做fnOS只读preflight。06:03:29.912Z Stop完成revision36，operation249ef42134da4e5530f51eac42aa7969d0f2f842112aca0400fc1a4e6a307618，所有inFlight0。保护基线为694 Commit/收藏、12组收藏/People表及39,346来源/正式stat；这包含本轮运行中新完成的3个收藏，不能继续用旧691代表当前全部事实。完整冷备正在执行，尚未apply/Resume。无再次Reset、任务取消、媒体移动删除或恢复自动观察。


## 2026-10-27 历史剧集展示生产发布与验收收口

markmahoro/shelfdeck:a2bf2d6fd，git a2bf2d6fd3271dc3a3741e28ed42f533a59d99d4，tar SHA256 cfe80143a74bba30f3cb92c9db4f3a03017701358cf8424fa81ce3b3a1770c03，NAS image sha256:894a07fd5c178536bebecc4d3dfb3951c9d225d217c62c2c2db2c49f8f4696df。生产容器1792e7209ca39dcd83eb64d91107803bb7bdf234103a4d5b00d4381bf1d29493于06:15:12.736Z启动，所有代码来自镜像，无源码覆盖挂载。标准构建、上传SHA、dry-run、正常readiness/ordinary apply、Admin Web和真实挂载验证通过；先前Stop36继续作为本次普通升级屏障。新Host以stopped/revision36/quiesced/所有inFlight0启动，health为正常ok且供给false。

完整当前冷备位于/vol2/1000/shelfdeck_backups/historical-series-projection-20261027/archives/pre-deployment，507文件/10,898,810,820逻辑字节；inventoryDigest=7e74151c12235146a4d007ec2b702cda78dd5fbfb32743032c7510aa38766459，verificationDigest=4fa1237d3f15d09fd6651c6ac95f34af331e754dc7626bbee3b58c1ec743100f，receiptDigest=188d6d4a759246faf1ca97dc8985ce1e95527281ceb5e516f0bbfb22bac84b2a。包括当时完整数据、Workspace、原Compose/Secret/Reset配置，明确排除旧Operator档案挂载，没有递归备份旧备份目录。未新增容量删除。原闭合closureDigest=a500d44c2cc333de381821922ec94211d7f9d4929cbc170016a848135ad5c854。完整冷备verified后才发布新管理配置；本次无Bootstrap、Reset、People登记纠正或额外任务取消。

停止态保护验证：694收藏/694 Commit、12组收藏/People表与新停机基线摘要一致；39,346个来源/正式路径stat摘要9c8f75b523bd2f22822ad90231da8d04fd6766a7dbb9d61f916d934a4a14d498保持（不是全体媒体内容SHA）。database-generation.json与generation-fence.json原字节摘要保持，代际仍13fcd0d320da5dcc0d02040fc22461b11afbb05729db089d9bacba4fc205711c。通过私有备份DB比较239表，并完成完整integrity_check=ok/foreign_key_check=0：236表逐行摘要完全一致。

辅助审计首次把“239表一行不变”错误设为普通启动断言，因此FAIL，原日志a2bf2d6fd-all-table-proof-first.log及原完整哈希证明保留。实际差异仅3张既有启动表，未修改数据去消除差异：Libra createSourceFairness初始投影priority_revision1802→1803，turn_sequence1762及实际轮次账本不变；NVIDIA既有unavailable/disabled状态保持，设备探测revision348→349并新增1条失败证据，全部667条旧Probe原行保持，其他3个设备及配置完全不变。按既有启动代码和精确字段逐项核验，后置startup-differences-proof通过；不是弱化收藏/历史保护或认为所有变化都正常。证据在qualification/stopped-upgrade-all-table-proof.json与stopped-upgrade-startup-differences-proof.json。只在私有副本打开归档DB，档案只读挂载及原SHA保持。

真实生产完成列表及19个历史剧集详情均200，当前Run与历史DTO可共同展示；旧历史Related执行权限未补回。最初辅助请求把care/corrections误当Formation section，实际回落active，不能据此证明这两个前端入口。已按web/src/helix/api.ts精确补验/v1/admin/care?view=work&limit=25及/v1/admin/collection/jav-corrections?limit=25，06:31:31–32Z均200（分别25/0项）。结合active/completed/ended真实接口，前端五类数据入口全部200，原completed500已消失。该工具请求错误及更正均保存，不把副本两个无效section覆盖称为原生五视图资格。

06:25:06.105Z正式Resume完成，operation7f71acf9d15c953cf68b1337ec9e7c5172b6b1c8638fe458113f6b59fc491623，revision37/running/normalSupplyAllowed=true/error=null；增量原始UTC sinceMs=1793082304422。06:25:46与06:29:25两份有限只读样本显示五来源stat/opendir可读，Procurement评估/新包组装、Libra身份/依据/验收均有真实成功，新Work继续运行；694收藏、此短窗口尚无新Commit，不用接纳或整理完成冒充入藏。People18参考登记无缺失，无新异常孤儿，Restart0/OOM=false，cgroup oom计数0。新容器Resume后日志P14历史Related漂移0、CLEAN_SERVICE_INTERNAL_ERROR0；1次AbortSignal监听器警告无泄漏结论。未重新创建自动观察。

开放边界：本次升级前后8条attention身份/原因完全相同，5条Arca共享剧资料P4_EVENT_RECOVERY_REALITY_CONFLICT（假如…？、真探、亿万、越狱、继承之战），2条Libra Run frozen（欲望都市、大宅门2，尚未独立核实具体失败证据），1条演员确认。共享Series Circuit仍为原有recovering；该行在236张不变表的fx_circuit_states中保持，不是本次Reader升级新增或已解决。另以FORMATION-SERIES-PRESENTATION-RECOVERY承接只读逐项诊断，不按同码推断同根因，不自动重试、取消、Reset或选择业务结果。只有FORMATION-HISTORICAL-SERIES-PROJECTION按自身实际500→200与历史/执行分离条件收口；生产全部媒体验收、已有UAT、Phase Exit、高达/凡人歌自然入藏、季集/演员/体积人工决定及4K/启动风暴均不据此关闭。
