# ShelfDeck Libra Handoff B 测试 Agent 交接

Status: `IMPLEMENTATION CHECKPOINT COMMITTED / INDEPENDENT QUALIFICATION PENDING`

Handoff date: 2026-08-13

Exact implementation commit: `11a1bfbbaccaef5c9e48c4cabca60c758f2a0aaa`

Branch at handoff: `codex/helix-first-implementation-retake`（2026-08-23原样改名为`main`）

Current workspace: `E:\my_project\emby_third_party-helix`

本文件面向一位从零接手ShelfDeck的独立测试Agent。它提供项目背景、架构词汇、当前实现边界、测试资产、执行顺序、停线条件和证据要求。它不是Architecture SSOT；任何冲突都以
`docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`为准。

## 1. 本次交接的任务

测试Agent的唯一目标是：

> 对提交`11a1bfbba`中的Movie Libra Run → Handoff B Ready实现做独立资格验收，确认产品确实经过
> `Run → Work → immutable Plan → Event Runtime → Resource Governor → Capability`完成生产，并形成自包含、未消费的Handoff B Offer。

测试Agent不是本轮的实现或架构Agent：

- 不修改产品代码、SSOT、合同、数据库或测试素材；
- 不用测试补丁、直接Store写入、手工Result或同步执行捷径让测试通过；
- 首次失败后立即保留现场并报告，不自行进行实现诊断或连续试错；
- 失败的根因诊断和产品修复返回原开发线程；
- 只有用户另行明确授权后，测试Agent才可以修改测试脚本本身。

本轮不是部署任务。禁止Docker、NAS、生产发布和Git release tag。

## 2. ShelfDeck是什么

ShelfDeck是个人媒体收藏的生产与管理系统。它从用户配置的物理Material Field发现原始材料，把材料整理、生产为符合收藏标准的产品，再交给Shelf进行正式上架。

Emby只是可选External Provider或最终读取Shelf目录的消费者，不拥有ShelfDeck的Material Field、Shelf或Deck事实。

当前Clean Helix架构有五个业务域：

| Domain | 用大白话解释 | 当前Movie链路中的责任 |
| --- | --- | --- |
| Procurement | 从乱文件中发现并分拣“这是什么材料” | Observation、Eligibility、Triage、Candidate Package、Handoff A Offer |
| Libra | 把已接管的电影生产成符合收藏要求的确定产品 | Subject、Routing、Acceptance Spec、Libra Run、Workspace、Product Package、Handoff B Offer |
| Arca | 把Libra交付的产品正式放进收藏架并建立Own事实 | Shelf、Acceptance、Stage/Switch、On-deck、Shelf Entry、Deck Fact |
| User Perception | 保存用户评分、Watched以及外部评分事实 | 评分Resolution影响Acceptance Spec |
| People Management | 维护人物、别名、Provider Identity等 | 本节点只验证Libra输出的Media-Cast引用，不展开人物生命周期 |

Collection Formation只有两次单向Business Handoff：

~~~text
Procurement --Handoff A--> Libra --Handoff B--> Arca
~~~

本轮测试的终点只是`Handoff B Offer=open`。不得消费Offer，也不得建立Arca On-deck Run、Shelf Entry或Deck Fact。

## 3. 为什么当前代码不是旧Mirex/Kairox流程

本工作区是第一次Helix实施的retake，不是从Mirex逐步升级，也不是第二/第三次废弃骨架。

早期第一次实施保留了大量正确的Domain、Schema、Capability和Execution Foundation资产，但Procurement和Libra曾出现大型Coordinator“一竿子插到底”的问题：Coordinator在同一调用栈里规划、执行Capability并收口Run，抢走了Planner和Event Runtime职责。

目前Movie Procurement已经修正并封口，Libra前半段也已逐节点接通：

~~~text
Handoff A Accepted
  → Subject
  → Routing Decision
  → User Perception Resolution
  → Acceptance Spec
  → Libra Run
  → Metadata / Artifact / Remux / Transcode / External Acquisition
  → Product Conformance
  → On-deck Product Package
  → Handoff B Offer=open
~~~

旧的大型`movie-formation-coordinator`、`movie-production-coordinator`和`external-material-coordinator`不应出现在本轮产品执行路径。测试通过不能建立在重新接回这些旧捷径之上。

## 4. 必须先理解的Execution Foundation

所有Domain都使用统一的三层执行模型：

~~~text
Business Run / Process
  ↓ Coordinator签发
Supporting Work
  ↓ Planner生成一次
