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


## 2026-10-23 转码终止方向澄清

用户指出FFmpeg不提供本项目所需的断点续转，并明确认为Reset无需等待转码完成。撤回上一节把“停止态恢复原执行并完成转码”作为Reset前置的建议；前述范围问题不能再视为当前待批准方案。Reset目标是结束未完成条目，重新完整转码只为取得成功结果没有必要。后续核查应聚焦精确执行终止、Workspace实际写入结果与未决Effect收尾，再由Owner完成行政退役。

当前代码核对：Foundation `work-lifecycle.cancelProcess` 遇到executing Event，会保留该Work为draining；现有用户取消合同亦要求未决Effect安全收尾后才能释放Control。这说明“安全收尾”仍须具备真实依据，但不等于“媒体必须转码成功”。尚未确认停机后精确中止的完整实现，不能直接改终态、虚构Outcome或把残留文件视为已清理。本次仅调整计划/Evidence，未改产品或生产，整剧共享根迁移范围也未获确认。


## 2026-10-23 追加范围确认与停止态终止实现

用户已确认将整剧共享根迁移、停止态既有执行收尾一并纳入本轮。停止态条目按随后澄清：Reset无需等待或重跑转码。SSOT已记录该规则及整剧迁移边界；该确认仍不构成生产Reset、媒体迁移或部署授权。

`STOPPED-EXECUTION-CLOSURE`已接入新Reset的冻结清单、完整备份和durable journal：仅精确选中的未提交Libra转码可终止。验证原Work/Plan/Event/Attempt/Intent、全部literal输入、当前Workspace/root登记、目标及临时文件实际身份；成功Result/Commit Marker、已登记输出、其他能力、范围外或不明责任仍阻断。原Event为cancelled、原Attempt为completed/cancelled、Effect为failed，与含文件现实/清单/备份摘要的管理终止Receipt在Foundation同事务提交；不生成Libra业务失败、不生成新的Attempt、不执行FFmpeg、不删除字节。后续原Owner分别退役。Host前置校验quiesced且没有在途执行/规划/恢复/Owner reconcile及FFmpeg子进程；停止意图与pending Reset身份每次验证。已提交未写journal ack可按同Receipt重放。

验证：Reset相关组合77/77 PASS；新增终止测试4/4（包含运行态拒绝、文件/执行漂移、事务回滚、journal ack前中断重放、硬链接/异域/异能力拒绝）。真实Series Host启动FFmpeg后关闭服务，使用新Reset完整备份/退役，1/1 PASS、11.68秒；子进程归零、原Attempt数量不增加、未产生On-deck Commit、未决Effect归零、FK/integrity通过、停止意图保持。该项是实际终止路径，不是转码完成/续转演练。日志：本地忽略目录`stopped-termination-tests-final.log`、`stopped-transcode-host.log`。增加最后的Receipt闭形/尺寸检查后4/4复验通过。尚未完成新固定候选完整资格、Docker/Windows包、具体版本UI审查或生产操作。

`SERIES-ROOT-PLACEMENT`仍进行中：当前仅新增按现行规则读取期望根的纯查询，正常入库继续服从durable binding；整剧冻结计划及物理移动模块已通过18项相关隔离测试（其中8项为新整剧边界）。两季+三份共享文件同移、物理rename后重入、未知文件/目录、占用目标、文件漂移、漏季/异Provider/其他维护及Accepted reservation拒绝已测。Arca持久占用、真实Work/Effect及全季Inventory/共享版本原子提交尚未接通；这些模块尚不能作为生产迁移工具，原Aftercare假healthy问题仍未完成修复。


## 2026-10-23 整剧迁移运行链检查点（尚未固定候选）

Arca已新增持久`arca_series_root_relocations`，冻结同剧全部当前Season、共享版本、材料物理身份与Control责任；Accepted预约、共享Builder、维护/退出/身份纠正及漏季阻断。活动迁移围栏阻止相关新增入藏、共享重建、Inventory刷新及Shelf变更。专用两阶段Work先核验并移动整根，再验证真实文件及原Effect/前序Result，以一个正式Owner事务推进各季Inventory、共享根与新版本，连同Foundation Result/Commit Marker原子提交。旧Canonical/Deck/入藏Receipt和Control责任保持；未决迁移不自动释放围栏。合同为138 Capability、117 Result family、232表、62事务、150 Domain Inputs，四项静态检查已通过。

精确旧231表到新232表结构复制仅允许既定12处终态CHECK扩展及新增空Arca迁移表/索引；230个原事实表逐行保护，已存在迁移或行政终止事实时拒绝有损回退。旧225→231工具继续使用原冻结目标档案，不改变历史结构路径。

定向验证：Windows计划/物理/双季数据库事务及结构复制15/15，Linux源码挂载隔离容器12/12；不是新镜像构建资格。单季真实Host完整迁移1/1，36.45秒。两季Host首次因前置检查不继续而超时；保留隔离数据库后证明手动检查更新人物关联并提前返回，没有启动健康检查。已修为同请求重新读取新Inventory后继续；Owner状态机与旧结构副本组合19/19，新增测试确认只点一次且新Assessment使用更新后的basis。再次两季Host迁移/全部文件与旧事实保护断言通过，末尾原共享版本计数仍预期1而实际为2，整体该次仍记FAIL（97.85秒）；已将断言按迁移新增版本修正，待重跑。

