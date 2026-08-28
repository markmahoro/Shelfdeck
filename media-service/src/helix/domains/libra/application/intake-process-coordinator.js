'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');

const { PREDECK_INTAKE_SEATS } = require('./predeck-intake-occupancy');
const LIMITS=Object.freeze({globalOpenWorks:256,ownerOpenWorks:256,openEvents:256,reservedOpenWorks:16});
const SEAT_WAIT=Object.freeze({kind:'seat_wait',reasonCode:'PREDECK_INTAKE_SEATS_FULL'});
function stable(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
function definition(kind,processId,basis,dependencyRefs=[]){return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
  workId:stable('libra-intake-'+kind+'-work-',{processId,basis}),ownerDomain:'libra',processType:'libra_intake',processId,workKind:kind,
  workObjectiveTypeRef:'helix://libra/work/'+kind+'/v1',workObjectiveVersion:1,executionBasisId:stable('libra-intake-'+kind+'-basis-',{processId,basis}),
  executionBasisDigest:basis,dependencyRefs:Object.freeze(dependencyRefs),priorityClass:'handoff_acceptance',priorityRevision:1,
  capabilityCatalogScope:'libra',workspaceMaterialScope:Object.freeze([]),idempotencyKey:stable('libra-intake-'+kind+'-key-',{processId,basis}),
  concurrencyScope:processId+'/'+kind,outputContractRef:kind==='evidence'?'helix://contracts/types/IntakeMaterialVerification/v1':
    kind==='acceptance'?'helix://contracts/types/SubjectAndTransferReceipt/v1':'helix://contracts/types/IntakeRejectionReceipt/v1'});}
function createIntakeProcessCoordinator(options){
  const deferredProcesses=new Set();
  let durableCursor=null;
  const admission=options.workAdmission||createWorkAdmission({schemaManifest:options.schemaManifest,unitOfWork:options.unitOfWork,limits:LIMITS,
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
  function freeSeats(){
    if(typeof options.occupancyProvider?.snapshot!=='function')return Number.POSITIVE_INFINITY;
    return options.occupancyProvider.snapshot().freeSeats;
  }
  function existingEvidence(processId){
    const work=evidence(processId);if(!work)return null;
    return options.workResultReader.status(work.workId)||admission.replay(work)?work:null;
  }
  function mayStartNewIntake(processId){
    if(existingEvidence(processId))return true;
    return freeSeats()>0;
  }
  return Object.freeze({
    admitOffer(offer){const source=options.offerReader.remember?.(offer),processId=source?.processId||options.offerReader.decisionId(offer.offerId),work=evidence(processId);if(!work)throw new Error('Offered Candidate Snapshot is unavailable.');
      if(!mayStartNewIntake(processId)){deferredProcesses.add(processId);return Object.freeze({processId,work,result:SEAT_WAIT});}
      const result=submit(work);if(result?.kind==='deferred')deferredProcesses.add(processId);else deferredProcesses.delete(processId);
      return Object.freeze({processId,work,result});},
    reconcile(processId){const source=options.offerReader.read(processId);if(!source)return Object.freeze({kind:'not_found',processId});
      if(!mayStartNewIntake(processId)){deferredProcesses.add(processId);return Object.freeze({kind:'seat_wait',processId,reasonCode:SEAT_WAIT.reasonCode,seats:PREDECK_INTAKE_SEATS});}
      const evidenceWork=evidence(processId),evidenceAdmission=submit(evidenceWork),status=options.workResultReader.status(evidenceWork.workId);
      if(!succeeded(status))return Object.freeze({kind:'evidence_pending',processId,workId:evidenceWork.workId,replayed:evidenceAdmission.replayed});
      const results=options.workResultReader.read(evidenceWork.workId).filter((item)=>item.outcomeKind==='succeeded').map((item)=>item.result);
      const candidate=results.find((item)=>item.schemaRef==='helix://contracts/types/CandidateContractVerification/v1');
      const material=results.find((item)=>item.schemaRef==='helix://contracts/types/IntakeMaterialVerification/v1');
      if(!candidate||!material)throw new Error('Terminal Intake Evidence Work has incomplete Results.');
      const accepted=candidate.result==='passed'&&material.result==='passed',kind=accepted?'acceptance':'rejection';
      const basis=canonicalDigest({schema:'libra.intake-'+kind+'-basis@1',snapshotDigest:source.snapshot.deliverySnapshotDigest,
        candidateVerificationDigest:canonicalDigest(candidate),materialVerificationDigest:canonicalDigest(material)});
      const dependency=Object.freeze({ownerDomain:'libra',objectType:'supporting_work',objectId:evidenceWork.workId,revision:1,
        digest:evidenceWork.executionBasisDigest});
      const next=definition(kind,processId,basis,[dependency]),nextResult=submit(next);
      if(nextResult?.kind==='deferred'){deferredProcesses.add(processId);return Object.freeze({kind:kind+'_deferred',processId,evidenceWorkId:evidenceWork.workId,
        workId:next.workId,outcome:accepted?'accepted':'rejected',reasonCode:nextResult.reasonCode});}
      deferredProcesses.delete(processId);
      const nextStatus=options.workResultReader.status(next.workId);
      return Object.freeze({kind:succeeded(nextStatus)?'terminal':kind+'_pending',processId,evidenceWorkId:evidenceWork.workId,
        workId:next.workId,outcome:accepted?'accepted':'rejected',replayed:nextResult.replayed});}
    ,reconcilePending({ignoreAcceptanceProcessId=null,limit=100,admissionLimit=32}={}){let visited=0;const admitted=[];
      const newAdmitLimit=Math.min(admissionLimit,freeSeats());
      const processIds=[...deferredProcesses].slice(0,limit),known=new Set(processIds);
      let durablePage=null;
      if(processIds.length<limit&&typeof options.offerReader.listProcessPage==='function'){
        durablePage=options.offerReader.listProcessPage(durableCursor,limit-processIds.length);
        for(const item of durablePage.items||[]){if(!known.has(item.processId)){known.add(item.processId);processIds.push(item.processId);}}
      }
      let lastDurableVisited=null;
      for(const processId of processIds){visited+=1;if(processId===ignoreAcceptanceProcessId)continue;
        if(!existingEvidence(processId)&&admitted.length>=newAdmitLimit){
          deferredProcesses.add(processId);continue;}
        const result=this.reconcile(processId);
        if(durablePage?.items?.some((item)=>item.processId===processId))lastDurableVisited=processId;
        if(result.kind==='seat_wait'){deferredProcesses.add(processId);continue;}
        if(!String(result.kind).endsWith('_deferred'))deferredProcesses.delete(processId);
        if(['evidence_pending','acceptance_pending','rejection_pending'].includes(result.kind)&&result.replayed===false)admitted.push(result);
        if(admitted.length>=admissionLimit)break;}
      if(durablePage){
        if(lastDurableVisited&&lastDurableVisited!==durablePage.items.at(-1)?.processId)durableCursor=lastDurableVisited;
        else durableCursor=durablePage.nextCursor;
      }
      return Object.freeze({visited,admitted:Object.freeze(admitted),admittedCount:admitted.length});}
  });
}

module.exports=Object.freeze({createIntakeProcessCoordinator});
