# Formation 终态收尾接手诊断（2026-10-23）

状态：诊断完成，产品修复与生产处置未执行。基线：`ee0c4786b`（`codex/formation-big-release-20261022`）。

本聊天原 checkout 为 `983b6a04a`，诊断实际读取 `ee0c4786b` 所在开发目录。没有切换分支、修改产品代码、部署、生产 Reset 或生产数据写入。本次没有重新查询 NAS；198/214/11、Control 分布等是用户交接的现场快照，不能当作本次实时核验结果。

## 工作项与范围

沿用唯一 CURRENT_PHASE，新增命名工作项 `FORMATION-TERMINAL-CLOSURE`，本次完成其诊断。Owner 为 Libra；Procurement 只负责正常观察、资格与新 Candidate；Material Control 维持既有 release/acquire 合同。性能、旧收藏离线补文件及生产处置不在本次诊断实施范围。

用户交接的新方向作为后续设计输入：保留有界系统 auto-discard，但不能把 Provider/网络/FFmpeg/候选不足直接终结；Run、Subject、Control、token、可见结果及审计必须闭合。没有改为 Subject 长期保有 Control，也没有引入逆向 Handoff。

## 已确认发现

### 1. 自动结束使用了错误的判定代理

`libra-run-admin-service.js:409` 的 `reconcileFrozen` 调用 `defectCandidate`；`P9_DEFECT_ADMISSION_INELIGIBLE` 或 `P9_DEFECT_ADMISSION_NONWAIVABLE` 直接进入 `discard(..., 'processing_failed')`，并不独立验证“这是允许自动终结的业务原因”。因此“不能豁免要求”与“本次应自动结束”被耦合。缺少必需 Artifact、缺少安全验证等均可能到达此路径。现有 integration unavailable fixture 确实在有界等待后自动 discarded。

这不是本次 ee0c4786b 新增的路径。后续应把产品资格、技术重试预算、业务终局资格分开；失败码字符串或 `integration_exhausted` 分类本身不能授权释放责任。

### 2. 系统终局不执行 Subject 收尾

`libra-run-admin-service.js:544` 仅当 `terminalReason === 'user_cancelled'` 调用 `cancellations.complete(subjectId)`；系统 `processing_failed` 跳过此步，但继续释放 token、失效 Projection 和 wake。

`task-cancellation-store.js:102` 内才有“无剩余 Control、全部 Run discarded/superseded → Subject abandoned”的检查，并且依赖 pending 用户取消意图。不能给系统补一个伪造用户取消意图来绕过此缺口；应由 Libra 定义双方共用的责任终结及可恢复收尾。

真实当前 SQLite schema 的隔离 fixture 复现：single Subject `active`；Run `discarded`；Decision actor `system`；原输入 Control `released` 且 owner 为 NULL；取消意图 0；Outbox 仅含 `libra.workspace-cleanup.requested@1`。因此新运行即可产生该组合，不是必须由旧数据迁移才能出现。

### 3. 活动列表隐藏不证明责任已终结

`formation-query.js:726` 用 `!currentRun && nextAction.label === '等待重新入库'` 判断 `isIdleAfterUserAbandon`，没有检查 actor 或终局 Receipt。`countHiddenActive` 和 `isVisibleActiveItem` 同时影响列表与计数；后者还要求 token/currentRun/Handoff B，单纯删掉文案判断仍不足以修复可见性。

但“系统丢弃彻底不可见”不成立：`formation-run-history-store.js` 可从 Discard Receipt 和 `processing_failed` Outcome 在 ended 区显示“无法上架”。活动列表按 Subject，结束历史按 Discard Receipt/Run（另合并无 Run 的 Subject abandon Receipt），不能直接把两区行数视为同一粒度。缺少 Receipt/Outcome 的历史仍需独立核账。

### 4. Reset 的历史保护承诺存在可复现交集

`user-formation-reset.js:22` 选择 active 且 Projection 为 in_progress/attention_required 的 Subject；`helix-formation-reset.js:335` 收集所选 Subject 下所有未 Commit 的 Run，不排除 discarded；随后删除 Discard Receipt、Decision、Outcome 和 Run。`RuntimeControls.tsx` 却无条件声称保留已完成/已结束历史，preview 的 `protected.endedRunCount` 也是全库计数，未扣除删除范围。

隔离复现 seed `active Subject + discarded Run + in_progress Projection + unable_to_on_deck Outcome`：公开 preview 返回 `ready=true`、`protected.endedRunCount=1`，选中该 Subject；同一 scope 的 apply 后 Run=0、Outcome=0。此 fixture 证明 selector/deletion 交集，不冒充完整生产副本演练。

因此 scoped Reset 198 项也会删除这些 Subject 所含终态历史。全量备份使其可离线追溯，不等于运行库保留历史。既有“删除所选未 Commit 闭包”和最新“保留 ended 历史”不能在这个交集上同时成立；修复前不能把当前 Reset 作为满足全部保护要求的方案执行。

## 需要纠正或保留开放的判断

1. **自动 discard 并非天然违反 SSOT。** §5.6.7 等旧段要求用户决定，但后文 `UAT-251 / UAT-212：2026-09-08已确认结果与展示修订`、9 月 12 日持久结果修订明确覆盖旧规则，允许“本次无法上架”及责任收尾。用户本次进一步限制技术失败的自动终局，需要同步相关 SSOT/typed 规则；不能仅据旧段把自动终局整体删除。
2. **release 不等于把 Control 直接交给 Procurement。** Discard 对 Run Manifest 逐成员执行 `release`、`toScope:null`，释放后无主合法。Procurement 后续正常 acquire 才成为 Owner；不能为“完整回 Procurement”实现反向责任转移。
3. **198 个旧 Subject 不等于 198 份材料当前完全停摆。** 当前 Control 已是 Procurement 的材料可能已进入新流程，也可能停在新资格/Selection；必须沿 materialKey 检查新的 Observation、Procurement Run、Candidate、Handoff A 和新 Subject。旧 Subject active 残留与材料没有后续进度是两个问题。
4. **不是完全没有定期重采机制。** `field-observation-automation.js` 已有启动扫描和 12 小时周期（本轮相关 11 项测试通过）。Discard Outbox 没有 Procurement 通知；现有 `reconcileMaterialControlChanges` 消费入口仅用于 Shelf deregistration。并且 `availableForAutomaticRun` 明确拒绝同 Observation 重放新轮次，简单新增 wake/重跑旧 Observation 不足以保证新尝试。需查实际周期 Observation 是否成功、资格与 Selection，而非直接新增重复 TTL。
5. **5 个 Subject / 202 个仍由 Libra 持有的材料尚不能直接定性为 release 部分提交。** 当前 release 是同事务、精确 Run Manifest 集合。必须逐项比对被丢弃 Run Manifest、当时/当前 Control revision、其他 Run 与后续 intake；可能是 Run 范围外的 Subject 剩余输入或重新取得责任。所有 Run 已 discarded 且责任仍无消费者确属需闭合的异常，但不能不核范围便释放整个 Subject，Series 尤须保留其他范围。
6. **6 条缺 Decision 单独追踪。** 汇总无法证明是合法历史变体还是完整性损坏；需查原 Run revision 内 Decision、Receipt、marker、Outcome 与 Control history，不补造审计。

