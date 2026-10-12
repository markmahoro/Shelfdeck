# UAT-318：有界查询的部署前UI接受

2026-10-12，UI负责人接受 `9a23b01c7ff8c5d16272898e2efe3296e500cd0c` 的受影响查询输出、当前动作、评分、分类和详情入口，部署前UI门禁通过。主任务可继续用户已授权的标准部署流程；UAT-318真实生产Tab/HTTP长尾性能仍开放。未修改产品代码、部署、Reset或重处理任何生产媒体。

根因、主任务双平台验证及生产备份交错对照见 [UAT-318实施Evidence](UAT-318_FORMATION_TAB_QUERY_PERFORMANCE_20261012.md)。同快照的12次三section JSON等价是查询层证据，不构成完整Host、浏览器或生产性能PASS；本负责人审阅了对照脚本及记录，没有重跑NAS备份对照。

## 审查与独立验证

Foundation只有显式传入有界 `resultCapabilityRefs` 的调用精简Result正文，Event结果头部及时间保持。Libra列表声明10个分类/分支/当前动作所需Capability，打开详情不传该范围，仍完整读取并执行原JCS与digest fence。Perception当前评分按target、query digest及当前head有界读取；retraction、Resolution及Winner保持原Owner判断。没有前端替代事实、丢弃事件、删除历史、状态回退或兼容绕行。与9478a4fc7比较，Web产品代码、文案和布局没有diff。

从指定SHA的git archive冻结副本执行：

- `helix-formation-projection.test.js`、`formation-process-projection.test.js`、`helix-architecture/p6-perception-store.test.js`、`helix-architecture/p6-perception-resolution-resolver.test.js`：81通过、0失败、0跳过。包含列表/详情当前动作一致、Result头部保留、所需正文及默认完整读取的篡改拒绝、无关历史不全扫、600目标跨500边界、缺失目标、retraction与当前Winner不变。
- TypeScript/Vite构建通过；JS `index--m8OvhRG.js`、CSS `index-BxRYbDd1.css` 与上一已验收Web产物名称保持。没有依靠修改界面掩盖读取问题。
- 隔离Chromium实际加载该bundle，HTTP适配器调用真实FormationQuery与SQLite ProjectionStore，当前事实/history ports为fixture。与父版本比较，三个section的完整fixture查询返回deepEqual；跨section summary保持一致。
- 额外用真实ExecutionProgressProjectionReader构造两个Event：含64KiB资料正文的metadata与含保留原输入结果的settlement。列表范围从本SHA声明的10个Capability提取，metadata只有头部，settlement完整；默认详情保留metadata正文。由实际ProcessDetail/currentPlanSummary构建，精简/完整读取所得当前动作一致，仍为“保留原有输入作为最终文件”。
- 浏览器同一条目显示该当前动作及“4星·豆瓣”，打开原“查看过程”，按真实折叠控件展开后可见metadata正文中的“完整资料示例”及保留原输入的处理结果。Esc关闭并恢复按钮焦点。评分的有界Owner读取由上述Perception回归单独证明；浏览器的current-rating port为受控值，不冒充真实豆瓣同步。
- stale/ready与两种active/completed响应先后，共4组合通过；状态/片名/收藏架筛选、刷新、reload、历史、空态及最后一页控件保持。1920×1080与390×844计数/入口可见，九列不变、无横向溢出。0浏览器异常、0未预期接口、0写请求。

审计目录 `E:/my_project/helix-git-consolidation-20261008/uat318-20261012/`：源码包 `source-9a23b01c7.zip` SHA256 `ae9dc79ae7dc3622bce8df7ee2866d3c53150f3be10d55dba9d7e6a0327f74b2`；`owner-tests.log`、`web-build.log`、最终 `browser-run-v2.log`。浏览器脚本 `formation-browser-audit.cjs` SHA256 `fadb02bf5562bf0901bf4e1223b90ae030006f52e1747b27c6cb2b196f8db6d6`，`browser-evidence.json` SHA256 `0dc3564a09374e364387b0d7968c63423d0f3cbb1167eeeb79f64508dd5791d0`。

已目检 `full-detail-desktop.png`、`all-unfiltered-desktop.png`、`ended-390.png`。首轮浏览器脚本误将已展开阶段再次点击关闭，导致其内部Plan不可见而超时；保留 `browser-run-v1.log`，改为先读原生open状态，仅展开尚未展开的控件，完整路径重跑通过。没有强制改DOM、放宽产品校验或修改产品以通过fixture。

## 接受边界

以上是指定版本的部署前UI与读取语义接受。隔离场景为既有Movie形状的Subject、受控current-fact/history ports及Process事件fixture；不是完整Clean Host、真实Series整季生命周期、生产NAS并发负载或豆瓣服务验收。完整生产备份查询等价另由原实施Evidence记录，不能拼接成新版本整页性能PASS。

本项最终镜像构建/部署资格由主任务处理。部署后需重测真实四Tab、刷新、自动更新的请求与结果可用时间、当前动作/评分/分类/详情，保留HTTP长尾、health及NAS/后台执行的独立证据；此前9478a4fc7曾观测约18.9秒请求，不因局部字节数下降而关闭。五项失败媒体继续保持用户“暂不重处理”的决定，不通过停止业务、Reset或改变事实口径获取性能结论。后续任何用户表面diff需按新SHA重验。
