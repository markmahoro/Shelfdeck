# ShelfDeck / Helix 文档索引

2026-10-16 当前生产已标准部署dc7dcddbaf（Libra二号暂存/来源公平、UAT-318查询优化及UAT-320展示修复、/adult别名）。560原收藏/两季原Run及Workspace保持，UTC18:25 health/running/normalSupplyAllowed通过。用户明确跳过本轮NAS完整Host演练；完整备份/203表逐行保护与标准readiness不冒充该项PASS。首开大文件传输超时及整季交付仍开放，生产身份以CURRENT_STATUS和对应Evidence为准。

以下较早快照保留为历史。

更新：2026-10-15。JAV首版已通过本轮发布资格，标准部署生产037592bef4并恢复正常供给；556条原收藏、入藏Receipt与历史保护通过，已观察新Libra执行成功。完整副本升级/正常Host/受保护回退、Linux/Windows Service及具体版本UI证据见既有JAV_RELEASE_COPY等记录。唯一活动Phase现为本轮发布与用户验收承接；不以部署替代用户验收、Phase正式Exit或既有UAT关闭。原NAS常规临时Linux项保留user skip，仅本次完整副本例外经明确授权执行。

## 权威与当前入口

来源验证及Source qualification、首次Fact/Correction已接正式流程，单站title+可用cover基线保持；CID完整映射、当前FC2路线等残余按Phase/evidence记录，不由fixture或早期样本宣称所有来源稳定可用。原Movie-only Beta验收边界保持。

| 文档 | 用途 |
| --- | --- |
| [TOP_DOWN_ARCHITECTURE_CONFIRMATION](TOP_DOWN_ARCHITECTURE_CONFIRMATION.md) | 唯一架构 SSOT；含 Movie、Series、JAV 和 Western Adult 的各自合同 |
| [BETA_FEATURE_ACCEPTANCE_BASELINE](BETA_FEATURE_ACCEPTANCE_BASELINE.md) | 原 Movie-only Definition of Done 与 Movie 回归 Oracle；不改写技术资格验收方法 |
| [CURRENT_PLAN](CURRENT_PLAN.md) | 唯一 Master Plan：JAV 准备与后续顺序、既有成果与残余边界 |
| [implementation/CURRENT_PHASE](implementation/CURRENT_PHASE.md) | 唯一活动Phase：JAV差距、待定决策、工作项与验收；OPS及Series包已归档 |
| [CURRENT_STATUS](CURRENT_STATUS.md) | 用户阶段接受、最近已记录生产身份、风险及未完成事实 |
| [ENGINEERING_PLAYBOOK](ENGINEERING_PLAYBOOK.md) | 实施、验证、授权、UI负责人与变更治理 |
| [UAT_ITERATION_REGISTER](UAT_ITERATION_REGISTER.md) | 上线后测试、验收问题台账；保留已有编号和历史记录 |
| [UAT-278 收尾证据](implementation/evidence/UAT-278_BETA_MOVIE_CLOSEOUT_20260930.md) | Movie阶段接受、基线对齐、残余承接、归档及验证边界 |

冲突按 SSOT、Master Plan、Playbook、Phase、Status、Evidence 的工程权威顺序处理；Beta验收结果仍受原基线约束。Helix文档高于历史v3/Kairox、v2架构和归档，历史部署/debug规范按适用范围使用。当前机器库存以仓库manifest为准，不在索引固定历史计数。

## 历史与证据

- [Movie 收尾快照](implementation/archive/20260930_BETA_MOVIE_CLOSEOUT/SNAPSHOT.md)冻结旧活动文档，不能继续指导当前实施。
- [implementation/archive 索引](implementation/archive/README.md)记录已结束Phase与稳定化包；`implementation/evidence/`保存验收及发布证据。
- `LEVEL7_BUSINESS_DECISIONS.md`、`ARCHITECTURE_REVIEW.md`是非Canonical已关闭审查Evidence。
- `PRODUCTION_DEPLOY_ISSUE_LOG.md`、`USER_ACCEPTANCE_TEST_ISSUE_LOG.md`、`ADMIN_WEB_UX_ISSUE_LOG.md`及`archive/`为历史。新增上线后问题进入UAT总表；大版本准备与开发进入Master Plan及唯一Phase，不使用UAT编号。

阶段接受不批量关闭残余UAT，不新增技术资格总体PASS；JAV必须独立完成真实链路与Movie/Series回归。生产、Formation Reset和真实媒体副作用继续按明确授权及精确范围执行。
