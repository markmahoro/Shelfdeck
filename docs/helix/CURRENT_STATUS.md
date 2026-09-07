# ShelfDeck Clean Helix Current Status

Status: **PROD-065 NFO合同、审计及本地修复验收完成，未部署。本任务未更新生产；以下 PROD-064 生产指标是 09-03 历史闭包，非当前健康声明。**

Last updated: 2026-09-07

09-07 生产只读复查：仍运行 09-03 镜像；8 部 Arca Settlement 停滞（4 部旧 NFO 漂移、4 部旧目录未知成员），2 部 Libra frozen，8 条 discarded 等待重新入库，1 部正常转码。恢复建议与逐片证据见 [生产停滞现状](implementation/evidence/PROD-065_PRODUCTION_STALL_STATUS_20260907.md)。未部署或修改生产。

16:06完成[11项深度审计](implementation/evidence/PROD-065_ELEVEN_FORMATIONS_DEEP_AUDIT_20260907.md)：8部最终NFO两版语义校验与实际媒体Probe未发现新验收阻断；007同一冻结输入在当前算法复算PASS，寒战2当前认证身份GET成功，哥斯拉正常转码45.7%。本轮typed Settlement failure仍丢失目录/文件及语义冲突详情（D1待补齐）；TMDB底层网络错误归因缺失仍待独立修复（D2）。此前本地测试通过不代表这两个可诊断性缺口已闭合。

## 当前产品与架构

- Helix-beta 范围是 Movie-only 的 SSOT 旅程 A–I，包含 Procurement、Libra、Arca On-deck、Aftercare、
  Off-deck 与 Shelf Deregistration；Series / JAV / Western Adult 属于后续产品范围。
- 唯一架构权威为 `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；当前验收权威为
  `BETA_FEATURE_ACCEPTANCE_BASELINE.md`。生产 health 或一次事故恢复不能自动把任何 `HB-*` 标为 PASS。
- P1–P13 Exit 已完成，P13 E2E-ready package 已冻结；Movie P14 资格验收和生产上线已完成。
- 当前实现机器库存：113 Capability、99 Result family、186 tables、44 Canonical Transactions、
  123 Admin routes、17 UI surfaces。

## 当前生产基线

| 项 | 当前事实 |
| --- | --- |
| 环境 | fnOS NAS `http://192.168.12.230:18080`，单容器 `shelfdeck` |
| 镜像 | `markmahoro/shelfdeck:helix-beta-20260903-f05d694dfa` |
| Source commit | `f05d694dfa` |
| Image ID | `sha256:60513d1a56f45cb7be136f1324babf44d6859351513df036ae881c780c0e332a` |
| Tar SHA-256 | `a82a4ee2d9b8798cec2137f8e98474facb83e8e30af648dc1dab503525982da5` |
| Readiness | 186 tables、123 routes、17 UI surfaces、0 findings |
| Health | `ok` / `helix-clean-v3` / `normalSupplyAllowed:true`；SQLite `quick_check=ok` |
| Execution | 0 active Aftercare Case、0 active Arca Work/Event、0 executing Arca Attempt、0 `reconcile_required` Effect |
| Collection | 22 条 active Shelf Entry；真实浏览器 22/22 显示收藏健康 |

本次生产基线由标准 build、upload、checksum、deploy dry-run/apply、readiness、health、Admin Web、mount 与
exact-image gate 验证。容器 restart count 为 0；未执行 Formation Reset。

## 最近关闭：PROD-064

- PROD-063 的 collision-only Shelf Placement Policy revision 被旧实现误当成 layout migration，影响范围冻结为
  13 条 Shelf Entry。PROD-064 使用获授权的 exact、fail-closed 工具恢复 65 个纳管文件路径，追加真实
  Inventory/Material Control revision，并把 4 个事故副本目录的 23 个文件非破坏性隔离；Deck Fact、未纳管
  torrent/字幕和正常 On-deck 条目保持不变。
- 通用修复把 layout 变化与 collision policy 变化分离；缺少 accepted Placement baseline 时进入
  `attention_required`，不猜测路径。Assessment generation、NFO 集合字段幂等、空 Inventory change typed no-op、
  列表/详情 rating basis 也已收敛。
- 两份已证明的 settlement `.superseded-*` NFO 已复制校验后移出媒体目录并保存在生产 data backup；未修改数据库，
  未放宽未知成员拒绝。
- 最终验证：Service 438 pass、18 skip、0 fail；Aftercare focused 128/128；13 条事故 Entry 的 85 个当前材料
  全部存在，三项最新 assessment 均 healthy；事故与 settlement 工具幂等复验均为零动作。

完整历史见 `PRODUCTION_DEPLOY_ISSUE_LOG.md`、
`implementation/archive/PROD-035_TO_PROD-064_PRODUCTION_STABILIZATION_20260903.md` 与 Git 提交历史。

## Gate、风险与下一动作

- NFO 连续性合同已获用户授权并固化；09-07 用户进一步授权逐步修复并推进已排摸的异常影片。唯一活动包见 `implementation/CURRENT_PHASE.md`。
- 当前允许标准部署及逐片有界恢复；不允许全量 Reset、伪造历史 witness 或直接生产 SQL 修补。
- 本地 `main` 已 fast-forward 到 PROD-064 完整闭包提交 `dbf3d2af5`；它高于生产 source commit，仅包含后续闭包记录。
- 下一项工作必须从已登记 UAT/PROD/UX 问题或新的用户目标建立唯一 Phase；若发现 Owner/Handoff/授权冲突，返回
  Architecture Design，不以兼容层或数据修补绕过。

当前只读取证：静水城/绣春刀 Arca Settlement reconcile_required；寒战2 TMDB 网络失败后 frozen。详见 PROD-065 Evidence，未宣称生产恢复。

09-07 后续实施：D1 Settlement 明细和 D2 网络安全归因已接入有界持久诊断及 Formation 查询；诊断文件不可用不会阻止失败终结。
精确 Subject Reset 已实现，服务回归 479 PASS / 18 SKIP / 0 FAIL，Admin Web 构建和 Admin HTTP 整理上架专项通过。
六项旧流程生产只读范围检查均为一 Subject、一 Run，未包含哥斯拉；尚未执行 Reset 或部署。在线数据库快照正在准备恢复演练。
