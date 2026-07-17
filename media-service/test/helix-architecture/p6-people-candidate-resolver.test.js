'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createPeopleCandidateResolver } = require('../../src/helix/domains/people/application/people-candidate-resolver');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const policyRef = Object.freeze({ policyKind: 'registration', policyRevision: 1,
  ruleSchemaRef: 'helix://contracts/decisions/people-candidate/v1', ruleDigest: hash('people-candidate-rule@1') });

function evidence() {
  const payload = {
    proposedName: 'Candidate Person', aliases: [{ aliasDisplay: 'Candidate', aliasNormalized: 'candidate', provenanceDigest: hash('alias') }],
    providerIdentities: [{ provider: 'tmdb', namespace: 'person', providerKey: '100', provenanceDigest: hash('provider') }],
    referenceHints: [{ hintKind: 'portrait', referenceValue: 'artifact:portrait', provenanceDigest: hash('portrait') }]
  };
  return { schemaRef: 'helix://contracts/types/PersonRegistrationEvidence/v1', schemaVersion: 1,
    evidenceId: 'registration-evidence-1', evidenceKind: 'person-registration', producerRef: 'people.registration_evidence.observe@1',
    basisDigest: hash('registration-basis'), payloadDigest: canonicalDigest(payload), observedAtMs: 100, ...payload };
}

test('pure registration policy maps complete typed Evidence to a complete digest-bound Candidate Draft', () => {
  const resolver = createPeopleCandidateResolver({ rules: [{ policyRef, evaluate: () => ({ kind: 'candidate' }) }] });
  const result = resolver.resolve({ evidence: evidence(), policyRef, draftId: 'candidate-draft-1', producedAtMs: 101 });
  assert.equal(result.kind, 'candidate');
  assert.equal(result.draft.candidateKind, 'registration');
  assert.equal(result.draft.candidatePayload.proposedName, 'Candidate Person');
  assert.equal(result.draft.candidatePayloadDigest, canonicalDigest(result.draft.candidatePayload));
  const { draftDigest, ...basis } = result.draft;
  assert.equal(draftDigest, canonicalDigest(basis));
  assert.equal(Object.isFrozen(result.draft.candidatePayload.providerIdentities), true);
});

test('pure policy can return bounded no_candidate without manufacturing an empty Candidate', () => {
  const resolver = createPeopleCandidateResolver({ rules: [{ policyRef, evaluate: () => ({ kind: 'no_candidate', reasonCodes: ['insufficient_evidence'] }) }] });
  assert.deepEqual(resolver.resolve({ evidence: evidence(), policyRef, draftId: 'unused', producedAtMs: 101 }),
    { kind: 'no_candidate', reasonCodes: ['insufficient_evidence'] });
});

test('fails closed for Evidence payload tamper, unknown policy digest, or malformed policy result', () => {
  const resolver = createPeopleCandidateResolver({ rules: [{ policyRef, evaluate: () => ({ kind: 'candidate' }) }] });
  assert.throws(() => resolver.resolve({ evidence: { ...evidence(), proposedName: 'Tampered' }, policyRef,
    draftId: 'candidate-draft-1', producedAtMs: 101 }), (error) => error.code === 'P6_PEOPLE_REGISTRATION_EVIDENCE_DIGEST');
  assert.throws(() => resolver.resolve({ evidence: evidence(), policyRef: { ...policyRef, ruleDigest: hash('unknown') },
    draftId: 'candidate-draft-1', producedAtMs: 101 }), (error) => error.code === 'P6_PEOPLE_POLICY_RULE_NOT_FOUND');
  const invalid = createPeopleCandidateResolver({ rules: [{ policyRef, evaluate: () => ({ kind: 'candidate', payload: {} }) }] });
  assert.throws(() => invalid.resolve({ evidence: evidence(), policyRef, draftId: 'candidate-draft-1', producedAtMs: 101 }),
    (error) => error.code === 'P6_PEOPLE_POLICY_RESULT_INVALID');
});

test('resolver source has no Store, Provider, Foundation runtime, scheduler, or Capability registration dependency', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/domains/people/application/people-candidate-resolver.js'), 'utf8');
  assert.doesNotMatch(source, /require\([^)]*(?:persistence|provider|foundation|workflow|scheduler)/i);
  assert.doesNotMatch(source, /effectClass|createParticipant|capabilityRef/);
});
