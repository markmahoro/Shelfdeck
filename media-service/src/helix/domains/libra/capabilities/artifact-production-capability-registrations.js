'use strict';

const { ACQUIRE, SIDECAR, VERIFY } = require('./artifact-production-capability-ports');
const EFFECTS = Object.freeze({ [ACQUIRE]:'workspace_write', [SIDECAR]:'workspace_write', [VERIFY]:'pure_observation' });

function createArtifactProductionCapabilityRegistrations(options) {
  const refs = Object.keys(EFFECTS);
  if (JSON.stringify(Object.keys(options?.manifests || {}).sort()) !== JSON.stringify([...refs].sort()) ||
      JSON.stringify(Object.keys(options?.ports || {}).sort()) !== JSON.stringify([...refs].sort())) {
    throw new TypeError('Artifact production requires exactly three Capability bindings.');
  }
  return Object.freeze(refs.map((capabilityRef) => {
    const manifest=options.manifests[capabilityRef],port=options.ports[capabilityRef];
    if (manifest?.capabilityRef !== capabilityRef || manifest.effectClass !== EFFECTS[capabilityRef] ||
        typeof port?.execute !== 'function') throw new TypeError('Artifact production Capability binding is invalid.');
    return Object.freeze({ manifest, executor:Object.freeze({version:1,execute:(context)=>port.execute(context)}),
      semanticValidator:Object.freeze({ref:manifest.semanticValidatorRef,validateInputs:(context)=>port.validateInputs(context),
        validateResult:(context,outcome)=>port.validateResult(context,outcome)}) });
  }));
}

module.exports = Object.freeze({ EFFECTS, createArtifactProductionCapabilityRegistrations });
