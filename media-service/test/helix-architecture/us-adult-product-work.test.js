'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {harness}=require('./fixtures/us-adult-analysis-context');
const {setup}=require('./fixtures/us-adult-cast-context');
const {proof}=require('./fixtures/us-adult-match-proof');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {buildCompletion}=require('../../src/helix/domains/libra/model/us-adult-match-completion');
const {FRAME,EMBED,CLUSTER,frameWork,resultRef}=require('../../src/helix/domains/libra/model/us-adult-analysis-work');
const {REQUEST,OBSERVE,NORMALIZE,POSTER,readActorContext,productWork,frameInputs,analysisSpec,analysisVariant,metadataBasis}=require('../../src/helix/domains/libra/model/us-adult-product-work');
const {createUsAdultProductPlanner}=require('../../src/helix/domains/libra/planning/us-adult-product-planner');
const {createUsAdultProductCapabilityPorts,createUsAdultProductCapabilityRegistrations}=require('../../src/helix/domains/libra/capabilities/us-adult-product-capability-ports');
const {createUsAdultProductCoordinator}=require('../../src/helix/domains/libra/application/us-adult-product-coordinator');
const {createCapabilityRegistry}=require('../../src/helix/foundation/capability/capability-registry');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {validateWorkflowPlan}=require('../../src/helix/foundation/execution/workflow-plan');
const {createCleanWesternAnalysisPort}=require('../../src/clean-western-analysis-port');
const {createUsAdultAnalysisEngine}=require('../../src/helix/integrations/us-adult-analysis-engine');
const {buildProductFactSourceRefs}=require('../../src/helix/domains/libra/model/product-fact-contracts');
const {productMetadataContext,createArtifactProductionPlanner,sidecarMediaCastDraft}=require('../../src/helix/domains/libra/planning/libra-production-planners');
function prepare({manual=true,noFaces=true}={}){return harness(input=>{
  const owner=setup(input);if(manual)owner.command.choose('run-1',owner.choiceBody,'admin');
  let choice=owner.store.current('subject-1');
  const snapshot={...input.snapshot,spec:{...input.snapshot.spec,requirements:{metadata:{requiredFieldCodes:['actor','title'],requiredArtifactKinds:['nfo','poster'],requireRenderableSidecar:true},inventory:{}}}},
    identity=JSON.parse(input.db.prepare("SELECT fact_json FROM libra_product_fact_revisions WHERE fact_kind='resolved_identity'").get().fact_json),
    basis=input.basis,completion=buildCompletion(proof(input,{noFaces})),records=new Map(),statuses=new Map(),files=new Map(),
    workspace={workspaceId:basis.workspaceId,libraRunId:'run-1',state:'active',currentRevision:1,stateDigest:D('workspace-state'),workspaceScopeDigest:D('scope')},
    root=input.decision.platformWorkspaceRootSnapshot;
  function artifact(kind,payload){
    const bytes=Buffer.from(canonicalJson(payload)),digest=crypto.createHash('sha256').update(bytes).digest('hex'),id=kind+'-'+digest,
      value={schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId:id,artifactKind:kind,ownerDomain:'libra',
        ownerScope:{scopeType:'libra_run',scopeId:'run-1'},storageRef:'fixture:'+id,digestAlgorithm:'sha256',digestHex:digest,sizeBytes:bytes.length,
        mediaType:'application/json',provenanceRef:{objectType:kind,objectId:id,revision:1,digest},referenceRevision:1};
    files.set(id,bytes);return value;
  }
  const frames={schemaRef:'helix://contracts/types/FrameArtifactSet/v1',schemaVersion:1,manifestId:'frame-manifest',manifestKind:'western_frame_artifact_set',
    ownerDomain:'libra',memberCount:1,membersDigest:D('frame-members'),manifestDigest:D('frames'),publishedAtMs:1,libraRunId:'run-1',workspaceId:basis.workspaceId,
    sourceMaterialDigest:D(basis.sourceHandle),samplingPlanDigest:basis.samplingPlan.digest,outputTargetDigest:D('frame-target'),frameCount:20,
    frameMemberSetDigest:D('twenty-frames'),frameSetArtifactHandle:artifact('western_frame_set',{schema:'fixture-unread-frames'})},
    feature=artifact('face_embedding_set',{schema:'shared.face-embedding-set@1',dimension:128,vectors:[]}),
    embeddingValue={schemaRef:'helix://contracts/types/FaceEmbeddingSetHandle/v1',schemaVersion:1,artifactHandleId:feature.artifactHandleId,artifactHandle:feature,
      computationMode:'western_frame_set',libraRunId:'run-1',workspaceId:basis.workspaceId,faceModelRefDigest:basis.faceModelRef.digest,
      sourceArtifactSetDigest:frames.manifestDigest,detectedFaceCount:0,vectorCount:0,dimension:128,embeddingDigest:feature.digestHex},
    embedding={...embeddingValue,handleDigest:D(embeddingValue)},clusters=artifact('face_cluster_set',{schema:'shared.face-cluster-set@1',clusters:[]}),
    clusterValue={schemaRef:'helix://contracts/types/FaceClusterSetHandle/v1',schemaVersion:1,artifactHandleId:clusters.artifactHandleId,artifactHandle:clusters,
      libraRunId:'run-1',workspaceId:basis.workspaceId,faceModelRefDigest:basis.faceModelRef.digest,clusterParameterDigest:basis.clusterParameters.digest,
      sourceEmbeddingDigest:embedding.embeddingDigest,clusterCount:0,clusterDigest:clusters.digestHex},cluster={...clusterValue,handleDigest:D(clusterValue)},
    result=(work,capabilityRef,value,inputBindings={schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[]})=>({
      workId:work.workId,attemptId:work.workId+'-attempt',planId:work.workId+'-plan',eventId:work.workId+'-'+capabilityRef,
      resultId:work.workId+'-'+capabilityRef+'-result',capabilityRef,outcomeKind:'succeeded',resultSchemaRef:resultRef(capabilityRef),
      result:value,resultDigest:D(value),inputBindings,inputBindingDigest:D(inputBindings)}),framesWork=frameWork(snapshot,basis);
  records.set(framesWork.workId,[[FRAME,frames],[EMBED,embedding],[CLUSTER,cluster]].map(([cap,value])=>result(framesWork,cap,value)));
  if(completion.winner)records.set(completion.winner.matchResultRef.workId,proof(input,{noFaces}).results.filter(row=>row.workId===completion.winner.matchResultRef.workId));
  const options={movieProductionReader:{readRunSnapshot:()=>snapshot,readFact:()=>({factValue:identity}),readWorkspace:()=>workspace},
    usAdultAnalysisStore:{getByRun:()=>basis},usAdultActorChoiceStore:{current:()=>choice},usAdultMatchCompletionStore:{getByRun:()=>completion},
    workResultReader:{read:id=>records.get(id)||[],status:id=>({state:statuses.get(id)||'succeeded'}),
      listWorks:query=>[...records.keys()].filter(id=>query.workKind==='us_adult_product'&&/^libra-us-adult-(analysis|normalize)-work-/.test(id))
        .map(work_id=>({work_id,state:statuses.get(work_id)||'succeeded'}))},
    workspaceProductPort:{rootSnapshot:()=>root},now:()=>20};
  const workspacePort={materializeArtifact(request){
    const value=artifact(request.artifactKind,JSON.parse(request.bytes.toString('utf8')));
    return {artifactHandle:{...value,mediaType:request.mediaType,provenanceRef:request.provenanceRef}};
  },recoverMaterializedArtifact:()=>null,openFrameCompositeSink(){throw new Error('No extraction in product fixture.');},
    readArtifactBytes:handle=>({bytes:files.get(handle.artifactHandleId)})};
  options.createUsAdultAnalysisPort=({context,basis:analysisBasis,actorPresentation})=>{
    const engine=createUsAdultAnalysisEngine({context:{...context,assertExecutionActive(){}},actorPresentation,
      frameExtractor:{extract(){throw new Error('No extraction in product fixture.');}},faceModel:{analyzeImage(){throw new Error('No inference in product fixture.');}},
      referencePort:{readReferenceEmbedding(){throw new Error('No matching in product fixture.');},readReferenceImage(){throw new Error('No poster rendering in product fixture.');}}});
    return createCleanWesternAnalysisPort({workspaceProductPort:workspacePort,engine,
      configuration:{faceModelRef:analysisBasis.faceModelRef,clusterParameters:analysisBasis.clusterParameters},now:options.now});
  };
  const refs=[REQUEST,OBSERVE,NORMALIZE,POSTER],ports=createUsAdultProductCapabilityPorts(options),manifests=Object.fromEntries(refs.map(ref=>[ref,
    require('../../src/helix/contracts/capabilities/'+ref.replaceAll('.','/').replace('@1','/v1/manifest.json'))])),
    registry=createCapabilityRegistry({registrations:createUsAdultProductCapabilityRegistrations({manifests,ports}),expectedCapabilityRefs:refs}),
    schemas=[...require('../../src/helix/domains/libra/application/western-analysis-plan-schema-graph'),
      require('../../src/helix/contracts/domain-types/LibraProductMetadataSourceBasisMetadataObservationWesternAnalysis/v1/schema.json'),
      ...refs.flatMap(ref=>['parameters','resource-demand','fence'].map(kind=>require('../../src/helix/contracts/capabilities/'+ref.replaceAll('.','/').replace('@1','/v1/')+kind+'.schema.json')))],
    validator=createCapabilityContractValidator({schemas}),planning={...options,registry,policyRegistry:{digest:D('policy'),bindingFor:()=>({retryPolicyRef:'retry',timeoutPolicyRef:'timeout'})}},
    planner=createUsAdultProductPlanner(planning);
  return {options,records,statuses,result,ports,planning,planner,validator,snapshot,identity,basis,completion,framesWork,
    clearChoice(){choice=null;},replaceChoice(record){choice=record;},choice};
});}
function execution(work,node,namedInputs){return {ownerScope:{domain:'libra',processType:'libra_run',processId:'run-1'},workId:work.workId,
  capabilityRef:node.capabilityRef,eventId:node.eventId,idempotencyKey:node.eventId+'-key',namedInputs};}
