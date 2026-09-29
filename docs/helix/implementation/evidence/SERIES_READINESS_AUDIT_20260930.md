# Series 准备初审与专项测试 Evidence

日期：2026-09-30。范围：当前隔离分支源码只读审查及Windows合同测试，不实施功能、不部署。工作归属为[Series准备Phase](../CURRENT_PHASE.md)，不是UAT问题；开发排程只在该Phase维护。

## 审查依据与已证实缺口

审查基线为`d22789ddf`，对应代码自`ecccf7ba9b`沿用，未在本轮修改。合同引用SSOT §3.2.6、§3.4.2–3.4.5、§4.4–4.5、§5.5.3–5.5.8；沿用Domain Owner、单向Handoff及Arca Commit，不用补功能改变边界。

| 入口 | 实际源码/测试事实 | 结论与覆盖边界 |
| --- | --- | --- |
| Procurement布局与Candidate | `domains/procurement/application/movie-run-coordinator.js`的`movieLayout`保留所有Primary；`draftFor`传递Season continuity claims；`model/triage-contracts.js`有Series分组 | 名字含movie不能证明不支持Series；跨观察批次、真实分组/Related/身份选择接线待纵向核查 |
| Libra Run范围 | `domains/libra/application/movie-formation-coordinator.js`的`episodeDeliveryKeys`按当前Binding revision收集Episode keys并校验Subject digest | 已有冻结范围与漂移防护基础；非重叠追加/并发Run的真实调度及历史事实保护未在本次证明 |
| 最长纵向fixture | `test/helix-architecture/p14-series-handoff-a.test.js:158`使用`test.skip`，说明Series Handoff A未在Movie milestone支持 | 该用例含后续Commit/故障/清理场景，但全部未执行；不能把文件存在或套件退出成功当作纵向通过 |
| 实际TMDB Metadata | `integrations/tmdb-provider-adapter.js`的`REQUESTED_FIELDS`与Metadata执行分支；`clean-service-host.js`的`fetchProviderMetadata`确实接入该Adapter | 支持`/tv/{id}`整剧详情/图片，但字段白名单未含`series_title`、`season_number`及`episode_*`，未请求Season/Episode详情；与Series模板要求有明确差距。整剧title尚为通用`title` |
| Sidecar生产 | `domains/libra/application/movie-production-coordinator.js`的`advance`按Artifact kind生成一个`product/season.nfo`；`clean-product-production-port.js`的`renderProductSidecar`按series选择`tvshow`根 | 当前路径未按本批Episode生成各自NFO，不能满足SSOT §5.5.5每个Episode的number/title/plot/NFO；不能用一个Season Artifact冒充逐集交付 |
| 外部寻源/落地 | `integrations/h1-provider-adapters.js`的`moviepilotSearch`将请求`requestedEpisodeKeys`放入候选；`moviePilotOutputSnapshot`要求视频数恰好1且输出空Episode claims | 已有Series namespace分支不代表真实覆盖；候选覆盖应依据实际证据，落地需接入有界Primary集合及Claims，保持Procurement Owner |
| N:M与空间 | `domains/arca/model/material-episode-claims.js`及PBF-20测试；SSOT §3.2.6/§5.5.8 | Claim Set结构覆盖一文件多集；不等于生产、空间计算及Inventory完整实现。多part、共享文件的逐集大小归属须核对既有合同，若真有缺口先明确合同，不用臆定分摊公式 |

上表路径均相对`media-service/src/helix/`，标明`clean-*.js`的路径相对`media-service/src/`；测试路径相对仓库根。这里只记录已读入口及直接依赖，未完成全链路审查。

## 执行命令与结果

Windows，Node `v25.9.0`。使用主工作区已恢复的外部依赖，通过本次命令进程的`NODE_PATH`解析；执行的是当前隔离工作区测试及源码。未复制依赖、未建立junction、未改锁文件；测试使用临时目录/数据库，无生产连接或媒体处置。

```powershell
$env:NODE_PATH='E:/my_project/emby_third_party-helix/media-service/node_modules'
node --test media-service/test/helix-architecture/p14-series-handoff-a.test.js media-service/test/helix-architecture/p14-series-run-layout.test.js media-service/test/helix-architecture/p14-series-run-lifecycle-continuity.test.js media-service/test/helix-architecture/p14-pbf20-episode-claims.test.js
```

结果：13 tests，12 pass，0 fail，1 skipped。通过覆盖：Claim Set闭合形状、重复/篡改/排序/非Primary反例；布局不跨Season误挂附件；当前Binding冻结及Subject scope漂移；N:M Comparable Basis重建及Binding/关系变化fail closed。被跳过的Series纵向fixture未产生通过证据。

未测：真实TMDB/MoviePilot、真实媒体Probe/转码、完整Series Host两次Handoff与Commit、浏览器、Linux/Docker、全量Movie回归。纯准备文档本轮不做Service/Docker/Desktop构建；这些验证仍为后续开发/发布门槛。

## 隔离样本矩阵草案

以下定义输入及预期结果，尚未创建真实媒体fixture或执行完整场景；不读取生产素材充当可破坏样本。

| 场景输入 | 必须观察的结果 |
| --- | --- |
| 首批S01 E01/E02；同Season再到E03 | 初批唯一Season Subject/Entry；后批exact claim零重叠extension、新Run冻结E03、同Entry扩充，旧事实不改写 |
| 同名不同Series/Season；无claim/多义/重叠/重复 | 不按标题/路径猜测合并；按SSOT建立新Subject或正式冲突结果；重复命令/Commit无重复事实 |
| E01–E02共文件；E03多part；共享NFO/图片 | 每物理成员只出现一次，1..32 bounded claims/覆盖完整；完整关系穿越两次Handoff和Inventory；共享材料退出不误删 |
| 缺Episode元数据、身份纠正、单成员失败、Provider超时 | 明确未就绪/失败结果，范围与重试遵循Owner；不可用空字段或请求Episode keys自证完成 |
| 逐集超限、整季总量大、低于上限的合格HEVC | 按本批Episode验收；整季总量不阻断；已合格不为贴近上限重处理；N:M计量先确认合同 |
| 进程退出、Effect前后故障、同Entry并发Commit、Aftercare/退出 | 有界恢复及唯一Commit/库存事实；旧Run与其他Movie/Season保护；真正危险动作按精确范围确认 |

首版普通Season范围沿SSOT，S00仍待适用合同复审；目前Provider identity校验要求positive Season Number。不能把实现限制默认为新的产品合同，也不擅自扩展已确认规则。
