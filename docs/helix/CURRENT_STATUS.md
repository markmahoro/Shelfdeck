# ShelfDeck Clean Helix Current Status

Status: **PROD-066 已按用户授权定向恢复 11 部，当前 54 部上架；7 条未完成流程及异常控制清理保留。NFO 问题仍待处理，服务停止，本地修复尚未部署。**

Last updated: 2026-09-07

最新工作：用户要求围绕工作可见性、Aftercare节流、两页性能、Top Gun残留和NFO阻塞重新审计。[五项痛点审计](implementation/evidence/USER_PAIN_AUDIT_20260907.md)已完成代码/合同与既有快照核查；未测本次在线延迟、未压测批量改善、未独立读取Emby索引。不以前序架构合并建议为前提，未修改SSOT、代码或生产，下一轮迭代待评审。

09-07 部署前生产只读复查（历史）：仍运行 09-03 镜像；8 部 Arca Settlement 停滞（4 部旧 NFO 漂移、4 部旧目录未知成员），2 部 Libra frozen，8 条 discarded 等待重新入库，1 部正常转码。恢复建议与逐片证据见 [生产停滞现状](implementation/evidence/PROD-065_PRODUCTION_STALL_STATUS_20260907.md)。未部署或修改生产。

16:06完成[11项深度审计](implementation/evidence/PROD-065_ELEVEN_FORMATIONS_DEEP_AUDIT_20260907.md)：8部最终NFO两版语义校验与实际媒体Probe未发现新验收阻断；007同一冻结输入在当前算法复算PASS，寒战2当前认证身份GET成功，哥斯拉正常转码45.7%。本轮typed Settlement failure仍丢失目录/文件及语义冲突详情（D1待补齐）；TMDB底层网络错误归因缺失仍待独立修复（D2）。此前本地测试通过不代表这两个可诊断性缺口已闭合。

## 当前产品与架构

- Helix-beta 范围是 Movie-only 的 SSOT 旅程 A–I，包含 Procurement、Libra、Arca On-deck、Aftercare、
  Off-deck 与 Shelf Deregistration；Series / JAV / Western Adult 属于后续产品范围。
- 唯一架构权威为 `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；当前验收权威为
  `BETA_FEATURE_ACCEPTANCE_BASELINE.md`。生产 health 或一次事故恢复不能自动把任何 `HB-*` 标为 PASS。
- P1–P13 Exit 已完成，P13 E2E-ready package 已冻结；Movie P14 资格验收和生产上线已完成。
- 当前实现机器库存：113 Capability、99 Result family、186 tables、44 Canonical Transactions、
  123 Admin routes、17 UI surfaces。

## PROD-065 中间部署记录（历史，最新状态见文末 PROD-066）

| 项 | 当前事实 |
| --- | --- |
| 环境 | fnOS NAS `http://192.168.12.230:18080`，单容器 `shelfdeck` |
| 镜像 | `markmahoro/shelfdeck:helix-beta-20260907-1125d232c6` |
| Source commit | `1125d232c6` |
| Image ID | `sha256:106d999b0e3d2a6bad4650e2603c61469dc70a7dc1c26639407b7c66deb003f5` |
| Tar SHA-256 | `a8daa19733d0c11586354500a6e7ad5f7d300dfc6280d56dcdc4494294b9d5e4` |
| Readiness | 186 tables、123 routes、17 UI surfaces、0 findings |
| Health | `ok` / `helix-clean-v3` / `normalSupplyAllowed:true`；SQLite `quick_check=ok` |
| Execution | 恢复进行中，存在运行中及 attention_required 的 Formation，不能沿用 PROD-064 零活动指标 |
| Collection | 哥斯拉已通过正常 On-deck Commit；其余恢复以逐片 durable Receipt 为准 |

本次生产基线由标准 build、upload、checksum、deploy dry-run/apply、readiness、health、Admin Web、mount 与
exact-image gate 验证。已对明确列出的六个 Subject 执行离线有界 Formation Reset，未执行全量 Reset。

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

## PROD-065 Gate、风险与下一动作（历史，已由 PROD-066 接替）

- NFO 连续性合同已获用户授权并固化；09-07 用户进一步授权逐步修复并推进已排摸的异常影片。唯一活动包见 `implementation/CURRENT_PHASE.md`。
- 当前允许标准部署及逐片有界恢复；不允许全量 Reset、伪造历史 witness 或直接生产 SQL 修补。
- 本地 `main` 已 fast-forward 到 PROD-064 完整闭包提交 `dbf3d2af5`；它高于生产 source commit，仅包含后续闭包记录。
- 下一项工作必须从已登记 UAT/PROD/UX 问题或新的用户目标建立唯一 Phase；若发现 Owner/Handoff/授权冲突，返回
  Architecture Design，不以兼容层或数据修补绕过。

当前只读取证：静水城/绣春刀 Arca Settlement reconcile_required；寒战2 TMDB 网络失败后 frozen。详见 PROD-065 Evidence，未宣称生产恢复。

09-07 后续实施：D1 Settlement 明细和 D2 网络安全归因已接入有界持久诊断及 Formation 查询；诊断文件不可用不会阻止失败终结。
精确 Subject Reset 已实现，服务回归 479 PASS / 18 SKIP / 0 FAIL，Admin Web 构建和 Admin HTTP 整理上架专项通过。
六项旧流程生产只读范围检查均为一 Subject、一 Run，未包含哥斯拉；尚未执行 Reset 或部署。在线数据库快照正在准备恢复演练。

## 09-07 生产恢复最新记录

