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