immutable Plan（DAG of Events）
  ↓ Event Runtime执行
Event → one Capability invocation → one typed Result
  ↓
Resource Governor在每个Event前发放完整Permit bundle
~~~

职责边界：

- Coordinator只签发Work、读取terminal Result、推进Domain状态；
- Planner只生成immutable施工图，不执行Capability；
- Event Runtime租赁ready Event、创建Attempt、调用Capability并绑定Result；
- Resource Governor管理`volume_read`、`volume_write`、`sqlite_write`、`cpu_heavy`、`encoder:<deviceId>`等正式资源；
- 等待Permit不能占有部分资源，也不能阻塞执行线程；
- Runtime技术安全上限为`maxInFlightEvents=16`，它不是某项业务的并发策略；
- durable事实是恢复依据，wake signal只用于加速，丢失后仍必须能恢复。

测试若只看到最终文件，却没有Work、Plan、Event、Attempt、Permit timing和Result链，不能判定Foundation路径通过。

## 5. 当前实现阶段与事实基线

### 5.1 已闭合的前置节点

- Movie Procurement已在Handoff A Ready边界封口；
- Arca Shelf配置已可供Libra读取；
- Libra Intake Acceptance已接通Foundation；
- Routing direct/sorting、真实TMDB unique/ambiguous路径已验证；
- User Perception与真实Douban同步已验证；
- No-rating及1–5星Acceptance Spec已验证；
- Candidate不向用户展示，Admin Web“上架进度”始终一Subject一行。

### 5.2 本提交已经实现的内容

提交`11a1bfbba`包含：

- Libra Run Creator、Admission、thin Coordinator和Lifecycle；
- Product Identity、Metadata、Artifact、Media-Cast和Product Fact链；
- direct、Remux、Transcode、External Acquisition生产路径；
- Workspace媒体效果、Product Verification、Conformance和Output Selection；
- Deliverable Promotion、Product Package和open Handoff B Offer；
- expedited、suspended、superseded、frozen及Discard相关合同；
- GPU优先、CPU `backup_only`和target-size Planner合同；
- BDMV/DVD/ISO的紧凑`ProductionSourceScopeReference`；
- 35场景验收基线和两个E2E入口。

### 5.3 尚未完成的内容

- 35个逻辑场景尚未全部形成独立可重现Evidence；
- 当前主场景脚本尚未在最后两项产品修复后完整重跑；
- 真实MoviePilot升级尚未形成资格证据；现有名为`external-handoff-b-e2e`的测试使用确定性Adapter，不能冒充真实外部E2E；
- Handoff B不得消费，Arca On-deck不属于本轮；
- Docker、NAS和生产均未开始。

### 5.4 文档时间差

`docs/helix/README.md`和`CURRENT_STATUS.md`的一些历史段落仍写着
`ACCEPTANCE SPEC READY / AWAITING LIBRA RUN`。这是提交`11a1bfbba`之前的状态快照，不代表当前代码仍未实现Libra Run。

测试时以以下顺序判断当前事实：

1. 精确Git commit；
2. 唯一SSOT；
3. 本交接与35场景基线；
4. 实际代码和机器合同；
5. 历史状态文档。

## 6. Architecture与测试必读材料

按顺序阅读：

1. `docs/helix/README.md`
2. `docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`
3. `docs/helix/CURRENT_STATUS.md`
4. `docs/helix/CURRENT_PLAN.md`
5. `docs/helix/acceptance/LIBRA_HANDOFF_B_READY_SCENARIOS.md`
6. 本文件
7. 根目录`AGENTS.md`

SSOT是唯一Architecture authority。测试发现以下情况时必须返回Design，而不是在测试侧变通：

- Domain Owner或Handoff责任不清；
- 需要改变Work/Event状态机、Permit语义或Effect Recovery；
- Libra必须写Material Field或Shelf Target才能完成Handoff B Ready；
- Related Material无法以完整disposition mapping交给Arca；
- Package无法在不消费Handoff B的情况下自包含。

## 7. Git与机器合同基线

开始测试前必须确认：

~~~powershell
Set-Location 'E:\my_project\emby_third_party-helix'
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 11a1bfbbaccaef5c9e48c4cabca60c758f2a0aaa HEAD
~~~

预期：

~~~text
branch = main
HEAD   = 当前main提交
11a1bfbbaccaef5c9e48c4cabca60c758f2a0aaa is ancestor of HEAD
~~~

如果commit不同或工作区不干净，停止并向用户报告，不自行checkout/reset/clean。