真实进程退出回归覆盖rename之后、Inventory+Result原子提交之后及二次重启。首轮测试误用外层`node --test`，导致注入79退出码被runner改写为1，未进入恢复；已沿既有进程退出测试方式修正。跨重启须保持同一隔离虚拟时钟，不能把前置维护窗口测试的未来时间换回真实时间。当前仍回归，未记PASS，未新增生产操作或发布资格。


## 2026-10-23 整剧迁移恢复、冲突重试与Projection回归

真实进程退出测试在修正测试启动方式后暴露产品缺陷：StartupRecovery的Work投影不含basis_digest，迁移Observer错误把缺失字段当成输入漂移，导致P4_EVENT_RECOVERY_REALITY_CONFLICT。修复为通过声明的Foundation只读Participant重验持久Work basis、原Event/Attempt/Effect；保留精确Owner和Intent围栏。两处真实进程退出及每处二次重启均通过（rename后112.92秒、Inventory/Result原子提交后105.61秒），原计划/两条入藏Receipt/Control/Identity/Deck保持，共享版本只新增一次。原失败日志保留，不追记PASS。

迁移文件冲突按明确失败结果返回，持久整剧围栏保留。现有“立即检查健康”入口用新幂等键触发重试，原键重放不新增Work；复核所有旧Work已终态、原Attempt已停止、精确输入摘要/Effect intent、完整物理集合及Control后，才提交同一冻结计划的新Work。未知旧Effect不直接改终态或伪造成功，实际文件执行仍重复核验。真实两季Host注入未登记文件→明确失败→原键重放→移除测试文件→新键重试→完整迁移通过（97.57秒）；补验两季收藏列表与详情同源的阻塞状态/真实季数/失败码后再次通过（97.54秒）。两季原有共享版本计数断言同步为迁移新增一版。

当前定向结果：迁移计划/Store/恢复与人工重试围栏24/24；Arca受影响449项中445PASS、4既有skip、0FAIL；Service695项中666PASS、29既有skip、0FAIL（在后续人工重试/UI增量前，最终固定候选仍须复验）。Web新增整剧冲突→同入口重试状态测试，完整263/263和build通过。四项静态检查通过。Linux先前12/12仅为当时源码覆盖，不视为当前新镜像资格。Docker/Windows打包清单已加入新根目录IO模块。

当前合同台账固定为138/117/232/62，150 Domain Inputs、254 referenced types；相应当前基线测试更新精确计数，旧225→231历史结构复制测试保持。完整新固定候选架构门禁、独立分发/镜像、真实UI负责人验收及停止态生产副本核验仍待完成。本轮无新增NAS操作；生产仍应保持停机，未Reset、迁移、升级或恢复供给。


## 2026-10-23 12:47 固定候选资格发现与修正

- 固定 `2c520418669977ac9a2429fc5020b9e47bad1e58`、干净源码完整Architecture实际完成，414文件、3321 total/3290 PASS/5 FAIL/26 skip，3686101ms；四项静态检查PASS。三项FAIL为Root IO白名单、138个Capability及115个输出family的精确断言未同步；另外两个是真实Host普通NFO/NFO+poster修复被新增Series迁移预检挡住。保留原失败，不把此轮算全绿。
- 根因是判断新规则的期望目录时调用了完整Inventory prepare，先对待修复的旧文件做不可变字节验证。已将Arca持有的Placement测算Basis与实际prepare分开；Series预检仅测算目标，迁移及正常修复执行时仍各自完整验证。没有放宽物理身份、漂移或Owner守卫。两个原失败Host用例重新通过（95.43s、124.78s），两季冲突→同Plan显式新Work重试→完整迁移亦PASS（98.84s）。
- 标准2c镜像构建成功，image `sha256:b835d8803a35b554f87c61baf9ee7ad17b0d9f524fcd60e80c2e65a0d664ff1a`，tar独立SHA256 `8f2b1648dd31556e41be6e120e41401f98e168cb2d33860d83ce6da6c6737ed9`。镜像内迁移/真实进程退出恢复26项PASS，但停止态脚本缺失导致1FAIL；此镜像不可发布。已同步Docker/Windows打包清单，补充真实分发包内空工作台Reset预检；新Windows独立启动、原生依赖与Reset预检1PASS。仅补挂该脚本的Linux实际FFmpeg停止→行政终止预演3PASS/3过滤skip，不代替新镜像资格。
- UI负责人2c具体版本审核为10PASS/4FAIL，桌面/窄屏均复现迁移完成后列表不刷新、检查按钮禁用后焦点掉到body。修正为详情状态变化后重读整个当前页，保持不变不重复加载；检查前将焦点移到弹窗健康标题。Web264PASS/build PASS，实施方复用负责人浏览器场景14PASS；最终新提交负责人复验仍待。原负责人报告保留在本机独立review目录，不混同真实Host证据。
- 新232结构在NAS原冻结库副本实际完成，1140939ms；230个原事实/执行表逐行摘要一致、FK/完整性通过，新迁移表为空。原库与Workspace只读。旧21个未决Effect中20个保留后继履行证明，唯一中断转码的14,193,262,592-byte partial具备精确停止态终止证明；带实际Workspace的只读预览blockers为空。
- 完整Reset演练范围225Subject/14Run/14Work/14Workspace/0pendingIntake，保护682收藏记录与927已结束Run。首次完整备份被`RESET_BACKUP_SPACE_INSUFFICIENT`正确拒绝，未进入退役：14个Workspace共88,669,733,359 bytes，数据库4,614,053,888 bytes，数据卷仅余约56GiB；另一卷余约386GiB。先前只看14.2GB中断产物不足以估计整体工作台备份。
- 容量预检原本先完整hash Workspace，导致空间不足也需数分钟。现仅容量统计使用无摘要枚举，正式备份来源前后、副本和恢复时的完整SHA校验不变。新增容量不足时不得读取媒体、不得授权或改变Run回归；Reset47PASS。未降低空间条件、未删除现场或备份。
- 新标准NAS部署增加专用`/vol2/1000/shelfdeck_backups:/app/data/operator-backups`，校验精确父根/路径、拒绝以挂载隐藏非空旧备份目录；部署dry-run合同3PASS。生产目录/Compose未改变。实际演练在独立`/vol2/1000/shelfdeck_diagnostics/formation-reset-232-2c5204186`进行，以单文件精确预检补丁覆盖固定2c脚本；原冻结源码保留。完整备份/Reset和随后停止态Host仍在进行。
- 本轮后续源码：Service696 total/667PASS/29既有skip，Web264PASS，受影响合同/入口/Reset/部署75PASS/2skip，四项静态检查PASS。P2仍138/117/232/62/150，aggregate `07bb897d8657031067ff42e9e693f472762a67970f55637b4d4338e1295ff459`。将冻结新候选重跑完整Gate及镜像/UI；当前不称发布资格完成。

