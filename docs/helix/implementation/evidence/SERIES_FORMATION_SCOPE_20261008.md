# Series Formation 本批范围（2026-10-08）

归属：CURRENT_PHASE 节点1–3的Formation可见范围；基于`510a5f913`，具体交付SHA由本文件Git历史定位。

## 合同、设计与实现

沿SSOT §3.4.4–3.4.5，Episode Delivery是冻结Run的交付集，不是Season理论全集或Subject累计范围。沿已有UI负责人2026-10-08设计协调，在现有媒体名称列与过程详情标题下显示季号、本批实际集号、集数与物理Primary数；列数/宽度/操作入口保持。用户从列表识别本批，在“查看过程”复核同一范围，仍从现有操作完成身份选择或处理。

Libra Formation使用本Owner现有`readRunSnapshot`及冻结Season验证，读取当前展示Run（或最近completed Run）；读模型按需投影，不新增持久列或跨域数据源。不从routing anchor、文件名或Collection推断范围，不修改EpisodeDelivery Requirement摘要。Movie与无Run条目无此投影，放弃后不复活历史批次。前端只格式化正式Episode keys。

## 证据

- Formation后端55项通过，含追加Run选择、非连续E03/E05、物理数与集数独立、completed读取、Season摘要漂移拒绝及Movie回归。
- 真实隔离Host首次两集→显式Series anchor追加E03：94.15秒通过。正式HTTP详情及completed列表均只有E003/一个文件；Collection累计E001/E002/E003；既有旧文件和历史不变断言继续通过。
- 前端26文件124项通过，TypeScript/Vite构建123模块通过。
- Series浏览器桌面1920×1080、窄屏390×844两项通过，覆盖列表本批范围、打开详情、Escape焦点返回及人工身份既有流程；identity弹窗Axe无问题。浏览器API受控，不替代真实Host；未宣称过程面板完整Axe验收。
- 已查看桌面列表与窄屏详情截图；位于ignored `.codex/series-browser/series-identity-Series-man-55d9e-rozen-Season-from-Formation-{desktop,narrow}/` 的`list.png`、`batch-detail.png`。
- P2、架构边界459文件/1455依赖及语义2078文件通过，`git diff --check`通过。
- 机器日志在仓库外`E:/my_project/helix-git-consolidation-20261008/series-formation-{unit,append-host,p2}.log`。

## 尚未验收

本次沿既有Subject行的当前Run选择显示范围；不是并发多Run工作区重构。UI负责人对交付版本的接受、完整外部替换Host、Linux、生产副本升级/回退与最终Movie全回归继续开放。用户暂缓的多part EpisodeDelivery摘要合同缺口保留。未部署NAS、未修改生产数据，节点及发布资格不关闭。
