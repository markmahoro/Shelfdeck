# ShelfDeck v3 / Kairox Historical Status

2026-09-12最新部署：`markmahoro/shelfdeck:helix-beta-20260912-cd4f3f5b2d`，git `cd4f3f5b2d2e1ebd80e4ec0bf4119e4cd7442beb`，NAS Config Image ID `sha256:f4d48cd326dba8b551af63fad7c3ce0ffdc0b3040c43c6153d1987cbc9a13452`。tar SHA256 `4d3f1b1c51d47d10bb2d3afaa5ce1b4cb6a63586b4a8887a458f8f72ec4beaed`。最终Linux适用39/39、Web94/94、生产八页/五Tab和正常扫描73页完成；本批未重跑完整真实媒体E2E。Linux Reset夹具23项路径限制失败、既有架构基线失败及旧席位恢复限制如实保留。完整备份、部署、回滚和UAT范围见[本批证据](../helix/implementation/evidence/UAT_RELEASE_CD4F3F5B2D_20260912.md)。下列发布为历史记录。

2026-09-12部署身份：markmahoro/shelfdeck:helix-beta-20260912-83235c9260，source 83235c9260；tar SHA256 5a2ba0cc1d86aa6fd6af5bdbef41d2ba0701c06b19a6408cdf78f8bffa8b9b94。最终Linux专项103/103，生产UI八页/五Tab通过，UAT-256关闭；UAT-257已部署但后续正常扫描验收未完成。扩展架构合同基线失败与历史恢复告警如实保留；未重跑完整真实媒体产品E2E。见[发布、备份及边界](../helix/implementation/evidence/UAT_RELEASE_83235C9260_20260912.md)。

2026-09-11部署身份更新：`markmahoro/shelfdeck:helix-beta-20260911-c10e516e64`，git `c10e516e64`，NAS config Image ID `sha256:fd03632b156ff535c84be0e853ee384dc98bea1fba41bf59eee4c8c2687a1b57`，tar SHA256 `6c3dede8106cc46b91e6da3f34092afca959bef81738cd3e89e49db8ffb3d2e4`。最终Linux镜像专项100/100，标准发布及《太阳帝国》真实On-deck恢复链通过：11项Settlement、唯一Commit、7项成品及246项范围外文件保留核验通过。本次没有重跑完整产品E2E，也未宣布另外两条电影均恢复完成。见[部署与恢复证据](../helix/implementation/evidence/THREE_FILM_FIX_20260911.md)。
2026-09-09部署身份更新：ShelfDeck `markmahoro/shelfdeck:helix-beta-20260909-7ceaeca7fb`，git `7ceaeca7fb`，tar SHA256 `2b5d16ee6d023540c567890e1bec4d0987df6dfaa3becf86be19ecc08d251f26`。UAT-245概览独立快照与有界读取、最终镜像真实备份完整服务及生产页面通过；82收藏和六路接口正常。此次查询变化未重跑无关完整媒体E2E。详见[Helix发布证据](../helix/implementation/evidence/UAT_RELEASE_7CEAECA7FB_20260909.md)。

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