原始日志保留在ignored `formation-diagnosis-20261023`：`gate-2c5204186.json`、`image-2c5204186-relocation.log`、`relocation-ordinary-repair-retest.log`、`qualification-fixes-*`、`schema-232-rehearsal.log`、`reset-232-rehearsal.log`与`reset-232-volume2.log`。所有生产操作仍停留在已授权停机状态。


## 2026-10-23 13:09 已Commit历史证明的真实副本缺陷

26ce2a6b8固定候选具体版本UI负责人PASS，独立浏览器14/14、Web264/264、真实隔离Host迁移1/1，0开放UI问题；记录在`formation-ui-review-26ce2a6b8-20261023/owner-review.json`。标准镜像revision为26ce2a6b8e3b18942437d17e25547128277c7b71，image ID `sha256:9db06db3ec6776c7f37a1587547e1006d02f65f66d30a2d68f4471cd84de0fe9`，tar SHA256 `44ebaaf8e40ec120dba8891953419df1e3c14da923e32ea87e714d4f694ab8ff`。实际镜像的Series迁移/两类真实退出恢复/停止态转码终止32项及新版Reset22项PASS。额外旧Reset测试25项因漏设既有`HELIX_TEST_ISOLATED_TRANSCODE=1`而正确拒绝/tmp路径，保留54PASS/25FAIL原报告；启用已挂载独立/transcode的fixture配置后该文件47/47 PASS，未降低产品挂载守卫。

NAS完整备份约35分钟后，Operator.prepare以`ARCA_RETIREMENT_PROOF_PENDING`拒绝，尚未写journal或调用beforeApply，未提交管理退役。独立核账发现选中14个当前Package之外有6个历史包，全部为Libra discarded、Arca正式Run committed、有Commit Receipt、recovery resolved、Custody仍active。这是既有正式On-deck finalize的实际输出；Reset新证明函数错误假设Custody必须committed，原微型fixture也手写该状态而掩盖缺陷。不能因此扩大Reset范围或把6个收藏退役。

修正保留Arca Owner边界，使用已有`readCommittedByPackage`核对原Completion、Final Decision、Shelf与不可变Inventory/Deck历史；还要求每个Custody都有对应已Commit Run、无active/waiting验收及未关闭recovery。Custody标记不能代替正式提交证据，历史状态/Control不改。NAS6包实际证明全部通过；真实Host入藏后的active Custody正例、破坏Inventory来源的负例及恢复后证明一致通过。Libra混合历史单元测试明确仅测试公开Arca证明消费，新增Arca伪Commit行/无Inventory反例；组合65项PASS。真实Host首次负例误用只读测试连接，记FAIL后修为独立fixture写连接，原运行断言不放宽。

原26ce完整Gate因这一候选被副本缺陷淘汰而停止（不是因耗时停止），STOPPED不计PASS；原414文件完整2c失败报告继续保留。最终新候选将重新固定并完成全量资格。

副本后续沿用已完成的同一完整备份：新旧previewDigest必须完全相等，真实Operator.prepare生成journal，真实userReset.recover重新hash全部备份数据/Workspace后再执行同一Owner退役链。不提供产品“忽略备份/强制继续”入口，也不删除或复写原备份。这是分段隔离演练，不能冒充一次成功的原API调用或Runtime崩溃恢复。实际生产仍须新完整备份与正式用户Reset入口。后续停止态Host测试只在实际退役receipt通过后结束诊断fixture的外层pending标记，生产原Workspace一直只读；该夹具操作不构成生产修复，也不计为完整Host pending-reset恢复证据。Runtime/Owner中断重放另由真实隔离回归覆盖。


