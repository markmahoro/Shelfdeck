# Series 真实 Host 浏览器身份与上架旅程

日期：2026-10-08；基线 ebcd19ebf，当前 Phase 节点2/4浏览器门槛增量。未部署或修改 NAS。

## 路径与结果

新增可选 `HELIX_SERIES_BROWSER=1`，与 `HELIX_SERIES_MANUAL_IDENTITY=1` 配合运行现有 `series-routing-run.test.js` 的 manual Series identity 场景。必须先构建 Admin Web，并设置绝对 `HELIX_SERIES_BROWSER_OUTPUT` 证据目录。

构建后的管理台由正式隔离 Service Host 在127.0.0.1随机端口提供。Playwright不拦截API：页面输入测试凭据登录，通过Formation的需处理入口查询TMDB Series ID 1399、预览冻结第1季并确认，校验真实202 Receipt namespace/Season。原Host继续完成Direct/Remux、Arca Commit及源结算，原有Run basis、Inventory/Claims/文件断言保持。然后页面查看实际Collection，季号、两集、两个成品文件名与公开Owner Projection一致。

桌面1920×1080、窄屏390×844均验证收藏页面、筛选展开、弹窗打开/关闭时无横向溢出，弹窗内正常滚动后剧集文件可读，Escape及关闭按钮均关闭并回焦。页面没有JS错误。测试退出关闭浏览器/Host并删除隔离runtime。

## 暴露并修复的缺陷

第一轮测试定位器错误地精确匹配收藏按钮名称，遗漏名称内的健康状态；只修正定位器后技术断言通过，但人工截图检查发现窄屏页面宽807px。原因是polish.css五列Grid和display:contents覆盖collection.css原响应式flex规则。

UI负责人任务 `01a0912a-0086-74e2-88ab-536c59d3862a` 于turn `01a11b0f-4add-7b21-8288-3f13d569c0ae`同意修复方向并给出上述验收条件。实际生效的polish规则在窄视口改为两列，收藏架和搜索占整行，保留桌面同排；未隐藏溢出、未变更业务或整理表格。补充受控API浏览器全页宽度断言，防止只检查剧集局部而漏报。

## 验证

- 最终真实Host+浏览器1项通过/0skip，37.26秒；`series-browser-host-v4.log`。
- 未开启浏览器的原人工身份Host回归1项通过/0skip，35.34秒；`series-manual-host-regression.log`。
- 收藏详情受控API桌面/窄屏2项通过，含Axe；`series-collection-responsive.log`。
- 前端26文件128项通过；`series-browser-host-web-tests.log`。
- Admin构建、P2合同、JS语法及diff检查通过。

所有日志位于仓库外 `E:/my_project/helix-git-consolidation-20261008/`。最终截图在 `series-browser-host-v4/`：formation-attention、identity-preview-desktop/narrow、collection-page-desktop/narrow、collection-filter-desktop/narrow、collection-desktop/narrow。初始失败及旧截图保留，不以技术PASS覆盖视觉缺陷。

## 验收范围

待UI负责人对本次精确提交复验。浏览器运行Windows Chromium，媒体Probe/加工与上游Provider沿既有可控fixture，不宣称该测试覆盖真实媒体质量。来源/规则/收藏架/路由配置仍由正式API预置，不是全程由用户界面配置；追加、完整运营和外部交付浏览器旅程仍未覆盖。Linux真实媒体证据沿既有专项，本次未重跑Linux/全架构，未关闭Series整体部署门槛。

## 负责人接受与来源页面追加

UI负责人在turn `01a11b12-a149-70b3-8bdf-6423d7e2f591`正式接受精确提交 `573444125e727c5ef988b0d96c673b4bda607a51` 的登录→人工身份确认→实际上架→收藏查看；其亲自复跑构建、双视口2项及真实Host37.23秒通过。仅覆盖该段，不覆盖全配置/追加/运营/外部交付。

