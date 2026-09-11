# UAT-257 前置阻塞：文件来源扫描失败定位

2026-09-12。用户要求定位“扫描与来源详情”为何失败。本轮是生产只读取证和本地诊断复现，不实施修复，不关闭UAT-257。此问题此前已记为257后续正常扫描验收的阻塞；UAT-053/179历史关闭保持不变。生产为`83235c9260`，本地调查基线为集成分支`144798953`。

## 结论

实际链路是：**第61页等待资源超过冻结Field Access Handle的一小时有效期 → 旧版对过期异常反复恢复 → 一小时恢复预算耗尽后以通用超时终结 → Automation把历史部分失败记录继续当成新扫描的阻塞条件。** 不能把最终超时代码解释为某个视频读取了一小时。

当前`field-observation-capability-ports.js`已经包含`139dab3b8`的过期异常明确失败处理；未解决的主要阻塞在`field-observation-automation.js:77–83`：遍历所有历史Work，只要任意一项有已提交页且`completed=false`就返回`incomplete`，没有区分Work已失败，也没有排除被后续成功轮次覆盖的旧扫描。已用当前代码分别复现这两种情况。

## 精确生产时间线

以下时间为北京时间。Field为`movie-field-0ac6fa81-eec0-4bcd-9903-aaf2e8e526d4`，root为`/media/Film`。失败Work为`field-observation-work-fabadd31c38e1233d2f485189505a61e548734d1`，第61页Event为`field-observation-page-commit-event-8be2a884286e87570bf9381b855db2b9f1e99d9f`。

| 时间 | 证据与含义 |
| --- | --- |
| 09-07 18:06:16 | 前一轮成功，共73页，revision 1089–1161。 |
| 09-07 18:48:10 | 新一轮开始；最终只提交60页，revision 1162–1221，末页`completed=0`。 |
| 09-07 19:08:14 | 第61页Plan就绪；Handle冻结`expiresAtMs=1788782894246`，即20:08:14过期。 |
| 09-07 19:08:22 | `fx_resource_defer`记录该Event等待`sqlite_write`与来源卷`volume_read`组合资源。两个defer行不是两个已确认独立瓶颈。 |
| 09-07 22:39:03 | 已有部署前只读快照仍为`waiting_for_resource`，Event Attempt尚未建立。不是正在读取第61页文件。 |
| 09-07 23:31:00 | 正式Event Attempt建立，距Plan就绪约4小时23分，Handle已过期约3小时23分；Effect recovery预算起点为`1788795060779`。 |
| 09-07 23:33–次日00:00 | [当时部署记录](USER_PAIN_DEPLOYMENT_20260907.md)明确记载同一Event反复`P7_FIELD_ACCESS_EXPIRED`；旧Capability没有将该异常归类为终态。 |
| 09-08 00:33:11 | Event/Attempt/Work/Effect均以失败收尾，代码`COOPERATIVE_EXECUTION_DEADLINE_EXCEEDED`；已有60页保持。 |
| 09-12 03:17–03:26调查 | 当前Head仍1221，最新Work仍failed，无open扫描；来源根目录存在、可读。没有后续成功扫描。 |

取证来源：当前NAS SQLite以`readonly:true,fileMustExist:true`打开；已有`.codex/production-copy/source.db`和`copy.json`提供22:39快照，记录SHA256为`55ce630b1cc024364b1d0febd990e320b0cd99c1330b917305ca1b010ef39e44`。本轮没有重算该旧库全文件SHA；用精确Event/Plan/input绑定与当前库匹配定位，未启动该库对应服务。

恢复预算Evidence核验：`canonicalDigest({deadlineAtMs:1788795060779+3600000,cooperativeAbortSafe:true})`等于生产Attempt的`4b5e5597b214ea826cf1b18585c50c0214e76a1d49d9cd5273967047982afe51`。这是后续恢复时限耗尽的精确对应，不是推测一个坏文件。

## 代码与历史修复边界

- SSOT §6.3.2允许新Observation Work从`cursorIn=null`和当前Field revision开始，限制同一Field只有一个non-terminal Work；不要求历史失败扫描先成功。SSOT自动触发表明确活动Field的周期/启动观察。
- `field-observation-planner.js:24`在Plan生成时冻结一小时Handle；`field-page-observer.js:64`在调用enumerator前检查有效期。读取实际生产input并把时钟置于实际Attempt开始时间，立即得到`P7_FIELD_ACCESS_EXPIRED`，enumerator调用次数为0。
- `139dab3b8`已修复过期异常不能终结的问题。本轮只验证该补丁，未重复改写。旧运行时`fd8a8e6f35`的同一路径仅处理root错误，过期错误继续抛出；历史记录和当前失败Evidence支持上述因果。
- `field-observation-store.js:121`已经允许失败前轮之后的新Work首轮提交；09-07历史修复见[PROD-065 §7](PROD-065_ELEVEN_FORMATIONS_DEEP_AUDIT_20260907.md)。Automation的残页阻塞分支仍然保留，形成入口与提交合同不一致。
- `field-procurement-status-query.js:12/45`只翻译root错误，过期/超时均落到“目录扫描失败”。前端据正式`state=failed`呈现失败，状态本身准确；原因信息不足来自后端Projection。

## 本地诊断复现

诊断脚本与原始JSON存于工作站临时目录`C:/Users/markm/AppData/Local/Temp/shelfdeck-scan-diagnosis-20260912/`，不提交生产导出。

`node --test .../reproduce.test.cjs`共6项通过：60页终态失败阻断新扫描；旧68页失败在后来73页成功后仍阻断；只有成功历史可发起新轮；活动Work仍防并发；精确过期input在I/O前失败；恢复预算digest精确匹配。这里“通过”表示成功复现缺陷和对照行为，不是修复验收。

`node --test --test-name-pattern='expired|incomplete|new Observation round|failed predecessor' test/helix-architecture/p7-field-observation.test.js test/helix-architecture/p7-field-observation-automation.test.js`实际匹配2项、2项通过：既有残页不重发测试及68页后过期的完整重启终结测试。前者正把有问题的阻塞行为锁进Oracle，后续修复必须调整；后者证明当前过期终结补丁有效。

## 后续范围与尚未证明的部分

应由Procurement按当前有效事实发起后续正常轮次，保留旧失败页与Result；不能刷新已冻结Handle、延长超时、伪造完成或清空历史掩盖问题。失败历史不能永久阻断新轮，周期触发幂等仍需覆盖无新页、失败后重启和重复tick等情况；现行idempotencyKey只含Access/Observation revision，修复时须核查零页失败后的新周期不会永久重放终态Work。

资源等待已精确定位到上述Event的持久defer记录，但仅凭旧快照不能还原整个4小时内的permit占用、调度和恢复过程，也不能判断哪个资源独立造成全部延迟。本轮没有生产重扫、真实媒体扫描/Probe、重启、Reset、SQL修改或部署；没有声称当前真实全轮扫描已恢复。需要后续修复与适用负向、Linux及真实扫描证据后，再验收257所依赖的正常选材结果。