test('formal US product plans freeze actor/original metadata and exact request-to-observation dependency',()=>{
  const h=prepare(),context=readActorContext(h.options,'run-1'),work=productWork(context,'analysis'),plan=h.planner.plan({...work,workAttemptId:'product-attempt'});
  assert.deepEqual(plan.nodes.map(node=>node.capabilityRef),[REQUEST,OBSERVE]);
  assert.equal(validateWorkflowPlan(plan,{...h.planning,contractValidator:h.validator}).plan.planId,plan.planId);
  for(const node of plan.nodes){
    const input=Object.fromEntries(node.inputBindings.bindings.filter(binding=>binding.bindingKind==='literal').map(binding=>[binding.portName,binding.value]));
    if(node.capabilityRef===REQUEST)h.validator.validate(node.inputBindingsSchemaRef,input);
  }
  assert.equal(context.actorPresentation.originalName.originalFileName,'Original source.mkv');
  assert.equal(context.actorPresentation.canonicalName,'actor-1');
  const frames=frameInputs(h.options,context),spec=analysisSpec(context,frames);
  h.validator.validate(spec.schemaRef,spec);assert.equal(spec.typedParameters.find(item=>item.parameter==='actor_selection_digest').value,context.selection.selectionDigest);
  h.clearChoice();assert.throws(()=>h.planner.plan({...work,workAttemptId:'old-attempt'}),/selected actor/);
});
test('no-face manual actor produces formally typed analysis and normalized metadata with exact durable provenance',async()=>{
  const h=prepare(),context=readActorContext(h.options,'run-1'),work=productWork(context,'analysis'),plan=h.planner.plan({...work,workAttemptId:'analysis-attempt'}),all=[];
  for(const node of plan.nodes){
    const input=Object.fromEntries(node.inputBindings.bindings.map(binding=>[binding.portName,binding.bindingKind==='literal'?binding.value:all[0].result]));
    h.validator.validate(node.inputBindingsSchemaRef,input);
    const scope=execution(work,node,input),outcome=await h.ports[node.capabilityRef].execute(scope);
    h.ports[node.capabilityRef].validateResult(scope,outcome);h.validator.validate(outcome.result.schemaRef,outcome.result);
    all.push({...h.result(work,node.capabilityRef,outcome.result,node.inputBindings),eventId:node.eventId,evidence:outcome.evidence});
    h.records.set(work.workId,[...all]);
  }
  const normalizedWork=productWork(context,'normalize'),normalizedPlan=h.planner.plan({...normalizedWork,workAttemptId:'normalize-attempt'}),node=normalizedPlan.nodes[0];
  assert.equal(validateWorkflowPlan(normalizedPlan,{...h.planning,contractValidator:h.validator}).plan.planId,normalizedPlan.planId);
  const input={westernAnalysisVariant:node.inputBindings.bindings[0].value},scope=execution(normalizedWork,node,input),outcome=await h.ports[NORMALIZE].execute(scope);
  h.ports[NORMALIZE].validateResult(scope,outcome);h.validator.validate(outcome.result.schemaRef,outcome.result);
  const normalized={...h.result(normalizedWork,NORMALIZE,outcome.result,node.inputBindings),eventId:node.eventId,evidence:outcome.evidence};h.records.set(normalizedWork.workId,[normalized]);
  const entries=new Map(outcome.result.descriptiveFacts.entries.map(item=>[item.key,item.value]));
  assert.equal(entries.get('title'),'actor-1 Original source');assert.equal(entries.get('original_file_name'),'Original source.mkv');
  assert.deepEqual(outcome.result.providerIdentities,[]);assert.equal(outcome.result.fieldProvenance.every(item=>item.sourceKind==='western_analysis'),true);
  const metadata=productMetadataContext(h.options,'run-1');assert.equal(metadata.draft.draftDigest,outcome.result.draftDigest);
  assert.equal(sidecarMediaCastDraft(metadata).relations[0].personId,'actor-1');
  const variant=analysisVariant(context,all[1]),basis=metadataBasis(context,all[1],normalized,variant),
    chains=[all[1],normalized].map(row=>({...row,ownerDomain:'libra',processType:'libra_run',processId:'run-1',workState:'succeeded',attemptState:'succeeded',
      planState:'planned',eventState:'succeeded',eventOwnerDomain:'libra',attemptWorkId:row.workId,planAttemptId:row.attemptId,
      eventWorkId:row.workId,eventAttemptId:row.attemptId,eventPlanId:row.planId,eventResultId:row.resultId,nodeCapabilityRef:row.capabilityRef}));
  h.validator.validate('helix://contracts/domain-types/LibraProductMetadataSourceBasisMetadataObservationWesternAnalysis/v1',basis);
  assert.equal(buildProductFactSourceRefs({sourceBasis:basis,productFactId:'metadata-fact',productMetadataDraft:outcome.result,foundationChains:chains}).length,2);
  const changed=structuredClone(chains);changed[1].inputBindings.bindings[0].value.resolvedIdentityDigest=D('substituted');changed[1].inputBindingDigest=D(changed[1].inputBindings);
  assert.throws(()=>buildProductFactSourceRefs({sourceBasis:basis,productFactId:'metadata-fact',productMetadataDraft:outcome.result,foundationChains:changed}));
  // The Artifact plan must use the shared US renderer, never a Provider image request.
  const artifactRefs=['libra.product_sidecar.render@1','shared.artifact.manifest.verify@1'],catalog=Object.fromEntries(artifactRefs.map(ref=>[ref,
    require('../../src/helix/contracts/capabilities/'+ref.replaceAll('.','/').replace('@1','/v1/manifest.json'))])),
    registry={...h.planning.registry,resolve(ref,owner){return catalog[ref]?{manifest:catalog[ref]}:h.planning.registry.resolve(ref,owner);}},
    artifactPlan=createArtifactProductionPlanner({...h.planning,registry}).plan({ownerDomain:'libra',processType:'libra_run',processId:'run-1',workId:'artifact-work',workAttemptId:'artifact-attempt',executionBasisDigest:h.basis.runExecutionBasisDigest});
  assert.deepEqual(artifactPlan.nodes.filter(item=>!item.nodeId.startsWith('artifact_verify')).map(item=>item.capabilityRef),['libra.product_sidecar.render@1',POSTER]);
});
test('unmatched film waits in the existing workshop and a first actor choice continues its original Run',()=>{
  const h=prepare({manual:false}),admitted=[],options={...h.options,peopleReferenceQuery:{},submit(work){admitted.push(work);return {replayed:false};}},
    coordinator=createUsAdultProductCoordinator(options),workspace={libraRunId:'run-1'},waiting=coordinator.reconcile(h.snapshot,{factValue:h.identity},workspace);
  assert.equal(waiting.kind,'waiting_product_identity');assert.equal(waiting.phase,'us_adult_actor_confirmation');assert.equal(admitted.length,0);
  const chosen=prepare();h.replaceChoice(chosen.choice);
  const current=readActorContext(h.options,'run-1'),analysis=productWork(current,'analysis');h.statuses.set(analysis.workId,'queued');
  const continued=coordinator.reconcile(h.snapshot,{factValue:h.identity},workspace);
  assert.equal(continued.kind,'pending');assert.equal(continued.libraRunId,'run-1');assert.equal(admitted[0].workId,analysis.workId);
  h.records.set('libra-us-adult-analysis-work-previous-actor',[]);
  const replaced=coordinator.reconcile(h.snapshot,{factValue:h.identity},workspace);
  assert.equal(replaced.kind,'replacement_required');assert.equal(replaced.actorChoiceIntentId,chosen.choice.intentId);
});
