'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {FRAME,EMBED,CLUSTER,resultRef}=require('../model/us-adult-analysis-work');
const {exactCatalogueResult}=require('../model/us-adult-catalogue-work-results');
const {catalogueFrameBatch,catalogueFrameWork}=require('../model/us-adult-catalogue-frame-work');
const {buildWorkspaceFrameTarget}=require('../model/workspace-frame-target');
const REFS=Object.freeze([FRAME,EMBED,CLUSTER]);
function fail(message){throw Object.assign(new Error(message),{code:'US_ADULT_CATALOGUE_FRAME_INPUT_INVALID'});}
function equal(value,expected){if(canonicalJson(value)!==canonicalJson(expected))fail('The input differs from its exact frozen frame batch or durable producer Result.');}
function createUsAdultCatalogueFrameCapabilityPorts(options){
  if(!options?.usAdultCatalogueStore||!options.movieProductionReader||!options.workResultReader||!options.contractValidator||
    typeof options.createCatalogueFramePort!=='function')throw new TypeError('Catalogue frame execution requires live Libra storage, formal results and its scoped Artifact adapter.');
  const now=options.now||Date.now;
  function state(context){
    if(context.ownerScope?.domain!=='libra'||context.ownerScope.processType!=='libra_run'||!REFS.includes(context.capabilityRef)||
      typeof context.assertExecutionActive!=='function'||typeof context.workAttemptId!=='string'||!context.workAttemptId||
      typeof context.planId!=='string'||!context.planId)fail('The frame capability requires its live Libra execution authority.');
    context.assertExecutionActive();
    const historical=options.usAdultCatalogueStore.getByRun(context.ownerScope.processId);
    if(!historical)fail('The Run has no frozen catalogue Basis.');
    const basis=options.usAdultCatalogueStore.readForExecution({libraRunId:context.ownerScope.processId,expectedBasisDigest:historical.basisDigest}),
      snapshot=options.movieProductionReader.readRunSnapshot(basis.libraRunId),stage=['initial','supplement'].find(value=>catalogueFrameWork(snapshot,basis,value)?.workId===context.workId);
    if(!stage||!Array.isArray(context.basisRefs)||context.basisRefs.length!==1||context.basisRefs[0].basisType!=='execution_basis'||
      context.basisRefs[0].basisId!==context.workId||context.basisRefs[0].revision!==1||
      context.basisRefs[0].digest!==basis.runExecutionBasisDigest)fail('The capability belongs to another Work or execution basis.');
    return {basis,batch:catalogueFrameBatch(basis,stage),work:catalogueFrameWork(snapshot,basis,stage)};
  }
  function record(work,ref,context){
    return exactCatalogueResult(options,work,ref,{workAttemptId:context.workAttemptId,planId:context.planId}).result;
  }
  function validate(context){
    const current=state(context),{basis,batch,work}=current,input=context.namedInputs;
    switch(context.capabilityRef){
      case FRAME:
        equal(input.physicalMaterialReadHandleOrWorkspaceMaterialHandle,basis.sourceHandle);equal(input.samplingPlan,batch.samplingPlan);
        equal(input.workspaceArtifactOutputTarget,buildWorkspaceFrameTarget({basis,workspace:options.movieProductionReader.readWorkspace(basis.workspaceId),
          rootSnapshot:options.workspaceProductPort.rootSnapshot(),samplingPlan:batch.samplingPlan,
          targetRelativePath:'analysis/catalogue/'+basis.analysisId+'/'+batch.stage+'-'+batch.batchDigest+'.json'}));break;
      case EMBED:
        equal(input.artifactHandleList,[record(work,FRAME,context).frameSetArtifactHandle]);equal(input.faceModelRef,basis.faceModelRef);break;
      case CLUSTER:
        equal(input.faceEmbeddingSetHandle,record(work,EMBED,context));equal(input.clusterParameters,basis.clusterParameters);break;
    }
    return current;
  }
  function validateResult(context,outcome){
    const {basis,batch,work}=state(context),value=outcome.result;
    options.contractValidator.validate(resultRef(context.capabilityRef),value);
    if(value.libraRunId!==basis.libraRunId||value.workspaceId!==basis.workspaceId)fail('Frame analysis Result crossed its exact Run or Workspace.');
    if(context.capabilityRef===FRAME){
      const {manifestDigest,publishedAtMs,...manifest}=value;
      if(value.frameCount!==batch.points.length||value.sourceMaterialDigest!==canonicalDigest(basis.sourceHandle)||
        value.samplingPlanDigest!==batch.samplingPlan.digest||canonicalDigest(manifest)!==manifestDigest||value.memberCount!==1||
        value.membersDigest!==canonicalDigest({schema:'libra.western-frame-artifact-set@1',items:[value.frameSetArtifactHandle]}))
        fail('The frame Result is not the complete frozen batch.');
    }else{
      const {handleDigest,...handle}=value;
      if(canonicalDigest(handle)!==handleDigest||value.faceModelRefDigest!==basis.faceModelRef.digest)fail('The face Result lost its exact model or canonical Handle.');
      if(context.capabilityRef===EMBED){
        if(value.dimension!==512||value.sourceArtifactSetDigest!==record(work,FRAME,context).manifestDigest)fail('Embedding Result changed feature space or source frames.');
      }else if(value.sourceEmbeddingDigest!==record(work,EMBED,context).embeddingDigest||value.clusterParameterDigest!==basis.clusterParameters.digest)
        fail('Grouping Result changed its exact embedding source or policy.');
    }
    const artifact=context.capabilityRef===FRAME?value.frameSetArtifactHandle:value.artifactHandle;
    if(artifact.ownerDomain!=='libra'||artifact.ownerScope.scopeType!=='libra_run'||artifact.ownerScope.scopeId!==basis.libraRunId||
      artifact.artifactKind!=={[FRAME]:'western_frame_set',[EMBED]:'face_embedding_set',[CLUSTER]:'face_cluster_set'}[context.capabilityRef]||
      context.capabilityRef!==FRAME&&(artifact.artifactHandleId!==value.artifactHandleId||
        artifact.digestHex!==(context.capabilityRef===EMBED?value.embeddingDigest:value.clusterDigest)))
      fail('The producer Artifact belongs to another responsibility.');
  }
  function exactPort(ref,context){if(context.capabilityRef!==ref)fail('The execution context selected another Capability port.');}
  function captureFence(context){
    if(typeof options.unitOfWork?.captureReadFence!=='function')fail('Catalogue frame publication requires an Owner read fence.');
    const fence=options.unitOfWork.captureReadFence();validate(context);return fence;
  }
  function recoveryScope(recovery){
    const {effect,event,node,work,attempt}=recovery||{},ref=event?.capability_ref;
    if(!REFS.includes(ref)||!effect||effect.effect_class!=='workspace_write'||effect.state!=='reconcile_required'||
      !event||event.state!=='executing'||event.owner_domain!=='libra'||!node||node.capability_ref!==ref||
      !work||work.work_id!==event.work_id||work.owner_domain!=='libra'||work.process_type!=='libra_run'||
      !['ready','running'].includes(work.state)||!attempt||attempt.event_id!==event.event_id||
      effect.event_attempt_id!==attempt.event_attempt_id||attempt.executor_ref!==ref)
      fail('Frame recovery requires the exact active Owner Work, Event and Effect.');
    const context={capabilityRef:ref,ownerScope:{domain:'libra',processType:'libra_run',processId:work.process_id},
      workId:work.work_id,workAttemptId:event.attempt_id,planId:event.plan_id,eventId:event.event_id,
      eventAttemptId:attempt.event_attempt_id,idempotencyKey:effect.idempotency_key,recoveryDecision:'continue_forward',
      basisRefs:[{basisType:'execution_basis',basisId:work.work_id,revision:1,digest:work.basis_digest}],assertExecutionActive(){}};
    const current=state(context),{basis,batch,work:expectedWork}=current;let bindings,fence;
    try{bindings=JSON.parse(node.input_bindings_json);fence=JSON.parse(node.fence_basis_json);}catch{fail('Frame recovery Plan bindings are not JSON.');}
    if(!Array.isArray(bindings?.bindings)||work.work_id!==expectedWork.workId||work.basis_digest!==basis.runExecutionBasisDigest||
      fence?.basisDigest!==basis.runExecutionBasisDigest||fence.inputSetDigest!==canonicalDigest(bindings.bindings)||
      fence.eventFenceDigest!==canonicalDigest({schema:'libra.catalogue-frame-event-fence@1',eventId:event.event_id,workId:work.work_id,batchDigest:batch.batchDigest})||
      fence.effectScopeDigest!==canonicalDigest({schema:'libra.catalogue-frame-effect-scope@1',eventId:event.event_id,
        analysisId:basis.analysisId,batchDigest:batch.batchDigest,capabilityRef:ref})||
      canonicalDigest(fence)!==attempt.fence_snapshot_digest||effect.intent_digest!==canonicalDigest({eventId:event.event_id,
        capabilityRef:ref,contractVersion:event.contract_version,inputSnapshotDigest:attempt.input_snapshot_digest,
        fenceSnapshotDigest:attempt.fence_snapshot_digest}))fail('Frame recovery lost its frozen Plan, fence or Effect intent.');
    let frameArtifactSet=null;
    if(ref===FRAME)context.namedInputs={physicalMaterialReadHandleOrWorkspaceMaterialHandle:basis.sourceHandle,samplingPlan:batch.samplingPlan,
      workspaceArtifactOutputTarget:buildWorkspaceFrameTarget({basis,workspace:options.movieProductionReader.readWorkspace(basis.workspaceId),
        rootSnapshot:options.workspaceProductPort.rootSnapshot(),samplingPlan:batch.samplingPlan,
        targetRelativePath:'analysis/catalogue/'+basis.analysisId+'/'+batch.stage+'-'+batch.batchDigest+'.json'})};
    else if(ref===EMBED){frameArtifactSet=record(expectedWork,FRAME,context);context.namedInputs={artifactHandleList:[frameArtifactSet.frameSetArtifactHandle],faceModelRef:basis.faceModelRef};}
    else context.namedInputs={faceEmbeddingSetHandle:record(expectedWork,EMBED,context),clusterParameters:basis.clusterParameters};
    if(canonicalDigest(context.namedInputs)!==attempt.input_snapshot_digest)fail('Frame recovery inputs differ from the original Event Attempt.');
    validate(context);return {...current,context,frameArtifactSet};
  }
  async function observeEffectReality(recovery){
    const effectId=recovery?.effect?.effect_id||null,eventId=recovery?.event?.event_id||null;
    function result(status,code,extra={}){return Object.freeze({status,cleanupDeclared:false,evidenceDigest:canonicalDigest({
      schema:'libra.us-adult-catalogue-frame-recovery@1',effectId,eventId,status,code,...extra})});}
    try{
      const scope=recoveryScope(recovery),{context,basis,batch,frameArtifactSet}=scope,
        port=options.createCatalogueFramePort({context,basis,batch,recoveryFacts:recovery,capturePublicationFence:()=>captureFence(context)}),
        input=context.namedInputs;
      if(typeof port.inspectRecovery!=='function')return result('unobservable','PORT_UNAVAILABLE');
      const candidate=await port.inspectRecovery({capabilityRef:context.capabilityRef,sourceHandle:input.physicalMaterialReadHandleOrWorkspaceMaterialHandle,
        samplingPlan:input.samplingPlan,outputTarget:input.workspaceArtifactOutputTarget,frameArtifactSet,faceModelRef:input.faceModelRef,
        faceEmbeddingSetHandle:input.faceEmbeddingSetHandle,clusterParameters:input.clusterParameters});
      const after=recoveryScope(recovery);if(after.batch.batchDigest!==batch.batchDigest)fail('The frame batch changed during recovery inspection.');
      if(candidate.kind==='matching')return result('matching','VERIFIED',{batchDigest:batch.batchDigest,artifactDigest:candidate.digestHex});
      return result(candidate.kind==='absent'?'absent':'conflict',candidate.kind==='absent'?'ABSENT':'REGISTRY_CONFLICT',{batchDigest:batch.batchDigest});
    }catch(error){
      const code=typeof error?.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(error.code)?error.code:'RECOVERY_READ_FAILED',
        invalid=/^(US_ADULT_CATALOGUE_.*(INVALID|STALE)|BUFFALO_.*INVALID|CLEAN_WESTERN_.*INVALID|CLEAN_WORKSPACE_.*(INVALID|STALE|BYTE_LIMIT|REALITY_DRIFT))$/.test(code);
      return result(invalid?'conflict':'unobservable',code);
    }
  }
  return Object.freeze(Object.fromEntries(REFS.map(ref=>[ref,Object.freeze({
    validateInputs(context){exactPort(ref,context);return validate(context);},
    validateResult(context,outcome){exactPort(ref,context);return validateResult(context,outcome);},
    async execute(context){
      exactPort(ref,context);
      const {basis,batch,work}=validate(context),port=options.createCatalogueFramePort({context,basis,batch,
        capturePublicationFence:()=>captureFence(context)}),input=context.namedInputs;let result;
      if(ref===FRAME)result=await port.extractFrames({sourceHandle:input.physicalMaterialReadHandleOrWorkspaceMaterialHandle,
        samplingPlan:input.samplingPlan,outputTarget:input.workspaceArtifactOutputTarget});
      else if(ref===EMBED)result=await port.computeEmbeddings({frameArtifactSet:record(work,FRAME,context),faceModelRef:input.faceModelRef});
      else result=await port.computeClusters({faceEmbeddingSetHandle:input.faceEmbeddingSetHandle,clusterParameters:input.clusterParameters});
      validateResult(context,{result});
      const digest=canonicalDigest(result),id=canonicalDigest({eventId:context.eventId,resultDigest:digest}).slice(0,40),at=now();
      return {kind:'succeeded',resultSchemaRef:resultRef(ref),result,evidenceSchemaRef:resultRef(ref).replace(/\/result$/,'/evidence'),
        evidence:{evidenceId:'catalogue-frame-evidence-'+id,evidenceKind:'us_adult_analysis',producerRef:ref,
          basisDigest:basis.basisDigest,payloadDigest:digest,observedAtMs:at},
        effectReceipt:{schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,effectReceiptId:'catalogue-frame-effect-'+id,
          effectId:canonicalDigest(['workspace_write',context.idempotencyKey]),effectClass:'workspace_write',idempotencyKey:context.idempotencyKey,
          commitMarker:'catalogue-frame-marker-'+id,externalReceiptRef:null,outputDigest:digest,verificationEvidenceDigest:digest,committedAtMs:at}};
    },
    observeEffectReality,
  })])));
}
module.exports=Object.freeze({createUsAdultCatalogueFrameCapabilityPorts});
