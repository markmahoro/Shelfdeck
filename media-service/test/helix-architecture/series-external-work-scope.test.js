'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest:d}=require('../../src/helix/contracts/canonical-json');
const work=require('../../src/helix/domains/libra/planning/external-material-work');
const planner=require('../../src/helix/domains/libra/planning/external-material-planner');
const external=require('../../src/helix/domains/libra/model/external-material-contracts');
const {buildMediaRequirement}=require('../../src/helix/domains/libra/model/media-production-contracts');
const digest=value=>d({value});
function snapshot(){
  const episodeClaims=['E1','E2','E3'].map(episodeKey=>({episodeKey,seasonClaimDigest:digest('season'),
    claimDigest:digest(episodeKey),outputRequirementDigest:digest('requirement-'+episodeKey)}));
  return {run:{libraRunId:'run',subjectId:'subject',executionBasisDigest:digest('run'),acceptanceSpecId:'spec',priorityClass:'normal'},
    spec:{schemaRef:'libra.acceptance-spec@1',schemaVersion:1,specRevision:1,acceptanceSpecId:'spec',recordDigest:digest('spec'),
      contentProfile:'series',structureKind:'season',productScope:{episodeKeys:episodeClaims.map(item=>item.episodeKey)},
      requirements:{mandatoryMedia:{mediaForm:'stream_file',videoCodec:'hevc',container:'matroska',fileExtension:'mkv',
        minimumRasterClass:'none',acceptedPrimaryAudioClasses:[],forbidSystemUpscaleFor4k:true},
      space:{unit:'episode',maxSizeGiB:null,maxSizeBytes:null}}},episodeClaims,
    members:[{materialKey:'shared',role:'primary_payload',episodeClaims:episodeClaims.slice(0,2)},
      {materialKey:'part',role:'primary_payload',episodeClaims:episodeClaims.slice(0,1)},
      {materialKey:'other',role:'primary_payload',episodeClaims:episodeClaims.slice(2)}]};
}
function fixture(value=snapshot()){
  const identity={contentProfile:'series',title:'Show',identityDigest:digest('identity'),providerIdentities:[{
    provider:'tmdb',namespace:'tmdb_series',providerKey:'1',seasonNumber:1,identityAnchorDigest:digest('anchor')}]};
  const observed={libraRunId:'run',result:'resolved',sourceKind:'provider_exact',verifiedIdentity:identity.providerIdentities[0]};
  const observation={...observed,observationDigest:d(observed)},records=new Map();
  const options={registry:{snapshot:[],resolve:capabilityRef=>({manifest:{effectClass:'pure_observation',
    parametersSchemaRef:capabilityRef+'/parameters',resultSchemaRef:capabilityRef+'/result',
    resourceDemandSchemaRef:'resources',fenceSchemaRef:'fence'}})},
    policyRegistry:{digest:digest('policy'),bindingFor:()=>({retryPolicyRef:'retry',timeoutPolicyRef:'timeout'})},
    movieProductionReader:{readRunSnapshot:()=>value,readFact:()=>({factKind:'resolved_identity',factValue:identity})},
    workResultReader:{listWorks:()=>[{work_id:'identity-work'}],read:id=>id==='identity-work'?[{
      outcomeKind:'succeeded',capabilityRef:'libra.product_identity.evidence.observe@1',result:observation}]:records.get(id)||[]},
    resolveExternalMaterialIntegrationHandle:({operationId})=>({integrationId:'provider',configRevision:1,integrationType:'moviepilot',allowedOperation:operationId})};
  return {value,identity,records,options};
}
const request=w=>({workId:w.workId,executionBasisDigest:w.executionBasisDigest,processId:'run',workAttemptId:'attempt-'+w.workId});
test('Series external stages bind one scope in every identity and dependency',()=>{
  const value=snapshot(),scopes=work.replacementScopes(value);
  assert.equal(scopes.length,2);
  for(const factory of [work.externalSearchSelectionWork,work.externalAcquireVerificationWork,work.externalImportSelectionWork]){
    assert.throws(()=>factory(value),/complete replacement scope/);
    const a=factory(value,scopes[0]),b=factory(value,scopes[1]);
    for(const key of ['workId','executionBasisId','executionBasisDigest','idempotencyKey','concurrencyScope'])assert.notEqual(a[key],b[key],key);
    assert.deepEqual(factory(value,scopes[0]),a);
    assert.throws(()=>factory({...value,spec:{...value.spec,recordDigest:digest('new-spec')}},scopes[0]));
  }
  const search=work.externalSearchSelectionWork(value,scopes[0]),acquire=work.externalAcquireVerificationWork(value,scopes[0]),
    imported=work.externalImportSelectionWork(value,scopes[0]);
  assert.equal(acquire.dependencyRefs[0].objectId,search.workId);assert.equal(acquire.dependencyRefs[0].digest,search.executionBasisDigest);
  assert.equal(imported.dependencyRefs[0].objectId,acquire.workId);
});
test('Movie external Work keeps its existing nominal identity and rejects a Series scope',()=>{
  const value=snapshot();value.spec.contentProfile='movie';value.spec.structureKind='single';
  const basis={libraRunId:'run',executionBasisDigest:value.run.executionBasisDigest,acceptanceSpecId:'spec',stage:'search_selection'};
  const result=work.externalSearchSelectionWork(value);
  assert.equal(result.workId,'libra-external-material-search_selection-work-'+d(basis).slice(0,40));
  assert.equal(result.executionBasisDigest,value.run.executionBasisDigest);
  assert.equal(result.concurrencyScope,'run/external-material/search_selection');
  assert.throws(()=>work.externalSearchSelectionWork(value,work.replacementScopes(snapshot())[0]));
});
test('Scoped structure and delivery preserve original claims and reject omissions',()=>{
  const value=snapshot(),scopes=work.replacementScopes(value),structures=scopes.map(scope=>planner.productStructure(value,scope));
  assert.notEqual(structures[0].objectId,structures[1].objectId);
  for(const scope of scopes){
    assert.deepEqual(planner.productStructure(value,scope).episodeClaims.map(item=>item.episodeKey),scope.episodeKeys);
    assert.deepEqual(planner.episodeDelivery(value,scope).episodeClaims,value.episodeClaims.filter(item=>scope.episodeKeys.includes(item.episodeKey)));
    assert.throws(()=>planner.episodeDelivery({...value,episodeClaims:[]},scope),/exact frozen Episode/);
  }
});
test('External Planner search and acquisition consume only their scope and reject a different query',()=>{
  const f=fixture(),p=planner.createExternalMaterialPlanner(f.options),scopes=work.replacementScopes(f.value);
  for(const scope of scopes){
    const search=work.externalSearchSelectionWork(f.value,scope),acquire=work.externalAcquireVerificationWork(f.value,scope);
    assert.equal(p.handles(request(search)),true);
    const searchPlan=p.plan(request(search)),structure=searchPlan.nodes[0].inputBindings.bindings.find(item=>item.portName==='productStructure').value;
    assert.deepEqual(structure.episodeClaims.map(item=>item.episodeKey),scope.episodeKeys);
    assert.throws(()=>p.plan({...request(search),executionBasisDigest:digest('stale')}),/basis changed/);
    const query=external.buildAcquisitionQuery({resolvedProductIdentity:f.identity,productStructure:structure,
      mediaRequirement:buildMediaRequirement(f.value.spec),acquisitionPolicy:external.buildAcquisitionPolicy({integrationId:'provider',configRevision:1}),
      executionContext:{libraRunId:'run',runExecutionBasisDigest:f.value.run.executionBasisDigest},producedAtMs:0});
    const results=[{outcomeKind:'succeeded',capabilityRef:'libra.external_material.query.prepare@1',result:query},
      {outcomeKind:'succeeded',capabilityRef:'libra.external_material.candidate.select@1',result:{result:'selected'}}];
    f.records.set(search.workId,results);
    const acquirePlan=p.plan(request(acquire)),delivery=acquirePlan.nodes.at(-1).inputBindings.bindings.find(item=>item.portName==='episodeDeliveryManifest').value;
    assert.deepEqual(delivery.episodeClaims.map(item=>item.episodeKey),scope.episodeKeys);
    f.records.set(search.workId,[{...results[0],result:{...query,requestedEpisodeKeys:['outside']}},results[1]]);
    assert.throws(()=>p.plan(request(acquire)),/exact replacement scope/);
  }
  assert.equal(p.handles({...request(work.externalSearchSelectionWork(f.value,scopes[0])),workId:'unrelated'}),false);
});