当前机器合同：

~~~text
Capability              112
Catalog Result family    98
Table                    180
Canonical Transaction     43
Admin route              114
Public health route        1
Domain input             113
Unresolved type ref        0
~~~

当前SSOT source-map aggregate digest：

~~~text
6ce996c86229d6fdd1e4fb4787adfcd1fe7565c75e4a2cd240ee8c8a51292e40
~~~

当前完整P2 contract aggregate digest：

~~~text
519f61a183451c00452d32dcb28c9079bdc4283d6c2facbf9915755ea6124b3a
~~~

## 8. 本地测试安全边界

### 8.1 唯一允许的真实字节测试库

~~~text
C:\Users\markm\AppData\Local\Temp\ShelfDeck-P14-20260723\material-fields
~~~

2026-08-13只读复核结果：

~~~text
regularFileCount = 1131
totalBytes        = 57027472
realityDigest     = 966c8fac23f3b99f02fe63566fb93c365e883d8c8ce34ac185eb3a348a098140
scenarioCount     = 22
~~~

受管manifest：

~~~text
C:\Users\markm\AppData\Local\Temp\ShelfDeck-P14-20260723\material-fields\.shelfdeck-test-library\manifest.json
~~~

只读校验命令：

~~~powershell
Set-Location 'E:\my_project\emby_third_party-helix\media-service'
$verified = node scripts/build-helix-movie-test-library.js `
  --root 'C:\Users\markm\AppData\Local\Temp\ShelfDeck-P14-20260723\material-fields' `
  --verify | ConvertFrom-Json
$verified.verification | Select-Object regularFileCount,totalBytes,realityDigest
$verified.scenarios
~~~

没有用户新授权时，不执行`--apply`，也不传`--source-root`。

### 8.2 绝对禁止的路径与动作

- `Z:\Film`不得作为Material Field、Shelf Target、Workspace、Canary或补充素材源；
- 不得读取、遍历、Hash或探测`Z:\Film`；
- 不得访问NAS生产`192.168.12.230:18080`；
- 不得使用Docker；
- 不得写入、移动、重命名或删除P14 Material Field；
- 不得把Libra Workspace或MoviePilot下载目录放入Material Field；
- 不得把临时clean database指向任何现有ShelfDeck数据目录。

### 8.3 允许写入的位置

每轮必须使用新的系统Temp根，且只允许新增或修改：

- 临时clean database/dataDir；
- 临时Libra Workspace；
- 临时空Shelf Target（Handoff B Ready阶段应保持无媒体变化）；
- 用户确认的隔离MoviePilot下载目录；
- 本轮日志和Evidence导出。

### 8.4 凭据

本机存在私密参考文件：

~~~text
E:\my_project\emby_third_party-helix\moviepilot信息.txt
~~~

它被Git exclude排除。测试Agent只可在用户已授权的真实MoviePilot阶段本地读取，并且：

- 不得把内容复制到聊天、日志、命令回显、文档、截图、Git或测试Result；
- 只能通过Admin Web的正式Integration配置入口提交；
- 不得直接写数据库或构造Secret Handle；
- 报告只记录Integration revision、测试结果和匿名digest；
- 如必须展示命令，使用`<redacted>`占位。

## 9. Acceptance Spec与Production Planner的业务预期

Movie规则：

| Rating | 关键Mandatory Requirements |
| --- | --- |
| No-rating | `mediaForm=stream_file`；不强制HEVC、4K或评分空间上限 |
| 1星 | HEVC、stream file、最终文件≤2 GiB |
| 2星 | HEVC、stream file、最终文件≤4 GiB |
| 3星 | HEVC、stream file、最终文件≤8 GiB |
| 4星 | HEVC、stream file、最终文件≤14 GiB |
| 5星 | HEVC、stream file、真4K-class、白名单高质量主音轨、最终文件≤50 GiB |

重要判断：

- `maxSizeGB`是最终硬上限，不是目标体积；
- `targetVideoBitrateBps`只是Planner施工参数；
- 码率偏离但最终文件合规可以通过；
- 码率看似命中但最终文件超限必须拒绝；
- 已经合规的输入不得为“更接近上限”而重复加工；
- 低清5星输入不得用本地upscale伪造4K，必须走External Acquisition或合法失败；
- 普通GPU顺序为`nvidia_nvenc → intel_qsv → amd_vaapi → remote_worker`；
- `software_cpu`默认`backup_only`，只有普通设备和合法策略带Evidence耗尽后才能生成CPU Plan；
- 设备切换和超限重试必须形成新Work Attempt、Plan、Event、Device Snapshot与Encode Intent，Executor内部不得隐藏fallback。

