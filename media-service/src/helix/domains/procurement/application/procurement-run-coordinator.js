'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');

class ProcurementRunCoordinatorError extends Error {
  constructor(code,message,details={}){super(message);this.name='ProcurementRunCoordinatorError';this.code=code;this.details=details;}
}
function fail(code,message,details){throw new ProcurementRunCoordinatorError(code,message,details);}
function stableId(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
const WORK_ADMISSION_LIMITS=Object.freeze({globalOpenWorks:256,ownerOpenWorks:256,openEvents:256});

function evidenceWork(snapshot){const runId=snapshot.run.procurement_run_id,basis=snapshot.run.run_basis_digest;
  return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
    workId:stableId('procurement-evidence-work-',{runId,basis}),ownerDomain:'procurement',processType:'procurement_run',processId:runId,
    workKind:'evidence_assessment',workObjectiveTypeRef:'helix://procurement/work/EvidenceAssessment/v1',workObjectiveVersion:1,
    executionBasisId:stableId('procurement-evidence-basis-',{runId,basis}),executionBasisDigest:basis,
    dependencyRefs:Object.freeze([]),priorityClass:'normal_foreground',priorityRevision:1,capabilityCatalogScope:'procurement',
    workspaceMaterialScope:Object.freeze([]),idempotencyKey:stableId('procurement-evidence-key-',{runId,basis}),
    concurrencyScope:runId+'/evidence-assessment',outputContractRef:'helix://contracts/types/TriageStructureEvidence/v1'});}

function candidateWork(snapshot,structure,unit,ordinal){const runId=snapshot.run.procurement_run_id,basis=canonicalDigest({
  schema:'procurement.candidate-assembly-work-basis@1',runBasisDigest:snapshot.run.run_basis_digest,
  structurePayloadDigest:structure.payloadDigest,unitId:unit.unitId,unitDigest:unit.unitDigest,ordinal});
  const suffix=String(ordinal).padStart(4,'0')+'-'+canonicalDigest({runId,unitId:unit.unitId}).slice(0,32);
  return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
    workId:'procurement-candidate-work-'+suffix,ownerDomain:'procurement',processType:'procurement_run',processId:runId,
    workKind:'candidate_assembly',workObjectiveTypeRef:'helix://procurement/work/CandidateAssembly/v1',workObjectiveVersion:1,
    executionBasisId:'procurement-candidate-basis-'+suffix,executionBasisDigest:basis,dependencyRefs:Object.freeze([]),
    priorityClass:'normal_foreground',priorityRevision:1,capabilityCatalogScope:'procurement',workspaceMaterialScope:Object.freeze([]),
    idempotencyKey:'procurement-candidate-key-'+suffix,concurrencyScope:runId+'/candidate/'+unit.unitId,
    outputContractRef:'helix://contracts/types/CandidatePackage/v1'});}

