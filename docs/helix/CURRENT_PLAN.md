# ShelfDeck Clean Helix Master Plan

Status: Helix-beta 已由 Product Owner 收窄为 **仅 Movie 的全功能版本**（旅程 A–I，含退出收藏与 Shelf 注销）。Movie Procurement保持`CLOSED FOR MOVIE`；Movie Libra保持`MOVIE LIBRA CLOSED AT HANDOFF B READY`；Movie Arca已经接通Handoff B Acceptance、On-deck、Shelf Entry、Deck Fact、Beta Aftercare、完整Off-deck及非破坏性Shelf Deregistration。当前实现状态为`MOVIE COLLECTION LIFECYCLE READY THROUGH SHELF DEREGISTRATION`。Product Owner 已授权并完成 Helix-beta 首次 NAS 部署：`markmahoro/shelfdeck:helix-beta-20260828-a3e07a1e1`。Helix-beta 验收权威仍为现行 `docs/helix/BETA_FEATURE_ACCEPTANCE_BASELINE.md`，不因此把任何 `HB-*` 标为验收 `PASS`。

Last updated: 2026-08-28

## 0. Current plan — Intake 3 席位 + Off-load 后立即回收 Workspace

Product Owner 确认上次试运行失败后，做完全干净的生产部署；已有 Libra Run 可无视。本轮只做两件事，不改 SSOT：

1. Libra Intake 门口最多 3 个未完成 Pre-deck Subject 席位；Offer 排队，席位满不 Reject。Handoff B Accepted 或放弃整理才释放。加急只作用于已占席位的 Run。
2. Arca Off-load Completion 后 Libra 立即开始 Workspace 回收（去掉 24h grace，保留约 60s 两轮无引用审计）。Signal 丢失仍靠周期兜底。

本地测试后提交，再 `--helix-clean-init` 部署；compose 挂载与 TMDB/豆瓣/目录/Shelf/Field 取值按现网快照写回。清空 `/transcode` 中间目录，不动 `/media/Film`。

## 0. Previous plan — Helix-beta NAS deployment preparation

正式工作区：`E:\my_project\emby_third_party-helix`，干净 `main`。
冻结 SHA：`bdafe186974e3fe4467f8b4c483f96bf578f9dce`（短 SHA `bdafe1869`）。
`emby_third_party-mirex-baseline` 作为历史 v2 基线 worktree 保留；其余本地 worktree 与主题分支已清理。远程仓库不动。

这是生产打包授权，不是新的 Implementation Phase 包，也不新开并行计划文件。NAS SSH 已改为私钥；历史镜像/tar/库文件已清，活数据只留一份 75 MiB 归档。下一步只允许 `docs/v2/PRODUCTION_DEPLOYMENT.md` 的标准发布流程；现网 compose 在新镜像 load 之前禁止 GUI 启动，且新容器必须注入 `SHELFDECK_SECRET_ROOT`：

1. 本机从仓库根目录 `node scripts/build-image.js <tag>`，输出 `dist-image/shelfdeck-<tag>.tar`。
2. 计算本地 tarball SHA-256。
3. `node scripts/upload-nas-image.js dist-image\shelfdeck-<tag>.tar`。
4. `node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <local-sha256>` dry run。
5. 首次 Helix clean cutover 必须带 `--helix-clean-init`；dry run 通过后再 `--helix-clean-init --apply`。compose 必须挂载 `/vol02/1000-0-c5b736af:/media`、`/vol2/1000/shelfdeck_upgrade:/upgrade` 和 `/dev/dri`（QSV）。

镜像 tag 在构建时按 `docs/v3/VERSIONING.md` 分配 `<milestone-slug>-<YYYYMMDD>-<git-short-sha>`，milestone-slug 使用 `helix-beta`，日期使用构建日，SHA 使用 `bdafe1869`。构建前不把该 tag 写入已部署记录，也不打 Git release tag。`media-desktop` 不在本次范围。NAS `192.168.12.230:18080` 始终视为生产；`--helix-clean-init` 不是原地兼容升级。已封存失败 Canary Evidence 不得拼入 HB 结论。不可变 Baseline `F:\shelfdeck_test_zone\test_film` 继续保留。

## 0. Previous UAT plan — UAT-131–UAT-139 qualification failed; fix landed

`fb28e360467766b666a3d021e1668c6f09d255da`资格运行已因UAT-131固定为失败并保留现场。经Product Owner授权，SSOT §8.6.20
有界补全、Libra授权瑕疵连续性、Arca独立Source/Product探测及Gap复核已完成本地实现与0失败回归。下一步只允许把该修复形成
新的clean main SHA，再从不可变基线建立全新Canary，完整重跑A–I、UAT-127、UAT-129、23/23主检查点、Aftercare、Off-deck、
Shelf Deregistration和至少24小时观察。不得把旧运行的10/23、恢复或其他Evidence拼入新资格结论。

该新运行又在冻结SHA `d7506e0bc534f6906f3a0ef53461b1a16f7bccd9`暴露UAT-132并固定失败：Arca独立复核的
accepted dynamic-range closed set遗漏`unknown`，误拒绝两份合法Direct产品。失败现场已封存，服务已停止。UAT-132现已按既有
SSOT完成五值合同传播，并把`none`、`preserve`、`tone_map_to_sdr_bt709`分支分别封闭；独立Architecture复核、Service全量、
Admin Web测试与构建均PASS。下一步先形成新的clean local main SHA，再从不可变基线建立新的timestamp+SHA Canary和data，完整
重跑全部协议；不得复用`d7506e0bc`的7项On-deck、6项Frozen或其他过程Evidence。

后续冻结SHA `82283e2e1f15704aed8aa612c0779288337f1475`已再次固定失败：UAT-127真实长转码在同一Event跨Attempt恢复时
从durable 63%写回0%，UAT-133又令三个合法多缺口Authorized Defect因规范顺序不一致而无法通过Handoff B。失败Canary、data与
Evidence全部保留，服务已停止。Event级Progress floor与跨Libra/Arca canonical Gap union修复的专项、完整Service、Admin Web及
Contract/Manifest/Semantic回归已经0失败；完整Architecture verifier只保留clean main既有8项fixture失败与22项dependency findings，
修改源文件无新增finding。当前形成新的clean local main SHA；之后必须从不可变基线创建新的timestamp+SHA Canary、data、temp、Workspace、External Landing和Evidence，
完整重跑A–I、UAT-127、UAT-129、23/23主检查点、豆瓣触发Aftercare、受控Artifact修复、UAT-128、全量Off-deck、Shelf
Deregistration及至少24小时观察。不得复用`82283e2e1f`的过程Evidence，也不得在资格运行期间修改代码继续拼接结论。

最新冻结SHA `185636805e879d56b7fff4c3a1a079129ccee843`又因UAT-134固定失败：同根Field/Shelf下，Arca把单个顶层
Source的父目录误当作当前Package独占旧目录，并把其他合法媒体单元判为unknown member，令On-deck永久停在`offloading`。
失败现场、UAT-127计划重启窗口及被动监控均已封存，Service与媒体进程已停止。修复保持在Arca Settlement边界，只豁免精确
Shelf Target Root的目录独占检查，仍只删除通过完整fence验证的当前Source；专项、完整Service、真实Admin HTTP、Admin Web、
Contract/Manifest/Semantic回归均0失败，Architecture只保留既有baseline findings。下一步形成新的clean local main SHA，清理足够F盘
空间后从不可变基线创建此前不存在的timestamp+SHA Canary与全新data，完整重跑全部协议；不得复用`185636805e`的13/23、
UAT-127 floor或其他部分Evidence。

最新冻结SHA `06aba07a4e279735af40ae8f47c93d818ff1141d`又因UAT-135固定失败：Arca独立媒体实检没有消费
fresh Probe已经证明的ISO selected topology，而把UDF容器路径直接当普通流Probe/Decode，误拒绝实际合法的HEVC Product。
失败现场、19/23主检查点与已通过UAT-127恢复证据均已封存，Service和媒体进程保持停止。修复没有改变Owner、Handoff、
Shelf Standard或Handle authority；同一签封ISO经uncached topology与stat/fingerprint重验后，只物化一次按MPLS精确顺序/
重复/in-out构成的selected payload session，fresh Probe与5/50/95 Decode共用并严格回收Service data专用scratch。
真实UDF单/多clip、漂移与回收负向、完整Service、Admin Web及Contract/Manifest/Semantic回归均0失败，Architecture只保留
既有baseline findings。下一步提交新的clean local main SHA，从不可变基线建立全新Canary/data/runtime/evidence，再完整重跑
A–I、UAT-127、UAT-129、23/23、Aftercare、UAT-128、全量Off-deck、Shelf Deregistration和至少24小时观察；不得复用
`06aba07a4e`的任何资格结论。

最新冻结SHA `89dc47fc926ce5dbae27c9fa3527afe75ccd006a`又因UAT-136固定失败：Package签封Handle的正斜杠
Windows路径与Arca Effect解析后的反斜杠绝对路径指向同一ISO，却因Topology identity绑定原始路径文本形成不同digest，触发
`ARCA_MEDIA_DISC_TOPOLOGY_DRIFT`。失败现场包含UAT-127完整恢复、UAT-129独立Recovery Canary与15/23 On-deck过程，但均不得
拼入后续资格。修复仅规范化ISO Topology identity的绝对路径拼写，真实Topology、Handle、Fingerprint、MPLS plan、Probe/Decode
漂移仍fail closed；专项与真实失败ISO重算已经通过。完整Service、Admin Web、Contract/Manifest/Semantic和Architecture
回归也已完成：Service 340 pass / 18显式环境skip / 0 fail，Admin Web 29/29与production build、Contract/Manifest/Semantic
均PASS，Architecture只保留既有baseline findings。下一步形成新的clean local main SHA；随后从不可变基线创建此前不存在的
全新Canary/data/runtime/evidence，再完整重跑A–I、
UAT-127、UAT-129、23/23、Aftercare、UAT-128、全量Off-deck、Shelf Deregistration及至少24小时观察。

最新冻结SHA `9f924128d8b3f48898f6e5a125bb96a8e2591df5`又因UAT-137固定失败：ISO Source/Product的Arca
fresh实检已证明SDR→SDR preserve且双侧5/50/95 Decode通过，但历史Product Media Verification的Source动态范围标签仍为
`unknown`，旧比较逻辑据此制造`dynamic_range_conversion_unmet`。22/23主检查点、已通过的UAT-127/UAT-129与全部过程
Evidence均只保留为失败现场，Service和媒体进程已停止。修复只保留历史`conversionOperation`用于operation continuity，
具体动态范围符合性完全由Arca fresh Source/Product reality判断；真实preserve drift、非DV tone-map、颜色、DOVI与Decode负向
仍fail closed。专项、完整Service、Admin Web、Contract/Manifest/Semantic及Architecture审计已经通过，完整Architecture verifier
只保留既有baseline findings。下一步形成新的clean local main SHA；随后从不可变基线建立此前不存在的新Canary、data、runtime、
Workspace、External Landing与Evidence，完整重跑A–I、UAT-127、UAT-129、23/23、豆瓣触发Aftercare、受控Artifact修复、
UAT-128、全量Off-deck、Shelf Deregistration及至少24小时观察。不得复用`9f924128d8`的任何资格通过结论。

