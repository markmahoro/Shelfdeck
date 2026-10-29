'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const Database = require('better-sqlite3');
const { verifyRetainedControls } = require('../scripts/formation-reset-responsibilities');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'copy.db'), db = new Database(file);
  db.exec(`CREATE TABLE arca_shelf_entries(shelf_entry_id TEXT PRIMARY KEY);
    CREATE TABLE arca_series_presentation_scopes(scope_id TEXT PRIMARY KEY);
    CREATE TABLE fx_material_controls(material_key TEXT PRIMARY KEY,owner_domain TEXT,owner_scope_type TEXT,owner_scope_id TEXT,state TEXT);
    INSERT INTO arca_shelf_entries VALUES('committed'); INSERT INTO arca_series_presentation_scopes VALUES('shared');
    INSERT INTO fx_material_controls VALUES('owned','arca','shelf_entry','committed','controlled'),
      ('shared-file','arca','series_presentation','shared','controlled'),('old-input',NULL,NULL,NULL,'released');`);
  db.close();
  function verify() {
    const reader = new Database(file, { readonly: true });
    try { reader.exec('BEGIN'); return verifyRetainedControls(reader); }
    finally { if (reader.inTransaction) reader.exec('ROLLBACK'); reader.close(); }
  }
  function mutate(domain, type, id) {
    const writer = new Database(file);
    try { writer.prepare("UPDATE fx_material_controls SET owner_domain=?,owner_scope_type=?,owner_scope_id=?,state='controlled' WHERE material_key='old-input'").run(domain, type, id); }
    finally { writer.close(); }
  }
  return { file, verify, mutate };
}

test('collection and shared Control plus legal released history remain intact', t => {
  const f = fixture(t), before = fs.readFileSync(f.file), verified = f.verify();
  assert.equal(verified.released, 1); assert.equal(verified.shelfEntry, 1); assert.equal(verified.seriesPresentation, 1);
  assert.deepEqual(fs.readFileSync(f.file), before);
});

test('opaque scopes cannot conceal cleared Subject, queued procurement or uncommitted custody ownership', t => {
  const f = fixture(t);
  for (const [domain, type, id, code] of [
    ['libra', 'subject', 'cleared-subject', 'RESET_VERIFY_UNCOMMITTED_CONTROL_RETAINED'],
    ['procurement', 'field', 'old-source', 'RESET_VERIFY_UNCOMMITTED_CONTROL_RETAINED'],
    ['arca', 'on_deck_custody', 'accepted-only', 'RESET_VERIFY_CONTROL_OWNER_MISSING'],
    ['arca', 'shelf_entry', 'missing-collection', 'RESET_VERIFY_CONTROL_OWNER_MISSING'],
  ]) {
    f.mutate(domain, type, id);
    const db = new Database(f.file, { readonly: true });
    try { assert.deepEqual(db.pragma('foreign_key_check'), [], 'opaque references are invisible to SQL FK checks'); }
    finally { db.close(); }
    const before = fs.readFileSync(f.file);
    assert.throws(f.verify, { code });
    assert.deepEqual(fs.readFileSync(f.file), before, 'the verifier must not invent a release');
  }
});