## 验证

Windows / Node：

```text
node --test test/helix-architecture/p9-run-lifecycle-store.test.js test/helix-formation-projection.test.js test/helix-architecture/p7-field-observation-automation.test.js
73 PASS / 0 FAIL / 0 SKIP
```

另以 Node Module 在内存加载上述 lifecycle fixture 和 Reset fixture，注入只读诊断断言/临时 SQLite 测试数据，各 1 PASS；未修改原测试文件或产品代码。前者复现系统终局后的 active single Subject，后者复现 Reset 的历史保护交集。临时 fixture 按原测试清理；无生产访问。原测试 PASS 说明旧行为被测试固化，不等于满足本轮要求。

未执行：完整 Gate、Linux/Docker、浏览器 UI、生产只读逐材料核账、完整副本 Reset、新版部署或生产验收。不继承交接里其他测试为本次 PASS。

## 后续验收顺序

1. 先冻结本轮有界终局资格；恢复仍在原 Owner/Work 合同内，不重开不可变 failed 执行，不重试绕过安全边界。
2. 新建 single/Series 的系统终局和用户取消均验证责任闭合；保留其他 Series Run/待分配 Episode，Subject 结束或保持有明确理由，token 不早放、不漏放；覆盖提交前后崩溃与重放。
3. UI 从正式终局/责任事实分类，活动列表与 ended 历史各自粒度清晰，不能靠中文文案推断用户决定。
4. 验证 release → 普通新 Observation → Procurement acquire → 新 Candidate → Handoff A；对已进入新链的材料不重复触发，不加逆向 Handoff。
5. 解决 Reset 范围与历史保护的交集，真实生产副本验证当前保留集合和删除闭包后，再按明确生产授权处理旧数据。198/225 均不能直接作为已冻结执行清单。

目前结论是可复现的生命周期收尾缺陷，且 Reset 存在独立保护缺口；不需要因此推翻 A 模型或引入长期 Subject-scoped Control。

## 最近提交与版本上下文复核（2026-10-23）

用户要求先恢复版本上下文，暂不进入修复。复核 Git log、关键产品 diff、git blame、CURRENT_STATUS 与原专项 Evidence，主要范围为 10 月 21 日生命周期版至 ee0c4786b；对自动 discard 和 UI 隐藏追溯更早来源。下述上线状态来自已记录发布证据，不是本次重新查询 NAS。package version、旧 VERSIONING 当前值及 Git release tag 不能替代实际镜像/commit。

本轮另重跑 `node --test test/helix-architecture/series-shared-presentation.test.js test/helix-architecture/p14-h1-tmdb-integration.test.js`：20 PASS / 0 FAIL / 0 SKIP，约44.7秒；涵盖真实Integration Runtime Handle及NFO正反例，不等于生产五项重试成功。仅更新本Evidence，无产品改动。

| 批次 | 关键提交 | 实际解决的问题 | 状态/边界 |
| --- | --- | --- | --- |
| 10-21 普通重采与公平竞争 | 63ad3baa2 | 移除 Libra 的历史失败同条件 reentry 抑制；Procurement 技术准备失败可在下一次普通 Observation 重做；Libra Run 按来源轮次及 Candidate 发布时间公平竞争；Arca 恢复不再只处理分页首项 | 已随后续生命周期版上线；未修改系统 auto-discard 的终局判定，也未补系统 Subject 收尾 |
| 10-21 取消与恢复生命周期 | 843bdff25、40861e877 | 持久取消、安全收尾后完成；无 Run Subject abandon；取消与排除分开；Intake/Routing/Spec 准备失败可人工重试；退休来源闲置 Control 释放；superseded Workspace 回收；Arca 人工恢复取消32代限制，自动限制保留；优先级投影重启恢复 | 已记录部署；Subject 终结检查新增在用户 cancellation.complete 中，系统分支仍绕过 |
| 10-21 重试界面及分页修正 | 438822156、6c7493964 | 撤销独立准备异常入口，准备异常并入原任务行；统一“重试任务”；修 ended 只读数组分页500、混合分页、迟到请求错误覆盖 | 6c7493964 已记录部署，是3.1.0前生产基线；这不是后来三段重试标签方案 |
| 3.1.0 主功能开发 | 85ab5c7e1、ab5f610ae、29824b87d及后续 | UAT-326：JAV来源资格稳定，执行时签短期Handle，处理TTL后恢复漂移；UAT-327：分类目录按完整媒体组确定性分批，保留1024上限；UAT-328：剧根tvshow.nfo/poster/fanart、剧/季/集Provider scope、跨季复用、重试补图、维护、退出、Workspace回收 | 经hostfix3进入生产；5部剧集异常属于新公共资料路径首次上线的缺陷，不是旧版已运行同路径后来失效 |
| 10-22 发布前增量 | 3917633f8、48cd492c7 | Season目录poster/fanart/season.nfo作为相关来源；Movie从源文件名/父目录派生edition，避免不同版本撞同一目标；不能形成安全edition时明确报错 | 已包含在后续上线镜像；作用于新事实/新包，不重写旧冻结Package；高达/凡人歌现场未因提交自动收口 |
| 10-22 其他增量 | 27a43e6c5、91e991c4b、16665e604、62624bc45、99ff13e14、23abf7705 | 筛选刷新保留计数；US Adult新分析阈值0.42；冲突诊断及“处理冲突”入口；恢复错误带Event身份；写入类输入漂移显式失败并保留Effect，pure observation改为新Attempt重试 | “处理冲突”随后由ee0c删除；这些不是本轮P1–P4性能优化。pure observation先被626纳入终态，后被23ab改为重试，不能只读中间提交描述最终行为 |
| 3.1.0 首次部署尝试 | 23abf7705 | 上述组合候选225→231结构升级 | 10-22 17:25记录因Aftercare root冲突回滚，不能视为成功上线 |
| Host修复并成功升级 | c18618177、37a264935、064f01d13、2664b4014 | 读取持久Aftercare root；识别旧生产Catalog；blocked投影避免嵌套事务；接受精确旧业务终态Result的reason vocabulary | 10-22 20:20记录3.1.0-hostfix3成功；注意37a包含旧active Plan按当前Capability/Projection检查后恢复，不只是历史展示兼容，未在本轮评价其授权充分性 |
| 3.1.0-hostfix4 | b70a9f6f6 | 已取消Subject不再请求仅接受active Subject的评分，消除Formation列表/详情/后台投影500 | 10-22 21:36记录部署；只修查询，不修剧集Handle/NFO或系统discard |
| 最新本地修复 | ee0c4786b | TMDB profile声明artifactOperations；真实Handle接受剧集source/assets的poster/fanart；NFO允许-1占位；三段重试标签、删除冲突对话框；扩大工作台Reset并增加receipt | 未记录部署、生产重试尚未验收；Reset保护交集见本报告，不能以已有40项PASS宣称完整保护成立 |

另有 ddc904b24 仅退役新增UAT编号，e204b7b71/435438250/38cf87426 等为缺陷/发布记录，不是额外产品修复版本。

### 新发现问题与版本的因果边界

