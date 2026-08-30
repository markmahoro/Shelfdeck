'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createFieldObservationRetentionStore, RETENTION_MS } = require(
  '../../src/helix/domains/procurement/persistence/field-observation-retention-store');
const { createFieldObservationRetention, estimateCapacity } = require(
  '../../src/helix/domains/procurement/application/field-observation-retention');

const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));

test('physical delete stays unavailable for every immutable table without the exact retention contract', () => {
  assert.throws(() => createRepositoryDefinition({
    repositoryId:'forbidden_delete', owner:'arca', schemaManifest,
    statements:{ remove:{ kind:'delete-one', tableId:'arca_acceptance_decisions', keyColumns:['acceptance_decision_id'] } },
  }), (error) => error.code === 'P3_REPOSITORY_IMMUTABLE_DELETE');
  assert.equal(schemaManifest.tables.filter((table) => table.deletion?.retentionGcAllowed === true).length, 1);
  assert.equal(schemaManifest.tables.find((table) => table.deletion?.retentionGcAllowed === true).tableId,
    'proc_field_observation_entries');
});

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-observation-retention-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now:() => 1_800_000_000_000 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  try { return run({ databasePath, kernel, unitOfWork }); }
  finally { kernel.close(); fs.rmSync(root, { recursive:true, force:true }); }
}

function seed(databasePath, nowMs) {
  const database = new Database(databasePath);
  database.pragma('foreign_keys=ON');
  database.prepare("INSERT INTO proc_material_fields(field_id,status) VALUES('field-1','active')").run();
  const insertWork = database.prepare(`INSERT INTO fx_supporting_works
    (work_id,owner_domain,process_type,process_id,work_kind,state) VALUES(?, 'procurement','material_field','field-1','field_observation',?)`);
  const insertObservation = database.prepare(`INSERT INTO proc_field_observations
    (field_id,revision,observation_id,field_observation_work_id,page_ordinal,observed_at_ms,completed)
    VALUES('field-1',?,?,?,?,?,?)`);
  const insertEntry = database.prepare(`INSERT INTO proc_field_observation_entries
    (field_id,field_observation_work_id,observation_id,observation_revision,page_ordinal,entry_ordinal,material_key,observed_at_ms)
    VALUES('field-1',?,?,?,0,0,?,?)`);
  const rows = [
    ['work-delete','succeeded','obs-delete',1,'material-delete',nowMs - RETENTION_MS - 1,1],
    ['work-open','running','obs-open',2,'material-open',nowMs - RETENTION_MS - 1,0],
    ['work-current','succeeded','obs-current',3,'material-current',nowMs - RETENTION_MS - 1,1],
    ['work-run','succeeded','obs-run',4,'material-run',nowMs - RETENTION_MS - 1,1],
    ['work-retry','succeeded','obs-retry',5,'material-retry',nowMs - RETENTION_MS - 1,1],
    ['work-material','succeeded','obs-material',6,'material-pointer',nowMs - RETENTION_MS - 1,1],
    ['work-cutoff','succeeded','obs-cutoff',7,'material-cutoff',nowMs - RETENTION_MS,1],
  ];
  for (const [workId,state,observationId,revision,materialKey,observedAtMs,completed] of rows) {
    insertWork.run(workId,state);
    insertObservation.run(revision,observationId,workId,0,observedAtMs,completed);
    insertEntry.run(workId,observationId,revision,materialKey,observedAtMs);
  }
  database.prepare("UPDATE proc_material_fields SET current_observation_revision=3 WHERE field_id='field-1'").run();
  database.prepare(`INSERT INTO proc_procurement_runs
    (procurement_run_id,field_id,terminal_observation_revision,field_observation_work_id,state)
    VALUES('run-1','field-1',4,'work-run','waiting')`).run();
  database.prepare(`INSERT INTO proc_procurement_retry_intents
    (retry_intent_id,field_id,retry_terminal_observation_revision,retry_field_observation_work_id,state)
    VALUES('retry-1','field-1',5,'work-retry','open')`).run();
  database.prepare(`INSERT INTO proc_field_materials(field_id,material_key,last_observation_id)
    VALUES('field-1','material-pointer','obs-material')`).run();
  database.close();
}

test('7-day purge is bounded, reference-safe, foreign-key-safe, and idempotent', () => fixture(({ databasePath, unitOfWork }) => {
  const nowMs = 1_800_000_000_000;
  seed(databasePath, nowMs);
  const store = createFieldObservationRetentionStore({ schemaManifest, unitOfWork });
  const first = store.purge({ cutoffMs:nowMs - RETENTION_MS, limit:1000 });
  assert.equal(first.deleted, 1);
  assert.deepEqual(first.protectedByReason, {
    non_terminal_work:1, current_field_work:1, procurement_run:1, open_retry_intent:1, current_material_pointer:1,
  });
  const second = store.purge({ cutoffMs:nowMs - RETENTION_MS, limit:1000 });
  assert.equal(second.deleted, 0);
  const database = new Database(databasePath, { readonly:true });
  assert.deepEqual(database.prepare('SELECT material_key FROM proc_field_observation_entries ORDER BY material_key').all()
    .map((row) => row.material_key), ['material-current','material-cutoff','material-open','material-pointer','material-retry','material-run']);
  assert.equal(database.prepare('SELECT count(*) count FROM proc_field_observations').get().count, 7);
  assert.equal(database.prepare('SELECT count(*) count FROM fx_supporting_works').get().count, 7);
  assert.deepEqual(database.pragma('foreign_key_check'), []);
  database.close();
}));

test('retention schedule uses exact cutoff, drains backlog promptly, and records reclamation', () => {
  let nowMs = 1_800_000_000_000; const purges = []; const reclaims = [];
  const retention = createFieldObservationRetention({ now:() => nowMs,
    store:{ purge(input) { purges.push(input); return { deleted:1000, backlogLikely:true }; } },
    storageMaintenance:{ reclaimFreePages(limit) { reclaims.push(limit); return { status:'reclaimed', freelistCountAfter:10 }; } },
  });
  assert.equal(retention.listPage({ cursor:null, limit:100 }).length, 1);
  const result = retention.reconcile();
  assert.equal(purges[0].cutoffMs, nowMs - RETENTION_MS);
  assert.equal(purges[0].limit, 1000);
  assert.deepEqual(reclaims, [1024]);
  assert.equal(result.nextDueAtMs, nowMs);
});

test('12-hour cadence capacity trend is deterministic for 7 days, 30 days, and one year', () => {
  const seven = estimateCapacity({ days:7 });
  const thirty = estimateCapacity({ days:30 });
  const year = estimateCapacity({ days:365 });
  assert.equal(seven.grossObservationCount, 14);
  assert.equal(thirty.grossObservationCount, 60);
  assert.equal(year.grossObservationCount, 730);
  assert.equal(seven.retainedObservationCount, 14);
  assert.equal(thirty.retainedBytes, seven.retainedBytes);
  assert.equal(year.retainedBytes, seven.retainedBytes);
  assert.equal(estimateCapacity({ days:365, protectedWorksOutsideWindow:3 }).retainedObservationCount, 17);
});
