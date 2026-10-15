'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const files=require('../src/clean-arca-recycle-port');
const {createRecycleStore}=require('../src/helix/domains/arca/persistence/recycle-store');
const {createRecycleApplication}=require('../src/helix/domains/arca/application/recycle-application');
const {createJavCorrectionDirectoryStore}=require('../src/helix/domains/arca/persistence/jav-correction-directory-store');
const {SCHEMA,CHECKS_SCHEMA}=require('../src/helix/domains/arca/model/jav-correction-directory-scope');
const {canonicalDigest}=require('../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createCapabilityContractValidator}=require('../src/helix/foundation/capability/contract-validator');
const {buildArcaApplicationSchemas}=require('../scripts/helix-architecture/arca-application-schema-builder');
const {buildSharedTypeSchemas}=require('../scripts/helix-architecture/shared-type-schema-builder');
const schemaManifest=require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),schemaDdl=fs.readFileSync(path.resolve(__dirname,'../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jav-directory-recycle-')),source=path.join(root,'media','Old Film'),archiveRoot=path.join(root,'recycle'),digest=canonicalDigest('directory-test');
  t.after(()=>{kernel.close();fs.rmSync(root,{recursive:true,force:true});});fs.mkdirSync(source,{recursive:true});fs.writeFileSync(path.join(source,'poster.jpg'),'old artwork');let at=100000000;
  const kernel=openSqliteKernel({Database,databasePath:path.join(root,'db'),schemaDdl,schemaManifest,now:()=>at}),contractValidator=createCapabilityContractValidator({schemas:[...Object.values(buildArcaApplicationSchemas()),...Object.values(buildSharedTypeSchemas())]}),
    dependencies={schemaManifest,contractValidator,unitOfWork:createSqliteUnitOfWork({kernel}),now:()=>at};
  // Upstream qualification is injected here; its real Work/Receipt path is covered by jav-host-journey.
  try{kernel.runPrimitive(({prepare})=>{
    prepare("INSERT INTO arca_shelf_entries(shelf_entry_id) VALUES('entry')").run();
    prepare("INSERT INTO arca_jav_identity_corrections(correction_id,shelf_entry_id,state,state_revision,preview_proof_schema_ref,preview_proof_json,committed_context_schema_ref,committed_context_json,committed_context_digest,cleanup_state,cleanup_receipt_schema_ref,cleanup_receipt_json,cleanup_receipt_digest,terminal_evidence_digest,terminal_at_ms) VALUES('correction','entry','committed',1,'helix://contracts/application-types/ArcaJavCorrectionPreviewProof/v1','{}','helix://contracts/application-types/ArcaJavCorrectionCommittedContext/v1','{}',?,'completed','helix://contracts/application-types/ArcaJavCorrectionCleanupReceipt/v1','{}',?,?,?)").run(digest,digest,digest,at);
    prepare("INSERT INTO arca_jav_correction_directory_checks(correction_id,shelf_entry_id,committed_context_digest,cleanup_receipt_digest,state,check_revision,checks_schema_ref,checks_json,created_at_ms,updated_at_ms,next_check_at_ms) VALUES('correction','entry',?,?,'pending',1,?,'[]',?,?,?)").run(digest,digest,CHECKS_SCHEMA,at,at,at);
  });}catch(error){throw new Error(error.message,{cause:error});}
  const store=createRecycleStore(dependencies),directoryStore=createJavCorrectionDirectoryStore(dependencies),port=files.createRecycleEffectPort(dependencies),
    protection={scanRoots:[path.join(root,'media')],protectedLocations:[]},scope={knownSourceDirectories:[source],...protection};
  const prepareScope=()=>{const eligibility=protection.scanRoots.some(scan=>files.inside(source,scan))?'retained_root':protection.protectedLocations.some(location=>files.inside(source,location))?'retained_in_use':'eligible';
    const body={schemaRef:SCHEMA,schemaVersion:1,correctionId:'correction',shelfEntryId:'entry',committedContextDigest:digest,cleanupReceiptDigest:digest,filePlanDigest:digest,targetRootLocation:path.join(root,'media'),protectionDigest:canonicalDigest(protection),directories:[{sourceLocation:source,oldBindingOrdinals:[0,1,2,3],eligibility}]};return {...body,scopeDigest:canonicalDigest(body)};};
  const makeApp=(extra={})=>createRecycleApplication({root:archiveRoot,store,port,files,now:()=>at,readScope:()=>scope,directoryStore,prepareCorrectionDirectory:prepareScope,...extra});
  return {root,source,store,directoryStore,protection,makeApp,setTime:value=>{at=value;}};
}
test('correction directory duty survives app reconstruction, archives only an empty old directory and retains user restore',async t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.source,'poster.jpg'));let app=f.makeApp();
  assert.equal((await app.tick()).kind,'correction_directory_checked');assert.equal(fs.existsSync(f.source),true);assert.equal(f.directoryStore.get('correction').state,'pending');
  app=f.makeApp();assert.equal((await app.tick()).kind,'completed');assert.equal(fs.existsSync(f.source),false);
  assert.equal(app.list().correctionChecks[0].checks[0].state,'archived');assert.equal(Object.hasOwn(app.list().correctionChecks[0],'onDeckRunId'),false);assert.deepEqual(app.list().cleanupChecks,[]);
  f.setTime(100000000+5*60*1000+1);await app.tick();assert.equal(f.directoryStore.get('correction').state,'completed');
  const record=f.store.list()[0];await app.restore(record.recycle_entry_id);await app.tick();
  assert.equal(fs.existsSync(f.source),true);assert.equal(app.list().correctionChecks[0].checks[0].state,'retained_after_restore');assert.equal((await app.tick()).kind,'idle');
});
test('nonempty correction directory waits without hashing and only its exact user-confirmed manifest is archived',async t=>{
  const f=fixture(t),app=f.makeApp({files:{...files,snapshot(){throw new Error('Background must not hash an occupied directory.');}}});
  assert.equal((await app.tick()).state,'attention');assert.equal(f.directoryStore.get('correction').checks[0].state,'awaiting_confirmation');assert.equal(f.store.list().length,0);
  const real=f.makeApp(),preview=await real.preview('entry',f.source);assert.equal(preview.requiresConfirmation,true);
  await assert.rejects(real.archive('entry',{...preview,confirmManifestDigest:'0'.repeat(64),idempotencyKey:'stale'}),{code:'ARCA_RECYCLE_CONFIRMATION_STALE'});
  await real.archive('entry',{...preview,confirmManifestDigest:preview.manifestDigest,idempotencyKey:'confirmed'});assert.equal(real.list().correctionChecks[0].state,'pending');
  await real.tick();assert.equal(fs.existsSync(f.source),false);assert.equal(real.list().correctionChecks[0].state,'completed');
});
test('configured roots retain the old directory without a recycle effect',async t=>{
  const f=fixture(t);f.protection.scanRoots.push(path.join(f.source,'nested-field'));let app=f.makeApp();
  assert.equal((await app.tick()).state,'completed');assert.equal(f.directoryStore.get('correction').checks[0].state,'retained_root');assert.equal(f.store.list().length,0);
  await assert.rejects(app.preview('entry',f.source),{code:'ARCA_RECYCLE_SOURCE_IN_USE'});
  assert.equal(fs.readFileSync(path.join(f.source,'poster.jpg'),'utf8'),'old artwork');
});
test('another current Entry binding protects the whole parent even when its file is missing',async t=>{
  const f=fixture(t);f.protection.protectedLocations.push(path.join(f.source,'other-entry','video.mkv'));const app=f.makeApp();
  assert.equal((await app.tick()).state,'completed');assert.equal(f.directoryStore.get('correction').checks[0].state,'retained_in_use');assert.equal(f.store.list().length,0);
});
test('restore refuses a newly protected formal binding at the old location',async t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.source,'poster.jpg'));const app=f.makeApp();await app.tick();await app.tick();
  const record=f.store.list()[0];f.protection.protectedLocations.push(path.join(f.source,'current-video.mkv'));
  await assert.rejects(app.restore(record.recycle_entry_id),{code:'ARCA_RECYCLE_SOURCE_IN_USE'});
  assert.equal(f.store.list()[0].state,'archived');assert.equal(fs.existsSync(f.source),false);
});
test('a new file between empty observation and preview is retained and never becomes automatic consent',async t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.source,'poster.jpg'));
  const app=f.makeApp({files:{...files,async emptyDirectory(source){fs.writeFileSync(path.join(source,'new.txt'),'preserve');return true;}}});
  assert.equal((await app.tick()).state,'attention');assert.equal(f.store.list().length,0);assert.equal(fs.readFileSync(path.join(f.source,'new.txt'),'utf8'),'preserve');
});
