# ShelfDeck Clean Helix Current Status

Status: **PROD-064 生产恢复进行中；ShelfDeck 已停服，禁止在物理媒体与 Arca 事实完全核验前启动。**

## PROD-064 Aftercare Placement Incident Recovery

- PROD-063 部署后追加的物理核查推翻了“无需数据纠正”的结论：Shelf Placement revision 2 只有
  `collisionPolicy: reject → suffix` 变化，却让 Aftercare 使用可变 Presentation title/year 重新计算既有接受路径。
  19 次 Placement 尝试中，10 条错误 Inventory revision 已 Commit，另 3 条已发生物理写入但 DB Commit 失败；
  影响精确冻结为 13 个 Shelf Entry。正常 On-deck 的《守望者》《角斗士2》《超脱》不在事故范围。
- 生产服务已于 2026-09-03 停止。停服后完整备份位于
  `/vol1/1000/docker/shelfdeck/backups/aftercare-incident-20260903T175159+0800`；数据库 `quick_check=ok`，
  foreign key violations 为 0。备份保留 data、compose、secret 与 SHA256SUMS；未修改 `/vol1/docker`。
- 物理闭包已只读核实：9 条完整错误目录需要恢复带年份路径；《银翼杀手：2022黑暗浩劫》恢复原有冒号路径；
  《最后的前线》《长空之王》《2001太空漫游》保留已完整的原路径。4 个仅含事故生成副本的目录进入同文件系统
  quarantine，不删除；《最后的前线》原目录中的 torrent 与未纳管字幕保持原位不动。
- 通用修复把 Placement policy 分为 layout 字段与 collision 字段：只有模板、Shelf root 或 endpoint 变化才允许
  重算路径；collision-only revision 保持已接受 Inventory，缺失历史 Placement baseline 时 fail closed 为
  `attention_required`。64 条 blast-radius fixture 与 13 条恢复 fixture 已通过；Service full 446 项为
  428 pass、18 skip、0 fail。
- 一次性恢复只能通过 `helix-prod064-aftercare-placement-incident-correction.js`：操作员集合必须与 13 条白名单
  精确相等；所有源、目标、quarantine 文件先做 bounded fingerprint/NFO semantic fence；物理 rename 写可逆
  journal，DB 事务只追加 Inventory revision 并按实际 Physical Material Identity 调整 Material Control。
  Deck Fact 与历史 `arca_material_bindings` 不变。任何失败均回滚物理 journal 并保持服务离线。
- 当前尚未执行 PROD-064 apply、镜像部署或生产重启；下述 PROD-063 “无直接数据修订/已稳定”只代表当时的
  观测窗口，已被本节事故证据取代，不能再作为当前生产结论。

Last updated: 2026-09-03

## PROD-063 Deployed And Observed

- Shelf Placement Policy revision 2 触发批量 Aftercare 重评后，生产一度出现 18 条 active Arca Attempt、48 条 open Event；其中 3 个 `arca.inventory.placement.switch@1` Effect 因错误目标持续处于 `reconcile_required`，Runtime 每 30 秒重复同一 `CLEAN_ARCA_TARGET_OCCUPIED`。Node 约占一个 CPU core，`/` 响应达到约 3.8–5.3 秒，形成真实 Aftercare storm。
- 根因一是 Aftercare Placement 只读 `product_metadata` 的非正式 title/year 字段，忽略已 Commit 的 `resolved_identity.displayIdentity` 以及 `year_or_release_date|release_date`，错误地把带年份的正式 Inventory 目录判为应迁往无年份目录。现优先使用 accepted display identity，并在任何目标变更前一次性 preflight 全部目标，后续成员冲突不能再留下部分迁移。
- 根因二是确定性 Placement/Settlement 前置拒绝从非纯 Capability 抛出后被误判为不确定副作用，进入无限 Effect recovery。现在只把尚未发生物理 mutation 的精确前置拒绝返回为 `retryDirective=never` 的 typed failed Outcome；未知 I/O 或已经开始删除后的失败仍保持 reconcile。旧目录存在未纳管文件时仍拒绝删除，但只失败一次。
- 同一物理材料仅变更 Binding 位置时，Aftercare Inventory 不再同时生成 acquire/release Control；只有同 material key 但 Physical Identity 不同的真实冲突继续 fail closed。没有影片 ID、路径特例、迁移或旧记录兼容代码。
- 本地验证：Aftercare focused 51/51；Service full 444 项为 426 pass、18 skip、0 fail；Helix Architecture 210 fixtures、dependency、semantic、manifest 与 113/99/186/44 contracts 全部 PASS。最终镜像 `markmahoro/shelfdeck:helix-beta-20260903-d8d25a95aa`，source commit `d8d25a95aa`（包含前置修复 `b87301717d`），image ID `sha256:acd91820ee98486cead34b5e8c644ac649296b27ec2ef4931043f4d1a9f6422e`，tar SHA-256 `52907064a51ea297ee3068ce27c802d450beca773654a58ed4b3516490f000b1`。标准 build/upload/checksum/dry-run/apply、readiness、health、Admin Web、mount 与 exact image 均通过；restart count 0，未执行 Formation Reset 或直接数据修订。
- 生产观察跨过完整 recovery cadence 后保持 0 active Aftercare Case、0 active Arca Work、0 `reconcile_required` Effect，最终镜像启动后 0 failed Attempt、日志无 runtime error，SQLite `integrity_check=ok`。health 实测约 0.01–0.16 秒，首页约 0.01–0.03 秒；容器高 CPU 主要来自《落水狗 (1992)》约 288% 的 QSV 转码，不再是 Aftercare。既有未纳管 torrent/字幕目录未被删除，对应 Case 已稳定为 unresolved attention。

## PROD-062 Deployed And Observed

- 《角斗士2 (2024)》的 Product Package 同时包含 `background.jpg` 与 `backdrop.jpg` 两张不同内容的 fanart；Placement Policy revision 1 的 `fanart{ext}` + `reject` 把两者映射为同一目标并正确拒绝。通过正式 Shelf preview/publish API 将 collision policy 更新为 `suffix`、形成 revision 2；目标目录和 mount 不变，preview 为 `physicalEffect=none`。没有直接编辑 SQLite，也没有丢弃任一 exclusively-related material。
- Admin Web 的 Arca acceptance retry 现发送唯一 idempotency key，符合 mutation adapter 合同。重试后同一 On-deck Package 通过第二次验收，最终文件使用稳定名称 `fanart-0183d731.jpg` 与 `fanart-5438dfba.jpg`。
- Placement revision 触发既有 Shelf Entry Aftercare 重评时暴露两个通用执行缺口：Aftercare placement final verify 读取 Stage Result 却未声明 Stage success dependency，导致 `P4_PLAN_RESULT_BINDING_DEPENDENCY_REQUIRED`；恢复中的 executor incident circuit 阻断队首 Event 时未让出 scheduling round，持续饿死健康 peer。现分别补齐直接依赖，并让 `circuit_wait` 与 `resource_wait` 一样获得每轮一次机会，未改变 Owner、Handoff 或业务决策。
- 验证：Aftercare focused 120/120、P4 Foundation full 234/234、Admin Web 42/42 与 production build PASS。最终镜像 `markmahoro/shelfdeck:helix-beta-20260903-245cb92336`，source commit `245cb92336`，image ID `sha256:abf23b4340021df5396d85e1c225d7470ecbe4d91a37d9a75804e7605c2ad652`，tar SHA-256 `514bf2b83a8bcf58963200fe394eaa62b37e217426a9f3f57a2558ed89229a9b`。标准 build/upload/SHA-256/dry-run/apply、readiness（186 tables、123 routes、17 UI surfaces、0 findings）、health、Admin Web、mount 与 exact image 均通过，restart count 0；未执行 Formation Reset。
- 生产结果：《角斗士2》7 个最终 Inventory member、7 个 settlement、Fulfillment 与 On-deck Commit 全部成功；Shelf Entry `0ac9b83b4af863b20faba87839f5c3524a06cac93952fa6382e4f45e6618b0d2` 为 active，Formation active 查询不再返回该片。两张 fanart 均在 Inventory；目录中 3 张不属于本次 Product Package 的既有图片保持原样。部署后未再出现 Plan dependency 或 execution runtime error。

## PROD-061 Deployed And Observed

