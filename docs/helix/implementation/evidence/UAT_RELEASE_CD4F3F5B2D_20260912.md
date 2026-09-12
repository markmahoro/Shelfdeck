# UAT-125/250/257/258/259 首批联合发布

2026-09-12。部署负责人按既有授权安排首批发布：接收恢复核心、扫描恢复、自动清理授权入口和第二轮UI精简。UAT-251及旧Control失配的正式拒绝链仍在独立实施，不包含在本镜像；本次未执行生产Reset、冲突文件隔离或重试上架。

## 发布身份与保全

| 项目 | 已核验事实 |
| --- | --- |
| Git source | `cd4f3f5b2d2e1ebd80e4ec0bf4119e4cd7442beb`，专用发布worktree干净 |
| Docker tag | `markmahoro/shelfdeck:helix-beta-20260912-cd4f3f5b2d` |
| Tar SHA256 | `4d3f1b1c51d47d10bb2d3afaa5ce1b4cb6a63586b4a8887a458f8f72ec4beaed` |
| NAS Config Image ID | `sha256:f4d48cd326dba8b551af63fad7c3ce0ffdc0b3040c43c6153d1987cbc9a13452`，与tar manifest的Config一致 |
| StartedAt | `2026-09-11T20:28:03.909028638Z` |
| 部署位置 | `192.168.12.230:18080`；`/vol1/1000/docker/shelfdeck`；SSH经统一配置，身份gezhu/303NAS |
| 完整备份 | `/vol1/1000/docker/shelfdeck/backups/unified-helix-beta-20260912-cd4f3f5b2d`，包含data、Compose、Secret |
| 备份验证 | 45文件；聚合digest `2ae95e4b047bf0281bfbafbcad44a4f4d0509e3ef31e34c1fe375447707b3523`；源一致SQLite backup与全部伴随文件、复制后再次逐文件校验、quick_check及foreign_key_check通过 |
| 回滚保留 | `helix-beta-20260912-83235c9260`镜像和tar；旧tar SHA256 `5a2ba0cc1d86aa6fd6af5bdbef41d2ba0701c06b19a6408cdf78f8bffa8b9b94`现场重验一致 |

实际流程为`build-image.js`、`upload-nas-image.js`、SHA256、`deploy-nas.js` dry-run/apply。readiness使用独立一致快照；未clean-init。五个原挂载、QSV、Secret root一致性、NAS与LAN health、Admin Web、fnOS管理页200及其他容器状态通过；根目录保持root:root755，Secret600，发布前系统卷约42GiB可用。启动等待期间有短暂connection reset，随后在脚本门限内健康通过；不是持续故障。

若需回滚，先记录当前业务执行和故障证据，再对旧83235c9260 tar使用同一`deploy-nas.js --sha256 <上述旧hash>` dry-run及apply。本批无DDL/typed合同变更，但不据此保证进行中Plan跨版本恢复；数据备份保留，不自动覆盖更新后的业务事实。生产数据恢复仍须按精确事故范围评估和授权。

## 验证与适用边界

- 整合`9820e7b85`恢复核心、`fdabf79a6`扫描、`38e89d145`授权按钮及`f62800edb`/`95ec6b8ab`第二轮UI。`f50006aa3`以`cd4f3f5b2d`补齐头像测试的异步挂载/load/error等待及实际img/state断言；未改产品或无障碍文案。发布区首次93/94的失败保留，最终21文件94/94通过。UI任务此前94/94确实包含该用例；具体竞态未独立复现，不写成已证实根因。
- Windows恢复/Reset/隔离/Intake合同49/49，扫描+Intake+普通选材/拒绝循环21/21，TypeScript/Vite构建通过。真实临时Host浏览器失败→键盘重扫→进行中→完成、未知原因单显通过；媒体Probe为fixture，不称为真实视频完整链。
- 最终cd4f3f5b2d Linux镜像39/39、无跳过，覆盖Intake并发恢复、扫描自动化/状态/普通选材/拒绝循环及精确隔离工具。仅只读挂载测试文件和尚未打包的离线quarantine operator，`/app/src`与服务依赖全部来自最终镜像。没有在生产执行该operator。
- 初次扩大Linux运行69项为46通过/23失败，均在既有Formation Reset通用fixture传入`/tmp/.../transcode`时被正式Linux `/transcode`限定拦下，包含一项预期注入错误也提前被该限制拦截。未放宽生产保护，也不把该套件说成全绿。后续精确Reset须在隔离真实`/transcode`挂载补齐演练，已向原恢复任务交接。
- 沿用已核验的4项架构合同生成基线失败/121项drift事实；本批没有schema、typed contract或依赖变化，未以重生成或放宽断言消除它们。未重跑完整真实媒体产品E2E、Desktop或Worker构建；本批未修改Desktop/Worker。

