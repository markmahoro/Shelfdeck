# UAT-251：整理三种终局与瑕疵接纳路径审视

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