最新冻结SHA `c5adeb32ab068e6377187d725427c39fda2426e0`首次达到23/23 On-deck，但主检查点逐文件审计发现
UAT-138：007目录内Baseline原有的`Thumbs.db`虽已被Field Observation观察，却未进入Candidate Related、Product、Final
Inventory Decision或Arca Inventory，形成“Decision 9 = Inventory 9 != FS 10”。该SHA资格已固定失败，豆瓣、Aftercare、
Off-deck与24小时观察均未继续。修复以新的Related Rule revision 2只在single Movie与BDMV external parent识别精确
`Thumbs.db`为exclusive `sidecar`并沿现有carried-forward与逐成员Disposition链收拢；历史revision 1、standalone、multi-movie、
其他`.db`、Material Control及Arca authority均保持不变。专项、完整Service、Admin Web、build与Contract/Manifest/Semantic
回归已通过，Architecture无新增finding。下一步把修复提交为新的clean local main SHA，随后从不可变基线创建此前不存在的新
Canary、data、runtime、Workspace、External Landing与Evidence，完整重跑A–I、UAT-127、UAT-129、23/23、豆瓣触发
Aftercare、受控Artifact修复、UAT-128、全量Off-deck、Shelf Deregistration及至少24小时观察；不得复用`c5adeb32ab`
的任何资格通过结论。

最新冻结SHA `6ed28d6841f7fe8df4ee9501d1b98880e660d343`已通过23/23主检查点、豆瓣Aftercare、受控NFO修复、
UAT-127与UAT-129，但在全量Off-deck前置页面门禁发现UAT-139：Admin Web没有将全部当前收藏多选/全选为一个batch Review的
入口，因而无法执行统一Scope核对和High-volume二次确认。该SHA资格已固定失败，Review、Authorization、Case、Off-deck和
Deregistration均未发生。修复只补现有Off-deck页面的选择清单、全选/清空、数量/空间汇总与batch Review动作，继续复用Arca
既有Scope、High-volume、Authorization与删除合同；Admin Web、build、Off-deck专项及完整Service回归均0失败。修复已落入
干净 `main@bdafe1869`。2026-08-28 Product Owner 授权不再以新的全量 Canary 重跑作为部署开工门禁；后续动作见上方
Helix-beta NAS 部署准备。不得复用`6ed28d6841`的任何资格通过结论。

## 0. Previous UAT plan — UAT-094–UAT-105 Aftercare internal hardening

Product Owner已明确：不调整SSOT、不改变Domain/Owner/Handoff、不把Aftercare退回Libra，也不抽取共享生产核心；只在Arca Aftercare及其既有Platform/Foundation端口内修复本域缺陷。已完成三路只读深审计，并在UAT台账登记`UAT-094`–`UAT-105`。

关闭顺序固定为：媒体策略与完整符合性（094–095）→ NFO/Poster及Verified Artifact（096–097）→ Basis/Settlement/失败恢复（098–100）→ Progress、异步I/O与Workspace生命周期（101–102）→ Incident/Projection与Startup Gate（103–104）→ 全新真实Canary评分刷新闭环（105，同时完成UAT-092真实资格）。每项先完成反例和专项回归，再进入下一项；不得以一次全量测试替代独立关闭证据。

当前正式工作区为`E:\my_project\emby_third_party-helix`、`main@194d4947d`，服务保持停止。`F:\shelfdeck_test_zone\test_film`为不可变基线；F盘当前空间不足以复制133.95GiB全量基线，最终Canary采用真实字节的选择性副本，所有data/temp/workspace/monitoring均在F盘。远端、NAS生产和旧证据库不在本轮范围。

## 0. Previous UAT plan — UAT-093 closed

`UAT-093`已完成SSOT、代码与自动化回归：Douban collection页缺year时仍形成Record并推进cursor，不再访问Subject详情；
Perception Resolution Rule revision 3使用明确Provider/Target Anchor后退到规范化title exact，year只保存/展示。历史
`title_year`事实通过可重建Projection参与title关联，旧Record不修改。专项84/84与完整Service 320 pass / 18 skip / 0 fail。

关闭结果：保留现场未经SQLite修改安全恢复并使用既有配置续传；真实Acquisition从cursor 435完成75页，最终Record 1547、
cursor revision 104、terminal complete。《网诱惊魂》Record合法提交`provider_identity + title` Anchor且没有`title_year`；
SQLite integrity为ok，服务保持ready。状态`FACT/RESTART PASSED / CLOSED`，没有剩余UAT-093动作。

## 0. Current UAT plan — UAT-092 real Canary pending

`UAT-092`已完成代码与自动化回归：Acceptance Spec要求演员而Related NFO没有演员时，Libra继续创建TMDB Metadata Work；
同一Observation集合形成的`MediaCastDraft`作为正式Sidecar输入，NFO按“未坏则更新、坏则重建、缺失则创建”写入演员，同时保留原丰富字段和
Person强身份。完整Service回归320 pass / 18 skip / 0 fail。

剩余关闭动作仅为全新隔离真实TMDB Canary：用未污染的`test_film`副本重跑至少一部原NFO无演员影片，证明Provider Work、Media Cast、
输出NFO演员、Product Conformance和Formation终态一致且不产生`metadata_field_unmet`冻结。在取得FACT/FS终态前，状态保持
`CODE/REGRESSION PASSED / REAL CANARY PENDING`；不得修改旧冻结Run或伪造恢复。

## 0. Previous UAT plan — UAT-085–UAT-091 closed

`UAT-085`–`UAT-091`的代码、FACT、FS、PERFORMANCE与RESTART作业已在最终隔离运行
`F:\shelfdeck_test_zone\runs\UAT-20260824-031004-228f39a37`完成。当前HEAD `0bc45ed98`服务保持运行，真实恢复转码继续推进；
不得为了补证停止服务、手工改SQLite、删除最终Canary或修改`test_film`。2026-08-24 Product Owner明确接受现有证据并授权关闭，
`UAT-085`–`UAT-091`全部PASS/CLOSED。

当前没有剩余UAT关闭动作。`UAT-085`–`UAT-088`未取得新的认证页面截图这一证据限制继续保留，不补写UI PASS；最终运行与Canary作为
可复核现场保留，服务继续正常运行。

## 0. Post-UAT implementation — People registration, identity conservation, and avatars complete

分支`codex/fix-people-registration-avatars`已完成`UAT-071`、`UAT-072`与真实Canary暴露的`UAT-073`：Arca按人物关系冻结Evidence，People按Provider Person Identity优先幂等；Libra保留NFO演员`tmdbid`并按稳定Provider Person Identity精确去重；Admin Web显示服务端代理TMDB头像并在失败时回退姓名首字。正式Route Inventory增加1条头像GET route，总计119条；不新增表，不迁移或删除旧错误Candidate，不放宽弱身份确认规则，不改变People/Arca Owner、Media-Cast或Business Handoff。

确定性stub运行`UAT-20260823-people-registration-avatar-91e6bb141`只保留为自动化夹具，不作为真实UAT截图。真实资格运行固定为`F:\shelfdeck_test_zone\runs\UAT-20260823-people-real-avatar-fix-b8861a3dd`，独立端口、数据、Field、Shelf、tmp、Playwright与evidence均位于F盘。《放·逐 (2006)》正式Formation→On-deck链路得到23/23强身份Person、0待确认，重启后数量不变；桌面及390px真实UI为21个真实TMDB头像、2个首字回退，axe serious/critical为0。后续交付只需保留提交与证据，不切换当前`18080`服务，不清理现有或本轮失败/成功运行目录，不部署NAS。

## 0. Product scope — Helix-beta is Movie-only full chain

用户于2026-08-22确认：Helix-beta 就是只支持 Movie 的全链路产品，包含发现、整理、上架、我的收藏、健康/Aftercare、评分与人物、**退出收藏**、**整架注销**和概览/安全，而不是「先上架、其他 profile 凑齐才叫 Beta」。

- 现行验收基线：`docs/helix/BETA_FEATURE_ACCEPTANCE_BASELINE.md`（`HB-A`–`HB-I` / `HB-P`，从 SSOT §9.1 抽象）。
- 已作废：2026-07-23 四类媒体 271 行 Feature Matrix，归档于 `docs/helix/archive/BETA_FEATURE_ACCEPTANCE_BASELINE_FOUR_PROFILE_2026-07-23.md`。
- SSOT 仍定义 Series / JAV / Western Adult；它们是后续产品范围，不再作为 Helix-beta 门禁，也不得从架构正文删除。
- `implementation/CURRENT_PHASE.md` 中「四类媒体完成后才回到完整 Feature Matrix」的 Beta DoD 已被本决定取代。

## 0. Current execution — clean Movie Canary Admin Web UAT authorized

用户已于2026-08-22明确授权从当时的工作区`E:\my_project\emby_third_party-helix-retake`、分支
`codex/helix-first-implementation-retake`重新开始一次干净的 Movie Canary 真实 Admin Web E2E/UAT。该提交链已于
2026-08-23原样提升为当前工作区`E:\my_project\emby_third_party-helix`、正式主分支`main`，未改写历史。
文档基线 commit 为`f7037310a51dd6873776c0ae57b317b0263c7fc2`；UAT-028 sidecar 修复 commit 为
`2ed7baad2dd663d302264cbb4747d41471a2eb96`。本轮使用`F:\test_film`只读基线和全新`F:\canary`，
不读取、不复用、不修改`G:\canary_film`、`Z:\Film`、NAS生产部署或旧污染Formation事实。

授权范围内允许：新建隔离UAT data directory、一次性copy-forward既有External Integration/Secret与
immutable Douban Perception历史、从基线复制Canary、Preflight通过后启动本地服务，以及按
`docs/helix/acceptance/MOVIE_CANARY_USER_UAT_CHECKLIST.md`执行真实Admin Web验收。
旧2026-08-21“修复完成后暂停、等待再授权”的hold已被本轮明确授权取代。

2026-08-23 工作区重组后继续沿用同一关闭任务：正式开发路径为
`E:\my_project\emby_third_party-helix`、分支`main`；测试专用根为`F:\shelfdeck_test_zone`，不可变基线与
Canary分别为其下`test_film`、`canary`，不得在C盘创建新的测试过程文件。当前Canary
`UAT-20260823-040740-0886b2723`已逐项关闭`UAT-017`与`UAT-062`：真实MoviePilot明确不合格候选在下载前被拒；
frozen Discard后页面进入等待重新入库、cleanup fully ack，重扫形成全新Procurement/Subject链而未复活旧Subject。