- 根因不是用户决定未提交：`defect_admitted` 已先把 Libra Run 从 frozen revision 3 推进到 active revision 4，但同步后继 Product Staging 仍一律拒绝 `verification.result=failed`，因而无法消费同一 Run 已精确授权的唯一 `max_size_exceeded` Workspace 产物；Admin API 最终返回 500，前端把后继失败误呈现为整次“接受瑕疵”失败。
- `WorkspaceProductVerificationSnapshot` 现在只允许 exact `AuthorizedDefectManifest` 绑定的 size-only failed media 进入 Product Staging；Run、Work、Verification、Workspace/Material Handle、digest 与 fence 必须逐项一致，普通 passed media 禁止携带该 Manifest。没有伪造 passed、没有影片特例或旧条目兼容路径。
- Admin Web 在 POST 异常时会重新读取 exact Formation；若 Run 已由 frozen 推进到更高 active revision，就关闭对话框并明确显示“瑕疵已接受，系统正在继续整理”，而不再要求用户反复点击。若状态未提交，仍保留真实错误。
- focused 回归 49/49，后续部署核验 21/21，Admin Web production build 与 Helix Architecture full gate PASS；contract aggregate 为 `58416d551dfbfcc742c3f4a5a4ac6437296f5a517b1367f20ab4733917cdb696`。Service full 443 项为 424 pass、18 skip、1 个既有 FFmpeg stall-watchdog 并发时序超时；该用例隔离重跑 1/1 PASS。
- 当前镜像 `markmahoro/shelfdeck:helix-beta-20260903-e1b0b7993d`，source commit `e1b0b7993d`，image ID `sha256:3cb5fc956700c9e03c5551dd22d2d35ee029d9219602b7f9864b9d1329600e0a`，tar SHA-256 `8bdb89929897a8c1109d1c906c25c25698592aba741cf1521bf01bd03041fc53`。标准 build/upload/SHA-256/dry-run/apply、readiness（186 tables、123 routes、17 UI surfaces、0 findings）、health、Admin Web、mount 与 exact running image 检查均通过；restart count 0，未执行 Formation Reset 或数据清理。
- 使用原 idempotency key 继续已提交的决定后，《守望者 (2009)》Libra Run 已 completed，Arca On-deck Run 已 committed 并产生 Shelf Entry。《角斗士2 (2024)》也已越过本次 Product Staging 缺口并发布 Handoff B；当前独立阻断为 Arca `CLEAN_ARCA_TARGET_COLLISION`：包内 `background.jpg` 与 `backdrop.jpg` 均为 fanart，而 Shelf Placement Policy revision 1 的固定 `fanart{ext}` + `reject` 会把两者映射到同一 `fanart.jpg`。该结果属于 Placement Policy 的真实拒绝，不再冒充接受瑕疵失败。

## PROD-059 Deployed And Observed

- 五星高质量音轨判定已统一为检查 Primary Video 容器内全部 Probe Audio Stream；`default disposition`、音轨顺序与语言不参与 Libra 原片寻源、Libra 成品验收或 Arca 独立验收，也不会只为设置 default 触发 Remux。007 当前下载成品中的非 default TrueHD 因此会被新链路正确识别。
- `size_cap_requires_admission` 只接受 `libra.product_media.verify@1` 的唯一实测 Gap `max_size_exceeded`；任何附加 Gap 继续 fail closed。守望者与角斗士2的既有活动 Run 在部署后均已收敛为 `frozen`，前端/API显示“需要处理”，并各自生成唯一 `size_cap_exceeded` 瑕疵接纳候选；0 active Attempt、无重复终态错误。
- 验证：focused 58/58；Service full 442项为424 pass、18 skip、0 fail。镜像 `markmahoro/shelfdeck:helix-beta-20260903-c77cd99951`，source commit `c77cd99951`，tar SHA-256 `4cda788a8dfcdd5d3c93d4355c4365210bac4db52d03c46bc8fd16a25ad27081`。标准 build/upload/SHA-256/deploy dry-run/apply、readiness（186 tables、123 routes、17 UI surfaces、0 findings）、health、Admin Web、mount与运行镜像检查均通过。
- 007 的旧 Run 已在旧逻辑下终态冻结；部署不兼容或复活旧条目。生产 Formation Reset 只读 plan 为 ready、0 blocker、0 active Work/Attempt，但会同时删除007、守望者、角斗士2共3个Subject/Run/Workspace、46个Work和6个Artifact，因此当前不建议全局Reset；若只要求007重新形成，应另行授权对该Run执行正式“放弃整理”。本次部署没有执行任何数据纠正。

## PROD-056/057/058 Deployed And Reset

- 007暴露的候选身份缺口已修复：MoviePilot明确TMDB冲突仍fail closed；缺TMDB但有结构化片名时要求片名与年份精确一致；结构化片名也缺失时，只接受发布名开头的精确片名段、独立年份和正做种同时成立。下载任务恢复接受“精确torrent标题+大小”或“精确torrent标题+TMDB ID”，不接受两项补强都缺失的记录；唯一Job持续零速30分钟即终态失败，不改选其他资源。
- 守望者暴露的制作策略缺口已修复：新`LibraMediaPlanningPolicy@1` revision 3保存源视频码率与有效质量保护下限；低码率源不被向Policy floor灌大。实际成品仅剩体积Gap时，若下一目标低于有效floor，就保留首次成功、画质更好的超限成品，立即freeze并offer`size_cap_exceeded`；不会继续strict ABR/CPU，也不会因体积Gap寻源。
- `size_cap_exceeded`授权现在精确绑定source Work、Product Media Verification digest、Candidate Basis、Workspace Media Handle与Material Handle/Fence；Staging、Delivery、Conformance和页面体积摘要都只能消费这一份精确产物，不再扫描“最新”超限输出。
- 007新Run已证明TMDB/title/year修复生效并建立唯一Job，但Provider rank 2的`beAst`只有1个共享者，持续`0% / 0.0B`约30分钟后以`job_stalled`冻结；同次搜索中rank 3的`WiKi`有28个共享者。根因是既有SSOT把所有正共享者压成相同`available`并按Provider rank初选，而single-source禁止失败后改选。PROD-058现冻结共享者数量并按`seederCount DESC, Provider rank, Candidate ID`选择唯一合规候选，同时让Formation公开真实下载百分比、字节速度与ETA，零速明确显示“等待下载数据”。
- 验证：focused 87/87；Service full 442项为424 pass、18 skip、0 fail；Admin Web production build与Helix Architecture full gate均通过，contract aggregate为`064eb00c4145950de3ebfcb686aef9ba3c8d3d40e4d47c3394159dd910cc4327`。
- 最终镜像为`markmahoro/shelfdeck:helix-beta-20260903-d0bed9af57`，source commit `d0bed9af57`，tar SHA-256 `c05652ef789332a8d7065bb685191b54517d781a25df210590ccce2a51685625`。标准build/upload/deploy dry-run/apply、readiness（186 tables、123 routes、17 UI surfaces、0 findings）、health、Admin Web、mount与运行镜像检查均通过。
- 获授权 Formation Reset 删除3个Subject、3个Run、3个Workspace、44个Work和6个Artifact，重开4个Delivery/Reservation并恢复3个Procurement Control；备份为`/vol1/1000/docker/shelfdeck/backups/formation-reset-20260902T183233Z/data`，manifest digest为`1f6012b784a2c711dafbee79f2032b071d3df29ca06a04643814dc10097f06ca`。独立verifier、SQLite integrity、外键和幂等二次plan均通过，二次plan所有可变reset计数为0。
- Reset后3个自然Formation均为`in_progress`且0 attention：007从合规集合选中共享者数28、Provider rank 3的唯一候选，只建立MoviePilot Job `a5cff5d562944dc94576b038009b8f5b71882731`，没有候选fallback；生产列表和详情卡片均已显示下载百分比及“等待下载数据”。守望者以revision 3首次QSV策略继续转码；角斗士2正常等待媒体资源。监测时仅3个Libra活动Attempt、0个Arca活动Work，容器restart count 0，日志未出现新错误。

## PROD-055 Formation Reset And Isolated Degraded Startup Deployed

- 获授权的唯一 Formation Reset 已离线完成。完整 data 备份位于 `/vol1/1000/docker/shelfdeck/backups/formation-reset-20260902T113345Z/data`；删除 3 个未 Commit Subject、3 个 Run、3 个 Workspace 与 55 个 Work，重开 4 个 Delivery/Reservation，恢复 3 个 Procurement Control。冻结 manifest digest 为 `9f36f22a9b4fa8b8ccb525f7e81a708fd5340cd70e23bee257731a693d66e88e`；独立 verifier、`integrity_check=ok`、外键检查和离线二次 plan 均通过，二次 plan 的可变 reset 计数及 blocker 均为 0。
- Reset 后首次启动被一个既有 exact-scope Circuit 拒绝：`owner/arca/arca_shelf_entry/care_workspace_reclaim` 已因 3 条终态失败 Work 达到阈值并记录 `RECOVERY_EXECUTION_BUDGET_EXHAUSTED`。该 Circuit 与 Incident 是真实故障隔离证据，且对应 committed Shelf Entry 的 Aftercare Work 仍存在，不属于 On-deck Commit 前 Reset 图；因此没有把它伪装成脏数据删除。
- 根因是 Startup Recovery 已正确把非全局 Circuit 分类为 `degraded`，却仍令 `normalSupplyAllowed=false`，Execution Host 因而在任何 exact-scope recovery Work 获得验证机会前全局退出。这与 SSOT 10.1.1“degraded 只隔离受影响 scope”冲突。修复后仅 `ready|degraded` 允许 Host 启动；全局 Circuit、完整性或其他 hard finding 仍 fail closed，具体 Event 继续由 exact Circuit/Incident gate 隔离并由同路径成功证据关闭。
- 验证：Startup Recovery/Runtime Host/Formation Reset focused 72/72；Service full 441 项为 423 pass、18 skip、0 fail。镜像 `markmahoro/shelfdeck:helix-beta-20260902-0d94f414ac` 由 source commit `0d94f414ac` 构建，tar 本地/远端 SHA-256 均为 `8e8224458f2f2de322befcd6f1cff9507650c9ed33d2aaa9dac842811a842d4b`；标准 deploy dry-run/apply、readiness、Admin Web、mount 与镜像校验全部通过。
- 部署后 health 为 `ok`、`normalSupplyAllowed:true`，容器 restart count 0，日志只有正常 listening。Reset 后自然链路已形成新 Formation：《第八个嫌疑人 (2023)》完成 Libra→Arca Commit；《守望者 (2009)》正在 QSV GPU 转码；《007：大破天幕杀机 (2012)》搜索 18 个 Candidate、《大风杀 (2025)》搜索 6 个 Candidate，均因可用且合规集合为空而冻结为“没有取得源”，未下载其他候选，符合 single-source 合同。

