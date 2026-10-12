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