UAT关闭总账现为70/70。`UAT-070` 已由 commit `efaf2d827` 完成精确根因修复：新 Work 创建时读取并冻结当前
Integration Handle，单个 reconcile scope 失败不再击穿整个 startup；真实失败库克隆已通过 RESTART/FACT。`UAT-064`
commit `daaef8c3d` 的同一真实证人在安全重启后自然完成，执行中与完成态 API/FACT 都满足关闭命题。2026-08-23 Product Owner
明确接受两项现有证据并要求关闭，因此两项均标记 `PASS`；记录明确保留未取得渲染 UI 截图，不伪造该证据。全过程未触碰
NAS/生产、未 push 远端。

2026-08-22 成功标准修正：`养蜂人 (2024)` 内现成 MKV 与嵌套 BDMV 按两部独立电影验收，两部都必须能上架；Arca Duplicate/Off-deck 才负责去重。形成口径 23 Subject / 23 Entry，不再使用“顶层 22 单元 = 22 Subject”或“养蜂人只能一部 Movie”。

## 0. Implemented repair — UAT-005 / UAT-018 Formation current state and ended history

Formation durable Projection现把每个当前Subject严格归入`pending | in_progress | attention_required | completed`
四个互斥桶。`completed`只接受Arca公开Projection对On-deck Commit Receipt、Shelf Entry及对应active Deck Fact的
完整证明；Package published或Handoff B Accepted不再提前显示完成。Frozen、Suspended、blocked、Product Identity
确认及Executor技术失败统一进入用户可见“需要处理”；`in_progress`必须由当前开放可推进的Libra/Arca责任证明，
历史Succeeded Work不能永久污染当前状态。

Discarded Run继续作为immutable业务历史，通过有界History Query展示“已结束 · 用户放弃”；同一eligible Subject只以
一个当前`pending`行回到待整理，不把旧Run重复计入顶部统计。Admin Web顶部与行级状态使用同一后端分类，增加“需要处理”
统计和“当前状态”列。专项回归、完整Architecture Gate、P3 Persistence Gate及Admin Web production build均已通过；
UAT-005/UAT-018仍保持OPEN，等待用户另行授权的新Canary真实验证。

## 0. Implemented repair — UAT-020 Final Inventory naming and Settlement

Shelf Placement Policy的关闭合同现同时包含目录、Primary、NFO、Subtitle、Poster、Fanart命名规则与collision policy；
Admin Web创建Shelf时全部可配置，并在保存前展示标准Movie样例预览。默认目录、视频和NFO stem为`片名 (年份)`，
Poster/Fanart使用稳定固定名，字幕只追加可证明的language、forced、SDH后缀。

Arca在Final Inventory Decision中逐成员冻结`sourceMaterialKey`、role、`finalName`、endpoint和最终location；Workspace
`transcode-*`、hash、内部ID或Package/Event名称不再泄漏到Shelf。旧Shelf两字段Placement只在读取历史失败Evidence时采用
版本化标准默认值，不改写旧Decision或Entry。

On-deck现按`settlementExpectation + source-to-final mapping`覆盖`carried_forward + replace_or_move`和
`replaced_and_settled + remove_after_place`；同路径形成Evidence no-op，不同路径先验证Final再精确清理旧成员。Commit前逐项证明
全部Disposition完成并持久化非空`related_disposition_completion_digest`。旧目录只在精确为空时删除，未知成员使流程fail closed。
Aftercare同时检查当前Inventory、Placement Decision与已知旧Custody Binding；只有旧Identity未漂移且能唯一对应当前Final字节时，
才纳入Placement Case的有界Settlement。Custody Binding持久化完整Physical Identity tuple，禁止用当前Shelf mount scope猜测历史
Identity。代码门禁完成后UAT-020仍保持OPEN，等待用户另行授权的新Canary真实验证。

## 0. Implemented repair — UAT-019 terminal executor outcome closure

Foundation继续把每个终态Work Outcome持久化后交还精确Domain Process scope，不再把成功作为Owner reconcile的前提。
Handoff B在Arca admission时原子写入Domain Recovery Case与Foundation Inbox；`delivered`只表示技术送达，只有正式
Accepted/Rejected业务事实成立后才能Ack。Assessment技术失败不产生业务拒绝，而进入持久`attention_required`，页面展示
失败阶段、稳定错误码、尝试次数、Owner、恢复代际和人工重试入口。

配置连接revision或服务执行合同revision变化时，只自动建立一次新的immutable Work代际；再次失败后等待用户重试。
相同确定性故障按Owner/Process/Work Kind/Error Code聚合Incident，第三次打开process-local Circuit，恢复证据成立后再关闭。
旧Work/Event/Attempt和失败Evidence不改写。专项闭环、迁移回归与完整Architecture Gate通过；新Canary仍需真实Admin Web验证。

## 0. Implemented repair — UAT-017 MoviePilot requirement preflight

External Acquisition Query现在同时冻结当前`MediaRequirement`和`AcquisitionPolicy`；MoviePilot Candidate以typed
`known/unknown`声明提供分辨率、Codec、主音轨、大小与来源Evidence。Selector优先明确合规候选，只有无合规项时才选
页面可见的未知候选，明确不合规项永不下载；真实字节仍由Probe最终验收，失败后在用户配置的1–5次上限内选择下一候选。
现有凭据无需重录即可revisioned修改尝试上限，默认3。专项91/91、完整Architecture Gate 1087 pass/7 skip/0 fail及
Admin Web production build均通过；真实Provider资格已由`UAT-20260823-040740-0886b2723`关闭`UAT-017`。

## 0. Qualified repair — UAT-004 bounded media I/O

Workspace大型媒体继续固定使用`middle-256k-sha256`，生成后额外读取上限为每个文件262,144 bytes；新增真实稀疏大文件
预算断言覆盖MKV、ISO、BDMV M2TS及`transcode-*`产物。下游Workspace Reference的primary media验证现拒绝旧式完整
SHA-256 Handle，防止完整文件digest由consumer重新引入；NFO、Artwork等小型Artifact仍使用完整SHA-256。

## 0. Qualified repair — UAT-002 Intake throughput

Intake继续使用每个Candidate独立的concurrency scope、256个open Work硬上限、16个Handoff Acceptance预留槽，
并在一次reconcile中最多新Admission 32项。补充的重启资格检查发现deferred process只存在内存Set；现已改为同时从
持久Procurement Offer分页重建，内存wake只作加速。400 Candidate积压在新Coordinator实例中以13个有界批次全部重新Admission，
不增加全局串行门闩。真实22部Canary吞吐仍由第二轮Admin Web UAT确认。

## 0. Qualified repair — UAT-001/UAT-003 Douban detail anchors

豆瓣Collection行缺失年份或别名时，同一有界Acquisition Page最多读取16个精确Subject详情页；响应必须绑定相同Origin和
Douban Subject ID。详情年份、别名和payload digest进入新的immutable source revision，旧Record不改写。Record Commit后只唤醒
title/year Anchor精确相交的Subject Resolution，周期reconciler只承担丢Signal恢复。既有技术尾缀、括号年份和多语言Alias规则保持
严格匹配，不提高模糊阈值。专项回归已通过并单独提交，三个定向Canary留待新UAT验证。

## 0. Qualified repair — UAT-016 TMDB locale and alias evidence

用户授权的Movie Canary修复已经开始。TMDB连接现在把首选语言作为用户可见、revisioned设置，默认`zh-CN`；Search、
精确ID Observation与Metadata读取共用该设置。精确ID和有界候选同时保留Original Title、Alternative Titles与Translations
别名Evidence，Libra继续使用严格关联而不放宽为模糊匹配。现有无该字段的连接按明确默认值读取，新保存revision显式持久化。
本修复已完成专项回归、Admin Web build并单独提交；真实Provider与Canary浏览器资格留给第二轮UAT。

## 0. Current amendment — Formation durable projection local cutover

2026-08-21，本轮“媒体整理工作区”已从请求内临时拼账切换为后端维护的
`libra_formation_projections`技术Projection。它是一张可重建的展示Projection，不是业务授权依据；每个Subject一行，
active默认25条分页，completed独立分页，Projection Host负责精确唤醒、启动重建、30秒fallback和100项有界游标。

本轮按“先克隆、后现场”的顺序完成安全退役和恢复：

- 现场数据库已由`helix-clean-v2`迁移至`helix-clean-v3`，表数量182；迁移只退役旧Catalog下的62个活动Work、106个活动Event，
  保留全部不可变执行历史，并把Owner后续replan留在原Work scope内；没有清空数据库或删除业务事实。
- 已在独立数据库克隆上验证迁移、启动恢复、541个既有Subject生成Projection、active分页25条、页面读取和队列幂等，
  随后才迁移现场数据库。现场切换前备份为
  `C:\Users\markm\AppData\Local\Temp\ShelfDeck-Local-Rerun-20260820\formation-projection-cutover-20260821-015122\shelfdeck.pre-retirement-20260821.db`，
  SHA-256为`A734FE822896D88F597F66825853EA984E6919D8E58E23099CAC6D022A27F154`。
- 现场迁移后`integrity_check=ok`；当前数据库有659个Subject和659行Projection，旧Catalog无非终态Attempt/Event，旧Plans仍保留2863条。
- 本机服务已恢复监听`127.0.0.1:18080`；健康接口返回`normalSupplyAllowed=true`，Formation active接口返回25条，
  completed可独立分页，Projection状态为`ready`，Admin Web返回200。
- 现场服务恢复期间继续处理原有队列，未主动新建媒体任务；启动阶段收口的是原队列中既有的Workspace transcode中间产物。
  没有重新Observation `Z:\Film`，没有清空当前队列，也没有主动重新同步豆瓣、TMDB或MoviePilot；Docker、NAS和生产数据均未触碰。

最终证据：启动恢复/事件运行时/Runtime Host聚焦回归分别为12/12、24/24、12/12；Node全量回归276项为259 pass、17 skip、0 fail；
Admin Web production build通过。现场日志另有1条既有Arca `CLEAN_ARCA_TARGET_COLLISION`业务错误，服务未降级；该问题不属于Projection切换，
已登记到UAT台账，未在现场数据库上直接修事实。

## 0. Completed target — Arca Shelf Deregistration and Movie lifecycle closure

Shelf Deregistration已经删除“仅空Shelf、同步改状态”的捷径。用户通过现有Admin route提交带Shelf revision fence、精确Shelf名称、
保留文件与释放Control确认的Intent后，Shelf立即进入`deregistering`并退出Routing/Handoff B Acceptance目标；HTTP返回`202`，后续固定经过
`Responsibility Drain → Manifest Freeze → Paged Verification → Atomic Commit`。Coordinator只处理责任收敛、Work签发和terminal Result，
Capability统一经过immutable Plan、Event Runtime、Resource Governor、Attempt与Result Binding。

非空Shelf可以注销。Release Manifest只保存header/digest；成员按Shelf Entry、Inventory revision、member ordinal稳定排序并持久化，
每100项形成一个Verification Work，整座Shelf没有Material总数上限。`controlled_material`冻结精确Physical Material Identity与Control fence；
Related/Artifact只作为`reference_evidence`，不会伪造Control release。所有Page通过后，唯一terminal commit在同一事务中再次校验Manifest，
释放精确Arca Material Control、终结active Shelf Entry与Deck Fact、更新Finished Goods Region、写Receipt/Result/Outbox并把Shelf置为
`deregistered`。任何CAS漂移都会整笔回滚并形成新Manifest revision，绝不部分释放。

