'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createPeopleStore } = require('../persistence/people-store');
const { createCandidateDraft } = require('../model/people-store-contracts');

const PERIOD_MS = 24 * 60 * 60 * 1000;
const PEOPLE_CANDIDATE_DRAFT_SCHEMA = 'helix://contracts/types/PeopleCandidateDraft/v1';

function digestValue(value) {
  return canonicalDigest(value);
}

function aliasFor(name) {
  const display = String(name || '').trim();
  const normalized = display.toLocaleLowerCase();
  return Object.freeze({
    aliasDisplay: display,
    aliasNormalized: normalized,
    provenanceDigest: digestValue({ kind: 'ondeck-display-name', display }),
  });
}

function providerIdentitiesFrom(evidence) {
  return (evidence.providerIdentities || []).map((item) => Object.freeze({
    provider: String(item.provider || item.providerName || 'tmdb'),
    namespace: String(item.namespace || 'person'),
    providerKey: String(item.providerKey || item.id || item.provider_key || ''),
    provenanceDigest: digestValue({ kind: 'ondeck-provider-identity', item }),
  })).filter((item) => item.providerKey);
}

function createPeopleProcessServices(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new TypeError('People process services require People persistence.');
  }
  const now = options.now || Date.now;
  const store = options.peopleStore || createPeopleStore(options);
  const evidenceProjection = options.onDeckPersonEvidenceProjection;
  let sweepNotBeforeMs = 0;

  function alreadyKnown(evidence) {
    const identities = providerIdentitiesFrom(evidence);
    if (identities.length && store.listPeople().some((person) => person.revision.providerIdentities.some((identity) =>
      identities.some((item) => item.provider === identity.provider && item.namespace === identity.namespace
        && item.providerKey === identity.providerKey)))) return true;
    const digest = evidence.evidenceDigest;
    return store.listRegistrationCandidates().some((item) => item.evidenceDigest === digest);
  }

  function openDraft(evidence) {
    const proposedName = String(evidence.displayName || '').trim() || '未命名人物';
    const aliases = [aliasFor(proposedName)];
    const providerIdentities = providerIdentitiesFrom(evidence);
    const candidatePayload = {
      proposedName,
      aliases,
      providerIdentities,
      referenceHints: [],
    };
    const producedAtMs = now();
    const evidenceDigest = evidence.evidenceDigest || digestValue(evidence);
    const basisDigest = digestValue({ evidenceDigest, shelfEntryId: evidence.shelfEntryId, inventoryRevision: evidence.inventoryRevision });
    const draft = createCandidateDraft({
      schemaRef: PEOPLE_CANDIDATE_DRAFT_SCHEMA,
      schemaVersion: 1,
      draftId: 'people-reg-' + evidenceDigest.slice(0, 32),
      draftKind: 'people-candidate',
      basisDigest,
      draftDigest: digestValue({ basisDigest, candidatePayload }),
      producedAtMs,
      candidateKind: 'registration',
      evidenceDigest,
      candidatePayload,
      candidatePayloadDigest: digestValue(candidatePayload),
    });
    return store.openCandidate({ candidateId: draft.draftId, draft });
  }

  function acceptCandidate(candidate, origin) {
    const basis = origin.decisionOrigin === 'user'
      ? {
        decisionId: origin.decisionId,
        candidateKind: 'registration',
        candidateId: candidate.candidateId,
        expectedCandidateRevision: candidate.currentRevision,
        candidatePayloadDigest: candidate.candidatePayloadDigest,
        decisionOrigin: 'user',
        actorId: origin.actorId,
        newPersonId: origin.newPersonId || ('person-' + candidate.candidateId.slice(-24)),
      }
      : {
        decisionId: origin.decisionId,
        candidateKind: 'registration',
        candidateId: candidate.candidateId,
        expectedCandidateRevision: candidate.currentRevision,
        candidatePayloadDigest: candidate.candidatePayloadDigest,
        decisionOrigin: 'strong_identity_rule',
        ruleRevision: 1,
        newPersonId: origin.newPersonId || ('person-' + candidate.candidateId.slice(-24)),
      };
    return store.acceptRegistrationCandidate({ ...basis, decisionDigest: digestValue(basis) });
  }

  function listPage({ cursor, limit }) {
    if (!evidenceProjection || typeof evidenceProjection.listPage !== 'function') return [];
    const gated = cursor === null && now() < sweepNotBeforeMs;
    if (gated) return [];
    const page = evidenceProjection.listPage({ cursor, limit });
    if (page.length < limit) sweepNotBeforeMs = now() + PERIOD_MS;
    return page;
  }

  function reconcile(scope) {
    if (!scope || scope.skipped) return Object.freeze({ kind: 'skipped' });
    if (!scope.displayName && !(scope.providerIdentities || []).length) return Object.freeze({ kind: 'empty' });
    if (alreadyKnown(scope)) return Object.freeze({ kind: 'known', evidenceDigest: scope.evidenceDigest });
    const candidate = openDraft(scope);
    if (scope.identityStrength === 'strong') {
      const person = acceptCandidate(candidate, {
        decisionOrigin: 'strong_identity_rule',
        decisionId: 'people-strong-' + candidate.candidateId,
      });
      return Object.freeze({ kind: 'auto_accepted', personId: person.personId, candidateId: candidate.candidateId });
    }
    return Object.freeze({ kind: 'candidate_open', candidateId: candidate.candidateId });
  }

  function registerPerson(body, actorId) {
    const canonicalName = String(body?.canonicalName || '').trim();
    const aliases = Array.isArray(body?.aliases)
      ? body.aliases.map((alias) => aliasFor(String(alias))).filter((item) => item.aliasDisplay)
      : [];
    const providerIdentities = Array.isArray(body?.providerIdentities)
      ? body.providerIdentities.map((item) => Object.freeze({
        provider: String(item.provider || 'tmdb'),
        namespace: String(item.namespace || 'person'),
        providerKey: String(item.providerKey || ''),
        provenanceDigest: digestValue({ kind: 'direct-provider-identity', item }),
      })).filter((item) => item.providerKey)
      : [];
    if (!canonicalName) {
      const error = new Error('人物姓名不能为空。');
      error.code = 'PEOPLE_NAME_REQUIRED';
      throw error;
    }
    const newPersonId = String(body?.personId || 'person-' + digestValue({ canonicalName, actorId }).slice(0, 24));
    const decision = {
      decisionId: String(body?.idempotencyKey || ('register-' + newPersonId)),
      newPersonId,
      canonicalName,
      aliases: aliases.length ? aliases : [aliasFor(canonicalName)],
      providerIdentities,
      actorId: actorId || 'admin',
    };
    return store.registerDirectPerson({ ...decision, decisionDigest: digestValue(decision) });
  }

  function acceptRegistration(body, actorId) {
    const candidate = store.getRegistrationCandidate(body.candidateId);
    if (!candidate || candidate.currentState !== 'open') {
      const error = new Error('待确认人物不存在或已经处理。');
      error.code = 'PEOPLE_CANDIDATE_NOT_OPEN';
      throw error;
    }
    return acceptCandidate(candidate, {
      decisionOrigin: 'user',
      decisionId: String(body.idempotencyKey || ('accept-' + candidate.candidateId)),
      actorId: actorId || 'admin',
      newPersonId: body.newPersonId,
    });
  }

  function dismissRegistration(body, actorId) {
    const candidate = store.getRegistrationCandidate(body.candidateId);
    if (!candidate || candidate.currentState !== 'open') {
      const error = new Error('待确认人物不存在或已经处理。');
      error.code = 'PEOPLE_CANDIDATE_NOT_OPEN';
      throw error;
    }
    const decision = {
      candidateKind: 'registration',
      candidateId: candidate.candidateId,
      expectedRevision: candidate.currentRevision,
      decisionId: String(body.idempotencyKey || ('dismiss-' + candidate.candidateId)),
      actorId: actorId || 'admin',
    };
    return store.dismissCandidate({ ...decision, decisionDigest: digestValue(decision) });
  }

  return Object.freeze({
    PERIOD_MS,
    store,
    listPage,
    reconcile,
    registerPerson,
    acceptRegistration,
    dismissRegistration,
  });
}

module.exports = Object.freeze({ createPeopleProcessServices });
