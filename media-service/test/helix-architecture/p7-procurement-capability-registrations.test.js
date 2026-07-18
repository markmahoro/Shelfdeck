'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createCapabilityRegistry } = require('../../src/helix/foundation/capability/capability-registry');
const { createExecutorDispatcher } = require('../../src/helix/foundation/capability/executor-dispatcher');
const { CONTRACTS, createProcurementCapabilityRegistrations } =
  require('../../src/helix/domains/procurement/capabilities/procurement-capability-registrations');

const contractsRoot = path.resolve(__dirname, '../../src/helix/contracts/capabilities');

function manifests() {
  const result = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name === 'manifest.json') {
        const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (Object.hasOwn(CONTRACTS, manifest.capabilityRef)) result[manifest.capabilityRef] = manifest;
      }
    }
  }
  visit(path.join(contractsRoot, 'procurement'));
  return result;
}

function ports(calls) {
  return Object.fromEntries(Object.keys(CONTRACTS).map((ref) => [ref, Object.freeze({
    validateInputs(context) { calls.push(['input', ref, context.capabilityRef]); },
    async execute(context) { calls.push(['execute', ref, context.capabilityRef]); return { kind:'committed' }; },
    validateResult(context) { calls.push(['result', ref, context.capabilityRef]); }
  })]));
}

test('registers exactly eight Procurement contracts and dispatches through their frozen Effect Classes', async () => {
  const calls = [];
  const registrations = createProcurementCapabilityRegistrations({ manifests:manifests(), ports:ports(calls) });
  assert.equal(registrations.length, 8);
  const registry = createCapabilityRegistry({ registrations, expectedCapabilityRefs:Object.keys(CONTRACTS) });
  const validated = [];
  const dispatcher = createExecutorDispatcher({ registry, contractValidator:{ validate(ref) { validated.push(ref); } } });
  for (const [capabilityRef, effectClass] of Object.entries(CONTRACTS)) {
    const context = { capabilityRef, contractVersion:1, executorVersion:1, effectClass,
      ownerScope:{ domain:'procurement' }, parameters:{}, fenceSnapshot:{}, namedInputs:{} };
    const outcome = await dispatcher.dispatch({ capabilityRef, ownerDomain:'procurement', context });
    assert.deepEqual(outcome, { kind:'committed' });
  }
  assert.equal(calls.length, 16);
  assert.equal(validated.length, 40);
});

test('rejects missing, extra, wrong-owner, wrong-effect, and untyped Procurement bindings', () => {
  const exactManifests = manifests();
  const exactPorts = ports([]);
  const ref = 'procurement.candidate.publish@1';
  assert.throws(() => createProcurementCapabilityRegistrations({ manifests:{ ...exactManifests, [ref]:undefined }, ports:exactPorts }),
    (error) => error.code === 'P7_PROCUREMENT_CAPABILITY_BINDING_INVALID');
  assert.throws(() => createProcurementCapabilityRegistrations({ manifests:exactManifests, ports:{ ...exactPorts, extra:exactPorts[ref] } }),
    (error) => error.code === 'P7_PROCUREMENT_CAPABILITY_SET_MISMATCH');
  assert.throws(() => createProcurementCapabilityRegistrations({ manifests:{ ...exactManifests,
    [ref]:{ ...exactManifests[ref], ownerScope:'libra' } }, ports:exactPorts }),
    (error) => error.code === 'P7_PROCUREMENT_CAPABILITY_BINDING_INVALID');
  const controlRef = 'procurement.material.control.acquire@1';
  assert.throws(() => createProcurementCapabilityRegistrations({ manifests:{ ...exactManifests,
    [controlRef]:{ ...exactManifests[controlRef], effectClass:'domain_fact_commit' } }, ports:exactPorts }),
    (error) => error.code === 'P7_PROCUREMENT_CAPABILITY_BINDING_INVALID');
  assert.throws(() => createProcurementCapabilityRegistrations({ manifests:exactManifests,
    ports:{ ...exactPorts, [ref]:{ execute() {}, validateInputs() {} } } }),
    (error) => error.code === 'P7_PROCUREMENT_CAPABILITY_BINDING_INVALID');
});

test('Procurement registration is a pure binding layer with no Workflow, Store, or legacy imports', () => {
  const source = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/domains/procurement/capabilities/procurement-capability-registrations.js'), 'utf8');
  assert.doesNotMatch(source, /require\([^)]*(workflow|runtime|persistence|store|legacy|kairox|nexora)/i);
});
