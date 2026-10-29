# 2026-10-29 Series 并行补丁候选

本记录承接用户本轮拆线程授权，属于 Phase 2 的专属诊断/开发 Evidence，不建立第二份活动计划。生产七条故障需保留并经原任务恢复；本分支没有生产操作或生产成功结论。

## 基线与边界

- 独立 worktree：`C:/Users/markm/.codex/worktrees/shelfdeck-series-parallel-20261029/emby_third_party-helix`；分支 `codex/series-recovery-parallel-20261029`，基线 `a2bf2d6fd3271dc3a3741e28ed42f533a59d99d4`。
- 最新治理只读参照主整合 worktree。主分支 `f24164ae0` 的 Series 实现来自 `1cf810220`，相关文件之后没有进一步 Series 修改。本轮复用该正确实现，不带入 People、buffalo、MoviePilot、自定义目标、新表或未提交代码。
- 主整合线程独占 SSOT、生成器、全局 manifest/DDL 及活动计划；本线程不修改这些文件。
- Linux Docker 是唯一交付验证目标。本机原生检查仅为开发反馈；NAS 本轮不部署、不重试、不停机、不启动重测试容器、不改库或媒体。

## 已有修复与仍欠缺的证明

七部历史样本：假如…？、真探、亿万、越狱、继承之战、当你沉睡时、飞天大盗。原生产完整只读证据见 `FORMATION_SERIES_AND_MOVIE_DIAGNOSIS_20261028.md`：正式 NFO SHA/大小正确，精确 producer partial 与正式文件的 dev/ino/size/mtimeNs/ctimeNs 稳定相同，partial open 为 EINVAL，另外两项未发布。

`1cf810220` 已实现两项独立修复：严格验证正式文件后证明冗余 hardlink 别名；IO 暂不可观察进入原 Effect 的有界重新观察，真正冲突继续拒绝。恢复不更换 Owner/Scope/Control，不补造 Receipt，不覆盖正式文件。该提交尚未在上述生产基线运行。

已有完整 Host 证据分别覆盖自动恢复、三次不可观察及一般人工重试；本轮增加“终态失败后，用户通过普通重试上架 POST，新 Work 仍遇到不可读 producer alias”的组合旅程，并核对原失败 Work/Attempt 完全保留、唯一 Command Receipt/Commit 及正式 NFO inode 保持。

## 资料修复的精确合同前置

季海报复用和同集语言补充已获主 SSOT 2026-10-28 合同确认，现有实现同样位于 `1cf810220`。生产基线仍缺以下生成字段；这些不是旧包兼容需求，不能用省略 proof 或宽松校验绕过。由主整合线程从该提交的精确最小变更统一整合/再生成后，才可部署资料切片：

| 生成入口 | 最小变化 |
| --- | --- |
| `domain-input-schema-builder.js` 的 `metadataFetchIntentSchema` | Provider Series 精确 Episode 请求允许冻结 `episodePlotPolicyRef=tmdb.episode-plot-language@1`。 |
| `result-type-schema-builder.js` 的 `metadataObservationSchema` | `episodePlotSourceProof` closed proof；仅 Series/provider/显式 episodeScope，保留真实语言、精确 Provider Episode 与剧情 SHA。 |
| 同文件 `ArtifactAcquisitionResult` 分支 | `seasonPosterSourceProof` closed proof；仅 acquired poster，禁止与 JAV derivation 混用。 |

对应生成文件仅 `domain-types/MetadataFetchIntent/v1/schema.json`、`types/MetadataObservation/v1/schema.json`、`types/ArtifactAcquisitionResult/v1/schema.json` 及其登记摘要。**不需要新增表、DDL、数据迁移或双读写。** 本分支不提交生成器/生成文件；资料切片在上述前置集成前不具备独立部署资格。恢复切片没有这个前置。

## 验证记录

- 首轮受限沙箱原生测试中，临时 hardlink 创建被 EPERM 拒绝；记录保留为环境失败，不修改产品代码绕过。
- 权限更新后的本机原生恢复批次：155 PASS / 0 FAIL / 0 skip；日志 `.codex/series-parallel-20261029/native-recovery.log`。该项不是 Linux Docker 资格。
- 本机 Docker Desktop 原先停止，已启动用于独立 Linux 验证；未调用 NAS。
- Linux 固定依赖镜像 `sha256:afb5fad462130beb66162fff081e96d089adf49ee7e2bb600e9fdac72aea0357`（本机已有的生产基线镜像，仅借用 Linux Node/原生依赖），源码使用独立冻结副本、只读挂载、network none、2 CPU/3 GiB，不挂生产。
- Linux 恢复批次：155 PASS / 0 FAIL / 0 skip，`linux-recovery-unit.log`；155 项包含严格 alias 正负例、执行围栏/替换、Observer 归属、原 Effect/Intent/持久恢复预算与 Host 供给。
- 新增 Linux 普通重试+不可读 alias Host 旅程：1 PASS / 29 名称过滤 skip，59.7 秒，`linux-manual-alias-first.log`。EPERM 明确失败留下同 inode NFO/partial，partial 的 open 持续注入 EINVAL；真实 POST `/v1/admin/formation/acceptance/{offerId}/actions/retry` 后新 Work 完成三项共享文件和唯一正式 Commit；原 failed Work/Attempt 完整行不变、原正式 NFO inode 保持、partial 未被 open、重放命令不重复 Commit。
- 首次冻结源码使用 Windows tar 解包时，一个中文 VBS 文件名被本机 tar 拒绝；改用 Git ZIP/.NET UTF-8 解包，失败目录保留。源码/产品实现没有为该环境错误变更。

