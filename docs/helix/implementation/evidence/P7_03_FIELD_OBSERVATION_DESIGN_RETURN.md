# P7-03 Field Observation Design Return

Status: OPEN AGAIN；PBF-07已闭合原始snapshot/revision缺口，但完整Page durable fact存在新的size/persistence矛盾。

## 1. Proven conflict

P7-03需要把`procurement.field.page.observe@1`的正式Result交给
`procurement.field.observation.commit@1`，并原子形成`proc_field_observations`与`proc_field_materials`。
当前SSOT/P2合同不能提供生成合法Material row和合法Result revision所需的全部信息。

本线程没有修改SSOT，没有把opaque ref当成Physical Material事实，也没有写默认Identity/hash/stat/location或伪造revision。

## 2. Missing realizable input

合同位置：SSOT §8.6.3、§8.6.18–8.6.19；生成合同：

- `contracts/types/FieldObservationPage/v1/schema.json`
- `contracts/capabilities/procurement/field/observation/commit/v1/inputs.schema.json`
- `contracts/table-contracts/proc_field_materials/v1/contract.json`

`FieldObservationPage.materialObservations[]`当前每项只有：

~~~text
objectId
revision
schemaRef
snapshotDigest
objectKind = field-material-observation
~~~

但`proc_field_materials`提交至少必须得到：

~~~text
material_key
mount_scope_id
inode
content_hash_algorithm
content_hash
size_bytes
mtime_ns
ctime_ns
hash_verified_at_ms
current_location
binding_revision
last_observation_id
eligibility_state
control_projection
~~~

closed input中没有完整typed Material Observation，也没有Artifact/Object Snapshot Handle、Resolver port或第二个named input可以
把`objectId/revision/snapshotDigest`合法解析成上述值。`DomainFactCommitHandle`只绑定payload digest和Fence，不携带业务payload，
不能作为补值渠道。

因此当前实现只能做以下两种错误选择，均被拒绝：

1. 把`objectId`冒充`material_key`并为其余列写默认值；
2. 在Commit时旁读未定义的全局Object Store/旧Nexora Store。

## 3. Missing Result revision continuity

合同位置：`contracts/types/ObservationCommitResult/v1/schema.json`和SSOT §8.6.18–8.6.19。

`ObservationCommitResult`继承`DomainFactEnvelope`并强制：

~~~text
aggregateType
aggregateId
revision >= 1
factDigest
commitMarker
~~~

`DomainFactCommitHandle`同时强制`aggregateId + expectedRevision`。但当前Procurement persistence只有：

- `proc_material_fields`：Access/Policy current pointer，没有Field Fact revision/head；
- `proc_field_observations`：每页独立`observation_id`，没有revision或current head；
- `proc_field_materials`：每个Field/Material current row，只有binding revision，不是Observation aggregate revision。

一次Access revision可以提交多页Observation，因此不能把`access_revision`当Observation revision；时间戳、page ordinal或
`observation_id`也不能合法替代单调CAS revision。当前没有可持久化并重放的revision连续性。

## 4. Architecture contract needed

需要Architecture Agent在SSOT中唯一确定并传播以下工程合同，不涉及新的用户业务选择：

1. `FieldObservationPage.materialObservations[]`提供可提交的完整typed snapshot，或提供正式、可解析且Owner明确的Snapshot Handle；
2. snapshot至少闭合Physical Material Identity、stat/hash reality、location、binding revision和provenance；
3. 明确`eligibility_state/control_projection`在Observation Commit的初始合法值及后续P7-04重算责任，或把其正式Basis加入输入；
4. 明确Observation Commit的`aggregateType/aggregateId/revision/expectedRevision`语义及其持久化head/CAS位置；
5. 保持page replay所需的stable observation ID、page digest、cursor、Result digest和Commit Marker连续性；
6. 对应更新formal DTO、Capability input/result、必要table/head/transaction合同及source map。

## 5. Resume gate

只有上述输入和revision连续性同时在SSOT/P2合同闭合并经重物化验证后，P7-03才能继续。无需用户决定Material Field业务
语义；这是正式输入/输出与持久化可实现性缺口。

## 6. PBF-07 closure verification

Architecture Agent提交`964c6e05`后，原第2–3节阻塞已经闭合：

- `FieldMaterialObservationSnapshot`成为完整inline DTO；
- `proc_material_fields.current_observation_revision`与`proc_field_observations(field_id,revision)`形成Field级连续head/CAS；
- `FieldObservationPageRequest`、稳定Work/Page ID、cursor、digest、Result与Commit Marker语义闭合；
- 新Material固定初始化`eligibility_state=unknown,control_projection=unknown`，最终reconcile归P7-04；
- canonical transaction从24增至25，循环FK以`DEFERRABLE INITIALLY DEFERRED`落成。

实现线程精确吸收SSOT提交后，完成112 Capability / 96 Result / 161 table / 25 transaction重物化；新增事务的participant
前后崩溃、revision fence、COMMIT后重启均PASS。合同传播提交为`17b14904`，本线程未修改SSOT。

## 7. Newly proven durable-page conflict

### 7.1 Contracts that must hold together

