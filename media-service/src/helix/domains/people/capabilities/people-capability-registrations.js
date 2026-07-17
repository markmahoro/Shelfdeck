'use strict';

const CONTRACTS = Object.freeze({
  'people.registration_evidence.observe@1': 'pure_observation',
  'people.reference_asset.import@1': 'workspace_write',
  'people.reference_fact.commit@1': 'domain_fact_commit',
  'people.merge_evidence.resolve@1': 'pure_observation',
  'people.candidate.commit@1': 'domain_fact_commit',
  'people.person.commit@1': 'domain_fact_commit',
  'people.preference.commit@1': 'domain_fact_commit',
  'people.workspace.reclaim@1': 'workspace_write'
});

class PeopleCapabilityRegistrationError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PeopleCapabilityRegistrationError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new PeopleCapabilityRegistrationError(code, message, details); }

function createPeopleCapabilityRegistrations(options) {
  const refs = Object.keys(CONTRACTS);
  if (!options || !options.manifests || !options.ports ||
      JSON.stringify(Object.keys(options.manifests).sort()) !== JSON.stringify([...refs].sort()) ||
      JSON.stringify(Object.keys(options.ports).sort()) !== JSON.stringify([...refs].sort())) {
    fail('P6_PEOPLE_CAPABILITY_SET_MISMATCH', 'People requires exactly its eight frozen Capability manifests and typed ports.');
  }
  return Object.freeze(refs.map((capabilityRef) => {
    const manifest = options.manifests[capabilityRef];
    const port = options.ports[capabilityRef];
    if (!manifest || manifest.capabilityRef !== capabilityRef || manifest.ownerScope !== 'people' ||
        manifest.effectClass !== CONTRACTS[capabilityRef] || manifest.contractVersion !== 1 ||
        !port || typeof port.execute !== 'function' ||
        typeof port.validateInputs !== 'function' || typeof port.validateResult !== 'function') {
      fail('P6_PEOPLE_CAPABILITY_BINDING_INVALID', 'People Capability binding drifted from its frozen P2 contract.', { capabilityRef });
    }
    return Object.freeze({ manifest, executor: Object.freeze({ version: 1, execute: (context) => port.execute(context) }),
      semanticValidator: Object.freeze({ ref: manifest.semanticValidatorRef,
        validateInputs: (context) => port.validateInputs(context), validateResult: (context, outcome) => port.validateResult(context, outcome) }) });
  }));
}

module.exports = Object.freeze({ CONTRACTS, PeopleCapabilityRegistrationError, createPeopleCapabilityRegistrations });