随后沿同一隔离Host扩展浏览器：来源页登录，选择剧集、填写临时目录并登记；通过真实POST生成Field ID，公开Projection确认Profile；收藏架分拣页发布年份>=2020策略并点击扫描新文件，然后接续人工身份与实际上架。没有页面API拦截、没有用固定Field ID替换页面结果。收藏架/规则及自动结算许可暂仍由原Fixture正式API配置。

该追加最终1项通过/0skip，38.41秒，`series-browser-source-v3.log`；截图目录 `series-browser-source-v3/` 新增 `source-registered.png` 与 `source-routing.png`。前两次新增断言错误读取Profile顶层字段，改按正式Projection的 `currentProfileHintSnapshot.contentProfileHint` 验证；未修改产品字段或弱化断言。JS语法/diff检查通过。本次仅测试与文档，不重复产品构建或全架构回归；待负责人接受新增来源/策略/扫描段。

截图中的“年份未知”已核对：当前Series标准的requiredFieldCodes不含year_or_release_date，Adapter仅返回请求字段，Collection没有已有年份事实可显示。此处不补造年份、不改资料采集合同；后续按实际标准展示。

## 收藏架创建与结算授权追加

负责人turn `01a11b16-d57e-7eb3-8bea-95577499aa94`接受精确 `a2910cc084155f6adb4ac6c759f2b4a5ae4ce9e7` 的桌面来源登记/分拣/扫描正常路径，亲自复跑38.27秒通过；不包含随后未提交增量。

继续将收藏架创建和自动结算授权移入真实页面：空态直接进入创建表单，选择已发布模板、填写临时收藏目录、调整目录命名并核验Season命名预览，再提交真实创建请求。页面生成的Shelf ID进入后续分拣目标断言，不使用固定Fixture ID替代。自动清理通过原确认弹窗授权，保留共享/未知/范围外文件以及不包含退出收藏销毁的后果提示均检查；原Host的正式源结算/文件结果断言仍执行。

最终无API拦截旅程1项通过/0skip，38.35秒，`series-browser-shelf-v4.log`；截图 `series-browser-shelf-v4/` 新增 settlement-authorization、shelf-empty-form、shelf-create、shelf-created。首次新增脚本错误等待空态不存在的“新建收藏架”按钮，第二次标签查询未匹配模板控件，按实际空态和combobox名称修正；产品未变更。前一轮创建专项38.39秒通过，最终轮另去除授权API预置后复验成功。JS语法与diff检查通过。

仅测试/文档增量，未重复构建或全量测试。待负责人对新增桌面创建及授权段验收。规则模板本身仍通过正式API预置（使混合Direct/Remux要求精确），规则编辑/发布的真实页面路径、追加/运营、外部交付和升级回退仍开放。所有媒体和文件清理限定临时测试目录，未操作NAS。

## 规则再次编辑与真实发布修复

UI负责人turn `01a11b1b-9672-72b2-a52f-4bb67d38e3e4`已接受 `c7354defd82ab8d6ee7cd34c94339649bc062e80` 的桌面收藏架创建/自动清理授权路径，亲自复跑38.16秒通过。

本轮真实规则编辑复现两处前端缺陷：已发布revision2后继续沿用Draft的旧basePublishedRevision1，触发HEAD_CAS；PATCH实际返回 `{draft,replayed}`，前端误当草稿本体而未消费新draftRevision，触发PREVIEW_CAS。旧浏览器测试桩也错误返回裸draft，未覆盖此差异。

按SSOT §9.6.3，发布后继续从用户看到的current revision编辑。页面以该已显示版本作为base，保留最新读取Draft的expectedDraftRevision；仅当草稿基线已经过期时，内容从显示版本重新建立，当前基线的可恢复Draft继续保留。请求幂等键加入basePublishedRevision，接口严格解包正式draft响应，随后Preview/Publish消费实际新revision/digest。未修改Arca双CAS或Domain边界，不自动采用现场新head，不自动覆盖或重试发布。

