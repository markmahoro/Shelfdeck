'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { materialKey } = require('../src/helix/foundation/persistence/material-control');
const { computeBoundedMaterialFingerprintSync } = require('../src/helix/integrations/bounded-material-fingerprint');
const { INCIDENT_ENTRIES, inspectPlan, applyCorrection, main } = require('../scripts/helix-prod064-aftercare-placement-incident-correction');

const schema=fs.readFileSync(path.resolve(__dirname,'../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');
const d=(value)=>canonicalDigest(value);
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'prod064-')),mediaRoot=path.join(root,'media'),journalDir=path.join(root,'journal'),database=new Database(path.join(root,'shelfdeck.db'));
  database.exec(schema);database.pragma('foreign_keys=OFF');fs.mkdirSync(mediaRoot,{recursive:true});
  database.prepare('INSERT INTO arca_placement_policy_revisions VALUES (?,?,?,?,?,?)').run('shelf-1',1,'placement',JSON.stringify({}),d('placement'),1);
  database.prepare('INSERT INTO arca_shelf_standard_revisions VALUES (?,?,?,?,?,?,?,?)').run('shelf-1',1,'rule-template',1,'standard',JSON.stringify({}),d('standard'),1);
  database.prepare('INSERT INTO arca_shelves VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('shelf-1','Shelf','endpoint-1',path.join(mediaRoot,'Film'),'mount-1',1,'active',1,1,1,d('routing'),1,1);
  for(let index=0;index<INCIDENT_ENTRIES.length;index+=1){
    const id=INCIDENT_ENTRIES[index],source=path.join(mediaRoot,'Film',`wrong-${index}`,'movie.bin'),destination=path.join(mediaRoot,'Film',`right-${index}`,'movie.bin');fs.mkdirSync(path.dirname(source),{recursive:true});fs.writeFileSync(source,Buffer.from(`material-${index}`));const observed=computeBoundedMaterialFingerprintSync(source),identity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,mountScopeId:'mount-1',inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint},key=materialKey(identity);
    database.prepare('INSERT INTO arca_shelf_entries VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,'shelf-1','single','active',1,`identity-${index}`,2,1,1,null);
    database.prepare('INSERT INTO arca_canonical_identity_revisions VALUES (?,?,?,?,?,?,?,?)').run(id,1,'single','movie','tmdb',String(index),d(['identity',index]),1);
    database.prepare('INSERT INTO arca_inventory_representations VALUES (?,?,?,?,?)').run(id,1,d(['representation',id,1]),`package-${id}`,1);
    database.prepare('INSERT INTO arca_inventory_representations VALUES (?,?,?,?,?)').run(id,2,d(['representation',id,2]),`package-${id}`,2);
    const insert=database.prepare('INSERT INTO arca_inventory_materials VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const values=(revision,location)=>[id,revision,0,key,'sidecar','claims',JSON.stringify({items:[]}),d('claims'),'endpoint-1',location,1,'mount-1',identity.inode,identity.fingerprintAlgorithm,String(identity.fingerprintVersion),identity.contentFingerprint,identity.contentFingerprint,identity.sizeBytes,0];insert.run(...values(1,destination));insert.run(...values(2,source));
    database.prepare('INSERT INTO arca_deck_fact_revisions VALUES (?,?,?,?,?,?,?)').run(id,1,'active',1,1,d(['deck',id]),1);
    database.prepare('INSERT INTO fx_material_controls VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(key,'mount-1',identity.inode,identity.sizeBytes,identity.fingerprintAlgorithm,String(identity.fingerprintVersion),identity.contentFingerprint,'arca','shelf_entry',id,1,'controlled',1);
    const work=`work-${index}`,attempt=`attempt-${index}`,plan=`plan-${index}`,event=`event-${index}`,eventAttempt=`event-attempt-${index}`;
    database.prepare('INSERT INTO fx_supporting_works VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(work,'arca','arca_shelf_entry',id,'care_repair_prepare',d(['basis',index]),'normal','definition',JSON.stringify({}),d({}), 'succeeded',`key-${index}`,1,100);
    database.prepare('INSERT INTO fx_work_attempts VALUES (?,?,?,?,?,?,?,?)').run(attempt,work,0,d(['basis',index]),'succeeded',1,100,null);
    database.prepare('INSERT INTO fx_workflow_plans VALUES (?,?,?,?,?,?,?,?,?)').run(plan,attempt,'planner',1,d('catalog'),d(['basis',index]),d(['graph',index]),'planned',1);
    database.prepare('INSERT INTO fx_workflow_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(event,plan,'placement',work,attempt,'arca','arca.inventory.placement.switch@1',1,'succeeded','normal',1,null,null,null);
    database.prepare('INSERT INTO fx_event_attempts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(eventAttempt,event,0,'executor',1,'snapshot',d('input'),d('fence'),'completed','succeeded',null,null,null,d('evidence'),1,100);
    database.prepare('INSERT INTO fx_effect_journal VALUES (?,?,?,?,?,?,?,?,?,?)').run(`effect-${index}`,eventAttempt,'filesystem_mutation',`effect-key-${index}`,d(['intent',index]),'committed',null,d(['output',index]),100,100);
  }
  database.pragma('foreign_keys=ON');
  return {root,mediaRoot,journalDir,database,options:{mediaRoot,quarantineRoot:path.join(mediaRoot,'.shelfdeck-incidents/prod064-aftercare-placement'),journalDir,incidentStartMs:50,expectedShelfEntryIds:[...INCIDENT_ENTRIES],restoreRevisions:new Map()}};
}

test('PROD-064 restores the exact 13-entry physical paths and appends Arca Inventory without changing Deck Facts',()=>{
  const value=fixture();try{const before=value.database.prepare('SELECT * FROM arca_deck_fact_revisions ORDER BY shelf_entry_id,revision').all(),plan=inspectPlan(value.database,value.options);assert.equal(plan.entries.length,13);assert.equal(plan.moveCount,13);assert.equal(plan.inventoryAdvanceCount,13);const result=applyCorrection(value.database,value.options);assert.equal(result.integrity,'ok');assert.equal(result.foreignKeyViolations,0);assert.equal(result.inventoryAdvanceCount,13);const converged=inspectPlan(value.database,value.options);assert.equal(converged.moveCount,0);assert.equal(converged.inventoryAdvanceCount,0);assert.deepEqual(value.database.prepare('SELECT * FROM arca_deck_fact_revisions ORDER BY shelf_entry_id,revision').all(),before);assert.equal(value.database.prepare('SELECT COUNT(*) AS count FROM arca_inventory_representations WHERE revision=3').get().count,13);}
  finally{value.database.close();fs.rmSync(value.root,{recursive:true,force:true});}
});

test('PROD-064 refuses any operator scope other than the frozen incident set',()=>{const value=fixture();try{assert.throws(()=>inspectPlan(value.database,{...value.options,expectedShelfEntryIds:INCIDENT_ENTRIES.slice(1)}),/PROD064_EXPECTED_ENTRY_SET_MISMATCH/);}finally{value.database.close();fs.rmSync(value.root,{recursive:true,force:true});}});

test('PROD-064 plan opens the stopped production copy through a read-only SQLite connection',()=>{const value=fixture();try{value.database.close();const args=['--data-dir',value.root,'--media-root',value.mediaRoot,'--quarantine-root',value.options.quarantineRoot,'--journal-dir',value.journalDir,'--incident-start-ms','50',...INCIDENT_ENTRIES.flatMap((id)=>['--expected-shelf-entry-id',id])],result=main(args);assert.equal(result.plan.moveCount,13);assert.equal(result.plan.inventoryAdvanceCount,13);}finally{try{value.database.close();}catch{}fs.rmSync(value.root,{recursive:true,force:true});}});
