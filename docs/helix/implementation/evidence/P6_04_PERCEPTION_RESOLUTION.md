# P6-04 Perception Resolution Evidence

Date: 2026-07-17

Status: focused work package complete；P6 phase Exit Audit not yet run.

## 1. Contract basis

- Architecture Agent SSOT delta: `857525177540028c72a47877f2e82fb087071ef4`；implementation thread cherry-picked it unchanged.
- Frozen inventory: `112 Capability / 96 Result / 160 table / 22 canonical transaction`.
- P2 aggregate at P6-04 close: `bf4a2d4033f3570e9b81154a2e8436db72b072b44318e6954390a701192d9878`；current aggregate after the P6-05 head-immutability materializer correction is `65f96c638a668817085611035870c461f96a71209198b64eae62886ecc6549ac`.
- 本线程没有编辑`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`。

## 2. Implemented clean chain

`CanonicalQueryHandle → PerceptionResolutionInputAssembler → PerceptionResolutionQuery +
PerceptionResolutionRecordSet + PerceptionResolutionRuleSnapshot → pure PerceptionResolutionResolver →
PerceptionResolutionDraft → atomic Resolution commit → PerceptionResolutionFacade`。

- Handle携带typed input schema和bounded typed input；Assembler是唯一Owner Store读取点，Capability不旁读Repository。
- Record Set携带完整immutable scalar facts、排序Anchor、provenance和`record_digest`；digest不匹配即fail closed。
- Resolver按数字更小的固定rank选择最强Identity tier；最强tier值一致才`found`，冲突、缺失或terminal target均`not_found`。
- Resolution matching不自动建立duplicate relation；只有独立exact duplicate proof产生normalized `duplicate_of` draft。
- Commit原子写完整typed Resolution revision、可选duplicate relation、Head CAS和Outbox；Head以query contract、input digest、
  revision和resolution ID四列复合外键锁定精确winner。
- Facade直接返回已存typed result，不回读Record拼装结果，不暴露原始Record集合。

## 3. Machine evidence

- P2 contract/source-map/domain-input/result/table/transaction baseline: PASS.
- P3 generated DDL: `7/7 PASS`.
- P3 canonical transaction crash fixtures: `78/78 PASS`.
- Perception acquisition/store/integrated resolution: `15/15 PASS`.
- Resolver counterexamples: `5/5 PASS`.

反例覆盖：弱tier不得压过强tier、同一最强tier冲突必须`not_found`、缺失fact不得伪造winner、terminal target不得入选、
fuzzy match不得制造duplicate relation。

## 4. Scope and next dependency

本包未运行E2E、Docker、服务启动、真实来源或真实媒体副作用，未修改生产和`media-desktop`。P6整体尚未Exit；下一工作包
是P6-05，必须按最新12-table/global Registry合同clean rewrite，旧10-table实现仅作历史证据，不得形成兼容层。