竞争责任已经接线：未授权Off-deck Reservation会释放；已授权Off-deck与已Accepted On-deck在不可逆边界后继续安全收口；Aftercare先通过
专用`care_deregistration_settlement` Work回收其Workspace，再使旧Case invalidated。terminal Control release按每页最多100个Material Key
发送durable Neutral Signal给Procurement，Signal丢失仍由既有cursor fallback发现；只对精确Material-local Eligibility做增量重算。

Admin Web“收藏架”提供强确认Dialog、责任数量、phase/Page进度和只读历史状态；`deregistering|deregistered` Shelf不再允许Standard、
Placement或Target变更。“我的收藏”支持当前/历史筛选，因Shelf注销终结的Entry只进入历史。注销全过程不申请任何Volume Permit，不读取、
移动、改名或删除Shelf Target内文件，也不删除Target Folder。

验证结果：Shelf/Aftercare/Off-deck/Deregistration聚焦回归24/24；超过10,000成员的非空Shelf形成10,003项Manifest、101个Page并完成注销；
进程中断后同一数据库恢复为唯一Process、Receipt、Control release与terminal Event。完整Architecture Gate为162个test file、1056 pass、
7个显式环境skip、0 fail；完整服务回归245 pass、17 skip、0 fail；Admin Web production build通过。机器合同保持112 Capability、
98 Result family、180 table、43 Canonical Transaction、115 Admin route加public health，UI Surface保持17。P2 aggregate为
`21942ef67403a4658f101966e6ea232ee9872e3add684e7842e7e1ef59dc308a`，SSOT source-map aggregate为
`3fde8cbfa5779c48ec15d1441b7cf2ea21779151c3da02d2f4d345ed6cc4f927`，manifest aggregate为
`64e0eefa999513a01804776951b11137c64913c9f1cb5ba1a20020f0fcdd6846`，DDL digest为
`78075366b3409916b8f8c6fcd3c0786daa5e45bab82f59ba83d91a2663689119`。

保留证据位于`C:\Users\markm\AppData\Local\Temp\helix-shelf-deregistration-aC8Nd7`，其中包含SQLite数据库与
`shelf-deregistration-report.json`；重启恢复证据数据库位于
`C:\Users\markm\AppData\Local\Temp\helix-shelf-deregistration-8hH1Vk\data\shelfdeck.db`。隔离Target内普通Primary、NFO、Poster、
字幕及BDMV/CERTIFICATE代表文件共9项，注销前后Reality digest均为
`31ddfb4ec9ceb37f7cba6e55267f55ddd262bf59bbba7ac7c44b949af7a2651d`。测试仅使用系统Temp及隔离Target，
未访问`Z:\Film`、Docker、NAS或生产数据。

## 0. Completed target — Arca Off-deck and Movie lifecycle closure

Off-deck现在以Arca-owned Policy、Candidate/Duplicate Evidence、Review、逐Entry Reservation、immutable Destruction Scope、
Selection/High-volume Receipt、Authorization、Case及Deletion Evidence形成完整链。推荐退出、Duplicate审阅、Aftercare
`attention_required`加入审阅和用户直接退出复用同一安全路径；用户直接退出不会伪造Review Candidate。默认Policy为disabled，
任何Condition Fact为unknown时不产生Candidate。

Authorization前可以取消Review并释放Reservation；Authorization后不可撤销。服务端以Entry、Primary、总空间、Shelf覆盖率和
全Deck覆盖率五项阈值重算High-volume，必须有独立第二次升级确认，客户端无法声明`highVolume=false`绕过。Batch只是一份授权
Envelope，每个Entry仍拥有独立Authorization与Case；单项stale不会回滚其他已经成立的退出Intent。

每个Case固定经过`Scope Verification Work → Material Destruction Work → Terminal Commit Work`。每个Primary删除、Related引用释放、
Related最后引用删除和最终核验均为独立Event，并通过Event Runtime、Resource Governor、Authorization Handle、Effect Journal及
`volume_mutation` Permit执行。共享Primary在任何删除前即被Scope Verification拒绝；共享Related先释放本Entry引用，最后引用消失后
才删除。授权Identity已经不存在时只形成精确absence Evidence，绝不触碰同路径替代Identity。全部成员合法收口后，terminal事务才
原子终结Deck Fact、把Shelf Entry置为`offdecked`并释放精确Material Control；历史Entry、Inventory、Authorization、Case和Evidence保留。

Aftercare与Off-deck之间的异步安全边界已闭合：Reservation原子阻止新Case；已有Care Work先通过精确Process cancellation排空，Review在
安全停点前保持`preparing`，不得提前授权。执行中的Off-deck Case若遇到Endpoint outage进入blocked；Scope变化进入同一Case的
`awaiting_reauthorization`，不会创建第二个Case。Coordinator不直接访问filesystem、Capability实现、Dispatcher、Event Runtime或
Resource Governor。

Admin Web的Off-deck页面已接通退出建议、Duplicate Group、审阅授权、High-volume第二屏、逐Entry退出进度和Policy编辑；“我的收藏”
详情可直接发起退出，“收藏健康”详情可加入审阅。没有新增一级页面或Admin route，UI Surface继续为8 pages + 9 journeys = 17。

自动化覆盖Policy tri-state、五项High-volume阈值、1024成员Scope、Duplicate分页、删除重放、删除后崩溃恢复、共享Related、共享Primary、
替代Identity、Endpoint outage和Coordinator静态边界。产品Composition Root在P14只读源的全新Temp副本上验证了普通单Entry及10 Entry
High-volume破坏性链：取消Review零副作用，正式批次形成10份独立Authorization/Case并全部offdecked；Scope外sentinel与原P14主库不变，
`failedWorks=0`、`failedEvents=0`且无非终态Work/Event。机器合同保持112/98/180/43/115；Execution Foundation、Procurement、
Libra与Aftercare状态机均未修改。最终Helix Architecture Gate为161个test file、1051 pass、7个显式skip、0 fail。

## 0. Completed target — Arca Aftercare Ready

Aftercare现以每个Shelf Entry作为Owner Process scope，经`Health Assessment Work → immutable Plan → Custody / Presentation /
Conformance Event → Assessment Commit → Care Disposition`推进。Coordinator只签发Work、读取terminal Result、创建Case或收口Case；
Planner不执行Capability，所有Capability均经过Event Runtime、Resource Governor、Attempt及Result Binding。三项Assessment共享同一
Care Basis；Basis过期后旧结论只保留为历史，不得继续给当前Shelf Entry着色。

周期合同已经封闭：Custody每24小时到期，Presentation与Conformance每7天到期；每个Shelf Entry加入最多2小时确定性jitter；
启动恢复和丢失signal通过`fx_reconcile_cursors`按100项/页、5秒/轮有界发现。每日Custody只核验当前Inventory成员的存在、可读性、
stat fence及最多256 KiB有界指纹，不遍历Shelf目录。Endpoint级故障以共享`incidentKey`聚合为`observe/not_assessable`，不会批量创建
损坏Case。

Beta自动修复已闭环NFO再生、Poster有界重取、现有Primary的remux/transcode与Placement迁移。效果完成后必须建立新verified
Inventory revision、精确settlement旧输入、回收Aftercare Workspace并重新执行三维Assessment，最后才能把Case标记为resolved。
Primary缺失、Identity改变、不可解码，或需要重新搜索/下载媒体时固定为`attention_required`，不调用Procurement、Libra或
MoviePilot。每个Shelf Entry由数据库partial unique约束保证最多一个非terminal Case；Basis变化会使旧Case invalidated。

“我的收藏”已承载全部健康产品表面：海报卡提供灰/绿/黄/蓝/红且带可访问文本的检验章，支持全部、健康、观察中、修复中、
需要处理、尚未检查筛选；详情展示Custody、Presentation、Conformance、Basis freshness、Finding、active Case进度及Inventory
revision修复历史，并提供只签发评估Work的“立即检查健康”。独立`/care`一级页面已经移除；正式UI inventory为8 pages + 9
journeys = 17 surfaces。

产品E2E覆盖健康Entry、NFO修复、Poster修复、Placement安全迁移、Inventory revision 1→4、三次Case闭环、Workspace先回收后
Case closure、重启无重复，以及Primary缺失同时NFO缺失时禁止昂贵局部修复。P14隔离产品场景15/15通过；完整服务回归245 pass、
16个显式环境skip、0 fail；完整Architecture Gate为160个test file、1039 pass、7 skip、0 fail；Admin Web production build通过。
机器合同保持112 Capability、98 Result family、180 table、43 Canonical Transaction、115 Admin route加public health；P2 aggregate为
`38f7ec09909ec35a75907d3ba7dadc8fa2e9bf715c2775076906039b39d9704d`。本节点未访问`Z:\Film`，未使用Docker/NAS。

## 0. Completed target — Movie Arca at Shelf Entry and Deck Fact

Arca现以`Handoff B Outbox → Acceptance Attempt → Supporting Work → immutable Plan → Event Runtime → Capability`
独立验证Package、Shelf Standard/Placement、Identity、Structure、Metadata、Mandatory Media、空间与Inventory可行性。
Accepted commit原子消费Offer、取得Product Control并建立On-deck Custody、Final Inventory Decision和On-deck Run；
Rejected commit只形成immutable rejection Decision/Receipt并回告Libra，不建立Arca Control、Shelf Entry或Deck Fact。

On-deck固定链通过独立Event完成Target Slot、Stage、Staged Verify、Final Verify、Placement Switch、精确Input
Settlement、Fulfillment Verify与On-deck Commit。只有最后的On-deck Commit原子建立Canonical Content Identity、
Inventory Representation、Shelf Entry、Deck Fact、Off-load Completion和typed Result/Outbox。Coordinator只签发Work、
读取terminal Result和请求Arca-owned transaction，不执行文件Capability或Foundation Runtime。

Admin Web“我的收藏”已成为active Shelf Entry的海报墙：卡片只来自Arca Collection Projection，点击后展示Metadata、
Media-Cast、Inventory/Deck revision及Shelf Entry评分入口。海报读取是带Inventory revision/digest/containment fence的
authenticated GET；缺海报只显示fallback，不触发Provider、Aftercare或文件写入。

fresh-clean正向与空间不足拒绝E2E都已通过，并分别在完成后重启验证无重复Acceptance、On-deck、文件效果、
Shelf Entry、Deck Fact或Outbox消费。当前机器合同为112 Capability、98 Result family、180 table、43 Canonical
Transaction、115 Admin route加1条public health（总计116 route）。该历史节点当时不实现Aftercare、Off-deck或Shelf Deregistration；
三者现已由前文独立闭环，只有NAS部署仍在当前范围之外。完整服务回归为245 pass、16个显式环境skip、0 fail，
Helix Architecture gate与Admin Web production build均通过。

