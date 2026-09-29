# UAT-280：Beta Movie 工程工作区与废弃副本清理

日期：2026-09-30。**部分完成**：NAS工程副本清理完成，14个本地Git worktree已退役；本地独立副本删除被自动审批阻断。用户明确要求先完成 Beta Movie 工作区清理，并扩展至无用副本、备份以及生产环境上的无用工程副本。

范围：本项目退役 Git worktree、已结束的本地/NAS测试数据库副本、旧发布镜像包及本项目旧镜像。删除前冻结精确清单并重新核验路径、归属、引用、身份与恢复职责；保留源码/未提交修改/独立提交、必要Evidence、当前及必要回退镜像、事故恢复备份和真实媒体。授权不包含生产数据Reset、媒体清理、业务Workspace手工回收、服务重启或其他项目Docker清理。

当前工作分支 `codex/beta-closeout-series`，前序收尾提交 `547e70786`；主工作区、集成区及failure-release-check有未提交内容，保留原工作区。最高原UAT为279，本项接续280，Series准备279仍保留；本项未全部关闭。

## 现场与保留边界

NAS：`192.168.12.230` / `303NAS`，SSH配置通过`tools/nas-ssh-config.js`加载。应用根`/vol1/1000/docker/shelfdeck`；Docker engine根不直接操作。生产镜像`helix-beta-20260928-c147188485`，StartedAt `2026-09-28T15:19:12.747534143Z`，RestartCount0，health200。清理前vol1约85%使用、可用29,065,129,984 bytes。

盘点37个Git worktree，包括主工作区和当前收尾区；本地旧副本/镜像包占用集中在历史集成与发布区。NAS应用目录测试副本约78GiB、备份约60GiB。逻辑大小不等于实际释放空间。

明确保留：

- 当前生产`data`、compose、Secret、所有媒体/External Landing/活动Workspace、所有运行及其他项目容器。
- NAS `aftercare-health-case-20260908` 与 `formation-reset-close-knit-20260912T142607Z` 含原媒体，不删除；历史三片及未完成UAT-267、Workspace事故恢复资料按精确职责保留。
- 当前c147与已验证回退071镜像/tar；未完成267所需3fff、历史286必要镜像/tar。
- 尚未核实整合的源码工作区保留；已结束且提交可达的clean工作区先保存Git snapshot ref及有用ignored Evidence，再退役。不删除分支或独立提交，不覆盖用户修改。

## 已完成NAS清理

冻结清单后按目标重新核验realpath在应用根内、inode/device/权限/归属、文件数量和metadata digest；排除symlink、媒体、special file、挂载引用和进程打开引用。初次执行在删除前因挂载数组顺序差异保护失败，删除0项；按Destination排序比较全部挂载字段后复验通过，再执行精确目标清理。

| 删除类别 | 数量 | 验证 |
| --- | --- | --- |
| 旧发布镜像tar | 20 | 保留当前及必要回退/验收包，当前c147完整SHA256复验通过 |
| 已结束测试运行目录 | 21 | 不含未完成UAT-267两处资料，不触及运行data |
| 已被替代的备份目录 | 19 | 恢复职责逐项排查；原媒体及必要事故恢复备份保留 |
| 本项目旧Docker镜像标签 | 142 | 只匹配`markmahoro/shelfdeck:helix-beta-*`，排除所有容器使用及4个受保护Image ID；逐ref `docker image rm`，失败0 |

60项文件系统目标全部成功，逻辑大小128,028,980,645 bytes（约119.2GiB）；不能据此报告释放119GiB。vol1可用空间最终74,796,285,952 bytes（约69.7GiB），较清理前增加45,731,155,968 bytes（约42.6GiB），使用率85%→60%。不执行Docker全局prune，不清理其他项目镜像，不直接修改Docker engine目录。

15项受保护文件系统资料metadata digest前后相同：4个镜像tar、9个备份目录、2个UAT-267测试目录。9个备份为`aftercare-health-case-20260908`、`formation-reset-close-knit-20260912T142607Z`、`three-films-c10e516e64-20260911`、`workspace-recovery-20260920`、`unified-helix-beta-20260922-19d13f7b58`、`uat267-3fff5f7dc3-20260923`、`uat267-predeploy-20260924`、`formation-reset-20260928T065625Z`、`uat275-preapply-07172d4c15-20260928`。前两项含真实原媒体，不作废弃副本；其余承担未完成验收、事故恢复或必要回退职责。

