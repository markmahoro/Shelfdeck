'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {FRAME,EMBED,CLUSTER,resultRef}=require('../../../contracts/us-adult-catalogue-work-types');
const {catalogueFrameWork}=require('./us-adult-catalogue-frame-work');
const {buildCompletedCatalogueBatches}=require('./us-adult-catalogue-completed-batches');
function fail(message){throw Object.assign(new Error(message),{code:'US_ADULT_CATALOGUE_RESULT_SCOPE_INVALID'});}
function exactCatalogueResult(options,work,capabilityRef,{workAttemptId,planId}={}){
  if(workAttemptId===undefined){
    const status=options.workResultReader.status(work.workId);
    if(status?.state!=='succeeded'||status.latestAttempt?.state!=='succeeded')fail('A completed catalogue producer requires its latest successful Work Attempt.');
    workAttemptId=status.latestAttempt.attempt_id;
  }
  if(typeof workAttemptId!=='string'||!workAttemptId)fail('A catalogue producer requires its exact Work Attempt.');
  const records=options.workResultReader.read(work.workId).filter(record=>record.outcomeKind==='succeeded'&&
    record.capabilityRef===capabilityRef&&record.attemptId===workAttemptId);
  if(records.length!==1)fail('Catalogue analysis requires exactly one durable successful Result in the selected Work Attempt.');
  const record=records[0];
  if(record.workId!==work.workId||planId!==undefined&&record.planId!==planId||record.resultSchemaRef!==resultRef(capabilityRef)||
    canonicalDigest(record.result)!==record.resultDigest||!record.inputBindings||canonicalDigest(record.inputBindings)!==record.inputBindingDigest||
    !['attemptId','planId','eventId','resultId'].every(key=>typeof record[key]==='string'&&record[key]&&record[key].length<=256))
    fail('A catalogue producer lost its exact Work, Plan, Result or frozen input bindings.');
  options.contractValidator.validate(resultRef(capabilityRef),record.result);return record;
}
function readCompletedCatalogueBatches(options,snapshot,basis,mode){
  const stages=mode==='initial'?['initial']:mode==='initial_and_supplement'?['initial','supplement']:[];
  if(!stages.length)fail('Catalogue analysis requires one of its two bounded stages.');
  return buildCompletedCatalogueBatches({basis,snapshot,mode,validator:options.contractValidator,records:stages.map(stage=>{
    const work=catalogueFrameWork(snapshot,basis,stage);if(!work)fail('An empty frame batch cannot be read as complete.');
    return {frame:exactCatalogueResult(options,work,FRAME),embedding:exactCatalogueResult(options,work,EMBED),cluster:exactCatalogueResult(options,work,CLUSTER)};
  })});
}
module.exports=Object.freeze({exactCatalogueResult,readCompletedCatalogueBatches});
