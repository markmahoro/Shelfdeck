# ShelfDeck Clean Helix Engineering Playbook

Status: active non-Canonical engineering governance；适用于版本开发与上线后问题处理，具体范围以用户授权为准；活工作以 GitHub PR 为台账（见根 `AGENTS.md` PR-ledger 指针）。

Last updated: 2026-10-31

## 1. Purpose and authority

本文规定clean Helix实施工作“如何组织、变更、验证和收口”。它不定义Business Domain、Owner、Handoff、Object、
Policy、Capability、Schema、API或产品旅程；这些内容只由`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`定义。

权威顺序固定为：

1. `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`：唯一架构SSOT；
2. 本Playbook：长期工程过程规则；
3. GitHub PRs：活工作台账（`open` / `merged` / `closed-wontfix`）；根 `AGENTS.md` 仅作 PR-ledger 指针；
4. `CURRENT_PLAN.md`：可选一行产品/发布目标与依赖说明（非工作项列表；**非默认通读**）；
5. `CURRENT_STATUS.md`：授权部署后的生产身份 stub（长叙事已归档；**非默认通读**，不产生授权）；
6. implementation Evidence和历史归档（含 legacy `CURRENT_PHASE` 包归档）。

`implementation/CURRENT_PHASE.md` 现为 legacy stub，**不是**默认阅读，也不是排期/backlog 来源。

本文与SSOT冲突时立即以SSOT为准，并修正文档或实现。Playbook不能把工程便利升级为业务合同。

关键词解释：

- **必须/禁止**：不满足即不能开始、合并或过闸；
- **应当**：默认执行，偏离时必须记录理由和Evidence；
- **可以**：在不破坏上位合同的前提下由实现选择。

## 2. Operating model

按2026-09-30用户明确纠正及后续 PR-ledger 决定：历史 register 编号（旧文档中的 `UAT-NNN`）只作 Evidence 追溯键，**不是**排期/backlog 语言。活增量以 GitHub PR 标题与链接管理；可选一行产品/发布目标可写在 `CURRENT_PLAN` 或薄 `CURRENT_STATUS` stub。不建立第二套全局编号台账，也不把 legacy `CURRENT_PHASE` 当活工作队列。

已有 register 编号及历史记录全部保留，不重排或复用；历史误登记项保持原事实，不作为新增开发编号先例。PROD/UX/AC/BR只作为历史别名，不再新增。

`CURRENT_PLAN` 至多维护一行目标与依赖说明；`CURRENT_STATUS` 只在授权部署后写生产身份；流水放 Evidence，完成批次归档，不建立平行活动计划。进度以 PR 状态为准（open / merged / closed-wontfix），不以测试通过冒充用户结果完成。

## 3. Authorization and environment boundaries

### 3.1 Scope and permission

用户最新明确指令及会话中已有授权优先。修复/实施请求包含必要的本地代码、测试、构建和隔离fixture；不需要对每个工具步骤重复申请。只读审计和文档整理可直接进行。用户要求仅设计时不实施功能。具体生产发布、真实媒体改动及破坏性数据操作需要对应范围授权；部署授权不等于任意清库/删媒体授权。文档遗漏或陈旧时先依据会话更正，不能让过时Gate阻止已经授权的工作。

### 3.2 Protected environments

NAS 192.168.12.230:18080是生产。标准发布使用build-image.js、upload-nas-image.js、deploy-nas.js及统一nas-ssh-config.js，验证checksum和dry-run后apply；保留回滚资料。破坏性验证使用本地临时目录/隔离数据库。media-desktop为历史树，不在当前交付范围。真实媒体/生产数据处置必须有精确范围、当前证据和授权，不用旧preflight替代正式流程。

### 3.3 SSOT change control

SSOT仍是唯一架构权威。实现缺陷在既有Owner与合同内修正；真正涉及业务结果、Owner/Handoff、对象连续性或副作用权限的变更，先记录精确冲突、证据与有界方案，取得相应用户确认，再回写SSOT并传播合同/manifest/测试。