恢复切片复验：在上述基线依赖镜像中，挂载候选仓库到 `/src:ro`，`NODE_PATH=/app/node_modules`；六文件 unit 批次为 `series-shared-presentation`、`series-presentation-recovery-observation`、`p4-effect-journal`、`p4-effect-reconcilers`、`p4-event-runtime`、`p4-execution-runtime-host`（均 `.test.js`）。Host 使用独立本机 Docker volume 作 `TMPDIR=/scratch`，设置 `HELIX_SERIES_SHARED_UNREADABLE_ALIAS=manual`，运行 `node --test --test-name-pattern="^Isolated Host schedules 2 Episodes through metadata and Direct On-deck Commit$" test/helix-architecture/series-routing-run.test.js`。

恢复切片已独立提交 `a4989adf9`；后续资料切片没有修改该生产恢复算法，只加强测试，追加旧 failed Effect 整行不变及失败时来源文件保留检查。完整资料实现仍逐文件复用 `1cf810220`，只新增精确测试。

| Linux 场景 | 结果 / 日志 |
| --- | --- |
| 三次正式文件 EIO 后原 Effect 自动恢复 | 1 PASS / 29 名称过滤 skip，154.1 秒，`linux-transient-alias.log`；真实 cadence，不刷新预算；partial 始终 EINVAL，0 次打开，唯一 Commit。 |
| 缺季图→同剧 Provider poster→正式入藏 | 1 PASS / 29 名称过滤 skip，52.2 秒，`linux-poster-provider.log`。 |
| 缺季图→已资格化同剧本地 poster→正式入藏 | 1 PASS / 29 名称过滤 skip，46.5 秒，`linux-poster-local.log`；新 Candidate Package 的 fieldRoot/sourceRoot/reference.location 均绝对、精确同祖先；本地三项原字节保持。 |
| 首选语言空→精确同集翻译→NFO→正式入藏 | 1 PASS / 29 名称过滤 skip，46.4 秒，`linux-episode-plot.log`；2 集均有完整 proof，本地季集编号保持。 |
| 资料模型/Adapter/本地来源/真实 Handle 批次 | 首轮 76 项：75 PASS / 1 FAIL，`linux-metadata-unit.log`。失败为新增 H1.1 测试 requestedFields 未按合同排序；同时补齐测试 Season ID。原生首次 74/75、第二次定向失败日志均保留；没有修改产品校验。 |
| 上述唯一失败定向修复后重验 | 1 PASS / 10 名称过滤 skip，17.0 秒，`linux-handle-final.log`；真实 Host composition→IntegrationHandle→Secret Lease→Adapter，仅 HTTP transport 为 fixture；季/剧图片 scope 切换、同集语言补充和外来 Episode ID 拒绝均通过。 |
| IO 增量与文件保护 | 完整 16 PASS / 0 skip，`linux-io-final.log`；追加未知相邻 partial、已有收藏文件的字节及 dev/ino/size/mtimeNs/ctimeNs 保持。 |
| 最终组合来源下普通重试+不可读 alias | 1 PASS / 29 名称过滤 skip，52.0 秒，`linux-manual-final.log`；旧 Work/Attempt/**Effect** 完整行保持、失败期间来源保留，唯一正式 Commit。 |
| Package / forbidden semantics | 两项实际 Linux CLI PASS / 0 findings，`linux-boundary.log`（751 文件、2749 依赖、47 package）及 `linux-semantic.log`（2731 文件）。 |

后四条业务资料旅程及最终组合人工重试使用冻结 `presentation-source-1/2`。测试副本只叠加前述 `1cf810220` 的三个**既有已确认 Schema**，不修改生产分支中的生成器/Schema/registry/manifest/DDL，不从主工作区读未提交代码。这是显式集成前置的测试，不能声称当前分支生成物已自洽。三份原字节 SHA256：

- MetadataFetchIntent：`6937b6486449e6d4b9fe9aa82910f593e2147cec57970aea487fc3f33e381d6d`。
- MetadataObservation：`8e0a20f5645a57e92aeeebb22841c971a5adb8c234d4c00d03dd213e703cf42d`。
- ArtifactAcquisitionResult：`08f75bfb1a8cd8299aa3fc38159d7864890eff038613f8d1db3e9767c0d58c2d`。

所有日志和冻结副本均在本 worktree ignored 的 `.codex/series-parallel-20261029/`。所有测试容器 `--rm` 退出，无生产数据、SMB 来源或 NAS 挂载。没有把首轮失败记为全绿，没有把名称过滤 skip 记为执行。

资料切片提交为 `878d814d3`。最终提交相对生产基线的全部 29 个 JavaScript 文件，已逐字节核对等于最终 Linux 定向验证的冻结 `presentation-source-2`；本次之后只补 Evidence。可复验测试包为本 worktree 的 `.codex/series-parallel-20261029/series-linux-test-source.zip`，13,747,748 bytes，SHA256 `40e0da372ed6390fd0064f6cb1c2f57ece6681af1eb198779736125b8e353420`。包内 `SERIES_QUALIFICATION.json` 记录源码提交、依赖镜像和三个 Schema 前置；只含必要仓库代码/架构资料，没有生产数据、运行配置或私有环境 checklist。它是显式前置下的 Linux 测试源码包，不能作为完成生成合同整合的生产镜像。

## 合同与可部署差异审查

- 恢复仅由 Arca 精确 Scope/recipe 与 Foundation 原 Effect 负责，完整读取正式 NFO 后才允许证明具名别名；任何异 inode、字节、链接/父路径、执行围栏或快照变化仍拒绝。未知文件、其他收藏/来源均无删除权限。
- 季图使用本季 exclusive 输入优先，Provider 本季明确无图后才按已确认策略复用同剧合格本地/Provider 剧图，单独生成季 Artifact。无图、HTTP/协议失败、身份/字节变化分开；两级无图保持 `not_available`，随后标准完整性检查仍明确阻断。
- 同集剧情只使用当前明确 Provider Episode 的 translation 响应；不猜季偏移、不改本地编号、不用整剧简介，显式映射仍需既有确认。欲望都市 S05E01 的历史真实资料核验沿用 2026-10-28 Evidence；本轮未访问或修改其生产 Run。
- Procurement 新包绝对根路径及季图来源已由真实新建包旅程复核，无需新路径修复。旧不可变包/Intent 不改写、不新增兼容读取；既有生命周期由主整合线程按已定义合同处理。七条已接纳发布故障是用户明确保留的精确恢复样本，不通过 Reset 收口。
- 本分支不包含新表/DDL、People、buffalo、MoviePilot 或自定义目标实现；没有 Windows/Electron 发布门禁。资料局部 helper、Libra/Platform adapter 和 Host 透传为必要直接依赖，没有转移 Arca/Libra 所有权。

## 精确生产操作建议与剩余门禁

1. 主整合线程可优先审查并集成恢复切片 `a4989adf9`，与最新已确认 SSOT 同步；该切片不依赖演员、新表或资料 proof Schema。主分支已有 `1cf810220` 相同算法，整合时只保留必要差异及新增组合回归，避免重复实现。
2. 如一并交付季图/同集剧情，主整合线程先按上表统一整合生成器、三个 Schema 与登记摘要，再完成固定候选完整架构/适用 Service、镜像及具体版本 UI 门禁。不能将本分支未同步的生成物直接当生产包。两条既有 frozen 资料任务继续按其明确生命周期处理，不暗改旧包/旧 Spec。
3. 本线程未获生产操作授权，**没有执行以下动作**。后续由主整合线程统一安排真实 CIFS 隔离资格、标准 build/upload/dry-run/checksum/apply；部署前逐项只读核对七条 Offer/build/Scope、原失败/Effect、冻结 NFO 摘要、双路径稳定 stat、三项 Control 与来源/正式保护基线。记录精确镜像/commit/SHA。
4. 经对应生产授权后，沿七条原有 Offer 的 `POST /v1/admin/formation/acceptance/{offerId}/actions/retry` 逐项提交新 idempotencyKey；每条核对新代 Work、旧失败保持、三项正式 Shared Inventory/Control、一次 On-deck Commit 和正常源结算。API/Receipt 重放不能第二次入藏。现场不可观察按原预算等待；真正围栏/内容冲突继续 attention，不手删 partial、改库或 Reset。

真实 CIFS 初始 hardlink/open EINVAL 的服务端/内核时序机制仍未在本轮独立复现；本轮通过实际 Linux 文件系统和精确 IO 故障注入证明恢复行为。七条生产最终结果、最终镜像、完整固定候选门禁与具体版本 UI 仍由主整合线程收口。本 Evidence 不宣称生产已修或 Phase 2 已退出。
