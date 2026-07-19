# ShelfDeck Clean Helix Engineering Playbook

Status: active non-Canonical engineering governance; Design-only until Implementation Gate is explicitly opened.

Last updated: 2026-07-17

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

实施按四层对象管理：

| Layer | Purpose | Completion evidence |
| --- | --- | --- |
| Program | P0–P13 clean-cut替换工程 | P13 Exit Audit与E2E-ready package handoff gate |
| Phase | 一组具有固定依赖和Exit Gate的能力 | Phase Exit Audit |
| Work Package | 一个可独立解释和审查的合同边界 | Definition of Done |
| Evidence | 证明实现符合合同的可复验结果 | test/static output、manifest digest、review record、commit |

进度不以代码行数、文件数、页面数量或主观百分比衡量。只使用已关闭Work Package、已通过Gate、已验证合同和
未关闭风险衡量。

采用rolling-wave planning：Master Plan一次固定Phase顺序；只把当前Phase细化到Work Package。当前Phase通过后，
冻结执行包到`implementation/archive/`，再把`implementation/CURRENT_PHASE.md`切换到下一Phase。禁止同时维护多个
活动Phase详细计划。

## 3. Authorization and environment boundaries

### 3.1 Gate meaning

文档确认、架构Accepted、测试通过和Phase完成都不自动授权下一类外部动作。权限分层如下：

| Authorization | Allowed | Not implied |
| --- | --- | --- |
| Design-only | 文档、只读审计、计划、Evidence整理 | 代码实施、测试、E2E、构建、部署 |
| Local implementation | 本地代码、单元/合同/隔离fixture、文档同步 | 真实来源E2E、Docker、生产、真实媒体副作用 |
| Real-source E2E | 明确范围内的真实来源验证 | Docker/NAS/生产或超出授权的副作用 |
| Build/Canary | 明确Artifact和环境的构建/Canary | 生产部署 |
| Production | 用户明确指定的发布/部署/升级动作 | 超出该次发布范围的数据操作 |

Implementation Gate只有用户明确授权才能打开。当前Gate状态只以`CURRENT_STATUS.md`和`CURRENT_PLAN.md`共同记录
为准；二者冲突时fail closed。

### 3.2 Protected environments

- NAS `192.168.12.230:18080`始终视为生产；
- `media-desktop`不属于本轮clean Helix实施范围；
- destructive测试只允许用户授权的本地临时目录或disposable fixture；
- 当前旧`helixCleanState`/preflight不得用于clean切换或生产；
- 没有明确授权时，不启动E2E、不构建Docker、不部署、不接触真实媒体副作用。

### 3.3 SSOT modification authority is excluded from implementation threads

任何Local Implementation、测试修复、Phase推进、Exit Audit或用户对实施范围的授权，都**不授予实施线程修改
`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`的权限**。本工程的实施线程必须把以下规则作为不可绕过的Design-return gate：

1. 发现SSOT内部矛盾、缺失合同、无法同时兑现的条款或实现所需的架构补充时，立即停止受影响Work Package；
2. 实施线程只能提交Problem Report：精确冲突条款、可复验证据、影响范围、为什么现有合同无法唯一实现，以及有界修正建议；
3. 实施线程禁止直接创建、编辑、修补、重排或“仅机械地”更新SSOT，也禁止先按猜测修改派生合同掩盖问题；
4. SSOT评审与修改只能由用户协调的Architecture Agent完成；实施线程不得代替Architecture Agent作出或落盘架构决定；
5. Architecture Agent的修正只有在用户确认并形成可识别commit/review record后，实施线程才可原样纳入活动Phase；
6. 纳入后先验证SSOT内部一致性、commit/digest和bounded propagation，再更新source map、manifest、机器门禁、测试、
   Current Plan/Status及实现；派生传播不得反向改写SSOT；
7. 一次已批准修正只授权纳入该精确修正，不构成实施线程以后修改SSOT的持续授权。

如果Architecture Agent修正仍有冲突或传播不完整，实施线程继续保持fail closed并再次上报，不以兼容层、豁免、旧结构、
silent fallback或“测试先过”为理由自行选择架构。Phase Exit Audit必须能区分Architecture Agent提交的SSOT变更与实施线程
的派生变更，并证明实施线程没有产生额外SSOT diff。

## 4. Workspace, branch and change isolation

Implementation Gate打开后，实施必须在独立worktree进行，不能直接复用包含用户未提交修改的当前工作区。

默认规则：

1. 从Master Plan指定的基线commit创建长期`codex/helix-clean`集成分支；
2. 每个Phase从clean集成分支创建`codex/helix-p<phase>` Phase分支；
3. 每个活动Work Package从Phase分支创建短生命周期`codex/helix-p<phase>-<slug>`分支或独立worktree；
4. 一个worktree同一时刻只允许一个`in_progress` Work Package；
5. 只有依赖独立、文件所有权不冲突的Work Package可以并行；
6. Work Package满足Done后合入Phase分支；Phase Exit Gate通过后，Phase分支才合入clean集成分支；
7. P13完整切换前，不把clean root接入旧产品主路径；
8. 不覆盖、暂存、清理或提交用户既有修改；
9. 不使用`git reset --hard`、破坏性checkout或隐式丢弃工作区内容。