同一任务可以完成设计、实施、测试和发布；不强制另建Architecture/E2E/部署任务。已获用户授权的合同调整无需再次确认；未确认的新边界不能因修复便利而改变。纯文案/链接修正不触发业务审批。必须保留可追溯diff、用户决定及验证证据，不能先改实现再补造合同。发现未决冲突只暂停依赖该决定的工作，独立工作继续。

### 3.4 Current-stage runtime continuity discipline

当前Helix迭代阶段采用clean-cut运行数据纪律：除非用户明确指定必须保留的**精确Libra/Formation条目**，所有尚未完成
Arca On-deck Commit的既有整理条目均不享有跨迭代兼容权利。Schema、contract、runtime或执行语义变化后，实施不得为这些
既有条目增加migration、dual-read/write、fallback、resume、repair或其他兼容性代码；应使用经授权的Formation Reset调试工具
清理，再由后续正常Observation/Intake自然产生新运行。Reset本身不得主动触发Observation或Intake。

2026-10-23用户确认的新Administrative Formation Reset取代原物理删除语义：保留历史记录，追加管理性退役，
旧Subject不再调度。退役不是用户取消、Rejected、撤回Accepted或业务成功；不可变Decision/Receipt、终态Run及
Revision、Execution历史必须保留。旧物理删除CLI属于历史调试工具，不得作为新管理入口的实现或生产处置路径。

Reset scope从Handoff A Accepted延伸到Arca On-deck Commit之前，必须显式覆盖Accepted但无
Pre-deck token的Subject、active但缺少Admission Head的Libra Run，以及Subject、Run、Workspace、On-deck
Package与Custody持有的Material Control。Reset只能退役本次范围内的当前占用，不得把仍由Procurement持有的
Control误判成阻塞，也不得删除Procurement事实；Control只追加释放revision，不截断旧revision或回卷后来Owner。
退役范围必须使用`owner_domain + scope/process type + ID` typed identity，不能把
不同类型ID合并成无类型集合。Postcondition必须根据冻结的pre-reset manifest独立反查业务、Execution、Artifact、
Workspace、消息、Receipt、Marker/Result与Control闭包，不能复用scope discovery证明自己完整。

对已有Arca On-deck Commit收藏、同时又有未Commit过程态的**retained Subject**，产品安全Reset必须保留其
`routing_anchor_intake_decision_id`所指向的创立Intake（集合身份锚点），即使未Commit Run material /
pipeline token引用该Intake；season_extension等可回卷中间Intake仍可清除。不得用`--subject-ids`定向绕过或
「兼容Reset」代替该全量安全路径；`RETAINED_SUBJECT_ROUTING_ANCHOR_IN_RESET`仅在删除集合仍会破坏保留锚点时挡板。

Reset必须保护已经Arca On-deck Commit的Shelf Entry与Deck Fact，不得触碰`/media`，生产执行仍需用户对该次生产数据操作
作出明确授权。用户只指定保留某个条目时，授权范围仅限该精确条目的有界迁移或恢复方案，不自动授权通用兼容层。

Reset只解决旧运行数据与新版本合同不再一致的问题。若同一缺陷会在Reset后由新建条目再次产生，必须修复根因并补回归验证，
禁止以反复Reset替代实现修复。

新管理入口覆盖当前工作台，不新增逐片Reset交互。同一Subject可包含已Commit或已结束历史，不能据此删除历史或
释放其收藏Control；冻结清单须独立验证所选当前占用已退役、保护记录不变及全库引用完整性。范围外流程与Workspace
必须保留，不能顺便全局清理。Workspace字节回收与退役提交分开核验；Reset不将旧文件绑定迁移到新Run。

