# 部署残余容量清理收尾（2026-10-28）

工作项：DEPLOYMENT-RESIDUE-CLEANUP。用户明确要求恢复之前暂停的vol1/vol2容量清理，完成后再开始本轮业务实施。本次不部署、Stop/Resume/Reset、不改业务库或媒体，不重建观察。

## 完成范围

1. 续作原部署残余精确清单：99文件全部结束。原回执记录57项，另1项已有持久unlink意图且实际不存在，本次恢复该项记账并实际删除剩余41项，逻辑50,308,212,736 bytes。
2. 回收Stash Sense已完成安装的两个运输包，共3,191,932,661 bytes：`/vol1/1000/docker/stash-sense2-eval/stash-sense2-0.48.1.tar`和`assets/stash-sense2-data-2026.10.09.zip`。删除前完整核验包SHA、已安装数据库7文件和3模型SHA及已加载镜像身份；模型、数据库、应用配置、样本、测试证据保留，镜像tar本机副本保留。
3. 通过Docker正常CLI、不使用force，移除7个无任何容器引用的已退役中间镜像标签：`7fee96508`、`e69a98bd4`、`101ce2fe0`、`e6c817319`、`45b5bfe82`、`e2cc23c81`、`ba75692d4`。逐项绑定原image ID和唯一RepoTag，删除前重新检查全部容器引用。

本次实际unlink文件43项，另恢复1项上次已删除的回执；原99项跨两次作业的累计逻辑删除159,674,790,648 bytes，不能把该累计数报成本次新增释放量。7个镜像的显示Size也不相加冒充实际回收空间。

## 容量实测

以下为NAS `df -B1` 的Available，采用十进制GB；生产持续运行，差值为作业前后净增，不等同所有删除对象的独占物理字节。

| 卷 | 开始可用bytes | 最终可用bytes | 可用空间净增bytes |
| --- | ---: | ---: | ---: |
| vol1 | 69,749,297,152 | 73,143,894,016 | 3,394,596,864 |
| vol2 | 278,343,237,632 | 293,306,990,592 | 14,963,752,960 |

合计净增18,358,349,824 bytes，约18.4GB。最终vol1使用率61%、vol2为43%。两卷为Btrfs，逻辑文件大小、Docker虚拟镜像大小与Available独立报告。

## 保留与保护核验

- 原qualified plan的4,758个保留文件/链接，逐项stamp或link target前后完全一致，全部完整备份档案保留。
- 原Reset档案、原代际/回执、People恢复证据及当前版本完整冷备保留；没有把父备份目录递归清空。
- 当前镜像`a2bf2d6fd`、上一版本`6ad98f1f6`、Reset版本`b0c32d0e9`、Reset前恢复版本`e78dbd82f`及Stash Sense 0.48.1均按确切image ID保留。其他未列入本次清单的镜像没有顺带删除。
- 12:36:50Z冻结732条正式On-deck Commit回执；12:46:08Z逐行独立反查仍732条，changed=[]，收藏数732。Workspace根及活跃Artifact无退役目录引用；未运行全库FK/integrity检查，不以该摘要检查冒充全库审计。
- 17个既有容器逐项比较ID、image、StartedAt、Restart/OOM及规范化挂载，changes=[]。挂载数组顺序造成的原始文本差异已按Destination规范化后确认没有语义变化。
- ShelfDeck仍为容器`1792e7209ca39dcd83eb64d91107803bb7bdf234103a4d5b00d4381bf1d29493`，image `sha256:894a07fd5c178536bebecc4d3dfb3951c9d225d217c62c2c2db2c49f8f4696df`，StartedAt仍2026-10-27T06:15:12.736819591Z，Restart0/OOM=false。health为ok/normalSupplyAllowed=true。
- 根目录、home和应用根owner/mode未变；fnOS管理页HTTP200。既有flight-tracker unhealthy未改变，没有作为本次故障处理。
- Stash Sense实验容器保持原停止状态，没有在清理中落实未来常驻配置。

未删除来源文件、正式收藏文件、当前工作区、生产SQLite、凭据或其他应用数据；未手动编辑Docker storage，未执行全局prune。

## 路径、进程及回执

SSH始终通过`tools/nas-ssh-config.js`，用户gezhu。Operator固定当前镜像，独立network-none/read-only容器和精确挂载；只对清单文件unlink，不递归删除目录。路径均在操作前解析、检查非链接及实际子卷边界。

- 原plan SHA256：`3af3aa37b93fd777954fa9ca038d8a1688a637146f8d095aad98c6c04837742b`。
- 原Host FD新证明：615进程/4966 FD，1项退出竞争，无不可见错误、无待删文件占用。
- 补充清理Host FD证明：576进程/4959 FD，1项退出竞争，无错误/占用。
- 原清单最终receipt SHA256：`cd45e223f0fa34c19bb194940f85d815a7b1e158c8708f2c9177462840f7e190`。
- 补充plan SHA256：`bf0a30c0ba9659c955096891b0fe34480d69211c086485c29911384e1670d32e`。
- 补充receipt SHA256：`083947fd3853d3f39a030f529716bad72ae7e3bfdb5d960cc6487838ea88b1d1`。

NAS原始plan、receipt、生产前后摘要及FD证明保存在`/vol2/1000/shelfdeck_backups/deployment-residue-cleanup-20261027/`；本机执行脚本、首跑失败、复验及最终summary在ignored目录`E:/my_project/emby_third_party-helix/.codex/capacity-cleanup-20261028/`。运行JSON不加入仓库。

## 保留的失败与修正

- 上次因回执临时名只使用PID，容器内重复PID7撞上既存`cleanup-receipt.json.7.tmp`而中断。本次保留旧临时文件和失败日志，原子保存使用随机UUID，校验旧回执digest、pending与实际文件后续作，没有从头重删。
- 补充清理首次把文件设备号与`/vol1`顶层比较，因fnOS应用子卷设备57、顶层设备56而在任何删除前拒绝。目标所有stamp一致；按已解析应用子卷设备57重验，原inode/size/mtime/ctime及全文件SHA要求保持。首次拒绝日志未抹去。
- 本机首次汇总命令因shell引号解析失败，没有NAS副作用；改为独立CJS读取原始日志并汇总，最终容器/容量汇总通过。

容量清理前置现已完成。后续按本轮唯一Phase顺序先推进7条剧集的恢复合同及修复，不因本次清理宣称这些业务问题已解决。
