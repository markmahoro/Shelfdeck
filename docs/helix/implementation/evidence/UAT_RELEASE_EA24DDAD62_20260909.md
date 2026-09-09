# UAT-226/233/234 标准发布与页面验收

2026-09-09。用户既有实施、验证后标准NAS发布授权持续有效，允许中断FFmpeg。此次运行代码仅改变整理页CSS；没有Schema/API/媒体执行或Desktop源码变化，没有Reset或直接改生产数据。

## 发布及回滚身份

- Source `ea24ddad62`；镜像 `markmahoro/shelfdeck:helix-beta-20260909-ea24ddad62`。
- NAS Image ID `sha256:5060b7d15841c1152d8cec95ad9becf569bd2b5b7ae36077011f0449502bb4bf`；StartedAt `2026-09-09T10:06:48.374063502Z`；running、0次重启。
- Tar `/vol1/1000/docker/shelfdeck/shelfdeck-helix-beta-20260909-ea24ddad62.tar`；SHA256 `f77479c0b8a7f65ad238d3c47d3a2548d794e837b26cecf3b8c5d52c2e9b9d39`，本地及上传后远端一致。
- 一致备份 `/vol1/1000/docker/shelfdeck/backups/uat-iteration-20260909-formation-layout-predeploy`；DB SHA256 `d3511ac8c5c8476c8e7f714113c55eee70165e013883ff4185b99d65118dbe69`，下载副本再次校验一致；Compose、secret.env、Admin凭据、3份加密Integration envelope一起保留。备份完成于10:05:11.246Z。
- 回滚保留`helix-beta-20260909-04ffa8b116`、原tar及备份。需要时对原tar使用标准deploy-nas.js，SHA256 `a0a6b903359b32e96f686348d3f88dd9b6d8b62b7e876633850c09f6a6219e12`，先dry run再apply；此次无需Schema回滚，不默认恢复数据库。

## 标准流程和生产事实

fnOS只读预检通过，/vol1约41GiB可用。干净发布worktree标准build-image.js、upload-nas-image.js、checksum、deploy-nas.js dry run与apply完成。Readiness为ready、findings为空；health/Admin、持久化及媒体/upgrade/transcode/adult/GPU挂载、精确镜像及无源码覆盖核验通过。启动窗口只读请求短暂fetch failed，随后正常；未吞掉启动后错误。

10:05:25.837Z部署前、10:08:07.360Z部署后六路GET均200，同口径为82收藏、Formation total78/inProgress2/attention0/completed76/ended3、Care44完成/11结束、Recycle4。既有P4_EVENT_RECOVERY_INPUT_DRIFT仍在日志出现，125/250保持开放。

生产原始页面经只读代理实际浏览器复验：1440宽度document1425/1425、table1137/1137；1280宽度document1265/1265、无内部表格溢出；390宽度document375/375、table343/343。宽屏保持表格，1280回流、390窄屏信息可读。视口恢复默认。没有点击生产加急、评分或其他修改操作。

新旧完成记录与过程详情依据、21项过程投影测试、5项Web测试及构建结果见[226/233/234页面证据](UAT-226_233_FORMATION_BROWSER_20260909.md)。没有为纯CSS修复重复完整媒体链或Desktop构建。

UAT-226、233、234按各自条件分别关闭，累计59项本轮功能关闭、40项开放。212完整进度/详情、245有界查询及其他页面条件不自动关闭。

日志：`.codex/uat233-{preflight,backup,image-build,upload,dry-run,apply,production-startup}.log`及`.codex/production-monitor.jsonl`。
