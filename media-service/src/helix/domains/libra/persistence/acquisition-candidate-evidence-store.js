'use strict';

const { canonicalJson, canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { assertCandidates } = require('../model/external-material-contracts');

const EVIDENCE = 'helix://contracts/types/AcquisitionCandidates/v1';
const RECORD = 'helix://contracts/types/AcquisitionCandidatesRecord/v1';
const fail = () => { throw Object.assign(new Error('Acquisition candidate Evidence does not match its immutable Run and execution scope.'),
  {code:'LIBRA_ACQUISITION_EVIDENCE_MISMATCH'}); };

function buildRecord(scope, value) {
  return {schemaRef:RECORD,schemaVersion:1,evidenceId:value.evidenceId,evidenceKind:'external_acquisition_candidates_record',
    producerRef:value.producerRef,basisDigest:value.basisDigest,payloadDigest:canonicalDigest(value),observedAtMs:value.observedAtMs,
    recordId:canonicalDigest({schema:'libra.acquisition-candidate-evidence@1',libraRunId:scope.libraRunId,
      searchEventAttemptId:scope.searchEventAttemptId}),...scope,queryDigest:value.queryDigest,integrationId:value.integrationId,
    configRevision:value.configRevision,candidateCount:value.candidates.length,candidateSetDigest:value.candidateSetDigest};
}

function createAcquisitionCandidateEvidenceStore(options) {
  const columns=['record_id','libra_run_id','search_work_id','search_event_id','search_event_attempt_id',
    'run_execution_basis_digest','evidence_schema_ref','evidence_json','evidence_digest','record_schema_ref','record_json',
    'record_digest','observed_at_ms'];
  const repository=createRepositoryDefinition({repositoryId:'libra_acquisition_candidate_evidence',owner:'libra',
    schemaManifest:options.schemaManifest,statements:{
      run:{kind:'select-one',tableId:'libra_runs',columns:['state','execution_basis_digest'],keyColumns:['libra_run_id']},
      attempt:{kind:'select-one',tableId:'libra_acquisition_candidate_evidence',columns,keyColumns:['search_event_attempt_id']},
      record:{kind:'select-one',tableId:'libra_acquisition_candidate_evidence',columns,keyColumns:['record_id']},
      insert:{kind:'insert',tableId:'libra_acquisition_candidate_evidence',columns},
    }});
  const execute=operation=>options.unitOfWork.execute([{participantId:'libra_acquisition_evidence',owner:'libra',repositories:[repository],
    execute:context=>operation(context.repository(repository.repositoryId))}]).libra_acquisition_evidence;
  function decode(row) {
    const value=JSON.parse(row.evidence_json),record=JSON.parse(row.record_json);
    options.contractValidator.validate(EVIDENCE,value);
    options.contractValidator.validate(RECORD,record);
    assertCandidates(value);
    const expected=buildRecord({libraRunId:row.libra_run_id,runExecutionBasisDigest:row.run_execution_basis_digest,
      searchWorkId:row.search_work_id,searchEventId:row.search_event_id,searchEventAttemptId:row.search_event_attempt_id},value);
    if(row.evidence_schema_ref!==EVIDENCE||row.record_schema_ref!==RECORD||row.evidence_digest!==canonicalDigest(value)||
      row.record_digest!==canonicalDigest(record)||row.record_id!==record.recordId||row.observed_at_ms!==value.observedAtMs||
      row.evidence_json!==canonicalJson(value)||row.record_json!==canonicalJson(expected))fail();
    return {value,record};
  }
  function assertScope(record,scope,query,handle) {
    if(Object.keys(scope).some(key=>record[key]!==scope[key])||record.queryDigest!==query.queryDigest||
      query.libraRunId!==scope.libraRunId||query.runExecutionBasisDigest!==scope.runExecutionBasisDigest||
      record.integrationId!==handle.integrationId||record.configRevision!==handle.configRevision)fail();
  }
  return Object.freeze({
    find(scope,query,handle) {return execute(repo=>{
      if(query.libraRunId!==scope.libraRunId||query.runExecutionBasisDigest!==scope.runExecutionBasisDigest)fail();
      const run=repo.invoke('run',{libra_run_id:scope.libraRunId});
      if(!run||run.state!=='active'||run.execution_basis_digest!==scope.runExecutionBasisDigest)fail();
      const row=repo.invoke('attempt',{search_event_attempt_id:scope.searchEventAttemptId});
      if(!row)return null;
      const {record}=decode(row);assertScope(record,scope,query,handle);return record;
    });},
    save(scope,query,handle,value) {
      options.contractValidator.validate(EVIDENCE,value);assertCandidates(value);
      const record=buildRecord(scope,value);options.contractValidator.validate(RECORD,record);assertScope(record,scope,query,handle);
      return execute(repo=>{
        const existing=repo.invoke('attempt',{search_event_attempt_id:scope.searchEventAttemptId});
        if(existing){const saved=decode(existing);if(canonicalJson(record)!==canonicalJson(saved.record))fail();return saved.record;}
        const run=repo.invoke('run',{libra_run_id:scope.libraRunId});
        if(!run||run.state!=='active'||run.execution_basis_digest!==scope.runExecutionBasisDigest)fail();
        repo.invoke('insert',{record_id:record.recordId,libra_run_id:scope.libraRunId,search_work_id:scope.searchWorkId,
          search_event_id:scope.searchEventId,search_event_attempt_id:scope.searchEventAttemptId,
          run_execution_basis_digest:scope.runExecutionBasisDigest,evidence_schema_ref:EVIDENCE,evidence_json:canonicalJson(value),
          evidence_digest:record.payloadDigest,record_schema_ref:RECORD,record_json:canonicalJson(record),
          record_digest:canonicalDigest(record),observed_at_ms:value.observedAtMs});
        return record;
      });
    },
    read(record,libraRunId) {
      options.contractValidator.validate(RECORD,record);
      if(record.libraRunId!==libraRunId)fail();
      return execute(repo=>{
        const row=repo.invoke('record',{record_id:record.recordId});if(!row)fail();
        const saved=decode(row);if(canonicalJson(saved.record)!==canonicalJson(record))fail();
        const run=repo.invoke('run',{libra_run_id:libraRunId});
        if(!run||run.execution_basis_digest!==record.runExecutionBasisDigest)fail();
        return saved.value;
      });
    },
  });
}

module.exports=Object.freeze({createAcquisitionCandidateEvidenceStore});
