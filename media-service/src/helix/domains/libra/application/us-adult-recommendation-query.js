'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {assertCompletion}=require('../model/us-adult-match-completion');
const {assertUsAdultAnalysisBasis}=require('../model/us-adult-analysis-basis');
const {frameWork,exactResult,FRAME,EMBED,CLUSTER}=require('../model/us-adult-analysis-work');
const {SOURCE_SCHEMA,PAGE_SCHEMA,QUERY_SCHEMA,buildRecommendationSource}=require('../model/us-adult-recommendation-source');
function stale(){throw Object.assign(new Error('The unmatched recommendation source or its actor choice version changed.'),{code:'US_ADULT_RECOMMENDATION_SOURCE_STALE'});}
function createUsAdultRecommendationQuery(options){
  const repository=createRepositoryDefinition({repositoryId:'libra_us_adult_recommendation_sources',owner:'libra',schemaManifest:options.schemaManifest,statements:{
    page:{kind:'select-page-after',tableId:'libra_us_adult_match_completions',keyColumn:'libra_run_id',maxItems:32,columns:['libra_run_id']},
    completion:{kind:'select-one',tableId:'libra_us_adult_match_completions',keyColumns:['libra_run_id'],columns:['analysis_id','subject_id','completion_json','completion_digest']},
    run:{kind:'select-one',tableId:'libra_runs',keyColumns:['libra_run_id'],columns:['libra_run_id','subject_id','state','state_revision','execution_basis_digest','package_revision_head','priority_class']},
    subject:{kind:'select-one',tableId:'libra_subjects',keyColumns:['subject_id'],columns:['subject_id','status','content_profile','structure_kind']},
    choice:{kind:'select-one',tableId:'libra_us_adult_actor_choice_heads',keyColumns:['subject_id'],columns:['intent_id','current_revision','record_digest']},
    basis:{kind:'select-one',tableId:'libra_us_adult_analysis_bases',keyColumns:['analysis_id'],columns:['basis_json','basis_digest']},
    identity:{kind:'select-one',tableId:'libra_product_fact_revisions',keyColumns:['libra_run_id','fact_kind','fact_revision'],columns:['fact_json','fact_digest','result_digest']},
  }});
  const read=callback=>options.unitOfWork.execute([{participantId:'us_recommendation_source_read',owner:'libra',repositories:[repository],
    execute:context=>callback(context.repository(repository.repositoryId))}]).us_recommendation_source_read;
  function ownerSnapshot(libraRunId){return read(repo=>{
    const run=repo.invoke('run',{libra_run_id:libraRunId});if(!run)return null;
    const subject=repo.invoke('subject',{subject_id:run.subject_id}),choice=repo.invoke('choice',{subject_id:run.subject_id});
    if(!subject||subject.status!=='active'||subject.content_profile!=='western_adult'||subject.structure_kind!=='single'||
      !['active','suspended'].includes(run.state)||run.package_revision_head!==0||choice)return null;
    const completion=repo.invoke('completion',{libra_run_id:libraRunId});if(!completion)return null;
    return {run,subject,completion,basis:repo.invoke('basis',{analysis_id:completion.analysis_id}),
      identity:repo.invoke('identity',{libra_run_id:libraRunId,fact_kind:'resolved_identity',fact_revision:1})};
  });}
  function currentSource(libraRunId){
    const owner=ownerSnapshot(libraRunId);if(!owner)return null;
    const completion=assertCompletion(JSON.parse(owner.completion.completion_json));
    options.contractValidator.validate(completion.schemaRef,completion);
    if(completion.completionDigest!==owner.completion.completion_digest||completion.analysisId!==owner.completion.analysis_id||
      completion.subjectId!==owner.run.subject_id||completion.libraRunId!==libraRunId||canonicalJson(completion)!==owner.completion.completion_json)
      throw new Error('Recommendation source completion index changed.');
    if(completion.winner!==null||completion.detectedFaceCount===0)return null;
    if(!owner.basis||!owner.identity)throw new Error('Unmatched source lacks its formal analysis or identity.');
    const basis=assertUsAdultAnalysisBasis(JSON.parse(owner.basis.basis_json)),identity=JSON.parse(owner.identity.fact_json);
    options.contractValidator.validate(basis.schemaRef,basis);options.contractValidator.validate(identity.schemaRef,identity);
    if(basis.basisDigest!==owner.basis.basis_digest||canonicalJson(basis)!==owner.basis.basis_json||identity.identityDigest!==owner.identity.fact_digest||
      canonicalDigest(identity)!==owner.identity.result_digest)throw new Error('Recommendation source Owner facts changed.');
    const snapshot={run:{libraRunId,subjectId:owner.run.subject_id,executionBasisDigest:owner.run.execution_basis_digest,priorityClass:owner.run.priority_class},
      spec:{contentProfile:'western_adult'}},work=frameWork(snapshot,basis);
    if(options.workResultReader.status(work.workId)?.state!=='succeeded')throw new Error('Recommendation requires the completed formal frame analysis Work.');
    const records=[FRAME,EMBED,CLUSTER].map(capability=>exactResult(options,work,capability)),
      source=buildRecommendationSource({run:owner.run,identity,basis,completion,records});
    if(canonicalDigest(ownerSnapshot(libraRunId))!==canonicalDigest(owner))stale();
    options.contractValidator.validate(SOURCE_SCHEMA,source);return source;
  }
  return Object.freeze({listSources(query){
    options.contractValidator.validate(QUERY_SCHEMA,query);
    const rows=read(repo=>repo.invoke('page',{cursor:query.cursor,limit:32})),items=[];let cursor=query.cursor,byteStop=false,reachedLimit=false;
    for(const row of rows){
      const source=currentSource(row.libra_run_id);
      if(source&&Buffer.byteLength(canonicalJson(items.concat(source)),'utf8')>256*1024-1024){byteStop=true;break;}
      if(source)items.push(source);cursor=row.libra_run_id;
      if(items.length===query.limit){reachedLimit=true;break;}
    }
    const value={schemaRef:PAGE_SCHEMA,schemaVersion:1,items:Object.freeze(items),nextCursor:byteStop||reachedLimit||rows.length===32?cursor:null},
      page=Object.freeze({...value,pageDigest:canonicalDigest(value)});
    options.contractValidator.validate(PAGE_SCHEMA,page);return page;
  },readSource(source){
    options.contractValidator.validate(SOURCE_SCHEMA,source);
    const current=currentSource(source.libraRunId);if(!current||canonicalJson(source)!==canonicalJson(current))stale();return current;
  }});
}
module.exports=Object.freeze({createUsAdultRecommendationQuery});
