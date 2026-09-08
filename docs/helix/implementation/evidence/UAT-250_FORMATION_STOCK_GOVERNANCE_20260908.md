# UAT-250：媒体整理区存量治理

2026-09-08 14:44北京时间，只读API分页及生产SQLite汇总核对；不执行Reset、DB修改或文件操作。

## 范围与事实

- Libra当前3项：林肯律师(2011)正在转码，采样19.9%；黑寡妇(2021)等待处理资源；活着(1994)frozen，libra.external_material.search@1失败码P5_PROVIDER_RESPONSE_INVALID。前两项保留，冻结条目先查Provider响应失败根因，再决定是否需要有界Reset；不能以重置保证下次成功。
- 上架历史53项；Aftercare可见55项（resolved44、unresolved11），数据库另有invalidated3项未出现在工作列表。当前active/queued Case为0，Arca非终态Work汇总为0；Libra有2条running workspace_media_production Work。
- 11条unresolved属于8部电影，当前收藏Query均healthy；健康是当前已存检查结果，不代表本次重新Probe。治理方式是历史终态与当前问题分离，不伪造Case成功。

| Case ID | 电影 | 历史终结原因 |
| --- | --- | --- |
| arca-care-7a7e5123b1f7a834e5b44d613dbe22e0c8421232 | 霍比特人1：意外之旅 | settlement_or_commit_failed |
| arca-care-ca38c6cd6e5e49a507e00de45a3eb9c3eefc0dd9 | Searching | settlement_or_commit_failed |
| arca-care-da387c0206068acbd992664afae662f7cf794728 | 猎头游戏 | repair_commit_exhausted |
| arca-care-ce41a1367c18f9297399552943bd471b7141c09d | Searching | repair_commit_exhausted |
| arca-care-57ac27afdeb1599b0e20e2394bb06d717797c0ab | Searching | settlement_or_commit_failed |
| arca-care-8c7504f112c7cee9ae204b163388553da1169a21 | 最后的前线 | settlement_or_commit_failed |
| arca-care-4efdb7242791ddd8b8e7115b01c30c68f710cc89 | 2001太空漫游 | repair_commit_exhausted |
| arca-care-c39831826646b12cdfc3931c3a60952b1fac7bcf | 长空之王 | repair_commit_exhausted |
| arca-care-e7e4ddd7fc739177b74fa6cbf67409f4a0faa5e5 | 银翼杀手：2022黑暗浩劫 | repair_commit_exhausted |
| arca-care-1b3f9c8d370b6d8b1acdcd0f3e7be6cc745c53ca | 百元之恋 | reassessment_exhausted |
| arca-care-f57dc43d61df214a229769993bbf4fa02b52f439 | Searching | external_writer_conflict |

## 治理方案与关闭条件

1. 随UAT-212把11条历史失败归入已结束，保留失败原因/过程；不能继续进入当前需要处理统计。44条成功维护与53条上架记录保留历史，配合分页；3条从未准入invalidated记录保持不可见，不为整洁删除事实。
2. 两项正常生产保留；活着的冻结故障独立核查，不自动放弃/Reset，不触碰已上架Entry和源文件。若证明需要Reset，先修复新链也会复现的缺陷、冻结精确闭包、备份与副本演练，再取得该次处置授权。
3. 发布前刷新快照，逐条核对Case/Run/Work/Receipt/Control及当前收藏状态；本次无证据证明需要全局清库或执行残留删除。
4. 现场验收当前需要处理只包含真实待决事项，历史数量与失败事实保留、正常处理连续推进、收藏不减少、范围外数据不变。UAT-250只处理存量，UAT-212负责防止再次错误展示；不把API53条上架历史和59部当前收藏差值直接视作孤儿。


## 活着：只读冻结查询重放与响应预算根因（17:14）

使用17:04一致性数据库副本恢复原AcquisitionQuery，queryDigest=c10703421c7777f2484a696f8378a9c708e5df2c8545e78bdeb76bbb4e49fd53；只调用MoviePilot GET search/title，无下载提交、无生产Run/Case/数据写入。外部结果是当前响应，不能声称恢复了当时已丢失的原始HTTP字节。

当前同一查询返回118行、268431原始字节。25候选规范化结果34829字节正常；100候选规范化结果138631字节，statusCode=200、responseBytesMatch=true、responseDigestMatches=true，唯一失败项为maxResponseBytes=65536。原错误不是无资源，也不是认证或HTTP失败；协议预算与扩展后的完整候选Evidence发生冲突，当前重放精确复现。

实施边界：只把Search响应与AcquisitionCandidates完整Evidence的字节上限同步到256 KiB，保留100项、全部字段/摘要、排序/选择规则及其他operation上限。超过新上限仍明确报技术错误，不截成25项、不把超限当寻源耗尽。补无敏感内容的status/字节/摘要比较诊断；旧冻结Run不自动重置或改写，后续重新处理入口依UAT-251合同。

验证：修复后同一只读查询100候选/138631字节成功；31项针对性测试通过，220文件架构fixture及依赖/语义/manifest/contract全通过。另补真实超过256 KiB、摘要与字节均正确的100候选回归，验证仍明确拒绝；P5协议12项通过。候选第100项仍可成为最优选择，没有截断到25项。SSOT source map先生成、Result registry后生成，基线摘要更新为9ff046077fde5fb9d04df97c3884cf7ad91055cdb1467a42772c9cca6ebf5554；未修改合同总数。生产旧Run恢复与治理验收仍未完成，不能关闭UAT-250。


17:38–17:43刷新：生产GET健康/整理/收藏/维护/回收站均200，active Formation为3项（1进行、2需处理），当前收藏62，维护44成功/11历史失败且无active/queued。真实Edge操作刷新整理页、打开沙丘过程、搜索并打开林肯律师收藏详情：林肯律师明确已上架、健康，主视频13.3 GB；旧整理页刷新后仍保留其88%旧转码行和完成行，属于UAT-212刷新列表一致性，不据此干预正常任务。黑寡妇约23%转码，继续保护。沙丘过程的失败代码为P5_PROVIDER_RESPONSE_INVALID，尚未对它自己的Query重放，不把同代码自动视作已证明同预算根因。
