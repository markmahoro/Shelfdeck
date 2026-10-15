# Libra 双车间与来源公平：接口审查与本地验证

对应唯一 CURRENT_PHASE 的 `LIBRA-ATTENTION-WORKSHOP` / `LIBRA-SOURCE-FAIRNESS`。开始日期 2026-10-15，最新验证 2026-10-16（Asia/Shanghai）。本记录不是平行活动计划，也不是生产发布或 UAT 关闭证明。

## 用户决定与边界

- 二号全 Libra 共用，默认 5，独立配置 0–32；0 只停止新增转入，缩容保留已有条目。一号每来源原 0–8/默认 3 与 Procurement→Libra 门禁保持。
- Series 按 Subject 整体转入：所有未交付 Run 都需要处理、已有执行与 Effect 安全收口；未分配 primary responsibility 不能被遗漏。恢复后留在二号，所有责任交付/合法终结才释放。
- 用户已明确允许 Foundation 最小通用只读分页执行摘要；随后另行明确允许扩展现有 `updateWaiterPriority`，只刷新已存在 durable deferred 的优先级元数据，不取得 Permit、不增加队列或改变资源/执行语义。
- /adult 部署、生产配置与 UAT-318 性能工作由原聊天承接。本聊天没有停机、部署、Reset、操作生产媒体或修改生产数据。
- 原聊天的 UAT-318 提交 `190e9a9f7` 及后续记录保留；本次不改 `domains/perception` 或 `planning/product-metadata-work.js`。

## 实现落点与不变量

| 范围 | 实现 | 关键约束 |
| --- | --- | --- |
| 二号政策/位置 | `predeck-pipeline-admission-store.js` | 保留原 responsibility token，独立持久位置；同事务检查容量、Owner readiness 与 Foundation 执行摘要；重复转入幂等 |
| Owner readiness | `attention-workshop.js` | 路由缺配置/未解决、身份待确认、业务冻结、策略不可用、挂起恢复及执行异常统一处理；Subject 全体未交付 Run 必须满足；不从 UI 投影授予转入 |
| 转入闭包 | 同上 | 复验 Subject/Run/decision head/路由政策/identity intent/当前 primary bindings；含 Run、Routing、Spec、原 Intake 的 open Work/Event 与未收口 Effect；不取消、硬杀或伪造终态 |
| 恢复与终结 | 既有 Run Coordinator / pipeline release | 原 Run/Workspace/Control/执行记录继续；二号位置不因恢复删除；合法责任 release 才同事务删除位置。Season frozen Run 也阻止提前释放 |
| 来源/Run 账本 | `source-fairness-store.js` | 来源沿用 Subject 既有 token 的 source_field_id；每来源只有一份轮次。Event Attempt ordinal/ID 高水位、时钟、来源与 Run 原子更新；冲突身份拒绝 |
| 执行反馈 | `source-fairness.js` 与 composition executor wrapper | 在实际 executor 入口及时记机会；公开 skinny 摘要补账；不把检查、submit、资源失败、无变化 acquisition/stability poll 当推进；长执行开始即可交棒 |
| 排序 | `libra-run-execution-projection.js` | priorityClass 保持；同一 Projection 用于 Work supply / queued Work / Event / resource waits；有限 bonus 0–95，保留原 completion 100 点间隔与 Foundation aging；大来源集合共享分桶，不承诺逐 Event 严格轮转 |
| 资源等待 | `libra-resource-priority-bridge.js` / `resource-governor.js` | 内存 waiter 和硬上限外 durable defer 都按更高 revision 更新；不修改资源集合、入队/重试时间或发 Permit；重启后从公开摘要重新观察等待者 |
| Admin/API/UI | 全局 secondary GET/PATCH；Settings 的整理空间 | 真实占用、0 与缩容反馈、整数约束、失败重试、键盘路径；独立于来源一号与 Arca 资源 |

默认扫描每 Run 至多每 5 秒读一页 100 Event；随机 Event ID 到页尾循环，持久游标支持重启。排队候选只读已计算的 O(1) Projection，不扫描历史 Result/Plan payload；公平重建只读活跃 eligible Run 与相应来源，不展开结束 Run。公平轮次是执行机会的有限偏好，不是成功数量或副作用完成证明。

