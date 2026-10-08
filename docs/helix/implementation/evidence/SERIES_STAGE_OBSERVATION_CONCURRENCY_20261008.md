# Series发布回归：Stage只读观察并发误报

日期：2026-10-08；基线`fe7014c29957c7e3b83726b3d1f1ed5992302f18`，归当前Phase发布回归工作项。

## 根因与边界

`d85a7b348`的全架构回归中，历史Stage Handoff B集合证明测试失败，隔离重跑通过。在另一Worker持续创建并立即删除无关临时空目录时，该测试首次就复现`ARCA_STAGE_REALITY_UNPROVEN: Stage path changed during observation.`。日志`series-stage-concurrency-repro.log`保留原始堆栈。

`empty-stage-slot-observer`原来把盘根到slot的每层mtime/ctime全部纳入前后比较。测试共享临时目录的兄弟活动改变祖先目录时间戳，被误认为精确slot发生变化。这个缺陷属于物理观察的范围误判，不是Handoff B Control集合错误。

沿UAT-261既有只读观察合同（`UAT-261_CATALOG_RETIREMENT_PROOF_20260912.md`中Stage派生证明）修复：全部祖先仍检查真实路径、非链接、directory、device/inode及mode；目标slot额外比较mtime/ctime，并保留两次为空的检查。祖先的其他子项变化不代表slot改变。没有改变Owner、Handoff、Control、旧输入重建或历史证明准入；没有新增兼容/恢复分支、重试或写权限。观察器仍只有lstat/realpath/readdir。

## 证据

- 新增5项确定性测试：无关兄弟目录活动通过且文件保留；目标slot瞬时写入后清空仍拒绝；第一轮观察后新残留拒绝且字节保留；祖先实体替换拒绝；祖先mode变化拒绝。
- Windows上述测试、历史Stage以及bounded catalog transition共84项通过，无skip。既有缺目录、链接、权限、Owner漂移、额外/缺失Control等保护继续通过。
- Linux本地测试镜像`372768b68`只读挂载当前观察器文件和测试目录，实际Node20执行观察器/历史Stage共21项通过；不是完整新镜像发布验证，容器已自动删除。
- 原并发复现条件下完整历史Stage文件连续10次通过；不靠放宽断言或测试重试掩盖失败，每次独立进程。
- P2合同、459文件/1455依赖包边界、2078文件语义检查及diff检查通过。首次语义检查仅指出新英文注释的术语不合规，改为明确directory timestamps后通过，无规则豁免。
- 日志在仓库外`E:/my_project/helix-git-consolidation-20261008/`：`series-stage-fence-{fix,linux,p2}.log`、`series-stage-concurrency-fixed.log`。

## 未完成

原277文件全量进程仍运行，不能据专项结果宣称全量通过。该进程已在本修复前加载历史Stage文件，因此原失败保持；结束后需要对修复冻结版本复验。未更改UI接受SHA的页面，未操作NAS生产。完整Series外部交付合同缺口、其余恢复/升级/发布门槛仍开放。
