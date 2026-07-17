'use strict';

const PREFERENCE_INTENT_SCHEMA = 'helix://contracts/domain-types/PreferenceIntent/v1';

class PeoplePreferenceLifecycleError extends Error {
  constructor(code, message) { super(message); this.name = 'PeoplePreferenceLifecycleError'; this.code = code; }
}

function createPeoplePreferenceCommitRegistration(store) {
  if (!store || typeof store.createPreferenceCommitParticipant !== 'function') {
    throw new PeoplePreferenceLifecycleError('P6_PEOPLE_PREFERENCE_STORE_REQUIRED', 'People Store preference participant factory is required.');
  }
  return Object.freeze({ ownerDomain:'people', aggregateType:'person-preference', factType:'PreferenceIntent',
    factSchemaRef:PREFERENCE_INTENT_SCHEMA, effectClass:'domain_fact_commit', revisionFence:true,
    createParticipant({ handle, payload }) { return store.createPreferenceCommitParticipant(handle, payload); } });
}

module.exports = Object.freeze({ PeoplePreferenceLifecycleError, createPeoplePreferenceCommitRegistration });
