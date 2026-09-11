# UAT-257 扫描失败后的普通新轮恢复

2026-09-12。本地实现及受影响路径验证完成，UAT-257保持开放；未部署、未触发生产扫描。用户“开始修复”授权本次实施，统一部署任务负责与UAT-251、Intake恢复及UI合并后发布。分支`codex/field-observation-recovery`，基线`38e89d145`；本证据与实现共同提交，提交身份由Git记录及交付消息绑定。

## 原因与修复

[定位证据](UAT-257_SCAN_FAILURE_DIAGNOSIS_20260912.md)记录第61页资源等待、冻结Handle到期、旧版本反复恢复及最终超时。当前Capability已能明确终结过期异常；残留问题是Automation把任意历史未完成页当成活动扫描，永久阻断新轮。零页失败时原手动/周期幂等键也会永久重放旧终态Work。

遵守SSOT §6.3.2的Observation并发/revision链及Level 10的12小时周期，Procurement通过既有Admin/Work Admission发起新Work，从当前revision与空cursor开始。旧失败页/Result/Package不改写，不刷新冻结Handle、不延长时限、不改变Resource Governor或跨域Store。

- Automation只用non-terminal Work阻止并发。最近一轮失败时按其持久admission时间维持12小时重试间隔；重启及零页失败不会立即反复重试。成功后的正常启动检查保持。
- 周期命令幂等键增加12小时周期标识，无新revision的下一周期也能创建新轮；同一请求仍只产生同一Work。
- 手动新扫描生成独立请求键；未知网络/5xx结果的重试保留原输入与键，成功或明确4xx后下次操作生成新键；同步防双击，后端并发保护保持。
- 状态读取最新Work自己的页数，零页失败不借用前轮页数；运行/完成不带旧错误。过期/执行超时显示“扫描超时”，I/O deadline显示“读取文件超时”；未知/缺失原因不推断目录故障，也不增加重复原因块。

完整服务回归发现初版把失败节流扩大到所有最近扫描，会取消成功后的启动检查，并使既有Procurement旅程事实刷新断言失败。已将节流限定为最近失败轮次，保留成功后的启动语义；对应旅程及新增恢复测试全部通过，没有放宽Oracle。

## 本地验证

Windows、Node.js v25.9.0、独立依赖。真实临时目录、SQLite、HTTP和文件枚举，Probe为fixture；不是实际视频解码或NAS压力测试。

| 检查 | 结果 |
| --- | --- |
| `node --test test/helix-architecture/p7-*.test.js test/helix-architecture/p14-clean-field-observation-enumerator.test.js test/helix-architecture/p4-resource-governor.test.js` | 144项通过，包括68页后到期/挂起的重启终结、过期时零I/O、截止后禁止late commit、并发与页连续性 |
| 最终原因投影：`node --test test/helix-architecture/p7-field-procurement-status-query.test.js` | 7项通过，较上行新增1项未知原因；缺失原因及概览可访问状态亦覆盖 |
| 最终节流：`node --test test/helix-architecture/p7-field-observation-automation.test.js test/field-observation-recovery.test.js test/procurement-only-movie-journey.test.js` | 12项通过，包括新恢复闭环与两项既有旅程 |
| `node --test test/field-observation-recovery.test.js test/procurement-rejection-cycle.test.js` | 2项通过；部分失败→下周期零页失败→重启不重复→下周期完成→手动新轮；拒绝后普通选材与历史包不变 |
| `npm test -- --reporter=dot`（web） | 21文件93项通过 |
| 最终未知原因：`npm test -- --reporter=dot test/material-field-scan.test.tsx`（web） | 4项通过，较上行新增1项；单个失败状态、稳定重试键、新动作新键、双击保护 |
| `npm run build`（web） | 最终TypeScript与Vite构建通过 |
| `node media-service/web/scripts/verify-scan-recovery.cjs`（仓库根） | 最终真实临时Host+Chromium走查通过，结束后关闭Host及清理临时数据 |
| `git diff --check` | 通过 |

