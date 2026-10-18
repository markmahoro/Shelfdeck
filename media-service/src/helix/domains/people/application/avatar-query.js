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

  async function get(personId,query={}) {
    const person = options.store.getPerson(personId);
    if (!person || person.status !== 'active') {
      fail('PEOPLE_PERSON_NOT_FOUND', 'Registered Person was not found.');
    }
    if (person.libraryKind === 'us_adult') {
      if(query.revision!==undefined&&Number(query.revision)!==person.currentReferenceRevision)
        fail('PEOPLE_AVATAR_NOT_AVAILABLE','Actor reference revision has changed.');
      const projection = options.store.getPersonReferenceProjection(personId);
      const assets = projection?.contributions.filter(item => item.ownerPersonId === personId).flatMap(item => item.activeAssets) || [];
      if (!assets.length || typeof options.readReferenceAvatar !== 'function') fail('PEOPLE_AVATAR_NOT_AVAILABLE', 'Actor reference image is unavailable.');
      const selected=query.assetId===undefined?assets[0]:assets.find(item=>item.referenceAssetId===query.assetId);
      if(!selected)fail('PEOPLE_AVATAR_NOT_AVAILABLE','Actor reference image is no longer current or belongs to another Person.');
      return options.readReferenceAvatar({ personId, ...selected });
    }
    if(query.assetId!==undefined)fail('PEOPLE_AVATAR_NOT_AVAILABLE','A system Person does not expose user Reference image selection.');
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
