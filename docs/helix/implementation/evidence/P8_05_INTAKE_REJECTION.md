# P8-05 Intake Decision and Rejection Evidence

Status: PASS

Date: 2026-07-19

## Architecture closure

- Architecture Agent的`PBF-11-R2`及最终CAS修正提交`f99428ce7ebda669c027240b58a9da7ac116e2aa`经只读复审PASS，
  本分支以提交`bc48fdfb`原样纳入；实现线程未编辑SSOT。
- Machine baseline固定为112 Capability、97 Result family、169 table、35 canonical transaction、96 domain input type；
  aggregate digest为`5280bc3a5271c7f0605892c616927fe47615240f6e2e3acb55ef4c62c4d41463`。

## Implementation evidence

- Rejected Decision只使用closed reason与typed Evidence，按SSOT precedence形成完整Structured Rejection、Receipt和digest链。
- Libra原子提交Decision、relationized reason rows、Receipt、typed Result、commit marker和Rejected Outbox；不创建Subject、
  Binding或Control revision，Outbox崩溃反例证明零部分提交。
- Procurement消费Rejected projection时只写Owner Delivery/Reservation与Foundation Inbox；精确执行
  `open → rejected`、`candidate_delivery → released+handoff_rejected`CAS，Material Control不变且重放从terminal rows重建。
- 同一架构修正新增的Accepted consume机器合同已同步物化，并用isolated fixture证明
  `open → accepted`、全部Reservation `transferred+handoff_accepted`、Inbox同事务全有或全无；它不替代P8-06的Libra accepted
  Transfer Point实现。
- 无Procurement Store旁读、跨Owner写入、compatibility、dual path或旧Runtime fallback。

## Verification

- P8 focused：8/8 PASS。
- Full Architecture：621/621 PASS；94 fixture files。
- Dependency：47 packages、99 files、148 dependencies，`findings=[]`。
- Semantic：1555 files，`findings=[]`。
- `prohibitedActionsRun=[]`。

未运行E2E、Docker、Canary、生产、Service startup、socket或真实媒体副作用；未触碰`media-desktop`。
