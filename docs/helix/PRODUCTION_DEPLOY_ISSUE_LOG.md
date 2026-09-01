# Helix-beta 生产部署问题台账

状态：`NAS PRODUCTION ISSUES OPEN / NO FIX AUTHORIZED IN THIS DOCUMENT`

建立日期：2026-08-28

环境：飞牛 NAS `http://192.168.12.230:18080`，容器 `shelfdeck`。首次 cutover 镜像 `helix-beta-20260828-a3e07a1e1`；当前运行镜像以 `docs/helix/CURRENT_STATUS.md` 为准。Admin Web 走 HTTP，不是 localhost，也不是 HTTPS。

本文记录 **Helix-beta 部署到该生产环境之后** 用户实际碰到的问题。它不是 Architecture SSOT，不替代 `CURRENT_PLAN.md`、`USER_ACCEPTANCE_TEST_ISSUE_LOG.md` 或 `ADMIN_WEB_UX_ISSUE_LOG.md`。Canary/UAT 历史缺陷继续记在原台账；本文只收生产现场。

记录原则：

- 先记用户可见结果和可复核证据，再写初步根因；
- 区分产品缺陷、展示缺口、配置选择和环境限制；
- 不因后台事实最终正确就忽略「当时页面看起来已经结束」；
- 不在本文写入 API Key、Secret、Cookie 或其他凭据；
- **本文不授权实现。** Product Owner 于 2026-08-28 明确：先开文档，先不修。已在现场热修的项只作为历史关闭记录，不把未授权项一并修掉。

## 1. 总览

| ID | 问题 | 分类 | 页面 | 严重度 | 状态 |
| --- | --- | --- | --- | --- | --- |
| PROD-001 | 打开「文件来源配置」整页白屏 | `USER_EXPERIENCE` / 浏览器安全上下文 | 文件来源配置（收藏架配置同样会中招） | Critical | 已热修并部署 `helix-beta-20260828-ef8eec0dc` |
| PROD-002 | 保存文件来源时报 `Cannot read properties of undefined (reading 'digest')` | `USER_EXPERIENCE` / 浏览器安全上下文 | 文件来源配置 | Critical | 已热修并部署 `helix-beta-20260828-c71149f17` |
| PROD-003 | 采购显示「已扫描完成 72 页」，媒体整理工作区当时一条都没有 | `USER_EXPERIENCE` | 文件来源配置、媒体整理工作区 | High | **FIXED in next image**（来源页增加采购进度；空工作区说明目录扫完不等于整理结束） |
| PROD-004 | 文件来源与收藏架都指向容器路径 `/media/Film` | 已确认拓扑 / 同根是必须支持的场景 | 文件来源配置、收藏架配置 | — | **ACCEPTED / 不是缺陷**（2026-08-30 锁定；不得改成拆目录） |
| PROD-005 | 一部都没上架；整理工作区数量看起来卡住 | 配置 / Workspace 根未生效 | 系统设置 Workspace、媒体整理工作区 | Critical | **FIXED by restart on upgrade**。`/transcode` 就是本机 Production Workspace；升级重启后按 durable `/transcode` 生效。冲突错误现带 configured/durable 路径。配置不变。 |
| PROD-006 | 打开媒体整理工作区卡在「正在读取媒体整理工作区…」 | `USER_EXPERIENCE` / 全量分页 | 媒体整理工作区 | Critical | **FIXED**。页面原先等 897 条全部拉完才渲染；现先画第一页，其余后台补齐，轮询只刷新首页。 |
| PROD-007 | 整理协调器 `P9_REFERENCE_MATERIAL_CORRUPT` / remux `P9_MEDIA_OUTPUT_CONTINUITY`，升级后管理端口起不来 | `EXECUTION` / Workspace root identity + startup recovery | 媒体整理工作区 | Critical | **FIXED**。材料句柄用内部 `service-local-workspace`，durable 根是 `local-filesystem-linux`；启动恢复还在 `listen()` 前续跑长时间 remux。句柄按 durable 根无损重盖章；workspace-write 恢复推迟到就绪之后。 |
| PROD-008 | 确认影片身份后仍停在「媒体身份信息冲突」 | `EXECUTION` / 工作准入硬顶 + 展示用旧观察 | 媒体整理工作区 | High | **FIXED**。选择意图已写入，但开放 Work 正好 256，后续 exact TMDB 观察进不了队；页面仍读旧冲突观察。Libra Run 准入放到 1000；有更新的选择意图时不再把旧冲突当待办。 |
| PROD-009 | 试运行长时间没有第一部 Arca 上架；`/transcode` 写满 | `EXECUTION` / Intake 无席位 + Workspace 24h grace | 媒体整理工作区、Workspace | Critical | **FIXED**。Intake 同时只接 3 个未完成 Pre-deck；Off-load Completion 后立即开始回收 Workspace，不再等 24 小时。干净部署后按同一套 Field/Shelf/Workspace/TMDB 取值重建。 |
| PROD-010 | 整理路径不能提前当 checklist 勾选；转码未规划出来时页面仍像「封装完了等验收」 | `USER_EXPERIENCE` / Formation 投影只回放已有 Event | 媒体整理工作区 | Medium | **FIXED** 无损升级 `helix-beta-20260829-e4d601cd9`。 |
| PROD-011 | 片源探测已能判定本地加工补不上时，仍先整盘 remux 再寻源 | `EXECUTION` / Libra 媒体阶段顺序 | 媒体整理工作区 | Medium | **FIXED** 无损升级 `helix-beta-20260829-e4d601cd9`。 |
| PROD-012 | 用户放弃后，工作区仍留「等待重新入库」待整理行 | `USER_EXPERIENCE` / Formation 当前 Subject 与结束历史叠在一起 | 媒体整理工作区 | Medium | **FIXED** 无损升级 `helix-beta-20260829-e4d601cd9`。 |
| PROD-013 | 三部转码停在「编码设备未就绪」；QSV/CPU 能编码但自检全失败 | `EXECUTION` / 编码设备探测校验过严 | 媒体整理工作区 | High | **FIXED** 无损升级 `helix-beta-20260829-0eb39ed97`。 |
| PROD-014 | 转码输入预检用跳转硬解，与正式转码命令不同；超时冻《宇航员》 | `EXECUTION` / 预检命令不是真转码缩小版 | 媒体整理工作区 | High | **FIXED** 无损升级 `helix-beta-20260829-83d3c4424`。已冻结片子需放弃后重新进整理。 |
| PROD-015 | 《怦然心动》上架拷贝后卡在 `product.stage` executing | `EXECUTION` / 指纹门禁把 mtime 当换材料 | 媒体整理工作区 | High | **FIXED** 无损升级 `helix-beta-20260829-83d3c4424`。重启走 startup recovery。 |
| PROD-016 | 放弃整理后 Workspace remux 没删，`/transcode` 空间未释放 | `EXECUTION` / Discard 只清已挂的 Libra 引用 | 媒体整理工作区、Workspace | High | **FIXED** 无损升级 `helix-beta-20260829-83d3c4424`。两份 orphan 目录升级前已删。 |
| PROD-017 | 《影子写手》转码成功，收藏架因原片 5%/50% 解帧拒收 | `EXECUTION` / Arca 把原片抽检绑进成品 Gap | 媒体整理工作区 | High | **FIXED** 无损升级 `helix-beta-20260829-904c415f7`。已拒收的需放弃后重新进整理。 |
| PROD-018 | 《国际市场》寻源耗尽冻结后没有「接受瑕疵」 | `EXECUTION` / 跳过直通验收就去寻源 | 媒体整理工作区 | High | **FIXED** 无损升级 `helix-beta-20260829-904c415f7`。已冻结的需放弃后重新进整理。 |
| PROD-019 | 收藏架拒收后没法放弃《影子写手》 | `USER_EXPERIENCE` / Handoff B 拒收后 Run 仍 active | 媒体整理工作区 | High | **FIXED** 无损升级 `helix-beta-20260829-c547a2f93`。列表页可点放弃。 |
| PROD-020 | 放弃/上架后工作区 remux 与转码 `.partial` 清不掉 | `EXECUTION` / Drain 先删后记账 + 清理名单不含无引用材料 | 工作区 `/transcode` | High | **FIXED** 无损升级 `helix-beta-20260829-6ad8bc999`。 |
| PROD-021 | 《露梁海战》DTS-HD MA 触发寻源且不能瑕疵入库 | `EXECUTION` / 音轨 copy 估满后 infeasible 去 MoviePilot | 媒体整理工作区 | High | **FIXED** 无损升级 `helix-beta-20260829-6ad8bc999`。已冻结片子需放弃后重新进整理。 |
| PROD-022 | 无损升级后容器起不来；启动恢复把旧转码超时残留当硬故障 | `EXECUTION` / 超时重试留下 superseded `reconcile_required` Effect | 服务启动 | Critical | **FIXED** 无损升级 `helix-beta-20260829-6ad8bc999`。 |
| PROD-023 | 放弃整理仍弹出浏览器自带确认框 | `USER_EXPERIENCE` / 只改了接受瑕疵 Dialog | 媒体整理工作区 | Medium | **FIXED** 无损升级 `helix-beta-20260829-79fc055d1`。请 Ctrl+F5。 |
| PROD-024 | 门口 3 席位失效，一次灌进 8 部 Libra Run | `EXECUTION` / Intake 成功到 Run 建立不占席位 | 媒体整理工作区 | High | **FIXED** 无损升级 `helix-beta-20260829-2fe558b95`。已进来的继续跑，不再继续灌。 |
| PROD-025 | 《007：大破天幕杀机》寻源报没有外部候选 | `EXECUTION` / MoviePilot 把 TMDB ID 当标题搜 | 媒体整理工作区 | High | **FIXED** 无损升级 `helix-beta-20260829-d1dd611d4`。已冻结片子需放弃后重新进整理。 |
| PROD-026 | 《教父2》GPU 转码每小时被掐，永远编不完 | `EXECUTION` / Libra remux/transcode 误用 1 小时观察时限 | 媒体整理工作区 | High | **FIXED** 无损升级 `helix-beta-20260830-06d0cc63b`。在途转码按新 Attempt 使用 48 小时时限。 |
| PROD-027 | 长转码页面进度写满后冻住，编码器仍在跑 | `EXECUTION` / ProgressReporter 历史上限连 current sample 一并停写 | 媒体整理工作区 | Medium | **FIXED / DEPLOYED**（current 就地覆盖） |
| PROD-028 | Aftercare 按整份 NFO 字节/指纹修文件，与 Emby 抢同一张说明书 | `EXECUTION` / Presentation 字节全等 + Inventory revision 未随实际 NFO 收敛 | 我的收藏 / Aftercare | Medium | **FIXED / FOLLOW-UP REQUIRED**。语义比较与 Inventory revision convergence 已进入后续镜像；首次修复未覆盖 On-deck post-Placement 后重新 Stage 的来源证明窗口，见 PROD-040。 |
| PROD-029 | 收藏架「全自动 / 关键步骤确认」开关不改变实际上架行为 | `USER_EXPERIENCE` / standing Authorization 未接入 On-deck | 收藏架配置 | Low | **FIXED in next image**（Admin Web 表面已移除；后端 API 保留供后续收口） |
| PROD-030 | 转码前体积预测 freeze 卡死 Run；寻源/转码编排割裂；详情步骤靠 Spec 猜测 | `EXECUTION` / Libra 协调器 + Formation 投影 | 媒体整理工作区 | Critical | **FIXED / DEPLOYED**（双工具穷尽编排 + 实测瑕疵 + 真实步骤） |
| PROD-031 | PROD-024 全局 3 席仍是 derived occupancy；无法按来源暂停/限流 | `EXECUTION` / Libra per-field pipeline token | 文件来源配置、媒体整理工作区 | High | **DEPLOYED** `helix-beta-20260830-5189f5f79c`（2026-08-30；migration + full libra reset；186 tables） |
| PROD-032 | token=0 时历史 Subject 仍批量生成 routing/spec/rating Work，Formation 保持 700+ 条 | `EXECUTION` / Intake replay 与下游 reconciler 绕过 token，Run Admission 过早释放 | 媒体整理工作区 | Critical | **FIXED / DEPLOYED** `helix-beta-20260831-710aa1b65a`（3 seats / 3 tokens / 3 active Works；Formation active 5） |
| PROD-035 | Emby 在 On-deck 检查点之间改写 NFO，检查失败后同一 Run 可无限停在中间态 | `EXECUTION` / Final Verify 在 Placement 前 + 无耗尽后的业务稳态 | 媒体整理工作区 / 上架 | Critical | **DEPLOYED / MONITORING FAILED** `helix-beta-20260831-29efa3a229`；仍有 NFO source stale / director semantic drift，已打回原任务。 |
| PROD-036 | Field Observation 每 30 分钟全量写入导致 SQLite 膨胀，且第 69 页 Event Attempt 长期 `executing` | `CAPACITY` / retention 缺失 + recovery hard deadline 未收口 | 文件来源、`shelfdeck.db` | Critical | **REPLACEMENT DEPLOYED / RECOVERY PASS** `helix-beta-20260831-ae7a567cde`；旧 Work/Attempt/Event/Effect terminal failed，68 页/17,408 Entries 不变；12 小时 cadence 与 7 天稳态继续监控。 |
| PROD-037 | PROD-035 部署后仍误报 director drift，Aftercare source fence 继续刷日志 | `EXECUTION` / Presentation gate 误复用 renderer 字段 + expected CAS conflict 被抛成未知 Effect | 上架 / Aftercare | Critical | **DEPLOYED / MONITORING** `helix-beta-20260831-ae7a567cde`；初始窗口未复发，既有《罪人》未兼容恢复。 |
| PROD-038 | 《罪人》详情吸入 Field-wide 867 个 Plan，attention 显示为 `in_progress` 且无重试动作 | `USER_EXPERIENCE` / Process Plan 因果范围过宽 + Arca attention 投影缺失 | 媒体整理详情 | Critical | **FIXED / PRODUCTION ACCEPTED**。详情使用精确 Candidate Plan scope；完成态显示最新成功 successor。 |
| PROD-039 | 部署 readiness 在 WAL 只读挂载下返回 `SQLITE_CANTOPEN`，脚本仍继续 | `DEPLOYMENT_SAFETY` / 未强制匹配 ready | 生产部署 | High | **FIXED / DEPLOYED**。只读源复制到临时目录验证，输出非 ready 即阻断；最终部署 readiness PASS。 |
| PROD-040 | 同一 On-deck Run 已 Placement 的 NFO 被 Emby 等价改写后，恢复 Stage 报 target occupied | `EXECUTION` / Stage 只认原始 offloadContext，遗漏 durable prior Placement provenance | 媒体整理详情 / 上架 | Critical | **FIXED / PRODUCTION ACCEPTED**。《罪人》同一 Run 已完成 Stage 至 Commit。 |
| PROD-041 | Startup Recovery 已分类 `continue_forward`，却因原 Attempt deadline 过期而永远进不了 Capability | `EXECUTION_FOUNDATION` / 恢复执行误复用原 wall-clock deadline，且没有 durable one-shot recovery budget | 全部非纯 Effect Forward Recovery | Critical | **FIXED / PRODUCTION ACCEPTED**。同一 Effect 一次冻结有界 recovery execution start，重启不续期。 |
| PROD-042 | 3 个 Pre-deck token 均被占用，但只有 2 条 Formation 活动记录，后续 Libra Run 不再进入 | `EXECUTION` / Rejection Planner 把整个 dependency ref 当成 Evidence Work ID | Handoff A Intake / 媒体整理工作区 | Critical | **FIXED / DEPLOYED**。正常新拒绝链会提交 Decision 并释放 token；旧失败条目不做兼容恢复。 |
| PROD-043 | 新三态 SSOT 下约 621 个 Accepted/no-token Subject 表现为“假死 Libra Run”，Reset dry-run 又被 Procurement/package Control 与保留 Run 反向指针阻塞 | `DATA_CORRECTION` / Reset scope 缺口 | Formation Reset / 媒体整理工作区 | Critical | **CORRECTION COMPLETED**。两种 Reset 覆盖孤儿 Subject/Run；获授权 Nuclear apply 已清场，Procurement 与已 Commit 事实保留。 |
| PROD-044 | 统一升级 readiness 因 846 个已终态 Plan 的旧 Catalog digest 阻断启动 | `DEPLOYMENT_SAFETY` / digest 混入 sourceLocator | 启动恢复 / 部署 | Critical | **FIXED / DEPLOYED**。执行摘要排除纯追踪字段；精确旧摘要仅允许全终态历史退役，任何活动执行仍 fail closed。 |
| PROD-045 | 《人生密密缝》Libra 生成 NFO 与自身 Product Fact 不一致，Arca 又在 Placement 后才发现 | `EXECUTION` / 根节点编辑范围与验收顺序 | Libra NFO / Arca 上架 | Critical | **FIXED / DEPLOYED**。根节点多值字段完整规范化，嵌套演员 ID 不再被覆盖；Staged Verify 在 Placement 前执行 NFO 语义门禁。 |
| PROD-046 | 非纯 safe-retry 恢复沿用已过期原 Attempt deadline | `EXECUTION` / recovery budget | Execution Foundation | Critical | **FIXED / DEPLOYED**。分类后的非纯 recovery 冻结一次 durable recovery start；普通 retry 不变。 |
| PROD-047 | 旧 Aftercare reclaim 已提交领域事实，但执行图仍活跃 | `PRODUCTION_DATA` / legacy Receipt residual | Arca Aftercare / Execution Foundation | High | **CORRECTION COMPLETED**。exact 3 条执行图已终止并通过幂等复核；Receipt、领域事实和文件未改。 |
| PROD-048 | Nuclear Reset 删除 Intake Work 后遗留 WorkAdmission Receipt，重入只占 token 不建 Work | `DATA_CORRECTION` / execution receipt scope | Formation Reset / Handoff A Intake | Critical | **FIXED / DEPLOYED / CORRECTION COMPLETED** `0813ae2991`。3,274 张 Libra phantom Receipt 与 3 条 token 已清零；自然 Intake Receipt 全部命中真实 Work。 |

