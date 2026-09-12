# UAT-251：整理三种终局与瑕疵接纳路径审视

## 2026-09-12 实施接续与新增授权

用户要求本任务完成UAT-251，追加“自动授权瑕疵上架”；前端UI须先与任务`01a0912a-0086-74e2-88ab-536c59d3862a`确认做法。实施基线`144798953`，隔离分支`codex/uat-251-terminal-defects`。本节之后记录实现及验收，以下旧时点审查保留，不冒充当前完成状态。

验收范围：首次三终局及不可豁免安全门禁；精确混合Gap及旧预览拒绝；持续授权启用/关闭/重启/并发及后台执行；终局安全收尾/原片保护/同条件不再进入；Arca现有差距接纳与仅手动修复、成功更新及失败保留；新损坏独立处理；同条件失败跨检查/重启抑制；协同确认后的列表/详情/设置交互、窄屏和键盘操作；Windows/Linux真实媒体与实际发布版本核验。

当前状态：核心实现及独立 Windows/Linux 验证完成，最新已上线 258/259 基线已合入，指定 UI 负责人于 2026-09-12 复查通过。UAT 保持开放，等待部署任务统一完成最终 Catalog witness、完整 Host 及生产验收。核心提交 `eae6bb3da`；合并 `31bd03b023fa779bc7390e050aa8955d75e88c06` 后提交 `874172bc6`。

本轮实现：

- 首次整理持久三终局；全局持续授权默认关闭，用户启用后按当前 Run 和精确 Gap 原子发放授权，撤销停止新增授权。身份、播放、完整性、Control、Binding、空间和当前 Basis 均不可豁免。
- 技术路径失败与业务不可达分开，Movie 当前成品的精确资料、附件及媒体差距独立取证。未知媒体/缺失播放证据不能自动放行；技术附件获取失败不能伪造 not_available 或无写入证明。
- 无法上架保留真实失败原因并完成 Control/Work/Effect/Workspace 责任收尾；同输入、要求和相关执行条件不变时抑制重新进入。用户手动意图只准入一次，同键重放安全。Handoff B 已接受不可 discard；明确拒绝可自动收尾。
- 缺失外部策略使用 Libra 自有 availability 观察，按首次观察后 1/5/15/30/60 分钟五次复核，重启不重置预算，无伪造 Work。Freshness 第五次仍不能确认时也形成合法终局。
- Arca 接受当前精确差距和手动修复意图有独立 revision、Receipt/Audit、CAS；修复成功只消除验证解决的差距，失败保留原片和授权，历史失败不覆盖当前健康。新损坏不继承既有授权；已接受差距不自动修复。
- 最终新增 8 表，共 197 表；DDL `854c22240e01915f777958ec490bf1ebad6dcc4a92f4bd6f2f032d32ac2d1312`；合并后 P2 aggregate `f88010679733e9a0d28effb67505ef32552a2369f42a13a76fbb8c8b24313d88`。最终合并后的 Catalog witness 及 full Host 门禁由部署任务核验。

本地证据（工作区 `.codex/uat251/`，不提交媒体/生产副本/凭据）：