function createProcurementRunCoordinator(options){
  if(!options?.schemaManifest||!options.unitOfWork||!options.triageReader||!options.workResultReader||
      typeof options.workResultReader.status!=='function'||!options.evidenceIndex||typeof options.evidenceIndex.read!=='function'||
      !options.runSealStore)fail('P7_RUN_COORDINATOR_DEPENDENCIES',
    'Procurement Run Coordinator requires only Owner read facts and Work Admission.');
  return Object.freeze({
    reconcile(runId){const run=typeof options.triageReader.readRunHeader==='function'?options.triageReader.readRunHeader(runId):options.triageReader.read(runId)?.run;
      if(!run)return Object.freeze({kind:'not_found',runId});
      const snapshot=Object.freeze({run});
      if(!['active','waiting'].includes(snapshot.run.state))return Object.freeze({kind:'terminal',runId,state:snapshot.run.state});
      const definition=evidenceWork(snapshot);
      const admission=createWorkAdmission({schemaManifest:options.schemaManifest,unitOfWork:options.unitOfWork,
        eligibilityProvider:{check:(request)=>Object.freeze({eligible:request.ownerDomain==='procurement'&&request.processId===runId&&
          request.executionBasisDigest===snapshot.run.run_basis_digest,basisDigest:snapshot.run.run_basis_digest,
          reasonCode:'PROCUREMENT_RUN_EVIDENCE_BASIS_STALE'})},limits:WORK_ADMISSION_LIMITS});
      const result=admission.replay(definition)||admission.submit(definition);
      if(result.kind==='deferred')return Object.freeze({kind:'evidence_work_deferred',runId,reasonCode:result.reasonCode,newlyAdmitted:0});
      if(result.kind!=='admitted')fail('P7_RUN_EVIDENCE_WORK_NOT_ADMITTED','Evidence Assessment Work could not be admitted.',{runId,reasonCode:result.reasonCode});
      const evidenceIndex=options.evidenceIndex.read(definition.workId);
      const structures=evidenceIndex.structureResults;
      const existingWorks=typeof options.workResultReader.listWorks==='function'
        ? new Map(options.workResultReader.listWorks({ownerDomain:'procurement',processType:'procurement_run',processId:runId,workKind:'candidate_assembly'}).map((work)=>[work.work_id,work]))
        : null;
      const issued=[];let ordinal=0,newlyAdmitted=0,deferredReasonCode=null;
      structurePages: for(const structureRef of structures)for(const unit of structureRef.units){
        const candidate=candidateWork(snapshot,structureRef,unit,ordinal++);
        const existingWork=existingWorks?existingWorks.get(candidate.workId):options.workResultReader.status(candidate.workId);
        if(existingWork){issued.push(Object.freeze({workId:candidate.workId,unitId:unit.unitId,replayed:true,state:existingWork.state}));continue;}
        const candidateAdmission=createWorkAdmission({schemaManifest:options.schemaManifest,unitOfWork:options.unitOfWork,
          eligibilityProvider:{check:(request)=>Object.freeze({eligible:request.ownerDomain==='procurement'&&request.processId===runId&&
            request.executionBasisDigest===candidate.executionBasisDigest,basisDigest:candidate.executionBasisDigest,
            reasonCode:'PROCUREMENT_CANDIDATE_ASSEMBLY_BASIS_STALE'})},limits:WORK_ADMISSION_LIMITS});
        const admitted=candidateAdmission.replay(candidate)||candidateAdmission.submit(candidate);
        if(admitted.kind==='deferred'){deferredReasonCode=admitted.reasonCode;break structurePages;}
        if(admitted.kind!=='admitted')fail('P7_CANDIDATE_ASSEMBLY_WORK_NOT_ADMITTED','Candidate Assembly Work could not be admitted.',
          {runId,unitId:unit.unitId,reasonCode:admitted.reasonCode});
        newlyAdmitted+=admitted.replayed?0:1;
        issued.push(Object.freeze({workId:candidate.workId,unitId:unit.unitId,replayed:admitted.replayed}));
      }
      const terminalStructure=evidenceIndex.terminal;
      const unitCount=structures.reduce((count,item)=>count+item.units.length,0);
      const candidates=typeof options.triageReader.listCandidatePackages==='function'
        ? options.triageReader.listCandidatePackages(runId) : options.triageReader.read(runId).candidates;
      if(terminalStructure&&candidates.length===unitCount){
        const publishedCandidates=Object.freeze(candidates.map((candidate)=>Object.freeze({
          candidatePackageId:candidate.candidate_package_id,packageDigest:candidate.package_digest,manifestDigest:candidate.manifest_digest})));
        const unassigned=new Map(structures.flatMap((item)=>item.unassignedMaterials||[]).map((item)=>[item.materialKey,item]));
        const releasedMembers=Object.freeze([...unassigned.values()].sort((a,b)=>Buffer.compare(Buffer.from(a.materialKey),Buffer.from(b.materialKey)))
          .map((item)=>Object.freeze({materialKey:item.materialKey,disposition:'triage_failed',evidenceDigest:item.evidenceDigest})));
        const sealOutcome=publishedCandidates.length===0?'failed':releasedMembers.length?'partial_failure':'completed';
        const raw={decisionId:stableId('procurement-run-seal-decision-',{runId,runBasisDigest:snapshot.run.run_basis_digest,
          publishedCandidates,releasedMembers}),procurementRunId:runId,expectedStateRevision:Number(snapshot.run.state_revision),
          expectedRunBasisDigest:snapshot.run.run_basis_digest,sealOutcome,publishedCandidates,releasedMembers};
        const decision=Object.freeze({...raw,decisionDigest:canonicalDigest(raw)});
        const sealed=options.runSealStore.seal(decision);
        return Object.freeze({kind:'run_sealed',runId,workId:definition.workId,replayed:result.replayed,newlyAdmitted,
          candidateWorks:Object.freeze(issued),sealReceipt:sealed});
      }
      return Object.freeze({kind:deferredReasonCode?'candidate_work_deferred':issued.length?'candidate_work_ready':'evidence_work_ready',
        runId,workId:definition.workId,replayed:result.replayed,newlyAdmitted,deferredReasonCode,
        candidateWorks:Object.freeze(issued)});
    },
  });
}

module.exports=Object.freeze({ProcurementRunCoordinatorError,createProcurementRunCoordinator});
