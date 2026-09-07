# ShelfDeck v3 / Kairox Historical Status

Last updated: 2026-09-07

- `Kairox Beta` 已达成，Kairox release line 已关闭。
- v3/Kairox 文档只保留历史实现、验收和版本管理证据，不能覆盖 clean Helix SSOT。
- 当前产品、计划、验收和生产运行事实分别见 `docs/helix/README.md`、
  `docs/helix/CURRENT_PLAN.md`、`docs/helix/BETA_FEATURE_ACCEPTANCE_BASELINE.md` 与
  `docs/helix/CURRENT_STATUS.md`。
- 当前生产镜像为 `markmahoro/shelfdeck:helix-beta-20260907-1125d232c6`，source commit `1125d232c6`，
  image ID `sha256:106d999b0e3d2a6bad4650e2603c61469dc70a7dc1c26639407b7c66deb003f5`，tar SHA-256
  `a8daa19733d0c11586354500a6e7ad5f7d300dfc6280d56dcdc4494294b9d5e4`。
- 不授权 Kairox compatibility migration、dual read、roadmap 重启或新 v3.x milestone。

- 本镜像 Linux NFO改写、重启和完整On-deck专项9 PASS；Windows服务479 PASS /18条件SKIP，生产健康门禁通过。逐片真实媒体恢复尚未全部完成，不能宣称生产全链验收完成。

补充部署 `1125d232c6` 已完成：SHA校验、标准dry run/apply、health、Admin Web及挂载验证通过。Field Observation从1088推进至1101（新Work第12页），证实旧失败扫描不再阻止新一轮。该补充镜像Windows观察与Sidecar22 PASS、关联观察15 PASS、架构210文件PASS；Linux新round与连续性3 PASS。恢复尚在进行。
