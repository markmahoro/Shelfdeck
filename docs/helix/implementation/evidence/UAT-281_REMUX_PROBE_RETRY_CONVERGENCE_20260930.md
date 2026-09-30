# UAT-281 蓝光探测及封装失败收敛

2026-09-30。用户报告《网诱惊魂》一直停在重新封装，并明确要求修复。独立维护分支 `codex/uat281-remux-convergence` 基于生产 `c14718848597063dcd28fed002ae8e5e5897a7e5`；不包含另一分支的 Series 开发，不修改其工作区或主工作区用户修改。编号依据当前台账最高 UAT-280 分配；这是上线后问题，不是 Series 开发工作项。

## 现场与根因

生产 health/Admin 可访问；不是整体服务停止。指定 Run `c9cc97b528136d4ec62e0fc84982b726a408f3cc05f3bb3484d337731dbb7c1e` 的 remux Event 已超过 27,299 次失败尝试，Work 仍 running，没有成功 Result。错误为 `LIBRA_MEDIA_FFMPEG_FAILED`；无持续运行的 FFmpeg，服务消耗单核 CPU。

1. 20.6GiB BDMV transport stream 的视频参数未在默认探测预算内出现。NAS FFmpeg 8 默认 identify 缺少尺寸，Matroska header 写入失败；指定 `analyzeduration=30000000`、`probesize=50000000` 正确读取 H264 1920×1080、DTS-HD MA 6ch，限定 1 秒封装到 `/dev/null` 成功。源 inode/mtime/size 保持。此前成功 Probe 却含 duration=0/尺寸缺失，经下游归一化成为 1×1。
2. Foundation 已明确 abandon 未提交 Effect，却向冻结 retry policy 传入未决定的 recovery。Controller 要求 reconcile，Event 进入无 retryAt 的 external wait 后立即再调度，绕过 maxFailureAttempts 与 failureClass 门禁。不是媒体工作 Owner 的重试策略缺失。

## 修复及合同

Probe、remux identify 和真实 remux 共用有限输入扫描预算；成功 ffprobe JSON 仍未观察到视频尺寸时返回 `CLEAN_MEDIA_PROBE_INCOMPLETE`，不把缺失观察发布成有效技术事实。不会替换原媒体。

Foundation 在明确 abandon 未提交 Effect 后，将安全重试判据交给现有 Controller，由冻结的重试次数、错误类别和 backoff 决定是否继续。普通 dispatch 和恢复执行一致；不确定副作用、timeout 及 committed Effect 仍走原恢复判断。没有改 Catalog、Owner、来源处置权限或旧记录；不是迁移、dual read 或历史数据 Reset。

## 初始本地验证（最终门禁见后文）

- Windows Event Runtime/Policy 74/74；真实 controller 覆盖可重试 backoff、次数耗尽、不可重试 FFmpeg executor 失败及恢复前未写 intent。终态不能再次 dispatch。
- 官方 Helix 架构验证 241 test files，所有检查通过、findings 为空。
- Windows 媒体/恢复专项 39 项：37 通过、2 跳过。真实 64MiB 源前缀 Probe→remux→Probe 为 Matroska/1920×1080，源字节逐字保持；负向缺尺寸明确失败。跳过 Linux-only signal fixture 及未提供的 BDAV/HEVC canary。
- Windows 捆绑 FFprobe 与 NAS FFmpeg 版本不同，Windows 默认 Probe 可以读取该前缀；不据此声称复现 NAS 默认参数失败。Linux 精确镜像及完整生产副本门禁尚待验证。

## 发布及业务验收

旧精确生产镜像的完整一致副本已经启动、运行正常 Owner/Intake reconciliation 并关闭：启动 766348ms，全程 788862ms，health200/normalSupplyAllowed=true。365 Entry/Commit、27217 Inventory Material、3554 Representation、11399 Product Fact、437 Acceptance Spec、1466 Run revision、3122 Material Binding、20004既有Plan和1013 Candidate Package逐行摘要保持；正常新增6 Plan。只读 Workspace 对两个既有 partial 清理产生 EROFS，已定位为隔离保护造成的写拒绝；无媒体/真实 Workspace 写入。首次240秒预算演练未得到完整启动结果，已停止测试容器；第二次900秒预算完成，不把首次当PASS。

5秒冷启动 CPU profile 的主要样本在 Catalog Plan proof reader，逐个 Event Attempt 查 Effect、逐个 Effect 查 marker，约两万次失败导致大量全表扫描。后续修复复用已有 P3 `select-in` primitive，每批最多500 ID、同一 read transaction 内读取全部 scoped Effect/marker，未加索引、未改schema或Catalog、未删/改历史，也未缓存或省略proof。真实SQLite1003 Attempt正向完整保留多Effect/多marker供既有否决器判断，foreign scope排除、空集不查询；Windows相关138项通过。官方架构及最终精确Linux、最新副本候选与同库回退仍待后续版本验证。

中间镜像 `8f72a0b47a` Linux媒体/Runtime 102项：101通过、1真实BDAV/HEVC canary缺失跳过；真实源前缀的默认FFprobe无尺寸，修复后的Probe→remux→Probe成功且源字节不变。第一批选择了两个生产镜像不包含的历史runtime测试及未复制的生成fixture helper，出现3个MODULE_NOT_FOUND；补充纯测试生成helper、移除不在当前生产runtime的历史测试后复测。没有替换镜像产品源码。中间镜像尚未发布，不代替后续性能修复版本的精确Linux验收。

