# Series 逐集资料与产物接线证据

日期：2026-09-30。所属工作项：CURRENT_PHASE 节点1「剧集资料与生产基础」。实现提交：`cca63288607aab127edd8e000221c00b373bca7a`。本批为隔离本地开发，未部署生产、未关闭节点1。

## 实现与合同

- MetadataFetchIntent/Observation 增加有界、closed `episodeScope`，包含 canonical Episode key 与正整数 Season/Episode Number；完整 scope 进入既有 intent/result digest。Libra 在 Provider I/O 前验证 Run、Execution Basis、Spec 和冻结 Manifest 的对应范围。
- Supporting Work 按各集缺口独立取资料。TMDB Adapter 显式核验 Series/Season/Episode tuple；Related NFO 必须属于该集的 primary member，只有匹配的 `episodedetails` 才提供单集资料。未取得的 title/plot 继续是缺口。
- Draft 只投影对应集的 Observation；Season Draft/Fact 保留 typed `episodeMetadata` 集合和逐字段 Provenance，不把一个 flat Episode title/plot 当整季资料。Movie 无新增可选字段时保持原 digest 形状。
- Artifact Planner 生成 Season 及本批每集 NFO 的 producer/verification 对。Owner input projection 选择对应 Draft/Profile；Renderer 写 `product/season.nfo`、`product/E001.nfo` 等不同 Workspace 路径。Verification 同时核验数量和 producer 目标，重复 E01 不能顶替 E02。Conformance 的 episode_title/episode_plot 覆盖冻结交付集。
- 仅扩展 SSOT 既有 MetadataFetchIntent、MetadataObservation、ProductMetadataDraft、ProductMetadataFact、ProductConformanceEvidence 的 closed DTO；未新增 Domain、Table、Capability 或 Handoff。SSOT source map 与 Result registry 按正式 materializer 更新。

## 可复验验证

环境：Windows，Node v25.9.0；依赖由主工作区锁定安装提供，`NODE_PATH=E:/my_project/emby_third_party-helix/media-service/node_modules`。

受影响回归：以下16文件合计172项通过、0失败、0跳过。最后新增 closed schema graph case、将专项 Renderer fixture 换成真实 Renderer 后，重新运行逐集专项12项全部通过；两批有重叠，不能相加作为独立案例数。

```powershell
node --test media-service/test/helix-architecture/series-metadata-scope.test.js media-service/test/helix-architecture/series-tmdb-season-metadata.test.js media-service/test/helix-architecture/p14-product-sidecar-update.test.js media-service/test/helix-architecture/p14-h1-tmdb-metadata-response.test.js media-service/test/helix-architecture/p14-h1-tmdb-integration.test.js media-service/test/helix-architecture/p9-product-fact-contracts.test.js media-service/test/helix-architecture/p9-product-fact-store.test.js media-service/test/helix-architecture/p9-product-metadata-work.test.js media-service/test/helix-architecture/p9-product-metadata-planner.test.js media-service/test/helix-architecture/p9-product-conformance.test.js media-service/test/helix-architecture/p14-rule-template-public-http.test.js media-service/test/helix-architecture/p9-libra-run-coordinator-boundary.test.js media-service/test/helix-architecture/p14-clean-workspace-product-port.test.js media-service/test/helix-architecture/p14-series-run-layout.test.js media-service/test/helix-architecture/p14-series-run-lifecycle-continuity.test.js media-service/test/helix-architecture/p14-pbf20-episode-claims.test.js
node --test media-service/test/helix-architecture/series-metadata-scope.test.js
node media-service/scripts/helix-p2-contract-check.js
git diff --check
```

P2最终通过：113 Capability、99 Result family、197 Table、45 Transaction、31 Shared type、120 Domain input、218 Type reference，未解析引用0，findings为空。新增 schema case 直接检查实际 closed schema graph 对 Intent/Observation/Draft/Fact 的接受和非法字段拒绝。

