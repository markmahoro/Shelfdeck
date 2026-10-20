'use strict';

function isTmdbPerson(identity) {
  return identity?.provider === 'tmdb' && ['tmdb_person', 'person'].includes(identity.namespace) && /^[1-9][0-9]{0,15}$/.test(identity.providerKey);
}

function personIdentityNamespaces(identity) {
  return isTmdbPerson(identity) ? ['tmdb_person', 'person'] : [identity.namespace];
}

module.exports = Object.freeze({ isTmdbPerson, personIdentityNamespaces });