浏览器从登录和“文件来源”导航进入，1920×1080桌面：键盘打开详情→“扫描超时”一次→键盘“扫描新文件”→正在扫描且按钮禁用、旧错误消失→完成且2页、按钮恢复。390×844补充无横向溢出、动作可达、键盘折叠；pageerror为0。未知原因单独使用只读GET响应fixture验证呈现，服务未知/缺失原因有独立持久化fixture覆盖；不能称为生产未知错误复现。

截图和操作结果在ignored目录`.codex/scan-repair/`：`scan-{failed,running,complete}-desktop.png`、`scan-complete-narrow.png`、`scan-unknown-desktop.png`、`browser-result.json`。脚本可重复生成，不提交运行数据。

UI负责人任务`01a0912a-0086-74e2-88ab-536c59d3862a`已做代码、截图和真实Host走查记录复查并通过；其本人未另启Host重走。核对blob：页面`5615b9a0472cdbc3cd74d4ce34b1916497b1dddb`，API`33f4884ea97475d2eaad124f17aa60c8f2db4d83`，Projection`d558ea6e1bea62213790812582514d9131c4bccd`。未夹带第二轮全页UI改版。

### 扩展检查限制

`npm test`运行554项：518通过、11失败、2取消、23跳过，不能报告全绿。包含最后两项收紧之前的内容；受影响文件已按上表定向复验，没有重复整个6分钟旧套件。

- `admin-web-contract.test.js`3项强制已移除的说明；`helix-setup-readiness-query.test.js`2项强制旧全自动字段；`helix-perception-acceptance-spec-e2e.test.js`1项等待Shelf Entry失败。已在不含本修复的`663861fae`（相对基线只有docs变化）复现同样结果，未恢复旧文案/字段。
- `formation-reset-nas.test.js`因工具依赖缺失无法加载；独立安装tools依赖后9项定向通过，没有执行NAS Reset。
- 初版`procurement-only-movie-journey.test.js`失败已修复，两项最终通过。
- UAT-131 E2E的actor-only、external-only、external-multi停在Arca settlement等待；combined/父测试受360秒限时及任务自有进程清理影响取消。保留失败信息交统一部署任务，未当作扫描回归通过，未扩大到UAT-251/131实现。

## 联合发布后的验收步骤

1. 统一部署任务完成标准build-image、上传、checksum、dry-run/apply及平台验证。先记录生产当前Field、最近Work/Observation head和包统计，核对根目录可读；不修改旧Work/Event/页或重置数据。
2. 发布后读取正式`GET /v1/admin/material-fields`。旧失败超过周期，startup sweep可自动发起新轮；已经“正在扫描”则等待这一轮，不额外点击。
3. 无活动扫描时，用现有“扫描新文件”发起普通新轮。核对新Work与旧失败不同、revision连续、最多一个活动Observation；若新轮真实失败，保存具体错误及resource/event时序，不靠反复点击掩盖。
4. Owner Work终结成功、末页完成、页面“已扫描完成”且旧错误消失才算扫描完成；不是接口202或按钮状态。总页数按现场目录确定。
5. 继续UAT-257六条旧资格普通选材验收，依当前存在性、Policy、Control及Delivery guard判断；8份旧拒绝记录保持、包统计守恒。有效材料应进入正常后续选材；不满足条件须保留准确理由，不强制新包或清黑名单替代Oracle。

Linux/Docker、NAS真实整轮扫描、生产I/O压力及六条资格验收尚未执行，由统一部署任务在最终镜像补齐。历史4小时资源等待的逐秒占用无法从现有快照完整还原，本修复不声称消除了所有资源等待。无schema迁移；原有失败/不可读/并发保护保持。UAT-257不能仅凭本地测试或部署关闭。
