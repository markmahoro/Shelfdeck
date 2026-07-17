'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createCandidateDraft } = require('../model/people-store-contracts');

const REGISTRATION_EVIDENCE_SCHEMA = 'helix://contracts/types/PersonRegistrationEvidence/v1';
const SHA256 = /^[a-f0-9]{64}$/;

class PeopleCandidateResolverError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PeopleCandidateResolverError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new PeopleCandidateResolverError(code, message, details); }
function text(value, field) {
  if (typeof value !== 'string' || value.length < 1) fail('P6_PEOPLE_RESOLVER_TEXT_INVALID', 'Resolver text field is required.', { field });
  return value;
}
function validatePolicyRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4 ||
      !['registration', 'merge'].includes(value.policyKind) || !Number.isSafeInteger(value.policyRevision) || value.policyRevision < 1 ||
      typeof value.ruleSchemaRef !== 'string' || value.ruleSchemaRef.length < 1 || !SHA256.test(value.ruleDigest || '')) {
    fail('P6_PEOPLE_POLICY_REF_INVALID', 'People Candidate Policy Ref is invalid.');
  }
  return Object.freeze({ ...value });
}
function validateRegistrationEvidence(value) {
  const keys = ['schemaRef', 'schemaVersion', 'evidenceId', 'evidenceKind', 'producerRef', 'basisDigest', 'payloadDigest', 'observedAtMs',
    'proposedName', 'aliases', 'providerIdentities', 'referenceHints'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key)) || value.schemaRef !== REGISTRATION_EVIDENCE_SCHEMA || value.schemaVersion !== 1 ||
      !SHA256.test(value.basisDigest || '') || !SHA256.test(value.payloadDigest || '') ||
      !Number.isSafeInteger(value.observedAtMs) || value.observedAtMs < 0) {
    fail('P6_PEOPLE_REGISTRATION_EVIDENCE_INVALID', 'Person Registration Evidence is invalid.');
  }
  for (const field of ['evidenceId', 'evidenceKind', 'producerRef', 'proposedName']) text(value[field], field);
  const candidatePayload = { proposedName: value.proposedName, aliases: value.aliases,
    providerIdentities: value.providerIdentities, referenceHints: value.referenceHints };
  const normalized = createCandidateDraft({ schemaRef: 'helix://contracts/types/PeopleCandidateDraft/v1', schemaVersion: 1,
    draftId: value.evidenceId, draftKind: 'validation-only', basisDigest: value.basisDigest, draftDigest: value.basisDigest,
    producedAtMs: value.observedAtMs, candidateKind: 'registration', evidenceDigest: value.payloadDigest, candidatePayload,
    candidatePayloadDigest: canonicalDigest(candidatePayload) }).candidatePayload;
  if (canonicalDigest(normalized) !== value.payloadDigest) fail('P6_PEOPLE_REGISTRATION_EVIDENCE_DIGEST', 'Registration Evidence payload digest is invalid.');
  return Object.freeze({ evidence: Object.freeze({ ...value }), candidatePayload: normalized });
}

function createPeopleCandidateResolver(options) {
  if (!options || !Array.isArray(options.rules) || options.rules.length === 0) {
    fail('P6_PEOPLE_POLICY_CATALOG_REQUIRED', 'An immutable People Candidate policy catalog is required.');
  }
  const rules = new Map();
  for (const entry of options.rules) {
    if (!entry || typeof entry.evaluate !== 'function') fail('P6_PEOPLE_POLICY_RULE_INVALID', 'Policy catalog entry requires a pure evaluator.');
    const policyRef = validatePolicyRef(entry.policyRef);
    const key = [policyRef.policyKind, policyRef.policyRevision, policyRef.ruleSchemaRef, policyRef.ruleDigest].join('|');
    if (rules.has(key)) fail('P6_PEOPLE_POLICY_RULE_DUPLICATE', 'Policy catalog identity must be unique.');
    rules.set(key, Object.freeze({ policyRef, evaluate: entry.evaluate }));
  }
  return Object.freeze({
    resolve(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          !Object.hasOwn(input, 'evidence') || !Object.hasOwn(input, 'policyRef') || !Object.hasOwn(input, 'draftId') ||
          !Object.hasOwn(input, 'producedAtMs') || Object.keys(input).length !== 4) {
        fail('P6_PEOPLE_RESOLVER_INPUT_INVALID', 'Resolver requires exact Evidence, Policy Ref, draft ID and production time.');
      }
      const policyRef = validatePolicyRef(input.policyRef);
      if (policyRef.policyKind !== 'registration') fail('P6_PEOPLE_POLICY_KIND_MISMATCH', 'Registration Evidence requires Registration Policy.');
      const { evidence, candidatePayload } = validateRegistrationEvidence(input.evidence);
      const key = [policyRef.policyKind, policyRef.policyRevision, policyRef.ruleSchemaRef, policyRef.ruleDigest].join('|');
      const rule = rules.get(key);
      if (!rule) fail('P6_PEOPLE_POLICY_RULE_NOT_FOUND', 'Exact immutable People Candidate policy is absent from the local catalog.');
      const resolution = rule.evaluate(Object.freeze({ evidence, policyRef }));
      if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution) || !['candidate', 'no_candidate'].includes(resolution.kind)) {
        fail('P6_PEOPLE_POLICY_RESULT_INVALID', 'People Candidate policy returned an invalid resolution.');
      }
      if (resolution.kind === 'no_candidate') {
        if (!Array.isArray(resolution.reasonCodes) || resolution.reasonCodes.length === 0 || resolution.reasonCodes.length > 32 ||
            resolution.reasonCodes.some((code) => typeof code !== 'string' || code.length < 1) ||
            new Set(resolution.reasonCodes).size !== resolution.reasonCodes.length || Object.keys(resolution).length !== 2) {
          fail('P6_PEOPLE_POLICY_RESULT_INVALID', 'no_candidate requires bounded unique reason codes.');
        }
        return Object.freeze({ kind: 'no_candidate', reasonCodes: Object.freeze([...resolution.reasonCodes]) });
      }
      if (Object.keys(resolution).length !== 1 || !Number.isSafeInteger(input.producedAtMs) || input.producedAtMs < evidence.observedAtMs) {
        fail('P6_PEOPLE_POLICY_RESULT_INVALID', 'Candidate resolution or produced time is invalid.');
      }
      const basisDigest = canonicalDigest({ evidenceId: evidence.evidenceId, evidencePayloadDigest: evidence.payloadDigest, policyRef });
      const candidatePayloadDigest = canonicalDigest(candidatePayload);
      const draftBasis = { schemaRef: 'helix://contracts/types/PeopleCandidateDraft/v1', schemaVersion: 1,
        draftId: text(input.draftId, 'draftId'), draftKind: 'people-candidate', basisDigest, producedAtMs: input.producedAtMs,
        candidateKind: 'registration', evidenceDigest: evidence.payloadDigest, candidatePayload, candidatePayloadDigest };
      return Object.freeze({ kind: 'candidate', draft: createCandidateDraft({ ...draftBasis, draftDigest: canonicalDigest(draftBasis) }) });
    }
  });
}

module.exports = Object.freeze({ PeopleCandidateResolverError, createPeopleCandidateResolver });
