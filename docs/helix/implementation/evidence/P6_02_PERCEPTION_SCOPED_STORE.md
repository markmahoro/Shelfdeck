# P6-02 User Perception Scoped Store Evidence

Status: `PASS`

Date: 2026-07-17

## SSOT traceability

| SSOT | Implemented invariant |
| --- | --- |
| §3.6.2–3.6.3 | Source/Cursor显式revision；Record与Anchor不可原地修改；用户即时输入允许无Integration、无sync cursor |
| §3.6.4、§5.9.1 | Resolution只允许`found|not_found`；found必须指向既有Record，not_found没有winner |
| §8.2.4 | `PerceptionRecordRepository`与`PerceptionResolutionRepository`为两个独立Repository definition |
| §8.5.1–8.5.2 | 两者Owner均为`perception`且只注册`perception_`表；不持有其它Domain/Foundation/Platform表 |
| §8.5.13 | 7张表、Source/Cursor CAS、Record source identity unique、normalized relation pair和Resolution head/revision全部闭合 |

## Physical result

- `PerceptionRecordRepository`只注册5张表：Sources、Source Cursors、Records、Identity Anchors、Dedup Relations；
- `PerceptionResolutionRepository`只注册2张表：Resolution Revisions、Resolution Heads；
- 新Source config revision固定从1开始；sync cursor可以为空，首次sync再原子建立revision 1；后续只允许current+1 CAS；
- Source config CAS不会移动cursor head，Cursor历史只追加不覆盖；
- Record、Anchor、Relation均只提供insert/query；rating在Repository入口严格为`null|1..5`，watched state闭合；
- Source identity replay由DB唯一合同阻断，Record/Anchor写入任何失败均整体回滚；
- Relation pair按Record ID规范化，同一pair只能有一条immutable relation；
- Resolution发布先验证expected head及winner，再原子插入revision并建立/推进显式head；读取不使用`MAX(revision)`；
- 全部返回值深冻结，不暴露raw SQL、TransactionContext或Repository definition。

## Machine evidence

- P6 Perception Store专项：8/8 PASS；
- architecture：65 fixture files；47 packages、55 files、67 dependencies，findings=0；
- semantic：1438 files、12 exact exemptions，findings=0；
- P2 contracts：112/96/156/18，aggregate
  `bcde76e0d380ead9fbe9c76c6c21293325d2de3dd97144c1357438c3d3cc8530`；
- P3 persistence：156 tables、72 indexes、19 partial unique、18 canonical transactions、132 fault points，PASS；
- static counterexamples拒绝其它Owner表前缀、raw SQL和`MAX(revision)`；
- `prohibitedActionsRun=[]`。

本工作包只使用owned temporary SQLite；未接Outbox/Capability/Product startup、HTTP/API/UI、真实Provider/媒体、E2E、
Docker、production或`media-desktop`。本线程未修改SSOT。