PROD-001、PROD-002 的共同环境前提：生产管理台是 `http://192.168.12.230`，浏览器不提供 `crypto.randomUUID` / `crypto.subtle`。这不是传输加密设计，只是浏览器 API 限制。未改成 HTTPS。

### PROD-036 — Observation 容量失控与 Work 不收口（REPLACEMENT MERGED）

生产只读证据显示完整 Observation 约 39.5 MiB，旧 30 分钟 cadence 相当于约 1.85 GiB/天；SQLite 没有 Entry retention，且普通 DELETE 不会自动缩小文件。卡住 Work 的前 68 个 Attempt/Event 均成功，17,408 条 Entry 恰为 `68 × 256`；第 69 个 Attempt/Event 为 `executing`，没有 Result、marker 或 page header。证据把故障限定在 Page commit 前的 Observation I/O，不能臆测为某个具体 syscall。

首次 replacement `helix-beta-20260831-29efa3a229` 运行超过一小时仍保持同一第 69 个 `executing` Attempt，证明单独传递 abort signal 不构成有界终止。精确实现缺口是 isolation 在 abort 后仍无限等待 operation，且 non-pure recovery timeout 重新抛出后只被 Host 重新排队。新 replacement 只对 Executor 显式声明的 abort-safe Capability 在 deadline 后给 1 秒 settlement grace，随后硬结束 Runtime 等待；Event Runtime 把该 pre-commit timeout 作为 `retryDirective=never` 失败，abandon intent 并终结 Event/Attempt。迟到执行仍须通过已 abort Context 的 commit 门禁。Recovery 沿用原 Attempt durable 开始时间。该 replacement 已随 `helix-beta-20260831-ae7a567cde` 部署，旧 Attempt/Event/Work 与 Effect 均 terminal failed，68 页/17,408 Entries 不变。12 小时 cadence、7 天 retention、incremental auto-vacuum 与离线 compact 保持不变；没有 Work ID 特例或数据修正。

## 2. PROD-001 — 文件来源配置白屏

发现：2026-08-28，用户登录后跳转「文件来源配置」。

现象：该页主内容空白。根因是页面 mount 时 `useState(newFieldId)` 调用 `crypto.randomUUID()`，HTTP 局域网下该函数不存在，未捕获异常导致白屏。「收藏架配置」同样在 mount 时生成 ID，会同样崩。

处理：`media-service/web/src/helix/id.ts` 在无 `randomUUID` 时回退 `getRandomValues`。现场热更新到 `helix-beta-20260828-ef8eec0dc`，未清库。

## 3. PROD-002 — 保存来源时 digest 报错

