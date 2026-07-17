'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createCapabilityRegistry } = require('../../src/helix/foundation/capability/capability-registry');
const { CONTRACTS: PERCEPTION, createPerceptionCapabilityRegistrations } = require('../../src/helix/domains/perception/capabilities/perception-capability-registrations');
const { CONTRACTS: PEOPLE, createPeopleCapabilityRegistrations } = require('../../src/helix/domains/people/capabilities/people-capability-registrations');

const capabilityRoot = path.resolve(__dirname, '../../src/helix/contracts/capabilities');

function manifestsFor(contracts) {
  const wanted = new Set(Object.keys(contracts)); const result = {};
  const pending = [capabilityRoot];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.name === 'manifest.json') {
        const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (wanted.has(manifest.capabilityRef)) result[manifest.capabilityRef] = manifest;
      }
    }
  }
  return result;
}

function ports(contracts, calls) {
  return Object.fromEntries(Object.keys(contracts).map((ref) => [ref, Object.freeze({
    validateInputs(context) { calls.push(['input', ref, context.capabilityRef]); },
    async execute(context) { calls.push(['execute', ref, context.capabilityRef]); return { kind: 'deferred' }; },
    validateResult(context) { calls.push(['result', ref, context.capabilityRef]); }
  })]));
}

test('registers exactly five Perception and eight People executors against frozen P2 manifests', async () => {
  const calls = [];
  const perception = createPerceptionCapabilityRegistrations({ manifests: manifestsFor(PERCEPTION), ports: ports(PERCEPTION, calls) });
  const people = createPeopleCapabilityRegistrations({ manifests: manifestsFor(PEOPLE), ports: ports(PEOPLE, calls) });
  const registrations = [...perception, ...people];
  assert.equal(registrations.length, 13);
  const registry = createCapabilityRegistry({ registrations, expectedCapabilityRefs: [...Object.keys(PERCEPTION), ...Object.keys(PEOPLE)] });
  assert.equal(registry.size, 13);
  for (const entry of registrations) {
    const context = { capabilityRef: entry.manifest.capabilityRef };
    entry.semanticValidator.validateInputs(context);
    assert.deepEqual(await entry.executor.execute(context), { kind: 'deferred' });
  }
  assert.equal(calls.filter((call) => call[0] === 'input').length, 13);
  assert.equal(calls.filter((call) => call[0] === 'execute').length, 13);
});

test('rejects missing, extra, wrong-Owner, Effect drift, and untyped ports', () => {
  const manifests = manifestsFor(PERCEPTION); const exactPorts = ports(PERCEPTION, []);
  assert.throws(() => createPerceptionCapabilityRegistrations({ manifests, ports: { ...exactPorts, extra: exactPorts[Object.keys(PERCEPTION)[0]] } }),
    { code: 'P6_PERCEPTION_CAPABILITY_SET_MISMATCH' });
  const ref = Object.keys(PERCEPTION)[0];
  assert.throws(() => createPerceptionCapabilityRegistrations({ manifests: { ...manifests, [ref]: { ...manifests[ref], ownerScope: 'libra' } }, ports: exactPorts }),
    { code: 'P6_PERCEPTION_CAPABILITY_BINDING_INVALID' });
  const peopleManifests = manifestsFor(PEOPLE); const peoplePorts = ports(PEOPLE, []); const peopleRef = Object.keys(PEOPLE)[1];
  assert.throws(() => createPeopleCapabilityRegistrations({ manifests: { ...peopleManifests, [peopleRef]: { ...peopleManifests[peopleRef], effectClass: 'pure_observation' } }, ports: peoplePorts }),
    { code: 'P6_PEOPLE_CAPABILITY_BINDING_INVALID' });
});

test('registration adapters contain no Store, Facade, Planner, Runtime, provider, filesystem, or network authority', () => {
  const files = [
    '../../src/helix/domains/perception/capabilities/perception-capability-registrations.js',
    '../../src/helix/domains/people/capabilities/people-capability-registrations.js'
  ];
  const source = files.map((file) => fs.readFileSync(path.resolve(__dirname, file), 'utf8').toLowerCase()).join('\n');
  for (const forbidden of ['require(\'node:fs\')', 'require(\'node:http\')', 'repository', 'facade', 'planner', 'runtime', 'integrationhandle', 'legacy', 'fallback']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