| 场景 | 证据与结果 |
| --- | --- |
| 自动演员/外部资源耗尽/多项外部耗尽/组合差距 | 独立完整 HTTP 场景实际到达 Arca Commit，重启持久唯一 |
| 无 metadata Provider 有限等待 | `no-provider-current.log`，186.4 秒，实际五次观察、重启、自动接纳至 Commit |
| 不可播放终局与一次手动重新整理 | `unsafe-terminal-current.log`，93.2 秒，实际终局收尾、重启、相同键只建一次新 Run |
| Freshness 无 blockedWorks 的第五次失败 | `freshness-terminal-current.log`，定向持久测试通过，无伪造 Work |
| 手动海报修复成功/业务失败/技术失败 | 完整 HTTP 场景通过；`poster-technical-failure-e2e.log`，技术失败保留原片及瑕疵 |
| Windows 真实 FFmpeg | `real-media-poster-repair-e2e.log`，128.8 秒，HEVC/AAC 样片实际上架、海报修复、剩余演员瑕疵及重启 |
| Linux 真实 FFmpeg | `linux-real-media-final.log`，124.9 秒，同链通过；`linux-final-focused.log` 52 项定向通过 |
| 既有授权不覆盖新损坏 | `new-primary-damage-result.json`：本地合成已上架收藏由 healthy 出发，暂移主视频后实际健康检查得到 unhealthy/custody:primary_missing，瑕疵候选不可提交（evidence_pending），既有两项授权未覆盖损坏；原文件恢复并复查 healthy |
| 完整生产副本 Schema | `production-copy-final-schema.log`、`production-copy-schema-result.json`：189→197、强制异常原子回滚、188 张原业务表逐行字节摘要一致，118 收藏、7 历史显式用户放弃保持；quick_check/FK clean；冻结原副本未修改 |
| Web | 合并后 `merged-web-tests.log` 105/105，`merge-web-build.log` 通过 |
| 架构 | `merged-architecture.json`：dependency/semantic/contracts 通过；仅 P2 合并计数断言与联合 Catalog witness 两项失败。前者 `merged-p2-focused.log` 已修正复验；后者交部署任务按当前递归 Schema 闭包更新，未放宽校验。Handoff B 拒绝自动收尾及冻结 DDL 迁移 `merge-terminal-migration.log` 19/19 |
| UI | 指定负责人复查 `874172bc6` 及 `ui-merged/` 全部 10 张 1920×1080 图片后通过。`31bd03b` 与当前 JS/CSS 同数据 18 单元格几何零变化，仅无法上架详情入口“—→查看过程”；取消/Escape/焦点由实施任务复验，UI 负责人明确未代为重跑交互测试。旧 `ui-final/` 非最终证据 |

合并版本实际新建 16 个 Plan 的 executionCatalogDigest 均为 `d8d6a237f3cdcda20b1548d5064b94dc483cf58da1ed2ca326f5e1ca2cfb6a74`，enabled Capability 87；与 31bd 比较的 20 个 Schema 文件变化见本地 `merged-schema-change-list.json`（12 新增、8 修改）。Catalog 值相同不代表递归 Schema 闭包相同，联合 witness 仍需精确核验。

限制：独立 UI fixture 的媒体探针为测试替身，真实媒体证据为上述 Windows/Linux 独立链；尚无最终合并版本生产验收。不得覆盖最新 UAT-260/261 或部署事实，不独立部署 NAS。

2026-09-08。基线159619ab8及后续文档提交；只读SSOT/代码审查与本地既有定向测试，无SSOT修改、生产或媒体副作用。用户最终意图：成功上架、瑕疵上架、无法上架；不能以条件不变的放弃→重新采购循环代替终局。Aftercare已经拥有收藏，对应维护成功、接受现有瑕疵、无法完成本次维护；后者不自动退出收藏。

## 已证实发现

