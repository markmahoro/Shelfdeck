# P14 PBF-22 Western Field Profile Hint Preclosure

状态：**FROZEN — 待 Architecture active review / P14 独立复验**

## Baseline 与范围

- Architecture source commit：`04f310c1`。
- 实现分支原样纳入 commit：`6369526c`。
- Implementation closure：本 Evidence 所在同一实现提交。
- 本 checkpoint 仅闭合 Material Field Profile Hint 的 Procurement
  Owner-row/API/Observation/Run/Retry/Triage 连续性；尚未开始 Western
  Handoff A、Routing、Production、Arca On-deck 或 responsibility closure。
- Architecture SSOT 没有实现线程 working-tree 修改。

## Implementation Contract

- 新增 append-only Procurement Owner table
  `proc_field_profile_hint_revisions`；Material Field 保存 exact current revision
  pointer。Procurement 机器表计数由 15 增至 16。
- registration Host 在计算 request digest 前把缺省 Hint 规范化为显式
  `mixed` revision 1；Owner Store 不接受缺失或 open enum。
- 既有 Material Field PATCH 通过 `revise_profile_hint` 执行 expected-revision
  CAS；same key/same payload稳定回放，same key/different payload冲突，不新增
  route。
- `MaterialFieldProfileHintSnapshot@1` 逐级冻结于 Field Observation Page
  Request/Page/Commit Result、Observation Owner row、Procurement Run
  Execution Basis/Run row、Retry Intent/head/consume，以及
  MaterialFieldContext/TriageIdentityMetadata。
- Observation 期间 Hint head 变化会令 commit fail closed；新 Run/Retry 只接受
  与 current Hint 完全相同的 terminal Observation。既有 Observation、Run、
  Retry、Candidate 不跟随 current pointer。
- Triage 只消费冻结 snapshot，写入唯一
  `field_content_profile_hint` source hint；显式 `western_adult` 与 `mixed`
  产生不同的 closed profile，未使用 caller cache、hardcoded mixed 或 current
  Field 旁读。
- 四个既有 canonical transaction 仅增加
  `proc_field_profile_hint_revisions` exact read fence；write set、participant、
  Outbox cardinality均未改变。

## Machine Baseline

- Capability / Result / Table / Transaction：`112 / 97 / 178 / 43`。
- Procurement tables：`16`。
- SSOT source aggregate：
  `4b1ce918fd77657683ce0fbf2f36e8c8d6ef2dce004553e3032b84764ab1107b`。
- Contract aggregate：
  `423a5818bca505d12998d87e69bf3e1d9391b0e960d014d84eb4f762bfc2b79f`。
- Table component digest：
  `291ff5db47d19738c055325d871e275f6072e6be75c901ab826e48a7d605ddc0`。
- Transaction component digest：
  `4d37eb40a1851fae068780e184ce4bc152be5428d662447576d0f166ea9a82ab`。
- DDL digest：
  `d7c8991f98fe3a7f1bbd5bf491f6c08080153fe6db30284f4c2141f80063e889`。
- Table contract aggregate：
  `9e9a73607538675d4177b28edc9906386a646d5aa216249ec70a6bd31b7160a0`。
- unresolved type refs：`0`；findings / prohibitedActionsRun：空。

## Tests 与反例

- PBF-22/P7 focused：`32/32 PASS`。
- 全部 P7 Procurement fixtures：`57/57 PASS`。
- clean public HTTP entrypoint：`15/15 PASS`，包含 registration default mixed、
  profile revision CAS/replay/conflict、restart 与 target mismatch。
- machine baseline correction：`15/15 PASS`。
- 完整 `npm run test:helix-architecture`：
  `132 files / 891 tests PASS`。
- 覆盖反例：
  - Profile Hint digest/closed-shape/CAS drift；
  - Observation physical read 后 Hint revision 改变，零 Observation/marker；
  - frozen terminal Observation 与 current Hint不一致，零Run/Control/Result；
  - Retry返回`field_profile_hint_changed`并保持旧Intent/Run历史；
  - 显式`western_adult`与`mixed→movie`分流；
  - restart/replay不重新解释既有Owner rows。

## Residual

- Western Adult产品纵切尚未开始；本 checkpoint 不能声明 Western Handoff A
  或 Feature PASS。
- deterministic Provider fixture、real Provider、face、UI/E2E均不在本证据范围。
- `F02.17`保持`NOT_RUN`。
- Worker、Desktop、Ollama、Python/FastAPI、NAS、Docker、生产均未触碰。
