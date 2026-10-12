# 升级后生产异常排查：UAT-315–317

2026-10-12，生产镜像 `markmahoro/shelfdeck:cab3e2d77`。用户要求优先排查异常占位、Reset残留、三部剧失败、计数跳动和页面延迟。安全停机与用户Reset仅保留需求，未修改SSOT或实施功能；狂暴女神/sample仍待优化。

## UAT-315：整理计数不一致

同一生产实例顺序GET：active summary.inProgressCount=6（2898ms），completed=9（1738ms），ended=9（759ms）。三者projection.status=stale。三个差额对应已discarded的三部剧，持久投影仍in_progress；三部均没有Pipeline Token。

`formation-query.js`原来仅active查询按当前事实修正summary；completed/ended仍用投影计数。`FormationPage.tsx`并发读取active/completed且分别setSummary，后到响应覆盖先到值，因此出现6/9跳动。后台投影无法及时写入的原因与UAT-317磁盘满一并复核，不将投影过期直接归因Reset。

本地修正所有section按当前active事实修正计数，并复用active页已读取结果；增加discarded场景跨section一致性断言。Windows投影33项与Reset32项合计65项通过。未部署、未进行Linux验证、未取得具体版本UI接受，不关闭。新增事实读取的开销仍需性能验证。

## UAT-316：三部剧已真实终结

| 剧集 | Run | 正式失败点 |
| --- | --- | --- |
| 三体 | `ccdeec76a39d046c28c900fb5ed7b981c47c7361e153ad31302a85097494e152` | `libra.product_metadata.fetch@1`，3次请求后`PLATFORM_INTEGRATION_NETWORK_FAILED` |
| 繁花 | `8ba7d85bac1c76925675fc970153ada1f45fdaeb7462c60c2c64e73945715cad` | `libra.product_identity.evidence.observe@1`，一次网络失败、两次超时，最终`PLATFORM_INTEGRATION_TIMEOUT` |
| 兰闺喜事 | `5589ceb2d8171e8aa8fb6f3ebb50913a64bd26c9b9dbeff5d85ff476cc7315a2` | `libra.product_media.verify@1`，`LIBRA_MEDIA_FFMPEG_TIMEOUT` |

均state=discarded、outcome=unable_to_on_deck、reason=processing_failed。终态时间分别1791805802105、1791806913409、1791807681179，发生在升级后运行期间。繁花诊断stage=json_request/timeout=true；兰闺喜事仅记录FFmpeg timeout，不能据此断言媒体损坏。三体原失败诊断文件缺失，但Event Attempt与正式终态保留。

网络链路具体故障及FFmpeg超时诱因尚未证实。没有依据把这些失败归为停机中断，也不因当前磁盘满反推历史网络故障。UAT-295历史修复不等于承诺Provider永不超时，本项独立开放；未重试三部剧。

## UAT-317：生产盘满与处置入口异常

生产`df -h /app/data`：175G总量、173G已用、Avail=0、Use%=100%。映射为`/vol1/1000/docker/shelfdeck/data`；根overlay也位于同一满盘。当前生产数据库2687041536字节。路径容量：data约2.7G、backups约52G、test-runs约23G、tests约8.2G，应用根目录约95G；不能将所有占用归于数据库。

用户已明确授权通过正式入口放弃《罪恶之城》当前Run `bec197dfd3585fb5084d50fcd03ed562aa7e3d253867d648f3ee39b24959b094`，保留原片和已入藏sample。POST携带revision2、精确digest及幂等键`admin-sin-city-discard-20261012`，返回500/CLEAN_SERVICE_INTERNAL_ERROR，correlationId=`0c74d323-791c-4f62-a69f-bd03a2cef27e`。后续只读确认Run仍active revision2、Token仍在，未宣称处置成功。

只读重放inspect=ready，无待取消Work；内存临时库的标量约束检查通过，但不等于完整事务通过。满盘是当前紧急环境故障，需释放获授权的明确文件后重试原命令，验证是否解释500和投影stale。未裸SQL修改任务、未扩大Reset。

候选清理仅两个旧镜像tar：`/vol1/1000/docker/shelfdeck/shelfdeck-c52c6e947.tar`和`shelfdeck-d6097265e.tar`，各1724112384/1724111360字节，约3.2GiB。当前镜像tar、备份和媒体不在此请求范围。清理授权及结果另补。

