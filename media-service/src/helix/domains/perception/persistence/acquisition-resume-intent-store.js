'use strict';
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {canonicalDigest}=require('../../../contracts/canonical-json');
const columns=['intent_id','perception_acquisition_id','actor_id','idempotency_key','request_digest','scope_digest','created_at_ms'];
function fail(code,message){throw Object.assign(new Error(message),{code});}
function createAcquisitionResumeIntentStore(options){
  const repository=createRepositoryDefinition({repositoryId:'perception_acquisition_resume_repository',owner:'perception',schemaManifest:options.schemaManifest,statements:{
    insert_intent:{kind:'insert',tableId:'perception_acquisition_resume_intents',columns},
    find_command:{kind:'select-one',tableId:'perception_acquisition_resume_intents',columns,keyColumns:['actor_id','idempotency_key']},
    find_acquisition_intent:{kind:'select-one',tableId:'perception_acquisition_resume_intents',columns,keyColumns:['perception_acquisition_id']},
    find_acquisition:{kind:'select-one',tableId:'perception_acquisitions',columns:['perception_acquisition_id','perception_source_id','source_config_revision','scope_json','scope_digest','state'],keyColumns:['perception_acquisition_id']},
    find_source:{kind:'select-one',tableId:'perception_sources',columns:['perception_source_id','source_kind','config_revision','status'],keyColumns:['perception_source_id']},
  }});
  const read=callback=>options.unitOfWork.execute([{participantId:'resume_intent_read',owner:'perception',repositories:[repository],
    execute:context=>callback(context.repository(repository.repositoryId))}]).resume_intent_read;
  return Object.freeze({
    findCommand:(actorId,idempotencyKey)=>read(repo=>repo.invoke('find_command',{actor_id:actorId,idempotency_key:idempotencyKey})),
    hasResume:acquisitionId=>Boolean(read(repo=>repo.invoke('find_acquisition_intent',{perception_acquisition_id:acquisitionId}))),
    participant(decision){
      options.contractValidator.validate('helix://contracts/domain-types/PerceptionAcquisitionResumeDecision/v1',decision);
      const {decisionDigest,...body}=decision;
      if(canonicalDigest(body)!==decisionDigest)fail('PERCEPTION_RESUME_INPUT_INVALID','同步继续决定摘要不匹配。');
      return Object.freeze({participantId:'perception_acquisition_resume',owner:'perception',repositories:[repository],execute(context){
        const repo=context.repository(repository.repositoryId),acquisition=repo.invoke('find_acquisition',{perception_acquisition_id:decision.acquisitionId}),
          source=acquisition&&repo.invoke('find_source',{perception_source_id:acquisition.perception_source_id});
        if(!acquisition||acquisition.state!=='active'||acquisition.scope_digest!==decision.expectedScopeDigest||
          !source||source.source_kind!=='douban'||source.status!=='active'||source.config_revision!==acquisition.source_config_revision||
          JSON.parse(acquisition.scope_json).mode!=='provider')fail('PERCEPTION_RESUME_BASIS_CONFLICT','同步来源或进度已变化，请重新读取。');
        repo.invoke('insert_intent',{intent_id:decision.decisionId,perception_acquisition_id:decision.acquisitionId,actor_id:decision.actorId,
          idempotency_key:decision.idempotencyKey,request_digest:decision.requestDigest,scope_digest:decision.expectedScopeDigest,created_at_ms:context.commitTimeMs});
        return {decisionId:decision.decisionId,acquisitionId:decision.acquisitionId,decisionDigest:decision.decisionDigest};
      }});
    },
  });
}
module.exports=Object.freeze({createAcquisitionResumeIntentStore});