Foundation `execution-summary-reader.js` 不含来源或公平业务。分页/精确 Event 摘要包括 Work kind、资源等待 revision 与 latest Attempt，不读完整 Result/Evidence/Plan bindings；事务 participant 最多接受 1000 个精确 process scopes。旧 Result Reader 的既有历史读取不构造这套新摘要 Repository，不为旧未完成 Libra 条目增加兼容逻辑。

## 已执行验证

所有命令均为本地/隔离测试；原始日志在工作区 `.codex/libra-*.log`，不提交运行数据或生产导出。

| 验证 | 结果与范围 |
| --- | --- |
| Service `npm test` 最终整轮 | **645 pass / 29 既有 skip / 0 fail**，674 tests；初轮两个旧主席位 fixture 失败，随后通过公开 API 显式关闭二号以继续独立验证原门禁；缺路由断言按 UAT-320 的 attention truth 更新后重跑整轮通过 |
| Web `npm test` | **190/190**，35 files；新增容量保存/0/缩容、无效草稿、保存失败保留输入、读取失败重试；旧 workspace 结构 fixture 更新为两个有实际作用的分组 |
| 宽/窄 Playwright | **4/4**：二号容量与 UAT-320 路由缺配置旅程各宽/窄两项；键盘保存、0、保留数量、恢复至 32、窄屏无横向溢出。已人工查看实际截图；build/tsc 通过。冻结 UI snapshot 为 `.codex/libra-ui-review-20261016/`，JS `index-Kbt-DVCt.js` SHA256 `484017837528e53f778648c4b37f05620f97c516901ba32fc72c87112e92584f`，CSS SHA256 `82cb8561be6544293d0f6850171d0df02a9a97e53bf60a075ec262ede15df4e2` |
| 原真实 JAV Host 回归 | **1 pass**：HEVC 真实视频、受控单站 HTTP、Workspace Artifact 到唯一 Arca Commit；该早期切片不替代后续组合版本 |
| 二号真实 Host | **1 pass**：主席位 1 / 二号 2，3 个待确认条目；二号满保留一号背压、0 不驱逐、重启保留位置，原 Run 手工确认后在二号继续，Handoff B 后释放，唯一 Arca Commit，重新允许转入后补空位 |
| 三来源真实 Host + 长转码 | **1 pass**：来源 Run 数 2/1/1；早先 Capability 保持 in flight 时其他两来源实际取得并完成执行；真实 1080p/240 秒 H.264 经 FFmpeg 转码并有非零进度时 B/C 已完成 Libra 交付；转码只有一个 Attempt，最终 4 个唯一 Arca Commit |
| Store/Reader/Scheduler/队列 | 覆盖全局容量、回滚/0/缩容、全 Subject、挂起 not_due、frozen Season 责任、Owner fingerprint 变化拒绝、未决 Effect 拒绝；独立 SQLite connections 争最后一席只能成功一个；幂等/重启/中断 ledger；真实 Scheduler 的 Work/Event、completion 与 expedited；durable defer 刷新不改变时间/Permit/队列大小 |
| P2/DDL/manifest/boundaries | 210 tables / 149 routes；P2 aggregate `6d2541d40a33e9db3f4fa2d95ebca40ee69b9e020c97b415ac46109b742ab31b`；契约可重复生成，package boundary / forbidden semantics / manifest findings 均为空。P3 旧 index count 改为准确 107 后专项通过 |
| Linux 本地 Docker 核心 | **36/36**；真实 Windows Docker Desktop `desktop-linux`，037 镜像 `fa6d0a7e9f26` 原生依赖，candidate src/scripts/test 只读挂载，network none、2 CPU / 768 MiB；不是新生产镜像资格 |
| Linux 本地真实二号 Host | **1 pass / 1 名称筛选 skip**：真实媒体到恢复/入藏；长转码选择项没有在这次 Linux 命令中执行，不将 skip 写为通过 |