专项覆盖 scope/digest 分离、rehashed 错集 Result 拒绝、Draft 数字矛盾、I/O 前 membership/物理关联 Fence、E01不关闭E02缺口、真实 Planner→Owner projection→Renderer 的3条不同路径和XML、Fact集合/digest、逐集字段 Conformance、重复 verification 目标拒绝及 Related NFO 不匹配保留缺口。

## 证据边界与下一步

专项 durable reader 为固定 Plan/Input Snapshot/Result digest fixture，Workspace write 为捕获 fixture；真实 Renderer 已执行，但不能代替 Foundation Event、原生 Series Fact commit 和完整 Run 的实际调度。既有回归包含原生 SQLite/Workspace 测试，仍没有新 Series 首批上架完整链路结论。

当前 Source Basis Observation 上限16、Observation Set 512 KiB、Fact 64 KiB；普通较长 Season 的批次容量必须明确验证并在既有 Owner 合同内处理，不能用本批 E01/E02 测试声称任意全集可交付。Episode Artifact 正式 staging/placement/交付关联尚需贯通核验。S00、N:M计量及Episode恢复依然按所属节点 DoR 审查。

未运行真实 Series 媒体 E2E、浏览器、Linux/Docker、Desktop 或生产验证。本批无页面/展示文案变更，无适用 UI 交付验收，不声明 UI PASS；后续可见变化仍提交 UI负责人按精确版本验收。

## 追加：原生 Workspace / Fact 事务验证

追加测试提交：`a36b22dab`。新 fixture 使用真实 clean SQLite schema、Work Result Reader、Artifact Planner/Owner projection/Capability、Renderer、Workspace physical port、Artifact Registry 和 Domain Fact Commit Coordinator。3个Source Work及其Plan/Event/成功Attempt/Result为固定边界种子；并非真实Scheduler从Field创建这些Work。Workspace写入绑定其种子Event Attempt的intended effect authority，测试没有模拟Runtime完成整个Effect lifecycle。

新增3项验证：Season/E01/E02三份实际NFO、Handle、3条Artifact verification与逐集Fact/Source refs保存和精确重放；Owner post-marker写入中途崩溃后Fact/source refs/Result/marker全回滚而既有Workspace产物保留，修复故障后正常commit；Source Basis冻结后修改并重哈希单集Result仍被source-reference digest Fence拒绝，零Fact/marker残留。新逐集专项与原生Fact Store、Workspace相关回归共48项通过、0失败、0跳过。首次负向case将拒绝码预期写成SOURCE_CHAIN，实际在更精确SOURCE_DIGEST Fence拒绝；按该确定拒绝位置修正断言后通过，未放松生产校验。

本追加证明原生Product Metadata Fact commit和实际Workspace持久化，不替代完整Series Run/Arca Commit。原上文“未覆盖原生Series Fact commit”是前一代码批次的历史边界，现由此追加证据补齐；Scheduler/Host/真实媒体边界仍未覆盖。

最终代码`a36b22dab`重跑上文同一16文件命令：176项通过、0失败、0跳过（约28.8秒）；P2合同再次通过，counts不变且findings为空。176为本批最终受影响回归结果，不与先前172/12/48重复相加。`git diff --check`通过。

贯通审查已确认两点：

- SSOT §8.6.21及`libra_product_package_materials`只允许Primary携带Episode relation；Artifact staging使用空Episode claims符合合同，不能为补播放器关联而更改成员关系Owner。正式关联/落位需由既有产品Artifact与Arca Inventory合同处理。
- `clean-arca-inventory-port.js::finalMemberName`使用同一影片标题stem映射全部metadata_sidecar，默认`{stem}.nfo`将Season/Episode三个产物映射到相同名字，`buildPlan`按collisionPolicy拒绝；节点2必须实现并验证Season/Episode正式布局。上游`createProductIdentityProjections`、Routing Identity observation、TMDB Routing adapter、`buildProductIdentityCommitBundle`也有Movie专属约束，节点1需先补齐完整Series身份链，不能用当前已注入ResolvedIdentity的fixture绕过这段后宣布完整Run通过。
