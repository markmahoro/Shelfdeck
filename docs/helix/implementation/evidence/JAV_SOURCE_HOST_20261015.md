# JAV 来源、人工确认与 Service 回归证据

## JAV-WORKBENCH-RECOVERY：工作区承载切片（2026-10-15）

用户确认后，独立Correction通过Arca公开只读`GET /v1/admin/collection/jav-corrections`进入工作区维护任务流，不生成Aftercare Case或Libra Run。八种业务/cleanup组合有界分页、片名/收藏架筛选、分类计数、绑定筛选的cursor及correctionId精确定位已实现；Foundation public progress reader提供真实Work/Plan/Event的只读过程，未按固定步骤伪造执行事实。收藏核对窗口提供查看维护任务，取消仅在工作区交互区，保留后果勾选、同key网络重试、并发拒绝后清除授权及真实Owner复验。必要清理完成前不归类completed。

本切片Web 177 pass，build通过；宽1920/窄390 Playwright共10 pass（9.0秒），包含收藏→精确任务→只读过程→交互区取消/失败重试/取消完成，axe通过。已视觉查看窄屏后果确认和宽屏取消结果，原有初次番号、正常纠正及目录流程继续通过。真实Host实际视频→唯一入藏→公开纠正确认即能查询到维护任务→完成后七个真实Foundation Work/Plan及completed分类→重放/原视频/原Commit保持，1 pass（53.35秒）。SQL分页80项/八阶段无漏重、过滤/游标及原Aftercare过程组合8 pass；P2/新查询/过程组合9 pass；入口/TMDB组合26 pass/2历史skip；包边界与语义扫描通过，无新豁免。最初P2因新增route导致SSOT source-map位置变化拒绝，按正式materializer重建后严格通过，未放宽检查。

日志与冻结输入receipt在ignored`.codex/jav-development/workbench-qualification-20261015.json`及其四份log；3130输入SHA256 `60c6d8b27fdf755071587ff09b03fa92d1b8cf9013f128ef85dec25e46114ab1`，JS `index-B8PFVrDV.js` SHA256 `06e43a3af8b1e5c64aa7b7a47b595ef59b9940c54600e01fa0ce502e84706abe`，CSS仍82cb8561...。当前146 routes/145 Admin/119 real，P2 `a6d6375b9e705a2c28ee23c6a21cfd9546852349ec9da65e5ea9c747fd946bfa`，121/104/202/50不变。本切片不包含终态失败恢复执行，也非新版本全架构/负责人通过；已向此前获准联系的UI负责人同步旧版本结论不能覆盖这些改动。未操作Desktop/NAS/用户测试材料。

2026-10-15 UI审核提交：用户明确授权后，已将`.codex/jav-development/ui-owner-review-handoff-20261015.txt`发送给“UI负责人”（01a0912a-0086-74e2-88ab-536c59d3862a），消息工具成功返回该threadId。提交前核对3125份冻结输入无变化；发现dist中的JS不是记录产物后重新执行Web production build，JS `index-jnDQRjjV.js` SHA256 `be48d04168d3079b3efe301e5a584a8a199dfa1857a40f486f103634c8012abc`、CSS `index-BYV0LKeb.css` SHA256 `82cb8561be6544293d0f6850171d0df02a9a97e53bf60a075ec262ede15df4e2`均与真实浏览器receipt一致。审核范围、截图、测试及终态恢复/Linux/生产副本未完成边界已随材料发送；发送成功不等于审核通过。

2026-10-15当前输入整合复验已完成：`architecture-current-ui-20261015`实际321文件、2704 tests，2692 pass/12 skip/0 fail（1048.91秒）。3125份Source/scripts/test/Web输入前后均为c7f8ae71e3144d7a36e0e1ea7c595ad8be1e655f628e64cc4e9bcddf0ad78a41，inputUnchanged=true、完整receipt ok=true。新input/result/log与前轮分开，原前轮测试成功/全输入守卫失败记录不改写；不再用前轮Annex替代这项完整同输入结果。排除长JAV Host文件，其各条Host/真实浏览器证据单独记录；12 skip中实际Movie三条与Series三条恢复已有显式启用的无skip复验，历史Movie-only负向占位不作新JAV资格。Linux/终态恢复合同/真实生产副本/负责人门禁仍未关闭。

## 真实浏览器入藏后纠正与架构后端结果（2026-10-15）

当前构建的真实Service浏览器Probe扩展到入藏后“核对影片”：宽/窄各1 pass、无skip（133.30秒，`real-jav-correction-ui-final-20261015.log`）。完成初次人工确认及实际入藏后，浏览器从收藏详情进入核对，查询IPX-178，显示新旧影片及四项材料/八个旧新位置，未勾选时禁止确认；实际POST202后不再显示号码编辑框，只有cleanup completed才出现“身份已纠正”及“完成”。关闭后收藏显示Corrected JAV film。无浏览器业务API拦截；Source HTTP仍受控，不以此宣称实时全站资格。

独立SQL/字节断言保持同一Entry、同一Primary Physical Material key及视频字节、原唯一On-deck Receipt digest、Libra原IPX-177身份Fact；只有Arca Canonical/Inventory前进到IPX-178。原有Candidate/确认重放/首次锁定与Artifact入藏断言仍执行。宽/窄预览axe及无横向溢出通过，窄屏预览、宽屏完成已视觉检查。初次Probe只因响应监听器误匹配`/jav-corrections`而timeout，按实际`/actions/confirm-jav-correction`修正，没有产品代码变更或降低状态断言；失败日志`real-jav-correction-ui-wide-20261015.log`保留。

JS/CSS仍为上节具体摘要，运行前后保持；receipt现包含两尺寸各确认/收藏/纠正收口三阶段。截图位于`.codex/jav-real-browser/real-service-1920/`及`real-service-390/`，含correction-preview/completed。任务自有7109/11720端口均无listener；fixture媒体及数据库已按原精确临时根清理。整体跨层UI负责人门禁仍开放，没有因本轮视觉/交互证据自行关闭。

