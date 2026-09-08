# UAT-132 Direct HEVC unknown验收关闭

2026-09-09。现行Oracle：真实合法Direct HEVC不因缺少色彩/动态范围标签被拒绝；Direct仍独立Probe和三点decode，真实不符合项仍拒绝。取消workspace原片额外decode不等于取消Direct产品验证。

新增可复现完整Host场景，本地生成2秒1080p HEVC/AC3，独立FFprobe确认codec=hevc且color_transfer/primaries/space未声明或unknown。经正式来源观察、Libra与Arca完成上架，六项Acceptance Check均passed、1收藏/1完成Run、0失败Arca Event；额外断言整个链没有libra.media.transcode/remux，防止转换后绕过原Direct问题。原独立媒体夹具不变。Provider为受控替身，实际媒体工具、正式Host与持久事实真实执行。

Windows实际场景9.38秒PASS；Linux直接使用生产48077d71bd镜像、仅挂载测试和脚本（不覆盖src）7.13秒PASS，19个名称过滤SKIP不计通过。日志`.codex/uat132-direct-windows.log`、`.codex/uat132-direct-linux.log`。初次fixture检查只给裸路径被正式Probe拒绝，改为独立CLI FFprobe检查输入先决条件；正式Host仍使用原合法Handle，没有放松生产验证。

配套mandatory-media定向测试覆盖Direct unknown、workspace none/preserve、fresh source/output漂移、真实媒体Gap、tone-map输出与DV metadata/色彩/播放失败拒绝；Windows/Linux已各随48项组通过，见[关联媒体验证](UAT-135_136_ISO_SOURCE_ACCEPTANCE_20260909.md)。生产48077d71bd发布、挂载、健康与前后计数一致见[发布证据](UAT_RELEASE_48077D71BD_20260909.md)。

UAT-132按本项问题验收关闭；137历史标签与fresh事实、160原片坏样本各自独立，不随132关闭。本次仅新增测试及证据，不需要重复部署。累计42项本轮功能关闭、57项开放；206承接已核实。
