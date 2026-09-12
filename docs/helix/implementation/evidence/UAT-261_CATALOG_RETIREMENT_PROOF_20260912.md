# UAT-261：精确 Catalog retirement 与未决 Effect 分离

状态：本地实现及只读副本验证；未部署、未关闭。统一部署任务负责完整 Host 升级/回退门禁。

## 问题与范围

Intake Control 引入真实执行合同变化，Catalog 从
`d2f4691efff1460f421d6a76ce06e537c0728a159dae7f548edc06ca5dc63e59` 变为
`d8d6a237f3cdcda20b1548d5064b94dc483cf58da1ed2ca326f5e1ca2cfb6a74`。
Startup Recovery 缺少该精确转换的历史证明路径，导致所有旧 Catalog Plan 阻断启动。
不是 sourceLocator 导致变化；该字段本就不进入 execution semantic digest。

依据为 SSOT 既有 Startup Recovery retirement、§8.5.6 Effect Journal、§8.6.19 Result/Evidence，
以及本次追加的 UAT-261 有界实例。Foundation 只核验技术持久证据，Arca 继续拥有实际上架及原片处置。
不修改 `catalog_digest`、`graph_digest`、旧输入/结果或业务事实，不扩大 Reset，不兼容活跃旧 Intake。

## 冻结 witness 与证明规则

- 87 个 enabled Capability 的完整语义摘要、executorVersion、Owner、Effect Class 和执行策略摘要逐项匹配；
  可由旧记录重算旧 Catalog，当前精确目标也须匹配。未来联合镜像若改变 Catalog 必须重新核验另一精确转换。
- 每个 Capability 的全部 input/parameter/result/evidence/failure/fence/resource schema 递归 `$ref` 闭包哈希，
  不把 ref/version 相同当成内容相同。5 个新增/改变 schema 导致 `libra.intake.material.verify@1`
  与 `libra.intake.accept.commit@1` 受影响。
- 持久 DAG、Work/Attempt/Plan/Event 一一归属、合法边、唯一 Event Attempt、成功 Result、内层 Evidence
  canonical digest、Effect/Commit Marker 引用都须可证明。空图只允许终态 non-planned Resolution。
- 同 Plan 结果依赖须有 success edge；同 Work 分页可读取严格更早 ordinal、已证明终态的 Attempt，
  不能以分页为由引用本 Attempt 无边的节点或未来 Attempt。跨 Work 递归核验 Owner、图及 typed Result 来源。
- 活动执行及其实际依赖必须未受变化影响；所有活动 `libra_intake` 排除。活动物理 Effect 仍由原 Reconciler/Fence
  判定，不由本证明器制造恢复结论。终态物理 Effect 若仍未决则阻断。

`catalog-plan-proof-reader` 只声明 Foundation owned select，在单次只读 UnitOfWork 中核验一个 Plan 及其依赖，
不把所有 Result 大 JSON 加入全局启动快照。没有跨 Domain Store，也没有裸 SQL/Kernel 访问。

## 正规历史形状与证据限制

1. Result 名义 alias 仅承认完整 schema 的直接 `$ref` 链，例如 Capability result → PerceptionRecordCommitResult；
   不接受任意相似名称或任意 schemaRef。
2. `EventRuntime.complete` 允许预提交 domain Result：Attempt 保存外层 EvidenceEnvelope 摘要，Result 保存内层
   Evidence。两摘要不同是合法形状。预提交路径必须有精确唯一 Marker/committed Effect/Result/成功 Attempt；
   普通路径按直接 Evidence 摘要验证。普通 Effect-only Marker 的三个 Result 字段必须同为 NULL。
3. 历史 `LibraProductFactEvidence` 已在原 SSOT 定义，却未物化 schema。现补齐其既有四字段 closed schema，
   result-helper 增加 1；Capability/Result family/Table/Transaction 不增加。witness 明确保存
   `previousSchemaDigest: null`，以旧 source commit、SSOT 原行及 canonical 文本摘要证明名义来源。
   不声称存在旧 schema 字节，不让该补齐成为活动依赖的 unchanged 证明。