发现：2026-08-28，用户按 `/media/Film` 保存文件来源。

现象：前端提示 `Cannot read properties of undefined (reading 'digest')`。根因是登记时计算 `policyDigest` 走 `crypto.subtle.digest`；HTTP 下 `crypto.subtle` 为 `undefined`。

处理：`canonicalDigest()` 在无 SubtleCrypto 时用本地 SHA-256，摘要与 Web Crypto / Node 一致。现场热更新到 `helix-beta-20260828-c71149f17`，未清库。SHA-256 在这里是规则合同指纹，不是 HTTPS。

## 4. PROD-003 — 扫描完成但整理工作区为空（FIXED）

发现：2026-08-28，用户配置完成后说：procurement 显示已扫描完成 72 页，媒体整理工作区一个条目也没有。Product Owner 判断为前端展示不够好，授权只登记、先不修。

当时只读现场（不写库、不改配置）：

- 文件来源活动，观察 `completed` / `pageCount=72` / `observationRevision=72`；
- `procurementStatus.stage=procurement_run_active`，`runCount=10`，`candidateCount=0`，`openOfferCount=0`；
- 观察条目约 18409，Run 材料 8633，候选包 0，Handoff A 收据 0，Libra Run 0，Formation `items=[]`；
- 10 个采购 Run 均为 `active`，材料停在 `run_selection`；`evidence_assessment` 多路仍 `running`（CIFS 源上的分拣/结构检查）。

约数分钟后再查：候选 21，阶段到 `handoff_a_ready`，媒体整理工作区已有 18 条 `in_progress`。后台并没有丢账，只是观察完成之后还有分拣、候选、Handoff A、Intake。

展示缺口：

- 「已扫描完成 72 页」被读成「发现/整理已经结束」；
- 文件来源页没有把「目录已扫完，正在分成 N 个采购批次 / 正在分拣 / 已形成候选 / 已交给整理」说清楚；
- 媒体整理工作区空列表没有解释「上游采购还在做，不是没有电影」；
- 概览当时 `todos=[]`、`inProgress=null`、系统态「正常运行」，也没有把这条长尾标成用户可等的进展。

修复：来源页增加「采购进度」，并在目录已扫完时说明采购仍在分拣；整理工作区空表区分「还没进入整理」和「当前筛选没有条目」；收藏页说明工作区条目还不算上架。不改采购合同。

## 5. PROD-004 — 来源与收藏架同为 `/media/Film`（ACCEPTED / 不是缺陷）

用户把文件来源和收藏架目标都配成容器路径 `/media/Film`（NAS `/vol02/1000-0-c5b736af/Film`）。SSOT `HB-A.05` 允许 Field 与同一 Shelf Target 同根或重叠。这不是 PROD-003 空工作区的原因。

2026-08-30 Product Owner 锁定：**同根是 ShelfDeck 必须接收的场景，不是待改配置，不得再建议拆成两个目录。** 同根上的 NFO/Emby、Settlement、二次 Observation 等，只能按同根正确行为收口（例如 PROD-028、已关闭的 UAT 同根项），不能用改路径回避。未改配置、未改合同。

## 6. PROD-005 — 工作区看似卡住、一部都未上架（FIXED）

发现：2026-08-28，用户问为何一部都没有整理上架，以及整理条目为何长时间停在 107。只读 NAS 容器与 `shelfdeck.db`，未改配置、未重启。

现场：

- 容器自 `2026-08-28T07:04:30Z` 起未再启动。约 `07:10Z` 把 Production Workspace 保存为 `/transcode`（`platform_workspace_roots.config_revision=2`）。该设置设计上要重启后才生效；当前进程仍按启动时的 `/app/data/workspaces/libra` 做事。
- 日志持续 `CLEAN_WORKSPACE_ROOT_CONFLICT`（例如 3 分钟内 70 次、随后 90 秒内 36 次）。CPU 约 100%。
- 没有任何 `workspace_media_production` / `artifact_production` / `product_conformance` / `deliverable_promotion` Work。成品包、Handoff B、Shelf Entry 一直为 0。身份和资料完成后下一项是「准备下一项整理工作」，无法进视频/海报生产，因此不能上架。
- 107 不是冻结的总数。07:30 工作区 130 条，07:33 pending 恰好 107、总共 214，07:35 总共 308。采购已发布 696 个候选，Intake 还在把它们接进整理；条目只增不减，因为没有人能离开工作区进入收藏架。
- 次要：7 条 Libra Run `frozen`（资料观察 `P4_CAPABILITY_SCHEMA_REJECTED` ×6、`P5_SECRET_LEASE_INVOCATION_FAILED` ×1），页面「本次整理已冻结，需要放弃后重新采购」。这解释不了「全部没上架」。

Product Owner 随后确认 `/transcode` 就是 Production Workspace，要求记录现网配置、修复后重启、配置不变。处理：冲突错误带上 configured/durable 路径；升级镜像不含 `--helix-clean-init`，重启后按 durable `/transcode` 生效。不改 Field、Shelf、Workspace、代理或集成。

## 7. PROD-006 — 媒体整理工作区卡在「正在读取」（FIXED）

发现：2026-08-28，用户打开「媒体整理工作区」整页停在「正在读取媒体整理工作区…」，响应极长。

现场：`GET /v1/admin/formation?limit=25` 约 1.2s 返回 25 条；库内 897 条、`nextCursor` 仍有。页面却在首屏前串行拉完全部分页（约 36 页），且有 `in_progress` 时每 5 秒再全量重拉。容器 CPU 约 100%。SQLite 单页查询本身是毫秒级，卡死是前端全量门闩。

修复：第一页到达即渲染表格；其余页后台续拉；轮询只合并首页进展，不再把整表当门闩。

随后用户点「需要处理」看到空表。库内仍有 41 条 `attention_required`（身份冲突/待确认/冻结），但首页按 `added_at_ms` 倒序全是新进的整理中条目；10 秒轮询还会打断后台全量续拉。已改为点筛选时按 classification 向服务取数，且轮询不再取消续拉。

冻结根因已核对：Related NFO `<actor>` 超过 `MetadataObservation.peopleHints` 上限 64，补资料结果被 P4 拒绝。实现改为 NFO 解析与观察组装都截到 64。已冻结的 Run 仍须用户放弃后重新采购，代码不会自动解冻。

## 8. PROD-007 — Workspace 材料 root handle 与 durable 根身份不一致（FIXED）

发现：2026-08-28，服务 health `ok`、FFmpeg 仍在 remux，但 `ready-libra-runs` / `active-libra-runs` 进入 `attention`，日志刷 `P9_REFERENCE_MATERIAL_CORRUPT`（Foundation Handle and hot columns do not match the Decision），并夹 `P9_MEDIA_OUTPUT_CONTINUITY`。

现场只读：`platform_workspace_roots.config_revision=2`，`root_handle_ref=de6dabd2…`。`fx_workspace_materials` 全部盖的是 genesis `configRevision:1` 摘要 `d8bcebf2…`。部署前材料约 179 条、Libra `libra_workspace_material_refs` 为 0（挂账从未成功），工作区目录与海报/NFO/remux 字节都在。

根因：保存 `/transcode` 把 Platform 根绑到 `local-filesystem-linux` / `local-mount-…` 且 `config_revision=2`。开 Workspace 和 Remux 验收目标用这份 durable 快照；写海报/NFO/remux 却盖内部 `service-local-workspace` 印章。`rootHandleRef` 对不上时挂账报 `P9_REFERENCE_MATERIAL_CORRUPT`；endpoint/mount 对不上时 remux 登记报 `P9_MEDIA_OUTPUT_CONTINUITY`。升级杀 FFmpeg 后，启动恢复在 `listen()` 之前续跑长时间 workspace write，管理端口起不来。

修复：写材料使用 `ensureRoot()` 的 durable `endpointId` / `mountScopeId` / `rootHandleRef`。启动时对不一致的 active 材料按路径 CAS 重盖章（字节、相对路径、inode、指纹不变）。`safe_retry_before_intent`、`continue_forward/reuse_existing` 和 workspace-write `safe_retry` 重建都推迟到就绪之后再恢复。未 `--helix-clean-init`。

## 9. PROD-008 — 确认影片身份后页面仍显示冲突（FIXED）

发现：2026-08-28，用户给《凶降喜讯 (2025)》选择 TMDB `1218681`《Good News》并确认，页面仍是「需要处理 / 媒体身份信息冲突」。

现场只读：

- `libra.choose-product-identity@1` 收据和 `libra_product_identity_selection_intents` 都有，`provider_key=1218681`，`created_at_ms=1787923511001`。
- 该 Run 只有两条早已成功的身份观察（related NFO 与 NFO exact），没有以选择意图为源的新 `observation_provider_exact` Work；`current_identity_revision` 仍为 null。
- 全库开放 Work 正好 256（admitted 208 + running 41 + blocked 7），Libra 开放 253。Libra Run Coordinator 准入硬顶是 256，后续确认身份的观察被 `WORK_HARD_CAP` 推迟且不落库。
- Formation 仍取最新一条未 resolved 的身份观察，所以 UI 继续展示确认之前的冲突。

修复：Libra Run 准入 `globalOpenWorks` / `ownerOpenWorks` 放到 1000（与 Movie production coordinator 同档；真正并发仍受 event in-flight 限制）。有比该观察更新的 Product Identity 选择意图时，不再把旧冲突当成待用户处理。未 `--helix-clean-init`，不改 Field / Shelf / Workspace / 代理。

## 10. PROD-009 — Intake 铺开与 Workspace 懒回收（FIXED）

发现：2026-08-28 Helix-beta 试运行。几百个 Subject 全部 Intake，Foundation 在全局队列里铺开 remux，`/vol2` 的 `/transcode` 被中间文件写满，一路 FFmpeg 做不完第一部，Arca On-deck 一直为 0。

根因：Libra Intake 不限制未完成 Pre-deck 数量；completed Workspace 回收还要等 Off-load Completion 之后 24 小时 grace，Signal 叫醒也清不掉盘。

修复：Intake 席位 3（占用 active/suspended/frozen Subject，Handoff B Accepted 或放弃才释放，席位满只排队不 Reject）。去掉 completed+Off-load 路径的 24h grace，Completion wake 当场开始两轮引用审计并回收。Product Owner 要求无视已有 Libra Run，干净部署后按原 Field/Shelf/`/transcode`/TMDB 代理/豆瓣取值重建。

