'use strict';
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {canonicalJson}=require('../../../contracts/canonical-json');
const {SCHEMA,buildCompletion,assertCompletion}=require('../model/us-adult-match-completion');
const columns=['analysis_id','libra_run_id','subject_id','completion_schema_ref','completion_json','completion_digest','created_at_ms'];
function fail(code,message){throw Object.assign(new Error(message),{code});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function createUsAdultMatchCompletionStore(options){
  const repository=createRepositoryDefinition({repositoryId:'libra_us_adult_match_completion',owner:'libra',schemaManifest:options.schemaManifest,statements:{
    find_completion:{kind:'select-one',tableId:'libra_us_adult_match_completions',columns,keyColumns:['analysis_id']},
    find_by_run:{kind:'select-one',tableId:'libra_us_adult_match_completions',columns,keyColumns:['libra_run_id']},
    insert_completion:{kind:'insert',tableId:'libra_us_adult_match_completions',columns},
    find_basis:{kind:'select-one',tableId:'libra_us_adult_analysis_bases',columns:['analysis_id','libra_run_id','subject_id','basis_json','basis_digest'],keyColumns:['analysis_id']},
    find_run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','execution_basis_digest','state'],keyColumns:['libra_run_id']},
  }});
  const execute=callback=>options.unitOfWork.execute([{participantId:'us_match_completion',owner:'libra',repositories:[repository],
    execute:context=>callback(context.repository(repository.repositoryId),context.commitTimeMs)}]).us_match_completion;
  function decode(row){
    if(!row)return null;let completion;try{completion=JSON.parse(row.completion_json);}catch{fail('US_ADULT_MATCH_COMPLETION_CORRUPT','Stored matching completion JSON is invalid.');}
    options.contractValidator.validate(SCHEMA,completion);assertCompletion(completion);
    if(row.completion_schema_ref!==SCHEMA||canonicalJson(completion)!==row.completion_json||completion.analysisId!==row.analysis_id||
      completion.libraRunId!==row.libra_run_id||completion.subjectId!==row.subject_id||completion.completionDigest!==row.completion_digest)
      fail('US_ADULT_MATCH_COMPLETION_CORRUPT','Stored matching completion header changed.');
    return freeze(completion);
  }
  return Object.freeze({
    get:analysisId=>execute(repo=>decode(repo.invoke('find_completion',{analysis_id:analysisId}))),
    getByRun:libraRunId=>execute(repo=>decode(repo.invoke('find_by_run',{libra_run_id:libraRunId}))),
    freeze(proof){
      const completion=buildCompletion(proof);options.contractValidator.validate(SCHEMA,completion);
      return execute((repo,at)=>{
        const existing=decode(repo.invoke('find_completion',{analysis_id:completion.analysisId}));
        if(existing){if(canonicalJson(existing)!==canonicalJson(completion))fail('US_ADULT_MATCH_COMPLETION_CONFLICT','This analysis already has a different immutable completion.');return existing;}
        const basis=repo.invoke('find_basis',{analysis_id:completion.analysisId}),run=repo.invoke('find_run',{libra_run_id:completion.libraRunId});
        if(!basis||basis.libra_run_id!==completion.libraRunId||basis.subject_id!==completion.subjectId||basis.basis_digest!==completion.analysisBasisDigest||
          canonicalJson(proof.basis)!==basis.basis_json||!run||run.state!=='active'||run.subject_id!==completion.subjectId||
          run.execution_basis_digest!==proof.basis.runExecutionBasisDigest)fail('US_ADULT_MATCH_COMPLETION_STALE','Matching completion requires its exact active Run and frozen analysis Basis.');
        repo.invoke('insert_completion',{analysis_id:completion.analysisId,libra_run_id:completion.libraRunId,subject_id:completion.subjectId,
          completion_schema_ref:SCHEMA,completion_json:canonicalJson(completion),completion_digest:completion.completionDigest,created_at_ms:at});
        options.afterCompletionInsert?.();
        return decode(repo.invoke('find_completion',{analysis_id:completion.analysisId}));
      });
    },
  });
}
module.exports=Object.freeze({createUsAdultMatchCompletionStore});
