# P7-03 Field Observation Design Return

Status: OPEN；implementation blocked before speculative code.

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