PROD-065 执行失败诊断使用 Foundation 已有 Attempt `evidence_digest` 关联本地诊断文件，composition 注入文件适配器。
内容只含白名单、每条至多16 KiB的技术详情，不含凭据、请求URL或原始网络错误文本；不作为业务事实或副作用授权。
诊断不可用必须明确显示，写诊断失败不得阻止原失败 Outcome 终结。历史缺失证据不能补造，新执行产生新证据。

### 3.5 Deployment ownership

2026-09-28，用户在任务“项目部署负责人”（`01a091f4-c863-7d02-9eea-12614e18f7d0`）明确取消集中部署负责人职责，后续各线程自行负责代码整合、适用验证、标准发布与上线验收闭环。原集中任命为历史安排，不再构成发布前必须交付该任务的门禁。既有任务范围和生产授权继续按各自精确合同执行；此次职责变更不授权任意Reset、媒体处置或扩大业务范围。

工作区清理前核验提交可达性、未提交/ignored文件归属、活跃任务和回滚资料；保护用户修改及未完成工作，不因统一收口覆盖或丢弃。发布仍执行§3.2及固定生产入口；本职责不扩大业务架构、生产数据Reset或媒体处置授权。UI设计规则和验收职责仍按§12.3执行。

## 4. Workspace, branch and change isolation

先检查工作区与用户修改。存在冲突或需要并行隔离时使用独立worktree；已有干净且归属明确的任务工作区可继续使用。**新分支禁止使用 `codex/` 前缀**（既有 `codex/*` 仅为历史残留，逐步合并或退役）；推荐 `sd/<topic>-YYYYMMDD`（人工/本机）或平台默认 `cursor/<topic>-…`（Cloud Agent）。不强制多级计划分支；开发提交关联对应 GitHub PR 与所需 Evidence；历史 register 编号仅作可选追溯键，不为编号重命名现有目录。产品版本与 Changelog 口径见 `docs/v3/VERSIONING.md` 与根 `CHANGELOG.md`；生产部署身份只写薄 `docs/helix/CURRENT_STATUS.md` stub。

同一批次可整合有关联的迭代项，但每项结果独立追溯。并行任务须明确文件归属和统一整合者；不覆盖用户修改，不使用破坏性reset/checkout。清理前核对worktree、临时数据和回滚资料的用途；不按“旧”或“未跟踪”直接删除。代码隔离不授权业务双读写或旧Runtime回流。

长时间完整门禁固定到明确提交的独立验证checkout；开发中的SSOT、生成合同及DDL不得改变该checkout。验收Evidence记录提交与结果，保存日志后清理临时验证worktree。门禁后置检查即使抛错，也必须返回失败并保留此前已完成的fixture输出；不能因汇总异常丢失证据或宣称通过。

## 5. Iteration contract

每个版本开发工作项或上线后UAT问题开工前至少记录：用户可见问题/目标、范围与Owner、证据/合同链接、验收方式。实现后补实现commit、验证结论、部署/未部署状态及未完成风险。小型UI或文档修改不填无关的Effect/事务/复用表。

涉及API、schema、调度或物理副作用时，追加适用的typed I/O、revision、幂等、事务、Fence、资源与恢复合同；涉及历史Runtime提取时才建立function-level reuse ledger。不能用“实现整个模块”等无法验收的宽泛条目代替范围。

## 6. Definition of Ready

版本开发工作项或上线后UAT问题开工前核对以下适用条件；不涉及的事务/副作用条件无需虚填：

- SSOT引用明确且没有互相冲突；
- 唯一Owner和禁止跨域写入边界明确；
- 上游依赖和Phase Gate已通过；
- typed input/output、revision、idempotency和错误合同明确；
- 涉及副作用时，Effect Class、Fence、不可逆点、Receipt和恢复路径明确；
- 涉及事务时，参与者和“全成或全不成”Fact Set明确；
- 从历史Runtime提取代码时，function-level reuse ledger已经登记；维护当前clean模块不重复登记；
- 必需fixture和验证方法可以在授权环境内执行；
- 没有需要用户决定的Owner/Handoff/Authorization/Object continuity问题；
- 工作区、分支和用户修改保护已经确认。

