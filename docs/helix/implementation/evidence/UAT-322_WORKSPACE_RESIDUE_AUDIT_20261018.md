# UAT-322 Workspace 历史残留只读调查 — 2026-10-18

状态：根因路径已定位；未修复、未清理。用户本轮仅授权生产只读排查。
现场 `192.168.12.230` shelfdeck `markmahoro/shelfdeck:bfd97f36a`、RestartCount=0、health ok/normalSupplyAllowed=true。
SSH gezhu，通过统一nas-ssh-config；不输出凭据。调查约北京时间09:56–10:10，生产继续正常运行，数值为动态采样。

## 空间分布

`/transcode`映射`/vol2/1000/shelfdeck_transcode`，所在卷总约477 GiB、可用约149 GiB。
只读递归stat/lstat（不跟随symlink、不读取媒体字节）并核对SQLite readonly Owner行：

| 分类 | 数量/大小 | 判断 |
| --- | --- | --- |
| 当前active Run Workspace | 8目录，约7.55 GiB，随在途转码增长 | 正常在用，不能清 |
| superseded旧Run Workspace | 4目录、11文件、75,333,165,878 bytes，70.1595 GiB | 旧Run已替换，无open Work；Workspace仍active，引用仍working，无Cleanup Scope |
| discarded/reclaimed残留 | 12目录、54文件、387,713 bytes | 主要NFO；登记状态未同步，容量影响可忽略 |
| `.prod065-preserved-20260907` | 2文件、27,506,629,081 bytes，25.6175 GiB | 带preserved标记的历史目录；用途未作完整复核，不当作无主垃圾 |
| `.upgrade-backups` | 17文件、10,493,327,756 bytes，9.7727 GiB | 三个Series备份目录，其中cab3e2d77有历史发布证据；未授权删除 |

同卷`/vol2/1000/shelfdeck_upgrade`还占186,032,857,088 allocated bytes（约173.26 GiB）：
6个外部下载/整理落地目录，最大「疯狂的麦克斯：狂暴女神 (2024)」约85 GiB。
这是MoviePilot/外部Landing范围，不是Libra Workspace孤儿；本轮不删除，也未宣称已查清其Provider任务保留用途。
`du`的allocated与文件logical bytes及`df`口径不同，不能相加冒充精确卷对账；卷其余差值未作归因。

## 大体积旧Run

| 影片 | Workspace ID | 旧Run ID | 大小 | replacement Run |
| --- | --- | --- | --- | --- |
| 倩女幽魂 (1987) | `16564772fb6ee1ea4f7b909e8b6628cb77ee837aef6799e80c2eb407eef46576` | `c8f2048166106a46a55eb56ed66ada6a6a709bbd27fd5a1f5d315ed49133963e` | 16.4371 GiB | `edd8fa5d16bc3b1987d5d3015df1e96a0fdb6a397e50e4666250b9055d7f39c0` discarded |
| 特工 (2018) | `97854596546f76479b0becb9ee68914bf4f09aaf9dedb865f37698ffca0f4758` | `4beb07700fbd692ef919ded9cf907d4e01e613a60db34277a1dbbb04ee3394ef` | 38.6876 GiB | `7dae5b62ae7d87d95c8cabb446ac8683bef86117fff0901a1e3ba5338508a524` completed |
| 决战犹马镇 (2007) | `d97f54a7f57af23aa8949459c0c6b8d791c915b9499fd9c6ffbd37766ce936af` | `cad37780a55625503b2547b5bb3322c032a3963c4ae93e82eddb28b8cc5bcc1e` | 15.0344 GiB | `6abeaab24deda59e99a85a351b552a1029143717ddb019d555cca8f128cd90ae` completed |
| 霍比特人2 | `ce577a4cee5064f36a608f910c076f440a40856a3bd4391641139bc82b4bab03` | `86802a7ec1a3b9e4acc33c80af71a92722c0b772a6c33f8c627fa17a3684ccd6` | 0.00035 GiB | `0e48ef17bb178ae096abd5b259151432f23bc928574e8c9e89fbec8edb29fa6d` completed |