| 发现 | 合同/代码证据 | 判断 |
| --- | --- | --- |
| 长期失败只冻结、等待用户discard | SSOT §5.6.7、L5-Q7、§9.5.3；libra-run-coordinator.js terminalWork调用freezeFailedWork | 现有合同明确如此，与新三终局意图不一致，须先改合同；不能只把frozen标签改为无法上架，因为仍持有责任/Control |
| discard允许相同来源重新进入 | SSOT §5.3.7、§5.6.7、§9.5.3；libra-run-admin-service.js discard提交后释放pipeline席位并wake | 不会自动discard，但用户放弃后没有必须出现新条件的再进入合同；同源/同Spec/同环境可能重复失败。不能声称所有discard一定循环 |
| 瑕疵入口按失败来源封闭匹配，而非所有成品差距 | defect-admission-contracts.js：仅actor_unavailable/external_source_exhausted/size_cap_exceeded，要求一个精确terminal blocker；Manifest最多两类 | 三类路径并非没有实现，但不覆盖所有不可达目标；具体错误码/Capability不在集合就拒绝，需审查“有可用产品但路径失败”的处理 |
| 技术失败与业务不可达混在frozen展示 | external search失败也进入terminalWork；UAT-250活着的P5_PROVIDER_RESPONSE_INVALID不在可接纳集合 | Provider响应无效不证明没有合格资源，也不证明影片无法上架。应保留技术失败分类/恢复条件，不能直接扩大豁免或宣告永久不可达 |
| Aftercare没有新瑕疵接受路径 | §9.5.4只有检查、修配置、Off-deck审阅；CareWorkRow无接受操作；authorized-defect-manifest消费Libra既有Manifest，Case终态只有resolved/invalidated/unresolved | 上架后新Spec无法满足时无法由用户正式接受当前差距；已有上架瑕疵继承不能代替新增授权能力 |
| 不可处理与多种处理组合缺少用户终局操作 | aftercare-contract.js dispositionFromAssessments/assertProcessingRequirement：不支持目标或不兼容组合进入attention；coordinator多处stopCase unresolved | 未解决结果能保存，但没有统一解释可接受性、具体阻断和重试条件；不能把所有attention都说成等待修复 |
| 新检查可能在相同业务条件下再建Case | aftercare-store.js createCase只对同trigger去重；trigger含assessmentWorkId，新的周期检查可形成新generation，即使basis/finding/requirement相同 | 单条Work有有界replacement，不等于同一不可达问题有跨Case终局。属于代码允许的重复路径风险，未进行多日生产复现，不称无限循环已实证 |
| 前端隐藏瑕疵预览失败原因 | FormationPage.tsx previewDefectAdmission.catch统一setDefectEligible(false) | 无资格、接口故障和缺证据都表现成没有按钮，用户无法判断为何不能接受；需显式呈现资格及阻断原因 |

## 现有可用能力与不能放宽的事实

Libra的演员缺失、外部寻源耗尽且原片安全可用、质量保护下仅体积超限三条接纳路径已有精确证据和授权Manifest；Arca消费同一授权继续验收，Aftercare只忽略被该Manifest覆盖的要求。不可把所有失败视作缺失瑕疵能力。

SSOT现规定身份不明、Primary不可播放、Integrity/Binding/Containment/Control、stale basis、Shelf inactive、空间接管失败不可豁免。用户新终局目标不授权伪造文件存在/可用或取消写入安全。技术失败也不能自动当作可接受产品瑕疵。

## 建议合同方向（待具体设计，不是已实现）

- 明确本次整理的业务结果：正常成功、用户授权的瑕疵成功、当前条件下无法完成。等待资源/暂时重试/待用户决定是过程态，不冒充终局。
- 判定优先看实际候选成品、已证实Gap及可豁免类别，再结合外部路径耗尽证据；技术失败与目标不可达分开，显示为什么没有瑕疵选项。
- 无法上架形成持久原因、处理依据、可恢复条件和合法责任收尾。重新处理需要用户明确发起或有与失败原因相关的条件变化；阻止同一失败条件无意义自动重入。具体在哪个Owner维护观察资格/失败记录须回SSOT确定，不能给Procurement塞Libra内部事实。
- Aftercare新增接受现有瑕疵的Arca授权合同：绑定当前Entry/Inventory/Spec及精确Gap；同条件不再自动修同一已接受差距，新差距不得继承旧授权。接受瑕疵与本次维护失败事实分开，绝不回写失败Case为成功。
- 用户主动取消与系统无法完成分开；前者若保留，不能默认等于重新采购。技术故障提供针对性的恢复条件，避免无条件重跑整条链。
- 保持已确认灯色/工作区语义；新增已接受瑕疵在收藏健康中的呈现必须写清，不可直接把技术失败刷绿。

## 关闭场景

正常达标；可用原片不达规格且寻源耗尽；质量底线与体积不可兼得；演员/海报资料不可取得；混合缺口；Provider断连/无效响应；真实文件不可用/身份冲突；策略变化后的Aftercare不可达；失败条件不变跨周期/重启不重复生成同一处理；新输入或相关配置改变后合法新处理；列表/详情明确结果、接受资格及原因。每场景独立Evidence，覆盖正常上架、瑕疵上架、无法完成的责任与文件收尾。

## 验证与限制

