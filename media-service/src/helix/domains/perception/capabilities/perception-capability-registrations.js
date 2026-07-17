'use strict';

const CONTRACTS = Object.freeze({
  'perception.source.acquire@1': 'pure_observation',
  'perception.record.normalize@1': 'pure_observation',
  'perception.record.commit@1': 'domain_fact_commit',
  'perception.dedup.resolve@1': 'pure_observation',
  'perception.resolution.commit@1': 'domain_fact_commit'
});

class PerceptionCapabilityRegistrationError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PerceptionCapabilityRegistrationError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new PerceptionCapabilityRegistrationError(code, message, details); }

function createPerceptionCapabilityRegistrations(options) {
  const refs = Object.keys(CONTRACTS);
  if (!options || !options.manifests || !options.ports ||
      JSON.stringify(Object.keys(options.manifests).sort()) !== JSON.stringify([...refs].sort()) ||
      JSON.stringify(Object.keys(options.ports).sort()) !== JSON.stringify([...refs].sort())) {
    fail('P6_PERCEPTION_CAPABILITY_SET_MISMATCH', 'Perception requires exactly its five frozen Capability manifests and typed ports.');
  }
  return Object.freeze(refs.map((capabilityRef) => {
    const manifest = options.manifests[capabilityRef];
    const port = options.ports[capabilityRef];
    if (!manifest || manifest.capabilityRef !== capabilityRef || manifest.ownerScope !== 'perception' ||
        manifest.effectClass !== CONTRACTS[capabilityRef] || manifest.contractVersion !== 1 ||
        !port || typeof port.execute !== 'function' ||
        typeof port.validateInputs !== 'function' || typeof port.validateResult !== 'function') {
      fail('P6_PERCEPTION_CAPABILITY_BINDING_INVALID', 'Perception Capability binding drifted from its frozen P2 contract.', { capabilityRef });
    }
    return Object.freeze({ manifest, executor: Object.freeze({ version: 1, execute: (context) => port.execute(context) }),
      semanticValidator: Object.freeze({ ref: manifest.semanticValidatorRef,
        validateInputs: (context) => port.validateInputs(context), validateResult: (context, outcome) => port.validateResult(context, outcome) }) });
  }));
}

module.exports = Object.freeze({ CONTRACTS, PerceptionCapabilityRegistrationError, createPerceptionCapabilityRegistrations });
