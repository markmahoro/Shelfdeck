'use strict';
const {createPlanningEvidenceReader}=require('../../src/helix/domains/arca/persistence/planning-evidence-reader');
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {fixture}=require('./helpers/acceptance-evidence-fixture');
const {types,createInventoryVerificationStore,resolveInventoryVerification}=require('../../src/helix/domains/arca/persistence/inventory-verification-store');
const {createOnDeckStore}=require('../../src/helix/domains/arca/persistence/on-deck-store');
function verification(type,count=128){const memberEvidence=Array.from({length:count},(_,i)=>({sourceProductMaterialKey:D('source'+i),role:'primary_payload',
  verificationKind:'exact_package_identity',actualPhysicalIdentity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,
    materialKey:D(i),mountScopeId:'mount',inode:String(i),sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('content'+i)},
  observedAtMs:100,semanticEvidenceDigest:null}));return {schemaRef:type.schema,schemaVersion:1,verificationId:'verification',verificationKind:type.kind,
  basisDigest:D('basis'),result:'passed',reasonCodes:[],evidenceRefs:[],verifiedAtMs:100,finalRealityDigest:D('reality'),memberEvidence,
  ...(type.kind==='final_product'?{finalBindingSetDigest:D('bindings'),productManifestDigest:D('manifest'),relatedDispositionSetDigest:D('related'),
    verifiedMaterialKeys:memberEvidence.map(m=>m.sourceProductMaterialKey),targetContainmentDigest:D('target')}:
    {finalInventoryDecisionDigest:D('decision'),shelfStandardRevision:1})};}
for(const type of types)test(type.name+' retains complete Evidence and atomically binds one compact Result',()=>{
  const f=fixture(type.capability,'scope','arca_ondeck_run'),store=createInventoryVerificationStore(f.options);try{
    const value=verification(type);assert.ok(Buffer.byteLength(canonicalJson(value))>65536);
    const saved=store.commit(f.execution,value);assert.deepEqual(store.resolve(saved.record),value);
    assert.deepEqual(resolveInventoryVerification(f.options,saved.record),value);assert.deepEqual(createPlanningEvidenceReader(f.options).resolveSource(saved.record),value);assert.deepEqual(store.commit(f.execution,value),saved);
    assert.ok(Buffer.byteLength(canonicalJson(saved.record))<65536);
    for(const table of ['arca_inventory_verification_records','fx_event_result_bindings','fx_commit_markers'])
      assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,1);
    assert.throws(()=>store.resolve({...saved.record,processId:'foreign'}),{code:'ARCA_INVENTORY_VERIFICATION_INTEGRITY'});
    assert.throws(()=>store.commit(f.execution,{...value,verifiedAtMs:101}),{code:'ARCA_INVENTORY_VERIFICATION_INTEGRITY'});
    f.db.prepare('UPDATE arca_inventory_verification_records SET verification_json=?').run(canonicalJson({...value,verifiedAtMs:101}));
    assert.throws(()=>store.resolve(saved.record),{code:'ARCA_INVENTORY_VERIFICATION_INTEGRITY'});
  }finally{f.close();}
});
test('On-deck Commit rejects absent, foreign and corrupted immutable Fulfillment references',()=>{
  const type=types[1],f=fixture(type.capability,'scope','arca_ondeck_run');try{
    const store=createInventoryVerificationStore(f.options),value=verification(type),saved=store.commit(f.execution,value),onDeck=createOnDeckStore(f.options);
    const request={onDeckRunId:'scope',fulfillmentVerification:value,fulfillmentVerificationDigest:D(value),fulfillmentVerificationRecord:saved.record};
    assert.throws(()=>onDeck.commit({...request,fulfillmentVerificationRecord:undefined}),{code:'P14_ONDECK_FULFILLMENT_RECORD'});
    assert.throws(()=>onDeck.commit({...request,onDeckRunId:'foreign'}),{code:'P14_ONDECK_FULFILLMENT_RECORD'});
    assert.throws(()=>onDeck.commit({...request,fulfillmentVerificationDigest:D('wrong')}),{code:'P14_ONDECK_FULFILLMENT_RECORD'});
    f.db.prepare('UPDATE arca_inventory_verification_records SET verification_json=?').run(canonicalJson({...value,verifiedAtMs:101}));
    assert.throws(()=>onDeck.commit(request),{code:'ARCA_INVENTORY_VERIFICATION_INTEGRITY'});
  }finally{f.close();}
});
test('Final Verification Owner write failure rolls back Result and marker; retry and 1024 members are exact',()=>{
  const type=types[0],f=fixture(type.capability,'entry','arca_shelf_entry'),store=createInventoryVerificationStore(f.options);try{
    f.db.exec("CREATE TRIGGER fail_verification BEFORE INSERT ON arca_inventory_verification_records BEGIN SELECT RAISE(ABORT,'verification-write-fault'); END");
    assert.throws(()=>store.commit(f.execution,verification(type)),/verification-write-fault/);
    for(const table of ['arca_inventory_verification_records','fx_event_result_bindings','fx_commit_markers'])
      assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
    f.db.exec('DROP TRIGGER fail_verification');const saved=store.commit(f.execution,verification(type,1024));
    assert.equal(store.resolve(saved.record).memberEvidence.length,1024);
    assert.throws(()=>f.db.prepare('UPDATE arca_inventory_verification_records SET verification_json=?').run(JSON.stringify('x'.repeat(8*1024*1024))),/CHECK constraint failed/);
    assert.throws(()=>store.commit(f.execution,verification(type,1025)),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
  }finally{f.close();}
});
test('Final Verification rejects a foreign Capability, scope, or expired execution fence',()=>{
  const type=types[0],f=fixture(type.capability,'scope','arca_ondeck_run'),store=createInventoryVerificationStore(f.options);try{
    assert.throws(()=>store.commit(f.execution,verification(types[1])),{code:'ARCA_INVENTORY_VERIFICATION_INTEGRITY'});
    assert.throws(()=>store.commit({...f.execution,ownerScope:{processType:'arca_ondeck_run',processId:'other'}},verification(type)),{code:'ARCA_INVENTORY_VERIFICATION_INTEGRITY'});
    f.db.prepare("UPDATE fx_event_attempts SET state='completed'").run();
    assert.throws(()=>store.commit(f.execution,verification(type)),{code:'ARCA_INVENTORY_VERIFICATION_INTEGRITY'});
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_commit_markers').get().n,0);
  }finally{f.close();}
});

test('correction final Verification cannot commit without its actual active admission and leaves no partial evidence',()=>{
  const type=types[0],f=fixture('arca.jav_correction.files.verify@1','correction','arca_jav_identity_correction'),
    store=createInventoryVerificationStore(f.options);
  try {
    const execution={...f.execution,namedInputs:{javCorrectionScope:{correctionId:'correction',expectedStateRevision:2,
      admissionDigest:D('admission'),basisDigest:D('basis'),digest:D('basis')}}};
    assert.throws(()=>store.commit(execution,verification(type)),{code:'ARCA_INVENTORY_VERIFICATION_INTEGRITY'});
    for(const table of ['arca_inventory_verification_records','fx_event_result_bindings','fx_commit_markers'])
      assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
    assert.throws(()=>store.commit({...execution,ownerScope:{processType:'arca_ondeck_run',processId:'correction'}},verification(type)),
      {code:'ARCA_INVENTORY_VERIFICATION_INTEGRITY'});
  } finally {f.close();}
});
