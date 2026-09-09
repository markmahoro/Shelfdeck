# UAT-218 Aftercare质量保护对齐

现行结论（2026-09-09）：Windows NVENC及生产同版Linux CPU完整服务真实媒体、超限拒绝与失败/重启保原片均通过，UAT-218独立验收关闭。以下2026-09-08“未部署”等内容保留为历史过程，不覆盖本结论。

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

## 2026-09-09 真实媒体接续

当前生产已包含上述质量策略（source `7ceaeca7fb`）。新增可重复的完整服务场景位于`test/helix-libra-handoff-b-scenario-e2e.test.js`，由`HELIX_UAT218_REAL_MEDIA=1`显式启用。全部数据和120秒真实H.264噪声视频在临时目录生成；先正式上架，再通过Admin命令发布/绑定24MiB空间要求，触发真实Aftercare。

Windows最终场景43秒PASS：实际NVENC策略冻结2,500,000 bps，下限未因小空间目标降低；FFmpeg输出后真实Product Verification仅报`max_size_exceeded`，Case以`unresolved / media_verification_failed`终结，维护Inventory Commit为0。失败前后原片SHA256相同，Inventory与Accepted Product Facts不变。

Host重启后原片仍相同、失败Case仍为unresolved、维护Commit仍为0。独立People记录刷新可能推进Inventory revision；测试必须找到该Entry精确`arca.inventory.person-records.refresh@1` Receipt，核对前后revision、changedBindingCount=0、所有物理材料字段相同，历史Accepted Product Facts不变。不能把人物引用更新说成维护更换原片，也不能仅忽略revision差异。

日志：`.codex/uat218-real-v6.log`。前次失败分别为样本错误空间unit、遗漏previewDigest、未评分基础要求未更新，以及把独立People记录刷新误判为媒体替换；均按现行合同修正测试，没有调整产品行为、放宽安全判定或恢复旧UAT做法。

### 独立发现保留到210/125

`.codex/uat218-real-v3.log`及本机隔离目录`helix-uat218-7TyHij`复现：初始三项专业Assessment的结果绑定旧Care Basis，在assessment.commit前绑定新标准，执行报`Aftercare terminal Assessment set is incomplete or stale`，恢复继续报`P4_EVENT_RECOVERY_INPUT_DRIFT`，未正常形成Case终局。本项不据此宣称质量保护失败或通过，也不清除生产记录掩盖问题。210负责标准变更与检查协调，125负责恢复边界；218主场景明确等待初始Assessment持久提交后再变更标准。此竞态仍需修复，不能把顺序场景通过当成并发场景关闭。

251的手动瑕疵修复意图、跨Case有限性及精确Gap仍独立开放；本测试只证明普通健康维护质量保护及本次失败不替换原片，没有声称新手动修复链已实现。

Linux最终复验：生产镜像`markmahoro/shelfdeck:helix-beta-20260909-7ceaeca7fb`，Image ID `sha256:12db15cbc07e12becd793b20cb0f1270e03ec29241ddab05f4dde42d8152eb83`。临时容器`shelfdeck-uat218-quality`，无网络、无挂载、无生产Secret，CPU配额2；仅注入新增测试文件，没有覆盖src。真实CPU libx265双遍使用2,500,000 bps和同一stats路径，两遍完成后验证仅报max_size_exceeded；失败原片/历史Facts/零维护Commit及Host重启断言全部通过。主场景295.14秒，测试进程296.13秒，1 PASS；其他20项按名称过滤跳过，不计为此次E2E通过。日志`.codex/uat218-linux-v2.log`。首次Linux运行因测试180秒等待预算不足未通过，保留`.codex/uat218-linux.log`；仅扩展测试等待为600秒、整场900秒，未改变产品超时、源视频、设备选择、码率或安全断言。

此次只增加测试与验收文档，既有质量修复已在当前生产镜像内，无需重建/替换生产容器。2026-09-09T11:59:34Z生产六路GET均200，82收藏；随后只读核实《霍比特人3》转码完成后等待接受体积瑕疵，《我记得》继续正常转码。没有提交生产瑕疵授权、修改规则或删除媒体。Desktop代码未变，HTTP业务结果保持现行合同。