## 10. 现有自动化入口及其证明能力

### 10.1 架构与回归基线

~~~powershell
Set-Location 'E:\my_project\emby_third_party-helix\media-service'
npm run test:helix-architecture
npm test
~~~

提交前已确认：

- `npm run test:helix-architecture`通过；
- Perception并发评分与Libra Related Control freshness聚焦回归13/13通过；
- 完整`npm test`在最后两项小修复前为244 pass、1个预期环境skip、0 fail，修复后尚未重新跑完整套件。

因此测试Agent应先重新执行完整`npm test`。失败时不要进入媒体场景。

### 10.2 确定性External Acquisition路径

~~~powershell
node --test --test-reporter=spec test/helix-libra-external-handoff-b-e2e.test.js
~~~

它证明正式Work/Plan/Event、MoviePilot协议编排、Workspace Import、Package和Offer，但使用测试Adapter与测试字节，不证明真实MoviePilot可用。

### 10.3 P14真实字节主生产路径

~~~powershell
$env:HELIX_LIBRA_HANDOFF_B_E2E_ROOT = `
  'C:\Users\markm\AppData\Local\Temp\ShelfDeck-P14-20260723\material-fields'
$env:HELIX_KEEP_TEST_ASSETS = '1'
$env:HELIX_TEST_LOG_RUNTIME_ERROR = '1'
$log = Join-Path $env:TEMP ("helix-libra-handoff-b-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
$started = Get-Date
node --test --test-reporter=spec test/helix-libra-handoff-b-scenario-e2e.test.js 2>&1 |
  Tee-Object -FilePath $log
$exitCode = $LASTEXITCODE
$elapsed = (Get-Date) - $started
[pscustomobject]@{ exitCode=$exitCode; elapsed=$elapsed; log=$log }
~~~

该脚本：

- 使用真实P14媒体字节和bundled FFmpeg/ffprobe；
- 创建新的Temp clean DB、Workspace、空Shelf Target、supplemental field和隔离downloads；
- 使用确定性TMDB和MoviePilot Adapter；
- 当前覆盖10个主路径Subject：`M01/M02/M03A/M03B/M05/M06/M07/G08/G09/L06`；
- 期待至少2个Transcode Event、4个Remux Event和1个External Package Verify；
- 要求所有10个Subject形成唯一active Run及open Offer；
- 要求failed Work/Event、Offer消费和Arca Shelf Entry均为0；
- 最后重新校验P14 source Reality；
- 测试timeout为360秒。

这个脚本不是35场景的全部证明。它是主链资格入口。

### 10.4 35场景完整矩阵

唯一场景清单为：

~~~text
docs/helix/acceptance/LIBRA_HANDOFF_B_READY_SCENARIOS.md
~~~

共35个逻辑场景：

~~~text
L01–L11  主生产路径
D01–D08  Metadata / Artifact / Media-Cast / Related
S01–S08  Run Lifecycle / Freshness / Priority
R01–R08  Workspace / Effect / Crash Recovery
~~~

当前没有一条命令能完整自动证明全部35项。测试Agent必须以场景矩阵逐项建立Evidence，不得因为主脚本通过就宣布Handoff B节点封口。

### 10.5 真实外部Integration

真实TMDB与真实MoviePilot必须单独记录：

- 确定性Adapter可以证明编排和恢复；
- 真实TMDB必须证明IntegrationHandle、Identity、Metadata、poster bytes和解码；
- 真实MoviePilot必须至少完成一次搜索、选择、请求、完成观察、稳定性验证、Identity/Package验证及Workspace Import；
- MoviePilot只能下载到隔离目录，不能自动整理进任何生产媒体库；
- External Material成功后仍必须通过Product Verification和Conformance；
- 没有真实外部Evidence时，L07不能标记为真实E2E通过。

### 10.6 Admin Web证据边界

现有Node.js E2E通过正式Admin HTTP Facade签发业务命令，能够证明产品后端入口，但不能单独证明浏览器UI。

最终资格验收还需要通过实际Admin Web完成并记录：

- Shelf、Material Field和Routing Policy配置；
- TMDB、Douban、MoviePilot的测试、保存与重新认证；
- Subject评分；
- active Run的加急与取消加急；
- frozen Run的精确Discard；
- “上架进度”一Subject一行及Run/Package/Offer状态展示。

不得为了UI测试暴露Event控制、Capability选择、设备强制选择或清队列入口。

## 11. 推荐执行顺序

严格顺序执行，任一阶段失败则停止：

1. 确认Git commit、branch和clean worktree；
2. 确认Node.js≥20，依赖已安装；
3. 确认没有遗留Node/ffmpeg/ffprobe场景进程；
4. 用builder `--verify`校验P14测试库；
5. 运行`npm run test:helix-architecture`；
6. 运行完整`npm test`；
7. 运行确定性External Acquisition E2E；
8. 运行P14真实字节主场景，设置`HELIX_KEEP_TEST_ASSETS=1`；
9. 审计保留DB、Workspace、Effect Journal、Package和Offer；
10. 使用fresh clean DB验证主动重启与lost wake；
11. 按35场景矩阵补齐Lifecycle、Crash Window、CPU/GPU、Related和Package内容；
12. 最后才通过Admin Web配置真实TMDB/MoviePilot，执行真实L07；
13. 形成逐场景Evidence Matrix，不修改状态文档中的完成态，等待原开发线程复核。

不要并发执行destructive/fault-injection场景。每个R02–R06场景都应使用独立fresh Temp根。

## 12. 必须立即停线的条件

命中任一项，立即终止本轮Node及其ffmpeg/ffprobe子进程，保留现场，不删除资产：

1. P14 Material Field任一文件数量、size、mtime、ctime或Reality digest变化；
2. 发现任何对`Z:\Film`、NAS、生产数据库或既有ShelfDeck数据的访问；
3. dataDir、Workspace、Shelf Target或downloads不位于明确的隔离Temp范围；
4. Handoff B Offer被消费，或出现Arca Handoff B Receipt、On-deck Run、Shelf Entry、Deck Fact；
5. Libra输出写入Material Field或Shelf Target，而不是Workspace；
6. `runtime_error`、fatal、未捕获异常、SQLite损坏或`integrity_check`失败；
7. `failedWorks > 0`或`failedEvents > 0`；
8. 同一Effect产生两个物理输出、同一Run重复Package/Offer、外部请求在恢复后重复；
9. Permit部分占有、死锁、Resource defer持续增长且terminal吞吐为0；
10. 连续10分钟Work/Event/Result/Package均无推进，且没有明确可解释的外部等待或Permit等待；
11. RSS超过2 GiB，或连续10分钟净增长超过512 MiB且吞吐不增长；
12. 出现真实凭据回显、日志落盘或Git状态收录；
13. 任何继续运行可能扩大媒体写入、外部请求、内存或事实污染风险的情况。

以下情况不单独等于Foundation故障：

- 有明确Evidence的业务`not_ready`、`not_found`或`frozen`；
- Run等待外部结果或Resource Permit但仍有可解释进度；
- 一个慢Run存在时其他Run继续产出Offer；
- RSS/WAL随真实吞吐短期波动。

但是，如果业务失败导致35场景中的必需成功场景没有Package/Offer，该场景仍判定不通过。

## 13. 监控与证据采集

启动时记录：

- commit、branch、Node/FFmpeg/ffprobe版本；
- P14 sourceBefore count/bytes/digest；
- canaryRoot、dataDir、databasePath、Workspace、Shelf Target、downloads、log路径；
- Device Probe及Resource Profile；
- Integration revision，但不记录Secret。

运行期间在阶段变化或每10分钟记录：

- Subject / Acceptance Spec / Libra Run状态；
- Work / Plan / Event / Attempt / Result分状态数量；
- Permit timing、Resource defer、in-flight峰值；
- Capability分类和设备使用；
- Workspace文件数量、bytes、WAL、RSS；
- Product Verification、Package、open Offer数量；
- failed Work/Event和首个错误；
- 首个Run、首个媒体效果、首个Package/Offer和全部terminal时间。

成功后必须记录：

- 每场景最终Probe、codec、raster、音轨、实际size和Provenance；
- CPU/GPU实际使用与fallback Evidence；
- 每份Package的Product Manifest、Off-load Context、Related mapping、Facts和digest闭合；
- sourceAfter与sourceBefore逐字一致；
- consumed Offer=0、Arca事实=0；
- DB `PRAGMA integrity_check=ok`；
- 重启后没有重复外部请求、媒体效果、Fact、Run、Package或Offer。

## 14. 上次试跑与已修复问题

最近一次P14场景试跑在用户要求安全收口后停止，保留资产：

~~~text
canaryRoot  = C:\Users\markm\AppData\Local\Temp\helix-libra-scenarios-fe25lC
database    = C:\Users\markm\AppData\Local\Temp\helix-libra-scenarios-fe25lC\data\shelfdeck.db
~~~

停止时大致事实：

~~~text
Libra Run       2
Product Package 0
Workspace       0
failed Event    0
~~~

该数据库`integrity_check=ok`，P14 source未发现写入。它只用于诊断追溯，不能续跑或作为资格证据。

上次运行暴露并已在`11a1bfbba`修复两项产品问题：

1. 两个Subject并发直接评分错误共享同一active Perception Source；现已改为按`subject|shelf_entry`目标生成稳定Source，并新增并发回归；
2. Libra freshness错误要求`related_derived` Binding独立持有Material Control；现已只对`primary_control`验证Control，并保留Related disposition责任。

对应聚焦回归13/13通过，但修复后的P14主场景尚未完整重跑。这正是新测试Agent的第一个媒体资格任务。

上次还观察到一条Procurement业务结果：

~~~text
candidate_disposition_scope_unrepresentable
~~~

不要先假定它是Foundation故障或已经解决。fresh run若再次出现，应记录对应Scenario、Candidate、Related数量和Evidence；若它影响必需成功场景则立即报告原开发线程。

## 15. 合格与不合格判定

### 主脚本合格

- 10个required Subject均有唯一active Libra Run；
- 每个都有唯一Package和open Handoff B Offer；
- Transcode、Remux和External Acquisition均有正式Foundation链；
- failed Work/Event=0；
- consumed Offer=0；
- Arca事实=0；
- source Reality不变。

### 节点封口合格

还必须满足35场景基线的全部八项封口条件。主脚本通过不等于节点封口。

### 不允许的“假通过”

- 只看Admin Web显示成功；
- 只看Package行存在，不核验实际媒体；
- fake Adapter冒充真实TMDB/MoviePilot；
- 直接写Store构造恢复结果；
- 通过消费Handoff B进入Arca证明Package可用；
- 以旧Coordinator同步跑通替代Work/Event链；
- 只核验target bitrate，不核验最终文件实际size；
- 为满足5星4K而本地upscale。

## 16. 异常报告模板

异常时只报告事实，不在测试线程修改实现：

~~~text
Result: STOPPED / FAILED
Commit:
Scenario ID:
First violated condition:
First error code/message:
Last progress timestamp:

Paths:
  canaryRoot:
  databasePath:
  workspaceRoot:
  shelfTarget:
  downloadsRoot:
  logPath:

Last durable snapshot:
  Subjects:
  Runs by state:
  Works by state:
  Events by state:
  Attempts / Results:
  Resource defers:
  Product Verifications:
  Packages / open Offers / consumed Offers:
  Arca facts:
  RSS / DB / WAL / Workspace bytes:

Source reality:
  before count/bytes/digest:
  after count/bytes/digest:
  changed paths:

Process state:
  Node exited:
  remaining ffmpeg/ffprobe:

Assets preserved: yes/no
Minimal reproduction command:
Suggested owner: Foundation / Libra / Procurement / Platform Integration / Design
~~~

不要把凭据、Cookie、API key、完整个人评分数据或外部响应原文放进报告。

## 17. 成功报告模板

~~~text
Result: QUALIFIED / PARTIALLY QUALIFIED
Commit:
Elapsed:
Scenario matrix: X/35

Source before/after:
Device and Resource evidence:
Work/Plan/Event/Attempt/Permit/Result totals:
Capability counts by path:
First offer / all terminal timing:
Packages / open offers:
CPU usage and fallback evidence:
External Integration evidence level:
Restart/replay evidence:
DB integrity:
Arca facts / consumed offers: 0 / 0

Preserved evidence paths:
Unqualified scenarios and exact reason:
~~~

只能在35/35及真实Integration要求均满足时使用`QUALIFIED`。否则必须使用`PARTIALLY QUALIFIED`，即使主脚本通过。

## 18. 测试Agent的第一步

接手后不要立即跑媒体。先向用户回报以下只读检查结果：

1. 已读SSOT及35场景基线；
2. HEAD是否精确为`11a1bfbba`；
3. worktree是否clean；
4. P14测试库是否仍为`1131 / 57027472 / 966c…8140`；
5. 没有遗留场景Node/ffmpeg/ffprobe进程；
6. 准备按“架构门禁→完整回归→确定性External→P14主场景→35矩阵→真实External”的顺序执行。

得到用户继续指示后，再开始耗时或真实外部测试。
