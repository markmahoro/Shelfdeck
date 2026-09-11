# UAT 联合发布接手审计

2026-09-12。本文件为交接与发布前检查 Evidence；唯一排程仍为 CURRENT_PLAN / CURRENT_PHASE，不建立第二份活动计划。最新结论：首批cd4f3f5b2d已发布，257/258/259分别验收关闭；第二批Control拒绝链已合入d7a6da2802，正在验证，生产保持首批镜像。下文接手时的旧镜像、未授权或未部署描述为历史快照，以末尾追加记录及CURRENT_STATUS为准。

## 用户决定与职责

用户明确要求部署任务了解并行工作、负责最终收口，并确认“全部就绪后，由本任务统一协调并部署”。此决定取代此前接收恢复任务中“部署等通知”的安排。统一部署任务为“收口并部署上线”，ID `01a091f4-c863-7d02-9eea-12614e18f7d0`；五个相关任务均已收到统一交付、不独立发布的通知。

同日后续指令指定本任务为部署负责人，明确负责代码合并、工作区清理、生产部署，顺序与节奏自主决定；不再将全部任务同时完成作为固定发布前提。用户进一步澄清“无需通知其他相关任务”仅指此次任命无需广播，不限制必要技术协调。该职责已写入AGENTS和Playbook §3.5；本次职责更新没有向其他任务发送通知。每批仍须完成其自身依赖及验证，未就绪的改动不混入发布。

授权包含必要的集成、验证、完整备份和标准 NAS 发布。生产 Reset、冲突文件移动、逐片 retry 仍须核对各任务中的精确授权及当前物理/持久事实，不能由镜像发布授权扩大。UI 第二轮扫描建议尚未获实施授权，不自动纳入本次发布。

## 已核实交付

| UAT / 范围 | 任务与工作区 | 接手时的事实 |
| --- | --- | --- |
| UAT-251：完整终局及自动授权瑕疵上架 | “增加自动授权瑕疵上架”；`01a091ee-2dee-7e00-8c00-7fb0e8189074`；`emby_third_party-helix-uat251` / `codex/uat-251-terminal-defects` | 实施中，基线144798953；UI方案已确认，实际实现截图尚待UI任务复查；未交付最终提交和验收。 |
| UAT-125/250相关接收恢复及三片剩余恢复范围 | “排查影片上架与席位占用”；`01a091e1-3ab5-7c83-968f-5581fb93f953`；`emby_third_party-helix-intake-recovery` / `codex/intake-recovery-20260912` | 新任务输入稳定与真实重启恢复已报告通过；旧席位精确工具及保护断言仍在验证，生产方案未执行。 |
| UAT-257扫描阻塞及后续普通选材 | “排查扫描与来源详情失败”；`01a091e5-2ad5-7a23-a1cb-9be53e1c6bca` | 已继续实施新轮次、幂等和失败后重扫修复，转入独立工作区；未交付最终验证，无生产扫描。 |
| UAT-258授权按钮 | “确认旧输入自动清理开关”；`01a091eb-5606-7393-a855-24b5636587cd` | 完整提交`38e89d14591592240820c1d1e05d3e472821daaa`已在集成分支；20文件90项Web测试、构建、本地真实Host1440/390px及授权/撤销/失败恢复/键盘验证通过，无后续未交付修改。待最终镜像生产只读页面验收。 |
| UAT-256及本轮UI协调 | “确认全页面 UI polish 需求”；`01a0912a-0086-74e2-88ab-536c59d3862a` | 已发布范围仍按原证据关闭；251/258及扫描修复需按新diff复查。第二轮八页清单、删除正常收藏架“可接收整理结果”标签均只是未实施建议。 |

UAT-251全局授权位于收藏架配置页头，与258保持相同按钮/对话框形态；新增决定进入现有详情，媒体整理九列、过滤、分页和查看过程入口保持。健康与已接受瑕疵各显示一次。旧256验收不能代替新增UI验收。