1. SSOT §8.5.4 canonical transaction row要求原子事实集包含完整`FieldObservationPage`；
2. SSOT §8.6.19允许`FieldObservationPage`最多100项、完整value最多`512 KiB`；
3. SSOT §8.5.11的`proc_field_observations`只保存page header、digest、marker和result digest，没有`page_json`或成员历史表；
4. 同节`proc_field_materials`明确是每个Field/Identity的current row，后续Page会更新location/reality/provenance/last snapshot，
   因而不能恢复任一历史Page的完整snapshot集合；
5. SSOT §8.5.9/§8.5.10的`fx_event_result_bindings.evidence_json`与`result_json`各硬限制`64 KiB`；
6. `ObservationCommitResult`只含accepted material摘要，不含完整`FieldMaterialObservationSnapshot`。

### 7.2 Unimplementable legal input

任一canonical size位于`65537..524288` bytes的合法`FieldObservationPage`均触发矛盾：

- 写入`fx_event_result_bindings.evidence_json`会违反64 KiB table CHECK；
- 只写`proc_field_observations.page_digest`会丢失“完整Page”事实，无法审计或从Store恢复；
- 依赖`proc_field_materials`会在下一次同Identity observation后丢失历史snapshot；
- 截断Page、降低实现上限、塞入opaque ref、旁读旧Store或运行时缓存都改变正式合同或破坏重启连续性。

因此实现无法同时满足输入上限、atomic fact set、append-only history与durable replay。该问题不是业务选择，也不能由实现线程
通过兼容层解决。

## 8. Architecture contract needed now

Architecture Agent需选择并正式传播一种唯一持久化合同，例如：

1. 新增Procurement-owned immutable Page/Member fact table，完整关系化保存每页snapshot；或
2. 为`proc_field_observations`增加受明确byte limit约束的完整typed `page_json`，并使上限与512 KiB合法输入一致；或
3. 把Page上限正式收紧到Foundation evidence JSON可容纳范围，并明确`fx_event_result_bindings.evidence_json`是完整Page的唯一
   durable location（还需证明Result+Evidence各自64 KiB约束）；或
4. 引入正式Artifact Handle方案，但必须闭合Artifact Owner、同事务durability、digest、replay和GC reference，不能只写opaque ref。

同时需明确Field Observation Page Commit是否允许`outboxMessages=[]`：当前canonical transaction声明`hasOutbox=false`，但P3
`DomainCommitCoordinator`当前要求至少一条Outbox。若该事务仍属于`domain_fact_commit`，Foundation协调合同必须允许“合同声明
无Outbox”的typed commit；不得伪造消息只为满足旧协调器。

## 9. Current resume gate

恢复P7-03前必须同时闭合：

- 合法最大Page的唯一durable完整事实位置及精确byte limit；
- 历史Page在后续current-row更新后仍可恢复/审计；
- 该事实与Field head、Material current rows、typed Result、Commit Marker的同事务关系；
- `hasOutbox=false`在正式Domain Commit协调器中的合法执行语义。

在此之前不提交partial Store，不降低Page上限，不伪造Outbox，不修改SSOT。

## 10. Closure and implementation receipt

Architecture Agent提交`19ed12fa`正式闭合第7–9节阻塞；实现线程仅将该提交精确纳入为`8021c8c7`，未编辑SSOT：

- `FieldObservationPage`与`ObservationCommitResult`完整typed value各自≤65,536 UTF-8 JCS bytes；
- 完整Page固定写入同一Commit Event的`fx_event_result_bindings.evidence_json`，并由
  Observation revision→Commit Marker→Result Binding形成长期历史恢复链；
- `proc_field_observations.commit_marker`显式FK指向Foundation Marker，循环写入使用deferred FK；
- exact canonical Transaction Contract决定Outbox cardinality，Field Observation固定`outboxRequired=false`且零消息。

合同重物化提交`3c6e6d6a`完成112 Capability、96 Result Family、161 table、25 transaction传播，并冻结Page/Result
64 KiB Schema扩展、170项FK、DDL与crash fixture。实现提交`15f27b7b`完成：

- pure page Observer只使用注入的bounded enumerator和clock，按materialKey UTF-8 bytes排序，同时按`1..100`条目与64 KiB
  canonical bytes截断；cursor只越过已返回成员，不能装入首项时不推进并稳定失败；
- 完整Physical Identity/stat/hash/location/provenance/reality snapshot及所有JCS digest逐层校验；
- Field current Observation head以SQL NULL映射逻辑revision 0，随后跨Work连续CAS；同Work page/cursor连续，Access head与
  running Supporting Work均在同事务preflight；
- Observation revision、Material current rows、完整typed Evidence/Result和Marker全有或全无；新Material为
  `unknown/unknown`，refresh保持binding revision，endpoint/location变化才rebound，reality变化只重置Eligibility；
- `mtime_ns/ctime_ns`在SQLite边界使用signed int64并以BigInt无损往返；marker replay恢复首次typed Result和完整Page Evidence；
- canonical transaction明确禁止伪造Outbox；旧的Outbox-required Domain transactions仍保持非空要求。

验证结果：P7 focused与P3/P6回归`33/33 PASS`；完整`media-service/test/helix-architecture/*.test.js`
`526/526 PASS`，`findings=0`。未运行E2E、Docker、Service启动、真实Field扫描、真实媒体副作用、部署或生产动作；
未修改`media-desktop`。本Design Return现为已闭合历史证据，P7-03恢复门禁全部满足。