## PROD-054 Arca Aftercare Recovery Convergence Deployed

- 生产只读证据显示 3 条 `arca.aftercare.workspace.reclaim@1` Event Attempt 使用已耗尽的 durable recovery budget，约每 30 秒重复同一 `P4_EXECUTION_TIMEOUT`。对应 Workspace Material 的 size/fingerprint 相同但 inode 已漂移，因此现行 exact Handle 合同正确拒绝清理；本项不放宽 Handle，也不直接修改 Arca 数据或文件。
- 根因是 dispatch 前 timeout 没有转为终态，并且 Execution Host 在 recovery 抛错后继续缓存旧 reality classification。修复只在最新分类仍为非纯 `safe_retry` 且 durable deadline 已于 dispatch 前耗尽时，以 `RECOVERY_EXECUTION_BUDGET_EXHAUSTED` 终态失败；`continue_forward` 与 dispatch 后不确定状态继续 fail closed。带 Effect 的 recovery 抛错后，Host 下一轮必须重新调用 exact reality reconciler。
- 验证：Event Runtime/Host focused 68/68；Service full 441 项为 423 pass、18 skip、0 fail。修复已随 `markmahoro/shelfdeck:helix-beta-20260902-efe1b91d6e` 无损部署；readiness 为 186 tables、123 routes、17 UI surfaces、0 findings，health、Admin Web、全部 mount 与镜像校验通过，restart count 为 0。
- 生产中原 3 条重复超时的 Arca Work/Event/Attempt/Effect 已分别收口为 `failed/failed/completed/failed`，统一错误码 `RECOVERY_EXECUTION_BUDGET_EXHAUSTED`；多个 recovery cadence 未再出现 `P4_EXECUTION_TIMEOUT`。3 份 inode 漂移的 NFO 文件仍存在且 size 与记录一致，未被误删。
- 部署后唯一 Formation Reset dry-run 仍为 ready、0 blocker，命中 3 个 disposable Subject、3 个 Run、3 个 Workspace、55 个 Work、1 个 active Work/Attempt、3 个 Control 与 6 个 Artifact。当前活动项为《守望者 (2009)》第三次 GPU 转码，诊断时进度 57.3%；apply 会中断它，因此本次未执行 Reset，等待 Product Owner 明确授权。

## PROD-053 Single-source External Acquisition Deployed

- Product Owner 已确认 External Acquisition 的最终业务结果只有“取得一个源”或“没有取得源”。Libra 可保留一次搜索的 bounded Candidate Evidence，但只从 `available + compliant` 集合按 `seederCount DESC, Provider rank, Candidate ID` 选择唯一首项；`unknown`、明确不合规、无共享者或共享者证据缺失均不得下载。选定后终态失败不得改试其他候选。
- 每个 Formation 只建立一组 Search/Acquire/Import Work 和最多一份 Acquire Request/External Job Receipt。同一 Provider Job 的幂等恢复与重复 Observation 保留；下载、transfer、Landing、imported bytes 或 real-media verification 的终态失败直接结束本次 acquisition，不再搜索、选择或下载 B/C 候选。
- MoviePilot 候选 identity 现只由稳定的站点、标题、大小和 locator 形成，seeder 与相对时间等动态字段不会改变引用；真正 POST 前重新搜索并核对 exact candidate identity、TMDB anchor、正 seeder 与仍然符合 frozen media requirement。零进度或 Provider 明确 stalled 达到 30 分钟后返回 `job_stalled`，transfer 失败区分 `transfer_failed|transfer_target_conflict`，不再无限 pending。
- Release grammar 已补齐 NFKC、`TrueHD5.1`、空格/点/连字符分隔的 `H 265|x265`；普通 `DDP/EAC3` 映射为已知 `other`，因此在当前 TrueHD 类要求下是明确 `primary_audio_unmet`，不再被当作 unknown 下载探测。
- `maxDownloadAttempts`、attempt ordinal、unverified selection 与 next-candidate fallback 已从 SSOT、派生 contracts、Libra Planner/Coordinator、Platform settings、Admin API/UI 全链删除。既有 Integration 配置读取只投影当前空 settings；新写入仍执行 closed-shape 校验。
- 验证：external focused 95/95；Provider protocol/H1 28/28；Service full 441 项为 423 pass、18 skip、0 fail；Admin Web 42/42 与 production build 通过；P5 Platform gate PASS。Architecture 210 个 fixture、semantic、manifest、113/99/186/44 contracts 全部 PASS，contract aggregate 为 `eca68576dc2661a885fd039b288536b4dd0cf4818d516a53c775909141c240e2`；总 gate 仍只受两个未改文件的 18 个既有 dynamic-template scanner findings 阻断。
- 生产镜像 `markmahoro/shelfdeck:helix-beta-20260902-713bbc0827` 已按标准流程 build、upload、SHA-256 校验、deploy dry-run 与 apply，无 `--helix-clean-init`。readiness 为 186 tables、123 routes、17 UI surfaces、0 findings；health、Admin Web、媒体/Workspace/成人库/QSV mount、运行镜像校验均通过，restart count 为 0。
- 部署后 Formation Reset 只读 plan 命中 3 个 disposable Subject、3 个 actionable Run、3 个 Workspace、55 个 Work、1 个 active Work/Attempt、3 个 Control 与 6 个 Artifact；0 orphan token、0 phantom Receipt、0 blocker。活动 Work 是旧链上的第三次转码选择，历史运行还包含旧的多次 Search/Acquire Work，因此不能用新单一来源语义继续解释。
- 结论是建议执行唯一 Formation Reset，让这 3 条未 Commit Formation 从干净 Intake 重新形成；本次只完成 dry-run 判断，尚未 apply。Reset 会中断当前 1 条转码并物理删除这 3 条未 Commit 过程，仍需 Product Owner 对本次生产 Reset 明确授权。

## Local implementation completed

