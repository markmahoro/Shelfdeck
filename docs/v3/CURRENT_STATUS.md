# ShelfDeck v3 / Kairox Historical Status

Last updated: 2026-09-07

- `Kairox Beta` 已达成，Kairox release line 已关闭。
- v3/Kairox 文档只保留历史实现、验收和版本管理证据，不能覆盖 clean Helix SSOT。
- 当前产品、计划、验收和生产运行事实分别见 `docs/helix/README.md`、
  `docs/helix/CURRENT_PLAN.md`、`docs/helix/BETA_FEATURE_ACCEPTANCE_BASELINE.md` 与
  `docs/helix/CURRENT_STATUS.md`。
- 当前生产镜像为 `markmahoro/shelfdeck:helix-beta-20260907-fd8a8e6f35`，source commit `fd8a8e6f35`，
  NAS image/config ID `sha256:92d7a7b6468a4e8f8c66466fe6c6dcbe0cc915560942e6bf2594fd0e6c8cbc8d`，tar SHA-256
  `e9615b1dc31a9ef51d7afcb9cd9090521988dc39d4f0df056e2c15aa169ddb08`。
- 当前资格：本地Service 498 PASS/18 SKIP、Architecture 1534 PASS/7 SKIP、Web 43 PASS；最后Work Supply改动另有29项回归通过。最终镜像在隔离Linux环境运行生产副本、后台执行和6个真实HTTP入口通过。未重新执行全部真实媒体旅程，生产发现历史恢复错误，不能声明全链E2E或稳定性全部PASS。详见Helix生产记录。
- 不授权 Kairox compatibility migration、dual read、roadmap 重启或新 v3.x milestone。

以下为本次用户痛点迭代之前的历史部署验证：

- 旧镜像 Linux NFO改写、重启和完整On-deck专项9 PASS；Windows服务479 PASS /18条件SKIP，生产健康门禁通过。逐片真实媒体恢复尚未全部完成，不能宣称生产全链验收完成。

补充部署 `1125d232c6` 已完成：SHA校验、标准dry run/apply、health、Admin Web及挂载验证通过。Field Observation从1088推进至1101（新Work第12页），证实旧失败扫描不再阻止新一轮。该补充镜像Windows观察与Sidecar22 PASS、关联观察15 PASS、架构210文件PASS；Linux新round与连续性3 PASS。恢复尚在进行。

09-07 D3及Reset闭包修复已按标准流程部署，Health/Admin Web/全部持久化挂载和exact image检查通过。Windows服务483 PASS/18条件SKIP，架构210文件PASS；最终Linux镜像上架E2E和Projection24 PASS、orphan范围保护3 PASS。NAS工作站operator补充commit dd850da43，参数保护7 PASS。完整备份位于NAS app backups/formation-reset-20260907T104609Z/data；原14条孤立控制经正式offline Reset清零，integrity/FK通过，0 Run/Workspace删除。
