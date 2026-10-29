'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createCommandCommitCoordinator } = require('../../../foundation/persistence/commit-foundation');
const CONTRACT = 'procurement.candidate-retirement@1';
const STATE = 'administratively_retired';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const normalize = value => typeof value === 'bigint' ? Number(value) : Array.isArray(value) ? value.map(normalize) :
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)])) : value;

function createCandidateRetirementStore(options) {
  const columns = table => options.schemaManifest.tables.find(row => row.tableId === table).columns;
  const read = (tableId,keyColumns,kind='select-all')=>({kind,tableId,columns:columns(tableId),keyColumns,safeIntegers:true});
  const repository=createRepositoryDefinition({repositoryId:'procurement_candidate_retirement',owner:'procurement',schemaManifest:options.schemaManifest,
    statements:{
      delivery:read('proc_candidate_deliveries',['offer_id'],'select-one'),
      members:read('proc_run_materials',['candidate_package_id']),
      primary:read('proc_candidate_primary_materials',['candidate_package_id']),
      retire:{kind:'update',tableId:'proc_candidate_deliveries',setColumns:['state','terminal_evidence_digest','closed_at_ms'],
        keyColumns:['offer_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
      release:{kind:'update',tableId:'proc_run_materials',setColumns:['selection_state','terminal_disposition','terminal_evidence_digest','reservation_updated_at_ms'],
        keyColumns:['procurement_run_id','ordinal'],compareColumns:[{column:'selection_state',parameter:'expected_state'},
          {column:'candidate_package_id',parameter:'expected_package_id'}]},
    }});
  const receipts=createRepositoryDefinition({repositoryId:'procurement_retirement_receipts',owner:'execution-foundation',readOnly:true,
    schemaManifest:options.schemaManifest,statements:{
      receipts:read('fx_command_receipts',['owner_domain','command_contract','target_type','target_id']),
      marker:read('fx_commit_markers',['commit_marker'],'select-one'),
    }});
  const commands=createCommandCommitCoordinator(options);
  function readReceipt(offerId) {
    return options.unitOfWork.execute([{participantId:'procurement_retirement_receipt_read',owner:'execution-foundation',repositories:[receipts],
      execute(context) {
        const repo=context.repository(receipts.repositoryId),rows=repo.invoke('receipts',{
          owner_domain:'procurement',command_contract:CONTRACT,target_type:'candidate_offer',target_id:offerId});
        if(!rows.length)return null;
        if(rows.length!==1)fail('PROCUREMENT_RETIREMENT_RECEIPT_CORRUPT','Candidate has multiple retirement receipts.');
        const row=rows[0],result=JSON.parse(row.result_ref_json),marker=repo.invoke('marker',{commit_marker:row.command_receipt_id});
        if(row.result_schema_ref!=='procurement.candidate-retirement-receipt@1'||canonicalDigest(result)!==row.result_digest||
            result.resultKind!==STATE||result.offerId!==offerId||!marker||marker.owner_domain!=='procurement'||
            marker.scope_type!=='candidate_offer'||marker.scope_id!==offerId||marker.commit_digest!==row.request_digest)
          fail('PROCUREMENT_RETIREMENT_RECEIPT_CORRUPT','Candidate retirement receipt or marker is inconsistent.');
        return {...result,receiptId:row.command_receipt_id,receiptDigest:row.result_digest};
      }}]).procurement_retirement_receipt_read;
  }
  function snapshot(repo,offerId) {
    const delivery=repo.invoke('delivery',{offer_id:offerId});
    if(!delivery)fail('PROCUREMENT_RETIREMENT_OFFER_MISSING','Candidate retirement requires a published Offer.');
    const value=normalize({delivery,members:repo.invoke('members',{candidate_package_id:delivery.candidate_package_id})
      .sort((a,b)=>a.material_key.localeCompare(b.material_key)),
      primary:repo.invoke('primary',{candidate_package_id:delivery.candidate_package_id}).sort((a,b)=>Number(a.ordinal)-Number(b.ordinal))});
    return {...value,snapshotDigest:canonicalDigest(value)};
  }
  function inspect(offerId){return options.unitOfWork.execute([{participantId:'procurement_retirement_read',owner:'procurement',repositories:[repository],
    execute:context=>snapshot(context.repository(repository.repositoryId),offerId)}]).procurement_retirement_read;}
  function commit(request) {
    if(!request?.retirementId||!request.offerId||!request.intakeProcessId||
        !['expectedSnapshotDigest','backupDigest','manifestDigest','intakeReceiptDigest'].every(key=>/^[a-f0-9]{64}$/.test(request[key]||'')))
      fail('PROCUREMENT_RETIREMENT_INVALID','Candidate retirement requires exact snapshots and an Intake retirement receipt.');
    // Public immutable Libra proof is read before this Owner's UOW, never as a
    // second business repository inside Procurement's transaction.
    const proof=options.readIntakeRetirementReceipt?.(request.intakeProcessId);
    const requestDigest=canonicalDigest(request),commandId=canonicalDigest({contract:CONTRACT,retirementId:request.retirementId,offerId:request.offerId});
    return commands.execute({command:{commandReceiptId:commandId,ownerDomain:'procurement',commandContract:CONTRACT,
      callerScope:'administrative-formation-reset',idempotencyKey:request.retirementId+':'+request.offerId,requestDigest,
      targetType:'candidate_offer',targetId:request.offerId},
      domainParticipant:{participantId:'procurement_candidate_retirement_commit',owner:'procurement',repositories:[repository],execute(context){
        const repo=context.repository(repository.repositoryId),current=snapshot(repo,request.offerId),delivery=current.delivery;
        if(current.snapshotDigest!==request.expectedSnapshotDigest)fail('PROCUREMENT_RETIREMENT_STALE','Candidate responsibility changed.');
        if(delivery.state!=='open'||delivery.handoff_decision_id||delivery.handoff_receipt_id||delivery.closed_at_ms!==null)
          fail('PROCUREMENT_RETIREMENT_TERMINAL','A closed or Accepted Delivery cannot be retired.');
        if(!proof||proof.resultKind!==STATE||proof.processId!==request.intakeProcessId||proof.offerId!==request.offerId||
            proof.receiptDigest!==request.intakeReceiptDigest||proof.candidatePackageId!==delivery.candidate_package_id||proof.packageDigest!==delivery.package_digest)
          fail('PROCUREMENT_RETIREMENT_INTAKE_PENDING','Libra must first prove this exact undecided Intake is retired.');
        const memberKeys=current.members.map(row=>row.material_key).sort(),primaryKeys=current.primary.map(row=>row.material_key).sort();
        if(!memberKeys.length||new Set(memberKeys).size!==memberKeys.length||canonicalDigest(memberKeys)!==canonicalDigest(primaryKeys)||
            current.members.some(row=>row.selection_state!=='candidate_delivery'||row.terminal_disposition!==null||row.terminal_evidence_digest!==null))
          fail('PROCUREMENT_RETIREMENT_SELECTION_CHANGED','Candidate no longer owns the exact current Reservation set.');
        for(const row of current.members)if(repo.invoke('release',{procurement_run_id:row.procurement_run_id,ordinal:row.ordinal,
          selection_state:'released',terminal_disposition:STATE,terminal_evidence_digest:proof.receiptDigest,
          reservation_updated_at_ms:context.commitTimeMs,expected_state:'candidate_delivery',expected_package_id:delivery.candidate_package_id}).changes!==1)
          fail('PROCUREMENT_RETIREMENT_CAS','Candidate Reservation changed.');
        if(repo.invoke('retire',{offer_id:request.offerId,state:STATE,terminal_evidence_digest:proof.receiptDigest,
          closed_at_ms:context.commitTimeMs,expected_state:'open'}).changes!==1)fail('PROCUREMENT_RETIREMENT_CAS','Candidate Delivery changed.');
        return {resultKind:STATE,offerId:request.offerId,candidatePackageId:delivery.candidate_package_id,packageDigest:delivery.package_digest,
          releasedMaterialCount:memberKeys.length,releasedMaterialSetDigest:canonicalDigest(memberKeys),intakeRetirementReceiptDigest:proof.receiptDigest,
          beforeDigest:current.snapshotDigest,afterDigest:snapshot(repo,request.offerId).snapshotDigest,
          backupDigest:request.backupDigest,manifestDigest:request.manifestDigest};
      }},
      commitMarker:{commitMarker:commandId,scopeType:'candidate_offer',scopeId:request.offerId,commitDigest:requestDigest},
      auditRecords:[{auditId:commandId,actorType:'admin',actorId:'admin',action:'administratively_retire_candidate',scopeType:'candidate_offer',
        scopeId:request.offerId,evidenceDigest:requestDigest}],
      resultEnvelope:resultRef=>({resultSchemaRef:'procurement.candidate-retirement-receipt@1',resultRef})});
  }
  return Object.freeze({inspect,commit,readReceipt});
}

module.exports=Object.freeze({createCandidateRetirementStore});