- `git log -S` 与 blame 确认 `reconcileFrozen → ineligible/nonwaivable → processing_failed discard` 核心分支来自 **eae6bb3da（2026-09-12）**；不是3.1.0或ee0c新加。
- `isIdleAfterUserAbandon` 可追溯 **e4d601cd9（2026-08-29）**，后续接包可见性另有调整；不能归咎于hostfix4新增。
- **843bdff25（10-21）** 新增用户取消完成后的Subject收尾，但没扩到系统终局；**63ad3baa2** 去掉同条件再入抑制。历史终局遗留、后续新尝试与当前材料归属因此须分开核账。它们可能共同使残留更显著，但尚未证明198条的增长因果或唯一引入版本。
- **ee0c4786b** 同时包含原7条问题所需的部分修复与额外Reset扩展；必须逐工作项验收，不能把这一提交整体标为“7条问题已解决”。
- 原主线不变：5部剧集重试验收、高达两条独立收藏、凡人歌一条Season且正常替换poster、三段重试UI；性能本轮不修。198项是新增生命周期诊断，不自动替代主线或授权清场。

## 生产独立复核与下一步计划（2026-10-23 02:18–02:25，Asia/Shanghai）

本次实际连接NAS；通过项目`nas-ssh-config.js`读取连接配置，Docker inspect只输出镜像/commit/运行/挂载白名单；容器内SQLite使用`readonly:true`及`query_only=ON`，查询通过stdin执行。只读取4个现场NFO的root/season/episode结构，没有导出完整生产库或Secret。一个逐材料查询耗时过长，已终止本任务独有诊断进程（不是服务），改为一次读取必要列后在内存聚合，约2秒完成；后续查询加25秒强制时限。未执行扫描、重试、Reset、部署或任何生产数据/媒体写入。

### 运行事实及原问题范围

- 镜像`markmahoro/shelfdeck:3.1.0-hostfix4`；revision `b70a9f6f6dde90654fbdef70e226b11f25f709f5`；image ID `sha256:d94bcda0875bc51059dfa601f5fec3b0f220d9b0925029fadd75886c649a886e`；启动时间2026-10-22 21:36:23，restartCount=0。health HTTP200、status=ok、normalSupplyAllowed=true。ee0c未上线。
- Projection：attention_required14、in_progress213、completed676。197个active且无current Run/token的Subject，另2个abandoned投影；实际active Run14、token14。上述为有限时点快照，不能当成未来操作清单。
- 11个共享剧根Work失败影响12条attention（风骚律师有两条Subject）：Handle错误7根——开端、权力的游戏、空战群英、风骚律师、匹兹堡医护前线、越狱、枪口彼端；NFO_SCOPE错误4根——西北岁月、风声、隐秘的角落、武林外传。当前失败Event均为`arca.series_presentation.source.observe@1`。现场4份tvshow.nfo根均为tvshow且season/episode均为-1，与ee0c修复条件一致；不能把“同一错误码”单独当作全部修复成功。
- 高达、凡人歌仍为`arca.inventory.product.stage@1 / CLEAN_ARCA_STAGE_TARGET_OCCUPIED`，custody active、On-deck blocked。高达旧包发布于10-22 09:01，源文件名带1080p FLAC；凡人歌旧包发布于10-21 22:57，包有37个Primary。两者均早于10-22的edition/Season related source修复。已有青瞳收藏的On-deck committed事实存在。未重新枚举全部媒体文件/计算大文件Hash，旧现场细节仍按原Evidence处理，实际新包目标和替换集合必须在副本/正式新链验收。

### 对“198孤儿”的更正

实时active残留Subject为197（single175、season22），latest Run actor：system175、admin16、缺Decision6。它们是Subject残留，不是197个仍执行的孤儿Run。

从这些Subject的current绑定取Primary/structural_dependency，按materialKey去重为937个：

| 当前Control | 去重材料数 | 含此类材料的旧Subject数 |
| --- | ---: | ---: |
| Procurement / material_field | 380 | 152 |
| released / 无主 | 435 | 40 |
| Libra / **其他Subject** | 41 | 4 |
| Arca / on_deck_custody | 81 | 1 |

旧Subject绑定重复，不能把绑定行数当成独立物理材料数。41个Libra材料归属两个其他Subject（一个40集Series与一个JAV），81个已到Arca On-deck；**未发现Control仍属于这些对应旧Subject**。因此本轮现场证据不支持“5个旧Subject的202个材料release不完整”。不据此证明每个历史事务均正确，但不能执行旧绑定集合的强制释放。

按每个去重材料关联的最早旧Run terminal时间，与该材料最新Procurement Selection比较：660个有后续Selection，其中264个candidate_delivery、280个transferred/handoff_accepted、62个released/triage_failed、54个released/handoff_rejected；277个未见晚于该比较点的Selection。这个口径证明有后续流程，**不代表660个现在都正常推进，也不代表277个全部故障**，更不证明每次最新失败之后都已重采。下一步只对未闭合/失败分支按新Owner和真实资格原因核账。Field表也有后续Observation，不能再说系统完全没有重采触发/TTL。

6条缺Decision的latest discarded Run同时没有Discard Receipt或Outcome：有话好好说、网络谜踪、怦然心动、2001太空漫游、银翼杀手：2022黑暗浩劫、猎头游戏。暂列审计完整性待查，未认定损坏原因或补造记录。

系统终局后single Subject保持active的隔离复现仍成立，UI按“等待重新入库”文案推断用户放弃仍不正确；上述更正不取消这两个产品缺陷。Run ended历史已有展示入口，不应夸大为完全不可见。

### 建议交付及验收

1. **原问题优先交付。** 继续ee0c真实Handle/NFO修复、三段动作；当前12条共享资料attention走原条目重试上架，不先Reset。验收11个剧根的正式资料、关联Season Commit、健康与无重复收藏；共享资料由Arca负责，与Libra残留Subject专项分开。
2. **Reset先补保护，再只准备两项。** 解决selected active Subject包含ended Run时的删除/保留合同交集；在生产副本验证历史、其他Subject新Control、共享资料引用及收藏保护。精确选择高达/凡人歌，检查accepted custody/target与已有物理effects闭包；原文件和已Commit收藏保留。经具体生产授权后采用新镜像工具，必要顺序为构建/校验新镜像→标准停机/完整备份→新镜像scoped Reset keep-stopped→部署/启动→普通新Observation/新包；禁止旧镜像Reset。高达验收两条独立收藏，凡人歌一条Season并正常替换poster。部署重启仍可能中断在途转码，但Reset范围不得包含其他active Run。
3. **生命周期独立收口。** 明确何种原因可系统自动终局，不能把“不能带缺陷上架”直接当成“永久不可继续”；技术故障在所属Owner预算内重试或attention。single/Series终局、其他Episode/Run保留、精确Control revision、token、审计、Projection与重放统一验证。保持A模型，不借此引入Subject-scoped Control或逆向Handoff。完整UI状态不能依赖中文文案或伪造用户取消。
4. **旧197项最后决定。** 先完成新任务不会复现的验收，再核对缺审计6项和真实无进展材料；按闭包准备历史处置方案。当前不推荐统一Reset197/198/225，更不释放已转到新流程的Control。迭代期不为旧在途增加兼容恢复层；若最终选择行政退役，也必须满足历史保留及新Owner保护约束。

