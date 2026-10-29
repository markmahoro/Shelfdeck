'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {CAPABILITY,resultRef}=require('../../../contracts/us-adult-catalogue-work-types');
const {assertCompletedCatalogueBatches}=require('./us-adult-catalogue-completed-batches');
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function initialCompletedCatalogueBatch(completed){
  const {setDigest,...source}=completed,body={...source,mode:'initial',batches:[source.batches[0]]};
  return freeze(JSON.parse(canonicalJson({...body,setDigest:canonicalDigest(body)})));
}
function catalogueObservationWork({snapshot,basis,completedBatches,validator}){
  assertCompletedCatalogueBatches(completedBatches,{basis,snapshot,validator});
  const id=canonicalDigest({schema:'libra.us-adult-catalogue-observation-work@1',basisDigest:basis.basisDigest,
    completedBatchSetDigest:completedBatches.setDigest}),merged=completedBatches.mode==='initial_and_supplement',
    prior=merged?catalogueObservationWork({snapshot,basis,validator,completedBatches:initialCompletedCatalogueBatch(completedBatches)}):null,
    dependencies=merged?[prior.workId,completedBatches.batches[1].workId]:[completedBatches.batches[0].workId];
  return freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
    workId:'libra-us-adult-catalogue-observation-work-'+id,ownerDomain:'libra',processType:'libra_run',processId:basis.libraRunId,
    workKind:'us_adult_analysis',workObjectiveTypeRef:'helix://libra/work/us-adult-catalogue-observation/v1',workObjectiveVersion:1,
    executionBasisId:'libra-us-adult-catalogue-observation-basis-'+id,executionBasisDigest:basis.runExecutionBasisDigest,
    dependencyRefs:dependencies.map(objectId=>({ownerDomain:'libra',objectType:'supporting_work',objectId,revision:1,digest:basis.runExecutionBasisDigest})),
    priorityClass:snapshot.run.priorityClass==='expedited'?'expedited_formation':'normal_foreground',priorityRevision:1,
    capabilityCatalogScope:'libra',workspaceMaterialScope:[],idempotencyKey:'libra-us-adult-catalogue-observation-key-'+id,
    concurrencyScope:basis.libraRunId+'/us-adult/catalogue/'+completedBatches.mode,outputContractRef:resultRef(CAPABILITY)});
}
module.exports=Object.freeze({initialCompletedCatalogueBatch,catalogueObservationWork});
