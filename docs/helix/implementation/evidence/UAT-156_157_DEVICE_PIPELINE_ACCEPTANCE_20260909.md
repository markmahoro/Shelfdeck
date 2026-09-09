# UAT-156 / 157：真实设备管线验收

日期：2026-09-09。当前仍开放，等待修复版本发布及镜像内复验；本记录不以局部测试替代关闭。

## 现行条件与根因

156要求实际可用CPU/QSV不得被资格检查假拒；157要求源文件预检采用正式管线的起始24帧、有界超时，不能恢复旧跳转硬解。两项没有新增用户业务决策，也不改变设备资格事实的Owner。

真实Windows CPU检查暴露两处问题：原`-pass/-passlogfile`没有指定libx265的stats文件；更换正确参数后，第一遍确实生成stats和cutree文件，但自检的`return Promise`在第二遍完成前执行finally，提前删除文件。现在使用共享FFmpeg编译器生成`-x265-params pass=N:stats=...`，自检等待第二遍完成后清理。Libra正式转码与Arca Aftercare同步使用该编译器，不建立另一条兼容路径。

Windows盘符、空格、单引号按FFmpeg选项转义，真实双遍产品验证覆盖含空格/单引号目录。正常完成清理stats；进程中断残留仅接受精确producer partial名称下的passlog/cutree及其temp文件，未知独立passlog仍阻止回收。159/163的引用/归属条件保持。

参数依据：[FFmpeg libx265](https://www.ffmpeg.org/ffmpeg-codecs.html)、[x265 pass/stats](https://x265.readthedocs.io/en/stable/cli.html)。

## 发布前证据

- Windows：四个相关测试文件71 PASS、1原有SKIP；补充编译器非法输入后单文件6 PASS。正式CPU双遍输出实际解码成功、源字节不变、stats清理完成。
- 225个架构测试文件通过，semantic/manifests/contracts通过。首次dependency scanner拒绝新增模板字符串/正则写法；改为等价静态写法后单独复跑dependency通过，无豁免规则变化。
- NAS隔离容器：基于`ea24ddad62`，通过stdin仅替换容器可写层内的待验源文件；无网络、无生产数据或媒体挂载，仅传入`/dev/dri`。这属于发布前真实硬件测试，不冒充原镜像代码。
- Linux CPU三模式`two_pass_abr/strict_abr/quality_bound`、QSV三模式`target_size/strict_abr/quality_bound`均通过实际生成输入、编码、输出Probe及解码；覆盖SDR/HDR10兼容/未知动态范围标签，没有设备缺失SKIP。
- Windows CPU三模式、Linux CPU/QSV共六模式：真实生成源文件，调用正式`verifyTranscodeInput`，24帧预检成功；过期deadline拒绝。Linux正式CPU双遍及预检测试3 PASS、20名称筛选SKIP。
- 首次Linux测试因镜像不含测试脚本依赖而未启动；补齐隔离容器测试依赖后通过，未修改生产容器。

本地日志：`.codex/uat156-windows-tests.log`、`uat156-pipeline-final.log`、`uat156-windows-worker.log`、`uat156-linux.log`、`uat156-architecture.log`、`uat156-dependency-final.log`。未以生成样本声称重新处理《宇航员》存量条目；存量恢复仍按125/250独立处理。
