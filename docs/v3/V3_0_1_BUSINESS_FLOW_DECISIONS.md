# ShelfDeck v3.0.1 Business Flow Decisions

本文是当前 worktree 的 v3.0.1 业务流程收口基准。

背景结论：另一个分支中的 v3 重建路线已经因成本过高放弃。当前路线是在已宣称完成的 v3 上逐版本演进，v3.0.1 不新增大功能，专门重新判定 v2 action 时代留下的业务细节、入口和展示语义。

术语以 `docs/v3/BUSINESS_MODEL_NOTES.md` 和 `docs/v3/DATA_MODEL_NOTES.md` 为准：

- task 是跨 lifecycle 阶段的桥。
- flow operation 是桥内的执行方向，例如 `transcode`、`upgrade`、`scrape`。
- event 是 flow 内发生的资源占用、外部调用、失败、确认、恢复事实。
- projection 只服务查询、展示和调度，不是事实来源。

## 1. 总判定

| 流程 | v3.0.1 判定 | 用户意图 | 媒体类型 | Lifecycle | Task bridge | Flow operation / event | 触发 | 完成条件 | 失败/恢复 | Admin Web |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Emby 普通媒体库 refresh | 支持，但不是 item task | 同步外部媒体事实 | 普通 Emby movie/season | external source -> ingested/metadata-ready projection | 无 | runtime event `library.refresh`、Emby API、SQLite projection write | 手动 `/v1/library/actions/refresh`、启动延迟、周期 refresh | Emby items 写入 `library.db`，metadata/lifecycle projection 更新 | 失败写 activity/runtime/diagnostic；重启后按子库状态重新 refresh | 展示 refresh 入口和子库状态，不展示 task bridge |
| 成人文件夹 discovery | 支持，只读候选发现 | 看见新文件候选 | adult folder | source/discovered | 无 | runtime event `smartTask.scan` 或目录候选枚举 | SmartTask 读取、页面只读核对 | 候选列表产生，不写 item、不写 task | 目录/坏文件失败只记录 diagnostic，不阻塞 service | 不提供目录 scan 入队按钮 |
| 成人文件夹 ingest | 支持 | 把单文件候选变成 ShelfDeck item | adult folder | source/discovered -> ingested | metadata | `ingest`，events `metadata.ingest.*`，resource `filesystem:ingest` | SmartTask 自动且 `smartTaskEnabledActions` 包含 `ingest`；手动候选可显式创建 | item 写入 `library.db`，基础媒体事实/NFO 预解析完成 | 单文件 probe 失败写 item `probeError` 或 task failed，不拖住整库 | 显示入库候选/任务，不把 ingest 链式变 scrape |
| 普通媒体 metadata-ready 判定 | 支持，projection/事实判定，不是 scrape | 判断是否可以优化/归档 | 普通 Emby | ingested -> metadata-ready | 无独立 task | `metadataStatus.resolveMetadataStatus`，projection columns | refresh、rating/Douban 更新、查询装饰 | 外部 ID、路径、技术事实、观看状态、评分等完整 | 缺失时 optimize/archive task admission 拒绝 `metadata_missing` | 展示 metadata badge 和缺失原因 |
| Douban 评分同步 | 支持，但不是 item task | 同步评分用于策略 | 普通 Emby | metadata facts update | 无 | runtime event `douban.sync`，resource `douban` | 手动集成入口、子库周期 sync、refresh follow-up | 匹配评分和 subject id 写入 item facts | 无配置/网络失败写 activity/runtime/diagnostic；重启后下一轮可重试 | 展示同步状态和失败信息，不展示 task bridge |
| 成人库 scrape/rescrape | 支持 | 成人 item 补元数据、整理目录、写 NFO/封面 | adult folder | ingested -> metadata-ready | metadata | `scrape`，events `metadata.scrape.*`，resources `scraper`、`local_ai`、`filesystem` | 自动仅 pending/empty 状态且 allow-list 包含 `scrape`；手动只走 rescrape endpoint | verification 合同通过，`scraped=true`、`scrapeStatus=done` | failed/ambiguous/needs_review 不自动重试；手动 rescrape 重置为 pending | 成人 item 展示 scrape 状态、重刮入口和诊断 |
| 普通媒体 scrape | v3.0.1 不支持，应阻断 | 用户可能误以为要“补普通媒体元数据” | 普通 Emby | 无 | 无 | 无；旧 `actionType=scrape` 仅 legacy compatibility | API `POST /v1/tasks` 对已知普通 item 拒绝；SmartTask 不得创建 | 无 | 返回 `TASK_ADMISSION_REJECTED/scrape_not_supported_for_standard_media` 并写 diagnostic | 不展示普通媒体 scrape 按钮；说明普通元数据来自 Emby refresh/Douban sync |
| strategy compute | 支持，但不是 item task | 计算下一步优化方向 | 普通和成人已 metadata-ready item | metadata-ready -> optimized/archive projection intent | 无 | runtime/diagnostic event `strategy.compute`；当前为同步 API | 手动 recompute、refresh/rating 后 | `action/reason` projection 更新 | 失败写 diagnostic；重启后可重算 | 展示“下一步”而不是“任务类型” |
| keep 闭环 | 部分支持，v3.0.1 定义为 archive-like projection | 策略判断无需优化 | 普通和成人 | metadata-ready/optimized -> archived | v3.0.1 不创建 task | projection `archiveStatus=archived_like` | strategy/lifecycle projection | item `lifecycleDone=true` | 若 metadata 不完整，不能 keep 闭环 | 展示“已闭环”，不得创建 keep task |
| transcode 优化 | 支持 | 降低体积/码率，保留媒体 | 普通和已 scraped 成人 | metadata-ready -> optimized -> archived-like | optimize | `transcode`，events `optimize.transcode.*`，resources local/worker transcode、filesystem | SmartTask allow-list；手动 optimize intent 当前兼容为 `actionType=transcode` | 输出校验、替换完成、optimization facts 写入 | FFmpeg/worker/replace 失败写 task event、runtime event、diagnostic；按 resumePoint 恢复 | 展示 optimize bridge、operation、resource、审批 gate |
| upgrade 优化 | 支持 | 通过 MoviePilot 洗版替换 | 普通 Emby，不支持原盘 | metadata-ready -> optimized -> archived-like | optimize | `upgrade`，events `optimize.upgrade.*`，resources `moviepilot`、filesystem | SmartTask allow-list；手动 optimize intent 当前兼容为 `actionType=upgrade` | 候选确认、下载/刮削、替换校验完成 | MoviePilot 外部任务 hash/transfer facts 用于恢复；失败需 event 解释 | 原盘禁用入口并说明原因；展示候选/审批 |
| delete / archive 删除 | 支持，当前 delete 是 archive bridge 的 destructive operation | 删除不该保留的媒体 | 普通和成人 | metadata-ready/optimized -> archived/removed | archive | `delete`，events `archive.delete.*`，resource `filesystem:mutation` | SmartTask allow-list；手动 delete | 安全目标删除并校验，任务 done/deleted facts | 路径安全失败、文件系统失败写 event/diagnostic；重启后按 task 状态解释 | 展示 archive bridge 和删除报告 |
| archive 验收 | v3.0.1 以 projection 为主，独立 archive task 暂不支持 | 确认本轮处理完成 | 全部 item | optimized/metadata-ready -> archived | 暂无独立 bridge | projection `lifecycleProjection` | strategy/optimization/delete 后 | `lifecycleDone=true` 或 archive-like 状态 | 验收不通过应回到 metadata/optimize 或留下 diagnostic | 展示 archive 状态；不展示独立验收按钮 |
| SmartTask 自动入队 | 支持，必须统一经过 TaskAdmission | 后台创建允许的桥 | 普通和成人 | 取决于候选 | metadata/optimize/archive | operation 由候选和 admission 固化 | 仅 `smartTaskEnabledActions` allow-list | task.created + flow.planned 持久化 | 被 admission 拒绝时不得创建；应有 runtime scan summary | 调度页展示 allow-list 和空队列原因 |
| 手动任务创建 | 支持，但当前仍是 v2 action compatibility API | 用户显式推进某项 | 普通和成人 | 由 action 映射桥 | metadata/optimize/archive | `actionType` 兼容映射到 flow operation | `/v1/tasks`、成人 rescrape endpoint | TaskAdmission 允许后写 task + flow plan | 拒绝写 diagnostic；active 去重 | 页面应表达“桥/flow 操作”，而不是只说 action |
| task execute/pause/resume/cancel/retry | 部分支持 | 控制当前桥推进 | task | 不改变业务阶段，只改 runtime | 已存在 task | task events `manual_execute_requested`、`paused`、`resumed`、`deleted` 等 | task action endpoints | 状态变更持久化 | 重启后 interrupted/queued 按 resumePoint 恢复；retry 仍需 v3.0.2 细化 | 任务中心展示状态、phase、resumePoint、审批 |
| scheduler dispatch | 支持 | 把可运行 task 推进到 flow event | task | bridge 内推进 | 已存在 task | `flow.dispatched` task event + runtime event `task.dispatch` | polling scheduler | flow executor 开始执行 | 资源不足等待；driveTask 异常 failed_hard 并写 runtime event | Resource View 展示 resource bucket |
| worker transcode | 支持，作为 transcode flow resource | 远程算力执行 FFmpeg | 普通/成人 transcode | optimize bridge 内 | optimize | `worker_transcode` resource events | transcode flow 选择 worker | 输出下载、校验、替换 | worker job 状态、源/输出路径需可恢复；失败写 task/runtime event | 节点页/资源页展示 worker 状态 |
| MoviePilot 外部任务 | 支持，作为 upgrade flow resource | 搜索、下载、刮削、转移 | 普通 upgrade | optimize bridge 内 | optimize | `moviepilot` resource events | upgrade flow | hash/transfer 完成且替换校验 | hash 丢失、候选不确定、刮削路径不确定时暂停确认 | 任务详情展示 MoviePilot 阶段和确认 |
| service restart recovery | 支持基础恢复，v3.0.2 需深化 | 解释 crash 后任务状态 | task/event | 不改变阶段 | 已存在 task | recovery diagnostic + task status normalization | service startup | active task 恢复 queued/interrupted，projection 可重建 | 外部副作用恢复仍按各 flow resumePoint 判断 | 健康页展示 scheduler/recovery 状态 |
| admin-web 入口和状态展示 | 支持并继续收口 | 让用户看见阶段、桥、flow、资源、原因 | 全部 | projection 展示 | task list 展示 bridge | event/resource/diagnostic 投影 | 页面/API | 操作入口符合本表 | 不支持入口必须 disabled 或不渲染，后端仍硬拒绝 | 媒体页、任务页、资源页均以 lifecycle/bridge/flow 为主 |

