# ShelfDeck Clean Helix Engineering Playbook

Status: active non-Canonical engineering governance；适用于当前UAT迭代，具体范围以用户授权和CURRENT_PLAN为准。

Last updated: 2026-09-08

## 1. Purpose and authority

本文规定clean Helix实施工作“如何组织、变更、验证和收口”。它不定义Business Domain、Owner、Handoff、Object、
Policy、Capability、Schema、API或产品旅程；这些内容只由`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`定义。

权威顺序固定为：

1. `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`：唯一架构SSOT；
2. `CURRENT_PLAN.md`：唯一Master Plan；
3. 本Playbook：长期工程过程规则；
4. `implementation/CURRENT_PHASE.md`：唯一活动Phase执行包，从属于Master Plan和Playbook；
5. `CURRENT_STATUS.md`：当前事实和Evidence指针，不产生授权；
6. implementation Evidence和历史归档。

本文与SSOT冲突时立即以SSOT为准，并修正文档或实现。Playbook不能把工程便利升级为业务合同。

关键词解释：

- **必须/禁止**：不满足即不能开始、合并或过闸；
- **应当**：默认执行，偏离时必须记录理由和Evidence；
- **可以**：在不破坏上位合同的前提下由实现选择。

## 2. Operating model

所有功能、缺陷、UI、性能和运维迭代统一使用UAT-NNN，唯一完整编号入口为UAT_ITERATION_REGISTER.md；原UAT-001–143保留，PROD/UX/AC/BR只作为历史别名，不再新增。一个可独立验收的结果一个编号，重复发现关联既有项，复发保留历史关闭并建立新项。

CURRENT_PLAN只维护顺序、依赖、授权和工作区归属；CURRENT_PHASE只维护当前验收要求及交付链接；CURRENT_STATUS只报告最新部署与未完成事实。流水放Evidence，完成批次归档，不建立平行活动计划。进度区分待实施、本地验证、已部署、验收关闭，不以测试通过冒充用户结果完成。

## 3. Authorization and environment boundaries

### 3.1 Scope and permission

用户最新明确指令及会话中已有授权优先。修复/实施请求包含必要的本地代码、测试、构建和隔离fixture；不需要对每个工具步骤重复申请。只读审计和文档整理可直接进行。用户要求仅设计时不实施功能。具体生产发布、真实媒体改动及破坏性数据操作需要对应范围授权；部署授权不等于任意清库/删媒体授权。文档遗漏或陈旧时先依据会话更正，不能让过时Gate阻止已经授权的工作。

### 3.2 Protected environments

NAS 192.168.12.230:18080是生产。标准发布使用build-image.js、upload-nas-image.js、deploy-nas.js及统一nas-ssh-config.js，验证checksum和dry-run后apply；保留回滚资料。破坏性验证使用本地临时目录/隔离数据库。media-desktop按任务相关性纳入影响审查，不因历史Phase范围被永久排除。真实媒体/生产数据处置必须有精确范围、当前证据和授权，不用旧preflight替代正式流程。

### 3.3 SSOT change control

SSOT仍是唯一架构权威。实现缺陷在既有Owner与合同内修正；真正涉及业务结果、Owner/Handoff、对象连续性或副作用权限的变更，先记录精确冲突、证据与有界方案，取得相应用户确认，再回写SSOT并传播合同/manifest/测试。

同一任务可以完成设计、实施、测试和发布；不强制另建Architecture/E2E/部署任务。已获用户授权的合同调整无需再次确认；未确认的新边界不能因修复便利而改变。纯文案/链接修正不触发业务审批。必须保留可追溯diff、用户决定及验证证据，不能先改实现再补造合同。发现未决冲突只暂停依赖该决定的工作，独立工作继续。

### 3.4 Current-stage runtime continuity discipline

当前Helix迭代阶段采用clean-cut运行数据纪律：除非用户明确指定必须保留的**精确Libra/Formation条目**，所有尚未完成
Arca On-deck Commit的既有整理条目均不享有跨迭代兼容权利。Schema、contract、runtime或执行语义变化后，实施不得为这些
既有条目增加migration、dual-read/write、fallback、resume、repair或其他兼容性代码；应使用经授权的Formation Reset调试工具
清理，再由后续正常Observation/Intake自然产生新运行。Reset本身不得主动触发Observation或Intake。

Formation Reset只有一种语义：物理删除未完成Arca On-deck Commit的整理过程记录，使其在当前运行数据库中
视同从未发生。工具不得保留`normal|nuclear`模式、旧确认串或兼容入口；若产品未来需要“保留过程审计并批量
终止”，必须作为独立正式领域能力设计，不得复用Reset语义。

Reset scope从Handoff A Accepted延伸到Arca On-deck Commit之前，必须显式覆盖Accepted但无
Pre-deck token的Subject、active但缺少Admission Head的Libra Run，以及Subject、Run、Workspace、On-deck
Package与Custody持有的Material Control。Reset可以终结或删除这些孤儿责任，但不得把仍由Procurement持有的
Control误判成阻塞，也不得删除Procurement事实；Reset只回卷首次进入Formation之后的Control revision后缀，
并恢复最后一个Procurement边界。删除范围必须使用`owner_domain + scope/process type + ID` typed identity，不能把
不同类型ID合并成无类型集合。Postcondition必须根据冻结的pre-reset manifest独立反查业务、Execution、Artifact、
Workspace、消息、Receipt、Marker/Result与Control闭包，不能复用scope discovery证明自己完整。

