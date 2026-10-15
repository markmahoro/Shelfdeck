# ShelfDeck / Helix 文档索引

更新：2026-10-15。当前唯一活动Phase为JAV首版本地开发及部署准备。单站主备、未确认身份/首次锁定、Artifact/加工入藏、独立身份纠正及同任务显式终态恢复已实现，Windows与实际Host证据、具体版本UI负责人接受已记录。用户启动本机Docker后，标准候选镜像已构建；本机隔离Linux验证暴露基础FFprobe 8.1漏读HEVC色彩资料，固定为锁定依赖探测器后重新构建/验证中。生产完整一致升级副本仍受未收口任务阻断；无NAS停机/Reset/部署。NAS临时隔离Linux按用户决定skip。详见CURRENT_PLAN/CURRENT_STATUS/CURRENT_PHASE与JAV证据。

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
