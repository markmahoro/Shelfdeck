'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createFormationRetirementStore } = require('../../src/helix/domains/libra/persistence/formation-retirement-store');
const { createFormationRunHistoryStore } = require('../../src/helix/domains/libra/persistence/formation-run-history-store');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const {
  createOperatorMaintenance,
} = require('../../src/helix/platform/application/operator-maintenance');
const {
  ACTION_ID,
  createFormationRetirementHistoryIntegrityAction,
} = require('../../src/helix/platform/application/maintenance-actions/formation-retirement-history-integrity');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl = fs.readFileSync(
  path.join(__dirname, '../../src/helix/foundation/persistence/generated/clean-schema.sql'),
  'utf8',
);
const D = canonicalDigest({ fixture: 'operator-maintenance' });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-maintenance-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 5000 });
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  db.prepare(`INSERT INTO libra_subjects(subject_id,status,structure_kind,content_profile,intake_revision,
    current_continuity_set_digest,current_episode_scope_digest,created_at_ms,updated_at_ms)
    VALUES ('subject','active','single','movie',1,?,?,1,1)`).run(D, D);
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const store = createFormationRetirementStore({ schemaManifest, unitOfWork });
  let mode = 'stopped';
  const maintenance = createOperatorMaintenance({
    dataDir: root,
    databasePath,
    Database,
    now: () => 9000,
    runtimeMode: () => mode,
  });
  return {
    root, db, store, kernel, unitOfWork, maintenance,
    setMode(next) { mode = next; },
    close() {
      db.close();
      kernel.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function request(f, subjectId = 'subject') {
  return {
    retirementId: 'reset-1',
    subjectId,
    expectedSnapshotDigest: f.store.inspect(subjectId).snapshotDigest,
    backupDigest: D,
    manifestDigest: D,
    retiringRunIds: f.store.inspect(subjectId).runs
      .filter((row) => ['active', 'frozen', 'suspended'].includes(row.state))
      .map((row) => row.libra_run_id),
  };
}

function seedSecondSubject(f, subjectId) {
  f.db.prepare(`INSERT INTO libra_subjects(subject_id,status,structure_kind,content_profile,intake_revision,
    current_continuity_set_digest,current_episode_scope_digest,created_at_ms,updated_at_ms)
    VALUES (?,'active','single','movie',1,?,?,1,1)`).run(subjectId, D, D);
}

test('catalog lists registered maintenance actions without requiring stopped mode', () => {
  const f = fixture();
  try {
    f.setMode('running');
    const catalog = f.maintenance.list();
    assert.equal(catalog.schemaRef, 'platform.operator-maintenance-catalog@1');
    assert.equal(catalog.actions.length, 1);
    assert.equal(catalog.actions[0].actionId, ACTION_ID);
    assert.equal(catalog.actions[0].requiresStopped, true);
  } finally {
    f.close();
  }
});

test('preview and apply refuse when runtime is not stopped', () => {
  const f = fixture();
  try {
    f.store.commit(request(f));
    f.db.prepare('DELETE FROM fx_commit_markers').run();
    f.setMode('running');
    assert.throws(() => f.maintenance.preview(ACTION_ID), { code: 'OPERATOR_MAINTENANCE_REQUIRES_STOPPED' });
    assert.throws(
      () => f.maintenance.apply(ACTION_ID, {
        idempotencyKey: 'k1',
        previewDigest: 'a'.repeat(64),
        confirmed: true,
      }, { actorId: 'admin' }),
      { code: 'OPERATOR_MAINTENANCE_REQUIRES_STOPPED' },
    );
  } finally {
    f.close();
  }
});

test('rebuilds missing retirement markers from surviving receipts and restores ended history', () => {
  const f = fixture();
  try {
    f.store.commit(request(f));
    const receipt = f.db.prepare(`SELECT command_receipt_id, request_digest, committed_at_ms
      FROM fx_command_receipts WHERE command_contract='libra.formation-retirement@1'`).get();
    f.db.prepare('DELETE FROM fx_commit_markers').run();
    const history = createFormationRunHistoryStore({ schemaManifest, unitOfWork: f.unitOfWork });
    assert.throws(() => history.listDiscarded(0, 25), { code: 'FORMATION_RETIREMENT_HISTORY_INTEGRITY' });

    const preview = f.maintenance.preview(ACTION_ID);
    assert.equal(preview.ready, true);
    assert.equal(preview.summary.missingMarkerCount, 1);
    assert.equal(preview.rebuildMarkers[0].commandReceiptId, receipt.command_receipt_id);
    assert.equal(preview.rebuildMarkers[0].requestDigest, receipt.request_digest);

    assert.throws(
      () => f.maintenance.apply(ACTION_ID, {
        idempotencyKey: 'repair-1',
        previewDigest: preview.previewDigest,
        confirmed: false,
      }, { actorId: 'admin' }),
      { code: 'OPERATOR_MAINTENANCE_CONFIRMATION_REQUIRED' },
    );

    const applied = f.maintenance.apply(ACTION_ID, {
      idempotencyKey: 'repair-1',
      previewDigest: preview.previewDigest,
      confirmed: true,
    }, { actorId: 'admin' });
    assert.equal(applied.state, 'completed');
    assert.equal(applied.result.rebuiltMarkerCount, 1);

    const marker = f.db.prepare('SELECT * FROM fx_commit_markers WHERE commit_marker=?')
      .get(receipt.command_receipt_id);
    assert.equal(marker.owner_domain, 'libra');
    assert.equal(marker.scope_type, 'subject');
    assert.equal(marker.scope_id, 'subject');
    assert.equal(marker.commit_digest, receipt.request_digest);
    assert.equal(Number(marker.committed_at_ms), Number(receipt.committed_at_ms));

    const rows = history.listDiscarded(0, 25);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, 'administratively_retired');

    const replay = f.maintenance.apply(ACTION_ID, {
      idempotencyKey: 'repair-1',
      previewDigest: preview.previewDigest,
      confirmed: true,
    }, { actorId: 'admin' });
    assert.equal(replay.state, 'completed');
    assert.equal(replay.operationId, applied.operationId);
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_commit_markers').get().n, 1);
  } finally {
    f.close();
  }
});

test('clears orphan retirement receipts without inventing subjects', () => {
  const f = fixture();
  try {
    f.store.commit(request(f));
    const resultRef = {
      resultKind: 'administratively_retired',
      subjectId: 'gone-subject',
      retiredRunCount: 0,
      releasedControlCount: 0,
      releasedControlScopeDigest: D,
      beforeDigest: D,
      afterDigest: D,
      manifestDigest: D,
      backupDigest: D,
    };
    const orphanId = canonicalDigest({ orphan: 'retirement-receipt' });
    const requestDigest = canonicalDigest({ orphanRequest: true });
    f.db.prepare(`INSERT INTO fx_command_receipts
      (command_receipt_id, owner_domain, command_contract, caller_scope, idempotency_key,
       request_digest, target_type, target_id, result_schema_ref, result_ref_json, result_digest, committed_at_ms)
      VALUES (?, 'libra', 'libra.formation-retirement@1', 'administrative-formation-reset', ?,
              ?, 'subject', 'gone-subject', 'libra.formation-retirement-receipt@1', ?, ?, 42)`)
      .run(orphanId, 'orphan-key', requestDigest, JSON.stringify(resultRef), canonicalDigest(resultRef));
    f.db.prepare(`INSERT INTO fx_commit_markers
      (commit_marker, effect_id, owner_domain, scope_type, scope_id, commit_digest,
       result_id, result_schema_ref, result_digest, committed_at_ms)
      VALUES (?, NULL, 'libra', 'subject', 'gone-subject', ?, NULL, NULL, NULL, 42)`)
      .run(orphanId, requestDigest);

    const preview = f.maintenance.preview(ACTION_ID);
    assert.equal(preview.ready, true);
    assert.equal(preview.summary.orphanReceiptCount, 1);
    assert.equal(preview.orphanReceipts[0].commandReceiptId, orphanId);
    assert.equal(preview.orphanReceipts[0].hasMarker, true);
    assert.equal(preview.summary.missingMarkerCount, 0);

    const applied = f.maintenance.apply(ACTION_ID, {
      idempotencyKey: 'orphan-1',
      previewDigest: preview.previewDigest,
      confirmed: true,
    }, { actorId: 'admin' });
    assert.equal(applied.result.clearedOrphanReceiptCount, 1);
    assert.equal(
      f.db.prepare(`SELECT count(*) n FROM fx_command_receipts WHERE command_receipt_id=?`).get(orphanId).n,
      0,
    );
    assert.equal(
      f.db.prepare('SELECT count(*) n FROM fx_commit_markers WHERE commit_marker=?').get(orphanId).n,
      0,
    );
    // Retained Subject retirement evidence stays intact.
    assert.equal(
      f.db.prepare(`SELECT count(*) n FROM fx_command_receipts
        WHERE command_contract='libra.formation-retirement@1' AND target_id='subject'`).get().n,
      1,
    );
  } finally {
    f.close();
  }
});

test('refuses apply without confirmation and rejects stale preview digest', () => {
  const f = fixture();
  try {
    f.store.commit(request(f));
    f.db.prepare('DELETE FROM fx_commit_markers').run();
    const preview = f.maintenance.preview(ACTION_ID);
    seedSecondSubject(f, 'other');
    const otherStore = createFormationRetirementStore({
      schemaManifest,
      unitOfWork: f.unitOfWork,
    });
    otherStore.commit(request({ store: otherStore }, 'other'));
    f.db.prepare("DELETE FROM fx_commit_markers WHERE scope_id='other'").run();
    assert.throws(
      () => f.maintenance.apply(ACTION_ID, {
        idempotencyKey: 'stale-1',
        previewDigest: preview.previewDigest,
        confirmed: true,
      }, { actorId: 'admin' }),
      { code: 'OPERATOR_MAINTENANCE_PREVIEW_STALE' },
    );
  } finally {
    f.close();
  }
});

test('blocks corrupt multi-receipt subjects instead of inventing repairs', () => {
  const f = fixture();
  try {
    f.store.commit(request(f));
    const row = f.db.prepare('SELECT * FROM fx_command_receipts').get();
    f.db.prepare(`INSERT INTO fx_command_receipts
      (command_receipt_id, owner_domain, command_contract, caller_scope, idempotency_key,
       request_digest, target_type, target_id, result_schema_ref, result_ref_json, result_digest, committed_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'duplicate-receipt',
        row.owner_domain,
        row.command_contract,
        row.caller_scope,
        'duplicate-key',
        row.request_digest,
        row.target_type,
        row.target_id,
        row.result_schema_ref,
        row.result_ref_json,
        row.result_digest,
        row.committed_at_ms,
      );
    f.db.prepare('DELETE FROM fx_commit_markers').run();
    const preview = f.maintenance.preview(ACTION_ID);
    assert.equal(preview.ready, false);
    assert.ok(preview.blockers.some((item) => item.code === 'RETIREMENT_RECEIPT_NOT_UNIQUE'));
    assert.throws(
      () => f.maintenance.apply(ACTION_ID, {
        idempotencyKey: 'blocked-1',
        previewDigest: preview.previewDigest,
        confirmed: true,
      }, { actorId: 'admin' }),
      { code: 'OPERATOR_MAINTENANCE_BLOCKED' },
    );
  } finally {
    f.close();
  }
});

test('framework accepts additional registered actions without new one-off endpoints', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-maintenance-extra-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1 });
  try {
    const maintenance = createOperatorMaintenance({
      dataDir: root,
      databasePath,
      Database,
      runtimeMode: () => 'stopped',
      actions: [
        createFormationRetirementHistoryIntegrityAction(),
        Object.freeze({
          actionId: 'example-future-action',
          title: 'Example',
          summary: 'Extensibility probe',
          requiresStopped: true,
          preview() {
            return Object.freeze({
              schemaRef: 'platform.operator-maintenance.example@1',
              actionId: 'example-future-action',
              ready: true,
              blockers: Object.freeze([]),
              summary: Object.freeze({ count: 0 }),
              items: Object.freeze([]),
            });
          },
          apply() {
            return Object.freeze({ schemaRef: 'platform.operator-maintenance-result@1', actionId: 'example-future-action' });
          },
        }),
      ],
    });
    assert.deepEqual(maintenance.actionIds(), [
      'formation-retirement-history-integrity',
      'example-future-action',
    ]);
    const preview = maintenance.preview('example-future-action');
    assert.equal(preview.actionId, 'example-future-action');
    assert.match(preview.previewDigest, /^[0-9a-f]{64}$/);
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('history integrity query remains hard-fail until maintenance repairs markers', () => {
  const f = fixture();
  try {
    f.store.commit(request(f));
    f.db.prepare('DELETE FROM fx_commit_markers').run();
    const history = createFormationRunHistoryStore({ schemaManifest, unitOfWork: f.unitOfWork });
    assert.throws(() => history.listDiscarded(0, 25), { code: 'FORMATION_RETIREMENT_HISTORY_INTEGRITY' });
    const preview = f.maintenance.preview(ACTION_ID);
    f.maintenance.apply(ACTION_ID, {
      idempotencyKey: 'hard-fail-then-repair',
      previewDigest: preview.previewDigest,
      confirmed: true,
    }, { actorId: 'admin' });
    assert.equal(history.listDiscarded(0, 25).length, 1);
  } finally {
    f.close();
  }
});
