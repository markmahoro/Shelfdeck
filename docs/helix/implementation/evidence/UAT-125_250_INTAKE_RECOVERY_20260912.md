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
