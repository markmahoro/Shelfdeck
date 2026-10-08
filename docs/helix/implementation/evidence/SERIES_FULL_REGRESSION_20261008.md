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
