'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {buildJavCorrectionBasis,buildJavCorrectionProposal}=require('../../src/helix/domains/arca/model/jav-identity-correction');
const {buildJavCorrectionScope,buildJavCorrectionSourceVerified,assertJavCorrectionVerifiedSource,CAPABILITY,SOURCE_CAPABILITY,STAGE_CAPABILITY}=require('../../src/helix/domains/arca/model/jav-correction-execution-contract');
const {createJavCorrectionAssetsPlanner,createJavCorrectionFilesPlanner,createJavCorrectionCommitPlanner}=require('../../src/helix/domains/arca/planning/jav-correction-planners');
const {CAPABILITY:COMMIT_CAPABILITY}=require('../../src/helix/domains/arca/model/jav-correction-commit-contract');
const fixture=require('./fixtures/jav-correction');
const {buildJavCorrectionRecoveryReceipt}=require('../../src/helix/domains/arca/model/jav-correction-recovery');
const {readJavCorrectionSourceResult,RECOVERY_SOURCE_PROJECTION}=require('../../src/helix/domains/arca/model/jav-correction-source-result');
function admission() {
  const c=fixture.context(),controlProjections=c.raw.materials.map(row=>({materialKey:row.material_key,resultKind:'available',controlState:'controlled',ownerDomain:'arca',
    ownerScopeType:'shelf_entry',ownerScopeId:c.shelfEntryId,controlRevision:1,projectionDigest:fixture.digest('control')})),
    basis=buildJavCorrectionBasis({raw:c.raw,controlProjections}),proposal=buildJavCorrectionProposal({basis,...fixture.source()}),
    record={state:'active',stateRevision:2,correctionId:'arca-jav-correction-'+fixture.digest('case').slice(0,40),shelfEntryId:c.shelfEntryId,
      admissionDigest:fixture.digest('admission'),proof:{basis,proposal}};
  return {record,scope:buildJavCorrectionScope(record,fixture.digest('workspace-root'))};
}
test('verified correction source freezes complete optional metadata and rejects tampering, foreign film or another admission',()=>{
  const {record,scope}=admission(),observation=structuredClone(record.proof.proposal.sourceQualification.observation);
  observation.descriptiveEntries.push({key:'release_date',value:'2025-06-07'});
  observation.observationDigest=canonicalDigest(Object.fromEntries(Object.entries(observation).filter(([key])=>key!=='observationDigest')));
  const expectations=['metadata','nfo','poster','fanart'].map(kind=>({kind,byteDigest:fixture.digest(kind),sizeBytes:100})),
    result=buildJavCorrectionSourceVerified(record,scope,observation,100,expectations);
  assert.notEqual(result.actualProposalDigest,result.confirmedProposalDigest);
  assert.deepEqual(assertJavCorrectionVerifiedSource(record,scope,JSON.parse(JSON.stringify(result))),result);
  const changed=structuredClone(result);changed.qualification.observation.descriptiveEntries.pop();
  assert.throws(()=>assertJavCorrectionVerifiedSource(record,scope,changed));
  assert.throws(()=>assertJavCorrectionVerifiedSource({...record,admissionDigest:fixture.digest('other')},scope,result));
  const foreign=structuredClone(observation);foreign.resourceKey='other-film';
  assert.throws(()=>buildJavCorrectionSourceVerified(record,scope,foreign,100),{code:'ARCA_JAV_CORRECTION_SOURCE_CHANGED'});
});
test('correction Planner conserves exact resource contracts and Source Result dependency before asset writes',()=>{
  const {record,scope}=admission(),root=path.resolve(__dirname,'../../src/helix/contracts/capabilities'),packages=new Map();
  for(const ref of [SOURCE_CAPABILITY,CAPABILITY,STAGE_CAPABILITY,COMMIT_CAPABILITY]) {
    const location=path.join(root,...ref.replace('@1','/v1').split('.').join('/').split('/'));
    packages.set(ref,{manifest:require(path.join(location,'manifest.json')),demand:require(path.join(location,'resource-demand.schema.json'))});
  }
  const registry={snapshot:[],resolve:ref=>packages.get(ref)},policyRegistry={digest:canonicalDigest('policy'),bindingFor:()=>({retryPolicyRef:'retry',timeoutPolicyRef:'timeout'})},
    planner=createJavCorrectionAssetsPlanner({registry,policyRegistry,correctionContextReader:{read:()=>({record,scope})}}),
    plan=planner.plan({processId:record.correctionId,processType:'arca_jav_identity_correction',workAttemptId:'attempt',workId:'work',executionBasisDigest:scope.digest}),
    validator=createCapabilityContractValidator({schemas:[...packages.values()].map(value=>value.demand)});
  for(const node of plan.nodes)validator.validate(packages.get(node.capabilityRef).demand.$id,node.resourceDemand);
  assert.equal(plan.nodes.length,2);assert.equal(plan.nodes[0].effectClass,'pure_observation');assert.equal(plan.nodes[1].effectClass,'workspace_write');
  assert.deepEqual(plan.nodes[1].dependsOn,[{eventId:plan.nodes[0].eventId,satisfaction:'success'}]);
  assert.equal(plan.nodes[1].inputBindings.bindings.find(value=>value.portName==='javCorrectionSourceVerified').eventId,plan.nodes[0].eventId);
  const files=createJavCorrectionFilesPlanner({registry,policyRegistry,correctionContextReader:{read:()=>({record,scope})}})
    .plan({processId:record.correctionId,processType:'arca_jav_identity_correction',workAttemptId:'files-attempt',workId:'files-work',executionBasisDigest:scope.digest});
  assert.equal(files.nodes.length,1);assert.equal(files.nodes[0].capabilityRef,STAGE_CAPABILITY);assert.equal(files.nodes[0].effectClass,'material_commit');
  assert.deepEqual(files.nodes[0].inputBindings.bindings.map(item=>item.portName),['javCorrectionScope']);
  validator.validate(packages.get(STAGE_CAPABILITY).demand.$id,files.nodes[0].resourceDemand);
  const commit=createJavCorrectionCommitPlanner({registry,policyRegistry,correctionContextReader:{read:()=>({record,scope})}})
    .plan({processId:record.correctionId,processType:'arca_jav_identity_correction',workAttemptId:'commit-attempt',workId:'commit-work',executionBasisDigest:scope.digest});
  assert.equal(commit.workObjectiveTypeRef,'helix://arca/work/jav_correction_commit/v1');assert.equal(commit.nodes.length,1);
  assert.equal(commit.nodes[0].capabilityRef,COMMIT_CAPABILITY);assert.equal(commit.nodes[0].effectClass,'responsibility_control_commit');
  assert.deepEqual(commit.nodes[0].inputBindings.bindings.map(item=>item.portName),['javCorrectionScope']);
  validator.validate(packages.get(COMMIT_CAPABILITY).demand.$id,commit.nodes[0].resourceDemand);
});

