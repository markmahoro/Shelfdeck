# UAT-315：Formation计数的部署前UI验收

2026-10-12，UI负责人接受 `9478a4fc777f778bdc75ef8d2fa0a014ec852b3f` 在本项范围内的计数修正及既有页面交互，允许主任务继续已获用户授权的部署流程。本结论是部署前UI门禁，不关闭生产现场复验或整页性能问题；没有部署、Reset或重处理任何生产媒体。

原现象及生产边界见 [UAT-315–317诊断](UAT-315_317_PRODUCTION_DIAGNOSIS_20261012.md)。本项只评审 `formation-query.js` 的用户表面影响，不把同一提交的Reset或FFmpeg诊断修正一并认定为UI/业务验收完成。

## 审查结论

原查询只在active中按当前事实纠正已终结Run；completed/ended仍报告过期投影的活动数量。现有页面并发查询后分别setSummary，响应顺序因此可覆盖真实数量。修正将相同当前活动事实应用于三个section，复用active已有读取结果，不为summary读取完整Plan。

Projection Source只读取本视图实际使用的active/frozen/suspended Run或最新completed Run执行图；未删除历史Run，也未扩大业务Owner或建立前端状态权威。页面、文案、九列表格、筛选、分页、配置与操作入口均无产品diff。本项不修改已确认的UI设计规则。

## 精确版本及验证

从指定commit的git archive副本构建与运行。审计目录：`E:/my_project/helix-git-consolidation-20261008/uat315-20261012/`。源码包 `source-9478a4fc7.zip` SHA256：`a4bcdc3f3adbab76c94a48c6f40cdee394b868e204dad1775011f5a553d1a784`。Admin构建通过，JS产物 `index--m8OvhRG.js`。

- `helix-formation-projection.test.js`与`formation-process-projection.test.js`：56通过、0失败、0跳过。包括当前终局覆盖、跨section计数、筛选/分页、历史访问、历史图不读取及summary不加载Plan。日志 `query-tests.log`。
- Chromium实际加载该版本Admin bundle，随机127.0.0.1端口。HTTP适配器调用真实 `createFormationQuery` 与真实 SQLite `FormationProjectionStore`，current-fact/history ports为受控fixture；没有在浏览器拦截API，也不是完整Clean Service Host。
- Fixture基于既有Movie形状的Subject：投影9条整理中、1条完成，当前事实中3条活动记录已终结并进入历史。父版本查询精确复现inProgressCount `6/9/9`；候选三个section均为`6/6/6`，完整summary一致：total7、inProgress6、attention0、completed1、ended3。
- 对`stale/ready`两种Projection状态，各调换active/completed响应先后顺序，共4种组合。实际页面DOM轨迹没有重新出现“整理中9”；显示“全部10、整理中6、需要处理0、已结束4”，10条数据行与6活动/1完成/3历史对应。
- 从页面切换整理中/需要处理/已结束/全部；片名筛选和收藏架筛选均实际发出正式GET并返回对应条目，状态数量保持全局当前事实口径。已结束显示4条，历史仍可访问；最后一页的下一页禁用。
- 键盘打开既有详情、Esc返回且恢复触发按钮焦点。刷新与直接reload后数量和数据行一致。空fixture的四项数量均0，显示既有空态；不把空态占位tr当作数据行。
- 1920×1080及390×844计数与入口可见、无页面横向溢出，九列表格保留；截图已目检。全过程0浏览器异常、0未预期接口、0写请求。

脚本 `formation-browser-audit.cjs` SHA256 `27f00871e0b25d7e4706c664704c73cb2e0852108a7fff2f76ceef035b55cbe4`；最终日志 `browser-run-v8.log`、查询/DOM轨迹 `browser-evidence.json`。截图：`all-unfiltered-desktop.png`、`all-desktop.png`、`ended-1920.png`、`ended-390.png`、`empty-desktop.png`。

前序fixture错误保留于v1–v5日志：内存SQLite不满足WAL、跨VM对象不满足plain JSON、缺少Subject FK种子、过早断言异步数据行以及误将空态占位算作数据行。未放宽产品保护，最终使用独立WAL数据库、plain JSON、合法测试种子、等待可见结果。v6/v7走查通过但截图检查发现捕获了刷新时的部分空结果，因此最终补充等待completed响应、完整数据行及无空态，按v8完整重跑。History fixture按正式降序契约排列；无产品代码修改。

## 接受边界及部署后要求

本次接受的是UAT-315所述终局残留造成的计数不一致及受影响查询/页面交互。受控current-fact/history ports、既有Movie形状及人为响应延迟不替代三部生产Series的真实生命周期、完整Service Host、NAS数据规模或生产I/O。业务事实在请求之间真实变化时，不承诺多个HTTP响应共享原子快照。