Ready不满足时不得以TODO、临时Store、兼容层或silent fallback开工。

## 7. Standard execution cycle

每个Work Package按固定顺序执行：

1. **Reconfirm**：重读最小SSOT引用、当前Phase包和相关代码；
2. **Inspect**：确认dirty worktree、依赖、旧行为和测试Oracle；
3. **Freeze contract**：先固定typed contract、manifest或transaction fixture；
4. **Implement minimum**：只实现本包Outcome，不顺手扩展相邻Scope；
5. **Verify**：运行本包规定的最小验证集和negative path；
6. **Boundary review**：检查Owner、import、SQL、Effect、Secret和Material权限；
7. **Evidence record**：保存可复验输出、digest、已知未测风险和commit；
8. **Status update**：更新Current Phase/Status，不复制架构正文；
9. **Close or return**：满足Done才关闭；发现合同缺口则返回Design。

禁止先完成大量实现，再在Phase末集中补合同、测试、恢复或安全边界。

## 8. Definition of Done

Work Package完成必须满足：

- Outcome和全部In-scope合同已实现；
- Out-of-scope能力没有被暗中加入；
- 所有Required verification通过，并记录未运行项及原因；
- negative path和适用的crash-window已经验证；
- 没有跨Domain internal import、跨Owner Repository/SQL或裸数据库连接；
- 没有Task、targetGate、Membership、Admission、global SourceBinding、flowKind等旧语义回流；
- 没有未登记旧函数复制或whole-executor reuse；
- Secret、Artifact和大Payload没有进入禁止的Store/Result/日志；
- 文档、manifest和测试与实现同步；
- 用户可见变更满足§11.1的UI引导验收；功能通过不能代替交互可用；
- diff无无关文件、生成物、runtime数据或用户修改；
- review没有未关闭的blocking finding；
- Current Status和Evidence能够从commit复验结论。

“测试大部分通过”“代码已经可运行”“以后再补恢复”都不构成Done。

## 9. Machine-enforced architecture guards

沿用现有机器门禁；变更合同须同步相关门禁，不通过删除失败检查掩盖缺陷。至少包括：

### 9.1 Package and import guards

- `composition/createHelixApplication`是唯一可同时导入五Domain public、Foundation public、Integration和Kernel的模块；
- Domain外部只能导入该Domain的`public/index.js`；
- Domain internal不能导入另一Domain internal/Repository/Capability；
- Foundation不能依赖Domain implementation或业务术语；
- Capability不能导入Facade、Planner、Store、另一Executor或全局Config；
- clean root不能导入旧Libra/Nexora/Kairox/Task Runtime。

### 9.2 Persistence guards

- 只有`SqliteKernel`可创建`better-sqlite3`连接；
- Repository只声明所属prefix的statement；
- Domain不能取得裸Connection或其他Owner Repository；
- 热路径字段不能只存在无索引JSON；
- schema manifest必须机械核对table count、prefix、PK、revision、unique、index和JSON limit。

### 9.3 Semantic guards

clean root禁止出现用于业务模型或路由的：

- Membership、Admission、targetGate、maintenanceComplete、flowKind、global SourceBinding；
- 独立Kairox Store/Facade/Runtime；
- 通用media item business ID或跨域Store；
- Task级Pause/Retry/Execute/priority用户语义；
- hidden post-effect、兼容读写或按媒体类型双轨分流。

允许在测试反例、Evidence locator或明确的forbidden-term manifest中出现这些字符串，但必须有结构化豁免，不能用
模糊目录白名单放行。

### 9.4 Contract manifests

机器可检查manifest至少覆盖：

- package/import boundary；
- function-level reuse ledger；
- 当前Capability、Result family、schema和API manifest；
- canonical transaction/crash fixture index；
- 当前Admin Web surface/journey与Projection consumer关系。

数量和具体模块以现行机器manifest为准；治理文档不复制历史计数作为永久门槛。