冻结架构轮已终结：321文件、2704项，2692 pass/12 skip/0 fail（1057.74秒，`architecture-integration-frozen-fanart-20261015.log`）。全输入守卫因两Web文件变化正确返回ok=false，不能称全输入一致PASS。独立只读Annex核验3011份非Web输入前后均为fe87fdbaaa1bdcd9f29d51e098ba23531d303c411e4eabb729cef436180adbd9；变化仅helix.css及jav-identity.spec.ts，由当前Web175、Playwright10、真实浏览器证据承接。Annex scope仅backend-input，保留全守卫false，见`architecture-frozen-backend-annex-20261015.json`。实际Windows独立分发测试也在该轮通过；Linux、Recovery Intent与真实生产规模副本资格不因此关闭。

## 当前构建与真实浏览器确认旅程（2026-10-15）

新增ignored真实浏览器probe：只在内存中加载已有JAV Host fixture并把“确认”调用交给实际Admin Web，设置/观察由隔离fixture准备；Service所有浏览器业务API不拦截、不补响应。外部资料站仍为受控HTTP，视频是fixture实际FFmpeg生成。两种尺寸1920×1080、390×844均完成：显式CID无身份→只读过程详情→交互区查询/可解码预览→修改输入阻断旧选择→Escape及焦点返回→重新查询/实际POST202→实际身份锁定/加工/唯一Arca Commit→真实收藏海报及核对入口。原有Candidate不可变、重复确认Receipt及确认后异号拒绝断言继续执行。

首轮宽屏通过、窄屏失败；诊断dialog clientWidth350/scrollWidth351，实际长Windows源路径使grid按min-content扩张，未把1 px溢出当作通过。修复identity-picker为minmax(0,1fr)、允许内容换行、dd就地对齐及预览子项收缩；新增长目录E2E样本及窗口无横向溢出断言。原截图与Playwright输出目录曾发生runner清理冲突，probe现独立写`.codex/jav-real-browser/`，不与`.codex/jav-browser/`复用。

最终真实浏览器2 pass/0 skip/0 fail（81.20秒，`real-jav-workbench-ui-long-path-final-20261015.log`），实际业务API routeInterceptions=0。预览与收藏dialog的axe、图片解码、布局及可达确认通过；宽/窄预览及窄屏收藏结果已视觉检查。Probe metadata在`real-jav-workbench-ui-receipt-20261015.json`；当前JS `index-jnDQRjjV.js` SHA256 be48d04168d3079b3efe301e5a584a8a199dfa1857a40f486f103634c8012abc，CSS `index-BYV0LKeb.css` SHA256 82cb8561be6544293d0f6850171d0df02a9a97e53bf60a075ec262ede15df4e2。运行前后两类Artifact摘要保持。

当前构建通过；Web175 pass（17.17秒，`jav-long-path-web-tests-20261015.log`），既有宽/窄Playwright10 pass（9.2秒，`jav-long-path-playwright-final-20261015.log`），新增长路径断言未省略。任务自有两个真实Host端口10090/2047及preview18194均已无listener。具体版本跨层UI负责人验收仍未完成，本probe不替代负责人结论。

冻结架构轮尚在运行；只读核对其3125份输入目前仅两份Web文件变化（helix.css及jav-identity.spec.ts），Service/backend输入保持。原全输入守卫仍将如实判定变化，不伪称整轮是最终全部输入版本；本次UI改动由上述当前构建及适用Web/真实浏览器证据承接。未新增Desktop、生产写入或用户原材料改动。NAS临时Linux授权及Recovery Intent决定仍待明确回复。

## Series 实际进程恢复与整合收取（2026-10-15）

显式启用HELIX_SERIES_AFTERCARE_RESTART、HELIX_SERIES_EXTERNAL_RESTART及HELIX_SERIES_OFFDECK_RESTART，三条已有隔离真实进程恢复全部通过、无skip（343.45秒，`series-real-recovery-after-fanart-20261015.log`）。覆盖N:M媒体维护在Materialization之后/Inventory Commit之前退出并以新Host完成、外部Transcode在来源结算后/On-deck Commit前恢复、N:M Off-deck删除后/terminal Commit前恢复；使用各自原有Receipt、材料/集数映射和唯一终态断言，不修改生产或旧UAT事实。

上一架构整合已终结：实际321文件、2703 tests，2690 pass/1 fail/12 skip（1081.60秒，`architecture-integration-after-fanart-20261015.log`）；此前运行中记录的319不是该轮实际清单数量，保留历史而在此纠正。唯一失败为Series NFO Presentation fixture在范围收窄前加载的fanart检查意外要求完整Identity。当前代码已限JAV；失败文件加范围/来源/Planner组合113 pass、无skip（`fanart-series-nfo-failure-recheck-20261015.log`），没有补造fixture身份或放宽Invariant。新整合轮运行前冻结Source/scripts/test/Web输入摘要，结束后比较相同输入；日志`architecture-integration-frozen-fanart-20261015.log`及独立input/result JSON承接结果，不覆盖初轮失败。

NAS只读检查确认既有ShelfDeck仍运行相同immutable image，可用内存约4.5 GiB；未创建容器或写NAS文件。临时Linux worker方案、本机Source tar及SHA/命令语法已准备，待用户明确授权NAS临时容器：1 CPU/2 GiB、network none、read-only root、无host mounts/ports/volumes，只有容器内tmpfs，结束按精确容器名清理。此方案只验证当前代码在既有Linux image的依赖/运行环境中执行，不代替候选Dockerfile构建、实时Source或真实生产规模升级资格。资料位于ignored `linux-worker-prepared-plan-20261015.json`与`linux-worker-readonly-capacity-20261015.json`，不记录Secret。

## JAV 收藏退出、注销与实际 Movie 媒体回归（2026-10-15）

新增两条隔离真实Host运营旅程，不修改生产实现或用户媒体。非空JAV Shelf注销1 pass（35.57秒，`jav-collection-operations-host-20261015.log`）：从实际JAV入藏产生的四份Inventory材料出发，经公开Shelf GET/明确保留文件与释放Control确认/注销POST到deregistered；逐文件原字节、无关文件、原Canonical及原On-deck Receipt保持，四份Control均released且没有Off-deck破坏Receipt。

同一组合中的首次Off-deck测试失败，因为新入藏健康检查仍运行时合法Review state为preparing，fixture误要求立即open；没有产品缺陷或放宽授权。修正fixture经公开GET等待现有后台收口，等待期间逐文件校验未改变，达到open才确认/授权。独立复验1 pass（65.86秒，`jav-offdeck-safe-review-host-20261015.log`）：Review scope恰四个实际Material key，非high-volume选定后授权，一Case completed/Entry offdecked、一terminal Receipt、四份Deletion Evidence，四份目标文件消失、Control released；无关文件及原Canonical/原唯一On-deck Receipt保持。初轮1 pass/1 fail保留为独立记录，不将其计为整轮通过。

