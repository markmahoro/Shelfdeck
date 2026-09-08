# ShelfDeck 当前状态

更新：2026-09-08。主线未全数关闭；逐项状态见[PROD台账](PRODUCTION_DEPLOY_ISSUE_LOG.md)，后续顺序见[CURRENT_PLAN](CURRENT_PLAN.md)。

## 部署与本地交付

- 生产镜像：`markmahoro/shelfdeck:helix-beta-20260908-6e37bf5679`，source `6e37bf5679`。
- Image ID：`sha256:356c034aca554dc206d7c2050b38d9ba646c6c0c1f43f66d7a57aa1f86f3d976`。Tar SHA256：`404da86c43eccc15c68b00b5d63832b1012d165ea7768d89deed6870fc581d90`。
- 标准发布已通过。回滚镜像275923039f及备份`/vol1/1000/docker/shelfdeck/backups/aftercare-health-case-20260908`保留。
- 本地1755743c1：详情加载/错误/迟到响应保护、倍速显示、大NFO有界记录同步；Service501 PASS/18 SKIP、Web47 PASS、214 Fixture Gate通过，未发布。
- 独立UI交付e6b7f0424：Service串行501 PASS/18 SKIP、Web49 PASS、构建与214 Fixture Gate通过，1440/1280浏览器fixture验证；并发测试曾有依赖缺失和watchdog超时，原Evidence保留。未整合、未部署，不代表生产UI验收完成。

## 最近现场与未完成项

09-08 12:57只读快照：56部收藏、54绿/2红/0黄，原54部全保留。两项红灯是007与第三度嫌疑人历史路径身份变化，修正归PROD-068；不手改健康字段。

09-08 14:03已知旧目录核查：Top Gun为定向回收（11文件、4,015,976字节、哈希复验）；霍比特人1/信使只剩种子，哪啊哪啊神去村含sample命名视频，夺宝奇兵5含另一1080p视频。本次其余文件未移动；PROD-072流程未建立，PROD-073存量未完成。

PROD-070建单目标Evidence、PROD-071人物观察仍未实现；PROD-074/075支线未修复。真实浏览器整合验收与后续发布未完成。5分钟自动化保持PAUSED，停止Emby归因审查。

详细事实见[实施证据](implementation/evidence/AFTERCARE_HEALTH_CASE_IMPLEMENTATION_20260908.md)。此前停机、恢复、测试与中间镜像流水保留于[整理前状态快照](implementation/archive/20260908_PRE_PROD_CONSOLIDATION/CURRENT_STATUS.md)，不再混入当前事实。当前库存以机器manifest为准，不在多份治理文档手工复制计数。
