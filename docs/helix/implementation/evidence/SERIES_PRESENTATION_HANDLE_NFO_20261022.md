# 剧集公共资料准备失败（4 部 Handle 非法 + 1 部 NFO 误判）— 2026-10-22

状态：开放。归属当前 Phase 工作项 `SERIES-PRESENTATION-HANDLE`（隶属 `SERIES-SHARED-PRESENTATION`），不新增 UAT 编号。根因已在生产只读查询与部署代码中定位；尚未修改代码、未部署、未改生产数据。

生产 `192.168.12.230:18080`，镜像 `markmahoro/shelfdeck:3.1.0-hostfix4`（commit `b70a9f6f6`），2026-10-22 21:36 部署；本项涉及的功能在 3.1.0 首次进入生产（20:20 `hostfix3`）。

## 用户可见问题

2026-10-22 晚，媒体整理工作区「需要处理」7 条，其中 5 条剧集显示「剧集资料准备失败」：

| 媒体 | 加入整理（UTC+8） | Handoff B 发布 | 失败码 | 目标收藏架 |
| --- | --- | --- | --- | --- |
| 开端 | 10-22 20:17:14 | 20:24:05 | `PLATFORM_INTEGRATION_HANDLE_INVALID` | 国产电视剧 |
| 权力的游戏 | 10-22 20:17:28 | 20:34:21 | `PLATFORM_INTEGRATION_HANDLE_INVALID` | 剧集 |
| 空战群英 | 10-22 20:17:13 | 20:36:48 | `PLATFORM_INTEGRATION_HANDLE_INVALID` | 剧集 |
| 西北岁月 | 10-22 20:21:14 | 20:57:33 | `ARCA_SERIES_NFO_SCOPE_INVALID` | 国产电视剧 |
| 风骚律师 | 10-22 20:38:22 | 21:29:18 | `PLATFORM_INTEGRATION_HANDLE_INVALID` | 剧集 |

同一时刻后台计数：`total 698 / in_progress 16 / attention_required 7 / completed 675 / ended 192`；页面 7 与后端一致，不是显示或计数错误。

另外 2 条 `CLEAN_ARCA_STAGE_TARGET_OCCUPIED`（机动战士高达 THE ORIGIN I、凡人歌）是目标位置已有文件的保护性停止，不属于本项缺陷。

## 根因 A：4 部剧集取图前 Handle 非法

调用链：

1. `media-service/src/helix/domains/arca/capabilities/series-presentation-capability-ports.js:71` 在 source 阶段调用 `acquire(scope,kind,CAPS.source)`；`:86` 在 assets 阶段调用 `acquire(scope,recipe.artifactKind,CAPS.assets,...)`。
2. `media-service/src/clean-service-host.js:890-895` 的 `fetchSeriesPresentationArtifact` 使用 `handleFor('tmdb', request.operationId, request.artifactKind)` 构造 Integration Handle。
3. `media-service/src/helix/platform/application/integration-runtime.js:299-309` 的 Handle 校验只在 `allowedOperation.endsWith('artifact.acquire@1')` 时允许 `artifactKind` 非空；`arca.series_presentation.source.observe@1` 与 `arca.series_presentation.assets.prepare@1` 都不以该后缀结尾，因此携带 `poster`/`fanart` 会被直接判为 `PLATFORM_INTEGRATION_HANDLE_INVALID`。
4. 该错误发生在真正向 TMDB 发请求之前；与 TMDB 凭据、网络无关（那会表现为 `PLATFORM_INTEGRATION_NOT_CONFIGURED`、`NETWORK_FAILED` 等）。
5. 该错误不在 `series-presentation-capability-ports.js:164` 的 series precondition 白名单内，按原始失败上抛，形成用户可见的「剧集资料准备失败」。

因此是确定性缺陷：同版本重试会在同一位置再次失败。失败时间全部落在 20:24–21:29，即 `hostfix3` 上线后、`hostfix4` 之前；`hostfix4` `b70a9f6f6` 只改 `formation-query.js` 的取消 Subject 评分读取，不涉及本路径。

测试缺口：`media-service/test/helix-architecture/series-routing-run.test.js:471` 将 `fetchSeriesPresentationArtifact` 整体替换为 stub，真实 `integration-runtime` Handle 校验从未在 Series 旅程中执行；平台侧对非 `artifact.acquire@1` 操作要求 `artifactKind=null` 的规则也没有与 Series 操作做交叉覆盖。

## 根因 B：西北岁月既有 tvshow.nfo 被误判

`/media/chn_series/西北岁月 (2024)/tvshow.nfo`（2025-06-09）是合法 tvshow 文档（`<title>西北岁月</title>`、`<tmdbid>275495</tmdbid>`），但含常见的 `<season>-1</season>` / `<episode>-1</episode>` 占位行。

`media-service/src/helix/integrations/series-presentation-io.js:24-28` 的 `nfoIdentity` 把任何直接 `season`/`episode` 子元素都当成季/集文档并抛 `ARCA_SERIES_NFO_SCOPE_INVALID`。文件本身未损坏，是本系统校验过严；真实的 season/episode 文档应以根元素和结构区分，而不是任何同名字段。

## 为什么升级前没有暴露

