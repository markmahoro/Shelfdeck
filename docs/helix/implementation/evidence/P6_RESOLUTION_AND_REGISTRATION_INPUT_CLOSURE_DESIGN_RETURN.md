# P6 Resolution / Registration Input Closure Design Return

Date: 2026-07-17

Status: closed by Architecture Agent revision `85752517`；SSOT unchanged by implementation thread.

Closure note: Architecture Agent formalized the Perception query/record/rule inputs and deterministic resolution semantics，and removed
the obsolete People `content_scope` while confirming Person as a global Registry object. The implementation thread cherry-picked the
exact SSOT delta and did not edit the SSOT. Perception closure evidence is recorded in `P6_04_PERCEPTION_RESOLUTION.md`；People closure
is the authority for the P6-05 12-table clean rewrite and subsequent P6-06 work.

## 1. Verified baseline

- Architecture Agent revision audited and cherry-picked unchanged: upstream `73391708` / local `387510c0`.
- P2 rematerialization: `112 Capability / 96 Result / 160 table / 21 canonical transaction`.
- P2 aggregate: `706cc7af3f2a11a90f9a1abf756c814c7f65faadfd2b0c32ee8fd3352e246d64`.
- Contract/DDL/SQLite/canonical crash focused baseline: `149/149 PASS`.
- Perception acquisition, Resolution commit/query and package boundary focused baseline: PASS.

## 2. DR-P6-05 — Perception Resolver named input is not semantically closed

SSOT requires:

- §5.9.1: one declared Decision Fact kind per query；
- §5.9.2: strong Identity Anchor wins over normalized name/year and weak filename/name Evidence；
- §8.6.13: `Immutable records + Resolution rule revision → PerceptionResolutionDraft`；
- §8.6.20: Accepted Business DTO contains the Level 3–5 members needed by the Executor.

The current formal DTOs provide only:

- `ImmutableRecords`: envelope plus `records[{objectId,revision,schemaRef,digest,objectKind}]`；
- `ResolutionRuleRevision`: envelope plus `ruleSetId,ruleRevision,ruleDigest`.

They do not provide the declared fact kind, query Identity Anchors, immutable Record values (rating/watched/anchors/provenance),
or executable/versioned matching rule members. Therefore a pure Executor cannot determine candidate matching, strong-anchor rank,
winner, `found|not_found`, Evidence, or duplicate relation drafts. Reading Perception Store from the Capability would violate §8.7.1；
choosing by list order, revision, ID, or hard-coded guesses would invent policy outside SSOT.

Required Architecture Agent action: close the formal named-input semantics while retaining pure observation and Perception ownership.
For example, define a bounded immutable query snapshot containing the single fact kind, query anchors and the required Record projections,
plus a versioned executable/system rule contract. The exact correction is an architecture decision；implementation must not choose it.

## 3. DR-P6-06 — Registration acceptance cannot produce required `content_scope`

SSOT requires:

- §8.5.13 `people_person_revisions` writes non-optional `content_scope`；
- §8.6.14 `people.person.commit@1` consumes only `PeopleCandidateAcceptanceDecision + DomainFactCommitHandle` and may read the
  People-owned immutable Candidate payload；
- §8.6.19 Registration `PeopleCandidateDraft.candidatePayload` is exactly
  `{proposedName,aliases[],providerIdentities[],referenceHints[]}`；
- Registration Acceptance Decision adds Candidate fence/origin plus `newPersonId`, but no `contentScope`.

Thus the accepted transaction can derive canonical name, aliases, provider identities and Candidate provenance, but not
`people_person_revisions.content_scope`. No SSOT clause defines a constant/default. Provider/Foundation reads are forbidden, and adding
an implementation-only field would violate the exact payload/Decision contracts.

Required Architecture Agent action: state the sole authoritative source for Registration `content_scope`: add it to an accepted formal
input, define a single explicit invariant value, or remove/replace the stored field. The implementation thread must not select a business
value.

## 4. Work safely completed without crossing either gap

- Latest SSOT contracts, generated schemas, DDL and canonical transactions were rematerialized and verified.
- Perception Resolution commit participant validates exact Draft/Handle, atomically writes normalized `duplicate_of` relations and
  revision/head CAS, and returns `PerceptionResolutionRevision`.
- Perception public query returns only a committed single-kind `found|not_found` projection with contract/version, input digest,
  revision, bounded Evidence and freshness；it never exposes raw Record sets or triggers consumer processes.
- No SSOT, legacy runtime, external source, Docker, E2E, production, real media or `media-desktop` action was performed.

This Design Return is historical evidence. P6-04 has since passed its focused contract/counterexample checks；P6-06 remains pending on
the P6-05 clean rewrite and its own acceptance evidence.