## 10. Legacy reuse protocol

本节仅适用于历史Mirex/Kairox等Runtime向clean模型的提取；当前clean代码的维护与共享helper复用不适用此额外流程。每个历史候选函数必须：

1. 登记current file/function或`register[historical-capability-ref]`；
2. 描述历史行为及混入的Decision、Owner、Store、Task/Config、路径和副作用；
3. 绑定唯一clean Owner、target component/capability和typed I/O；
4. 声明Effect Class、Fence、Resource Demand、idempotency和crash window；
5. 只提取pure/protocol/file-transaction内核，删除旧wrapper和隐藏后效；
6. 迁移安全/失败测试向量，再写clean contract test；
7. 通过clean root不反向import旧模块的静态检查；
8. 记录Evidence后方可关闭ledger项。

以下内容不能作为复用单位：旧Service、Runtime、Store、Executor、Task/Gate状态机、Config snapshot、全局路径
resolver、Signal驱动后效和Admin页面业务模型。

## 11. Verification matrix by change type

| Change type | Minimum verification |
| --- | --- |
| Pure model/policy | unit、boundary value、determinism、versioned input |
| Public Facade/DTO | contract、immutability、Owner authority、error envelope |
| Repository/schema | schema manifest、FK/unique/revision/current pointer、scoped SQL、rollback |
| Canonical commit | transaction fixture、revision/CAS conflict、duplicate command、Outbox atomicity |
| Capability | typed I/O、Effect/Fence/Resource、idempotency、cancel/recovery、result binding |
| External adapter | protocol fixture、timeout/retry/breaker、Secret masking、no Domain write |
| File/Material effect | realpath/mount/identity/Fence、stage/switch/verify、pre/post-crash、forward recovery |
| Projection | rebuild、duplicate/out-of-order Outbox、bounded SQL、lag/health、GET no side effect |
| API/Auth | method/path manifest、schema、correlationId、Session/credential revision、idempotency |
| Admin Web / 用户可见Projection文案 | journey、Projection-only、intent confirmation、Activity Ledger、responsive/a11y、§11.1 UI引导验收 |
| Operator tooling | temp directory、digest drift、external backup、hash/fsync、mixed generation、no media-root access |
| Runtime lifecycle | startup/recovering/ready/degraded/faulted/shutdown、unknown Effect、safe checkpoint |

测试通过只是Evidence，不证明未覆盖的Owner或恢复边界正确。必须诚实记录未测风险。

### 11.1 UI引导优先：设计、实现与UAT共同门禁

2026-09-11用户明确要求：前端尽量简单易用，靠UI引导用户，不靠说明性语句补足交互。
本节落实SSOT §9.9.1、§9.9.4、§9.9.6–§9.9.7，不新增业务状态、Owner或授权语义。
适用于全部用户可见变更，包括后端生成的展示文案、bug fix、UAT后的追加修改；不只适用于专门的UX改版。

**先安排状态与操作，再写辅助文案。** 实施前在现有Work Package或issue中简述：用户要完成什么、
首屏如何识别当前状态、在哪执行下一步、如何确认结果。默认先用布局、分组、短状态、真实数量/进度、
明确按钮和合理默认值解决；发现必须加一句解释才能使用时，先修正信息结构或控件。普通UI取舍由工程侧完成，
不为标签、布局或文案选择新增用户审批。

| 情境 | 默认呈现与交互 | 不通过的补丁 |
| --- | --- | --- |
| 正常进行/自动等待/容量已满 | 原位置的短状态、真实数量或进度；可调整时提供就地入口；无需操作时不制造待办 | 常驻「当前整理数量已达上限，其余材料继续等待」或弹出告警教用户理解调度 |
| 缺配置/首次使用 | 空态最多一句原因，配一个能到达配置位置的明确动作 | 只有「请先配置……」而没有可达入口 |
| 输入无效/操作受阻 | 相关字段或控件就地指出具体原因；有恢复动作时直接可达 | 泛化禁用、无原因转圈，或让用户读页头教程找原因 |
| 成功/完成 | 对应对象状态或结果更新，必要时短反馈；按钮、确认和结果术语一致 | 用成功说明替代实际结果，或多个位置重复播报同一事实 |
| 危险操作/复杂诊断 | 确认时展示精确范围和后果；实现细节按需展开 | 平时反复声明文件安全，或把必要授权后果藏进Tooltip |

