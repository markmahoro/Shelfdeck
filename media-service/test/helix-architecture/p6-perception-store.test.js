'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createPerceptionStore } = require('../../src/helix/domains/perception/persistence/perception-store');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-perception-store-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let now = 1_700_010_000_000;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => now++ });
  const store = createPerceptionStore({ schemaManifest, unitOfWork: createSqliteUnitOfWork({ kernel }) });
  try { return run({ databasePath, store }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function register(store, id = 'source-1') {
  return store.registerSource({
    perceptionSourceId: id, sourceKind: 'douban', integrationId: 'integration-douban', status: 'active', configRevision: 1,
    initialCursor: { revision: 1, cursorValue: 'cursor-1', observationDigest: hash(id + ':cursor:1') }
  });
}

function record(id, sourceRecordKey = id, overrides = {}) {
  return {
    perceptionId: id, perceptionSourceId: 'source-1', sourceKind: 'douban', sourceRecordKey, sourceRecordRevision: 1,
    sourceRecordDigest: hash(id + ':source'), rating: 5, watchedState: 'watched', observedTitle: 'Example',
    provenanceDigest: hash(id + ':provenance'), observedAtMs: 1_700_000_000_000,
    anchors: [{ anchorKind: 'provider_id', anchorValue: 'tmdb:' + id, confidenceClass: 'strong', evidenceDigest: hash(id + ':anchor') }],
    ...overrides
  };
}

test('atomically bootstraps Source with cursor and advances explicit immutable cursor history', () => {
  fixture(({ databasePath, store }) => {
    assert.deepEqual(store.repositoryManifest.components, [
      {
        component: 'PerceptionRecordRepository', repositoryId: 'perception_record_repository',
        tableIds: ['perception_dedup_relations', 'perception_identity_anchors', 'perception_records', 'perception_source_cursors', 'perception_sources']
      },
      {
        component: 'PerceptionResolutionRepository', repositoryId: 'perception_resolution_repository',
        tableIds: ['perception_resolution_heads', 'perception_resolution_revisions']
      }
    ]);
    const source = register(store);
    assert.equal(source.currentCursorRevision, 1);
    assert.equal(store.getCurrentCursor('source-1').cursorValue, 'cursor-1');
    store.advanceSourceCursor({
      perceptionSourceId: 'source-1', revision: 2, cursorValue: 'cursor-2', observationDigest: hash('cursor-2')
    }, 1);
    assert.equal(store.getSource('source-1').currentCursorRevision, 2);
    assert.equal(store.getCurrentCursor('source-1').cursorValue, 'cursor-2');
    assert.throws(() => store.advanceSourceCursor({
      perceptionSourceId: 'source-1', revision: 3, cursorValue: 'stale', observationDigest: hash('stale')
    }, 1), (error) => error.code === 'P6_PERCEPTION_CURSOR_REVISION_CONFLICT');

    const inspected = new Database(databasePath, { readonly: true });
    const revisions = inspected.prepare('SELECT revision,cursor_value FROM perception_source_cursors ORDER BY revision').all();
    inspected.close();
    assert.deepEqual(revisions, [{ revision: 1, cursor_value: 'cursor-1' }, { revision: 2, cursor_value: 'cursor-2' }]);
  });
});

test('revises Source config by exact CAS without moving its cursor head', () => {
  fixture(({ store }) => {
    register(store);
    const revised = store.reviseSource({
      perceptionSourceId: 'source-1', sourceKind: 'douban', integrationId: 'integration-douban-2', status: 'disabled', configRevision: 2
    }, 1);
    assert.equal(revised.configRevision, 2);
    assert.equal(revised.status, 'disabled');
    assert.equal(revised.currentCursorRevision, 1);
    assert.throws(() => store.reviseSource({
      perceptionSourceId: 'source-1', sourceKind: 'douban', integrationId: 'x', status: 'active', configRevision: 3
    }, 1), (error) => error.code === 'P6_PERCEPTION_SOURCE_REVISION_CONFLICT');
  });
});

test('supports a user-input Source without Integration or cursor and initializes cursor only when synchronization begins', () => {
  fixture(({ store }) => {
    const source = store.registerSource({
      perceptionSourceId: 'source-user', sourceKind: 'user_input', integrationId: null,
      status: 'active', configRevision: 1, initialCursor: null
    });
    assert.equal(source.integrationId, null);
    assert.equal(source.currentCursorRevision, null);
    assert.equal(store.getCurrentCursor('source-user'), undefined);
    store.advanceSourceCursor({
      perceptionSourceId: 'source-user', revision: 1, cursorValue: 'local-sequence-1', observationDigest: hash('local-sequence-1')
    }, null);
    assert.equal(store.getSource('source-user').currentCursorRevision, 1);
    assert.equal(store.getCurrentCursor('source-user').revision, 1);
  });
});

test('appends immutable Records and bounded Identity Anchors under the Perception Owner only', () => {
  fixture(({ store }) => {
    register(store);
    const saved = store.appendRecord(record('perception-1'));
    assert.equal(Object.isFrozen(saved), true);
    assert.equal(Object.isFrozen(saved.anchors), true);
    assert.deepEqual(store.getRecord('perception-1'), saved);
    assert.deepEqual(store.findRecordsByAnchor('provider_id', 'tmdb:perception-1').map((item) => item.perceptionId), ['perception-1']);
    assert.equal(store.findRecordBySourceIdentity({
      perceptionSourceId: 'source-1', sourceRecordKey: 'perception-1', sourceRecordRevision: 1,
      sourceRecordDigest: hash('perception-1:source')
    }).perceptionId, 'perception-1');
  });
});

test('rejects invalid rating, duplicate anchors and duplicate source identity with atomic rollback', () => {
  fixture(({ databasePath, store }) => {
    register(store);
    assert.throws(() => store.appendRecord(record('bad-rating', 'bad-rating', { rating: 6 })),
      (error) => error.code === 'P6_PERCEPTION_RATING_INVALID');
    const anchor = { anchorKind: 'provider_id', anchorValue: 'same', confidenceClass: 'strong', evidenceDigest: hash('same') };
    assert.throws(() => store.appendRecord(record('bad-anchor', 'bad-anchor', { anchors: [anchor, anchor] })),
      (error) => error.code === 'P6_PERCEPTION_ANCHOR_DUPLICATE');
    store.appendRecord(record('perception-1', 'same-source'));
    assert.throws(() => store.appendRecord(record('perception-2', 'same-source', {
      sourceRecordDigest: hash('perception-1:source')
    })), (error) => error.code === 'SQLITE_CONSTRAINT_UNIQUE');
    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM perception_records').get().count, 1);
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM perception_identity_anchors').get().count, 1);
    inspected.close();
  });
});

test('normalizes relation pairs and enforces one immutable relation per pair', () => {
  fixture(({ store }) => {
    register(store);
    store.appendRecord(record('perception-a'));
    store.appendRecord(record('perception-b'));
    const relation = store.appendDedupRelation({
      relationId: 'relation-1', leftPerceptionId: 'perception-b', rightPerceptionId: 'perception-a', ruleRevision: 1,
      relation: 'duplicate', evidenceDigest: hash('relation-1')
    });
    assert.equal(relation.leftPerceptionId, 'perception-a');
    assert.equal(relation.rightPerceptionId, 'perception-b');
    assert.throws(() => store.appendDedupRelation({
      relationId: 'relation-2', leftPerceptionId: 'perception-a', rightPerceptionId: 'perception-b', ruleRevision: 2,
      relation: 'distinct', evidenceDigest: hash('relation-2')
    }), (error) => error.code === 'P6_PERCEPTION_RELATION_PAIR_CONFLICT');
  });
});

test('publishes found and not_found Resolution revisions through an exact current head without MAX lookup', () => {
  fixture(({ databasePath, store }) => {
    register(store);
    store.appendRecord(record('perception-1'));
    const queryDigest = hash('rating:tmdb:1');
    store.publishResolution({
      resolutionId: 'resolution-1', queryContract: 'perception.rating.resolve@1', queryInputDigest: queryDigest,
      revision: 1, resultKind: 'found', winningPerceptionId: 'perception-1', resultDigest: hash('resolution-1')
    }, null);
    assert.equal(store.getCurrentResolution('perception.rating.resolve@1', queryDigest).winningPerceptionId, 'perception-1');
    store.publishResolution({
      resolutionId: 'resolution-2', queryContract: 'perception.rating.resolve@1', queryInputDigest: queryDigest,
      revision: 2, resultKind: 'not_found', winningPerceptionId: null, resultDigest: hash('resolution-2')
    }, 1);
    const current = store.getCurrentResolution('perception.rating.resolve@1', queryDigest);
    assert.equal(current.resultKind, 'not_found');
    assert.equal(current.winningPerceptionId, null);
    assert.equal(current.revision, 2);
    assert.throws(() => store.publishResolution({
      resolutionId: 'resolution-3', queryContract: 'perception.rating.resolve@1', queryInputDigest: queryDigest,
      revision: 3, resultKind: 'not_found', winningPerceptionId: null, resultDigest: hash('resolution-3')
    }, 1), (error) => error.code === 'P6_PERCEPTION_RESOLUTION_REVISION_CONFLICT');

    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM perception_resolution_revisions').get().count, 2);
    assert.equal(inspected.prepare('SELECT current_revision FROM perception_resolution_heads').get().current_revision, 2);
    inspected.close();
  });
});

test('fails closed for missing Resolution winner and exposes no raw SQL or cross-Owner table reference', () => {
  fixture(({ databasePath, store }) => {
    register(store);
    assert.throws(() => store.publishResolution({
      resolutionId: 'resolution-1', queryContract: 'perception.rating.resolve@1', queryInputDigest: hash('missing'),
      revision: 1, resultKind: 'found', winningPerceptionId: 'missing', resultDigest: hash('missing-result')
    }, null), (error) => error.code === 'P6_PERCEPTION_RESOLUTION_WINNER_MISSING');
    const inspected = new Database(databasePath, { readonly: true });
    assert.equal(inspected.prepare('SELECT COUNT(*) count FROM perception_resolution_revisions').get().count, 0);
    inspected.close();
  });
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/domains/perception/persistence/perception-store.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:proc_|libra_|arca_|people_|platform_|fx_)\w*/);
  assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\s+/i);
  assert.doesNotMatch(source, /MAX\s*\(/i);
});
