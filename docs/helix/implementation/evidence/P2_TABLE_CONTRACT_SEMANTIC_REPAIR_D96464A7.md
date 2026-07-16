# P2 Table Contract Semantic Repair Evidence

Status: PASS；P2-05 table semantic baseline and P3-01 DDL reclosed after implementation-discovered counterexample.

Repair commit: `d96464a7`

## 1. Why the closed baseline was reopened

P3-02 startup-gate design audited generated DDL against SSOT §8.5.9 and proved that the earlier P2 table parser had accepted three
classes of semantic loss:

- 57 `state/status` columns had no enum despite the SSOT hard requirement that every status column has an enum `CHECK`；
- three `control_revision_set_digest` columns were misclassified as `INTEGER` because `_revision` was matched as an unanchored substring；
- six version/local-priority columns remained `TEXT` although their accepted contract is integer；P3-01 also emitted aggregate revision
  checks as `>=0` rather than starting at `1`.

Continuing to SQLite Kernel on that baseline would have made the implementation weaker than the SSOT. The old table digest and derived
DDL digest are therefore historical evidence only, not an accepted implementation baseline.

## 2. Repair scope

| Contract | Repaired result |
| --- | --- |
| State closure | 57/57 previously open state/status columns now have explicit closed enums；named Level 6/7 lifecycle values are preserved |
| Immutable packages | Procurement Candidate Package and Libra Product Package accept only `published` in their immutable package row；handoff outcome remains in Delivery/Decision facts |
| Opaque types | three revision-set digests are `TEXT`；six contract/query/planner/executor version or local-priority columns are `INTEGER` |
| Revision checks | aggregate/current/binding revision columns compile to `CHECK >= 1`；time/count/ordinal remain non-negative |
| Digest checks | 168 digest/digest-hex columns compile to fixed `sha256`, 64-character lowercase hexadecimal checks |
| Fail-closed validation | missing state enum and invalid identity/time/digest logical types now fail the P2 table validator |
| P3 DDL | 156 tables、72 indexes、19 partial unique rules and three traced technical guards remain closed；no legacy object was introduced |

No SSOT line、Owner、Business Handoff、Business Result、table identity、transaction participant or Runtime fallback changed.

## 3. Accepted replacement digests

| Artifact | Digest |
| --- | --- |
| P2 table component | `d008e18dbf2c056bde61516fd5acc1585ceb952aa52a0074c2136742b5e8e2f7` |
| P2 contract aggregate | `aab78271f712df7714233f0a79e24453e0c1a85c5d214ebf926dc6e71adba247` |
| P3 table-contract aggregate | `b44ee659e1554be8ea5f9998df8f79bbebb6fe10ef04f4aced6cbee792a674db` |
| P3 clean DDL | `98e50feb79165844951ab5133f383eedc82848e83b0e4a2c4a58059121548b11` |

The earlier P2 aggregate `ebbfda88…` and P3 DDL `66e0fc57…` are explicitly superseded.

## 4. Verification

- `node scripts/helix-architecture-verify.js`：PASS；112/96/156/18；191 refs / 0 unresolved；findings=0；
- fresh detached worktree at `d96464a7`：the same full gate PASS；
- fresh worktree rematerialized all 156 table contracts and P3 DDL, then `git diff --exit-code` returned zero；
- negative fixtures reject unbounded state, wrong identity/time/digest types, unsupported index expressions, unknown partial-unique rules,
  unresolved FK targets and unsupported logical types；
- no SQLite connection、E2E、Docker、production、real media or `media-desktop` action was run.

Conclusion: `PASS / OLD TABLE SEMANTIC DIGEST SUPERSEDED / P2-05 AND P3-01 RECLOSED`.
