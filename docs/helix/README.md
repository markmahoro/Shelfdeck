# ShelfDeck / Helix 文档索引

更新：2026-09-30。Helix Beta Movie全链路已获用户阶段验收；当前进入Series开发，首批元数据基础已本地验证。Series完整功能尚未交付，Beta保持Movie-only A–I。

## 权威与当前入口

| 文档 | 用途 |
| --- | --- |
| [TOP_DOWN_ARCHITECTURE_CONFIRMATION](TOP_DOWN_ARCHITECTURE_CONFIRMATION.md) | 唯一架构 SSOT；含未来 Series 的 Owner、Season/Episode 与连续性合同 |
| [BETA_FEATURE_ACCEPTANCE_BASELINE](BETA_FEATURE_ACCEPTANCE_BASELINE.md) | 原 Movie-only Definition of Done 与 Movie 回归 Oracle；不改写技术资格验收方法 |
| [CURRENT_PLAN](CURRENT_PLAN.md) | 唯一 Master Plan：Movie 收尾、Series 准备及后续顺序 |
| [implementation/CURRENT_PHASE](implementation/CURRENT_PHASE.md) | 唯一活动执行包：Series开发及Phase工作项 |
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

阶段接受不批量关闭残余UAT，不新增技术资格总体PASS；未来Series必须独立完成真实链路与Movie回归。生产、Formation Reset和真实媒体副作用继续按明确授权及精确范围执行。
