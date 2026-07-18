# P7-04 Extraction Eligibility Reconcile Design Return

Status: OPEN — formal realizability gap；implementation thread did not modify SSOT.

Date: 2026-07-18

## 1. Implementable basis already closed

P7-03已经提供可实现的Observation侧输入：Field current Observation head、terminal page、完整Page Evidence、同Work覆盖集合、
current Material reality、Access revision及跨Work CAS连续性。SSOT §8.6.4也明确：Work未terminal或Access revision变化时不得形成
missing结论；terminal后可由head所指Work和Material `last_observation_id`判断本轮是否出现。

因此“存在于当前完整Observation覆盖”“当前Field/Access有效”“reality变化先回到unknown”三项不再阻塞P7-04。

## 2. Exact SSOT decision that must be implemented

SSOT §5.3.1把Extraction Eligibility固定为以下合取：

1. Field Material存在且可访问；
2. 当前位于Procurement Region，且Control可在Run admission原子取得；
3. 未被任何尚未sealed且仍持有Selection/Reservation的Procurement Run占用；
4. Extraction Policy允许；
5. 没有当前有效的重复开采抑制。

§5.10.2又限定Decision输入只能是Field Observation、Procurement Region、Extraction Policy、Selection/Reservation
conflict与Control acquirability。§8.5.11要求P7-04最终写`proc_field_materials.eligibility_state/control_projection`，
而最终Control取得仍必须在Run admission对`fx_material_controls`执行CAS。

## 3. Gap A — Extraction Policy has no executable closed contract

当前`proc_extraction_policy_revisions`只保存：

~~~text
policy_schema_ref + policy_json + policy_digest
~~~

P7-02只能验证它是≤16 KiB的任意closed JSON value，P2没有`ExtractionPolicy@1`正式DTO、Rule union、Decision input/output或
Evaluator contract。§9.6.2只列产品示例：包含/排除目录边界、扩展名、最小文件大小、显式排除模式；没有唯一确定：

- 每种rule的字段与类型、是否允许空集合及上限；
- location相对哪一个root、separator/case/Unicode normalization语义；
- include与exclude优先级、目录边界与pattern匹配语义；
- size、extension、specific member/identity与whole-Field规则如何合取；
- unsupported/旧schema应形成`unknown`、`ineligible`还是稳定contract failure；
- Eligibility reason/basis digest如何证明使用了精确Policy revision。

实现若自行发明`includeExtensions`、glob、默认allow或优先级，就会把工程选择升级为未确认的用户Policy语义。

## 4. Gap B — “current duplicate-extraction suppression” has no fact continuity

§5.3.1把“没有当前有效的重复开采抑制”列为mandatory conjunct，但161表中没有Procurement-owned suppression表、
current pointer、state、scope、basis、expiry/revocation或Facade command。唯一`suppression`表属于Arca Off-deck，不能跨Owner复用。

§6.3.3同时明确失败Run/Candidate历史不能成为隐藏的重新开采抑制规则。因此实现不能：

- 把sealed/failed历史暗中解释为suppression；
- 永久记忆一次失败；
- 默认“Beta永远不存在suppression”并跳过SSOT mandatory conjunct；
- 读取Arca suppression或旧Store补齐。

当前没有输入能区分“无有效suppression”与“合同尚未提供suppression事实”。

## 5. Gap C — Control Projection lacks a formal versioned reconcile input

Region由当前Material Control动态派生，`fx_material_controls`拥有全局current row和revision history；
`proc_field_materials.control_projection`只是候选筛选Projection，不能替代最终CAS。当前Foundation仅暴露写入型
Material Control participant，没有正式read/query port或typed snapshot供Field Management消费。

`proc_field_materials`也没有`control_revision/control_digest`字段。若实现先读Control、后写Procurement current row：

- 无法证明Projection对应哪个Control revision；
- 较旧reconcile可能覆盖较新Projection；
- overlapping Fields对同一Identity可能以不同旧快照写出互相矛盾的Region；
- 不能区分“从未有Control row”和“读取/Projection不可用”而不伪造`uncontrolled`。

最终Run admission CAS可以防止错误取得Control，但它不能让P7-04当前Eligibility/Region Projection本身满足SSOT freshness与
可恢复性要求。

## 6. Persistence/output continuity still needed

Architecture Agent需要提供唯一可重物化的合同，至少闭合：

1. Beta `ExtractionPolicy@1` closed schema、rule precedence/normalization和deterministic Decision basis；
2. `ExtractionEligibilityDecision`或等价正式输入/输出，含Field/Material binding、Observation Work/head、Policy revision、
   Selection conflict、Control Projection revision/digest、suppression basis及稳定reason codes；
3. 重复开采抑制在Beta的唯一语义：若存在则补Procurement Owner、scope/lifecycle/table/Facade；若Beta明确不存在，则必须在
   SSOT中正式删除/收敛该mandatory input，不能由实现默认；
4. Foundation Material Control read Projection的typed、versioned、restart-safe合同，以及`uncontrolled|procurement|production|
   finished_goods`的精确映射；
5. stale reconcile防护：在`proc_field_materials`保存Control basis revision/digest，或提供同事务/version CAS的等价方案；
6. terminal coverage下missing Material的明确结果与持久化动作，以及Access变化/新Observation开始时如何回到unknown；
7. reconcile是纯Procurement current projection update还是canonical transaction，并明确其atomic set、marker/outbox要求。

## 7. Resume gate

只有上述Policy、suppression、Control Projection和stale-write连续性进入SSOT/P2机器合同后，P7-04才能唯一实现。
本问题不要求用户选择代码结构；若Beta Policy产品语义或是否提供用户可管理suppression需要业务取舍，应由Architecture Agent
整理为真正的业务Decision Packet。实现线程不会修改SSOT，不会用默认allow、默认无suppression、旧Store旁读、无revision
Projection或最终Control CAS来掩盖当前缺口。
