# JAV 发布副本与历史核验证据

2026-10-15 用户明确要求跳过已准备的NAS临时隔离容器Linux测试。`shelfdeck-jav-qualification-462f153a`不创建、不执行；准备方案标记skipped-by-user。该决定取消此测试项的授权等待，不产生Linux文件Effect/候选镜像PASS，也不授权其他NAS或生产操作；原只读/内存级证据保持各自范围。

日期：2026-10-15。工作项：JAV-RELEASE。隔离 Windows 副本及 NAS 只读历史核验；没有 NAS 发布/停机/Reset、生产数据或用户测试材料处置，没有 Desktop 开发。

## 实际生产历史 Catalog 分层只读核验

新增独立工程Probe，以只读SQLite/query_only/同一read transaction读取既有200表源库，仅允许SELECT Repo Statement。复用当前CatalogPlanProofReader、FrozenCatalogHistory、public Repository/UOW及真实Projection注册定义；只核验Projection ref存在，不执行projector、执行器、Owner IO或业务协调。149个历史适用Projection定义本地构造通过，所有读取依赖在误调用时明确抛错，不提供假事实。130份当前代码/冻结档案以约5.7 MB stdin bundle在已有容器的新Node进程中检查，不创建NAS文件或新容器，不复制原始业务数据/Secret到日志。

初轮每个冻结Catalog最多3个实际终态Plan，12/12通过（1.89秒）；再按Owner+Work kind分层，四个冻结Catalog共101根实际Plan、27种Owner/Work类别全部通过（10.34秒）。覆盖Procurement观察/证据/候选、Libra身份/资料/Artifact/媒体/交付、Arca验收/入藏/维护/重复检查、Perception获取/解析，并沿既有验证器核验实际Plan、Work、Attempt、Event、Result、Effect、Marker及跨Work来源。记录`nas-terminal-plan-samples-20261015.json`、`nas-terminal-plan-stratified-20261015.json`保留边界及hashed Plan key，不输出Result payload。

另三个Catalog按当前composition中已有的精确retirement predicate核验，不新增档案/规则或模拟完整Schema证明。只冻结原函数/常量文本，没有启动runtime；非终态和需要执行注册的分支均无可用执行器。七Catalog合并分层检查156/156通过（11.60秒）：完整冻结图101，现有退役envelope55；`nas-terminal-plan-all-rules-20261015.json`逐类标明method。上述均为有界样本，fullQualification=false；没有全量Plan、Owner现场或完整生产副本资格。

随后再次只读核验生产：556 active Entries（554 Movie/2 Season），源Schema仍c00f45c1...、数据库3,133,046,784 bytes；6 active Libra、2 running Work/Attempt、20 reconcile_required Effect仍阻断完整副本资格，旧一次intended已不在最新聚合。这里只记录当前聚合，不把相同数量断言为同一批运行，也不擅自终止供给、处理旧责任或Reset。最新metadata `nas-release-readonly-inspection-20261015.json`，本轮终态Probe不代替这些资格。未运行候选Service、未改现有镜像/挂载/媒体/收藏。

## 大历史消息集的内存检查

2026-10-15真实规模补充：当前Kernel的只读Snapshot verifier在实际3,133,046,784-byte生产库完整通过（82.54秒），readonly/query_only及同一read transaction；核验原200表/99索引/22 partial unique、实际catalog digest、foreign_key_check、integrity_check、Guard、Outbox/Inbox及Material Control完整一致性。实际8,701 Outbox、8,609 Inbox、18,402 Control和29,830 Control revision；Linux Node20.20.2、256 MiB JS堆上限，结束heapUsed16,915,928/RSS123,006,976 bytes，没有OOM。仅stdin加载3份当前纯Kernel/编译/摘要模块及冻结Source Schema，不启动候选Service，不执行Domain/Owner IO、不写库或NAS文件；90秒超时/5秒强制退出保护未触发。结果`nas-kernel-readonly-integrity-20261015.json`，检查进程已exit0。