## 2026-10-23 13:25 Reset空执行步骤性能修正

013aec7ce标准镜像image ID `sha256:02d8e3267f78094e2e3293a8ce732ea42ad208175dead4cfb8a2905a766e72f2`、tar独立SHA256 `744bcfec417f68523c4e0647d754ed012a1963edbaaedd7936846960a73e7440`；实际镜像Series/真实进程恢复/停止态转码/新旧Reset/Arca退役97/97 PASS、278809ms，真实Host已Commit历史正反例1PASS/29名称过滤skip。后者首轮/tmp只配2GiB，低于既定`1.2×输入+5GiB`准入，未创建Run而等待超时；扩大隔离tmpfs为8GiB后37.2s通过，不降低产品守卫。Service696 total/667PASS/29既有skip；UI负责人核对171前端文件和9资源一致，将26ce证据限定继承至013，未冒充重新跑UI。

NAS在完整备份重验后进入真实Owner退役，原停止转码已新增1个正式终止Receipt。journal共992步（execution_termination1、execution741、arca14、arca_shared11、libra225），其中execution仅14个scope在冻结plan中有open Work。13:19:56至13:20:43只从71步推进到83步；每步重复校验/持久化约30,168,268-byte清单，多数取消没有实际Work，存在可复现的管理Reset性能浪费。

修正仅在journal.prepare时选取冻结plan.works对应的processScopes；仍保留全量manifest.plan.processScopes、各Owner执行状态门禁和完成时逐scope核验。shared Builder仍按Arca既定判断收尾，不重写任何已存在journal或兼容旧运行时。新增回归证明只取消实际open Work，若被省略scope后来出现新Work，正式Owner仍拒绝退役、Subject保持active、日志保持executing；与原Reset/重放/保护组合66/66 PASS。

旧慢速演练容器已明确停止，保留output/data及原992步journal和partial管理终止证据；新`output-fast/data`从原prepared.sqlite与冷备伴随文件重新建立，不删除现场或回改旧journal。重用同一冻结previewDigest的已验证完整备份，真实recover继续全量字节SHA核验。该诊断性能修正使候选变更，013完整架构Gate按STOPPED保留、不计PASS；将对新固定版本重跑。生产shelfdeck始终exited，未Reset、部署或恢复供给。


## 2026-10-23 14:28 固定Gate与生产授权检查点

固定f280e6bd495e8bb75f4185d532adc18e0f1b0071完整Architecture Gate PASS：414文件、fixture exit0，无signal/executionError，dependency/semantic/manifests/contracts四项PASS。Gate成功分支省略stdout，不宣称无法直接核对的逐项总数。期间tracked工作树保持冻结，原STOPPED/FAIL报告保留。Service696 total/667PASS/29skip；实际镜像98/98、272230ms，真实Host已Commit历史正反例1PASS/29名称过滤skip、37204ms。UI负责人对该精确版本按171源码/9资源一致继承浏览器14/Web264，未重复运行。

标准tar SHA256为192445c85c44a26f38cb1490a30f5b7b29a8ab48b8e24732861a017a545c107c。Docker Desktop报告OCI index digest 27027fd11a007f7ba091567260b53205d07d4e38edbe4b0305296f819a64d403；NAS传统image config ID为6f57fec925c007f810ab23af323a75f3dd3499259e6f18b8acbb56186a78e723，两者由同一tar manifest核对，revision一致。首次load后误把两类ID直接比较而退出，未部署；tar附带latest标签，诊断加载后已立即恢复原d94bc镜像的latest指向，生产容器始终原image/exited。标准upload只写隔离诊断目录，SHA已校验。

实际候选镜像对原232副本的停止态Host启动495434ms通过，health/runtime/Formation/collection全200，normalSupplyAllowed=false，158424 Attempt、682 Entry、0停止态终止Receipt及1 executing Event均保持。源码覆盖版先前522363ms的PASS单独保留，不替代实际镜像。NAS真实Operator最终完成275步：225Subject/14Run退役、14Workspace字节保留、10张Arca保护表摘要完全相同、Attempt不增、executing归零、1条停止态终止Receipt、FK/integrity通过。此为重用已完成完整备份且全量SHA重验的分段演练，不宣称一次完整Runtime API成功。实际镜像的正式256MiB Worker重放738072ms通过，回执完全一致、Attempt/Receipt/Entry计数保持；其他最后资格仍在完成。

原232副本经实际候选镜像反向复制1905272ms完成，230表逐行摘要同源；初始隔离配额1.5GiB/1CPU发生173101次内存上限回收、读盘158GB，无OOM，后调到3GiB/2CPU，不调整产品守卫。旧镜像完整停止态Host正在核验。

用户明确授权生产部署后执行新版整体Reset；另外明确4K忙载吞吐延后、不阻塞发布。新冷备`backups/pre-f280e6bd4-20261023/data`于05:56:05Z校验196文件一致，清单SHA256为7e115a1b966f5f9c947d455d4aa60a832facd580c02093296026644bf2260d1a，另保存Compose/Secret，原事故冷备保留。生产原库仍未切换。准备新一致快照及正反向结构副本，首次部署辅助fixture误假设镜像内包含只供部署包装加载的create-readiness-snapshot.js，未开始捕获即失败；改为只读挂载同提交的既有辅助脚本后继续，没有修改镜像或产品规则。