“简单”不等于删除有用信息：保留清楚的标签、简短等待原因、字段约束、必要风险确认和无障碍名称；
状态不能只靠颜色或无标签图标，核心操作不能依赖hover。帮助只补充低频知识，不承载完成主任务必需的信息。
计数、等待原因、可用操作和进度必须来自Owner正式事实；不能把接收额度当转码并发数，也不能编造队列、ETA或恢复动作。

**完成前必须做一次不靠额外讲解的任务走查。** 操作者从正常入口使用界面，不依赖源码、日志、工程师口头提示或
页面常驻教程来理解业务主流程；仅凭控件标签、状态、就地校验和必要确认即可完成任务。覆盖受影响的正常态及
适用的空态、等待/满额、需处理、失败和完成态；同时检查窄屏与键盘路径，不能只看成功截图。

- 审查全部新增/修改的用户可见句子：它是否提供当前操作必需的新信息，是否已由控件或状态表达，是否泄漏内部术语。
  需要靠说明弥补的入口、状态或反馈缺失，必须作为UX缺陷处理；不能以“后台正确”或“解释清楚了”关闭。
- 自动化测试优先验证状态、数量、操作可达/可用、交互后的结果，以及与公开Projection的一致性。
  必要标签、错误原因和确认后果可以断言文本；不得把冗余解释句的存在写成业务正确性的Oracle。
  固定禁词表只能辅助检查，不能靠给禁句换同义词通过验收。
- 在原Work Package或issue的Evidence中记录页面/状态、用户动作、可见反馈、截图或操作轨迹、对应版本及未测项。
  后续提交只要影响用户表面，就重走受影响路径；旧UAT PASS不覆盖新diff，也不能用文案单测替代交互验收。
- 若仅完成代码或文档审查，必须如实记录；缺少实际页面走查时，不得宣称UI/UAT PASS。

### 11.2 三层验收与 RED-first（用户批准流程）

2026-10-31 用户批准的验收分层；写入本 Playbook 为仓库内 durable 过程规则。不另建平行计划文档。规范补齐后须先完整跑通第 1–2 层；均通过后再提合入/部署。未通过不提部署。

| 层 | 角色 | 要求 |
| --- | --- | --- |
| **1 · Agent 驱动** | 项目级 `.cursor/skills/verify-shelfdeck/` skill | Agent 按 feature map 在隔离环境 Launch → Doctor → Drive → Evidence → Cleanup；覆盖本变更相关 journey，不替代合入门禁 |
| **2 · 合入门禁** | CI / 真 E2E（`tests/runner.sh` 等） | Merge gate 必须覆盖已知用户痛点路径；**RED-first**：对现网/分支上已知洞，须先让门禁在未修产品时失败，再修根因到绿。禁止安慰剂门禁、事后补丁式“必绿”断言 |
| **3 · 生产** | 仅授权后的复验 | 生产只做授权范围内的抽查/复验，不是首次发现洞的地方；未获该次生产授权不得碰 NAS |

交叉引用：skill 路径见 [`.cursor/skills/verify-shelfdeck/`](../../.cursor/skills/verify-shelfdeck/)（若当前 tip 尚未合入 skill 树，以该路径为 intended home，随 verify-shelfdeck skill PR 落地）。Helix SSOT / 生产门禁（§3）仍高于本分层。第 2 层“真 E2E”指隔离环境跑通全流程至可举证结果，不是仅 schema/observe 套件绿。

## 12. Review model

### 12.1 Work Package review

每个Work Package关闭前执行：