本轮只更新唯一CURRENT_PLAN/CURRENT_PHASE及CURRENT_STATUS事实。产品未改、未提交，既有全量/平台/浏览器证据不继承为新候选PASS；本次新增验证为前述73项、真实Handle/NFO20项和两个隔离复现。性能P1–P4与旧剧根统一离线补文件继续不纳入。

## 实施开始与生产停机冻结（2026-10-23 02:36–02:43）

用户随后确认七项实施范围：剧集修复、三段重试、整体Reset重做、生命周期根因、高达/凡人歌隔离验证、独立性能诊断迭代、发布验收。性能不沿用前序agent的分项/根因；两部真实入藏等待正常采购，不阻塞本轮开发交付。上节“只记录/性能不纳入”和精确两项运维Reset推荐已被此决定替代；用户界面整体Reset没有单片选择能力。生产Reset仍未执行。

用户明确要求先安全停机。02:36:28 POST Runtime stop（idempotency key `incident-freeze-20261023-main`），持久intent revision23/desiredMode stopped，normalSupplyAllowed=false。Runtime有1个inFlightRecovery未排空；只读容器采样CPU357.95%、内存2.088GiB，Node累计CPU71.5%、FFmpeg累计261%，FFmpeg已运行04:56:53。这些混合瞬时/累计指标仅是现场采样，不能直接推断所有界面慢都由FFmpeg导致。

随后对精确容器ID `9250d8f8a15267aa1d370ddfd37a618dbf9dfb7677abff831f641b6756c3d9be`执行`docker stop --time 75 shelfdeck`。02:38:23退出，exitCode1、OOMKilled=false、RestartCount0；日志收到SIGTERM后报`P4_SHUTDOWN_CHECKPOINT_TIMEOUT / Operational checkpoint deadline expired`，是既有60秒检查点超时保护退出，不能记作完整优雅排空PASS。其他15容器运行保持。持久intent为stopped/revision23/pendingReset=null；未将执行补写为业务失败，无Reset或源文件改动。

完整data冷备：`/vol1/1000/docker/shelfdeck/backups/incident-freeze-20261023T023823/data`。源及副本196个文件逐文件SHA256清单一致，清单SHA256为`7e115a1b966f5f9c947d455d4aa60a832facd580c02093296026644bf2260d1a`。此备份不包含媒体/整个transcode Workspace，不冒充未来Reset所需完整范围备份。SQLite主文件4,614,598,656 bytes，WAL11,045,752 bytes、SHM32,768 bytes随副本保留。初次25秒只读quick_check/FK组合未返回、被诊断时限结束，不能记SQLite完整性PASS；有限聚合查询正常读取。

冻结后Projection仍14 attention/213 in_progress/676 completed，Libra14 active/690 completed/199 discarded/38 superseded。Foundation保留1 executing Event，20 destructive_commit/reconcile_required Effect和1 workspace_write/intended Effect，未抹掉未决证据；后续Reset必须处理这类阻挡，不能绕过。

进一步读取6个缺审计Run：current state_revision均4/discarded，terminal_at_ms一致为1788097290969（2026-08-30）；修订链仅有1 admitted、2 freshness_confirmed、3 completed，缺4号revision。与当前自动discard链不同，证明其不是10月新建终局；历史PROD-031/032记录了同期仅改Run/Work的早期full reset，但尚未取得本6条精确命令receipt，不能把因果推断写成已证实。无补造记录。

产品最小防误删保护已加入`user-formation-reset.js`：检查实际删除闭包是否包含discarded/superseded Run，有则RESET_ENDED_HISTORY_OVERLAP阻止apply，不能仅按Subject的当前tab判历史保护。新增4种classification/state组合回归验证保留Run且不进入备份/授权apply；Reset41 PASS。此保护不是整体Reset重做完成，保留历史与物理清除交集的对象生命周期方案已向用户请求确认，依赖部分待答复，独立项继续。

本轮重新执行真实Handle/NFO20 PASS；Web五文件31 PASS（series retry、collection、runtime controls、Formation tabs/stage conflict）。生产同构性能诊断在独立工作副本与隔离容器进行：当前生产镜像、network none、媒体及transcode只读、生产服务保持停止；使用正式Host入口且不跳过完整性/恢复检查。完整Host测量尚未完成，不宣称性能根因或优化收益。

## 2026-10-23 03:06 隔离性能测量与实施检查点

上节Host测量已完成。生产保持同一容器exited/restartCount0；本任务诊断容器已退出并自动移除，15个其他容器保持运行。无生产Reset、部署或正式媒体改动。完整七项迭代尚未完成，不以本节局部修复替代发布资格。

### 测量环境与边界

从已校验冷备复制出独立可写目录`diagnostics/incident-20261023/data`；使用生产镜像的正式`createCleanServiceHost`入口，网络禁用、3 GiB内存上限、容器根只读、媒体/transcode/生产data均只读。Host的dataDir明确指向`/rehearsal/data`独立副本，生产data只在原`/app/data`位置作为物理Workspace身份来源。前两次隔离挂载因Aftercare mount scope不一致而拒绝启动；改正挂载后通过原守卫，没有改写持久root或跳过检查。完整性/外键检查、启动恢复和正式HTTP路由均实际执行，Runtime一直为stopped，没有运行FFmpeg或恢复普通业务供给。Host完整性检查通过不等于未决Effect已完成。

基线Host启动约162.6秒，其中FK检查4.0秒、integrity_check29.7秒；诊断候选启动约169.5秒，FK6.7秒、integrity35.3秒。CPU profile含启动期，最大事件循环延迟约110秒主要发生在启动核验，不能把它当成稳态页面延迟。未取消完整性/历史证据核验来缩短启动。

基线是生产image ID；诊断候选在同一镜像中只读挂载本轮两个修改文件`formation-query.js`、`progress-projection-reader.js`。两次顺序使用同一工作副本，Host会更新该副本的技术状态；不是随机交叉实验，也不是正式候选整包资格。每条HTTP路径测3次，带SQL计时和CPU采样；结果如下（毫秒，范围/中位数）：

| 路径 | 基线范围 / 中位 | 修改后范围 / 中位 | 判断 |
| --- | --- | --- | --- |
| Runtime | 4.6–29.4 / 9.1 | 3.8–25.8 / 8.1 | 停供给状态读取正常 |
| overview已有快照 | 4.4–4.9 / 4.9 | 5.1–5.2 / 5.2 | 请求不重建快照；不能代表后台构建成本 |
| Formation active limit25 | 982.1–1128.6 / 1063.9 | 813.4–861.2 / 830.7 | 中位约下降21.9%，仍有约0.8秒同步工作 |
| collection limit24（未指定sort） | 422.3–491.7 / 482.4 | 432.6–775.8 / 523.1 | 未改此链，未证明改善；此请求默认标题排序，不能冒充所有UI筛选/排序 |

Formation三次共2208条SQL，改前后相同；collection三次987条SQL，同样相同。没有通过少读证据或放松完整性换速度。Formation/collection响应bytes分别108297/155176保持相同，仅byte数量相同不作为语义等价证明。当前测量没有并发4K、真实浏览器海报请求或网络Provider，不能宣称线上整体卡顿已解决。

### 已实现的两项局部性能修正

