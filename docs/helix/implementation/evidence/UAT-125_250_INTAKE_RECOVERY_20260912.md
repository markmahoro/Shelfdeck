# UAT-125/250：接入恢复与精确处置准备

日期：2026-09-12。第一批实现 `9820e7b85ec2716ab367b4cdef4345c96587c531`，基线 `144798953`，分支 `codex/intake-recovery-20260912`。本任务仅本地实施、隔离验证及生产只读核验；生产部署、停服、Reset、文件隔离和重试由统一部署任务安排。UAT-125/250保持开放。

## 已修复的新流程缺陷

Libra claim-free Movie 的 Binding Receipt 允许无关 Subject 推进 Continuity Head，但 Acceptance 的 Payload/Control Handle 原来每次投影都读取最新 Head。事务失败后重建输入即触发 `P4_EVENT_RECOVERY_INPUT_DRIFT`，已有 Effect 无法继续。

Acceptance Planner 现在一次冻结 Head 与两个语义摘要，写入原有投影参数；三个投影均从同一 frozen basis 重建。保留 Foundation 的输入摘要 Fence、当前 Control CAS、claim-bearing Head Fence和语义变化拒绝。不增加旧 Plan 兼容分支，不回写旧 Attempt。

新 Host 回归从三个新文件经过 Field Observation/Triage/Intake建立数据；SQLite test-only trigger使其中一个接收事务回滚，另两项先提交。关闭并重建Host后第三项用原Attempt摘要完成，再重启无重复Subject/Receipt，源文件不变。基线重复出现原漂移错误；修复通过。Probe为有界fixture，不声称该测试验证FFmpeg或GPU吞吐。

## 席位与旧候选事实

生产 `83235c9260` 只读快照的3席位为两个pre-Subject孤儿与《速度与激情10》；只有后者实际转码且输出增长。《人生密密缝》已完成Handoff B，不占Intake席位。3/3占用不能解释成三个生产任务都在有效推进。

两个精确孤儿根：

| 影片 | Token Subject ID | Intake process ID |
| --- | --- | --- |
| 宇航员 (2023) | `libra-subject-2a33b6808bb76a964cb7d8f51e96b092c8fd2c2e` | `0b0dd582d88583d4b4a9116303b4eb485d6bf9af7200cce873304337c1c31cc1` |
| 光荣岁月 (2006) | `libra-subject-43e80b3c9dffe20134bfbcece12d573f8f763a87` | `f2bfaaf653e26f69d1aac32889ac9715b60b985f91c0f2a35ebc698495ca3efe` |

原 `--subject-ids` discovery遗漏无Subject行的Token及缺Work的Admission Receipt。工具现按已指定Subject精确纳入其typed Intake闭包并独立核对Receipt残留，范围外孤儿保持原状。

一致备份来源：`/vol1/1000/docker/shelfdeck/backups/ui-procurement-83235c9260-20260912/data/shelfdeck.db`。下载原件SHA256 `004829a398463e9ed9f0b0db391647d09b112fc3b3d0c94c6d46d1457f62ad74`，只在独立副本执行Reset。冻结manifest digest `12e637fc225ee7774a14919f37838e58be4c8cde769f3b854fd11f7d5132780a`：2 Token、4 Work、4 WorkAttempt、4 Plan、8 Event/Attempt、2 Effect、6 Result、4 Admission Receipt及对应节点/边/资源计时被删除。无Workspace、Control或Procurement闭包处置。全表双向EXCEPT证明没有新增/更新行，每条删除均属于冻结清单；全部其他业务表与范围外执行行逐字保持。完整性/FK通过，重放0变化。

**Reset safe不等于recovery ready。** 同备份另发现以下5个open Candidate共23个Primary member的admitted Control revision4、current revision1（同一Procurement Field）。前两项正是占席旧根；清Token后直接重新接收仍会CAS失败。

