# P6-10 Cross-domain Projection Boundary Evidence

Status: complete.

Synthetic Libra/Arca consumer只能调用`PerceptionResolutionFacade`或`PersonReferenceQueryFacade`，并只能保存
`ownerDomain + contractRef + revision + digest`的immutable Basis copy。Perception Facade没有push/Run/Case权限；People Projection只公开
Reference Image，不公开Face级操作，也没有Media-Cast或Person写回入口。重复、缺失、乱序wake signal不改变Owner Store中的Canonical结果。

Boundary fixtures `3/3 PASS`；package dependency与forbidden semantic gates均PASS。
