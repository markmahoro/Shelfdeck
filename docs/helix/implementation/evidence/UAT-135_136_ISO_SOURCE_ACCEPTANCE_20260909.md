# UAT-135/136 ISO Source验收

2026-09-09。当前用户合同取消workspace Source三点decode否决，保留fresh Source Probe/拓扑与Fence，Product独立三点decode；Direct仍验证实际产品。此证据分别支持135的ISO观察和136的等价路径，关联132/137/160不自动关闭。

## 根因与变更

普通Source已不再做三点decode，但ISO分支的observeDiscPlayback仍在获取所选payload Probe后执行三次FFmpeg，虽然不把失败样本当Product Gap，进程超时仍会抛错阻断合格成品。Arca显式给workspace ISO传probeOnly，Platform保留同一Topology、selected-plan、前后Physical Handle检查及scratch回收，只取消该Source的decode；返回零样本而不伪造通过。普通完整disc playback与Product verifyPlayback保留三点验证。

## 本地与Docker证据

- 真实ISO Port：鲜活FFprobe/所选payload、Windows等价路径、单/多clip顺序及in/out；probeOnly即使Source FFmpeg不可启动也完成Probe，返回零decode；拓扑或物理Handle漂移仍拒绝，scratch回收为空。
- 完整Host：本地生成2秒1080p H.264/AC3 ISO，经正式来源观察、Triage、Libra Workspace、Arca六项Check、Final/Settlement和On-deck Commit，1收藏/1完成Run、0失败Event，原独立disc夹具不变。Provider接口为受控替身，Probe、FFmpeg和业务Host真实运行。
- Windows 48 PASS/19 SKIP（18旧大媒体环境场景+1缺失live BDMV prefix）；Linux生产基础镜像同组48 PASS/19 SKIP，实际ISO Host分别15.29秒/15.09秒。日志`.codex/uat135-windows-v3.log`、`.codex/uat135-linux-v3.log`。
- 初次新Host夹具人为NFO强身份落入待身份处理，改用既有纯文件Provider测试入口；第二次已成功Commit但测试漏算inventory_feasibility第六Check，修正为六项全部passed。没有改业务身份规则或绕过验收。
- Linux旧测试硬编码C:/路径、绕过FFMPEG_PATH/FFPROBE_PATH使用npm静态二进制（独立复现SIGSEGV）、Node stderr未flush即exit，分别修正测试路径、生产同构工具选择及写完成回调；未修改生产工具配置。
- 223文件架构全跑1604 PASS/6 SKIP/1失败，唯一失败是三项已确认SSOT传播后的冻结P2摘要陈旧；更新为生成器计算摘要后原3项P2测试通过。dependency/semantic/manifest/contracts四门禁均通过。日志`.codex/uat135-architecture.json`、`.codex/uat135-p2-digest-recheck.log`。没有为旧合同恢复行为。

## 剩余关闭条件

135包含本次运行时修正，待标准发布和生产版本/健康验证后关闭；136等价路径与真实ISO链已通过，随相同版本逐项验收。132/137的fresh媒体对照及160原片失败场景继续按各自条件核验。本项不授权存量Reset、修改生产原片或直接写入清理授权。
