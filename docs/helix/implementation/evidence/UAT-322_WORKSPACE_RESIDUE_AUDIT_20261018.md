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
| `.prod065-preserved-20260907` | 2文件、27,506,629,081 bytes，25.6175 GiB | 历史明确保留目录，不当作无主垃圾 |
| `.upgrade-backups` | 17文件、10,493,327,756 bytes，9.7727 GiB | 三份Series升级备份，另有历史发布证据；未授权删除 |

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
