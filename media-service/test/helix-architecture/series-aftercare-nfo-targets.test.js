'use strict';
const {createPlanningEvidenceReader}=require('../../src/helix/domains/arca/persistence/planning-evidence-reader');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {artifactRequirement}=require('../../src/helix/contracts/product-artifact-requirement');
const {SCHEMA_REF}=require('../../src/helix/domains/arca/model/inventory-artifact-scope');
const {seriesNfoFindingDraft,seriesNfoRepairTargets,seriesNfoProfileParameters}=require('../../src/helix/domains/arca/model/aftercare-series-nfo-targets');
const {createCareRepairPreparationPlanner,P}=require('../../src/helix/domains/arca/planning/aftercare-planners');
const {createAftercareProjections}=require('../../src/helix/domains/arca/planning/aftercare-projections');
const {CAPABILITY_REFS:C}=require('../../src/helix/domains/arca/model/aftercare-contract');
const {validateWorkflowPlan}=require('../../src/helix/foundation/execution/workflow-plan');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {careFindingParameters,careFindingCodes}=require('../../src/helix/domains/arca/model/care-objective');

test('many per-member findings retain all effects without multiplying identical CareRequirement parameters',()=>{
  const findings=Array.from({length:1024},(_,index)=>({findingId:'finding-'+index,
    findingKind:index%2?'presentation:nfo_corrupt':'presentation:nfo_missing'}));
  const parameters=careFindingParameters(findings);
  assert.equal(parameters.length,2);assert.equal(findings.length,1024);
  assert.deepEqual(careFindingCodes({typedParameters:parameters}),['presentation:nfo_corrupt','presentation:nfo_missing']);
  assert.deepEqual(careFindingParameters([...findings].reverse()),parameters);
});

