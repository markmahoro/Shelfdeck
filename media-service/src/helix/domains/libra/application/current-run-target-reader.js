'use strict';

const {canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {customTargetHeadStatement,readTargetCommitFence}=require('../persistence/custom-target-commit-fence');
const {assertStandardAcceptanceSpec}=require('../model/custom-acceptance-spec');
const SHA=/^[a-f0-9]{64}$/;
function fail(){throw Object.assign(new Error('Current Run target evidence is invalid.'),{code:'LIBRA_RUN_TARGET_EVIDENCE_INVALID'});}

// This is only the Owner's Run/target-currency read, not a scheduling permit:
// replacement drain, current standard, material control and Arca responsibility
// must be independently checked before any work or workspace can be started.
function createCurrentRunTargetReader(options){
  if(!options?.schemaManifest||typeof options.unitOfWork?.captureReadFence!=='function')
    throw new TypeError('Current Run target reader requires clean persistence and a read fence.');
  const repository=createRepositoryDefinition({repositoryId:'libra_current_run_target',owner:'libra',schemaManifest:options.schemaManifest,
    readOnly:true,statements:{
      run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','state','state_revision','state_digest',
        'acceptance_spec_id','execution_basis_digest','execution_basis_record_json'],keyColumns:['libra_run_id']},
      spec:{kind:'select-one',tableId:'libra_acceptance_specs',columns:['acceptance_spec_id','subject_id','shelf_id','product_scope_digest',
        'spec_revision','spec_digest','record_digest','spec_json'],keyColumns:['acceptance_spec_id']},
      find_custom_target_head:customTargetHeadStatement,
    }});
  return Object.freeze({read(libraRunId,{readFence=options.unitOfWork.captureReadFence(),allowSuspended=false}={}){
    if(typeof libraRunId!=='string'||!libraRunId)throw new TypeError('Exact Libra Run is required.');
    const result=options.unitOfWork.execute([{participantId:'libra_current_run_target_read',owner:'libra',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId),run=repo.invoke('run',{libra_run_id:libraRunId});
      if(!run)fail();
      if(run.state!=='active'&&!(allowSuspended===true&&run.state==='suspended'))
        return Object.freeze({kind:'run_not_active',libraRunId,state:run.state});
      const row=repo.invoke('spec',{acceptance_spec_id:run.acceptance_spec_id});let basis,spec;
      try{basis=JSON.parse(run.execution_basis_record_json);spec=JSON.parse(row?.spec_json);}catch{fail();}
      if(!row||!basis||!spec||canonicalJson(spec)!==row.spec_json||!SHA.test(run.execution_basis_digest||'')||
          !Number.isSafeInteger(run.state_revision)||run.state_revision<1||!SHA.test(run.state_digest||'')||
          basis.subjectSnapshot?.subjectId!==run.subject_id||basis.executionBasisDigest!==run.execution_basis_digest||
          row.subject_id!==run.subject_id||spec.subjectId!==run.subject_id||spec.acceptanceSpecId!==row.acceptance_spec_id||
          spec.recordDigest!==row.record_digest||spec.specDigest!==row.spec_digest||spec.specRevision!==row.spec_revision||
          spec.targetShelfId!==row.shelf_id||spec.productScope?.scopeDigest!==row.product_scope_digest||
          basis.acceptanceSpec?.acceptanceSpecId!==row.acceptance_spec_id||basis.acceptanceSpec.specDigest!==row.spec_digest||
          basis.acceptanceSpec.recordDigest!==row.record_digest||basis.acceptanceSpec.productScopeDigest!==row.product_scope_digest||
          basis.acceptanceSpec.specRevision!==row.spec_revision||basis.acceptanceSpec.shelfId!==row.shelf_id)fail();
      if(spec.targetKind===undefined)assertStandardAcceptanceSpec(spec);
      const current=readTargetCommitFence(repo,{subjectId:run.subject_id,productScopeDigest:row.product_scope_digest,
        specJson:row.spec_json,executionBasisRecordJson:run.execution_basis_record_json});
      return Object.freeze({kind:current?'target_current':'target_not_current',libraRunId,
        targetKind:spec.targetKind==='user_custom'?'user_custom':'standard',subjectId:run.subject_id,
        productScopeDigest:row.product_scope_digest,executionBasisDigest:run.execution_basis_digest});
    }}],{readFence}).libra_current_run_target_read;
    return result.kind==='target_current'?Object.freeze({...result,readFence}):result;
  }});
}
module.exports=Object.freeze({createCurrentRunTargetReader});
