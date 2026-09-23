'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createShelfQueryStore } = require('../src/helix/domains/arca/persistence/shelf-query-store');
const { assertAcceptedTargetScope } = require('../src/helix/domains/arca/persistence/on-deck-store');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const generated = path.resolve(__dirname, '../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');

test('accepted Shelf Basis reads immutable revisions after a head change and fails closed on missing history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-ondesk-shelf-basis-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now:()=>100 });
  const database = new Database(databasePath);
  database.pragma('foreign_keys = OFF');
  try {
    database.prepare(`INSERT INTO arca_shelves(shelf_id,name,target_endpoint_id,target_root_location,
      target_mount_scope_id,target_mount_scope_revision,status,current_standard_revision,
      current_placement_revision,routing_projection_revision,routing_projection_digest,created_at_ms,updated_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('shelf-1','Movie','endpoint-1',path.join(root,'Shelf'),
      'mount-1',1,'active',2,3,2,canonicalDigest('routing'),1,2);
    const standard = database.prepare(`INSERT INTO arca_shelf_standard_revisions(shelf_id,revision,
      rule_template_id,rule_template_revision,standard_schema_ref,standard_json,standard_digest,effective_at_ms)
      VALUES(?,?,?,?,?,?,?,?)`);
    for (const revision of [1,2]) standard.run('shelf-1',revision,'template-1',revision,
      'helix://contracts/types/ShelfStandard/v1',JSON.stringify({revision}),canonicalDigest({revision}),revision);
    const placement = database.prepare(`INSERT INTO arca_placement_policy_revisions(shelf_id,revision,
      policy_schema_ref,policy_json,policy_digest,effective_at_ms) VALUES(?,?,?,?,?,?)`);
    for (const revision of [1,2,3]) placement.run('shelf-1',revision,
      'helix://contracts/types/PlacementPolicy/v1',JSON.stringify({revision}),canonicalDigest({revision}),revision);
    const store = createShelfQueryStore({ schemaManifest, unitOfWork:createSqliteUnitOfWork({ kernel }) });
    const current = store.getShelf('shelf-1');
    const accepted = store.getShelfAtBasis('shelf-1', { standardRevision:1, placementRevision:2 });
    assert.equal(current.currentStandardRevision, 2);
    assert.equal(accepted.currentStandardRevision, 1);
    assert.equal(accepted.standard.digest, canonicalDigest({revision:1}));
    assert.equal(accepted.placement.revision, 2);
    assert.deepEqual(accepted.target, current.target);
    assert.throws(()=>store.getShelfAtBasis('shelf-1', { standardRevision:3, placementRevision:2 }),
      /ahead of the current Shelf/);
    database.prepare('DELETE FROM arca_shelf_standard_revisions WHERE shelf_id=? AND revision=?')
      .run('shelf-1',1);
    assert.throws(()=>store.getShelfAtBasis('shelf-1', { standardRevision:1, placementRevision:2 }),
      /revisions do not resolve/);
  } finally {
    database.close();
    kernel.close();
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('a frozen Basis does not weaken the current Shelf Target containment fence', () => {
  const root = path.resolve(os.tmpdir(), 'accepted-shelf-target');
  assert.doesNotThrow(()=>assertAcceptedTargetScope({ target:{ rootLocation:root } },
    path.join(root, 'Movie')));
  assert.throws(()=>assertAcceptedTargetScope({ target:{ rootLocation:path.join(root, 'moved') } },
    path.join(root, 'Movie')), (error)=>error.code === 'P14_ONDECK_TARGET_SCOPE_CHANGED');
});
