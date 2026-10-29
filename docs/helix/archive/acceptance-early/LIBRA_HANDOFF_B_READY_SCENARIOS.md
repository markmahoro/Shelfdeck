# Libra Run → Handoff B Ready 验收场景基线

Status: `CONFIRMED SCENARIO BASELINE / IMPLEMENTATION CHECKPOINT COMMITTED / QUALIFICATION PENDING`

Authority: 本文档是对唯一Architecture SSOT的验收展开，不是新的架构来源，不修改SSOT中的Domain、Owner、Handoff或Execution Foundation语义。冲突时以`docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`为准。

## 1. 验收边界

本节点只实现和验收一种Business Process：`Libra Run`。Remux、Transcode、Metadata、Artifact、External Acquisition不是新的Run类型，而是Production Planner在同一Run中根据Acceptance Spec产生的Supporting Work、Plan、Event和Capability路径。

成功终点固定为：

~~~text
Libra Run active
  → Product Conformance passed
  → immutable On-deck Product Package
  → Handoff B Offer = open
~~~

对于每个成功场景，必须同时满足：

- Package、Product Material Manifest、Off-load Context Manifest、Related disposition mapping、Control、Result、Outbox和Offer可持久化重建；
- Offer状态为`open`，不得消费；
- 不存在Handoff B Accepted/Rejected、Arca On-deck Run、Shelf Entry、Deck Fact或Arca媒体事实；
- Material Field保持只读，Shelf Target Folder不发生媒体文件变化；
- 新写入只能出现在Libra Production Workspace；
- direct-input路径不为形式一致而复制大文件。

## 2. 主生产路径：真实文件E2E

以下11个场景必须使用真实可解析媒体字节和产品Composition Root执行。可以在同一物理样本上切换Perception/Spec，不要为每个评分复制一部电影。

| ID | 输入与Acceptance Spec | Planner必须得出的路径 | 成功结果 |
| --- | --- | --- | --- |
| `L01` | No-rating，已是合规H.264 `stream_file` | `no_effect_required`；原Primary直接进入Product Manifest | 一份Package、一份open Offer |
| `L02` | 1星，H.264 | Transcode为HEVC，产品不超过2 GiB | Workspace新Primary + Package + Offer |
| `L03` | 2星，已是HEVC且不超过4 GiB | `no_effect_required`，不得重复加工 | Package + Offer |
| `L04` | 3星，H.264或超出8 GiB的HEVC | 闭合HEVC与8 GiB上限Gap | 合规Workspace Product + Package + Offer |
| `L05` | 4星，已是HEVC且不超过14 GiB | `no_effect_required` | Package + Offer |
| `L06` | 5星，HEVC + 真4K + 合格主音轨 + 不超过50 GiB | 直接带入，不得为“优化”重复加工 | Package + Offer |
| `L07` | 5星，低于4K或主音轨不合格 | 禁止本地scale或音频转码伪造通过；执行External Acquisition | 外部升级成功后Package + Offer |
| `L08` | 单标题BDMV | 使用Procurement选定Topology，Remux为`stream_file` | 一个Primary、一个Package、一个Offer |
| `L09` | 多标题BDMV | 只处理已选定的主标题；必要时Remux后Transcode | 不生成多余电影或Product |
| `L10` | ISO原盘 | 有界挂载/结构识别/主标题Remux | Product为可消费`stream_file` |
| `L11` | DVD `VIDEO_TS` | 主标题解析与Remux | 一个`stream_file` Product |

### 2.1 评分矩阵不可降级

`L01`–`L07`必须核对最终Product的实际Probe、大小和Provenance，不能只证明“Acceptance Spec创建成功”。

- No-rating Movie只强制`mediaForm=stream_file`，不强制HEVC或评分空间上限；
- 1–5星Movie均强制HEVC与`stream_file`；
- 1/2/3/4/5星空间上限分别为2/4/8/14/50 GiB；
- 5星额外要求真4K-class raster与白名单高质量主音轨；
- 低于4K的原Input不得用ShelfDeck本地放大满足4K Requirement；
- 普通AC-3、E-AC3或DTS Core不得伪装成5星高质量音轨。

## 3. Metadata、Artifact、Media-Cast与Related

以下8个场景与主生产路径叠加执行，不必额外准备8份Primary。