最终 Windows Host 组合 **2/2**（约 123 秒）已在 5 秒扫描节流及 suspended/not_due 分支修正后重跑通过；Windows 独立 Service 包原生/API 启动及拒绝覆盖测试 **1 pass**，route/TMDB 受影响组合 **21/21**（原两处 real route 计数从 120 修正为准确 122 后复验）。Linux 没有新增 Electron/独立 worker 或完整候选镜像证明。

实际 Host 初轮暴露转入后未补 Intake、以及两次稳定 readiness 等待周期过长，已补 Owner scoped wake 与转入后 refill 并通过。另一处 Oracle 曾把 Handoff B Accepted 的 Run completed 当作 Arca On-deck Commit，已分别等待真实事实；没有改变业务终态。结构差异检查还发现新 ledger 的 event_id 名称会误导 FK 推导，已改为 foundation_event_id，现仅 fx_resource_defer 有批准的旧表元数据列差异。

## 精确 204→210 离线 Operator

入口：`node media-service/scripts/helix-libra-schema-copy.js --source <consistent-204-snapshot> --inspect|--target <new-file>|--rollback-check <210-copy>`。
不覆盖目标，不改源库，不启动业务 Host、请求 Integration、扫描或处置媒体。Windows/Docker 分发均携带工具及精确 source archive。

- source DDL：`6ff9269258f74ae96d99ad770d1bd1d75a2fd38677def2e0e4c1fef2e50ca5ea`（204）。原 JAV 200→204 Operator 继续固定原目标，不跟随当前 generated schema 漂移。
- target DDL：`5e82c36bf1d63e1297cf468361be67c074df3226a64d2dfb755d472db0bbee41`（210）。只新增 6 个 Libra 空表、`fx_resource_defer.priority_revision` 可空元数据；203 个既有表逐行保留，marker 使用新结构身份。
- 结构测试 **3/3**：包括活动 Season Run、未决 Effect、64-bit integer 原样保持；未知 catalog、别名、覆盖与中断拒绝；新政策/ledger/resource revision 或任意旧事实变化阻止基线回退。原 JAV Operator 历史套件 **10/10** 通过。
- 已有历史 204 大副本：源 **3,132,153,856 bytes**，目标 **3,132,252,160 bytes**；192 MiB JS heap 下完整复制 **203 表 / 2,138,297 rows**，逐表 row digest 一致，源 SHA256 前后保持；未使用副本 rollback-check eligible。Receipt 位于 `.codex/libra-workshop-scale-20261015/`，不是当前生产备份。

**明确未覆盖：** 这个历史 204 大副本不含用户指定 S02/S03 两个 Run；不能代替新鲜完整生产副本的保留/正常 Host 推进/回退资格，不能使用旧 Reset 授权清场。另在大副本复制件通过 Libra Admin Owner 保存政策后，rollback-check 按新政策事实明确拒绝；源备份实际复制恢复并以旧 204 Kernel 实开通过。Receipt 为 `used-and-restored-receipt.json`；这仍只是历史结构/Owner 配置/Kernel 资格，不是当前生产完整 Host 或媒体保护资格。

## 仍开放的验收

- 具体版本 UI 门禁已按 Playbook §12.3 由已任命负责人接受，见下节；接受范围不扩展到生产或后续可变后端字节。
- 新鲜生产 204 副本中 S02/S03 的精确保留、真实 Host 正常推进及使用后回退保护资格，由原聊天统一准备；不能由本次历史大副本替代。
- 尚未部署，不将代码、结构演练或局部 Source 性能修复等同于生产体验、整季 Series、长期稳定性或 UAT-320 关闭。

## 具体版本交付协调（2026-10-16）

实现提交为 `1f36d9ed85e1ec48f6d91c14d78617f3df2668af`。用户明确授权后，已将该提交及上述冻结 UI artifact 发送给已任命的“UI负责人”只读审核。

同一授权下，已向原聊天回传实现、验证范围及精确 204→210 Operator。原聊天确认收到，继续负责 UAT-318 与最终升级；当前尚未取得新鲜生产副本，没有提供可供本地资格验证的路径。其后续 `7a378b20c` Foundation 热读性能修改独立于本次实现与既有测试结果，不能继承为本次已验证字节，也不改变本次两项业务合同。

