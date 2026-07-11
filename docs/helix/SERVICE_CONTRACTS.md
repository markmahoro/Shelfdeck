# ShelfDeck Business Service Contracts

Status: direction accepted; payload schemas intentionally incomplete.

Last updated: 2026-07-12

本文只固化已确认的Owner、调用方向和交付物类别。精确Schema属于下一轮Design，不得在
实现中自行补齐。

## 1. Pre-deck

```text
Libra
├─ calls Nexora for triage, observation and binding
└─ calls Kairox for maintenance against an immutable acceptance snapshot
```

- Nexora返回Triage Result与SourceBinding projection。
- Libra建立Maintenance Scope并向Kairox发放Subject admission。
- Kairox返回versioned maintenance attestation和Pre-deck media description。
- Libra组装`OnDeckPackage`提交Deck；Schema尚未确认。

Nexora与Kairox不得互调或写对方Store。Kairox的`TriageMismatch`只唤醒Libra。

## 2. On-deck

```text
Libra -> Deck: OnDeckPackage
Deck -> Libra: accepted | rejected（详细协议待定）
```

只有Deck可以创建active `deckId`。Libra和Kairox不得将`maintenanceComplete`投影成拥有。

## 3. Post-deck

```text
Deck -> Aftercare: health incident / repair request
Aftercare -> Deck: Repair Package
Deck: revalidates and publishes current accepted state
```

Aftercare不调用Libra、Nexora或Kairox。Deck Health也不通过Nexora执行。

## 4. User Perception

消费者通过只读batch query提交当前identity context。返回仅`found|not_found`及匹配的
不可变projection。User Perception不发送流程中断通知，也不写消费者Fact。

## 5. People Management

People Management公开Person Registry查询、注册、候选和合并服务。Kairox/Aftercare可
读取Person与Reference Face，但Media-Cast Relation由各自媒体维护流程判断。

Deck向People Management提供当前已验收人物关系projection；People据此维护反向索引，
不得回写Deck关系。Person注册不自动建立Media-Cast Relation。

## 6. Off-deck

Off-deck Management仅消费Deck事实和自身Policy。完成交付物是全部Inventory销毁证据及
deckId退役Receipt。不存在retain/detach Service合同。

## 7. Universal prohibitions

- HTTP adapter不得直接写业务域Store。
- 一个域不得写另一个域的Canonical Fact。
- signal可丢失时必须有durable事实和周期恢复。
- 跨数据库不假设原子事务。
- 不得因修Bug、性能或测试需要越过Owner边界。
- 未确认的handoff schema不得通过实现先行成为事实标准。
