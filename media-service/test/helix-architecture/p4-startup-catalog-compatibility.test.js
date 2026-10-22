'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  verifyStartupPlanCatalog,
} = require('../../src/helix/composition/create-procurement-execution-runtime');

const PRODUCTION_CATALOG = 'b7e4d607f2684ef6e061e47215aea6607d408fdaf148be3c4b79e7eb0a7ec714';
const registry = Object.freeze({
  resolve() {
    return { manifest: { contractVersion: 1, effectClass: 'pure_observation' } };
  },
});
const policyRegistry = Object.freeze({ bindingFor() {} });
const bindingProjectionRegistry = Object.freeze({ resolve() {} });

function verify(snapshot) {
  return verifyStartupPlanCatalog(snapshot, 'current-catalog', registry, policyRegistry,
    bindingProjectionRegistry, undefined, undefined, undefined);
}

const terminalSnapshot = Object.freeze({
  plan: { catalog_digest: PRODUCTION_CATALOG, state: 'planned' },
  workAttempt: { state: 'succeeded' },
  work: { owner_domain: 'libra' },
  nodes: [],
  events: [],
});

const activeSnapshot = Object.freeze({
  plan: { catalog_digest: PRODUCTION_CATALOG, state: 'planned' },
  workAttempt: { state: 'running' },
  work: { owner_domain: 'libra' },
  nodes: [{
    plan_id: 'plan', node_id: 'node', capability_ref: 'libra.product_identity.evidence.observe@1',
    contract_version: 1, effect_class: 'pure_observation',
    input_bindings_json: '{"schemaRef":"helix://foundation/types/EventInputBindingSet/v1","schemaVersion":1,"bindings":[]}',
  }],
  events: [{
    plan_id: 'plan', node_id: 'node', owner_domain: 'libra',
    capability_ref: 'libra.product_identity.evidence.observe@1',
  }],
});

test('terminal production-movie plans are accepted as bounded historical catalog', () => {
  assert.equal(verify(terminalSnapshot), true);
});

test('active production-movie plans may resume only when current capability contracts still match', () => {
  assert.equal(verify(activeSnapshot), true);
  const drifted = { ...activeSnapshot, nodes: [{ ...activeSnapshot.nodes[0], contract_version: 2 }] };
  assert.equal(verify(drifted), false);
  const unknown = { ...activeSnapshot, plan: { ...activeSnapshot.plan, catalog_digest: 'unknown' } };
  assert.equal(verify(unknown), false);
});