## 11. PROD-010 — Formation 路径应提前铺成 checklist（OPEN / 先记不修）

发现：2026-08-28 干净部署后的现场。Product Owner 问为何前端不显示下一步是 transcode；随后要求整理过程有「路径提前展示、一步一步勾上」的感觉，并明确先记下、不授权实现。

现场（只读）：

- 《宇航员》《怦然心动》remux / probe / verify / select 已成功；后续 `workspace_media_production`（transcode 策略评估）为 `blocked` / `temporarily_unplannable` / `media_device_strategies_unavailable`。库内 **0** 条 `libra.media.transcode@1`。
- Formation `nextAction` 仍是「处理视频文件 / blocked」。`organizingSteps` 为封装整理 `done` → 验证整理结果 `pending`，没有转码行。收藏要求已写 HEVC（有的还带 4k / 体积上限）。
- 编码设备探测在服务启动时写入 Platform 登记；每次 transcode 规划只读就绪设备，不会再探。Helix 登记与设置页旧设备池不是同一条链。

根因（展示层，不是生产链停了）：

- `organizingSteps()` 按已出现的 Event 回放。没有 transcode Event 就没有转码格子。
- 所有 `workspace_media_production`（探测、remux、transcode 评估、真转码）在 `nextAction` 里都叫「处理视频文件」。
- 详情页 ○ / ✓ / × 已经是 checklist，缺的是还没发生的格子。
- Libra Run 是决策树：封装达标就验收；不达标才转码；策略耗尽才寻源。不能把未发生的转码画成已存在的 Event。

实现：`formation-query.js` 用 Acceptance Spec + 已有 Event 铺 checklist；transcode 评估 blocked 且无转码 Event 时当前进展为「需要转码，编码设备未就绪」。投影 contract revision 4。未伪造 transcode Event。待无损升级。

## 12. PROD-011 — 注定过不了验收的容器源仍先整盘 remux（OPEN / 先记不修）

发现：2026-08-29，《女性瘾者：第二部 (2013) - 1080p AVC DTS》。豆瓣 5 星，Acceptance Spec 为 HEVC · 4K · 不超过 50 GiB，且禁止系统拉升。Product Owner 问为何触发寻源，随后认为 remux 这一步浪费，要求先记下。

现场（只读）：

- 片源探测已成功；随后 `remux_selection` 整盘 `-c copy` 完成。
- `libra.product_media.verify@1`：`video_codec_unmet` + `minimum_raster_unmet`（h264 / `below_4k`）。`product_output.select` 为 `not_selected`。
- 协调器见 `minimum_raster_unmet` 即 `requiresExternalSource`，**跳过 transcode**，直接 MoviePilot 寻源；候选 `not_selected` / `no_available_candidate`，Run 冻成「没有找到可获取的外部候选」。
- 库内该 Run 无 `libra.transcode.input.verify@1`、无 `libra.media.transcode@1`。

根因：容器源（BDMV）固定「先 remux，再用 remux 产物验收，再决定转码或寻源」。Remux 是 copy，改不了分辨率和编码。五星 4K 缺口在 **source probe 之后** 已能判定本地加工补不上（尤其禁止拉升），整盘封装只占 `volume_write` 和磁盘，不能改变后续寻源。

不是所有 remux 都废：源已是 HEVC 4K、只差装成 mkv 时，封装是正步。仅编码不够、分辨率已够时，现行设计用 remux 产物当转码输入，属于另一笔账，不在本项。

实现：`sourceRequiresExternalSearch` 在 source probe 之后判定 4K/主音轨缺口，容器源与直通源都跳过本地 remux/direct 入选，直接 `ensureExternalSelection`。不改五星标准。待无损升级。

## 13. PROD-012 — 放弃整理后仍占着「等待重新入库」（OPEN / 先记不修）

发现：2026-08-29，Product Owner 对《女性瘾者：第二部》点了放弃整理，随后看到媒体整理工作区仍有一条「等待重新入库」，认为不符合体验。

现场（只读）：

- 结束历史已有一行：`outcome=user_abandoned`，文案「已结束 · 用户放弃」。
- 同一 Subject 仍在 active Formation：`classification=pending`，`currentRun=null`，`nextAction=等待重新入库`。默认「全部」会把当前行和结束历史叠在同一张表里。
- Subject 仍 `active`，材料还在 Field；席位已释放（无 active/frozen Run）。确认框也写了「之后系统仍可能重新发现该媒体并开始新的整理」。

根因：UAT-005 把 Discarded Run 做成结束历史，同时让仍 eligible 的 Subject 以一条 `pending` 回到待整理，文案就是「等待重新入库」。后台事实没错，用户放弃后的工作区却像还有一件待办。

实现：active Formation 列表与统计去掉 `currentRun` 为空且进展为「等待重新入库」的行。结束历史仍保留「用户放弃」。Subject 不删。待无损升级。

## 14. PROD-013 — 编码器能转，探测把缺色标的正常 HEVC 判失败（FIXED）

发现：2026-08-29，无损升级 `e4d601cd9` 之后。Product Owner 看到《影子写手》《宇航员》《怦然心动》三部「转码失败」，要求查原因并修复。

现场（只读）：

- 三部都不是 `libra.media.transcode@1` 编码失败。`workspace_media_production` 的 `transcode_1_assessment` 为 `blocked` / `temporarily_unplannable` / `media_device_strategies_unavailable`，`failure_code` 为空。库内仍 **0** 条真转码 Event。
- `platform_compute_devices` 四条全部 `unavailable` / `probe_result=failed`（NVENC rev3，QSV/VAAPI rev1，CPU rev3）。
- 容器内同一 FFmpeg：`hevc_qsv` 与 `libx265` 一帧编码 exit 0；NVENC 无 libcuda；VAAPI HEVC 需要 hwupload。Helix 风格 SDR mkv 再编码，QSV hwaccel / QSV 软解 / CPU CRF 均 exit 0。
- 探测输出 ffprobe 只有 `codec_name=hevc,pix_fmt=yuv420p,color_range=tv,color_space=bt709`，**缺 `color_primaries` 和 `color_transfer`**。旧 `validateProbeOutput` 对普通 SDR 也强制 bt709 primaries+transfer，于是 `pipeline_output_profile_failed`。
- 已发布普通管线 `outputColorProfile` 是 `source`，不是强制写 bt709 标签。自检比生产编码更严。

根因：能力探测把「编码器没把可选色标写进容器」当成设备不可用。Work 进入 `blocked` 后调度器只收 `admitted`/`ready`，设备以后即使就绪也不会自动重规划。

修复（本地，未部署）：

- 普通 SDR 探测：HEVC、非 Dolby Vision、像素格式 `yuv420p`/`yuv420p10le` 即通过；色域标签缺省不再失败。Dolby Vision→SDR 自检仍要求完整 bt709。
- `settleWork(replan)` 允许 `blocked → ready`（取消 blocked Attempt）。
- 活动 Libra Run 调和：一旦 `listReadyDeviceRefs` 非空，把 blocked 的 `transcode_*_assessment` 重新规划并 `host.wake()`。无就绪设备时不重规划，避免空转。

升级后预期：启动探测把 QSV 和/或 CPU 标 ready；三部评估从 blocked 回到 ready，规划出 `libra.media.transcode@1`。NVENC 仍不可用（无 CUDA）。不自动解冻其余影片。不 `--helix-clean-init`。待无损升级。

部署：`helix-beta-20260829-0eb39ed97`，tar SHA-256 `e95c8bfdad460770064c5a66138813d1e1da5dae8985063719a5c798369d43ea`，无 `--helix-clean-init`。升级后 QSV/VAAPI/CPU `ready`；《怦然心动》GPU 转码执行中，《影子写手》等写槽；《宇航员》输入校验 `LIBRA_MEDIA_FFMPEG_TIMEOUT` 后冻结，不在本项范围内自动解冻。

## 15. PROD-014 — 转码预检不是正式命令的缩小版（FIXED）

发现：2026-08-29。《宇航员》在设备就绪后做 `libra.transcode.input.verify`，30 秒超时冻住。预检带 `-ss` 跳到 5%/50%/95% 再 QSV 硬解编 8 帧并 copy 全部音轨字幕；正式转码从 0 开始、无 seek。demux 跳转 115ms 正常。超时被当成 `executor` 崩溃，不能换 VAAPI/CPU。

修复：预检改为正式管线从头编 24 帧；失败或超时返回 `encoder_rejected_source_pipeline`，评估 `strategy_rejected` 后换下一条设备。不测偏色、不测整片可播。Terminal freeze 不能 resume；已冻的《宇航员》升级后需放弃并重新进整理。已无损升级 `helix-beta-20260829-83d3c4424`。

## 16. PROD-015 — 上架指纹把 mtime 触摸当成材料被换（FIXED）

发现：2026-08-29。《怦然心动》转码成功并进入 Arca On-deck `arca.inventory.product.stage@1`。staging 目录里只有 banner/fanart/clearlogo；随后 Event 停在 `executing`。日志是 `PHYSICAL_MATERIAL_STAT_FENCE_CHANGED`，对象是刚写入的 `怦然心动 (2010).nfo.tmp-…`。catch 删了 tmp 再把错误抛出去。

根因：有界指纹在采样前后用 lstat/fstat 比对 inode、size、**mtimeNs、ctimeNs**。同根 `/media/Film` 上的扫描或 NAS 元数据刷新会摸到刚写完的 sidecar，mtime 一变就判「材料被换」。内容指纹和大小其实没变。Product Owner 判断这是极小概率的内容对调，授权取消 mtime/ctime 身份门禁。

P4 对 journaled `material_commit` 的 Executor throw 仍会把 Attempt 留在 `executing` 等启动恢复，这是既有合同，本项不改。现场卡住的 Event 要等无损升级重启走 startup recovery；mtime 门禁取消后这次误伤不再发生。

修复：`sameIdentity` 只比 inode+size。采样期间换 inode 或改大小仍 `PHYSICAL_MATERIAL_STAT_FENCE_CHANGED`。拷贝后仍用 middle-256KiB SHA-256 对 Package 内容指纹。已无损升级 `helix-beta-20260829-83d3c4424`。重启走 startup recovery。

## 17. PROD-016 — 放弃整理后 Workspace remux 未释放（FIXED）

发现：2026-08-29，Product Owner 放弃《宇航员》后要求核对空间是否释放。只读现场：