4. 旧表未保存完整原始 WorkflowPlanDefinition 或外层 EvidenceEnvelope 原文，因此不能重算它们的历史摘要。
   本修复证明持久图/提交关系及实际保存 payload 的 canonical digest；不声称重建未保存原文，不伪造业务 Envelope。
   已终态 payload 不用新 schema 重做业务语义判断；未知名义引用和缺失/损坏持久引用仍阻断。

## 最新副本与验证

部署任务提供 2026-09-12T09:52:01.807Z 的 45 文件一致快照，manifest digest
`ac818aa75b1eb2b8ef266b6e23eefbc260be82cf8bbef72bb98b18e72e06b11d`。
冻结目录为集成工作区 `.codex/unified-release-20260912/uat261-host-20260912-resume/data`；
本任务复制数据库到独立 TEMP `catalog-proof-latest.db` 后仅做 Catalog proof，无 Host 启动或物理操作。

4764 个精确旧 Catalog Plan 中，4757 个严格通过；仅 7 个 Plan 的 23 个未决物理 Effect 保持 blocker。
数据库检查 `quick_check=ok`、`foreign_key_check=0`；原件与演练后副本完整 DB SHA256 相同：
`57d42faa5f0a69a512f6cfde9fc2079b6122a497e937a193344573039f522867`。
原始只读分析结果保留在本任务 TEMP 的 `catalog-proof-audit.json`、`catalog-unresolved-effects.json`，不提交生产数据导出。

定向运行 85 个测试全部通过，覆盖新校验、Startup Recovery、schema builder/validator、SSOT source map；
追加包边界/持久边界/DAG 检查与校验器回归 59 个测试全部通过（两组有重叠）。
全量 architecture gate 首次运行受到保留中的 UAT-260 未完成文件和当时未刷新 source map 影响而失败；
source map 已刷新并验证，不能把该次全量失败报告为全绿。完整最终 Host 和 Linux 镜像门禁尚交部署任务执行。

部署任务独立报告：同一完整副本上 exact cd4f Host 正常 ready，exact d7 Host 出现 4764 个 Catalog findings；
两者八组 protected facts 哈希不变。此为发布对照证据，不代表本修复已可发布。

本地实现提交 `e6ab87955`；在不含260 WIP的独立干净 checkout 运行全量 architecture：
1686 tests，1676通过、9跳过、1失败。唯一失败是新增既有名义 schema 后的 P2 固定 aggregateDigest
仍用旧期望，随后同步为 `faa39ed26084596b67ea06686c3fe1cada31639fa67c26731a68dc38009ab1dc`；
该次依赖、语义、manifest、合同图检查全部通过。基线期望修正做定向复验，不能把首次运行写成1686全通过。

## 7 项未决物理责任的最小处理范围

全部 Owner=`arca`、processType=`arca_ondeck_run`、workKind=`on_deck_execution`，旧 Work/Work Attempt/Event
均 failed，Event Attempt completed/failed，Effect 均 `reconcile_required`，output/receipt 尚未证明。
四个 Run 已由后续正式 Work 完成 On-deck，但旧 20 个 destructive Effect 仍未收口；Run committed 不能直接
作为每个旧物理 Effect 已完成的证明。另一个 Run 是人生密密缝，仍 blocked，其 3 个 stage Effect 也未收口。

已有 Owner 入口为 `on-deck-process-coordinator.recoverOnDeck/retryAcceptance/reconcileOnDeck`：
前两者读取当前资格后建立新 generation，后者以成功 On-deck Commit 收口 Run；它们都不是任意终态旧 Effect
的清除入口。Foundation Startup Recovery 现有逻辑对失败/取消 Event 的未决 material/destructive Effect
保留日志，不自动重启该终态 Event。§8.5.6 要求根据精确物理 Reality、授权和逐项 Evidence 前向恢复或预声明回退。