负责人turn `01a11b1e-3420-72b1-9148-4b906c4b5f55`确认修复方向并要求冲突在弹窗内可见。冲突现以短提示显示在固定操作区，保留输入，提供“返回查看最新规则”；此动作明确退出编辑并刷新供用户核对，不自动重新提交。窄屏操作按钮换行，避免挤成竖排。初次将提示置于滚动体末尾仍不可见，截图检查后移到固定区。

验证：

- 真实页面修改未评分Series每集上限0.5GiB，预览/发布/建架/扫描/身份确认/实际上架全部通过；每份正式Acceptance Spec断言 `{unit:episode,maxSizeGiB:0.5,maxSizeBytes:536870912}`。最终功能轮38.35秒，`series-browser-rules-v5.log`，截图同名目录。随后仅调整错误操作区布局，双视口走查覆盖最终布局。
- 前端26文件131项通过，包含用户模板旧Draft基线、未编辑Movie字段保持、head/draft冲突保留输入且不自动重试；`series-rules-head-web-v4.log`。
- Series双视口8项通过，测试桩按真实draft响应，冲突就地反馈/输入保留/键盘和Axe复验；`series-rules-head-browser-v4.log`。冲突截图在仓库忽略目录 `.codex/series-browser/series-shelf-rules-*/series-standard-conflict.png`，已视觉检查。
- 正式Rule Template HTTP5项通过，追加head/draft双CAS拒绝后Draft内容与revision不变；`series-rules-head-http-v2.log`。
- Admin构建、P2、JS/diff检查通过；未改变服务实现，不重复全架构或Linux媒体回归。

本轮初始失败日志 `series-browser-rules{,-v2,-v3}.log` 保留，未以测试桩替代真实失败。仍从正式API预置的现有用户模板开始编辑（预置保留混合Remux的fileExtension要求）；首次从系统模板复制已有受控测试，尚不宣称全配置冷启动。新增修复版本待负责人验收，运营/外部交付/升级回退等整体门槛不关闭，未操作NAS。

## 页面追加E03与累计收藏

UI负责人turn `01a11b26-3f0a-7712-aaf5-e52229dbd0ad`正式接受 `2aaa423ceab08a979d0561310d24e09a1f2c27b9` 规则修复：其亲自复跑131前端、8浏览器、5正式HTTP、构建以及38.59秒真实Host通过，接受范围仍不含全配置冷启动或后续追加增量。

新增 `HELIX_SERIES_BROWSER_APPEND=1` 与已有MANUAL_IDENTITY/BROWSER开关配合。首批两集经页面配置、身份选择和上架后，在同一临时来源增加E03，通过来源页再次“扫描新文件”；正式Formation投影仅有本批E003，页面再次人工确认同一Series/Season。Arca独立把新Product追加到原Canonical Season Entry。浏览器核对桌面/窄屏累计3集、3个实际文件且文件名与正式Projection一致，保留前后两批独立截图。

原追加Host的断言保留：两批Run与非锚定Subject范围、唯一Entry、历史Inventory/Deck Fact不可变、旧文件字节不变、E03新文件与Claims、追加Commit的Reservation/Head漂移拒绝/事务回滚/重放、两份正式Commit Receipt及历史查询一致。页面生成的Field/Shelf ID贯穿，不依赖原固定Fixture ID。

Windows Chromium真实旅程1项通过/0skip，73.15秒；日志 `series-browser-append.log`，截图目录 `series-browser-append/`（仓库外统一证据根）含 append-source-scan、append-formation-attention、append-identity-preview-*、append-collection-*。人工截图确认“本批1集E03”与“已收藏3集”区分清楚，窄屏文件完整可读。JS语法/diff检查通过。仅测试/文档增量，未重复产品构建或全架构/Linux媒体回归；临时Host与浏览器已关闭。

新增追加段待负责人验收。素材与Provider沿既有可控Fixture，不扩充为真实长媒体质量证据。首次规则模板仍API预置；运营、外部交付合同缺口及升级回退门槛继续开放，未操作NAS。

## 浏览器维护、健康投影与追加人物展示修复