显式启用HELIX_UAT137_REAL_MEDIA的三个既有Movie实际FFmpeg用例全部通过、无skip（1.38秒，`movie-real-media-after-fanart-20261015.log`）：历史标签不替代当前Product解码、损坏Source不替代Product资格、损坏Product仍发布playback_decode_failed。没有重新关闭或改写原UAT。Series维护/外部转码/退出的实际进程恢复已显式启用并运行；319文件整合也保持运行，结果未收取前不作通过结论。

## 背景图独立维护（2026-10-15）

当前Standard明确要求fanart时，Arca沿当前accepted同站资料与当前技术Handle派生uncropped背景图；与poster采用独立Plan节点、Artifact类型、Workspace输出和MaterialEffectReceipt.artifactKind。Inventory角色取当前Receipt声明类型，缺失/未知类型拒绝，不以图片扩展名猜测；旧Receipt不改写、未完成旧Case无兼容读取。SSOT对应段与生成Schema已同步，P2当前aggregate为b9eae8313bce1eb107eef441546b36efe1a813070c906adbfb0fab6d4529307b，121/104/202/50计数及DDL结构保持。

实际首轮暴露fanart替换错误复用poster退役筛选器：背景图文件已恢复，但原海报被移出Inventory并另起Case修复。诊断日志`jav-fanart-maintenance-host-diagnostic-20261015.log`保留；修复为按明确Artifact角色定位/退役，未削弱只允许一个Case/一个acquisition的断言。最终fixture独立核验另一张图片的Inventory绑定、原字节及原Control完整保持。

真实Host三条维护通过（119.05秒，`jav-all-artifact-maintenance-final-20261015.log`）：NFO、poster、fanart各自仅修复目标，保留其他图片/视频/Canonical及原唯一On-deck Receipt，旧目标Control释放，fanart crop=NULL且materialization Receipt类型为fanart。纠正后背景图维护1 pass（60.00秒，`jav-corrected-fanart-maintenance-host-20261015.log`）：只查询当前IPX-178/Correct02，保留新海报及视频。所有请求受控，不代替实时站点资格。

来源失效Host 1 pass（99.03秒，`jav-fanart-source-failure-host-20261015.log`）：3个有界failed Effect完整保持，Case unresolved，没有Aftercare Artifact或目标写入；原Inventory/其他图片/视频/Canonical/Receipt保持。修复适用范围明确限JAV，非要求fanart的JAV、Movie、Season均不新增背景图义务，直接Presentation Capability无写入测试覆盖这四种情境。最新模型/Planner/来源/Series组合102 pass（`jav-fanart-scope-final-tests-20261015.log`）；初轮101保留，不冒充同一轮结果。

Service根测试670项（641 pass/29 skip/0 fail，141.15秒，`service-regression-after-fanart-20261015.log`）通过；P2、模块边界、语义与diff检查通过。319文件架构整合仍运行，启动早于最后JAV范围收窄及新增范围测试，不作最终版完整资格。Linux、真实规模副本、终态文件失败恢复合同与具体版本UI门禁仍开放；无Desktop、生产或用户原测试集改动。

## 维护恢复条件与特殊来源（2026-10-15）

修复JAV海报维护仍冻结TMDB条件的错误：现只读取当前accepted站点的`jav-<siteRef>`公共Platform语义摘要，Movie/Series保持TMDB，媒体加工保持media_compute；无关站点、配置revision/测试时间/命令不构成相关语义变化。41项恢复条件/Source/Case回归通过，P2保持b61d66725c9f5145a08fc7b4a71915ae4f138d9a951f24c2d8eee3501870712d，边界/语义/diff通过。合同细化已同步SSOT与Source Map，没有新的Correction恢复Intent。

实际Host恢复1 pass（97.35秒，`jav-aftercare-source-condition-recovery-host-final-20261015.log`）：原源失效→有界3个failed Effect/旧Case unresolved→显式配置同站新route→新Case resolved；两Case的条件均为jav-javdb且语义digest不同，旧失败历史完整保持，新海报证明configRevision2，视频/NFO/Canonical/原Receipt保持。fixture通过受控fetch验证新route合同，不证明测试代理端口实际可用；新连接测试合法搜索与维护固定资源请求分别按操作核验，未放宽后者。

特殊来源维护2 pass（76.89秒，`jav-special-source-poster-maintenance-host-20261015.log`）：FC2-718323官方站与GETCHU-4052694，各自完整入藏后缺海报→本站修复→resolved，保留seller/circle角色、唯一当前海报/旧Control释放及原视频/身份/Receipt；无其他站点补图。这些受控Host旅程不替代实时网站资格，也不代表全部类别维护或最终跨平台/版本发布资格。无Desktop/生产或原测试集改动。

## 已入藏海报维护及纠正后来源（2026-10-15）

Arca海报维护现在从当前accepted Metadata取得固定站点/native resource/番号/title/cover digest，使用同站当前技术Handle，独立保存当前config/route/观察及crop/output证明；不回到legacy Provider、不换站拼图、不修改原Metadata资格。当前配置续签的Platform实测、旧Handle拒绝及Libra旧配置围栏保持通过。JAV的NFO/海报缺失都在Case admission前要求对应精确Material的Custody缺失Evidence；没有放宽覆盖权限。

真实Host：缺失NFO/海报2条通过（76.96秒，`jav-aftercare-artifact-host-final-20261015.log`），唯一当前Artifact、旧Control released、视频/Canonical/NFO及原唯一入藏Receipt保持。纠正后海报修复1条通过（47.58秒，`jav-aftercare-corrected-poster-host-restored-20261015.log`），只查询当前IPX-178/Correct02，不回到原影片。该旅程暴露压缩Metadata Record的来源引用未恢复；现按Correction公共Work Result Reader取得唯一匹配Source Result，完整核验record/source/payload/hints/source Fact digest后恢复只读视图，原事实和Receipt不重写。首次fixture失败另有cold-inspection helper关闭Host及查询错误列两项，均按实际Host/表关系修正，没有弱化业务断言。

