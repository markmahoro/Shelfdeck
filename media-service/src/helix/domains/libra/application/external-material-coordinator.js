'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const contracts=require('../model/external-material-contracts');

class ExternalMaterialCoordinatorError extends Error{
  constructor(code,message){super(message);this.name='ExternalMaterialCoordinatorError';this.code=code;}
}
const fail=(code,message)=>{throw new ExternalMaterialCoordinatorError(code,message);};

function request(operationId,integrationHandle,secretLeaseHandle,input,timeoutMs,idempotencyKey){
  const basis={integrationId:integrationHandle.integrationId,integrationType:integrationHandle.integrationType,
    configRevision:integrationHandle.configRevision,operationId,idempotencyKey,input};
  return Object.freeze({integrationHandle,secretLeaseHandle,operationId,idempotencyKey,requestDigest:canonicalDigest(basis),timeoutMs,input});
}

function createExternalMaterialCoordinator(options){
  if(!options?.observationPort||typeof options.observationPort.execute!=='function'||!options.requestPort||typeof options.requestPort.execute!=='function'||
      !options.workspaceImportPort||typeof options.workspaceImportPort.execute!=='function')fail('P9_EXTERNAL_PORTS','Exact Provider and Workspace ports are required.');
  const now=()=>options.now();
  return Object.freeze({
    prepareQuery:(input)=>contracts.buildAcquisitionQuery({...input,producedAtMs:now()}),
    async search(input){
      const req=request('libra.external_material.search@1',input.integrationHandle,input.secretLeaseHandle,
        {acquisitionQuery:input.acquisitionQuery,limit:input.limit},30000,'search-'+input.acquisitionQuery.queryDigest);
      const result=await options.observationPort.execute(req);
      return Object.freeze({schemaRef:'helix://contracts/types/AcquisitionCandidates/v1',schemaVersion:1,
        evidenceId:canonicalDigest({schema:'libra.external-acquisition-candidates-id@1',requestDigest:req.requestDigest,responseDigest:result.responseDigest}),
        evidenceKind:'external_acquisition_candidates',producerRef:result.transportRequestId,
        basisDigest:req.requestDigest,payloadDigest:canonicalDigest(result.result),observedAtMs:now(),...result.result});
    },
    select:(input)=>contracts.selectCandidate({...input,producedAtMs:now()}),
    async acquire(input){
      if(input.selectedCandidate?.result!=='selected')fail('P9_EXTERNAL_SELECTION_REQUIRED','Acquire requires selected Candidate.');
      const idempotencyKey=canonicalDigest({schema:'libra.external-acquisition-request-idempotency@1',queryDigest:input.acquisitionQuery.queryDigest,
        selectedCandidateId:input.selectedCandidate.selectedCandidateId});
      const req=request('libra.external_material.acquire.request@1',input.integrationHandle,input.secretLeaseHandle,
        {acquisitionQuery:input.acquisitionQuery,selectedCandidate:input.selectedCandidate},30000,idempotencyKey);
      return (await options.requestPort.execute(req)).result.externalJobReceipt;
    },
    async observe(input){
      const req=request('libra.external_material.acquire.observe@1',input.integrationHandle,input.secretLeaseHandle,
        {externalJobReceipt:input.externalJobReceipt,phase:input.phase},30000,'observe-'+input.externalJobReceipt.receiptId+'-'+input.phase);
      const result=await options.observationPort.execute(req);
      if(result.result.state==='pending')return Object.freeze({outcome:'deferred',reasonCode:'external_job_pending'});
      if(result.result.state==='failed')fail(result.result.reasonCode,'External acquisition failed terminally.');
      return contracts.buildAcquisitionObservation({externalJobReceipt:input.externalJobReceipt,providerSnapshot:result.result,
        phase:input.phase,producerRef:result.transportRequestId,observedAtMs:now()});
    },
    resolveOutput:contracts.buildExternalMaterialHandle,
    async observeStability(input){
      const req=request('libra.external_material.stability.observe@1',input.integrationHandle,input.secretLeaseHandle,
        {externalMaterialHandle:input.externalMaterialHandle,quietWindowMs:input.quietWindowMs},30000,
        'stability-'+input.externalMaterialHandle.handleId+'-'+input.externalMaterialHandle.observationRevision);
      const result=await options.observationPort.execute(req);
      try{return contracts.buildStableEvidence({externalMaterialHandle:input.externalMaterialHandle,providerSnapshot:result.result,
        quietWindowMs:input.quietWindowMs,productStructure:input.productStructure,verifiedAtMs:now()});}
      catch(error){if(error.code==='P9_EXTERNAL_STABILITY_DEFERRED')return Object.freeze({outcome:'deferred',reasonCode:'quiet_window_not_reached'});throw error;}
    },
    verifyIdentity:(input)=>contracts.verifyIdentity({...input,verifiedAtMs:now()}),
    verifyPackage:(input)=>contracts.verifyPackage({...input,verifiedAtMs:now()}),
    planImports:contracts.buildWorkspaceDeliveryContracts,
    async importOne(input){
      const contract=input.workspaceDeliveryContract,stable=input.stableEvidence,verified=input.verifiedExternalPackage;
      if(contract.verifiedPackageDigest!==canonicalDigest(verified)||contract.stableExternalMaterialHandleId!==stable.stableExternalMaterialHandle.handleId||
          !verified.verifiedMemberIds.includes(contract.externalMemberId))fail('P9_EXTERNAL_IMPORT_FENCE','Import inputs do not match the frozen contract.');
      const member=stable.stableExternalMaterialHandle.outputSnapshot.members.find((item)=>item.externalMemberId===contract.externalMemberId);
      const idempotencyKey=canonicalDigest({schema:'libra.external-material-import-effect@1',contractId:contract.contractId,
        stableExternalMaterialHandleId:contract.stableExternalMaterialHandleId,externalMemberId:contract.externalMemberId,targetRelativePath:contract.targetRelativePath});
      const receipt=await options.workspaceImportPort.execute(Object.freeze({idempotencyKey,contract,sourceHandle:stable.stableExternalMaterialHandle,
        sourceMember:member,targetRoot:contract.rootSnapshot,targetRelativePath:contract.targetRelativePath}));
      if(!receipt?.workspaceMaterialHandle||receipt.idempotencyKey!==idempotencyKey||receipt.workspaceMaterialHandle.workspaceId!==contract.workspaceId||
          receipt.workspaceMaterialHandle.relativePath!==contract.targetRelativePath)fail('P9_EXTERNAL_IMPORT_RECEIPT','Workspace import receipt does not bind the frozen contract.');
      return receipt.workspaceMaterialHandle;
    }
  });
}

module.exports=Object.freeze({ExternalMaterialCoordinatorError,createExternalMaterialCoordinator});
