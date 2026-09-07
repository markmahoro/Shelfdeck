# PROD-065：生产停滞影片现状与恢复建议

采样时间：2026-09-07 15:28–15:38 CST。只读检查生产 SQLite、容器日志及精确关联媒体目录；未部署、重启、重试、Reset 或修改媒体。此文为证据和建议，不是新的活动计划或生产操作授权。

**16:06追加更正：** 下文007的主音轨疑点已被[11项深度审计](PROD-065_ELEVEN_FORMATIONS_DEEP_AUDIT_20260907.md)关闭：同一历史Input digest在现有生产代码纯函数复算为PASS，属于已修复算法留下的旧冻结结果。寒战2使用生产凭据和代理的exact identity GET已返回200。下文网络和音轨部分保留为首次采样判断，以后续深度审计为准。

## 1. 生产与修复的关系

- 当前镜像仍为 `markmahoro/shelfdeck:helix-beta-20260903-f05d694dfa`，容器自 09-03 12:29:30 UTC 运行。
- 本轮修复提交 `8ec6be753` 仅在本地，不能将当前生产停滞解释为修复上线后再次失败。
- Formation projection 共 57 条：38 completed、17 in_progress、2 attention_required。
- 17 in_progress 实际包括 8 个 Arca Settlement 停滞、8 个等待重新入库的旧 Subject、1 个正常转码。
- 8 个 Arca 停滞均已 Handoff B 接管、On-deck Run 为 offloading，未完成 Commit；当前计划内最终文件均存在，非 NFO 成员的 bounded fingerprint 与预期一致。此检查不代替完整播放检测及最终 NFO accepted Facts 验证。

## 2. 当前停滞清单

时长为执行 Event started_at 到首次采样的近似值，不采用反复刷新的 UI 更新时间。

| 影片 | 停滞时长 | 当前阻断与实际文件 |
| --- | --- | --- |
| 绣春刀 (2014) | 78.3 小时 | Settlement 0003；旧 NFO 6915→6898 bytes，hash 不同；旧正片、旧字幕路径已不存在，最终文件存在 |
| 静水城 (2021) | 78.2 小时 | Settlement 0003；旧 NFO 10871→9756 bytes，hash 不同；旧正片路径已不存在，最终文件存在 |
| 恋恋笔记本 (2004) | 0.6 小时 | Settlement 0009；旧 NFO 14571→13035 bytes，hash 不同；旧正片路径已不存在，最终文件存在 |
| 图雅的婚事 (2006) | 0.5 小时 | Settlement 0004；旧 NFO 5309→4874 bytes，hash 不同；旧正片、旧字幕路径已不存在，最终文件存在 |
| 霍比特人1：意外之旅 — Extended Edition (2012) | 73.6 小时 | 5 个 Settlement Event；旧目录存在未计划 torrent；原 NFO 16725 bytes 且 hash 与冻结值匹配；原输入和最终副本均存在 |
| 哪啊哪啊神去村 (2014) | 53.3 小时 | 7 个 Settlement Event；旧目录存在未计划 torrent、额外字幕、sample；原 NFO 8663 bytes 且 hash 匹配；原输入和最终副本均存在 |
| 夺宝奇兵5：命运转盘 (2023)，2160p CMRG | 14.7 小时 | 3 个 Settlement Event；旧目录还有另一份 1080p WiKi 正片、NFO、字幕和公共图片；原 2160p NFO 15856 bytes 且 hash 匹配；原输入和最终副本均存在 |
| Top Gun — Maverick — IMAX (2022) | 0.6 小时 | 5 个 Settlement Event；旧目录存在 torrent 和 10 张不同命名前缀的图片；原 NFO 29564 bytes 且 hash 匹配；原输入和最终副本均存在 |
| 寒战2 (2016) | 自 09-04 冻结 | related NFO 身份观察成功，Provider exact 三次 `PLATFORM_INTEGRATION_NETWORK_FAILED`，没有 Package；原正片存在、仍由 Libra 控制 |
| 007：大破天幕杀机 (2012) | 自 09-03 冻结 | direct_input 未满足 minimum_raster 与 primary_audio；补购后达到 4K，仍 `primary_audio_unmet`，最终 `no_passed_candidate`；不是 NFO 失败 |

007 的原输入 Probe 实际为 AAC；补购文件主音轨为英语 DTS core，归类 other；另有国语 TrueHD 和 AC3 音轨。当前系统的主音轨验收未因存在次要 TrueHD 音轨而通过。需要核对主音轨选择与 Shelf 要求，不能仅凭文件名或“任意音轨有 TrueHD”判成功，也不能未经确认放松媒体标准。

寒战2 历史错误没有保留底层 DNS/TLS/代理原因，本次不能断言具体网络根因。近 24 小时相同 identity observation Capability 有 15 次成功，无失败 Attempt，说明不能将历史冻结概括为当前全局 Provider 不可用；这也不证明该片 exact 请求已恢复。

## 3. 等待重新入库与正常工作

以下 8 条均为 discarded Run、没有当前执行 Run，原 Primary Material Control 已 released；不会通过继续等待自动复活。