因此本次 Catalog 校验不会把以下日志改为 committed/failed，也不会因为已有后续 Run 成功而删除日志。
下一修复须先明确 Arca 正式 Reality 观察与 Foundation 旧 Effect 责任收口的依据及入口，验证 exact scope 后再实现；
不能用 Reset 或直接 SQL 代替。这个缺口独立于 Catalog retirement，仍阻止当前镜像发布。

部署任务 10:02Z 后续只读复查：人生密密缝旧 NFO 摘要已变，且 NFO、poster 现有 Arca/Libra Binding；
Arca owner object=`0ed81eff0ac03622a5e09c78a4f289d333941d0dd33da8fa2d3c2053ef2db7d4`，
Libra Subject=`libra-subject-16840a150d21691ee3d8d67e7c926af7d55f4f10`，
origin Offer=`b5c41d007afbd84f13c2f475910c25d8b0169b662ca51c38a496417bb00630b2`，
Offload Package=`e9938da46df82bc89a1d0a6affdd595661dd72d409712e88359d01dc38cf2154`。
旧无主冲突隔离清单失效，poster 字节未变也不能豁免当前归属。未执行隔离或媒体写入。

以下精确清单来自冻结副本；任何后续实际恢复都须重验当前状态，不按这些 ID 盲目重放。

### arca-plan-57f848ab2f57bd0d590eddf8cc32c3d4a114e7e8

- Work：`arca-on_deck_execution-work-948034c65dfbb9b6442e048ecdd4c82f9f10ecea`
- Attempt：`arca-on_deck_execution-work-948034c65dfbb9b6442e048ecdd4c82f9f10ecea:attempt:1`
- Arca Run：`935956e4cec5555819cbcac5b899a719b37a2a00335249cf3e448bd4c586ab2d`
- Capability：`arca.ondeck.input_settlement.delete@1`

| Event | Effect | 状态 |
| --- | --- | --- |
| `ondeck-settlement-50e87271af287c52c6-0000` | `40b0219eaeaaff2be3901603a57792479a42cfa673286b6ee27e5942072748e9` | `reconcile_required` |
| `ondeck-settlement-50e87271af287c52c6-0001` | `0d7ce18e76f653d48c19bcfbfb9a58bb2d013401d7845bbb33a79df373eefaae` | `reconcile_required` |
| `ondeck-settlement-50e87271af287c52c6-0002` | `890a40e99380f45e385c190389e44f828df4b7d0434fa86967296a54f28c3feb` | `reconcile_required` |
| `ondeck-settlement-50e87271af287c52c6-0003` | `5cff38da6527099333f7805f8357bc16382feade59f541b83712f334c742efff` | `reconcile_required` |
| `ondeck-settlement-50e87271af287c52c6-0004` | `483afd15db35fb2a87e0f868d8c901ab76b81229e0b7740bf5cdbbd176389232` | `reconcile_required` |

### arca-plan-6ff85d69bd9d5a4768d79b89b06585aac6b38d92

- Work：`arca-on_deck_execution-work-7bf42c80966994f724922c6907cd805d4ad45ae7`
- Attempt：`arca-on_deck_execution-work-7bf42c80966994f724922c6907cd805d4ad45ae7:attempt:1`
- Arca Run：`7c5091bf9b6abb95caf2c312b7022786e46c5622b464ece3dd863c18c030bb2d`
- Capability：`arca.ondeck.input_settlement.delete@1`

