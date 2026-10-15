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

- 本次是跨后端/UI开发，按 Playbook §12.3 仍需已任命 UI 负责人对具体版本审核；现有受控 UI/单测不是负责人接受。
- 新鲜生产 204 副本中 S02/S03 的精确保留、真实 Host 正常推进及使用后回退保护资格，由原聊天统一准备；不能由本次历史大副本替代。
- 尚未部署，不将代码、结构演练或局部 Source 性能修复等同于生产体验、整季 Series、长期稳定性或 UAT-320 关闭。