Reset必须保护已经Arca On-deck Commit的Shelf Entry与Deck Fact，不得触碰`/media`，生产执行仍需用户对该次生产数据操作
作出明确授权。用户只指定保留某个条目时，授权范围仅限该精确条目的有界迁移或恢复方案，不自动授权通用兼容层。

Reset只解决旧运行数据与新版本合同不再一致的问题。若同一缺陷会在Reset后由新建条目再次产生，必须修复根因并补回归验证，
禁止以反复Reset替代实现修复。

生产逐片处理可以通过 `--subject-ids` 显式限定未 Commit 的 Subject 集合；这是同一 Reset 语义的范围约束。
显式空集合、无效 ID、已 Commit Subject 必须拒绝；已删除 ID 的重放是无副作用。范围外未完成流程、孤儿记录与
Workspace 必须保留，不能利用逐片操作顺便全局清理。冻结清单仍须独立验证所选闭包清零及全库引用完整性。
对需要保留的 Workspace 文件，应在执行前另行核验并保护；Reset 不负责将旧文件绑定迁移到新 Run。

PROD-065 执行失败诊断使用 Foundation 已有 Attempt `evidence_digest` 关联本地诊断文件，composition 注入文件适配器。
内容只含白名单、每条至多16 KiB的技术详情，不含凭据、请求URL或原始网络错误文本；不作为业务事实或副作用授权。
诊断不可用必须明确显示，写诊断失败不得阻止原失败 Outcome 终结。历史缺失证据不能补造，新执行产生新证据。

### 3.5 Deployment ownership

用户指定“收口并部署上线”任务（`01a091f4-c863-7d02-9eea-12614e18f7d0`）为部署负责人，负责代码合并、冲突处理、工作区清理、生产发布及上线验证；部署顺序、批次与节奏由其根据依赖、交付证据和生产影响自主决定，无需逐次确认常规部署步骤。无需向其他任务广播此次任命；必要的合并依赖、冲突、交付缺项及验收技术协调仍正常进行。

工作区清理前核验提交可达性、未提交/ignored文件归属、活跃任务和回滚资料；保护用户修改及未完成工作，不因统一收口覆盖或丢弃。发布仍执行§3.2及固定生产入口；本职责不扩大业务架构、生产数据Reset或媒体处置授权。UI设计规则和验收职责仍按§12.3执行。

## 4. Workspace, branch and change isolation

先检查工作区与用户修改。存在冲突或需要并行隔离时使用独立worktree；已有干净且归属明确的任务工作区可继续使用。分支默认codex/，不强制Program→Phase→Work Package三级分支；提交与台账关联UAT编号即可，不为编号重命名现有目录。

同一批次可整合有关联的迭代项，但每项结果独立追溯。并行任务须明确文件归属和统一整合者；不覆盖用户修改，不使用破坏性reset/checkout。清理前核对worktree、临时数据和回滚资料的用途；不按“旧”或“未跟踪”直接删除。代码隔离不授权业务双读写或旧Runtime回流。

## 5. Iteration contract

每个UAT开工前至少记录：用户可见问题/目标、范围与Owner、证据/合同链接、验收方式。实现后补实现commit、验证结论、部署/未部署状态及未完成风险。小型UI或文档修改不填无关的Effect/事务/复用表。

涉及API、schema、调度或物理副作用时，追加适用的typed I/O、revision、幂等、事务、Fence、资源与恢复合同；涉及历史Runtime提取时才建立function-level reuse ledger。不能用“实现整个模块”等无法验收的宽泛条目代替范围。

## 6. Definition of Ready

UAT迭代项开工前核对以下适用条件；不涉及的事务/副作用条件无需虚填：

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
| Admin Web | journey、Projection-only、intent confirmation、Activity Ledger、responsive/a11y |
| Operator tooling | temp directory、digest drift、external backup、hash/fsync、mixed generation、no media-root access |
| Runtime lifecycle | startup/recovering/ready/degraded/faulted/shutdown、unknown Effect、safe checkpoint |

测试通过只是Evidence，不证明未覆盖的Owner或恢复边界正确。必须诚实记录未测风险。

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
- Evidence记录baseline、实现commit、验证命令/范围和未测风险；镜像/文件处置等需要内容身份的场景追加digest，小型文案修改不强制生成manifest；
- Passing tests不是完成声明的唯一依据；Final handoff必须列出未执行验证。

## 16. Status and progress reporting

按UAT报告结果，区分本地验证、生产部署和用户场景验收；当前状态不重复保存历史流水。UI性能必须按真实用户操作验收，单接口延迟不能替代整页体验。验证范围依据第11节和实际影响，不为纯文档或低风险文案改动重复运行全栈测试；所需检查通过后，只有新改动、失败或未决风险才扩大/重复验证。

## 17. Delivery and closure

迭代项只有在约定结果、适用检查及要求的部署/用户验收全部满足后才能关闭。统一发布可包含多项UAT，逐项关联同一镜像及各自证据。完成批次冻结Evidence，活动文档只留下当前事项；P13结束后必须拆成独立验收/部署任务等旧Program要求不再约束当前迭代。

本次治理整理前全文见implementation/archive/20260908_PRE_PROD_CONSOLIDATION/ENGINEERING_PLAYBOOK.md；该快照不是现行规则。生产数据、媒体处置、凭据保护和Owner边界约束仍有效。