| Event | Effect | 状态 |
| --- | --- | --- |
| `ondeck-settlement-04e65ceaaeaed83b34-0000` | `4c641fe8f4926f7e3e3f82c1a193827157107dac777d149533fb87c59e99d63a` | `reconcile_required` |
| `ondeck-settlement-04e65ceaaeaed83b34-0001` | `6c03a36d66a5818d130c7b53e5a50a81367322886ff4c671a174efb2acd11a24` | `reconcile_required` |
| `ondeck-settlement-04e65ceaaeaed83b34-0002` | `9cfce3ff1f77d9362ef3c2fde2edb5dccd13cf7f9d2f485e5f4398dfcc5dbdcc` | `reconcile_required` |
| `ondeck-settlement-04e65ceaaeaed83b34-0003` | `07d7d1fca79304a4b54293df99e8f4f135b724f18374aaa66cfe4f5a2d50a18f` | `reconcile_required` |
| `ondeck-settlement-04e65ceaaeaed83b34-0004` | `911fb7edb918438c6ee1af19660f39594a626a2cb3fc49d711409d02cba4cbef` | `reconcile_required` |
| `ondeck-settlement-04e65ceaaeaed83b34-0005` | `75571a37795206d7c89449b264c537e01f38bab401e95d08e9e55efeb186b2db` | `reconcile_required` |
| `ondeck-settlement-04e65ceaaeaed83b34-0006` | `2959cac50f9fb7d81ece53c03598f06bc83ea519038add86d864664579af6be5` | `reconcile_required` |

### arca-plan-823a5c01a08171a2af645161524324acf447e911

- Work：`arca-on_deck_execution-work-ddd955391d6a550982567f7d4b3acdab279e00ff`
- Attempt：`arca-on_deck_execution-work-ddd955391d6a550982567f7d4b3acdab279e00ff:attempt:1`
- Arca Run：`844d2564f525ee73c36564559e8b5cbefc704f8cf65457796af7b72bf6215615`
- Capability：`arca.inventory.product.stage@1`

| Event | Effect | 状态 |
| --- | --- | --- |
| `ondeck-stage-623de8a7db70cdfdda` | `f10b50c1ee7ac178fb654b6d2aa4fc4516fe66a0e20871f1f2828d96c01590fa` | `reconcile_required` |

### arca-plan-c6fec45fb891de15344f647854d88f7857255887

- Work：`arca-on_deck_execution-work-d2a4e2666330f577364bdc477274f2832979290b`
- Attempt：`arca-on_deck_execution-work-d2a4e2666330f577364bdc477274f2832979290b:attempt:1`
- Arca Run：`f6b5b9ab9520b4ab4f672de7a1c096af8d305507f6ae46c1586b3d897dba9271`
- Capability：`arca.ondeck.input_settlement.delete@1`

| Event | Effect | 状态 |
| --- | --- | --- |
| `ondeck-settlement-8ce012cfb3799fe981-0000` | `4f7731a5efa21e49d810cbb4f48057668cdea3f72afaefc3ca2f9ca35dbb3061` | `reconcile_required` |
| `ondeck-settlement-8ce012cfb3799fe981-0001` | `5cbfc64e21531b38b1f435f999d579ce9b001e43ba961f12aa269a37faabcfdd` | `reconcile_required` |
| `ondeck-settlement-8ce012cfb3799fe981-0002` | `bf2cb6e38c06b3a6370b3553f3ea5b45aab3dee8a0f31e8b1c123cd957a64eb6` | `reconcile_required` |

### arca-plan-ea4290fa6643ec250a381d4065e7f267b5a9dccd

- Work：`arca-on_deck_execution-work-7f96b6aa04d524485faea195d1d1f0a4896ad65b`
- Attempt：`arca-on_deck_execution-work-7f96b6aa04d524485faea195d1d1f0a4896ad65b:attempt:1`
- Arca Run：`844d2564f525ee73c36564559e8b5cbefc704f8cf65457796af7b72bf6215615`
- Capability：`arca.inventory.product.stage@1`

| Event | Effect | 状态 |
| --- | --- | --- |
| `ondeck-stage-5addc646fbda872412` | `075b7da9f993f0a34edcc636a8c18ef93e2d6849cb011d7a4203d93bab91a4f2` | `reconcile_required` |