负责人复查24e995e8e追加截图发现同一演员跨批次重复展示，未据旧验收关闭追加门槛。按其turn `01a11b2b-fac0-7c50-9f08-d09c842b421c`要求，仅Collection展示按非空正式personId去重，再取前12人；保留底层关系、同名不同ID以及未解析人物。前端回归覆盖上述情形；最终演员实现的实际E03追加72.26秒通过，截图 `series-browser-append-people-v2/append-collection-desktop.png` 确认三集与一次Fixture Actor。此次追加截图早于后续独立的movie_only提示修正。

新增 `HELIX_SERIES_BROWSER_CARE=1`：隔离fixture对E01 NFO缺失/E02 NFO损坏后，由详情按钮发起真实检查，Arca正式Aftercare修复后再次检查；保留原Host对唯一Inventory Commit、历史事实、未改文件、控制结算、外键/完整性及重启不变断言。页面桌面/窄屏核对健康结果和键盘返回。

初轮 `series-browser-care.log` 是health选择器匹配两个区域，已改为精确语义区域。v2–v4复现真实服务缺陷：列表never_assessed而详情healthy；新增正式API相等断言后证实CareBasis不同。根因批量healthProjectionInputs评分目标遗漏series_title，单条Collection目标已有该字段。只补相同标题取值顺序，不逐项读取、不更改判定/Owner/持久事实。新增批量501项回归含Season标题，保持有界SQL读取。v5完整浏览器91.73秒通过，详情与列表完整健康投影相同。

截图另发现健康状态下瑕疵区错误提示文件安全问题：Series资格返回movie_only，UI缺少该原因映射。仅补准确的电影适用范围提示，不开放Series接受瑕疵。负责人turn `01a11b39-ffe9-71b2-8a2e-c1667cb78fd3`同意此方向；本轮最终版本尚待验收。

验证：Windows/Linux各61项健康投影、合同及accepted-requirements回归通过；Linux使用既有本地测试镜像只读挂载当前src/test，不是发布镜像构建。最终133前端、8项Series双视口/Axe、Admin构建、P2、包边界/禁用语义及diff检查通过。日志分别为 `series-care-health-{windows,linux,p2,guards}.log`、`series-care-final-{web,ui,build}.log`；全部在仓库外统一证据根。真实媒体质量、完整冷配置、外部交付缺口、升级回退等门槛仍开放，无NAS动作。

最终movie_only提示构建的真实浏览器维护 `series-browser-care-v6.log` 91.66秒通过/0skip，截图 `series-browser-care-v6/care-healthy-{desktop,narrow}.png` 已视觉检查；健康与资格提示一致，列表/详情投影完全相等。临时Host与浏览器已退出。

### 本轮UI验收结果

UI负责人turn `01a11b3d-4af8-7fb3-b0a7-8e7253bdbef6`正式接受冻结提交 `a5dc10fac99194e4214a11912fa06a4fcebad92f` 的适用范围：E03累计三集/三个文件且演员一次，缺失ID/同名不同ID及底层关系保留；页面检查与NFO修复后，列表/详情健康投影一致，桌面/窄屏健康；电影限定瑕疵提示准确且Series资格不变。前次演员重复拒绝项解除。

负责人独立复跑133前端、8浏览器、构建通过；真实追加76.02秒、维护91.80秒均通过且无skip。其未修改源码或操作NAS。仅上述路径通过，完整冷配置、其他运营、外部交付、升级回退和整体发布门槛仍开放。

## Series页面退出收藏

新增 `HELIX_SERIES_BROWSER_OFFDECK=1`，与MANUAL_IDENTITY/BROWSER组合使用；APPEND/CARE/OFFDECK三个旅程互斥。来源配置至两集上架后，从详情发起真实退出审阅，确认Review材料键集合等于正式Inventory全部成员；页面列出2个主视频和4个附属文件。Escape只关闭展示并回焦标题，正式GET确认审阅仍open；重开同一审阅后明确取消，断言cancelled、无Authorization/Case、收藏active、每个文件字节不变。随后再次进入新审阅，核对范围及不可撤销警示，再点击最终确认删除。

