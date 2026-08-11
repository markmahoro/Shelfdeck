'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');

const LIMITS=Object.freeze({globalOpenWorks:256,ownerOpenWorks:256,openEvents:256});
const OPEN_WORK_STATES=new Set(['admitted','ready','running','blocked']);
function stable(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
function definition(kind,processId,basis,dependencyRefs=[]){return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
  workId:stable('libra-intake-'+kind+'-work-',{processId,basis}),ownerDomain:'libra',processType:'libra_intake',processId,workKind:kind,
  workObjectiveTypeRef:'helix://libra/work/'+kind+'/v1',workObjectiveVersion:1,executionBasisId:stable('libra-intake-'+kind+'-basis-',{processId,basis}),
  executionBasisDigest:basis,dependencyRefs:Object.freeze(dependencyRefs),priorityClass:'handoff_acceptance',priorityRevision:1,
  capabilityCatalogScope:'libra',workspaceMaterialScope:Object.freeze([]),idempotencyKey:stable('libra-intake-'+kind+'-key-',{processId,basis}),
  concurrencyScope:processId+'/'+kind,outputContractRef:kind==='evidence'?'helix://contracts/types/IntakeMaterialVerification/v1':
    kind==='acceptance'?'helix://contracts/types/SubjectAndTransferReceipt/v1':'helix://contracts/types/IntakeRejectionReceipt/v1'});}
function createIntakeProcessCoordinator(options){
  const admission=createWorkAdmission({schemaManifest:options.schemaManifest,unitOfWork:options.unitOfWork,limits:LIMITS,
    eligibilityProvider:{check:(request)=>Object.freeze({eligible:request.ownerDomain==='libra'&&request.processType==='libra_intake',
      basisDigest:request.executionBasisDigest,reasonCode:'LIBRA_INTAKE_BASIS_STALE'})}});
  function submit(value){
    const result=admission.replay(value)||admission.submit(value);
    if(result?.kind==='invalid_contract'){
      const error=new Error('Libra Intake Work Definition violates the Foundation contract.');
      error.code=result.reasonCode||'LIBRA_INTAKE_WORK_INVALID';
      throw error;
    }
    return result;
  }
  function evidence(processId){const source=options.offerReader.read(processId);if(!source)return null;
    return definition('evidence',processId,canonicalDigest({schema:'libra.intake-evidence-basis@1',offerId:source.offer.offerId,
      snapshotDigest:source.snapshot.deliverySnapshotDigest}));}
  function succeeded(status){return status?.state==='succeeded'||status?.latestAttempt?.state==='succeeded';}
  function otherAcceptanceOpen(processId,ignoredProcessId){return options.workResultReader.listOwnerWorks({ownerDomain:'libra',workKind:'acceptance'})
    .some((work)=>OPEN_WORK_STATES.has(work.state)&&work.process_id!==processId&&work.process_id!==ignoredProcessId);}
  return Object.freeze({
    admitOffer(offer){const processId=options.offerReader.decisionId(offer.offerId),work=evidence(processId);if(!work)throw new Error('Offered Candidate Snapshot is unavailable.');
      return Object.freeze({processId,work,result:submit(work)});},
    reconcile(processId,control={}){const source=options.offerReader.read(processId);if(!source)return Object.freeze({kind:'not_found',processId});
      const evidenceWork=evidence(processId),evidenceAdmission=submit(evidenceWork),status=options.workResultReader.status(evidenceWork.workId);
      if(!succeeded(status))return Object.freeze({kind:'evidence_pending',processId,workId:evidenceWork.workId,replayed:evidenceAdmission.replayed});
      const results=options.workResultReader.read(evidenceWork.workId).filter((item)=>item.outcomeKind==='succeeded').map((item)=>item.result);
      const candidate=results.find((item)=>item.schemaRef==='helix://contracts/types/CandidateContractVerification/v1');
      const material=results.find((item)=>item.schemaRef==='helix://contracts/types/IntakeMaterialVerification/v1');
      if(!candidate||!material)throw new Error('Terminal Intake Evidence Work has incomplete Results.');
      const accepted=candidate.result==='passed'&&material.result==='passed',kind=accepted?'acceptance':'rejection';
      if(accepted&&otherAcceptanceOpen(processId,control.ignoreAcceptanceProcessId)){
        return Object.freeze({kind:'acceptance_queued',processId,evidenceWorkId:evidenceWork.workId});
      }
      const basis=canonicalDigest({schema:'libra.intake-'+kind+'-basis@1',snapshotDigest:source.snapshot.deliverySnapshotDigest,
        candidateVerificationDigest:canonicalDigest(candidate),materialVerificationDigest:canonicalDigest(material)});
      const dependency=Object.freeze({ownerDomain:'libra',objectType:'supporting_work',objectId:evidenceWork.workId,revision:1,
        digest:evidenceWork.executionBasisDigest});
      const next=definition(kind,processId,basis,[dependency]),nextResult=submit(next);
      if(nextResult?.kind==='deferred')return Object.freeze({kind:kind+'_deferred',processId,evidenceWorkId:evidenceWork.workId,
        workId:next.workId,outcome:accepted?'accepted':'rejected',reasonCode:nextResult.reasonCode});
      const nextStatus=options.workResultReader.status(next.workId);
      return Object.freeze({kind:succeeded(nextStatus)?'terminal':kind+'_pending',processId,evidenceWorkId:evidenceWork.workId,
        workId:next.workId,outcome:accepted?'accepted':'rejected',replayed:nextResult.replayed});}
    ,reconcilePending({ignoreAcceptanceProcessId=null,limit=100}={}){let cursor=null,visited=0,admitted=null;
      while(visited<limit){const page=options.offerReader.listProcessPage(cursor,Math.min(100,limit-visited));if(page.items.length===0)break;
        for(const item of page.items){visited+=1;if(item.processId===ignoreAcceptanceProcessId)continue;
          const result=this.reconcile(item.processId,{ignoreAcceptanceProcessId});
          if(result.kind==='acceptance_pending'&&result.replayed===false){admitted=result;break;}}
        if(admitted||!page.nextCursor)break;cursor=page.nextCursor;}
      return Object.freeze({visited,admitted});}
  });
}

module.exports=Object.freeze({createIntakeProcessCoordinator});