function sealCare(care) {
  const {digest,...body}=care.careRequirement;
  care.careRequirement={...body,digest:canonicalDigest(body)};care.careRequirementDigest=care.careRequirement.digest;
}
function fixture() {
  const materials=[1,2,3].map(number=>{
    const episodeScope={seasonNumber:1,episodeNumber:number,episodeKey:'E'+String(number).padStart(3,'0')};
    const body={schemaRef:SCHEMA_REF,schemaVersion:1,artifactKind:'nfo',seasonNumber:1,episodeScope,
      requirementDigest:artifactRequirement('nfo',episodeScope).requirementDigest,sourcePackageId:'package',
      sourceArtifactHandleId:'artifact-'+number,sourceArtifactReferenceDigest:canonicalDigest(number)};
    return {role:'metadata_sidecar',material_key:canonicalDigest('material-'+number),endpoint_id:'endpoint',binding_revision:1,
      location:'/shelf/opaque-'+number+'.nfo',artifact_scope_schema_ref:SCHEMA_REF,
      artifact_scope_json:canonicalJson({...body,scopeDigest:canonicalDigest(body)})};
  });
  const basis=canonicalDigest('basis'),context={shelfEntryId:'entry',basis:{digest:basis},raw:{entry:{structure_kind:'season'},materials,
    shelf:{current_standard_revision:1},standard:{standard_digest:canonicalDigest('standard')}}};
  const findings=materials.slice(1).map((material,index)=>{
    const code=index?'nfo_corrupt':'nfo_missing',draft=seriesNfoFindingDraft(code,material);
    return {findingId:'finding-'+index,assessmentId:'assessment',findingKind:'presentation:'+code,
      severity:'warning',repairability:'attention_required',findingDigest:draft.snapshotDigest};
  });
  const care={state:'active',careBasisDigest:basis,careRequirement:{careBasisDigest:basis,
    requiredEffects:findings.map(finding=>({objectId:finding.findingId,digest:finding.findingDigest})),
    typedParameters:findings.map(finding=>({parameter:'finding.'+finding.findingId,value:finding.findingKind}))}};
  sealCare(care);
  const history={cases:[care],findings,assessments:[{assessmentId:'assessment',careBasisDigest:basis,assessmentKind:'presentation'}]};
  return {context,care,history,materials};
}
test('Series NFO targets contain only affected current members and retain stable ordering',()=>{
  const f=fixture(),targets=seriesNfoRepairTargets(f.context,f.care,f.history);
  assert.deepEqual(targets.map(item=>item.material.material_key),f.materials.slice(1).map(item=>item.material_key).sort());
  assert.deepEqual(targets.map(item=>item.scope.episodeScope.episodeNumber).sort(),[2,3]);
  f.context.raw.materials.reverse();f.history.findings.reverse();f.care.careRequirement.requiredEffects.reverse();sealCare(f.care);
  assert.deepEqual(seriesNfoRepairTargets(f.context,f.care,f.history),targets);
});
test('Custody and Presentation evidence for the same damaged NFO produce one repair target',()=>{
  const f=fixture(),row={findingId:'custody-finding',assessmentId:'custody',findingKind:'custody:nfo_corrupt',severity:'warning',repairability:'attention_required',
    findingDigest:canonicalDigest({kind:'custody',code:'nfo_corrupt',severity:'warning',repairability:'attention_required',basis:f.materials[2].material_key})};
  f.history.findings.push(row);f.history.assessments.push({assessmentId:'custody',careBasisDigest:f.care.careBasisDigest,assessmentKind:'custody'});
  f.care.careRequirement.requiredEffects.push({objectId:row.findingId,digest:row.findingDigest});sealCare(f.care);
  assert.equal(seriesNfoRepairTargets(f.context,f.care,f.history).length,2);
});
const mutations={
  stale_basis:f=>{f.context.basis.digest=canonicalDigest('later');},
  terminal_case:f=>{f.care.state='closed';},
  altered_requirement:f=>{f.care.careRequirement.requiredEffects.pop();},
  missing_effect:f=>{f.history.findings.pop();},
  duplicate_effect:f=>{f.care.careRequirement.requiredEffects.push({...f.care.careRequirement.requiredEffects[0]});sealCare(f.care);},
  unknown_effect:f=>{f.care.careRequirement.requiredEffects.push({objectId:'unknown',digest:canonicalDigest('unknown')});sealCare(f.care);},
  duplicate_finding:f=>{f.history.findings.push({...f.history.findings[0]});},
  missing_assessment:f=>{f.history.assessments=[];},
  foreign_assessment:f=>{f.history.assessments[0].careBasisDigest=canonicalDigest('another-basis');},
  wrong_dimension:f=>{f.history.assessments[0].assessmentKind='custody';},
  changed_location:f=>{f.materials[1].location='/shelf/new-location.nfo';},
  changed_endpoint:f=>{f.materials[1].endpoint_id='foreign';},
  changed_revision:f=>{f.materials[1].binding_revision=2;},
  removed_material:f=>{f.context.raw.materials=f.materials.filter((_,index)=>index!==1);},
  duplicate_material:f=>{f.materials.push({...f.materials[1]});},
  changed_scope:f=>{const scope=JSON.parse(f.materials[1].artifact_scope_json);scope.sourcePackageId='foreign';
    const {scopeDigest,...body}=scope;f.materials[1].artifact_scope_json=canonicalJson({...body,scopeDigest:canonicalDigest(body)});},
  missing_scope:f=>{f.materials[1].artifact_scope_json=null;f.materials[1].artifact_scope_schema_ref=null;},
  wrong_role:f=>{f.materials[1].role='sidecar';},
};
for(const [name,mutate] of Object.entries(mutations))test('Series NFO target resolution refuses '+name,()=>{
  const f=fixture();mutate(f);assert.throws(()=>seriesNfoRepairTargets(f.context,f.care,f.history),{code:'ARCA_AFTERCARE_SERIES_NFO_TARGET_STALE'});
});
test('Series NFO profile freezes one exact Material, Artifact scope and Case requirement',()=>{
  const f=fixture(),target=seriesNfoRepairTargets(f.context,f.care,f.history)[0];
  const input={materialKey:target.material.material_key,artifactScopeDigest:target.scope.scopeDigest};
  const result=seriesNfoProfileParameters(f.context,f.care,f.history,input);
  assert.deepEqual(Object.fromEntries(result.map(item=>[item.parameter,item.value])),{...input,careRequirementDigest:f.care.careRequirementDigest});
  for(const {valueDigest,...body} of result)assert.equal(valueDigest,canonicalDigest(body));
  assert.throws(()=>seriesNfoProfileParameters(f.context,f.care,f.history,{...input,materialKey:f.materials[0].material_key}));
  assert.throws(()=>seriesNfoProfileParameters(f.context,f.care,f.history,{...input,artifactScopeDigest:canonicalDigest('foreign')}));
});

