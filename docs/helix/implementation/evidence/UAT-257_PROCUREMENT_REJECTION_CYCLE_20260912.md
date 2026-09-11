# UAT-257 拒绝后普通重新选材与包统计

2026-09-12。用户已确认业务闭环并授权本地迭代。Owner：Procurement资格、选材与交付统计；Libra继续独立决定接收；Admin Web消费统计。

## 合同与范围

依据SSOT §6.3.3/6.3.6、§8 MaterialSelectionSnapshot及Eligibility合同。生产只读调查见[MATERIAL_FIELD_REJECTIONS_READONLY_20260912](MATERIAL_FIELD_REJECTIONS_READONLY_20260912.md)。拒绝终结旧包并释放交付占用；材料回到下一轮普通选材，旧包与拒绝记录保留。没有拒绝包自动重做、专用等待、Retry Intent或Case。不放松Libra的当前材料验证；不处置生产存量。

修复同Field Procurement Control被误判不可选、sealed Run的未决交付占用漏读及占用变化未触发资格重算。Run Admission继续使用当前资格/Binding/Control校验及唯一guard；同轮重放不得新建包，未成包Triage失败仍服从已有有意义Basis变化/明确重试约束。

Package统计以不同Package ID为粒度，累计生成=当前等待+累计接收+累计拒绝；不计为去重影片数。接收/拒绝保持互斥终态，技术重投不增加生成数。

## UI协调

用户指定与任务“确认全页面 UI polish 需求”（01a0912a-0086-74e2-88ab-536c59d3862a）达成一致，已获明确回复：仅各来源现有“材料准备”卡片，“等待接收 N 包”独立一行，数字20px/标签14px；下方三列“累计生成 N 包 / 累计接收 N 包 / 累计拒绝 N 包”，14px、中性灰色拒绝。无全局汇总、解释教程、技术编号或新操作；旁边席位与整理列表不变。对方负责全站去技术标识，本任务在其依赖提交后修改统计区块与测试，保留UAT-256样式。

## 验收

- 隔离数据库与fixture验证：拒绝释放、下一正常轮次重新成包、原包不变、重复终态/同轮重放不新建；缺失材料不成包。
- 未决Package即使Run已sealed仍阻止重选；其他Field、Libra/Arca Control不能被重复取得；已结束Triage失败不产生无条件循环。
- 同材料旧包拒绝、新包接收，统计2/1/1/0；不同Field隔离，反复拒绝历史计数保留。
- 相关Procurement/Intake/持久化回归、前端测试与构建、隔离浏览器走查；不触发生产扫描、重试、Reset或部署。

## 执行位置

实现提交`0aabaa1ca`；分支`codex/procurement-rejection-cycle`，初始基线`27b83c6ad`，最终UI依赖`bbec73fb0`。交付到既有`codex/user-pain-iteration`，不包含生产发布。已完成本地实现与验证；尚未部署，未宣称生产验收关闭。


## 实施及本地验证

已合入UI依赖`28c7cf1df`/`bbec73fb0`。统计卡片按约定实现，移除旧累计接收占比条，避免把重复成包的历史当作当前材料整理进度。API字段及既有累计统计粒度不变；没有新增包、材料或影片计数混用。

- Eligibility恢复同Field的合法Control复用，并改用SSOT已有`MaterialSelectionSnapshot.activeGuards`，同时读取sealed Run中的精确Candidate/package digest。占用变化参与正常资格重算；数据库原有全局唯一Selection guard与Run Admission CAS继续保护并发。
- 下一轮自动选材依据本轮完成的Observation及当前事实；同Observation重放、拒绝前已经结束的旧扫描不能触发新轮次。没有在拒绝消费者中追加重做动作、Intent或Outbox。
- 未成包Triage失败的正常重入仍要求当前Selection Scope材料集合、Reality/Binding/Control或Field/Policy/Triage规则发生实际变化。Observation审计ID变化本身不算材料变化；Handoff拒绝不走该失败限制。

| 本地检查 | 结果 |
| --- | --- |
| `node --test test/helix-architecture/p7-*.test.js test/helix-architecture/p8-intake-*.test.js test/helix-architecture/p8-candidate-*.test.js` | 138项通过：资格、Observation、Run Admission/Seal、显式失败重试、Candidate交付与接收/拒绝原子幂等 |
| `node --test test/procurement-only-movie-journey.test.js` | 2项通过：多Field席位隔离、停止/重启、未决包占用、失败未成包释放及既有API统计 |
| `node --test test/procurement-rejection-cycle.test.js` | 完整新样例通过，约36秒；临时SQLite、临时文本文件与Probe fixture，未调用真实视频生产 |
| `npm test -- --reporter=json`（web） | 20个测试文件、89项通过 |
| `npm run build`（web） | TypeScript与Vite通过 |
| Package boundary / forbidden semantics guard | 389代码文件、1151依赖边检查通过；1977文件语义检查通过 |
| 1920×1080隔离页面 | 956/126/8/822、2/1/1/0、全零三组样例；无全局重复统计、无旧进度条、无溢出；等待数字20px，历史数字14px且均为中性灰 |

完整新样例使用两个可成包文件及一个不可成包文件：先封口并保持两份未决交付；普通再扫描不重复打包；移开临时文件后真实Intake拒绝两包且释放占用；缺失扫描不生成包；恢复其中一个原文件（保留同一物理身份）后普通扫描生成新包；再次拒绝、恢复、下一轮接受。最终生成4、接收1、拒绝3、等待0；原两份Package与其Rejected Delivery行逐字段保持相同。重放Observation、服务重启不增加包/Subject，Retry Intent始终为0；已接受材料不被重新选取。

来源UI已将截图与验证结果回传UAT-256任务，对方实际查看截图并回复“UI对齐通过，没有额外视觉修改意见”。截图：`C:/Users/markm/.codex/visualizations/2026/09/11/01a09142-1921-7b11-b650-001668f9a0f0/UAT-257_FILE_SOURCES.png`。三组数据均为隔离UI样例，不能作为生产修复证据。原138项和89项结果摘要仅存任务临时目录，没有把运行输出或构建产物提交入库。

未执行NAS部署、生产扫描/重试/Reset、真实媒体处置、Linux/Docker运行或Desktop构建。本次修改位于平台无关Procurement逻辑和服务Web，不修改Desktop/Worker。生产8条拒绝及6条陈旧资格的实际后续变化尚未验收；UAT-257保持“本地验证通过，待生产验收”。

## 联合部署及生产核验（2026-09-12）

用户已授权联合部署。83235c9260正式Linux镜像103项专项全部通过，包含本项完整拒绝循环；生产版本、来源UI统计956=820+128+8、八份旧拒绝Package/Delivery不变均已核验。六条资格仍受未完成Observation/扫描超时阻塞，尚无后续正常扫描成功证据；整项保持开放，不以部署或fixture替代真实后续结果。没有生产扫描、重试或Reset。详见[联合发布证据](UAT_RELEASE_83235C9260_20260912.md)。