实际封面失效1条通过（96.31秒，`jav-aftercare-poster-no-write-effect-qualified-20261015.log`）：既有有界3次prepare lineage均保留failed Attempt/Effect，无维护Artifact注册、无目标写入，原Inventory/视频/NFO/Receipt保持。用公开check收取耗尽后的Case outcome为unresolved；不以测试直接修改Case/Work或清数据。Source/Record恢复及JAV/Movie/Series、Case/Effect保护89 pass/0 skip/0 fail（8.23秒），日志`jav-aftercare-contract-final-20261015.log`。P2维持121/104/202/50及aggregate b61d66725c9f5145a08fc7b4a71915ae4f138d9a951f24c2d8eee3501870712d；边界、语义、Source Map及diff资格独立核验，不冒称最终整合或完整发布PASS。来源恢复条件映射、其他类型维护及最终版本资格仍需核对；恢复Intent/Linux选择等门禁仍开放，无Desktop/生产或原测试集动作。

## 已入藏 JAV NFO 修复（2026-10-15）

先复现两个实际缺陷：普通Movie NFO renderer重建JAV时丢失番号；Custody检查后、Presentation检查前NFO丢失，使新Case只有presentation缺失目标，正式替换因缺精确Custody缺失证明停止。现在JAV从已接受Metadata/Cast及当前Canonical号重建精确uniqueid，拒绝CID/非canonical号和外来/冲突身份；已声明NFO缺失而Custody缺少该Material的对应Evidence时，在Case admission前新发当前Basis检查。没有放宽覆盖权限，没有用另一Artifact的缺失证明替代；必要合同补充在SSOT。

最终实际Host 1 pass（40.7秒，`jav-aftercare-nfo-host-final-20261015.log`）：完整入藏后删除自身fixture NFO，通过公开check入口修复并resolved；唯一Case含custody+presentation缺失目标，当前恰一份新NFO，旧NFO Control released，Primary Control/视频/Canonical不变、原唯一On-deck Receipt digest不变、无新来源请求。JAV/Movie/Series NFO、Case状态机及文件副作用保护组合92 pass/0 skip/0 fail；边界/语义/diff与P2通过，121/104/202/50和aggregate b61d66725c9f5145a08fc7b4a71915ae4f138d9a951f24c2d8eee3501870712d保持。此项不是封面修复或全部Aftercare资格；JAV封面维护来源接入仍需单独验证。

此前318文件整合已exit0：2690 tests、2678 pass、12 skip、0 fail，1057.7秒，排除长JAV Host文件。日志`architecture-integration-after-cid-20261015.log`保持独立；它早于本轮NFO改动及部分Kernel变更，不能称当前最终版整体通过。当前新增JAV NFO文件不在该轮318文件清单内。没有Desktop、NAS发布或用户原始测试集修改。

## 显式 CID 文件名人工确认（2026-10-15）

`CID=ipx00177.mkv`等显式CID locator不再被文件名词法识别器拼成番号；同文件名另有独立完整番号时仍保留该Claim，不改变普通无横杠番号或A/B识别规则。真实隔离Host旅程通过：原Candidate文件名hint及Claim/metadata/package digest保留，人工查询前零Provider请求、零resolved identity、视频字节保持；公开预览仍不写身份，用户确认实际番号后产生同站Artifact/唯一On-deck Commit，原Candidate保持不可变，重复确认重放且换号拒绝。日志`cid-manual-host-20261015.log`，1 pass、40.2秒。

文件名/分段模型6 pass，历史Movie阶段Handoff fixture 1 skip，不计为JAV资格；P2维持121/104/202/50及aggregate `b61d66725c9f5145a08fc7b4a71915ae4f138d9a951f24c2d8eee3501870712d`，diff检查通过。CID→番号自动映射仍无合格实际来源Evidence，此旅程仅证明人工确认出口，不关闭自动映射缺口。没有UI源码、Desktop、生产或用户测试集改动。

新增断言后的普通无号、FC2人工确认实际Host回归均通过（2 pass，79.6秒，`manual-identity-after-cid-20261015.log`）。当前318文件整合回归已启动，单独写入`architecture-integration-after-cid-20261015.log`，不覆盖初轮失败证据；结果待收取，不先声明通过。

## FC2 live 与失败主备补验（2026-10-15）

当前适配器实测FC2-718323：官方站经指定proxy取得qualified同号/title/1280×720 cover，固定resource再次qualified、poster31180 bytes；JavMenu直连独立取得同号/title/200×200 cover及poster6031 bytes。JavMenu proxy返回ACCESS_DENIED，没有自动改路线。原图/标题不入库或聊天，ignored `fc2-fallback-live-20261015.json` 保存presence/digest/尺寸与时间；仅此样本有效，不声明全部FC2来源持续可用。

两条实际Host受控HTTP故障旅程通过：官方403拒绝后选择JavMenu；官方503在同一Event完成3次有界失败后选择JavMenu。都保留首站failed Work/Attempt、source ordinal0与失败原因，最终只有一份resolved Observation/正式身份、同一JavMenu Metadata与完整image derivation/NFO，一包、一Run、一份Primary/唯一On-deck Commit；缺studio/date不阻断，无首站字段混入或重复媒体加工。日志 `fc2-source-failure-host-final-20261015.log`（1 pass，40.3秒）、`fc2-transient-fallback-host-20261015.log`（1 pass，47.4秒）。最初fixture在Integration测试时就注入拒绝，修正为配置成功后故障；没有放宽真正连接验证。

故障测试暴露连接Probe错误误归通用500：`testCandidate`现在仅把8类已知JAV transport errors映射到既有Platform upstream error，保留safe siteRef/reasonCode、不给raw响应/URL/Secret；未知异常不降级，正式Source Observation原始错误与主备规则不变。实际Admin HTTP403连接拒绝现在502/no proof/no config；伪proof不能保存。503、invalid MIME与timeout也验证现有Platform contract。后端/来源合同/身份32 pass、相关Web7 pass，明确失败后仍断开/路线可编辑/不显示raw错误。没有改UI源码/bundle、Nominal machine contracts或生产；当前跨层版本审核与完整发布资格仍开放。

日期：2026-10-15。工作项：JAV-SOURCE、JAV-IDENTITY-RECOVERY、JAV-RELEASE。仅本地开发和只读来源验证；没有 Desktop 开发、生产发布、生产数据处置或用户测试集改动。

## 正式 Host 旅程

