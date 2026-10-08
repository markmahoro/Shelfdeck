# Series 完整架构回归与入口等待（2026-10-08）

277个`media-service/test/helix-architecture/*.test.js`在`0eea37925`启动，原运行保持到终态，没有因观察超时重启。期间只提交无默认行为变化的跨设备测试/证据，运行源码未修改。

## 完整结果

2,407项：2,396通过、1失败、10既有可选/历史skip，917.56秒。唯一失败为`formal node entrypoint starts, authenticates and shuts down through public HTTP`，错误`service health timeout`，stderr为空。原helper最多400次25ms轮询（约10秒），没有单次HTTP请求上限；测试子进程在健康检查通过前仍存活。独立原版同场景7.65秒通过，未以隔离通过覆写原失败。

## 测试修正与复验

将测试等待改为单调时钟30秒启动预算、每次GET最多1秒，提前检查子进程退出；超时保留耗时、最后HTTP状态与传输错误类型。非200响应释放body。仍必须200并完成原有generation、Admin页面、认证、凭据配置、Field登记/查询及关闭检查。不修改生产启动行为、业务合同、HTTP成功条件或重试业务操作。

相关完整三文件（入口、Capability Contract Validator、Bounded Catalog Transition）83通过、2既有skip，32.65秒；正式入口本身11.33秒通过。另与重型Domain Input Schema负向校验并发运行，3项通过、0skip，13.82秒。复验覆盖修正后的helper，但不是修正后的新277文件全量PASS；后续最终冻结版本仍需完整回归。

命令：

```text
node --test --test-concurrency=4 test/helix-architecture/p14-clean-service-entrypoint.test.js test/helix-architecture/capability-contract-validator.test.js test/helix-architecture/p4-bounded-catalog-transition.test.js
node --test --test-concurrency=4 --test-name-pattern="formal node entrypoint starts|rejects contract drift|rejects duplicate registry entries" test/helix-architecture/p14-clean-service-entrypoint.test.js test/helix-architecture/domain-input-schema-validator.test.js
```

仓库外日志`E:/my_project/helix-git-consolidation-20261008/series-architecture-0eea37925.log`、`series-entrypoint-isolated.log`、`series-entrypoint-loaded-recheck.log`及`series-entrypoint-contract-load.log`。完整测试原失败保留，不声称所有skip已覆盖。未部署NAS。

## UI验收衔接

用户本轮明确授权发送并跟进UI负责人验收，已提交冻结SHA`76ed35e32ed5eb404791dd268d46b540cb225485`及7份UI证据。负责人任务`01a0912a-0086-74e2-88ab-536c59d3862a`、验收turn`01a11ac3-56f4-7d73-b690-a9b9995c7319`仍在审查；8项双视口自动测试通过，但补充走查已报告Series TMDB分拣仍提交Movie类型、规则/收藏弹窗焦点与Escape缺口，尚未给UI通过。接续修复必须遵循其正式结论并重新交验受影响版本。

## 修复冻结版本全量通过

2026-10-08，冻结源码`06a8ce7c04f18f22ab30a2433283cf2be2a10392`，Windows Node25完整278文件：2412项、2402通过、0失败、10既有skip，893.98秒，终态exit 0。日志`E:/my_project/helix-git-consolidation-20261008/series-architecture-06a8ce7c0.log`。入口30秒墙钟/单请求1秒上限修复与Stage目录范围修复在完整负载下通过。

该运行已在后续long-media/Aftercare-restart测试编辑前加载对应测试文件；没有运行时业务代码变更，后续新增的显式专项分别记录，不把本次全量覆盖外推到尚未完成的新测试。10skip保持原可选场景语义，并非新失败；Series完整外部替换的合同缺口与生产副本升级/回退、完整用户旅程等门槛仍开放。

## b78e48d9f后服务总回归修复

2026-10-08，变更前`npm --prefix media-service test`619项中579通过、13失败、27skip。逐项定位后：