## 生产结果

1. 原失败扫描Work `field-observation-work-fabadd31c38e1233d2f485189505a61e548734d1`保留failed、revision1162–1221、60页及未完成事实。启动正常路径自动产生新Work `field-observation-work-c009c4202144c2e5eb527c5d5b46c75336d9bb9c`，revision1222–1294、73页、completed=1、Work=succeeded。未人工重复点击或修改旧记录。
2. 当前六片主文件（老枪、绣春刀、静水城、恋恋笔记本、图雅的婚事、猩球崛起3）资格在1294按真实观察变为eligible；各自已不在目录中的旧文件仍为not_observed_in_current_terminal_work。普通Procurement Run c79c13e05f70d25fd33123c64418a0143bdf906a随后为六片各产生一个新的Package/open Delivery，8份旧Rejected记录仍逐行不变；新累计970=834等待+128接收+8拒绝，257已按本项证据关闭。
3. 发布后初次核对113收藏、956包=820等待+128接收+8拒绝。8份原Rejected Package/Delivery逐行摘要与发布前一致；自动清理授权仍enabled、revision1、old_primary_and_exclusive_related，未为UI验收授予或撤销。后续选材可能合法增加累计包数量，须按新时点守恒核对。
4. 生产浏览器1920×1080检查八页和设置五Tab，来源/收藏架/人物/收藏筛选/日志控件同排，相关按钮及输入36px，无水平溢出或页面console error；概览详情在视口内滚动，回收记录可展开，目录保持当前生效`/transcode`。258对话框显示精确范围及后果，取消后关闭并返回入口焦点，授权不变。既有媒体整理九列表格保留；Fast X继续显示处理中，《人生密密缝》仍需处理。没有把旧条目自动判为恢复。
5. UI任务的同数据、同时间494元素对照0差异保留为本地结构证据；生产DOM/布局和交互复验不伪称同数据像素对照。外部浏览器中途断连后使用已有登录态的应用内浏览器继续，没有新增凭据或配置。

日志、完整只读响应及备份receipt位于集成区ignored `.codex/unified-release-20260912/`；镜像/测试日志位于发布worktree `.codex/*final-20260912.log`。生产导出与Secret均不入Git。受保护Aftercare Evidence SHA256仍为`81729d8c6ec35bec5494929bb19b46e6c83412b769a2cb8cff6db859bad35a3c`。

## 逐项收口

258、259、257分别以独立Evidence和关闭提交收口（626e5f806、212b992d7、ae4e64137），当前259项中71项本轮功能关闭、32项开放。六片新Package/Delivery与970包守恒见[257生产证据](UAT-257_PROCUREMENT_REJECTION_CYCLE_20260912.md)。正式拒绝链、251及旧条目恢复仍开放；本批发布不替代后续生产验收。

工作区收尾：确认废弃候选5ff5b8078f未被容器引用、tar SHA256与本任务构建记录一致、绝对路径在专用发布区后，删除该单个本地tar（561784320 bytes）及其本地镜像标签。保留已发布cd4f3f5b2d、NAS83235c9260回滚资料及所有业务备份；没有Docker prune、递归清库或改动其他任务文件。发布区tracked/untracked状态干净，任务测试容器/浏览器/进程已结束；集成区仅保留原受保护Aftercare Evidence修改。仍在实施的251/接收恢复及UI协调工作区保留。联合部署自动化继续跟进剩余两项交付，无变化时静默。