使用临时目录、真实 SQLite、真实生成的 HEVC 视频、公开 Admin API 和受控网站响应；测试结束只清理自身临时目录。受控响应不代表网站当前可用。

13 条来源旅程通过：FC2、HEYDOUGA、日期型、数字前缀、GETCHU、GYUTTO、MUGEN、IBW、T38、N，以及普通号主站坏封面后换站、普通号主站成功后停止备用查询、T28 主站无资料后换站。每条均完成身份 Fact、同站 Metadata、真实 poster/fanart/NFO、Workspace 和唯一 Arca On-deck Commit；只形成一个 Candidate Package/Run。seller、maker、circle 的可选署名角色保留；缺日期等选填资料不阻断。

两个换站负例独立核验持久 ProductIdentityEvidenceObservation：第一站为 `not_found`，reason 分别为 `cover_undecodable` 和 `not_found`，没有 qualificationObservation；第二站独立 `resolved`。最终 Metadata/NFO 不混入被拒站的字段。主站成功的正例只查询选定站，不为补选填字段继续查询备用站。

无号普通文件和无号 FC2 两条人工确认旅程通过：工作区待处理→GET 预览（没有身份写入）→POST 精确确认→上架；重复确认重放同一 Intent，确认后异号拒绝。视频字节保持。连同来源旅程，共 15 条本轮独立 Host 正例。

复现入口：`media-service/test/helix-architecture/jav-host-journey.test.js`，过滤 `JAV class source journey` 或 `unrecognized JAV input`。测试网站响应位于 `fixtures/jav-class-transport.js`。

## 真实来源复验

本轮直接使用当前来源客户端，分别完成首次资格、携带已冻结 native resource key 的精确重验和封面派生；每次冻结显式 direct/http_proxy route，没有运行时绕过代理。仅获取网页和封面，没有获取网站视频。

| 来源及实测号码 | 显式线路 | 结果 |
| --- | --- | --- |
| JavDB/IPX-177、T38-071 | direct | 完整资格、精确重验及 JPEG poster 通过 |
| JavMenu/IPX-177、MKD-S148、IBW-398Z、N1230、RED030、SKY066、EX0010、K1095 | direct | 8 个样本的上述三步通过 |
| HEYDOUGA/4030-2113、Caribbeancom/082713-417 | NAS HTTP proxy | 上述三步通过；HEYDOUGA 实际 WebP 正确派生 JPEG |
| AvWiki/259LUXU-1022 | direct | 上述三步通过 |
| Getchu/4052694、Gyutto/242158 | NAS HTTP proxy | 上述三步通过 |
| JavMenu/T38-071 | direct | `not_found`，没有合格主内容；既有 T38 规则已经优先 JavDB，无需改顺序 |
| FC2 官方/718323 | NAS HTTP proxy | 两次独立有界复验均 `JAV_SOURCE_UNAVAILABLE`；保留历史成功证据，本轮不宣称当前可用或全站失效 |

15 个真实成功样本及明确负例的 digest/尺寸记录保存在 ignored `.codex/jav-development/source-reobservation*-20261015.json`。原始内容及影片标题不复制进文档。历史网络与身份叶子证据继续见 [来源准备证据](JAV_SOURCE_READINESS_20261013.md)。CID/FANZA 仍没有完整影片身份映射资格，本轮没有关闭此缺口。

## 修复与回归

专用站的 qualified resource key 为规范番号。此前客户端只准 JavDB native key，导致身份成功后 Metadata 精确重验失败；现在专用站只接受与冻结 anchor.javCode 完全相同的 key。null、空值、异号及 URL 均在网络请求前拒绝。7 个专用来源的精确重验和负例通过，没有扩大 host、番号类型或身份权限。

路由重新生成曾把已实现的 `post_runtime_stop/resume/reset` 改成未实现方法名。生成器现保留原公开 Facade 方法；实际 HTTP 验证停机、停机期间只读、恢复以及空 Reset 的既有拒绝结果。没有放宽 Reset 准入或改变运行状态协议。

Inventory registration 与 Result registry 中过期计数已跟随严格 SSOT extraction 更新。当前 121 Capabilities / 104 Result families / 202 Tables / 49 Transactions、31 shared types / 123 domain inputs / 228 refs / 0 unresolved 保持；Result schema registry 的实际 helper 数为 22。P2 aggregate 为 `c5b16223e6a5b4743e7f2a558e1a88333bdb1b0d6fe82caf2da6a046c249b454`。没有删除 schema、放宽 Closure 或绕过 cardinality 检查。

- Service 全量 `npm test`：670 项，641 pass / 29 skipped / 0 fail；日志在 ignored `.codex/jav-development/service-final-tests-after-route-fix.log`。
- 来源、运行操作、Manifest、Result schema、P2 与产品表面组合：42 pass / 0 fail。
- Package boundary：541 files / 1842 dependencies / 47 packages，无 finding；semantic：2274 files / 42 exemptions，无 finding。
- `git diff --check` 通过。

全架构和 P3 跨持久化检查已启动，运行中不计为通过。精确版本 UI 负责人、Linux、异常恢复入口及生产升级/回退仍开放；本轮不宣称部署就绪。

## 发布结构预检

只读比较冻结的上一发布 DDL `c00f45c15c5540e158a688c32fd4b57fdbc146b1a28067f0ac7fe82c496d0d5d` 与当前 DDL `550b212e5491b273ee9e07290e8ab0065176fbf56d48792bb0f90ed0730d9ae1`：新增 Arca correction/directory 两表；实际 SQL 变化仅在 Selection Intent 的两列和 Candidate Package 的两列/对应约束，现有索引未改变。其他表的合同 digest 变化不能误报为 SQL 结构变化。完整本地报告在 ignored `schema-release-diff-20261015.json`。

这只是结构差异审计，不是迁移、升级、终态历史兼容或回退成功证据。Kernel 仍拒绝旧 schema；下一切片必须按正式发布合同准备完整副本升级与回退，不用直接改 marker、清库或旧 Formation 兼容代码绕过。

## UI负责人审核 / 2026-10-15：送审版暂未通过

