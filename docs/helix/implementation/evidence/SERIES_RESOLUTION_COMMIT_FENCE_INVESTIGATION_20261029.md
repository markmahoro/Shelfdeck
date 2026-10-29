# Perception Resolution Draft / Commit Handle 竞态诊断

2026-10-29，面向独立Series候选 `27a0f68af3599a3422b21853632fc8a01878b750`；全部测试在本机禁网容器、隔离合成数据库中完成，未访问NAS。此文是隔离诊断证据，不是正式资格或生产数据事实。

## 根因与合同边界

- Resolve Event 产出的 `PerceptionResolutionDraft` 冻结了 Query/Record Set/Rule 摘要。`perception-planners.js` 的 Commit Handle projection 却重新读取 `resolutionProcessContext(processId)` 的当前 Query、Record Set 与 head，用当前 Query 生成 aggregateId。Subject 的公开目标版本变化即可改变 Query 的 evidenceDigest / queryInputDigest。
- `perception-store.js:339–361` 要求 Handle aggregateId 和已成功 Draft 的 Query 精确相等，且要求 payload 与 Draft digest 均准确。当前值发生变化时抛 `P6_PERCEPTION_RESOLUTION_COMMIT_MISMATCH`。不能只改一处摘要而不审查当前资格、完整 Work basis 与 head revision；Draft 与当前状态不同也不能通过放宽断言处理。
- Perception planner、process services、store、resolver 和 Foundation input provider 在生产基线 `a2bf2d6fd` 与候选 `27a0f68af` 的Git blob均相同；Foundation event-runtime/host有其他候选修改，调度时序可能不同。首次完整门禁失败现场未保留，以下受控和自然复现不证明该首次样本的精确原因。

## 精确候选自然复现

使用原 `series-routing-run.test.js`（SHA256 `f51c783bf6beadf5ca77d43aecf335cdbd21249c1d942a98cefe471be2251d53`）的 `Isolated Host schedules 2 Episodes through metadata and Direct On-deck Commit with concurrent non-overlapping E03` 名称过滤，不注入业务错误。只读 trace 比对实际投影和store拒绝条件，不改变计算或调度；目标测试0 PASS/1 FAIL，其余29按名称跳过，出现与全量门禁相同文案及错误。

trace证明 Handle aggregateId与Draft的queryContract/queryInputDigest推导值不等，而`payloadDigest`、Draft内部`draftDigest`均匹配。首次trace源文件保留为`trace-resolution-first.cjs`，SHA256 `a6e85854caeba04bf2d8313ef79cd086776a720cf2dc61d14cbe59043e4a6d19`；完整TAP `run-01.log` SHA256 `19d77572fef021340010b7c7ed846704fc356ed6fdb848bcf07cc390790fae97`。

Host 在捕获错误后立即按原测试teardown；只读保留库`fixture-01.json` SHA256 `6bb52c852656e4cc18df36489d60def6695e155579aab8ea74aef694f52bdef4`：Resolve Event succeeded，commit Event/Attempt executing，原`domain_fact_commit` Effect为`reconcile_required`，无Commit Marker、无commit Result，该process仅一条running Work，On-deck 0，数据库integrity ok、FK错误0。不能称其已收敛，也不能按无Effect的P8 input stale覆盖。

保留的合成fixture在Docker volume `shelfdeck-resolution-investigation-scratch` 的 `/scratch/helix-series-routing-LkNEhl`，含原SQLite及WAL/SHM；`inspect-fixture.cjs`以readonly/query_only读取。保留原始文件，不清理。

## 基线对照与可控条件

`a2bf2d6fd`实际镜像使用同一27a测试文件、基线镜像的`src/scripts/node_modules`及只读trace，一次自然对照1 PASS/0 FAIL，29 skip；日志 `baseline-01.log` SHA256 `30b5cc25961f36498374fb331e757f7a9d9eca27c5550ac1b1cc0a5882df868e`。一次通过不证明基线不存在竞争。

`force-target-revision.cjs`只在一次Commit Handle投影时，让既有`targetProjectionReader`对合成Subject返回更高的revision（1→2），不改业务源码、数据库或原测试断言；a2bf Host重现同一aggregate mismatch、同一P6错误。`baseline-forced-01.log` SHA256 `d0938257595129d74ff2f64a19797d0f5c1364f00914de8bf2723dea4b82b86d`。保留库 `baseline-forced-fixture-01.json` SHA256 `9d4e1c23aae93bfa0f68033f53482b42901902554baca0935cc865daf73d88a2`：该注入后revision回到原值，原commit Event/Work和Effect已failed，Attempt为`P4_EVENT_RECOVERY_INPUT_DRIFT`，无Marker/Result，On-deck 0；这不代表真实持续版本变化必然具有同一恢复结果。

## 持续变化下的有界恢复观察

`force-persistent-target-revision.cjs`让一个合成Subject在首次Commit Handle投影起持续显示更高版本；`series-observe-continuation.test.js`仅对这条诊断错误不提前终止监听，保留原两Run/On-deck断言及150秒上限，不可当作原测试或交付门禁。它持续记录同一Event/Effect的P6错误，150秒未产生两条Run，原commit Event/Attempt仍executing、原Effect仍`reconcile_required`，0 Marker/Result且无同process的新Work，On-deck 0；另一watched Resolution成功不构成该rating Effect恢复。数据库integrity ok、FK错误0。

日志 `persistent-01.log` SHA256 `933ee3fb383c5fdc5a30a3a5c518aae5ff0d8548e8a60942f6473906a07dd365`；查询 `persistent-fixture-01.json` SHA256 `2ce782911f46cce24aa99cd1a4c3cc130205c50474b15568ef391fd40b7cdf0f`；注入和改写测试分别为 `force-persistent-target-revision.cjs` SHA256 `b6d74bf2805334afecaff7dbb6bf2795eb35363bbe221440b20d91a872794305`、`series-observe-continuation.test.js` SHA256 `36381b32b8612173b70c6e328c08f877ec2c71f653edec2f84d1abf6e91b57d1`。只说明有界测试中未收敛，不推断永久失败或线上必然受影响。

恢复合同中，domain fact Effect须先由Observer精确证明无Commit Marker且Fence有效，才能`safe_retry/revalidate_and_commit`；输入重建漂移亦须重证原Effect无提交后才可终止/abandon。修复需要覆盖原Effect已持久化后的无副作用收口、与当前完整Basis关联的后继Work及目标被篡改/真正Commit存在的负例。
