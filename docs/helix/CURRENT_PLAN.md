# ShelfDeck Architecture Current Plan

Status: Design only; implementation, E2E and production deployment paused.

Last updated: 2026-07-12

## Objective

在不继续固化旧Helix假设的前提下，完成ShelfDeck业务域重构设计。当前只允许文档审计、
现状盘点和明示的Design工作，不允许按旧计划继续写Runtime、重启四库E2E或部署生产。

## Confirmed baseline

- ShelfDeck是Deck最终owner；active deckId表达拥有。
- Libra只负责Pre-deck，上辖Nexora和Kairox。
- Deck、Aftercare、User Perception和People Management是平级一级业务域。
- Deck owns Acceptance Policy、Health、Inventory与Off-deck。
- Aftercare独立处理Post-deck修复，不调用Nexora/Kairox。
- People Management拥有Person Registry，不拥有Media-Cast Relation。
- User Perception使用immutable perceptionId记录和pull-only解析。
- Company/Department Capability边界不可变，允许复制换取低耦合。

## Next design session

1. OnDeckPackage与Deck Acceptance协议。
2. SourceBinding到Inventory Representation的交接。
3. deckId、Movie/Season/Series和多版本唯一性模型。
4. Deck Acceptance Policy Schema及Policy变更后的Aftercare行为。
5. Deck Health与Aftercare Case/Repair Package。
6. Person注册、Cast Relation交付与Person merge引用规则。
7. Off-deck authorization和失败/不可达状态。
8. 新顶层架构正式命名。

## After design acceptance

只有上述合同经用户确认后，才重新制定数据模型clean cut、Admin Web调整、Capability scope
审计、业务能力守恒矩阵及新的自动测试/真实来源E2E/生产恢复计划。

## Prohibitions

- 不把未决项按工程便利自行定死。
- 不把旧Membership解释成Deck ownership。
- 不让Kairox继续拥有Library Policy、长期媒体维护或People Registry。
- 不恢复生产ShelfDeck容器。
- 不修改`media-desktop`。
