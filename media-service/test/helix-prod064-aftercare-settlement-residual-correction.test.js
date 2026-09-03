'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { CONFIRMATION, inspectPlan, applyCorrection } = require('../scripts/helix-prod064-aftercare-settlement-residual-correction');

const schemaDdl=fs.readFileSync(path.join(__dirname,'../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');
const digest=(bytes)=>crypto.createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'prod064-settlement-residual-')),
    mediaRoot=path.join(root,'media'),backupRoot=path.join(root,'backups','incident'),currentNfo='Film/Movie (2018)/Movie (2018).nfo',
    currentPath=path.join(mediaRoot,currentNfo),entryId='entry',currentBytes=Buffer.from('<movie><title>movie</title></movie>'),
    residualValues=[['case-one',Buffer.from('first historical nfo')],['case-two',Buffer.from('second historical nfo')]],
    residuals=residualValues.map(([caseId,bytes])=>Object.freeze({caseId,sizeBytes:bytes.length,sha256:digest(bytes)}));
  fs.mkdirSync(path.dirname(currentPath),{recursive:true});fs.writeFileSync(currentPath,currentBytes);
  residualValues.forEach(([caseId,bytes])=>fs.writeFileSync(currentPath+'.superseded-'+caseId,bytes));
  const database=new Database(path.join(root,'shelfdeck.db'));database.exec(schemaDdl);database.pragma('foreign_keys = OFF');
  database.prepare('INSERT INTO arca_shelf_entries (shelf_entry_id,status,current_inventory_revision) VALUES (?,?,?)').run(entryId,'active',3);
  const stat=fs.statSync(currentPath,{bigint:true});
  database.prepare(`INSERT INTO arca_inventory_materials
    (shelf_entry_id,inventory_revision,ordinal,role,location,inode,digest_hex,size_bytes,active_guard)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(entryId,3,0,'metadata_sidecar','/media/'+currentNfo.replaceAll('\\','/'),String(stat.ino),digest(currentBytes),currentBytes.length,0);
  residuals.forEach((item,index)=>{
    database.prepare('INSERT INTO arca_aftercare_cases (aftercare_case_id,shelf_entry_id,state,terminal_reason_code,terminal_at_ms) VALUES (?,?,?,?,?)').run(item.caseId,entryId,'unresolved','settlement_or_commit_failed',100+index);
    database.prepare('INSERT INTO arca_aftercare_inventory_commits (inventory_commit_id,aftercare_case_id,shelf_entry_id,previous_inventory_revision,new_inventory_revision,committed_at_ms) VALUES (?,?,?,?,?,?)').run('commit-'+index,item.caseId,entryId,index+1,index+2,90+index);
  });
  const options={mediaRoot,backupRoot,allowedBackupParent:path.join(root,'backups'),entryId,currentNfo,residuals,confirm:CONFIRMATION};
  return {root,database,currentPath,backupRoot,residuals,options};
}
function dispose(value){value.database.close();fs.rmSync(value.root,{recursive:true,force:true});}

test('PROD-064 settlement residual correction backs up and removes only the two proven failed-Case NFOs',()=>{
  const value=fixture();try{
    const before=value.database.prepare('SELECT * FROM arca_shelf_entries').all();
    const plan=inspectPlan(value.database,value.options);assert.equal(plan.members.length,2);assert.ok(plan.members.every((item)=>item.sourceExists&&!item.backupExists));
    const result=applyCorrection(value.database,value.options);assert.equal(result.memberCount,2);
    assert.ok(value.residuals.every((item)=>!fs.existsSync(value.currentPath+'.superseded-'+item.caseId)));
    assert.ok(value.residuals.every((item)=>fs.existsSync(path.join(value.backupRoot,path.basename(value.currentPath)+'.superseded-'+item.caseId))));
    assert.ok(fs.existsSync(path.join(value.backupRoot,'manifest.json')));assert.deepEqual(value.database.prepare('SELECT * FROM arca_shelf_entries').all(),before);
    assert.equal(applyCorrection(value.database,value.options).manifestDigest,result.manifestDigest);
  }finally{dispose(value);}
});

test('PROD-064 settlement residual correction fails closed on an unknown superseded member',()=>{
  const value=fixture();try{fs.writeFileSync(value.currentPath+'.superseded-arca-care-unknown','unknown');assert.throws(()=>inspectPlan(value.database,value.options),/UNKNOWN_SUPERSEDED_MEMBER/);assert.ok(value.residuals.every((item)=>fs.existsSync(value.currentPath+'.superseded-'+item.caseId)));}
  finally{dispose(value);}
});

test('PROD-064 settlement residual correction fails closed on source identity drift and missing confirmation',()=>{
  const value=fixture();try{
    assert.throws(()=>applyCorrection(value.database,{...value.options,confirm:null}),/CONFIRMATION_REQUIRED/);
    fs.appendFileSync(value.currentPath+'.superseded-'+value.residuals[0].caseId,'drift');
    assert.throws(()=>inspectPlan(value.database,value.options),/SOURCE_IDENTITY_MISMATCH/);
    assert.ok(!fs.existsSync(value.backupRoot));
  }finally{dispose(value);}
});
