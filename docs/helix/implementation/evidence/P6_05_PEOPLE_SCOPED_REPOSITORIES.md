# P6-05 People Registry and Candidate scoped Repositories Evidence

Status: `PASS / IMPLEMENTED OUT OF SEQUENCE WHILE P6-03 SSOT NOMINAL FIX IS PENDING`

Date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implementation evidence |
| --- | --- |
| §8.2.5 exactly two persistence components | `PersonRegistryRepository` and `PeopleCandidateRepository` are the only exposed component definitions |
| §8.5.13 exactly ten `people_*` tables | Registry owns seven Person/Identity/Preference/Reference tables；Candidate Repository owns three Candidate/Merge tables |
| Person current head points to immutable revision | Person creation uses nullable bootstrap head, then inserts revision/facts and initializes the exact pointer in one UoW；later revision uses expected-head CAS |
| Alias and stable Provider Identity are People facts | Alias set is revision-scoped；old Provider Identity guards are deactivated only inside the same revision transaction；current stable provider tuple is active-unique |
| Preference is `-2..2` | People model requires an integer in the closed range even though the current generated SQLite numeric column is permissive |
| Reference stores handles, not image/embedding payload | Asset stores `artifactHandleId + digest`；Face stores `embeddingHandleId + modelRef` and requires the same Person owner as its Asset |
| Registration Candidate is durable People business fact | Candidate JSON accepts only the exact `PeopleCandidateDraft@1` closed shape；Foundation `CapabilityOutcome`/Work/Event Result is rejected |
| Candidate open uniqueness | Registration evidence digest and normalized Merge Person pair each allow at most one open Candidate；terminal CAS is one-way |
| Candidate is not Person | opening/dismissing Candidate does not create, revise, merge, archive, or otherwise mutate Person |
| Merge history is terminal and directional | normalized Candidate pair is distinct from directional Merge Record；one source Person can receive only one terminal target |

## 2. Physical component classification

| Component | Repository ID | Exact table family |
| --- | --- | --- |
| `PersonRegistryRepository` | `person_registry_repository` | `people_persons`、`people_person_revisions`、`people_aliases`、`people_provider_identities`、`people_preference_revisions`、`people_reference_assets`、`people_reference_faces` |
| `PeopleCandidateRepository` | `people_candidate_repository` | `people_registration_candidates`、`people_merge_candidates`、`people_merge_records` |

No Repository exposes raw SQL, a generic query/write method, another Owner table, Media-Cast, Foundation Work/Event, or a cross-Domain Store.

## 3. Machine counterexamples

`media-service/test/helix-architecture/p6-people-store.test.js` proves:

1. exact two-component/ten-table manifest；
2. immutable Person revision history and explicit head CAS；
3. active stable Provider Identity conflict rolls back the complete second Person；
4. stale/skipped Person revision is rejected；
5. Preference `3` and fractional `1.5` are rejected；
6. cross-Person Reference Face is rejected；
7. Foundation Result cannot be persisted as Registration Candidate；
8. duplicate open registration evidence is rejected but may produce a later Candidate after terminal closure；
9. reversed Merge pair collides while open；dismiss leaves both Persons active；
10. a source Person cannot receive a second terminal Merge Record；
11. source scan rejects raw SQL、cross-Owner prefixes、`MAX` head lookup、Media-Cast and Work/Event Repository semantics.

Focused and boundary command:

```text
node --test \
  media-service/test/helix-architecture/package-boundary-guard.test.js \
  media-service/test/helix-architecture/forbidden-semantic-guard.test.js \
  media-service/test/helix-architecture/p6-horizontal-domain-public-ports.test.js \
  media-service/test/helix-architecture/p6-perception-store.test.js \
  media-service/test/helix-architecture/p6-people-store.test.js
```

Result: `33 tests / 33 PASS / 0 FAIL`，of which P6-05 focused fixtures are `9/9 PASS`.

## 4. Scope and pending integration

P6-05 satisfies its Repository contract independently of P6-03. It does not claim P6-06/P6-07 lifecycle completion：Person Registration、Candidate acceptance、Merge、Preference conflict decision and their Domain Commit Participants remain owned by later Work Packages.

The full P2/P3/P4 aggregate is intentionally not claimed in this receipt because the accepted PBF-02/PBF-03 SSOT introduced a currently reported nominal typo in the `perception.dedup.resolve@1` output identity. P6-05 does not consume or work around that type. Full aggregate regression will be rerun after the Architecture Agent closes the SSOT identity and transaction-cardinality question.

No E2E、Docker、production、real media、network、Service startup or `media-desktop` action was run. The SSOT was not edited by the implementation thread.
