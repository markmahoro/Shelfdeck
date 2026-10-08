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
