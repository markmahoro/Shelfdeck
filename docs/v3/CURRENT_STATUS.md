# ShelfDeck v3 / Kairox Historical Status

2026-10-13生产已标准发布 `markmahoro/shelfdeck:9a23b01c7`，git `9a23b01c7ff8c5d16272898e2efe3296e500cd0c`，Image ID `sha256:23ec509e81511ee9fc84f50ad61f87c633a4ab8ac6d9cc2e4d508fc24f994a7b`，tar SHA256 `e7d95627ebc588c0161e6e109452f5edc5c479744c307558ea69f868695055ff`。标准checksum/readiness/health/Admin/五挂载/QSV通过，RestartCount0；最终镜像专项79/79，发布前备份509 Entry/509 Commit，本地integrity ok/FK0及SHA匹配。未重跑整季加工上架E2E或desktop全量，五项失败媒体未重处理。真实四请求并发样本旧版三轮4891/2530/4762ms，新版3626/1683/1750ms，仍有长尾，UAT-318不关闭；这不是完整SLO资格验收。用户追加整理中加载时误报空态，纯前端补丁专项14项及Web构建通过，尚未发布；服务优化生产UI审核仍进行中。

2026-10-12维护发布：Docker markmahoro/shelfdeck:9478a4fc7，git 9478a4fc777f778bdc75ef8d2fa0a014ec852b3f，Image ID sha256:d3fcc1f839494fb441835c23ac05da49635432af6db85f526e06ca2fcf6d78f7，tar SHA256 e530bdc7f880b12b8be312bc7134e1ead1a4f6baa6d81d6e2389aaf2580ac552。标准checksum/readiness/health/供给/Admin/五挂载/QSV通过，RestartCount0。发布前509 Entry/509 Commit备份完整性及摘要核验；本次无Reset/重处理。E2E边界：最终镜像专项120通过/1既有live BDMV缺失skip，UI负责人隔离及真实生产四Tab计数接受；未重跑整季媒体加工/上架或desktop全量，整页性能仍开放UAT-318。详见[本轮Evidence](../helix/implementation/evidence/UAT-315_317_PRODUCTION_DIAGNOSIS_20261012.md)。

2026-10-12 17:34：NAS标准升级完成，Docker markmahoro/shelfdeck:cab3e2d77，运行时git cab3e2d77ac0b6506a268c97ac07af82f4442e49，Image ID sha256:d927c546c3d77690af75829527d785bab5001008d9e3a1b5aa61ba5035773c3b，tar SHA256 bfe6769dedae1699d24c5349d6b9077cb364091e1ac8c6f55f9ea98aff4e9aa0。用户明确授权的四Subject限定Reset完成，完整备份和Workspace备份已核验保留；504收藏/36111库存/504 Commit及保留执行历史逐行一致，integrity=ok/FK=0。health正常供给、Admin、五挂载/QSV/fnOS通过。E2E：最终Windows/Linux两集重复NFO→Commit→整季迁移通过，精确生产副本启动/历史保护及旧镜像备份恢复通过；Service602通过/0失败/29skip。生产尚未配置Series，未执行生产Series整季E2E或桌面全量，不把原33集演员Fact验收称作整季入藏。详情及回退边界见[Series生产升级记录](../helix/implementation/evidence/SERIES_PRODUCTION_UPGRADE_20261012.md)。下文为先前发布历史。

2026-09-30 UAT-281标准apply已切换 `helix-beta-20260930-8e197b3c36`，git `8e197b3c3685d21d87c581bae1016ed70896e2c3`，tar SHA256 `c6b84d0de15b92a38a5ecbe58003f2dc2fdafb2f42c41d66408f3b16e3711d02`，Image ID `sha256:168be0bb2101b79424f7f978c32d3724852eb5267b2234a4c981c22fe075ac2b`。243架构文件及完整检查、最终Linux165通过/1跳过；最新完整副本候选及同库旧镜像回退通过。生产health/normalSupplyAllowed、Admin/挂载/QSV/Secret及十一类历史事实保护通过；《网诱惊魂》原任务16:45:49 CST完成真实封装、输出验证、来源处置和唯一On-deck Commit，active Entry revision1，UAT-281关闭。全量Service/Desktop/全库整理E2E未执行，无UI修改或生产Reset；不发布Series开发。[证据](../helix/implementation/evidence/UAT-281_REMUX_PROBE_RETRY_CONVERGENCE_20260930.md)。

紧邻本次修复前的实际生产为 `helix-beta-20260928-c147188485`，git `c14718848597063dcd28fed002ae8e5e5897a7e5`，tar SHA256 `df9a74befe6ac9bd5ac3014222598c2ff7bd57f1958079decb6aaa4c14400ffa`，Image ID `sha256:a928dc2cb13a03e6e379f3f88420a104dbf83d06fe658b0192a6d9de6a4e9fb0`；UAT-275/276/277已发布，各自业务验收仍按原记录。[原证据](../helix/implementation/evidence/UAT-275_276_277_ONDECK_FAILURES_20260928.md)。以下为更早历史时点。

