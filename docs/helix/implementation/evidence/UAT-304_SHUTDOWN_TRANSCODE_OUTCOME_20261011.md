# UAT-304：正常停机先终止FFmpeg，可能写成业务加工失败

2026-10-11为判断本地转码期间能否安全加载优化，核对SSOT §10.1.5与现有关闭链：正常关闭应立即停止新Work/Event供给、最多60秒到达safe checkpoint；超预算可退出但不得伪造Event terminal，重启按Effect Class恢复。

当前clean-service-host的application.stop先await ffmpegProcessRegistry.close，再停止Execution Host。Registry.close对所有child发SIGKILL；runProcess的close分支将非零退出转换为LIBRA_MEDIA_FFMPEG_FAILED；Libra mediaEffectFailed将其转换为正式failed Outcome。现有clean-media-production-effect-port.test.js的“service process registry terminates an active FFmpeg child during shutdown”正向测试还明确断言该失败码，完整Service回归中该用例通过。于是停止供给前仍存在将技术停机写为加工失败的路径。

这证明当前代码/底层进程行为存在缺口，不足以反推10月9日每一条历史FFmpeg失败的实际原因；历史stderr未持久化，不能补造证据。现场人世间仍在转码，未为加载UAT-301/302主动重启，也未Reset或重写失败历史。

状态开放，尚未实施。修复须在现有Runtime/Effect恢复合同内先停供给并处理safe checkpoint，不能把intentional stop改称另一种业务失败或放宽60秒预算，也不能让子进程成为孤儿。验收应覆盖Windows/Linux实际子进程、期限内排空、超时退出、未决Effect保留和重启幂等，独立于UAT-299的Discard Evidence容量修复。
