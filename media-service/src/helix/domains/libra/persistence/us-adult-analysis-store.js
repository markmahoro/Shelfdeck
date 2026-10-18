'use strict';
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {canonicalJson,canonicalDigest}=require('../../../contracts/canonical-json');
const {SCHEMA,assertUsAdultAnalysisBasis}=require('../model/us-adult-analysis-basis');
const PAGE_SCHEMA='helix://contracts/domain-types/PeopleReferenceLibraryPage/v1';
const basisColumns=['analysis_id','libra_run_id','subject_id','workspace_id','basis_schema_ref','basis_json','basis_digest','created_at_ms'];
const pageColumns=['analysis_id','page_ordinal','page_schema_ref','page_json','page_payload_digest','item_count','first_person_id','last_person_id'];
function fail(code,message){throw Object.assign(new Error(message),{code});}
function deepFreeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;}
function createUsAdultAnalysisStore(options){
  if(!options?.contractValidator||!options.schemaManifest||!options.unitOfWork)throw new TypeError('US Adult analysis persistence requires Owner storage and formal contracts.');
  const definition=createRepositoryDefinition({repositoryId:'libra_us_adult_analysis_repository',owner:'libra',schemaManifest:options.schemaManifest,statements:{
    find_by_run:{kind:'select-one',tableId:'libra_us_adult_analysis_bases',columns:basisColumns,keyColumns:['libra_run_id']},
    find_basis:{kind:'select-one',tableId:'libra_us_adult_analysis_bases',columns:basisColumns,keyColumns:['analysis_id']},
    insert_basis:{kind:'insert',tableId:'libra_us_adult_analysis_bases',columns:basisColumns},
    find_page:{kind:'select-one',tableId:'libra_us_adult_reference_pages',columns:pageColumns,keyColumns:['analysis_id','page_ordinal'],safeIntegers:true},
    insert_page:{kind:'insert',tableId:'libra_us_adult_reference_pages',columns:pageColumns},
    find_run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','state','state_revision','execution_basis_digest'],keyColumns:['libra_run_id']},
    find_identity:{kind:'select-one',tableId:'libra_product_fact_revisions',columns:['libra_run_id','fact_kind','fact_revision','fact_digest','result_digest','fact_json'],
      keyColumns:['libra_run_id','fact_kind','fact_revision']},
    find_workspace:{kind:'select-one',tableId:'libra_workspaces',columns:['workspace_id','libra_run_id','state'],keyColumns:['workspace_id']},
  }});
  const execute=callback=>options.unitOfWork.execute([{participantId:'us_adult_analysis_store',owner:'libra',repositories:[definition],
    execute:context=>callback(context.repository(definition.repositoryId),context.commitTimeMs)}]).us_adult_analysis_store;
  function readBasis(row){
    if(!row)return null;let value;
    try{value=JSON.parse(row.basis_json);}catch{fail('US_ADULT_ANALYSIS_BASIS_CORRUPT','Stored US Adult analysis Basis is not valid JSON.');}
    options.contractValidator.validate(SCHEMA,value);assertUsAdultAnalysisBasis(value);
    if(row.basis_schema_ref!==SCHEMA||canonicalJson(value)!==row.basis_json||value.analysisId!==row.analysis_id||value.libraRunId!==row.libra_run_id||
      value.subjectId!==row.subject_id||value.workspaceId!==row.workspace_id||value.basisDigest!==row.basis_digest)
      fail('US_ADULT_ANALYSIS_BASIS_CORRUPT','Stored US Adult analysis Basis header or digest changed.');
    return deepFreeze(value);
  }
  function readPage(row,basis){
    if(!row||Number(row.page_ordinal)<0||Number(row.page_ordinal)>=basis.pageCount)fail('US_ADULT_ANALYSIS_PAGE_NOT_FOUND','The frozen reference page is missing.');
    let page;try{page=JSON.parse(row.page_json);}catch{fail('US_ADULT_ANALYSIS_PAGE_CORRUPT','Stored US Adult reference page is not valid JSON.');}
    options.contractValidator.validate(PAGE_SCHEMA,page);
    const {pageDigest,...value}=page;
    if(row.page_schema_ref!==PAGE_SCHEMA||canonicalJson(page)!==row.page_json||canonicalDigest(page)!==row.page_payload_digest||
      pageDigest!==canonicalDigest(value)||page.libraryDigest!==basis.referenceLibraryDigest||page.totalPersonCount!==basis.personCount||
      page.items.length!==Number(row.item_count)||row.first_person_id!==(page.items[0]?.personId||null)||row.last_person_id!==(page.items.at(-1)?.personId||null))
      fail('US_ADULT_ANALYSIS_PAGE_CORRUPT','Stored US Adult reference page header or digest changed.');
    return deepFreeze(page);
  }
  return Object.freeze({
    getByRun:libraRunId=>execute(repo=>readBasis(repo.invoke('find_by_run',{libra_run_id:libraRunId}))),
    get:analysisId=>execute(repo=>readBasis(repo.invoke('find_basis',{analysis_id:analysisId}))),
    readPage(analysisId,ordinal){
      if(!Number.isSafeInteger(ordinal)||ordinal<0)fail('US_ADULT_ANALYSIS_PAGE_NOT_FOUND','Reference page ordinal is invalid.');
      return execute(repo=>{
        const basis=readBasis(repo.invoke('find_basis',{analysis_id:analysisId}));
        if(!basis)fail('US_ADULT_ANALYSIS_BASIS_NOT_FOUND','US Adult analysis Basis was not found.');
        return readPage(repo.invoke('find_page',{analysis_id:analysisId,page_ordinal:ordinal}),basis);
      });
    },
    freeze(basis,pages){
      options.contractValidator.validate(SCHEMA,basis);for(const page of pages)options.contractValidator.validate(PAGE_SCHEMA,page);
      assertUsAdultAnalysisBasis(basis,pages);
      return execute((repo,at)=>{
        const existing=readBasis(repo.invoke('find_by_run',{libra_run_id:basis.libraRunId}));
        if(existing){
          if(canonicalJson(existing)!==canonicalJson(basis))fail('US_ADULT_ANALYSIS_BASIS_CONFLICT','This Run already has a different frozen analysis Basis.');
          for(let ordinal=0;ordinal<basis.pageCount;ordinal++){
            const page=readPage(repo.invoke('find_page',{analysis_id:basis.analysisId,page_ordinal:ordinal}),basis);
            if(canonicalJson(page)!==canonicalJson(pages[ordinal]))fail('US_ADULT_ANALYSIS_BASIS_CONFLICT','Frozen reference page differs on replay.');
          }
          return existing;
        }
        const run=repo.invoke('find_run',{libra_run_id:basis.libraRunId}),workspace=repo.invoke('find_workspace',{workspace_id:basis.workspaceId}),
          identity=repo.invoke('find_identity',{libra_run_id:basis.libraRunId,fact_kind:'resolved_identity',fact_revision:1});
        if(!run||run.state!=='active'||Number(run.state_revision)!==basis.expectedRunStateRevision||run.subject_id!==basis.subjectId||run.execution_basis_digest!==basis.runExecutionBasisDigest||
          !workspace||workspace.libra_run_id!==basis.libraRunId||workspace.state!=='active'||!identity||identity.fact_digest!==basis.resolvedIdentityDigest)
          fail('US_ADULT_ANALYSIS_BASIS_STALE','US Adult analysis Run, formal identity or Workspace changed before freezing.');
        let identityValue;try{identityValue=JSON.parse(identity.fact_json);}catch{fail('US_ADULT_ANALYSIS_BASIS_STALE','US Adult formal identity is corrupt.');}
        if(canonicalDigest(identityValue)!==identity.result_digest||identityValue.contentProfile!=='western_adult'||identityValue.subjectId!==basis.subjectId||identityValue.identityDigest!==basis.resolvedIdentityDigest)
          fail('US_ADULT_ANALYSIS_BASIS_STALE','US Adult analysis requires its exact formal identity Fact.');
        repo.invoke('insert_basis',{analysis_id:basis.analysisId,libra_run_id:basis.libraRunId,subject_id:basis.subjectId,workspace_id:basis.workspaceId,
          basis_schema_ref:SCHEMA,basis_json:canonicalJson(basis),basis_digest:basis.basisDigest,created_at_ms:at});
        for(const [ordinal,page] of pages.entries()){
          repo.invoke('insert_page',{analysis_id:basis.analysisId,page_ordinal:ordinal,page_schema_ref:PAGE_SCHEMA,page_json:canonicalJson(page),
            page_payload_digest:canonicalDigest(page),item_count:page.items.length,first_person_id:page.items[0]?.personId||null,last_person_id:page.items.at(-1)?.personId||null});
          options.afterPageInsert?.({analysisId:basis.analysisId,ordinal});
        }
        return readBasis(repo.invoke('find_basis',{analysis_id:basis.analysisId}));
      });
    },
  });
}
module.exports=Object.freeze({createUsAdultAnalysisStore});
