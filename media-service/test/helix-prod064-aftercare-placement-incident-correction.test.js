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
const { INCIDENT_ENTRIES, inspectPlan, applyCorrection, main,
  mapRestoreRows, resolveRestoreRevision,
  quarantineStageBasis, restoredLocation,
  stagedIncidentEvidence } = require('../scripts/helix-prod064-aftercare-placement-incident-correction');

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
  return {root,mediaRoot,journalDir,database,options:{mediaRoot,quarantineRoot:path.join(mediaRoot,'.shelfdeck-incidents/prod064-aftercare-placement'),journalDir,incidentStartMs:50,expectedShelfEntryIds:[...INCIDENT_ENTRIES],restoreRevisions:new Map(INCIDENT_ENTRIES.map((id)=>[id,1]))}};
}

test('PROD-064 restores the exact 13-entry physical paths and appends Arca Inventory without changing Deck Facts',()=>{
  const value=fixture();try{const before=value.database.prepare('SELECT * FROM arca_deck_fact_revisions ORDER BY shelf_entry_id,revision').all(),plan=inspectPlan(value.database,value.options);assert.equal(plan.entries.length,13);assert.equal(plan.moveCount,13);assert.equal(plan.inventoryAdvanceCount,13);const result=applyCorrection(value.database,value.options);assert.equal(result.integrity,'ok');assert.equal(result.foreignKeyViolations,0);assert.equal(result.inventoryAdvanceCount,13);const converged=inspectPlan(value.database,value.options);assert.equal(converged.moveCount,0);assert.equal(converged.inventoryAdvanceCount,0);assert.deepEqual(value.database.prepare('SELECT * FROM arca_deck_fact_revisions ORDER BY shelf_entry_id,revision').all(),before);assert.equal(value.database.prepare('SELECT COUNT(*) AS count FROM arca_inventory_representations WHERE revision=3').get().count,13);}
  finally{value.database.close();fs.rmSync(value.root,{recursive:true,force:true});}
});

test('PROD-064 refuses any operator scope other than the frozen incident set',()=>{const value=fixture();try{assert.throws(()=>inspectPlan(value.database,{...value.options,expectedShelfEntryIds:INCIDENT_ENTRIES.slice(1)}),/PROD064_EXPECTED_ENTRY_SET_MISMATCH/);}finally{value.database.close();fs.rmSync(value.root,{recursive:true,force:true});}});

test('PROD-064 plan opens the stopped production copy through a read-only SQLite connection',()=>{const value=fixture();try{value.database.close();const args=['--data-dir',value.root,'--media-root',value.mediaRoot,'--quarantine-root',value.options.quarantineRoot,'--journal-dir',value.journalDir,'--incident-start-ms','50',...INCIDENT_ENTRIES.flatMap((id)=>['--restore-inventory-revision',`${id}=1`,'--expected-shelf-entry-id',id])],result=main(args);assert.equal(result.plan.moveCount,13);assert.equal(result.plan.inventoryAdvanceCount,13);}finally{try{value.database.close();}catch{}fs.rmSync(value.root,{recursive:true,force:true});}});

test('PROD-064 derives each restore baseline from the first incident commit unless explicitly overridden',()=>{const database=new Database(':memory:');try{database.exec('CREATE TABLE arca_aftercare_inventory_commits (inventory_commit_id TEXT,shelf_entry_id TEXT,previous_inventory_revision INTEGER,committed_at_ms INTEGER)');database.prepare('INSERT INTO arca_aftercare_inventory_commits VALUES (?,?,?,?)').run('later','entry',4,200);database.prepare('INSERT INTO arca_aftercare_inventory_commits VALUES (?,?,?,?)').run('first','entry',2,100);const options={incidentStartMs:50,restoreRevisions:new Map()};assert.equal(resolveRestoreRevision(database,options,'entry',5),2);assert.equal(resolveRestoreRevision(database,options,'uncommitted',7),7);assert.equal(resolveRestoreRevision(database,{...options,restoreRevisions:new Map([['entry',1]])},'entry',5),1);}finally{database.close();}});

test('PROD-064 maps reordered members by immutable identity and applies only the explicit Silver Blade path restoration',()=>{const row=(ordinal,key,role,location)=>({ordinal,material_key:key,role,location,size_bytes:10,content_fingerprint:key});const restore=[row(0,'a','primary_payload','/media/Film/Movie (2020)/Movie (2020).mkv'),row(1,'b','poster','/media/Film/Movie (2020)/poster.jpg')],current=[row(0,'b','poster','/media/Film/Movie/poster.jpg'),row(1,'a','primary_payload','/media/Film/Movie/Movie.mkv')];assert.deepEqual(mapRestoreRows(current,restore,'entry').map((item)=>item.material_key),['b','a']);assert.equal(restoredLocation('052d55542cdc50ef521932293cccf0ce26fe00d7967b61d388ae7b487f0b2db8','/media/Film/银翼杀手2022：黑暗浩劫 (2017)/银翼杀手2022：黑暗浩劫 (2017).mkv'),'/media/Film/银翼杀手：2022黑暗浩劫 (2017)/银翼杀手：2022黑暗浩劫 (2017).mkv');assert.equal(restoredLocation('another','/media/Film/银翼杀手2022：黑暗浩劫 (2017)'),'/media/Film/银翼杀手2022：黑暗浩劫 (2017)');});

