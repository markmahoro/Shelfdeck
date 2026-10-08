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