## 0. Closed target — Movie Libra at Handoff B Ready

2026-08-14，用户在审阅38场景、真实DV、源级GPU→CPU fallback及真实MoviePilot L07终态证据后接受Movie Libra封口。封口范围从Handoff A Accepted后的Intake开始，覆盖Routing、User Perception、Acceptance Spec、Libra Run、Workspace Production、Product Conformance、Package Publication，终止于自包含On-deck Product Package及open Handoff B Offer。封口不包括Handoff B Accepted、Arca Acceptance、On-deck、Shelf Entry、Deck Fact或Workspace Off-load回收。

后续Arca接入只能消费正式Handoff B合同；若要求改变Libra Owner、Run/Work/Event执行边界、Production Planner、Package、External Landing或Promotion语义，必须返回Design，不得以Arca实现补丁反向修改已封口的Movie Libra。

Libra Run、Workspace、Product Fact、媒体生产、Promotion和open Handoff B Offer均已通过隔离P14真实字节及故障注入验证。原35个逻辑场景继续由
`test/helix-libra-handoff-b-scenario-e2e.test.js`的产品级test case覆盖；MoviePilot External Landing接线后该文件复跑为13/13 PASS、约450秒。D09与R09另由真实DV字节产品Composition Root E2E覆盖。当前默认服务测试245 pass、14个显式环境skip、0 fail；Architecture gate为159个test file PASS。合同计数保持112/98/180/43/115，当前P2 aggregate为
`f75a5a714d2bb06af61cb31986832ed07ff9106e51ef12f3988fca87a4bf8327`，SSOT source-map aggregate为`9d7e809b178976d1b742819f87622a44f9757c0ec173b32e494be4e3fbd65ac3`。Execution Foundation状态机没有修改。

DV专项已封口：真实Profile 8样本经实际Device Probe选择`local-nvidia-nvenc-0`，Assessment 24/24通过后只产生一份GPU Transcode Effect；真实Profile 7样本在受控Platform Adapter中保持GPU `ready`但缺少当前source pipeline，GPU Assessment以`required_pipeline_profile_unavailable`收口且GPU Transcode Effect为0，随后由新的CPU Work/Plan/Event/Intent执行two-pass及显式strict-ABR重规划。两条最终输出均为HEVC、SDR BT.709 limited、`yuv420p`、无DOVI，5%/50%/95%均可解码；重启不重复Assessment或媒体Effect。Profile 5/无兼容Base Layer的D10会耗尽本地策略并在外部无结果时Frozen，0 Package/0 Offer。

MoviePilot External Landing产品合同已经接通：MoviePilot的请求/整理目录与Libra Workspace保持独立；最终输出只允许按整理历史的
`download_hash → dest`解析，不读取下载历史旧`path`。`dest`经当前`MoviePilotLandingBinding@1`转换为Endpoint-relative location，
随后由Stability、Identity/Package Verify和Workspace Import复用同一Binding revision。Import以流式普通拷贝形成独立Workspace
Physical Material，前后核验stat、digest与containment，不硬链接、不删除Landing原件。Admin Web通过现有Integration路由配置和测试
Endpoint、API Key、请求根、整理根与ShelfDeck只读可见根；产品路径不再接受进程启动参数中的旧下载映射。

真实L07最终复用MoviePilot中已经完成的`The Wild Robot (2024)`精确任务和`download_hash`，测试脚本硬性禁止调用`/api/v1/download/add`，因此没有重新下载或创建第二个任务。产品链只通过Transfer History定位最终整理`dest`，随后完成planned restart、Resolve、Stability、Identity/Package Verify、Workspace Import、真实Probe、Package及open Offer。

最终fresh-clean证据位于`C:\Users\markm\AppData\Local\Temp\helix-real-libra-handoff-b-HmA51h`：总耗时607.681秒；Search 12.057秒、Request/既有任务采用14.085秒、Acquisition Observation 268.735秒、Stability 289.589秒、Workspace Import 341.676秒。`moviePilotDownloadAddCount=0`；Request、Acquisition Observation、Stability与Import的成功事实均各1份，planned restart后无重复外部请求、Import、Package或Offer。Landing原件与Workspace副本均为21,756,642,178 bytes、SHA-256 `fd725e36bc8f5fb5503cddba241d146353aba5a8b06e2b50c7f0c35dbe347468`，inode不同，证明是独立物理副本而非硬链接。真实输出为HEVC 4K + TrueHD，低于50 GiB Acceptance上限；`failedWorks=0`、`failedEvents=0`、Offer未消费、Arca Entry为0，数据库`integrity_check=ok`，Landing、Material Field与Shelf Reality不变。

该轮同时闭合了大文件External Landing观察的执行合同：External package完整SHA-256属于外部包完整性Evidence，不是Physical Material Identity的有界指纹；Acquire Observation和Stability必须同时取得Integration及Landing `volume_read` Permit，并使用有界长超时。原30秒timeout会在约4分钟checksum尚未完成时制造重试和重叠读取，现已修为30分钟硬上限并通过真实21.76 GB文件验证。

## Local media test boundary

用户于2026-08-11固定后续真实媒体测试范围：

- 可重复构建的主测试库：`C:\Users\markm\AppData\Local\Temp\ShelfDeck-P14-20260723\material-fields`；
- destructive Formation场景仍只允许在该主测试库或由它生成的独立系统Temp副本中执行；Material Field与Shelf Target必须明确配置到本轮隔离副本；
- 后续Libra、Arca及Movie E2E只能在隔离临时目录内实施，不得将`Z:\Film`配置为Material Field、Shelf、Workspace或Canary输入；用户随后分别授权测试库seed和真实Perception E2E从`Z:\Film`只读取材。本轮真实Perception E2E只复制两部有界普通媒体到新的Temp Field，复制前后逐项验证源size/mtime/ctime不变；仍禁止任何源端写入、移动、重命名或删除；
- 该目录已由`build-helix-movie-test-library.js`重新seed为可重复构建的Movie纵向验收库；正式manifest、受管路径、Reality digest和重建命令保存在`.shelfdeck-test-library`，历史非受管目录保持原样；
- 任何文件移动、替换、Settlement、On-deck或销毁验证都只能作用于上述已登记测试Scope；越出Scope立即停线。

该决定是本机测试环境与安全合同，不修改Architecture SSOT中Material Field、Shelf Target或Material Control的通用语义。

当前测试库包含12个既有Movie输入场景和10个Formation高风险场景。新增G01–G10分别覆盖existing Related replacement、
精确Settlement授权、逐成员崩溃恢复、Target collision、跨卷、Handoff后Related Reality变化、同根二次Observation、ISO、DVD以及
1,025项exclusive Related的complete-or-fail-closed边界。静态输入直接位于Material Field；碰撞与Reality mutation以受digest保护的
control seed保存，只能在manifest指定阶段物化；跨卷场景明确要求第二个本地filesystem root。每个destructive/fault-injection场景
必须先重建测试库且不得并发执行。素材和配方存在只代表测试前提完备，产品路径未接线的分支仍必须标为`contract_only|not_implemented`。

### Completed Routing test-set extension

Routing节点测试集已把主生产链与Sorting专项链分开：现有`test material field → movie test`继续作为direct路径，保证现有
Subject可以全部进入后续Acceptance Spec/Libra Production；另建不与其物理范围重叠的Sorting专用Material Field及三座拥有唯一Target
Folder、绑定同一Movie Rule Template的测试Shelf。Sorting happy-path使用真实电影标题及正式Evidence，至少固定以下预期：

| Input | Required Routing Fact | Expected target |
| --- | --- | --- |
| `顽主` | `release_year=1989` | 经典电影测试 |
| `爆弹` | `release_year=2025` | 新片测试 |
| `0.5毫米` | `release_year=2014` | 普通电影测试（显式最低优先级`always`规则） |

Policy顺序固定为`release_year <= 1999 → 经典电影测试`、`release_year >= 2020 → 新片测试`、`always → 普通电影测试`。
真实标题只用于用户可读核验，不得作为Routing条件或Provider ID；Routing必须消费带revision/digest的正式Decision Fact。

Sorting专用Field还必须增加两条无NFO边界：一部无NFO但能够通过正式Identity/Provider Evidence确定年份的电影，必须仅补齐Routing所需
`release_year`后正常命中；另一部无NFO且无法可靠解析Identity/年份的电影，必须保持`Routing Readiness unresolved`，高优先级规则结果为
`unknown`时不得越级进入catch-all。两者都不得在Routing阶段生成NFO、poster、完整Product Metadata、Libra Run或文件副作用。

## 0. Completed target — User Perception and Acceptance Spec Ready

本轮从resolved Routing Decision继续接通User Perception和immutable Acceptance Spec。评分只允许以Handoff A Accepted后的Subject或
Arca Shelf Entry为目标；Candidate仍是内部对象。用户评分与真实Douban同步统一经过`Acquisition Work → Normalize/Commit Event →
Resolution Work → Resolution Commit Event`，HTTP只签发Work并返回`202`。改分追加Correction/Supersedes Record，不修改旧Record。

Admin Web当前保持八个一级页面：“上架进度”按Subject提供1–5星控件，“我的收藏”按Shelf Entry提供同一控件；“系统设置”内部增加
`连接与集成|评分日志`Tab。评分日志是可分页、可筛选的只读Projection，不提供评分、修改或同步动作，也不展示Candidate。

Acceptance Spec链路固定为`Routing resolved → Perception Resolution terminal → Spec Preparation Work → Decision Basis Commit Event →
Acceptance Spec Publication Event`。Decision Basis冻结Shelf Standard、Routing Decision和Perception Resolution revision/digest；
`not_found`形成No-rating Spec，1–5星按Movie Rule Set形成不同Requirements。新评分只追加下一份合法Spec revision，不覆盖旧Spec，
本轮不创建Libra Run或Workspace。

真实本地E2E使用当前代码生成的fresh Routing事实和临时clean数据库，通过Admin产品入口测试/保存真实Douban连接并完成全部分页：
1546条Douban Record、104个Provider Acquisition Page，约107秒完成；Admin评分日志以16页读取1546个唯一Record。两部匿名普通媒体
从`Z:\Film`只读复制到隔离Field后，完成Procurement、Intake与direct Routing；匿名Subject `d76cdad1c520`和`62800f9c2a3f`
分别命中两个不同真实星级，形成两个不同Acceptance Requirements digest。直接评分及Correction又证明同一Subject的Spec revision
`1 → 2 → 3`且三份历史均保留。重启与相同sync idempotency key重放没有增加Acquisition、Work、Record、Resolution或Spec。

最终数据库保留于`C:\Users\markm\AppData\Local\Temp\helix-routing-decision-0bAMhK\data\shelfdeck.db`。当前机器合同为
112 Capability、98 Result family、180 table、43 Canonical Transaction、114 Admin route加1条public health（总计115 route）。
`failedWorks=0`、`failedEvents=0`；Libra Run、Workspace、Product Package、Handoff B/Arca Receipt及Shelf Entry全部为0。

