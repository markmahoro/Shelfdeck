# Series Season 扩充实施证据

2026-10-08，活动Phase节点3的Arca增量，尚未关闭节点或达到部署资格。

## 当前实现

Series Canonical Content Key 使用 Shelf + TMDB Series + positive Season tuple，不包含Libra Subject/Run证据/显示标题；Movie保持既有键。Arca Stage精确读取当前Season Inventory，只允许同一Entry仍持有且identity/location/role/claims完全一致的共享次要材料保留控制权。不得把其他Entry材料、Primary重叠或仅同名文件当作可复用材料。

On-deck Commit合并历史Inventory成员与新集，保留旧文件及历史revision；以Entry当前Inventory/Deck revision比较更新，事务内重查旧Episode范围、Entry状态、Off-deck Reservation以及所有保留成员的Control。共享成员不转回On-deck Custody；新材料仍执行既定Control事务。active_guard是当前唯一性技术索引标记，旧revision内容保留，仅旧标记清零。

Arca库存Fact主键纳入source_package_id，保留不同Package同一fact_revision的原JSON/digest/provenance；不在Arca重写Libra生产Fact。SSOT表行、源映射、合同、DDL与原子schema升级一起更新。DDL digest为46893c3ce29b664d4eb5af009108756ec5ba19851b082f32e1af0d13157f3beb。升级仅重建accepted库存快照主键并原样复制内容，不翻译或恢复旧Formation运行。

## 已执行

- Windows隔离Host从E01/E02实际Commit后观察E03，再完成正式Commit。唯一Season Entry，最新Inventory覆盖E001/E002/E003，两批Metadata Fact及来源独立保留，旧文件字节、旧Inventory和Deck Fact历史保持。68秒通过，日志E:/my_project/helix-git-consolidation-20261008/series-append-host8.txt。
- 7个相关文件26项专项通过，涵盖Movie/Handoff/Claim/Control、Series identity、成员扩充及两类schema升级。后追加的共享Control负向/合并专项通过。P2通过。完整架构254文件执行2060项：2050通过、9项既有skip、1项仅因新schema的固定P2摘要仍为旧值失败；已核对合同后更新为442083dcef397f9f6071ee9256305c6e424d5fbe43606a73a9268e659e42e55b，该整个测试文件复验通过。依赖边界、语义、manifest、P2均通过；未把skip计为业务验收通过。日志series-append-architecture.json与series-append-p2-tests.txt位于上述工作区外证据目录。
- 测试最初以Inventory revision 2作为最新值，实际正常Aftercare可建立中间revision，已改按Entry当前指针校验完整集合，仍独立保护revision 1。

## 必须保留的未完成结论

此Host样本只有文件名Triage、没有exact Season continuity claim，因此按SSOT建立两个Subject，最终由Arca正式Provider identity归入同一Season Entry。自动Triage目前始终发布空continuity claim；同Subject的明确身份线索/追加路径仍需真实入口接线和单独验收，不能将本样本计为该能力完成。

本批还需原生Commit重放、并发/Reservation/失败回滚的负向验证，及消费者对多Package Fact的完整读取审查。Related变更NFO、共享文件后续修改、N:M最终空间、逐成员加工、UI/真实媒体/Linux/构建均未由本批证明。当前未部署生产，未宣称UI PASS。

## 提交历史与原生事务追加验证

2026-10-08：修复Commit重放调用与按Package读回执使用当前Entry head的问题，改为原Receipt冻结的Inventory/Deck revision；原custody/decision/Package摘要继续精确验证。双批Host完成后，两份原回执均可读，foreign custody和错误Package摘要均拒绝，没有改写当前Inventory。此为已完成Owner事实的历史查询，不是旧Formation兼容层。

同一实际Host第二次Owner事务内注入三类故障：active Off-deck Reservation、竞争Deck head、全部Domain/Control/Foundation写入后抛错。分别触发Reservation保护、stale revision保护和原子回滚。18张相关表（含Inventory/事实/关系/Entry/Deck/Control/revision/Result/Marker/Outbox/delivery）前后逐字节对照不变；正常执行后重放原Owner事务参与者，不增加记录，不改写提交快照。没有绕过正式材料落位、结算或领域事务。

最终专项Host通过（68秒）；5文件39项回归中38通过、1个既有Series Handoff fixture skip。日志series-extension-atomic-final.txt、series-history-regression-final.txt位于工作区外证据目录。该验证覆盖原Owner事务参与者重放及正式Capability历史回读，不声明用任意重建request直接调用Store.commit已完成所有幂等验证；多进程真实竞争、精确Claim的同Subject追加与跨批Fact消费者仍待后续验收。
