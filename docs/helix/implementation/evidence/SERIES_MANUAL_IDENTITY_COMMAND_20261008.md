# Series 人工身份选择命令

2026-10-08；当前 Series Phase 节点1/4，基于`5a6138a30`。用户本轮明确确认：扩展人工身份选择为TMDB Series ID＋当前Run冻结Season，不允许改季或扩集，仍只形成选择意图。

## 实现与合同

SSOT §8.5.4明确Movie/Series互斥输入、namespace、冻结Season与execution basis约束以及精确Provider复验；更新source-map与transaction contract，表结构未变，无历史Run兼容迁移。

Libra命令接受tmdbSeriesId，从正式MovieProductionReader读取同Run冻结Candidate Season Claim，经既有frozenSeriesSeasonNumber验证。持久化事务核对真实Subject Profile和Run basis；Season/basis进入请求摘要与不可变Intent关联，namespace为tmdb_series。Season与Episode范围不能来自用户输入。Movie仍接受tmdbMovieId；混合字段、跨Profile、过期Run或basis、改季/扩集、其他额外字段拒绝。

GET预览从完整query传递互斥ID，只读调用现有Provider观察，要求候选为同Series namespace和冻结Season；写命令仍只发布Intent/Receipt，不发布Identity。Planner投影检查手工Intent namespace与Run Profile一致，继续通过provider_exact真实验证TV与Season。

## 证据

- 3文件49项通过：真实SQLite命令/幂等/零Identity写入、冻结Season/basis与跨类型拒绝、Movie回归、Series正式Planner/Provider/原生Identity事务、P2聚合摘要验证。
- 新增Series手工Intent投影经正式Provider Adapter查询`/tv/1399/season/1`，不走TV搜索；错误Movie namespace明确拒绝。
- 普通2集Direct/Remux隔离Host正式观察至Arca Commit通过，35.9秒。该Host不是人工选择端到端，不能替代待补的人工选择Host/browser验证。
- P2合同、包边界（458文件1451依赖）、语义（2077文件）检查通过。
- 日志：仓库外`E:/my_project/helix-git-consolidation-20261008/series-manual-identity-{tests-v2,host,p2}.log`。首次baseline断言误用了source-map摘要而非P2聚合摘要，已按当前完整合同结果修正，49项复验通过。

## 继续

前端尚未接Series人工选择，下一段补预览中明确Season、候选选择和真实Host/UI验证；本批不宣称界面可用或首版可部署。用户另行要求暂保留的EpisodeDelivery Requirement摘要缺口不变。未重跑完整架构、Linux/Docker或生产升级回退，未操作NAS。
