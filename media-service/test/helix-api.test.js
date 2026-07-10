'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { buildApp } = require('../src/app');
const adultLibraryService = require('../src/adultLibraryService');

test('Helix Admin API projects Libra state and executes retain/detach/delete offboarding modes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-helix-api-'));
  const root = path.join(dir, 'adult');
  fs.mkdirSync(root, { recursive: true });
  const app = await buildApp({ logger: false, dataDir: dir, apiKey: '' });
  try {
    const createdLibrary = await app.inject({
      method: 'POST',
      url: '/v1/admin/sublibraries',
      payload: {
        name: 'Helix Adult', source: 'folder', mediaType: 'adult', adultRegion: 'japanese_jav',
        scraperType: 'shelfdeck_japanese_jav', watchRoot: root, ruleTemplateId: 'adult_jav_default',
      },
    });
    assert.strictEqual(createdLibrary.statusCode, 201);
    const subLib = createdLibrary.json();

    const adminHealth = await app.inject({ method: 'GET', url: '/v1/admin/health' });
    assert.strictEqual(adminHealth.statusCode, 200);
    assert.ok(adminHealth.json().checks.nexoraObservation);
    assert.ok(adminHealth.json().checks.libraReconciler);

    function createItem(name) {
      const filePath = path.join(root, `${name}.mp4`);
      fs.writeFileSync(filePath, name);
      const result = adultLibraryService.commitAdultFolderSourceReference(subLib, { path: filePath });
      return { item: result.item, filePath };
    }

    const retained = createItem('HELIX-RETAIN');
    const detail = await app.inject({ method: 'GET', url: `/v1/library/items/${retained.item.itemId}` });
    assert.strictEqual(detail.statusCode, 200);
    assert.strictEqual(detail.json().helix.membership.status, 'active');
    assert.strictEqual(detail.json().helix.phase, 'maintenance');
    assert.strictEqual(detail.json().helix.source.readiness, 'ready');

    const retainResult = await app.inject({
      method: 'POST',
      url: `/v1/admin/library/items/${retained.item.itemId}/actions/offboard`,
      payload: { idempotencyKey: 'retain-1', cleanupMode: 'retain_source' },
    });
    assert.strictEqual(retainResult.statusCode, 202);
    assert.strictEqual(retainResult.json().projection.membership.status, 'closed');
    assert.strictEqual(fs.existsSync(retained.filePath), true);

    const detached = createItem('HELIX-DETACH');
    const detachResult = await app.inject({
      method: 'POST',
      url: `/v1/admin/library/items/${detached.item.itemId}/actions/offboard`,
      payload: { idempotencyKey: 'detach-1', cleanupMode: 'detach_source' },
    });
    assert.strictEqual(detachResult.statusCode, 202);
    assert.strictEqual(detachResult.json().projection.source.readiness, 'detached');
    assert.strictEqual(fs.existsSync(detached.filePath), true);

    const deleted = createItem('HELIX-DELETE');
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/admin/library/items/${deleted.item.itemId}/actions/offboard`,
      payload: { idempotencyKey: 'delete-denied', cleanupMode: 'delete_source' },
    });
    assert.strictEqual(denied.statusCode, 409);
    assert.strictEqual(denied.json().error.code, 'LIBRA_DESTRUCTIVE_AUTHORIZATION_REQUIRED');
    assert.strictEqual(fs.existsSync(deleted.filePath), true);

    const deleteResult = await app.inject({
      method: 'POST',
      url: `/v1/admin/library/items/${deleted.item.itemId}/actions/offboard`,
      payload: { idempotencyKey: 'delete-1', cleanupMode: 'delete_source', destructiveAuthorization: true },
    });
    assert.strictEqual(deleteResult.statusCode, 202);
    assert.strictEqual(deleteResult.json().projection.source.readiness, 'destroyed');
    assert.strictEqual(fs.existsSync(deleted.filePath), false);

    const manualAfterClose = await app.inject({
      method: 'POST', url: '/v1/tasks', payload: { itemId: retained.item.itemId, targetGate: 'metadata' },
    });
    assert.strictEqual(manualAfterClose.statusCode, 409);
    assert.strictEqual(manualAfterClose.json().error.code, 'LIBRA_MAINTENANCE_NOT_ADMITTED');

    const legacyDelete = await app.inject({
      method: 'POST', url: '/v1/tasks', payload: { itemId: retained.item.itemId, targetGate: 'delete' },
    });
    assert.strictEqual(legacyDelete.statusCode, 410);
    assert.strictEqual(legacyDelete.json().error.code, 'HELIX_LEGACY_TARGET_REMOVED');

    const bulkOne = createItem('HELIX-SUBLIB-ONE');
    const bulkTwo = createItem('HELIX-SUBLIB-TWO');
    const unsafeRemove = await app.inject({ method: 'DELETE', url: `/v1/admin/sublibraries/${subLib.uuid}` });
    assert.strictEqual(unsafeRemove.statusCode, 409);
    assert.strictEqual(unsafeRemove.json().error.code, 'LIBRA_SUBLIBRARY_OFFBOARDING_REQUIRED');

    const destructiveBulk = await app.inject({
      method: 'POST',
      url: `/v1/admin/sublibraries/${subLib.uuid}/actions/offboard`,
      payload: { idempotencyKey: 'bulk-destructive', cleanupMode: 'delete_source' },
    });
    assert.strictEqual(destructiveBulk.statusCode, 409);
    assert.strictEqual(destructiveBulk.json().error.code, 'LIBRA_SUBLIBRARY_RETAIN_SOURCE_REQUIRED');

    const bulkOffboard = await app.inject({
      method: 'POST',
      url: `/v1/admin/sublibraries/${subLib.uuid}/actions/offboard`,
      payload: { idempotencyKey: 'bulk-retain-1', cleanupMode: 'retain_source', reason: 'helix_test' },
    });
    assert.strictEqual(bulkOffboard.statusCode, 202);
    assert.strictEqual(bulkOffboard.json().result.failed, 0);
    assert.strictEqual(fs.existsSync(bulkOne.filePath), true);
    assert.strictEqual(fs.existsSync(bulkTwo.filePath), true);

    const safeRemove = await app.inject({ method: 'DELETE', url: `/v1/admin/sublibraries/${subLib.uuid}` });
    assert.strictEqual(safeRemove.statusCode, 200);
    assert.strictEqual(fs.existsSync(bulkOne.filePath), true);
    assert.strictEqual(fs.existsSync(bulkTwo.filePath), true);
  } finally {
    await app.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
