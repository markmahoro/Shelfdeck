# Series Direct N:M 空间 Basis

2026-10-08；CURRENT_PHASE逐成员生产工作项，基于`5791bb29a`。这是首版开发增量，未关闭Phase，未部署NAS。

## 合同与根因

Direct验证原先把物理文件大小直接比较每集上限，故对bounded N:M使用显式入口保护。本批用完整typed输入替代该保护：Libra Owner从同一冻结Run的全部Primary及持久Probe形成`seriesSpaceBasis`，绑定Run execution digest、每个member/Handle/Probe digest、实际字节及完整Episode范围。Candidate identity仍按immutable Plan定义；inputDigest覆盖完整Basis，Verification identity条件追加Basis digest。

Capability用BigInt有理数对完整集合均分、累加，只返回当前成员涉及集的精确份额；`actualSizeBytes`仍表示文件字节。Series Direct缺Basis、wrong Run、Handle/Probe/大小不符、重复物理Handle、scope缺失、乱序或额外字段均不形成passed。Direct Reader重建完整输入和逐集Evidence，禁止借用其他part的结果。Movie输入/ID保持原形；64 KiB input、16 KiB Result、32 Primary及每成员32 Episode上限不放宽。Conformance和Arca仍各自重算最终Product，候选Evidence不替代最终接纳。

实际两part Host又发现Procurement在`mergeSeriesUnits`把不同物理成员的Episode重叠一律拒绝为`structure_ambiguous`。这与SSOT §3.2.6/§3.4.2的同Candidate N:M及Libra生产责任冲突。修正为保留完整成员Claim Set；同一物理成员仍唯一、后续Candidate零重叠Intake保持。未增加文件名part猜测或额外Owner规则，未让Triage替Libra决定可生产/可上架。旧单测的错误拒绝Oracle已改为验证无损N:M集合。

## 验证

- 共享文件实际隔离Host：24字节物理Primary覆盖E001/E002，每集上限12；正式Spec、Direct Verification、Selection、Package、Conformance、Handoff B、Arca Space Check、落位/源结算、唯一Season Entry均通过，35.1秒。只有一次物理Probe/Primary交付，持久最终Evidence为每集`12/1`。
- 普通两集各24字节、上限24的Host通过，35.3秒；与共享样本共2项70.95秒。
- 两part样本最初100.8秒失败，无Subject/Run，持久Triage结果为`structure_ambiguous`。根因修复后完整Host通过，35.8秒；一集两个各24字节Primary，上限48，均保留到正式Inventory，最终份额`48/1`，逐集NFO唯一。
- 最终24集完整Host回归通过，52.3秒；新增逐成员空间Evidence未突破Package/Provenance容量。
- Movie真实媒体隔离Host：Handoff B、Arca Commit及后续维护/历史保护，1项通过、无skip，159.8秒。使用保护fixture的测试副本，没有生产或原媒体修改。
- 新专项覆盖9/2+3=15/2在7/8字节边界，跨Run/缺失/重写/重复/乱序Basis、Source Probe变化、其他part改变导致Verification identity改变、Reader拒绝伪造份额、schema闭包及字节/数量边界。2/24/32成员源/Direct集合最终61项通过。
- 全架构回归（除Series Host）：2,083项，2,073通过、9既有skip、1固定P2摘要预期陈旧。更新摘要后相关3文件76项通过。Triage根因修复后另跑全部P7及相关Intake/连续性、Source/Space/P2共256项，全部通过。没有把skip计为验收。
- P2无findings，aggregate `2cc30cccd12e0d4acf88305d61977974b7e99b545ef54282749dd0575b7c2ed5`；DDL未改变。Domain boundary及forbidden semantics检查均通过。

日志位于工作区外`E:/my_project/helix-git-consolidation-20261008/series-basis-*`。Host的Series Probe/Provider/Playback仍是隔离替身，不能视为真实Series FFmpeg验收。

## 继续项

Direct N:M已能经正式链路交付，不代表需要加工的N:M或混合成品已实现。Coordinator在任一Series Direct不合格时仍有旧单Selection假设；必须继续逐成员Remux/Transcode、混合成品及基于最终集合的空间预算，不能退化成选择首个文件。跨批Fact读者、Related/Aftercare/退出、恢复、UI负责人具体版本验收、真实Series媒体/Linux、历史迁移测试及冻结版本升级/回退仍是首个可部署版本门槛。未执行Formation Reset，无UI交付或生产动作。