下一独立节点只能是Libra Run Admission；若它要求改变已冻结的Perception Resolution、Spec、Execution Foundation或Procurement合同，
必须先返回Design，不得恢复旧`movie-formation-coordinator`捷径。

Libra Run Admission至Handoff B Ready的已确认验收场景基线固定在
`docs/helix/acceptance/LIBRA_HANDOFF_B_READY_SCENARIOS.md`；后续实施和封口必须逐项回填该文档的35个逻辑场景，
不得只以一条happy path产生Offer代替产品、Freshness、Related与crash-window验收。

## 0. Completed target — Libra Routing Decision Ready

本轮在Intake Accepted Subject之后接通正式`Routing Coordinator → Supporting Work → immutable Plan → Event Runtime → Capability`
路径。新增`libra.routing.fact.observe@1`只按当前Field Policy实际引用的Fact观察精确NFO或确定性TMDB测试Integration；NFO与Provider
是两个独立Work，不在Capability内部隐藏fallback。Coordinator只签发Work、读取terminal Result、调用pure Resolver及提交Owner事实，
未导入Capability实现、Dispatcher、Event Runtime或Resource Governor；历史大型`movie-formation-coordinator`的Routing捷径未进入产品路径。

Field Routing Policy现支持direct与1..64项sorting closed AST，三态`true|false|unknown`严格阻止高优先级unknown越级命中catch-all；
一次性手动选Shelf只为当前unresolved Subject形成immutable Decision，不修改长期Policy。Admin Web“文件来源”可预览/发布Policy，
按Fact类型提供Operator和值编辑、组合条件及rank上移/下移，不向普通用户暴露AST JSON；“上架进度”仍一行一个Subject，并展示准备
事实、unresolved/resolved、Policy revision、目标Shelf与Decision digest。

本机fresh-clean产品Composition Root E2E形成24个Subject：direct Field的19个全部命中`movie test`；sorting Field的4个按NFO或
deterministic TMDB Evidence命中经典/新片/普通Shelf，1个Provider `not_found`保持unresolved且未命中always，随后通过Admin入口
一次性选择普通Shelf。共29个Routing Work、5个Fact Event和24个Decision Basis Commit Event全部成功；Acceptance Spec、Libra Run、
Workspace和Arca Shelf Entry均为0。下一独立节点是Acceptance Spec，不能在其门禁打开前进入Production。

补充的真实外部资格验证已于2026-08-12完成：显式脚本`npm run test:helix-routing-real`要求调用者提供隔离Temp MKV与本机私有
TMDB credential，经Admin产品入口配置真实Integration，禁止注入fake Provider Adapter。无NFO的`The Shawshank Redemption`由真实
TMDB唯一解析为ID `278`、年份1994并自动命中经典Shelf；重启后没有重复事实。另一个真实标题`Fight Club`因2个同名候选保持
`ambiguous/unresolved`，证明系统没有选择搜索结果第一项。该外部脚本不进入默认离线测试套件，也不得把credential写入代码、日志或文档。

## 0. Completed target — Arca Shelf Configuration Ready for Libra

本轮在不进入Handoff B、On-deck或文件副作用的前提下，完成第一座可由Libra公开读取的active Shelf。首次创建Command必须探测唯一
Shelf Physical Target Folder、读取`system-beta-recommended`的精确active revision、由Arca生成effective Shelf Standard和Placement
revision 1，并原子发布Shelf Routing Target Projection；Admin Web不得提交自行展开的Standard。

Admin Web“收藏架”从静态Stub改为真实配置页：列出Shelf与Rule Template、创建Shelf、选择推荐Template、配置Target Folder和Movie
Placement，并展示Movie No-rating及1–5星Standard。系统Template仍包含四组Profile Rule Set且保持只读；M1只展示和消费Movie部分。

验收只使用本机Node.js、临时clean数据库和临时空Target Folder。必须证明Target探测失败不留半成品、创建命令幂等、重启后事实与
Projection逐字一致、Libra只能通过Arca public projection读取Shelf及Standard、Target目录内容不变。完成状态只能标记为
`ARCA SHELF CONFIGURATION READY FOR LIBRA`；Libra-owned Field→Shelf Routing Policy属于下一独立目标。

2026-08-11，本目标已通过本地Node.js、临时clean数据库和临时Target Folder完成验收。下一目标仍是Libra-owned
Field→Shelf Routing Policy及Handoff A Routing Decision/Acceptance Spec；它尚未获得Implementation Gate，不能在本轮顺带实现。

## 0. Completed target — Libra Intake Acceptance and Formation list

本轮只打开Handoff A之后的第一个Libra节点。Procurement发布的Candidate Offer由durable Outbox Dispatcher交给Libra
Intake Coordinator；Coordinator只签发Supporting Work并读取terminal Work Result。Candidate、Material、Binding及continuity验证均由
Planner展开为immutable Plan，再由Event Runtime执行正式Intake Capability。Accepted commit在一个原子事务中建立或延续Subject、写入
Libra Material Binding、接收Receipt和Control连续性，并向Procurement发布accepted结果；拒绝路径保持独立typed Decision和Receipt。

Admin Web“上架进度”已接入真实Formation Projection，固定一行一个Subject。当前节点只显示Intake已经接收、但尚未完成Shelf Routing的
Subject，因此状态为`awaiting_destination`；页面不会把Work、Event或一次Run展示成独立用户条目。历史大型Libra Coordinator没有进入该
产品路径，也没有被复用为同步执行捷径。

本地Node.js clean Canary使用唯一隔离测试根完成：1,140个regular files、5个Observation Page、1个sealed Procurement Run、19个
Candidate/Offer全部被Libra正式接收，形成19个Subject和19个accepted Intake；其中G08/G09分别以正式typed topology形成`iso`与`dvd`
输入，DVD Manifest包含1个`primary_payload`及4个`structural_dependency`。唯一G10超大Related场景在Procurement按业务合同
`candidate_disposition_scope_unrepresentable`收口，不产生Candidate，不属于Foundation技术失败。测试主动重启后未重复Observation、
Candidate、Offer、Intake或Subject；源Reality前后一致，Libra Run/Workspace、Handoff B及Arca媒体事实均为0。

本轮完成状态为`LIBRA INTAKE ACCEPTANCE READY / AWAITING ROUTING`。下一独立目标是Libra-owned Field→Shelf Routing Policy、Routing
Decision及Acceptance Spec；不得在未显式开放门禁前签发Libra Production Run或产生Workspace/文件副作用。

## 0. Closure — Movie Procurement at Handoff A Ready

2026-08-11，用户在审阅最新全库Canary、性能分段对账和Candidate抽样结果后接受Movie Procurement封口。当前活动改造已经完成，
封口内容为：Observation事实、增量Eligibility、Selection Scope、Run Admission、Foundation三层执行链、Movie Triage、BDMV Assessment、
Related重建、Candidate Assembly、Candidate Package与open Handoff A Offer。Series、JAV、Western Adult以及Handoff A之后的Libra Intake
均不属于本次完成声明。

后续若进入Movie Libra，应作为新的、可验证目标单独打开Implementation Gate；只能消费当前正式Handoff A合同，不得反向修改已经封口的
Procurement或Execution Foundation语义来迁就Libra实现。当前线程在未获得新的明确实施指令前停在该边界。

## 0.1 Completed amendment — Mixed Movie Field and unified Run bound

本轮基于`bd6a0d2c`把Movie Field的pre-triage Selection正式统一为三类持久Scope：Field根目录中的每个普通文件分别形成
`standalone_file`，非BDMV材料按Field根目录下第一级目录形成`ordinary_directory`，BDMV及同级`CERTIFICATE`形成
`bdmv_container`。Run Creator只消费terminal Observation形成的冻结Scope，按canonical UTF-8顺序装箱；Run与任一不可拆分
Scope的唯一业务上限都是1024个selected Physical Material。Related Material既不进入Selection，也不计入该上限。

Planner、Structure及Candidate Context直接消费已Admission的Scope事实，不再重新猜目录类别。标题规则固定为：standalone取文件
stem；单电影ordinary directory取目录名；多电影ordinary directory分别取对应文件stem；BDMV取容器目录名，Field根直接放置的
BDMV使用稳定临时标签。Related在Candidate Assembly中只查询冻结Observation的当前Scope并按standalone、单电影目录、多电影目录、
BDMV外部目录四种association mode重建，Structure不访问NAS且不内联大型Related数组。

正式合同为111 Capability、97 Result family、180 table及43 Canonical Transaction；Run/Scope/Retry/Manifest/Handoff的物理成员
上限统一为1024。Observation Page与Eligibility批次保持256，Probe批次保持100，Execution Runtime保持16个in-flight Event；本轮
没有修改Scheduler、Event Runtime、Resource Governor、Permit、Retry或Result Binding语义。

### Full Canary result and bounded performance return

第一次全库复验使用新的临时clean数据库和只读`Z:\Film`完成。实际源为18,409个regular files（用户新增`苹果.mkv`及其
`苹果.nfo`），不是计划假设的18,408。正确性全部通过：72个Observation Page、922个Selection Scope、8,627个selected
Physical Material、10/10 Run Seal、943个Candidate Package/943个open Handoff A Offer；`苹果.mkv`形成唯一
`standalone_file` Candidate，display identity为`苹果`、`materialInputForm=stream_file`、Primary Manifest只有自身，Related只有
`苹果.nfo`。源Reality前后一致，0 duplicate Selection、0 failed Work/Event、0 Resource defer、Libra/Arca为0且Offer未消费。

该轮性能未通过15%红线：首个Offer 163.385秒、全部Run Seal 445.122秒、总耗时451.260秒。资产保留于
`C:\Users\markm\AppData\Local\Temp\helix-full-movie-canary-0af0uA`。诊断确认主要放大来自Candidate Manifest与Context对每个
Candidate复制/读取整个1024成员Run，以及Coordinator在每次terminal Work后重复扫描旧Work/Package；不是Foundation状态机问题。

修正后，Manifest只接收当前Candidate的精确成员，Candidate Context只查询当前Unit/Scope，Triage Evidence Index按确定性ordinal
O(1)定位，Coordinator用O(log N)幂等Work存在性探测并只在Seal前执行完整集合核验。产品Composition Root的1000 Candidate压力
fixture已形成1000个Candidate/Offer、最大open Work 33、0失败；`npm run test:helix-procurement`及`npm test`均通过。

用户明确授权后，第二次全库复验已使用新的Temp clean数据库完成。正确性仍全部通过，资产保留于
`C:\Users\markm\AppData\Local\Temp\helix-full-movie-canary-Ovor6i`。Candidate修正被真实数据验证：Manifest累计耗时从
90.043秒降至16.335秒，首个Offer到全部Run Seal的尾段从281.737秒降至173.523秒，改善约38.4%。