- Run `5e9d0df7…` 已 `discarded`，Discard Receipt 已提交，原片 Control 已释放。
- `workspace_cleanup_scope_id` 为空；库内 **0** 条 `libra_workspace_cleanup_scopes`。
- 该 Run 的 `libra_workspace_material_refs` 为空。`fx_workspace_materials` 仍 `active`：remux mkv **32.27 GiB** + poster/nfo。目录 `/transcode/50b88801…` 仍在。
- `libra.workspace-cleanup.requested@1` 已 `fully_acked`，但没有 cleanup member 可删。
- 同病：《女性瘾者：第二部》先前放弃，Workspace 仍 `active`，**35.54 GiB** remux 未删。
- `/transcode` 现约 128 GiB / 477 GiB（28%）。原片在 `/media/Film`，Discard 本来就不会删源文件。

根因：Discard 只把已挂到 Libra Workspace Reference 的材料列入 cleanup。转码输入校验冻住时 remux 已写入 Foundation Workspace，但还没 `attach_working`，所以放弃时当成「工作区是空的」。SSOT 禁止用目录扫描补 cleanup member，所以不能在 Discard 事务里从 Foundation 材料编造 Scope。

第一次修复：

1. remux / transcode / artifact / import 产出后立刻 `attach_working`。以后再放弃，Discard 能看到引用并建立 cleanup Scope。
2. 已放弃或已被替代、工作区仍 active、当前没有未释放引用时，leftover 回收器删除 Foundation 材料并收空目录。不新建空 cleanup Scope，不改 Discard 合同。

现场两份 orphan（宇航员约 32.3 GiB、女性瘾者约 35.5 GiB）在升级前按授权清掉 `/transcode` 下对应工作区目录，不碰 `/media/Film`。已无损升级 `helix-beta-20260829-83d3c4424`。

## 18. PROD-017 — 上架把原片抽检失败当成成品不可播（FIXED）

发现：2026-08-29。《影子写手》转码成功（HEVC mkv 约 8.3 GiB，5/50/95 全过）。Arca mandatory media 同时抽检 BDMV 原片，5% 和 50% 解帧失败，只过 95%。实现把原片失败并入 `playback_decode_failed`，Handoff B 拒收。

修复：workspace 成品只拿成品解帧否决；原片仍 probe 对照分辨率/动态范围，不再三点抽检。已拒收的需放弃后重新进整理。已无损升级 `helix-beta-20260829-904c415f7`。

## 19. PROD-018 — 跳过直通验收去寻源后「接受瑕疵」不亮（FIXED）

发现：2026-08-29。《国际市场》要求 HEVC·4K，片源 1080p H.264。PROD-011 跳过 remux/转码直接寻源，MoviePilot 无候选冻结。`接受瑕疵` 需要失败的直通 `product_media.verify` 才能列出豁免缺口；这次没有做过，预览失败，按钮被藏。

修复：stream_file 在 `sourceRequiresExternalSearch` 之后先跑直通验收再寻源。已冻结的需放弃后重新进整理。已无损升级 `helix-beta-20260829-904c415f7`。

## 20. PROD-019 — 收藏架拒收后没法放弃（FIXED）

发现：2026-08-29。升级后《影子写手》仍占着整理席位，页面没有「放弃整理」。Handoff B 已 `rejected / playback_decode_failed`，但 Libra Run 还是 `active`。放弃入口只给 `frozen` Run；验收拒收既不冻结也不返工，动作列是空的。第一次镜像尝试先冻再弃，因成品工作区产物从未进 Material Control 而失败。

修复：Handoff B 业务拒收后，整理工作区直接放出「放弃整理」，Discard 允许 `active` + rejected Delivery Receipt。列表页没有 `processDetail`，按钮条件改为 active Run + 已提交 Package + `attention_required`。已无损升级 `helix-beta-20260829-c547a2f93`。请 Ctrl+F5。

## 21. PROD-020 — 工作区中间文件清理卡住（FIXED）

发现：2026-08-29。`/transcode` 仍占约 45 GiB。《影子写手》放弃后 remux 30.6 GiB 还在；《怦然心动》已上架 remux 15 GiB 还在；《里斯本丸沉没》有升级打断留下的 `.partial-*`。

三处合同洞：

1. Drain 先 Foundation 删文件再 Libra 记账；最后一个 member 还先收空目录。失败后材料已 `reclaimed`、member 仍 `pending`，以后每轮重放再撞 `UNKNOWN_MEMBER`。
2. Cleanup 名单只拍当时未 released 的 Libra 引用。《怦然心动》remux 从未挂引用，Off-load 名单没有它；completed+reclaiming 也不走 leftover。
3. 转码先写 `目标.partial-{effectId}` 再 rename。升级杀掉 ffmpeg 后半成品不入账，清理看不见。

修复：Drain 先 `cleanup.commit`，Scope `completed` 后再 leftover（含已完成 Scope 重放）。没有 cleanup member 的已完成工作区也会 leftover 没挂引用的 Foundation 材料。已 reclaimed 的材料允许重放。产出端口在写出/回收时清同目标的 `.partial-*`。不扫目录编造 cleanup member。专项测试 14/14 通过。已无损升级 `helix-beta-20260829-6ad8bc999`。

## 22. PROD-021 — 无损音轨撑破体积上限后去寻源（FIXED）

发现：2026-08-29。《露梁海战》三星要求 HEVC · 8 GiB。片源 1080p H.264 + DTS-HD MA。Remux 后转码评估 `media_size_budget_infeasible`（DTS-HD MA 按 8 Mbps 估满），跳过转码去 MoviePilot，无候选冻结。接受瑕疵要的是原片直通失败，所以按钮不亮。

修复：保留无损主音轨。视频按星级×画幅下限（三星 1080p 2.5 Mbps、三星 4K 10 Mbps 等）编码。扣完音轨后低于下限则冻结，接受瑕疵只豁免 `max_size_exceeded`，弹窗写清上限 / 预计 / 超出多少，确认后再转 HEVC。不再因此去寻源。页面 Dialog 替换 `window.confirm`。已冻结的《露梁海战》不会自动重跑，需放弃后重新进整理。已无损升级 `helix-beta-20260829-6ad8bc999`。

## 23. PROD-022 — 升级后启动恢复把旧转码超时残留当硬故障（FIXED）

发现：2026-08-29。`helix-beta-20260829-f68c3f346` 镜像替换后容器反复重启，health 连不上。启动恢复报 `P4_EXECUTION_HOST_RECOVERY_BLOCKED`。现场一条仍活的转码 Event 多次超时重试，旧 Attempt 留下 `workspace_write` `reconcile_required` Effect；恢复只看最新 Attempt，把这些残留当成 `NONTERMINAL_EFFECT_WITHOUT_RECOVERY_EVENT` 硬故障。

修复：启动恢复对已完成且 outcome 为 failed/cancelled 的 Attempt，放弃其上未提交 Effect，不再拒启。专项测试覆盖 live Event 上被 supersede 的残留。已无损升级 `helix-beta-20260829-6ad8bc999`。

## 24. PROD-023 — 放弃整理仍用浏览器弹窗（FIXED）

发现：2026-08-29。上一张镜像把「接受瑕疵」改成页面 Dialog，但「放弃整理」仍走 `window.confirm`。用户点放弃《露梁海战》时看到的还是浏览器自带框。

修复：放弃整理改为同一套页面 Dialog，标题「确认放弃整理」。已无损升级 `helix-beta-20260829-79fc055d1`。请 Ctrl+F5。

## 25. PROD-024 — 3 席位漏算路由/规格，一次灌进 8 部 Run（FIXED）

发现：2026-08-29。整理工作区同时 8 部 `active` Run。其中 6 部在约 8 秒内新建。席位只数已有 Run 和还在跑的 Intake Work；Intake 一成功、Run 还没建时，路由和验收规格不占座。入库成功后的补位还用默认 `admissionLimit` 32。

修复：占用把 `libra_routing` / `libra_acceptance_spec` 进行中的 Subject 算进去；入库成功先占路由再补位，补位最多 3。已进来的 8 部不踢出，门口不再继续灌。已无损升级 `helix-beta-20260829-2fe558b95`。

## 26. PROD-025 — MoviePilot 把 TMDB 编号当片名搜（FIXED）

发现：2026-08-29。《007：大破天幕杀机》本地 1080p，规格要 4K，跳过转码去 MoviePilot。查询词里有 TMDB `37724` 和中文名，搜索接口却优先拿 `provider_key` 当 `search/title` keyword，等于搜「37724」，候选 0，冻成 `no_available_candidate`。

修复：title 搜索用中文名和英文原名，TMDB ID 只核对搜回的候选。已冻结的需放弃后重新进整理。已无损升级 `helix-beta-20260829-d1dd611d4`。

## 27. PROD-026 — Libra 转码 1 小时事件时限掐死长片（FIXED）

发现：2026-08-30。《教父2 (1974)》2160p Remux 走 Intel QSV，`libra.media.transcode@1` 正在执行，输出在涨。但 Event 时限是 1 小时（`helix://foundation/timeout/field-observation/v1`）。片长约 202 分钟、速度约 1.1x，整部要约 3 小时。已失败 5 次：2 次 `LIBRA_MEDIA_FFMPEG_FAILED`，3 次刚好 1 小时 `LIBRA_MEDIA_FFMPEG_TIMEOUT`。页面 32.8% 是上次超时残留。FFmpeg 端口默认 12 小时还会把 Aftercare 的长媒体预算再截短。

SSOT 10.3.5：本地 transcode/remux 是「10 分钟无进展判 Attempt timeout，48 小时 hard timeout」，不能用持续 progress 无限延长 hard timeout。Aftercare 原先只有 12 小时，同样短于该合同。

修复：Libra remux/transcode 与 Aftercare remux/transcode 共用 48 小时硬上限；FFmpeg 服从 Event `deadlineAtMs`，不再用更短的进程默认值截断；编码进度管道 10 分钟无 stdout/stderr 活动视为停滞。未改 SSOT。同镜像还带上架暂存槽躲开 Emby，以及启动恢复对旧 Catalog 零节点 unplannable Plan 的放行。已无损升级 `helix-beta-20260830-06d0cc63b`。在途转码按新 Attempt 使用新时限。

## 28. PROD-027 — 长转码进度采样顶满后页面冻住（FIXED in next image）

