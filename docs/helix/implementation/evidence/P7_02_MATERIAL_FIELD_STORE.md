# P7-02 Material Field Store Evidence

Status: PASS; frozen.

- SSOT traceability: §2.2–2.3、§3.3.2、§8.2.1、§8.5.11。
- `MaterialFieldRepository`精确拥有`proc_material_fields`、`proc_field_access_revisions`、
  `proc_extraction_policy_revisions`三张表，不取得Platform Store或其他Domain Repository。
- 注册在单一Procurement UoW内按Policy→Field temporary head→Access Revision→final head闭合双向FK；提交结果不存在
  null current pointer，任一失败整事务rollback。
- Policy与Access均使用immutable revision、canonical SHA-256、exact current CAS；Policy JSON上限16 KiB。
- Field disable只改变行政生命周期并保留全部Policy/Access历史，不删除、移动或观察真实材料。
- Focused P7：9/9 PASS；重复Field、digest tamper、oversize Policy、stale/skipped revision、disabled revision均fail closed。
- 完整P3 Persistence：77 architecture fixtures、161 tables、74 indexes、20 partial unique、24 transactions、25 crash fixtures
  PASS；`prohibitedActionsRun=[]`。
- 未修改SSOT，未运行真实Field、E2E、Docker、production或`media-desktop`动作。
