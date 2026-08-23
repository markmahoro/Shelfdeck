'use strict';

function compare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function createPeopleAdminQuery(options) {
  if (!options || !options.store || typeof options.store.listPeople !== 'function' ||
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
    const people = [...options.store.listPeople()].sort((left, right) => compare(left.personId, right.personId));
    const filtered = people.filter((person) => {
      if (status && person.status !== status) return false;
      if (cursor && compare(person.personId, cursor) <= 0) return false;
      if (!search) return true;
      const names = [person.revision.canonicalName,
        ...person.revision.aliases.map((alias) => alias.aliasDisplay)];
      return names.some((name) => name.toLocaleLowerCase().includes(search));
    });
    const page = filtered.slice(0, limit);
    const registrations = options.store.listRegistrationCandidates();
    const merges = options.store.listMergeCandidates();
    return Object.freeze({
      items: Object.freeze(page.map((person) => Object.freeze({
        personId: person.personId,
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
      nextCursor: filtered.length > limit ? page.at(-1).personId : null,
      summary: Object.freeze({
        activePersonCount: people.filter((person) => person.status === 'active').length,
        mergedPersonCount: people.filter((person) => person.status === 'merged').length,
        openRegistrationCandidateCount: registrations.filter((item) => item.currentState === 'open').length,
        openMergeCandidateCount: merges.filter((item) => item.currentState === 'open').length,
      }),
    });
  }

  return Object.freeze({
    list,
    get(personId) {
      const result = options.store.getPerson(personId);
      return result || null;
    },
    registrationCandidates() {
      return Object.freeze({ items:options.store.listRegistrationCandidates() });
    },
    mergeCandidates() {
      return Object.freeze({ items:options.store.listMergeCandidates() });
    },
  });
}

module.exports = Object.freeze({ createPeopleAdminQuery });
