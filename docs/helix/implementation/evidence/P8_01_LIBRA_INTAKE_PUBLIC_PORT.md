# P8-01 Libra Intake Public Port

Status: PASS

## Contract decision

SSOT §8.4.2唯一明确当前Handoff A入口：

~~~text
LibraIntakeFacade.offerCandidate(ProcurementCandidateOfferAvailableMessage@1)
~~~

§8.2.2虽列出其他Libra public component名称，但当前没有为其冻结exact method catalog。P8-01因此只物化上述已确认方法，
不以工程猜测提前创建Admin、Product Delivery或Workspace Reclamation接口。

## Machine evidence

- `domains.libra.public`精确导出`PACKAGE_ID`与`LibraIntakeFacade`。
- `LibraIntakeFacade`只接受exact `offerCandidate` implementation；缺失或额外Repository/authority稳定拒绝。
- input schema ref固定为`ProcurementCandidateOfferAvailableMessage@1`。
- source guard证明public package无Persistence/Store、Procurement internal、Runtime、HTTP、SQLite或startup依赖。
- Architecture dependency与semantic scan保持零finding，112/96/163/30合同不变。

未实现Acceptance Decision、Subject、Control transfer或任何外部副作用；这些仍按P8依赖顺序后置。
