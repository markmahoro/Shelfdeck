'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createLibraReconciler } = require('../src/libraReconciler');

test('Libra consumes Kairox SourceMutationResult through Nexora rebind and new admission generation', () => {
  let item = { itemId: 'item-1', subLibraryId: 'library-1', membershipStatus: 'active', desiredState: 'managed', phase: 'maintenance', quarantineStatus: 'none', quarantineReason: '', admissionGeneration: 1, sourceRevision: 'source-1', mediaKind: 'adult_file', playable: true };
  const events = [];
  const calls = { suspended: [], rebound: [], acknowledged: [], admitted: [] };
  let source = { itemId: 'item-1', readiness: 'ready', sourceRevision: 'source-2', sourceAccessDescriptor: { subLibraryId: 'library-1' } };
  const store = {
    getLibraryItem: () => item,
    getLibraryItems: () => [item],
    upsertLibraryItem: (patch) => (item = { ...item, ...patch }),
    appendEvent: (event) => events.push(event),
  };
  const mutation = { mutationId: 'mutation-1', itemId: 'item-1', oldSourceEvidence: { path: '/media/a.mkv' }, newSourceEvidence: { path: '/media/scraped/a.mkv' } };
  const kairoxService = {
    getPendingSourceMutations: () => [mutation],
    acknowledgeSourceMutation: (id) => calls.acknowledged.push(id),
    suspendMaintenance: (command) => calls.suspended.push(command),
    getMaintenanceProjections: () => ({ 'item-1': { itemId: 'item-1', admissionCurrent: false, maintenanceRevision: 'm2' } }),
    reconcileMaintenance: (command) => { calls.admitted.push(command); return { maintenanceRevision: 'm3' }; },
  };
  const nexoraService = {
    rebindSourceMutation: (command) => { calls.rebound.push(command); return source; },
    getSourceProjections: () => ({ 'item-1': source }),
  };
  const reconciler = createLibraReconciler({ store, nexoraService, kairoxService, configStore: { loadConfig: () => ({ subLibraries: [{ uuid: 'library-1', maintenanceAutomationMode: 'auto' }] }) } });
  reconciler.reconcileBatch();
  assert.strictEqual(item.admissionGeneration, 2);
  assert.deepStrictEqual(calls.acknowledged, ['mutation-1']);
  assert.strictEqual(calls.rebound.length, 1);
  assert.strictEqual(calls.suspended[0].reason, 'source_mutation_rebind');
  assert.strictEqual(calls.admitted[0].sourceRevision, 'source-2');
  assert.strictEqual(item.quarantineStatus, 'none');
});