新增专用formation-retirement-schema-cutover工具，避免旧223表/旧schema发布器误用；严格绑定230表正反向证明、独立源快照SHA及原main/WAL/SHM物理集合，保留非空WAL并进行持久同卷切换。真实WAL含已提交Subject的正例、WAL漂移/缺失、反向事实证明漂移及两处中断继续共6项，Windows与实际Linux镜像各PASS。该工具属于部署辅助，不改变f280产品镜像；生产前仍执行dry-run及完整门禁。正式deploy-nas dry-run已通过，尚未apply。


## 2026-10-25 生产操作前最终资格核对

用户再次明确要求部署并执行新版Reset，完成后保持停止，核对收藏与历史。原生产仍为d94bc/hostfix4、exited、restartCount0，15个其他容器运行；fnOS只读preflight和部署Secret一致性复核通过。标准deploy dry-run再次通过。

补记已完成但14:28检查点尚未结束的资格：实际候选Reset后停止态Host 725874ms PASS；旧镜像在反向副本完整停止态Host 713539ms PASS，原158424 Attempt/682 Entry/1 executing保持。256MiB Worker prepare修正fixture Reset ID格式后437245ms PASS，保留plan 7185665 bytes，heapUsed216278880；首轮ID守卫拒绝记录保留，不修改产品守卫。新生产冷备的正向230表结构复制及反向还原于2026-10-23T06:59:30.916Z全部验证通过。

2026-10-25T09:03:44.900Z生产cutover dry-run通过，原main/WAL/SHM与冻结物理集合完全一致，源一致快照SHA256 `56cf17a43327a0b533fb8a92e2ff90a2e10f1652d17deaf76b2765692d709ecc`，目标SHA256 `cc3f026824919c3d3b7ea6fa5821b611a9b4ef939b8b9a0acd4b0a85262cbca4`。正在执行切换；本节不宣称部署或生产Reset成功。


2026-10-25生产切换与部署：cutover apply成功，目标SHA与预检一致，原冷备及WAL/SHM保留。标准deploy-nas --apply完成，镜像 `markmahoro/shelfdeck:f280e6bd4`，source `f280e6bd495e8bb75f4185d532adc18e0f1b0071`，NAS image ID `sha256:6f57fec925c007f810ab23af323a75f3dd3499259e6f18b8acbb56186a78e723`，tar SHA256 `192445c85c44a26f38cb1490a30f5b7b29a8ab48b8e24732861a017a545c107c`。StartedAt `2026-10-25T09:11:22.486206343Z`，启动约5分钟后health/Admin/挂载/镜像身份全部通过；启动前连接重置属于监听前轮询，未重启容器，restartCount0。Runtime stopped/desiredMode stopped/normalSupplyAllowed false、error null。

生产Reset前只读基线22组摘要保存于冷备verification/protected-before.json：10张Arca收藏表、10张Libra Decision/Receipt/Outcome历史表、927个既有ended Run及其Revision；682 Shelf Entry、158424 Attempt、1 executing Event、0停止态终止Receipt。相比先前12组验证，增加历史表核账只改变只读诊断脚本，不改产品镜像。

正式Runtime Reset API于 `2026-10-25T09:17:40.244Z`受理 operation `35f56422b3e3f8f2dc52d539bae7a261427637c0a9daa95352b94fef49c35454`，范围225Subject/14Run/14Work/14Workspace、pending Intake0、无blocker。使用同一幂等键，未重复提交。当前resetting/desired stopped/normalSupplyAllowed false，备份ID `formation-reset-8d5c2351-dcbb-4174-962c-163d98f2bd39`，位于 `/vol2/1000/shelfdeck_backups/`；本检查点尚未完成Reset，不宣称后置核对通过。


## 2026-10-25 正式生产Reset完成及独立保护核验

本次实际通过正式Runtime API执行，非隔离副本或分段重放。operation `35f56422b3e3f8f2dc52d539bae7a261427637c0a9daa95352b94fef49c35454` 于09:17:40.244Z受理、10:13:54.769Z完成；reset ID `formation-reset-ffd78384-295c-4bdb-9736-215035e4a4fa`，275/275步骤完成，225Subject/14Run行政退役、pending Intake0、14Workspace保留。原1个停止态转码执行正式终止，新增1条Foundation停止态终止Receipt，executing=0，未重跑转码。API后置preview subjects/intakes/runs/works/workspaces全部0、无blocker；Runtime stopped/desired stopped/normalSupplyAllowed false/error null/recoveryBackup null，未Resume。

完整备份于09:45:36.033Z生成回执，目录 `/vol2/1000/shelfdeck_backups/formation-reset-8d5c2351-dcbb-4174-962c-163d98f2bd39`；backupDigest `df162e66ae9b65da163df7d383acb9b0344ab0f23ab2eb182c6de91ac5a3b309`，一致数据库SHA256 `606b9bd3309f1925a496a1cfbf60c8b267702cf8f096bb6973bbfd20c2c11218`。现存Workspace 88,669,733,359 bytes，14项中2项原目录不存在、按absent记录；含数据库/伴随文件逻辑总量约93.3GB。提交前再次全量SHA复核通过；不把reflink逻辑字节等同新增物理占用。原升级前196文件冷备及精确结构切换证据另保留。

