'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),zlib=require('node:zlib');
const Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createPeopleStore}=require('../../src/helix/domains/people/persistence/people-store');
const op=require('../../scripts/helix-architecture/us-adult-schema-copy');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'us-adult-schema-')),sourcePath=path.join(root,'source.sqlite'),targetPath=path.join(root,'target.sqlite'),
    archive=path.resolve(__dirname,'../../src/helix/foundation/persistence/release-schemas',op.SOURCE_DIGEST),
    schema={schemaDdl:zlib.gunzipSync(fs.readFileSync(archive+'.sql.gz')).toString('utf8'),schemaManifest:JSON.parse(zlib.gunzipSync(fs.readFileSync(archive+'.manifest.json.gz')))};
  const kernel=openSqliteKernel({Database,databasePath:sourcePath,...schema});kernel.close();
  t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('us-adult-schema-'));fs.rmSync(root,{recursive:true,force:true});});
  const db=new Database(sourcePath);db.pragma('foreign_keys=ON');db.exec('BEGIN');db.pragma('defer_foreign_keys=ON');
  for(const [id,provider,namespace,key] of [['normal','tmdb','tmdb_person','819'],['jav','javdb','javdb_actor','actor-key'],['us',null,null,null]]){
    db.prepare('INSERT INTO people_persons(person_id,status,current_revision,current_reference_projection_revision,current_reference_projection_digest,created_at_ms) VALUES(?,?,?,?,?,?)').run(id,'active',1,1,D(id),1);
    db.prepare('INSERT INTO people_person_revisions(person_id,revision,person_status,canonical_name,origin_kind,origin_decision_id,origin_decision_digest,fact_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?)').run(id,1,'active','Same Name','direct','old-direct-'+id,D(id),D({id}),1);
    if(provider)db.prepare('INSERT INTO people_provider_identities(person_id,revision,provider,namespace,provider_key,provenance_digest,active_guard) VALUES(?,?,?,?,?,?,?)').run(id,1,provider,namespace,key,D({provider,key}),1);
  }
  db.prepare("INSERT INTO arca_canonical_identity_revisions(shelf_entry_id,revision,structure_kind,identity_kind) VALUES('entry',1,'single','internal_identity')").run();
  db.prepare("INSERT INTO arca_shelf_entries(shelf_entry_id,status,structure_kind,canonical_identity_revision,current_inventory_revision) VALUES('entry','active','single',1,1)").run();
  db.prepare("INSERT INTO arca_inventory_representations(shelf_entry_id,revision) VALUES('entry',1)").run();
  db.prepare("INSERT INTO arca_inventory_person_relations(relation_id,shelf_entry_id,inventory_revision,person_id,display_name,role,provider_identity_json,relation_digest) VALUES('actor','entry',1,'us','Same Name','actor','[]',?)").run(D('actor'));
  db.prepare("INSERT INTO people_registration_candidates(registration_candidate_id,current_revision,current_state,proposed_name,evidence_digest,candidate_schema_ref,candidate_json,candidate_payload_digest,created_at_ms) VALUES('old-confirmation',1,'open','Same Name',?,'helix://contracts/types/PeopleCandidateDraft/v1',?,?,1)").run(D('weak'),JSON.stringify({proposedName:'Same Name',providerIdentities:[]}),D('old-payload'));
  db.prepare("INSERT INTO people_registration_candidate_revisions(registration_candidate_id,revision,state,committed_at_ms) VALUES('old-confirmation',1,'open',1)").run();
  db.prepare("INSERT INTO fx_audit_records(audit_id,owner_domain,occurred_at_ms) VALUES('retained-history','arca',?)").run(9223372036854775806n);
  const violations=db.pragma('foreign_key_check');assert.deepEqual(violations,[]);db.exec('COMMIT');db.close();return {root,sourcePath,targetPath,schema};
}
test('versioned copy classifies three independent identities and preserves every historical column and pending evidence',t=>{
  const f=fixture(t),before=sha(f.sourcePath),inspection=op.inspectUsAdultSchemaSource({Database,...f});
  assert.equal(inspection.eligible,true);assert.deepEqual(inspection.assignments,[{personId:'jav',libraryKind:'jav'},{personId:'normal',libraryKind:'normal'},{personId:'us',libraryKind:'us_adult'}]);
  const result=op.prepareUsAdultSchemaCopy({Database,...f});assert.equal(result.tableProofs.length,209);assert.equal(result.applied,false);assert.equal(sha(f.sourcePath),before);
  const db=new Database(f.targetPath,{readonly:true});try{
    assert.deepEqual(db.prepare('SELECT person_id,library_kind FROM people_persons ORDER BY person_id').all(),[{person_id:'jav',library_kind:'jav'},{person_id:'normal',library_kind:'normal'},{person_id:'us',library_kind:'us_adult'}]);
    assert.equal(db.prepare('SELECT current_state FROM people_registration_candidates').get().current_state,'open');
    assert.equal(db.prepare('SELECT occurred_at_ms FROM fx_audit_records').safeIntegers().get().occurred_at_ms,9223372036854775806n);
    assert.equal(db.prepare('SELECT person_id FROM arca_inventory_person_relations').get().person_id,'us');
    for(const tableId of op.EXTRA_TABLES)assert.equal(db.prepare('SELECT count(*) n FROM '+tableId).get().n,0);
  }finally{db.close();}
  assert.equal(op.verifyUsAdultSchemaRollback({Database,...f,upgradedPath:f.targetPath}).eligible,true);
});
test('missing and conflicting evidence never guesses a library or changes the source',t=>{
  const f=fixture(t),db=new Database(f.sourcePath);
  db.prepare("INSERT INTO people_provider_identities(person_id,revision,provider,namespace,provider_key,provenance_digest,active_guard) VALUES('us',1,'tmdb','person','820',?,1)").run(D('conflict'));
  db.prepare("DELETE FROM people_provider_identities WHERE person_id='jav'").run();db.close();const before=sha(f.sourcePath);
  const result=op.inspectUsAdultSchemaSource({Database,...f});assert.equal(result.eligible,false);
  assert.deepEqual(result.blockers.map(item=>item.reasonCode).sort(),['conflicting_library_evidence','library_evidence_missing']);
  assert.throws(()=>op.prepareUsAdultSchemaCopy({Database,...f}),{code:'US_SCHEMA_SOURCE_INELIGIBLE'});
  assert.equal(sha(f.sourcePath),before);assert.equal(fs.existsSync(f.targetPath),false);
});
test('historical Merge correlations carry library evidence and conflicting libraries block both identities',t=>{
  const f=fixture(t),db=new Database(f.sourcePath);
  db.prepare("DELETE FROM people_provider_identities WHERE person_id='jav'").run();
  db.prepare("UPDATE people_person_revisions SET merged_into_person_id='normal' WHERE person_id='jav'").run();db.close();
  const first=op.inspectUsAdultSchemaSource({Database,...f});assert.equal(first.eligible,true);
  assert.equal(first.assignments.find(item=>item.personId==='jav').libraryKind,'normal');
  const changed=new Database(f.sourcePath);changed.prepare("INSERT INTO people_provider_identities(person_id,revision,provider,namespace,provider_key,provenance_digest,active_guard) VALUES('jav',1,'javdb','javdb_actor','actor-key',?,1)").run(D('jav'));changed.close();
  const conflict=op.inspectUsAdultSchemaSource({Database,...f});assert.equal(conflict.eligible,false);
  assert.deepEqual(conflict.blockers.map(item=>item.personId),['jav','normal']);
});
test('rollback qualification refuses a new-version business row',t=>{
  const f=fixture(t);op.prepareUsAdultSchemaCopy({Database,...f});
  const db=new Database(f.targetPath);db.prepare("INSERT INTO people_us_recommendation_cycles(cycle_id) VALUES('new-cycle')").run();db.close();
  assert.throws(()=>op.verifyUsAdultSchemaRollback({Database,...f,upgradedPath:f.targetPath}),{code:'US_SCHEMA_ROLLBACK_CHANGED_FACTS'});
});
test('unfinished execution blocks the copy without cancelling any responsibility',t=>{
  const f=fixture(t),db=new Database(f.sourcePath);db.prepare("INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,state) VALUES('pending','libra','libra_run','run','running')").run();db.close();
  const before=sha(f.sourcePath);assert.throws(()=>op.prepareUsAdultSchemaCopy({Database,...f}),{code:'US_SCHEMA_SOURCE_INELIGIBLE'});assert.equal(sha(f.sourcePath),before);
});
test('an accepted historical weak origin remains readable without rewriting its pre-library Candidate payload',t=>{
  const f=fixture(t),db=new Database(f.sourcePath),payload={proposedName:'Same Name',aliases:[],providerIdentities:[],referenceHints:[]};
  db.exec('BEGIN');db.pragma('defer_foreign_keys=ON');
  db.prepare("UPDATE people_registration_candidates SET candidate_json=?,candidate_payload_digest=?,current_state='accepted',current_revision=2,terminal_at_ms=2 WHERE registration_candidate_id='old-confirmation'").run(JSON.stringify(payload),D(payload));
  db.prepare("INSERT INTO people_registration_candidate_revisions(registration_candidate_id,revision,state,decision_origin,decision_ref,decision_digest,committed_at_ms) VALUES('old-confirmation',2,'accepted','user','old-decision',?,2)").run(D('decision'));
  db.prepare("UPDATE people_person_revisions SET origin_kind='candidate',origin_decision_id=NULL,origin_decision_digest=NULL,origin_candidate_kind='registration',origin_candidate_id='old-confirmation',origin_candidate_revision=1,origin_candidate_payload_digest=? WHERE person_id='normal'").run(D(payload));
  db.exec('COMMIT');db.close();const before=sha(f.sourcePath);op.prepareUsAdultSchemaCopy({Database,...f});
  const target=path.resolve(__dirname,'../../src/helix/foundation/persistence/release-schemas',op.TARGET_DIGEST),
    schema={schemaDdl:zlib.gunzipSync(fs.readFileSync(target+'.sql.gz')).toString('utf8'),schemaManifest:JSON.parse(zlib.gunzipSync(fs.readFileSync(target+'.manifest.json.gz')))},
    kernel=openSqliteKernel({Database,databasePath:f.targetPath,...schema}),store=createPeopleStore({...schema,unitOfWork:createSqliteUnitOfWork({kernel})});
  try{assert.equal(store.findUserAcceptedRegistrationPerson(D('weak')).personId,'normal');assert.equal(store.findUserAcceptedRegistrationPerson(D('missing')),null);}
  finally{kernel.close();}assert.equal(sha(f.sourcePath),before);
});
test('rollback qualification refuses new facts, changed old bytes and changed library assignments',t=>{
  const f=fixture(t);op.prepareUsAdultSchemaCopy({Database,...f});
  const db=new Database(f.targetPath);db.prepare("UPDATE people_persons SET library_kind='jav' WHERE person_id='normal'").run();db.prepare("UPDATE people_provider_identities SET library_kind='jav' WHERE person_id='normal'").run();db.close();
  assert.throws(()=>op.verifyUsAdultSchemaRollback({Database,...f,upgradedPath:f.targetPath}),{code:'US_SCHEMA_ROLLBACK_CHANGED_FACTS'});
  const changed=new Database(f.targetPath);changed.prepare("UPDATE people_persons SET library_kind='normal' WHERE person_id='normal'").run();changed.prepare("UPDATE people_provider_identities SET library_kind='normal' WHERE person_id='normal'").run();changed.prepare("UPDATE people_registration_candidates SET proposed_name='Changed',candidate_json=json_set(candidate_json,'$.proposedName','Changed')").run();changed.close();
  assert.throws(()=>op.verifyUsAdultSchemaRollback({Database,...f,upgradedPath:f.targetPath}),{code:'US_SCHEMA_ROLLBACK_CHANGED_FACTS'});
});
test('copy refuses target overwrite, aliases and interrupted publication',t=>{
  const f=fixture(t),before=sha(f.sourcePath);assert.throws(()=>op.prepareUsAdultSchemaCopy({Database,...f,targetPath:f.sourcePath}),{code:'US_SCHEMA_TARGET_EXISTS'});
  const alias=path.join(f.root,'alias.sqlite');fs.linkSync(f.sourcePath,alias);assert.throws(()=>op.inspectUsAdultSchemaSource({Database,...f}),{code:'US_SCHEMA_PATH_UNSAFE'});fs.unlinkSync(alias);
  function FailingDatabase(file,options){const db=new Database(file,options),prepare=db.prepare.bind(db);
    if(path.basename(file).startsWith('.us-adult-schema-preparing-')&&!options?.readonly)db.prepare=sql=>sql.startsWith('INSERT INTO "people_persons"')?{run(){throw Error('injected copy interruption');}}:prepare(sql);return db;}
  assert.throws(()=>op.prepareUsAdultSchemaCopy({Database:FailingDatabase,...f}),/injected copy interruption/);
  assert.equal(sha(f.sourcePath),before);assert.equal(fs.existsSync(f.targetPath),false);assert.equal(fs.readdirSync(f.root).filter(name=>name.startsWith('.us-adult-schema-preparing-')).length,0);
});