### UI 负责人具体版本接受

负责人聊天“UI负责人”（`01a0912a-0086-74e2-88ab-536c59d3862a`）已完成上述精确实现提交审核，结论 **PASS，无阻断项**。独立校验 2 个冻结产物与 7 个精确提交源文件，共 9 项 SHA256 全部相符；JS/CSS 身份沿用本记录已列摘要，其余 UI 继承 `037592bef4441ceda87b3270f6e70cb7857da3a7` 的接受。

实际浏览器 **8/8**，1920×1080 与 390×844：独立复跑容量/缺路由原脚本 4 项，另补充 4 项，覆盖读取挂起不编造数值、读取失败键盘重试、非法草稿就地校验、保存失败保留输入及原占用、缩容后真实 `7 / 2`、两个来源只打开目标来源、特殊字符 ID、配置读取失败恢复与 Tab 至预览/发布。已目视核对截图，没有产品代码修改。补充脚本首轮 4 个失败属于仓库外夹具的 runtime/completed 返回问题；修正夹具后 4/4，不将首轮失败记为产品通过。

原始只读审核记录位于仓库外 `E:/my_project/helix-git-consolidation-20261008/libra-ui-review-1f36d9ed8-20261016/OWNER_REVIEW.md`；同目录保存 `identity-check.json`、三份最终日志、补充脚本、截图及 `owner-final-review.json`。审核用服务器/浏览器已结束，没有 tracked 文件或生产操作。此项关闭本次确切 UI 门禁，不关闭新鲜副本/发布资格、UAT-320 或整个 Phase；后续用户可见改动仍需受影响范围重验。

原始审核记录 SHA256：`5a678d1d9fa8483528c86409c91fca211be7721a21d4cb61d6e01fedc9c24edb`；`owner-final-review.json` SHA256：`03b4d60bec048f8a319e4a5f1c413a546b321488dc76a5354fcb5ecef5cae172`。

## 新鲜副本完整 Host 的物理资格边界（2026-10-16）

原聊天要求复核本机完整 Host 准备方式，尚未提供新鲜副本。本轮仅核对源码及既有 harness/证据，没有连接或操作生产，也没有启动新的副本 Host。

**当前没有已验证 harness，能在 Windows/Docker Desktop 把生产物理绑定替换为本地目录后，同时保持原 Scope、原 Workspace Handle 并证明完整正常供给。** 原 `JAV_RELEASE_COPY_20261015.md` 已记录本机 candidate 的 `ARCA_AFTERCARE_WORKSPACE_ROOT_CONFLICT`；当时正常供给超过两分钟、33 协调器 cursor 推进的证明来自用户特许的 NAS 同物理挂载隔离容器，不是本机演练。

源码原因：`clean-local-filesystem-mount-probe.js` 使用实际 platform、mountinfo 的 source/mountRoot/filesystem（非 CIFS 还含 device）等证据；`local-filesystem-mount-scope-resolver.js` 校验完整当前 Scope，`aftercare-workspace-store.js` 校验持久 Root/Handle。Host 自行创建真实 probe，没有可用于生产资格的 probe 替身开关。路径名称相同、文件内容相同、只读挂载或复制完整 data，均不能替代这些物理事实；不能改 Root、重新登记 Scope、运行历史 CIFS correction 或伪造 probe 来获得通过。

| 可复用入口 | 已验证范围与使用限制 |
| --- | --- |
| `media-service/scripts/helix-libra-schema-copy.js` | 204→210、203旧表精确保护、未使用回退及使用后拒绝；新鲜副本可沿用此 Operator。完整 data 的伴随文件与 runtime-generation 身份仍需另行复制/核对，不只复制 SQLite |
| `media-service/test/helix-architecture/libra-workshop-host.test.js` | 自建临时介质与正式注册的本地 Scope；已完成 Windows 2/2、Linux 二号恢复 1 条。可以复用真实业务回归，不能换成生产 data 就声称原身份连续 |
| ignored `qualify-production-original-restore-native.cjs` / `qualify-production-candidate-host.cjs`（`.codex/jav-development/`） | Docker native SQLite、network none、无宿主端口、只读外部根、原凭据会话和 stopped Host 的历史模板。candidate 曾在本机失败；固定旧镜像/表数/路径，不能原样执行或称当前正常供给已通过 |
| ignored `nas-jav-rehearsal.cjs` / `nas-jav-rehearsal-runtime.cjs`（同目录） | 已验证过同 NAS 实际物理根、独立可写 data、生产 data/media/Workspace 只读、network none，公开 Resume/Stop 与持久 Receipt 跟踪。含旧 staging/上传流程且固定200→204，不能原样执行；仅能在原聊天取得当前精确授权后按当前210和冻结镜像重新准备 |

