'use strict';
const {createPlanningEvidenceReader}=require('../../src/helix/domains/arca/persistence/planning-evidence-reader');
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {fixture}=require('./helpers/acceptance-evidence-fixture');
const {createStagedManifestStore,MANIFEST,resolveStagedResult}=require('../../src/helix/domains/arca/persistence/staged-manifest-store');
function manifest(count=128){
  const stagedMembers=Array.from({length:count},(_,index)=>({sourceMaterialKey:D('source'+index),
    physicalIdentity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:D(index),mountScopeId:'mount',
      inode:String(index),sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('content'+index)},
    role:'primary_payload',endpointId:'endpoint',location:'/target/episode-'+index+'.mkv',bindingRevision:1,
    episodeClaims:{items:[],episodeClaimSetDigest:D([])}}));
  const body={schemaRef:MANIFEST,schemaVersion:1,manifestId:'manifest',manifestKind:'staged_inventory',ownerDomain:'arca',memberCount:count,
    membersDigest:D({schema:'arca.staged-inventory-members@1',items:stagedMembers}),publishedAtMs:10,targetCommitSlotId:'slot',
    stagedMembers,sourceProductManifestDigest:D('package')};return {...body,manifestDigest:D(body)};
}
for(const processType of ['arca_ondeck_run','arca_shelf_entry'])test('Stage retains complete large Manifest for '+processType+' and exact replay',()=>{
  const f=fixture('arca.inventory.product.stage@1','scope',processType),store=createStagedManifestStore(f.options);f.execution.namedInputs={targetCommitSlotHandle:{slotId:'slot'}};try{
    const full=manifest();assert.ok(Buffer.byteLength(canonicalJson(full))>65536);
    const record=store.save(f.execution,full);assert.ok(Buffer.byteLength(canonicalJson(record))<65536);
    assert.deepEqual(store.resolve(record),full);assert.deepEqual(resolveStagedResult(f.options,record),full);assert.deepEqual(createPlanningEvidenceReader(f.options).resolveSource(record),full);
    assert.deepEqual(store.save(f.execution,full),record);
    assert.equal(f.db.prepare('SELECT count(*) n FROM arca_staged_manifest_records').get().n,1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_event_result_bindings').get().n,0);
    assert.throws(()=>store.resolve({...record,completeValueDigest:D('other')}),{code:'ARCA_STAGED_MANIFEST_INTEGRITY'});
    assert.throws(()=>store.save(f.execution,{...full,publishedAtMs:11}),{code:'ARCA_STAGED_MANIFEST_INTEGRITY'});
    f.db.prepare('UPDATE arca_staged_manifest_records SET manifest_json=?').run(canonicalJson({...full,publishedAtMs:11}));
    assert.throws(()=>store.resolve(record),{code:'ARCA_STAGED_MANIFEST_INTEGRITY'});
  }finally{f.close();}
});
test('Stage storage failure leaves no record, retries once, and preserves the 8 MiB SQL bound',()=>{
  const f=fixture('arca.inventory.product.stage@1','scope','arca_ondeck_run'),store=createStagedManifestStore(f.options);f.execution.namedInputs={targetCommitSlotHandle:{slotId:'slot'}};try{
    f.db.exec("CREATE TRIGGER fail_stage BEFORE INSERT ON arca_staged_manifest_records BEGIN SELECT RAISE(ABORT,'stage-write-fault'); END");
    assert.throws(()=>store.save(f.execution,manifest()),/stage-write-fault/);
    assert.equal(f.db.prepare('SELECT count(*) n FROM arca_staged_manifest_records').get().n,0);
    f.db.exec('DROP TRIGGER fail_stage');const record=store.save(f.execution,manifest(1024));
    assert.equal(store.resolve(record).stagedMembers.length,1024);
    assert.throws(()=>f.db.prepare('UPDATE arca_staged_manifest_records SET manifest_json=?').run(JSON.stringify('x'.repeat(8*1024*1024))),/CHECK constraint failed/);
    assert.throws(()=>store.save(f.execution,manifest(1025)),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
  }finally{f.close();}
});
test('Stage rejects stale execution and foreign Owner scope',()=>{
  const f=fixture('arca.inventory.product.stage@1','scope','arca_ondeck_run'),store=createStagedManifestStore(f.options);f.execution.namedInputs={targetCommitSlotHandle:{slotId:'slot'}};try{
    assert.throws(()=>store.save({...f.execution,ownerScope:{processType:'arca_ondeck_run',processId:'other'}},manifest()),{code:'ARCA_STAGED_MANIFEST_INTEGRITY'});
    f.db.prepare("UPDATE fx_event_attempts SET state='completed'").run();
    assert.throws(()=>store.save(f.execution,manifest()),{code:'ARCA_STAGED_MANIFEST_INTEGRITY'});
    assert.equal(f.db.prepare('SELECT count(*) n FROM arca_staged_manifest_records').get().n,0);
  }finally{f.close();}
});