该实证闭合真实规模下原消息`.all()`内存风险的只读核验，但没有创建独立副本、执行200→202升级、启动候选Host或核验实际媒体；fullQualification=false保持，不能据此代替独立一致副本/活动责任门禁。之前138 MB有界复制/回退及末尾损坏负例仍为独立证据。

隔离复现：精确旧200表Schema中8,192条合法tombstoned Outbox，每条15,014-byte JSON，数据库137,990,144 bytes。原Kernel只读Snapshot检查使用`.all()`同时加载全部消息，独立64 MiB堆子进程exit134/heap exhausted。改为逐条`.iterate()`，仍逐条核验完整payload digest、消费者集合和ack/Inbox关系，不跳历史记录、不改领域责任；相同数据/限制独立检查exit0，耗时3.1秒，结尾heapUsed25,424,512 bytes。

新增持久回归在64 MiB堆下检查全部8,192条，再篡改最后一条digest；明确返回`P3_SQLITE_OUTBOX_CONSISTENCY_DRIFT`。Operator、Kernel、Outbox/Inbox组合22 pass/0 skip/0 fail（10.0秒），日志`release-bounded-memory-tests-20261015.log`。这是可复现内存缺陷及有界处理证据，不能替代真实3.1 GB生产一致副本和完整历史语义资格。正在运行的318文件整合早于该Kernel改动，不作为这项变更的最终整轮证明。

随后扩大同一64 MiB堆回归：实际完成只读检查、200→202副本生成（全部199旧表、8,192条Outbox完整row digest）及未变事实回退资格（199表），再独立拒绝末尾篡改。首轮负例子进程参数`inspect`被Node识别为debugger命令，修正测试参数分隔与模式名；未修改业务检查。最终组合22 pass/0 skip/0 fail（26.6秒），日志`release-bounded-memory-tests-verified-20261015.log`。当前P3结构专项202表/102索引、P2 aggregate b61d66725c9f5145a08fc7b4a71915ae4f138d9a951f24c2d8eee3501870712d、源码边界/语义及diff检查通过；结构专项不称完整P3聚合。

## 离线 Operator

`media-service/scripts/helix-jav-schema-copy.js` 只读精确 200-table 源库，在新文件生成 202-table SQLite snapshot；逐表核验除技术 schema marker 外全部 199 个原表的列、行数、完整行集摘要，新增四列为 NULL、两表为空。它保留 UTF-8、opaque Secret reference 与 SQLite 64-bit integer，不输出 Secret 内容。目标私有事务结束、checkpoint 为独立文件并刷盘后，使用独占 hard-link 发布；已有目标/发布时抢占/路径别名均不覆盖。失败不发布目标，不改源库。

只读 inspection 拒绝未完成 Formation/Procurement、Arca责任、Work/Attempt/Event、未收口 Effect/Outbox。rollback-check 只证明回退资格，不执行恢复；已有行变化、任一新列非 NULL 或新表有事实都拒绝。源 Kernel startup 严格准入保持，没有自动升级或旧 Formation 兼容。

命令接口：

```powershell
node media-service/scripts/helix-jav-schema-copy.js --source <snapshot.sqlite> --inspect
node media-service/scripts/helix-jav-schema-copy.js --source <snapshot.sqlite> --target <new.sqlite>
node media-service/scripts/helix-jav-schema-copy.js --source <snapshot.sqlite> --rollback-check <new.sqlite>
```

8 项 Operator tests 及 6 项 Kernel tests 通过；晚期真实 SQLite 插入失败、目标抢占、非 NULL 新列、事实变更、hard-link alias、旧未完成 Work、Catalog 篡改、CLI 与 Secret masking 覆盖。结构 fixture 不代替真实历史 Host 资格。

## 真实上一发布数据集与完整副本

