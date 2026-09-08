# NFO UAT前后合同核对

2026-09-09，用户提示NFO UAT可能前后矛盾后，按现行SSOT全局复核。本文为证据，不是新计划或新合同。结论：确有已被取代的旧验收要求；不能以“所有历史测试通过”证明当前产品正确，也不能把取消呈现比较扩张成删除权限。

## 时间与效力

| 原记录 / 当前UAT | 当时要求 | 当前效力 |
| --- | --- | --- |
| 2026-08-30 PROD-028 / 171 | 不比完整字节，但比较title/year/plot/genre/演员与accepted Facts，差异触发呈现修复 | **持续语义匹配要求已被取代**；“不要与外部编辑抢写”和必要Inventory记录收敛继续有效，由210承接 |
| PROD-040 / 183 | 同一Run已Placement材料的恢复须有durable prior Placement provenance，不能只认原offloadContext | 精确来源/同Run恢复证明仍有效；不恢复旧的常驻呈现全等门禁 |
| 2026-09-05～07 PROD-065 / 208 | 原NFO观察witness不可变，源当前版本凭exclusive mapping及事实连续性安全处置；当时要求Final匹配全部accepted Facts | **Final持续匹配内部呈现要求被后续修订取代**；原witness、准确物理归属、授权与删除前稳定快照仍有效 |
| 2026-09-07 SSOT“User-visible work, bounded Care and file coexistence amendment” | 明确优先于冲突的NFO持续呈现一致性条款；上架与保有不因演员/剧情呈现差异而拒绝或反复改写 | 当前有效 |
| 2026-09-08 SSOT“Aftercare健康检查更新与上架后处理合同统一修订” / 210、214 | 当前Movie默认NFO存在、非空、可读；已知资料文件变化只更新必要Binding，保留字节、零Case；人物走正式观察入口 | 当前有效；明确优先于9月7日冲突条款，不反向改写内部Identity/Media-Cast |
| 211 | 成功Settlement后的历史路径不再是当前健康义务 | 已独立关闭；不要求删除那里后来出现的额外NFO |

证据：SSOT第441行的旧PROD-065正文、第3847行源范围限制，与第15376～15449行带明确优先级的两次修订；`PRODUCTION_DEPLOY_ISSUE_LOG.md` §29、§40；`PROD-065_FORMATION_STALL_20260905.md` §8～10。旧段仍保留历史传播痕迹，不能越过后续优先条款独立充当验收Oracle。无需重新询问已经确认的业务决定。

## 修正后的验收边界

1. **内部事实及生成**：影片身份识别、第一次生产的补缺/生成、实际解析用途仍按各自合同验证；外部NFO不会直接成为Canonical Identity或替换已接受Media-Cast。074/075/092/096等生成器历史验收不等于允许周期性强制改写。
2. **当前Final / Inventory**：默认NFO在已声明位置存在、非空、可读即可；字段不一致本身不制造健康Gap或修复Case。变化只做有界观察、带revision/Receipt的Owner记录更新。独立明确的必要解析要求另验，不把它假定为默认要求。
3. **准备覆盖或删除旧输入**：必须证明本次精确对象、exclusive source-to-final mapping、权限及原始witness连续性；共享/未知/缺证、源关键事实冲突及删除前再次变化保持拒绝。这里的“冲突拒绝”指物理操作许可，不是对当前已上架NFO做持续内容审查。
4. **已完成旧义务**：不重新打开已Settlement的历史NFO位置，不以其后来存在为当前收藏红灯依据；211现有结论保留。

## 当前代码与测试证据的正确解读

- `clean-arca-inventory-port.js`的`verifyFinalObservation`已对Movie NFO使用`readableNfo`；`mutableSettlementBasis`/`verifySettlementSource`仍验证原witness与精确处置连续性，两者职责不同。
- `compareMovieNfoPresentation`仍有旧helper和单元测试，但当前`src`搜索仅找到函数定义，没有生产调用。其“字段冲突不匹配”测试不是当前Aftercare产品Oracle，不因测试存在重新接回运行链。
- 新补Linux 94项（真实Host含源NFO原子改写/重启、Inventory正负路径、Effect安全）全部通过。该Host使用Probe/Provider替身，只证明现有实现与恢复安全；不宣称真实媒体、真实外部服务并发写入或当前所有健康规则均已验收。
- 171/208/210继续开放，按以上现行边界补各自缺证。未新增业务行为、未改SSOT、未关闭或重开历史项；本轮仍37关闭、62开放、206承接另核。