独立只读前后核验22组事实完全一致，涵盖：

- Arca的Shelf Entry、Canonical Identity revisions、Deck Fact revisions、Inventory materials/person relations/product facts/related references/representations/verification records、On-deck Commit receipts，共10张表；682条Shelf Entry保持。
- Libra既有discard decisions/receipts、Run outcomes、Handoff A receipts、intake decisions、delivery receipts、Subject abandon decisions/receipts、decision basis inputs/revisions，共10张表。
- 原927条已结束Run及其Run revisions逐行摘要保持；结束总数941是原927加本次14条administratively_retired，不删除或改写原终局。158424条Attempt总数保持；原未完成执行的状态改变由新增正式终止Receipt说明，不冒充全部Execution字节不变。

foreign_key_check为空、integrity_check=ok。后置检查初始隔离1GiB/1CPU产生11004次memory.max回收、没有OOM；只把读数据容器提升到3GiB/2CPU后完成，所有生产数据与媒体挂载均readonly，仅verification证据目录可写，未改生产资源配置。辅助容器自动退出；只剩正式ShelfDeck容器运行且业务stopped。health/runtime/Formation/collection通过，fnOS HTTP200，15个无关容器持续运行；正式容器restartCount0/OOMfalse。

正式回执位于 `/vol1/1000/docker/shelfdeck/data/reset-receipts/formation-reset-ffd78384-295c-4bdb-9736-215035e4a4fa.json`；journalDigest `8d8f7aa1871c432ce75f85ef2d49eb66ee5822982e46251b5b56d71ba7cdeb50`。前后摘要位于 `/vol1/1000/docker/shelfdeck/backups/pre-f280e6bd4-20261023/verification/protected-before.json` 与`protected-after.json`。本地ignored目录保存标准deploy日志、API受理/最终结果、冷备/Reset回执及前后摘要，不提交原始生产数据。

本次已产生正式管理退役新事实，不能仅切回旧镜像或覆盖旧数据库；反向结构复制仅证明无新增事实时可回退。冷备保留作事故恢复材料，本次没有执行回退。未重新遍历全收藏媒体字节，保护结论以正式收藏事实/历史摘要、Reset正式边界及上述证据为准。原剧集问题、高达/凡人歌的正常新流程媒体验收继续开放；不以Reset或隔离测试代替自然重采验收。4K忙载吞吐继续延后。


## 2026-10-25 Resume 阻断与来源目录提示

Reset 完成后的用户授权 Resume 在 10:21:42.470Z 创建 operation `08c21ab53416aa594dd461a3c6c5aeec61ae305e437fee50951f949ac2f72126`，10:23:46.265Z 失败，`P4_EXECUTION_HOST_RECOVERY_BLOCKED`。HTTP 客户端超时不代表请求未受理；未重复投递。Runtime error / desired stopped / normalSupplyAllowed=false，容器无重启/OOM。此前完整副本验证只证明 stopped Host，不包含正常 Resume，这是本次资格遗漏。

五个真实来源 `/media/Film`、`/media/chn_series`、`/media/Series`、`/adult/JAV/toscrape`、`/adult/US` 均通过 stat/opendir 且非空。最新 Field Observation 的 ROOT_UNAVAILABLE 来自 2026-10-22T11:52:23–36Z；overview 优先投影该历史失败，不能由提示推断当前挂载失效。未清除旧记录或修改路径。后续需恢复供给并等待正式新观察证明，而非伪造成功。

未改动镜像 f280e6bd4 的完整生产副本正式 Resume 恰好得到 1707 个 `PLAN_CATALOG_DRIFT`，无其他类型 finding。这些 Plan 全部对应 hostfix4 Catalog `8f5dded28a5fea846f45a7c7b715109f1cf92ef36473d7a1b7f67cc68b4208db`，所属 Work 全部终态；8 个范围外保留非终态 Work 不是本次阻挡原因。两次前置诊断因副本挂载身份与持久 Aftercare root 不匹配而中止，属于 fixture 配置错误，已保留失败日志；使用生产 `/app/data` 只读保留原物理身份、独立 `/diagnostic/data` 写入副本后复现成立。

修复沿 SSOT 既有 Frozen Catalog History：从不可变旧镜像 `sha256:d94bcda0875bc51059dfa601f5fec3b0f220d9b0925029fadd75886c649a886e`、revision `b70a9f6f6dde90654fbdef70e226b11f25f709f5` 的空隔离 Host 提取 125 Capability / 1368 Schema 及原策略与完整 Result 证据闭包。新增 `published-terminal-contracts-20261022.json`，canonical SHA256 `51dca4f218fdeae45ec2a72c53056afe3fb0486b056e5a794117658fa6c1046b`。只读验真终态 DAG/Owner/Result/Effect，不注册旧执行器、不增加 Catalog 白名单、不修改历史、无数据结构迁移。定向历史合同/暂停批次/启动恢复 118/118 PASS，含活动 Attempt 与篡改拒绝。新鲜生产副本正常恢复、Service 与修复镜像资格仍在执行；本节不是发布成功声明。


## 2026-10-25 历史兼容累积机制审视（设计待确认，候选暂停发布）

用户明确担心逐次升级叠加兼容补丁。复核实现与 Git 历史后，不能把本次问题仅定性为漏带文件：