### arca-plan-f6c681430d0b48afc772847ed52f25a90553d43c

- Work：`arca-on_deck_execution-work-7bfe62294876484ac7c0550b4f8c113ee6ecbda7`
- Attempt：`arca-on_deck_execution-work-7bfe62294876484ac7c0550b4f8c113ee6ecbda7:attempt:1`
- Arca Run：`b4b54b41b23fa27ef7342736a8706ec5ea7f795df13d5723a7e80d1de596e04a`
- Capability：`arca.ondeck.input_settlement.delete@1`

| Event | Effect | 状态 |
| --- | --- | --- |
| `ondeck-settlement-ffae54e8254138871a-0000` | `224483fd717448283792fa93519a887df0b68baaf3f3b9f63077ca24eec860ff` | `reconcile_required` |
| `ondeck-settlement-ffae54e8254138871a-0001` | `3abdd60ed18bb37f54c7f4a3ea6789f2a73f3a0542a687f7537fd843c0393a11` | `reconcile_required` |
| `ondeck-settlement-ffae54e8254138871a-0002` | `83a9a436f120f3d910a6c874ddd2e1df99027dbaa6e80b6a04cdb6a5d70b707d` | `reconcile_required` |
| `ondeck-settlement-ffae54e8254138871a-0003` | `ca2ab7528cbb9845d5bfce5f4d72411aae7fb9b3ede12f9b439822c689d85c28` | `reconcile_required` |
| `ondeck-settlement-ffae54e8254138871a-0004` | `cbfe0e3e52bd56e0a2ef912f908e725fb967507c8be09ef196a625db54874469` | `reconcile_required` |

### arca-plan-f9eb9d98460ba2c2ad719b6517deb646c4f4dcd7

- Work：`arca-on_deck_execution-work-16dd1c4d8b4740d018b85be7356d4edf197d4865`
- Attempt：`arca-on_deck_execution-work-16dd1c4d8b4740d018b85be7356d4edf197d4865:attempt:1`
- Arca Run：`844d2564f525ee73c36564559e8b5cbefc704f8cf65457796af7b72bf6215615`
- Capability：`arca.inventory.product.stage@1`

| Event | Effect | 状态 |
| --- | --- | --- |
| `ondeck-stage-1da8e127756a34ae5d` | `2b2197bf1319000bc35d9a21938d7fe5d6cc4c2fa6ba19b04e16d592700541cc` | `reconcile_required` |

## 未决责任的设计审查输入（尚未实施）

### 已证明的候选关系与尚缺的证明

进一步只读查询冻结副本：20 个 destructive Effect 全部各对应唯一一个同 Run、同 materialKey、后续成功
Work 的 `SettlementDeletionEvidence`；记录的 `postDeleteReality` 均为 `absent=true`、
`disposition=settled_to_final`、`final_verified=true`，无多候选歧义。候选结果保留于 TEMP
`catalog-successor-proof-candidates.json`。这里只证明存在后继候选，未把 materialKey 匹配当成正式收口。

Arca 正式观察还必须同时验证：原 Custody/Package/Final Inventory Decision、原 Plan 中 exact materialKey，
原 source identity 与 source→final mapping、当时 Approval/standing authorization 的精确依据，后继
Settlement Result/Event/Attempt/committed Effect/Receipt 及 On-deck Commit 完整成员引用。后继成功在旧失败
之后且属于同一责任范围；任何缺失、重复、摘要/身份/Scope 不符均返回 unknown。