本次结论绑定未提交的送审开发版，不以基线`da23711dd`冒充实现commit。开始时独立重算3125份Source/scripts/test/Web输入，digest为`c7f8ae71e3144d7a36e0e1ea7c595ad8be1e655f628e64cc4e9bcddf0ad78a41`、changed为空；其中3011份backend输入为`fe87fdbaaa1bdcd9f29d51e098ba23531d303c411e4eabb729cef436180adbd9`，与提交材料一致。独立读取并冻结JS `index-jnDQRjjV.js` SHA256 `be48d04168d3079b3efe301e5a584a8a199dfa1857a40f486f103634c8012abc`、CSS `index-BYV0LKeb.css` SHA256 `82cb8561be6544293d0f6850171d0df02a9a97e53bf60a075ec262ede15df4e2`，所有本负责人浏览器检查加载该副本。

### 三项阻断问题

1. **初次确认的封面显示失败仍可确认。** `JavIdentityDialog.tsx`已有imageFailed占位，但确认按钮及confirm()没有此围栏。两个视口均在“封面显示失败”旁显示可点击的“确认影片并继续整理”。最终复现返回符合当前后端形状的真实JPEG data URI，再用浏览器文档CSP阻止显示，触发真实img error；没有伪造Owner事实或修改DOM状态。这证明的是用户无法目视核对封面时仍可选择，不声称后端接纳不合格Source。应与已入藏纠正的现有做法一致：显示失败时不得继续确认，重新查询/取得可见预览后才恢复。
2. **预览过期没有使旧确认失效。** 接收真实错误码`LIBRA_JAV_PREVIEW_EXPIRED`后，仅显示“预览已过期，请重新查询。”，仍保留selected和已启用确认按钮。两视口均复现。服务端到期围栏仍会拒绝，不把它记为错误身份已经提交；但用户会被允许反复提交已知无效预览。需要清除该预览/确认资格，显式重新查询后再确认；普通网络失败的幂等重试仍按原合同保留。
3. **JAV推荐标准在收藏架配置中没有摘要或命名样例。** 直接从当前Arca `rule-template-contracts.js`导出真实system-jav-recommended规则提供给隔离浏览器，选择“JAV 推荐整理标准”后`.template-preview`为空。实际规则含JAV身份、标题、HEVC/Matroska、2 GiB、NFO/海报/背景图；前端RuleSummary仅遍历movie/series，NamingPreview也无JAV样例。复制编辑入口同样只安排电影/剧集，不能将此空编辑器作为JAV配置路径。应根据JAV静态baseRequirements展示真实标准及适用的配置/命名入口，不将其伪装成rating分支或改变规则事实。

另有应按既有规范收敛的呈现项：来源卡片同时展示已连接总数、选项连接状态及当前连接状态，重复/全局汇总应删除；预览来源直接插入siteRef，特殊站可能显示fc2_official等机器枚举，应复用来源配置已有的人类可读站名。这些无需新增业务决定或生产动作。

### 已验证路径与证据边界

- 读取本节前列的真实Service宽/窄截图，核对初次确认、唯一入藏、纠正新旧影片/位置及cleanup结果；审阅原真实Host/SQL/字节证明，未自行重跑真实Host，不将资料站受控响应解释为线上站点可用。
- 独立运行冻结Web内原有JAV Playwright，1920×1080与390×844共10通过。含首次查询/歧义/改变输入、只读过程与锁定、纠正后果/失败同key重试、core committed与cleanup分离、无写入取消及重新查询、不可取消状态、目录精确清单/后果/归档/恢复；保留其键盘焦点、适用Axe及布局断言。全部为受控API，未调用生产。
- 独立补充浏览器最终v4：两视口各5项，共4通过/6失败。通过项覆盖来源选择、拒绝含凭据代理地址、实际PATCH配置后读取已连接及原代理配置、JAV Material Field选择、JAV来源区域Axe零违规，以及评分/已看各自设置/清除而不相互覆盖。失败恰为上述3项×2视口，不能将测试发现缺陷称为产品通过。
- 已目检封面失败、过期预览、JAV空标准、来源配置截图。补充测试首轮存在ESM路径和select的label精确匹配问题；后改为role/name。来源fixture最初漏处理真实PATCH，最终按proof保存网络配置并断言连接状态/代理值；封面最终改用当前Owner接受的JPEG data URI与浏览器显示阻断。保留discovery及v1–v3，不用早期不完整fixture作为最终资格。

冻结目录`E:/my_project/helix-git-consolidation-20261008/jav-ui-review-20261015/`。138份Web快照输入清单digest `357db0f116da8282a7c2c6fc740ca447235ce76799715803f3008d756053cb41`；`web-source-manifest.json` SHA256 `f28e684a2ccc116174e066d5718afaf1bd122beebc817d73992cec0a6a00e4b5`；`owner-input-check.json` SHA256 `4414258cc10b12c068be8607a077eb1a8513cd32916c5dfca0cacabb9081c3ec`。原10项日志`baseline-browser.log` SHA256 `f24268ac0c1ea2de14aa54c90e672cdfdc1e9e88ff759b82421d0900172549c1`；最终补充日志`owner-boundary-v4.log` SHA256 `a7a8f9590894fb4ec120150b5fab3698f0ebe471c20395f274b43a8173386e3e`；补充脚本`media-service/web/e2e/owner-jav-audit.spec.ts` SHA256 `65c7699ee28820ad0c0b0060d106df3207bbaa680bb7e5ede181e53e950a9795`，仅存在仓库外审计副本。`owner-boundary-v4/`保留截图、失败上下文与trace。任务HTTP服务和浏览器已关闭。

结束时只读核验发现共享工作区21份输入已变化，包含FormationPage、JavCorrectionDialog和API，原dist文件名也已替换；`owner-final-input-check.json`保留该漂移。本负责人始终测试冻结的送审副本，本结论不覆盖这些后续改动，不能继承为当前新实现的UI接受。

本轮未修改产品源码、SSOT/Phase/Status、Desktop、生产或用户测试材料；仅向本证据追加审核结果，不提交实施任务的大量未提交改动。未重跑175全Web或2692架构整合；其skip/替代证据仍属原实施资格。终态失败Recovery Intent不在本次送审完成范围，不把“无法取消”当作恢复实现。Linux用户跳过项、实际一致生产副本、候选/回退与整体JAV发布资格均按主任务独立事实处理，不因本UI检查关闭。

## UI负责人复核index-Cuvw6dnb / 2026-10-15：旧问题修复，新增确认失效问题

