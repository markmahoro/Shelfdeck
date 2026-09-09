# ShelfDeck v3 / Kairox Historical Status

2026-09-09部署身份更新：ShelfDeck `markmahoro/shelfdeck:helix-beta-20260909-ea24ddad62`，git `ea24ddad62`，tar SHA256 `f77479c0b8a7f65ad238d3c47d3a2548d794e837b26cecf3b8c5d52c2e9b9d39`。UAT-226/233/234实际页面、响应式、统计筛选及标准NAS发布通过；82收藏和六路接口前后同口径一致。详见[Helix发布证据](../helix/implementation/evidence/UAT_RELEASE_EA24DDAD62_20260909.md)。

历史部署（2026-09-09 04:09）：helix-beta-20260909-955fe42daf，source 955fe42daf，NAS config Image ID sha256:252261f4e075ceb2e1b771c84c535c365fe6714b55c5fbea83c447e98a97eb48，tar SHA256 43b88bc21fa5bb6f67c0ad66fb0a7b5f723b13575f42ea1698cee67f7f3fe6ae。Windows/Linux真实Host席位验证、12 Web/构建、隔离真实网关浏览器、标准发布及生产资产/浏览器复验通过；本次HTTP请求修正无媒体执行变化，未重复完整媒体E2E。详见[发布证据](../helix/implementation/evidence/UAT_RELEASE_955FE42DAF_20260909.md)。

Last updated: 2026-09-08

- `Kairox Beta` 已达成，Kairox release line 已关闭。
- v3/Kairox 文档只保留历史实现、验收和版本管理证据，不能覆盖 clean Helix SSOT。
- 当前产品、计划、验收和生产运行事实分别见 `docs/helix/README.md`、
  `docs/helix/CURRENT_PLAN.md`、`docs/helix/BETA_FEATURE_ACCEPTANCE_BASELINE.md` 与
  `docs/helix/CURRENT_STATUS.md`。
- 历史部署镜像`markmahoro/shelfdeck:helix-beta-20260908-696b122da4`，source `696b122da4`，Image ID `sha256:c35d7ad1672a8859da85fb9224461cdd13cb4d9eb71ce0163c6cb0bd744893b8`，Tar SHA256 `9edf350c11efcd317e0507e986cef5ca0a164b185660dacc0cf6953b6c0eb640`。标准部署通过；基线Service511 PASS/19 SKIP及真实全链72.2秒通过，本次回收15项/Web59/build/222架构文件/Linux smoke通过。完整事实见Helix状态。
- 不授权 Kairox compatibility migration、dual read、roadmap 重启或新 v3.x milestone。

以下为本次用户痛点迭代之前的历史部署验证：

- 旧镜像 Linux NFO改写、重启和完整On-deck专项9 PASS；Windows服务479 PASS /18条件SKIP，生产健康门禁通过。逐片真实媒体恢复尚未全部完成，不能宣称生产全链验收完成。

补充部署 `1125d232c6` 已完成：SHA校验、标准dry run/apply、health、Admin Web及挂载验证通过。Field Observation从1088推进至1101（新Work第12页），证实旧失败扫描不再阻止新一轮。该补充镜像Windows观察与Sidecar22 PASS、关联观察15 PASS、架构210文件PASS；Linux新round与连续性3 PASS。恢复尚在进行。

09-07 D3及Reset闭包修复已按标准流程部署，Health/Admin Web/全部持久化挂载和exact image检查通过。Windows服务483 PASS/18条件SKIP，架构210文件PASS；最终Linux镜像上架E2E和Projection24 PASS、orphan范围保护3 PASS。NAS工作站operator补充commit dd850da43，参数保护7 PASS。完整备份位于NAS app backups/formation-reset-20260907T104609Z/data；原14条孤立控制经正式offline Reset清零，integrity/FK通过，0 Run/Workspace删除。
