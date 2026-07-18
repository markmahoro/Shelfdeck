# P8-05 Intake Rejection Design Return

Status: OPEN — waiting for Architecture Agent SSOT closure.

Date: 2026-07-19

## 1. Audit result

P8-05 cannot implement the Handoff A rejected path without inventing business facts or losing durable replay continuity. The
implementation thread did not change the SSOT and did not add a compatibility path.

## 2. Contract gaps

1. `SubjectContinuityResolutionDecision@1` permits only `new_subject|season_extension`, while
   `libra_intake_decisions.result` also permits `rejected` and requires its `decision_digest` to equal that DTO's digest. There is
   no typed digest source for a rejected Decision row.
2. `libra_intake_decisions.target_subject_id` and `committed_continuity_head_revision` are non-null, but a rejected result must not
   create or expand a Subject and must not transfer Control. No legal rejected values are defined.
3. `StructuredRejection@1` requires ordered `reasonCodes[]` and `rejectionDigest`; `RejectionReceipt@1` additionally requires a
   receipt identity/envelope and primary `rejectionCode`. The Libra Decision row stores only `rejection_schema_ref`, and the 168-table
   inventory contains no relation from which those values can be reconstructed.
4. The SSOT precisely contracts only Handoff A Accepted. It does not define the rejected commit participant/write set, commit marker,
   result, message/outbox/dedup contract, or the Procurement consume transaction that atomically closes the Delivery and all matching
   Run reservations as `released+handoff_rejected`.

## 3. Required closure

- Define the rejected acceptance Decision typed source and digest, and legal nullability/required values for its row variant.
- Persist enough immutable Libra-owned data to reconstruct `StructuredRejection@1` and `RejectionReceipt@1` exactly.
- Define the Libra rejected commit transaction and its durable publication contract.
- Define the Procurement idempotent consume transaction and terminal Evidence continuity.
- Preserve existing Owner, Store and Handoff boundaries; do not introduce compatibility, dual operation or fallback.

## 4. Safety evidence

- No SSOT file was edited by the implementation thread.
- No Subject, continuity head, Material Control or reservation mutation was implemented for the ambiguous path.
- No E2E, Docker, Canary, production, real media operation or `media-desktop` action was run.
