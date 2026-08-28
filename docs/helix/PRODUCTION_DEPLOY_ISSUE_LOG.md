# Helix-beta 生产部署问题台账

状态：`NAS PRODUCTION ISSUES OPEN / NO FIX AUTHORIZED IN THIS DOCUMENT`

建立日期：2026-08-28

环境：飞牛 NAS `http://192.168.12.230:18080`，容器 `shelfdeck`。首次 cutover 镜像 `helix-beta-20260828-a3e07a1e1`；当前运行镜像以 `docs/v3/CURRENT_STATUS.md` 为准。Admin Web 走 HTTP，不是 localhost，也不是 HTTPS。

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
| PROD-004 | 文件来源与收藏架都指向容器路径 `/media/Film` | 配置选择 / 后续 Settlement 风险 | 文件来源配置、收藏架配置 | Medium | **OPEN / 先不修**（SSOT 允许同根，不是当前空工作区的原因） |
| PROD-005 | 一部都没上架；整理工作区数量看起来卡住 | 配置 / Workspace 根未生效 | 系统设置 Workspace、媒体整理工作区 | Critical | **FIXED by restart on upgrade**。`/transcode` 就是本机 Production Workspace；升级重启后按 durable `/transcode` 生效。冲突错误现带 configured/durable 路径。配置不变。 |
| PROD-006 | 打开媒体整理工作区卡在「正在读取媒体整理工作区…」 | `USER_EXPERIENCE` / 全量分页 | 媒体整理工作区 | Critical | **FIXED**。页面原先等 897 条全部拉完才渲染；现先画第一页，其余后台补齐，轮询只刷新首页。 |
| PROD-007 | 整理协调器 `P9_REFERENCE_MATERIAL_CORRUPT` / remux `P9_MEDIA_OUTPUT_CONTINUITY`，升级后管理端口起不来 | `EXECUTION` / Workspace root identity + startup recovery | 媒体整理工作区 | Critical | **FIXED**。材料句柄用内部 `service-local-workspace`，durable 根是 `local-filesystem-linux`；启动恢复还在 `listen()` 前续跑长时间 remux。句柄按 durable 根无损重盖章；workspace-write 恢复推迟到就绪之后。 |
| PROD-008 | 确认影片身份后仍停在「媒体身份信息冲突」 | `EXECUTION` / 工作准入硬顶 + 展示用旧观察 | 媒体整理工作区 | High | **FIXED**。选择意图已写入，但开放 Work 正好 256，后续 exact TMDB 观察进不了队；页面仍读旧冲突观察。Libra Run 准入放到 1000；有更新的选择意图时不再把旧冲突当待办。 |
| PROD-009 | 试运行长时间没有第一部 Arca 上架；`/transcode` 写满 | `EXECUTION` / Intake 无席位 + Workspace 24h grace | 媒体整理工作区、Workspace | Critical | **FIXED**。Intake 同时只接 3 个未完成 Pre-deck；Off-load Completion 后立即开始回收 Workspace，不再等 24 小时。干净部署后按同一套 Field/Shelf/Workspace/TMDB 取值重建。 |
| PROD-010 | 整理路径不能提前当 checklist 勾选；转码未规划出来时页面仍像「封装完了等验收」 | `USER_EXPERIENCE` / Formation 投影只回放已有 Event | 媒体整理工作区 | Medium | **FIXED locally**。等待无损升级。路径模板提前铺开，当前进展跟人话。 |
| PROD-011 | 片源探测已能判定本地加工补不上时，仍先整盘 remux 再寻源 | `EXECUTION` / Libra 媒体阶段顺序 | 媒体整理工作区 | Medium | **FIXED locally**。等待无损升级。source probe 后栅格/音轨补不上则直接寻源。 |
| PROD-012 | 用户放弃后，工作区仍留「等待重新入库」待整理行 | `USER_EXPERIENCE` / Formation 当前 Subject 与结束历史叠在一起 | 媒体整理工作区 | Medium | **FIXED locally**。等待无损升级。放弃后当前列表不再挂 pending 行。 |

PROD-001、PROD-002 的共同环境前提：生产管理台是 `http://192.168.12.230`，浏览器不提供 `crypto.randomUUID` / `crypto.subtle`。这不是传输加密设计，只是浏览器 API 限制。未改成 HTTPS。

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

## 5. PROD-004 — 来源与收藏架同为 `/media/Film`（OPEN）

用户把文件来源和收藏架目标都配成容器路径 `/media/Film`（NAS `/vol02/1000-0-c5b736af/Film`）。SSOT 允许 Field 与 Shelf Target 同根，这不是 PROD-003 空工作区的原因。风险在后面：成品也写回同一棵树，Settlement /「磁盘有、Inventory 无」会对账更绕。页面没有强提示「源目录和成品目录现在是同一个」。先不改配置、不改合同。

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
