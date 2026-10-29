'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {assertCatalogueAnalysisBasis}=require('./us-adult-catalogue-analysis-basis');
const {samplingPoints}=require('./us-adult-catalogue-sampling');
const {CLUSTER,resultRef}=require('./us-adult-analysis-work');
function fail(message){throw Object.assign(new TypeError(message),{code:'US_ADULT_CATALOGUE_BATCH_INVALID'});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function parameters(values){return Object.keys(values).sort().map(parameter=>{
  const value={parameter,valueType:Number.isSafeInteger(values[parameter])?'integer':'string',value:values[parameter]};
  return {...value,valueDigest:canonicalDigest(value)};
});}
// Batch construction is deterministic input compilation. Only the Libra
// coordinator may decide whether a completed initial assessment needs more data.
function catalogueFrameBatch(basis,stage){
  assertCatalogueAnalysisBasis(basis);
  if(!['initial','supplement'].includes(stage))fail('A frame batch requires its exact bounded stage.');
  const sampled=samplingPoints(basis.durationMs),points=sampled[stage];
  if(!points.length)return null;
  const offset=stage==='initial'?0:sampled.initial.length,items=points.map((point,compositeOrdinal)=>({
    ordinal:offset+compositeOrdinal,compositeOrdinal,...point}));
  const workspaceByteBudget=Math.floor((basis.resourceBudget.maximumWorkspaceBytes-basis.representativeImagePolicy.maximumOutputBytes)/2);
  if(workspaceByteBudget<1)fail('The Workspace budget cannot hold both bounded frame batches and one representative image.');
  const plan={contractId:canonicalDigest({schema:'libra.us-adult-catalogue-frame-plan-id@1',basisDigest:basis.basisDigest,stage}),revision:1,
    schemaRef:'helix://contracts/domain-types/SamplingPlan/v1',intervalMs:basis.samplingPlan.intervalMs,maxFrames:items.length,
    frameProfileDigest:basis.samplingPlan.frameProfileDigest,typedParameters:parameters({analysis_id:basis.analysisId,basis_digest:basis.basisDigest,
      duration_ms:basis.durationMs,stage,strategy:'buffalo_frozen_batch@1',points_json:JSON.stringify(items)})};
  const value={schema:'libra.us-adult-catalogue-frame-batch@1',analysisId:basis.analysisId,basisDigest:basis.basisDigest,stage,
    sourceHandleDigest:canonicalDigest(basis.sourceHandle),parentSamplingPlanDigest:basis.samplingPlan.digest,workspaceByteBudget,
    faceModelRefDigest:basis.faceModelRef.digest,points:items,samplingPlan:{...plan,digest:canonicalDigest(plan)}};
  return freeze({...value,batchDigest:canonicalDigest(value)});
}
function catalogueFrameWork(snapshot,basis,stage){
  const batch=catalogueFrameBatch(basis,stage);
  if(!snapshot?.run||snapshot.spec?.contentProfile!=='western_adult'||snapshot.run.libraRunId!==basis.libraRunId||
    snapshot.run.executionBasisDigest!==basis.runExecutionBasisDigest)fail('The frame Work must belong to the frozen western Run.');
  if(!batch)return null;
  const id=canonicalDigest({schema:'libra.us-adult-catalogue-frame-work@1',basisDigest:basis.basisDigest,batchDigest:batch.batchDigest}),
    prior=stage==='initial'?{workId:basis.sourceProbeRef.workId}:catalogueFrameWork(snapshot,basis,'initial');
  return freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
    workId:'libra-us-adult-catalogue-'+stage+'-frames-work-'+id,ownerDomain:'libra',processType:'libra_run',processId:basis.libraRunId,
    workKind:'us_adult_analysis',workObjectiveTypeRef:'helix://libra/work/us-adult-catalogue-'+stage+'-frames/v1',workObjectiveVersion:1,
    executionBasisId:'libra-us-adult-catalogue-batch-'+id,executionBasisDigest:basis.runExecutionBasisDigest,
    dependencyRefs:[{ownerDomain:'libra',objectType:'supporting_work',objectId:prior.workId,revision:1,digest:basis.runExecutionBasisDigest}],
    priorityClass:snapshot.run.priorityClass==='expedited'?'expedited_formation':'normal_foreground',priorityRevision:1,
    capabilityCatalogScope:'libra',workspaceMaterialScope:[],idempotencyKey:'libra-us-adult-catalogue-batch-key-'+id,
    concurrencyScope:basis.libraRunId+'/us-adult/catalogue/'+stage,outputContractRef:resultRef(CLUSTER)});
}
module.exports=Object.freeze({catalogueFrameBatch,catalogueFrameWork});