- 已确认 SSOT 边界：Procurement 继续生成 Candidate Package；Field 席位满或为0时，open Handoff A Offer、责任和 Control 留在 Procurement。
- Field API 已改为 generated/accepted/waiting/rejected；Formation 当前业务分类已收敛为 in_progress/attention_required/completed；Admin Web 已删除“待整理”筛选并把文件来源页重排为 Procurement 交接账本与 Libra 席位。
- 旧四态 Formation 表升级时只重建可派生 Projection，不改 Subject、Token、Handoff、Run 或其他 Owner 事实；本地目标 DDL digest 为 `6a2246c39bebcd1f6f80264bac793c7a3119636a791683e426e4c30aa6fdc651`。
- 最终合并验证：Service 412 项为 394 pass、18 skip、0 fail；Admin Web 42/42 且 production build 通过；NFO/Catalog focused 66/66。Architecture fixture、semantic、manifest、contract 均通过，contract aggregate 为 `ab70c205efa3f8d8dd399d352690497918e3489ae9118bf067ea58b281accf75`；总 gate 仍仅被未改动的 `formation-process-projection.js` 与 `progress-projection-reader.js` 18 个既有 dynamic-template scanner findings 阻断。Service production dependencies 与 Admin Web 全依赖经 npm 官方 registry 审计均为 0 vulnerability。
- 文件来源/Formation 新语义、Formation 详情排版、我的收藏成品库一级页、PROD-042、NFO 与 Catalog 修复均已合并并随当前统一镜像部署。
- 生产所谓“600 多个假死 Libra Run”实际以 621 个 Accepted 但无 token 的历史 Subject 为主；生产现有真实 `libra_runs` 仅 101 个，其中此前 dry-run 识别 2 个 actionable Run。它们不获得兼容权利。
- Formation Reset 已修复 Control scope：Procurement-owned Control 保留；Libra `subject|on_deck_package` 与 Arca custody Control 属于可清理范围；Nuclear 只回卷 Formation Control revision 后缀并恢复 Procurement 边界。
- 首次生产 Nuclear apply 在事务提交前由 `foreign_key_check` 阻断并完整回滚：2 条受保护的已 Commit Run 仍以 `supersedes_run_id` 指向待删除旧 Run。Nuclear 现同步清空保留 Run 上指向被删除 Run 的 supersession pointer；回归覆盖保护 Run、Shelf Entry 与 Commit Receipt继续保留。
- 修正后的生产 Nuclear Reset 已完成：删除 716 个未 Commit Subject、101 个 Libra Run 和 3,275 个过程 Work；保留 10 条已 Commit 责任链、全部 Procurement 事实与 `/media`。事务后 Accepted/no-token Subject、active/no-admission-head Run 和孤儿引用均为 0；随后新 Observation/Intake 只按正常链路自然形成新条目。
- 两种 Reset 均报告并清零 Accepted/no-token Subject 与 active/no-admission-head Run；Normal 可建立一次 reset-only Admission Head 后正式 discard，Nuclear 删除整个未 Commit 图。Service 411 项为 393 pass、18 skip、0 fail；Admin Web 42/42 且 production build 通过。Architecture fixture、semantic、manifest、contract 均通过，总 gate 仍仅受 18 个既有 dynamic-template scanner findings 阻断。
- PROD-049 已部署并生产验收：Plan 全终态不再代替 Handoff A、Handoff B Accepted/Libra Run completed 与 On-deck Commit 三段正式业务边界；Result 采用封闭中文映射，结构化 Product Identity 显示标题与年份，未知对象/内部枚举不再进入用户界面。生产《赤焰战场2》详情为材料准备 completed、媒体整理 running、验收与上架 pending，身份结果为“赤焰战场2（2013）”，全文无 `[object Object]`。
- PROD-050 已部署并完成获授权的一次性 Nuclear 数据纠正：重新打开 exact Delivery/Reservation、删除 exact Offer 跨域 dedup 闭包，并回卷目标 Control revision 后缀；不放宽 Runtime 校验、不增加条目兼容或生产 ID 特例。纠正后 3 个自然 token 全部对应 active Subject 与真实 Admission target Work，Handoff A terminal conflict 和 Libra phantom Receipt 均为 0。
- 2026-09-01 Nuclear Reset 的旧 discovery 曾命中并删除 1,255 条 eventless Fact Marker（Routing Decision 717、Acceptance Spec 535、其他 3），当时 postcondition 与二次 dry-run 均为 0。PROD-052 后续证明 postcondition 复用了同一 discovery，无法发现 discovery 本身遗漏的 run-owned Artifact 等残留，因此“Foundation 清理闭包已完成”结论已经撤销；上述数字仅保留为当次执行事实。
- 本轮获授权 Nuclear Reset 删除 3 个未 Commit Subject、1 个 Run、1 个 Workspace、20 个 Work，恢复 3 个 Delivery/Reservation 与 3 个 Procurement Control；保留 10 条已 Commit 收藏链和 `/media`。服务自然 Intake 后，《007：大破天幕杀机》《唐人街探案》均建立了新的 active Run，已越过原先缺失 Routing Decision/Acceptance Spec 的静默重放点；第三个席位由《浪客剑心：京都大火篇》进入。
- 本轮 Reset focused 14/14；Service full 432 项为 414 pass、18 skip、0 fail；Admin Web production build 通过。Architecture fixture、semantic、manifest、contract 通过，总 gate 仍只受未改文件中的 18 个既有 dynamic-template scanner findings 阻断。
- PROD-051 已在本地完成通用在线 Effect 恢复：非纯 Capability 在 intent 后抛出异常时，Event Runtime 将 Effect 持久化为 `reconcile_required`，Execution Host 针对 exact Event/Effect 调用与 Startup Recovery 相同的 reality reconciler，并在独立恢复 lane 中复用原 Event Attempt/Effect 与一次 durable recovery execution budget；恢复收敛前不聚合 Event。同步修复快速失败发生于 Host `draining` 时的 wake 丢失窗口。未增加旧条目兼容或影片特例，尚未部署。
- PROD-051 验证：Event Runtime/Host focused 66/66；全部 P4 Runtime 文件 230/230；Service full 432 项为 414 pass、18 skip、0 fail。`npm run test:helix-runtime` 仍在运行用例前被两个未修改文件的 18 个既有 dynamic-template scanner findings 阻断。

## PROD-051 / PROD-052 Local Implementation Completed

- Product Owner 已确认不再区分 Normal/Nuclear：调试合同收敛为唯一 `Formation Reset`。其目标是物理删除 Intake Accepted 后至 Arca On-deck Commit 前的全部业务与执行过程，使本次整理在运行数据库中视同未发生；Procurement immutable Candidate/Delivery、重新打开的 Handoff A、已 Commit Shelf/Deck 与 `/media` 保留。旧 `normal|nuclear` 名称只作为历史执行记录，不提供兼容入口。
- 《浪客剑心：京都大火篇》的海报取得在 `workspace_write` Effect intent 后遇到 TMDB 网络失败；文件、Artifact Registry 与 Workspace Material 均未形成。PROD-051 已补上通用在线桥接：该异常会进入 exact Effect reality reconciliation，并在 absent 证据下复用同一 Effect 有界重试；这是 Runtime 通用修复，不是影片数据修补。现有生产条目不会被本地代码自动修复，部署与 Formation Reset 另行授权。
- 《007：大破天幕杀机》与《守望者》的 Workspace 中已有海报文件和 `fx_artifact_registry` 行，但缺少原子要求的 `fx_workspace_materials` 行，后续执行以 `CLEAN_WORKSPACE_EFFECT_STATE_CONFLICT` fail closed。
- Nuclear scope 在 `helix-formation-reset.js` 中只按 Package/Workspace owner ID 查 Artifact，遗漏正式使用的 `owner_domain='libra' / owner_scope_type='libra_run' / owner_scope_id=libra_run_id`。生产 Nuclear dry-run 因而报告 `artifacts: 0`，但同一数据库可按活动 Run ID 查到残留 Artifact；这是已证实的直接漏删。
- Reset 把 Subject、Run、Workspace、Package、Offer、Decision 等不同类型 ID 合并为无类型 `allScopeIds`，再据此选择 Work、Marker、Audit、Command Receipt 与 Outbox；该做法既可能漏掉正式关联，也不满足 SSOT 的 domain-local typed identity 约束。
- 已有 committed Subject 上的新未 Commit 链存在第二个 scope 缺口：Pre-deck token 的 `source_process_id` 是当前 Intake process/decision 的正式锚点，但 Reset 只收集 orphan token 的 source process；对保留 Subject，仅删除未 Commit Run，可能留下本次 Intake Decision、Handoff A Receipt、Work 与 dedup 闭包。
- Workspace 目录在数据库事务之前由 `fs.rmSync` 删除。若后续数据库删除失败，SQLite 会回滚而 Workspace 文件不会恢复；NAS 包装器只备份 `data`，不备份 `/transcode`。现有 rollback 测试没有创建目标 Workspace 目录，未覆盖该失败现实。
- `verifyPostconditions()` 重新调用 `inspectPlan()`，没有针对冻结的 pre-reset manifest 做独立反查；scope discovery 漏掉的对象会在验收中再次漏掉。`assertRequiredSchema()` 只声明 29 个表，而脚本实际读取或修改约 82 个业务/Foundation 表，无法在任何文件删除前完整阻断 schema drift。
- discovery 主要从仍存在的 Subject/Run/Workspace/Package 等领域根向下找 Foundation 图；如果前一次 Reset 已删领域根却漏下 Workspace Registry、Artifact、Control、Supporting Work、Command Receipt、Outbox 或 Marker，下一次 Reset 通常没有反向孤儿扫描可再找到它们。`foreign_key_check` 与 `integrity_check` 只能证明已声明 FK 和 SQLite 结构，不能证明这些无 FK typed logical references 已闭合。
- 当前 14/14 Reset focused 仍通过；它们没有 run-owned Artifact、retained Subject 新 Intake、typed ID collision、Workspace 文件回滚或独立 residual verifier 夹具。因此 PASS 只能证明已列举场景，不再作为 Nuclear closure 证据。
- PROD-052 已删除旧 `normal|nuclear` 分支、mode 参数和确认串；唯一 Formation Reset 使用 `FORMATION_RESET_V2`。NAS wrapper 与旧 pre-deck upgrade 入口均已切换到唯一合同，旧 CLI 明确拒绝，不提供兼容入口。
- Reset scope 已改为 domain/type/ID typed manifest；run-owned Artifact、retained Subject 新 Intake/Run、Work/Attempt/Plan/Event/Effect、Result/Marker、Receipt、Outbox/Inbox、Audit、Workspace registry/material 与 Control revision 后缀进入同一冻结闭包。独立 verifier 直接反查冻结 ID 和 typed owner scope，并增加全局反向孤儿扫描，不再调用 `inspectPlan()` 自证。
- Workspace 文件不再在数据库事务前 `rmSync`：先在 `/transcode` 同文件系统原子 rename 到精确 staging 路径；数据库删除、外键、integrity 或独立 residual verifier 任一失败均回滚 SQLite 并 rename 恢复原目录；提交和验收通过后才删除 staging。`/media` 从未挂载给 Reset 容器。
- Formation Reset focused 与 NAS wrapper 共 22/22；Service full 436 项为 418 pass、18 skip、0 fail。新增五个核心负向夹具覆盖 run-owned Artifact、已 Commit Subject 的新未 Commit Intake/Run、数据库失败时 Workspace 保持、typed ID collision 与 verifier 捕获 discovery omission，并补充领域根已消失时对 orphan Work/Workspace/Artifact 的反向清理。未部署、未执行生产 dry-run/apply、未直改 SQLite 或媒体文件；生产旧工具继续暂停使用。
- 2026-09-02 首轮 PROD-052 生产 Reset 后，自然 Intake 暴露反向闭包缺口：Procurement Delivery 已记录旧 Handoff A accepted，但对应 Libra Receipt 已被更早 Reset 删除；新 Intake 为同一 Decision 形成新 Receipt 后，Procurement 因旧 receipt/digest 终态证据拒绝更新并周期性报告 `P8_ACCEPTANCE_TERMINAL_CONFLICT`。这不是影片特例，也不是新 Intake 本身失败。
- Formation Reset 现全局反向发现 Procurement-only accepted/rejected Delivery；仅在 Candidate 物料与任何 Arca Commit 链零重叠时重新打开 Delivery/Reservation、清理精确 dedup 闭包并回卷 Control。命中已 Commit 物料的闭环单独计数并保护。冻结 manifest 与独立 verifier 均包含该边界；NAS health 检查补充 `--retry-all-errors`，避免服务启动瞬间的 connection reset 被误报为 Reset 失败。新增两项正/负夹具后 focused 25/25；Service full 439 项为 421 pass、18 skip、0 fail。
- 首次反向闭包生产 apply 在事务内被 `proc_run_materials.material_key` 唯一约束阻断并完整回滚；备份为 `/vol1/1000/docker/shelfdeck/backups/formation-reset-20260901T193429Z/data`，服务随后恢复健康。只读审计证明 712 个反向残留中有 1 个被当前 active Candidate Reservation 覆盖，另有 13 组双代闭环共享 Material。修正现按 `offered_at_ms + offer_id` 确定每个重叠 Material 集合的最新可重开代，保护被现行 Reservation 或更新闭环取代的旧代；不修改其历史终态、不制造并行 active Reservation。新增两项碰撞夹具后 Reset/NAS focused 27/27。
- 最终生产镜像为 `markmahoro/shelfdeck:helix-beta-20260902-d293c58753`，源提交 `d293c58753babfda1563b5a8534dfaea40fbedce`，镜像 tar SHA-256 `9588d3cc87906c3cb748ba1dca648689f21af7b5ea1d761a9fbf1c48e80e43b1`。readiness 为 186 tables、123 routes、17 UI surfaces、0 findings；Admin Web、媒体/转码/QSV mount、运行镜像与 health 均通过，容器 restart count 为 0。
- 最终获授权 Formation Reset 备份为 `/vol1/1000/docker/shelfdeck/backups/formation-reset-20260901T194339Z/data`。Reset 删除 3 Subject、3 Run、3 Workspace、43 Work、6 Artifact，重新打开 711 Delivery 与 997 Reservation，恢复 15 个 Procurement Control；独立 verifier、`integrity_check`、外键检查和离线二次 plan 均通过，actionable reverse Handoff A closure 为 0，4 个被更新 Reservation 取代的历史闭环保持受保护。
- 服务自然 Intake 后维持 3 个 active Formation，0 `attention_required`；《电锯惊魂 (2004)》已完成新 Libra→Arca On-deck Commit，使 completed 从 6 增至 7；《守望者 (2009)》GPU 转码从 0 推进到 0.4%，《因果报应 (2024)》等待转码资源，《007：大破天幕杀机 (2012)》等待外部服务。Reset 后日志中 `P8_ACCEPTANCE_TERMINAL_CONFLICT` 为 0。
- 生产仍有 3 条 Reset 前已 Commit Arca Aftercare Work 使用过期 deadline，每约 30 秒报告 `P4_EXECUTION_TIMEOUT`；它们不属于 On-deck Commit 前 Formation Reset 边界，且未阻断本轮新 Arca Commit，但当前全局运行不能表述为“完全无异常”。