- `workflow-plan.js:executionCatalogDigest` 对全部注册 Capability 与完整 Policy digest 求摘要，Plan 持久化该全局标识；与某 Plan 无关的能力变化也可能改变 Catalog。
- `startup-recovery.js` 的 snapshot 全读执行表，逐一把全部历史 Plan 送入 Catalog verifier；`PLAN_CATALOG_DRIFT` 属 hard finding，任何一项均令全局 normalSupplyAllowed=false。缺档与当前实际责任风险在该门禁中没有区分。
- 9月以来多个提交持续扩充 transition/history；现有五份 terminal contract archives 合计约8.4MB，包含本次未部署档案。附加档案有最多8份的硬上限；该上限不是退出机制，不能以扩大上限解决增长。
- 既有 SSOT UAT-251/274、UAT-293 允许完整原合同只读验真，禁止旧 Executor 和活动 Attempt；本次678687b8e符合这一现有机制，但不消除机制本身的发布耦合。§10.3原有按责任Scope恢复/隔离与后续全局历史Catalog阻断规则需统一，不应擅自把历史全部跳过。

建议的新合同方向（尚未批准或实现）：Foundation在发布新Plan时原子冻结其实际使用的合同及Schema/Policy闭包，以不可变内容摘要保存且去重；历史合同作为随数据备份的证据，不再按发布日硬编码加入服务源码。正常启动验证当前责任与未决Effect及其必需依赖闭包；已经闭合且不被当前责任引用的历史审计独立有界执行。缺失依赖必须阻断受影响操作，无法证明风险Scope时仍全局阻断；不能仅凭terminal字段认定无责任。历史审计结果不能授权执行，引用旧Result须通过明确的当前消费合同。需要定义证据版本支持边界、完整性/来源信任、备份恢复、缺失/篡改行为，不能把新的存储层变成通用兼容执行器。

既有历史只允许一次性从可证明的原镜像/合同建立精确证据引用，原事实不改写、不复活已退役Formation；无法证明的历史显式报告，不猜Schema。验收必须覆盖：无关Capability升级无需旧版本分支；多次合同升级及无旧镜像环境仍能启动；历史篡改被发现；有未决Effect或当前依赖时仍严格拒绝；断电发布不形成无合同Plan；备份恢复及既有收藏/历史保持。

这涉及启动门禁及持久合同，需要先确认新SSOT再实施。当前补档案候选暂停部署，生产保持供给关闭，不再Reset。Windows Service复验673 PASS/29 skip/0 fail；定向118 PASS仍只证明现有补档案方案，不作为新机制通过证据。


## 2026-10-25 历史合同机制清理开发检查点

用户已确认按机制清理，不单独上线678687b8e补档案候选。SSOT §8.5.10.1及三个Phase工作项已同步。本节为开发证据，不是部署或生产恢复完成声明。

- 新Plan保存实际使用的Capability manifest、schema传递闭包、执行策略和结构绑定，两个证据表与Plan同事务；同步Owner命令单独采用其正式合同，不伪造Executor或Effect。
- 启动根为当前Work/Attempt/Event、未决Effect、资源等待和Circuit，按实际关系展开；终态Work的未决Effect仍必须验真。闭合无关历史不再构成整机启动前置条件。
- 历史审计纳入既有存储维护：每批8项、时间预算、持久cursor及内容寻址审计Receipt。缺失或错误证据有明确finding，不能静默视为通过。
- 原日期档案和专用旧版本证明移至`scripts/helix-architecture/history-evidence`。一次性迁入仅接受精确来源及原严格验证；终态封存原图与依赖图摘要，不产生旧执行权。实际依赖仍必须校验，未知来源记unverified。尚未证明生产所有历史均可迁入。
- 精确232→235结构复制只增加`fx_execution_contracts`、`fx_plan_contracts`、`fx_plan_history_audits`，逐表核对231张原事实/执行表。旧232目标工具冻结其原DDL，避免未来版本重新改变旧工具语义。
- 新增原表前后校验抓到正常Host初始化会写系统Rule Template，因此导入改为临时空Host仅捕获合同，目标使用SQL受限Kernel，只能SELECT及INSERT两张证据表。修复后真实进程回归通过，旧表全部保持；该失败及修复日志保留。

开发证据（ignored日志位于`.codex/formation-diagnosis-20261023`）：

| 检查 | 实际结果/边界 |
| --- | --- |
| 完整Service上一检查点 | 702 total / 673 PASS / 29 skip / 0 fail，`history-mechanism-service-2.log`；不代表此后追加修改已完整复测 |
| Clean Host | 15 PASS / 2 skip，`history-mechanism-clean-host.log` |
| Owner重试 | 26 PASS，`history-mechanism-owner-command.log` |
| 责任根/合同证明/导入 | 34 PASS，`history-mechanism-roots-proof.log` |
| 最新隔离导入 | 1 PASS，`history-mechanism-import-protection-4.log`，含原表保护 |
| 静态模块/语义/manifest/合同门禁 | 全部通过；旧版本移出运行目录后的完整固定门禁待执行 |

当前生产容器仍为f280e6bd4，业务供给关闭。旧Reset已经完成，不重复执行。下一步固定候选完整门禁、NAS生产副本逐表保护与历史迁入、正常Resume及适用平台资格；完成后才沿标准发布入口恢复生产。Docker Desktop当前命令超时，尚无新镜像，不以源代码overlay演练替代最终镜像资格。