1. overview内部四次Formation切片复用同次读取的summary/count/history和active Owner事实。复现原groupedCounts/history各4次、active Owner读取重复；修后每个overview读取一次，下一次请求仍重读最新Owner。只在一次同步调用中共享，没有全局业务缓存。
2. CPU profile定位`progress-projection-reader`在每个Work上全量filter Plan/Event、每个Plan全量filter Edge。改为按Work/Plan一次建索引，保留Plan排序、Event顺序、Result摘要验证和缺Plan拒绝。新增128 Work/256 Event用例验证归属、共用node名称隔离、线性membership读取上界及缺node失败，防止退回平方遍历。

最终三文件回归`formation-process-projection`、`helix-formation-projection`、`clean-arca-inventory-port`共145 PASS。另已执行相关Candidate/Series layout/disposition等组合99 PASS；不能简单相加成无重复总数。Reset保护41 PASS、Handle/NFO20 PASS、Web31 PASS为本轮前述独立证据；尚无完整新候选Gate、Windows发行包、正式Linux镜像及具体版本UI验收。

### 两片现场与4K继续项

Season poster新隔离用例把真实Inventory port的prepare→stage（注入一次中断）→verify→switch→settle串起，确认`Season 01/poster.jpg`被新受管字节替换且settle不会删掉最终poster；Movie变体同时通过。此前完整Episode Claim fixture不足的首轮失败已补为精确claim digest/集合后通过，未放松产品验证。此用例与Candidate Season关联测试仍是分层证据，尚不是凡人歌37集完整新包旅程，也没有为高达创建真实双Entry；生产两项保持开放。

冻结库唯一executing Event为`libra.media.transcode@1`，immutable encodeIntent和device snapshot均为`intel_qsv`；video为`hevc`、`tone_map_to_sdr_bt709`、`pq_bt2020_base_to_sdr_bt709_hevc@1`、target_size/25,700,738 bps。最新进度50.6%，rate0.244、eta17,426,397ms（按记录原单位，不将rate擅自解释为fps）。代码`compileFfmpegPipeline`对该组合显式采用`cpu_decode_cpu_filter_gpu_encode`，HDR→SDR使用zscale/浮点格式/hable后QSV编码。高CPU与此混合路径一致，不证明硬件选择失效，也不能证明它单独导致页面延迟。后续需用有界真实媒体样本验证吞吐、色彩/播放正确性和交互竞争；本轮没有临时替换色彩管线、降清晰度或修改生产转码参数。

### Reset合同决定（03:06提出，随后用户已同意）

已提出的具体方案：整体Reset冻结选择集合，保留completed/ended历史及其外键闭包；对包含历史的当前Subject另持久化管理性退役记录，使它失去调度资格并退出工作台，来源资格交回正常Procurement链。记录明确区分系统管理退役与用户取消，不补造历史Run Outcome；旧/新Owner的Control按精确revision核对，未决物理Effect拒绝清除，不能把新Subject占用从旧绑定中释放。没有新单片UI。

当时 SSOT 的历史保留与 Playbook§3.4 的整过程物理删除存在交集冲突，因此提出了具体退役方案。用户随后回复“同意”，已据此更新 SSOT 和 Playbook 并进入实现，不再等待这项设计确认。该决定不等于生产 Reset 执行授权。

### 03:57 退役与系统终局实现检查点（未部署）

- Libra/Arca 各自以 Owner UOW + immutable Command Receipt 收口；MCA 精确 current scope/CAS 释放，追加 Control revision，不截断历史。Arca 保留 Accepted Decision、拒绝已 Commit，关闭未 Commit custody/target；Libra 保留旧 terminal Run，对未完成 Run 追加行政退役 revision，Subject 进入 administratively_retired。已收藏 Season 与未完成 Run 共存的隔离用例通过。
- Arca 迟到 Offer、后台恢复、人工重试读取退役 Receipt，不重新准入；Libra terminal Subject 不能重取 pipeline token。管理退役历史与取消/系统失败区分，缺少 marker 拒绝伪造历史。
- Operator journal 先冻结 manifest/request，再逐 Owner 执行；真实数据库在 commit 成功但 journal 尚未确认时注入中断，重建 journal 后重放精确命令只产生一份 Run revision/Command Receipt。仍需接入完整用户 Reset 和 Runtime pendingReset 恢复，不能把此核心测试冒充端到端完成。
- 最新退役/席位两文件16 PASS；首次 journal 测试发现 CommandCoordinator 返回含 undefined 的非持久成员，改为明确只记录 replayed + durable Receipt 后通过，未弱化 canonical JSON 校验。
- 系统 frozen 不能接纳瑕疵时，只有现有有限 Freshness Assessment 或精确 Product Media Verification 业务终局可自动 discard；Provider不可用耗尽保持 frozen/attention，不释放责任。single 的系统 discard 同事务结束 Subject 为 ended、核验无其他 Control/active Run并释放 token/workshop；Season 保留，由剩余责任决定席位。列表依据明确 Owner 终态隐藏，active Subject 缺 Run/token 仍显示。相关63 PASS，额外 Control/Series/恢复矩阵继续验证。
- 未完成：pending intake 的跨 Owner 收尾、共享 builder、Workspace 正式回收、用户 Reset wiring、旧231库升级及完整 Host/Catalog资格。原用户 Reset 删除实现仅加保护，不能发布使用。未执行生产 Reset、部署或源媒体改动；最近03:30核验生产停止状态不变。


## 2026-10-23 04:29 开发验证追加

2026-10-23 04:29 开发检查点：新版历史保留 Reset 已接入用户入口与 worker；pending intake 分别经 Libra/Procurement Owner 命令终结，不伪造 Handoff；持久日志支持 commit 后中断重放，恢复保持停止。退役 intake 的低层席位准入也有同事务门禁。未被 Arca 观察的已发布 Offer 已接入真实 ProductDeliveryReader 验证，保留旧 Package。Reset/Runtime/intake 70项、真实 Promotion/退役29项、Web262项和Web build通过；完整Service首跑689项中657通过/29skip/3失败，发现并修复终态短路跳过拒绝席位释放，另一失败为旧隐藏规则断言；三个失败文件重跑6项通过，完整Service尚待重跑，不能记全绿。新增精确231→231结构副本仅扩展11处状态CHECK，230个事实/执行表逐行保留，副本/回退保护2项通过，尚未做生产副本Host资格。共享builder和Workspace物理回收仍未完成；当前回执明确保留Workspace字节。04:29只读复核生产仍为hostfix4 exited、RestartCount0，无Reset/部署。性能后续诊断、两片新包旅程、完整Gate和同版UI资格仍开放。

所有测试均为隔离数据。结构复制工具尚未接入生产发布；它不修改旧事实、不解决未决 Effect、不赋予旧在途继续运行资格。完整Service暴露的新拒绝席位回归已以原真实Host测试修复，未通过调大超时或放宽断言处理；可见性断言则明确更新为 active Subject 无 token 仍可见。


## 2026-10-23 05:03 资格推进检查点（未发布）

