# ShelfDeck 当前阶段

2026-10-08：Series首个可部署版本开发已完成，当前没有新的活动开发Phase。五个节点的实施记录已[冻结归档](archive/SERIES_DEVELOPMENT_20261008.md)，最终反向审计、具体版本UI接受及验证边界见[Exit Evidence](evidence/SERIES_FULL_REGRESSION_20261008.md)。

产品SHA：84c2cd92687ad55851cd1d0984e94c1d14334031；标准镜像：markmahoro/shelfdeck:84c2cd9268。后续为测试/文档收尾，未改变产品运行时。现有UAT按原条件保留，不因开发Exit关闭。

NAS生产未部署。生产升级前必须核对当前备份/精确未完成Formation范围，并取得对应部署及必要Reset授权；本次开发不处置当前生产3个active Run。部署入口沿用scripts/build-image.js、scripts/upload-nas-image.js、scripts/deploy-nas.js。