| 影片 | Offer ID | 失配成员数 |
| --- | --- | --- |
| 宇航员 (2023) | `5d067f5b9a8f0e3ab26417a7b9ccbfc5a4247cf8b58144f2286dd57a7640faf1` | 5 |
| 光荣岁月 (2006) | `c609e720e3052aa35f9ed9753a68d9541b60ba5790ca06a738e94dcd8ee7d4df` | 5 |
| 影子写手 (2010) | `ea7441eeaf51381c994407c1f7ffe5119579361b8c80d93145fca0a09d6e7c94` | 7 |
| 巴尔干边界 (2019) | `ce6f90063343368098abb1500e863580602f6c4bf04acb5ea641dccb6c8448df` | 5 |
| 国际市场 (2014) | `859078a049a2ee0d583aff5a204de83c9149dbea0288f3cc41d4296361bc4152` | 1 |

现行SSOT §8.6.19已定义 `candidate_control_scope_unavailable`，须引用正式 `MaterialControlProjectionSnapshot@1` Evidence。第一批提交未补对应Evidence producer/拒绝路由。后续独立提交核对并落实现有合同；不能伪造Evidence、修改immutable Candidate、补造Control历史或跳过CAS。生产两Token Reset在该闭环完成前保持阻塞。

## 人生密密缝两文件处置工具

On-deck Run `844d2564f525ee73c36564559e8b5cbefc704f8cf65457796af7b72bf6215615` 当前blocked、无Commit。最新明确失败 `CLEAN_ARCA_STAGE_TARGET_OCCUPIED`；旧两文件未被历史部署处理。脚本 `media-service/scripts/helix-stage-conflict-quarantine.js` 默认只读，实际生产只读inspect已通过。

| 精确路径 | Bytes | SHA256 |
| --- | --- | --- |
| `/media/Film/人生密密缝 (2017)/人生密密缝 (2017).nfo` | 7427 | `0c36f85dad179428446e6fb946a98df535913aa297dc9e90be83285560df25d4` |
| `/media/Film/人生密密缝 (2017)/poster.jpg` | 1031527 | `db80299781122985c4dea6001f88bcffce25c7f5952c91823259eb3bc98f8619` |

其接受产品大小分别7423/333786 bytes。工具要求manifest schema `shelfdeck.stage-conflict-quarantine@1`、精确Run、path/size/SHA256数组；上述二项manifest digest为 `bedd689515b5767e6630954cd9fd229e3c55043416827b6eac436cb29c9ece8f`。

工具只允许Final Inventory Decision声明的NFO/poster目标，确认Run blocked、无Commit、无活动Arca Work；检查当前Inventory、Arca/Libra Binding、Off-load Context和Product Package引用，并保护同inode/size引用。拒绝根目录越界、符号链接、身份变化、未证明冲突。SQLite永远只读。

实际执行需要 `--apply --offline-confirmed --confirm QUARANTINE_EXACT_STAGE_CONFLICTS`。先备份两项并fsync/校验全部SHA256，再逐项复核、同目录暂存后移走；异常还原已处理原件且保留备份与journal。Linux同步目录元数据。遇历史备份目录直接停止并要求核对journal，不盲目覆盖或自动重放。断电后据journal核验原位、parked及备份，禁止覆盖后来产生的不同文件。

部署维护窗口使用停止的服务数据与相同路径挂载，先重新只读inspect；备份必须位于持久应用目录，不能留在临时容器层。当前只读预检的 `--application-root /app/data` 对应备份 `/app/data/backups/stage-conflict-<manifestDigest>`。先保全一致数据库与原件备份，再apply；重启后通过正式On-deck重试入口处理该Run，验收Stage、Settlement、Commit Receipt和收藏可用性。该脚本不自动重试、不写任何收藏事实、不改其他媒体。

## 验证和未完成项

- Windows最终服务/Reset/隔离3文件测试41/41；P8 Acceptance投影8/8，含缺失/篡改basis、claim-bearing Fence、语义漂移负例。
- 相关Intake/Rejection/Movie Journey组合16/16；覆盖席位上限、重启、坏材料拒绝后释放及下一轮扫描，和本次Host恢复用例。
- 本机Docker Desktop Linux、既有83235镜像依赖+只读挂载本分支源码：三Movie Host恢复通过；最后P8/隔离18/18；新两项scoped Reset2/2。首次完整Reset套件因旧fixture使用临时transcode路径而触发既有Linux `/transcode` 限制，未放宽产品保护；已有套件其他Linux失败未宣称修好。
- 架构226文件：1621通过、4失败、9跳过；依赖/语义/manifest通过。4项为source map及派生contract drift，121个findings与干净基线144798953逐项相等；基线4项测试单独复现。统一整合后须刷新派生物并重新过闸，当前不能声称架构全绿。
- 无UI/桌面代码变化，无本批生产镜像构建或部署。生产Token/媒体未修改，未声称《人生密密缝》已上架或3席位已有效周转。