页面延迟已有服务端证据，但独立只读重建三条失败剧投影仅44/5/51ms；不能据此测得真实HTTP全部开销。容器一次采样CPU133.71%，不是持续CPU结论。先恢复磁盘余量再测真实页面，避免在满盘状态下武断归为前端性能缺陷。

## 安全停机能解决的范围

- 可降低升级/reset与正在执行的Work、Effect、文件操作竞争；其确定的静止边界有利于维护。
- UAT-313恢复探针引用仍必须由Reset正确释放，停机本身不修复已存在孤儿引用。
- UAT-315不同查询计数规则不一致仍需修复；停机不改变查询算法。
- UAT-316网络/媒体验证超时没有证据由停机引起，安全停机不保证此类任务成功。
- UAT-317历史镜像、测试副本、备份占满磁盘不由安全停机解决，需维护空间；满盘还可能阻碍停机checkpoint。
- sample归属和remux能力缺陷均独立，不因新增安全停机消失。

## 获授权清理与处置复验

用户明确批准删除上述两个旧镜像tar，随后补充授权删除无用旧备份等，并要求所有问题解决后统一清理生产环境。已校验精确路径、非symlink及权限后删除两文件；当前cab3e2d77 tar、备份、媒体保留。Btrfs空间统计延迟后Avail=3448233984 bytes（约3.3GiB）。容器未重启，镜像保持cab3e2d77、RestartCount=0。

随后原幂等放弃命令返回200/discarded，正式Receipt `6759ed4e2a4ec3e49498db5611c28bbda6cdb66289074eee70b4e2b438d71cde`，committedAtMs=1791811590484；只读复核Run discarded revision3、该Subject Token=0。因此罪恶之城本轮处置已完成，sample缺陷仍待优化。

投影恢复ready，但跨section计数仍不一致：active=7（2608ms）、completed=10（4303ms）、ended=10（958ms），attention=0。满盘影响与UAT-315查询缺陷需分别处理；页面延迟仍开放，不能以恢复空间宣称性能修复。

按扩展清理授权，又删除`tests/uat281-20260930/{current,current2,candidate,rollback}/data/shelfdeck.db`四份已结束测试副本（每份2157551616 bytes）。UAT-281已独立验收关闭、全部现存容器均无此路径挂载、无symlink；保留测试日志和其他文件。目录逻辑占用8.2G→94M，但实际卷Avail仍约3.3GiB，不将逻辑文件大小当作额外实际释放空间。正式备份未删除：部分历史备份含原媒体；UAT-267与本次Reset排障所需材料及05-stopped回退备份继续保留。

清理后health=ok/normalSupplyAllowed=true、根目录权限755/root及应用目录771/gezhu保持。全面收尾清理仍以当前问题逐项解决为前提，不宣称已完成全部清理或全部UAT。

## 继续修正与再次满盘

后续用户授权恢复MoviePilot，对暂停下载提出疑问，未授权暂停。复查卷再次Avail=0、下载目录48G→55G；先清理已关闭UAT-281三份中间数据库备份`backups/uat281-20260930-{1450,1458,152349}/data/shelfdeck.db`（各2157551616 bytes），保留UAT-281最终preapply备份、05-stopped及Reset备份，核对路径/非symlink及权限。延迟回收后Avail约6.1–6.2GiB。仅清理不能保证覆盖剩余下载需求，暂停不是必选前提；未操作下载器。

MoviePilot初次start被ENOSPC拒绝，空间回收后又遇到残留同名Docker bridge endpoint。原容器ID保持`9fb7c7b9a56dac24acbc00333b8422f7d46f2e37e0574d808d303f063fa6d300`；在恢复过程中停止尚未联网的容器、移除失效网络引用，临时更名以精确释放同名孤儿endpoint，恢复原名并连接原moviepilot network，再start。原IP172.18.0.2、3000端口映射恢复；未删除容器/volume或修改应用数据配置。容器running不等于API已健康，继续等待启动验证。