本次仅审核指定冻结副本`.codex/ui-review-index-Cuvw6dnb/`，不读取共享区的后续产品改动来替换验收版本。开始及结束均独立逐项核验2608份清单文件，changed为空，fileDigest保持`19e811147ce7466b4edddc5ae043087a4287db4a7cec32d75adeb2d03abbf45f`。JS `index-Cuvw6dnb.js` SHA256 `168f5c2bfe4825a9daa545837a9cf19f128580e1293905e70f80422012e32160`，CSS SHA256 `82cb8561be6544293d0f6850171d0df02a9a97e53bf60a075ec262ede15df4e2`。**该版当前UI门禁仍未通过**，原因如下，不追认旧jnDQR版通过。

### 新问题：未提交的“继续纠正”勾选沿用于“继续清理”

独立宽1920×1080、窄390×844浏览器均复现：Owner最初返回attention_required、stateRevision=3、continue_correction；用户展开“继续纠正”并勾选，但尚未发送POST。随后正常后台读取同一Correction的最新Projection：已committed、cleanup attention_required、stateRevision=7、continue_cleanup及新的previousIntentDigest。页面原行保持，后果文字和按钮已改为继续清理，checkbox却仍为checked，按钮可用。没有新增用户勾选，就能够进入另一种后果的提交路径。

根因在`JavCorrectionWorkRow.tsx`：begin只设置action/consent，未冻结并校验确认所对应的mode及状态围栏；render使用最新item动态替换后果，而首次submit才从最新item创建命令。应在未提交期间对确认动作、stateRevision、Admission、cleanup状态、前次Intent及可用性变化使旧确认失效，要求按新后果重新确认，不能只期待服务端拒绝：当前实现会用最新围栏构造请求。本次在发出新POST前停止并取证，未声称真实Host已错误清理。

修复不得破坏网络结果不明的既有协议。另一独立场景先提交，收到503且已有完整命令/键；后台读取推进到active后重试，宽/窄均保持原完整body及key，成功读取Receipt后才关闭确认。此路径2通过。不要用“任何item变化都清空command”的做法修复上面的未提交确认；对象引用或进度时间变化也不是业务围栏变化。

### 已通过的适用部分

- 在冻结dist上独立运行`jav-*.spec.ts`，22通过、0失败；该pattern比提交的18项还包含既有收藏纠正与目录处理4项，不把18与22加总。覆盖工作区取消/不可取消、只读实际过程入口、继续纠正/清理、文件冲突路径、同key重试、后果勾选、首次身份及推荐标准回归、既有归档/恢复、键盘和适用Axe/布局断言。
- 上轮封面失败仍可确认、过期预览未失效、JAV静态标准/命名/复制编辑缺失，在本冻结版均已修复并走查通过。复制编辑保持JAV baseRequirements及空评分分支，未改成电影/剧集规则。来源汇总/重复状态已收敛，预览使用可读站名；FC2官方等回归已覆盖。
- 新工作区仍为九列，同一Correction一行；详情只展示过程，取消/继续位于用户操作区。受理、身份已更新但待清理、独立清理完成没有混同；后台状态仍由Owner重读。审查后端过程构建器由实际Work/Plan/Event投影，不以业务状态伪造Plan；浏览器状态响应仍为fixture，不冒充完整Host。
- 补充并发4项为2通过/2失败：两个视口分别保留正确的未知网络结果重试，分别发现未提交后果变化仍保持勾选。不是测试全绿或当前UI接受。已目检后果切换、JAV静态编辑等截图。

负责人审计输出位于仓库外`E:/my_project/helix-git-consolidation-20261008/jav-ui-review-Cuvw6dnb-20261015/`，只读使用送审副本与依赖，不修改其文件。`owner-final-review.json` SHA256 `5752352d0a46f04fe8e96d72ac894a34d9f71e945235ae258a34e4c18b762875`；22项日志`baseline-browser.log` SHA256 `5366ced3984264bbeba49b8a0fa1dec6f3a2fcfb8ba7f96715a4f43abd0c2ccc`；`owner-concurrency.log` SHA256 `e9fab01d9ec7fefa306f3b0ef170daf3dee897eb71e89e8a80ee9900b1abfef2`；补充脚本SHA256 `057bca19700e0c6ab95103d98437d374d93a001c4a626f8fbf17f3ac385412c8`。失败截图/上下文/trace在`owner-concurrency/`。任务浏览器和动态端口服务已关闭。

已审阅冻结proofs的185项Web、公开恢复Host结果及正式清理/回收日志；未重跑这些后台资格。正式清理所在原组合1通过/1失败，回收另行1通过，保留各自轮次，不合并成原组合全绿。stage/publish/verify/identity commit终态恢复、producer与反复恢复后取消、最终服务/平台/生产一致副本/回退仍按实施任务原门禁推进。本次无共享产品源码、Desktop、NAS、生产或用户材料动作；未替未完成恢复/Linux/发布资格背书。

## UI负责人接受index-1qAJmlnq / 2026-10-15

**接受本冻结版本的适用JAV UI范围，具体版本UI门禁通过。** 仅对应`.codex/ui-review-index-1qAJmlnq/`：2611文件在审核前后逐项SHA-256验证均一致，fileDigest为`d218465ff514f929a4bc08fe6716743a924685fbbe2c75dad83615eefe598409`。JS `index-1qAJmlnq.js` SHA256 `5d3bd76bdcd5ee77a914899a96e53c605850f6fd8f44152e112769edb9af34fa`；CSS `index-BYV0LKeb.css` SHA256 `82cb8561be6544293d0f6850171d0df02a9a97e53bf60a075ec262ede15df4e2`。不追认旧jnDQR/Cuvw版，也不覆盖共享区后续改动。

与Cuvw比较，Web产品仅修改JavCorrectionWorkRow。未提交勾选按动作、Correction/Entry、状态revision、Admission、业务state/cleanup、恢复mode、前次Intent与可用性绑定；最新Projection改变后，派生consent立即失效，不能等effect之后再允许一次提交。已存在未知结果命令时，actionStatus及请求路径/五字段/key绑定原Snapshot，新的Projection不替换已确认后果。availability失效时，尚未提交的checkbox和按钮禁用；未把客户端禁用当作Owner授权。

独立Chromium宽1920×1080、窄390×844两组检查均通过：