1. **代码路径是 3.1.0 新增的。** `series-presentation-capability-ports.js` 首次提交为 `ab5f610ae`（2026-10-21），`series-presentation-io.js` 首次提交为 `85ab5c7e1`（2026-10-21）；两者在升级前生产镜像 `6c74939646` 中都不存在（`git cat-file -e 6c7493964:<path>` 失败）。3.0 线的旧剧集流程不管理剧集根目录的 `tvshow.nfo`/海报/背景公共资料，也不会为它们发 TMDB 取图请求，也不执行这版 NFO 校验。
2. **这 5 条是今晚才进入整理的。** 加入时间为 20:17–20:38，第一次真正执行就在 3.1.0 上；升级前的版本没有处理过这 5 条新 Subject。
3. **资格测试没有打到真实路径。** Provider 取图被 stub 替换（见根因 A 第 6 点）；NFO 用例只覆盖 `<season>3</season>` 这类真实季文档（`series-shared-presentation.test.js:57-61`），没有覆盖 `<season>-1</season>` 占位；真实库中「已有剧根 + 缺一张 fanart」的数据组合也不在 fixture 中。
4. 所以这不是 3.0 行为的回归，而是新能力第一次接触真实媒体库数据时暴露的缺陷；升级前没有运行过该路径，自然没有暴露。

## 影响与范围

- 4 条 A + 1 条 B，共 5 条需要处理。
- 同批其余剧集中，仍有 5 条停在「读取并补充媒体资料」；走到「补齐剧集资料」且需要从 TMDB 取图时，可能继续出现 A。不能把当前 5 条当作最终数量。
- 「匹兹堡医护前线」已走到「正在写入收藏架」，说明并非所有剧集都失败；问题集中在需要 TMDB 取图的公共资料阶段。

## 修复方向（待实施）

1. 让剧集公共资料的取图操作可以合法携带 `artifactKind`：优先在 Integration Profile 明确声明可携带 `artifactKind` 的操作（`source.observe` / `assets.prepare`），由 `integration-runtime` 读取该声明；或改用 artifact-scoped 的操作命名。以 SSOT/平台合同为准，不在 resolver 硬编码 Series 特例。
2. `nfoIdentity` 只拒绝真正的季/集文档，允许 `season`/`episode` 的 `-1` 占位；保留 title、tmdbid 必需与身份唯一性校验。
3. 回归必须走真实 `integration-runtime` Handle 校验，不只用 stub；覆盖 source 与 assets 两阶段、`poster`/`fanart` 两种 kind，以及 `-1` 占位 NFO 的正反例。
4. 修复后对 5 条生产条目重试并记录精确结果；同版本失败不得以 Reset 或清数据掩盖。

## 生产影响

只读 API 与部署代码检查；没有修改数据库、没有 Reset、没有删除/移动媒体、没有重启或重新部署。2026-10-22 21:55 复核 formation 三个 section 均为 200，`attention_required=7`。

## 状态

OPEN。等待修复提交、回归、生产重试验收；两条目标冲突按独立操作项处理。

## 2026-10-23 代码修复与定向回归

已按上述方向实施：

1. `integration-profile-catalog` 的 tmdb profile 增加 `artifactOperations`，明确声明 `arca.series_presentation.source.observe@1` 与 `assets.prepare@1` 可携带 `artifactKind`；`integration-runtime` 对声明操作允许 `null` 或 `poster|fanart`，未声明操作仍要求 `null`，`*.artifact.acquire@1` 仍要求非空合法 kind。未在 resolver 硬编码 Series 特例。
2. `series-presentation-io.nfoIdentity` 允许 `season`/`episode` 及其 `_number` 变体的 `-1` 占位；真实季/集值、`episodedetails` 仍拒绝。
3. 回归新增真实 `integration-runtime` Handle 用例（source/assets + poster/fanart + 非 artifact 操作拒收）和 NFO `-1` 正例、`episodedetails` 负例。

定向结果：`series-shared-presentation.test.js` + `p14-h1-tmdb-integration.test.js` 共 **20/20 PASS**。本轮后续将随 Form 工作台 Reset 扩展一并部署；部署后对 5 条现有条目以新代码重试验收，若仍失败则保留 OPEN，不以 Reset 掩盖。

状态更新：`FIXED IN CODE / VERIFICATION PENDING DEPLOYMENT`；生产尚未变更。

## 2026-10-26 生产接线遗漏的独立复现

ee0c4786b确实修复了Handle的artifactKind资格和NFO占位，但同提交中的clean-service-host.fetchSeriesPresentationArtifact仍无条件调用tmdbAdapter.artifactPort。source.observe的pure_observation合同及adapter Observation端口本来正确，生产接线错误在通过Handle后才暴露为PLATFORM_TMDB_EFFECT_CLASS_MISMATCH。最新失败的五部是辐射、黑镜、棋士、沙丘：预言、越狱，不把它们写成最初五部已完成验收。

前次新增测试只签发/比较真实Handle，没有调用Host的fetchSeriesPresentationArtifact；series-tmdb-artifact-scope测试手选正确Observation端口，完整Series Host旅程又注入fetchSeriesPresentationArtifact。三种测试各自通过，未覆盖生产连接点。此次增强原Platform真实服务测试：配置持久Integration、经真正Handle和Secret broker调用该Host方法，poster/fanart各经过Source→冻结locator→Assets并取得可解码JPEG，仅HTTP传输为隔离fixture。原代码稳定失败，错误与生产相同；按operation正确选择端口后通过，另保留Source走Artifact及Assets走Observation的双向负例。

26项相关回归通过。该结果不等于新镜像已部署或五部实际入藏；现场重试与后续正式Commit继续开放。详见FORMATION_TERMINAL_CLOSURE_DIAGNOSIS_20261023.md本轮13条诊断节。
