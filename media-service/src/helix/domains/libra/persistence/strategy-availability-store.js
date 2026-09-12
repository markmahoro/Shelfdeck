'use strict';
const {canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {buildStrategyAvailability,validateStrategyAvailability}=require('../model/strategy-availability');
function createStrategyAvailabilityStore(options) {
  const repository=createRepositoryDefinition({repositoryId:'libra_strategy_availability',owner:'libra',schemaManifest:options.schemaManifest,statements:{
    run:{kind:'select-one',tableId:'libra_runs',keyColumns:['libra_run_id'],columns:['state','state_revision','state_digest','execution_basis_digest']},
    history:{kind:'select-all',tableId:'libra_strategy_availability',keyColumns:['libra_run_id','strategy_kind','condition_digest'],
      columns:['check_ordinal','evidence_json','evidence_digest']},
    insert:{kind:'insert',tableId:'libra_strategy_availability',columns:['libra_run_id','strategy_kind','condition_digest','check_ordinal',
      'evidence_schema_ref','evidence_json','evidence_digest','checked_at_ms']},
  }});
  return Object.freeze({observe(request,expectedRun){return options.unitOfWork.execute([{participantId:'libra_strategy_observation',owner:'libra',
    repositories:[repository],execute(context){const repo=context.repository(repository.repositoryId),run=repo.invoke('run',{libra_run_id:request.libraRunId});
    if(!run||run.state!=='active'||run.state_digest!==expectedRun.state_digest||Number(run.state_revision)!==Number(expectedRun.state_revision))
      throw Object.assign(new Error('Strategy observation belongs to a stale Run.'),{code:'LIBRA_STRATEGY_EVIDENCE_STALE'});
    const rows=repo.invoke('history',{libra_run_id:request.libraRunId,strategy_kind:request.strategyKind,condition_digest:request.conditionDigest})
      .sort((a,b)=>Number(a.check_ordinal)-Number(b.check_ordinal));
    if(rows.length>6||rows.some((row,index)=>Number(row.check_ordinal)!==index))throw new Error('Strategy observation history is invalid.');
    for(const row of rows)if(validateStrategyAvailability(JSON.parse(row.evidence_json)).evidenceDigest!==row.evidence_digest)
      throw new Error('Strategy observation history digest is invalid.');
    const previous=rows.length?JSON.parse(rows.at(-1).evidence_json):null;
    if(previous?.status==='unavailable')return previous;
    const value=buildStrategyAvailability({...request,executionBasisDigest:run.execution_basis_digest,previous});
    if(!value)return null;
    repo.invoke('insert',{libra_run_id:request.libraRunId,strategy_kind:request.strategyKind,condition_digest:request.conditionDigest,
      check_ordinal:value.checkOrdinal,evidence_schema_ref:value.schemaRef,evidence_json:canonicalJson(value),evidence_digest:value.evidenceDigest,checked_at_ms:value.checkedAtMs});
    return value;
  }}]).libra_strategy_observation;}});
}
module.exports=Object.freeze({createStrategyAvailabilityStore});