## 2. v2 action 在 v3.0.1 的归属

| v2 action/value | v3.0.1 归属 | 说明 |
| --- | --- | --- |
| `ingest` | metadata task bridge 的 flow operation | 只用于成人 folder 单文件入库；discovery 不是 action |
| `scrape` | metadata task bridge 的 flow operation；普通媒体为 blocked；旧任务为 legacy compatibility | 成人 scrape/rescrape 支持；普通 Emby metadata 由 refresh/Douban/projection 解决 |
| `transcode` | optimize bridge 的 flow operation | API 仍兼容 actionType；业务展示应叫 optimize / transcode operation |
| `upgrade` | optimize bridge 的 flow operation | MoviePilot 是 flow 内 resource/event，不是 task 本体 |
| `delete` | archive bridge 的 destructive flow operation | delete 是进入 archive/removed 的一种执行方式 |
| `keep` | strategy/optimization direction + archive-like projection | 不创建 task；不能等同 archived，必须由 lifecycle projection 验收 |
| `refresh` | runtime operation/metric | 普通库 refresh 不是 item task |
| `douban sync` | runtime operation/metric | 更新 metadata facts，不创建 item task |
| `strategy compute` | runtime operation/projection update | 不是 task；结果影响 SmartTask 候选 |
| `execute/pause/resume/cancel/retry` | task control event | 不改变 bridge 语义；retry 需进一步事件化 |