## PROD-036 Production Monitoring

Field Observation 容量与崩溃恢复已随 `helix-beta-20260831-29efa3a229` 无损部署。生产只读证据已排除先前判断的 terminal Event 聚合窗口：同一 Work 的 Attempt 1–68 及各自 Event 均为 `succeeded`，共写入 `68 × 256 = 17,408` 条 Entry；Attempt 69 与 Event 仍为 `executing`，Effect 只有 intent，没有 Result、commit marker 或第 69 页 header，`runningAttemptWithOnlyTerminalEvents.count=0`。精确故障点位于领域提交前的 Observation executor I/O。冻结的 1 小时 Timeout Policy 此前接到 no-op isolator，只做执行前检查；页内任一 CIFS `stat/open/read` 不 settle 都会无限占住 Attempt。现有证据不能进一步归因到某个具体 syscall。

首次 replacement `helix-beta-20260831-29efa3a229` 运行约 68 分钟后，第 69 个 Event Attempt 仍为 `executing`、Effect 仍为 `intended`，header/Entry 完全不变。代码审计确认两个缺口：cooperative isolator 发送 abort 后仍无限等待不 settle 的 operation；non-pure recovery 抛出的 timeout 被 Host 重新排队并保留原 Attempt。replacement 现仅允许显式 abort-safe 的 Field Observation Executor 在 deadline 后经过 1 秒 settlement grace 硬结束 Runtime 等待，并让 ordinary/recovery 统一写 terminal failed、abandon 未提交 intent。迟到 operation 仍持有已 abort 的 Context，Page commit 前的执行资格门禁会拒绝它。

Recovery deadline 改为使用原 Event Attempt 的 durable `started_at_ms`，所以已超时的生产 Attempt 69 在 replacement 启动时直接收口，不会因重启重新获得一小时预算。该行为没有生产 Work ID 特例或人工数据补丁；通用 terminal Event 聚合保护继续独立保留。

Observation cadence 已由 30 分钟改为 12 小时。`proc_field_observation_entries` 仅保留 7 天，并保护 non-terminal Work、current Field Work、`active|waiting` Run、open Retry 与 current Material exact pointer；每事务最多删除 1,000 行。新库启用 incremental auto-vacuum；旧库使用默认 dry-run、显式 `--apply` 的离线 `VACUUM INTO` 原子替换工具。按生产测得 39.5 MiB/完整轮估算，7 天正常稳态约 553 MiB；30 天 gross churn 约 2.31 GiB，365 天约 28.16 GiB，但窗口外仅活动引用会增加 retained size。

hard-deadline replacement 已随 `helix-beta-20260831-ae7a567cde` 无损部署。启动恢复使用原 Event Attempt 的 durable deadline，旧第 69 页的 Work、Work Attempt、Event、Event Attempt 与 Effect 均已 terminal failed，错误为 `COOPERATIVE_EXECUTION_DEADLINE_EXCEEDED`；页数仍为 68、最大 page ordinal 67、Entries 仍为 17,408，没有 Result、header 或迟到第 69 页提交。现库 275,972 Entry、15 个 Observation Work、7 天以前 0、freelist 0；12 小时实际签发间隔与 7 天 GC 稳态仍需跨时间窗口继续观测。

## Production

- Host：`192.168.12.230:18080`。
- Running image：`markmahoro/shelfdeck:helix-beta-20260903-03ba1191d1`；source commit `03ba1191d1`；tar SHA-256 `4005b6cf9b6546523054ae60c8665e903f16ccd4f31fdf281e2578490f2172fc`。
- Running image ID：`sha256:6aca3373202e154443583d17d0fd63376ebdc2b0e5a5e64bff5dd96c408ce0d0`；2026-09-03 14:43 CST 启动，restart count 0。
- Health：`ok`；generation `helix-clean-v3`；schema 186；`normalSupplyAllowed:true`；SQLite `integrity_check=ok`。
- Compose：`/vol1/1000/docker/shelfdeck`；data：`/vol1/1000/docker/shelfdeck/data`；Workspace mount：`/transcode`。
- PROD-047 离线纠正备份：`/vol1/1000/docker/shelfdeck/data.backup-20260901T082544Z-prod047-aftercare-reclaim`（约 898 MiB）。
- PROD-048 最终 Nuclear Reset 备份：`/vol1/1000/docker/shelfdeck/backups/formation-reset-20260901T092339Z-nuclear/data`。
- PROD-050 Handoff A 边界纠正备份：`/vol1/1000/docker/shelfdeck/backups/formation-reset-20260901T094823Z-nuclear/data`。
- 本轮 Nuclear Reset 备份：`/vol1/1000/docker/shelfdeck/backups/formation-reset-20260901T105240Z-nuclear/data`。
- PROD-055 Formation Reset 备份：`/vol1/1000/docker/shelfdeck/backups/formation-reset-20260902T113345Z/data`。
- PROD-058 Formation Reset 备份：`/vol1/1000/docker/shelfdeck/backups/formation-reset-20260902T183233Z/data`。
- 其他 NAS Docker 服务在部署后只读检查时仍运行正常。

## Production Corrections

