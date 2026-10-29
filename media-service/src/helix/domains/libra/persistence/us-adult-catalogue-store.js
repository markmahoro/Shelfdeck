'use strict';
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {canonicalJson,canonicalDigest}=require('../../../contracts/canonical-json');
const {SCHEMA,assertCatalogueAnalysisBasis}=require('../model/us-adult-catalogue-analysis-basis');
const columns=['analysis_id','libra_run_id','subject_id','workspace_id','basis_schema_ref','basis_json','basis_digest','created_at_ms'];
function fail(code,message){throw Object.assign(new Error(message),{code});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function createUsAdultCatalogueStore(options){
  if(!options?.contractValidator||!options.schemaManifest||!options.unitOfWork)throw new TypeError('Catalogue Basis persistence requires Libra storage and formal contracts.');
  const repository=createRepositoryDefinition({repositoryId:'libra_us_adult_catalogue_repository',owner:'libra',schemaManifest:options.schemaManifest,statements:{
    find_by_run:{kind:'select-one',tableId:'libra_us_adult_catalogue_bases',columns,keyColumns:['libra_run_id']},
    find_basis:{kind:'select-one',tableId:'libra_us_adult_catalogue_bases',columns,keyColumns:['analysis_id']},
    insert_basis:{kind:'insert',tableId:'libra_us_adult_catalogue_bases',columns},
    find_run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','state','state_revision','execution_basis_digest'],keyColumns:['libra_run_id']},
    find_identity:{kind:'select-one',tableId:'libra_product_fact_revisions',columns:['fact_digest','result_digest','fact_json'],keyColumns:['libra_run_id','fact_kind','fact_revision']},
    find_workspace:{kind:'select-one',tableId:'libra_workspaces',columns:['workspace_id','libra_run_id','state'],keyColumns:['workspace_id']},
  }});
  const execute=callback=>options.unitOfWork.execute([{participantId:'us_catalogue_basis',owner:'libra',repositories:[repository],
    execute:context=>callback(context.repository(repository.repositoryId),context.commitTimeMs)}]).us_catalogue_basis;
  function decode(row){
    if(!row)return null;let value;
    try{value=JSON.parse(row.basis_json);assertCatalogueAnalysisBasis(value,{validator:options.contractValidator});}
    catch{fail('US_ADULT_CATALOGUE_BASIS_CORRUPT','Stored catalogue Basis failed its exact nominal contract.');}
    if(row.basis_schema_ref!==SCHEMA||canonicalJson(value)!==row.basis_json||value.analysisId!==row.analysis_id||value.libraRunId!==row.libra_run_id||
      value.subjectId!==row.subject_id||value.workspaceId!==row.workspace_id||value.basisDigest!==row.basis_digest)
      fail('US_ADULT_CATALOGUE_BASIS_CORRUPT','Stored catalogue Basis header or canonical bytes changed.');
    return freeze(value);
  }
  function assertCurrent(repo,basis,{freezing=false}={}){
    const run=repo.invoke('find_run',{libra_run_id:basis.libraRunId}),workspace=repo.invoke('find_workspace',{workspace_id:basis.workspaceId}),
      identity=repo.invoke('find_identity',{libra_run_id:basis.libraRunId,fact_kind:'resolved_identity',fact_revision:1});
    if(!run||run.state!=='active'||run.subject_id!==basis.subjectId||run.execution_basis_digest!==basis.runExecutionBasisDigest||
      !Number.isSafeInteger(Number(run.state_revision))||Number(run.state_revision)<basis.expectedRunStateRevision||
      freezing&&Number(run.state_revision)!==basis.expectedRunStateRevision||!workspace||workspace.libra_run_id!==basis.libraRunId||workspace.state!=='active'||
      !identity||identity.fact_digest!==basis.resolvedIdentityDigest)fail('US_ADULT_CATALOGUE_BASIS_STALE','The current Run, identity or Workspace no longer permits catalogue execution.');
    let value;try{value=JSON.parse(identity.fact_json);}catch{fail('US_ADULT_CATALOGUE_BASIS_STALE','The formal identity Fact is not readable.');}
    if(canonicalDigest(value)!==identity.result_digest||value.contentProfile!=='western_adult'||value.subjectId!==basis.subjectId||value.identityDigest!==basis.resolvedIdentityDigest)
      fail('US_ADULT_CATALOGUE_BASIS_STALE','Catalogue execution lost its exact formal identity Fact.');
  }
  return Object.freeze({
    get:analysisId=>execute(repo=>decode(repo.invoke('find_basis',{analysis_id:analysisId}))),
    getByRun:libraRunId=>execute(repo=>decode(repo.invoke('find_by_run',{libra_run_id:libraRunId}))),
    readForExecution({libraRunId,expectedBasisDigest}){
      if(typeof libraRunId!=='string'||!libraRunId||!/^[a-f0-9]{64}$/.test(expectedBasisDigest||''))
        fail('US_ADULT_CATALOGUE_BASIS_REQUIRED','An exact Run and frozen catalogue digest are required.');
      return execute(repo=>{
        const value=decode(repo.invoke('find_by_run',{libra_run_id:libraRunId}));
        if(!value)fail('US_ADULT_CATALOGUE_BASIS_NOT_FOUND','No frozen catalogue Basis exists for this Run.');
        if(value.basisDigest!==expectedBasisDigest)fail('US_ADULT_CATALOGUE_BASIS_STALE','The requested catalogue Basis has been substituted.');
        assertCurrent(repo,value);return value;
      });
    },
    freeze(value){
      const basis=freeze(assertCatalogueAnalysisBasis(JSON.parse(canonicalJson(value)),{validator:options.contractValidator}));
      return execute((repo,at)=>{
        const existing=decode(repo.invoke('find_by_run',{libra_run_id:basis.libraRunId}));
        if(existing){
          if(canonicalJson(existing)!==canonicalJson(basis))fail('US_ADULT_CATALOGUE_BASIS_CONFLICT','This Run already has another immutable catalogue Basis.');
          return existing;
        }
        assertCurrent(repo,basis,{freezing:true});
        repo.invoke('insert_basis',{analysis_id:basis.analysisId,libra_run_id:basis.libraRunId,subject_id:basis.subjectId,workspace_id:basis.workspaceId,
          basis_schema_ref:SCHEMA,basis_json:canonicalJson(basis),basis_digest:basis.basisDigest,created_at_ms:at});
        options.afterBasisInsert?.();
        return decode(repo.invoke('find_basis',{analysis_id:basis.analysisId}));
      });
    },
  });
}
module.exports=Object.freeze({createUsAdultCatalogueStore});