发现：2026-08-30。只读核对现网 Libra Run。服务 health `ok`，镜像 `helix-beta-20260830-06d0cc63b`。《里斯本丸沉没 (2024)》`libra.media.transcode@1` 正在 QSV 执行，partial 仍在增长（约 2.9 GiB，8 秒内 +5 MB），FFmpeg 已跑约 1 小时 50 分。Formation 进度却停在约 25.7%，最后一条 durable sample 约 27 分钟未更新。Product Owner 后授权逐项深修。

现场（只读，未改库、未改配置、未重启）：

- 当前 Attempt 第 24 轮，`fx_event_progress` **256** 条，最新 `25.7%` / `rate=0.382`，revision 987；下一条非 terminal 不再入库。
- 25.7% 不是阈值。`ProgressReporter` `MAX_SAMPLES_PER_ATTEMPT=257`（256 条历史 + 1 条 terminal）。非 terminal 写满 256 后静默 `HISTORY_BOUND`，**current 指针也不再前进**。
- 编码器不受影响：停滞看的是 FFmpeg stdout/stderr 活动，不是库内 sample，因此不会因为采样停写而被杀掉。
- 同场另外两部（《教父2》《唐人街探案》）在等 QSV，与本项无关。

根因：SSOT `7.9.4` 要求长耗时 Capability 持续发布 current progress sample，历史按 bucket 有界；`10.4.3` 允许最多每 5 秒写一次 durable sample。实现把有界历史做成 append-only 硬顶，顶满后连 current 也停写。P4 测试原先覆盖了 5 秒间隔，没有覆盖 `HISTORY_BOUND`。

修复：非 terminal 历史顶满后 **就地覆盖** 当前 sample（同一 `revision` / Event 指针），继续发布 current；行数仍 ≤256 条非 terminal + 1 条 terminal。5 秒同 bucket 间隔、回归否决、terminal 独占槽、编码器停滞判定均不变。未改 SSOT、表合同或 Domain。本地 `p4-progress-reporter` / `p4-event-runtime` / `p4-foundation-public` PASS。现网在途转码仍冻在旧镜像，需无损升级后新 Attempt 才按覆盖合同走。

## 29. PROD-028 — Aftercare NFO 按整份字节修，而不是按内部事实验呈现（FIXED in next image）

发现：2026-08-30。只读现网《Searching / 网络谜踪》上架后 Aftercare Case 目标 `presentation:nfo_update_required`。盘上 NFO 是可用的 Emby 形 movie XML（`lockdata`、`dateadded`、CDATA、tvdbid），不是损坏文件。Product Owner 确认核心理念后授权逐项深修。

核心理念：

- NFO 是视频旁边的说明书（Shelf 上的 `.nfo`），不是户口本。
- 户口本已在 On-deck 写入：Canonical Identity、Product Metadata、Media Cast。不新建存储或 Domain。
- Aftercare 对 NFO 的职责是「说明书呈现的信息是否仍与内部身份和资料一致」。
- 文件还在不在、能不能读，仍归 Custody；「被改过」本身不再等于要修。
- Libra 仍负责第一次 create / 可用则 update / 损坏或身份冲突则 rebuild。
- 不把 Emby 修改当权威，不把 Emby XML 方言做成产品格式。

修复：

- Presentation 用 `compareMovieNfoPresentation`：可解析 movie NFO、TMDB 仍是这部片、title/year/plot/genre 与 accepted Facts 一致、Facts 中的演员仍在。不验整份字节、排版、CDATA/`lockdata`/`dateadded`/tvdbid。
- Custody 对仍存在且可读的 NFO sidecar 忽略 inode/size/指纹漂移，不再 `nfo_identity_changed` + `auto_repair`。缺失/不可读仍按 Artifact 修。
- Aftercare 写入路径仍走 `renderAftercareMovieNfo`（create/update/rebuild）。Libra 首次写入仍在 `clean-product-production-port.js`；Helix Domain 边界不允许 Libra 引用 Arca model，本项不把两套写入器硬合并。
- 当时没有覆盖 On-deck Placement 之后到 Commit 之前的并发改写窗口，也没有在盘上 NFO 语义等价但 physical identity 已变化时提交新的 Inventory Representation revision；因此「不抢写文件」已修，但库存仍可能长期记着旧指纹。
- 后续 PROD-035/037 补上 Final Reality 与 Inventory revision 收敛后，仍遗漏了一层更早的恢复来源证明：同 Run 已 Placement 的 final NFO 不是原始 `offloadContext` 成员，重新执行 Stage 会在语义检查前被 target occupied 门禁拒绝。该独立缺口由 PROD-040 修复，不能用放宽所有 NFO 冲突来掩盖。

本次完整修复：

- Final Verify 移到 Placement 后，并与 Fulfillment、Commit 一样重新读取 Shelf 最新现实；NFO 按语义放行且保存当次实际 physical identity，Primary 等材料仍 exact package identity。
- Aftercare 对语义等价的 NFO 漂移不写文件，提交新的 Inventory Representation revision 并原子切换 Material Control；来源再次变化时废止旧输入并重新评估。
- 坏 XML、错误 Movie Identity 或缺少拥有字段仍 fail closed。连续外部写入有界重试并聚合为一个 `external_writer_conflict` attention，不再无限建 Case/Work 或刷日志。
- Product Owner 已明确授权这次 NFO Final Reality SSOT 变化；未改变 Domain、Handoff、Final Inventory Decision 或 Emby 的 External Provider 角色，也不要求修改 Emby 配置。

本地 On-deck、Aftercare、recovery 与 Service full 测试 PASS。现网《网络谜踪》仍需另行授权部署后，下一次 Presentation 评估才会按语义放行并收敛 Inventory revision。

## 30. PROD-030 — 媒体制作编排：预测 freeze、过早寻源、步骤猜测（FIXED in next image）

发现：2026-08-30。《里斯本丸沉没》转码实测 8.3 GiB 已通过，但转码前 `sizeCapAdmissionForecast` 触发 freeze → P9，`product_conformance` 永不提交。另：《露梁海战》因 `media_size_budget_infeasible` 跳过本地转码去寻源；规格寻源后体积超标无转码兜底；Formation 详情步骤按 Spec 猜测 remux/转码/寻源，与实际 Work 不一致。

修复（L7-DP-02）：

- 删除转码前体积预测 freeze；`media_size_budget_infeasible` 不再短路到寻源，继续下一转码策略。
- 本地转码策略穷尽后再寻源；external import 仅体积/可转码 gap 时继续转码该素材。
- `size_cap_exceeded` 绑定 **实测** `product_media.verify` workspace 失败；Admin 预览读实测体积。
- Formation `buildMediaOrganizationSteps` 按 Work/Event 回放真实步骤，Frozen 时插入瑕疵确认步骤。

本地 targeted tests PASS。部署后《里斯本丸沉没》应 reconcile 续跑；旧形态 frozen Run 仍须放弃重进。

## 31. PROD-029 — 「全自动或关键步骤确认」对用户旅程无效果（FIXED）

发现：2026-08-30。收藏架配置页有「全自动（推荐） / 关键步骤确认」。Product Owner 确认该开关当前没有用户可见意义，要求先记下，**后续删除**；本文不授权现在删界面、API、表或 SSOT。

它本来只想管一件事：上架后要不要自动处理旧输入文件（来源里的正片/独占附属）。不是整理总开关。全自动不授予退出收藏销毁，弱人物仍要确认。这些在 SSOT `9.6.5` 和 Beta `HB-A.07` 里仍写着。

现在实际：

- 点选会写入 `arca_input_settlement_authorizations`，Readiness/概览标签会变。
- On-deck 结算批准由投影直接生成，`actorId` 固定 `system-policy`，不读这份授权。
- `settleInputAsync` 不用 `approval`。媒体整理工作区没有「确认本次旧输入范围」入口。
- 采购、整理、验收、Aftercare 自动修两边一样。
- 现网 Field/Shelf 同为 `/media/Film`（PROD-004）时，旧输入和成品常是同一路径，结算往往不另删文件，开关更看不见。

处理：Admin Web 已移除该表面与 Overview `productChoice`；后端 API 暂保留，不改变 On-deck 行为。本项不宣称修改 `HB-A.07` 的产品验收结论。

## 32. PROD-032 — Pre-deck token 存在但生产重建完全绕过（FIXED / DEPLOYED）

发现：2026-08-31 对 NAS 只读盘点。现网 720 个 active Subject、0 个 active Libra Run、0 个 pipeline token；Formation 仍有 712 pending、2 in progress，Foundation 同时有 Libra 183 admitted、17 running 和 Perception 48 admitted。

根因：

1. 历史 succeeded Intake Evidence 被当作无需 token 的 replay；真正新 Offer 又必须先有 acceptance receipt 才能解析 Subject ID，形成首进死锁。
2. routing、Subject rating、acceptance spec、ready-run fallback 直接扫描所有 active Subject，不读取 token。
3. token 在 Run Admission 成功时释放，无法限制完整 Pre-deck 在途数量。
4. Formation 把所有 active Subject 投影都当当前工作；旧 full reset 只终止 Run/Work，没有收敛视图。
5. policy GET 会写默认行，重复 PATCH 更新时间戳；production build 允许 dirty worktree，导致镜像 tag 的 commit 无法重建镜像内容。

修复：Intake 提交前先占 token，历史 replay 同样占用；Subject ID 可由当前 continuity decision 确定性解析；下游 fallback 只推进 token holder；token 保持到 Handoff B Accepted、用户 Discard或 Intake Rejection；Formation active queue 只展示 token holder 或已有 Run/Handoff B 的 Subject。GET 改为纯读、重复 PATCH no-op，production build 强制 clean + exact commit tag。reset 同步取消 Work/Event/Attempt/resource wait，并对 `/transcode` 路径做 fail-closed 防护。

2026-08-31 已按 stop → 完整 data backup → migration → bounded Libra reset → standard deploy 执行。备份为 `/vol1/1000/docker/shelfdeck/data.backup-20260830T170231Z-predeck-pipeline`；reset 时无 active/suspended/frozen Run，终止 200 条遗留 Libra Work，未删除 Subject、未触碰 `/media`。

部署镜像 `markmahoro/shelfdeck:helix-beta-20260831-710aa1b65a`，tar SHA-256 `19292cef75f10eb5216f52c41cdb8fc8f50ab156e6dcc27cf7c6c4c4809c8733`。部署后 health `ok`、schema 186、SQLite integrity `ok`；唯一 Field 为 3 seats / 3 tokens / 3 active Work / 0 active Run。Formation 汇总 3 pending、2 in progress、6 completed，active section 仅 5 条且无分页。

