'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createCapabilityRegistry } = require('../../src/helix/foundation/capability/capability-registry');

const serviceRoot = path.resolve(__dirname, '../..');
const capabilityRoot = path.join(serviceRoot, 'src/helix/contracts/capabilities');

function manifests() {
  const result = [];
  const pending = [capabilityRoot];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.name === 'manifest.json') result.push(JSON.parse(fs.readFileSync(absolute, 'utf8')));
    }
  }
  return result.sort((left, right) => left.capabilityRef.localeCompare(right.capabilityRef));
}

function registration(manifest, overrides = {}) {
  return {
    manifest,
    executor: overrides.executor || { version: manifest.executorCompatibility.minimumVersion, async execute() { return { kind: 'deferred' }; } },
    semanticValidator: overrides.semanticValidator || {
      ref: manifest.semanticValidatorRef, validateInputs() {}, validateResult() {}
    }
  };
}

test('Registry closes exactly all 112 frozen Capability refs with deterministic snapshot', () => {
  const catalog = manifests();
  const expected = catalog.map((manifest) => manifest.capabilityRef);
  const first = createCapabilityRegistry({ registrations: catalog.map((manifest) => registration(manifest)), expectedCapabilityRefs: expected });
  const second = createCapabilityRegistry({ registrations: [...catalog].reverse().map((manifest) => registration(manifest)), expectedCapabilityRefs: expected });
  assert.equal(first.size, 112);
  assert.deepEqual(first.snapshot, second.snapshot);
  assert.equal(first.snapshot.every((entry) => /^[0-9a-f]{64}$/.test(entry.contractDigest)), true);
});

test('Domain Catalog view contains only own and Shared contracts', () => {
  const catalog = manifests();
  const registry = createCapabilityRegistry({
    registrations: catalog.map((manifest) => registration(manifest)), expectedCapabilityRefs: catalog.map((manifest) => manifest.capabilityRef)
  });
  const libra = registry.viewFor('libra');
  assert.equal(libra.length > 0, true);
  assert.equal(libra.every((entry) => entry.ownerScope === 'execution-foundation' || entry.ownerScope === 'libra'), true);
  const arcaOnly = catalog.find((manifest) => manifest.ownerScope === 'arca');
  assert.throws(() => registry.resolve(arcaOnly.capabilityRef, 'libra'), (error) => error.code === 'P4_CAPABILITY_NOT_VISIBLE');
});

test('Registry rejects missing, unknown, duplicate, fallback version, old executor, and semantic-validator drift', () => {
  const manifest = manifests()[0];
  assert.throws(() => createCapabilityRegistry({ registrations: [registration(manifest)], expectedCapabilityRefs: [manifest.capabilityRef, 'shared.missing@1'] }),
    (error) => error.code === 'P4_CAPABILITY_REGISTRY_SET_MISMATCH');
  assert.throws(() => createCapabilityRegistry({ registrations: [registration(manifest), registration(manifest)], expectedCapabilityRefs: [manifest.capabilityRef] }),
    (error) => error.code === 'P4_CAPABILITY_DUPLICATE_REGISTRATION');
  const registry = createCapabilityRegistry({ registrations: [registration(manifest)], expectedCapabilityRefs: [manifest.capabilityRef] });
  assert.throws(() => registry.resolve(manifest.capabilityRef.replace('@1', '@2'), manifest.ownerScope === 'execution-foundation' ? 'libra' : manifest.ownerScope),
    (error) => error.code === 'P4_CAPABILITY_NOT_REGISTERED');
  assert.throws(() => createCapabilityRegistry({
    registrations: [registration(manifest, { executor: { version: 0, execute() {} } })], expectedCapabilityRefs: [manifest.capabilityRef]
  }), (error) => ['P4_CAPABILITY_INVALID_REGISTRATION', 'P4_CAPABILITY_EXECUTOR_VERSION_TOO_OLD'].includes(error.code));
  assert.throws(() => createCapabilityRegistry({
    registrations: [registration(manifest, { semanticValidator: { ref: 'helix://wrong', validateInputs() {}, validateResult() {} } })],
    expectedCapabilityRefs: [manifest.capabilityRef]
  }), (error) => error.code === 'P4_CAPABILITY_INVALID_REGISTRATION');
});
