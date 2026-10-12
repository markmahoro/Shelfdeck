# UAT-318：Series上线后媒体整理Tab切换延迟

2026-10-12用户追加现场反馈。生产9478a4fc7计数已通过，但性能独立开放。原API、浏览器样本及I/O边界见[315–317 Evidence](UAT-315_317_PRODUCTION_DIAGNOSIS_20261012.md)和[UAT-315生产走查](UAT-315_FORMATION_COUNT_UI_ACCEPTANCE_20261012.md)。

## 根因及修正范围

Tab切换按现有分页合并读取Formation/Aftercare；后端读取当前Plan时，顺带装配完整Event Results，Series逐集资料使单请求读取量增长。summary又读取当前活动事实，因此completed/ended也重复读取活动Run相关结果。Perception的批量评分方法还全扫约1941个head/1961个Resolution，先读完整历史再在JS中过滤目标。此处量化了多余读取，不声称解释全部NAS I/O或HTTP长尾。

现有Owner内修正：Foundation progress reader新增有界resultCapabilityRefs查询范围，只为调用者所需能力读取完整Result，其他Event保留outcome/schema/digest/committedAt头部；默认详情读取保持完整及原JCS/digest校验。Libra列表显式声明分类、分支与当前动作所需结果，完整过程仍按原入口读取。Perception按请求的target/query digest/head分批读取当前记录和Resolution，保留retraction、最新head、Winner及全部既有Evidence校验。没有新Owner、缓存权威、兼容修复、业务终态规则或HTTP写副作用；API与页面字段不变。

## 验证

Windows四组初次77通过；新增有界读取/一致性测试后相关76通过，Linux同源四组79通过/0失败/0skip。测试覆盖600缺失target跨500边界、retraction仍可见、当前Resolution/Winner不变、评分查询拒绝全表历史扫描、Result头部与时间保留、列表/详情当前动作一致，以及所需Result篡改仍拒绝。尚未构建或发布本项最终镜像；不是生产性能验收关闭。

NAS disposable容器CPU1/memory1GiB，以已验证生产备份作只读业务输入，对旧版/候选按before-after-after-before交错运行active/completed/ended。所有12次完整返回JSON一致（含计数、当前动作、分页及Series交付范围）；不挂生产媒体，不修改原运行DB。启动使用完整Kernel校验，因此备份验证期间会占NAS I/O；容器--rm已退出。

| section | 旧版处理ms | 候选处理ms | 旧版结构化Result bytes | 候选bytes |
| --- | --- | --- | --- | --- |
| active | 1096–1717 | 703–787 | 8938153 | 1200767 |
| completed | 1312–1981 | 803–898 | 15067635 | 1906516 |
| ended | 625–704 | 316–375 | 8779871 | 1200767 |

每次读取的字节数下降约86–87%。completed的评分历史读取从3922行变33行（含summary当前活动目标），active/ended从1961变8；结构化读取保持目标数据等价。这是同快照查询层测量，未含真实Clean Host后台执行、HTTP及浏览器渲染，不能把它称作整页Tab性能通过。

本地Node25读取同快照遇历史Perception Record digest fence；同一代码/数据在生产Node20只读剖析及隔离对照通过。本项没有修改或放宽Record完整性规则，也没有处置历史记录。

## 剩余验收

最终版本需精确UI负责人接受、标准镜像及部署资格、生产真实Tab/刷新/后台更新和HTTP长尾复验。五项失败媒体保持用户“暂不重处理”决定；性能改善不得用停止业务、Reset、丢弃过程或改变事实口径实现。

## 2026-10-13生产复验及加载空态补充

2026-10-13生产已标准发布 `markmahoro/shelfdeck:9a23b01c7`，git `9a23b01c7ff8c5d16272898e2efe3296e500cd0c`，Image ID `sha256:23ec509e81511ee9fc84f50ad61f87c633a4ab8ac6d9cc2e4d508fc24f994a7b`，tar SHA256 `e7d95627ebc588c0161e6e109452f5edc5c479744c307558ea69f868695055ff`。标准checksum/readiness/health/Admin/五挂载/QSV通过，RestartCount0；最终镜像专项79/79，发布前备份509 Entry/509 Commit，本地integrity ok/FK0及SHA匹配。未重跑整季加工上架E2E或desktop全量，五项失败媒体未重处理。真实四请求并发样本旧版三轮4891/2530/4762ms，新版3626/1683/1750ms，仍有长尾，UAT-318不关闭；这不是完整SLO资格验收。用户追加整理中加载时误报空态，纯前端补丁专项14项及Web构建通过，尚未发布；服务优化生产UI审核仍进行中。

加载空态根因：切换筛选使用新filter过滤旧pageRows，且onPartial可能先收到空stream，rows.length===0直接呈现真实空态，没有检查pageLoading。纯前端修正：筛选事件即刻进入加载态，空行在全部分页stream完成前显示短加载状态；读取失败保留错误和刷新入口，不再宣称无条目。不改变API、分页或业务分类。延迟测试覆盖空stream先返回、全部完成后真实空结果、回到整理中迟到的真实条目，以及请求失败。Web专项14通过、TypeScript/Vite构建通过；尚未做该补丁实际浏览器走查或生产发布，不把测试通过称为已解决生产闪现。按用户新流程，此纯UI补丁可由实施任务核验，跨层查询优化仍须UI负责人审核。