## 35. PROD-035 — On-deck NFO 并发改写与失败 Run 无业务终态（FIXED LOCALLY）

发现：2026-08-31。前一轮 PROD-035 只修了 Accepted 后同一 On-deck Run 的执行恢复，但 Final Product Verify 仍发生在 Placement 前。Emby 可以在 Placement 后、Final Verify 后、Settlement 后或 Fulfillment 后改写 Shelf NFO；严格 Package 指纹会把语义仍正确的说明书当成产品变化。若 Supporting Work 一直失败，Reconciler 又会周期性重建，Run 对用户看起来永久卡在中间态。

业务处理审计：

- 「接受瑕疵」只用于 Libra 对已明确、可授权偏离的产品结果做冻结决策；「放弃整理」用于 Handoff B Accepted 前终止 Libra Run，或在 Handoff B Rejected 后放弃该次整理。
- Handoff B Accepted 后 Arca 已接管 custody/control，不能把检查失败改判 Rejected、退回 Libra，或再使用「接受瑕疵 / 放弃整理」结束；否则会伪造已经发生的 Handoff 事实。
- 因此检查失败仍必须阻止 Commit，但恢复必须收敛：自动尝试有界，耗尽后进入可解释、零执行资源的 `attention_required` 稳态；用户可继续同一 On-deck Run 重试。

修复：

- On-deck 顺序改为 `Stage → Staged Verify → Placement → Final Product Verify → Settlement → Fulfillment → Commit`。
- NFO 以 Movie Identity、title/year/plot/genre/cast 验语义，记录 `sourceProductMaterialKey`、实际 `physicalIdentity`、`observedAtMs` 和语义证据摘要；不保存原始 NFO 字节。其他成员保持 exact package identity。
- 文件读取、指纹和前后状态检查使用同一 handle；读取期间变化则有界重读，避免混合快照。
- 自动恢复最多 3 代 Supporting Work；耗尽后 Reconciler 不再扫描该 Run，Formation 显示「重试上架」。用户重试恢复同一 Run，不创建第二个 Run 或 Shelf Entry。
- 未新建 Domain、Store、表或兼容路径；DDL digest 不变。本轮未改 Emby 配置、未部署生产、未直接编辑 SQLite。

后续生产复现补充：上述修复解决了 post-Placement Final Verify 和有界业务稳态，但恢复 Work 重新从 Stage 开始时，collision gate 仍只认 Package 的原始 `offloadContext`。同一 Run 先前 Placement 新建、随后被 Emby 等价改写的 NFO 因而在进入 semantic verification 之前就被拒绝。此遗漏不改变 PROD-035 的业务处理结论；它作为 PROD-040 的来源证明缺口单独收口。

## 40. PROD-040 — prior Placement NFO 在恢复 Stage 被误判为陌生冲突（FIXED / PRODUCTION ACCEPTED）

发现：2026-08-31。精确复现为正常新 On-deck Run 完成 Placement 后，Emby 将 final NFO 改写为语义等价字节；后续同 Run 的 Forward Recovery 从 Stage 重新进入时，Target Commit Slot 为空、Primary 等成员与 Package 全等，只有 final NFO 指纹变化。因为该 final 路径由 Placement 创建，不在 Package 原始 `offloadContext` 中，旧 Stage 抛出 `CLEAN_ARCA_TARGET_OCCUPIED`。

通用根因与修正：

- `offloadContext` 只能证明进入 On-deck 前已有的受管来源，不能证明同一 Run 已经完成的 Placement；后者的正式证据是 Execution Foundation 中 durable succeeded Placement Result。
- Capability 从同一 `arca_ondeck_run` 的 `on_deck_execution` Works 读取 typed `PlacementSwitchReceipt/v1`。Inventory Port 再核对 `ownerDomain=arca`、`scopeType=on_deck_run`、同 `scopeId`、同 `targetCommitSlotId` 与 transaction revision。
- 只有 `.nfo` metadata sidecar 可使用该授权：Stage 读取同一文件快照做 semantic presentation 检查；等价时不写文件并把实际 physical identity 写入 Staged Manifest，错误时从 Package 重新 Stage。Staged Verify 与 Placement 重复核对 Receipt、实际身份和语义。
- Primary、poster、subtitle 及其他成员完全不使用 prior Placement 语义授权；任何字节漂移仍 fail closed。没有 Receipt、错 Run、错 Slot 或缺 accepted presentation basis 也继续拒绝。
- 实现没有影片、TMDB、路径、旧 Run/Work/Effect 特例，没有 migration、fallback、生产数据编辑或 Reset；它只修正常新条目同样会触发的 Forward Recovery 规则。

本地精确测试覆盖空 `offloadContext`、先 Placement、Emby 等价改写、同 Run Stage/Staged Verify/Placement 恢复且 NFO 字节保持不变；同时覆盖无 Receipt 拒绝、错 Slot 拒绝与 Primary 漂移拒绝。本项已随 `e16ff04ebf` 部署，但尚未获得实际 Capability 执行机会，也未据此判断当前生产样本是否仍具备完整可恢复事实。

部署后补充：`e16ff04ebf` 已包含本项，但生产样本的恢复 Runtime 在进入 Stage Capability 前即因原 Attempt deadline 过期而失败，所以该代码没有执行机会。PROD-040 的业务规则保持成立；新的 Foundation 阻断记录为 PROD-041。

## 41. PROD-041 — continue-forward 恢复误用已经过期的原 Attempt deadline（FIXED / PRODUCTION ACCEPTED）

发现：2026-08-31。Startup Recovery 正确识别一个 `material_commit` Effect 需要 `continue_forward`，但 Event Runtime 仍用原 Event Attempt 的 `started_at_ms` 调用 Attempt Policy。长时间停机后计算出的 `deadlineAtMs` 已在过去，Timeout Controller 在调用 Capability 前直接拒绝；Host 随后按 recovery cadence 再次调用，同一个过期 deadline 永远不可能收敛。

修正依据与实现：

- SSOT 7.9.2/10.3.1 要求不可逆点后的 Effect 先分类并进入 Forward Recovery；7.9.4/10.3.5 又要求每个执行句柄受 hard timeout 约束。原 Attempt deadline 不能给新恢复句柄零预算，也不能在每次重启时重新给满预算。
- Effect Journal 在第一次执行 classified `continue_forward` 前，为同一非终态 Effect 原子冻结 `verified_at_ms` 作为 recovery execution start；该列此前已承载 Effect recovery observation 时间，不新增表或 migration。
- Event Runtime 先重验原 Input Snapshot、Fence、Effect intent 与 idempotency identity，再以 frozen recovery start 调用同一 Attempt Policy；Context 仍保留原 `eventAttemptId`、`effectOccurredAtMs` 与 `recoveryDecision`。
- 再次崩溃或 Host 重试只读原时间，不能刷新 deadline。普通执行、pure observation、`safe_retry` 与 PROD-036 的原 Attempt hard-close 路径完全不变。

本地单测证明旧 Attempt deadline 已过仍能进入并完成 `continue_forward`；同时把时钟推进一小时后重复开始，Journal 时间与 `updated_at_ms` 均保持第一次值。没有生产 ID、路径、影片、NFO 或旧 Run 特例。

生产验收：修正随 `helix-beta-20260831-e655d6d66f` 部署后，《罪人 (2025)》沿用 On-deck Run `6934758bf6a97208e0e2bc024d6bfb19bf6f36993a2a223bee5a7ba23125ca2a`，同一恢复链实际执行 Stage、Staged Verify、Placement、Final Verify、Settlement、Fulfillment 与 Commit，建立 Shelf Entry `f04a4f09b2b64d957392425ca6eb7d70dde5126bf4f07424777df08c84f11347`。这同时完成 PROD-040 的生产行为验收；没有 Reset 或生产数据编辑。

完成态详情随后暴露旧 failed Work 抢占 `currentPlan` 的独立投影问题。最终镜像 `helix-beta-20260831-b06b70ba10`（tar SHA-256 `1389e07734d1de51262ef947d0345f095c5f50c59d9c2acbd97cd951b51f9543`）已无损部署；《罪人》现显示 `计划5 将媒体写入收藏架 / 已完成`，Formation 汇总为 3 条进行中、9 条已完成、0 条待整理或需处理。部署窗口未见该条目的 target occupied、NFO semantic drift 或 source stale。

## 42. PROD-042 — Intake Rejection 输入绑定把引用对象当成 Work ID（FIXED / DEPLOYED）

发现：2026-08-31 生产只读诊断。唯一 Field 为 3 seats / 3 held / 0 free，但 Formation 只有 2 条活动记录。第三个 token 对应的 Candidate 已通过合同校验，物理材料校验返回 `candidate_material_unavailable`；随后的 Rejection Work 因 `P4_EVENT_INPUT_PREPARATION_FAILED` 失败，token 未释放，后续 Handoff A Intake 因而无法补位。

根因：Intake Coordinator 正确把 Evidence Supporting Work 作为一个 typed `dependencyRef` 传给 Rejection Work；Rejection Planner 却把整个对象写入 `parameters.evidenceWorkId`。Input Projection 再以该值调用 `workResultReader.read()`，于是本应为字符串的 Work ID 变成对象。由于 Rejection Decision 从未提交，Coordinator 按合同不能释放 Pre-deck token。

本地修复：Rejection Planner 现在只接受唯一的 `ownerDomain=libra / objectType=supporting_work` 依赖，并只把其 `objectId` 传入两个 Rejection input projection。缺失、多个或错误类型的依赖直接以 typed planning error fail closed。回归测试实际穿过 Planner、两项 Input Projection、Rejection Store 原子提交与 Coordinator token release，并证明查询始终使用 exact Evidence Work ID。

本项没有 migration、dual-read、旧 Work fallback 或生产 ID 特例。修复已随统一镜像部署；现有失败 Rejection
Work 不会被兼容重规划。生产仍有一条旧失败 Work 关联无 Subject provisional token，当前 Formation Reset
不覆盖该 orphan token，未经新授权未直接清理。

## 44. PROD-044 — 追踪位置变化导致终态 Plan 阻断启动（FIXED / DEPLOYED）

2026-08-31 的统一升级 readiness 发现 846 个 Plan 使用摘要
`37264ba7abffb70a9d44264856816e992d0f05674a471fd4496d2bf3cc06ecca`。只读审计证明这些 Plan 的 Work
Attempt 与全部 Event 均已终态；真正仍活动的 3 个 Arca Work 使用既有兼容摘要 `a30cf21a…`。旧实现把
Capability `sourceLocator`（包含 SSOT 行号）纳入执行目录摘要，所以只移动文档位置也会伪造执行合同变化。