安全顺序为：新鲜一致204冷副本和全 data 文件摘要→冻结 S02/S03 精确责任及其余新增事实清单→只读源生成新210目标并核对203旧表、伴随文件和未使用回退→在目标运行环境用真实 probe 对全部根/Scope/Workspace Handle 预检→预检通过才启动完整 Host。完整 Host 只写独立目标 data；外部媒体及生产 Workspace 只读、网络 none、不映射宿主端口，绝不让验证连接生产服务。若真实 Scope 不符，保留拒绝证据，资格止于结构/读入或守卫拒绝，不能自动重新绑定。

保留清单区分不可变事实和可合法推进的 Run 状态：转化前全部203旧表逐行一致；运行后原 Subject/Run/Control/Workspace/Commit 等身份及既有不可变记录保持，允许同一责任的合法新状态/追加事实并逐项说明，不能 Reset 来简化。只读 Workspace 和断网会阻止需要写材料/联网的后续能力；即使 `normalSupplyAllowed=true` 和协调器有推进，也不证明两季实际转码/交付完成。Host 写入技术观察或新业务事实后，旧204基线回退应拒绝；保留未使用副本的回退窗口，不恢复覆盖已使用副本。

## 原聊天合并候选及发布暂缓（2026-10-16）

候选`markmahoro/shelfdeck:dc7dcddbaf`，source `dc7dcddbaf6714d56aaa453610f862914863578f`，本机Image `sha256:54de07e6311167d619113d59970fbccf151b765158f12f597f035682ac0d387a`；tar592582656 bytes，SHA256 `81cd04d16a46e515d9a1aaaf9286881d3d7ac148a841f4a812a6492baf247113`。已走标准build/upload并经NAS和独立本地SHA校验；2356份canonical运行源码逐文件匹配，JS/CSS保持上述负责人接受字节。镜像继承FFmpeg base的OCI revision标签，该标签不是ShelfDeck源提交；本次commit绑定依据干净构建输入及完整运行字节。初轮脚本误将base标签当ShelfDeck提交而拒绝，发生在生产操作之前；后续完整字节验证通过。Windows source Service645 pass/29既有skip，最终实际镜像Foundation68 pass。纯性能修改及部署挂载没有新增UI资产变化。

用户明确回答“暂不进行 NAS 演练”。没有启动本次NAS临时Host、没有新鲜完整副本资格、没有切换schema或部署候选，`/adult`新绑定尚未生效。NAS生产仍原037；之前新鲜备份准备已由公开Stop关闭新增供给，等待封神已有转码收口后公开Resume原版本，不停止/重建容器、不Reset或处置媒体。旧一次NAS特许不复用，新候选不继承旧Host资格。具体现场、镜像、测试和运行控制Receipt保留ignored `.codex/libra-production-upgrade-20261016/`。

最终实际dc镜像补充本机Linux真实Host组合2/2通过，约216秒：二号满背压、原Run就地解决、重启恢复、0与恢复容量；三来源不均匀Run数、阻塞Capability、真实长转码期间其他来源交付，最终四次唯一Commit及单次转码Attempt。首轮我方用768MiB的`/tmp`，低于现有Workspace `1.2×input + 5GiB`预留，故正确停在Workspace admission、等待交付超时；该失败保留。随后改用空间足够的本机Docker native临时卷，产品代码和门禁不变，组合通过；容器退出且精确label核验后的任务卷已删除。此项是新临时介质的业务回归，未改写为新鲜生产副本或真实CIFS连续性。
