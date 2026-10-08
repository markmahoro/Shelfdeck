# Collection 的 Season / Episode 投影

2026-10-08；当前 Series Phase 节点2/3/4，基于`b589b906a`，随实现提交绑定版本。沿既有Arca收藏事实与UI负责人Series详情设计，不新增Owner或理论全集推断。

## 实现

Collection查询从当前Inventory revision读取Primary Episode Claims，并校验当前Canonical Season key与已接纳resolved_identity事实一致。以实际Episode key去重并排序，返回seasonNumber、episodeCount、physicalFileCount及每集全部文件。每个共用文件标记实际覆盖集数；一集多个part全部保留；片名来自同Season/集scope的正式metadata，缺失为null，重复/错季或重复Primary拒绝。

Series不再将首个主视频的大小/编码/清晰度当作整季：主视频大小为当前所有Primary的物理大小之和，整季统一编码/清晰度不臆测。Collection总占用仍按Inventory物理成员计算，不按集重复加算共享文件。电影原逻辑保持。

海报卡显示Season及实际集数；详情列出已收藏Episode与文件关系。列表计数使用收藏条目，详情另显示集数与文件数；未提供的E02不补成已收藏集。界面不从文件名解析集数。

## 证据

- Collection专项7项通过，含共文件/part、跳号、错误Season identity、重复Primary/claim和非法Episode key拒绝；原Movie查询/分页/健康按页读取保持。
- 实际Host通过：一集2 part（35.5秒）、两集共1文件（35.4秒），经Arca Commit后从正式HTTP Collection读取并核对Season、集数、物理文件数及关联数。
- E03追加Host：94.2秒通过；同一Season Entry的最新Collection投影精确包含E001/E002/E003，原Episode不丢失。
- 前端26文件124项通过；首次两次失败为电影空态/计数旧措辞断言，已更新显示Oracle，保留行为校验。浏览器desktop/narrow两项通过，检查实际未连续集数、共文件、多part、Escape及焦点返回，受影响区域Axe零违规且无内部横向溢出。浏览器API受控，不冒充真实后端。
- 浏览器fixture初版未正确提供care/defect-admission-candidate响应，导致旧健康组件读取缺字段；修正fixture后通过，没有给产品代码添加静默fallback。
- TypeScript/Vite构建、P2合同、包边界459文件1453依赖及语义2078文件通过。窄屏截图已目视检查；路径为ignored的`.codex/series-browser/series-collection-shows-on-ba07e-heir-shared-files-and-parts-{desktop,narrow}/series-episodes.png`。
- 仓库外日志：`E:/my_project/helix-git-consolidation-20261008/series-collection-{host,append-host,ui-tests-v3,p2}.log`。

## 未闭合

同版本UI负责人验收、Formation本批范围、Series命名预览及完整发布Gate继续；未新增逐集体积分摊显示或宣称逐集播放入口。EpisodeDelivery摘要缺口按用户要求保留，未改动NAS或生产数据。Linux/Docker与完整升级/回退仍未验收。
