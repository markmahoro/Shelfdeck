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

## 第二轮根因及候选（2026-10-13）

生产10.76秒CPU采样中，概览Formation调用累计约2.85秒，收藏健康汇总约2.19秒；这是含子调用的样本时间，不能相加当作总CPU或解释每个43秒请求。临时Inspector仅容器loopback启用，采样后已关闭并复核连接拒绝，无业务写操作。整理列表为读取架名称经listShelves装配注销摘要，每架遍历当前Inventory Materials；概览一次同步调用四遍Formation，增加主线程等待。候选在现有Arca public facade新增listShelfNames，仅返回同一Shelf持久事实的ID/name；Formation只使用这份姓名投影，不读取注销摘要，完整Shelf Admin入口保持不变。概览四次查询之间setImmediate让出线程，不改变五秒cadence或概览原子发布。没有移转Owner、弱化校验或新增缓存事实。

Windows相关Shelf/Formation27通过，Overview及4000条分页汇总8通过；纯前端补丁实际Chromium桌面延迟走查通过（首轮因fixture误用care-work URL失败，改为实际/v1/admin/care后通过）。覆盖等待→真空态→等待→条目，截图保存在ignored Playwright输出，临时Host由runner关闭。当前候选仍待精确镜像、跨层UI审核及生产复验。

## 第二轮发布准备（6feda0d26）

产品git `6feda0d26a3d3ff5994a17d23d83ac1bc3a756ce`，镜像`markmahoro/shelfdeck:6feda0d26`，Image ID `sha256:88ee3b310b9d07fab4c95914e3936152014a09e601163f9bf38e67b0dc0d9af7`，tar 1724121600 bytes、SHA256 `f7fb047d9ebecefa14a5db8b2b7e0e285900d7c46efb59337bd0ab0e5439f11d`。固定build/upload入口通过，上传SHA一致，fnOS只读preflight及部署dry run完成。最终镜像35/35（相关Shelf/Formation/Overview，测试文件注入临时容器，产品源自完整镜像），未重跑整季加工E2E/desktop全量。Chromium加载截图已目检，结果移至ignored `.codex/series-release-20261012/uat318-second-browser`，不是仓库生成物。

发布前备份 `/vol1/1000/docker/shelfdeck/backups/uat318-6feda0d26-predeploy`：DB2735779840 bytes，SHA256 `13b7bde97fbe41c91327011e0cb9fee25437647add3d570f3c4754daa6466278`，512 Entry/512 Commit/36575 Inventory Materials/647 Run，45份companion稳定复制；Compose/Secret保留原权限，目录700/Secret600。本地下载integrity ok/FK0/完整SHA匹配，verification-local.json已回存备份600。业务继续运行，因此不是部署后DB逐字节保护快照或恢复生产数据的授权；常规回退保留9a23镜像及备份，不直接倒灌业务DB。

前一版9a23在本次备份结束后的四请求并发三轮为6569/2022/1376ms，首轮真实业务从attention转ended期间summary头发生变化，不能判为再次计数横跳；此处保留全部样本，未编造固定DB或SLO资格。第二轮当前尚未apply，跨层具体版本UI审核仍待完成。

## 第二轮生产复验与第三轮热点

2026-10-13第二轮已标准发布 `markmahoro/shelfdeck:6feda0d26`，git `6feda0d26a3d3ff5994a17d23d83ac1bc3a756ce`，Image ID `sha256:88ee3b310b9d07fab4c95914e3936152014a09e601163f9bf38e67b0dc0d9af7`，tar SHA256 `f7fb047d9ebecefa14a5db8b2b7e0e285900d7c46efb59337bd0ab0e5439f11d`。备份integrity ok/FK0/SHA、readiness/health/供给/Admin/五挂载/QSV通过，RestartCount0；最终镜像35通过，跨层UI具体版本66项及实际页面接受。生产Chromium两轮四Tab：有条目Tab误报空态0次；正常空结果保持，未执行媒体写操作。但HTTP仍有15.9秒长尾，UAT-318不关闭；追加采样定位Series候选恢复中反复构造未签发策略Work，局部修正139专项通过、未发布。未执行整季加工E2E/desktop全量，五项失败媒体仍未重处理。

两轮实际桌面Tab/DOM MutationObserver没有出现“有条目Tab”的空态闪现；正常需要处理0项仍显示空结果。样本包含700ms稳定观察等待，不作为精确首绘时间。实际认证后请求范围约0.312–15.856秒，保留全部长尾；初始未登录401属于正常session交换前请求，不作为服务故障。独立三轮四请求并发3269/1382/2004ms，不是P95/完整资格。第二轮切换65.0秒，冷启动比之前更长；追加10.36秒startup采样发现9.54秒落在Libra Run reconcile，readSeriesProductionCandidates及整季依据/策略Work重复构造占主要部分，不能再把全部启动耗时称作数据库校验。临时Inspector仅容器loopback，采样结束服务就绪后已关闭并复核。

第三轮局部修正：用同一Libra Work工厂的确定性stage前缀预筛当前Run已成功Work包含的策略ordinal，只为这些ordinal构造成员的完整Work；仍按原升序、精确Work ID及原Result/Verification/Selection完整性栅栏消费，未签发Work不能产生候选。无新路径算法、状态兼容、跨域事实、全局缓存或资源管理。139项原Series Source/External Scope/Replacement/Episode Space通过，新增缺省不构造任何transcode策略、failed策略跳过、完成ordinal64仍严格读取并拒绝缺失Result的真实fixture测试；其生产表现尚待最终验证，不能称长尾已修复。