完整本地manifest、只读预检和副本演练证据在 `%TEMP%/shelfdeck-intake-recovery-20260912/`，运行数据未入仓库。历史因果证据见[UAT-250](UAT-250_FORMATION_STOCK_GOVERNANCE_20260908.md)、[三片修复](THREE_FILM_FIX_20260911.md)。

## 后续Control拒绝闭环的精确缺口

部署负责人要求先交付第一批，再核对既有拒绝闭环；如果producer/持久化/路由无法从现行合同唯一确定，先交付缺口并停止该边界实现。核查结论如下，不把已确认closed reason重新当成待定业务要求。

1. §8.3.6的Foundation只读public port及§8.6.18的 `MaterialControlProjectionSnapshot` 已明确query事实和digest；DTO没有EvidenceEnvelope/Evidence ID。当前不存在该名义类型的独立schema、Catalog Result family或持久化producer。§8.6.19却要求拒绝引用它的正式Evidence ID/digest。
2. Catalog的 `libra.intake.material.verify@1` 只有 `CandidateDeliverySnapshot + PhysicalMaterialReadHandle[]` 输入和物理验证输出；其evidence仅为通用EvidenceEnvelope。不能凭调用者内存/临时JSON把current Control悄悄加入Executor。另增Capability、扩充现有typed I/O或增加Owner Evidence事实，属于需要明确选择并传播的正式合同方案。
3. 当前Coordinator按同一Evidence Work的两项成功Result决定Accept/Reject，Rejection Planner要求这一Work的精确dependency。只在入场前观察Control不覆盖“观察通过后、Accepted事务CAS前Control变化”：后者当前进入未决Effect恢复。在没有原子未提交证明时，不得改旧输入或把未知效果转为拒绝；已有Accepted Decision/Receipt更不得反转。

建议的最小合同保持现有Owner：Foundation按精确Primary Key集合提供bounded current Control事实；Libra在正式Evidence Work中形成可持久重建且绑定Candidate Snapshot/观察时点的Control Evidence，并以已有code签发拒绝；Procurement只消费正式拒绝通知释放本包Reservation。Query unavailable保持技术unknown，不伪装成业务拒绝。须明确producer名称/typed输入输出、正式Evidence ID与payload digest、成功Result持久位置、CAS失败原子未提交证明和后续新Evidence/Work basis规则。保护当前Control和原immutable Package；重复/restart同一拒绝只成立一次；释放后通过下一轮普通Observation/Triage重新选材。

这些具体producer/持久化/恢复分叉尚未形成唯一现行契约，本任务未擅自增加Catalog或改写SSOT。已将精确缺口及上述有界方案交给统一部署负责人收口；此段不能当作已批准的新增合同。第一批修复可独立整合，生产两席位恢复不得越过该未完成条件。

## 可直接审定的最小合同提案（待审，未实施）

本提案收窄上一节：**只实现Evidence观察时已证实Control不符合Candidate冻结转移前提的正式拒绝。观察通过之后的CAS失败继续按现有未决Effect规则处理，本批不增加CAS后自动拒绝、重新观察或新Work generation。** 因此旧五包治理可以有通用实现入口，但不能宣称所有未来Control竞争均已自动恢复。

### 选择：复用材料验证Capability和既有Evidence Work

选定复用 `libra.intake.material.verify@1`，继续属于Libra、`pure_observation`，输出仍为 `IntakeMaterialVerification@1`。不新增Capability、Catalog Result family、Process Root、业务表或自动化队列。现有Candidate验证节点和后续Acceptance/Rejection两个分支保持原归属。材料验证在本次Intake的只读检查中同时核对物理可读性和冻结Control前提，不执行Control转移。