三个 stage 的已存 TargetCommitSlotHandle 相同，Result digest
`00ae254bcbcd27d285c032c3382346428b26f8dab5fda0123ac922039e1b2b8c`；
slotId=`609405599ec100b83183deb71888343fdd0144df4e847b4a923a9e0be1a520fc`，
slotDirectory=`/media/Film/.shelfdeck-stage-aa7783bd30f39459`。
三个均因 `RECOVERY_EXECUTION_BUDGET_EXHAUSTED` 终结，不能倒用后来新增的 pre-stage 检查证明当时零写入。
尚需当前只读观察：slot 的 containment/symlink/实际成员与临时文件、每项 identity 与当前 Arca/Libra
Binding/Control、是否有其他活动执行。当前正式目标的归属不能因旧 stage 失败被撤销。

### 可实现入口与明确禁止的复用

- Arca public recovery port 增加精确 Effect scope 的只读观察，由本域 application 解析历史责任与后继
  Settlement/On-deck Receipt。Foundation 只传/验 Work、Attempt、Effect 与摘要，不读取 Arca Store 或自行判断材料已无责任。
- 复用 `workResultReader` 的持久结果、`acceptance.readRunResponsibility` 的不可变责任，及正式历史 Package
  read contract；不能以当前 policy 重新生成旧 Final Inventory Decision。已有 `readAccepted/readSettlement`
  包含 current Shelf/Binding 验证，若无法覆盖 committed 历史，应新增明确 historical read purpose，不能偷偷绕过其 Fence。
- 物理观察从 `clean-arca-inventory-port` 的 fingerprint/containment/final verification 读取部分提取只读函数。
  不得调用 `stage`、`prepareSlot`、`settleInputAsync` 来“观察”：这些入口会 mkdir/copy/清 temporary/delete。
- 四个已 committed Run 以精确后继 Settlement 证据证明原责任已履行，不按 Run 状态放行；人生三个 stage
  仅在零待处置输出被确证时可报告 no remaining effect。存在已知待处理 staged output 时返回需 Owner
  前向恢复/预声明回退，出现未知文件或其他 Owner 引用时保持 unknown，不自动清理。

### 需先审定的技术合同

现有 `EffectReconciler` 的 `terminal_failure` 表示停止/阻断；`EffectJournal.abandonUncommitted` 只改变状态，
不验证 Owner 责任证明。两者都不足以直接表达“原失败执行的责任已由精确后继履行”。不得直接调用该方法
把23项改为failed，也不得把后继Result重新绑定到旧Event、伪造旧EffectReceipt或成功Outcome。

建议先明确一个 Foundation owned、append-only 的 `EffectResolutionReceipt` 技术证明：引用原 Effect
identity/intent digest、原 terminal Attempt、精确 Owner observation 与后继 Result/Receipt 集的 canonical
摘要；closed disposition 仅为 `fulfilled_by_successor` 或 `no_remaining_material_effect`。证明成立后由
Foundation 原子登记，保留原失败 Attempt/Plan/Result 和旧 Journal 审计事实；Startup Recovery 只有验证到
该精确证明才将其视为已解决责任。unknown 不生成证明、不改变供给判断。

这会新增明确的技术持久证明/恢复输入输出合同，需要先同步 SSOT、schema、原子幂等及升级/回退门禁；
当前没有这样的可持久 Receipt，不能把临时日志或只有digest的诊断文件当作它。该方案不新增 Arca 业务状态、
不转移 Owner、不撤销 Handoff B，也不授权实际文件副作用。可否只依赖既有不可变后继 Result 形成只读派生
证明、避免新存储，应由同一设计审查明确；在选择前本批不添加两套路径。

如果人生密密缝最终必须撤销已 Accepted 的旧 Custody、把责任改交另一个 Run，或覆盖/隔离现有其他 Owner
文件，那是超出技术证明的业务/物理决定；既有 `recoverOnDeck` 只建立同一责任的新 generation，并没有
隐含取消 Accepted 责任的合同。必须另交精确对象与拟改变的责任合同，不能夹入 Catalog 修复。

验证要求：20项正路径同时证明原/后继完整映射；错Run、错material、错Approval、缺marker、伪后继或当前
Owner冲突拒绝；stage空slot、合法残留、未知文件、symlink、并发执行分别验证。证明写入前/后崩溃与重放
必须幂等，失败不能改旧历史或媒体。最终仍以最新完整副本的实际 Host 升级/回退为门禁。