2026-10-23 05:03 开发检查点（未部署、生产仍停机）：共享 Series 预约退出已复用 Arca retained-root retirement，保留其他 Season 的 builder 与正式文件；Owner Receipt 缺失/篡改、commit 后中断、worker pending Intake、备份改动拒绝恢复已补回归。登记过材料的管理退役 Workspace 接入原有两次 Reference/Control 观察和 Cleanup Scope；未登记字节仍保留并由回执报告，不宣称物理全清空。Service 最近一轮690/661 PASS/29 skip/0fail，但其后又改了停机顺序和依赖分层，不能作为最终固定版本全绿。静态包边界/语义/Manifest/合同四项通过，完整架构测试进行中；首轮两项旧 public exports/历史查询 fixture 已定向修正，完整Gate仍未PASS。首轮NAS结构副本230表逐行摘要一致（17.2分钟），只读Reset范围225 Subject/14 Run/11 shared scope，21未决Effect及1executing Event继续阻挡；该轮目标是11处CHECK扩展版本，新增Workspace trigger后的12处最终结构仍待重验。NAS收藏页性能复测进行中。真实转码停机已能在10秒预算内排空子进程并保留执行记录，重启首跑因测试Provider未重建而失败，修复测试依赖后重跑中。高达/凡人歌完整新包、最终副本Host/平台/UI/发布资格仍开放；没有生产Reset授权。

新增证据与限制：

- 共享 builder：两季预约中退出一季保留 builder，退出最后一季进入既有 Arca retained-root retirement；注入 Receipt 写失败全事务回滚，重放只保留一份 Receipt。完成核验改为纯读取。与核心 Reset/分页历史组合29 PASS。
- 整体 Reset：Subject 状态不再足以充当完成证明，复验精确行政命令 Receipt/marker/manifest/backup、Run 终态和 token/workshop。真实 worker 退役 pending Intake 后 Candidate/旧 Outbox/无伪 Handoff 保持，备份 SQLite 被改动后拒绝恢复并保持 stopped。该新增用例1 PASS。
- Workspace：管理退役专用 trigger 验证不可变 Run revision 与管理命令 Receipt；已有 superseded 路径继续共用正式清理权限。两类事务、Execution/Effect 阻挡、同事务注入失败和重建 replay 的组合16 PASS。尚未完成新 trigger 的完整物理删除/崩溃 Host 旅程；没有 Reference 的私有文件未自动删除。
- Schema：NAS独立源快照 `4549671e…` → `f9cf2100…` 首轮复制耗时1,032,181ms，231表中230个事实/执行表逐行值及类型摘要相同；只改11处枚举CHECK，未执行Reset。新增 Workspace trigger 后当前目标是 `40dfcbb6a6a64294098c72093ba03ce61e6696c5fb8d162b76a3272af73f409c`（12处CHECK），不能将首轮PASS冒充新目标资格。演练目录 `diagnostics/retirement-copy-20261023` 只写隔离副本。
- 未决Effect进一步分组：20条是 Arca `arca.ondeck.input_settlement.delete@1`，Event/Work均failed、Effect仍reconcile_required；1条是正在执行的Libra转码。20条的历史Owner完成证明尚须精确核查，不能仅按状态数认定仍在删文件或直接补写终态。
- 收藏查询：标题/年份/搜索先按身份与metadata选页，再只读取当前页的people/material/详细facts。真实SQLite八项回归PASS；NAS同库性能复测未返回，暂不报收益。
- 停机：`clean-service-host.stop`原来先等待Execution停止，再在finally关闭FFmpeg，长转码会一直占住排空窗口。改为停止派发后并行关闭本服务进程，再等待Execution。真实测试确认停机完成、无业务失败Outcome；首轮重启最终未入藏，诊断为测试重启缺少原先共享资料Provider（ARCA_SERIES_SOURCE_STALE），修复测试依赖继续复验。保留首轮失败证据，不放宽产品来源版本校验。
- 690项Service结果发生在停机与依赖分层最终修正之前；完整架构测试尚在运行，已出现两项fixture遗漏并定向修正。静态检查发现的新增Persistence→Execution/Capability非法依赖已通过抽出Foundation持久化读participant、由组合根注入validator解决，没有扩大包边界豁免；另修已有注释触发的membership语义扫描。四项静态检查重新通过。

## 2026-10-23 05:35 资格与性能追加（未发布）

- **20条历史Effect的性质纠正**：对冻结源库调用实际 Arca TerminalEffectHistoryObserver，4个原Plan分别5/7/3/5条均为 `fulfilled_by_successor`。Reset只读适配器使用同一read transaction，Foundation独立验证原Intent/Attempt和严格后继Work/Event/Result/committed Effect；篡改拒绝用例通过。它不改写旧Effect状态。最终preview仍有225 Subject、14 active Run、11共享scope；真正阻挡只剩1条 `libra.media.transcode@1` 的intended Effect及executing Event。没有执行恢复、Reset或终态补写。
- **最终结构复制**：`4549671e…` → `40dfcbb6…`，新增状态/trigger共12处CHECK，231表/115index/23partialUnique保持。NAS `diagnostics/retirement-copy-final-20261023` 中源只读，复制1,129,241ms；230张事实及执行表逐行值与类型摘要相同，FK/integrity通过。目标catalog `8d37d7c2471e6b95810efe2ee83e06bee35cfddfcc4294563502aa37eca32da5`。新增标准结构副本入口 `helix-formation-retirement-schema-copy.js`，仅准备新文件，不能自行切生产库或处理未决执行。候选Host使用另一个诊断副本和只读原媒体挂载，验证尚在进行。
- **Reset独立完成核验**：Libra/Procurement/Arca均要求本次resetId、manifestDigest、backupDigest对应的不可变Receipt/marker；Procurement当前afterDigest必须匹配，不能仅看delivery状态。直接按冻结Owner/process scopes复核无current Control/Work，原Control有精确下一revision release，原terminal Run、已Commit Package/Receipt逐行保持。注入历史行变化或Receipt/marker缺失拒绝恢复。61项Reset组合PASS。
- **真实用户入口旅程**：配置正式Workspace Root后，正常Intake接纳Subject，正式HTTP stop→preview→Reset成功；历史Candidate/Accepted/Receipt保留，Subject行政退役、token归还、历史可见且active列表退出；重启保持stopped且没有新采购，随后显式正常观察创建第二个Subject，原Subject仍退役，源文件inode/mtime/bytes不变。1 PASS。首轮fixture只有bootstrap逻辑Workspace而没有正式Mount Scope，安全检查拒绝；改为正式settings配置后重启，无产品校验降级。
- **正常停机根因回归**：停止派发后并行停止FFmpeg子进程，再等待Execution排空。真实Series转码停机小于10秒，无子进程、无伪业务失败，保留执行Effect；正式重启完成一次Arca Commit，二次重启不重复产物或Commit（1 PASS/57.6秒）。首轮restart fixture共享Provider未重建失败记录保留，已修测试依赖。
- **性能对照**：NAS同数据、同镜像运行时、Formation/progress代码相同，仅切换collection-query，标题页三次中位451.170→212.607ms（约52.9%），返回155176 bytes相同。顺序样本，没有4K并发，不能外推全站。早期Formation1063.9→830.7ms属于另一个明确的2文件对照，不与后续不同响应版本混用。overview已有缓存HTTP约5ms不代表后台聚合构建成本。
- **海报**：原每次请求读图并重新resize/WebP；保留所有Owner/路径/物理稳定读取检查，仅用内容SHA256+尺寸复用派生字节，32MiB/128项LRU、同图并发合并、失败不缓存。实际sharp测试3 PASS。Windows合成1600×2400 JPEG约2.78MB，wall派生重复渲染约32–36ms，命中约1.05–1.09ms，输出9162 bytes一致；这不是NAS真实海报端到端延迟测量。
- **4K限制**：冻结intent为intel_qsv/25.7Mbps/PQ-BT2020→SDR，当前合法路径是CPU decode+float zscale/hable filter+GPU encode。进度最后约50.6%、speed0.244x，只是冻结采样；不能据此断言GPU没有使用。未修改质量/色彩合同、未做忙载对照，不报4K加速收益。
- **平台/完整Gate**：Service最新694total/665PASS/29skip/0fail。Windows首个包build成功但独立启动失败，发现新poster模块和Reset脚本未进显式文件清单，修正Dockerfile/package-win，第二个独立包自带node/native依赖启动health200、空Reset预检成功。完整架构仍运行；最早public exports、retired历史query fixture及JAV不兼容分段旧自动终局预期三个失败均已定向修正（5/3/1 PASS），首轮FAIL保留。JAV真实Plan拒绝现在进入attention并保留两源Control/token、无虚构Outcome；符合本轮终局规则。静态包边界/语义/Manifest/P2合同检查通过。没有宣称最终固定候选全Gate、NAS真实UI或完整生产验收通过。