保留Arca后端完整断言：目标6个成员删除、范围外sentinel保持、控制和active guard释放、唯一终结Receipt、事务回滚核验、数据库外键及integrity通过；退出列表正确显示已完成，当前收藏消失，桌面/窄屏均验证。素材仍沿可控Probe/Remux fixture，不把本轮外推为真实N:M媒体质量或崩溃恢复证据（该类已有独立专项）。

本轮发现并修正：

- v1浏览器测试在跳转后读取旧POST响应体失败，改为检查POST成功，跳转后从正式GET读取同一Review，不绕过页面动作。
- v2真实退出显示未命名收藏：OffdeckEntryQuery未投影或搜索series_title。补同一Arca事实字段，新增搜索当前Season、建议/名称查询及已退出仍保留剧名的回归。
- 键盘专项复现旧dialog未接管焦点（1失败/10通过）。复用useModalFocus，初始焦点与Tab循环、Escape关闭展示；busy时关闭/取消/确认禁用。无存活原触发元素时回焦页面标题，保留关闭展示与业务取消的不同语义。负责人turn `01a11b45-b534-7bd0-961e-e9add3b0a7e9`同意方向并要求焦点回到可用入口。
- 最终截图发现退出记录的剧名/收藏架粘连，使用既有行内分组的grid及4px间距分行，不增加说明文案。

v3实际退出38.46秒、v4焦点40.36秒、v5关闭/回焦及取消字节保护38.46秒通过；早期失败日志保留。134前端、构建通过，Windows/Linux各1项有界Offdeck查询集成回归、P2/包边界/禁用语义及diff检查通过。日志在仓库外统一证据根，前缀series-browser-offdeck、series-offdeck-query、series-offdeck-final-web-v2、series-offdeck-final-build-v3、series-offdeck-p2/guards。Linux以本地测试镜像只读挂载当前src/test，不是发布镜像。精确版本UI验收与其他发布Gate仍开放，未操作NAS。

最终分行布局构建后v6真实浏览器39.13秒通过/0skip；截图 `series-browser-offdeck-v6/` 内 offdeck-scope-*、offdeck-confirmation、offdeck-completed-*、offdeck-collection-* 已复核，窄屏退出记录剧名与收藏架分行。临时Host与浏览器已关闭。

### 退出确认文案复验

负责人turn `01a11b4a-17f9-7412-8d21-8626ca63ba03`对1014b1411独立复跑134前端、查询/构建及38.31秒实际退出通过，范围保护/取消/回焦认可，但因确认阶段“不能反悔/不能撤销”重复，未关闭本段UI门槛。

仅删除独立重复段，范围摘要保留一次不可撤销后果和共享引用保护；open仍提示后果，selection_confirmed同一段以alert突出。两状态各一次提示的回归加入后136前端及构建通过（series-offdeck-warning-web/build.log）；最终实际退出v7为38.36秒PASS/0skip，截图series-browser-offdeck-v7/offdeck-confirmation.png已视觉确认一次警示，保护断言保持。后端未再变更，不重复Linux/架构全集。新版本待负责人复验，无NAS动作。

负责人turn `01a11b4d-fdba-75b3-8f25-129da02bfdb6`正式接受 `51ed1bb6e89a04d4661382a0c1890c5a69d3178a` 的已验证退出路径：待核对/确认均一次不可撤销提醒，保留共享文件条件，桌面/窄屏可读，前次重复警示拒绝项解除。其亲自复跑退出前端专项13项并审阅38.36秒真实旅程，前次取消/范围/保护/回焦验证保持适用。整体发布门槛仍开放，无源码修改或NAS动作。

## 首次业务配置：系统模板到实际上架

新增 `HELIX_SERIES_BROWSER_COLD=1` 与MANUAL_IDENTITY/BROWSER组合。与原混合加工旅程分别执行；本路径两个MKV成员走Direct，以系统推荐模板原有要求进入生产，不再经API预置用户模板。页面实际登录、登记来源、授权清理、从系统模板复制用户模板、修改未评分Series每集0.5GiB、预览/发布、创建收藏架、发布年份分拣、扫描、人工身份确认、两集上架和双视口Collection验证。