## 3. 入口审计与收口规则

| 入口 | v3.0.1 规则 |
| --- | --- |
| API `/v1/tasks` | 兼容 v2 actionType，但必须走 TaskAdmission；已知普通媒体 `scrape` 拒绝并写 diagnostic |
| API adult rescrape | 唯一手动 scrape 入口；只允许 adult folder item；重置失败状态后仍走 TaskAdmission |
| API sublibrary scan | 保持 410 `SUBLIBRARY_SCAN_REMOVED` |
| Admin Web media buttons | 普通媒体不展示 scrape；成人只展示 rescrape；优化按钮显示下一座桥/flow operation |
| SmartTask | 候选生成不能直接创建 task；所有自动入队必须走 TaskAdmission 和 allow-list |
| Ingest follow-up | ingest 完成不得链式创建 scrape；后续 scrape 只能由 item 状态触发 SmartTask |
| Scheduler retry/resume | 只能推进已有 task runtime，不得根据旧 actionType 新建任务 |
| Startup recovery | 只恢复/解释已有 SQL task/event/runtime facts，不重新发明业务入口 |

## 4. v3.0.1 当前落地问题清单

| 问题 | 风险 | v3.0.1 第一批处理 |
| --- | --- | --- |
| 普通媒体 `POST /v1/tasks actionType=scrape` 可触发 | 未判定流程进入 scrape executor，语义错误 | TaskAdmission 拒绝已知普通媒体 scrape |
| SmartTask 可能把普通缺元数据项当 scrape 候选 | 自动入口绕过业务判定 | Admission 硬拒绝，测试覆盖不创建 |
| `/v1/tasks` active-only 只按 actionType 过滤 | bridge/operation 展示和兼容 API 不一致 | active 查询补 bridge/operation 过滤 |
| Admin Web 仍有 actionType 文案残留 | 用户继续按 v2 action 理解 task | 已开始切换到 lifecycle/bridge/flow/resource 展示 |
| archive 验收仍是 projection，没有独立事件合同 | keep/optimized/done 语义可能混淆 | v3.0.1 文档定界，v3.0.2 深化 |
| retry 仍主要是 task runtime 字段 | 重试事件链不足 | v3.0.2 事件化 |

