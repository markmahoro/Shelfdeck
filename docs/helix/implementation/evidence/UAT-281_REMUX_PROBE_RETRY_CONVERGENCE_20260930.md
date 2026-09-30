# UAT-281 蓝光探测及封装失败收敛

2026-09-30。用户报告《网诱惊魂》一直停在重新封装，并明确要求修复。独立维护分支 `codex/uat281-remux-convergence` 基于生产 `c14718848597063dcd28fed002ae8e5e5897a7e5`；不包含另一分支的 Series 开发，不修改其工作区或主工作区用户修改。编号依据当前台账最高 UAT-280 分配；这是上线后问题，不是 Series 开发工作项。

## 现场与根因

生产 health/Admin 可访问；不是整体服务停止。指定 Run `c9cc97b528136d4ec62e0fc84982b726a408f3cc05f3bb3484d337731dbb7c1e` 的 remux Event 已超过 27,299 次失败尝试，Work 仍 running，没有成功 Result。错误为 `LIBRA_MEDIA_FFMPEG_FAILED`；无持续运行的 FFmpeg，服务消耗单核 CPU。

1. 20.6GiB BDMV transport stream 的视频参数未在默认探测预算内出现。NAS FFmpeg 8 默认 identify 缺少尺寸，Matroska header 写入失败；指定 `analyzeduration=30000000`、`probesize=50000000` 正确读取 H264 1920×1080、DTS-HD MA 6ch，限定 1 秒封装到 `/dev/null` 成功。源 inode/mtime/size 保持。此前成功 Probe 却含 duration=0/尺寸缺失，经下游归一化成为 1×1。
2. Foundation 已明确 abandon 未提交 Effect，却向冻结 retry policy 传入未决定的 recovery。Controller 要求 reconcile，Event 进入无 retryAt 的 external wait 后立即再调度，绕过 maxFailureAttempts 与 failureClass 门禁。不是媒体工作 Owner 的重试策略缺失。

## 修复及合同

Probe、remux identify 和真实 remux 共用有限输入扫描预算；成功 ffprobe JSON 仍未观察到视频尺寸时返回 `CLEAN_MEDIA_PROBE_INCOMPLETE`，不把缺失观察发布成有效技术事实。不会替换原媒体。

Foundation 在明确 abandon 未提交 Effect 后，将安全重试判据交给现有 Controller，由冻结的重试次数、错误类别和 backoff 决定是否继续。普通 dispatch 和恢复执行一致；不确定副作用、timeout 及 committed Effect 仍走原恢复判断。没有改 Catalog、Owner、来源处置权限或旧记录；不是迁移、dual read 或历史数据 Reset。

## 已完成验证

- Windows Event Runtime/Policy 74/74；真实 controller 覆盖可重试 backoff、次数耗尽、不可重试 FFmpeg executor 失败及恢复前未写 intent。终态不能再次 dispatch。
- 官方 Helix 架构验证 241 test files，所有检查通过、findings 为空。
- Windows 媒体/恢复专项 39 项：37 通过、2 跳过。真实 64MiB 源前缀 Probe→remux→Probe 为 Matroska/1920×1080，源字节逐字保持；负向缺尺寸明确失败。跳过 Linux-only signal fixture 及未提供的 BDAV/HEVC canary。
- Windows 捆绑 FFprobe 与 NAS FFmpeg 版本不同，Windows 默认 Probe 可以读取该前缀；不据此声称复现 NAS 默认参数失败。Linux 精确镜像及完整生产副本门禁尚待验证。

## 发布及业务验收

旧精确生产镜像的完整一致副本已经启动、运行正常 Owner/Intake reconciliation 并关闭：启动 766348ms，全程 788862ms，health200/normalSupplyAllowed=true。365 Entry/Commit、27217 Inventory Material、3554 Representation、11399 Product Fact、437 Acceptance Spec、1466 Run revision、3122 Material Binding、20004既有Plan和1013 Candidate Package逐行摘要保持；正常新增6 Plan。只读 Workspace 对两个既有 partial 清理产生 EROFS，已定位为隔离保护造成的写拒绝；无媒体/真实 Workspace 写入。首次240秒预算演练未得到完整启动结果，已停止测试容器；第二次900秒预算完成，不把首次当PASS。

5秒冷启动 CPU profile 的主要样本在 Catalog Plan proof reader，逐个 Event Attempt 查 Effect、逐个 Effect 查 marker，约两万次失败导致大量全表扫描。后续修复复用已有 P3 `select-in` primitive，每批最多500 ID、同一 read transaction 内读取全部 scoped Effect/marker，未加索引、未改schema或Catalog、未删/改历史，也未缓存或省略proof。真实SQLite1003 Attempt正向完整保留多Effect/多marker供既有否决器判断，foreign scope排除、空集不查询；Windows相关138项通过。官方架构及最终精确Linux、最新副本候选与同库回退仍待后续版本验证。

中间镜像 `8f72a0b47a` Linux媒体/Runtime 102项：101通过、1真实BDAV/HEVC canary缺失跳过；真实源前缀的默认FFprobe无尺寸，修复后的Probe→remux→Probe成功且源字节不变。第一批选择了两个生产镜像不包含的历史runtime测试及未复制的生成fixture helper，出现3个MODULE_NOT_FOUND；补充纯测试生成helper、移除不在当前生产runtime的历史测试后复测。没有替换镜像产品源码。中间镜像尚未发布，不代替后续性能修复版本的精确Linux验收。

发布准备发现生产旧镜像逐文件 COPY 层数积累，原 runtime reuse 在 `max depth exceeded` 失败。本次将 canonical recipe 内同目标目录、同文件名的 COPY 合并；所有源和目标逐项等价，目录及改名 COPY 保留。两项构建工具验证通过，旧身份/锁文件/Git 差异门禁保持。完整构建的依赖下载耗时较长，转回已验证的相同 runtime；没有重新选择运行依赖或 Web 版本。本机 Docker engine 不能启动，实际构建入口仍为本机 `build-image.js`，经统一 SSH 配置和 loopback 临时转发使用 NAS daemon。

未执行完整 Service/Desktop/全库整理 E2E。没有 UI 修改。当前尚未发布，指定影片尚未完成；以精确镜像 Linux 测试、最新完整一致副本候选/回退 Host、标准上传 checksum/dry-run/apply 及真实 Run 结果分别补充，不用代码或健康接口代替业务验收。