PROD-060 修复了体积瑕疵接受提交：GET 预览为展示预计体积而附加的 `sizeForecast` 曾被 POST 提交路径误纳入核心 Candidate 身份校验，导致摘要必然不一致并在事务前拒绝。现仅预览模型携带该字段，提交仍以 exact frozen Run、Candidate digest、用户 acknowledgement 和 idempotency fences 构造 `AuthorizedDefectManifest`。没有降低瑕疵范围或摘要门禁，没有 Formation Reset 或生产数据纠正。部署后《守望者 (2009)》保持原 frozen Run revision 3，候选仍只包含 `size_cap_exceeded` / `max_size_exceeded`，等待用户重新确认。

PROD-032 已修复 Libra Pre-deck token 旁路并完成有损升级；保留全部 Subject 和 Field policy，终止 200 条遗留 Libra Work，使 Formation 从数百条活动记录收敛到真实工作集。证据见归档 Phase packet。

PROD-033 已收口终态 Work 下的执行层残留：39 Attempts、52 Events、2 Event Attempts 和 2 Effects；当前 residual 为 0，不再占满全局 64 个 active Attempt 名额。其 rollback backup 为 `/vol1/1000/docker/shelfdeck/data.backup-20260830T175325Z-prod033-execution-recovery`。

PROD-034 已按 Product Owner 授权对“唐人街探案 (2015)”和“赤壁（上） (2008)”执行封闭的一次性数据纠正：

- 两个 `discarded` Libra Run 不再恢复；两个 Custody、7 项 Material Control 和 35 条 Binding 已释放；
- 删除两个可重建的陈旧 Formation Projection，两个目标不再出现在 active section；
- 保留 Handoff、Package、Work、Attempt、Event、Effect 和 Final Inventory Decision 最低审计；
- 为这两个 Run 引入的通用 Arca 恢复兼容路径已经撤除；
- 未删除、移动或改写 `/media`、`/transcode` 文件。

## Formation Reset Debug Capability

- 当前生产镜像已包含 PROD-052 唯一 Formation Reset：不保留终态过程记录，也不再维护 `normal|nuclear` 分支。
- 唯一 Formation Reset 物理删除 On-deck Commit 前的整理过程，使其在当前运行数据库中视同未发生；若未来需要“保留历史并批量放弃”，应作为独立正式领域操作设计，不属于 Reset。
- 唯一 Reset 以 Arca On-deck Commit 为保护线，不触碰已入架事实和 `/media`，也不主动触发 Observation 或 Intake。
- **唯一 Formation Reset 已随当前生产镜像部署到 NAS。** 2026-09-03 本次获授权 apply 已完成；后续每次调用仍必须重新获得明确生产授权，再使用唯一确认串显式 `--apply`，部署本身不触发 Reset。
- Reset 发现范围现补齐无 Subject 的 orphan pipeline token：以 token 自身与 `source_process_id` 为独立范围根，
  同时纳入其 Libra Intake Work。Normal 删除 token、终止活动执行但保留终态审计；Nuclear 删除 token 与对应执行图。
  两种模式的 postcondition 都要求 orphan token 为 0。
- 首次获授权 Nuclear apply 清除了 3 条旧 orphan token 与《人生密密缝》未 Commit 链，但自然 Intake 立即又形成
  3 条新 orphan token。生产联表证明每条都有 1 张 WorkAdmission Command Receipt，Receipt 的 `target_id` 指向
  已被早先 Nuclear Reset 删除、当前不存在的 Intake Evidence Work；Admission 因而回放“已 admit”却没有 Work。
- Reset 现同时删除 Nuclear execution graph 对应的 Work-target Command Receipt，并全局识别 Libra 中 target Work
  已不存在的 phantom WorkAdmission Receipt；两种模式都会先删除这种不自洽 Receipt，Nuclear 再删除完整图。
  这覆盖尚未取得 token 的潜伏 Receipt，避免调度游标继续逐批撞上历史回放。最新聚焦 12/12，Service full
  426 项为 408 pass、18 skip、0 fail。
- Nuclear 现额外把 exact 未 Commit Handoff A 闭包回卷到 Procurement：Candidate Package/Delivery identity 保留，
  Delivery 与 Reservation 重新变为 open/candidate_delivery，accepted/rejected outbox/inbox dedup 删除；即使 Control
  当前已 released，只要其 revision 历史首次进入本次 token/Subject 范围，也会删除该后缀并恢复此前 Procurement
  revision。已 Commit Shelf/Deck 与 `/media` 不进入范围。
- 获授权的 PROD-050 Nuclear dry-run 精确命中 1 个 disposable Subject、2 条 orphan token、3 个 Handoff A closure、
  7 个 Work（其中 2 个 active），且没有 Run/Workspace/Package/Arca On-deck；apply 删除 7 个 Work 和 1 个 Subject，
  重开 3 个 Delivery/Reservation、删除 1 条 Libra outbox、恢复 3 个 Procurement Control 并删除其 6 条后续 revision。
  postcondition、幂等、SQLite integrity 与外键检查均通过；10 条已 Commit 链和 `/media` 保持不变。

## PROD-042 Local Fix

- 生产只读诊断确认：3 个 Pre-deck token 中有 1 个停在 Intake Rejection。Evidence Work 已正式返回 `candidate_material_unavailable`，但 Rejection Planner 把整个 `dependencyRef` 对象写进 `evidenceWorkId`，Input Projection 因此无法按字符串 Work ID 读取 Evidence Result；Rejection Decision 未提交，token 也不能释放。
- 本地已将 Rejection Planner 收紧为只接受唯一的 Libra Supporting Work 依赖，并只投影其 `objectId`。focused 回归实际覆盖 Planner → Input Projection → Rejection Store commit → Coordinator token release，2/2 通过。
- 修复没有为现有失败 Work 增加重规划、fallback 或兼容读取，已随当前统一镜像部署。生产监控发现的
  1 条旧失败 Rejection Work 关联的是无 Subject 的 provisional token，不做兼容恢复。

## PROD-044 / PROD-045 Local Fixes

- 前一次候选镜像 readiness 因 846 个旧执行目录摘要 Plan 阻断启动，部署未继续；原镜像与健康数据已恢复。生产只读审计确认这些 Plan 全部终态，当前 3 个活动 Arca Work 均使用既有兼容摘要。执行摘要现排除纯追踪 `sourceLocator`，精确旧摘要只允许全终态历史退役。
- 《人生密密缝》的根因是 Libra NFO renderer 只替换首个根级 genre，且无层级正则把 actor 的 TMDB ID 当作 movie ID；Workspace NFO 在进入 Arca 前已与 Product Fact 不一致。现改为只编辑根节点直接子元素、整体规范化多值 genre，并在 Arca Placement 前执行 staged NFO 语义门禁。
- 两项均为通用合同修复，没有影片、路径、Run 或生产 ID 特例；现有失败《人生密密缝》不做兼容恢复。

## PROD-047 Completed One-time Correction

- 生产 3 条 `care_workspace_reclaim` 遗留执行图的领域现实已经完成 reclaimed，但 Material 保存的是缺少
  `scopeDigest` 的旧 `ReclamationReceipt/v1` digest；当前执行图没有 Result/Commit Marker，因此通用恢复
  必须持续 fail closed，不能把旧事实伪造为当前成功。
- Product Owner 已授权只终止这 3 条旧 Work/Event/Attempt/Effect。默认 dry-run 的 PROD-047 工具以
  终态 Case、完整 reclaimed scope、旧/新 Receipt 精确 digest、零 Result/Marker/活动引用和单链结构共同
  证明范围；apply 还要求外部逐条传入 exact Work ID，集合漂移或任一不变量不符即整批拒绝。
- 首次生产 plan 额外观察到 1 条 Workspace 仍 active 且有活动引用的正常 reclaim Work；exact Work 集合门禁
  在事务前阻断，自动重启原服务，数据库未纠正。工具现明确只把领域 Registry 已 reclaimed 的执行残留纳入
  PROD-047 候选，正常 active Workspace 只列为 excluded 诊断。
- 生产 apply 已在完整离线备份后完成：exact 3 条 Work、3 条 Work Attempt、3 条 Event 和 3 条 Effect
  分别收口为 `cancelled/cancelled/cancelled/failed`，3 条 Event Attempt 形成完成的 cancelled Outcome；统一错误码为
  `P4_LEGACY_AFTERCARE_RECLAIM_EXECUTION_RETIRED_PROD047`。事务后 `integrity_check=ok`。
- 二次 dry-run 返回候选 0、unsafe 0，证明纠正幂等；正常 active Workspace Work 继续只列为 excluded。
  纠正没有改 Receipt、Aftercare Case、Inventory、Workspace/Material reclaimed 事实或任何媒体文件，也没有向
  Runtime 增加 migration、fallback 或旧条目兼容。

## Current Runtime

- Formation 当前为 5 条：0 条 `in_progress`、1 条 `attention_required`、4 条 `completed`、0 条 `ended`；服务
  health、readiness、SQLite integrity、容器 restart count 与浏览器 console 均正常。
- 《人生密密缝 (2017)》保持真实 attention：旧条目在 Arca 上架前报告
  `CLEAN_ARCA_FINAL_NFO_SEMANTIC_DRIFT`，没有为该影片增加兼容恢复；《千寻小姐 (2023)》与《罪人》均已完成。
