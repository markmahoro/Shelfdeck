# Series Aftercare NFO重建及结果关联

日期：2026-10-08。归属唯一Phase的Series运营/Aftercare工作项；开发基线`30defdb575fe4bb7270ee883d1b5acdeb14d2dbd`。本批不部署NAS，不关闭节点4或首版发布资格。

## 实现与边界

- Arca内部`aftercare-series-nfo.js`从当前Inventory NFO成员的正式Artifact scope读取精确来源批次，选择其唯一已接受Identity、Metadata和Cast。所有批次仍须指向当前Canonical Series/Season。
- 单集使用精确Episode scope，并验证该集仍有当前Primary Claim。共文件、多part不改变这个目标，不从路径或首个Metadata推断。缺资料、重复/错季scope、集号冲突、错来源及非法XML字符明确拒绝。
- 整季生成`tvshow`，单集生成`episodedetails`；Series TMDB ID只作为整季ID，不误写为Episode ID。XML文本转义，输出受现行256 KiB上限约束。
- Commit Planner原来给每份NFO都只绑定preparation Work和outputKind，Resolver会返回第一份成功结果。现在Artifact binding携带sourceEventId，按Work、Event、Capability精确取结果；缺失/歧义拒绝。单一Movie结果及同Work媒体验证保持原路径，Inventory Commit依赖所有物化Event成功。
- 本批Renderer通过真实Owner context验证，尚未替换现有TextRender的Series门禁。完整逐Artifact缺陷冻结、生成副作用、物化、Inventory/Control原子Commit、结算和恢复仍需接通；现有attention_required不是最终交付。

## 验证

- 精确多批次/Season/Episode重建及负向27项；连同输出Projection与Planner共39项通过。Planner使用正式Capability manifest和parameters/resource/fence schema验证。
- 正式隔离Host E01/E02首次上架→同Subject E03追加通过，执行93.7秒；从Aftercare Store的实际当前Inventory/Fact重建全部四份NFO，核对根元素、逐集标题/集号与原批次来源。没有修改收藏文件或伪造数据库行。
- 边界检查445文件、1381依赖及语义检查2063文件通过；无跨Owner调用或新增Provider请求。
- 完整架构回归2,242项：2,233通过、9项既有skip、0失败，96.5秒（实际Series Host另行执行）。

首次专项失败为新增Planner测试未传入validator要求的frozen schema set，已改为读取正式schema并复验通过；原失败日志保留。隔离Host一次通过。

日志位于`E:/my_project/helix-git-consolidation-20261008/`：`series-nfo-render-focused.log`、`series-nfo-render-focused-final.log`、`series-nfo-render-host.log`、`series-nfo-render-full.log`。本批未做实际Series维修落位、Linux/Docker、UI/浏览器或生产升级验证；Movie完整发布回归仍按Phase后续门禁执行。
