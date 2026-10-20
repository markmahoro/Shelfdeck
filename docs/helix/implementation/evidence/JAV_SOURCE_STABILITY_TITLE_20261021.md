# UAT-323 / UAT-324 JAV 连接与标题修正

日期：2026-10-21，Asia/Shanghai。用户反馈来源连接不稳定、影片名带“免费AV在线看”，要求参考 JavSP。状态：两项根因有生产/源码证据，针对已确认路径本地修正通过；未部署，未关闭 UAT。先前 UAT-322 待办及未提交定位文档保持，不混作本轮产品修复。

## 范围和参考

基线 `codex/us-adult@1b7b683e0`，生产仍为 `helix-beta-20261020-af2257c423`。生产仅 readonly SQLite、独立 Node 进程读取公开页面/图片；没有调用连接配置写 API、保存配置、创建整理任务或修改媒体。

参考官方 [Yuukiy/JavSP](https://github.com/Yuukiy/JavSP)，本轮只读 clone 的 HEAD 为 `c4cfe61188234dd24c75b53b42b054327fef3e58`，与之前冻结参考相同：

- [javmenu.py](https://github.com/Yuukiy/JavSP/blob/c4cfe61188234dd24c75b53b42b054327fef3e58/javsp/web/javmenu.py)：明确处理主标题中的站点广告尾缀。
- [base.py](https://github.com/Yuukiy/JavSP/blob/c4cfe61188234dd24c75b53b42b054327fef3e58/javsp/web/base.py)、[__main__.py](https://github.com/Yuukiy/JavSP/blob/c4cfe61188234dd24c75b53b42b054327fef3e58/javsp/__main__.py)：共享代理出口、站点级请求参数；网络异常有限重试，not-found/权限错误停止。默认 retry=3，timeout=10秒；这不等于ShelfDeck应复制其多站并行汇总或总预算。
- [javdb.py](https://github.com/Yuukiy/JavSP/blob/c4cfe61188234dd24c75b53b42b054327fef3e58/javsp/web/javdb.py)：另有Cloudflare及浏览器Cookie处理；本轮未借用这些执行器、扫描浏览器凭据、加入隐藏镜像或切换代理。

复用记录：仅参考两个叶子行为（已知站点广告清理、有限同站重试）；ShelfDeck独立实现于现有Integration模块，不复制第三方函数/执行器，不新增依赖，保留单站title+cover、完整番号身份、Host白名单和冻结route约束。

## UAT-323：连接失败的已确认路径

1. 生产8个JAV Integration均active，lastTestSummary均为passed，但时点不同；只表示最近保存的测试成功，不能说明每个影片/每次请求可用。
2. 最近持久化执行失败有 `JAV_SOURCE_URL_DENIED`。从该Run的公开执行结果链定位输入为`ABF-047`；NAS独立只读client复现：JavMenu主页面HTTP200、身份核验通过，但封面请求前在`stage=cover`被Host边界拒绝。当前页面明确声明的封面Host为`fmtu.sl2025p.com`，不在旧白名单；不是该次已证明的网络超时。
3. 使用相同全站代理直接核验该精确声明图片：HTTPS/HTTP200、image/jpeg、148144 bytes、800×539，sharp实际解码成功。只增加已验证的精确Host；未增加通配子域、HTTP、任意重定向或本地IP权限。
4. 设置中的连接测试以前只有一次完整sample观察；瞬时503/连接reset可能直接显示失败。人工选片/纠正预览已有同站两次上限，正式后台也有contract retry；不能把它们描述成全系统从未重试。
5. 本地连接测试现在最多两次，仅对`JAV_SOURCE_UNAVAILABLE|JAV_SOURCE_TIMEOUT`，保持同endpoint、同sample及同冻结route，共享原始deadline。首轮耗尽总预算不额外延长；403、404、资料不合格或URL边界拒绝不靠重试放宽。仍然只有正式qualified sample才生成连接证明。

生产原版client经全站代理的4个独立样本当时均qualified：JavMenu/IPX-177约2.26秒、JavDB/IPX-177约1.90秒、FC2/718323约2.20秒、HEYDOUGA/4030-2113约2.99秒。JavDB/ABF-047返回ambiguous，未擅选首条。这些都是短窗口叶子Evidence，不是八站长期稳定性或完整入藏PASS。

## UAT-324：标题广告进入事实

生产查到2份resolved_identity Fact包含已知广告后缀，对应`ABF-153`、`ABF-213`，来源均为javmenu。根因为`jav-source-pages.js`将主h1/strong直接交给通用title helper；helper仅去除前置番号，没有JavMenu专用广告清理。JavSP已针对该站处理，之前移植主区域选择时遗漏此行为。

本地仅在JavMenu主标题边界清理末尾已知装饰：繁简“免费/免費[AV]在线/在線看”及“JAV目錄/目录大全 | 每日更新”。保留片名内部同样字词，其他来源不变，不用全局字符串替换污染影片标题；清理后为空仍然不合格，完整番号核验保持。

用户旅程保持既有文件来源连接测试、整理列表/身份预览及收藏入口：正常态显示片名，瞬时连接失败在原测试动作预算内再尝试一次，最终失败沿原安全错误合同；不新增常驻说明或伪造成功。没有修改UI布局或新增展示文案，但标题是用户可见结果；本轮没有具体版本浏览器/UI负责人验收，不记UI PASS。

## 验证与发布边界

- Windows专项：`node --test test/helix-architecture/jav-source-resilience.test.js test/helix-architecture/jav-source-runtime.test.js test/helix-architecture/jav-source-contracts.test.js test/helix-architecture/jav-aftercare-source.test.js`，40 PASS/0fail/0skip，约22.58秒。
- 覆盖广告尾缀/正文保留/错号/空title/其他来源隔离、新Host真实图片fixture与恶意相似Host/loopback拒绝、503恢复、永久错误不重试、重试上限及超时；保留已有proof、route变更失效、Handle隔离、封面资格变化拒绝等回归。
- Package boundary、forbidden semantics、manifest set、P2 contract baseline四项静态检查均ok。
- 修改后的本地client通过同一NAS全站代理读取JavMenu/ABF-047：qualified，声明封面Host正确、title非空且无广告尾缀。只是只读Integration观察，未形成Product Fact、NFO、命名或入藏结果。
- 未执行完整Service/Web/Architecture、Linux候选镜像、Windows分发、精确版本UI或生产完整媒体E2E；没有构建/上传/发布，没有改生产配置或文件。

Host集合变化会改变javmenu的endpointProfileDigest；后续发布须遵守既有精确Handle/Source Snapshot围栏和未完成条目的clean-cut纪律，不增加旧运行兼容或偷偷替换已冻结来源。标题修正不自动改写已入藏Fact、旧命名/NFO及既有selected-source资格；既有污染条目的正式Arca纠正/刷新资格及范围尚未验证，不可用直接SQL或批量改文件代替。

UAT-323仍需收取用户所见其他站点失败的精确场景及后续稳定性证据；本次只确认并修正一个具体Host拒绝和连接测试瞬时失败路径，不宣称所有来源稳定。UAT-324需后续精确版本呈现及新整理链路验收；已污染收藏的处置另行形成明确范围。

只读探针及诊断JSON位于主工作区ignored `.codex/jav-*-20261021.*`；第三方源码clone也在ignored目录，不提交原页面、图片、生产数据或凭据。
