'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {CAPABILITY,resultRef,assertObservationHandle}=require('../../../contracts/us-adult-catalogue-work-types');
const {readCompletedCatalogueBatches}=require('../model/us-adult-catalogue-work-results');
const {catalogueObservationWork}=require('../model/us-adult-catalogue-observation-work');
const {catalogueObservationTarget,assertCatalogueObservationSource,buildCatalogueObservationHandle,
  readCatalogueObservationArtifact}=require('../model/us-adult-catalogue-observation-result');
const {currentObservationScope,observationTarget,observationBindings}=require('../model/us-adult-catalogue-observation-scope');
function fail(message){throw Object.assign(new Error(message),{code:'US_ADULT_CATALOGUE_OBSERVATION_INPUT_INVALID'});}
function createUsAdultCatalogueObservationCapability(options){
  if(!options?.usAdultCatalogueStore||!options.movieProductionReader||!options.workResultReader||!options.contractValidator||
    typeof options.unitOfWork?.captureReadFence!=='function'||
    typeof options.createCatalogueObservationPort!=='function')throw new TypeError('Catalogue execution requires live Libra storage and a scoped Observation publisher.');
  const now=options.now||Date.now;
  function state(context){
    if(context.capabilityRef!==CAPABILITY||context.ownerScope?.domain!=='libra'||context.ownerScope.processType!=='libra_run'||
      typeof context.assertExecutionActive!=='function'||typeof context.workAttemptId!=='string'||!context.workAttemptId||!context.planId)
      fail('Catalogue execution requires its exact live Owner and Capability context.');
    context.assertExecutionActive();
    const historical=options.usAdultCatalogueStore.getByRun(context.ownerScope.processId);if(!historical)fail('No frozen catalogue Basis exists.');
    const basis=options.usAdultCatalogueStore.readForExecution({libraRunId:context.ownerScope.processId,expectedBasisDigest:historical.basisDigest}),
      snapshot=options.movieProductionReader.readRunSnapshot(basis.libraRunId),input=context.namedInputs;
    if(!input||Object.keys(input).sort().join(',')!=='usAdultCatalogueAnalysisBasis,usAdultCatalogueCompletedBatchSet,workspaceArtifactOutputTarget')
      fail('The catalogue Capability input ports are not closed.');
    const completedBatches=readCompletedCatalogueBatches(options,snapshot,basis,input.usAdultCatalogueCompletedBatchSet?.mode),
      work=catalogueObservationWork({snapshot,basis,completedBatches,validator:options.contractValidator}),
      outputTarget=catalogueObservationTarget({basis,completedBatches,workspace:options.movieProductionReader.readWorkspace(basis.workspaceId),
        rootSnapshot:options.workspaceProductPort.rootSnapshot()});
    if(context.workId!==work.workId||!Array.isArray(context.basisRefs)||context.basisRefs.length!==1||
      context.basisRefs[0].basisType!=='execution_basis'||context.basisRefs[0].basisId!==context.workId||context.basisRefs[0].revision!==1||
      context.basisRefs[0].digest!==basis.runExecutionBasisDigest||canonicalJson(input.usAdultCatalogueAnalysisBasis)!==canonicalJson(basis)||
      canonicalJson(input.usAdultCatalogueCompletedBatchSet)!==canonicalJson(completedBatches)||canonicalJson(input.workspaceArtifactOutputTarget)!==canonicalJson(outputTarget))
      fail('Catalogue input lost its exact Work, execution basis, completed sources or output target.');
    return {basis,snapshot,completedBatches,outputTarget};
  }
  function validateResult(context,outcome){
    const current=state(context),handle=outcome.result;
    options.contractValidator.validate(resultRef(CAPABILITY),handle);
    assertObservationHandle(handle,{validator:options.contractValidator});
    readCatalogueObservationArtifact({...current,validator:options.contractValidator,handle,
      bytes:options.workspaceProductPort.readArtifactBytes(handle.observationArtifactHandle).bytes});
  }
  function recoveryScope(context){
    const {effect,event,node,work,attempt}=context||{};
    if(!effect||!event||!node||!work||!attempt||effect.effect_class!=='workspace_write'||effect.state!=='reconcile_required'||
      effect.event_attempt_id!==attempt.event_attempt_id||event.event_id!==attempt.event_id||event.capability_ref!==CAPABILITY||
      event.owner_domain!=='libra'||event.state!=='executing'||node.capability_ref!==CAPABILITY||work.work_id!==event.work_id||
      work.owner_domain!=='libra'||work.process_type!=='libra_run'||!['ready','running'].includes(work.state))
      fail('Recovery requires the exact active catalogue Event, Effect and Owner Work.');
    let bindings,fence;try{bindings=JSON.parse(node.input_bindings_json);fence=JSON.parse(node.fence_basis_json);}catch{fail('Recovery Plan bindings are not valid JSON.');}
    const parameters=bindings?.bindings?.[0]?.parameters;
    if(!parameters||Object.keys(parameters).sort().join(',')!=='analysisId,basisDigest,completedBatchSetDigest,mode')
      fail('Recovery requires its closed frozen catalogue projection parameters.');
    const scope=currentObservationScope(options,work.process_id,parameters.mode,parameters.basisDigest),target=observationTarget(options,scope),
      expectedBindings={schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:observationBindings(scope)},
      namedInputs={usAdultCatalogueAnalysisBasis:scope.basis,usAdultCatalogueCompletedBatchSet:scope.completedBatches,workspaceArtifactOutputTarget:target};
    if(work.work_id!==scope.work.workId||work.basis_digest!==scope.basis.runExecutionBasisDigest||
      parameters.analysisId!==scope.basis.analysisId||parameters.completedBatchSetDigest!==scope.completedBatches.setDigest||
      canonicalJson(bindings)!==canonicalJson(expectedBindings)||canonicalDigest(namedInputs)!==attempt.input_snapshot_digest||
      canonicalDigest(fence)!==attempt.fence_snapshot_digest||effect.intent_digest!==canonicalDigest({eventId:event.event_id,
        capabilityRef:CAPABILITY,contractVersion:event.contract_version,inputSnapshotDigest:attempt.input_snapshot_digest,
        fenceSnapshotDigest:attempt.fence_snapshot_digest}))
      fail('Recovery cannot change the frozen Work, Plan inputs, fence or Effect intent.');
    return {...scope,outputTarget:target};
  }
  function observeEffectReality(context){
    const effectId=context?.effect?.effect_id||null,eventId=context?.event?.event_id||null;
    function result(status,code,extra={}){return Object.freeze({status,cleanupDeclared:false,evidenceDigest:canonicalDigest({
      schema:'libra.us-adult-catalogue-recovery-observation@1',effectId,eventId,status,code,...extra})});}
    try{
      if(typeof options.workspaceProductPort.readCatalogueRecoveryCandidate!=='function')return result('unobservable','PORT_UNAVAILABLE');
      const scope=recoveryScope(context),{basis,completedBatches,outputTarget}=scope,effect=context.effect,attempt=context.attempt,
        candidate=options.workspaceProductPort.readCatalogueRecoveryCandidate({libraRunId:basis.libraRunId,workspaceId:basis.workspaceId,
          relativePath:outputTarget.targetRelativePath,artifactKind:'face_catalogue_observation',mediaType:'application/vnd.shelfdeck.face-catalogue-observation+json',
          analysisId:basis.analysisId,mode:completedBatches.mode,provenanceRef:{objectType:'us_adult_catalogue_observation',
            objectId:completedBatches.setDigest,revision:1,digest:outputTarget.targetDigest},effectId:effect.effect_id,
          eventAttemptId:attempt.event_attempt_id,idempotencyKey:effect.idempotency_key,executionBasisDigest:basis.runExecutionBasisDigest,
          inputSnapshotDigest:attempt.input_snapshot_digest,fenceSnapshotDigest:attempt.fence_snapshot_digest});
      if(candidate.kind==='absent')return result('absent','ABSENT',{targetDigest:outputTarget.targetDigest});
      if(candidate.kind!=='present')return result('conflict','REGISTRY_CONFLICT',{targetDigest:outputTarget.targetDigest});
      let observation;try{observation=JSON.parse(candidate.bytes.toString('utf8'));}catch{return result('conflict','INVALID_JSON',{targetDigest:outputTarget.targetDigest});}
      if(!Buffer.from(canonicalJson(observation)).equals(candidate.bytes)||canonicalDigest(observation)!==candidate.digestHex)
        return result('conflict','BYTE_DRIFT',{targetDigest:outputTarget.targetDigest});
      assertCatalogueObservationSource({...scope,observation,validator:options.contractValidator});
      const after=recoveryScope(context);
      if(after.completedBatches.setDigest!==completedBatches.setDigest||after.outputTarget.targetDigest!==outputTarget.targetDigest)
        fail('The catalogue Owner scope changed during recovery observation.');
      return result('matching','VERIFIED',{targetDigest:outputTarget.targetDigest,artifactDigest:candidate.digestHex,observationDigest:observation.observationDigest});
    }catch(error){
      const code=typeof error?.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(error.code)?error.code:'RECOVERY_READ_FAILED',
        invalid=/^(US_ADULT_CATALOGUE_.*INVALID|US_ADULT_CATALOGUE_BASIS_STALE|BUFFALO_.*INVALID|P4_CAPABILITY_SCHEMA_REJECTED|CLEAN_WORKSPACE_.*(INVALID|STALE|BYTE_LIMIT|REALITY_DRIFT))$/.test(code);
      return result(invalid?'conflict':'unobservable',code);
    }
  }
  function isCatalogueOpenFailure(error){
    const code=typeof error?.code==='string'?error.code:'';
    return code==='BUFFALO_CATALOGUE_OPEN_FAILED'||code==='SQLITE_CANTOPEN'||code.startsWith('SQLITE_CANTOPEN')||
      code==='SQLITE_READONLY'||code==='SQLITE_READONLY_DIRECTORY'||code.startsWith('SQLITE_READONLY');
  }
  return Object.freeze({validateInputs:state,validateResult,observeEffectReality,async execute(context){
    const current=state(context),port=options.createCatalogueObservationPort({...current,context,
      capturePublicationFence:()=>{const fence=options.unitOfWork.captureReadFence();state(context);return fence;},
      validateObservation:observation=>assertCatalogueObservationSource({...state(context),observation,validator:options.contractValidator})});
    let published;
    try{published=await port.observe(current);}
    catch(error){
      // Catalogue open failures are permanent for this Attempt: do not leave the
      // workspace_write Effect in reconcile/retry storm (production SQLITE_CANTOPEN).
      if(!isCatalogueOpenFailure(error))throw error;
      const code=typeof error.code==='string'&&error.code?error.code:'BUFFALO_CATALOGUE_OPEN_FAILED';
      return Object.freeze({kind:'failed',failureClass:'integration',code,
        message:'The offline face catalogue performers database could not be opened.',
        retryDirective:'never',evidence:Object.freeze({stage:'catalogue_open',errorCode:code,
          basisDigest:current.basis.basisDigest,libraRunId:current.basis.libraRunId})});
    }
    const result=buildCatalogueObservationHandle({...current,observation:published.observation,
        artifactHandle:published.artifactHandle,validator:options.contractValidator});
    validateResult(context,{result});
    const digest=canonicalDigest(result),id=canonicalDigest({eventId:context.eventId,resultDigest:digest}).slice(0,40),at=now();
    return {kind:'succeeded',resultSchemaRef:resultRef(CAPABILITY),result,evidenceSchemaRef:resultRef(CAPABILITY).replace(/\/result$/,'/evidence'),
      evidence:{evidenceId:'catalogue-observation-evidence-'+id,evidenceKind:'us_adult_analysis',producerRef:CAPABILITY,
        basisDigest:current.basis.basisDigest,payloadDigest:digest,observedAtMs:at},
      effectReceipt:{schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,effectReceiptId:'catalogue-observation-effect-'+id,
        effectId:canonicalDigest(['workspace_write',context.idempotencyKey]),effectClass:'workspace_write',idempotencyKey:context.idempotencyKey,
        commitMarker:'catalogue-observation-marker-'+id,externalReceiptRef:null,outputDigest:digest,verificationEvidenceDigest:digest,committedAtMs:at}};
  }});
}
function createUsAdultCatalogueObservationRegistration({manifest,port}){
  if(manifest.capabilityRef!==CAPABILITY||manifest.effectClass!=='workspace_write'||!port)
    throw new TypeError('Catalogue registration requires its exact declared Capability and Effect class.');
  return Object.freeze({manifest,executor:{version:1,execute:context=>port.execute(context)},semanticValidator:{ref:manifest.semanticValidatorRef,
    validateInputs:context=>port.validateInputs(context),validateResult:(context,outcome)=>port.validateResult(context,outcome)}});
}
module.exports=Object.freeze({createUsAdultCatalogueObservationCapability,createUsAdultCatalogueObservationRegistration});
