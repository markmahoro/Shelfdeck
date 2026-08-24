'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const {
  mergeResourceDemands,
} = require('../../src/helix/composition/create-procurement-execution-runtime');
const {
  createResourceGovernor,
} = require('../../src/helix/foundation/execution/resource-governor');
const {
  createResourceProfileMapper,
} = require('../../src/helix/foundation/execution/resource-profile-mapper');
const {
  openSqliteKernel,
} = require('../../src/helix/foundation/persistence/sqlite-kernel');
const {
  createSqliteUnitOfWork,
} = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function demand(eventId, resources) {
  return {
    eventId,
    queueClass: 'normal_foreground',
    localPriority: 0,
    priorityRevision: 1,
    resources,
  };
}

test('Aftercare media verification merges same-mount reads and preserves cross-mount reads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uat116-aftercare-demand-'));
  const kernel = openSqliteKernel({
    Database,
    databasePath: path.join(root, 'shelfdeck.db'),
    schemaDdl,
    schemaManifest,
    now: () => 1700000000000,
  });
  try {
    let permitOrdinal = 0;
    const mapper = createResourceProfileMapper({
      profileKey: 'default',
      profileRevision: 1,
      logicalCpu: 8,
      integrations: [],
      volumes: [{ volumeKey: 'mount-a' }, { volumeKey: 'mount-b' }],
      encoders: [],
      aiDevices: [],
      workers: [],
    });
    const governor = createResourceGovernor({
      schemaManifest,
      unitOfWork: createSqliteUnitOfWork({ kernel }),
      profileProvider: { current: () => mapper },
      now: () => 180000,
      nextPermitId: () => 'permit-' + (++permitOrdinal),
    });

    const sharedMount = mergeResourceDemands([
      { resourceKey: 'volume_read:mount-a', units: 1 },
      { resourceKey: 'volume_read:mount-a', units: 1 },
    ]);
    assert.deepEqual(sharedMount, [{ resourceKey: 'volume_read:mount-a', units: 2 }]);
    const sharedPermit = governor.acquire(demand('same-mount-verify', sharedMount));
    assert.equal(sharedPermit.kind, 'permitted');
    governor.release(sharedPermit.permit);

    const separateMounts = mergeResourceDemands([
      { resourceKey: 'volume_read:mount-a', units: 1 },
      { resourceKey: 'volume_read:mount-b', units: 1 },
    ]);
    assert.deepEqual(separateMounts, [
      { resourceKey: 'volume_read:mount-a', units: 1 },
      { resourceKey: 'volume_read:mount-b', units: 1 },
    ]);
    const separatePermit = governor.acquire(demand('cross-mount-verify', separateMounts));
    assert.equal(separatePermit.kind, 'permitted');
    governor.release(separatePermit.permit);

    assert.throws(() => governor.acquire(demand('raw-duplicate', [
      { resourceKey: 'volume_read:mount-a', units: 1 },
      { resourceKey: 'volume_read:mount-a', units: 1 },
    ])), { code: 'P4_RESOURCE_DEMAND_INVALID' });
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('production composition scopes demand merging to Aftercare media verification', () => {
  const source = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/composition/create-procurement-execution-runtime.js'), 'utf8');
  assert.match(source,
    /if\(capability==='arca\.aftercare\.media\.verify@1'\)resources=mergeResourceDemands\(resources\)/);
  assert.doesNotMatch(source, /\n\s*resources=mergeResourceDemands\(resources\);/);
});