- Formation 详情卡片已生产验收：列表与详情使用同源 current Plan，完成 successor 不再被历史失败 Plan 覆盖，
  NFO 失败文案明确表达“正式位置中的 NFO 内容与本次已接受的媒体信息不一致”。
- Field 页面显示 generated 952、Libra accepted 727、waiting 225。第二次获授权 Reset 已删除当时 3 条 token 与
  3 张直接关联的 phantom Receipt，但自然 Intake 又选中 3 张更早的潜伏 Receipt。提交时间证明这些 Receipt 比
  新 token 早约 43 小时，并非新 Admission 原子性失败；全库只读审计发现 3,274 张 Libra phantom Receipt
  （Intake 1,433、Acceptance 726、其他 Libra 1,115）。本地修复现清理完整 Libra 潜伏池；19 张 Arca phantom
  Receipt、2 条 active Aftercare reclaim Work 仍明确不在本次范围。
- 最终 `0813ae2991` 镜像已部署并执行获授权 Nuclear 数据纠正：3 条 orphan token、3 张直接关联 Receipt 和
  3,274 张 Libra phantom Receipt 全部清零，postcondition、幂等复验、`integrity_check` 与外键检查均通过。
  服务恢复后自然形成 3 个新 token；每个 token 都有 2 条同 process Intake Work，Admission Receipt target Work
  存在，当前 2 条 Acceptance Work 正在运行，另 1 条已形成 active Subject《地狱为何恶劣 (2013)》。
- PROD-050 纠正后 3 个自然 Intake 均形成 active Subject；每个 token 的 Admission Receipt 都命中真实 Work，
  Control 均为 Procurement revision 1 → Libra revision 2，Handoff A terminal conflict 与 Libra phantom Receipt 为 0。
  《赤焰战场2》已进入真实 `libra.media.transcode@1`，部署重启后继续从持久化进度推进。
- Formation 详情生产验收通过：材料准备 completed、媒体整理 running、验收与上架 pending；三类 Receipt 使用稳定中文，
  结构化身份显示为“赤焰战场2（2013）”，全文不含 `[object Object]` 或旧内部 outcome。
- PROD-047 之外另有 2 条正常 active Aftercare reclaim Work。它们的文件 size 与 content fingerprint 与记录完全
  一致，仅 inode 已变化，持续形成 `ARCA_AFTERCARE_WORKSPACE_MEMBER_CHANGED`；它们不属于已 reclaimed 的
  legacy Receipt residual，未纳入本次授权纠正。
- 《罪人 (2025)》沿用 On-deck Run `6934758bf6a97208e0e2bc024d6bfb19bf6f36993a2a223bee5a7ba23125ca2a`，已完成 Stage → Verify → Placement → Settlement → Fulfillment → Commit，并建立 Shelf Entry `f04a4f09b2b64d957392425ca6eb7d70dde5126bf4f07424777df08c84f11347`。
- 《罪人》详情当前显示 `计划5 将媒体写入收藏架 / 已完成`；旧 failed Plan 仅留在过程历史。最终启动窗口未再出现该条目的 `CLEAN_ARCA_TARGET_OCCUPIED`、`CLEAN_ARCA_FINAL_NFO_SEMANTIC_DRIFT` 或 `ARCA_AFTERCARE_NFO_SOURCE_STALE`。
- 《千寻小姐 (2023)》已完成；此前长期 49.9% 是部署重启窗口中的持久化转码进度，不再是当前状态。

## Formation Detail Production Acceptance

- 根因一是详情投影只按共享 `procurement_run_id` 收集 Plan，把同一 Field Run 下全部 Candidate Work 都带入一个 Subject。现在 Procurement 阶段必须同时匹配 Accepted Candidate Package 与其冻结 `structureUnitId`；Field-wide Evidence Plan、其他 Candidate Plan 以及只匹配其中一项的漂移数据全部排除，前端仍只渲染后端返回的真实 Plan。
- 根因二是 Accepted On-deck 的 Plan/Input Projection 失败没有 Result，恢复却从 Result 读取 Handoff B 引用；生产《罪人》的同一 On-deck Run 因此停在 `offloading`，已有两代 failed Work。恢复现只读 immutable Work Definition，继续同一 Run；第三代失败后的 callback gap 会先把该 Run 收口为 `blocked`，再稳定投影 `attention_required` 与「重试上架」，不会重开 Libra 或创建第二个 On-deck Run。
- 上述两项已随 `91f990609c` 无损部署。生产详情已收敛到约 14–25 KiB，材料准备只保留当前 Candidate 的一个真实 Plan；同一 On-deck Run 已产生第三代 running Work，没有重开 Libra 或第二个 Run。
- 第三代 Work 的首个 Event 随后持续停在 `ready`。只读诊断确认不是 16 个 Event 并发上限：仅 6 个 Event Attempt executing。真正原因是两个更早的 `waiting_for_resource` 转码 Event 持续排在队首；Scheduler 用 100ms wall-clock cooldown 防重复，而生产一次 SQLite 调度扫描可超过 100ms，于是同一 waiter 每轮重新获选并饿死后续 Event。现改为 scheduling-round fairness：一个资源 waiter 每轮只尝试一次，其他 eligible Event 必须获得机会；整轮耗尽后再由 bounded fallback 开启下一轮。
- 过程卡片另有独立聚合错误：旧 failed Work 先于当前 running successor 判定，导致阶段显示 `attention` 而整体仍为 `in_progress`。现在当前 `admitted|ready|running` 后继 Work 决定阶段为进行中；旧失败 Plan 仍原样保留在展开结果中，不被覆盖或删除。
- 完成态进一步暴露同一缺口：成功 successor 已完成 On-deck Commit 后，历史 failed Work 仍会把阶段和 `currentPlan` 拉回 `attention`。现按同一 Owner/Process/Work kind 的最新 Work 判定责任链状态；最终上架阶段完成时，列表摘要指向完成 Commit 的 successor，早期失败 Plan 继续只作为过程历史展示。没有 successor 的真实失败仍保持 `attention`。该修正已随 `b06b70ba10` 部署，并由《罪人》的完成态详情形成生产验收。
- 《冰血暴 (1996)》生产只读证据进一步确认：计划12执行链全部 `succeeded`，只是媒体合规检查返回`max_size_exceeded`（原片约10.03 GiB、收藏上限8 GiB），随后真实计划13确认处理方式、计划14等待转码资源。旧过程投影把Result payload中的`result:"failed"`误当成Runtime失败；本地现只按Event/Outcome执行事实确定Plan状态，计划12显示已完成并保留“不符合要求”的真实检查结论。
- 一级页“当前进展”此前虽不是React生成Plan，但仍由`nextAction + organizingSteps`这套旧后端表达驱动，与过程卡片的真实Plan分离。现在列表只为当前页有界读取同一真实Plan投影的编号、标题、状态和进度摘要；前端只渲染`currentPlan`，没有第二套Plan生成或`organizingSteps`回退。媒体生产计划标题按真实工作区分，冰血暴计划11–14依次为“读取原始媒体信息 / 判断原片是否可以直接使用 / 确认视频处理方式 / 处理媒体文件”。
- 历史 focused 109/109；当时 Service full 402 项为 384 pass、18 skip、0 fail。P4 Runtime gate 仅受既有 dynamic-template scanner findings 阻断。该 follow-up 后续已部署，未编辑生产数据库、未 Reset、未创建新 On-deck Run 或重开 Libra。
- Plan语义/列表同源增量 focused 42/42、Admin Web 38/38、production build通过；最终 successor 聚合合并后 Service full 406 项为 388 pass、18 skip、0 fail。上述增量均已部署，未写生产数据库。

## PROD-035 Production Monitoring

- Product Owner 已针对 Emby 并发改写 NFO 授权 SSOT 变化和本次无损部署；未授权修改 Emby 配置。
- On-deck 顺序改为 Placement 后 Final Verify；NFO 用 accepted Movie facts 做语义验收，同时保存 Shelf 上实际 physical identity。Primary 与其他普通成员仍严格校验 Package identity。
- Final Verify、Fulfillment、Commit 各自重读最新现实；Commit 用最后一次实际 Final Reality 建立 Inventory Representation 与 Material Control。
- Aftercare 对语义等价 NFO 漂移不改文件，只新增 Inventory Representation revision 并原子切换 Control；语义错误仍走带 CAS source guard 的 update/rebuild。
- Accepted 后失败继续由 Arca 持有同一 On-deck Run。自动恢复最多 3 代；耗尽后进入零执行资源的稳定 `attention_required`，停止周期性 Supporting Work 与错误日志，用户可「重试上架」继续同一 Run。
- 检查点审计确认：「接受瑕疵」和「放弃整理」属于 Handoff B Accepted 前的 Libra 旅程；Accepted 后不得用它们改判、回退或释放 Arca custody/control。
- 生产仍重复报 `ARCA_AFTERCARE_NFO_SOURCE_STALE` 与 `CLEAN_ARCA_FINAL_NFO_SEMANTIC_DRIFT`（owned field `director`）；因此 PROD-035 不能标记生产 FIXED，已打回原 NFO 任务继续修正。

