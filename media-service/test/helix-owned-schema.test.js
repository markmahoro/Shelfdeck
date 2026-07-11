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
const gateInvalidationService = require('../src/gateInvalidationService');
const scrapeFlowExecutor = require('../src/metadataProviderAdapter');
const adultSourceIdentity = require('../src/adultSourceIdentity');
const workflowStore = require('../src/workflowStore');

test.after(() => {
  libraStore.resetForTests();
  nexoraStore.resetForTests();
  kairoxAdmissionStore.resetForTests();
  kairoxStore.resetForTests();
  workflowStore.resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('clean owned schemas do not create the mixed media_items or Nexora Membership tables', () => {
  libraStore.getLibraryItems();
  nexoraStore.getSourceState('schema-item');
  kairoxAdmissionStore.getAdmission('schema-item');
  kairoxStore.ensureMedia({ itemId: 'schema-item' });
  workflowStore.listEvents('schema-task');

  const libraryDb = new Database(path.join(dataDir, 'library.db'), { readonly: true });
  const taskDb = new Database(path.join(dataDir, 'tasks.db'), { readonly: true });
  const libraryTables = libraryDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  const taskTables = taskDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  const taskColumns = taskDb.prepare('PRAGMA table_info(tasks)').all().map((row) => row.name);
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
  assert.ok(taskTables.includes('workflow_plans'));
  assert.ok(taskTables.includes('workflow_events'));
  for (const legacyColumn of ['resume_point', 'manual_execute_requested', 'bridge_kind', 'flow_kind', 'flow_executor', 'flow_steps_json']) {
    assert.strictEqual(taskColumns.includes(legacyColumn), false, `legacy Task column must be absent: ${legacyColumn}`);
  }
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

test('Kairox gate invalidation is durable and canonical publication completes its refresh request', () => {
  kairoxStore.publishBasedata({ itemId: 'refresh-item', sourceRevision: 'source-1', facts: { codec: 'h264' } });
  const invalidation = gateInvalidationService.recordGateInvalidation({
    itemId: 'refresh-item',
    invalidatedGate: 'basedata',
    reason: 'post_optimize_replace',
    taskId: 'optimize-task',
  });
  assert.strictEqual(invalidation.stored, true);
  let bundle = kairoxStore.getBundle('refresh-item');
  assert.strictEqual(bundle.basedata.status, 'stale');
  assert.strictEqual(bundle.refreshRequests[0].status, 'pending');
  assert.strictEqual(bundle.refreshRequests[0].causedByTaskId, 'optimize-task');

  kairoxStore.publishBasedata({ itemId: 'refresh-item', sourceRevision: 'source-1', facts: { codec: 'h265' } });
  bundle = kairoxStore.getBundle('refresh-item');
  assert.strictEqual(bundle.basedata.status, 'fresh');
  assert.strictEqual(bundle.refreshRequests[0].status, 'completed');
});

test('Kairox metadata publication is idempotent by terminal task identity', () => {
  const input = {
    itemId: 'metadata-idempotent-item',
    facts: { title: 'Canonical Title', type: 'movie' },
    evidence: { taskId: 'metadata-task-once', adapter: 'emby' },
  };
  const first = kairoxStore.publishMetadata(input);
  const second = kairoxStore.publishMetadata(input);
  assert.strictEqual(first.factRevision, 1);
  assert.strictEqual(second.factRevision, 1);
  assert.strictEqual(kairoxStore.getBundle(input.itemId).metadata.facts.title, 'Canonical Title');
});

test('Metadata adapters separate descriptive facts from Basedata technical facts', () => {
  const facts = scrapeFlowExecutor.embyMetadataFacts({
    name: 'Example Movie',
    type: 'movie',
    providerIds: { Tmdb: '42' },
    tmdbId: '42',
    path: '/media/example.mkv',
    codec: 'h265',
    bitrate: 8000,
  });
  assert.strictEqual(facts.title, 'Example Movie');
  assert.strictEqual(facts.tmdbId, '42');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(facts, 'path'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(facts, 'codec'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(facts, 'bitrate'), false);
  assert.strictEqual(adultSourceIdentity.extractAdultId('folder/ABP-123/movie.mp4'), 'ABP-123');
  assert.strictEqual(adultSourceIdentity.extractAdultId('movie-part-01.mkv'), '');
});
