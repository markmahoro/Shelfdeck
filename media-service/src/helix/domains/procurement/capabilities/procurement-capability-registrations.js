'use strict';

const CONTRACTS = Object.freeze({
  'procurement.field.observation.page.commit@1': 'domain_fact_commit',
  'procurement.material.control.acquire@1': 'responsibility_control_commit',
  'procurement.triage.playability.inspect@1': 'pure_observation',
  'procurement.triage.structure.inspect@1': 'pure_observation',
  'procurement.triage.identity_claim.resolve@1': 'pure_observation',
  'procurement.triage.primary_manifest.build@1': 'pure_observation',
  'procurement.candidate.publish@1': 'domain_fact_commit'
});

class ProcurementCapabilityRegistrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProcurementCapabilityRegistrationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ProcurementCapabilityRegistrationError(code, message, details);
}

function exactKeys(value, expected) {
  return value && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function createProcurementCapabilityRegistrations(options) {
  const refs = options?.enabledCapabilityRefs || Object.keys(CONTRACTS);
  if (!Array.isArray(refs) || refs.length < 1 || new Set(refs).size !== refs.length ||
      refs.some((ref) => !Object.hasOwn(CONTRACTS, ref))) {
    fail('P7_PROCUREMENT_CAPABILITY_SET_MISMATCH', 'Enabled Procurement Capability set is invalid.');
  }
  if (!options || !exactKeys(options.manifests, refs) || !exactKeys(options.ports, refs)) {
    fail('P7_PROCUREMENT_CAPABILITY_SET_MISMATCH',
      'Procurement requires exactly its eight frozen Capability manifests and typed ports.');
  }
  return Object.freeze(refs.map((capabilityRef) => {
    const manifest = options.manifests[capabilityRef];
    const port = options.ports[capabilityRef];
    if (!manifest || manifest.capabilityRef !== capabilityRef || manifest.ownerScope !== 'procurement' ||
        manifest.effectClass !== CONTRACTS[capabilityRef] || manifest.contractVersion !== 1 ||
        !port || typeof port.execute !== 'function' || typeof port.validateInputs !== 'function' ||
        typeof port.validateResult !== 'function') {
      fail('P7_PROCUREMENT_CAPABILITY_BINDING_INVALID',
        'Procurement Capability binding drifted from its frozen P2 contract.', { capabilityRef });
    }
    return Object.freeze({
      manifest,
      executor:Object.freeze({ version:1, execute:(context) => port.execute(context) }),
      semanticValidator:Object.freeze({
        ref:manifest.semanticValidatorRef,
        validateInputs:(context) => port.validateInputs(context),
        validateResult:(context, outcome) => port.validateResult(context, outcome)
      })
    });
  }));
}

module.exports = Object.freeze({ CONTRACTS, ProcurementCapabilityRegistrationError,
  createProcurementCapabilityRegistrations });
