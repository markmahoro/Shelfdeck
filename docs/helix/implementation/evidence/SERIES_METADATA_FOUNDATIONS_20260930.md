# Series元数据基础：首批开发交付

日期：2026-09-30。Phase工作项为“Series元数据基础”；用户明确开始开发，实施提交`ea3d33d16d1bb19949f379e36ea648cfafd003a6`。本工作项已完成约定的Windows组件验证，完整Series纵向与发布资格继续由[唯一Phase](../CURRENT_PHASE.md)管理，不使用UAT编号。

## 结果与合同

- TMDB Metadata沿已有IntegrationHandle/Secret Lease查询精确Series详情及Season详情，校验positive Season Number、anchor digest、Series ID和Season响应，返回`series_title`/`season_number`及季级sourceRef。缺Season/外部失败不发布半份成功Result。现有Movie请求保持原路径和字段；Movie不能请求Season字段。
- `SidecarProfile@1.typedParameters`新增显式单集约定，按UTF-8顺序冻结`episodeNumber(integer)`、`rootElement(string=episodedetails)`、`seasonNumber(integer)`，每项`valueDigest=SHA-256(JCS({parameter,valueType,value}))`，外层Profile digest仍为完整值除digest。必须与单集Draft中的season_number/episode_number匹配，并有非空Series title、Episode title/plot；缺失、错集或篡改均在物理写入前拒绝。
- Renderer输出episodedetails的title/showtitle/season/episode/plot，使用本集资料；不把TMDB Series ID写成Episode ID。仍沿用受控Workspace Artifact写入、effect authority与provenance。适用Related NFO更新保留非托管字段；错季/错集/错Series或未知scope重新生成产品NFO，原文件字节不变。Movie与现有tvshow生成路径保留。

Owner与依据：SSOT §5.5.3/§5.5.5、§6.4.7.1；Adapter不形成业务身份Decision或理论Episode目录，Libra决定本次交付范围/资料来源/冻结Profile并写Workspace，Arca仍独占正式上架。DTO及Capability的字段形状未增加，使用既有SidecarProfile typed slot；没有新Store、全局媒体ID或存量迁移。

Season详情的协议入口核对[TMDB官方参考](https://developer.themoviedb.org/reference/tv-season-details)。实现只消费本工作项所需的季号及身份字段，不把Provider返回的全集列表引入Run Manifest。

## 复验

Windows、Node `v25.9.0`，依赖通过本命令进程`NODE_PATH`解析主工作区已恢复的外部包；执行当前隔离分支源码。未复制依赖或建立junction。HTTP为注入fixture，NFO源为临时文件，数据库为隔离临时数据，不连接生产。

```powershell
$env:NODE_PATH='E:/my_project/emby_third_party-helix/media-service/node_modules'
node --test media-service/test/helix-architecture/series-tmdb-season-metadata.test.js media-service/test/helix-architecture/p14-product-sidecar-update.test.js media-service/test/helix-architecture/p14-h1-tmdb-metadata-response.test.js media-service/test/helix-architecture/p14-h1-tmdb-integration.test.js
node --test media-service/test/helix-architecture/p9-product-fact-contracts.test.js media-service/test/helix-architecture/p9-product-fact-store.test.js media-service/test/helix-architecture/p9-product-metadata-work.test.js media-service/test/helix-architecture/p9-product-metadata-planner.test.js media-service/test/helix-architecture/p9-product-conformance.test.js media-service/test/helix-architecture/p14-rule-template-public-http.test.js
```

第一批60 pass，第二批43 pass；合计103，0 fail，0 skipped。覆盖新Series/Season请求正负路径、请求字段与Handle fencing、单集NFO及源保护；既有Movie的Provider/Secret/CAS/restart、NFO保留/重建，以及Metadata来源优先级、Observation链、Fact原子提交与规则归属回归。`git diff --check`通过。

诊断时以内存临时启用旧`p14-series-handoff-a.test.js`的skip用例，首先得到`firstProbeEvent`不存在的失败：该fixture注册未提供profile hint，按当前合同规范化为mixed，Admin Movie-only guard拒绝观察；用例还假定observe API同步推进。这是陈旧fixture/阶段入口事实，不能据此断定底层Series Probe失败。未修改该skip、未将诊断计为通过。

## 后续与限制

当前仍没有Run内每个Episode的正式Observation/Draft/Result引用闭包，也未把单集Profile规划接入Artifact Production或Handoff B。Adapter继续拒绝没有显式Episode scope的episode_*请求，不用全季flat字段填充所有Episode。当前Series产品入口仍受阶段限制；没有完成真实媒体、完整Host/Commit、浏览器、Linux/Docker或全量Movie测试。

本工作项未改API路由、数据库schema、UI、FFmpeg/设备或Desktop，不构建/部署新镜像，不改生产业务事实/媒体；Linux及真实文件生产验证留在纵向Gate，不以Windows组件测试宣称跨平台资格。S00、N:M空间计量及Episode级恢复合同尚待所属工作项复核；没有通过本实现默默决定它们。