- 5个页面源码断言仍要求已经由UI负责人接受版本移除的说明文案或Movie-only文案。对齐现有Series/Movie展示，继续验证后端Plan消费、不可用状态、真实评分日志读取与不触发同步；未修改页面代码或把过时文案加回产品。
- 2个Setup Readiness测试仍要求已被SSOT §9取消的全自动/关键步骤模式。改为验证持续结算授权、实际配置就绪、Provider缺失及Off-deck授权独立；未改变产品合同。
- 3个PROD-064测试的fixture按旧19列写Inventory，新表含21列。fixture改显式列；其中实际工具也使用旧19列写法，修正为显式21列并保留Artifact Scope字段。仍限定原13个incident IDs、原路径/事实/Control保护与幂等条件，隔离执行，没有运行NAS事故工具。
- 1个Quarantine fixture未给Offload互斥映射任一合法variant，现补正式单目标；保留“被引用材料不得隔离”的负向断言。
- 1个瑕疵准入fixture缺正式Spec的recordDigest，补齐输入；保留预览装饰不改变准入identity与CAS检查。
- 1个评分完整Host缺旧输入持续清理授权。经正式API设置隔离授权；保留数据库证明首次dispatch后批准已存在、事件按正常30秒input重试等待，原30秒helper先到期。仅把该helper墙钟预算改90秒，未改产品重试策略。评分Host Windows3项通过（52.54秒），验证五次评分及重启不重开既有Run。

修复后完整Windows服务619项：592通过、0失败、27既有skip，138.18秒，exit0。Linux Node20相关7文件58项全部通过、0skip，89.05秒。P2/diff检查通过。此次运行代码与测试冻结到本批提交；日志位于仓库外：`series-service-full-repaired.log`、`series-service-fixture-repair-linux.log`、`series-service-perception-repaired.log`、`series-service-repair-p2.log`；原失败和中间诊断日志保留。

另收取较早启动的`series-architecture-bfefd19ae.log`：2416项、2405通过、0失败、11skip，1091.16秒；期间进行了EpisodeDelivery源码修改及派生合同重建，不能视为bfefd19ae或本批最终冻结SHA的全架构发布Gate。

本批只改测试、历史事故工具及文档，未改Admin产品UI，不新增UI验收请求；Linux脚本/测试已验证，未重新构建服务镜像或Desktop。此前精确版本UI接受不自动扩张到未验证路径。外部后加工/进程恢复及最终发布资格仍开放，未部署生产。


## 候选36100db30：冻结回归、构建与时序诊断

2026-10-08从干净的`36100db30ecc0a65a5b4225aabed507c7a7e1584`启动Windows完整架构、服务总测试及Web构建。Web成功；标准`node scripts/build-image.js 36100db30e`构建成功，镜像`markmahoro/shelfdeck:36100db30e`，image ID `sha256:16cfa5b0b68c4846d1dda9b41f1b19827d907f1bc1a810fc7f4429b1b557b119`，本地tar `dist-image/shelfdeck-36100db30e.tar`（536.0 MiB），SHA256 `e7dffbae86a9c338c06fb3a014599a571d1d21731a9abe6c7c96de458ad35d90`。提交号仅作候选构建身份，不是新发布版本或Git tag；未上传NAS。

按Docker runtime stage的COPY输入及构建Web枚举2121文件，本地与镜像逐文件hash集合摘要均为`32054b0745702079537ab7c51058c4f737c2ad0b4e6f7512d91f362262d9507a`。最初检查脚本误纳入web-builder输入，因runtime无`/app/web/package.json`明确失败；修正为runtime stage输入后完成一致性验证，没有修改镜像或产品输入。

服务总测试619项：591通过、1失败、27skip（167.05秒）。失败为`clean-media-production-effect-port.test.js`活跃输出看门狗：子Node进程只有200ms静默窗口，500ms运行期；并行负载下365.80ms报告超时，单独复验556ms通过。生产`runProcess`在启动后即统计静默，这是既有正确规则，不能为测试放宽。修正测试为2秒静默预算、4.5秒持续输出（超过两预算），并断言实际输出；同组硬截止验证改3秒硬截止/2秒静默，仍要求持续输出及进程Registry释放。无输出200ms拒绝用例保留。三项专项通过；完整服务复验尚未计PASS。

这次时序编辑只影响服务根测试，不在正在运行的architecture/Series测试集合内；runtime源码、契约、运行时脚本、Web及Docker输入保持36100db30相同，架构及镜像运行证据仍绑定该源码候选，不能称后续未完成测试通过。

