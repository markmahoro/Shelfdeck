'use strict';
const { requireLibraryKind } = require('../model/person-library');

function createPeopleAdminQuery(options) {
  if (!options || !options.store || typeof options.store.listPeoplePage !== 'function' ||
      typeof options.store.overviewStats !== 'function' ||
      typeof options.store.listRegistrationCandidates !== 'function' ||
      typeof options.store.listMergeCandidates !== 'function') {
    throw new TypeError('People Admin Query requires the People owner store.');
  }

  function list(query = {}) {
    const requestedLimit = Number(query.limit ?? 50);
    const limit = Number.isSafeInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 100
      ? requestedLimit : 50;
    const cursor = String(query.cursor || '');
    const search = String(query.search || '').trim().toLocaleLowerCase();
    const status = ['active', 'merged'].includes(query.status) ? query.status : null;
    const libraryKind = requireLibraryKind(query.libraryKind || 'normal');
    const people = options.store.listPeoplePage({ cursor, limit: limit + 1, status, search, libraryKind });
    const page = people.slice(0, limit);
    return Object.freeze({
      items: Object.freeze(page.map((person) => Object.freeze({
        personId: person.personId,
        libraryKind: person.libraryKind,
        status: person.status,
        currentRevision: person.currentRevision,
        canonicalName: person.revision.canonicalName,
        aliases: Object.freeze(person.revision.aliases.map((alias) => alias.aliasDisplay)),
        providerIdentities: Object.freeze(person.revision.providerIdentities.map((identity) =>
          Object.freeze({ provider:identity.provider, namespace:identity.namespace, providerKey:identity.providerKey }))),
        currentPreferenceRevision: person.currentPreferenceRevision,
        currentReferenceRevision: person.currentReferenceRevision,
        createdAtMs: person.createdAtMs,
      }))),
      nextCursor: people.length > limit ? page.at(-1).personId : null,
      summary: options.store.overviewStats(libraryKind),
    });
  }

  return Object.freeze({
    summary:()=>{
      const counts=['normal','jav','us_adult'].map(kind=>options.store.overviewStats(kind));
      return Object.freeze({activePersonCount:counts.reduce((sum,item)=>sum+item.activePersonCount,0),
        mergedPersonCount:counts.reduce((sum,item)=>sum+item.mergedPersonCount,0),openRegistrationCandidateCount:0,openMergeCandidateCount:0});
    },
    list,
    get(personId) {
      const result = options.store.getPerson(personId);
      return result || null;
    },
    registrationCandidates() {
      return Object.freeze({ items:Object.freeze([]) });
    },
    mergeCandidates() {
      return Object.freeze({ items:Object.freeze([]) });
    },
  });
}

module.exports = Object.freeze({ createPeopleAdminQuery });
