'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const test=require('node:test');
const Database=require('better-sqlite3');
const {SCHEMA,CONFIRMATION,inspectQuarantine,applyQuarantine}=require('../scripts/helix-stage-conflict-quarantine');
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-stage-quarantine-'));
  const mediaRoot=path.join(root,'media'),applicationRoot=path.join(root,'application');
  fs.mkdirSync(mediaRoot);fs.mkdirSync(applicationRoot);
  const database=new Database(path.join(root,'shelfdeck.db'));
  database.exec(fs.readFileSync(path.join(__dirname,'../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8'));
  database.prepare("INSERT INTO libra_product_packages(on_deck_package_id,state) VALUES('package','published')").run();
  database.prepare("INSERT INTO arca_ondeck_custodies(custody_id,on_deck_package_id,state) VALUES('custody','package','active')").run();
  database.prepare("INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state) VALUES('run','custody','blocked')").run();
  const members=[],targets=[];
  for(const [name,role] of [['Movie.nfo','metadata_sidecar'],['poster.jpg','poster']]) {
    const file=path.join(mediaRoot,name),bytes=Buffer.from('previous-'+name);
    fs.writeFileSync(file,bytes);
    targets.push({path:file,sizeBytes:bytes.length,sha256:sha256(bytes)});
    members.push({targetLocation:file,sourceMaterialKey:role,role});
    database.prepare('INSERT INTO libra_product_package_materials(on_deck_package_id,material_key,role,size_bytes) VALUES(?,?,?,?)').run('package',role,role,bytes.length+5);
  }
  database.prepare('INSERT INTO arca_final_inventory_decisions(on_deck_run_id,decision_json) VALUES(?,?)').run('run',JSON.stringify({members}));
  const manifest={schema:SCHEMA,onDeckRunId:'run',targets};
  t.after(()=>{database.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  return {database,manifest,mediaRoot,applicationRoot,offlineConfirmed:true,confirm:CONFIRMATION};
}

test('quarantine backs up the exact two conflicts, preserves other files and leaves SQLite unchanged',t=>{
  const f=fixture(t),video=path.join(f.mediaRoot,'Movie.mkv');fs.writeFileSync(video,'protected-video');
  const before=sha256(f.database.serialize());
  const plan=inspectQuarantine(f);
  assert.equal(fs.existsSync(plan.backupDirectory),false,'dry-run is read-only');
  const result=applyQuarantine(f);
  assert.equal(result.state,'completed');
  for(const item of result.targets) {
    assert.equal(fs.existsSync(item.path),false);
    assert.equal(fs.existsSync(item.parkedPath),false);
    assert.equal(sha256(fs.readFileSync(item.backupPath)),item.sha256);
  }
  assert.equal(fs.readFileSync(video,'utf8'),'protected-video');
  assert.equal(sha256(f.database.serialize()),before);
  assert.equal(JSON.parse(fs.readFileSync(result.journalPath)).state,'completed');
});

test('quarantine fails before changing any source when one hash drifts',t=>{
  const f=fixture(t);fs.writeFileSync(f.manifest.targets[1].path,'changed');
  assert.throws(()=>applyQuarantine(f),{code:'QUARANTINE_EXPECTED_IDENTITY_CHANGED'});
  assert.ok(fs.existsSync(f.manifest.targets[0].path));
  assert.equal(fs.readdirSync(f.applicationRoot).length,0);
});

test('quarantine restores all originals and preserves verified backups on a partial failure',t=>{
  const f=fixture(t);
  assert.throws(()=>applyQuarantine({...f,afterIsolatedFile(){throw new Error('injected');}}),/injected/);
  for(const item of f.manifest.targets) assert.equal(sha256(fs.readFileSync(item.path)),item.sha256);
  const directory=path.join(f.applicationRoot,'backups',fs.readdirSync(path.join(f.applicationRoot,'backups'))[0]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'))).state,'restored');
  assert.throws(()=>applyQuarantine(f),{code:'QUARANTINE_BACKUP_ALREADY_EXISTS_REVIEW_JOURNAL'});
});

for(const table of ['arca_inventory_materials','arca_material_bindings','libra_material_bindings','libra_offload_context_materials','libra_product_package_materials']) {
  test('quarantine protects referenced files in '+table,t=>{
    const f=fixture(t),file=f.manifest.targets[0].path;
    const guard=table==='arca_inventory_materials'?'active_guard':table.endsWith('bindings')?'current':null;
    if(table==='libra_offload_context_materials') {
      f.database.prepare('INSERT INTO libra_offload_context_materials(location,final_product_material_key) VALUES(?,?)').run(file,'final-primary');
    } else f.database.prepare(`INSERT INTO ${table}(location${guard?','+guard:''}) VALUES(?${guard?',1':''})`).run(file);
    assert.throws(()=>applyQuarantine(f),{code:'QUARANTINE_REFERENCED_FILE'});
    assert.ok(fs.existsSync(file));
  });
}

test('quarantine refuses active work, committed entries, unproven conflicts and missing offline confirmation',t=>{
  const f=fixture(t);
  assert.throws(()=>applyQuarantine({...f,offlineConfirmed:false}),{code:'QUARANTINE_OFFLINE_CONFIRMATION_REQUIRED'});
  f.database.prepare("INSERT INTO fx_supporting_works(work_id,owner_domain,process_id,state) VALUES('work','arca','run','running')").run();
  assert.throws(()=>applyQuarantine(f),{code:'QUARANTINE_ACTIVE_EXECUTION'});
  f.database.prepare("UPDATE fx_supporting_works SET state='failed'").run();
  f.database.prepare("INSERT INTO arca_ondeck_commit_receipts(on_deck_run_id) VALUES('run')").run();
  assert.throws(()=>applyQuarantine(f),{code:'QUARANTINE_RUN_NOT_BLOCKED'});
  f.database.prepare('DELETE FROM arca_ondeck_commit_receipts').run();
  f.database.prepare("UPDATE libra_product_package_materials SET size_bytes=? WHERE role='metadata_sidecar'").run(f.manifest.targets[0].sizeBytes);
  assert.throws(()=>applyQuarantine(f),{code:'QUARANTINE_CONFLICT_NOT_PROVEN'});
});

test('quarantine refuses paths outside the approved roots and a symlinked backup parent',t=>{
  const f=fixture(t);
  assert.throws(()=>inspectQuarantine({...f,manifest:{...f.manifest,targets:[{...f.manifest.targets[0],path:path.join(f.applicationRoot,'other.nfo')}]}}),{code:'QUARANTINE_PATH_OUTSIDE_ROOT'});
  fs.symlinkSync(f.mediaRoot,path.join(f.applicationRoot,'backups'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>applyQuarantine(f),{code:'QUARANTINE_SYMLINK_REFUSED'});
});