## 5. 第一批修复范围

本批必须完成并用测试验证：

- 已知普通 Emby item 的手动 scrape API 明确拒绝。
- 拒绝写入 diagnostic log，页面可通过资源/诊断投影解释。
- SmartTask 即使启用 `scrape`，也不能为普通 Emby 缺元数据项创建 scrape task。
- `/v1/tasks` 与 `/v1/admin/tasks` 都能按 bridge/operation 查询。
- Admin Web 媒体页、任务页、资源页展示 lifecycle、bridge、flow operation、resource/diagnostic，而不是只展示 actionType。

## 6. 剩余未判定/未收口流程

| 流程 | 剩余工作 |
| --- | --- |
| 独立 archive 验收 | 定义 archive task 是否需要存在、何时创建、验收 event 和失败回退 |
| 手动 optimize intent | 从“用户点转码/洗版”演进为“用户请求 optimize bridge，flow 内确认 operation” |
| retry | 将 retry 从计数和状态切换提升为 event chain，包括 retry policy 和 notBefore |
| service restart recovery | 按每个 flow 定义外部副作用恢复矩阵，尤其 FFmpeg replace、MoviePilot hash、adult organize |
| diagnostic/metric 标准 | admission reject、SmartTask skip、resource wait、external call failure 的字段需要统一 |
| Desktop 兼容 | service Admin Web 已进入 v3 展示，desktop 是否仍依赖 actionType 需专项排摸 |

## 7. v3.0.2 建议

1. 引入独立 `BusinessFlowPolicy` 或等价模块，让 TaskAdmission、SmartTask、Admin Web action availability 共享同一份判定，而不是散落在候选生成和页面判断里。
2. 将手动 `/v1/tasks` API 升级为 intent API：`bridgeKind=optimize/archive/metadata`，`preferredOperation` 只是 flow hint；保留 actionType compatibility。
3. 设计 archive 验收 event 合同，明确 keep、delete done、transcode done、upgrade done 如何进入 archived。
4. 将 retry、resume、external side effect recovery 事件化，补齐每个 flow 的 restart matrix。
5. 将 diagnostic log 和 runtime event 的字段标准化，使 Admin Web 可以稳定解释“为什么不可用、为什么被跳过、资源卡在哪里”。
