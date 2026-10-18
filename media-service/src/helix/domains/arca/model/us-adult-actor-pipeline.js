'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {CAPS}=require('../../../contracts/us-adult-actor-file-contracts');
const RESULTS=Object.freeze({assets:'ArcaUsAdultAssetsPrepared',stage:'ArcaUsAdultFileReceipt',publish:'ArcaUsAdultFileReceipt',verify:'ArcaUsAdultFileReceipt',
  commit:'AftercareInventoryCommitReceipt',retire:'ArcaUsAdultFileReceipt',close:'AftercareCaseResult',unchanged:'AftercareCaseResult'});
const effectClass=action=>action==='assets'?'workspace_write':['stage','publish','retire'].includes(action)?'material_commit':action==='verify'?'pure_observation':action==='commit'?'responsibility_control_commit':'domain_fact_commit';
const capability=action=>CAPS[action==='unchanged'?'close':action];
const resultRef=action=>'helix://contracts/capabilities/'+capability(action).replace('@1','/v1/result');
function phaseWork(intent,care,action,dependencies){
  const id=canonicalDigest({schema:'arca.us-adult-phase-work@1',intentDigest:intent.intentDigest,aftercareCaseId:care.aftercareCaseId,action,dependencies});
  return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,workId:'arca-us-'+action+'-work-'+id,
    ownerDomain:'arca',processType:'arca_shelf_entry',processId:intent.shelfEntryId,workKind:'us_adult_actor_'+(action==='unchanged'?'close':action),
    workObjectiveTypeRef:'helix://arca/work/us_adult_actor_'+action+'/v1',workObjectiveVersion:1,executionBasisId:'arca-us-phase-basis-'+id,
    executionBasisDigest:intent.intentDigest,dependencyRefs:[{ownerDomain:'arca',objectType:'aftercare_case',objectId:care.aftercareCaseId,revision:1,digest:care.careRequirementDigest},
      {ownerDomain:'arca',objectType:'us_adult_actor_refresh_intent',objectId:intent.intentId,revision:1,digest:intent.intentDigest},...dependencies],
    priorityClass:'normal_foreground',priorityRevision:1,capabilityCatalogScope:'arca',workspaceMaterialScope:[],idempotencyKey:'arca-us-phase-'+id,
    concurrencyScope:'arca_shelf_entry/'+intent.shelfEntryId+'/actor-refresh',outputContractRef:'helix://contracts/types/'+RESULTS[action]+'/v1'});
}
function dependency(work,resultDigest){return {ownerDomain:'arca',objectType:'supporting_work',objectId:work.workId,revision:1,digest:resultDigest};}
function completed(options,work,action){
  if(options.workResultReader.status(work.workId)?.state!=='succeeded')return null;
  const definition=options.workResultReader.readDefinition(work.workId)?.definition,
    results=options.workResultReader.read(work.workId).filter(record=>record.outcomeKind==='succeeded'&&record.capabilityRef===capability(action));
  if(!definition||canonicalJson(definition)!==canonicalJson(work)||results.length!==1||results[0].workId!==work.workId||
      results[0].state!=='succeeded'||results[0].resultSchemaRef!==resultRef(action)||canonicalDigest(results[0].result)!==results[0].resultDigest)
    throw Object.assign(new Error('Actor phase lacks its exact complete immutable Work Result.'),{code:'ARCA_US_ADULT_PHASE_PROOF_INVALID'});
  options.contractValidator.validate(resultRef(action),results[0].result);return results[0];
}
function executionInput(snapshot,action){
  const {intent,care,stages,plan,selection}=snapshot,body={schemaRef:'helix://contracts/domain-types/UsAdultActorExecutionInput/v1',schemaVersion:1,
    aftercareCaseId:care.aftercareCaseId,shelfEntryId:intent.shelfEntryId,intentId:intent.intentId,intentDigest:intent.intentDigest,action,
    assetsWorkId:stages.assets?.record?.workId||null,assetsResultDigest:stages.assets?.record?.resultDigest||null,planDigest:plan?.planDigest||null,
    selectionDigest:selection?.selectionDigest||null,stageWorkId:stages.stage?.record?.workId||null,stageResultDigest:stages.stage?.record?.resultDigest||null,
    publishWorkId:stages.publish?.record?.workId||null,publishResultDigest:stages.publish?.record?.resultDigest||null,
    verifyWorkId:stages.verify?.record?.workId||null,verifyResultDigest:stages.verify?.record?.resultDigest||null,
    commitWorkId:stages.commit?.record?.workId||null,commitResultDigest:stages.commit?.record?.resultDigest||null,
    retirementWorkId:stages.retire?.record?.workId||null,retirementResultDigest:stages.retire?.record?.resultDigest||null,
    completionDigest:snapshot.completion?.completionDigest||null};
  // A Work's projected input never starts referring to its own later result.
  const order=['assets','stage','publish','verify','commit','retire','close'];
  for(const later of order.slice(Math.max(0,order.indexOf(action)))){
    const prefix={assets:'assets',stage:'stage',publish:'publish',verify:'verify',commit:'commit',retire:'retirement'}[later];
    if(prefix){body[prefix+'WorkId']=null;body[prefix+'ResultDigest']=null;}
  }
  return Object.freeze({...body,inputDigest:canonicalDigest(body)});
}
module.exports=Object.freeze({CAPS,RESULTS,effectClass,capability,resultRef,phaseWork,dependency,completed,executionInput});
