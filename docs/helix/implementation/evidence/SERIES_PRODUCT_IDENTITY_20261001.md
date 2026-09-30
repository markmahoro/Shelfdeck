# Series Product Identity 与 continuity 发布证据

日期：2026-10-01。所属工作项：CURRENT_PHASE 节点1「剧集资料与生产基础」。实现提交：`215af03f5261029410c2d8e8041778ba1396a8dd`，隔离分支 `codex/beta-closeout-series`。节点1未关闭，未部署生产。

## 实现范围

- 沿用 Product Identity Planner、Owner projection、Provider Observation 与 Domain Fact Commit。Series Intent 从冻结 Candidate IdentityClaim 取得显式 positive Season Number；该数字写入两个 Plan Owner input binding 的 parameters，实际 projection 重读冻结输入并核对。Movie 的 DTO 不增加 Season 字段。
- closed Intent/Observation schema 增加 Series 分支；TMDB search/exact 查询 TV 对象，再验证同一 Season 实际存在。404形成明确 no-match，技术失败保留 Integration failure；不展开理论 Episode 目录，也不拿 Episode ID当Series ID。
- Related `tvshow` NFO只形成 claim，剔除演员及嵌套 Episode身份。必须再执行独立 Provider exact Work，核验Series对象、Season、Alias/year及来源关联，才能发布正式身份。未解决的多义、冲突和缺失保留为 typed Result；本批不交付 Series 消歧界面。
- 正式 `ResolvedProductIdentity` 使用 `tmdb_series_season`、Series ID与Season tuple；发布 `provider_season_identity / tmdb / series:{id}:season:{number}` nominal claim，并保存 Observation Evidence 和 `resolved_identity` provenance。
- Store 在事务内重验实际 Work→Attempt→Plan→Event→Result、完整 Source refs、计划冻结Season、Run Episode claims的season_claim_digest、身份与Observation digest、正式display tuple。无效或跨Season输入零发布。
- 同一 Libra participant保存Run Fact、Subject Identity revision/current pointer、continuity relation、Subject continuity-set digest、global continuity head CAS及Source refs；Result/marker同事务形成，始终无Outbox。未来Intake使用已发布的continuity关系；旧Intake记录不追溯改写。
- 已建立身份的Subject后续生产采用正式Series display record，并核对冻结Season，再执行Provider exact核验。不存在旧Formation兼容路径或数据Reset。

未新增Domain、Table、Capability或Handoff；扩展既有typed DTO和Libra Fact transaction的精确读写集。SSOT、schema builders、Source map、Result/Domain Input registry、Table/Transaction contracts和clean schema manifest通过正式materializer同步。SQL DDL字节及其digest保持原值，仅合同追溯digest更新。

TMDB TV别名与Movie响应结构不同：TV的`alternative_titles`集合为`results`，Movie为`titles`，依据[官方OpenAPI](https://developer.themoviedb.org/openapi/tmdb-api.json)核对。Adapter对Series显式使用该结构，Series metadata也同步修正；未添加双结构fallback。

## 可复验验证

环境：Windows，Node v25.9.0，依赖由主工作区锁定安装提供。以下命令在隔离交付区执行，使用临时SQLite数据库和一次性HTTP响应；不访问生产。

```powershell
$env:NODE_PATH='E:/my_project/emby_third_party-helix/media-service/node_modules'
node --test media-service/test/helix-architecture/series-product-identity.test.js media-service/test/helix-architecture/series-metadata-scope.test.js media-service/test/helix-architecture/series-tmdb-season-metadata.test.js media-service/test/helix-architecture/p9-product-identity-input-readiness.test.js media-service/test/helix-architecture/p9-product-fact-contracts.test.js media-service/test/helix-architecture/p9-product-fact-store.test.js media-service/test/helix-architecture/p8-decision-front-half-contracts.test.js media-service/test/helix-architecture/p8-libra-intake-store.test.js media-service/test/helix-architecture/p8-subject-continuity-resolver.test.js media-service/test/helix-architecture/p14-h1-tmdb-metadata-response.test.js media-service/test/helix-architecture/p14-h1-tmdb-integration.test.js media-service/test/helix-architecture/p15-uat217-rating-target.test.js media-service/test/helix-architecture/p3-canonical-transaction-crash.test.js media-service/test/helix-architecture/transaction-contract-builder.test.js media-service/test/helix-architecture/transaction-contract-validator.test.js
node --test media-service/test/helix-architecture/p3-ddl-compiler.test.js media-service/test/helix-architecture/p3-persistence-verifier.test.js media-service/test/helix-architecture/series-product-identity.test.js
node media-service/scripts/helix-p2-contract-check.js
git diff --check
```

最终15文件回归302项通过、0失败、0跳过，约55.5秒。随后同步Table contract的追溯信息及clean schema manifest，DDL内容无变化；3文件复验44项通过、0失败、0跳过，包含有重叠的30项Series Identity专项，不能与302相加。P2最终通过：113 Capability、99 Result family、197 Table、45 Transaction、31 Shared type、120 Domain input、218 Type reference，未解析引用0，findings为空。`git diff --check`通过。

专项直接执行实际Adapter、Planner、Owner input projection和closed schema graph，覆盖TV/Season查询、搜索与精确验证、TV别名、冻结Season非法值、Movie/foreign TV/foreign Season/错误响应、404/网络/HTTP失败、NFO root/Episode ID/演员ID隔离、NFO claim不可直接commit、多义/year/association冲突。

原生测试使用clean SQLite、Work Result Reader、Domain Fact Commit Coordinator和实际Owner repositories：

- 完整保存Resolved Identity、Product Fact、Source refs和continuity关系，核对Subject digest/head及exact replay不重复推进。
- 实际Intake Store以新发布的Series/Season claim找到该active Subject，另一个Season无匹配；E03的固定后续生产snapshot可读取既有Series身份并形成相同Season的Provider exact Intent。
- 在最后global continuity head CAS处注入失败，此前真实Owner写入和Subject pointer、Result/marker全部回滚；去掉故障后正常提交。
- 即使重建Fact/Handle digest，跨Season Source、冻结Run Season不一致、非canonical Fact仍被拒绝且无发布残留。

## 证据边界与接续

原生fixture明确在已准入的Run/Manifest和已完成Observation Work边界播种。Provider Observation真实逻辑、Plan/projection及正式Fact事务已验证，但不是Scheduler/Host从Field自动生成这些对象的完整旅程；后续Intake查询及E03生产projection也不能代替实际E03 Handoff/准入/上架。

节点1继续接通Routing与完整Series Run调度，并验证普通长Season的有界Source Basis和Fact容量。当前16 Observation、512 KiB Observation Set、64 KiB Fact仍是明确边界，不能凭E01/E02声称任意全集交付。节点2接续Arca正式Season/Episode命名与首次完整上架；默认NFO命名碰撞仍未修复。Artifact只有Primary携带Episode relation的Owner合同保持。

没有Series页面/后端展示文案交付，未声明UI PASS。可见变化仍交UI负责人按准确版本验收。未运行真实Series媒体E2E、完整Host调度、真实TMDB凭据请求、浏览器、Linux/Docker、Desktop或生产验证；未创建release tag，未分配开发UAT编号。
