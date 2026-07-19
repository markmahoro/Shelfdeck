# P8-07 Receipt Publication and Procurement Boundary Evidence

Status: PASS

## Boundary result

- Libra accepted/rejected终态各发布一份typed durable Outbox，唯一consumer为Procurement，dedup分别绑定Offer。
- Procurement只消费`LibraCandidateAcceptedMessage@1`或`LibraCandidateRejectedMessage@1`，只写
  `proc_candidate_deliveries`、`proc_run_materials`及Foundation `fx_inbox`；不读取Libra Subject/Receipt Store。
- Accepted只将全部exact Candidate Reservation改为`transferred+handoff_accepted`，不再次转移Control；Rejected只改为
  `released+handoff_rejected`，不释放或改写仍由Procurement持有的Control。
- terminal Owner rows与Inbox digest可重建同一closure；重复、相反终态、Envelope/digest漂移均fail closed。

## Machine evidence

- accepted consumer：exact Reservation set、Delivery CAS、Inbox dedup、terminal replay、Inbox crash全事务rollback PASS。
- rejected consumer：exact Reservation set、Delivery CAS、Inbox dedup、terminal replay、Inbox crash全事务rollback PASS。
- Handoff A accepted/rejected producer tests验证Outbox payload/schema/digest与零跨Store读取。
- Full Architecture gate：96 fixture files PASS，`findings=[]`、`prohibitedActionsRun=[]`。

## Prohibited actions

未运行E2E、Docker、Canary、production、Service/socket或真实媒体副作用；未触碰`media-desktop`；未建立可靠Signal假设、
兼容路径或旧Runtime fallback。
