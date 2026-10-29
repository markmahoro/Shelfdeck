'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createCommandCommitCoordinator } = require('../../../foundation/persistence/commit-foundation');
const { createExecutionStateReader } = require('../../../foundation/persistence/execution-state-reader');
const { decisionId } = require('./intake-offer-reader');

const CONTRACT = 'libra.intake-retirement@1';
const STATE = 'administratively_retired';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const normalize = value => typeof value === 'bigint' ? Number(value) : Array.isArray(value) ? value.map(normalize) :
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)])) : value;

function createIntakeRetirementStore(options) {
  const columns = table => options.schemaManifest.tables.find(row => row.tableId === table).columns;
  const select = (tableId, keyColumns, kind = 'select-all') => ({ kind, tableId, columns: columns(tableId), keyColumns, safeIntegers: true });
  const repository = createRepositoryDefinition({ repositoryId: 'libra_intake_retirement', owner: 'libra', schemaManifest: options.schemaManifest,
    statements: {
      decision: select('libra_intake_decisions', ['intake_decision_id'], 'select-one'),
      receipt: select('libra_handoff_a_receipts', ['intake_decision_id'], 'select-one'),
      tokens: select('libra_predeck_pipeline_tokens', ['source_process_id']),
      release: { kind: 'delete', tableId: 'libra_predeck_pipeline_tokens', keyColumns: ['subject_id','source_process_id'] },
    } });
  const audit = createRepositoryDefinition({ repositoryId: 'libra_intake_retirement_receipts', owner: 'execution-foundation', readOnly: true,
    schemaManifest: options.schemaManifest, statements: {
      receipts: select('fx_command_receipts', ['owner_domain','command_contract','target_id']),
      marker: select('fx_commit_markers', ['commit_marker'], 'select-one'),
      all: select('fx_command_receipts', ['owner_domain','command_contract']),
    } });
  const commands = createCommandCommitCoordinator(options), execution = createExecutionStateReader(options);
  function snapshot(repo, processId) {
    const value = normalize({ processId, decision: repo.invoke('decision', { intake_decision_id: processId }) || null,
      receipt: repo.invoke('receipt', { intake_decision_id: processId }) || null,
      tokens: repo.invoke('tokens', { source_process_id: processId }).sort((a,b)=>a.subject_id.localeCompare(b.subject_id)) });
    return { ...value, snapshotDigest: canonicalDigest(value) };
  }
  function inspect(processId) {
    return options.unitOfWork.execute([{ participantId:'libra_intake_retirement_read', owner:'libra', repositories:[repository],
      execute:context=>snapshot(context.repository(repository.repositoryId),processId) }]).libra_intake_retirement_read;
  }
  function receiptFromRepository(repo, processId) {
    const rows=repo.invoke('receipts',{owner_domain:'libra',command_contract:CONTRACT,target_id:processId});
    if(!rows.length)return null;
    if(rows.length!==1)fail('LIBRA_INTAKE_RETIREMENT_CORRUPT','An Intake has multiple retirement receipts.');
    const row=rows[0],result=JSON.parse(row.result_ref_json),marker=repo.invoke('marker',{commit_marker:row.command_receipt_id});
    if(row.result_schema_ref!=='libra.intake-retirement-receipt@1'||row.target_type!=='libra_intake'||canonicalDigest(result)!==row.result_digest||result.processId!==processId||result.resultKind!==STATE||
        !marker||marker.owner_domain!=='libra'||marker.scope_type!=='libra_intake'||marker.scope_id!==processId||marker.commit_digest!==row.request_digest)
      fail('LIBRA_INTAKE_RETIREMENT_CORRUPT','Intake retirement receipt or marker is inconsistent.');
    return {...result,receiptId:row.command_receipt_id,receiptDigest:row.result_digest};
  }
  function readReceipt(processId) {
    return options.unitOfWork.execute([{participantId:'libra_intake_retirement_receipt_read',owner:'execution-foundation',repositories:[audit],
      execute:context=>receiptFromRepository(context.repository(audit.repositoryId),processId)}]).libra_intake_retirement_receipt_read;
  }
  function activeAdmissionGuard(processId) {
    return {participantId:'libra_intake_retirement_admission_guard',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[audit],
      execute(context) {
        if(receiptFromRepository(context.repository(audit.repositoryId),processId))
          fail('LIBRA_INTAKE_RETIRED','A retired Intake cannot reacquire a pipeline token.');
      }};
  }
  function listProcessIds() {
    const ids=options.unitOfWork.execute([{ participantId:'libra_intake_retirement_list', owner:'execution-foundation', repositories:[audit],
      execute:context=>context.repository(audit.repositoryId).invoke('all',{owner_domain:'libra',command_contract:CONTRACT})
        .map(row=>row.target_id).sort() }]).libra_intake_retirement_list;
    for(const id of ids)readReceipt(id);
    return ids;
  }
  function commit(request) {
    if(!request?.retirementId || request.processId!==decisionId(request.offerId) || !request.candidatePackageId ||
        !['packageDigest','expectedSnapshotDigest','backupDigest','manifestDigest','candidateSnapshotDigest'].every(key=>/^[a-f0-9]{64}$/.test(request[key]||'')))
      fail('LIBRA_INTAKE_RETIREMENT_INVALID','Intake retirement requires an exact Offer, snapshot and backup.');
    const previous=readReceipt(request.processId),requestDigest=canonicalDigest(request);
    const commandId=canonicalDigest({contract:CONTRACT,retirementId:request.retirementId,processId:request.processId});
    if(previous&&previous.receiptId!==commandId)fail('LIBRA_INTAKE_ALREADY_RETIRED','Intake was retired by another command.');
    const candidate=previous?null:options.readCandidateSnapshot?.(request.offerId);
    const candidateValid=previous || candidate?.snapshotDigest===request.candidateSnapshotDigest && candidate.delivery?.state==='open' &&
      candidate.delivery.candidate_package_id===request.candidatePackageId && candidate.delivery.package_digest===request.packageDigest;
    const guard=execution.createExecutionStateReadParticipant([{ownerDomain:'libra',processType:'libra_intake',processId:request.processId}],summaries=>{
      if(summaries.some(row=>row.hasOpenWork||row.hasOpenEvent||row.hasUnsettledEffect))
        fail('LIBRA_INTAKE_RETIREMENT_EXECUTION_PENDING','Intake execution must close before retirement.');
    });
    return commands.execute({ command:{commandReceiptId:commandId,ownerDomain:'libra',commandContract:CONTRACT,
      callerScope:'administrative-formation-reset',idempotencyKey:request.retirementId+':'+request.processId,
      requestDigest,targetType:'libra_intake',targetId:request.processId},
      validationParticipants:[{...guard,boundBusinessOwner:'libra'}],
      domainParticipant:{participantId:'libra_intake_retirement_commit',owner:'libra',repositories:[repository],execute(context){
        const repo=context.repository(repository.repositoryId),current=snapshot(repo,request.processId);
        if(!candidateValid||current.snapshotDigest!==request.expectedSnapshotDigest)
          fail('LIBRA_INTAKE_RETIREMENT_STALE','Intake or candidate delivery changed.');
        if(current.decision||current.receipt)fail('LIBRA_INTAKE_RETIREMENT_TERMINAL','A decided Intake cannot be administratively rewritten.');
        for(const token of current.tokens)repo.invoke('release',{subject_id:token.subject_id,source_process_id:request.processId});
        return {resultKind:STATE,processId:request.processId,offerId:request.offerId,candidatePackageId:request.candidatePackageId,
          packageDigest:request.packageDigest,releasedTokenCount:current.tokens.length,
          beforeDigest:current.snapshotDigest,afterDigest:snapshot(repo,request.processId).snapshotDigest,
          backupDigest:request.backupDigest,manifestDigest:request.manifestDigest};
      }},
      commitMarker:{commitMarker:commandId,scopeType:'libra_intake',scopeId:request.processId,commitDigest:requestDigest},
      auditRecords:[{auditId:commandId,actorType:'admin',actorId:'admin',action:'administratively_retire_intake',scopeType:'libra_intake',
        scopeId:request.processId,evidenceDigest:requestDigest}],
      resultEnvelope:resultRef=>({resultSchemaRef:'libra.intake-retirement-receipt@1',resultRef}) });
  }
  function retiredAdmission(offer) {
    const processId=decisionId(offer.offerId),receipt=readReceipt(processId);
    if(!receipt)return null;
    if(receipt.offerId!==offer.offerId||receipt.candidatePackageId!==offer.candidatePackageId||receipt.packageDigest!==offer.packageDigest)
      fail('LIBRA_INTAKE_RETIREMENT_OFFER_MISMATCH','A retired Intake cannot consume another Candidate.');
    return {kind:STATE,processId,retirementReceipt:receipt,
      admissionParticipant:{participantId:'libra_retired_intake_consumption',owner:'libra',repositories:[repository],execute(context){
        const current=snapshot(context.repository(repository.repositoryId),processId);
        if(current.decision||current.receipt||current.tokens.length)fail('LIBRA_INTAKE_RETIREMENT_CORRUPT','Retired Intake has current responsibility.');
        return {processId,retirementReceiptId:receipt.receiptId,retirementReceiptDigest:receipt.receiptDigest};
      }}};
  }
  return Object.freeze({inspect,commit,readReceipt,listProcessIds,retiredAdmission,activeAdmissionGuard});
}

module.exports=Object.freeze({createIntakeRetirementStore});
