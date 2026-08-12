# Libra Run → Handoff B Ready 验收场景基线

Status: `CONFIRMED SCENARIO BASELINE / IMPLEMENTATION NOT STARTED`

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
+ 8条Metadata/Artifact/Media-Cast/Related断言
+ 8条Run生命周期场景
+ 8条Workspace/Effect/恢复场景
= 35个逻辑场景
~~~

通过复用Primary样本、变更Rating/Policy和使用故障注入，预计只需12–15份物理电影样本。

封口需同时满足：

1. 35个逻辑场景均有可重现证据；
2. 所有成功场景都产生自包含的Package与open Handoff B Offer；
3. 所有失败/等待/frozen场景都不伪造Package或Offer；
4. Planner、Coordinator、Event Runtime与Resource Governor职责边界符合SSOT；
5. 真实媒体效果全部发生在隔离Workspace；
6. 重启、重放和崩溃注入不生成重复外部请求、输出、Fact、Package或Offer；
7. Material Field和Shelf Target的Reality在Handoff B Ready前后逐项一致；
8. Handoff B Offer未被消费，Libra/Arca责任边界没有被测试捷径跨越。
