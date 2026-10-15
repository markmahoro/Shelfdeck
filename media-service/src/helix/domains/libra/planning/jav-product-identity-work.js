'use strict';

const {canonicalDigest}=require('../../../contracts/canonical-json');
const {buildJavQueryAnchor,assertJavSourceSelectionSnapshot}=require('../../../contracts/jav-source-contracts');
const {buildJavIdentityIntent}=require('../model/jav-product-identity');
const {identityObservationWork}=require('./product-identity-work');
const CAPABILITY='libra.product_identity.evidence.observe@1';

function nextJavIdentityStage(options,snapshot) {
  const run=snapshot.run,manual=options.productIdentitySelection.readCurrent(run.libraRunId),
    context=options.routingContextReader.read(run.subjectId),identity=context?.subject;
  if(!identity || identity.contentProfile!=='jav')throw new Error('JAV identity stage requires its exact Subject.');
  const selectionRevision=manual?.intent_revision||0;
  const fence={subjectId:run.subjectId,libraRunId:run.libraRunId,runExecutionBasisDigest:run.executionBasisDigest,
    expectedRunStateRevision:run.stateRevision,expectedIdentityRevision:identity.currentIdentityRevision||0,
    expectedIdentityDigest:identity.currentIdentityDigest||null,expectedSelectionIntentRevision:selectionRevision,
    selectionIntentId:manual?.selection_intent_id||null,selectionIntentDigest:manual?.intent_digest||null};
  let sourceSnapshot,sourceOrdinals,resourceKey=null,expectedTitle=null,expectedCoverDigest=null;
  if(identity.currentIdentityRevision) {
    const established=options.movieProductionReader.readSubjectIdentityFact(run.subjectId,identity.currentIdentityDigest);
    if(!established?.javSourceQualification || established.contentProfile!=='jav')throw new Error('Established JAV identity lacks its exact qualified source.');
    sourceSnapshot=established.javSourceQualification.sourceSnapshot;
    sourceOrdinals=[established.javSourceQualification.sourceOrdinal];
    const proof=established.javSourceQualification.observation;
    resourceKey=proof.resourceKey;expectedTitle=proof.descriptiveEntries.find(entry=>entry.key==='title').value;
    expectedCoverDigest=proof.cover.byteDigest;
    if(manual && manual.provider_key!==sourceSnapshot.queryAnchor.javCode)throw new Error('JAV identity selection cannot change an established Subject.');
  }else if(manual) {
    if(manual.provider!=='jav'||manual.namespace!=='jav_code')throw new Error('Manual JAV selection does not match the Subject.');
    const record=JSON.parse(manual.selection_record_json);
    if(record.libraRunId!==run.libraRunId || record.runExecutionBasisDigest!==run.executionBasisDigest ||
        record.expectedRunStateRevision!==run.stateRevision)
      return Object.freeze({kind:'waiting',reasonCode:'jav_selection_basis_changed'});
    sourceSnapshot=record.sourceSnapshot;sourceOrdinals=[record.selectedSourceOrdinal];
    resourceKey=record.resourceKey;expectedTitle=record.qualificationObservation.descriptiveEntries.find(entry=>entry.key==='title').value;
    expectedCoverDigest=record.qualificationObservation.cover.byteDigest;
  }else {
    let anchor;
    try {anchor=buildJavQueryAnchor('jav_code',snapshot.candidateIdentityClaim.javCode);}
    catch{return Object.freeze({kind:'waiting',reasonCode:'jav_code_unrecognized'});}
    const works=options.workResultReader.listWorks({ownerDomain:'libra',processType:'libra_run',processId:run.libraRunId,workKind:'product_identity'});
    for(const work of [...works].sort((a,b)=>Number(a.created_at_ms)-Number(b.created_at_ms))) {
      for(const plan of options.workResultReader.readBindings(work.work_id)) {
        const intent=plan.inputBindings.bindings?.find(binding=>binding.portName==='productIdentityEvidenceIntent')?.parameters?.javIntent;
        if(intent?.contentProfile==='jav' && intent.javSelectionFence.expectedSelectionIntentRevision===0 &&
            intent.sourceSnapshot.queryAnchor.anchorDigest===anchor.anchorDigest &&
            intent.libraRunId===run.libraRunId && intent.subjectId===run.subjectId &&
            intent.runExecutionBasisDigest===run.executionBasisDigest) {
          sourceSnapshot=assertJavSourceSelectionSnapshot(intent.sourceSnapshot);break;
        }
      }
      if(sourceSnapshot)break;
    }
    if(!sourceSnapshot) {
      try{sourceSnapshot=options.productIdentitySelection.snapshotJavSources(anchor);}
      catch(error){if(error.code==='PLATFORM_INTEGRATION_NOT_CONFIGURED')return Object.freeze({kind:'waiting',reasonCode:'jav_source_not_configured'});throw error;}
    }
    sourceOrdinals=sourceSnapshot.sources.map(source=>source.ordinal);
  }
  assertJavSourceSelectionSnapshot(sourceSnapshot);
  let last=null;
  for(const sourceOrdinal of sourceOrdinals) {
    const intent=buildJavIdentityIntent({libraRunId:run.libraRunId,subjectId:run.subjectId,runExecutionBasisDigest:run.executionBasisDigest,
      sourceSnapshot,sourceOrdinal,javSelectionFence:fence,resourceKey,expectedTitle,expectedCoverDigest});
    const work=identityObservationWork(snapshot,intent.sourceKind,{workId:intent.intentId,resultDigest:intent.intentDigest});
    const result=options.workResultReader.read(work.workId).find(item=>item.outcomeKind==='succeeded'&&item.capabilityRef===CAPABILITY);
    if(result) {
      if(result.result.contentProfile!=='jav' || result.result.sourceOrdinal!==sourceOrdinal ||
          canonicalDigest(result.result.javSelectionFence)!==canonicalDigest(fence))throw new Error('JAV observation does not conserve the planned selection.');
      if(result.result.result==='resolved')return Object.freeze({kind:'resolved',work,intent,sourceResult:result});
      last=result;
      if(['ambiguous','conflicting'].includes(result.result.result))return Object.freeze({kind:'waiting',reasonCode:result.result.reasonCode,
        workId:work.workId,observationId:result.result.observationId,observationResult:result.result.result});
      continue;
    }
    const status=options.workResultReader.status(work.workId);
    if(status?.state==='failed') {
      if(!/^JAV_SOURCE_(?:UNAVAILABLE|TIMEOUT|ACCESS_DENIED|RESPONSE_INVALID|RESPONSE_TOO_LARGE|REDIRECT_DENIED|URL_DENIED|CHARSET_INVALID)$/.test(status.latestAttempt?.failure_code||''))
        throw new Error('JAV identity Work failed outside the source fallback contract.');
      continue;
    }
    return Object.freeze({kind:'observation',work,intent});
  }
  return Object.freeze({kind:'waiting',reasonCode:last?.result.reasonCode||'jav_sources_exhausted',
    observationId:last?.result.observationId||null,observationResult:last?.result.result||'not_found'});
}
module.exports=Object.freeze({nextJavIdentityStage});
