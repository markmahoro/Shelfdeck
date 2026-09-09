# UAT-169：长转码与实际截止验收

2026-09-09按现行条件独立关闭。此次只增加针对硬截止的验收测试，生产运行时仍为ea24ddad62，不为同一代码再发布。

## 真实长片证据

从[发布前一致备份](UAT_RELEASE_EA24DDAD62_20260909.md)只读关联Event、Attempt、正式Result、Libra Run及展示Projection，没有修改数据库或生成假生产状态。

| 影片 | 成功转码Attempt（UTC） | 耗时 | 正式结果 |
| --- | --- | --- | --- |
| 速度与激情：特别行动 (2019) | 09-09 01:57:04.197至05:13:11.611 | 11767.414秒，约3小时16分 | intel_qsv、WorkspaceMediaHandle、Run completed |
| 沙丘2 (2024) | 09-08 21:14:42.288至09-09 01:07:50.718 | 13988.430秒，约3小时53分 | intel_qsv、WorkspaceMediaHandle、Run completed |
| 美国队长 (2011) | 09-08 14:08:55.765至16:51:55.379 | 9779.614秒，约2小时43分 | intel_qsv、WorkspaceMediaHandle、Run completed |

第一项Event为`libra-transcode-media-event-f07d4b3b99c8067b9713aa2cd77592121c6af4f8`，Attempt为`event-attempt-c22ee78a-e7a5-4323-b268-1ae0f23e2e94`，Result binding digest为`f03e71b27e3fadaf7b3c2b5f9c0329907866e8641836592a8a5058057fb514e1`，输出12712937947字节，正式Effect Receipt存在。该时段在6bcfd7b33b生产容器01:56启动之后、此次09:47替换之前；不是通过当前测试时钟假推进一小时。

每项保留257个进度样本，最后到100；采样存在长间隔，不能据此宣称拥有连续逐秒FFmpeg日志。证据证明真实转码Event超过一小时后成功，不用缺失的采样虚构连续过程。其它两项跨过的部署/恢复时段不额外推断。

## 截止及停机边界

当前组合与端口均保持48小时hard timeout、10分钟stall规则，Libra remux/transcode不再绑定Field Observation的一小时时限；Aftercare同一长媒体policy绑定测试通过。

Windows与实际发布Linux镜像内代码各6项专项通过：48h/10min参数；使用Event deadline而不是较短进程默认值；实际子进程无输出时stall终止；持续输出时不误判stall；新增实际子进程持续输出仍在500ms硬截止终止（至少3次真实输出、退出前仍在stall窗口内，registry归零）；停机registry实际终止生成lavfi的FFmpeg子进程。短预算验证共用截止机制，不冒充跑满48小时。Linux6 PASS/16名称过滤SKIP；首次漏挂载测试scripts产生MODULE_NOT_FOUND，补齐只读测试夹具后通过，未改镜像src。

源保护、输入漂移及完整恢复属于125/127/250，编码设备资格属于156；本项关闭不自动代替其它条件。没有重跑或修改现有生产长片。

日志/只读提取：`.codex/uat169-long-evidence.json`、`uat169-deadline-windows.log`、`uat169-deadline-linux.log`、`uat169-policy-bindings.log`。累计60项本轮功能关闭、39项开放。