新增只读数据库断言：开始时0用户模板/0收藏架，系统模板恰一已发布revision；结束配置时1用户模板/1收藏架，系统模板完整revision行不变。实际发布响应必须ownerKind=user，系统复制后的ID不同且名称非空，页面选择及建架请求绑定实际新ID。正式Acceptance Spec每份保持 `{unit:episode,maxSizeGiB:0.5,maxSizeBytes:536870912}`，不只校验表单。

最终v3实际Host38.12秒PASS/0skip（series-browser-cold-v3.log）；截图同名目录含series-standard-preview.png、series-standard-preview-narrow.png、shelf-created.png和collection-*。系统复制预览桌面/窄屏与发布选中已检查。v2含完整系统模板保护断言37.05秒通过；原用户模板Direct/Remux混合回归37.36秒通过（series-browser-cold-mixed-regression.log）。仅测试/文档增量，沿既有最终产品构建，不重复前端全集/Linux/服务镜像构建；JS与diff检查通过，临时Host/浏览器已关闭。

精确边界：initializeCleanData仍负责空库、初始管理凭据与系统规则；测试通过正式API登录用于只读结果/断言，但本路径不通过API预置用户规则、来源、收藏架、分拣或清理授权。Provider、身份响应、Probe/媒体及Artifact端口沿既有受控fixture，不包含真实TMDB/外部Provider凭据的首次配置、真实联网或媒体质量验收。不能据此关闭完整环境冷启动/真实集成门槛。原混合加工旅程保持。负责人已确认范围，新增路径待具体SHA验收，无NAS动作。

负责人turn `01a11b55-8bb4-7472-affe-6694225f13f7`正式接受 `31b1df37be4cbf8021277242db61c33ec3506e9c` 的首次业务配置正常路径；独立真实Host38.40秒，1通过/0skip。其确认零用户模板/零收藏架、页面配置至两集上架、系统模板未改写、新模板绑定及0.5GiB/集正式Spec、桌面/窄屏可读。初始化/凭据和Provider/媒体fixture边界保留，不关闭完整环境或真实外部集成冷启动及整体Gate；其未修改源码或操作NAS。


## 同名多Season收藏与无障碍区分

2026-10-08：基于 `5e44f749a203d0087f64ff81e26588919513f02d` 追加同名Series跨季Host场景。S01 E01/E02上架后，在同一来源加入S02E01并再次观察；使用真实TMDB Adapter和按请求Season返回的受控Provider。必须形成两个Subject、两个Season Entry和两份Commit Receipt，S02只有E001，第一季的Inventory/Product Facts/Deck Fact/Receipt及六个文件字节保持，第二季文件路径不与第一季重合、Artifact季号均为2。比对前等待首季异步People登记完成，以免把合法人物关系Inventory修订当成跨季改写；未放宽跨季保护断言。

Windows API Host 94.71秒通过，Linux Node20 Host 103.27秒通过（1执行通过，28条名称过滤skip不计覆盖）。实际浏览器94.30秒通过；补齐Enter打开详情、Escape关闭回焦后95.11秒通过，0skip。浏览器仍从页面登录/来源登记/建架/分拣/扫描开始，二次扫描也走页面；对两个Season分别检查桌面1920与窄屏390、季号/集数/文件、无横向溢出以及准确回焦。Provider、Probe/媒体和Artifact仍为受控端口，不代表真实外部或媒体质量。

发现并修复海报卡可访问名称遗漏季号：可见副标题原已有第N季，aria-label现加入正式Projection季号，使同名Season可独立选择；Movie名称保持。没有新增说明文案或业务规则。前端137项、Admin构建通过；同名双季可访问名称及选择正确详情有组件回归。负责人turn `01a11b6c-2782-7322-b862-6fb8ea0e05c8`已确认设计与验收范围，精确版本验收待跟进。

