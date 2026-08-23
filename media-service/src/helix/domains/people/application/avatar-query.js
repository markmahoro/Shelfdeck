'use strict';

class PeopleAvatarQueryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PeopleAvatarQueryError';
    this.code = code;
    this.details = {};
  }
}

function fail(code, message) {
  throw new PeopleAvatarQueryError(code, message);
}

function createPeopleAvatarQuery(options) {
  if (!options?.store || typeof options.store.getPerson !== 'function' ||
      typeof options.readProviderAvatar !== 'function') {
    throw new TypeError('People Avatar Query requires the People store and Provider avatar reader.');
  }

  async function get(personId) {
    const person = options.store.getPerson(personId);
    if (!person || person.status !== 'active') {
      fail('PEOPLE_PERSON_NOT_FOUND', 'Registered Person was not found.');
    }
    const providerIdentity = person.revision.providerIdentities.find((identity) =>
      identity.provider === 'tmdb' && identity.namespace === 'tmdb_person' &&
      /^\d+$/.test(identity.providerKey));
    if (!providerIdentity) {
      fail('PEOPLE_AVATAR_IDENTITY_NOT_AVAILABLE', 'Registered Person has no TMDB Person identity.');
    }
    const result = await options.readProviderAvatar(Object.freeze({
      provider: providerIdentity.provider,
      namespace: providerIdentity.namespace,
      providerKey: providerIdentity.providerKey,
    }));
    if (!result || result.resultKind !== 'acquired') {
      fail('PEOPLE_AVATAR_NOT_AVAILABLE', 'Registered Person has no available avatar.');
    }
    return Object.freeze({ contentType: result.mediaType, bytes: result.bytes });
  }

  return Object.freeze({ get });
}

module.exports = Object.freeze({
  PeopleAvatarQueryError,
  createPeopleAvatarQuery,
});