整轮绝对性能仍未过原红线：首个Offer 256.578秒、全部Run Seal 430.101秒、总耗时435.806秒。与第一次混乱Field Canary相比，
Observation Capability累计耗时从42.320秒升至111.266秒，普通Media Probe从83.173秒升至122.758秒；上游source-dependent
阶段的本轮波动掩盖了Candidate收益。该绝对耗时继续作为原始Evidence保留；用户已将其确认为环境波动并接受正确性与Candidate阶段
性能证据，因此不再阻断Movie Procurement封口。不得通过修改Candidate或Foundation去“修复”该环境波动，也不自动第三次读取全库。

## 0.1 Current amendment — Observation facts and incremental Eligibility

本轮废止“仅改Observation存储”的上一版计划，先修改唯一Architecture SSOT，再实现并验证两个相互关联的收敛点：

- Observation明细永久写入Procurement-owned `proc_field_observation_entries`；Page JSON只保存游标、数量、边界digest、page/fact digest和commit marker。一个Page Event最多提交256个文件、物理读取最多64 MiB，每个Physical Material指纹读取最多262,144 bytes。独立Layout Capability/Event/Result废止，Layout只作为冻结Observation entries上的技术Projection。
- Eligibility仍是`proc_field_materials`上的当前Decision Projection。全局Observation head推进不再使全部Material失效；Reconcile只接收新、Reality/Binding/位置变化、missing、unknown/basis失效，以及Field/Access/Policy/Selection/Reservation/Control影响的有界Material Key Change Set。未变化Material不执行Eligibility SQL UPDATE、不递增revision。

本轮不新增Eligibility历史表、Capability、Result family、Admin route或业务对象；当前clean合同为111 Capability、97 Result family、180 table、43 Canonical Transaction。验证顺序固定为：合同/Schema → Observation幂等与批次边界 → 18,000项Eligibility写放大fixture → Procurement回归 → 本地只读`Z:\\Film`全量Canary。上述门禁已全部完成；本轮不进入Docker、NAS、Libra或Arca。

### 0.1 Current amendment — BDMV Assessment and Scope Reference

BDMV不再为每个物理成员建立通用Media Probe Event。每个BDMV容器只签发一个`procurement.triage.bdmv.assess@1`，在一次受控调用中完成有限Playlist/Clip拓扑解析、确定性主标题选择和选定主标题M2TS的bounded metadata probe；不读取完整M2TS、不计算全文件Hash、不嵌套调用Event Runtime。普通媒体仍使用`shared.material.media.probe@1`。

Structure只消费durable `BdmvAssessmentEvidence@1`并输出紧凑`UnitScopeReference`；Candidate Context按冻结Run、Observation和Assessment facts重建主载荷与对应结构依赖。BDMV容器的全部物理成员仍作为不可拆分Scope参与Run Admission（最多1024），但不塞入Plan或Structure Result；未选中的M2TS/CLIPINF不进入Candidate或Related。

### 0.2 Final evidence — 2026-08-10 local full Canary

本轮使用本机Node.js、系统Temp下的clean数据库和只读`Z:\\Film`完成最终Canary：

- sourceBefore/sourceAfter均为18,407个regular files，digest均为`a630ecf5b86c0da2541b5e53fae2bc6e5aa8d28fd181b7d6ce6c770042eb316d`；数据库`integrity_check=ok`。
- Observation为72页、18,407条entry；每文件只读取一次中段指纹，逻辑读取`1,776,608,472` bytes，未超过`18,407 × 262,144`上限；主动重启后未重读已提交页。
- 增量Eligibility首轮实际`eligibilityDecisionWrites=18,407`、`reconcileBatchCount=185`；Observation完成后的后续Triage没有增加Eligibility写入；完全相同Observation的0写入由专项fixture覆盖。
- 创建12个并存Run并全部Seal；955个Work、1,080个Plan、3,926个Event/Attempt/Result全部成功；942个Candidate Package与942个open Handoff A Offer，Related Reference共122份。
- BDMV容器共59个，全部Assessment为`resolved`；产生59个BDMV Structure Unit/Candidate，普通Candidate为883个。通用Media Probe共884个，BDMV内部成员通用Probe为0；没有STREAM标题Candidate。
- `failedWorks=0`、`failedEvents=0`、`resourceDefers=0`、RSS峰值约0.78 GiB；数据库`integrity_check=ok`。Related数据库审计未发现BDMV内部路径或视频载荷（包括`.m2ts`）被误记为Related；Offer未消费，Libra/Arca事实为0，源文件无写入/移动/删除/重命名。
- 总耗时约5分42秒；Observation terminal后首个Structure约131秒、首个Candidate/Offer约142秒、全部Run Seal约5分36秒。Scope成员路径归一化改为每个Run Basis只做一次，避免大BDMV Candidate Context的平方级重复扫描。临时资产保留于`C:\\Users\\markm\\AppData\\Local\\Temp\\helix-full-movie-canary-VFP6wA`；此前Canary资产未删除。

本证据将Execution Foundation与Procurement本地验证状态更新为`CLOSED FOR DOMAIN ONBOARDING`。后续Libra/Arca接入若要求改变Foundation状态机、Permit、Result Binding、Reconcile或backpressure语义，必须返回Design。

## 0. Active implementation checkpoints

本轮在已经恢复的`Run → Work → Event`产品路径上正式封闭Execution Foundation的设计与实现接口；不回退Mirex，不重建骨架，
不进入Libra或Arca：

1. **SSOT封闭**：明确Event有界并发、`maxInFlightEvents=16`、typed Resource Key、精确Process reconcile、30秒fallback sweep、
   Domain Execution Projection及soft/hard cap语义；新增`fx_reconcile_cursors`，当前Observation事实表改造后的clean table总数为180。
2. **产品接线修复**：Runtime Host有界启动多个Event；Resource Governor逐Event原子发放Permit bundle；Scheduler、Work Supply与
   waiter遵守同一Domain Execution Projection；删除每Event全Run扫描及整Field Triage读取。
3. **Foundation封口验证**：以产品Composition Root覆盖并发、Permit、immutable Plan、Result Binding、terminal aggregation、
   205个Process三页cursor恢复、lost wake、retry/defer/timeout及七类Effect crash window。
4. **Procurement压力回归**：以260个Candidate需求证明hard cap有界、completion持续产出、Package/Offer早于全部Run Seal，且
   Coordinator不执行Capability、不做整Field读取。
5. **最终全库Canary与封口**：本地Node.js在新的系统Temp clean数据库上运行`Z:\Film`只读Canary；主动重启后从同一
   durable数据库恢复，未重扫Observation。最终12/12 Run Seal、942 Candidate Package/942 open Handoff A Offer、
   `failedWorks=0`、`failedEvents=0`、源Reality前后一致、Libra/Arca为0，已改为`CLOSED FOR DOMAIN ONBOARDING`。

Checkpoint 1–5的实现与本地fixture已经完成；Layout Snapshot及Triage Unit/Candidate Context改造的Node回归和Procurement压力fixture已通过；全量真实Canary已完成。运行边界固定为本机Node.js、临时clean数据库和
只读媒体源；不使用Docker、不部署NAS、不消费Handoff A Offer、不进入Libra或Arca。

Physical Material Identity不承担NAS字节完整性证明。所有Physical Material统一使用`middle-256k-sha256`：读取正中间最多
262,144 bytes并执行前后stat fence；禁止首次登记、Control、Binding或Effect Fence触发全文件Hash。Artifact、Canonical JSON和
事务Evidence的SHA-256保持不变。当前本地数据库不迁移Identity v1，也不保留alias、fallback或dual contract。

2026-08-09 Layout性能修订：唯一SSOT已补充Field Observation Layout Snapshot合同。Observation terminal后生成可复用的
profile-neutral目录索引；Evidence Assessment按唯一直接父目录规划Layout Event，Triage Layout只读取Snapshot，不再
执行NAS `readdir`或相关文件指纹读取。Media Probe仍保持为独立Event并只对Run Selection访问源文件。

2026-08-10 BDMV拓扑边界已确认并完成实现：BDMV不是pre-triage的`movie`类别，
而是Run Creator使用的不可拆分container group。最近`BDMV`祖先目录下的全部terminal Observation成员必须进入同一Run，
完整group可以与其他group按稳定顺序装入同一Run，单个group超过256项时整体不建Run。Structure只消费完整group，
解析Playlist、Clip与结构依赖并形成单标题Triage Unit；BDMV内部成员不得各自形成Candidate，多标题/歧义/不完整保持
`not_ready`。Run Admission不得等待Structure发现依赖后再静默扩张；所需结构成员必须在Admission前完成Observation、
Eligibility和Control。当前实现新增正式`procurement.triage.bdmv.assess@1`、`BdmvAssessmentEvidence@1`及
`BdmvAssessmentInput@1`，Scope Reference为运行时可重建引用，不新增表或业务Domain。

当前产品压力证据为260个Movie Primary、2个并存Run：260份Candidate Assembly Work最终形成260个Package和260个open
Handoff A Offer，全部Run Seal，零failed Work/Event；开放Work从未突破256。全链由产品Composition Root中的Scheduler、
Event Runtime及typed Resource Governor推进；没有Coordinator直接执行Capability的路径。

此前同步Coordinator路径完成的单Movie Canary保留为低层Capability和Owner事实的诊断证据，但它绕过了产品形态的Work Scheduler、
Event Runtime与Resource Governor，因此自本计划起不再作为有效Foundation E2E或Handoff A Ready E2E验收证据。

## 1. Role and authority

本文是唯一Helix Master Plan，只维护：

- clean-cut总决策；
- P0–P13 Phase顺序、依赖和Exit Gate；
- 当前Phase指针；
- 授权边界和下一动作。

架构只由`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`定义；工程过程只由`ENGINEERING_PLAYBOOK.md`定义；当前Phase的
Work Package细节只存在于`implementation/CURRENT_PHASE.md`；当前事实只由`CURRENT_STATUS.md`报告。

本文不复制Phase执行细节，也不保存已完成审计全文。

## 2. Accepted implementation decision

采用：

> 新`media-service/src/helix/`完整重建clean业务核心和产品表面；旧实现逐函数取证复用；完整验证后一次性切换
> Composition Root；不在旧Libra/Nexora/Kairox/Task主路径上增量改造。

固定边界：

- 五个一级Business Domain为Procurement、Libra、Arca、User Perception、People Management；
- Collection Formation只有Procurement→Libra和Libra→Arca两次单向Handoff；
- 一个`data/shelfdeck.db`不等于共享Store；Repository和Fact Owner保持隔离；
- clean schema不迁移旧Runtime事实，不dual-read/write/run，不保留旧fallback；
- 62个旧业务executor中0个可整体复制；复用只限登记后的pure/protocol/FFmpeg/file-transaction原子；
- 完整clean root切换前只允许isolated fixture，不形成混合可运行产品；
- `media-desktop`不属于本轮范围。

实现差距基线和处置Evidence见
`implementation/evidence/IMPLEMENTATION_GAP_AUDIT_4a16f0a9.md`。

