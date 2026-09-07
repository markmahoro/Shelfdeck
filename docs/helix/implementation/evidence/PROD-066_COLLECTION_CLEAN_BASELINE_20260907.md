# PROD-066 收藏干净基线审计

2026-09-07。用户授权 Libra/Arca 审查、逐 Movie 核验、直接数据库基线清理、未完成 Formation Reset 和最后的残留清理；原始源删除另行逐条授权。沿用此前生产停线，不修改 SSOT。

## 结论与边界

生产停机数据库已建立 43 部 Movie / 369 个当前 Inventory 文件的基线，退出 11 部不满足当前一致性验收的记录。54 部原电影均有可读主文件；未发现不可恢复的源清理条目。退出的电影保留在 Field 的物理文件中，待恢复后重新观察/采购/Intake。

当前镜像仍为 `markmahoro/shelfdeck:helix-beta-20260907-5565a03eb2`，image ID `sha256:804e02a59df72f99c1c20d68630b2902c6fa166315968eae4f2f85a31e539988`。本地修复没有部署，服务没有启动；不能宣称新的 Intake 或运行态闭环已验证。

## 全量核验

- 54 个 Active Shelf Entry、451 个当前 Inventory member：均存在，3 个 NFO 的当前字节指纹与 Binding 不一致；其呈现语义一致，但绑定事实不干净。
- 54 份 NFO 可解析且必要字段存在；其中 8 份未覆盖当前接受的演员关系，现有 `compareMovieNfoPresentation` / Final Inventory 验证不接受。它们不是主片缺失，也不是完全没有 actor 字段。
- 54 次 FFprobe 通过；每片 5%/50%/95% 的音视频各 0.25 秒采样，共 162 次通过。4 个中段采样有 null muxer 时间戳警告，无解码失败。没有做全片逐帧解码或全字节视频校验。
- 93 张 poster/fanart 由 Sharp 完整解码通过。5 部媒体参数与普通要求不同，但具有匹配的 Authorized Defect Manifest，属于合格保留范围。
- 用户前序指出的四个旧目录已与最终 Inventory 路径区分；实际最终主片/NFO/图片存在，旧目录不能作为最终上架事实的唯一证据。
- 当前控制、Entry/Deck 指针、重复纳管路径、SQLite/FK 均检查；发现 20 条已 Commit Custody 的旧 Stage NFO 控制以及 9 条无 Custody 的孤儿控制。

## 代码审查与修复

1. On-deck Stage 取得 NFO 控制后，合法的同文件语义重写会改变 Physical Material Key。原 Commit 只考虑原 Package/Off-load 及最终身份，漏掉 Stage 中间身份，导致已 Commit Custody 留锁。现从当前 Work 的成功 Stage Manifest 取证，验证 Run、Product、manifest digest、source member 和同 mount/inode，加入同一 Commit 的精确 release；其他文件、其他 Custody、非同文件漂移一律拒绝，不添加历史兼容或全局扫描。
2. Formation Reset 只对反向孤儿闭包做重叠仲裁，仍保留 Intake 的旧/新 Candidate 会同时重新占用同一 material_key。生产副本复现唯一约束错误。现将选中 Intake 的闭包与反向孤儿统一分区，仅恢复最新无冲突 Candidate，保留已 Commit 或被新 Reservation 覆盖的历史闭包。
3. NAS Reset 增加 `--keep-stopped`，查找停止状态的镜像并在结束时确认仍停止。默认重启流程保持；本次候选数据库使用本地修复后的 Reset 在隔离辅助容器内处理，未把旧镜像 Reset 误称为已修复。

前序 NFO 呈现/typed Settlement 失败/逐文件 Settlement 的实现与回归沿用已部署版本，本轮没有恢复目录删除或放宽 Final Inventory 验证。旧失败记录不作为新缺陷的自动证据。

## 数据处理与保护

先完成只读全量取证，再复制完整 data 并核对数据库 SHA256。候选副本以单事务精确删除 11 个 Entry 的 Arca 外键闭包、对应执行图；调用正式 Formation Reset 删除其 11 个关联 Subject 加 7 个未完成 Subject/Run；清理精确异常控制。保护其余 43 个 Entry 的事实、所有当前控制、Shelf/Standard/Policy 等范围外行；外键检查在事务内执行，失败即回滚。

候选库通过后在服务仍停止且源库/备份/候选 SHA256 均未变化的前提下替换生产库。没有执行业务 Off-deck 删除，也没有伪造 Off-deck 或 Shelf Deregistration 回执。

- 原数据库 SHA256：`e234a68a8cca029ed028dd9285f13c0e0b9a1f5bb50faddc13e35c8743c98100`。
- 安装后数据库 SHA256：`0fb882495cff216ba0c835afd038395761b2bc9020ddb45f4bd2820377120d4c`。
- 回滚目录：`/vol1/1000/docker/shelfdeck/backups/formation-reset-20260907T120253Z/data`。
- 结果：43 Entry；369 当前 Material/Control；18 Subject/Run、13 Package/On-deck Run 清理；21 Delivery/Reservation 重新开放；Reset 再次检查无可清理的活动范围。6 个被新 Reservation 覆盖的历史闭包按既有分区规则保留，不重复开放。
- SQLite integrity=ok、FK=0；独立生产文件复查 369/369 指纹匹配；Libra/Custody 当前 Material Control 均为 0。
- 保留 20 条已失败旧 Settlement Work 的历史 reconcile 记录及 1 条停机时执行中的 Aftercare workspace_write；前者对应已完成上架过程的旧尝试，后者需恢复调度后按既有恢复语义处理，均未改写为成功。3 个停机中的 Arca Work 和 1 个 Field Observation Work 未冒充已完成。

同一历史 Procurement Run 包含 839 个 Candidate，不能按整批删除。旧 Candidate 的原路径可能已经失效；重开后由现有 Intake Material Verify 正式拒绝不再可用的输入，Field 新观察针对保留的实际电影重新采购。此为代码与静态资格核查，停机状态尚未实际运行该链路。

## 最后清理

删除 33 个旧数据库快照目录（约 31.0 GB 内容）前，将其中 448 个非数据库文件复制到本次备份的 `retained-support` 并逐文件 SHA256 校验，保留约 536 MB 支持文件，包括可能独有的 NFO/凭证。删除 4 个数据库已无 Workspace 注册的生成目录，约 68 MB；保留另一个仍有来源责任的目录。原始媒体挂载未以写方式提供给清理容器。

逐片条目、完整路径、数据库导出和运维脚本位于本次 worktree 的忽略目录 `.codex/audit/`，未加入 Git。本文只记录聚合结论、边界和校验身份。

## 验证

- Windows `npm test`：489 PASS、18 条件 SKIP、0 FAIL；架构测试与合同/依赖审计通过，findings=[]。
- On-deck Control 和 UAT-131 缺陷准入全链路定向验证：10 PASS；Reset 原套件及新增重叠 Intake 回归通过。
- Linux 生产镜像中的实际数据库副本演练及安装后独立复核通过；补充测试的初次 2 GiB scratch 低于 Workspace 所需 5 GiB，触发正确的等待空间。Windows 临时路径 Reset 单测不满足 Linux 必须 `/transcode` 的保护规则，不能把这类夹具拒绝解释为生产 Reset 回归。
- Linux 提供 16 GiB 临时空间后，定向 Control 和 UAT-131 四种缺陷准入/重启/正式 Commit 场景合计 10 PASS、0 FAIL，30.2 秒。测试只写隔离临时数据；没有启动 ShelfDeck 或执行新的真实媒体流程。