## 工作区与生产身份

- 实际集成区：`E:/my_project/emby_third_party-helix-iteration`，`codex/user-pain-iteration`。主工作区main及其用户未提交规则/文档修改不作为构建来源，也不覆盖。
- 发布区：`E:/my_project/emby_third_party-helix-uat-release-20260908`。UI任务明确释放该区，交接时为clean detached `83235c9260fc4e2c1bc1c5d87fb193a265e1d8bb`；保留ignored镜像、日志和证据，最终只从审定的精确提交构建。
- 受保护的原Aftercare Evidence SHA256仍为`81729d8c6ec35bec5494929bb19b46e6c83412b769a2cb8cff6db859bad35a3c`，不夹带提交。
- 实时NAS：`303NAS`，SSH用户`gezhu`；Compose project/service均为`shelfdeck`，应用目录真实路径`/vol1/1000/docker/shelfdeck`，Docker私有根`/vol1/docker`。
- 实时镜像：`markmahoro/shelfdeck:helix-beta-20260912-83235c9260`；Config Image ID `sha256:ed54a889290e6e448e551af3ea823c1b32a8a00b8176adec1e4411d170789a2c`；StartedAt `2026-09-11T18:36:35.708195394Z`。当前tar存在；既有发布记录的tar SHA256为`5a2ba0cc1d86aa6fd6af5bdbef41d2ba0701c06b19a6408cdf78f8bffa8b9b94`，本次未重新计算整包hash。
- 旧发布/备份与验证细节见[83235c发布证据](UAT_RELEASE_83235C9260_20260912.md)，不能将其备份时间点当作下一次上线前的最新快照。

## 已执行的只读检查

通过项目统一`tools/nas-ssh-config.js`和`tools/ssh-exec.js`在NAS执行fnos-docker-deploy的`preflight.sh shelfdeck 18080`，另核验Compose、image、bind mounts、QSV及HTTP。

- NAS Docker 28.5.2、Compose v2.40.3；工作站Node v25.9.0、Docker Server29.4.1可用。
- `/`、`/home`为root:root755；应用目录gezhu:Users771；Compose644、secret.env600；`/vol1`约45GiB可用。未修改权限、配置或业务数据。
- 五项持久挂载`/app/data`、`/media`、`/adult_media`、`/upgrade`、`/transcode`及`/dev/dri`与当前正式部署合同一致；没有源码bind mount。
- `docker compose config --quiet`通过；NAS本机及LAN `/v1/health`均为`status=ok`、`generation=helix-clean-v3`、`normalSupplyAllowed=true`；NAS管理页HTTP200。其他运行容器状态已取得上线前参考。
- 本次没有执行build、upload、deploy apply、Reset、媒体移动或生产业务POST；没有重复已通过的UAT-258本地测试。

## 最终发布尚缺的证据

1. 三项开发完整交付及UI实际结果复查；在同一最终集成提交验证适用Windows/Linux真实流程、并发/重启/负向、Web构建和浏览器。生产只读页面核对258真实授权，避免为验证样式改变用户授权。
2. UAT-251新schema/typed合同、manifest、readiness及旧镜像回滚影响。上次扩展架构4个失败、121条drift虽在旧基线复现，本次涉及合同变更，必须重新区分相关/新增/无关失败，不继承纯UI发布的豁免结论。
3. 上线前重新核验当前生产与磁盘，创建并校验完整data一致快照、伴随文件、Compose及Secret备份。已读脚本确认`deploy-nas.js`本身不提供完整data备份，须在apply前单独完成；已有在线SQLite backup API方案可作为实现参考，不能直接复用旧目标路径或旧image断言。
4. 只使用`build-image.js` → `upload-nas-image.js` → SHA256 → `deploy-nas.js` dry-run/apply；新tag绑定最终clean commit，保留当前83235c镜像及tar。新schema如果不支持旧镜像，不宣称可以只回滚镜像。
5. 生产镜像/健康/挂载通过后继续验证各自用户结果：257完整新扫描及普通选材、接收恢复和席位持续周转、251终局与授权行为、258页面。精确历史数据治理按独立授权执行；未完成时对应UAT保持开放。

