'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const Database = require('better-sqlite3');
const { canonicalDigest: D, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createSeriesPresentationStore } = require('../../src/helix/domains/arca/persistence/series-presentation-store');
const { describeFreshResetSeriesRetention } = require('../../src/helix/domains/arca/public');
const { seriesScopeId, buildSharedManifest } = require('../../src/helix/domains/arca/model/series-presentation');
const { buildMaintenanceBasis } = require('../../src/helix/contracts/series-maintenance-basis');
const { buildImageSource } = require('../../src/helix/contracts/series-image-source');
const { basis } = require('./helpers/series-basis');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-shared-')), databasePath = path.join(root, 'copy.db');
  const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
  const kernel = openSqliteKernel({ Database, databasePath, schemaManifest,
    schemaDdl: fs.readFileSync(path.join(__dirname, '../../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8') });
  const db = new Database(databasePath), unitOfWork = createSqliteUnitOfWork({ kernel });
  const store = createSeriesPresentationStore({ schemaManifest, unitOfWork, contractValidator: { validate() {} } });
  t.after(() => { db.close(); kernel.close(); fs.rmSync(root, { recursive: true, force: true }); });
  function insert(table, row) {
    const keys = Object.keys(row);
    db.prepare('INSERT INTO ' + table + '(' + keys.join(',') + ') VALUES(' + keys.map(k => '@' + k).join(',') + ')').run(row);
  }
  const shelfRoot = path.join(root, 'shelf'), rootLocation = path.join(shelfRoot, 'Show'), scopeId = seriesScopeId('shelf', '1399');
  insert('arca_shelves', { shelf_id: 'shelf', status: 'active', target_endpoint_id: 'endpoint', target_mount_scope_id: 'mount',
    target_mount_scope_revision: 1, target_root_location: shelfRoot, current_standard_revision: null, current_placement_revision: null });
  insert('arca_series_presentation_scopes', { scope_id: scopeId, shelf_id: 'shelf', provider: 'tmdb', provider_key: '1399',
    endpoint_id: 'endpoint', mount_scope_id: 'mount', shelf_root: shelfRoot, root_location: rootLocation, placement_revision: 1,
    current_version: 0, active_build_id: null, retirement_scope_id: null, state_revision: 1, state_digest: D('head'), created_at_ms: 1, updated_at_ms: 1 });
  const value = basis(), build = store.admitBuild({ scopeId, basis: value.value, existingMembers: [] });
  const members = ['nfo', 'poster', 'fanart'].map(kind => ({ artifactKind: kind, endpointId: 'endpoint',
    location: path.join(rootLocation, kind === 'nfo' ? 'tvshow.nfo' : kind + '.jpg'), byteDigest: D(kind), sizeBytes: 20,
    physicalIdentity: { materialKey: D('material-' + kind) }, width: kind === 'poster' ? 600 : 1600, height: 900,
    nfoProviderKey: kind === 'nfo' ? '1399' : null, sourceDigest: D('source') }));
  unitOfWork.execute([store.versionParticipant(build, buildSharedManifest(build, members), D('verification'))]);
  function describe(committedEntryIds = ['season-one']) {
    return describeFreshResetSeriesRetention({ scopes: db.prepare('SELECT * FROM arca_series_presentation_scopes').all(),
      builds: db.prepare('SELECT * FROM arca_series_presentation_builds').all(), committedEntryIds,
      retainedVersions: db.prepare('SELECT * FROM arca_series_presentation_versions').all() });
  }
  return { db, store, describe, scopeId, rootLocation, members, value };
}

test('mixed Series reset detaches the uncommitted builder and preserves the committed shared manifest', t => {
  const f = fixture(t);
  const before = canonicalJson(f.db.prepare('SELECT * FROM arca_series_presentation_versions').all());
  const build = f.store.admitBuild({ scopeId: f.scopeId, basis: basis(4).value, existingMembers: f.members });
  const description = f.describe();
  assert.equal(description.droppedHeads.length, 1); assert.equal(description.preservedBuilders.length, 0);
  assert.equal(description.metadataBases.length, 1);
  assert.equal(description.metadataBases[0].basis.metadataEvidenceId, f.value.observation.evidenceId);
  assert.notEqual(description.metadataBases[0].buildId, build.objectId, 'uncommitted incoming metadata is not retained');
  // Simulate only the new generation's copy result. The original backup is
  // never modified by the production Operator.
  f.db.prepare('DELETE FROM arca_series_presentation_builds WHERE build_id=?').run(build.objectId);
  const result = f.store.normalizeFreshResetHeads(description);
  assert.equal(result.normalized.length, 1);
  assert.equal(f.store.readScope(f.scopeId).active_build_id, null);
  assert.equal(f.store.manifest(f.scopeId, 1).value.members.length, 3);
  assert.equal(canonicalJson(f.db.prepare('SELECT * FROM arca_series_presentation_versions').all()), before);
  assert.deepEqual(f.db.pragma('foreign_key_check'), []);
});

test('collection maintenance is an exact retained builder, and losing it blocks Reset', t => {
  const f = fixture(t), original = f.value;
  const maintenance = buildMaintenanceBasis({ shelfEntryId: 'season-one', shelfId: 'shelf', inventoryRevision: 1,
    identityRevision: 1, identityDigest: D('identity'), inventoryDigest: D('inventory'), rootLocation: f.rootLocation },
  original.identity, buildImageSource(original.value.sourceObservation));
  const build = f.store.admitBuild({ scopeId: f.scopeId, basis: maintenance, existingMembers: f.members });
  const description = f.describe();
  assert.equal(description.preservedBuilders[0].buildId, build.objectId);
  assert.equal(description.droppedHeads.length, 0);
  assert.throws(() => f.describe([]), { code: 'ARCA_RESET_MAINTENANCE_COLLECTION_MISSING' });
  assert.equal(f.store.normalizeFreshResetHeads(description).normalized.length, 0);
  f.db.prepare('DELETE FROM arca_series_presentation_builds WHERE build_id=?').run(build.objectId);
  assert.throws(() => f.store.normalizeFreshResetHeads(description), { code: 'ARCA_RESET_MAINTENANCE_LOST' });
});

test('a retained incoming build and changed head each block shared normalization', t => {
  const f = fixture(t), build = f.store.admitBuild({ scopeId: f.scopeId, basis: basis(4).value, existingMembers: f.members });
  const description = f.describe();
  assert.throws(() => f.store.normalizeFreshResetHeads(description), { code: 'ARCA_RESET_UNCOMMITTED_SERIES_RETAINED' });
  f.db.prepare('DELETE FROM arca_series_presentation_builds WHERE build_id=?').run(build.objectId);
  f.db.prepare('UPDATE arca_series_presentation_scopes SET state_digest=?').run(D('changed'));
  assert.throws(() => f.store.normalizeFreshResetHeads(description), { code: 'ARCA_RESET_SERIES_HEAD_CHANGED' });
});