发布准备发现生产旧镜像逐文件 COPY 层数积累，原 runtime reuse 在 `max depth exceeded` 失败。本次将 canonical recipe 内同目标目录、同文件名的 COPY 合并；所有源和目标逐项等价，目录及改名 COPY 保留。两项构建工具验证通过，旧身份/锁文件/Git 差异门禁保持。完整构建的依赖下载耗时较长，转回已验证的相同 runtime；没有重新选择运行依赖或 Web 版本。本机 Docker engine 不能启动，实际构建入口仍为本机 `build-image.js`，经统一 SSH 配置和 loopback 临时转发使用 NAS daemon。

## 最终发布门禁与执行

最终源码 `8e197b3c3685d21d87c581bae1016ed70896e2c3`，镜像 `markmahoro/shelfdeck:helix-beta-20260930-8e197b3c36`，Image ID `sha256:168be0bb2101b79424f7f978c32d3724852eb5267b2234a4c981c22fe075ac2b`，tar 1814790144 bytes，SHA256 `c6b84d0de15b92a38a5ecbe58003f2dc2fdafb2f42c41d66408f3b16e3711d02`。官方全量架构243 test files及全部检查通过，findings为空；最终精确Linux166项：165通过、1缺少BDAV/HEVC canary跳过。完整原片只读Probe正确获得6351392ms、1920×1080、DTS6ch/AC3 2ch，源 inode/mtime/size不变。

最新完整一致备份52文件/2164320009 bytes，manifest SHA256 `aa08eb2ad7b54ad69e6ba01894f93b76782e4603519744d576b98997e81df35a`，quick_check=ok/foreign_key_check=0。候选完整Host启动516074ms/全程533747ms，health200/normalSupplyAllowed=true，正常Owner/Intake运行后关闭，十一类事实原行摘要保持，包括22118既有committed Effects；正常新增7 Plan/1 Effect。两次EROFS定位为只读Workspace阻止partial清理，不能据此宣称实际媒体执行成功。

从已关闭候选的数据另复制，旧精确镜像同库回退Host启动732848ms/全程755979ms，health200/normalSupplyAllowed=true；十一类既有事实保持，包括候选新增的Plan/committed Effect。只读Workspace的单次EROFS和既有listener warning记录，未掩盖或扩大修复范围。两份快照及负向保护挂载均未写入真实媒体/Workspace；上述不同快照的耗时不是严格性能benchmark。

固定入口build→upload已完成，上传SHA256一致，dry run通过，Secret root与当前生产一致。发布前现场仍为同一active Run、同一external-wait remux Event，已累计32206 Attempt；没有Reset、SQL编辑或历史改写。另创建紧邻发布完整备份 `/vol1/1000/docker/shelfdeck/backups/uat281-preapply-20260930-162230`：52文件/2164320009 bytes，manifest SHA256 `db6098850260b6c5b2b971209d8a3fb9a523218ca752f76fba1f1287777f51c3`，quick_check=ok/foreign_key_check=0，compose及secret伴随文件保持。

标准apply已完成，StartedAt `2026-09-30T08:26:54.92134126Z`。完整冷启动后health200、generation=helix-clean-v3、normalSupplyAllowed=true，Admin可访问；五项挂载、QSV及Secret保持，未发生OOM。发布后逐行摘要证明十一类既有事实保留：365 Entry/365 Commit、27235 Inventory Material、3557 Representation、11411 Product Fact、437 Acceptance Spec、1466 Run revision、3122 Material Binding、20013既有Plan、1013 Candidate Package、22126既有committed Effect。正常新增9 Plan/6 Effect。封装期间源inode/mtime/size保持；此保护核验早于正常Arca来源处置，不能表述为入库后原路径必须保持。

2026-09-30 16:45:49 CST 原Run自动接续完成，无Reset、手动重建、直接SQL编辑或旧技术观察改写。原remux Event `libra-remux-media-event-22e326ac2de658812602b845f839617a85c742fb` 为succeeded，Result `event-result-ad07486e-8689-4e9c-b188-bfa44bef45c4`；累计32322 Attempt中1项成功。原任务的remux 100%、输出Probe/验证/选择、产品符合性与交付均completed；Arca六项接纳检查、实际placement/final product verify、11项input settlement、fulfillment verify及On-deck Commit全部completed。来源处置由既有Arca正式流程执行，没有绕过其权限或合同。

Admin显示“已进入收藏架”、completedAtMs=1790757949568。数据库只读核实指定On-deck Run `81f618cb978699680bccd05993271b8a4000be5a784e3f3e1ee49e29444ee2fe` 恰有一条Commit Receipt `9d40558f0798c8bd36de5311062f5dbaa31260b7df35ebeb4153591c7ed8d471`；Shelf Entry `c8ca00483506ca26102a6babb5f84781d6d3f0643a9e05e8e3b7e365d5e33aa4` 为active，Inventory/Deck Fact revision均1。此时全库369条，包含其他正常任务的新增，不能把全部增量归因于本片。UAT-281按自身根因、冻结重试正反例、精确镜像与副本门禁、原片实际封装及唯一入库提交证据关闭。

本次测试及保护容器已关闭移除，临时loopback Docker SSH转发已停止；一致备份和副本门禁证据保留供回退与审查。

未执行完整 Service/Desktop/全库整理 E2E。没有 UI 修改，不新增release tag或Series生产能力声明。