只读生产准备核对：统一SSH配置读取`docker inspect`及只读SQLite查询，NAS仍running `markmahoro/shelfdeck:helix-beta-20260930-8e197b3c36` / `sha256:168be0bb2101b79424f7f978c32d3724852eb5267b2234a4c981c22fe075ac2b`；442个active Shelf Entry及442份Commit Receipt，3个active Run，数据库2359721984字节。未复制当前数据库、未新建远端文件、未重启或修改生产。此前365条历史副本升级/恢复不代表当前442条现场；生产迁移/Reset仍需对应精确授权。

合同审查：SSOT §8的`ResolvedProviderIdentity`明确只有`tmdb_series`带positive `seasonNumber`，实现及Series identity负向测试拒绝0。原准备文档的S00待复审标记不能扩大首版普通Season合同；当前不新增S00功能或合同更改。缺Episode title/plot、外部身份/错误Season、无claim/多义/重叠和单成员Import失败分别已有明确负向专项，完整结果以正在运行的候选回归为准；真实集成初配/联合回退等尚未关闭。

日志、检查脚本及机器摘要在仓库外`E:/my_project/helix-git-consolidation-20261008/`，前缀`series-candidate-36100db30-`；三项修正专项为`series-watchdog-timing-fixed.log`。当前架构与Linux实际镜像回归仍运行，后续补最终结果；不宣称首版可部署。

## 候选36100db30终态与生成清单修正

Windows完整架构280文件：2424项、2410通过、2失败、12skip，1103.27秒。失败仅为P2固定aggregateDigest仍指向旧合同，以及P3生成manifest未同步b78e48d9f重新物化的8个表合同摘要；DDL文本及ddlDigest没有变化。使用正式p3-ddl-materializer重新生成，并更新P2固定摘要，保留逐表追踪和完整重现断言，相关12项复验全部通过。修改包含运行时manifest，故36100db30镜像不是修正后的最终镜像；需重建候选及最终全架构复验。

服务完整复验619项：592通过、0失败、27skip，137.64秒。实际36100db30镜像内Series及受影响加工/Workspace集合549项：545通过、0失败、4skip，994.29秒；仅挂载测试/scripts/docs，没有挂载源码。长媒体、外部真实加工等opt-in专项仍按各自已有独立证据，不将skip计为通过。日志series-candidate-36100db30-architecture.log、series-candidate-36100db30-linux-image.log、series-contract-generated-recheck.log及服务复验日志保留于同一仓库外审计目录。

## 修正后候选0f78f4240

冻结0f78f42400c132dfd8be1a2f822ef19ca7b55f5e并推送后，标准build-image.js生成markmahoro/shelfdeck:0f78f42400，tar SHA256 08df85d24eee8f41d6f4212b24f2f9c87601e3bef7e48727aa874df4cc676e12（536.0 MiB）。2121个runtime输入本地/镜像hash集合均为0eed624f0a06fa6822dc29e27c407df221a0bd66c6207ddf7c07f31a4e14923f。镜像内P2/P3全部12项通过：首次CLI负向测试因镜像/app布局缺少测试假定的/media-service路径而失败，临时容器增加/media-service→/app链接后原断言通过，未挂载或改动产品源码。

修正后Windows280文件完整architecture gate正在运行，日志series-candidate-final-architecture.log；未将未完成运行计为通过。候选构建/合同日志series-candidate-0f78f4240-*保留在相同仓库外目录。未上传或部署NAS，尚未关闭真实集成初配及最终发布资格。

## 候选实际网络集成与冷配置

在实际0f78f42400镜像、全新隔离数据库中执行正式initializeCleanData及Admin Session；初始TMDB未配置，正式test→connectionProof→PATCH保存成功，停止Host后重新打开并登录，TMDB仍active/revision1，公开health正常且normalSupplyAllowed=true。通过正式Platform Secret Lease、Handle和TMDB Adapter请求真实1399/S01及E001/E002，返回的Season身份/逐集scope/sourceRef与非空标题、剧情均核对通过。没有fetch mock；仅使用元数据只读请求，不获取媒体。

现有TMDB凭据由统一SSH读取生产加密Envelope后在内存中交接至本地容器stdin，不出现在参数、日志或仓库；生产配置/数据库不变。新的本地凭据仅由产品正常加密保存，随机Secret Root不持久化。审计脚本初版把readiness.ready当公开字段、且requestedFields未排序，分别被断言和正式输入合同拒绝；修正脚本为实际health字段/排序请求后通过，未改变产品检查。