这些旧材料material_key未被其他Run input manifest引用；这不是完整删除授权/Control与未决Effect闭包证明。
大文件旧mtime在09-23左右，不是本轮44小时中新转码产生的积压。活跃Run和已入藏材料未改动。

## 停滞路径与边界

`movie-responsibility-closure-coordinator.listDiscardedLeftoverWorkspacePage`选取active Workspace的discarded/superseded Run。
`reconcileDiscardedLeftoverWorkspace`先尝试已有active Cleanup Scope；如果没有而仍有non-released Reference，返回
`has_workspace_references`，不会走unreferenced reclaim。现场这4个Workspace正是：旧Run superseded、引用working、无Cleanup Scope。
因此它们不会被现有兜底清理释放，符合Owner清理准入遗漏，而非Scheduler公平排序没有轮到。
SSOT已有superseded cleanup合同；后续修复应在Libra Owner内建立合法Scope、逐Reference/Control/Effect闭包和正式Reclaim，不以删目录/改状态绕过。

## 对国产剧的影响

现有空间准入为整季Primary大小×1.2+5 GiB：沉默的荣耀158.79、情满四合院164.15、甄嬛传242.58 GiB。
当前约149 GiB不足；若仅合法释放70.16 GiB旧Run残留，粗估约219 GiB，可解除前两项的空间门槛，仍不足甄嬛传。
这是容量估算，不是实际清理/准入成功证明；并发生产、正式占用与后续安全门禁仍须重验。

所有生产动作均为docker inspect/health/readonly SQLite/stat/lstat/du；没有restart、Stop/Resume、配置保存、UPDATE、媒体读写或删除。
记录本地查询失败`no such column x.libra_run_id`后按已读schema改为r.libra_run_id重跑，未执行任何写SQL。
后续清理需形成精确当前清单、完整引用/Control/Effect复核及用户生产处置授权；历史备份和Landing不混入同一删除范围。

## 2026-10-21 深度定位（只读，未修复）

用户要求再次深度定位。北京时间02:42–02:44，生产仍为`helix-beta-20261020-af2257c423`，容器运行约7小时；代码核对使用干净的`codex/us-adult@1b7b683e0`。生产四个关键源码文件SHA256与该工作区完全相同：closure coordinator、cleanup contracts/store、run admission store。本节不继承10-18现场作为当前状态。

### 当前现场

- 4个有文件的旧Workspace仍是上表的精确ID，共11文件、75,333,165,878 logical bytes（70.1595 GiB），与10-18相同；只读递归lstat没有发现symlink，没有读取媒体内容。
- 4个旧Run均`superseded`，Workspace和Foundation Registry均`active`；10个current Reference均`working`，Cleanup Scope均为0。3个大目录在09-23已终结，另一个小目录在09-28终结；对应replacement已完成或discarded，旧Run的Acceptance Spec与replacement不同，terminal revision均保存`LibraRunAdmissionDecision@1`。
- 对上述4个旧Run，open Work=0；其Foundation执行图中的`intended|effect_observed|reconcile_required` Effect=0；目标Reference material key没有其他Run input manifest成员，也没有其他Workspace的current non-released Reference。10个Reference material key当前没有Material Control row；Foundation material registry仍为active，登记11文件的总字节与物理stat相符。此检查不是全Owner/全Control/所有物理别名的删除资格证明。
- 另有第5个`superseded/active` Workspace `593accec5b38077bdbe9e766649654ac5a9940e7edb8f679523f0e3928bffa12`，无Reference、2个Foundation material已reclaimed、目录ENOENT，仅剩登记状态未收口；不计入70.16 GiB。
- 同库已有631个`offload_completed`及78个`run_discarded` Scope完成，`run_superseded` Scope为0。因此有证据表明另外两条清理路径有实际成功记录，不能把本问题归为整个Reclaimer失效。

### 精确根因：superseded准入链没有实现

