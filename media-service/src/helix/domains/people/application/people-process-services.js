'use strict';

const { requireLibraryKind, libraryForProfile } = require('../model/person-library');
const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createMediaCastReferenceQuery } = require('./media-cast-reference-query');
const { createPeopleStore } = require('../persistence/people-store');
const { createCandidateDraft } = require('../model/people-store-contracts');
const {createUsAdultRecommendationStore}=require('../persistence/us-adult-recommendation-store');
const {createUsAdultRecommendationCoordinator}=require('./us-adult-recommendation-coordinator');
const {createUsAdultRecommendationQuery}=require('./us-adult-recommendation-query');
const {createUsAdultRecommendationClaims}=require('./us-adult-recommendation-claims');

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
  let recommendationClaims=null;
  const recommendationStore=options.recommendationPorts?createUsAdultRecommendationStore(options):null,
    recommendations=recommendationStore?createUsAdultRecommendationCoordinator({store:recommendationStore,...options.recommendationPorts}):null,
    recommendationQuery=recommendationStore?createUsAdultRecommendationQuery({store:recommendationStore,...options.recommendationPorts,now,
      readActiveClaim:sourceId=>recommendationClaims?.findActive(sourceId)||null}):null;
  if(recommendationStore)recommendationClaims=createUsAdultRecommendationClaims({...options,...options.recommendationPorts,peopleStore:store,
    recommendationQuery,afterSourceConfirmation:options.afterRecommendationSourceConfirmation,onClaimFailure:options.onRecommendationClaimFailure});

  function alreadyKnown(evidence) {
    if(evidence.personId && store.getPerson(evidence.personId)?.libraryKind === libraryForProfile(evidence.contentProfile))return true;
    const identities = providerIdentitiesFrom(evidence);
    if (identities.some((identity) => store.findActivePersonByProviderIdentity({libraryKind:libraryForProfile(evidence.contentProfile),provider:identity.provider,
      namespace:identity.namespace,providerKey:identity.providerKey}))) return true;
    const digest = evidence.evidenceDigest;
    return Boolean(store.findRegistrationCandidateByEvidence(digest));
  }

  function openDraft(evidence) {
    const proposedName = String(evidence.displayName || '').trim() || '未命名人物';
    const aliases = [aliasFor(proposedName)];
    const providerIdentities = providerIdentitiesFrom(evidence);
    const candidatePayload = {
      libraryKind: libraryForProfile(evidence.contentProfile),
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
    return evidenceProjection.listPage({ cursor, limit });
  }

  function reconcile(scope) {
    if (!scope || scope.skipped) return Object.freeze({ kind: 'skipped' });
    if (libraryForProfile(scope.contentProfile) === 'us_adult') return Object.freeze({ kind: 'user_owned_library' });
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
    return Object.freeze({ kind: 'internal_evidence', candidateId: candidate.candidateId });
  }

  function registerPerson(body, actorId) {
    const libraryKind = requireLibraryKind(body?.libraryKind);
    if (libraryKind !== 'us_adult') throw Object.assign(new Error('This Person library is system managed.'), { code: 'PEOPLE_LIBRARY_READ_ONLY' });
    if (!options.imageOperations) throw Object.assign(new Error('People image preparation is unavailable.'), { code: 'PEOPLE_IMAGE_PREPARATION_UNAVAILABLE' });
    return options.imageOperations.begin(body, actorId);
  }

  function acceptRegistration(body, actorId) {
    throw Object.assign(new Error('System Person evidence does not require user confirmation.'), { code: 'PEOPLE_LIBRARY_READ_ONLY' });
  }

  function dismissRegistration(body, actorId) {
    throw Object.assign(new Error('System Person evidence is managed internally.'), { code: 'PEOPLE_LIBRARY_READ_ONLY' });
  }

  function reconcileNfoEntry(scope) {
    const observation = options.onDeckNfoPersonEvidence.observeEntry(scope);
    if (observation.kind !== 'observed') return observation;
    const results = observation.items.map(reconcile);
    return Object.freeze({kind:'nfo_evidence_consumed',observedCount:results.length,
      registeredCount:results.filter(item => item.kind === 'auto_accepted').length,
      pendingCount:results.filter(item => item.kind === 'internal_evidence').length});
  }

  return Object.freeze({
    listNfoPage:({cursor,limit}) => options.onDeckNfoPersonEvidence?.listPage({cursor,limit}) || [],
    reconcileNfoEntry,
    mediaCastReferenceQuery:createMediaCastReferenceQuery(store),
    store,
    recommendations,
    recommendationQuery,
    recommendationClaims,
    listPage,
    reconcile,
    registerPerson,
    imageOperations: options.imageOperations,
    updateProfile:(personId,body,actorId)=>options.profileUpdate.update(personId,body,actorId),
    registrationSignalParticipant: payload => store.createRegistrationSignalParticipant(payload),
    referenceSignalParticipant:payload=>store.createReferenceSignalParticipant(payload),
    addReference:(personId,body,actorId)=>options.imageOperations.addReference(personId,body,actorId),
    acceptRegistration,
    dismissRegistration,
  });
}

module.exports = Object.freeze({ createPeopleProcessServices });