### 单一派生证明实施：20 个 Settlement Effect（2026-09-12）

部署任务完成设计审查后选择 **每次 startup 重验的只读派生证明**；此前新增持久 Resolution Receipt 的
建议已被本单一路径取代。本批没有新表、业务状态、媒体副作用或历史回填，旧失败 Event/Attempt 与
reconcile_required Journal 保持原样。仅精确 d2f→d8d witness 内可识别责任；活动执行不消费该证明。

`ArcaExecutionRegistration.createTerminalEffectHistoryObserver` 读取本域 Accepted Responsibility、
Libra public historical Package 与 Foundation public technical graph。冻结历史 input projection witness
来自 `b8fbee1a95e41efa3ee55c93eb42e80927cc79a7` 的 `on-deck-projections.js`。
该版本使用 synthetic `system-policy / approvedAtMs=0` ApprovalHandle，且
`finalProductVerificationDigest` 是 Libra historical conformance。UAT-172 已确认这是执行授权缺口；
本批明确输出 `historicalAuthorization=unproven_system_policy`，只复原过去输入，不证明真实用户授权。
该 helper 不被新 Planner、Projection 或 Executor 调用。

最新完整快照副本中：

- 20 个原 Effect 的 namedInputs 摘要全部匹配原 EventAttempt.input_snapshot_digest；使用保存的
  fence_snapshot_digest 计算 intent 全部匹配 Journal.intent_digest，未重算为当前 Fence。
- 20 个唯一成功后继同样全部匹配自身 input/intent；要求同 Owner、Run、immutable Package/Custody、
  exact member/source→final mapping，且后继 Attempt 开始时间严格晚于原 Attempt。
- 后继 Staged Manifest、Placement Receipt、真实 Arca Final Verification、逐项 Settlement Evidence、
  Fulfillment、OnDeckCommit 的 success dependency 路径与 canonical payload 全部验证；缺失、伪造、
  跨 Run、歧义后继、输入/intent/Fence 漂移均拒绝。Foundation 重新证明完整后继 Plan/Event/Effect/Result 链。
- Arca 原 `readCommitted` 使用 current Inventory revision（四 Run 分别为5/2/5/5），因此不能用来读取
  初始提交历史。新增独立 `readHistoricalCommitted` **只取 Receipt 指定的 Inventory=1 / DeckFact=1**，
  完整复用原 Inventory Representation、Physical Identity、active Deck Fact、packageDigest 与 Receipt
  校验，四 Run 全部通过。原 current read 入口和 Fence 保持原语义，不尝试任选 revision 匹配。
- 精确7个待处理 Plans 的开发区验证结果为 **4通过 / 3 stage unsupported**。本次没有重跑此前已通过的
  4757项全量审计，不能把此结果宣称为新镜像或 full Host 已通过。

定向测试：Foundation Catalog proof 51项、Arca Owner history observer 8项通过；另 Handoff B/On-deck
8项与 Source Map 1项通过。Package boundary、forbidden semantics、manifest、P2 contract baseline 四类
静态 gate 均通过，执行 Catalog 仍 d8d、87 enabled capabilities。本批未做 Linux 镜像/full Host，交由
部署任务在干净集成树重验。临时 DB 只读核验前后 SHA256 仍为
`57d42faa5f0a69a512f6cfde9fc2079b6122a497e937a193344573039f522867`。

《人生密密缝》三项 stage 不在本提交的放行分支。现有空 slot 观察保留为证据；下一步需精确旧输入/intent
与持久 TargetCommitSlotHandle 验证、当前 readonly slot reality、作用域内无活动写入及引用的闭包。
这三项未解决前 UAT-261 保持开放，Arca Accepted Run 保持 blocked，不能部署宣称已修复上架。