Foundation依旧是Control事实提供者。Composition提供固定的 `IntakeControlObservationPort.observe(handle)` 只读适配器，内部复用 `getMaterialControlProjections` public port，按500项分批读取。Libra只用下述冻结的scoped Read Handle调用这个明确声明的观察依赖，与现有材料验证调用有界fingerprint观察port相同；Executor不持有Store、通用Facade或任意Query，不通过路径猜Owner。port只返回事实，是否满足Candidate转移前提由Libra判断。Planner只声明typed Handle投影，不执行查询或写入。

所需SSOT传播仅为：原Capability输入栏追加下述Control观察输入；原Material Result定义补检查字段；定义该Capability的Evidence双分支及正式引用规则。下面选定的DTO、ID公式、schema生成和持久绑定是工程合同落点，不增加拒绝理由或业务Owner。

### Typed输入与检查结果

原两个named input不变，追加必需的 `intakeControlReadHandle`，名义类型暂定 `IntakeControlReadHandle@1`（正式scoped读取输入，不是Catalog Result）：

```text
handleId: SHA256
ownerDomain: libra
processType: libra_intake
processId: 本Offer的Intake decision ID
candidateDeliverySnapshotDigest: SHA256
materialKeys: SHA256[1..1024]
accessScope: current_control_projection_read
scopeDigest: SHA256
```

`materialKeys`按UTF-8字节排序，唯一且恰好覆盖同一Delivery的全部Primary成员；exclusive Related不进入Primary Control transfer集合。`scopeDigest=SHA-256(JCS({schema:"libra.intake-control-read-scope@1",ownerDomain,processType,processId,candidateDeliverySnapshotDigest,materialKeys,accessScope}))`；`handleId=SHA-256(JCS({schema:"libra.intake-control-read-handle-id@1",scopeDigest}))`。完整Handle不超过128 KiB。输入投影仅从immutable Delivery确定性派生Handle；port必须校验Handle、ExecutionContext Owner/process及同一Candidate成员闭包，只允许读这些Key，不能接收额外SQL或调用者扩大的Key列表。

**Handle不含current Control值、当前时间或临时nonce。** 这些值若由live input projection每次重算，会再次导致恢复输入漂移，不能采用。纯观察执行时，适配器返回 `capturedAtMs,projections[],observationDigest`：projections沿用§8.6.18完整available/unavailable union，排序/闭包与Handle一致；capturedAtMs为观察装配完成时刻，不声称多批Query同时原子读取；`observationDigest=SHA-256(JCS({schema:"libra.intake-control-observation@1",readHandleScopeDigest:scopeDigest,capturedAtMs,projections}))`。该明确声明的port输出上限1 MiB，超界、缺项、多项或digest错误是typed integrity failure，禁止截断。port输出是本次观察结果，不是回填Event输入的新快照。

未完成的pure观察可以在同一稳定Handle输入下重新观察现实；已经成功持久的Result/Evidence只重放原记录，不重新查询current Control。这样保留Foundation的输入摘要Fence，并避免把动态时钟藏进恢复输入。

Executor先校验输入Handle及观察输出闭包，再将每项available观察与该Candidate冻结的 `admittedControlRevision/admittedControlProjectionDigest` 及来源Field比较。只有revision/digest均相等、`controlState=controlled`、`ownerDomain=procurement`、`ownerScopeType=material_field`、`ownerScopeId=来源Field ID`才匹配。

| 观察情况 | 本批结果 |
| --- | --- |
| 全部available且全部匹配 | Control检查matched；物理验证也通过时，原Material Result才passed |
| 全部available，至少一项不匹配，包括revision0无row、released、其他Owner/Field或revision/digest不同 | Material Result failed，理由加入现有 `candidate_control_scope_unavailable`；保存按materialKey排序的**第一项**失配完整Snapshot作为充分拒绝证据 |
| 任一项resultKind=unavailable，包括Query不可用、坏row、未知Owner/state | 明确技术unknown/failure；不生成该业务拒绝理由、不把unknown算作uncontrolled、不释放席位，沿用原pure观察重试/失败处理 |
| 输入或Snapshot digest/closure不合法 | typed integrity failure，不进入业务拒绝 |