同一候选的正式MoviePilot connection-test Adapter执行三个真实GET：search/title、download/列表、history/transfer，各响应结构与实例摘要合格。没有POST或下载请求，不修改MoviePilot任务/生产Landing。该证据证明可连通及当前基础协议，不能声称真实Series下载或跨主机Landing全链路已验收；真实外部处理链仍使用可控Provider配真实媒体，绑定/副作用/恢复分别见已有Host证据。

仓库外series-live-tmdb-run.js/worker.js、series-live-tmdb-result.log及series-live-moviepilot-run.js/worker.js/result.log可重放，均不含凭据。TMDB E001/E002元数据摘要分别22f52e15725aa323d07ba35537f1408dc529900f20cf913c583bfb085120daf5、df90ed86fb05dc58c9752175ce1a5ea9fdf1fe698a898a2b8a82fca4471d18df；在线数据会变化，摘要仅标记本次响应。MoviePilot观察摘要fe1ca525859c7b83e33749bc64f28ce97ffeac73a37738f6a8b58d0a99e64cb3。

## 失败矩阵收口审查（尚非最终通过声明）

| 要求 | 当前验收入口与明确边界 |
| --- | --- |
| 无Claim、多义、同Season重叠/重复 | series-continuity-claims、p14-series-handoff-a、p14-series-run-lifecycle-continuity；保留零扩集/冻结Binding/不同批次身份合同 |
| 错误Series/Season、缺单集资料 | series-product-identity、series-tmdb-season-metadata；错误身份/404/缺title或plot明确拒绝，不继承整剧字段，另有上述真实两集读取 |
| N:M体积、同集多part、分数边界 | series-episode-space、series-arca-space-acceptance、series-member-size-budget、series-aftercare-prepared-media；与实际外部multipart及有界内部Host相互补充 |
| 单成员Import失败/磁盘空间不足 | p14-clean-workspace-product-port实际第二成员copy注入ENOSPC，首成员inode/mtime不变，重试无重复Workspace/Effect，Landing全部字节/inode/mtime/ctime保持；这是端口恢复证据，不称中途断电Host通过 |
| 搜索拒绝/本地策略耗尽/技术失败 | series-routing-run三个外部失败Host；series-external-work-scope逐阶段pending/failed不发后继，失败媒体不得交付 |
| 进程恢复/正式结算保护 | 外部和Aftercare在物理完成后Commit前新进程恢复、Off-deck分段删除恢复；各专项明确崩溃边界，未将其描述为所有时点恢复 |
| 并发追加/同名多季/共享Artifact退出 | 完整Series Host及已接受浏览器旅程，Target Reservation/跨revision/重放与其他季文件保持分别有负向断言 |

当前固定的样本和核心拒绝条件均有对应验证入口；剩余用户表面门禁需要最终UI影响审查。已授权发送给UI负责人0f78f4240具体候选，负责人正在审查外部Remux/Transcode新增阶段/进度/失败状态，未把后端Host通过当成UI接受。最终Windows全架构运行仍保留原session，不因空日志重启。

## 0f78f4240完整架构终态及外部页面复核

修正后的280文件Windows完整architecture gate已正常退出0，fixture、依赖边界、语义、manifest、P2等总体ok=true；日志series-candidate-final-architecture.log。运行中未改产品运行时源码；其末段新增的外部浏览器fixture是显式opt-in测试，不能将本次全量视为该新增浏览器路径覆盖。

UI负责人在turn 01a11beb-c837-7f60-ae7e-dc6ae95dbf53复验原候选四条实际浏览器旅程通过（首次配置/追加/NFO维护/仅退出第二季），但明确外部Direct/Remux/Transcode过程状态及失败反馈仍需页面证据。追加实际Host浏览器观察发现列表已到“处理原有输入”，打开的过程弹窗仍停“等待文件稳定”；实际原因是Formation load仅刷新列表和selectedCare，selected只在打开时读取一次。

负责人turn 01a11bf4-6f8e-7482-a29d-d73e40588e14确认沿原10秒循环按精确formationViewId刷新详情，保留关闭/切换/请求乱序fence、焦点/滚动，失败明确显示且恢复清错。本批按此修复，无新轮询周期或业务判断；Movie共用测试验证更新、失败恢复、乱序、关闭后迟到、切换对象及回焦。前端全26文件139项通过，构建通过，强化单文件复验通过。

