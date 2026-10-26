# Fresh Reset 发布审查材料

2026-10-27 最新决定：用户明确授权部署前vol1清理、生产部署和Reset；随后追加成功核验后恢复正常生产。原“完成后仍停止”仅保留为此前决定，执行中任何失败仍保持停止。下方候选资格/容量/待授权状态为历史检查点，最新实际操作以CURRENT_STATUS和本轮事故Evidence追加记录为准。

固定候选 `101ce2fe04a0991ded2ba705d66f9d56a8664dba`，镜像 `markmahoro/shelfdeck:101ce2fe0`，tar SHA256 `0b6160ff2b0435397653f89effd54aebdb9ce8198bae8e18a2e3f89ea449a2fb`，NAS image ID `sha256:e468b02f65ddc577d1efca7e210c7620b511c7c999bdb6a52fffc6d9dcc29077`，28层。最终完整Architecture428文件/3408项：3382 PASS、26 skip、0 FAIL；Service850/821 PASS/29 skip/0 FAIL；Windows独立包、Linux增量17、具体版本UI负责人通过。NAS691收藏依赖和完整FK/integrity、三次停止态启动、27.44GB真实私有文件副本中断/续跑/重放及原文件保护通过。首次NAS启动批次在两次通过后触及900秒总预算；文件复制结束后1800秒预算三次重验通过，不隐去原超时。

本文件是当前 Phase 的发布证据与精确操作清单，不是新增活动计划。生产仍为 e78dbd82f；自动观察已取消。本轮目标和边界以 SSOT Fresh-generation Formation Reset 为准。

## 候选与验证

实现基线 e6c817319：新任务缺陷修复、Libra 显式 Provider 季集映射、新数据库代际 Reset、部署前完整冷备、流式收藏摘要。最终候选另含 SSOT 生成摘要同步及 Windows 打包清单补齐；固定镜像身份和最终门禁结果待补。

- Service 849 项：820 PASS、29 skip、0 FAIL。
- 新增 Windows 备份/Bootstrap/摘要组合 24 PASS；实际 Linux 镜像 23 PASS。
- Windows 独立打包、原生依赖及停止态 Reset 旅程 1 PASS。
- 混合 Series：一季 Commit、一季 Accepted，完整 Operator/清理/两次 stopped 重开 Win/Linux 各 1 PASS；10 个来源/正式/共享文件不变。
- NAS 691 收藏保留库三次 stopped 启动完整 FK/integrity PASS。e6 镜像对 691 Commit、691 Package、10 组保护表、2 组共享资料与 2 个精确 metadata 依赖复核 PASS；与本地原校验摘要逐项相同。峰值 RSS 166576 KiB，V8 heap 上限 768 MiB。
- 原两次摘要内存失败保留；修正没有减少校验范围。静态合同首跑因 SSOT 文本摘要未更新 FAIL，生成同步后 8 项合同回归 PASS。127 层旧镜像 NAS 装载失败及 UI 焦点首跑失败均保留。
- c2/45b/e6 的具体版本 UI 负责人核验通过；最终候选精确身份复核待完成。
- 完整 Architecture 固定 af525 独立 checkout 首跑 3404 total / 3377 PASS / 26 skip / 1 FAIL；People 前置资料未完成即进入维护窗口导致迁移夹具等待失败。前置条件修正后两个实际迁移中断点 2 PASS，最终候选完整 Gate 仍待完成。

## 精确容量删除候选

只建议以下两个普通文件，合计 **9,229,676,544 bytes**。未删除；不得扩展为父目录、通配符或 Docker prune。删除前重验路径、inode/mtime/size、SHA、保留副本与用途；任何变化均拒绝。

| 拟删除文件 | 保留的相同字节副本 | bytes / SHA256 |
| --- | --- | --- |
| `/vol1/1000/docker/shelfdeck/backups/pre-f280e6bd4-20261023/data/shelfdeck.db` | `/vol1/1000/docker/shelfdeck/backups/incident-freeze-20261023T023823/data/shelfdeck.db` | 4,614,598,656 / `dda16f4ab5f881daf98d667b8cd4c43020916a89664ec91b39a256d3af1a12f3` |
| `/vol1/1000/docker/shelfdeck/backups/history-cutover-c91fbed63-20261025/source.sqlite` | `/vol2/1000/shelfdeck_backups/pre-c91fbed63-20261025/data/shelfdeck.db` | 4,615,077,888 / `44ed9880bb7867bb701458b334afdb5cc8ef2ca131ec4e08c278392226e2f6cd` |

保留原目录中的 manifest，并在实际清理 Receipt 记录精确替代副本。所有唯一诊断副本、原始失败日志、所需镜像、其他应用及未证明重复的备份继续保留。容器挂载未引用上述备份；宿主进程 fd 可见性仍不完整（普通 fuser 与只读隔离检查均有 EACCES），不能声明无任何进程使用，需删除前补齐核验或由具备完整可见性的操作入口执行。