test('a current finding without a persisted Artifact scope cannot authorize a guessed repair',()=>{
  const f=fixture(),material=f.materials[1];material.artifact_scope_json=null;material.artifact_scope_schema_ref=null;
  const digest=seriesNfoFindingDraft('nfo_missing',material).snapshotDigest;
  f.history.findings[0].findingDigest=digest;f.care.careRequirement.requiredEffects[0].digest=digest;sealCare(f.care);
  assert.throws(()=>seriesNfoRepairTargets(f.context,f.care,f.history),{code:'ARCA_AFTERCARE_SERIES_NFO_TARGET_STALE'});
});

test('Series Preparation Planner and Owner Projection preserve distinct frozen NFO targets',()=>{
  const f=fixture(),root=path.join(__dirname,'../../src/helix/contracts'),directory=path.join(root,'capabilities/arca/aftercare/text_artifact/render/v1'),
    manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
  const registry={snapshot:[{capabilityRef:C.textRender,contractVersion:1}],resolve:()=>({manifest})},
    policyRegistry={digest:canonicalDigest('policy'),bindingFor:()=>({retryPolicyRef:'retry@1',timeoutPolicyRef:'timeout@1'})},
    contextReader={read:()=>f.context,store:{history:()=>f.history}},
    request={workAttemptId:'attempt',workId:'prepare',processId:'entry',processType:'arca_shelf_entry',ownerDomain:'arca',
      executionBasisDigest:f.care.careBasisDigest,dependencyRefs:[]};
  const plan=createCareRepairPreparationPlanner({registry,policyRegistry,contextReader}).plan(request);
  const schemas=['parameters','fence','resource-demand'].map(kind=>JSON.parse(fs.readFileSync(path.join(directory,kind+'.schema.json'),'utf8'))),
    profileSchema=JSON.parse(fs.readFileSync(path.join(root,'domain-types/ArtifactProfile/v1/schema.json'),'utf8'));
  const validator=createCapabilityContractValidator({schemas:[...schemas,profileSchema]});
  validateWorkflowPlan(plan,{registry,policyRegistry,contractValidator:validator});
  assert.equal(plan.nodes.length,2);assert.equal(new Set(plan.nodes.map(node=>node.eventId)).size,2);
  const projections=createAftercareProjections({ evidenceReader:createPlanningEvidenceReader({}),contextReader,workResultReader:{read:()=>[]},
    materialControlProjectionPort:{getMaterialControlProjections:()=>[]},controlScopeDigest:canonicalDigest});
  const projection=projections.find(item=>item.projectionRef===P.artifactProfile).projection,profiles=[];
  for(const node of plan.nodes) {
    const binding=node.inputBindings.bindings.find(item=>item.portName==='artifactProfile');
    const value=projection.project({ownerScope:{processId:'entry'},parameters:binding.parameters});
    validator.validate(profileSchema.$id,value);profiles.push(value);
    assert.equal(value.typedParameters.find(item=>item.parameter==='materialKey').value,binding.parameters.materialKey);
  }
  assert.equal(new Set(profiles.map(value=>value.profileId)).size,2);
  assert.equal(new Set(profiles.map(value=>value.digest)).size,2);
  f.materials[1].binding_revision++;
  assert.throws(()=>projection.project({ownerScope:{processId:'entry'},parameters:plan.nodes[0].inputBindings.bindings[1].parameters}));
});
