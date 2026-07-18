'use strict';

function createCandidatePublicationCapability(options = {}) {
  if (!options.store || typeof options.store.publish !== 'function') throw new TypeError('Candidate Publication Store is required.');
  return Object.freeze({
    capabilityRef:'procurement.candidate.publish@1',
    effectClass:'domain_fact_commit',
    execute(request) { return options.store.publish(request); }
  });
}

module.exports = Object.freeze({ createCandidatePublicationCapability });
