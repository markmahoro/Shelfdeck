'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
const {initializeCleanData}=require('../../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../../src/clean-service-host');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createPeopleStore}=require('../../src/helix/domains/people/persistence/people-store');
const {createMediaCastReferenceQuery}=require('../../src/helix/domains/people/application/media-cast-reference-query');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {seedPerson}=require('./fixtures/people-state-fixture');
test('maintenance merges only reliable same-library identities through actual Work, Owner commits and acknowledged signals',{timeout:90000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'people-system-merge-')),dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),
    secretRoot='people-system-merge-isolated-secret-0123456789';fs.mkdirSync(adminDistDir);fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  const initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'}),generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated'),
    schema={schemaDdl:fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8'),schemaManifest:JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'))};
  const databasePath=path.join(dataDir,'shelfdeck.db'),kernel=openSqliteKernel({Database,databasePath,...schema}),store=createPeopleStore({...schema,unitOfWork:createSqliteUnitOfWork({kernel})});
  function seed(key,namespace,providerKey,name='Shared Name',contentProfile='movie'){
    return seedPerson(store,{contentProfile,displayName:name,evidenceDigest:D(key),providerIdentities:[{provider:'tmdb',namespace,providerKey}]},{historical:true});
  }
  const a=seed('a','person','42','Historical Name'),b=seed('b','tmdb_person','42','Provider Name'),sameName=seed('same-name','tmdb_person','43','Historical Name'),
    jav=seed('jav','person','42','Historical Name','jav'),conflictA=seed('conflict-a','person','44'),conflictB=seed('conflict-b','tmdb_person','44');
  for(const [person,level] of [[conflictA,-1],[conflictB,1]])store.appendPreference({personId:person.personId,revision:1,preferenceLevel:level,reason:'Historical preference',originKind:'fixture',originRef:'history'});
  assert.equal(store.findActivePeopleByProviderIdentity({libraryKind:'normal',provider:'tmdb',namespace:'person',providerKey:'42'}).length,2);
  assert.equal(store.listPeoplePage({cursor:'',limit:100,status:'active',search:'',libraryKind:null}).length,6);
  kernel.close();let now=Date.parse('2026-10-24T02:59:00+08:00'),host=null,cookie,runtime,db=null;const errors=[];
  t.after(async()=>{await host?.close();db?.close();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('people-system-merge-'));fs.rmSync(root,{recursive:true,force:true});});
  const open=()=>createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:()=>now,onExecutionRuntimeError:error=>errors.push({code:error.code,message:error.message})});
  host=await open();const login=async()=>{const response=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});assert.equal(response.statusCode,204,response.body);cookie=response.headers['set-cookie'];};await login();
  db=new Database(databasePath,{readonly:true});
  await new Promise(resolve=>setTimeout(resolve,200));assert.equal(db.prepare('SELECT count(*) n FROM people_merge_records').get().n,0);
  now=Date.parse('2026-10-24T03:00:00+08:00');const deadline=Date.now()+60000;
  while(Date.now()<deadline){runtime=(await host.inject({method:'GET',url:'/v1/admin/runtime',headers:{cookie}})).json();if(db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE work_kind='system_person_merge' AND state='succeeded'").get().n===1&&
    db.prepare("SELECT count(*) n FROM fx_outbox WHERE message_kind='people.person.merged' AND state='fully_acked'").get().n===1)break;await new Promise(resolve=>setTimeout(resolve,50));}
  const diagnostics=()=>JSON.stringify({errors,works:db.prepare('SELECT work_id,work_kind,state FROM fx_supporting_works').all(),
    attempts:db.prepare('SELECT state,failure_code FROM fx_work_attempts').all(),events:db.prepare('SELECT capability_ref,state FROM fx_workflow_events').all(),
    runtime,cursors:db.prepare("SELECT reconciler_key,opaque_cursor FROM fx_reconcile_cursors WHERE owner_domain='people'").all()});
  assert.equal(db.prepare('SELECT count(*) n FROM people_merge_records').get().n,1,diagnostics());
  const record=db.prepare('SELECT * FROM people_merge_records').get();assert.deepEqual(new Set([record.source_person_id,record.target_person_id]),new Set([a.personId,b.personId]));
  assert.equal(db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE work_kind='system_person_merge' AND state='succeeded'").get().n,1,JSON.stringify(errors));
  assert.equal(db.prepare("SELECT count(*) n FROM fx_outbox WHERE message_kind='people.person.merged' AND state='fully_acked'").get().n,1,JSON.stringify(errors));
  for(const person of [sameName,jav,conflictA,conflictB])assert.equal(db.prepare('SELECT status FROM people_persons WHERE person_id=?').get(person.personId).status,'active');
  assert.equal(db.prepare("SELECT count(*) n FROM people_person_revisions WHERE person_id IN (?,?) AND revision=1").get(a.personId,b.personId).n,2);
  const candidates=await host.inject({method:'GET',url:'/v1/admin/people/registration-candidates',headers:{cookie}});assert.equal(candidates.statusCode,200,candidates.body);assert.deepEqual(candidates.json().items,[]);
  await host.close();host=await open();await login();await new Promise(resolve=>setTimeout(resolve,200));assert.equal(db.prepare('SELECT count(*) n FROM people_merge_records').get().n,1);
  await host.close();host=null;const reopened=openSqliteKernel({Database,databasePath,...schema}),current=createPeopleStore({...schema,unitOfWork:createSqliteUnitOfWork({kernel:reopened})});
  try{const query=createMediaCastReferenceQuery(current);assert.equal(query.resolve({libraryKind:'normal',personId:record.source_person_id,providerIdentities:[]}).personId,record.target_person_id);
    assert.equal(query.resolve({libraryKind:'jav',personId:jav.personId,providerIdentities:[]}).personId,jav.personId);
    const target=current.getPerson(record.target_person_id);assert.ok(target.revision.aliases.some(alias=>alias.aliasDisplay===current.getPerson(record.source_person_id).revision.canonicalName));
    assert.deepEqual(new Set(current.relatedWorksScope(record.target_person_id).personIds),new Set([a.personId,b.personId]));
  }finally{reopened.close();}assert.deepEqual(errors,[]);
});
