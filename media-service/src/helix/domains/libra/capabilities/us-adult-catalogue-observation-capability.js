'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {CAPABILITY,resultRef,assertObservationHandle}=require('../../../contracts/us-adult-catalogue-work-types');
const {readCompletedCatalogueBatches}=require('../model/us-adult-catalogue-work-results');
const {catalogueObservationWork}=require('../model/us-adult-catalogue-observation-work');
const {catalogueObservationTarget,assertCatalogueObservationSource,buildCatalogueObservationHandle,
  readCatalogueObservationArtifact}=require('../model/us-adult-catalogue-observation-result');
function fail(message){throw Object.assign(new Error(message),{code:'US_ADULT_CATALOGUE_OBSERVATION_INPUT_INVALID'});}
function createUsAdultCatalogueObservationCapability(options){
  if(!options?.usAdultCatalogueStore||!options.movieProductionReader||!options.workResultReader||!options.contractValidator||
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
  return Object.freeze({validateInputs:state,validateResult,async execute(context){
    const current=state(context),port=options.createCatalogueObservationPort({...current,context,
      validateObservation:observation=>assertCatalogueObservationSource({...state(context),observation,validator:options.contractValidator})}),
      published=await port.observe(current),result=buildCatalogueObservationHandle({...current,observation:published.observation,
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
