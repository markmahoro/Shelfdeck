'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {buildCollectionTargetReference}=require('../../../contracts/collection-target-reference');
const {assertStandardAcceptanceSpec,assertCustomAcceptanceSpec}=require('../model/custom-acceptance-spec');

const SCHEMA='libra.fresh-reset-custom-target-closure@1';
const HISTORICAL_ROW_SCHEMA='AcceptanceSpec@1';
const HISTORICAL_VALUE_SCHEMA='helix://contracts/types/AcceptanceSpecDraft/v1';
function fail(){throw Object.assign(new Error('Retained custom target evidence is incomplete or inconsistent.'),
  {code:'LIBRA_RESET_CUSTOM_TARGET_INVALID'});}
function parse(row,column){try{return JSON.parse(row?.[column]);}catch{fail();}}

// This Owner reader receives only exact objects selected by the offline copy.
// It never chooses Subjects or scans their unrelated target history.
function createFreshResetCustomTargetRetention(options){
  if(!options?.schemaManifest||!options.unitOfWork)throw new TypeError('Custom target retention requires clean Owner persistence.');
  const repository=createRepositoryDefinition({repositoryId:'libra_reset_custom_target',owner:'libra',schemaManifest:options.schemaManifest,
    readOnly:true,statements:{
      spec:{kind:'select-one',tableId:'libra_acceptance_specs',keyColumns:['acceptance_spec_id'],columns:['acceptance_spec_id','subject_id',
        'shelf_id','product_scope_digest','spec_revision','spec_schema_ref','spec_json','spec_digest','record_digest']},
      intent:{kind:'select-one',tableId:'libra_custom_target_intents',keyColumns:['intent_id'],columns:['intent_id','preview_id','subject_id',
        'libra_run_id','product_scope_digest','target_revision','actor_id','idempotency_key','request_digest','record_schema_ref','record_json',
        'record_digest','created_at_ms']},
      preview:{kind:'select-one',tableId:'libra_custom_target_previews',keyColumns:['preview_id'],columns:['preview_id','subject_id',
        'libra_run_id','actor_id','record_schema_ref','record_json','record_digest','created_at_ms']},
      run:{kind:'select-one',tableId:'libra_runs',keyColumns:['libra_run_id'],columns:['libra_run_id','subject_id','acceptance_spec_id',
        'execution_basis_digest','execution_basis_record_json']},
      package:{kind:'select-one',tableId:'libra_product_packages',keyColumns:['on_deck_package_id'],columns:['on_deck_package_id','libra_run_id',
        'subject_id','shelf_id','acceptance_spec_id','acceptance_spec_record_digest']},
    }});
  function specFrom(repo,id){
    const row=repo.invoke('spec',{acceptance_spec_id:id}),value=parse(row,'spec_json');
    // Before 053260c409 the standard writer stored this exact pair. It is
    // recognized only by the cold retention reader; no stored fact changes.
    const historical=value?.targetKind===undefined&&row?.spec_schema_ref===HISTORICAL_ROW_SCHEMA&&value?.schemaRef===HISTORICAL_VALUE_SCHEMA;
    if(!row||!value||canonicalJson(value)!==row.spec_json||row.acceptance_spec_id!==value.acceptanceSpecId||
        row.subject_id!==value.subjectId||row.shelf_id!==value.targetShelfId||row.product_scope_digest!==value.productScope?.scopeDigest||
        row.spec_revision!==value.specRevision||(!historical&&row.spec_schema_ref!==value.schemaRef)||row.spec_digest!==value.specDigest||
        row.record_digest!==value.recordDigest)fail();
    return {row,value,historical};
  }
  function describeSpec(repo,id){
    const {value:spec,historical}=specFrom(repo,id);
    if(spec.targetKind===undefined){
      // Both versions digest the same frozen Draft. The temporary view lets
      // the current model verify that complete digest without rewriting it.
      assertStandardAcceptanceSpec(historical?{...spec,schemaRef:'libra.acceptance-spec@1'}:spec);return null;
    }
    if(spec.targetKind!=='user_custom'||!spec.customTargetRef||!spec.originalTarget)fail();
    const intentRow=repo.invoke('intent',{intent_id:spec.customTargetRef.intentId}),intent=parse(intentRow,'record_json'),
      previewRow=repo.invoke('preview',{preview_id:spec.customTargetRef.previewDigest}),preview=parse(previewRow,'record_json'),
      {value:baseSpec}=specFrom(repo,spec.originalTarget.acceptanceSpecId);
    if(!intentRow||!previewRow||!intent||!preview||canonicalJson(intent)!==intentRow.record_json||canonicalJson(preview)!==previewRow.record_json||
        intentRow.intent_id!==intent.intentId||intentRow.preview_id!==intent.previewDigest||intentRow.subject_id!==intent.subjectId||
        intentRow.libra_run_id!==intent.libraRunId||intentRow.product_scope_digest!==intent.basis?.productScopeDigest||
        intentRow.target_revision!==intent.revision||intentRow.actor_id!==intent.actorId||intentRow.idempotency_key!==intent.idempotencyKey||
        intentRow.request_digest!==intent.requestDigest||intentRow.record_schema_ref!==intent.schemaRef||intentRow.record_digest!==intent.intentDigest||
        intentRow.created_at_ms!==intent.confirmedAtMs||previewRow.preview_id!==preview.previewDigest||
        previewRow.subject_id!==preview.basis?.subjectId||previewRow.libra_run_id!==preview.basis?.libraRunId||
        previewRow.actor_id!==preview.actorId||previewRow.record_schema_ref!==preview.schemaRef||
        previewRow.record_digest!==preview.previewDigest||previewRow.created_at_ms!==preview.createdAtMs)fail();
    assertCustomAcceptanceSpec({spec,baseSpec,preview,intent});
    const body={schemaRef:SCHEMA,acceptanceSpecId:spec.acceptanceSpecId,specRecordDigest:spec.recordDigest,
      subjectId:spec.subjectId,productScopeDigest:spec.productScope.scopeDigest,intentId:intent.intentId,intentDigest:intent.intentDigest,
      previewId:preview.previewDigest,baseAcceptanceSpecId:baseSpec.acceptanceSpecId,baseRecordDigest:baseSpec.recordDigest};
    return Object.freeze({...body,digest:canonicalDigest(body)});
  }
  function validateRun(repo,runId){
    const run=repo.invoke('run',{libra_run_id:runId});if(!run)fail();
    const {value:spec}=specFrom(repo,run.acceptance_spec_id),basis=parse(run,'execution_basis_record_json');
    if(spec.subjectId!==run.subject_id)fail();
    if(spec.targetKind!=='user_custom'){
      if(basis?.collectionTargetRef!==undefined&&buildCollectionTargetReference(basis.collectionTargetRef).targetKind!=='standard')fail();
      return null;
    }
    const closure=describeSpec(repo,run.acceptance_spec_id);
    const ref=buildCollectionTargetReference(basis?.collectionTargetRef),expected=spec.customTargetRef;
    if(basis.subjectSnapshot?.subjectId!==run.subject_id||basis.executionBasisDigest!==run.execution_basis_digest||
        basis.acceptanceSpec?.acceptanceSpecId!==spec.acceptanceSpecId||basis.acceptanceSpec.specDigest!==spec.specDigest||
        basis.acceptanceSpec.recordDigest!==spec.recordDigest||basis.acceptanceSpec.specRevision!==spec.specRevision||
        basis.acceptanceSpec.productScopeDigest!==spec.productScope.scopeDigest||basis.acceptanceSpec.shelfId!==spec.targetShelfId||
        ref.targetKind!=='user_custom'||ref.intentId!==expected.intentId||ref.intentDigest!==expected.intentDigest||
        ref.targetRevision!==expected.targetRevision)fail();
    return closure;
  }
  const read=(participantId,fn)=>options.unitOfWork.execute([{participantId,owner:'libra',repositories:[repository],
    execute:context=>fn(context.repository(repository.repositoryId))}])[participantId];
  return Object.freeze({
    describeSpec:id=>read('libra_reset_custom_spec',repo=>describeSpec(repo,id)),
    validateRun:id=>read('libra_reset_custom_run',repo=>validateRun(repo,id)),
    validatePackage:id=>read('libra_reset_custom_package',repo=>{
      const item=repo.invoke('package',{on_deck_package_id:id});if(!item)fail();
      const {value:spec}=specFrom(repo,item.acceptance_spec_id);
      const run=repo.invoke('run',{libra_run_id:item.libra_run_id});
      if(!run||run.subject_id!==item.subject_id||run.acceptance_spec_id!==item.acceptance_spec_id||
          item.subject_id!==spec.subjectId||item.shelf_id!==spec.targetShelfId||item.acceptance_spec_record_digest!==spec.recordDigest)fail();
      return validateRun(repo,item.libra_run_id);
    }),
  });
}
module.exports=Object.freeze({SCHEMA,createFreshResetCustomTargetRetention});
