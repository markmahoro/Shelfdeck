'use strict';

const EFFECTS = Object.freeze({
  'libra.product_identity.evidence.observe@1': 'pure_observation',
  'libra.routing.fact.observe@1': 'pure_observation',
  'libra.decision_basis.commit@1': 'domain_fact_commit',
});

function createRoutingCapabilityRegistrations(options) {
  return Object.freeze(options.enabledCapabilityRefs.map((capabilityRef) => {
    const manifest = options.manifests[capabilityRef], port = options.ports[capabilityRef];
    if (!manifest || manifest.ownerScope !== 'libra' || manifest.effectClass !== EFFECTS[capabilityRef] || !port) {
      throw new TypeError('Libra Routing Capability binding is invalid: ' + capabilityRef);
    }
    return Object.freeze({ manifest, executor: Object.freeze({ version: 1, execute: (context) => port.execute(context) }),
      semanticValidator: Object.freeze({ ref: manifest.semanticValidatorRef,
        validateInputs: (context) => port.validateInputs(context), validateResult: (context, outcome) => port.validateResult(context, outcome) }) });
  }));
}

module.exports = Object.freeze({ EFFECTS, createRoutingCapabilityRegistrations });