执行node --test test/helix-architecture/p15-uat126-defect-admission.test.js：6/6通过，证明现有三类接纳、Provider故障拒绝及Arca精确授权消费行为。未运行新三终局E2E，未修改业务代码；本审视不是UAT-251关闭。关联UAT-210/213/217/218/250；不重复实现其评分、码率或存量问题。


## 本轮独立UI修正（2026-09-08）

瑕疵预览新增loading/eligible/ineligible/error四种明确状态；只有正式P9_DEFECT_ADMISSION_INELIGIBLE结论显示当前证据不支持，网络/服务/其他证据错误保留检查失败提示及只读重试入口。旧Run revision请求迟到不得恢复接纳按钮；接纳仍走原显式确认和服务端fence。

确认文案移除“入库后不会由售后继续补齐”的永久性承诺，改为本次列明瑕疵与文件安全检查边界。没有实现新的瑕疵类型、有限终局、Aftercare修复入口或重复Case治理，不能据UI修正关闭251。

Web56 PASS（其中3项验证请求失败重试、明确不合格、旧revision迟到隔离），Web build PASS；真实浏览器尚未完成该分支验证。浏览器连接恢复后仍出现读取超时，已保留为未验证项。

### 终态原因展示的独立修正

冻结仍为内部现状，但列表/详情共同查询不再要求用户理解冻结或默认放弃后重新采购。演员缺失、Handoff B拒绝、无合格/可获取候选分别保留原因并指向已有操作；P5 Provider技术失败优先于旧空候选Evidence，不能误报寻源无结果。此修正不改变Run状态或自动恢复，不声称三终局合同已完成。36项Formation真相/投影测试通过；同时补齐UAT-212新增endedCount和实际已完成动作展示的旧断言，阶段仍等待时不伪造阶段完成。


真实Edge本地合成验收：18183独立fixture首次GET瑕疵预览返回503，表格明确显示“暂时无法确认瑕疵接纳条件”和“重新检查”；用户点击重新检查后，第二次GET成功并出现“接受瑕疵”。仅使用合成电影和只读预览，没有提交接纳或触碰生产Run。证明预览失败不再静默消失；不能证明新的业务接纳范围或生产闭环。


## 2026-09-09 用户明确决定

本任务两项具体问题均已收到用户回答：仅用户手动发起已接受瑕疵修复；安全且可播放时健康正常，另显示已接受瑕疵标记。已回写SSOT末尾UAT-251有界修订。相关条件改变不自动修复，失败保原片原瑕疵并结束本次尝试；新损坏仍独立健康问题。此为合同确认，尚不代表实现或251关闭。

### 2026-09-09 typed约束传播

SSOT已细化精确Gap身份、资格/路径结果分离、不可豁免Fence、三终局及责任收尾、Libra本地再进入判定、Arca接纳决定/手动意图、修复提交/失败和跨Case有限性。没有转移Owner、授权Reset或把旧冻结当成已完成。P2派生基线通过；新DTO/schema、原子持久化和执行接入尚未完成，251保持开放。

实现定位：Arca当前findingDigest基于kind/code/basis，Finding实例ID另外包含Assessment Evidence ID；CareRequirement.requiredEffects仍引用实例ID，triggerDigest又包含assessmentWorkId。因此跨Case去重不能直接依赖整份旧Requirement digest或检查Work ID。当前projectHealth还把同Basis unresolved Case优先于健康Evidence，该分支需与手动瑕疵失败保原片、健康独立投影一起修正。不能仅删判断后宣称手动修复链完成。

## 2026-09-09 既有Arca授权事实盘点

对841cbcf0c7发布前一致只读备份查询，arca_inventory_product_facts存在40条AuthorizedDefectManifest/v1记录，defectCount均1。它们是既有Inventory事实，不是可清理的未完成Formation数据；新精确Gap/有效授权与修复意图接入必须保留原始字节/历史结果，不能把严格新schema直接用于否定既有授权。此数是历史fact行，不等于40个当前收藏。只读脚本`.codex/uat251-manifest-scope.cjs`；未执行生产修改或新增兼容代码。