test('PROD-064 accepts an uncommitted quarantine member only from the exact succeeded incident Stage result',()=>{const database=new Database(':memory:');try{database.exec(`
  CREATE TABLE fx_supporting_works (work_id TEXT,owner_domain TEXT,process_type TEXT,process_id TEXT);
  CREATE TABLE fx_workflow_events (event_id TEXT,plan_id TEXT,work_id TEXT,capability_ref TEXT);
  CREATE TABLE fx_event_attempts (event_attempt_id TEXT,event_id TEXT,outcome_kind TEXT,started_at_ms INTEGER);
  CREATE TABLE fx_effect_journal (event_attempt_id TEXT,effect_class TEXT,state TEXT,verified_at_ms INTEGER);
  CREATE TABLE fx_event_result_bindings (event_id TEXT,outcome_kind TEXT,result_schema_ref TEXT,result_json TEXT,committed_at_ms INTEGER);
`);database.prepare('INSERT INTO fx_supporting_works VALUES (?,?,?,?)').run('work','arca','arca_shelf_entry','entry');database.prepare('INSERT INTO fx_workflow_events VALUES (?,?,?,?)').run('stage','plan','work','arca.inventory.product.stage@1');database.prepare('INSERT INTO fx_workflow_events VALUES (?,?,?,?)').run('switch','plan','work','arca.inventory.placement.switch@1');database.prepare('INSERT INTO fx_event_attempts VALUES (?,?,?,?)').run('switch-attempt','switch','failed',110);database.prepare('INSERT INTO fx_effect_journal VALUES (?,?,?,?)').run('switch-attempt','material_commit','failed',130);const location=path.resolve('/media/Film/Movie/Movie.nfo'),physicalIdentity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',sizeBytes:4189,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:'fingerprint'};database.prepare('INSERT INTO fx_event_result_bindings VALUES (?,?,?,?,?)').run('stage','succeeded','helix://contracts/capabilities/arca.inventory.product.stage/v1/result',JSON.stringify({result:{stagedMembers:[{location,physicalIdentity}]}}),100);database.prepare('INSERT INTO fx_event_result_bindings VALUES (?,?,?,?,?)').run('stage','failed','helix://contracts/capabilities/arca.inventory.product.stage/v1/result',JSON.stringify({result:{stagedMembers:[{location:path.resolve('/media/Film/Movie/failed.nfo'),physicalIdentity}]}}),100);const evidence=stagedIncidentEvidence(database,'entry',50);assert.deepEqual([...evidence.keys()],[location]);assert.equal(evidence.get(location)[0].signature,'4189:middle-256k-sha256:1:fingerprint');assert.deepEqual(evidence.get(location)[0].failedSwitchWindows,[{startedAtMs:110,verifiedAtMs:130}]);assert.equal(stagedIncidentEvidence(database,'entry',101).size,0);}finally{database.close();}});

test('PROD-064 bounds a valid mutated NFO to the failed Placement effect window',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'prod064-nfo-')),location=path.join(root,'Movie.nfo');try{fs.writeFileSync(location,'<movie><title>Movie</title></movie>');const observed=computeBoundedMaterialFingerprintSync(location),modifiedAtMs=Number(observed.stat.mtimeMs),evidence=new Map([[path.resolve(location),[{signature:'different',stageCommittedAtMs:modifiedAtMs-20,failedSwitchWindows:[{startedAtMs:modifiedAtMs-10,verifiedAtMs:modifiedAtMs+10}]}]]]);assert.equal(quarantineStageBasis(location,observed,evidence),'incident_failed_switch_nfo_mutation');evidence.get(path.resolve(location))[0].failedSwitchWindows[0].verifiedAtMs=modifiedAtMs-2;assert.equal(quarantineStageBasis(location,observed,evidence),null);fs.writeFileSync(location,'not an nfo');const invalid=computeBoundedMaterialFingerprintSync(location);evidence.get(path.resolve(location))[0].failedSwitchWindows[0].verifiedAtMs=Number(invalid.stat.mtimeMs)+10;assert.equal(quarantineStageBasis(location,invalid,evidence),null);}finally{fs.rmSync(root,{recursive:true,force:true});}});
