# Series Aftercare 海报 Provider 身份

2026-10-08；关联Series Phase节点4展示维护，未部署NAS。

## 根因与结果

原Artifact Capability根据Provider为tmdb直接写死 `namespace=tmdb_movie`，使Series已有收藏的海报维修也请求同编号Movie。现在Arca从当前Inventory的全部已接受resolved_identity重建Provider Series/Season tuple，逐批验证Canonical Identity一致、Provider key一致、正整数Season以及tmdb_series_season类型，并生成正式tuple摘要；再交给原Integration Artifact端口。Movie保持原namespace与identity digest。

缺少正式身份、错剧/错季、重复anchor、旧StableProviderIdentity或返回Movie身份的Artifact在网络请求或Workspace写入前按对应错误拒绝。既有Integration Handle、Case权限、响应身份复核和Workspace写入Fence保持。没有新Owner、跨域Store、schema或生产数据兼容代码；不修改Provider目录或图片选择策略。

## 验证

- 新专项17项：跨批重建、顺序无关、Movie回归及9类非法身份；正式Capability请求和错误响应Fence；实际TMDB Adapter以受控HTTP Response验证 `/3/tv/1399/images` 与 `/3/movie/1399/images`。正式Capability正向路径采用not_available结果，不声称真实网络海报下载/完整Inventory维修已通过。
- 与既有Aftercare结算/Workspace安全、UAT-251修复准入、Series TMDB Season资料一起执行：84项通过，0失败/跳过。
- TMDB集成回归11项通过（16.5秒），合计本批95项通过；架构边界、语义及diff检查通过。
- 日志在仓库外 `E:/my_project/helix-git-consolidation-20261008/series-aftercare-provider-tests.log` 与 `series-aftercare-provider-tmdb.log`。

未执行此版本完整架构、完整Host维修、浏览器/UI负责人验收、Linux、Docker/Desktop或生产部署。逐集NFO、逐成员媒体维修、展示完整闭环及首版发布门槛仍开放。外部N:M替换合同仍等待此前用户确认，未据本批改变该合同。
