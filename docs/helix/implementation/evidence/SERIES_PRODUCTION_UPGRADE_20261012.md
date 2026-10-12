# Series 生产升级记录（2026-10-12）

17:34（Asia/Shanghai）：升级验收完成。17:31标准deploy成功，NAS及LAN health均为`status=ok`、`normalSupplyAllowed=true`，Admin HTTP 200；17:33最终迁移后逐行历史审计及完整性复核全部通过，integrity=ok/FK=0，服务持续健康。用户可配置Series Shelf与Material Field；本次未代用户创建这些配置。

## 发布身份与范围

| 项目 | 已核对值 |
| --- | --- |
| 镜像 | `markmahoro/shelfdeck:cab3e2d77` |
| 运行时Git | `cab3e2d77ac0b6506a268c97ac07af82f4442e49` |
| Image ID | `sha256:d927c546c3d77690af75829527d785bab5001008d9e3a1b5aa61ba5035773c3b` |
| tar | `shelfdeck-cab3e2d77.tar`，1,724,112,384字节 |
| tar SHA256 | `bfe6769dedae1699d24c5349d6b9077cb364091e1ac8c6f55f9ea98aff4e9aa0` |
| 服务 | `http://192.168.12.230:18080`；Compose `/vol1/1000/docker/shelfdeck` |
| StartedAt | `2026-10-12T09:25:09.099888741Z`；验收时RestartCount=0 |
| Schema | `helix-clean-v3` / `c00f45c15c5540e158a688c32fd4b57fdbc146b1a28067f0ac7fe82c496d0d5d` |

按标准build-image.js、upload-nas-image.js及deploy-nas.js执行，构建、上传checksum、dry run、apply全部通过；未clean-init。演员方案采用用户最终选定的单Episode来源，不采用跨全季聚合扩容提案。本批Series UAT-282–311分别按自身Evidence收口；独立Movie外部BDMV UAT-312仍开放，本次不宣称修复或恢复其任务。

## 授权与限定清理

用户明确同意先清理《万里归途》(2022)、《周处除三害》(2023)、《宇宙探索编辑部》(2023)、《荒野猎人》(2015)四项未入藏进度再升级。精确Subject/Run及停机范围见[UAT-293](UAT-293_LOCAL_UPGRADE_TEST_RESET_20261009.md)。停机plan无已Commit条目、无Custody或On-deck Run。完整备份核验后清理4 Subject/4 Run/1 Package/59 Work，删除3个Workspace目录（另一目录原本不存在），重复plan归零；manifest digest `6cab97983c765f6b1e66b07c69abf4ff7bf059d6e12a729bd03982dc87e4156d`，integrity=ok、FK=0。

首次包装使用旧生产镜像工具，遗漏Run outcomes而被FK检查拦住；事务与Workspace全部回滚。回滚后DB与停机备份SHA一致，7个Workspace文件逐文件SHA一致。最终候选已包含该清理闭包修复；包装提交`5248795f7`允许显式指定不可变Reset镜像ID，同时强制keep-stopped及非空Subject范围，仍保留备份与plan/apply/plan。包装10项及既有Run outcomes回归1项通过后，在相同获批范围完成清理。没有手工SQL，没有改变应用镜像内容。

## 备份与回退边界

- 完整停机备份：`/vol1/1000/docker/shelfdeck/backups/series-preflight-20261012-05-stopped`，含data、docker-compose.yml、secret.env和receipt；DB 2,570,006,528字节，源/副本SHA256均为`82db4a85aea53ab200aad4f6e2319f645aa6bade40ac46673d46e5cbc414348b`，39伴随文件校验一致、integrity=ok/FK=0，Compose/Secret逐字节一致。
- 精确Workspace备份：`/vol2/1000/shelfdeck_transcode/.upgrade-backups/series-cab3e2d77-stopped`，7文件共7,104,409,698字节，独立inode/reflink副本及逐文件SHA核验，receipt记录第四Workspace不存在。
- 标准Reset追加备份：`/vol1/1000/docker/shelfdeck/backups/formation-reset-20261012T091753Z/data`。首次失败Reset备份`formation-reset-20261012T091108Z/data`亦保留。
- 原生产镜像：`markmahoro/shelfdeck:helix-beta-20260930-8e197b3c36`，Image ID `sha256:168be0bb2101b79424f7f978c32d3724852eb5267b2234a4c981c22fe075ac2b`。

若需回退，先停止该Compose服务并保全升级后数据，核对以上05完整备份与Workspace receipt，再恢复对应旧data/Compose/Secret及精确Workspace，使用原镜像并重新验收。不能仅切旧镜像读取新版Schema；不得直接覆盖当前新成果。旧镜像在backup03隔离副本已完整健康启动，但只读物理目录下的演练不证明未完成加工恢复。失败的04-stopped及其他未完成Workspace备份不作为回退依据。

## 数据保护与上线验证

停机备份→限定Reset后的逐行摘要一致：504 Shelf Entry、36,111 Inventory Material、504 On-deck Commit；保留31,390 Plan、71,755 Node、45,439 Edge、80,605 Result Binding及46,663 Commit Marker。限定删除59 Plan等闭包与冻结manifest一致。Reset后integrity=ok/FK=0。

迁移后同一批保留记录在固定只读快照内再次逐行摘要一致，数量全部保持，完整性检查ok/FK=0。四份原视频按停机备份记录重新核验，存在、大小及middle-256k-sha256均一致。完整媒体文件全量SHA未执行；这里不把有界指纹称作全文件摘要。

NAS/LAN health、Admin页面入口、实际镜像ID、五个数据/媒体挂载与QSV设备通过；无源码覆盖挂载，RestartCount=0。fnOS管理HTTP 200，其余原有容器运行状态保持，根目录及用户目录权限未改变。临时只读SQLite连接仅辅助标准readiness建立副本，已关闭并移除。

## 测试与E2E边界

最终运行时Windows专项34项、四项静态门禁、Windows两集重复NFO→Commit→整季迁移及Linux同Host链路通过；Linux相关7通过/0失败/43过滤skip，Service602通过/0失败/29skip。此前全架构2493通过/1个陈旧P2摘要断言失败/12skip，修正后针对性3项通过；没有将其写成修正后全架构重跑通过。

精确候选完整生产副本健康启动/退出、原历史逐行保护以及旧镜像备份恢复演练通过。原《大江大河》33集新Run的单Episode演员Fact、34 NFO及35 Artifact验证已验收；不以此宣称该原整季已完成入藏。本次生产未新增Series配置，未执行生产真实Series整季E2E；桌面全量构建/测试未重跑。既有UI负责人验收随原UAT保留，最后NAS包装变更无UI。

原始操作日志及JSON保存在ignored `.codex/series-release-20261012/`：`formation-reset-candidate-apply.log`、`deploy-production-final-apply.log`、`post-reset-history-audit.log`、`post-migration-history-audit.jsonl`、`production-originals-post-reset.json`、`production-final-platform-verification.log`。不将导出的生产数据或凭据加入仓库。
