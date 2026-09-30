# Series Routing 与原生资料生产调度证据

日期：2026-10-01。开发工作项：唯一 Phase 的节点1「剧集资料与生产基础」。实现提交：`4831a923bad032b3953b2db46953419612d678b1`。此证据承接[身份与continuity](SERIES_PRODUCT_IDENTITY_20261001.md)及[逐集资料接线](SERIES_EPISODE_METADATA_WIRING_20260930.md)，不分配开发UAT编号。

## 已实现

- Routing Context Reader 从正式Subject及accepted routing-anchor IdentityClaim冻结contentProfile；Series从同一explicit_number claim冻结positive Season Number及其digest。两个source均保留Season，Movie输入形状保持。
- Routing的TMDB Adapter查询TV与相同Season实际存在，严格校验对象、Season、namespace、Handle及协议。Related只观察tvshow NFO的Series层事实，去掉actor/Episode子节点；Episode NFO和其他Season不能提供Series Routing事实。Routing资料不会发布Product Identity或continuity。
- Acceptance Spec Context Reader从Libra当前active Primary Binding及对应binding revision的Episode claims形成本批Product Scope，按Subject intake revision及Episode scope digest检查读取Fence；不读取理论目录，不以空Episode列表构造Season Spec。当前证明首批单Run，不宣称后续多批调度已完成。
- Artifact协调器使用既有精确Season/Episode目标、Producer binding、完整Verification Result及input snapshot核验。移除将“Artifact种类数”当作“Artifact目标数”的Movie遗留判断；漏集、重复E01代替E02的负向验证保留。
- Series Metadata Observation Set及Selection/正式Source refs支持最多128个来源，Movie/JAV保持16。512 KiB Set/Source Basis与64 KiB Draft/Fact等字节合同保持。128是来源数量，不是128集交付承诺；Related与Provider均计数。超数量或超字节显式拒绝，不截断、不只取首集。
- 同步SSOT closed DTO描述、schema builders及正式materializers产物；无新增Domain、Capability、Table、Handoff、SQL DDL或存量兼容逻辑。

## 原生纵向验证

`series-routing-run.test.js`使用临时clean SQLite与实际Clean Host。Series产品入口仍关闭；测试调用Procurement自己的Field Observation命令准入，由Host正常fallback reconciliation运行真实Work、Planner、Event、Result Reader与Owner事务。没有播种Foundation Work/Result或注入Resolved Identity。

两个样本分别为首批E01/E02与普通24集Season：

1. 实际目录枚举、Triage/Candidate、Handoff A/Intake形成唯一Season Subject。
2. 年份规则按需查询Routing事实，正式Decision指向目标Shelf；Perception与Spec形成冻结Episode交付集并准入唯一Run。
3. 实际Identity Capability通过TV/Season观察、原生Fact事务发布Series身份及continuity；后续Spec重评不改写该Run冻结范围。
4. 逐集资料查询、Artifact Planner/Renderer/Verification、Workspace写入及正式Metadata Fact提交全部由调度器执行。
5. E01/E02生成Season加逐集3份NFO及1张海报；24集生成25份NFO及1张海报。逐份读取NFO检查集号、标题；Fact精确保留2/24个Episode scoped records。
6. Product Metadata Fact分别保存3/25条来源引用；每条逐字节核对真实Foundation Result storage digest、Evidence payload digest及对应Plan input binding digest。
7. 在Metadata Fact门槛停止Host。正式Arca Shelf Entry计数0，Shelf target为空；全部源文件字节不变。

Provider执行真实Adapter逻辑，外部HTTP为一次性fixture。视频字节及Probe为合成fixture，海报由Sharp生成可解码JPEG；这些验证不等于真实Series媒体测试、真实TMDB凭据请求或正式上架。

## 回归与合同检查

Windows / Node v25.9.0。依赖由主工作区锁定安装提供。命令在隔离交付区执行：

```powershell
$env:NODE_PATH='E:/my_project/emby_third_party-helix/media-service/node_modules'
node --test media-service/test/helix-architecture/series-routing-run.test.js media-service/test/helix-architecture/series-product-identity.test.js media-service/test/helix-architecture/series-metadata-scope.test.js media-service/test/helix-architecture/series-tmdb-season-metadata.test.js media-service/test/helix-architecture/p9-product-metadata-work.test.js media-service/test/helix-architecture/p9-product-fact-contracts.test.js media-service/test/helix-architecture/p9-product-fact-store.test.js media-service/test/helix-architecture/p8-decision-front-half-contracts.test.js media-service/test/helix-architecture/p8-decision-basis-store.test.js media-service/test/helix-architecture/p8-acceptance-spec-planner-stale.test.js media-service/test/helix-architecture/domain-input-schema-builder.test.js media-service/test/helix-architecture/domain-input-schema-validator.test.js media-service/test/helix-architecture/result-type-schema-builder.test.js media-service/test/helix-architecture/result-type-schema-validator.test.js media-service/test/helix-architecture/p9-product-identity-input-readiness.test.js
node --test media-service/test/helix-routing-decision-e2e.test.js media-service/test/helix-architecture/p14-h1-tmdb-metadata-response.test.js media-service/test/helix-architecture/p14-h1-tmdb-integration.test.js media-service/test/helix-architecture/p15-uat217-rating-target.test.js
node media-service/scripts/helix-p2-contract-check.js
git diff --check
```

最终两批分别181项（约18秒）及17项（约22.1秒）通过，0失败、0跳过；不同文件共198项。17项Series Routing专项及此前的单文件/两文件复验包含在181项内，不再相加。P2：113 Capability、99 Result family、197 Table、45 Transaction、31 Shared type、120 Domain input、218 Type reference，未解析引用0，findings为空。diff检查通过。

另验证：128来源完整保留、129来源拒绝、Movie第17来源拒绝；实际closed schema graph拒绝把128来源Series Basis伪装成Movie；64份较大Observation在512 KiB Set边界拒绝。未扩大字节合同。

Movie Routing旧fixture原先向所有operation返回Routing专用Handle，使Product Identity有机会启动生产并创建Workspace，违背该测试“只到Run准入”的范围。修正fixture只向Routing提供Handle；资源、Spec/Run数量、源字节及restart断言保持，最终通过。没有通过修改生产恢复/准入逻辑或放松断言消除失败。

## 当前边界与后续

节点1尚未关闭。当前原生门槛到资料/Artifact/Product Fact，不等于每个Primary完整媒体验证、加工、Product Package/Handoff B及Arca落位；这些继续贯通。默认NFO正式布局碰撞留在节点2，非重叠追加/多Run准入及N:M仍在节点3验证，不以首批结果宣称通过。

没有Series页面或后端展示文案交付，未声明UI PASS；未来可见变化由UI负责人验收准确版本。未运行Linux/Docker、Desktop、真实媒体E2E、浏览器、完整升级/回退或生产验证；未部署、未创建release tag、未改生产数据。

测试关闭了全部task-owned Host。两处首次失败运行留下的临时目录仍为一次性fixture，自动审批拒绝其递归删除命令，返回“blocked by policy”；未改用绕过方式。它们位于系统Temp的`helix-series-routing-Sm3t26`与`helix-series-routing-Xzi4aK`，工作区没有残余测试数据。
