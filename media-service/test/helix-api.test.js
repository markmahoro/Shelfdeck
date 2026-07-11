'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { buildApp } = require('../src/app');
const cleanState = require('../src/helixCleanState');

test('Helix Admin API projects Libra state and executes retain/detach/delete offboarding modes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-helix-api-'));
  const root = path.join(dir, 'adult');
  fs.mkdirSync(root, { recursive: true });
  cleanState.applyCleanInit({ dataDir: dir, confirmation: cleanState.APPLY_CONFIRMATION });
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
    assert.ok(adminHealth.json().checks.libraryAutomation);

    const rawConfig = await app.inject({ method: 'GET', url: '/v1/config' });
    assert.strictEqual(rawConfig.statusCode, 404);
    const resources = await app.inject({ method: 'GET', url: '/v1/admin/settings/resources' });
    assert.strictEqual(resources.statusCode, 200);
    assert.strictEqual(resources.json().ffmpegPath, undefined);
    assert.deepStrictEqual(Object.keys(resources.json().resourceLimits).sort(), ['embyApiPerServer', 'filesystemPerVolume', 'localFfmpeg', 'workerPerNode']);
    const maintenancePolicy = await app.inject({ method: 'GET', url: '/v1/admin/policies/maintenance' });
    assert.strictEqual(maintenancePolicy.statusCode, 200);

    const createdPerson = await app.inject({ method: 'POST', url: '/v1/admin/people', payload: { name: 'Contract Actor', preference: 1, contentKinds: ['general'] } });
    assert.strictEqual(createdPerson.statusCode, 201);
    assert.strictEqual(createdPerson.json().preference, 1);
    const personList = await app.inject({ method: 'GET', url: '/v1/admin/people?contentKind=general' });
    assert.strictEqual(personList.statusCode, 200);
    assert.strictEqual(personList.json().total, 1);
    const updatedPerson = await app.inject({ method: 'PATCH', url: `/v1/admin/people/${createdPerson.json().personId}`, payload: { preference: -2 } });
    assert.strictEqual(updatedPerson.statusCode, 200);
    assert.strictEqual(updatedPerson.json().preference, -2);
    assert.strictEqual(updatedPerson.json().preferenceRevision, 2);
    const removedPeopleRoute = await app.inject({ method: 'GET', url: '/v1/admin/adult/people' });
    assert.strictEqual(removedPeopleRoute.statusCode, 404);

    async function createItem(name) {
      const filePath = path.join(root, `${name}.mp4`);
      fs.writeFileSync(filePath, name);
      const subjectId = `item-${name.toLowerCase()}`;
      const response = await app.inject({
        method: 'POST',
        url: '/v1/admin/library/actions/onboard',
        payload: {
          subjectId,
          idempotencyKey: `onboard-${name}`,
          sourceReference: {
            source: 'adult_folder',
            subLib: { uuid: subLib.uuid, watchRoot: root },
            path: filePath,
          },
        },
      });
      assert.strictEqual(response.statusCode, 202);
      assert.strictEqual(response.json().projection.phase, 'maintenance');
      return { item: { subjectId }, filePath };
    }

    const retained = await createItem('HELIX-RETAIN');
    const detail = await app.inject({ method: 'GET', url: `/v1/library/subjects/${retained.item.subjectId}` });
    assert.strictEqual(detail.statusCode, 200);
    assert.strictEqual(detail.json().helix.membership.status, 'active');
    assert.strictEqual(detail.json().helix.phase, 'maintenance');
    assert.strictEqual(detail.json().helix.source.readiness, 'ready');

    const candidates = await app.inject({ method: 'GET', url: '/v1/admin/cleanup-recommendations' });
    assert.strictEqual(candidates.statusCode, 200);
    assert.deepStrictEqual(candidates.json(), { candidates: [], total: 0 });
    const removedOffboardingRoute = await app.inject({ method: 'GET', url: '/v1/admin/offboarding-candidates' });
    assert.strictEqual(removedOffboardingRoute.statusCode, 404);
    const removedCandidateRoute = await app.inject({ method: 'GET', url: '/v1/admin/delete-candidates' });
    assert.strictEqual(removedCandidateRoute.statusCode, 404);

    const removedTaskCreation = await app.inject({
      method: 'POST', url: '/v1/tasks', payload: { subjectId: retained.item.subjectId, targetGate: 'basedata' },
    });
    assert.strictEqual(removedTaskCreation.statusCode, 404);
    const startedMaintenance = await app.inject({
      method: 'POST', url: `/v1/admin/library/subjects/${retained.item.subjectId}/actions/start-maintenance`,
      payload: { idempotencyKey: 'start-retained' },
    });
    assert.strictEqual(startedMaintenance.statusCode, 202);
    assert.strictEqual(startedMaintenance.json().result.run.initiatedBy, 'user');
    const prioritized = await app.inject({
      method: 'POST', url: `/v1/admin/library/subjects/${retained.item.subjectId}/actions/prioritize-maintenance`,
      payload: { idempotencyKey: 'prioritize-retained' },
    });
    assert.strictEqual(prioritized.statusCode, 202);
    assert.strictEqual(prioritized.json().result.media.maintenancePriorityClass, 'expedited');
    const cancelledPriority = await app.inject({
      method: 'POST', url: `/v1/admin/library/subjects/${retained.item.subjectId}/actions/cancel-maintenance-priority`,
      payload: { idempotencyKey: 'cancel-priority-retained' },
    });
    assert.strictEqual(cancelledPriority.statusCode, 202);

    const retainResult = await app.inject({
      method: 'POST',
      url: `/v1/admin/library/subjects/${retained.item.subjectId}/actions/offboard`,
      payload: { idempotencyKey: 'retain-1', cleanupMode: 'retain_source' },
    });
    assert.strictEqual(retainResult.statusCode, 202);
    assert.strictEqual(retainResult.json().projection.membership.status, 'closed');
    assert.strictEqual(fs.existsSync(retained.filePath), true);

    const detached = await createItem('HELIX-DETACH');
    const detachResult = await app.inject({
      method: 'POST',
      url: `/v1/admin/library/subjects/${detached.item.subjectId}/actions/offboard`,
      payload: { idempotencyKey: 'detach-1', cleanupMode: 'detach_source' },
    });
    assert.strictEqual(detachResult.statusCode, 202);
    assert.strictEqual(detachResult.json().projection.source.readiness, 'detached');
    assert.strictEqual(fs.existsSync(detached.filePath), true);

    const deleted = await createItem('HELIX-DELETE');
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/admin/library/subjects/${deleted.item.subjectId}/actions/offboard`,
      payload: { idempotencyKey: 'delete-denied', cleanupMode: 'delete_source' },
    });
    assert.strictEqual(denied.statusCode, 409);
    assert.strictEqual(denied.json().error.code, 'LIBRA_DESTRUCTIVE_AUTHORIZATION_REQUIRED');
    assert.strictEqual(fs.existsSync(deleted.filePath), true);

    const deleteResult = await app.inject({
      method: 'POST',
      url: `/v1/admin/library/subjects/${deleted.item.subjectId}/actions/offboard`,
      payload: { idempotencyKey: 'delete-1', cleanupMode: 'delete_source', destructiveAuthorization: true },
    });
    assert.strictEqual(deleteResult.statusCode, 202);
    assert.strictEqual(deleteResult.json().projection.source.readiness, 'destroyed');
    assert.strictEqual(fs.existsSync(deleted.filePath), false);

    const manualAfterClose = await app.inject({
      method: 'POST', url: `/v1/admin/library/subjects/${retained.item.subjectId}/actions/start-maintenance`, payload: { idempotencyKey: 'start-closed' },
    });
    assert.strictEqual(manualAfterClose.statusCode, 409);
    assert.strictEqual(manualAfterClose.json().error.code, 'LIBRA_MAINTENANCE_NOT_ADMITTED');

    const legacyDelete = await app.inject({
      method: 'POST', url: '/v1/tasks', payload: { subjectId: retained.item.subjectId, targetGate: 'delete' },
    });
    assert.strictEqual(legacyDelete.statusCode, 404);

    const bulkOne = await createItem('HELIX-SUBLIB-ONE');
    const bulkTwo = await createItem('HELIX-SUBLIB-TWO');
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