1. `run-admission-store.js`的replacement事务把旧Run及immutable revision写成superseded，并建立双向replacement关系；它没有释放旧Workspace Reference。保持旧引用等待合法清理是必要的，不能把Run终结直接等同于允许删文件。没有Outbox本身也不是本缺陷：当前合同允许后台以durable事实补偿发现。
2. `movie-responsibility-closure-coordinator.js:642`的后台枚举确实包含discarded和superseded旧Run；`:667`的reconcile只会续跑已有active Scope，或在完全没有non-released Reference时调用unreferenced reclaim。`:680–681`一旦发现自己的working Reference就返回`has_workspace_references`，没有为superseded建立两轮审计或新的Scope。该保护分支本身不能删掉。
3. `workspace-cleanup-contracts.js:84`只有`buildOffloadAdmission`，没有superseded Decision builder。`workspace-cleanup-store.js:660/684`写trigger时无条件解引用`triggerSnapshot.offloadCompletionFact.factId`，`:858`的trigger lookup也固定offload；因此不能仅在coordinator换一个triggerKind就补全本链路。
4. SSOT §8.6.21及WorkspaceCleanupScopeAdmissionDecision已经明确要求superseded variant：读取immutable old Run终态与互相一致的replacement relation，间隔至少一个Reclaimer周期的两轮外部引用/Control审计；以old Run ID、terminal revision/digest作trigger，grace=0。表合同允许`run_superseded`，实际应用实现没有传播这个variant。

于是形成固定停滞：旧Run已替换 → 自己的working Reference仍存在 → 无Scope → leftovers拒绝无引用回收 → 没有合法删除Evidence/Reference release的后续动作。反复扫描、等待24小时、调整公平优先级或新Run完成都不会补建缺失的Scope。此缺陷也会影响将来新建且产生同样replacement状态的条目，不能只当旧数据不兼容处理。

### 维护窗口与复现证据

当前`maintenance-admission-policy.js`将`discarded-workspace-leftovers`和`completed-workspace-reclamation`归入每周维护；已有active Scope的逐项清理为safety类别。窗口外暂不扫描是当前正常调度，但即使进入窗口仍会命中上述guard。维护窗口不是旧残留形成的根因。

在本地用精确coordinator、正式schema manifest和仅返回Scope/Reference样本的只读UnitOfWork替身复现：单个superseded旧Workspace、working Reference、无Scope，时钟分别推进1/2/3天，三次均返回`has_workspace_references`、reclaim port调用0次；仅将样本Reference追加released revision的对照才到达unreferenced reclaim替身。没有创建实际清理Scope或删除文件，也未在生产运行reconcile。此项证明控制流停点，不冒充完整SQLite/文件Effect或未来修复验收。

Windows既有专项`p14-workspace-cleanup-audit.test.js`和`p9-run-admission-store.test.js`共10 PASS/0fail/0skip（约1.02秒）。现有测试分别验证offload双轮审计、replacement事务及保护，没有覆盖“有working Reference的superseded Workspace自动建立Scope”组合旅程；通过不否定本缺陷。

原始现场和复现脚本在主工作区ignored `.codex/uat322-deep-production*-20261021.json`及`.codex/uat322-control-flow-repro.cjs`，不提交运行数据。

### 修复边界与未完成项

后续应在Libra Owner内补齐superseded trigger构造/原子准入和后台调用，沿用现有逐member删除Evidence、Reference/Control release和Foundation Registry收口；另对无Reference且目录已消失的Workspace核对登记收口路径。必须覆盖replacement仍运行、外部引用/Control变化、未决Work/Effect、重启重放和范围外保护，不能直接放宽`has_workspace_references`或伪造offload事实。

本轮只更新定位Evidence；没有修改产品、部署、Stop/Resume、生产配置或数据，没有清理Workspace。UAT-322保持开放；70.16 GiB是文件logical size，不等同于已经证明的可释放allocated空间。

2026-10-21 用户确认：“行 这个要改 你先记一下”。状态转为已确认待修复，本轮只记录，不启动实现。后续按上节既有合同补齐 superseded 正式清理链；本次确认不包含生产部署、文件删除或数据清理授权。