分支和worktree只隔离代码，不授权双Runtime、双写、双读或旧fallback。

## 5. Work Package contract

每个Work Package在开始前必须具有以下字段：

| Field | Required content |
| --- | --- |
| ID | 稳定`P<phase>-<sequence>`编号 |
| Title | 一个可独立陈述的工程结果 |
| SSOT references | 精确Level/section/table/contract引用 |
| Gap/Evidence references | 对应Gap ID、审计或前序Phase Evidence |
| Owner | 唯一Business Domain或Foundation/Platform技术Owner |
| Outcome | 完成后新成立的能力或约束 |
| In scope | 本包允许修改的component/contract |
| Out of scope | 明确禁止顺手实现的相邻能力 |
| Dependencies | 必须已经通过的Work Package/Gate |
| Inputs/outputs | typed contract、DTO、Handle、Result或manifest |
| Effect and transaction | Effect Class、Fence、UoW、外部副作用和恢复要求 |
| Legacy reuse | current locator、允许提取原子或`none` |
| Verification | static/unit/contract/transaction/recovery/performance/UI要求 |
| Evidence | 关闭时必须保存的输出、digest、review和commit |
| Stop triggers | 触发返回Design或请求授权的条件 |

不允许使用“实现Libra”“完成数据库”“修好架构”等无法独立验收的Work Package。

## 6. Definition of Ready

Work Package只有同时满足以下条件才可进入`in_progress`：

- SSOT引用明确且没有互相冲突；
- 唯一Owner和禁止跨域写入边界明确；
- 上游依赖和Phase Gate已通过；
- typed input/output、revision、idempotency和错误合同明确；
- 涉及副作用时，Effect Class、Fence、不可逆点、Receipt和恢复路径明确；
- 涉及事务时，参与者和“全成或全不成”Fact Set明确；
- 涉及旧代码时，function-level reuse ledger已经登记；
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

P1必须建立机器门禁，后续Phase只能扩展，不能绕过。至少包括：

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
- 112 Capability ref和96 Result family；
- 156 table schema；
- 113 Admin method+path和1 public health；
- canonical transaction/crash fixture index；
- Admin Web九页/九旅程与Projection consumer关系。

P1只建立manifest框架和校验机制；具体112/96/156/113合同在对应后续Phase完成。

## 10. Legacy reuse protocol

旧代码默认不可复用；复用是需要Evidence的例外。每个候选函数必须：

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

大型边界Phase应采用隔离盲审。Suspected finding必须经全局合同审计证明后才能成为架构缺口。

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
- Phase分支只有在全部blocking finding关闭后才能合入clean集成分支；
- Evidence记录至少包含baseline commit、result digest、验证命令/范围、已知风险和实现commit；
- Passing tests不是完成声明的唯一依据；Final handoff必须列出未执行验证。

## 16. Status and progress reporting

`CURRENT_STATUS.md`只报告：

- 当前Phase和活动Work Package；
- Gate与授权状态；
- 最近关闭的Outcome和Evidence链接；
- open blocker/risk；
- 下一动作。

`CURRENT_PLAN.md`只报告Master Roadmap、Phase依赖、Exit Gate和当前Phase指针。Work Package细节只存在于
`implementation/CURRENT_PHASE.md`。

建议进度指标：

- Gap：open / implementing / verified / retired；
- legacy function：unreviewed / registered / extracted / removed；
- Capability、Result、table、route：contracted / implemented / verified；
- canonical transaction和crash fixture：planned / passing / closed；
- architecture guard violation：必须为0；
- undocumented legacy reuse：必须为0。

## 17. Phase transition

Phase转换只能按以下顺序发生：

1. 全部Work Package满足Done；
2. Phase Exit Audit通过；
3. Evidence冻结并链接到Current Status；
4. `implementation/CURRENT_PHASE.md`移动到`implementation/archive/`并标记baseline/closure commit；
5. Master Plan将current phase指针前移；
6. 根据已经稳定的前序合同细化下一Phase；
7. 新Phase开始前重新检查授权范围。

Phase转换不自动授权真实来源E2E、Docker、Canary、生产或破坏性副作用。

P13是本Program最后一个Phase。P13必须冻结一个可被独立验收任务直接消费的E2E-ready package，至少包含exact git commit、
package/artifact manifest、全部local gate Evidence与digest、clean initialization和运行说明、测试数据/凭证边界、已知限制及明确
禁止动作。该交付包冻结并通过P13 Exit Audit后，本实施线程完成，不再创建后续实施Phase。

真实来源E2E与部署分别由两个后续独立任务承担。E2E任务只消费冻结包并产出Qualification Evidence；部署任务只消费通过E2E的
精确Artifact并产出Deployment Evidence。任何E2E失败都必须按缺陷归属返回实现或Architecture Agent，禁止在E2E/部署任务中
加入compatibility、dual-read/write/run或旧Runtime fallback。部署任务不得绕过E2E PASS Evidence。