修复保留包含 `sourceLocator` 的完整 manifest digest 供架构追踪，另以排除该字段的 semantic contract digest
形成 Execution Catalog。typed schema、Owner、Effect Class、executor version 或 policy 任一变化仍会改变摘要。
上述精确旧摘要只在 Attempt 与所有 Event 全终态时接受；活动 Plan、未知摘要和新 Plan 一律不得使用它。
修复已随统一镜像部署，最终 readiness findings 为空。

## 45. PROD-045 — Libra NFO 自身语义漂移且 Arca 检查过晚（FIXED / DEPLOYED）

《人生密密缝》的 Accepted Product Fact 为 `genre=Family`，但 Libra Workspace NFO 已包含 `Family` 与
`Drama`；演员生田斗真的 person TMDB ID 还被根级 movie ID 覆盖。源 NFO 同时含多个根级 `genre`，且
`actor/tmdbid` 位于根级 movie `tmdbid` 之前。旧 renderer 只替换第一个 genre，并用不限定 XML 层级的
正则替换第一个 `tmdbid`，因此是 Libra 生成与自身提交事实不一致，和 Emby 无关。

修复只操作 NFO 根节点直接子元素：重复 genre 先按 Product Fact 的规范多值集合整体替换，movie unique ID
只更新根节点，嵌套 actor ID 保持不变；Related NFO observation 同样保留完整多值 genre。Arca 在
Staged Verify 已持有 Presentation Basis 时即做同一语义校验，失败不得创建或占用目标目录，Placement 后的
Final Verify 继续作为现实重读门禁。实现没有影片 ID、路径或旧 Run 特例；现有失败 Run不获得兼容恢复。
修复已随统一镜像部署；《人生密密缝》旧失败条目保持 attention，不做兼容修复。

## 46. PROD-046 — 非纯 safe-retry 恢复误用已经过期的原 Attempt deadline（FIXED LOCALLY）

第一轮统一升级后，三个 `arca.aftercare.workspace.reclaim@1` Work 仍保持 running。Reality Observer 已证明
对应 `workspace_write` Effect 不存在并分类为 `safe_retry`，但 Event Runtime 继续使用原 Event Attempt 的
`started_at_ms` 计算 deadline；该时间早已过期，Capability 尚未 dispatch 就抛出 `P4_EXECUTION_TIMEOUT`，
后续启动恢复重复同一失败。

这是 Foundation 的一般缺口：已有非纯 Effect 且现实明确证明可安全重做时，恢复句柄与 `continue_forward`
一样需要一次实际执行预算。修正让这两类 classified non-pure recovery 共用 Effect Journal 的 durable
recovery execution start；同一 Effect 只原子冻结一次时间，重启不会刷新，预算耗尽后仍 fail closed。
普通 retry、`safe_retry_before_intent` 与 pure observation 继续使用原 Attempt deadline。没有 Arca、路径、
Work ID 或生产数据特例，也没有直接编辑生产 SQLite。

## 47. PROD-047 — 旧 Aftercare Reclaim Receipt 已提交，但执行图仍活跃（CORRECTION COMPLETED）

发现：2026-09-01。PROD-041/046 让 3 条历史 `care_workspace_reclaim` Attempt 获得真实恢复机会后，
它们稳定失败为 `ARCA_AFTERCARE_WORKSPACE_RECLAIM_RECEIPT_DRIFT`。只读审计证明对应 Aftercare Case
均已终态，Workspace Registry 和全部 Material 已于旧版本中完成 reclaimed，Artifact 不再活动，文件也已经
回收；但当时写入 Material 的 `ReclamationReceipt/v1` digest 不含后来新增的 `scopeDigest`。Execution
Foundation 又没有该旧领域提交的 Result/Commit Marker，所以当前 Runtime 只能 fail closed，不能把它升级为
成功，也不能安全重放。

处理边界：Product Owner 已授权一次性数据纠正，只终止这 3 条旧 Arca Work/Event/Attempt/Effect 执行图；
不伪造成功 Result，不重写旧 Receipt，不改 Aftercare Case、Inventory、Workspace Registry、Material reclaimed
事实或媒体文件。实现为默认 dry-run 的 `helix-prod047-aftercare-reclaim-residual-correction.js`：它以旧/新
Receipt 的精确 digest 差异、终态 Case、完整 reclaimed scope、零 Result、零 Commit Marker、零活动引用和
单一 reclaim 执行图共同证明候选；apply 还要求操作员逐条传入 exact Work ID，集合不完全相等即整批拒绝。
仍为 active、领域回收尚未发生的正常 Aftercare Workspace Work 只列为 excluded 诊断，不进入事故候选。
NAS 包装固定执行标准部署 dry-run、停服、完整 data backup、离线事务、`integrity_check` 和标准 deploy；任何
CAS 或不变量失败都会阻断并重启未改变的服务。

本项是有界生产事故纠正，不是 migration、兼容读取、Receipt 升级或 Runtime fallback；脚本不得包含影片、
路径或生产 Work ID 常量。

执行：统一镜像 `helix-beta-20260901-84b8d313e0` 部署后，以
`/vol1/1000/docker/shelfdeck/data.backup-20260901T082544Z-prod047-aftercare-reclaim` 为离线备份执行纠正。
exact 3 条 Work/Attempt/Event 收口为 cancelled，3 条 Event Attempt 完成 cancelled Outcome，3 条未提交 Effect
收口为 failed，统一错误码为 `P4_LEGACY_AFTERCARE_RECLAIM_EXECUTION_RETIRED_PROD047`。事务后
`integrity_check=ok`，再次 plan 返回候选 0、unsafe 0。生产监控中的另外 2 条 active Aftercare reclaim Work
只有 inode drift 且领域 Workspace 仍 active，不属于本项候选或授权范围。

## 48. PROD-048 — Nuclear Reset 遗留 WorkAdmission Receipt 导致新 Intake 再次占满席位（FIXED / DEPLOYED）

发现：2026-09-01。首次补齐 orphan token 范围的获授权 Nuclear Reset 成功清零全部 postcondition，但服务恢复后
不到一分钟又形成 3 条新 token，且没有 Subject、Run 或 Intake Work。生产只读联表排除 Work/Event hard cap 与
Circuit：仅 2 个 Arca open Work/Event，Admission circuit 为空；3/3 token 各命中一张
`helix.foundation.work.submit@1` Command Receipt，Receipt target Work 均不存在。

根因：Nuclear `deleteExecutionGraph` 删除 Work 图时只按业务 `scopeIds` 删除 Command Receipt，没有把
`graph.workIds` 加入 `target_id` 范围。后续 Procurement Offer 重入时，WorkAdmission 幂等回放旧的 admitted
Result，却无法恢复已删除的 Work；Intake 因此持有 token 并永久等待一个不存在的 Evidence Work。第二次清掉
当前 3 张 Receipt 后又出现 3 个 token，但 Receipt `committed_at_ms` 比 token 早约 43 小时，证明不是新事务分裂；
全库共有 3,274 张 Libra phantom Receipt（Intake 1,433、Acceptance 726、其他 Libra 1,115）。

修复：Nuclear 删除图时同步删除所有以被删 Work 为 target 的 Command Receipt；两种 Reset 还会全局识别并删除
Libra 中 target Work 不存在的 phantom WorkAdmission Receipt，在新 Offer 获得 token 前清空整个潜伏池。没有
Admission fallback、Receipt 兼容读取、生产 ID 或 Offer 特例；19 张 Arca phantom Receipt 不纳入本项。生产再次
apply 前仍要求完整备份、精确 dry-run、零 blocker 与逐项 postcondition。

生产验收：`helix-beta-20260901-0813ae2991` 部署后，Nuclear dry-run 精确报告 3 条 orphan token、3 张直接
关联 Receipt、3,274 张 Libra phantom Receipt，且 Subject/Run/Workspace/Package/On-deck/Work 全为 0、blocker
为空。离线 apply、幂等复验、SQLite integrity 与外键检查全部通过。服务恢复后 3 个自然 token 的 Receipt target
Work 均存在，每个 process 已形成 2 条 Intake Work；没有再次出现 Libra phantom Receipt。备份位于
`/vol1/1000/docker/shelfdeck/backups/formation-reset-20260901T092339Z-nuclear/data`。19 张 Arca phantom Receipt 与
2 条 active Aftercare reclaim Work 未被修改。

## 49. PROD-049 — Formation 用现有 Plan 终态冒充业务阶段完成，并泄露内部 Result 枚举（FIXED LOCALLY）

发现：2026-09-01。生产新自然 Intake 条目《地狱为何恶劣 (2013)》整体仍为 `in_progress`、Routing 仍为
`preparing`、Acceptance Spec 与 Libra Run 尚未形成，但详情把“媒体整理”阶段显示为“本阶段已完成”。同一详情
还把 `procurement_candidate_published`、`libra_binding_draft_resolved`、`handoff_a_accepted` 直接拆成
英文词组展示。

根因：阶段投影把“当前已经存在的 Supporting Work/Plan 都成功”当作阶段完成；这只能说明已执行工作终态，
不能证明该业务域的交付边界已经成立。结果投影对未知枚举使用下划线拆词兜底，又把内部 Receipt kind 当成
用户文案。

修复：Formation 详情调用方必须显式提供三段业务状态。材料准备只以 Handoff A Accepted 后成立的 Subject
责任为完成边界；媒体整理只在 Handoff B Accepted 使 Libra Run completed 后完成；验收与上架只在 Arca
On-deck Commit 后完成。已存在 Plan 全终态但边界未成立时继续显示进行中，正式边界成立则不会被历史失败
Plan 拉回。Result 只使用封闭的稳定中文映射，未知机器枚举不展示；Candidate Publication 文案也不再误称
Libra 已经接收。本项没有影片、Subject ID、旧条目兼容、SSOT 改动或生产数据修改。Formation focused
44/44、P14 Formation truth 8/8、Service full 411 pass / 18 skip / 0 fail、Admin Web 42/42 与 production build
通过；Architecture fixture、semantic、manifest 与 contract 均通过，总 gate 仍只受 main 既有 18 个
dynamic-template scanner findings 阻断。Service production dependencies 与 Admin Web 全依赖经 npm 官方
registry 审计均为 0 vulnerability。
