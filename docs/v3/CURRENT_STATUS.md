# ShelfDeck v3 / Kairox Historical Status

最新部署（2026-09-09 02:12）：helix-beta-20260909-1a3f4254dc，source 1a3f4254dc，NAS config Image ID sha256:e5fb3d29e5f9a0dbe2c24776ccc0c5a872ea0d1017beaec9049ba98759ae2c5b，tar SHA256 1d1f41052ae1f95aae7078a8dab0556675e508f791204b1e8896a8494f12c113。标准发布、17 Windows/17 Linux/10 Web及真实十部链36.71秒PASS，生产分页/全选与六路GET通过。详见[发布证据](../helix/implementation/evidence/UAT_RELEASE_1A3F4254DC_20260909.md)。

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