新增浏览器只连接实际Host、不拦截前端API；真实Direct/Remux/Transcode与Provider网络fixture分开标注。使用15秒Provider响应暂停（正式30秒超时内）及12秒真实加工前暂停抓取瞬时阶段，实际FFmpeg/Probe/全链交付不替换。搜索拒绝/策略耗尽/技术失败三终态页面42.58秒通过；初次失败仅审计强求快速失败也必有运行截图，改为失败必须检查真实终态、成功必须检查运行与完成，保存最初失败日志。

外部Direct113.71秒、Remux116.67秒、多part Transcode128.06秒及延时Transcode161.87秒证明实际Host和运行页面；审查发现外部Host成功分支提前return，使初版通用collection浏览器hook未执行，因此以上结果不能称完成反馈已验收。已将finish放到精确外部成功分支，并加正式Collection的季/集/物理文件数及逐集文件名检查；此前候选镜像尚不含本次页面刷新修复，仍须构建新的最终版本；未操作NAS。

## 外部页面完成态、失败与放弃保护

33dd116275b21a7ffc738b984f1abaa51433ff26上的修正后实际Host浏览器：Direct116.11秒、Remux141.46秒、三文件多part Transcode162.71秒均通过，observations末项均为committed-collection；实际Collection的Season、两集、物理文件数及各集文件名断言执行完成。网络Provider受控，真实4K媒体/FFmpeg/Probe/Import/结算保持，且未拦截前端API。日志与双视口截图位于仓库外审计目录series-external-browser-{direct,remux,transcode}-final对应路径。窄屏收藏截图初版未稳定滚至Episode区，DOM断言不等同截图覆盖；后续按每个viewport重新定位Episode区，并追加过程弹窗Enter/Escape/回焦验证。

UI负责人turn 01a11c00-8e30-7860-9dcb-47c6071b5a1b确认技术失败文案缺陷：NONWAIVABLE不能一概诊断为安全或身份问题。Libra沿正式productEvidence原因区分身份/播放失败，沿已保存Path Result区分FFmpeg技术失败，其余保留中性不可豁免要求；不改变瑕疵接纳资格、生命周期或Owner。失败节点将LIBRA_MEDIA_FFMPEG_FAILED呈现为“视频处理工具执行失败”。技术/身份/播放/要求/体积资格及Projection、UAT-251共30项回归通过。

实际浏览器搜索拒绝20.17秒、策略耗尽19.07秒、技术失败3.93秒（3项合计43.72秒）验证失败详情、无虚构重试、放弃确认取消及正式放弃；Run分别保持frozen/转为discarded，未产生Shelf Entry，原媒体bytes/inode/mtime/ctime逐项保持。该三项运行时技术文案尚为中性版本；随后明确技术文案版本单独复验通过5.46秒，日志series-external-browser-technical-copy.log及technical目录截图。没有用取消/Reset隐藏新输入缺陷，没有生产数据操作。负责人尚需接受具体最终提交，发布资格继续开放。

最终截图/键盘专项：真实多part Transcode完整Host再次通过161.86秒，过程弹窗Enter打开、Escape关闭及返回原按钮焦点断言通过；每个viewport滚至已收藏剧集后截图，窄屏明确显示第1集两个part、第2集一个文件及总计3视频文件。日志series-external-browser-transcode-final-framing.log、截图同名目录09-narrow.png；已人工查看，未将测试截图修正描述为产品布局变更。

## 最终候选84c2cd926镜像

标准scripts/build-image.js生成markmahoro/shelfdeck:84c2cd9268，tar SHA256 a5c09f6cd69a9193b89453bc8fda9f75b75ff7dabfe3c8ec3945510b981adfdc（536.0 MiB）。本地与镜像2121个runtime文件集合SHA256均为af94e8003cee218e579aba3271728d04792ddfa7e40a73ff8c9f1e71ad477bf6。镜像内失败诊断/Projection/UAT-251及P2/P3合同共46项全部通过；首次有一项静态源码测试因镜像不包含web/src而ENOENT，补挂只读web/src供该测试读取后复验通过，运行时后端源码未挂载或替换。日志series-candidate-84c2cd926-build.log及-linux[-recheck].log。UI负责人正验收相同产品版本，尚无最终接受结论，未上传或部署NAS。