## 2026-10-23 06:08 最终实现回归与未关闭边界

- **Handoff A 收尾**：停机可留下 Libra Accepted 已提交、Procurement 原消息尚未消费的正常窗口。Reset planner 只接受原 Libra Outbox 的确定性 message ID、dedup key、schema、payload digest 及完整原 Receipt 对应；缺少证明拒绝。operator 先调用现有 Procurement CandidateAcceptanceConsumer，使用原 Inbox 幂等键，再退役 Subject。未创建新 Handoff、未撤回 Accepted、未由管理工具直接写 Procurement 业务表。postcondition核对原 Receipt 不变、accepted delivery、所有 transferred/handoff_accepted成员和精确 Inbox closure。commit后日志未落盘重放、篡改原消息或成员的负例通过。原 Outbox 传输确认由恢复后的普通 dispatcher 幂等收口。
- **界面与计数**：Reset完成后一次性失效overview查询；Procurement waiting统计排除administratively_retired候选，latest stage有独立退役状态。真实浏览器原先复现完成后仍显示旧待办；修复后旧Subject退出active，等待接收/待办清零，历史和源inode/mtime/bytes保持。检查980px/1920px确认框、错误确认词禁用、Enter提交、完成仍停机、空工作台不可重复Reset和Escape关闭。截图位于忽略目录reset-browser-v3，已目视核查。
- **平台与回归**：最新产品源Service695 total/666 PASS/29 skip/0fail（135.0秒）；Web262/262；构建通过。NAS只读源覆盖运行最新Reset+真实Host取消/重采53/53（111.4秒）；Windows候选v3使用包内node/native依赖启动health200并通过空preview（empty=true、ready=false、blockers=[]）。包装smoke前两次错误断言把空preview当ready=true，保留FAIL日志并按接口语义修正；未改产品允许空Reset。另一次smoke测试secret字符串不足最小长度在初始化前拒绝，改隔离测试输入。
- **NAS候选Host**：最终结构副本上独立Host完成启动和正常关闭，保持stopped；health200/20ms、runtime200/4.64ms、Formation200/1407.49ms、collection200/252.11ms，总440651ms。该Host快照早于最后的配置Workspace Root与接纳回执收尾；后两者由最新Linux53项覆盖。不得将此记为最终Docker精确版本或生产验收。
- **两片对应新包路径**：同片1080p AAC/FLAC使用真实FFmpeg和实际Provider Handle完整旅程，形成两条Entry/不同目录，首条Receipt与文件不变（1 PASS/78秒）。测试最终使用带年份括号的识别文件名与匹配NFO；不声称任意文件名均识别成功。Series新包两集、已有Season 01/poster.jpg被纳入相关来源并正常Commit，只形成一个Season（1 PASS/35.8秒）；该fixture使用既有媒体适配替身和真实文件，先前真实poster port替换/重试证据继续有效。没有将这些隔离旅程当成高达/凡人歌生产已验收。
- **完整架构原始结果**：3278 total/3224 PASS/28 FAIL/26 skip，58.1分钟，执行期间发生后续修正，不是固定最终快照。未修改原FAIL日志。基线ee0c独立archive的18文件329 total/310PASS/19FAIL证明19项原已失败；另单独Series迁移在基线也FAIL（156.9秒），共20项既有失败。基线archive仅一个无关Windows非法文件名未提取，相关service/test/docs完整；不宣称完整分发基线。
- **失败修正范围**：19项既有清单/fixture按当前真实136/115/231/61合同、149 inputs、Schema依赖及实际Season scope更新；保留严格digest、精确集合与拒绝测试。本轮public exports、retired分页fixture、JAV技术失败应attention保留Control、P3新纯Persistence模块清单、Workspace新trigger、重启Provider测试依赖分别补齐。最终17文件129/129（7.6秒）、canonical inventory定向1 PASS；JAV/停机实际重启各1 PASS及其日志另存。尚未重新完成一次固定快照全量架构，因此只报告定向通过。
- **保留失败：Series既有根目录迁移**。测试修改folderTemplate期望完整迁移，但已有Series root binding固定root_location，resolveTargetLocation继续采用该根，Aftercare评估healthy，不创建迁移Case。原基线与当前相同。共享根是跨季Owner正式绑定，不能为通过单季测试绕过它或单独移动一季。该路径需按已有共享根迁移合同进一步设计/确认，本轮未擅自扩大实现、未删除或skip测试、未声称发布资格通过。
- **仍开放**：管理退役Workspace新trigger已有两次Reference/Control检查、事务/重放用例，尚无新trigger完整物理回收崩溃Host旅程；未登记字节保留。4K未做质量/色彩策略变更或忙载性能收益验证；启动仍需分钟级。生产中断转码1 intended Effect/1executing Event必须通过正式恢复/核验处理后才可Reset，不补写终态。精确Docker候选/UI负责人验收及生产Reset、部署、自然重采验收均未完成。

06:07只读复核：生产仍hostfix4，exited1、RestartCount0，FinishedAt=2026-10-22T18:38:23.87218858Z；其余15容器运行，诊断容器已退出。所有诊断写入均位于隔离副本/临时工作区，没有生产Reset、结构安装或源媒体修改。


## 2026-10-23 06:11 固定提交与构建环境阻塞

产品候选提交为 `44b725e6a`（126文件，包含合同/实现/回归/Evidence）。提交后工作树干净。标准入口 `node scripts/build-image.js 44b725e6a` 在desktop-linux context启动构建前失败：本机Docker Desktop Linux Engine pipe不存在。启动本机Docker Desktop后，backend在Inference manager初始化时因dockerInference监听文件无法访问而崩溃；未进入镜像build、未产生image/tar/SHA256，未上传NAS。没有执行Docker恢复出厂、清理镜像/volume或修改系统设置。Windows v3独立包与最新Linux53项源码回归不能替代最终Docker镜像资格。

