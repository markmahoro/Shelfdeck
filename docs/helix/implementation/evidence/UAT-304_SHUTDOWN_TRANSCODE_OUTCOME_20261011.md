# UAT-304：正常停机先终止FFmpeg，可能写成业务加工失败

2026-10-12收口：按下述Windows/Linux真实FFmpeg中断、期限内排空、超时未决证据保留及跨进程唯一Commit/再次重启幂等证据关闭本项。Service601通过、0失败、28skip；全量架构2485通过、2个P7测试替身缺方法失败、12skip，补齐abandonWaiters后P7文件14项通过。未改写历史Outcome，未重启生产；本项关闭不代表UAT-293历史升级通过。

2026-10-12修复：Runtime先同步停止新供给/dispatch并撤销未获Permit的waiter；执行、恢复和Owner回调最多60秒checkpoint。超预算不关闭仍被执行使用的SQLite，不伪造Outcome；随后Registry标记并终止自己的FFmpeg，技术中断沿Event Runtime抛出，不转写为业务failed。server按未决状态退出，重启继续使用既有Effect恢复合同。正常预算内仍排空并干净关闭。Compose停止宽限设为75秒，覆盖checkpoint及子进程回收。

Windows Runtime/Effect专项133通过、1既有skip，资源等待专项14通过。实际FFmpeg Host验证68.27秒通过：在编码开始后触发缩短的测试checkpoint，未决Event/Attempt保持executing、Effect保持intended、失败及Outcome均空、子进程清零；第二进程完成唯一On-deck Commit，第三进程重放不增加Commit、不重新获取Provider资料。Linux同一实际Host90.12秒通过，媒体专项24通过、1既有skip；其余299项Runtime/合同专项通过。Linux首次12失败均由测试命令误设`/usr/bin/ffmpeg`引起，改用镜像既有`/usr/local/bin`环境后媒体全组通过，保留失败记录。

日志位于忽略目录`.codex/series-release-20261012/uat304-*.log`、`linux-focused.log`、`linux-media-fixed.log`。无历史Outcome改写，无生产重启。完整Service与架构门禁仍在运行，本项尚未最终关闭。

2026-10-11为判断本地转码期间能否安全加载优化，核对SSOT §10.1.5与现有关闭链：正常关闭应立即停止新Work/Event供给、最多60秒到达safe checkpoint；超预算可退出但不得伪造Event terminal，重启按Effect Class恢复。

当前clean-service-host的application.stop先await ffmpegProcessRegistry.close，再停止Execution Host。Registry.close对所有child发SIGKILL；runProcess的close分支将非零退出转换为LIBRA_MEDIA_FFMPEG_FAILED；Libra mediaEffectFailed将其转换为正式failed Outcome。现有clean-media-production-effect-port.test.js的“service process registry terminates an active FFmpeg child during shutdown”正向测试还明确断言该失败码，完整Service回归中该用例通过。于是停止供给前仍存在将技术停机写为加工失败的路径。

这证明当前代码/底层进程行为存在缺口，不足以反推10月9日每一条历史FFmpeg失败的实际原因；历史stderr未持久化，不能补造证据。现场人世间仍在转码，未为加载UAT-301/302主动重启，也未Reset或重写失败历史。

状态开放，尚未实施。修复须在现有Runtime/Effect恢复合同内先停供给并处理safe checkpoint，不能把intentional stop改称另一种业务失败或放宽60秒预算，也不能让子进程成为孤儿。验收应覆盖Windows/Linux实际子进程、期限内排空、超时退出、未决Effect保留和重启幂等，独立于UAT-299的Discard Evidence容量修复。

2026-10-11 13:44用户要求加载新代码并明确本地Series无需等待安全退出窗口。精确终止旧服务及子进程后保存停机数据库快照，18081已以5c3effc20/PID41120启动，health正常且normalSupplyAllowed=true；人世间transcode与新FFmpeg进程恢复，历史失败计数未增加。加载前后只读采样为仓库外pre-fast-reload-20261011.log、post-fast-reload-ready-20261011.log，运行日志series-fast-20261011.stdout/stderr.log。未Reset、重扫或操作NAS；正常stop缺口仍由UAT-304独立跟进，不以强制终止方式恢复来关闭它。
