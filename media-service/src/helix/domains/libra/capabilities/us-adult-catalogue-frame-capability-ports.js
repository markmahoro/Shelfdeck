'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {FRAME,EMBED,CLUSTER,resultRef,exactResult}=require('../model/us-adult-analysis-work');
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
      typeof context.assertExecutionActive!=='function')fail('The frame capability requires its live Libra execution authority.');
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
  function record(work,ref){
    const result=exactResult(options,work,ref);options.contractValidator.validate(resultRef(ref),result.result);return result.result;
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
        equal(input.artifactHandleList,[record(work,FRAME).frameSetArtifactHandle]);equal(input.faceModelRef,basis.faceModelRef);break;
      case CLUSTER:
        equal(input.faceEmbeddingSetHandle,record(work,EMBED));equal(input.clusterParameters,basis.clusterParameters);break;
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
        if(value.dimension!==512||value.sourceArtifactSetDigest!==record(work,FRAME).manifestDigest)fail('Embedding Result changed feature space or source frames.');
      }else if(value.sourceEmbeddingDigest!==record(work,EMBED).embeddingDigest||value.clusterParameterDigest!==basis.clusterParameters.digest)
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
  return Object.freeze(Object.fromEntries(REFS.map(ref=>[ref,Object.freeze({
    validateInputs(context){exactPort(ref,context);return validate(context);},
    validateResult(context,outcome){exactPort(ref,context);return validateResult(context,outcome);},
    async execute(context){
      exactPort(ref,context);
      const {basis,batch,work}=validate(context),port=options.createCatalogueFramePort({context,basis,batch}),input=context.namedInputs;let result;
      if(ref===FRAME)result=await port.extractFrames({sourceHandle:input.physicalMaterialReadHandleOrWorkspaceMaterialHandle,
        samplingPlan:input.samplingPlan,outputTarget:input.workspaceArtifactOutputTarget});
      else if(ref===EMBED)result=await port.computeEmbeddings({frameArtifactSet:record(work,FRAME),faceModelRef:input.faceModelRef});
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
  })])));
}
module.exports=Object.freeze({createUsAdultCatalogueFrameCapabilityPorts});
