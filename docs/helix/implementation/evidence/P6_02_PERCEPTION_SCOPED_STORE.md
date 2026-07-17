# P6-02 User Perception Scoped Store Evidence

Status: `PASS / REBASELINED AFTER PBF-02 AND PBF-03`

Date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implemented invariant |
| --- | --- |
| §3.6.2–3.6.3 | Source、Acquisition和Cursor显式revision；首次同步使用逻辑CAS sentinel `0`且不伪造cursor row |
| §3.6.4、§5.9.1 | Resolution只有`found/not_found`；found winner必须是既有immutable Record |
| §8.2.4 | 只有`PerceptionRecordRepository`与`PerceptionResolutionRepository`两个Perception persistence component |
| §8.5.13 | Record Repository精确拥有7张Source/Acquisition/Commit/Cursor/Record/Anchor/Relation表；Resolution Repository拥有2张Revision/Head表 |
| §8.5.13 | 一个Source最多一个active Acquisition；terminal后允许新Acquisition；cursor head、Source config和Resolution head均使用expected revision CAS |
| §8.5.13 | Acquisition page receipt、Record、Anchor、source-lineage Relation、cursor、terminal state和typed Result同事务 |
| §8.5.13、§8.6.19 | rating只允许`null`或integer `1..5`；correction/retraction必须在同页携带对应outgoing `supersedes/retracts` |
| §8.6.19、§8.6.21 | Result以JCS digest持久化；marker replay返回原始Result；篡改Result时fail closed |

## 2. Physical and atomic result

- Repository manifest覆盖全部9张`perception_*`表，没有旧`perception_dedup_relations`、`cursor_value`或独立Record写入口。
- `perception_acquisitions`的`UNIQUE(perception_source_id) WHERE state='active'`被物化为partial unique index；不再错误变成Source终身唯一。
- `initial_cursor_revision`与`expected_cursor_revision`允许逻辑sentinel `0`；真实cursor revision仍从1递增且不重置。
- Canonical rating同时由typed model和SQLite check约束；REAL affinity下使用整数等价检查，`0`和小数均禁止。
- 同source identity在后续Acquisition中再次出现时事务内计为duplicate而不重复插入；同commit marker重放不再执行第二次事实写入。
- `PerceptionRecordCommitResult`由Commit Participant根据实际插入/重复集合生成，保存于Domain表及`fx_event_result_bindings`，不接受调用者伪造Result。

## 3. Machine counterexamples

Focused fixture：`p6-perception-store.test.js`，`11/11 PASS`。

覆盖active Acquisition冲突、terminal后重开、stale Source/cursor、scope digest漂移、rating 0、重复Anchor、缺失lineage、Acquisition内非法duplicate relation、missing Resolution winner、head CAS冲突、commit replay drift及stored Result tamper。

P2/P3/People/Perception组合回归曾完成`59/59 PASS`；加入replay反例后focused Store仍为`11/11 PASS`。Architecture guards `21/21 PASS`。

## 4. Scope boundary

本包只实现Perception Owner Store与原子Repository；不建立global content ID，不取得People/Procurement/Libra/Arca/Platform/Foundation事实Owner。无E2E、Docker、production、真实来源、真实媒体、Service startup或`media-desktop`动作；本线程未修改SSOT。