从 `git archive da23711dd1ed03e68fca22f30c3fe304a3c25f32` 导出上一发布源码，在新临时目录运行其真实 Host；使用实际生成的 1080p/HEVC/Matroska 视频、实际 JPEG、受控 TMDB 描述响应和公开 Admin API。媒体 Probe、播放核验与 On-deck 物理链路实际执行，形成一个 active Movie Entry、一个原 On-deck Commit 及三份正式材料。随后通过原公开安全停机接口收口并关闭 Host。原库实际 DDL 为 `c00f45c15c5540e158a688c32fd4b57fdbc146b1a28067f0ac7fe82c496d0d5d`；Operator inspection 没有 blocker。

完整新副本复制 runtime 文件与加密 Secret，数据库由 Operator 重建而非改旧 marker；新 runtime-generation 文件绑定已验证目标。启动前 rollback-check 验证 199 表完全相同，eligible=true/applied=false。当前 Host 保留 stopped intent，public health 200；原测试会话按原签名协议由原加密 Secret 形成，在新 Host 通过认证并查询原收藏。这里证明既有 credential/session 连续性，不声称重新找回或公开了原 API key。

最初 resume 被 23 项 PLAN_CATALOG_DRIFT 正确阻断；这暴露了已归档 Movie Catalog 未包含本次真实上一发布 Catalog 的缺口。没有改旧 DAG、Result、Witness 或放宽 current Catalog gate。按 Source commit 捕获实际 87-capability Registry/Policy、1134 Schema，冻结独立 archive；Typed完整 Record Evidence 强制等于实际 Result，其独立 schema/producer/Marker/Effect 仍核验。

最终独立副本公开 resume 202→running/normalSupplyAllowed=true，经过 31 秒完整后台周期后仍 ready、无 runtime error、Collection 200。原 Entry ID、Canonical revision 1、原 package、唯一 On-deck Receipt 及视频/poster/NFO SHA-256 保持；源库 SHA-256 保持。People 既有精确人物关联刷新建立 Inventory revision 2，identity/metadata/cast 三份 fact digest 全与 revision 1 相同，原影像未重新加工；不把该正常 revision 变化误报为迁移篡改。没有在有新增事实后恢复原备份。

脚本、完整摘要及早期失败诊断保存在 ignored `.codex/jav-development/`：`published-movie-fixture.json`、`published-movie-upgrade-qualification.json`、`published-upgrade-recovery-diagnostic.json`。未将 runtime 数据或 Secret 导出进仓库。

## 回归与未关闭项

2026-10-15 后续实测：同一上一发布源码另产生一个真实两集 HEVC Season，通过原 TMDB Adapter 的受控 show/season/episode 响应、实际 Probe/播放/资料至原 On-deck Commit。完整升级副本在当前 Host 通过旧会话、Collection、公开 resume 和 31 秒周期，最终 ready/normalSupplyAllowed=true；原 Entry、Canonical revision、原 package/唯一 Commit、两视频及 Season/Episode NFO/海报 SHA-256 保持，源 SQLite 字节保持。人物关联正常刷新 Inventory，不能声称所有合法新 revision 都被冻结。摘要为 ignored `published-series-fixture.json` / `published-series-upgrade-qualification.json`。

Movie、Series 均实际演练无新事实的完整备份恢复窗口：先创建/独立验证完整 runtime backup，再从同一源产生未启动新版副本并核验 199 表相等；只向新空目录恢复备份，用旧发布 Host 保留原 credential/session 查询收藏、公开 resume→running，确认旧 schema、原唯一 Commit、源库和媒体字节保持。没有覆盖原源或已使用的新副本。两个已恢复运行、已有新事实的新版副本随后都被 rollback-check 拒绝 `JAV_SCHEMA_ROLLBACK_CHANGED_FACTS`，没有执行备份恢复。实际摘要为 ignored `release-rollback-window-qualification.json`。这证明隔离样本的恢复路径与门禁，不等于 NAS 停服发布或混合生产数据规模资格。