| ID | 场景 | 必须验证的业务结果 |
| --- | --- | --- |
| `D01` | 已有完整有效NFO和poster | NFO优先；不得无意义调用TMDB、重写NFO或重新获取poster |
| `D02` | NFO存在但Required字段不完整 | 保留NFO有效字段，TMDB只填补Gap，不默认覆盖用户Sidecar |
| `D03` | 完全没有NFO/poster | 真实TMDB Metadata→NFO Render→Poster Acquire→Artifact Verification |
| `D04` | NFO不可解析或图片不可解码 | 旧Related被明确替代，新Artifact进入Product，不得同时宣称两份current |
| `D05` | 已有字幕、外部音轨、章节、fanart等Related | 每一项均必须被直接带入、替代或明确终结，不留下拆分Owner |
| `D06` | Metadata包含演员和导演 | 形成Product Metadata Fact和Media-Cast Fact；未注册Person也保留显示名、角色和Provider hint |
| `D07` | Related在Handoff A Accepted后Reality变化 | 旧Reference/Disposition Basis失效；当前Run不得用旧Basis发布Package |
| `D08` | 同一Run存在多个已验证合规输出 | 仅按Plan冻结rank及verification ID tie-break选择，不按输入数组顺序“选第一个” |
| `D09` | DV Profile 7/8且存在PQ/BT.2020兼容Base Layer，本来就需要转码 | 通过经过self-test的GPU或CPU closed pipeline归一化为SDR BT.709 yuv420p HEVC；无DOVI残留且三点可解码 |
| `D10` | DV Profile 5、无兼容Base Layer或色彩Evidence未知 | 本地GPU/CPU均fail closed；不得盲目tone-map或产生错误媒体，只有External Acquisition可继续闭合 |

### 3.1 每份成功Package的内容审计

每份Package必须逐项证明：

- Resolved TMDB Movie Identity与Evidence；
- single Product Structure；
- Product Metadata中title、year/release date、plot、genre、actor、director；
- NFO可解析，至少一张poster可解码；
- Media-Cast Fact与Metadata Source Basis可重建；
- Product Material Manifest中所有成员都具有正确role、Binding、Identity和Product Verification；
- Off-load Context完整列出后续Arca可能需要处置的旧Input；
- Candidate中所有唯一Related都有`source-to-final disposition mapping`；
- Product Conformance对Identity、Structure、Metadata、Mandatory Media、Space和Inventory六类Requirement全部passed；
- Libra Delivery Attestation和Package/Manifest/Fact/Requirement digest相互一致。

## 4. Run生命周期与Decision Freshness

| ID | 变化场景 | SSOT要求的结果 |
| --- | --- | --- |
| `S01` | 相同Intent、重放或启动恢复重复触发Run Creator | 同single Subject范围只能有一个具有最终提交资格的Run |
| `S02` | Shelf/Perception/Identity revision变化，但Spec产品语义不变 | 原Run继续，追加Freshness Evidence，不建立替代Run |
| `S03` | 评分或Shelf规则使Spec产品语义变化 | 旧Run `superseded`，Run Creator建立新Run，旧产物不得提交 |
| `S04` | 当前Basis暂时无法证明fresh | Run进入`suspended`，停止新的重型或外部效果 |
| `S05` | suspended窗口内重新ready且Spec/初始Basis完全相同 | 原Run恢复`active` |
| `S06` | suspended窗口内恢复但Spec或初始Basis变化 | 原Run永久superseded，建立替代Run |
| `S07` | 恢复预算耗尽，或正式Evidence证明产品手段已耗尽 | Run进入`frozen`，释放执行资源，不得自动重开 |
| `S08` | expedited Run因合法Basis变化被替代 | expedited Intent复制至新Run，但不传给Arca |

## 5. Workspace、Effect与崩溃恢复

| ID | 故障窗口 | 必须证明的恢复结果 |
| --- | --- | --- |
| `R01` | Workspace Root不可用、空间不足或Demand溢出 | 不产生半个Workspace、Registry或文件；不动External Input |
| `R02` | Remux/Transcode写入中进程退出 | 从Effect Journal恢复同一Target/效果，不生成第二份输出 |
| `R03` | Provider/External Acquisition请求已成功，Result提交前退出 | 恢复同一Receipt/Observe链，不重复发起外部请求 |
| `R04` | Workspace bytes已写入，Product Verification尚未提交 | 恢复验证或同Effect，不重做已成功媒体效果 |
| `R05` | Product Metadata/Media-Cast Fact Commit任意中间点 | Fact、Source Basis refs、Result、marker全有或全无 |
| `R06` | Deliverable Promotion的Control、Manifest、Package、Offer、Outbox任意中间点 | 全有或全无；重放返回同一Package/Offer |
| `R07` | Owner wake signal丢失后重启 | durable reconcile发现并继续合法Run，不依赖旧HTTP调用栈 |
| `R08` | 17个Subject并行建立Run和生产 | Run/Workspace/Fact/Result不串线；一个慢Run不阻止其他Run先产生Offer |
| `R09` | GPU全局ready但当前Source × Pipeline不兼容 | GPU Assessment产生terminal `strategy_rejected`且零GPU Transcode Effect；Planner建立独立CPU Work/Plan/Event/Intent后才允许真实CPU转换 |