未重新运行整个镜像专项或桌面构建；主任务的120通过/1既有live BDMV缺失skip不能替代本页实际性能验收。没有用本地fixture耗时声称生产提速或SLO通过。

部署后由主任务只读复验active/completed/ended及页面刷新、分类数量、已结束历史，并采集完整HTTP/页面响应与health、NAS I/O表现；此前构建期间的I/O等待、health超时仍须独立解释。在这些证据取得前，不宣称生产计数已通过或整页延迟已解决，不重处理用户指定的失败媒体。

## 生产只读复验：计数通过，性能仍开放

2026-10-12 23:13–23:27（Asia/Shanghai），生产已由主任务按标准流程部署 `9478a4fc777f778bdc75ef8d2fa0a014ec852b3f`。UI负责人在真实Edge现有管理台会话执行reload、四个Tab及手动刷新，只操作读取入口；没有配置修改、评分、加急、放弃、重新整理、Reset或媒体动作。本项计数问题的生产UI接受条件通过，可由主任务独立收口UAT-315的计数结论；整页与Tab性能问题继续开放。

浏览器收到的active/completed/ended多个同轮响应summary完全一致：`totalCount=510 / inProgressCount=7 / attentionRequiredCount=0 / completedCount=503 / endedCount=99`，Projection为ready。维护查询counts为completed56、ended31。现有页面合并维护条目后显示“全部696、整理中7、需要处理0、已结束689”，符合 `510+99+56+31=696`、`503+99+56+31=689` 及 `7+0+689=696`。不把维护数量遗漏造成的差额误判为Formation计数故障。

整理中显示7个当前条目，三体、繁花、兰闺喜事未出现在活动行中；已结束列表仍能看到这三项正式历史及其它结果。四个Tab、刷新及reload中未复现旧section口径造成的7/10横跳。此前主任务观测5、随后正常任务进入成为7，与本轮稳定7不是同一事实时点，不据此判缺陷。真实页面保留九列与既有分类入口；需要处理0显示筛选空态，全部/已结束首屏25行、整理中7行；已逐张目检截图。

下表为一次生产样本；“控件反馈”表示选中Tab、状态按钮与搜索输入可用的首次观测，“请求完成及结果观测”要求本次动作触发的formation/care请求均结束且当前分类可见行数匹配。两者包括浏览器控制通讯与采样开销，为观测上界，不是纯渲染性能指标。相同数量的旧行可能先于新响应保持显示，因此不将首次25行可见解释成新的服务器结果已经就绪。

| 动作 | 控件反馈 | 请求完成及结果观测 | 浏览器HTTP请求耗时 |
| --- | ---: | ---: | --- |
| 需要处理 | 0.373s | 1.965s | active分类1.659s，care1.661s |
| 已结束 | 0.305s | 7.604s | completed6.523s、ended7.180s、care7.414s |
| 全部 | 0.301s | 3.602s | active0.982s、completed1.960s、ended2.520s、care3.350s |
| 手动刷新全部 | 0.357s | 4.449s | active3.682s、completed4.074s、ended3.021s、care3.100s |
| 整理中 | 0.309s | 0.986s | active分类0.673s、care0.674s |

CDP还观测到正常后台刷新一轮active16.263s、completed18.924s、ended17.787s、care17.873s；本轮所获Formation请求范围0.641–18.924s，不能用某次低延迟关闭性能问题。证据表明等待包含真实HTTP请求耗时；未同时取NAS/服务端剖析，不能将其进一步武断归因前端、NAS I/O、数据库或单个模块。验收末尾独立公开GET `/v1/health` 为200/status=ok/normalSupplyAllowed=true；这一时点健康不抹去此前超时或长尾。

证据目录为原审计目录下 `production-9478a4fc7/`。`production-browser-evidence.json` 保存5次动作及298条脱敏请求记录，SHA256 `9dbe1cd8e034a04922affab9e3d5efb098fb5162d7458b800e5b3e5f2926f5cd`；只保留path/query、GET、状态、时长、summary/counts/Projection及条目数，没有请求Header、Cookie、API key、响应正文或凭据文件内容。操作记录全部为GET。首次reload附近事件缓冲曾报告truncated，故不宣称捕获浏览器全部资源；其已配对API请求及后续游标连续采集可用于对应样本。

截图 `01-attention.png`、`02-ended.png`、`03-all.png`、`04-refreshed.png`、`05-in-progress.png` 均为真实最大化视口约2552×1261。测量结束恢复进入时的“整理中”Tab并停止本任务的Network观测；没有关闭或更改用户其它浏览器页，也没有改动生产任务。本轮没有重新进行窄屏或性能SLO资格验收，先前隔离窄屏证据保持其原边界。后续查询性能修复若影响用户表面，需针对新版本重新验收，不能继承本版PASS。