本机 Linux 阻塞已只读重验：Docker Desktop backend 因 Secrets Engine 的 `engine.sock` 初始化失败退出，版本查询长时间无响应；仅 docker-desktop WSL，没有另一个可用 Linux 测试环境。只结束了本任务的悬挂只读查询进程，未 Reset Docker、删除 socket/配置、改镜像或容器。Linux 资格仍开放。

- 完整架构初轮：2708 tests，2672 pass / 24 fail / 12 skipped，P3 未通过；失败文件的过期计数、完整身份 fixture 和 Retry 新 revision 已精确修正。16 个相关文件最终复验：235 tests，230 pass / 5 skipped / 0 fail。原 Witness digest 及严格负例保留。
- 新发布历史档案/完整 Record Evidence 与既有边界负例：69 pass；结合 Startup/Operator 的最终组合 101 pass。
- Operator/Kernel/P2 组合 17 pass，运行/Startup/Operator/Kernel 组合 46 pass；清单 121/104/202/49 保持。
- 包依赖和 forbidden semantics 扫描通过；`git diff --check` 通过。

最终 P3 聚合已在原 session 31706 收取 exit0，`persistence-final-after-release-20261015.log` 为 `ok:true`；317 个架构 fixture files，202 tables / 102 indexes / 23 partial unique，121 capabilities / 104 Result families / 49 transactions。49 项 revision fence、14 项 Control CAS 与 52 个 crash fixture bindings 通过；aggregate c5b16223e6a5b4743e7f2a558e1a88333bdb1b0d6fe82caf2da6a046c249b454。此结果证明当时整合版本；随后新增的 no-effect Observation 源码须用增量证据验证，不追溯计入本次聚合。

仍须完整混合生产数据规模与标准发布停服窗口、Linux/Docker、具体版本 UI 负责人、异常恢复交互和 CID 等残余。Movie/Series 两个隔离样本及备份恢复窗口不等于完整生产升级/回退 PASS，本轮不宣称可部署生产。


## Recovery Intent当前203表版本隔离复验

2026-10-15 当前Source Map/P2为121/104/203/51，aggregate 1b6cbca95f6f84ebfc796a4c3c24a1bd28928b4da3306c90a77423780c3ca7f2；SQL digest仍为ccef6a14c90620fa9e861ce9f860f66b5b92146f1028cc40467cc614715a9f90。Movie、Series从冻结发布200表源分别建立新完整203表副本，旧会话保留、公开resume 202→running，31秒后ready/normalSupplyAllowed，Collection200/唯一原Commit、原媒体及源SQLite SHA保持，runtimeError=null；当前资格JSON为published-{movie,series}-recovery-upgrade-qualification.json。没有对生产数据执行复制或升级。

两类源另建立独立backup/未启动新副本/全新restore目录，用原发布Host验证原credential/session/Collection/公开resume及唯一Commit，原schema c00f45c1...、199业务表相等、原媒体/源库保持。已开始写入新事实的当前203表副本被rollback-check以JAV_SCHEMA_ROLLBACK_CHANGED_FACTS拒绝；未恢复覆盖该副本。recovery-current-rollback-window-qualification.json、recovery-rollback-window-current-final-20261015.log为两个通过记录。首轮工具误读旧202表used-candidate证据，被严格schema检查拒绝，修正本地测试工具输入/新目录后复验，未放宽任何产品检查。

当前Windows独立Service包重新构建在任务独有temp目录，通过真实node.exe启动203表/147route Host、六条公开Admin查询（含独立Correction列表）、SQLite/Sharp/FFmpeg及require cache全部包内来源。windows-recovery-service-package-qualification.json、windows-recovery-current-qualification-20261015.log；无Desktop开发。完整Service670 tests=641pass/29既有skip/0fail；这些skip不算JAV必需链路通过。架构全输入整合仍在运行，具体版本UI待负责人；NAS临时Linux测试skip by user，实际混合生产一致副本及镜像发布资格继续开放。
