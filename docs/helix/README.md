# ShelfDeck / Helix Documentation Index

Status: Movie Procurement保持`CLOSED FOR MOVIE`。Arca Shelf配置保持`READY FOR LIBRA`；Libra Intake Acceptance达到`READY / AWAITING ROUTING`。下一步Routing Policy尚未开放Implementation Gate，Docker/NAS、Handoff B、On-deck和生产均未开始。

后续本地真实媒体测试的唯一物理范围由用户于2026-08-11固定为
`C:\Users\markm\AppData\Local\Temp\ShelfDeck-P14-20260723\material-fields`。该目录同时作为测试
Material Field和Movie Shelf Physical Target Folder；Libra、Arca及后续Movie E2E不得把`Z:\Film`作为运行时输入。用户仅对测试库seed
追加了只读取材授权：构建器可从两个冻结源目录提取有界8秒片段和复制少量sidecar，但不得在`Z:\Film`写入、移动、重命名或删除。

该根目录现由`media-service/scripts/build-helix-movie-test-library.js`维护22个Movie纵向场景：12个既有
Procurement/Libra输入形态，加10个Formation高风险E2E场景。受管manifest位于`.shelfdeck-test-library\manifest.json`，
同时记录Candidate/Related/Input Form、Related替代与清退、精确授权、故障恢复、Target冲突、跨卷、Reality变化、同根二次
Observation、ISO/DVD和Scope上限预期。Target collision与Reality mutation使用control seed并只允许在manifest指定阶段物化。
构建器只替换ownership marker声明的`SDT-*`路径，旧P14目录不会被清理。

第一次实施的P0–P13资产继续保留，但此前由大型Coordinator同步闭环得到的Movie Canary只证明低层Capability、Owner事实和
Handoff A Ready数据形态可工作，不构成`Work Scheduler → Event Runtime → Resource Governor`已经参与的Foundation E2E证据。
当前唯一活动实施计划见`CURRENT_PLAN.md`。最新`Z:\Film`全库Canary以本机Node.js、全新临时clean数据库和只读源完成，再次验证了`standalone_file|ordinary_directory|bdmv_container`三类Scope、1024物理成员Run上限、`苹果.mkv`独立Candidate、943个Handoff A Ready Offer及源Reality不变。Candidate尾段由281.737秒降至173.523秒，证明整Run重复投影与Coordinator扫描修正有效；Observation与普通Media Probe的本轮耗时变化由用户接受为环境波动。随后全量数据库约束及代表样本复核未发现正确性问题，Movie Procurement因此在Handoff A Ready边界正式封口。完整证据和保留资产记录在`CURRENT_STATUS.md`。

Handoff A之后的第一个Libra节点已经正式接通：Outbox Dispatcher触发薄Intake Coordinator签发Supporting Work，Planner与Event Runtime
执行Candidate、Material、Binding及continuity验证并原子接受。隔离Movie测试库形成19个accepted Intake和19个Subject；Admin Web
“上架进度”按一行一个Subject展示，当前全部为`awaiting_destination`。ISO/DVD依赖typed topology而非扩展名猜测；历史大型Libra
Coordinator不在产品路径中。本轮没有建立Libra Run/Workspace、没有消费Shelf生产资源，也没有产生Handoff B或Arca媒体事实。

Physical Material不再计算全文件Hash。当前唯一合同读取文件正中间最多262,144 bytes并执行前后stat fence；NAS负责bit rot和底层
完整性。Artifact、Canonical JSON与事务Evidence digest仍使用SHA-256，这些digest不得作为Physical Material Identity。

Observation是Procurement后续流程的物理事实起点：每个已观察文件永久写入`proc_field_observation_entries`，
`proc_field_observations`只保存Page/Observation头和compact receipt。Page最多256个文件、64 MiB物理读取；
Eligibility保留在`proc_field_materials`，但只对有界Material-local Change Set重算，完全不变的每日Observation不写Eligibility列。

Observation完成后，Layout只作为Observation entries上的冻结技术Projection供Procurement Triage复用；不再有独立Layout Capability/Event/Result，
Triage不重复解析Page JSON，也不重复扫描NAS目录。Media Probe仍是独立Event，仅对Run Selection执行。

Candidate Assembly现在通过运行时可重建的`TriageEvidenceIndex`按`unitId`直接定位Structure Result，并按`runId + unitId`
共享不可变Candidate Context；Identity、Manifest、Publication不再重复读取完整Run、完整Structure Result或整Field Material。

