'use strict';

const { requireLibraryKind, libraryForProfile } = require('../model/person-library');
const { createMediaCastReferenceQuery } = require('./media-cast-reference-query');
const { createPeopleStore } = require('../persistence/people-store');

function createPeopleProcessServices(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new TypeError('People process services require People persistence.');
  }
  const store = options.peopleStore || createPeopleStore(options);
  store.ensureJavUnknownActor();
  const evidenceProjection = options.onDeckPersonEvidenceProjection;

  function listPage({ cursor, limit }) {
    if (!evidenceProjection || typeof evidenceProjection.listPage !== 'function') return [];
    return evidenceProjection.listPage({ cursor, limit });
  }

  function reconcile(scope) {
    if (!scope || scope.skipped) return Object.freeze({ kind: 'skipped' });
    if (libraryForProfile(scope.contentProfile) === 'us_adult') return Object.freeze({ kind: 'user_owned_library' });
    if (!scope.displayName && !(scope.providerIdentities || []).length) return Object.freeze({ kind: 'empty' });
    if(!options.systemRegistration)throw new TypeError('System People maintenance requires the formal Evidence Work coordinator.');
    return options.systemRegistration.reconcile(scope);
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
    listPage,
    reconcile,
    registerPerson,
    imageOperations: options.imageOperations,
    systemMerge:options.systemMerge,
    artifactReclamation:options.artifactReclamation,
    updateProfile:(personId,body,actorId)=>options.profileUpdate.update(personId,body,actorId),
    registrationSignalParticipant: payload => store.createRegistrationSignalParticipant(payload),
    candidateSignalParticipant:payload=>store.createCandidateSignalParticipant(payload),
    mergeCandidateSignalParticipant:payload=>store.createCandidateSignalParticipant(payload,'merge'),
    mergeSignalParticipant:payload=>store.createMergeSignalParticipant(payload),
    referenceSignalParticipant:payload=>store.createReferenceSignalParticipant(payload),
    addReference:(personId,body,actorId)=>options.imageOperations.addReference(personId,body,actorId),
    releaseReference:(personId,assetId,body,actorId)=>options.imageOperations.releaseReference(personId,assetId,body,actorId),
    acceptRegistration,
    dismissRegistration,
  });
}

module.exports = Object.freeze({ createPeopleProcessServices });
