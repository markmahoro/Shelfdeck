'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Database = require('better-sqlite3');
const { createRetainedDatabase } = require('../scripts/formation-reset-copy');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-copy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sourcePath = path.join(dir, 'source.db'), targetPath = path.join(dir, 'new.db');
  const db = new Database(sourcePath);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE subject(id TEXT PRIMARY KEY);
    CREATE TABLE run(id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subject(id), value TEXT);
    CREATE TABLE collection(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES run(id));
    CREATE TABLE inventory(id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collection(id), content TEXT);
    CREATE TABLE queue(id TEXT PRIMARY KEY, run_id TEXT REFERENCES run(id));
    INSERT INTO subject VALUES('shared-series'),('orphan');
    INSERT INTO run VALUES('committed','shared-series','proof'),('unfinished','shared-series','pending'),('old','orphan','history');
    INSERT INTO collection VALUES('season-one','committed');
    INSERT INTO inventory VALUES('episode-one','season-one','original file relation');
    INSERT INTO queue VALUES('unaccepted','unfinished');`);
  db.close();
  const policy = { tables: { subject: { owner: 'libra', disposition: 'dependent' }, run: { owner: 'libra', disposition: 'dependent' },
    collection: { owner: 'arca', disposition: 'root' }, inventory: { owner: 'arca', disposition: 'dependent' },
    queue: { owner: 'procurement', disposition: 'clear' } }, edges: [
    { owner: 'arca', parent: 'collection', child: 'inventory', columns: [{ parent: 'id', child: 'collection_id' }] }] };
  return { Database, sourcePath, targetPath, policy };
}
test('copy preserves collection dependencies without retaining other Runs of the same Subject', t => {
  const f = fixture(t), receipt = createRetainedDatabase(f), db = new Database(f.targetPath, { readonly: true });
  try {
    assert.deepEqual(db.prepare('SELECT id FROM run').all(), [{ id: 'committed' }]);
    assert.deepEqual(db.prepare('SELECT id FROM subject').all(), [{ id: 'shared-series' }]);
    assert.equal(db.prepare('SELECT count(*) n FROM queue').get().n, 0);
    assert.equal(db.prepare('SELECT content FROM inventory').get().content, 'original file relation');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(receipt.tables.find(x => x.table === 'run').removed, 2);
  } finally { db.close(); }
  const original = new Database(f.sourcePath, { readonly: true });
  try { assert.equal(original.prepare('SELECT count(*) n FROM run').get().n, 3); } finally { original.close(); }
});
test('a protected dependency cannot be silently dropped by a clear policy', t => {
  const f = fixture(t); f.policy.tables.run.disposition = 'clear';
  assert.throws(() => createRetainedDatabase(f), { code: 'RESET_COPY_PROTECTED_DEPENDENCY_CONFLICT' });
  const incomplete = new Database(f.targetPath, { readonly: true });
  try { assert.equal(incomplete.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n, 0); }
  finally { incomplete.close(); }
});
test('schema changes require explicit owner policy coverage', t => {
  const f = fixture(t); delete f.policy.tables.queue;
  assert.throws(() => createRetainedDatabase(f), { code: 'RESET_COPY_POLICY_INCOMPLETE' });
});

test('Owner projection detaches a scan head without keeping unrelated history or altering retained evidence', t => {
  const f = fixture(t), source = new Database(f.sourcePath);
  source.exec("CREATE TABLE field(id TEXT PRIMARY KEY, current_run TEXT REFERENCES run(id)); INSERT INTO field VALUES('source','unfinished')");
  source.close();
  f.policy.tables.field = { owner: 'procurement', disposition: 'root', resetColumns: { current_run: null } };
  const receipt = createRetainedDatabase(f), target = new Database(f.targetPath, { readonly: true });
  try {
    assert.equal(target.prepare('SELECT current_run FROM field').get().current_run, null);
    assert.deepEqual(target.prepare('SELECT id FROM run').all(), [{ id: 'committed' }]);
    assert.deepEqual(receipt.tables.find(t => t.table === 'field').resetColumns, { current_run: null });
  } finally { target.close(); }
  f.policy.tables.field.resetColumns = { id: null };
  assert.throws(() => createRetainedDatabase({ ...f, targetPath: f.targetPath + '.invalid' }), { code: 'RESET_COPY_PROJECTION_INVALID' });
});

test('Owner maintenance seeds preserve exact processes and reject missing or foreign keys', t => {
  const f = fixture(t);
  f.policy.seeds = [{ owner: 'libra', table: 'run', key: { id: 'old' } }];
  createRetainedDatabase(f);
  const target = new Database(f.targetPath, { readonly: true });
  try { assert.deepEqual(target.prepare('SELECT id FROM run ORDER BY id').all(), [{ id: 'committed' }, { id: 'old' }]); }
  finally { target.close(); }
  const output = name => path.join(path.dirname(f.targetPath), name + '.db');
  f.policy.seeds[0].key.id = 'missing';
  assert.throws(() => createRetainedDatabase({ ...f, targetPath: output('missing-seed') }), { code: 'RESET_COPY_OWNER_SEED_MISSING' });
  f.policy.seeds[0] = { owner: 'arca', table: 'run', key: { id: 'old' } };
  assert.throws(() => createRetainedDatabase({ ...f, targetPath: output('wrong-owner') }), { code: 'RESET_COPY_SEED_INVALID' });
});

test('Owner-declared cross-domain provenance without an SQL FK must be retained', t => {
  const f = fixture(t), source = new Database(f.sourcePath);
  source.exec("CREATE TABLE origin_package(id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, proof TEXT); INSERT INTO origin_package VALUES('package-one','season-one','frozen provenance')");
  source.close();
  f.policy.tables.origin_package = { owner: 'libra', disposition: 'dependent' };
  f.policy.edges.push({ owner: 'libra', parent: 'collection', child: 'origin_package', required: true,
    columns: [{ parent: 'id', child: 'collection_id' }] });
  createRetainedDatabase(f);
  const target = new Database(f.targetPath, { readonly: true });
  try { assert.equal(target.prepare('SELECT proof FROM origin_package').get().proof, 'frozen provenance'); }
  finally { target.close(); }
  const missing = new Database(f.sourcePath); missing.exec('DELETE FROM origin_package'); missing.close();
  assert.throws(() => createRetainedDatabase({ ...f, targetPath: path.join(path.dirname(f.targetPath), 'missing.db') }),
    { code: 'RESET_COPY_OWNER_REFERENCE_MISSING' });
});
test('SQLite integers are preserved exactly beyond JavaScript safe integer range', t => {
  const f = fixture(t), source = new Database(f.sourcePath);
  source.exec('CREATE TABLE exact_integer(id INTEGER PRIMARY KEY, value INTEGER NOT NULL)');
  source.prepare('INSERT INTO exact_integer VALUES(?,?)').run(9007199254740993n, 9223372036854775806n);
  source.close();
  f.policy.tables.exact_integer = { owner: 'configuration', disposition: 'root' };
  createRetainedDatabase(f);
  const target = new Database(f.targetPath, { readonly: true });
  try { assert.deepEqual(target.prepare('SELECT * FROM exact_integer').safeIntegers().get(),
    { id: 9007199254740993n, value: 9223372036854775806n }); } finally { target.close(); }
});
test('copy will never overwrite an existing database or the source', t => {
  const f = fixture(t);
  assert.throws(() => createRetainedDatabase({ ...f, targetPath: f.sourcePath }), { code: 'RESET_COPY_TARGET_INVALID' });
  fs.writeFileSync(f.targetPath, 'existing');
  assert.throws(() => createRetainedDatabase(f), { code: 'RESET_COPY_TARGET_INVALID' });
  assert.equal(fs.readFileSync(f.targetPath, 'utf8'), 'existing');
});

test('unindexed Owner provenance is copied in bounded key pages without retaining unrelated audit rows', t => {
  const f = fixture(t), source = new Database(f.sourcePath);
  source.exec('CREATE TABLE audit(id TEXT PRIMARY KEY, owner TEXT, target TEXT, proof INTEGER)');
  const insert = source.prepare('INSERT INTO audit VALUES(?,?,?,?)');
  source.transaction(() => {
    for (let i = 0; i < 513; i++) {
      insert.run('keep-' + i, 'arca', 'season-one', i);
      insert.run('foreign-' + i, 'libra', 'season-one', i);
      insert.run('uncommitted-' + i, 'arca', 'uncommitted-season', i);
    }
  })();
  source.close();
  f.policy.tables.audit = { owner: 'audit', disposition: 'dependent' };
  f.policy.edges.push({ owner: 'audit', parent: 'collection', child: 'audit',
    columns: [{ parent: 'id', child: 'target' }], where: { owner: 'arca' } });
  const before = fs.readFileSync(f.sourcePath), receipt = createRetainedDatabase(f);
  assert.deepEqual(fs.readFileSync(f.sourcePath), before);
  assert.equal(receipt.tables.find(row => row.table === 'audit').retained, 513);
  const target = new Database(f.targetPath, { readonly: true });
  try {
    assert.equal(target.prepare('SELECT count(*) n FROM audit').get().n, 513);
    assert.equal(target.prepare("SELECT count(*) n FROM audit WHERE id NOT LIKE 'keep-%'").get().n, 0);
    assert.equal(target.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'reset_lookup_%'").get().n, 0);
  } finally { target.close(); }
});