- 冻结`jav-*.spec.ts`共26通过、0失败，包含当前工作区取消/不可取消、只读过程、两类继续、文件/状态冲突、重试、初次身份、三项原审核回归与静态标准复制、既有收藏纠正/目录处理。该pattern比实施方报告的20项更广，不把两份结果加总。原三项问题与来源去重/站名显示修正继续成立，九列及同一Correction单行保持。
- 负责人独立并发补充8通过、0失败：未提交的继续纠正→继续清理清除旧勾选；未提交时失去可用性禁用checkbox/提交；网络结果不明而Projection推进到active，原完整body/key仍可精确重试；网络结果不明而Projection已推进到cleanup，仍显示并重试原纠正后果，取得原Receipt后才关闭旧确认，新清理必须另行勾选。四种场景均覆盖两个视口，未操作生产。

已目检宽屏后果变化后的未勾选/禁用状态，以及窄屏原请求重试后新的清理确认。浏览器全部使用独立动态端口与受控API响应，不把这些结果当作真实文件Effect或NAS生命周期验证。任务浏览器/HTTP服务已关闭，未改变冻结副本或共享产品源码。

负责人审计目录`E:/my_project/helix-git-consolidation-20261008/jav-ui-review-1qAJmlnq-20261015/`：`owner-final-review.json` SHA256 `3485c4e1f36a8b8e3599a2b477d008d6983459817ddcff88a92346fbc2ae92df`；26项`baseline-final.log` SHA256 `960485b3ab5dc36310fb4eeebe4ad9aab09de944c519f67197e3aef33510b873`；8项`owner-concurrency-final.log` SHA256 `332f86ac2310519666cc359301765f9d7995657e247fe33a51d3c1165e189aab`；独立补充脚本SHA256 `af83914a51b1b14ea435d17529cbaaba2637fbe1edb9ce3680932c3eddf4bdeb`。截图/trace按最终两组独立目录保存。首轮并行runner误共享配置，双方都执行补充8项，未用作最终验收；保留`shared-config-invalid-*`日志，改为独立配置和输出后按正确26/8分组复验通过，没有修改产品或弱化断言。

实施方186项Web及新增stage/publish/verify/commit/短producer、反复恢复后取消Host证明已作为冻结proofs收取，负责人未重复执行，不把旧组合失败日志改写为通过。上述UI接受不代表最终整合、Service/Movie/Series/平台、生产一致副本/回退或整体JAV发布资格通过；Linux用户skip仍非PASS。本负责人只追加本节Evidence，无Desktop、生产部署/停机/Reset或用户测试材料动作。

### UI负责人补充Linux候选镜像字节绑定 / 2026-10-15

候选`markmahoro/shelfdeck:9f4df61e7b`，source commit `9f4df61e7b9378f28ce31f5f5eb1bd8b716a9a7c`，本机实际image ID `sha256:baf287e2413aec1e95e03d90576b57fca820d09ecd923e8bc218c552a510a727`。审核该commit相对父版的产品diff仅Dockerfile：改用package-lock已固定的FFprobe可执行文件；没有UI、DTO、显示文案或源码归一化/fallback变更。可对**该镜像中不变的UI表面**继承1qAJmlnq已接受的适用证据，无需重复26/8浏览器组；这不构成新的媒体或发布资格。

负责人独立核对`linux-candidate-expected-9f4df61e7b.json`的2318份源码记录，与已接受冻结副本及核对时工作区src逐项匹配，聚合digest为`74848078dc41feeb62a163ff53e48c296c88ee787ae64a264bcbd0a897979742`；66份Web src也与冻结清单相同。主任务实际镜像源码/203表/147路由/会话与公开GET资格来自`linux-candidate-package-9f4df61e7b-20261015.log`，不冒称负责人重复启动服务或重验这些后台资格。两份原记录SHA256分别为`616796123ef0b81e4245de72d1339e60d95356eeaf7e3f0f4a0aafba7aa9a398`、`6f66fb415c326d2389f8b9a5213dcf888451c3da16dcab398ad60e36621d0f56`。

除日志核对外，负责人对上述不可变image ID执行一次自动删除的无网络、只读root、无capability Node哈希进程，仅读取`/app/dist/admin/assets`，没有启动Service或媒体流程。实际JS `index-1qAJmlnq.js` SHA256 `5d3bd76bdcd5ee77a914899a96e53c605850f6fd8f44152e112769edb9af34fa`、CSS `index-BYV0LKeb.css` SHA256 `82cb8561be6544293d0f6850171d0df02a9a97e53bf60a075ec262ede15df4e2`，与已接受资产逐字节相同。当前可变本地dist已出现另一份`index-qNABnIMQ.js`，未用它替代镜像证据，也不由本节予以接受。

独立核对记录位于原仓库外审计目录`jav-ui-review-1qAJmlnq-20261015/linux-candidate-binding.json`，SHA256 `7bad44c31383a54a70249a8a18febf7858f09c9c65e568f72d9df2e16572e1bb`。本补充不验证FFprobe替换的原生媒体正确性、JAV/Series全链、完整整合或生产一致副本/回退；不改变原用户skip的具体测试记录，也不将后来本机Docker资格误写为被跳过的NAS临时测试已执行。无生产部署、停机、Reset或媒体/数据处置。

### 062c0ba7a1新增失败语义的UI复核

062候选的实际JS/CSS与1q接受资产一致，不变表面可继承；新有界观察失败已正确成为failed，但过程原因显示“系统没有保存可展示的文字原因”，宽/窄均复现，不能把这条新路径视为文案完成。建议短句“返回的信息超出处理上限。”，不附重试引导或改变never策略。具体版本、真实镜像投影及4项Runtime/2项浏览器证据见[JAV停滞修复Evidence的负责人审核](JAV_RELEASE_STALLED_EXECUTION_20261015.md#ui负责人差异审核062c0ba7a1--2026-10-15)。本结论不撤销1q原接受，也不覆盖后续修正版或生产资格；负责人未修改产品源码。

2026-10-15后续：负责人已接受`f27035945ddf75bc4326d63201750f1a6a9d6e8e`及`index-CQ6ZHoan.js`（SHA256 `c5bbbc11714fadb01f2be4ea3a77ab46b3211358b65f0d99e7462f6cbb869d15`）的单行失败映射修正。实际相同failed数据在宽/窄均正确显示“返回的信息超出处理上限”，无新增重试或技术码直出；2项独立检查通过，其余不变UI继承原接受。详见上链Evidence的f270接受段，最终镜像与副本/发布资格不由本结论代替。
