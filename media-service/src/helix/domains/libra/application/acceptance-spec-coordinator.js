'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const { createDecisionBasisStore } = require('../persistence/decision-basis-store');
const { createAcceptanceSpecStore } = require('../persistence/acceptance-spec-store');

const LIMITS=Object.freeze({globalOpenWorks:256,ownerOpenWorks:256,openEvents:256});
const BASIS_RESULT='helix://contracts/types/DecisionBasisRevision/v1';
function stable(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
function definition(subjectId,basisDigest){return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
  workId:stable('libra-acceptance-spec-work-',{subjectId,basisDigest}),ownerDomain:'libra',processType:'libra_acceptance_spec',processId:subjectId,workKind:'acceptance_spec_basis',
  workObjectiveTypeRef:'helix://libra/work/acceptance-spec-basis/v1',workObjectiveVersion:1,executionBasisId:stable('libra-acceptance-spec-basis-',{subjectId,basisDigest}),executionBasisDigest:basisDigest,
  dependencyRefs:Object.freeze([]),priorityClass:'normal_foreground',priorityRevision:1,capabilityCatalogScope:'libra',workspaceMaterialScope:Object.freeze([]),
  idempotencyKey:stable('libra-acceptance-spec-key-',{subjectId,basisDigest}),concurrencyScope:subjectId+'/acceptance-spec',outputContractRef:BASIS_RESULT});}
function createAcceptanceSpecCoordinator(options){if(!options?.contextReader||!options.workResultReader)throw new TypeError('Acceptance Spec Coordinator requires Owner context and Foundation results.');
  const admission=createWorkAdmission({schemaManifest:options.schemaManifest,unitOfWork:options.unitOfWork,limits:LIMITS,eligibilityProvider:{check:(request)=>Object.freeze({eligible:request.ownerDomain==='libra'&&request.processType==='libra_acceptance_spec',basisDigest:request.executionBasisDigest,reasonCode:'LIBRA_ACCEPTANCE_SPEC_BASIS_STALE'})}}),
    basisStore=createDecisionBasisStore(options),specStore=createAcceptanceSpecStore(options),now=options.now||Date.now;
  function submit(work){return admission.replay(work)||admission.submit(work);}function succeeded(status){return status?.state==='succeeded'||status?.latestAttempt?.state==='succeeded';}
  function publish(subjectId,inputSet,basis,workId=null){const identity={subjectId,decisionBasisId:basis.decisionBasisId,inputSetDigest:inputSet.inputSetDigest};
    const published=specStore.publish({decisionInputSet:inputSet,decisionBasis:basis,producedAtMs:now(),commitMarker:stable('libra-acceptance-spec-marker-',identity),resultId:stable('libra-acceptance-spec-result-',identity)});
    return Object.freeze({kind:'terminal',subjectId,workId,spec:published.result,replayed:published.replayed});}
  function reconcile(subjectId){const context=options.contextReader.read(subjectId);if(context.kind==='current')return Object.freeze({kind:'terminal',subjectId,
      acceptanceSpecId:context.acceptanceSpecId,decisionBasisId:context.decisionBasisId,replayed:true});
    if(context.kind==='basis_ready')return publish(subjectId,context.inputSet,context.basis);
    if(context.kind!=='ready')return Object.freeze({...context,subjectId});
    const work=definition(subjectId,context.inputSet.inputSetDigest),submitted=submit(work),status=options.workResultReader.status(work.workId);if(!succeeded(status))return Object.freeze({kind:'pending',subjectId,workId:work.workId,replayed:submitted.replayed});
    const basis=options.workResultReader.read(work.workId).find((item)=>item.outcomeKind==='succeeded'&&item.result?.schemaRef===BASIS_RESULT)?.result;
    if(!basis)throw new Error('Terminal Acceptance Spec Basis Work has no DecisionBasisRevision Result.');const persisted=basisStore.readInputSet(basis.decisionBasisId);
    if(!persisted||persisted.inputSet.inputSetDigest!==context.inputSet.inputSetDigest)throw new Error('Acceptance Spec Basis inputs are unavailable.');
    return publish(subjectId,persisted.inputSet,basis,work.workId);}
  return Object.freeze({reconcile});}
module.exports=Object.freeze({createAcceptanceSpecCoordinator});