2026-09-28 UAT-272/273已标准发布 `helix-beta-20260928-69a82f2a5d`，git `69a82f2a5d776a0bde3ae1bc34ff5fd97c80dfb0`，tar SHA256 `21b241d5713f432e10413c7a08f3893bcec3cadbee9c5a313b97694b91ee5ca2`。Linux56/56、最新完整副本候选/回退Host、生产健康/挂载及真实浏览器身份预览/取消通过；完整媒体整理E2E未执行，用户正式身份确认待验，UAT保持开放。[证据](../helix/implementation/evidence/UAT-272_273_MOVIE_IDENTITY_20260928.md)。

2026-09-28 UAT-269：生产镜像`markmahoro/shelfdeck:helix-beta-20260928-b8cf321d65`，git `b8cf321d65`，tar SHA256 `e0f0b09b1583cb23bb9ae3d87c13c0d480e24561401d49f87236ceb73283e4c4`；完整架构240文件、Windows/Linux专项各45通过，生产健康/Admin/挂载通过，荒野猎人原任务import/probe/verify/select成功，真实外部导入E2E通过（未重新下载）。见Helix UAT-269证据；不宣称整片后续上架已完成。

2026-09-24最新生产为`markmahoro/shelfdeck:helix-beta-20260924-cdcab6dbab`，源git `cdcab6dbab83e157af80068196d250b9eb236491`，tar SHA256 `9361e3c95edd69b195f9e63b6f6432175afd90c290981862da9e819c9b43b7fc`，镜像ID `sha256:42c03c77c6567effb97a259f64bb9b21c7e58d8dd991563e865a50ef1804c564`。UAT-268独立标准发布及指定sample正式放弃/原文件和正片保护验收通过，health/Admin/挂载/SQLite正常。Web108、Windows Run20、架构及Linux适用42项通过；全量Service 540通过/18失败/24跳过，未执行完整真实媒体E2E。UAT-267物理Effect演练未过门禁，其修复不在此镜像。备份、候选/回退Host、测试局限和业务终局见[UAT-268发布与验收](../helix/implementation/evidence/UAT-268_ACTIVE_RUN_DISCARD_20260924.md)。以下为历史时点。

2026-09-12 14:33Z生产身份补充：同`markmahoro/shelfdeck:helix-beta-20260912-286fe56f1e`，source `286fe56f1e4c5c74ae845584f29b997597415f9c`，tar SHA256 `43dd75c9f2510dc246a38c6a00cd1a506db77fec14402a2aaf73b49f1516ca7e`、Config ID `sha256:16aa204ffda72363b68f03c7ad720c1ed73f0baf990b5c113c468f98623e3083`。用户明确确认《人生密密缝》旧重复主片归档及旧Subject精确Reset，现已执行；StartedAt更新为`2026-09-12T14:31:12.085895511Z`。122收藏/9文件保护、health/Admin/五挂载/QSV/Secret/fnOS通过；同版副本的真实缺失拒绝链通过，生产旧候选仍待满席位队列收尾，未伪称完整闭环。无镜像或产品代码变化，未重跑无关媒体E2E。见[精确执行证据](../helix/implementation/evidence/UAT-125_250_INTAKE_RECOVERY_20260912.md#人生密密缝获授权生产清理结果)。下段13:31Z为上次重启记录。

2026-09-12最新生产：`markmahoro/shelfdeck:helix-beta-20260912-286fe56f1e`，git `286fe56f1e4c5c74ae845584f29b997597415f9c`，tar SHA256 `43dd75c9f2510dc246a38c6a00cd1a506db77fec14402a2aaf73b49f1516ca7e`，Config ID `sha256:16aa204ffda72363b68f03c7ad720c1ed73f0baf990b5c113c468f98623e3083`，获授权精确Reset后StartedAt `2026-09-12T13:31:09.552222065Z`。标准发布、生产health/Admin/五挂载/SQLite/原122收藏保护通过；最终镜像Linux119+28及真实媒体自动瑕疵上架、手动修复、重启E2E通过。随后用户明确允许《宇航员》单Token/2旧Work清理，完整离线备份、冻结manifest、正式Reset和新Evidence→Rejected→ACK→释放闭环均通过；本次无镜像变更，未重跑无关媒体E2E。完整副本同格式备用切换已验证，备份和范围见[发布记录](../helix/implementation/evidence/UAT_RELEASE_286FE56F1E_20260912.md)。下方为历史时点，不覆盖本段。

2026-09-12最新发布结果：d7a6da2802因完整Host PLAN_CATALOG_DRIFT失败，已标准回退`markmahoro/shelfdeck:helix-beta-20260912-cd4f3f5b2d`；git `cd4f3f5b2d2e1ebd80e4ec0bf4119e4cd7442beb`，Config ID `sha256:f4d48cd326dba8b551af63fad7c3ce0ffdc0b3040c43c6153d1987cbc9a13452`，tar SHA256 `4d3f1b1c51d47d10bb2d3afaa5ce1b4cb6a63586b4a8887a458f8f72ec4beaed`，StartedAt `2026-09-11T21:32:51.809272745Z`。health、挂载及fnOS复核通过；未重跑完整媒体E2E。失败候选Windows38/架构1647（9 skip）/Linux117不能替代完整旧库启动验证；原两Token scoped Reset已执行且未恢复DB，旧队列未恢复。完整备份、两次标准deploy、保护证据及后续261门禁见[事故记录](../helix/implementation/evidence/UAT-261_CATALOG_STARTUP_DEPLOYMENT_20260912.md)。

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