test('terminal asset recovery pins the old successful Source Event and plans only new asset execution',()=>{
  const original=admission(),{scope}=original,record={...original.record,state:'attention_required',stateRevision:3,cleanupState:null,updatedAtMs:100},
    expectations=['metadata','nfo','poster','fanart'].map(kind=>({kind,byteDigest:fixture.digest(kind),sizeBytes:100})),
    result=buildJavCorrectionSourceVerified(original.record,scope,original.record.proof.proposal.sourceQualification.observation,99,expectations),
    baseWorkId=require('../../src/helix/domains/arca/model/jav-correction-execution-contract').javCorrectionAssetsWorkId(scope),
    reference={workId:baseWorkId,eventId:'successful-source-event',resultDigest:canonicalDigest(result)},
    realityObservation={schema:'arca.jav-correction-recovery-reality@1',correctionId:record.correctionId,phase:'jav_correction_assets',observedAtMs:100,classification:'matching',files:[],directories:[]},
    body={schema:'arca.jav-correction-recovery-observation@1',correctionId:record.correctionId,admissionDigest:record.admissionDigest,stateRevision:3,updatedAtMs:100,
      previousIntentDigest:null,scopeDigest:scope.digest,executionRevision:2,filePlanDigest:null,sourceResultReference:reference,realityClassification:'matching',realityObservation,realityDigest:canonicalDigest(realityObservation),
      executionSnapshot:{works:[],attempts:[],plans:[],nodes:[],events:[],eventAttempts:[],effects:[],results:[],registries:[],materials:[],artifacts:[]},
      failedWork:{ownerDomain:'arca',processType:'arca_jav_identity_correction',processId:record.correctionId,state:'failed',hasUnresolvedEffects:false,
        workKind:'jav_correction_assets',baseWorkId,workId:baseWorkId,definitionDigest:fixture.digest('definition'),executionEvidenceDigest:fixture.digest('execution'),basisDigest:scope.digest}},
    receipt=buildJavCorrectionRecoveryReceipt({record,command:{shelfEntryId:record.shelfEntryId,correctionId:record.correctionId,actorId:'admin',idempotencyKey:'recover-assets',
      expectedStateRevision:3,expectedAdmissionDigest:record.admissionDigest,expectedCleanupState:null,expectedRecoveryIntentDigest:null},
      observation:{...body,observationDigest:canonicalDigest(body)},admittedAtMs:101}),active={...record,state:'active',stateRevision:4,recoveryIntent:receipt},
    row={state:'succeeded',outcomeKind:'succeeded',capabilityRef:SOURCE_CAPABILITY,eventId:reference.eventId,result,resultDigest:reference.resultDigest,
      resultSchemaRef:'helix://contracts/capabilities/arca.jav_correction.source.verify/v1/result'},
    work={state:'failed',owner_domain:'arca',process_type:'arca_jav_identity_correction',process_id:record.correctionId,basis_digest:scope.digest},
    reader={status:id=>id===baseWorkId?work:null,read:id=>id===baseWorkId?[row]:[]},validator={validate(){}};
  assert.equal(readJavCorrectionSourceResult({record:active,scope,workResultReader:reader,contractValidator:validator}).result,result);
  assert.throws(()=>readJavCorrectionSourceResult({record:{...active,recoveryIntent:null},scope,workResultReader:reader,contractValidator:validator}),{code:'ARCA_JAV_CORRECTION_SOURCE_RESULT_UNPROVEN'});
  row.eventId='another-source-event';assert.throws(()=>readJavCorrectionSourceResult({record:active,scope,workResultReader:reader,contractValidator:validator}),{code:'ARCA_JAV_CORRECTION_SOURCE_RESULT_UNPROVEN'});row.eventId=reference.eventId;
  row.resultDigest=fixture.digest('changed');assert.throws(()=>readJavCorrectionSourceResult({record:active,scope,workResultReader:reader,contractValidator:validator}),{code:'ARCA_JAV_CORRECTION_SOURCE_RESULT_UNPROVEN'});row.resultDigest=reference.resultDigest;
  const root=path.resolve(__dirname,'../../src/helix/contracts/capabilities'),registry={snapshot:[],resolve(ref){return {manifest:require(path.join(root,...ref.replace('@1','/v1').replaceAll('.','/').split('/'),'manifest.json'))};}},
    policyRegistry={digest:fixture.digest('policy'),bindingFor:()=>({retryPolicyRef:'retry',timeoutPolicyRef:'timeout'})},
    plan=createJavCorrectionAssetsPlanner({registry,policyRegistry,correctionContextReader:{read:()=>({record:active,scope})}}).plan({processId:record.correctionId,
      processType:'arca_jav_identity_correction',workAttemptId:'new-attempt',workId:receipt.workLineage[0].workId,executionBasisDigest:scope.digest});
  assert.deepEqual(plan.nodes.map(node=>node.capabilityRef),[CAPABILITY]);assert.deepEqual(plan.nodes[0].dependsOn,[]);
  const binding=plan.nodes[0].inputBindings.bindings.find(item=>item.portName==='javCorrectionSourceVerified');
  assert.equal(binding.bindingKind,'projected_owner_facts');assert.equal(binding.projectionRef,RECOVERY_SOURCE_PROJECTION);
  assert.equal(binding.processId,record.correctionId);assert.equal(binding.parameters.expectedScopeDigest,scope.digest);
});