- contract-to-diff追溯；
- Owner/import/Repository审查；
- Effect/Material/Secret安全审查；
- test output和未测风险审查；
- reuse ledger和manifest审查。

### 12.2 Phase Exit Audit

Phase结束时必须独立于实现顺序，从SSOT反向检查：

- Phase Outcome是否完整；
- 是否产生跨域authority或隐式新业务对象；
- 所有Work Package是否Done；
- Phase-level negative path和恢复是否闭合；
- 后续Phase是否被提前耦合；
- 旧Runtime是否仍保持不可达；
- Evidence是否可从commit和manifest复验。

大型边界变更应安排独立审查；不是每个修复都强制盲审或扫描完整SSOT。疑点先查相关合同及直接依赖，证据涉及更广范围时扩展审查。

### 12.3 UI负责人及统一设计约定

2026-10-13用户调整验收分工：**纯UI层开发**由实施任务核验具体版本并记录受影响页面、状态、操作结果及适用截图/测试Evidence；完成这些核验后，不再要求UI负责人重复审核。**其他层开发同时涉及UI改动**（包括后端生成的展示文案或改变用户可见Projection）仍须UI负责人审核具体版本。按实际diff划分，不能把跨层开发标为UI任务以绕过审核；尚未核验不等于自动通过。两类开发均继续遵守§11.1、版本绑定及受影响路径重验要求，不改变业务结果、生产授权或架构边界。以下任命及Series节点记录保留为历史安排；当前验收分工以本段为准。

2026-09-30用户进一步明确：Series开发按Master Plan/Phase的5个节点推进，所有适用UI结果由UI负责人负责验收。实施任务先协调设计，再提供具体版本的页面/状态、操作结果及截图/测试Evidence；缺少负责人对该版本的适用验收结论，涉及UI的节点不能关闭。后续用户可见diff重新提交受影响路径验收；开发工作及UI验收记录归所属Phase工作项，上线后测试问题才使用UAT。

2026-09-12，用户任命任务“UI负责人”（任务ID：`01a0912a-0086-74e2-88ab-536c59d3862a`）统筹本项目所有涉及UI的改动，包括页面、组件、交互、状态和后端生成的用户可见文案。实施任务负责实现与验证；UI负责人协调设计做法、受影响文件和实现复查，避免各任务各自形成规则。用户已确认范围内的日常UI取舍由负责人判断，不逐项向用户索要许可；业务结果、授权范围和架构边界仍按既有合同处理。发布由项目部署负责人统一协调。

已确认的设计原则：

- 同一页面的信息只出现一次；标题、图标、标签、折叠和外层容器必须增加信息、识别或交互价值。去掉后这三者不受影响的元素应删除。
- 通过结构、控件和短状态引导，不使用常驻说明段落弥补界面问题，不展示用户不理解的技术标识。必要字段约束、具体错误原因、授权范围与后果确认、无障碍名称仍须保留。
- 状态、配置、必要提示采用统一字号与语义配色，状态同时有可读名称，不能只靠颜色。沿用既有token与按钮组件；普通正文/按钮14px，按钮36px高、6px圆角，不随任务新造样式。
- 页面分区统一使用卡片；只保留承载实际分组的卡片层级，不混用装饰性下划线或无内容的多层边框。同一作用范围的按钮同组、同排对齐；必要折叠入口的样式、位置和点击范围统一。
- 用户视角下应用操作围绕配置组织，不把界面重构为人工任务调度台，不另造“操作主次”流程。功能任务所需的具体决定沿用明确授权及现有入口。
- 有用数量在对应对象或区域就地表达，避免再加重复的全局汇总。单纯重述正常用途的标签应删除，例如收藏架的“可接收整理结果”；影响使用的实际异常和生命周期状态保留。