恢复验证完成：NAS127.0.0.1:3000及LAN192.168.12.230:3000页面均HTTP200；启动日志Application startup complete/Uvicorn running，容器running/restarting=false。ShelfDeck health200/status=ok/normalSupplyAllowed=true。卷Avail约6.2GiB。未执行新的影片重处理，不以页面恢复替代两部电影寻源成功验收；未暂停下载。

最新验证：Windows92/92通过。Linux原1项失败为测试包缺少`web/src/helix/FormationPage.tsx`，补齐该文件和ProcessStages.tsx后，同组92/92通过，临时/tmp及/transcode均tmpfs且不挂生产媒体。不是产品回退或放宽保护。未部署新源码，实际UI及端到端性能仍待验收。

追加清理：已删除被最终05-stopped备份替代的01/02/03预检备份中的`data/shelfdeck.db`三个文件（1112883200/2545827840/2545827840 bytes），保留其receipt、其他文件和完整05-stopped、两份Reset备份。路径及非symlink校验通过。最新Avail约6.1GiB。MoviePilot-v2现exited/exit135/OOM=false，FinishedAt=2026-10-12T12:40:51.249846848Z，State.Error=`hosts: no space left on device`；服务恢复待授权，不把ShelfDeck本身health正常理解为外部服务正常。

本地进一步让summary只读分类所需当前事实，不为计数读取完整Plan；Formation执行图仅取实际用于当前视图的active/frozen/suspended Run或最新completed Run，不加载未使用旧Run的图。历史事实不删除。新增断言验证历史图不读取、计数不加载Plan。生产同一只读快照8条数据对照，旧/新输出JSON相同，单次约552/494ms；未接入完整Arca/Perception读取，未发布，不作为整页提速验收。

Linux隔离测试不挂生产data/媒体：首次缺少专用/transcode tmpfs，24项被既有保护拒绝；补充隔离挂载后92项中91通过/1失败，失败详情尚待补取。再复验被Docker ENOSPC阻止，不宣称Linux全部通过。所有容器使用--rm，无产品源码覆盖到生产容器。

卷再次Avail=0。发现`/vol1/1000/media_download/chn_series`内Against.the.Current.S01.2026的2160p TX及1080p DSNP资源最近20分钟有写入，下载目录约48G；不能以逻辑文件大小代替实际速率或独占空间。用户授权的无用副本清理继续删除本次已完成升级门禁的七份`test-runs/series-release-20261012/{upgrade-copy,rollback-original,candidate03,candidate310,rollback-original03,candidate311,candidate311final}/shelfdeck.db`，每份2545827840字节；明确非symlink、无现存容器挂载，保留日志及正式05-stopped/Reset备份。曾恢复约939MiB，随后再满。已询问用户是否暂停这两套下载，尚未取得授权前不操作下载器。

## 本轮修复准备与原文件复验

用户选择“先完成修复，暂不重处理”，因此不向绿头苍蝇、燃情岁月、三体、繁花、兰闺喜事发起新整理。五条原Run目前均discarded revision4，未被新Run取代；两电影的搜索均在MoviePilot恢复前耗尽三次连接失败，不再占用旧恢复探针。

兰闺喜事原失败materialKey 5d8338f3…定位为S01E17的2160p HEVC MP4（471778325 bytes）。在生产容器只读执行相同Probe及5/50/95抽样解码：Probe1146ms；三抽样3369/1679/1865ms，退出码均0，stderr为空。当前未复现，不据此否认原51秒超时，也不能确定历史诱因。

修补内部诊断缺口：FFmpeg超时保留process_timeout/event_deadline/process_stall原因、执行时长、预算及stderr字节数；Playback增加抽样百分比。Failure diagnostics只接收白名单数值及枚举，不保存原始stderr、参数、URL或媒体路径。不改变超时值、验收条件、重试或业务终态。

新增相关Windows/Linux测试各28通过、1个缺少live BDMV fixture的既有skip。Linux初次遗漏测试fixture脚本，补齐后一次Event deadline时序断言失败；原样复验28通过，未放宽断言，保留该时序稳定性风险。此前计数/Reset等92项双平台通过仍适用。尚无新代码部署、UI接受或三部剧重新上架结果。

最新磁盘Avail约26GiB（86%使用），MoviePilot running；本轮未新增清理或下载处置。空间变化不归因为已证明的单一来源。