BDMV采用SSOT定义的拓扑边界：它不是pre-triage的Movie类别，而是Run Creator识别的不可拆分container group。
同一最近`BDMV`祖先目录下的全部terminal Observation成员必须进入同一Run；完整group可与其他group稳定装箱，
最多1024个物理成员，超过上限时整体不建Run。Structure消费完整group并将单标题解析为一个Triage Unit，不能把内部M2TS拆成多个Candidate；
多标题、歧义或结构不完整保持`not_ready`。所需Playlist/Clip/结构依赖必须在Run Admission前完成Observation、Eligibility
和Control，不能由Triage在Admission后静默扩张。每个BDMV容器由`procurement.triage.bdmv.assess@1`一次性完成有限拓扑和选定主标题metadata probe；Structure只消费`BdmvAssessmentEvidence@1`和`UnitScopeReference`，Candidate Context按Scope digest重建成员。

混乱Movie Field的pre-triage边界同样由SSOT固定：Field根普通文件各自形成`standalone_file` Scope；第一层普通目录形成
`ordinary_directory` Scope；BDMV及同级`CERTIFICATE`形成`bdmv_container` Scope。Run与任一Scope都以1024个selected
Physical Material为唯一上限，Related不计数。Structure按冻结Scope决定标题与Related association mode，不重新猜测当前目录，
Candidate Assembly只查询当前Scope；Execution Foundation的16 in-flight Event和Permit语义没有因此改变。

## Architecture authority

`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`是ShelfDeck / Helix唯一架构SSOT。它从产品本体、价值系统、
业务域和领域模型逐层向实现推导；后续Level必须引用前序Level的Canonical Dictionary，不能重新定义
已经固化的术语。

旧的处理链、Membership、全局SourceBinding和线性`onboarding → maintenance → offboarding`
合同已经失效。旧合同只保留为历史证据，不能指导新实现。

## Active documents

| Document | Purpose |
| --- | --- |
| `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` | 唯一架构SSOT；Level 0–10与最终全文审计均已关闭 |
| `LEVEL7_BUSINESS_DECISIONS.md` | 已关闭的Level 7非Canonical业务决策Evidence；没有Open Decision |
| `ARCHITECTURE_REVIEW.md` | 已关闭的非Canonical Review台账；Section 14记录最终全文审计、`FA-04`与Closure Evidence |
| `FUTURE_PRODUCT_CAPABILITIES.md` | 非Canonical Post-Beta能力保留；不属于活动计划或实现授权 |
| `CURRENT_PLAN.md` | 唯一活动计划与Design门禁 |
| `CURRENT_STATUS.md` | 当前架构确认进度、实现差距与安全状态 |
| `CAPABILITY_CONSERVATION.md` | 已完成的Level 7能力守恒Evidence；62项历史能力逐项映射，不覆盖SSOT |
| `KAIROX_CAPABILITY_CATALOG.md` | 62项历史Capability目录快照；不定义clean Owner或调用方向 |
| `acceptance/FLOWPLAN_BUSINESS_PARITY.md` | 旧Kairox FlowPlan复刻验收Evidence；不定义clean业务流程 |
| `acceptance/MOVIE_OPTIMIZE_POLICY_CALIBRATION.md` | Movie空间策略的历史校准证据；Level 5已将其结论收录为推荐Rule Template初始值 |

## Reading order

~~~text
TOP_DOWN_ARCHITECTURE_CONFIRMATION.md
CURRENT_STATUS.md
CURRENT_PLAN.md
LEVEL7_BUSINESS_DECISIONS.md（仅追溯已关闭的Level 7业务决策审计；非Canonical）
ARCHITECTURE_REVIEW.md（仅追溯Architecture Review；非Canonical）
~~~

只有在处理能力守恒或现有实现审计时，才继续读取Capability文档或历史归档。

## Historical archives

- `archive/pre-top-down-2026-07-14/`：Top-down SSOT之前的Helix架构、服务合同与Triage专题文档。
- 组件专题归档：更早的架构、实施计划、切片和验收证据；不进入活动阅读顺序。

归档文档保持原样以便追溯。它们不再是活动合同、活动计划或当前状态来源。

## Conflict rule

1. `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`高于所有其他Helix、v3、v2和实现说明。
2. `CURRENT_STATUS.md`只报告当前状态，`CURRENT_PLAN.md`只规定当前工作顺序；二者不得改写SSOT。
3. Capability目录、历史实现和测试只提供Evidence，不能反向证明旧业务边界仍然有效。
4. 当前不得依据归档文档恢复编码、E2E或生产部署。