`R02`–`R06`必须使用故障注入、产品Composition Root和可恢复的隔离Workspace；不允许用直接写Store或手工拼装Result代替产品路径。

## 6. 外部Integration的证据等级

以下边界必须分开记录，不得用fake adapter声称“真实外部E2E通过”：

| 链路 | 确定性测试Adapter可证明 | 真实E2E还必须证明 |
| --- | --- | --- |
| TMDB Metadata/Artifact | Planner、Result Binding、Fact/Artifact Commit和错误分类 | 真实IntegrationHandle、唯一Identity查询、真实Metadata、poster bytes及可解码验证 |
| External Material Upgrade | Query/Search/Select/Request/Observe/Stability/Import编排和恢复 | 真实配置的External Material Integration至少完成一次升级获取与Workspace Import |

在真实External Material Integration未配置前，`L07`可先得到“产品执行链正确”的确定性证据，但不得作为Movie全功能封口的真实Integration证据。

## 7. 现有P14测试集映射

现有隔离测试库：

~~~text
C:\Users\markm\AppData\Local\Temp\ShelfDeck-P14-20260723\material-fields
~~~

| 现有场景 | 本节点用途 |
| --- | --- |
| `M01` | `L01` + `D01` + `D05`；根目录standalone与精确stem Related |
| `M02` | 单电影目录、generic/exact-stem Related；可承载`L03`或`L05` |
| `M03` | 同目录多电影；H.264与HEVC分别承载Transcode/direct反例 |
| `M04` | `L06`候选；必须用真实Probe证明4K和白名单音轨，不能依赖文件名 |
| `M05` | `L07`；低清输入禁止本地Upscale，需External Upgrade |
| `M06` | `L08`；单标题BDMV |
| `M07` | `L09`；多标题BDMV主标题选择 |
| `M08` | `D03`；无Related NFO的TMDB/Artifact链 |
| `M11` | 真实中文名Matroska样本；文件名codec与Probe相反的Evidence反例 |
| `M12` | 真实BDMV metadata与有界主标题payload |
| `G01` | `D04`；不合格旧Related被生成Product Artifact替代 |
| `G06` | `D07`；Handoff A后Related Reality变化 |
| `G08` | `L10`；ISO原盘 |
| `G09` | `L11`；DVD `VIDEO_TS` |

不属于本Libra节点的现有场景：

- `M09`、`M10`、`G10`只到Procurement失败/封口，不建立Libra Run；
- `G02`–`G05`、`G07`主要验证Arca Input Settlement、Stage/Switch、碰撞、跨卷及Finished Goods排除，留到Arca节点。

尚需补充的主要证据：

- 2、3、4星实际产品结果；
- 真正合格的5星4K + 高质量主音轨样本；
- External Upgrade成功与手段耗尽/frozen；
- Workspace空间不足；
- Spec同语义/异语义Freshness变化；
- Effect、Fact Commit和Package Publication Crash Window。

## 8. 明确延期到Arca的场景

本节点不执行：

- Handoff B Accepted或Structured Rejection；
- Arca Final Inventory Decision；
- Stage、Placement Switch和Input Settlement；
- 同目录替换、跨卷复制和target collision处理；
- On-deck Commit、Shelf Entry和Deck Fact；
- Arca durable Off-load Completion后的Libra Workspace回收。

但Libra Package必须已完整提供Arca执行上述动作所需的Product Manifest、Off-load Context、Related disposition mapping和Control/Evidence fence。如果这些输出不完整，即使生成Offer也不能判定`Handoff B Ready`。

## 9. 规模与封口判定

本基线共包含：

~~~text
11条真实主生产路径
+ 10条Metadata/Artifact/Media-Cast/Related与DV断言
+ 8条Run生命周期场景
+ 9条Workspace/Effect/恢复场景
= 38个逻辑场景
~~~

通过复用Primary样本、变更Rating/Policy和使用故障注入，预计只需12–15份物理电影样本。