当前UI polish的范围约束：页面数量不变，仅前端呈现；媒体整理工作区现有列表保持，不能借通用样式改动其结构、列宽、筛选、分页和入口。本轮以最大化桌面为验收视口，不因适配多个尺寸扩大改版。后续功能需求只在其独立授权范围内扩展，不因UI负责人任命而自动实施扫描建议。具体实现和走查证据仍进入原UAT项，不另建平行活动计划。

## 13. Change classification and escalation

| Finding | Handling |
| --- | --- |
| Implementation bug | 在现有Owner/合同内修复并补回归Evidence |
| Test bug | 修正Oracle，但不能移动Owner或放宽Invariant |
| Performance issue | 在Owner边界内优化；禁止用共享Store/隐藏缓存越界 |
| Recovery gap | 返回对应Effect/Owner合同；不得以清状态、silent retry或人工DB修复绕过 |
| Architecture gap | 停止相关实现，回到SSOT Design审计 |
| Business fork | 只在改变用户意图、可见结果、不可逆授权、Owner/Handoff或Object continuity时提交用户 |
| Authorization gap | 停止外部动作，请求明确授权，不推断权限 |

用户质疑是复审触发器，不是当前结论自动错误的证据。必须重新核对SSOT和Evidence后给出结论。

## 14. Stop-the-line conditions

出现以下任一情况立即停止当前Work Package：

- 需要让一个Domain写另一个Domain Store；
- 需要新组件接旧Membership、Task、Kairox Store或旧Admin route；
- 需要用Signal、重试或补偿冒充原子事务；
- 需要扩大Material Control、Destruction Scope或Authorization；
- 无法判断崩溃后外部/文件副作用是否已发生；
- 旧代码只有整体复制才能工作；
- 测试只能通过修改Owner/Handoff/Authorization语义；
- 需要silent fallback、临时通用Store、直接DB修复或跳过backup；
- 发现用户工作区修改将被覆盖；
- 当前动作超出已授权环境。

停止不等于工程失败；它保护SSOT不被实现压力反向改写。

## 15. Commit, merge and evidence discipline

- Commit message、代码和代码注释使用English；工程文档使用中文并保留必要English term；
- 一个commit只包含一个可解释的Work Package增量；行为、测试和必要文档应共同提交；
- 不提交`dist/`、runtime JSON、debug dump、生产导出、Secret或旧restructure脚本；
- 不把无关格式化、用户修改或后续Phase内容混入commit；
- 合并范围的blocking finding必须关闭；无关待办不阻断本次独立交付；
- 合入前须满足 §11.2 第 1–2 层（verify-shelfdeck + CI/真 E2E；RED-first 对已知洞）；仅 CI 绿且未经第 1 层/真 E2E 覆盖时，不得当作可合入交付；
- Evidence记录baseline、实现commit、验证命令/范围和未测风险；镜像/文件处置等需要内容身份的场景追加digest，小型文案修改不强制生成manifest；
- Passing tests不是完成声明的唯一依据；Final handoff必须列出未执行验证。

## 16. Status and progress reporting

按Phase工作项或上线后UAT问题报告结果，区分本地验证、生产部署和用户场景验收；当前状态不重复保存历史流水。UI性能必须按真实用户操作验收，单接口延迟不能替代整页体验。验证范围依据第11节和实际影响，不为纯文档或低风险文案改动重复运行全栈测试；所需检查通过后，只有新改动、失败或未决风险才扩大/重复验证。

## 17. Delivery and closure

工作项或问题只有在约定结果、适用检查及要求的部署/用户验收全部满足后才能关闭。统一发布可包含Phase开发交付及多项UAT修复，分别关联同一镜像及各自证据，不能为版本功能交付补分配UAT编号。完成批次冻结Evidence，活动文档只留下当前事项；P13结束后必须拆成独立验收/部署任务等旧Program要求不再约束当前迭代。

本次治理整理前全文见implementation/archive/20260908_PRE_PROD_CONSOLIDATION/ENGINEERING_PLAYBOOK.md；该快照不是现行规则。生产数据、媒体处置、凭据保护和Owner边界约束仍有效。