## PROD-037 Production Monitoring

- 生产只读核对确认，`director` semantic drift 的目标是《老枪 (2024)》，不是《罪人》。盘上 NFO 的 TMDB `1184222`、title/year/plot/genre/cast 与 accepted facts 一致；Emby 增加的 director 属于可维护附加内容，不是 Final Reality gate。
- `ARCA_AFTERCARE_NFO_SOURCE_STALE` 属于另一条 Aftercare Case。source CAS 在 `material_commit` intent 后抛异常，旧 Runtime 将其视为未知副作用并持续恢复。
- 本地修正把 Presentation gate 限定到已授权字段，并将同一演员的弱名称/强 TMDB identity 合并验收；source/stat fence 冲突在文件回滚后返回 `retryDirective=never` 的 typed `external_writer_conflict`，使未提交 Effect 可 abandon、Event/Work 有界终结。
- 没有生产 DB 编辑、Emby 配置修改、Work ID 特例或旧条目兼容路径。修正已随当前镜像无损部署；初始监控窗口未见两类旧错误复发，仍需等待新的正式 Aftercare/On-deck 行为验证。

## PROD-040 Production Accepted

- 生产只读复现证明，恢复 Stage 遇到的非 Package NFO 是同一 On-deck Run 早先 Placement 后由 Emby 等价改写的 final 文件；原 `offloadContext` 不包含这个由 Placement 新建的路径，因此旧门禁把它误判为陌生冲突文件并抛出 `CLEAN_ARCA_TARGET_OCCUPIED`。
- 本地修正从 Execution Foundation 读取同一 Arca On-deck Run 的 durable Placement Result；只有 typed `PlacementSwitchReceipt/v1` 同时匹配 `scopeId=onDeckRunId` 与当前 `targetCommitSlotId`，Stage、Staged Verify、Placement 才允许 NFO 进入 semantic presentation 分支。
- 语义等价 NFO 不被重写，Staged Manifest 记录其盘上实际 physical identity；没有正式回执、错 Run/错 Slot、缺 presentation basis、语义冲突或任何非 NFO 成员漂移继续 fail closed。不存在影片 ID、路径、Work ID 特例，也没有 migration、旧条目兼容、生产数据编辑或 Reset。
- 精确回归覆盖空 `offloadContext`、先 Placement、Emby 改写、同 Run 恢复 Stage；同时覆盖无回执拒绝与 Primary 严格拒绝。修正先随 `e16ff04ebf` 部署，并在 PROD-041 部署后由《罪人》同一 Run 完成 Stage 至 Commit 的生产链路正式验收。

## PROD-041 Production Accepted

- PROD-040 随生产镜像 `e16ff04ebf` 部署后，现有 On-deck Run 的 Stage 仍未进入 Inventory Port：Startup Recovery 已把 Effect 分类为 `continue_forward`，但 Event Runtime 用原 Event Attempt `started_at_ms + timeoutMs` 重建 deadline；原 deadline 已过，Timeout Controller 在 Capability dispatch 前立即抛出 `P4_EXECUTION_TIMEOUT`。
- 这是所有长时间停机后 `continue_forward` 非纯 Effect 都可能触发的 Foundation 缺口，不是 NFO、影片或 Arca 专属问题。现为同一 Effect 在首次恢复执行前原子写入一次 durable recovery execution start；Attempt Policy 仍使用原 Capability/Effect Class 的冻结 Timeout Policy，只把这次恢复句柄的计时起点改为该 durable 时间。
- 后续进程重启不会更新该时间，因此真实 recovery hard timeout 不会无限重置。原 Event Attempt identity、Input Snapshot、Fence Snapshot、Effect identity/intent/idempotency key、`effectOccurredAtMs` 和 Result/Receipt 收口合同均保持不变。当现实探测已证明一个非纯 Effect 不存在时，`safe_retry` 也复用这一单次 durable recovery budget；`safe_retry_before_intent`、普通 retry 与 pure observation 仍沿用原 Attempt deadline，PROD-036 hard-close 行为未放宽。

## PROD-046 Local Fix Ready

- `arca.aftercare.workspace.reclaim@1` 的三个生产恢复动作被 Reality Observer 分类为 `safe_retry`，但原 Event Attempt deadline 已过；旧 Event Runtime 在 Capability dispatch 前持续抛出 `P4_EXECUTION_TIMEOUT`，使同一 Work/Attempt/Effect 永久保持 executing/intended。
- 根因是 Foundation 只给 `continue_forward` 建立 durable recovery execution budget，遗漏了“Effect 已持久化、现实已证明 Effect 不存在”的非纯 `safe_retry`。修正后两类 classified non-pure recovery 共享同一机制：Effect Journal 原子冻结一次 `verified_at_ms`，重启不能续期，超时后仍 fail closed。
- 该修正不包含影片、路径或生产 ID 特例，不编辑生产数据，不改变 Owner/Handoff；普通 retry、`safe_retry_before_intent` 与 pure observation 的 deadline 语义不变。
- 本地测试覆盖：原 Attempt deadline 已过时，classified `continue_forward` 仍实际 dispatch 并成功收口；同一 Effect 在时钟前进一小时和再次启动时仍返回第一次冻结时间。修正随 `e655d6d66f` 部署后，《罪人》同一 Effect/Run 获得一次有界恢复预算并完成 On-deck Commit；未修改生产数据。

## Verification

- PROD-060 focused 7/7；Service full 443 项为 425 pass、18 skip、0 fail。标准 build/upload/checksum/dry-run/apply、readiness（186 tables、123 routes、17 UI surfaces、0 findings）、health、Admin Web、media/QSV mounts 与 exact running image 校验通过；容器 restart count 0。

- PROD-034 focused：2/2；Arca focused：24/24；Admin Web：37/37，build 通过。
- 当时 Helix Architecture full gate 通过；P2 contract aggregate 更新为 `549e136626021ed6f7f437e173775c06b59e82fc3cea73e189bdafeb0792404b`，DDL digest 为 `3be2dad9b3615053681dfc2721974657fc3995ccf60a044e17dfb5131f0f8199`。本轮三态 Formation Projection 的本地目标 DDL digest 已更新为 `6a2246c39bebcd1f6f80264bac793c7a3119636a791683e426e4c30aa6fdc651`，仅迁移可重建 Projection；尚未部署生产。
- 本次最终合并后 focused 135/135；完整 Service 399 项为 381 pass、18 skip、0 fail；Admin Web 38/38；production build 通过。
- 标准 build/upload/deploy dry-run/apply 完成，未使用 `--helix-clean-init`。部署脚本原只读 WAL readiness 返回 `SQLITE_CANTOPEN` 却未阻断；部署后 health/SQLite 校验通过。脚本已在本地修为“只读源复制到临时目录后校验，并强制匹配 ready”，对当前生产数据副本复验为 186 tables、123 routes、17 UI surfaces、findings []，尚未随镜像部署。
- PROD-035 targeted 覆盖 NFO 五个并发改写窗口、Primary 漂移、坏 XML/身份冲突/缺字段、Aftercare revision convergence、连续冲突聚合、同根与阶段恢复；UAT-131 四个场景通过。
- PROD-040 focused：相关 Arca/Aftercare/On-deck 68/68；Service full 403 项为 385 pass、18 skip、0 fail；Admin Web 38/38，production build 通过；Service 与 Web 官方 npm registry audit 均为 0。Helix Architecture gate 的 semantic、manifest、contract 均通过，总 gate 仅被 main 既有 `formation-process-projection.js` / `progress-projection-reader.js` dynamic-template scanner findings 阻断，本轮未改这两个文件。
- PROD-041 focused：P4 Effect Journal/Event Runtime/Startup Recovery/Runtime Host 96/96；Service full 403 项为 385 pass、18 skip、0 fail。正式 P4 Runtime gate 仍只被 main 既有两个 dynamic-template scanner findings 阻断；本轮 Foundation tests 与运行时语义没有新增 finding。
- 最终 Formation successor 聚合合并后 targeted 10/10；Service full 406 项为 388 pass、18 skip、0 fail。最终镜像 build/upload/checksum/dry-run/apply、readiness、health、Admin Web、媒体/QSV mount 和 running-image 校验全部通过。
- PROD-042 targeted 11/11；新增 Planner/Projection/commit/token-release 精确回归 2/2；Service full 406 项为 388 pass、18 skip、0 fail。P8 fixture/semantic/manifest/contract 均通过，总 Gate 仍只受 main 既有 `formation-process-projection.js` / `progress-projection-reader.js` dynamic-template scanner findings 阻断，本轮没有新增 finding。
- Service full：386 项，368 pass、18 skip、0 fail；Admin Web：37/37，production build 通过。
- Service 与 Web 的 official npm registry audit 均为 0；image checksum、deploy gates、SQLite integrity 和 production health 通过。

现行产品验收权威仍为 `BETA_FEATURE_ACCEPTANCE_BASELINE.md`。这些生产修复不把任何 `HB-*` 自动标为 PASS。