当前不能申请生产Reset/发布：除镜像阻塞外，完整固定架构Gate仍未通过（既有Series根目录迁移FAIL保留），跨层UI尚无本候选负责人结论，生产1条中断转码Effect/1executing Event尚需正式恢复/核验。高达/凡人歌生产自然重采可按本轮约定后验，不将其提前宣布通过。生产保持02:38的停止状态；没有本轮数据Reset或部署授权。


## 2026-10-23 09:11 Docker候选与精确版本UI收口（未发布）

用户恢复本机Docker并授权继续，另明确授权将候选发送给既有UI负责人。生产授权范围未扩大。

- 标准构建入口先完成694d3b429，再按UI修正完成b9c033573及最终d4b5c00b8。最终镜像`markmahoro/shelfdeck:d4b5c00b8`绑定完整提交`d4b5c00b8509cc8b6e49ae09c2e873729e3d601e`，本机image ID `sha256:451738b8254f9804aa03fb4601b0241c669f5404733b2a6d676bf4c94405aa7d`。导出`dist-image/shelfdeck-d4b5c00b8.tar`约771.8MiB，SHA256 `3a2c2434dfecfdb0a0d27491eda3820c70a0e2156a343c26221e19bb08a925b1`，独立Get-FileHash一致。未上传、未部署，无Git release tag。
- 镜像内资格不覆盖src/scripts，仅挂载测试：694d镜像Reset/取消/重采53/53 PASS（84.9秒）；真实Host使用镜像自带dist完成配置Workspace Root、启动health、正式停机、空Reset preview，694d及b9均PASS。两片对应新包旅程在694d镜像2 PASS；真实转码停机→原Effect保留→重启一次Commit→二次重启不重复，在b9镜像1 PASS（49.6秒）。b9相对694d只改前后端提示，d4相对b9只改侧栏一个字符串；不把这些继承证据标成最终镜像所有测试重跑。
- 首轮媒体FAIL保留：测试tmpfs `/transcode`仅512MiB、`/tmp`1GiB，不满足现有`1.2×输入+5GiB`空间准入。仅扩大隔离挂载为8GiB后两片旅程通过，未放宽准入或测试超时。停机测试另触发256 PIDs上限：4个并行FFmpeg设备能力探测耗尽253线程/进程，docker exec也被拒；采集docker top/stats后停止该任务容器，改隔离PIDs上限1024后通过。此为测试资源约束下的实证，未修改产品探测并发策略，也不据此宣称生产4K性能已修复。诊断脚本首次缺少预建shutdown根目录的ENOENT单独保留，不与产品失败混淆。
- UI负责人对694d完成真实隔离Host重置闭环、三段重试/历史浏览器核验，要求去除Aftercare/正在Reset内部术语。b9修为收藏维护/正在重置工作台，并同步中断/确认/阻挡错误提示；Runtime9、前端定向6 PASS。b9复验指出App侧栏遗漏同一字符串，d4单行修正后两个视口2/2 PASS、0未决UI问题。精确候选最终结论PASS，其他业务行为证据按验证过的差异继承。
- 负责人任务`01a0912a-0086-74e2-88ab-536c59d3862a`；最终记录本机`E:/my_project/helix-git-consolidation-20261008/formation-ui-review-d4b5c00b8-20261023/owner-review.json`，报告SHA256 `c9848f0c140a03cb70c4eafe795f736ae7453884d46adabf381290da09f9e8a1`。记录绑定171个冻结Web输入，包含构建/截图/原版失败和修正版通过证据。不是整体发布许可。
- 本轮结束时本地任务诊断容器均退出。生产只读检查仍为原hostfix4 stopped/exited1、RestartCount0，其余15容器运行。没有生产Reset、结构切换、源媒体写入或恢复供给。

仍开放：已有Series根目录迁移FAIL（基线与候选均存在，未skip或放宽断言），完整固定架构Gate尚未通过；生产1条中断转码Effect/1executing Event尚需正式恢复核验，Reset继续拒绝。4K忙载吞吐及启动耗时未解决，Workspace管理退役新trigger的完整物理崩溃旅程仍无新增证据。高达/凡人歌真实自然重采验收按约定后验，不将隔离通过等同现场收口。


## 2026-10-23 后续独立合同核查（方案待确认，未改产品）

1. Series迁移不是单纯旧测试断言：SSOT §2.5附近明确Placement revision变化须被识别为Aftercare Placement Conformance Gap；共享Series补充又要求同Shelf/剧身份唯一正式根。当前clean-arca-inventory-port.resolveTargetLocation在计算新folder后直接采用旧rootBinding.rootLocation；Aftercare conformance与placementMatchesInventory共用该解析结果，导致新模板被忽略、健康评估为healthy。Series scope保存placement_revision，但当前解析未比较此值；既有Store只有创建/版本/预约/引用，无整剧根迁移事务。不能通过简单忽略rootBinding让单季迁走，那会使共享文件与其他季分离。
2. 建议补齐的Arca合同：冻结同shared scope全部active Season、当前Inventory/head、共享版本/Control及目标；存在pending Accepted预约、builder、Aftercare/Off-deck/身份纠正竞争时延后，不偷改其冻结目标。共享文件与各季成员按精确集合执行、验证，使用可恢复Effect与持久Receipt推进Arca当前根绑定及各Inventory，旧Commit/Identity/Deck Fact保持。未知目录文件不搬、不删；冲突保持明确待处理。先修当前布局差异被隐藏，再完成共享迁移；不得把auto_repair降为healthy或skip既有测试来取得资格。此跨季合同尚待用户确认，未写入SSOT/实现。
3. 运行恢复核查：clean-service-host在desiredMode=stopped时调用ExecutionHost.start({quiesced:true})，Foundation只分类恢复动作并保持normalSupplyAllowed=false，不执行它们。普通resume/start则会启动fallback reconciler，drainOnce同轮恢复、新Work、新Event及Owner reconcile全部推进，因此普通恢复运行不能作为“只处理既有Effect”的替代。
4. 冷备只读查询再次确认唯一executing项：libra.media.transcode@1，Event libra-transcode-media-event-8aad245ef3023e69b22e557adc4eb9ad1b15d3c6，原Run 8ecba91fddbf9286cbbfac859fa7eff098e06f21f9d3cf6c75563d30907989cc。查询只列白名单字段，未改生产。建议增加显式管理性停止态恢复：冻结精确Event/Attempt/Effect清单，经Foundation原reality分类及replay，保持原身份与供给门禁；只允许既有技术执行和Work结果聚合，不运行新Plan/Owner reconcile/Outbox采购。结束仍stopped，重新分类无未知Effect后才可另行Reset；不能把resume→立即stop的竞争窗口当成隔离保证。
5. clean-workspace-product-port.materializeMedia先清理精确producer partial；缺少已登记/最终产物时按原Intent重新produce，再rename与正式记录。故中断转码可能从头重做，不能声称续接50%编码进度，也不能用临时文件存在证明成功。恢复机制不得重签不同Intent或补写终态规避校验。

已向用户请求确认是否把“整剧共享根迁移”和“停止态仅恢复既有执行”两条合同纳入本轮。该请求不等于生产恢复/Reset/发布授权。在答复前继续保留生产停机，未实现依赖新合同的修改。