## 9. 2026-08-14资格证据状态

原35个逻辑场景继续由产品Composition Root逐项覆盖；2026-08-13新增的`D09`、`D10`、`R09`也已完成实现和验证。承载这些场景的是产品级test case与两条真实DV字节E2E，不代表test case数量等于业务场景数：

- 主路径和Package审计覆盖`L01–L11`、`D01–D08`；
- rating/same-semantics/suspend/resume/replacement/expedite/fail-closed覆盖`S01–S08`；
- 空间、媒体Effect、外部Receipt、Fact、Promotion、lost wake和20 Subject并行覆盖`R01–R08`；
- 加入D10后的P14场景文件复跑结果为`13/13 PASS`、`451.569 s`；默认服务测试为245 pass、14个显式环境skip、0 fail；完整Helix Architecture gate为158个test file PASS，合同计数保持112/98/180/43/115；
- D09真实Profile 8样本经实际NVENC pipeline Assessment 24/24后完成唯一GPU Effect；R09真实Profile 7样本在GPU仍ready但source pipeline缺失时先形成`strategy_rejected`且零GPU Effect，再由独立CPU two-pass/strict-ABR链完成；两条输出均为SDR BT.709 limited、`yuv420p`、无DOVI且三点可解码；
- D10的Profile 5/无兼容Base Layer fixture使GPU与CPU均产生`dolby_vision_base_layer_unsupported`，随后External无可用结果，Run Frozen且0 Package/0 Offer；
- 所有成功Package均核验single Structure、Identity、Metadata、Media-Cast、NFO/poster、Off-load Context、Related disposition和Delivery Attestation；
- 所有验证保持Handoff B Offer未消费、Arca Entry/Fact为0、隔离源Reality不变。

DV与源级Compatibility矩阵已经达到`LIBRA SOURCE-COMPATIBILITY FALLBACK AND DV NORMALIZATION VERIFIED`。MoviePilot External Landing也已完成产品接线：最终文件只通过Transfer History的`download_hash → dest`解析，旧下载历史`path`不参与；Landing与Workspace必须独立，Import流式复制并保留源文件。确定性External E2E、planned restart/lost wake及P14完整场景回归均通过。

真实L07 External Integration资格已经闭合。最终测试采用MoviePilot中已经完成的`The Wild Robot (2024)`精确任务与`download_hash`，脚本硬阻止`/api/v1/download/add`，因此`moviePilotDownloadAddCount=0`，没有重复下载。产品链通过Transfer History得到最终`dest`，planned restart后完成Resolve、Stability、Verify、Workspace Import、Package和open Offer。

证据根为`C:\Users\markm\AppData\Local\Temp\helix-real-libra-handoff-b-HmA51h`：总耗时607.681秒；Landing与Workspace副本均为21,756,642,178 bytes，SHA-256均为`fd725e36bc8f5fb5503cddba241d146353aba5a8b06e2b50c7f0c35dbe347468`且inode不同；真实Probe为HEVC 4K + TrueHD并满足50 GiB Acceptance上限。Request、Acquisition Observation、Stability、Import、Package及Offer均无重复，`failedWorks=0`、`failedEvents=0`、Offer未消费、Arca Entry为0、数据库`integrity_check=ok`。据此当前状态为`LIBRA HANDOFF B READY / AWAITING ARCA ACCEPTANCE`。

## 10. 封口条件

封口需同时满足：

1. 38个逻辑场景均有可重现证据；
2. 所有成功场景都产生自包含的Package与open Handoff B Offer；
3. 所有失败/等待/frozen场景都不伪造Package或Offer；
4. Planner、Coordinator、Event Runtime与Resource Governor职责边界符合SSOT；
5. 真实媒体效果全部发生在隔离Workspace；
6. 重启、重放和崩溃注入不生成重复外部请求、输出、Fact、Package或Offer；
7. Material Field和Shelf Target的Reality在Handoff B Ready前后逐项一致；
8. Handoff B Offer未被消费，Libra/Arca责任边界没有被测试捷径跨越。

## 11. 封口决定

上述八项条件均已满足。2026-08-14用户接受本节点封口，正式状态为：

```text
MOVIE LIBRA CLOSED AT HANDOFF B READY
```

封口出口是自包含On-deck Product Package与open、未消费的Handoff B Offer。Handoff B Accepted、Arca Acceptance、Arca On-deck、Shelf Entry、Deck Fact及Libra Workspace Off-load回收属于后续节点，不得被本封口状态提前宣称完成。