`pre-ba75692d4-20261026` 的 201 个 data 文件重新 SHA 校验通过，仅是旧 data 基线。691-Commit 快照也仅是数据库。两者都不能替代本轮安全停止后的 data+转码Workspace+原外部配置完整恢复基线。

## 各卷峰值预算

采样 UTC 2026-10-26T20:15:08.684Z。按文件逻辑大小计：data 5,287,897,095 bytes、transcode 27,436,291,513 bytes、最大文件 14,193,262,592 bytes、DB+WAL 5,246,566,512 bytes。业务仍运行，执行前及安全停止后必须重算；不把将来清理的空间当成当前可用。

| 卷 | 当前可用 bytes | 本轮保守峰值要求 bytes | 判定 |
| --- | ---: | ---: | --- |
| /vol1 | 7,382,339,584 | 15,233,318,624 | 当前不足；两个候选实际释放后仍须重采样 |
| /vol2 | 367,174,250,496 | 132,445,032,992 | 当前有余量，仍需执行前复验 |

/vol1 预算含两份 DB staging、三倍镜像 tar 的装载预留及 2GiB 余量；/vol2 含两次完整备份、各一次最大文件失败副本预留、六份 DB 的重建/资格工作量、两份镜像 tar、32MiB 管理资料和 5GiB 余量。已有资格副本占用已在当前可用值中，不计入释放收益。

新作业树拟为 `/vol2/1000/shelfdeck_backups/fresh-reset-final-20261027/`，operations 和 archives 分离；原路径不得被复用覆盖。原 Compose/secret.env/存在的 Reset 配置精确备份，不递归备份历史 archives。用户授权后才创建生产作业目录。

## 获准后操作边界与回退

容量清理 → 原 Runtime 安全 Stop → 核验执行和文件写入退出、关闭旧容器 → 完整冷备及逐文件校验 → 标准部署冷态管理 → 原 Runtime 一次确认的新 Reset → 停止态核对。无需等待转码完成。Reset 预检重新冻结实际收藏数、保留/清除摘要、临时文件清单、各卷容量和幂等键，不把本材料中的 691 当作届时固定数量。

保留当前/历史 Commit 收藏、所有必要依赖、People、配置、维护责任和文件关联。清除未接纳 Offer 至未 Commit Arca 状态及无依赖历史；临时清理只在已分类的系统私有根，Owner 当前使用的 Workspace 精确保留。来源与正式收藏目录不递归清理、不回滚。成功后仍停止，不自动 Resume，不恢复定时观察。

若完整备份失败，禁止发布配置。若新管理部署失败，保留 stopped 现场与原配置/完整基线；旧 schema 数据不直接交给不兼容新业务 Host。若 Reset 切换后清理失败，报告该阶段未完成，使用原幂等 Receipt 继续管理操作；不能恢复供给或把旧库覆盖新事实。任何恢复覆盖数据库、Workspace 或配置均先核验文件现实、保留事故现场并取得明确范围授权，不自动执行回退。

唐顿与暗算 36 个本地集的证据矩阵已逐项记录，但没有用户逐集确认，不生成映射事实；合并/拆分、演员无候选、体积瑕疵仍为明确待决。风骚律师旧失败的具体底层 HTTP 状态不可恢复，新增证据链仅保证未来可诊断。高达/凡人歌隔离旅程用于规则验证；生产须等待正常采购，不强制调度。复机启动负载控制另议。

## Workspace 文件资格补充（开发中）

2026-10-27 Workspace 资格增量：真实隔离保留库发现两条历史 Libra/Registry 生命周期不一致，首次文件清理预检在任何复制/删除前拒绝。新增冷态 Libra Workspace 归档回执：保留原证据，不补造回收成功；撤销已退役 Subject 下终态 Run 的当前调度/文件保留资格，实际删除仍由 Operator 清单和 Receipt 证明。695 条归档在独立副本已验真，原 Workspace 状态不改，完整 FK/integrity PASS；新归档/保护定向 16 PASS，既有相关 25 PASS，混合 Series 完整 Operator、清理及两次 stopped 重开 1 PASS。最终 NAS 文件清理及固定候选资格仍待完成。

完整 af525 Architecture 首跑已结束：3404 total / 3377 PASS / 26 skip / 1 FAIL。失败位于整剧迁移崩溃夹具的 People 前置等待：正常窗口评分资料未结束即推进维护窗口。补齐正常阶段资料前提后两个真实中断场景 2 PASS；该复验不能替代最终完整 Gate，原失败保留。


归档模型首跑 4 项因测试夹具循环 FK 未在同事务创建而失败，修正夹具后通过；第一次对已归一化副本重复使用另一代际的完整归一化入口被 Procurement barrier 正确拒绝，未覆盖旧代际。随后独立复制后直接调用新的冷态 Workspace Owner 命令，695 条回执验真通过；不冒称完成新的全库重新生成或生产清理。
