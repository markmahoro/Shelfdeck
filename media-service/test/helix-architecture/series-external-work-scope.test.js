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

function importFixture(scopeSize=2){
  const f=fixture(),scope=work.replacementScopes(f.value).find(item=>item.episodeKeys.length===scopeSize),
    acquire=work.externalAcquireVerificationWork(f.value,scope),importWork=work.externalImportSelectionWork(f.value,scope);
  const outputMembers=[{externalMemberId:'shared-new',relativePath:'shared.mkv',episodeClaims:f.value.episodeClaims.filter(item=>scope.episodeKeys.includes(item.episodeKey))},
    {externalMemberId:'part-new',relativePath:'part.mkv',episodeClaims:f.value.episodeClaims.filter(item=>item.episodeKey===scope.episodeKeys[0])}];
  const stableBody={verificationId:'stable',stableExternalMaterialHandle:{handleId:'external',structureKind:'season',
    manifestDigest:digest('manifest'),outputSnapshot:{members:outputMembers}}};
  const stable={...stableBody,stableDigest:d(stableBody)},identity={verificationId:'identity-verification',result:'passed',
    expectedIdentityDigest:f.identity.identityDigest},verified=external.verifyPackage({stableEvidence:stable,identityVerification:identity,
      episodeDeliveryManifest:planner.episodeDelivery(f.value,scope),identityRequirement:planner.identityRequirement(f.identity,f.value),verifiedAtMs:0});
  f.records.set(acquire.workId,[['libra.external_material.stability.observe@1',stable],['libra.external_material.package.verify@1',verified],
    ['libra.external_material.identity.verify@1',identity]].map(([capabilityRef,result])=>({capabilityRef,result,outcomeKind:'succeeded'})));
  f.options.movieProductionReader.readWorkspace=()=>({workspaceId:'workspace',state:'active',currentRevision:1,stateDigest:digest('workspace')});
  f.options.workspaceProductPort={rootSnapshot:()=>({rootId:'root'})};
  f.options.registry.resolve=capabilityRef=>({manifest:{effectClass:capabilityRef==='libra.workspace.material.import@1'?'workspace_write':'pure_observation',
    parametersSchemaRef:'helix://contracts/capabilities/'+capabilityRef.replace('@1','/v1')+'/parameters',
    resultSchemaRef:'helix://contracts/capabilities/'+capabilityRef.replace('@1','/v1')+'/result',resourceDemandSchemaRef:'resources',fenceSchemaRef:'fence'}});
  const p=planner.createExternalMaterialPlanner(f.options),plan=p.plan(request(importWork));
  return {...f,scope,acquire,importWork,p,plan};
}
test('Series Import Plan schedules every file and verifies only after all imports and probes',()=>{
  const f=importFixture(),nodes=f.plan.nodes,imports=nodes.filter(item=>item.capabilityRef==='libra.workspace.material.import@1'),
    probes=nodes.filter(item=>item.capabilityRef==='shared.material.media.probe@1'),verifications=nodes.filter(item=>item.capabilityRef==='libra.product_media.verify@1');
  assert.equal(nodes.length,8);assert.equal(new Set(nodes.map(item=>item.eventId)).size,8);
  assert.equal(imports.length,2);assert.equal(verifications.length,2);
  const other=importFixture(1),paths=imports.map(node=>node.inputBindings.bindings.find(item=>item.portName==='workspaceDeliveryContract').value.targetRelativePath),
    otherPaths=other.plan.nodes.filter(item=>item.capabilityRef==='libra.workspace.material.import@1')
      .map(node=>node.inputBindings.bindings.find(item=>item.portName==='workspaceDeliveryContract').value.targetRelativePath);
  assert.ok(paths.every(path=>!otherPaths.includes(path)&&path.startsWith('external/'+f.scope.scopeDigest+'/')));

  for(const node of verifications){
    assert.deepEqual(new Set(node.dependsOn.map(item=>item.eventId)),new Set([...imports,...probes].map(item=>item.eventId)));
    assert.deepEqual(node.inputBindings.bindings[0].parameters.replacementScope,f.scope);
  }
  const rows=f.records.get(f.acquire.workId),changed=rows.map(item=>item.capabilityRef==='libra.external_material.package.verify@1'
    ?{...item,result:{...item.result,episodeDeliveryManifestDigest:digest('other-range')}}:item);
  f.records.set(f.acquire.workId,changed);assert.throws(()=>f.p.plan(request(f.importWork)),/exact verified replacement Package/);
});
test('Series import projection binds exact Events and evaluates shared files plus parts as one set',()=>{
  const f=importFixture(),binding=f.plan.nodes.find(item=>item.capabilityRef==='libra.product_media.verify@1').inputBindings.bindings[0],
    parameters=binding.parameters,projection=planner.createExternalMaterialProjections().find(item=>item.projectionRef===planner.IMPORTED_CANDIDATE).projection;
  const sourceResults=parameters.seriesImportMembers.flatMap((item,index)=>{
    const handle={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,handleId:digest('handle'+index),
      workspaceId:'workspace',ownerDomain:'libra',processId:'run',endpointId:'endpoint',materialKey:digest('material'+index),
      physicalIdentity:{mountScopeId:'mount',inode:String(index),fingerprintAlgorithm:'middle-256k-sha256',contentFingerprint:digest(index)},
      rootHandleRef:digest('root'),relativePath:item.contract.targetRelativePath,digestAlgorithm:'sha256',digestHex:digest(index),
      sizeBytes:item.source.episodeClaims.length===2?80:30,referenceRevision:1,accessScope:'workspace_material_read',fenceDigest:digest('fence'+index)};
    const body={schemaRef:'helix://contracts/types/MediaProbeEvidence/v1',schemaVersion:1,evidenceId:digest('probe'+index),resultKind:'probed',container:'matroska',durationMs:1000,
      sourceHandleDigest:d(handle),videoStreams:[{streamIndex:0,codec:'hevc',dispositionDefault:true,width:1920,height:1080,
        dynamicRangeKind:'sdr',bitDepth:8,pixelFormat:'yuv420p'}],audioStreams:[],subtitleStreams:[]},probe={...body,payloadDigest:d(body)};
    return [{eventId:item.importEventId,resultSchemaRef:'helix://contracts/capabilities/libra.workspace.material.import/v1/result',result:handle},
      {eventId:item.probeEventId,resultSchemaRef:'helix://contracts/capabilities/shared.material.media.probe/v1/result',result:probe}];
  });
  const input=projection.project({sourceResults,parameters});assert.equal(input.seriesSpaceBasis.members.length,2);
  const allocations=require('../../src/helix/contracts/episode-byte-allocation').evaluateSeriesEpisodeSpace({episodeKeys:f.scope.episodeKeys,maxSizeBytes:60,
    members:input.seriesSpaceBasis.members.map(item=>({...item,role:'primary_payload',episodeClaims:item.episodeKeys.map(episodeKey=>({episodeKey}))}))});
  assert.deepEqual(allocations.map(item=>[item.episodeKey,item.allocatedBytes.numerator,item.withinLimit]),[['E1','70',false],['E2','40',true]]);
  for(const cap of [60,70]){
    const spec={...f.value.spec,requirements:{...f.value.spec.requirements,space:{unit:'episode',maxSizeBytes:cap,maxSizeGiB:cap/1073741824}}};
    const candidate=projection.project({sourceResults,parameters:{...parameters,mediaRequirement:buildMediaRequirement(spec)}});
    const verified=require('../../src/helix/domains/libra/model/media-production-contracts').buildProductMediaVerification({input:candidate,
      verifiedAtMs:0,playbackVerification:{samplePointsPercent:[5,50,95],passedSamplePointsPercent:[5,50,95],decodeDigest:digest('decode')}});
    assert.equal(verified.result,cap===60?'failed':'passed');
    assert.deepEqual(verified.reasonCodes,cap===60?['max_size_exceeded']:[]);
  }

  for(const sources of [sourceResults.slice(1),[sourceResults[0],...sourceResults.slice(0,-1)],
    sourceResults.map((item,index)=>index===1?{...item,eventId:'foreign-event'}:item),
    sourceResults.map((item,index)=>index===1?{...item,result:{...item.result,sourceHandleDigest:digest('other')}}:item)])
    assert.throws(()=>projection.project({sourceResults:sources,parameters}));
});
