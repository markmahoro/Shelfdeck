'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const C=require('../../src/helix/domains/libra/model/intake-control-contracts');
const {createIntakeControlObservationPort}=require('../../src/helix/domains/libra/application/intake-control-observation-port');
const without=(value,...keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
function projection(key,changes={}) {
  const value={materialKey:key,resultKind:'available',controlRevision:1,controlState:'controlled',
    regionProjection:'procurement',ownerDomain:'procurement',ownerScopeType:'material_field',ownerScopeId:'field-1',...changes};
  const evidenceDigest=D({schema:'foundation.material-control-evidence@1',...without(value,'regionProjection')});
  const body={...value,evidenceDigest}; return {...body,projectionDigest:D(body)};
}
function fixture(count=2) {
  const projections=Array.from({length:count},(_,index)=>projection(D(index))).sort((a,b)=>a.materialKey.localeCompare(b.materialKey));
  const snapshot={offer:{offerId:'offer-1'},candidatePackage:{candidatePackageId:'candidate-1',packageDigest:D('package'),
    materialFieldContextRef:{fieldId:'field-1'}},deliverySnapshotDigest:D('snapshot'),
    primaryMaterialDeliveries:projections.map(item=>({materialKey:item.materialKey,admittedControlRevision:1,admittedControlProjectionDigest:item.projectionDigest}))};
  const handle=C.buildIntakeControlReadHandle(snapshot);
  const context={namedInputs:{candidateDeliverySnapshot:snapshot},ownerScope:{domain:'libra',processType:'libra_intake',processId:handle.processId}};
  const observe=(values=projections)=>({capturedAtMs:123,projections:values,observationDigest:C.controlObservationDigest(handle,123,values)});
  return {snapshot,projections,handle,context,observe};
}
function binding(f) {
  const observations=f.projections.map(item=>projection(item.materialKey,{controlRevision:3}));
  const {witness,...control}=C.verifyIntakeControlObservation(f.snapshot,f.handle,f.observe(observations));
  const result={schemaRef:C.MATERIAL_SCHEMA,candidatePackageId:'candidate-1',packageDigest:D('package'),
    candidateDeliverySnapshotDigest:f.snapshot.deliverySnapshotDigest,basisDigest:f.snapshot.deliverySnapshotDigest,
    result:'failed',reasonCodes:[C.CONTROL_REASON],...control};
  return {workId:'work-1',capabilityRef:C.CAPABILITY,outcomeKind:'succeeded',state:'succeeded',resultSchemaRef:C.RESULT_SCHEMA,
    evidenceSchemaRef:C.EVIDENCE_SCHEMA,resultId:'persisted-result-1',result,resultDigest:D(result),evidence:witness,evidenceDigest:D(witness)};
}
test('stable scoped Handle is exact to immutable Primary members and owner process',()=>{
  const f=fixture();
  assert.deepEqual(C.buildIntakeControlReadHandle(f.snapshot),f.handle);
  C.assertIntakeControlReadHandle(f.handle,f.snapshot,f.context.ownerScope);
  for(const handle of [{...f.handle,materialKeys:[D('outside')]},{...f.handle,observedAtMs:123},{...f.handle,scopeDigest:D('forged')}])
    assert.throws(()=>C.assertIntakeControlReadHandle(handle,f.snapshot,f.context.ownerScope),{code:'P8_INTAKE_CONTROL_HANDLE_INVALID'});
  assert.throws(()=>C.assertIntakeControlReadHandle(f.handle,f.snapshot,{...f.context.ownerScope,processId:D('foreign')}));
  assert.throws(()=>fixture(1025),{code:'P8_INTAKE_CONTROL_SCOPE_INVALID'});
});
test('Composition observation batches at 500 and preserves stable inputs across observation times',()=>{
  const f=fixture(1024),calls=[]; let clock=100;
  const port=createIntakeControlObservationPort({now:()=>clock++,materialControlProjectionPort:{getMaterialControlProjections(keys){
    calls.push(keys.length); return keys.map(key=>f.projections.find(item=>item.materialKey===key));
  }}});
  const first=port.observe(f.handle,f.context),second=port.observe(f.handle,f.context);
  assert.deepEqual(calls,[500,500,24,500,500,24]);
  assert.notEqual(first.observationDigest,second.observationDigest);
  assert.deepEqual(C.buildIntakeControlReadHandle(f.snapshot),f.handle);
  assert.equal(C.verifyIntakeControlObservation(f.snapshot,f.handle,first).controlScopeStatus,'matched');
});
test('available mismatch selects the first exact member witness; unavailable never becomes business rejection',()=>{
  const f=fixture();
  assert.equal(C.verifyIntakeControlObservation(f.snapshot,f.handle,f.observe()).controlScopeStatus,'matched');
  for(const changes of [{controlRevision:3},{ownerScopeId:'other-field'},
    {ownerDomain:'libra',regionProjection:'production',ownerScopeType:'subject'}]) {
    const values=f.projections.map(item=>projection(item.materialKey,changes));
    const result=C.verifyIntakeControlObservation(f.snapshot,f.handle,f.observe(values));
    assert.equal(result.controlScopeStatus,'mismatched'); assert.deepEqual(result.witness,values[0]);
  }
  const body={materialKey:f.handle.materialKeys[1],resultKind:'unavailable',failureCode:'control_query_unavailable'};
  const value={...body,evidenceDigest:D({schema:'foundation.material-control-evidence@1',...body})};
  const values=[projection(f.handle.materialKeys[0],{controlRevision:3}),{...value,projectionDigest:D(value)}];
  assert.throws(()=>C.verifyIntakeControlObservation(f.snapshot,f.handle,f.observe(values)),{code:'P8_INTAKE_CONTROL_QUERY_UNAVAILABLE'});
  values[1]={...f.projections[1],controlRevision:100};
  assert.throws(()=>C.verifyIntakeControlObservation(f.snapshot,f.handle,f.observe(values)),{code:'P8_INTAKE_CONTROL_PROJECTION_INVALID'});
  assert.throws(()=>C.verifyIntakeControlObservation(f.snapshot,f.handle,{...f.observe(),observationDigest:D('forged')}));
});
test('Control Evidence reference uses persisted result ID and full snapshot digest with strict binding validation',()=>{
  const f=fixture(),record=binding(f),ref=C.intakeControlEvidenceRef(f.snapshot,record,'work-1');
  assert.deepEqual(ref,{evidenceSchemaRef:C.SNAPSHOT_SCHEMA,evidenceId:record.resultId,evidenceDigest:D(record.evidence)});
  assert.notEqual(ref.evidenceDigest,record.evidence.evidenceDigest);
  assert.notEqual(ref.evidenceDigest,record.evidence.projectionDigest);
  for(const changes of [{workId:'foreign'},{resultId:''},{evidenceSchemaRef:C.SNAPSHOT_SCHEMA},{state:'executing'},
    {resultDigest:D('forged')},{evidenceDigest:D('forged')},{evidence:f.projections[0]}])
    assert.throws(()=>C.intakeControlEvidenceRef(f.snapshot,{...record,...changes},'work-1'));
  const result={...record.result,controlScopeStatus:'matched',mismatchedControlMaterialKey:null,result:'passed',reasonCodes:[]};
  assert.equal(C.intakeControlEvidenceRef(f.snapshot,{...record,result,evidence:{producerRef:C.CAPABILITY,
    payloadDigest:D(result),basisDigest:f.snapshot.deliverySnapshotDigest}},'work-1'),null);
  assert.throws(()=>C.assertMaterialControlResult(f.snapshot,result,{producerRef:C.CAPABILITY,payloadDigest:D('bad'),basisDigest:result.basisDigest}));
});
