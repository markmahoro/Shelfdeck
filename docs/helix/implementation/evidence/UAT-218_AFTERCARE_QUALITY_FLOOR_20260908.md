# UAT-218 Aftercare质量保护对齐

2026-09-08。本地修正，未部署或关闭。历史BR-02、UAT-059/200关联。

## 根因与实施

Aftercare原预算仅有100,000 bps可行性门槛，Libra则执行SSOT 7.7的画幅/空间档位质量下限。相同输入会在Aftercare冻结低于既有质量保护的施工码率。

Arca域内Quality Policy revision 1保留相同2/4/8/14/50 GiB档位、非4K与4K质量下限和未知档位既有3星映射；源视频码率优先实测stream，只有全部源音轨有码率才允许从真实源字节/时长推导。下限取Policy与真实源码率较低者；cap低于下限时按下限施工，最终实测超限仍拒绝。技术上不可行的预算保持拒绝。

Strategy取得完整冻结Probe的video/audio/subtitle信息，Intent的目标码率进入既有digest。移除预算异常吞成null的catch，坏Probe保持明确技术错误。没有新增跨Owner调用、修改旧Case/Inventory、绕过Conformance或改变Executor。

## 证据与剩余

- 47项定向PASS：10组空间/画幅同输入与Libra结果一致；低码率源不灌大；未知音轨不伪造源码率；真实Strategy冻结2 Mbps质量下限；既有超限Conformance拒绝、文件替换失败回滚测试通过。
- 尚缺真实FFmpeg超限输出与Case完整失败保原片验收。上述模型/端口测试不等于真实媒体结果。
- 修复尝试终局、相同瑕疵不重复Case仍归UAT-251；本项不擅自确定触发方式与健康展示。

UAT-218整合验证：220个architecture fixture文件与Dependency/Semantic/Manifest/Contract全部Gate PASS（.codex/uat218-architecture.json）。其中包含UAT-217最终代码回归。