只保存一项失配见证足以证明该不可变Candidate不能按冻结集合转移，不声称列出了全部失配成员；查询与验证仍检查完整Primary集合。有真实物理失败时继续保留其理由，整体按既有五类precedence排序；不把Control失败伪装成物理不可用。

`IntakeMaterialVerification@1`补具名字段：`controlObservationDigest`、`controlCapturedAtMs`、`controlScopeStatus(matched|mismatched)`、`mismatchedControlMaterialKey(null|SHA256)`。matched时key为null；mismatched时key必须为上述见证key且reasonCodes含Control失败。观察unknown不发布此成功Outcome。现有 `result=failed` 仍可作为 `Outcome.kind=succeeded` 的正式验证结果；只有Material Result passed才能进入Accepted payload。上述字段明确进入新生产者的校验合同，不为旧Result缺字段增加fallback。

### 正式Evidence身份与持久位置

复用原材料验证Event的 `fx_event_result_bindings` 一行；Result保存在现有 `result_json/result_digest`。该Capability的 `evidence.schema.json` 从单一通用Envelope变成严格双分支：

- Control matched：保留现有物理验证EvidenceEnvelope。
- Control mismatched：`evidence_json` **直接保存第一项失配的完整 `MaterialControlProjectionSnapshot@1`**，不加字段、不套会改变Projection digest的伪Snapshot；所有物理失败的证明仍在同一行Material Result中。

Capability producer在执行时核对见证确实来自该scoped port观察输出；semantic validator强制Result状态与Evidence分支对应，并从冻结Candidate/Handle独立复核见证key命中同一Primary、确实失配、内部两个digest正确。Foundation按原流程在成功Outcome中持久化Result/Evidence，重启由已有 `WorkResultReader` 读取并校验canonical JSON摘要；不创建新的Evidence Store。

**正式Evidence ID选用该持久绑定已有的 `result_id`**，而非由projectionDigest临时拼出不可解析的ID。该ID在此引用语境唯一定位同一行的 `evidence_json` 槽位。正式拒绝引用固定为：

```text
evidenceSchemaRef = helix://contracts/types/MaterialControlProjectionSnapshot/v1
evidenceId        = WorkResultReader返回的resultId
evidenceDigest    = WorkResultReader返回的evidenceDigest
                 = SHA-256(JCS(完整evidence_json Snapshot))
```

三个摘要不得混用：Snapshot内部 `evidenceDigest`是§8.6.18的Foundation观察basis摘要；`projectionDigest`覆盖Snapshot中除projectionDigest自身以外的完整字段；拒绝引用的外层 `evidenceDigest` 是包含上述两项的完整持久Snapshot摘要。ID不是Snapshot字段，不参与其内部公式。绑定列的 `evidence_schema_ref`仍指向该Capability的evidence schema；Reader/Libra引用验证器必须验证其确实命中名义Snapshot分支，才能出具上述nominal ref。补充名义Snapshot schema以逐字表达已有union，不新增Catalog Result family。

这是一项显式的持久Evidence引用合同选择：Foundation生成且持久保存既有Result ID，Libra只将已读取的ID及正确槽位/名义schema绑定成拒绝Evidence ref。禁止把随机字符串、当前Query返回值或后来Control row当作历史Evidence。

### Planner、Coordinator、拒绝Receipt和释放的关联

