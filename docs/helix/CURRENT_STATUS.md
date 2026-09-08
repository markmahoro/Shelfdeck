# ShelfDeck 当前状态

更新：2026-09-08。主线未全数关闭；逐项状态见[UAT总表](UAT_ITERATION_REGISTER.md)，后续顺序见[CURRENT_PLAN](CURRENT_PLAN.md)。

## 部署与本地交付

- 接手核实：集成工作区`codex/user-pain-iteration` HEAD为`7c858523c`；唯一既有dirty文件为Aftercare调查Evidence，原内容受保护。相关UI任务idle，交付e6b7f0424尚未整合。本轮未部署、未重置、未修改生产媒体；下述生产镜像与Image ID现已通过SSH只读复核一致，health正常。
- 全量台账初步一致性对账：251个连续ID；153历史关闭、1文档关闭、1非缺陷接受、95待实现/验收、1被取代待核承接。96行已补具体场景/依赖/排程；历史资格待核不能转为本轮PASS。已发现终局、健康三态、全量续拉、退出页常驻整库及43部旧恢复基线与最新决定不一致，正在传播合同。

- 生产镜像：`markmahoro/shelfdeck:helix-beta-20260908-6e37bf5679`，source `6e37bf5679`。
- Image ID：`sha256:356c034aca554dc206d7c2050b38d9ba646c6c0c1f43f66d7a57aa1f86f3d976`。Tar SHA256：`404da86c43eccc15c68b00b5d63832b1012d165ea7768d89deed6870fc581d90`。
- 标准发布已通过。回滚镜像275923039f及备份`/vol1/1000/docker/shelfdeck/backups/aftercare-health-case-20260908`保留。
- 本地1755743c1：详情加载/错误/迟到响应保护、倍速显示、大NFO有界记录同步；Service501 PASS/18 SKIP、Web47 PASS、214 Fixture Gate通过，未发布。
- 独立UI交付e6b7f0424：Service串行501 PASS/18 SKIP、Web49 PASS、构建与214 Fixture Gate通过，1440/1280浏览器fixture验证；并发测试曾有依赖缺失和watchdog超时，原Evidence保留。未整合、未部署，不代表生产UI验收完成。

## 最近现场与未完成项

09-08 12:57只读快照：56部收藏、54绿/2红/0黄，原54部全保留。两项红灯是007与第三度嫌疑人历史路径身份变化，修正归UAT-211；不手改健康字段。

09-08 14:03已知旧目录核查：Top Gun为定向回收（11文件、4,015,976字节、哈希复验）；霍比特人1/信使只剩种子，哪啊哪啊神去村含sample命名视频，夺宝奇兵5含另一1080p视频。本次其余文件未移动；UAT-215流程未建立，UAT-216存量未完成。

UAT-213建单目标Evidence、UAT-214人物观察仍未实现；UAT-217/218支线未修复。真实浏览器整合验收与后续发布未完成。5分钟自动化保持PAUSED，停止Emby归因审查。

详细事实见[实施证据](implementation/evidence/AFTERCARE_HEALTH_CASE_IMPLEMENTATION_20260908.md)。此前停机、恢复、测试与中间镜像流水保留于[整理前状态快照](implementation/archive/20260908_PRE_PROD_CONSOLIDATION/CURRENT_STATUS.md)，不再混入当前事实。当前库存以机器manifest为准，不在多份治理文档手工复制计数。

本轮本地：6aff1635b完成全量排程/已确认合同传播；2a9efbbac实现UAT-211精确历史Settlement排除（40定向PASS，215架构Fixture文件及全部Gate PASS）；799433c65整合UAT-212交付。收藏分页补充实施中，Web50 PASS，尚未浏览器/生产验收。原Aftercare调查Evidence未提交修改仍保留，未关闭功能UAT。

### 2026-09-08 迭代本地整合补充

UAT-213创建时有效目标快照dcbcc8314；UAT-212收藏分页7f80831c2、实际动作6b7486d43及统一有界整理分页完成本地回归。218个architecture fixture文件与全部Gate、Web53项、Web build通过；本地Edge合成场景翻页/刷新/跨页筛选/详情通过。以上未部署、未新增验收关闭。生产林肯律师73%转码与黑寡妇等待资源仍受保护，活着仍保留P5_PROVIDER_RESPONSE_INVALID原失败。NASpreflight正常，准备干净检出构建，不能因当前在飞工作未结束而强行打断。

UAT-144现有生产普通HTTP来源/收藏架页已实际导航验收，无randomUUID定向回归通过，按原问题边界单项关闭；UAT-145保存与146来源进度保持开放。详见UAT-144_HTTP_PAGE_ACCEPTANCE_20260908.md。