### 机制副本演练追加检查点

- 固定230a3100a的Service再次取得673 PASS / 29 skip / 0 fail；完整Architecture仍运行于独立固定checkout，JAV旅程持续创建新fixture，未提前终止或记PASS。
- NAS只读生产副本232→235复制完成：231张原表逐行一致，外键/完整性通过。旧无索引候选的逐Plan导入反复扫描Effect及Marker；保留已得复制证据后停止该隔离容器，生产未操作。新增三个明确SSOT技术索引，查询计划回归证明使用索引而非全表扫描。不会在运行旧副本上偷偷加索引，将从冻结源重新准备新候选。
- 三组更早的Catalog已用原提交真实Host复原：b06b70ba10对应37264ba7、999a94fa8对应a30cf21a、04bf24190对应b39d3635；档案canonical摘要分别35b0bb78、9131d24f、999a72c8。仅纳入一次性导入输入；缺少当时Schema声明的Result仍验真失败，不沿用后来的名义合同补授权。
- 终态证明的未决物理Effect必须重新取得当前Owner证明，不能靠封存摘要通过启动；复用相同输入/Intent/Source Commit/Slot链验证，观察后重读封存事实。85项正反例通过。
- 加性复制/导入、原表保护与同卷原子切换10项通过；包含保留非空WAL、rename前后中断恢复、来源漂移及运行意图拒绝。失败历史现在立即写持久审计Receipt。
- Docker引擎经用户恢复后已确认29.4.1可用。Windows及Docker包装已补一次性工具及冻结档案依赖；最新固定候选完整门禁、镜像和NAS演练继续，尚未部署或恢复生产。

- 最新组合`history-mechanism-final-targeted.log`：41项，40 PASS/1历史快照未配置skip/0 FAIL，覆盖两个P3持久化门禁、旧JAV复制/验真、合同导入/加性复制、终态Owner证明、Windows独立分发与切换工具。两个过期索引总数断言改为对照当前manifest；精确索引查询计划仍独立检查。
- `history-current-jav-first.log`：新建真实HEVC JAV完整入藏1 PASS（约44秒）；输入清理等待是fixture主动验证授权前不删除，授权后正常完成，并非已证实的运行回归。完整Gate仍待结果。


### 2026-10-25 完整门禁发现的机制缺口及副本导入结果

固定230a完整Architecture结果为3346项：3296 PASS / 24 FAIL / 26 skip，四项静态通过。失败日志保留，不作为发布资格。除旧fixture断言、归档checkout缺Git历史外，确认了以下真实缺口并补回归：

- Owner原子写入Result/Commit Marker后、Event Journal收尾前退出，是合法恢复窗口。当前Plan仍须使用未变合同，并精确证明Event/Attempt/Intent、Marker/Result摘要、Owner及Scope和提交时序；Receipt与DomainFact两种既有typed提交合同分别核对。不会直接将Effect改成committed。
- Procurement的Triage Evidence引用不是完整观察对象；新增显式`evidence_reference`序列化声明，严格四字段及摘要/Marker检查。JAV资料修正的验证Record按实际生产者声明为`full_result`，不从字段形状推断合同。
- 一个依赖闭包可涉及多个终态Owner观察，逐图取得精确未决Effect集合并重验整图；限制100轮，外来/缺失/不推进证明继续拒绝。
- 维护窗口旅程暴露Host注入时钟未传到文件观察和FFmpeg Event deadline。统一使用同一执行时钟，实际进程本地时限/停滞保护继续使用原规则，不调整4K吞吐或时限。

定向证据：合同/历史/Owner正反例及P2基线100 PASS；静态fixture23 PASS；Git历史及文件观察11 PASS；媒体Effect24 PASS/1现场BDAV fixture未配置skip。真实同名多季入藏、整剧rename后退出恢复、整剧原子Commit后退出恢复、JAV原子修正/回收退出恢复、维护窗口人物建档均通过。定向通过不代替最终固定版本完整门禁。

固定76724153e镜像已标准构建及上传，仅用于NAS隔离诊断：tar SHA256 `fb70783d5c546e87292d3ba8bfabecb5c5b6ea805c11bcb960ee8d78e85b8d4a`，NAS image ID `sha256:ccf311034f84204fd51514b0aef911bac6b42201739ef907928295ab04be0e5f`。232→235副本导入扫描51273个Plan，其中51246 imported、27 unverified；导入后231张原表逐行摘要保持，FK/integrity检查通过。27项均为终态且Effect已committed：4项成功Event缺Result、20项旧生产者缺可证明的prebound Evidence声明、3项旧Result缺其冻结Schema要求字段。保留原事实及持久失败审计，不补造证据；它们不因此获得执行权。

767副本首次正常Host启动因演练漏复制加密凭据失败，补齐后由于将副本挂到`/app/data`改变原Workspace mount身份再次失败。演练改为副本数据库位于`/diagnostic/data`、原Workspace及媒体只读挂载以保留真实物理身份，正常Resume/Stop及22组收藏历史保护继续验证。两次演练配置失败保留，不记PASS。当前生产仍f280e6bd4且供给关闭，本段没有生产部署或Reset；最终新候选门禁/镜像/副本恢复资格待完成。
