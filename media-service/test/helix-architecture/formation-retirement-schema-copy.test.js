'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { schemas, prepareFormationRetirementSchemaCopy: copy } = require('../../scripts/helix-architecture/formation-retirement-schema-copy');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retirement-schema-'));
  const sourcePath = path.join(root, 'source.sqlite'), targetPath = path.join(root, 'prepared.sqlite');
  openSqliteKernel({ Database, databasePath: sourcePath, ...schemas().source }).close();
  const db = new Database(sourcePath);
  db.prepare("INSERT INTO libra_subjects(subject_id,status,structure_kind,content_profile,intake_revision,created_at_ms,updated_at_ms) VALUES ('subject','active','single','movie',1,1,1)").run();
  db.pragma('journal_mode=DELETE'); db.close();
  return { root, sourcePath, targetPath, close() { fs.rmSync(root, { recursive: true, force: true }); } };
}
test('exact schema copy preserves every table and original file, supports pre-use rollback and normal Kernel startup', () => {
  const f = fixture();
  try {
    const originalHash = hash(f.sourcePath), prepared = copy({ Database, ...f });
    assert.equal(prepared.copiedTableCount, 230); assert.equal(prepared.applied, false);
    assert.equal(hash(f.sourcePath), originalHash);
    assert.equal(prepared.tableProofs.find(row => row.tableId === 'libra_subjects').rowCount, 1);
    const upgraded=new Database(f.targetPath,{readonly:true});
    assert.equal(upgraded.prepare('SELECT count(*) n FROM arca_series_root_relocations').get().n,0);upgraded.close();
    openSqliteKernel({ Database, databasePath: f.targetPath, ...schemas().target }).close();
    const reverted = copy({ Database, sourcePath: f.targetPath, targetPath: path.join(f.root, 'rollback.sqlite'), rollback: true });
    assert.deepEqual(reverted.tableProofs, prepared.tableProofs);
    assert.throws(() => copy({ Database, ...f }), { code: 'RESET_SCHEMA_TARGET_UNSAFE' });
    assert.equal(hash(f.sourcePath), originalHash);
  } finally { f.close(); }
});

test('schema rollback refuses a frozen Series relocation even before it moves any file',()=>{
  const f=fixture();
  try {
    copy({Database,...f});const db=new Database(f.targetPath);
    db.prepare("INSERT INTO arca_shelves(shelf_id) VALUES ('shelf')").run();
    db.prepare("INSERT INTO arca_series_presentation_scopes(scope_id,shelf_id) VALUES ('scope','shelf')").run();
    db.prepare("INSERT INTO arca_series_root_relocations(relocation_id,scope_id,shelf_id,state,plan_schema_ref,plan_json,plan_digest,state_revision,created_at_ms) VALUES ('relocation','scope','shelf','active','fixture','{}',?,1,1)").run('a'.repeat(64));db.close();
    assert.throws(()=>copy({Database,sourcePath:f.targetPath,targetPath:path.join(f.root,'rejected.sqlite'),rollback:true}),{code:'RESET_SCHEMA_ROLLBACK_NEW_FACTS'});
    assert.equal(fs.existsSync(path.join(f.root,'rejected.sqlite')),false);
  }finally{f.close();}
});
test('schema rollback refuses both new Subject terminal facts and pending-Intake-only retirement receipts', () => {
  const f = fixture();
  try {
    copy({ Database, ...f });
    const db = new Database(f.targetPath);
    db.prepare("UPDATE libra_subjects SET status='ended'").run(); db.close();
    assert.throws(() => copy({ Database, sourcePath: f.targetPath, targetPath: path.join(f.root, 'rejected.sqlite'), rollback: true }),
      { code: 'RESET_SCHEMA_ROLLBACK_NEW_FACTS' });
    const pending = new Database(f.targetPath);
    pending.prepare("UPDATE libra_subjects SET status='active'").run();
    pending.prepare("INSERT INTO fx_command_receipts(command_receipt_id,owner_domain,command_contract,idempotency_key) VALUES ('receipt','libra','libra.intake-retirement@1','intake')").run(); pending.close();
    assert.throws(() => copy({ Database, sourcePath: f.targetPath, targetPath: path.join(f.root, 'rejected.sqlite'), rollback: true }),
      { code: 'RESET_SCHEMA_ROLLBACK_NEW_FACTS' });
    assert.equal(fs.existsSync(path.join(f.root, 'rejected.sqlite')), false);
  } finally { f.close(); }
});
