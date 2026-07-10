'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-owned-schema-'));
process.env.CONTROL_PLANE_DATA_DIR = dataDir;

const libraStore = require('../src/libraStore');
const nexoraStore = require('../src/nexoraStore');
const kairoxAdmissionStore = require('../src/kairoxAdmissionStore');
const kairoxStore = require('../src/kairoxStore');

test.after(() => {
  libraStore.resetForTests();
  nexoraStore.resetForTests();
  kairoxAdmissionStore.resetForTests();
  kairoxStore.resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('clean owned schemas do not create the mixed media_items or Nexora Membership tables', () => {
  libraStore.getLibraryItems();
  nexoraStore.getSourceState('schema-item');
  kairoxAdmissionStore.getAdmission('schema-item');
  kairoxStore.ensureMedia({ itemId: 'schema-item' });

  const libraryDb = new Database(path.join(dataDir, 'library.db'), { readonly: true });
  const taskDb = new Database(path.join(dataDir, 'tasks.db'), { readonly: true });
  const libraryTables = libraryDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  const taskTables = taskDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  libraryDb.close();
  taskDb.close();

  assert.strictEqual(libraryTables.includes('media_items'), false);
  assert.strictEqual(libraryTables.includes('nexora_memberships'), false);
  assert.ok(libraryTables.includes('libra_library_items'));
  assert.ok(libraryTables.includes('libra_library_work'));
  assert.ok(libraryTables.includes('nexora_source_bindings'));
  assert.ok(taskTables.includes('kairox_media'));
  assert.ok(taskTables.includes('kairox_basedata_facts'));
  assert.ok(taskTables.includes('kairox_metadata_facts'));
  assert.ok(taskTables.includes('kairox_optimize_facts'));
  assert.ok(taskTables.includes('kairox_admissions'));
});

test('Kairox fact rows are revisioned independently by fact group', () => {
  kairoxStore.publishBasedata({ itemId: 'fact-item', sourceRevision: 'source-1', facts: { codec: 'h264' } });
  kairoxStore.publishMetadata({ itemId: 'fact-item', facts: { title: 'Title' } });
  kairoxStore.upsertObjective({ itemId: 'fact-item', policyRevision: 'policy-1', objectiveRevision: 'objective-1', status: 'ready', objective: { targetCodec: 'h265' } });
  kairoxStore.publishOptimize({ itemId: 'fact-item', objectiveRevision: 'objective-1', facts: { passed: true } });
  kairoxStore.markBasedataStale({ itemId: 'fact-item', reason: 'post_optimize_activation' });

  const bundle = kairoxStore.getBundle('fact-item');
  assert.strictEqual(bundle.basedata.sourceRevision, 'source-1');
  assert.strictEqual(bundle.basedata.status, 'stale');
  assert.strictEqual(bundle.basedata.staleReason, 'post_optimize_activation');
  assert.strictEqual(bundle.metadata.status, 'fresh');
  assert.strictEqual(bundle.optimize.objectiveRevision, 'objective-1');
  assert.strictEqual(bundle.objective.policyRevision, 'policy-1');
});