`PBF-10-R1`只闭合Candidate Publication的机器事务表集：7张Procurement domain表（含
`proc_candidate_primary_material_episode_claims`）与3张Foundation表构成精确10张`writeTables`；不改变Domain、Owner、
Store、Handoff或Capability；PBF-11后当前关系表总数为168张。

`PBF-10-R2`进一步固定Package-derived `CandidateIntakeAcceptanceBasis@1`、stable Offer ID、typed Offer Outbox
message/consumer/dedup合同，并把Season Continuity Claim全链路统一为
`provider_season_identity|triage_grouping_lineage`；同样不扩大任何Owner或物理边界。

`PBF-10-R3`把承载Run `candidate_package_revision_head` CAS的既有`proc_procurement_runs`补入Candidate
Publication domain write participant；最终机器事务固定为8张Procurement、3张Foundation及11张write table，
同时保留Run表为CAS fence read，不改变Owner、Store、Handoff或Capability。

`PBF-11`闭合Candidate Delivery typed snapshot、Libra-owned continuity resolution、N:M Episode/Binding关系、
global/target CAS、Resolved Identity exact Claim关系化、nullable identity初值及Handoff A完整Accepted事务。
它新增五张Libra Intake关系/头表，使总数调整为168；不新增Domain、Owner、Store、Handoff或Capability。

`PBF-11-R1`扩充既有`proc_candidate_related_references`，逐列保存完整Physical Identity、association Evidence和
reference digest，使Candidate/Run/Offer关闭后仍能由Procurement Owner rows历史重建完整Package与Delivery Snapshot；
不新增表、Owner、Store、Handoff或Capability，168-table inventory保持不变。

`PBF-11-R2`与`PBF-11-R2-R1`把Handoff A Rejected闭合为独立typed Decision、Reason/Evidence、Receipt、Outbox及
Procurement consume，并恢复Accepted Receipt的唯一scope digest；同时分离Handoff A富拒绝与Handoff B通用拒绝，
完整闭合Arca rejected持久化连续性。关系表调整为169，Catalog Result family调整为97。

`PBF-11-R2-R2`明确区分append-only row与CAS lifecycle row：`proc_candidate_deliveries`仅允许一次
`open → accepted|rejected`，`proc_run_materials`只允许合同列出的Reservation转换；Accepted/Rejected consume均从
terminal Owner rows重建并使用同一原子性、Evidence与幂等纪律。不新增Domain、Owner、Store、Handoff、Capability或表。

`PBF-11-R3`固定Handoff A Accepted Control revision set的成员、排序、JCS公式、Payload/Commit Handle绑定及
historical Control reconstruction；保持112项Capability、97个Catalog Result family、169张关系表和15表事务边界不变。

`PBF-12`闭合Libra Routing、Decision Basis与Acceptance Spec的typed input/output、唯一ID/digest、revision/head CAS、
Subject Field/profile provenance、Product Scope、Arca只读Projection freshness及三项canonical transaction。它不新增
Domain、Owner、Store、Handoff、Capability或关系表；保持112项Capability、97个Catalog Result family和169张表，
Canonical Transaction由35项增至38项。

`PBF-12-R1`把pre-CAS `SubjectDecisionHeadSnapshot@1`补入既有Decision Basis input relation，并在Basis row/result
冻结expected revision与snapshot digest；历史Input Set可只由Libra Owner rows重建。它不改变Domain、Owner、Store、
Handoff、Capability、Result family、表或Canonical Transaction计数。

`PBF-13`闭合Libra生产后半链的Run Admission/Lifecycle、immutable Production Material与N:M Episode scope、
Workspace admission/reference、完整On-deck Product Package、Discard/Cleanup及Off-load Completion Reclaimer连续性。
新增七张Libra-owned关系表和五项Canonical Transaction；当前合同为112 Capability、97 Catalog Result family、
176 tables、43 Canonical Transactions，未新增Domain、Owner、Store、Handoff、Capability或用户业务决策。

## 3. Current phase

| Field | Current value |
| --- | --- |
| Phase | P13 — Operational cutover and E2E-ready package |
| Detailed packet | `implementation/CURRENT_PHASE.md` |
| Status | P13 complete；final Implementation Contract Baseline and E2E-ready package frozen |
| Implementation baseline | P13 implementation closure `bd75e7e4`；product surface `23e3b930` |
| Phase branch/worktree | `codex/helix-p9` / `E:\my_project\emby_third_party-helix-p9` |
| Allowed now | 本实施线程停止；不得进入P14、E2E或部署 |
| Next action | 独立P14资格验收任务消费冻结package；需用户单独授权 |

## 4. Master roadmap

| Phase | Outcome | Dependencies | Exit Gate summary |
| --- | --- | --- | --- |
| P0 Audit and disposition | `4a16f0a9`差距、旧模块处置、风险和clean-cut方向 | Level 0–10 accepted | **complete**；Evidence已冻结 |
| P1 Clean skeleton and guards | 固定`src/helix/`、public/internal边界、唯一Root shell、机器架构门禁和manifest框架 | P0；Local Implementation Gate | **complete**；Exit Audit PASS；Evidence frozen |
| P2 Contract and schema baseline | 112 Capability、96 Result、161 table合同与digest | P1 | **complete**；latest SSOT rematerialized 112/96/161/26；baseline gate PASS |
| P3 Persistence and atomic foundation | 唯一Kernel、scoped UoW、Control、Commit Marker、Outbox/Inbox、Audit | P2 | **complete**；26 canonical transactions；baseline gate PASS |
| P4 Execution and recovery foundation | Work/Plan/Event/Effect、Progress、Control Plane、Resource、Retry/Timeout/Circuit、startup recovery | P3 | **complete**；7 Effect Classes / 31 crash scenarios；Exit Audit PASS |
| P5 Platform and integrations | Secret/Mount/Workspace/Artifact/Resource/Worker及typed Provider/FFmpeg/file libraries | P3–P4 ports | **complete**；10 fixture families / 31 recovery scenarios；Exit Audit PASS |
| P6 Horizontal domains | Perception和People独立Store/Facade/Process/Projection | P3–P5 | **complete**；Exit Audit PASS；两域Owner与cross-domain边界闭合 |
| P7 Procurement | Material Field、Observation、Region、Triage、Candidate Package | P3–P5 | **complete**；Exit Audit PASS；15表/8 Capability与Candidate原子性闭合 |
| P8 Handoff A and Libra front half | Handoff A、FA-04 continuity、Subject、Decision、Routing、Acceptance Spec | P6–P7 | **complete**；原子连续性和Exit Audit PASS |
| P9 Libra production and delivery | Run、Workspace、Product、Conformance、On-deck Package、Discard/Cleanup/Reclaimer | P4–P5、P8 | **complete**；baseline frozen |
| P10 Handoff B and On-deck | Shelf/Standard/Placement、Acceptance、Custody、Off-load、Inventory、Shelf Entry、Deck | P5、P9 | **complete**；Exit Audit PASS |
| P11 Arca post-deck | Aftercare、Off-deck、Shelf Deregistration | P10 | **complete**；baseline frozen |
| P12 Product surface | Projection/Activity、Facade、113 Admin route、Session/Auth、九页Admin Web | P6–P11 | **complete**；114 route、18 surface、build/tests PASS |
| P13 Operational cutover and E2E-ready package | clean init/backup/restore/Safety、readiness；Root/API/UI一次切换；旧路径退役；冻结独立E2E任务可直接消费的版本化交付包 | P2–P12 | **complete**；local gates PASS；package frozen |

P1–P13是本线程的完整逻辑实施Phase，不是版本名或自动部署节点。P13 Exit Audit PASS且E2E-ready package冻结后，
本线程的Helix开发任务即完成。

## 5. Hard dependency invariants

~~~text
P1 package/guards
  → P2 contracts/schema
  → P3 atomic persistence
  → P4 execution/recovery
  → P5 platform/integration substrate
  → P6/P7 horizontal domains and Procurement
  → P8/P9 Handoff A and Libra
  → P10/P11 Handoff B, Arca and post-deck
  → P12 Projection/API/Admin Web
  → P13 operational cutover and E2E-ready package
~~~

禁止以以下方式缩短依赖链：

- 新Procurement接旧Membership；
- 新Libra写旧`media_items`或Kairox Store；
- 新Event Runtime驱动旧executor；
- 新Admin Web调用旧Task/Library route；
- clean database回退旧Service；
- 先做Material副作用、后补Control/Effect recovery。

## 6. Phase planning and transition

- 任意时刻只有`implementation/CURRENT_PHASE.md`一份活动详细执行包；
- 只细化当前Phase，后续Phase维持Outcome/Dependency/Exit Gate级别；
- 当前Phase全部Work Package满足Done并通过独立Exit Audit后，执行包移动到`implementation/archive/`；
- Evidence冻结并由`CURRENT_STATUS.md`链接后，才细化下一Phase；
- Phase完成不自动打开下一类环境授权；
- blocking架构缺口返回Design，不以兼容层、temporary Store或silent fallback解决。

详细Ready/Done、Review、Reuse、Git/worktree和停线规则见`ENGINEERING_PLAYBOOK.md`。

## 7. Authorization boundaries

用户已授予P2–P13第1层`Local implementation` standing authorization。每个Phase在SSOT traceability、机器反例和
Exit Audit全部PASS后可以自动归档并进入下一Phase，不需要逐Phase等待：

1. Local implementation：本地代码、单元/合同/隔离fixture；
2. Real-source E2E：明确来源和副作用范围；
3. Build/Canary：明确Artifact和环境；
4. Production：明确发布/部署/升级动作。

Standing authorization不授权下一层。E2E、Docker/Canary、NAS、生产和真实媒体副作用保持暂停，
`media-desktop`保持排除。

## 8. Post-program independent tasks

P13之后的外部验证与发布工作不属于本Helix实施Program，也不作为本线程完成条件：

1. **Independent E2E qualification task**：从P13冻结的E2E-ready package开始，按单独授权执行真实来源、真实媒体副作用、
   Windows/Linux/Docker及必要的Canary验证；发现实现缺陷时形成可复现Problem Report并返回对应开发范围修复，发现SSOT冲突时
   返回Architecture Agent；不得在验收任务加入兼容层或旧Runtime fallback。
2. **Independent deployment task**：只消费已经通过独立E2E验收的精确Artifact，按单独生产授权完成镜像身份、SHA256、dry run、
   NAS部署、health/readiness与发布观察；不得把部署修补反向变成业务架构或运行时兼容路径。

两项任务必须使用P13冻结的commit、package manifest和digest建立可追溯交接。E2E验收任务与部署任务彼此独立；部署任务不得在
缺少对应E2E PASS Evidence时开始。

## 9. Business decision handling

只有改变用户真实意图、可见业务结果、不可逆Authorization、Business Domain/Owner/Handoff或Object continuity的
问题才提交用户。包结构、代码组织、测试工具、manifest格式、SQL实现和性能优化由工程内部在SSOT边界内决定。

当前没有open business decision。工程问题由Codex自主处理；只有真实业务决策或SSOT冲突才向用户提问。