日志位于统一仓库外证据根：`series-multi-season-windows-v2.log`、`series-multi-season-linux.log`、`series-multi-season-browser-keyboard.log`、`series-multi-season-web-v2.log`、`series-multi-season-build.log`。截图 `series-browser-multi-season-keyboard/season-{1,2}-collection-{page-,filter-,}{desktop,narrow}.png`；前轮桌面/窄屏双季墙与第二季详情已视觉复核。完整路由Host文件的额外回归仍运行，不提前记为通过。多季运营/破坏性操作隔离、完整冷启动和外部合同及最终发布门槛保持开放，未操作NAS。


负责人turn `01a11b72-e353-7e70-823a-4bb127d6ec31`接受 `b490aad3633229907802034b4b9bdba40b6d736c` 同名多季收藏UI：独立实际Host95.93秒、137前端、8浏览器及构建通过；季号可访问名称、详情范围、Enter/Escape/回焦和双视口已确认，首季六文件/事实不变。不包含后续退出增量或仍在运行的完整路由文件回归。负责人同时同意退出搜索/已选/审阅/历史使用正式季号统一显示，要求实现后独立验收。


## 同名多Season退出与首季保护

2026-10-08：OffdeckEntry增量投影 `seasonNumber:number|null`。Arca从当前Inventory的resolved_identity读取，逐份校验Season canonical key与Entry一致；缺失或不一致拒绝，不猜测标题/文件名。Movie为null。仅在已有有界页/精确ID读取中加载Season身份，不构造Collection完整详情。搜索、已选缓存、建议/执行中、审阅与历史共用“剧名 · 第N季”；危险授权与Material范围合同不变。

API查询与UI测试先复现缺季号，再修复；Windows/Linux查询各1项通过（包含1000条分页、Movie不变、已退出季号保留及错误Season拒绝），138前端、Admin构建、P2/边界/禁用语义检查通过。

实际双Season旅程通过 `HELIX_SERIES_MULTI_SEASON_OFFDECK=1` 扩展同名双季场景。浏览器从退出页搜索同名两季，仅勾选S02；关闭/重新打开和取消无授权、两季字节不变；再次搜索选择S02，审阅范围精确等于该季当前Inventory四成员，核对/授权后全部删除。唯一终结回执、S02 offdecked、S01 active，首季六文件字节、Inventory/Product Facts/Deck Fact/Commit Receipt及Material Control完整保持；返回收藏仍能打开S01两集。桌面/390窄屏审阅和退出记录季号正确，保留确认后果与键盘焦点约束。

Windows真实浏览器v2 98.45秒通过/0skip，Linux实际Host103.84秒通过（1执行通过、28名称过滤skip不计覆盖）。首轮浏览器已完成物理和保护断言，但旧辅助函数错误要求收藏为空；改为对剩余首季可见及其详情的显式检查后复跑通过。原单季实际退出40.74秒回归通过，六成员删除/唯一终结/原子回滚与范围外文件保护保持。Provider/媒体fixture边界不变，未触及NAS。

日志：`series-multi-season-offdeck-browser-v2.log`、`series-multi-season-offdeck-linux.log`、`series-single-season-offdeck-regression.log`、`series-offdeck-season-{query,query-linux,web,build,p2}.log`，位于仓库外统一证据根。截图 `series-browser-multi-season-offdeck-v2/` 包含offdeck-season-search、offdeck-scope-*、offdeck-confirmation、offdeck-completed-*及protected-season-collection-*；搜索与窄屏审阅已视觉核对，具体版本待负责人验收。

前轮启动的完整 `series-routing-run.test.js` 回归已结束：29通过、0失败、0skip，951.67秒（日志 `series-multi-season-routing-unit.log`，命令名虽为unit，实际包含完整Host场景）。覆盖当时b490aad36的同名双季、24集、位置迁移/改名、NFO/poster维修、Direct/Remux、逐集空间/共享Primary/parts、追加/并发。它不替代本轮退出增量的上述专项或最终候选全量。
