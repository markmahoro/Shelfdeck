# 外部Series上架验收Workspace源投影

日期：2026-10-08；基线 `f32d360d021325df0a8142833b07fc0b306aa024`，当前Phase外部交付工作项。

缺口：外部候选的member仅为Workspace候选投影，缺少原Field Binding的endpoint/location/revision；Import与最终成品共用Handle时，原装配条件因sourceHandleDigest相同跳过了源投影，无法发行完整Shelf Acceptance Read Handle。

现在外部Series无论是否共Handle，都从成功Import/Remux/Transcode记录按Probe的完整sourceHandleDigest取唯一Workspace Handle，校验同Libra Run、owner、正式revision和size/physicalIdentity一致，再由Workspace端口解析位置。既有加工后Workspace源也复用相同检查，去掉revision缺失时猜测1；原Run Binding与原source Offload映射不变，授权仍由正式生产端口发行。

10项外部Scope/Import/候选专项通过，增强真实consumer fixture验证endpoint/location/physicalIdentity/revision完整，缺Handle、重复、跨Run及缺revision拒绝。fixture原physicalIdentity缺size/version，现补正式字段，未弱化校验；首轮新增测试同名局部变量语法错误已修正。普通两集Direct/Remux正式Host完整上架通过35.4秒；P2、包边界457文件/1446依赖、语义2076文件及diff检查通过。

日志 `E:/my_project/helix-git-consolidation-20261008/series-acceptance-source-v3.log`、`series-acceptance-source-host.log`、`series-acceptance-source-contracts.log`。专项验证源投影边界，尚非外部完整Shelf Acceptance Host；本批未单独重跑Movie外部后处理Host。外部Coordinator/失败媒体后处理、完整N:M交付/审批/恢复及Linux/UI/发布门禁继续，未操作NAS，Series尚不可声明可部署。
