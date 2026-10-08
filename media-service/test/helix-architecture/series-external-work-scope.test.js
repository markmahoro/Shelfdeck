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
    claimDigest:digest(episodeKey)}));
  return {run:{libraRunId:'run',subjectId:'subject',executionBasisDigest:digest('run'),acceptanceSpecId:'spec',priorityClass:'normal'},
    spec:{schemaRef:'libra.acceptance-spec@1',schemaVersion:1,specRevision:1,acceptanceSpecId:'spec',recordDigest:digest('spec'),
      contentProfile:'series',structureKind:'season',productScope:{episodeKeys:episodeClaims.map(item=>item.episodeKey)},
      requirements:{mandatoryMedia:{mediaForm:'stream_file',videoCodec:'hevc',container:'matroska',fileExtension:'mkv',
        minimumRasterClass:'none',acceptedPrimaryAudioClasses:[],forbidSystemUpscaleFor4k:true},
      space:{unit:'episode',maxSizeGiB:null,maxSizeBytes:null}}},episodeClaims,
    members:[{materialKey:'shared',role:'primary_payload',outputRequirementDigest:digest('requirement-shared'),episodeClaims:episodeClaims.slice(0,2)},
      {materialKey:'part',role:'primary_payload',outputRequirementDigest:digest('requirement-part'),episodeClaims:episodeClaims.slice(0,1)},
      {materialKey:'other',role:'primary_payload',outputRequirementDigest:digest('requirement-other'),episodeClaims:episodeClaims.slice(2)}]};
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
    assert.deepEqual(planner.episodeDelivery(value,scope).episodeClaims.map(({outputRequirementDigest,...claim})=>claim),
      value.episodeClaims.filter(item=>scope.episodeKeys.includes(item.episodeKey)));
    assert.throws(()=>planner.episodeDelivery({...value,episodeClaims:[]},scope),/exact frozen Episode/);
  }
});
test('Episode delivery binds all original requirements independently of member order',()=>{
  const value=snapshot();
  const delivery=value=>planner.episodeDelivery(value,work.replacementScopes(value).find(scope=>scope.episodeKeys.includes('E1')));
  const actual=delivery(value);
  assert.equal(actual.episodeClaims[0].outputRequirementDigest,d({schema:'libra.episode-delivery-requirements@1',episodeKey:'E1',
    items:[{materialKey:'part',outputRequirementDigest:digest('requirement-part')},
      {materialKey:'shared',outputRequirementDigest:digest('requirement-shared')}]}));
  assert.equal(actual.episodeClaims[1].outputRequirementDigest,d({schema:'libra.episode-delivery-requirements@1',episodeKey:'E2',
    items:[{materialKey:'shared',outputRequirementDigest:digest('requirement-shared')}]}));
  assert.deepEqual(delivery({...value,members:[...value.members].reverse()}),actual);
  for(const property of ['materialKey','outputRequirementDigest']) {
    const changed=structuredClone(value);changed.members[1][property]=property==='materialKey'?'renamed-part':digest('changed');
    const result=delivery(changed);
    assert.notEqual(result.episodeClaims[0].outputRequirementDigest,actual.episodeClaims[0].outputRequirementDigest);
    assert.equal(result.episodeClaims[1].outputRequirementDigest,actual.episodeClaims[1].outputRequirementDigest);
    assert.equal(result.episodeClaims[0].claimDigest,actual.episodeClaims[0].claimDigest);
  }
  const unrelated=structuredClone(value);unrelated.members[2].outputRequirementDigest=digest('unrelated');
  assert.deepEqual(delivery(unrelated).episodeClaims,actual.episodeClaims);
  const fakeEpisodeRequirement=structuredClone(value);
  fakeEpisodeRequirement.episodeClaims.forEach(claim=>{claim.outputRequirementDigest=digest('not-formal');});
  assert.deepEqual(delivery(fakeEpisodeRequirement).episodeClaims,actual.episodeClaims);
});
test('Episode delivery refuses invalid original requirements and missing or duplicate coverage',()=>{
  for(const invalid of [undefined,null,'', 'BAD', 'A'.repeat(64)]) {
    const value=snapshot();value.members[1].outputRequirementDigest=invalid;
    if(invalid===undefined)delete value.members[1].outputRequirementDigest;
    assert.throws(()=>planner.episodeDelivery(value,work.replacementScopes(value).find(scope=>scope.episodeKeys.includes('E1'))),/formal Requirement digests/);
  }
  const duplicate=snapshot();duplicate.members.push({...duplicate.members[0]});
  assert.throws(()=>planner.episodeDelivery(duplicate,work.replacementScopes(duplicate)[0]));
  const missing=snapshot();missing.members=missing.members.filter(member=>member.materialKey==='other');
  assert.throws(()=>planner.episodeDelivery(missing,work.replacementScopes(snapshot()).find(scope=>scope.episodeKeys.includes('E1'))));
});
test('Movie delivery has no Episode requirements or Season scope',()=>{
  const value=snapshot();value.spec.contentProfile='movie';value.spec.structureKind='single';value.episodeClaims=[];
  const result=planner.episodeDelivery(value);
  assert.deepEqual(result.episodeClaims,[]);assert.equal(result.seasonScopeDigest,null);
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
  const sourceResults=importSourceResults(parameters);
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

function importSourceResults(parameters){
  return parameters.seriesImportMembers.flatMap((item,index)=>{
    const handle={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,handleId:digest('handle'+index),
      workspaceId:'workspace',ownerDomain:'libra',processId:'run',endpointId:'endpoint',materialKey:digest('material'+index),
      physicalIdentity:{mountScopeId:'mount',inode:String(index),sizeBytes:item.source.episodeClaims.length===2?80:30,fingerprintVersion:1,fingerprintAlgorithm:'middle-256k-sha256',contentFingerprint:digest(index)},
      rootHandleRef:digest('root'),relativePath:item.contract.targetRelativePath,digestAlgorithm:'sha256',digestHex:digest(index),
      sizeBytes:item.source.episodeClaims.length===2?80:30,referenceRevision:1,accessScope:'workspace_material_read',fenceDigest:digest('fence'+index)};
    const body={schemaRef:'helix://contracts/types/MediaProbeEvidence/v1',schemaVersion:1,evidenceId:digest('probe'+index),resultKind:'probed',container:'matroska',durationMs:1000,
      sourceHandleDigest:d(handle),videoStreams:[{streamIndex:0,codec:'hevc',dispositionDefault:true,width:1920,height:1080,
        dynamicRangeKind:'sdr',bitDepth:8,pixelFormat:'yuv420p'}],audioStreams:[],subtitleStreams:[]},probe={...body,payloadDigest:d(body)};
    return [{eventId:item.importEventId,resultSchemaRef:'helix://contracts/capabilities/libra.workspace.material.import/v1/result',result:handle},
      {eventId:item.probeEventId,resultSchemaRef:'helix://contracts/capabilities/shared.material.media.probe/v1/result',result:probe}];
  });
}

function completedImportFixture(unmetCodec=false){
  const f=importFixture(),binding=f.plan.nodes.find(item=>item.capabilityRef==='libra.product_media.verify@1').inputBindings.bindings[0],
    sources=importSourceResults(binding.parameters),projections=new Map(planner.createExternalMaterialProjections().map(item=>[item.projectionRef,item.projection])),
    production=require('../../src/helix/domains/libra/model/media-production-contracts'),results=new Map(sources.map(item=>[item.eventId,item.result]));
  if(unmetCodec){
    const probe=sources.find(item=>item.resultSchemaRef.includes('shared.material.media.probe')).result;
    probe.videoStreams[0].codec='h264';delete probe.payloadDigest;probe.payloadDigest=d(probe);
  }
  for(const node of f.plan.nodes){
    const inputBinding=node.inputBindings.bindings[0];
    if(node.capabilityRef==='libra.product_media.verify@1'){
      const input=projections.get(inputBinding.projectionRef).project({sourceResults:sources,parameters:inputBinding.parameters});
      results.set(node.eventId,production.buildProductMediaVerification({input,verifiedAtMs:0,
        playbackVerification:{samplePointsPercent:[5,50,95],passedSamplePointsPercent:[5,50,95],decodeDigest:digest('decode')}}));
    }else if(node.capabilityRef==='libra.product_output.select@1'){
      const input=projections.get(inputBinding.projectionRef).project({sourceResult:results.get(inputBinding.eventId),parameters:inputBinding.parameters});
      results.set(node.eventId,production.selectProductOutput({input,producedAtMs:0}));
    }
  }
  const rows=f.plan.nodes.map(node=>({workId:f.importWork.workId,attemptId:request(f.importWork).workAttemptId,planId:f.plan.planId,
    planDigest:d(f.plan),planRevision:1,eventId:node.eventId,capabilityRef:node.capabilityRef,state:'succeeded',outcomeKind:'succeeded',
    resultSchemaRef:node.outputContractRef,resultId:'result-'+node.eventId,result:results.get(node.eventId),resultDigest:d(results.get(node.eventId)),
    inputBindings:node.inputBindings,inputBindingDigest:d(node.inputBindings)}));
  const reader={status:id=>({state:'succeeded',basis_digest:(id===f.importWork.workId?f.importWork:f.acquire).executionBasisDigest,
    latestAttempt:{attempt_id:request(id===f.importWork.workId?f.importWork:f.acquire).workAttemptId}}),
    readDefinition:()=>({definition:f.importWork,definitionDigest:d(f.importWork)}),
    read:id=>id===f.importWork.workId?rows:f.records.get(id).map(row=>({...row,workId:id,
      attemptId:request(f.acquire).workAttemptId,resultDigest:d(row.result)}))};
  return {...f,rows,reader};
}
test('Series external consumer reconstructs every result and produces complete source-to-final mappings',()=>{
  const f=completedImportFixture(),read=require('../../src/helix/domains/libra/planning/series-external-import-results').readSeriesExternalImportSet;
  const result=read({snapshot:f.value,scope:f.scope,workResultReader:f.reader});
  assert.equal(result.eligible,true);assert.equal(result.members.length,2);
  const materialKeys=result.members.map(item=>item.importRecord.result.materialKey).sort();
  assert.deepEqual(result.mapping.members.map(item=>item.finalProductMaterialKeys),[materialKeys,materialKeys]);
  const shuffled={...f.reader,read:id=>id===f.importWork.workId?[...f.rows].reverse():f.reader.read(id)};
  assert.deepEqual(read({snapshot:f.value,scope:f.scope,workResultReader:shuffled}),result);
  assert.equal(read({snapshot:f.value,scope:f.scope,workResultReader:{...f.reader,status:()=>({state:'running'})}}),null);
});
test('Series external consumer rejects incomplete, foreign and recomputed but false successful Results',()=>{
  const f=completedImportFixture(),read=require('../../src/helix/domains/libra/planning/series-external-import-results').readSeriesExternalImportSet;
  const mutations=[rows=>rows.map((row,index)=>index?row:{...row,state:'completed'}),rows=>rows.slice(1),rows=>[...rows,rows[0]],rows=>rows.map((row,index)=>index?row:{...row,attemptId:'foreign'}),
    rows=>rows.map((row,index)=>index?row:{...row,planId:'foreign'}),rows=>rows.map((row,index)=>index?row:{...row,workId:'foreign'}),
    rows=>rows.map(row=>row.capabilityRef==='libra.product_media.verify@1'?{...row,result:{...row.result,result:'failed'}}:row),
    rows=>rows.map(row=>{if(row.capabilityRef!=='libra.product_media.verify@1')return row;
      const result={...row.result,result:'failed',reasonCodes:['max_size_exceeded']};return {...row,result,resultDigest:d(result)};}),
    rows=>rows.map(row=>{if(row.capabilityRef!=='libra.product_media.verify@1')return row;
      const inputBindings=structuredClone(row.inputBindings);inputBindings.bindings[0].parameters.replacementScope.episodeKeys=['E3'];
      return {...row,inputBindings,inputBindingDigest:d(inputBindings)};})];
  for(const mutate of mutations)assert.throws(()=>read({snapshot:f.value,scope:f.scope,workResultReader:{...f.reader,read:id=>id===f.importWork.workId?mutate(f.rows):f.reader.read(id)}}));
  assert.throws(()=>read({snapshot:f.value,scope:f.scope,workResultReader:{...f.reader,
    readDefinition:()=>({definition:{...f.importWork,idempotencyKey:'wrong'},definitionDigest:d({...f.importWork,idempotencyKey:'wrong'})})}}));
  assert.throws(()=>read({snapshot:f.value,scope:f.scope,workResultReader:{...f.reader,
    read:id=>id===f.importWork.workId?f.rows:f.reader.read(id).map(row=>({...row,workId:'other-scope'}))}}));
});

test('Completed external execution with a failed media requirement remains ineligible',()=>{
  const f=completedImportFixture(true),read=require('../../src/helix/domains/libra/planning/series-external-import-results').readSeriesExternalImportSet;
  const result=read({snapshot:f.value,scope:f.scope,workResultReader:f.reader});
  assert.equal(result.eligible,false);assert.equal(result.members.filter(item=>!item.eligible).length,1);
  assert.ok(result.members.some(item=>item.verificationRecord.result.reasonCodes.includes('video_codec_unmet')));
});

test('Series candidate merge replaces the whole component and retains unrelated qualified files',()=>{
  const f=completedImportFixture(),set=require('../../src/helix/domains/libra/planning/series-external-import-results')
    .readSeriesExternalImportSet({snapshot:f.value,scope:f.scope,workResultReader:f.reader}),
    merge=require('../../src/helix/domains/libra/planning/series-external-candidate-merge'),
    final=require('../../src/helix/domains/libra/planning/series-production-candidates');
  const handle={...set.members[0].importRecord.result,materialKey:'retained',handleId:digest('retained-handle'),sizeBytes:20},
    probeBody={...set.members[0].probeRecord.result,sourceHandleDigest:d(handle)};delete probeBody.payloadDigest;
  const probe={...probeBody,payloadDigest:d(probeBody)};
  const original=f.value.members.map(member=>({member,readHandle:handle,record:{result:probe},probeRecord:{result:probe},
    media:null,work:{workId:'internal'},verification:{result:'passed'},selection:{result:'selected'},eligible:true}));
  const retained=original.find(item=>item.member.materialKey==='other'),merged=merge.mergeSeriesExternalCandidates(f.value,original,[set]);
  assert.equal(merged.length,3);assert.equal(merged.find(item=>item.member.materialKey==='other'),retained);
  assert.ok(!merged.some(item=>['shared','part'].includes(item.member.materialKey)));
  const space=merge.completeSeriesCandidateSpace(f.value,merged);assert.deepEqual(space.episodeKeys,['E1','E2','E3']);
  const targets=merge.seriesExternalOffloadTargets(f.value,merged);
  const keys=set.mapping.finalMembers.map(item=>item.materialKey);
  assert.deepEqual(Object.keys(targets).sort(),['part','shared']);
  assert.deepEqual(targets.shared,{finalProductMaterialKeys:keys});
  assert.deepEqual(targets.part,{finalProductMaterialKeys:keys});
  assert.equal(targets.other,undefined);
  const singleMember=set.members.find(item=>item.externalMember.episodeClaims.length===2);
  const singleMapping=require('../../src/helix/domains/libra/model/series-external-replacement').buildSeriesReplacementMapping({
    basis:work.replacementBasis(f.value),scope:set.scope,finalMembers:[{materialKey:singleMember.importRecord.result.materialKey,
      memberDigest:d({externalMember:singleMember.externalMember,workspaceMediaHandle:singleMember.workspaceMediaHandle}),
      episodeKeys:singleMember.externalMember.episodeClaims.map(claim=>claim.episodeKey)}]});
  const singleCandidates=merge.mergeSeriesExternalCandidates(f.value,original,[{...set,members:[singleMember],mapping:singleMapping}]);
  assert.deepEqual(merge.seriesExternalOffloadTargets(f.value,singleCandidates).shared,
    {finalProductMaterialKey:singleMember.importRecord.result.materialKey});

  assert.ok(Object.isFrozen(targets.shared.finalProductMaterialKeys));
  assert.throws(()=>merge.seriesExternalOffloadTargets(f.value,merged.slice(1)));
  const changedMapping=merged.map(item=>item.externalReplacement?{...item,externalReplacement:{...item.externalReplacement,
    mapping:{...item.externalReplacement.mapping,members:item.externalReplacement.mapping.members.map(row=>({...row,finalProductMaterialKeys:keys.slice(0,1)}))}}}:item);
  assert.throws(()=>merge.seriesExternalOffloadTargets(f.value,changedMapping),/frozen replacement mapping/);
  const candidate=merged.find(item=>item.externalReplacement),input=final.finalCandidateInput(f.value,merged,candidate);
  assert.equal(input.seriesSpaceBasis.members.length,3);
  assert.deepEqual(input.seriesSpaceBasis,space);
  assert.equal(input.workspaceMediaHandle,candidate.media);
  {
  const resolve=require('../../src/helix/domains/libra/planning/shelf-acceptance-workspace-source').workspaceAcceptanceSourceMember;
  const port={resolveMaterialLocation:handle=>'/workspace/'+handle.materialKey},records=set.members.map(item=>item.importRecord),probe=candidate.probeRecord.result;
  const source=resolve(f.value,records,probe,port);
  assert.equal(source.location,'/workspace/'+candidate.member.materialKey);assert.equal(source.endpointId,candidate.readHandle.endpointId);
  assert.equal(source.bindingRevision,candidate.readHandle.referenceRevision);assert.equal(source.materialKey,candidate.member.materialKey);
  assert.equal(source.physicalIdentity.materialKey,candidate.member.materialKey);
  assert.throws(()=>resolve(f.value,[...records,candidate.mediaRecord],probe,port),/one exact/);
  assert.throws(()=>resolve(f.value,[],probe,port),/one exact/);
  const foreign={...candidate.readHandle,processId:'other-run'},foreignRow={...candidate.mediaRecord,result:foreign};
  assert.throws(()=>resolve(f.value,[foreignRow],{...probe,sourceHandleDigest:d(foreign)},port),/selected Run/);
  const noRevision={...candidate.readHandle,referenceRevision:undefined};delete noRevision.referenceRevision;
  assert.throws(()=>resolve(f.value,[{...candidate.mediaRecord,result:noRevision}],{...probe,sourceHandleDigest:d(noRevision)},port),/selected Run/);

  }
  assert.throws(()=>merge.completeSeriesCandidateSpace(f.value,merged.filter(item=>item!==retained)),/complete frozen Run/);
  const drifted=merged.map(item=>item===candidate?{...item,media:{...item.media,sourceMaterialHandleDigest:digest('changed')}}:item);
  assert.throws(()=>merge.completeSeriesCandidateSpace(f.value,drifted),/frozen replacement mapping/);
  const changedRun={...f.value,run:{...f.value.run,executionBasisDigest:digest('changed-run')}};
  assert.throws(()=>merge.completeSeriesCandidateSpace(changedRun,merged),/frozen connected component/);

  assert.throws(()=>merge.mergeSeriesExternalCandidates(f.value,original,[set,set]),/overlap/);
  assert.throws(()=>merge.mergeSeriesExternalCandidates(f.value,original,[{...set,eligible:false}]),/ineligible/);
  const missing=merged.filter(item=>item!==candidate);
  assert.throws(()=>final.candidateSetDigest(missing),/omit an external member/);
  assert.throws(()=>final.candidateSetDigest([...merged,original.find(item=>item.member.materialKey==='part')]),/retain a replaced original/);
  assert.throws(()=>merge.mergeSeriesExternalCandidates(f.value,original.slice(1),[set]),/complete original/);
});

test('Series external coordinator advances one frozen Scope in order and attaches exact imported Claims',()=>{
  const f=completedImportFixture(),advance=require('../../src/helix/domains/libra/application/series-external-scope-coordinator').advanceSeriesExternalScope,
    submitted=[],attached=[],ports={reader:f.reader,submit:work=>{submitted.push(work);return {replayed:true};},
      result:(_work,capability)=>({result:{result:capability.includes('candidate')?'selected':'passed'}}),
      terminal:()=>{throw new Error('unexpected terminal');},freeze:()=>{throw new Error('unexpected freeze');},
      attach:(handle,claims)=>attached.push({handle,claims})};
  assert.equal(advance(f.value,{workspaceId:'workspace'},f.scope,ports).kind,'series_external_ready');
  assert.deepEqual(submitted.map(item=>item.workId),[work.externalSearchSelectionWork(f.value,f.scope).workId,f.acquire.workId,f.importWork.workId]);
  assert.equal(attached.length,2);
  for(const item of attached){const imported=f.rows.find(row=>row.capabilityRef==='libra.workspace.material.import@1'&&row.result.handleId===item.handle.handleId);
    assert.equal(item.handle,imported.result);assert.ok(item.claims.length>0);assert.ok(item.claims.every(claim=>f.scope.episodeKeys.includes(claim.episodeKey)));}
  assert.deepEqual(attached.map(item=>item.claims.length).sort(),[1,2]);
});
test('Series external coordinator stops at each pending or failed stage without launching successors',()=>{
  const f=completedImportFixture(),advance=require('../../src/helix/domains/libra/application/series-external-scope-coordinator').advanceSeriesExternalScope,
    works=[work.externalSearchSelectionWork(f.value,f.scope),f.acquire,f.importWork];
  for(let index=0;index<3;index++)for(const state of ['running','failed','cancelled']){
    const submitted=[],ports={reader:{...f.reader,status:id=>id===works[index].workId?{state}:f.reader.status(id)},
      submit:item=>{submitted.push(item.workId);return {replayed:true};},result:(_w,c)=>({result:{result:c.includes('candidate')?'selected':'passed'}}),
      terminal:()=>({kind:'terminal'}),freeze:()=>{throw new Error('unexpected freeze');},attach:()=>{throw new Error('premature attachment');}};
    assert.equal(advance(f.value,{workspaceId:'workspace'},f.scope,ports).kind,state==='running'?'pending':'terminal');
    assert.equal(submitted.length,index+1);
  }
});
test('Series external coordinator freezes failed imported media without attaching or selecting a partial set',()=>{
  const f=completedImportFixture(true),advance=require('../../src/helix/domains/libra/application/series-external-scope-coordinator').advanceSeriesExternalScope;
  let frozen;
  const result=advance(f.value,{workspaceId:'workspace'},f.scope,{reader:f.reader,submit:()=>({replayed:true}),
    result:(_w,c)=>({result:{result:c.includes('candidate')?'selected':'passed'}}),terminal:()=>{throw new Error('unexpected terminal');},
    freeze:(work,row,reason)=>{frozen={work,row,reason};return {kind:'frozen'};},attach:()=>{throw new Error('ineligible attachment');}});
  assert.equal(result.kind,'frozen');assert.equal(frozen.work.workId,f.importWork.workId);
  assert.equal(frozen.row.capabilityRef,'libra.product_media.verify@1');assert.equal(frozen.reason,'video_codec_unmet');
});

test('Series external coordinator does not acquire or import after a rejected predecessor result',()=>{
  const f=completedImportFixture(),advance=require('../../src/helix/domains/libra/application/series-external-scope-coordinator').advanceSeriesExternalScope;
  for(const rejected of ['candidate','package']){
    let count=0;
    const result=advance(f.value,{workspaceId:'workspace'},f.scope,{reader:f.reader,submit:()=>{count++;return {replayed:true};},
      result:(_work,capability)=>({result:{result:capability.includes(rejected)?'rejected':capability.includes('candidate')?'selected':'passed',reasonCodes:['rejected_evidence']}}),
      terminal:()=>{throw new Error('unexpected terminal');},freeze:()=>({kind:'frozen'}),attach:()=>{throw new Error('rejected attachment');}});
    assert.equal(result.kind,'frozen');assert.equal(count,rejected==='candidate'?1:2);
  }
});
