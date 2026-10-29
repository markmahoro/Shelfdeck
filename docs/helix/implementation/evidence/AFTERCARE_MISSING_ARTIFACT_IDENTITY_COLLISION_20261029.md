# Aftercare 缺失 Artifact 的物理身份碰撞

工作项：`AFTERCARE-MISSING-ARTIFACT-IDENTITY-COLLISION`。范围为 Arca Aftercare 的已冻结缺失 NFO、poster 或 fanart 的物化；不改变 Physical Material Identity 公式、Material Control Owner、Inventory 事务或目标重现时的保护。该记录是隔离开发证据，不是生产验收。

## 首份门禁与根因边界

Series 候选 `bc4f5c952849ed6079baedde159ddaa5ce1d39c1` 的 Linux 完整 Architecture 首跑中，GETCHU poster maintenance 失败。首个 Inventory commit 为 `ARCA_AFTERCARE_INVENTORY_NO_CHANGE`，后续物化报 `Aftercare Artifact target reappeared after the frozen missing finding.` 原测试的临时目录在失败后清理，**原始文件及 inode 现场不可得**，不能断言该次必然发生了本记录复现的碰撞。原门禁完整日志保留于主整合工作区 `.codex/series-integration-20261029/linux-architecture-bc4f5c952.log`，SHA256 `1c07502a962be1eb0ed77dd043657b4943e4496d799a66256ce975ae5d0dfed2`；本工作区提取的事件摘录 SHA256 `45afd1071620c413eeaf92a7f03b784c987b2ce02a54c5df8bae3f9ab71a000b`。

生产基线 `a2bf2d6fd3271dc3a3741e28ed42f533a59d99d4` 与该候选的相关 Aftercare 实现及 JAV 测试文件完全相同。两者各一次未注入 Host 重跑均通过，不能取代首份失败。独立 Linux Volume 和 overlay 临时目录上，删除文件后按相同字节复制到临时文件的探针各 512 次均观察到旧 inode 复用；这是隔离文件系统结果，不代表 NAS。

受控 Host 测试在移除旧 poster 前暂存其 hardlink，在原物化复制边界释放，再用真实文件分配选出复用 inode 的临时文件；没有伪造 stat，也没有修改产品代码。基线（36 次分配选中）和候选（1 次选中）均复现同 inode、同字节、相同 Material Key，并出现与首份门禁相同的 Inventory no-change 与后续保护错误。候选保留的私有 DB 副本显示首个物化 Effect committed、Inventory Effect failed、后继物化 Effect reconcile_required、Case active；FK 0、integrity ok。该受控过程证明既有碰撞缺口及相同失败链，不证明首份门禁的当次现场。两份原始隔离日志分别为 `jav-poster-baseline-collision.log` / `jav-poster-bc4-collision.log`，SHA256 `461fd4a8f6925252ffc494a10885361f09efc61c3ea3d2b33c20bc61d2411018` / `96653fcaf1c1ad2751195c44db15077f10f419deecd5305cfc762100a35cdf66`；均保留在本工作区 ignored 的 `.codex/continuity-evidence-20261029/`。

## 修复与回归

在仅有匹配的冻结 missing Finding 对时，Arca 对同 Case 的确定 stage 验证源字节及 regular file 和稳定 stat；若新 Stage 的 Material Key 恰好等于冻结旧 Key，在持有该 inode 的文件句柄时重建并复验 Stage，确保新旧 Key 不同后再排他发布。恢复时仅清理经验证与目标为同一物理文件的已声明 Stage 别名；不覆盖发布期间出现的外部目标，不按相同字节删除外来目标，不把不可观察 Stage 当作不存在。发布后只允许回滚与本次受验证物化快照仍一致的目标。原失效 Finding 的 exact-old 重现仍冲突，现有 Inventory release/acquire 和 Control 唯一性检查保持。

本地 Windows 定向集 39 PASS，Linux Aftercare、Series Aftercare 和 Material Control 回归 359 PASS / 1 skip / 0 FAIL。覆盖同 inode 同字节、不同或相同字节的外部目标、Stage 被替换或不可观察、链接后外部写入、Authority 失效、四个进程退出窗口及重放。首轮扩展集 355 PASS / 1 FAIL / 1 skip，失败是隔离源码挂载缺少测试子进程硬编码的 `node_modules/better-sqlite3`；补齐镜像自身原生依赖后原样复跑，首轮日志仍保留。Windows 首轮新增用例中以普通 Number 比较 64 位 inode 的测试断言发生精度损失，改用实际 bigint 指纹后通过，未改写产品身份公式。对应首轮与最终 Linux 日志 SHA256 `6449ebae7effbae1dacccd8822e2ffb24136d3a01fab5a88404c324283d13039` / `45983025f6d51a47c3a49c6f37f8240371bd1e01e80117af2a4c78cf474419fd`；Windows 日志 SHA256 `37aa37fda4fd1e84f474ba8d49e3d26f90cafb63bae3c980d62f356e6b2ba3ac`。

最终源码 `aftercare-capability-ports.js` SHA256 `58abf334c586704708fdfdc868d884b859e5d148437935290bf8577036599755` 的受控 Host 1 PASS / 0 FAIL：Stage 实际复用旧 inode `1933614`，最终 inode 为 `1925159`，内容均为 286 字节；物化及 Inventory 的 Event/Effect 成功、Case resolved、旧 Key released、新 Key 唯一由相应 Arca Shelf Entry controlled，且原视频、NFO、另一图片及 On-deck Receipt 保持；只读副本 FK 0、integrity ok。Host 日志 `jav-poster-fixed-collision-final-v2.log` SHA256 `0b630efb919820a073ac78db3b54a951da661e4cc131203f90cd9a73000cf88b`。Linux 回归唯一 skip 为需显式设置 `HELIX_SERIES_AFTERCARE_RESTART=1` 的 Series media Aftercare 独立 Host 重启用例，并非执行通过。合并后完整门禁结果由主整合记录。

## 生产影响与未完成项

缺失 Artifact 的排他发布需要目标目录支持同卷 exclusive hard link；Shelf 现有探针只保证 atomic rename，hard link 不可用时本补丁明确失败，不降级为覆盖写。主整合指出此前真实 CIFS 16 项为 8 PASS / 8 FAIL，失败覆盖全部 8 个实际文件发布/恢复用例；不得把其中规则或 SQLite 的通过当成 NAS 文件系统资格。须在用户授权的隔离目录和合适负载窗口验证目标挂载的 hard link、打开/删除及实际重放；真实 CIFS/NAS 支持仍未知。

本工作区未访问生产或修改真实媒体。独立补丁不代表最终整合版本、完整发布门禁、NAS 部署或七条生产任务恢复验收完成；这些由主整合在精确最终版本上完成并更新唯一活动 Phase。
