# Series 同 Subject 分批连续性验证

日期：2026-10-08。Phase节点1/3的本地开发增量；不是Series发布、UI验收或生产部署结论。

## 合同与实现

依据SSOT §3.4.2–3.4.5、§6.2.5、§8.6.19。Procurement从冻结路径的显式`{tmdb-series-N}`与positive Season形成weak exact Continuity Claim；同Candidate每个成员必须一致声明。缺失、冲突、错误namespace、异常数字或未闭合marker不形成claim。普通标题仍不获得跨Candidate连续性；NFO claim读取未接通。

Libra沿不可变Candidate Claim执行正式`provider_exact`查证，Series专属`candidate_season_claim`保留Source Association digest，仍验证TV、Season、Alias及年份。不是直接把路径标签写成正式身份。Movie Intent形状不变，派生schema/registry与SSOT source map同步。

Spec按未交付Candidate形成本批Episode Scope。已交付材料的排除依据Libra自己的Accepted Delivery Receipt与冻结Run Manifest，不猜当前Control归属，不改历史Binding。Run Creator、Admission事务及Freshness只核验本批Spec覆盖的绑定与claims，保留精确Control/Binding/evidence及事务CAS。多个输入part仍以完整Episode claims进入原有Manifest校验。

实际隔离Host场景：显式标记的E01/E02首批上架，再观察E03。保持一个Season Subject、两个独立Run、一个Season Shelf Entry；E03新Run只覆盖E003，旧Run保持E001/E002，旧Run行及旧文件/Inventory历史保持。继承Season扩充fixture的Reservation/head漂移拒绝、写入后故障回滚及Owner事务participant重放检查。普通无claim输入仍使用两个Subject，Arca按正式身份扩充同一Season。

## 验证

- 同Subject实际Host专项通过（93.6秒）；Provider/Probe/Playback为隔离Adapter，文件是fixture字节，未冒充真实FFmpeg媒体验收。
- Run Admission相关12项通过；生命周期及Series身份62项通过；扩展身份专项32项通过，含显式claim精确查询、不搜索、错误标题不resolve、stale claim拒绝。这些集合有重叠，不累计计数。
- 除Series Host文件外的全架构回归2048项：2036通过、9项既有skip、3项检查失败。两项来自新增SSOT说明后Result registry派生摘要未同步，一项是旧Triage文本检查误判注释中的Provider。同步registry并将检查改为纯模型依赖白名单后，三个文件共15项全部通过；额外范围/P2/Creator复验6项通过。
- 2/24集、无claim补集与显式claim补集完整Host文件最终19项全部通过（267.7秒），其中同Subject补集94.0秒；明确断言首批provider_exact且无provider_search，两批Run范围分别为E001/E002与E003。完整架构共256个测试文件均已执行，失败的三个检查文件已修复专项复验；没有把首次全量结果写成全绿。最终纯模型5项复验通过。
- P2、架构边界、语义检查通过。P2 aggregate为`111dacfb4993599e1d93b48b26eb302a2f352bb68bc35708f6792862bf02a821`，DDL未变化。

日志在工作区外`E:/my_project/helix-git-consolidation-20261008/series-continuity-*.txt`及相关json。未修改NAS或用户保留的诊断文档。

## 后续与限制

同Subject顺序追加已验证；多个同时active的非重叠Run仍需贯通按各自冻结范围计算当前Spec/Freshness，不能用Subject的最新Spec替换另一Run。接下来补并发、重复/重叠、恢复的实际Host证据。逐成员加工、N:M最终空间证据、完整运营/Projection、真实媒体/Linux、用户路径及精确版本UI负责人验收仍未完成。不得以本切片关闭完整Phase或宣称可部署。