本任务已建立15分钟联合交付跟进；无变化时静默，重要交付、失败、待决定或发布完成时通知。联合发布及约定验收完成后停止跟进。自动化只承担唤醒，不替代上述发布证据或授权。

## 共享验证依赖恢复

同日接收恢复及扫描任务报告`better-sqlite3`不可用。只读核实：主工作区`media-service/node_modules`为实体目录且缺少该包，iteration通过Junction指向它，intake-recovery又通过Junction指向iteration；scan-repair和uat251此时已具有独立依赖。没有证据确定最初缺包的具体操作，不能归因于某个任务。

确认主区/集成区服务及Web的package/lock无差异，且没有共享npm安装进程后，在主服务已核验的精确实体路径执行`npm ci --no-audit --no-fund`，161包安装成功。主区、iteration、intake-recovery三条路径均通过SQLite内存`SELECT 1`及fastify/undici/sharp加载，跟踪的package/lock没有变化。已向受影响的接收恢复任务发送技术恢复结果；没有生产写入。该检查只证明本地验证依赖恢复，不代替业务回归或最终镜像验证。

随后发现`tools/node_modules`同样缺少ssh2，iteration及intake-recovery仍通过Junction使用主区实体目录。核验package/lock一致且无安装并发后，按原锁恢复8包；三路径`ssh2.Client`加载及统一SSH入口实际只读生产health均通过，跟踪依赖文件不变。

## 接收恢复追加阻塞

接收恢复任务报告：83235c生产备份副本的精确两项pre-Subject Reset演练及全库保护检查通过，但5个open旧Offer的23个member存在冻结Control revision4/current1。safe Reset不等于recoveryReady，在正式拒绝与重新选材闭环就绪前不执行该两席位的生产Reset。SSOT §8.6.19已规定`candidate_control_scope_unavailable`须引用正式`MaterialControlProjectionSnapshot@1` Evidence；已请求原恢复任务先交付已验证核心修复，再按现行Owner合同补齐并验证这条正常拒绝路径。若producer/持久化/路由存在未定边界，先报告精确缺口，不以旧数据兼容、改Control或改immutable Candidate替代。

## 首批代码集成核验

接收恢复核心提交`9820e7b85ec2716ab367b4cdef4345c96587c531`已审查并在专用发布区与`06f1324df`合为`3aab889980`，再以`203773327`合入集成分支，同时保留`abb87310d`新确认的UAT-259第二轮UI授权及最新台账。七项服务文件包括Intake Plan冻结输入、精确pre-Subject Reset闭包、冲突文件隔离工具和对应测试。UAT-259实现仍由UI任务独立交付；本记录中此前“第二轮未授权”只表示接手时的历史状态。

发布区安装独立锁定服务依赖，没有共享Junction。集成候选执行`node --test --test-concurrency=1 media-service/test/helix-intake-recovery.test.js media-service/test/helix-formation-reset.test.js media-service/test/helix-stage-conflict-quarantine.test.js media-service/test/helix-architecture/p8-intake-acceptance-contracts.test.js`，49/49通过、无跳过，约52.8秒。该恢复场景为真实Host/SQLite与注入Probe fixture，不把它称为完整真实媒体链；最终Linux镜像验证仍待该批候选冻结后执行。本地日志位于发布区`.codex/intake-integration-20260912.log`。

仍未构建或部署新生产镜像，也未执行生产Reset/隔离工具；核心合入不关闭UAT-125/250。恢复任务进一步指出正式Control Evidence身份/持久化与CAS失败后的未提交证明路径有合同缺口，当前先保留阻塞并审查其窄合同提案，不在集成时补造Evidence或改变旧Plan。原Aftercare Evidence SHA256保持接手值。