标准部署 `15bee70546` 已完成并通过 health、Admin Web、mount 与 exact-image 验证。Windows服务479 PASS /18条件SKIP、架构210文件与合同依赖检查PASS；最终Linux镜像NFO语义及重启/完整上架9 PASS。
六项精确 Reset 删除6 Subjects/6 Runs/89 Works/5 Workspaces/4 Packages，范围外责任保留；全量离线备份位于 `/vol1/1000/docker/shelfdeck/backups/prod065-20260907-93205bff21/`。007合格27506628703-byte文件独立备份并完整SHA校验，已替换进入正式Field；原媒体和字幕保存在Field外，不删除。
正式观察已提交，但发现新前序实现缺陷：旧扫描Work已failed、最后提交页completed=0，Store错误拒绝所有新Work的第一页。SSOT§6.3.2允许新Work从null cursor开始并保留历史页；正在修正实现，不改旧事实。
寒战2已通过身份/资料/NFO阶段，进入转码流程；四部共享目录影片自动恢复后可显示目录和未知成员，D3合同调整仍等待用户确认。老手旧版本生成的NFO与正式演员编号冲突，生成时间早于部署，当前渲染器已有对应修正，旧不可变产品仍需重建。

补充部署 `1125d232c6` 已完成：SHA校验、标准dry run/apply、health、Admin Web及挂载验证通过。Field Observation从1088推进至1101（新Work第12页），证实旧失败扫描不再阻止新一轮。该补充镜像Windows观察与Sidecar22 PASS、关联观察15 PASS、架构210文件PASS；Linux新round与连续性3 PASS。恢复尚在进行。


2026-09-07本轮结果：生产 `helix-beta-20260907-5565a03eb2`，source `5565a03eb2`，tar SHA `fc179c4e1020f5812341feaebb3b099bc9d3453b488b949e01d0ad6879a21253`，部署健康/Admin Web/mount验证通过。D3四部（壮志凌云2、夺宝奇兵5 2160p、哪啊哪啊神去村、霍比特人1）全部取得On-deck Commit，22个范围外文件前后指纹一致。
原四Subject遗漏的14条孤立custody控制经正式operator清零；《老手》《猩球崛起3》《九月五日》三条旧证据流程已逐范围Reset，正片保留、integrity/FK通过。新Observation重启后继续到revision1191、第30页；007合格Candidate仍open，其他目标等待观察及正常Intake，未完成上架。管理页快照47 completed，寒战2转码恢复，侠盗一号identity conflicting；另有新的正式Intake acceptance执行中，不调整全局并发策略强插队。

## 2026-09-07 PROD-066 接手现场

生产 source 5565a03eb2；ShelfDeck 自北京时间19:08:26起 exited，来自用户停线指令。本任务未启动服务或修改生产数据。当前活动包为 PROD-066，允许用户指定的基线数据清理及未完成 Formation Reset，原始源清理待逐项授权。旧健康/数量记录不是本次基线证明。

## 2026-09-07 PROD-066 已应用基线

北京时间20:06完成生产停机数据库替换：43部Active Entry、369个当前Inventory文件，全部存在且指纹匹配；退出11部的物理文件保留。18个关联/未完成Libra Subject与Run清空，20个旧Stage控制和9个孤儿控制清理。SQLite integrity=ok、FK=0；范围外43部事实及当前控制逐行未变。33个旧快照与4个无引用Workspace已清理，完整回滚及448个旧非数据库支持文件保留。

Windows服务489 PASS/18条件SKIP、架构/合同审计PASS、Linux隔离Control及UAT-131全链路10 PASS。生产仍为5565a03eb2且停止，本地修复尚未部署，尚未恢复真实Intake。明细及风险边界见[PROD-066审计](implementation/evidence/PROD-066_COLLECTION_CLEAN_BASELINE_20260907.md)。

## 2026-09-07 20:48 定向恢复（当前状态）

用户明确要求“先定向恢复这11部”。原退出判定过宽：8 部为同名演员的 Person ID 被写成 Movie ID，符合 PROD-045 已修复的旧 Libra NFO 写入缺陷；另 3 部呈现语义符合已接受事实，仅字节/Inventory Binding 漂移，不能直接等同于内容不合格。没有进程级写入证据证明 Emby 是改写者。

已从清理前完整备份恢复精确 11 部的 Shelf Entry、原 Commit/Deck/Inventory、Libra 与执行历史及必要采购关联。候选库在保留另外 7 条未完成流程、20 条失效 Stage 控制和 9 条孤儿控制清理的前提下构建；全表逐行比对目标副本一致，既有 43 部记录和 369 条当前控制未变。经新备份、哈希校验、单事务副本验证后替换生产库，未重新生成业务成功凭证。

独立生产复核：54 部 active，451 个当前文件均存在；原上架/Commit 行及全部当前 Inventory 与清理前一致；文件 inode、大小及采样指纹与原审计一致。SQLite integrity=ok、FK=0，无 Libra/Custody 当前控制。原有 3 个 NFO 绑定漂移仍在，8 个演员 ID 问题也没有在此次数据库恢复中修复，不宣称为全面合格基线。服务继续停止，镜像仍为 5565a03eb2，本地修复未部署。

恢复后数据库 SHA256：`55ce630b1cc024364b1d0febd990e320b0cd99c1330b917305ca1b010ef39e44`。恢复前 43 部数据库新备份：`/vol1/1000/docker/shelfdeck/backups/formation-reset-20260907T124525Z/data`；清理前 54 部备份仍保留在 `formation-reset-20260907T120253Z/data`。本次没有清理备份或改动媒体文件。