| 影片 | 当前物理状态 |
| --- | --- |
| 怦然心动 (2010) | 旧光盘路径不存在；已在 `/media/Film/怦然心动 (2010) - 1080p Remux DTS` 找到 MKV、NFO 和图片 |
| 银翼杀手：2022黑暗浩劫 (2017) | 旧带规格正片路径不存在；原影片目录存在规范名称 MKV、NFO |
| 猎头游戏 (2011) | 同上，规范名称 MKV、NFO及字幕/图片仍在 |
| 有话好好说 (1997) | 旧带规格 MP4 路径不存在；规范名称 MP4、NFO、字幕仍在 |
| 2001太空漫游 (1968) | 旧带规格正片路径不存在；规范名称 MKV、NFO、字幕仍在 |
| 网络谜踪 (2018) | 旧带规格正片路径不存在；规范名称 MKV、NFO、字幕仍在 |
| 巴尔干边界 (2019) | 原 BDMV Primary 成员存在，控制权已释放 |
| 光荣岁月 (2006) | 原 BDMV Primary 成员存在，控制权已释放 |

未找到这些片名对应的 completed Formation projection；不能把规范名称文件的存在等同于 Shelf Entry 已成立。需通过当前 Field 观察和正式 Procurement 入库流程重新建立事实关联，不能复用失效路径。

《哥斯拉大战金刚 (2021)》为正常 GPU 转码：两次采样进度由 21.5% 增至 23.6%，采样时间持续更新；无需恢复或 Reset。

## 4. 其他问题点与合同判断

1. **未计划目录成员与 NFO 是两个不同问题。** 四部异目录影片均有 `CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER` 日志及对应现场文件。SSOT 6.5.3 明确要求旧目录 closed-world 检查，未知成员应进入 attention_required。保护这些文件符合现有合同；将它们作为普通垃圾自动删除不符合合同。缺陷是旧版执行层没有将拒绝收敛为可处理终态，以及直到复制完成才暴露问题，造成无效复制与空间占用。
2. **无限恢复仍在生产发生。** 八部的 destructive Effect 均为 reconcile_required，Event 仍 executing。当前容器日志快照包含 108201 条 `P4_EXECUTION_TIMEOUT`；这是日志出现次数，不是独立业务重试次数。PROD-065 的 typed failure 和预算终态修复尚未上线。
3. **UI 混合了真正工作与无执行的等待。** 8 条 discarded Subject 仍归 in_progress。旧路径已经失效的条目不应给用户“仍在后台整理”的印象，需单独呈现下一步可执行动作和当前材料状态。
4. **媒体采购候选与最终音轨验收可能不一致。** 007 已花时间补购 27.5 GB 文件，最后因主音轨不满足被拒。应审计广告声明、实际 Probe、主音轨选择和正式验收之间的差异；当前证据不足以判定具体哪一层有 bug。
5. **网络失败缺少可诊断原因。** 寒战2 只能看到通用错误和冻结；应保留脱敏的底层错误类型/阶段以区别连接、TLS、DNS与超时，不应改变身份验收标准。

## 5. 推荐推进方式

不修改数据库成功标记、不覆盖历史 hash、不补造旧 Package 的 NFO witness，也不手动删除旧文件来让流程误以为已经完成。工程维护可以用于安全退场和重新建立流程，最终成功必须仍由正式验收与 Arca Commit 产生。

1. 先完成本轮修复的 Docker/Linux 验证，再按发布流程上线；以新建 NFO 改写样本证明能完成全链。新版本上线只解决代码行为，不自动补齐旧业务证据。
2. **四部 NFO 已改写影片**：它们的原 MetadataObservation 均没有 sourceNfoSemantics，无法证明改写前后的连续性。推荐在当前迭代规则下退场旧未完成 Formation，核对并保留现有最终媒体及关联文件，以当前实际文件重新观察、重新入库。旧正片名称已经消失，因此必须以现有实际位置建立重建清单；不能承诺绝不重跑生产步骤。
3. **四部未知成员影片**：原 NFO 目前仍与冻结 bytes/hash 匹配；无需因为缺少新 witness 自动判定必须重建。先逐项确定未纳管文件归属及保留位置，尤其保留《夺宝奇兵5》的另一版本。经明确授权落实目录处置后，待旧执行状态依法收敛，再由既有 Arca attention retry 路径复验、清理、Commit。后续若出现新的 NFO 漂移且缺证据，再转入上一类；不保证重试必然成功。
4. **两部 frozen 影片**：寒战2 先补齐网络诊断并验证 exact 请求；007 先核对主音轨与采购要求。再通过既有放弃/重新采购流程建立新 Run，不强解冻历史失败。
5. **八部等待重新入库**：使用当前 Field 观察定位现存媒体，走正式重新入库；不复用旧 binding，也不直接伪造 Shelf Entry。

现有 Formation Reset 只读 inspectPlan 返回 ready=true，但范围为 **13 个 Subject / 12 个 Workspace / 8 个 Package / 206 个 Work**，包含正常转码的《哥斯拉大战金刚》，不是逐片重试。工具会清除该范围 Workspace 和未完成业务图。ready=true 只代表现有结构性检查通过，不证明部分落地媒体已经准备好重建。因此当前不建议全量执行；应先完成可审计的精确退场范围、当前文件清单及保护正常工作的验证，或在所有正常工作结束后另行评估全量范围。

本次未执行上述任何生产推进动作。原始运行数据与日志仅保存在工作站临时目录，未加入仓库。