## 后续集成与批次安排

- `fa2d1f2f0`完整接收恢复Evidence已合入`22ac589f3`；三个CURRENT文件的并发冲突保留部署职责、259最新授权、258及恢复事实。开发任务已释放的`E:/my_project/emby_third_party-helix-intake-baseline`经物理路径、无tracked/untracked/ignored变更、无占用进程及144798953可达性核验后，用非force的`git worktree remove`清理；其余未交付工作区和回滚资料保留。
- 扫描交付`fdabf79a6`已由`93d525b2d`整合，三个CURRENT文件冲突逐段合并，保留全部新授权及旧队列阻塞。独立发布区在93d525b2d完成21/21扫描、Intake与拒绝循环组合回归、21文件94/94 Web回归及TypeScript/Vite构建；无需因后续纯文档合入重复这些检查。
- 首批拟在UAT-259完成自身UI组合验收后，集中发布扫描修复、接收恢复核心、258/259；UAT-251完成自身合同/schema/全链验证后另安排。最终镜像Linux、生产真实扫描、正式用户结果与完整备份仍是每批独立门禁，未交付变更不混入。
- `5d4950e58`最小Control拒绝提案已通过部署负责人工程审定并交原恢复任务实施：限定观察时available且已证实不符，复用既有材料验证能力和Result Evidence，采用稳定scoped Handle及Foundation public读取；没有改变Owner、既有拒绝理由或业务终局，不需用户再次决定工程字段与ID槽位。CAS后自动Reject/新Work分叉移出范围，unknown和Accepted不可反转保持。正式SSOT/typed合同传播及新建流程验证未完成前，生产旧两席位Reset仍不执行。

## 首批已发布

cd4f3f5b2d已通过最终Web94/94、适用Linux39/39、完整备份与标准发布，生产73页新扫描成功，六条资格恢复。生产八页/五Tab、授权取消保持revision1及原8份拒绝记录不变通过；完整身份、未覆盖项和回滚见[本批发布证据](UAT_RELEASE_CD4F3F5B2D_20260912.md)。后续正式Control拒绝链与251仍由原任务实施；精确旧两席位Reset仍不执行。

## 第二批Control拒绝链集成验证

`9ecf7b2a1`代码与`d591d6867`Evidence已由`d7a6da2802fc0838a273633a5225a5c9e4929fae`合入。三个CURRENT文件冲突保留首批实际生产身份及257/258/259关闭状态。原Aftercare未提交Evidence仍保留，不夹带提交。

专用发布区在精确d7a6da2802执行Windows组合回归：Control拒绝与未知/提交后竞争保护、Intake恢复、扫描、普通选材/拒绝循环、精确Formation Reset，共**38/38通过、0跳过**；完整`helix-architecture`为**1,647通过、9既有跳过、0失败**。日志分别为发布区`.codex/control-combined-20260912.log`和`.codex/control-architecture-20260912.log`。本批生成合同已经通过完整检查，首批记录中的旧基线失败不作为本批豁免。与生产cd4f3f5b2d比较，clean-schema.sql无差异；这不等于旧未完成Work可跳过新Evidence合同，仍不得增加旧Result缺字段fallback。

标准build-image.js已构建本地候选`markmahoro/shelfdeck:helix-beta-20260912-d7a6da2802`，tar SHA256 `291a20e18595f8f08916155eca8b184339c38c7496a6a86fa581f60bc6b08282`，构建Config digest `sha256:42f7b2d8ba5ba56472e014a224f728f5b536bd95ba0b585470ff74c13cdd626f`。尚未上传、部署或执行生产Reset；精确镜像Linux验证与最新旧队列隔离恢复演练继续补齐，125/250保持开放。现有首批完整备份是上线前83235c9260时点，不能作为扫描1294后的最新副本。

