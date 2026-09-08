# ShelfDeck v3 / Kairox Historical Status

最新部署（2026-09-09 01:27）：helix-beta-20260909-7608c517cd，source 7608c517cd，NAS config Image ID sha256:99d38b530f5dd90981a2b036b269c98fa83383c6a33b5a8513aa1b58f3ed9ddd，tar SHA256 2acc85158da2aae349b4cf6334da12f615023b3e259a181268af5272cd2c4549。标准发布/生产六路GET/浏览器通过；原真实十部退出及重启链证据复用，纯UI增量8项Web/build通过。详见[发布证据](../helix/implementation/evidence/UAT_RELEASE_7608C517CD_20260909.md)。

最新部署（2026-09-09）：helix-beta-20260909-b2978c1512，source b2978c1512，Image ID sha256:49dceb0e1d8680b76dee17d6b8c88009d5e9be79d72c661932a1cd0975e7e1bc，tar SHA256 280ea8c7e26868fb468a7f97df510b7147d7c72066006c55ce171c076a024377。标准readiness及生产6路GET通过；实际十部退出/重启链21.84秒PASS。完整结果见[发布证据](../helix/implementation/evidence/UAT_RELEASE_B2978C1512_20260909.md)。

Last updated: 2026-09-08

- `Kairox Beta` 已达成，Kairox release line 已关闭。
- v3/Kairox 文档只保留历史实现、验收和版本管理证据，不能覆盖 clean Helix SSOT。
- 当前产品、计划、验收和生产运行事实分别见 `docs/helix/README.md`、
  `docs/helix/CURRENT_PLAN.md`、`docs/helix/BETA_FEATURE_ACCEPTANCE_BASELINE.md` 与
  `docs/helix/CURRENT_STATUS.md`。
- 当前生产镜像`markmahoro/shelfdeck:helix-beta-20260908-696b122da4`，source `696b122da4`，Image ID `sha256:c35d7ad1672a8859da85fb9224461cdd13cb4d9eb71ce0163c6cb0bd744893b8`，Tar SHA256 `9edf350c11efcd317e0507e986cef5ca0a164b185660dacc0cf6953b6c0eb640`。标准部署通过；基线Service511 PASS/19 SKIP及真实全链72.2秒通过，本次回收15项/Web59/build/222架构文件/Linux smoke通过。完整事实见Helix状态。
- 不授权 Kairox compatibility migration、dual read、roadmap 重启或新 v3.x milestone。

以下为本次用户痛点迭代之前的历史部署验证：

- 旧镜像 Linux NFO改写、重启和完整On-deck专项9 PASS；Windows服务479 PASS /18条件SKIP，生产健康门禁通过。逐片真实媒体恢复尚未全部完成，不能宣称生产全链验收完成。

补充部署 `1125d232c6` 已完成：SHA校验、标准dry run/apply、health、Admin Web及挂载验证通过。Field Observation从1088推进至1101（新Work第12页），证实旧失败扫描不再阻止新一轮。该补充镜像Windows观察与Sidecar22 PASS、关联观察15 PASS、架构210文件PASS；Linux新round与连续性3 PASS。恢复尚在进行。

09-07 D3及Reset闭包修复已按标准流程部署，Health/Admin Web/全部持久化挂载和exact image检查通过。Windows服务483 PASS/18条件SKIP，架构210文件PASS；最终Linux镜像上架E2E和Projection24 PASS、orphan范围保护3 PASS。NAS工作站operator补充commit dd850da43，参数保护7 PASS。完整备份位于NAS app backups/formation-reset-20260907T104609Z/data；原14条孤立控制经正式offline Reset清零，integrity/FK通过，0 Run/Workspace删除。
