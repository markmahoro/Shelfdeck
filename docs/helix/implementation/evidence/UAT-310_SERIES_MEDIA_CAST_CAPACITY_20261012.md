# UAT-310：Series完整演员来源关系超过Media Cast边界

2026-10-12原大江大河33集正式重处理新Run `b33e7b5ff5908c1dae99588762b32ea1bc2311df53996e3ab7c11b2ef38d0c9d`进入metadata后报`P9_MEDIA_CAST_DRAFT_SIZE`。本地实例已加载UAT-307精确同Evidence去重；67份持久MetadataObservation中66份含重复hint，按冻结sourcePriority/evidenceId排序重放后的4166条relationId全部唯一，relations JSON本身1678933字节（尚不含Draft envelope及relationDigest）。这是多来源assertion数，不是不同Person数。

现有`buildMediaCastDraft`要求完整Draft≤64 KiB；`MediaCastDraft`/`MediaCastFact`typed关系集合上限4096，且Libra `libra_product_fact_revisions.fact_json`、Foundation完整Result等仍64 KiB。因此仅修改一个guard或合并跨Evidence同名未知人物均不能成立。原结果、重复hint及失败证据保留；日志与只读核验在ignored `.codex/series-release-20261012/uat310-cast-size.json`和local-uat309.stderr.log。

待用户确认的有界方向：Series完整Media Cast最多16384条关系且完整值≤8 MiB；其他Profile保持原合同。Libra拥有完整Draft/Fact与精确来源，Foundation只持久化≤64 KiB的可验真Record/Receipt；后续消费者从同一Owner冻结来源/精确Fact引用重建并重验完整摘要，禁止latest/current fallback。传播完整链路至Promotion/Handoff、Arca自己的入藏演员事实、NFO与Aftercare读取；不由Arca旁读Libra/People，不截断演员来源，不合并跨来源无身份人物。现有16 MiB On-deck Package上限仍独立执行。

验收需同Evidence去重与跨Evidence保留、4166关系原现场、16384及字节边界/越界拒绝、丢失或篡改拒绝、原子Commit及重放、双平台完整交付及Movie/Western回归。按Playbook §3.3确认后回写SSOT并实施；当前仅调查和记录，不修改容量实现，不关闭UAT-307或整体Series发布资格。

## 用户最终决定与实施

2026-10-12用户因性能顾虑改为“只取某一个episode的演员作为该季的演员清单”，明确同意按集号取首个非空Episode、同集按已有来源优先级选择一份并去重；替代此前已同意的8 MiB扩容方案。完整来源Observation保留，演员覆盖完整性允许降低；本次不扩容、不增加演员大字段或Foundation新引用类型。实现位于Libra生成Media Cast关系的共同入口，NFO与事实组装沿用同一规则。验证进行中，未关闭UAT或升级生产。

## 当前验证

原33集现场67份持久Observation只读重放：选中Season 3 / E001的related_nfo（sourcePriority=34），演员关系由4166降至63，relations JSON 25388字节，完整Draft 31300字节；旧64 KiB边界通过。未改写现场证据。日志：ignored uat310-selected-cast-size.json。

Windows合同32通过/0失败；覆盖空集跳过、单来源优先级、输入排列不影响选择、无合格Episode为空、无效Scope拒绝、原Movie跨来源规则保持及逐集资料。双平台实际隔离Host完成重复演员NFO解析、完整入藏、整季placement迁移：Windows90.99秒；Linux完整文件94.68秒，5通过/0失败/37按名称过滤skip（含4项演员专项及1项完整Host）。入藏前后逐字节核对Media Cast事实，所有关系来自单份选中Evidence且重复演员恰一条。四项静态架构/语义/manifest/P2门禁通过。耗时属于隔离fixture，不是生产性能基准。原现场加载和重处理仍待完成。