该精确候选镜像随后完成Linux **117/117通过、0跳过**，约241秒，涵盖适用P8合同、上述组合流程、30项精确Reset及10项冲突隔离工具测试。服务源码、生成合同和依赖均来自镜像，仅只读挂载测试目录及镜像外的工作站quarantine operator；网络关闭，真实`/transcode`为临时tmpfs。未运行依赖Git历史的`p8-exit-auditor`文件（生产镜像不含git），该文件已在Windows完整架构检查中通过；没有放宽Reset路径保护或mock平台。日志为发布区`.codex/linux-control-20260912.log`，容器正常退出并由`--rm`回收。两条AbortSignal MaxListenersExceededWarning在首批同版测试日志已存在，本次保留记录，没有屏蔽告警。没有重跑完整FFmpeg/QSV长片E2E、Desktop/Worker或未变化的首批Web交互验收；本结果仍不替代最新历史队列恢复演练和生产业务验收。tar内manifest的Config与上述42f7b2d8一致，Docker Desktop本地OCI index为db127c87ace859ada3acf7537a11f2d8259903caa84e012a7d61c2d49341e726，不混作NAS Config ID。

## 最新副本演练的顺序约束

恢复任务报告最新cd4f一致副本SHA256为`1f4f90753df7cf0806121acbed57d6604289ce8c286ce439ba586bdcca6f4003`，970份Delivery（834 open、128 accepted、8 rejected）。在该隔离副本上仅Reset原两Token，通过实际Composition/Planner/EventRuntime、typed Owner ports及NAS原文件只读fingerprint完成5份旧Offer正式拒绝，真实consumer与幂等重放释放23条Reservation。前半段Evidence 3378b34be已接手为0907001cd，并核对final-audit：89张受保护表全行摘要、其余965个Delivery、无关Work及Fast X Token保持，integrity ok/FK0；完整材料路径见源Evidence。该演练为限定process执行轨，直接consumer尚未验证Outbox transport ACK，后半段须补齐；不是生产恢复结果。

普通再选材返回`no_eligible_material`。部署任务已核对`procurement-automation-service.js`的现行防回环实现：同一个Observation不能产生新Procurement轮次；`handoff_rejected`的`reservation_updated_at_ms >= terminalObservation.observed_at_ms`时不能复用旧Observation再选材。因此revision1294虽然真实扫描成功，但早于本次副本拒绝消费，不能作为后半段恢复证据。不得改时间戳、弱化guard或合成新Observation；已交原恢复任务继续同一隔离副本上的完整真实扫描与普通再选材。

验收顺序固定为：精确两Token Reset → 新代码下5份正式拒绝及消息消费完成 → **晚于消费的新一轮完整Field Observation成功** → 普通再选材及席位周转。镜像启动自动扫描若早于消费完成，也不能替代这轮观察。需要显式触发时使用正式`POST /v1/admin/material-fields/:fieldId/actions/observe`，从当前Owner读数取得Access/Observation revision及独立idempotencyKey；若有活跃扫描则先等其终态，不绕过并发准入。生产处置仍待完整演练及现场预检；Reset只用原两项`--subject-ids`精确范围，当前标准NAS Reset wrapper与离线operator相对cd4f均无代码差异。发布及Reset各自的备份、plan、确认、完整性校验和标准deploy要求不因顺序安排省略。

## 第二批试发布失败并回退

最新scoped正常链e3b8fd7c7已合入667e4a66e，5新包/2Accepted/12 ACK及保护检查通过。随后真实生产scoped Reset完成，但d7a6da2802完整Host因PLAN_CATALOG_DRIFT未启动，已标准回退cd4f3f5b2d，health正常。原两Token Reset已生效，未恢复DB、未扩大范围；下一次必须重新核对当前队列并先过最新副本完整Host启动门禁。详细身份、备份、已执行数据变更及覆盖遗漏见[UAT-261事故记录](UAT-261_CATALOG_STARTUP_DEPLOYMENT_20260912.md)，覆盖上文“未上传/未部署/尚未Reset”等历史时点描述。
