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

未执行完整 Service/Desktop/全库整理 E2E。没有 UI 修改。当前尚未发布，指定影片尚未完成；以精确镜像 Linux 测试、最新完整一致副本候选/回退 Host、标准上传 checksum/dry-run/apply 及真实 Run 结果分别补充，不用代码或健康接口代替业务验收。
