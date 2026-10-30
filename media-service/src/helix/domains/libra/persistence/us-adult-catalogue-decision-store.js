'use strict';
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {canonicalJson}=require('../../../contracts/canonical-json');
const {SCHEMA,assertCatalogueActorDecision}=require('../model/us-adult-catalogue-actor-decision');
const columns=['decision_id','libra_run_id','subject_id','decision_schema_ref','decision_json','decision_digest','observation_result_id','created_at_ms'];
function fail(code,message){throw Object.assign(new Error(message),{code});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function createUsAdultCatalogueDecisionStore(options){
  if(!options?.contractValidator||!options.schemaManifest||!options.unitOfWork)
    throw new TypeError('Catalogue actor decision persistence requires Libra storage and formal contracts.');
  const repository=createRepositoryDefinition({repositoryId:'libra_us_adult_catalogue_decision_repository',owner:'libra',
    schemaManifest:options.schemaManifest,statements:{
      find_decision:{kind:'select-one',tableId:'libra_us_adult_catalogue_actor_decisions',columns,keyColumns:['decision_id']},
      find_by_run:{kind:'select-one',tableId:'libra_us_adult_catalogue_actor_decisions',columns,keyColumns:['libra_run_id']},
      insert_decision:{kind:'insert',tableId:'libra_us_adult_catalogue_actor_decisions',columns},
      find_run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','execution_basis_digest','state'],keyColumns:['libra_run_id']},
      find_choice_head:{kind:'select-one',tableId:'libra_us_adult_actor_choice_heads',columns:['subject_id','intent_id'],keyColumns:['subject_id']},
      find_basis:{kind:'select-one',tableId:'libra_us_adult_catalogue_bases',columns:['analysis_id','libra_run_id','basis_digest'],keyColumns:['libra_run_id']},
    }});
  const execute=callback=>options.unitOfWork.execute([{participantId:'us_catalogue_decision',owner:'libra',repositories:[repository],
    execute:context=>callback(context.repository(repository.repositoryId),context.commitTimeMs)}]).us_catalogue_decision;
  function decode(row){
    if(!row)return null;let decision;
    try{decision=JSON.parse(row.decision_json);assertCatalogueActorDecision(decision);}
    catch{fail('US_ADULT_CATALOGUE_DECISION_CORRUPT','Stored catalogue actor decision failed its exact nominal contract.');}
    if(row.decision_schema_ref!==SCHEMA||canonicalJson(decision)!==row.decision_json||decision.decisionId!==row.decision_id||
      decision.libraRunId!==row.libra_run_id||decision.subjectId!==row.subject_id||decision.decisionDigest!==row.decision_digest||
      decision.observationResultRef.resultId!==row.observation_result_id)
      fail('US_ADULT_CATALOGUE_DECISION_CORRUPT','Stored catalogue actor decision header or canonical bytes changed.');
    return freeze(decision);
  }
  return Object.freeze({
    get:decisionId=>execute(repo=>decode(repo.invoke('find_decision',{decision_id:decisionId}))),
    getByRun:libraRunId=>execute(repo=>decode(repo.invoke('find_by_run',{libra_run_id:libraRunId}))),
    freeze(decision){
      const value=freeze(assertCatalogueActorDecision(JSON.parse(canonicalJson(decision))));
      options.contractValidator.validate(SCHEMA,value);
      return execute((repo,at)=>{
        const existing=decode(repo.invoke('find_by_run',{libra_run_id:value.libraRunId}));
        if(existing){
          if(canonicalJson(existing)!==canonicalJson(value))
            fail('US_ADULT_CATALOGUE_DECISION_CONFLICT','This Run already has another immutable catalogue actor decision.');
          return existing;
        }
        const byId=decode(repo.invoke('find_decision',{decision_id:value.decisionId}));
        if(byId){
          if(canonicalJson(byId)!==canonicalJson(value))
            fail('US_ADULT_CATALOGUE_DECISION_CONFLICT','This decision identity already exists with different content.');
          return byId;
        }
        const run=repo.invoke('find_run',{libra_run_id:value.libraRunId}),basis=repo.invoke('find_basis',{libra_run_id:value.libraRunId}),
          choice=repo.invoke('find_choice_head',{subject_id:value.subjectId});
        if(!run||run.state!=='active'||run.subject_id!==value.subjectId||run.execution_basis_digest!==value.runExecutionBasisDigest||
          !basis||basis.basis_digest!==value.catalogueBasisDigest||basis.analysis_id!==value.catalogueAnalysisId||choice)
          fail('US_ADULT_CATALOGUE_DECISION_STALE','Catalogue actor decision requires its exact active Run, Basis and empty Choice head.');
        repo.invoke('insert_decision',{decision_id:value.decisionId,libra_run_id:value.libraRunId,subject_id:value.subjectId,
          decision_schema_ref:SCHEMA,decision_json:canonicalJson(value),decision_digest:value.decisionDigest,
          observation_result_id:value.observationResultRef.resultId,created_at_ms:at});
        options.afterDecisionInsert?.();
        return decode(repo.invoke('find_decision',{decision_id:value.decisionId}));
      });
    },
  });
}
module.exports=Object.freeze({createUsAdultCatalogueDecisionStore});