1. `IntakeEvidencePlanner`仍规划原两个验证节点，仅给material节点增加上述投影输入。同一Work/process仍由Offer及Delivery Snapshot定位；只读观察重试可以重新取得现实，但只有成功持久的终态Result用于后续Decision。
2. Coordinator继续读取原Evidence Work的Candidate和Material Results；候选passed且材料passed才提交Acceptance，否则提交原Rejection Work。构造Work basis时除原两个Result摘要外，加入Control见证的持久ID及外层Evidence摘要（matched为null），固定真正消费的Evidence绑定。不得在已有Acceptance执行/未决Effect时另作current Control查询并改判分支。
3. Rejection Planner仍只有一个精确Evidence Work dependency，保留 `WorkResultReader` 的完整来源元数据。Control理由使用上面的正式ref；其他理由仍引用原Candidate/Material Verification。装配器重验Work/process、capability、Result basis、Candidate Snapshot摘要和见证成员，使用持久Result的verifiedAtMs形成Decision，禁止旁读current Control刷新理由。
4. 原 `IntakeRejectionDecision → Reasons → IntakeRejectionReceipt → Result/marker → LibraCandidateRejectedMessage` 保持同一原子事务。`libra_intake_rejection_reason_evidence`保存正式ref，Receipt中的reasonSet/rejection digest继续锁定它。无Subject、Binding或Control变更；重复与重启必须重建同一Decision/Receipt。
5. Libra仅在正式Rejected Receipt成立后按原规则释放本Intake Token。Procurement只消费原Rejected Message，经原精确Offer/package/Receipt校验将本包Reservation终结为released+handoff_rejected。消息未消费前Reservation继续保护旧材料，不能因为Libra席位已释放便提前借用。原Package不改，后续普通Observation/Triage按当前资格产生新Package；不自动强制启动扫描，也不把其他Owner控制的材料强行重新选入。

### Accepted事务后的三种状态：本批不增加恢复分叉

| 状态与证明 | 处理结果 |
| --- | --- |
| 已commit：同一Accepted Receipt、commit marker及Result等原子事实完整且一致 | 按原Accepted事实重放/继续；不因current Control后来变化而转Rejected，不重建Evidence Work |
| 可证明未commit：原事务明确回滚/未进入提交，且按既有Reconcile合同排除该effect的Commit事实；不是只查不到一行 | 本批仍走原失败/恢复规则，保留原frozen输入、原Effect及席位；**不**自动生成新Control Evidence、Reject或新Work generation。若原前提不再可满足，保持可诊断阻塞，由后续精确恢复处置解决 |
| unknown：事务结局或Receipt/marker/Result一致性未证实 | 保留reconcile_required及既有Fence，不释放席位、不更换输入、不把CAS错误直接翻译为业务拒绝 |

因此可以在本次最小修复中保留全部现有unknown保护。CAS后自动拒绝/重新观察不是让本提案安全成立的前提，明确移出本批。旧两Token仅在另行授权的精确Reset完成后成为新流程；新Evidence从当前事实看见旧Candidate revision不符并正式拒绝，不为旧Plan增加兼容。其余旧队列条目是否需clean-cut处置须发布时逐项预检，不顺带扩大Reset范围。

### 决策边界与验收

**没有必须重新询问的业务决定。** 使用既有Control失配理由、Foundation只读事实/Libra拒绝/Procurement释放的Owner边界、保护原Package/Control和unknown，均已有依据。选择复用Capability、DTO字段/字节界、借用既有Result行的Evidence身份与槽位、schema/manifest生成及测试组织，是可在既有Owner内完成的工程选择；不是要求用户替工程师选择表名或摘要公式。本轮按部署负责人明确要求停留在提案审定状态，并非把每次schema修改一概当作用户审批事项。

**若要扩大范围才需要新的业务/边界确认：** 将已Accepted条目反转为Rejected；依据CAS异常或缺行猜测未提交并释放席位；把未知/坏Control当作普通不符；自动修改Control/immutable Package，或扩大生产Reset/媒体处置范围。上述行为均未包含在提案中。未来CAS后自动新Evidence/Work分叉须另列完整Owner恢复合同，不搭便车加入本补丁。

审定后实施验收至少覆盖：新Candidate发布后、验证前通过正式测试Control命令改变revision/Owner；正式Snapshot证据和拒绝ref可独立重建；原Control/Package逐字不变；反复reconcile/消息重放/两次Host重启无重复Receipt且Token释放一次；释放后当前资格允许时下一轮普通扫描生成新Package；Query unavailable/坏row不拒绝；观察通过后才CAS失配保留未决保护；已有Accepted Receipt绝不反转；篡改见证schema/ID/摘要/来源Work/Candidate成员逐项拒绝。先通过新建流程测试，再对生产备份副本演练旧队列，不能以清旧数据代替根因验收。
