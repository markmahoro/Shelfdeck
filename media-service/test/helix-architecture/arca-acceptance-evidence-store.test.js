'use strict';
const {createPlanningEvidenceReader}=require('../../src/helix/domains/arca/persistence/planning-evidence-reader');
const test=require('node:test');
const assert=require('node:assert/strict');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {fixture}=require('./helpers/acceptance-evidence-fixture');
const {CHECK,RECORD,resolveAcceptanceResult}=require('../../src/helix/domains/arca/persistence/acceptance-check-evidence-store');
const capability='arca.acceptance.identity.verify@1';
function check(){return {schemaRef:CHECK,schemaVersion:1,verificationId:'check',verificationKind:'shelf_acceptance',
  basisDigest:D('basis'),result:'passed',reasonCodes:[],evidenceRefs:Array.from({length:1024},(_,i)=>'evidence-'+i+'-'+D(i)),
  verifiedAtMs:100,acceptanceAttemptId:'acceptance',checkKind:'identity',standardRevision:1,packageDigest:D('package'),
  requirementDigest:D('requirement'),evidenceStatus:'complete',actualGapCodes:[],actualGapSetDigest:D([]),
  missingMetadataFields:[],missingArtifactKinds:[],primaryMediaObservations:[],primaryMediaObservationSetDigest:D([]),
  authorizedDefectManifestDigestOrNull:null,authorizedGapComparison:'not_applicable'};}
const offer={offerId:'offer',packageDigest:D('package')};
test('Arca retains complete large Evidence while Foundation binds only an immutable reference',()=>{
  const f=fixture(capability);try{
    const value=check();assert.ok(Buffer.byteLength(canonicalJson(value))>65536);
    const saved=f.store.commit(f.execution,offer,value);
    assert.equal(saved.record.schemaRef,RECORD);assert.deepEqual(f.store.resolve(saved.record),value);
    assert.deepEqual(resolveAcceptanceResult(f.options,saved.record),value);assert.deepEqual(createPlanningEvidenceReader(f.options).resolveAcceptance(saved.record),value);
    assert.deepEqual(f.store.commit(f.execution,offer,value),saved);
    const binding=f.db.prepare('SELECT result_json,evidence_json FROM fx_event_result_bindings').get();
    assert.deepEqual(JSON.parse(binding.result_json),saved.record);
    assert.ok(Buffer.byteLength(binding.result_json)<65536);assert.ok(Buffer.byteLength(binding.evidence_json)<65536);
    for(const table of ['arca_acceptance_check_evidence','fx_commit_markers','fx_event_result_bindings'])
      assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,1);
    assert.throws(()=>f.store.commit(f.execution,offer,{...value,verifiedAtMs:101}),{code:'ARCA_ACCEPTANCE_EVIDENCE_INTEGRITY'});
    assert.throws(()=>f.store.resolve({...saved.record,checkRevision:2}),{code:'ARCA_ACCEPTANCE_EVIDENCE_INTEGRITY'});
    assert.throws(()=>f.store.resolve({...saved.record,checkDigest:D('tampered')}),{code:'ARCA_ACCEPTANCE_EVIDENCE_INTEGRITY'});
    assert.throws(()=>f.db.prepare('UPDATE arca_acceptance_check_evidence SET evidence_json=?').run(JSON.stringify('x'.repeat(2*1024*1024))),/CHECK constraint failed/);
    assert.deepEqual(f.store.resolve(saved.record),value);
    f.db.prepare('UPDATE arca_acceptance_check_evidence SET evidence_json=?').run(canonicalJson({...value,verifiedAtMs:102}));
    assert.throws(()=>f.store.resolve(saved.record),{code:'ARCA_ACCEPTANCE_EVIDENCE_INTEGRITY'});
  }finally{f.close();}
});
test('Owner write failure rolls back Result and marker, then the same Event can commit',()=>{
  const f=fixture(capability);try{
    f.db.exec("CREATE TRIGGER test_abort BEFORE INSERT ON arca_acceptance_check_evidence BEGIN SELECT RAISE(ABORT,'injected owner write failure'); END");
    assert.throws(()=>f.store.commit(f.execution,offer,check()),/injected owner write failure/);
    for(const table of ['arca_acceptance_check_evidence','fx_commit_markers','fx_event_result_bindings'])
      assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
    f.db.exec('DROP TRIGGER test_abort');
    assert.equal(f.store.commit(f.execution,offer,check()).record.checkRevision,1);
  }finally{f.close();}
});
test('Evidence cannot cross scope, execution fence, schema, or full byte bounds',()=>{
  const f=fixture(capability);try{
    assert.throws(()=>f.store.commit(f.execution,{...offer,packageDigest:D('other')},check()),{code:'ARCA_ACCEPTANCE_EVIDENCE_INTEGRITY'});
    assert.throws(()=>f.store.commit({...f.execution,ownerScope:{processType:'arca_acceptance',processId:'other'}},offer,check()),{code:'ARCA_ACCEPTANCE_EVIDENCE_INTEGRITY'});
    assert.throws(()=>f.store.commit(f.execution,offer,{...check(),unregistered:true}),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
    assert.throws(()=>f.store.commit({...f.execution,capabilityRef:'arca.acceptance.space.verify@1'},offer,check()),{code:'ARCA_ACCEPTANCE_EVIDENCE_INTEGRITY'});
    f.db.prepare("UPDATE fx_event_attempts SET state='completed'").run();
    assert.throws(()=>f.store.commit(f.execution,offer,check()),{code:'ARCA_ACCEPTANCE_EVIDENCE_INTEGRITY'});
    assert.throws(()=>resolveAcceptanceResult(f.options,check()),{code:'ARCA_ACCEPTANCE_EVIDENCE_INTEGRITY'});
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_commit_markers').get().n,0);
  }finally{f.close();}
});
