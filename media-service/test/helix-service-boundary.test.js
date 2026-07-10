'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const srcRoot = path.join(__dirname, '..', 'src');

function source(file) {
  return fs.readFileSync(path.join(srcRoot, file), 'utf8');
}

test('Helix service facades expose the accepted in-process contracts', () => {
  const nexora = require('../src/nexoraService');
  const { createKairoxService } = require('../src/kairoxService');
  const { createLibraService } = require('../src/libraService');
  const kairox = createKairoxService({ implementation: {
    getMaintenanceProjection: (itemId) => ({ itemId }),
  } });
  const libra = createLibraService({ nexoraService: nexora, kairoxService: kairox });

  for (const name of ['ensureOnboarding', 'diagnoseSource', 'ensureOffboarding', 'getSourceProjection', 'getSourceProjections']) {
    assert.strictEqual(typeof nexora[name], 'function', `missing NexoraService.${name}`);
  }
  for (const name of ['reconcileMaintenance', 'suspendMaintenance', 'requestMaintenance', 'getMaintenanceProjection', 'getMaintenanceProjections']) {
    assert.strictEqual(typeof kairox[name], 'function', `missing KairoxService.${name}`);
  }
  for (const name of ['acceptSource', 'requestMaintenance', 'requestOffboarding', 'requestOffboardingBatch', 'reconcileItem', 'reconcileBatch', 'getLibraryProjection', 'getLibraryProjections']) {
    assert.strictEqual(typeof libra[name], 'function', `missing LibraService.${name}`);
  }
});

test('only the Libra composition root imports both Helix capability facades', () => {
  const offenders = fs.readdirSync(srcRoot)
    .filter((name) => name.endsWith('.js'))
    .filter((name) => {
      const text = source(name);
      return text.includes("require('./nexoraService')") && text.includes("require('./kairoxService')");
    });
  assert.deepStrictEqual(offenders, ['libraCompositionRoot.js']);
});

test('Nexora and Kairox service facades do not depend on each other', () => {
  assert.doesNotMatch(source('nexoraService.js'), /require\(['"]\.\/kairoxService['"]\)/);
  assert.doesNotMatch(source('kairoxService.js'), /require\(['"]\.\/nexoraService['"]\)/);
  assert.doesNotMatch(source('libraService.js'), /require\(['"]\.\/(nexoraService|kairoxService)['"]\)/);
});

test('Nexora runtime owns source writes and no longer writes legacy Membership', () => {
  assert.match(source('nexoraService.js'), /require\(['"]\.\/nexoraStore['"]\)/);
  assert.doesNotMatch(source('nexoraService.js'), /require\(['"]\.\/libraryStore['"]\)/);
  assert.doesNotMatch(source('nexoraService.js'), /upsertNexoraMembership/);
  assert.doesNotMatch(source('mediaLibraryService.js'), /recordEmbySourceObservation/);
  assert.doesNotMatch(source('adultLibraryService.js'), /recordAdultFolderSourceObservation/);
});

test('Libra composes live capability projections without persisting capability snapshots', () => {
  const runtime = source('libraRuntime.js');
  const reconciler = source('libraReconciler.js');
  assert.match(runtime, /nexoraService\.getSourceProjections\(ids\)/);
  assert.match(runtime, /kairoxService\.getMaintenanceProjections\(ids\)/);
  assert.doesNotMatch(runtime, /sourceProjection\s*:/);
  assert.doesNotMatch(runtime, /maintenanceProjection\s*:/);
  assert.doesNotMatch(reconciler, /sourceProjection\s*:/);
  assert.doesNotMatch(reconciler, /maintenanceProjection\s*:/);
});

test('public Helix path quarantines Kairox ingest/delete creation', () => {
  const appSource = source('app.js');
  assert.match(appSource, /HELIX_LEGACY_TARGET_REMOVED/);
  assert.match(appSource, /ingestCandidateProvider:\s*async \(\) => \[\]/);
  assert.doesNotMatch(
    appSource.slice(appSource.indexOf("app.post('/v1/admin/delete-candidates/:itemId/actions/confirm-delete'"), appSource.indexOf("app.get('/v1/tasks'")),
    /createTargetGateTask/,
  );
});
