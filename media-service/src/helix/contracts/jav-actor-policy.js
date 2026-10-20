'use strict';

// This reserved Person is owned by People, not by any external metadata site.
const JAV_UNKNOWN_ACTOR_ID = 'person-jav-unknown-actor';
const JAV_UNKNOWN_ACTOR_NAME = '未知演员';
const JAV_UNKNOWN_ACTOR_ROLE = 'jav_unknown_actor';

function javActorHints(hints) {
  const actors = (hints || []).filter(item => item.role === 'actor' && typeof item.displayName === 'string' && item.displayName.trim());
  return actors.length ? actors : [{ displayName: JAV_UNKNOWN_ACTOR_NAME, role: 'actor', providerIdentities: [] }];
}

module.exports = Object.freeze({ JAV_UNKNOWN_ACTOR_ID, JAV_UNKNOWN_ACTOR_NAME, JAV_UNKNOWN_ACTOR_ROLE, javActorHints });