Docker保留当前c147、回退07172d4c15、未完成267基线3fff5f7dc3、历史必要286fe56f1e四个受保护镜像；`latest`未作为清理目标。所有29个容器（包含其他项目及停止容器）的Image、StartedAt、Running、RestartCount前后一致。ShelfDeck挂载、compose及Secret文件摘要未变化；未操作生产data、媒体、业务Workspace或Reset。最终通过主工作区原SSH工具复验：生产镜像/StartedAt/RestartCount0未变，health200，应用根权限771、系统根755未变。未以活动数据库字节不变作断言，未重新核验所有收藏业务事实。

## 本地退役、保留与待清理

37个原工作区HEAD保存到`refs/archive/helix-beta-20260930/*`，不删分支；选出14个clean且提交可达当前收尾交付的工作区退役。其余23个含当前/主工作区、未提交修改、独立交付或尚未确认整合的源码，继续保留。

`git worktree remove`后14个注册全部移除，9个目录完全移除，5个只剩tools/junction残余：`movie-ondeck-fixes`、`emby_third_party-helix-baseline`、集成区内`scan-repair-20260912`、`emby_third_party-helix-prod065`、`emby_third_party-helix-three-films`。这些残余不计为已完整删除。

退役过程发现Windows tools/node_modules junction指向主工作区共享依赖；Git删除曾波及共享依赖，并对上述5个残余报`Invalid argument`。已向用户说明，使用锁文件`npm ci --prefix tools --ignore-scripts`恢复主工具依赖；当前收尾区改用独立依赖。初次恢复因已加载native addon返回EPERM，任务SSH进程退出后恢复成功；`require(ssh2)`及原SSH工具实际连接NAS均通过。未修改工具源码/锁文件，不宣称native addon已重新构建。后续退役必须先识别junction，不沿链接递归删除。

项目外必要保留位置：`E:/my_project/shelfdeck-retained/beta-movie-20260930/`。约23.9MB源码恢复bundle通过`git bundle verify`；1161份有用Evidence/日志/配置/脚本/截图共97,805,529 bytes逐份SHA256验证通过，私密资料只留本地，不提交。14个退役snapshot ref复验HEAD正确；三个有用户未提交修改的工作区`git status --porcelain`与原盘点一致。首个退役后磁盘快照C/E合计可用空间增加约24.1GiB；该净值会受其他进程影响，不作为逐文件精确释放计量。

仍待删除：34个本地旧镜像包、40个已结束测试副本，合计逻辑大小约72.7GiB，另有5处junction残余。批量受保护PowerShell删除和随后单一精确路径删除均被自动审批拒绝，返回`blocked by policy`，没有更具体原因；这些独立文件系统删除未执行，未通过其他语言或shell绕过。需要审批限制解除并重新核验目标后才能完成剩余清理，UAT-280保持部分完成。

## Receipt与验证范围

原始清单、核验脚本和逐目标Receipt保存在本任务ignored `.codex/cleanup-uat280-20260930/`；JSON/JSONL结果另存上述保留位置`cleanup-records/`。主要文件：`nas-plan.json`、`nas-receipt-final.jsonl`、`nas-images-receipt.jsonl`、`local-frozen-plan.json`、`local-retirement-results.json`、`cleanup-summary.json`、`pending-local-cleanup.json`。可阅读待清理清单为保留位置根下`PENDING_LOCAL_CLEANUP.md`。历史Evidence中的已删除副本路径仅供追溯，不能继续当作现存恢复副本使用。

本轮验证精确清理结果、保护目标、源码/证据恢复能力、用户修改状态、服务身份/持续运行与磁盘空间。无服务/UI源码改动，未构建、部署新版本或跑Service/Desktop/真实媒体E2E；不新增功能资格PASS，不关闭未完成业务UAT。关闭本项仍需剩余本地目标清理和保护复验。
